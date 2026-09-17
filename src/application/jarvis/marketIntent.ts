/**
 * Tier 0: a named instrument's current state, recognised without a model.
 *
 * "Hur gick S&P 500 idag?", "Vad gör tioåringen?", "Och Nasdaq?" have a
 * fresh structured answer already — a level, a move, a time, a source — and
 * the ruling of 2026-09-16 sets them a product target of about one second.
 * A general model round trip cannot meet that, and is not needed to turn
 * `-0.45 %` into a sentence. So this recogniser names the narrow class a
 * deterministic answer can serve truthfully, and nothing else.
 *
 * ## Conservative by construction
 *
 * A line is retrieval only when it names an instrument the platform serves
 * AND either asks for its state in plain words ("hur gick", "vad står",
 * "hur mycket upp", "idag", "just nu") or is a bare follow-up of a few
 * words ("Och Nasdaq?"). Any cue of judgement, reasoning or meaning —
 * "borde", "ska jag", "köpa", "varför", "vad betyder", "tror du", "framöver"
 * — refuses the match, whatever else the line says, and the line goes to
 * the one router. "Hur ser amerikanska börsen ut idag?" names no instrument
 * and is an overview: not Tier 0, the router's. Nothing here decides what
 * to do with capital; nothing here can open a case.
 */

import {
  SYM_BRENT,
  SYM_DAX,
  SYM_DE10Y,
  SYM_EURUSD,
  SYM_FTSE100,
  SYM_GOLD,
  SYM_NASDAQ100,
  SYM_NIKKEI225,
  SYM_OMXS30,
  SYM_SE10Y,
  SYM_SECTOR_COMMS,
  SYM_SECTOR_DISCRETIONARY,
  SYM_SECTOR_ENERGY,
  SYM_SECTOR_FINANCIALS,
  SYM_SECTOR_HEALTHCARE,
  SYM_SECTOR_INDUSTRIALS,
  SYM_SECTOR_REALESTATE,
  SYM_SECTOR_STAPLES,
  SYM_SECTOR_TECH,
  SYM_SP500,
  SYM_US10Y,
  SYM_US2Y,
  SYM_USDSEK,
  type CanonicalSymbol,
} from '~/domain/market'
import type { MarketScope } from './marketBrief'

export type RetrievalTarget =
  | { kind: 'quote'; symbol: CanonicalSymbol }
  | { kind: 'rate'; symbol: CanonicalSymbol }
  /** "Vilka sektorer går bäst?" — every US sector, best to worst. */
  | { kind: 'sectors' }
  /** The platform's risk-appetite score. */
  | { kind: 'risk' }
  /** A VIX level, which the platform does not serve; answered by saying so. */
  | { kind: 'vix' }

export interface RetrievalIntent {
  kind: 'retrieval'
  /** What was named, in order of mention, at most three. */
  targets: RetrievalTarget[]
}

interface LexiconEntry {
  pattern: RegExp
  target: RetrievalTarget
}

const quote = (symbol: CanonicalSymbol): RetrievalTarget => ({ kind: 'quote', symbol })
const rate = (symbol: CanonicalSymbol): RetrievalTarget => ({ kind: 'rate', symbol })

/*
 * Word boundaries that know Swedish letters. JavaScript's `\b` is ASCII-only:
 * before an "ä" there is no boundary, so `\bärende` never matched, and
 * `\beuro\w*` happily matched "Europa". Every pattern below is built with
 * these lookarounds instead, under the `u` flag.
 */
const B = '(?<![\\p{L}\\p{N}])'
const E = '(?![\\p{L}\\p{N}])'
/** Any inflection: "guld", "guldet", "guldpriset". */
const L = '\\p{L}*'
const words = (alternatives: readonly string[]): RegExp =>
  new RegExp(`${B}(?:${alternatives.join('|')})${E}`, 'iu')

/** Instrument names as a Swedish speaker says them. Each entry is one instrument; first mention wins. */
const LEXICON: readonly LexiconEntry[] = [
  { pattern: words(['s\\s?&\\s?p\\s?500', 's\\s?&\\s?p', 'sp500', 's och p', 'ess och pe']), target: quote(SYM_SP500) },
  { pattern: words(['nasdaq(?:\\s?100)?']), target: quote(SYM_NASDAQ100) },
  { pattern: words(['omx(?:s30)?', 'stockholmsbörsen', 'svenska börsen']), target: quote(SYM_OMXS30) },
  { pattern: words(['dax', 'tyska börsen']), target: quote(SYM_DAX) },
  { pattern: words(['ftse(?:\\s?100)?', 'londonbörsen']), target: quote(SYM_FTSE100) },
  { pattern: words(['nikkei(?:\\s?225)?', 'tokyobörsen']), target: quote(SYM_NIKKEI225) },
  { pattern: words([`tyska tioår${L}`, 'bund(?:en|s)?']), target: rate(SYM_DE10Y) },
  { pattern: words([`svenska tioår${L}`, `svenska statsobligation${L}`]), target: rate(SYM_SE10Y) },
  { pattern: words([`tioår${L}`, `tioårsränt${L}`, 'us 10[- ]?year', '10[- ]?year', '10y', `amerikanska långränt${L}`]), target: rate(SYM_US10Y) },
  { pattern: words([`tvåår${L}`, `tvåårsränt${L}`, 'us 2[- ]?year', '2[- ]?year', '2y']), target: rate(SYM_US2Y) },
  { pattern: words([`guld${L}`]), target: quote(SYM_GOLD) },
  { pattern: words([`olj${L}`, `brent${L}`]), target: quote(SYM_BRENT) },
  { pattern: words([`dollar${L}`, 'usd', 'usdsek', 'kronan']), target: quote(SYM_USDSEK) },
  { pattern: words(['euron?', `eurokurs${L}`, 'eurusd', 'euro[/-]dollar']), target: quote(SYM_EURUSD) },
  { pattern: words([`tech${L}`, `teknik${L}`, 'it-sektorn', 'information technology']), target: quote(SYM_SECTOR_TECH) },
  { pattern: words([`finans${L}`, `bank${L}`]), target: quote(SYM_SECTOR_FINANCIALS) },
  { pattern: words([`energi${L}`, `oljebolag${L}`]), target: quote(SYM_SECTOR_ENERGY) },
  { pattern: words([`hälsovård${L}`, 'health\\s?care', `läkemedel${L}`]), target: quote(SYM_SECTOR_HEALTHCARE) },
  { pattern: words([`industri${L}`, `verkstad${L}`]), target: quote(SYM_SECTOR_INDUSTRIALS) },
  { pattern: words([`kommunikation${L}`, `communication${L}`]), target: quote(SYM_SECTOR_COMMS) },
  { pattern: words([`sällanköp${L}`, 'discretionary', `konsument${L}`]), target: quote(SYM_SECTOR_DISCRETIONARY) },
  { pattern: words([`dagligvar${L}`, 'staples']), target: quote(SYM_SECTOR_STAPLES) },
  { pattern: words([`fastighet${L}`, 'real estate']), target: quote(SYM_SECTOR_REALESTATE) },
  { pattern: words([`sektor${L}`]), target: { kind: 'sectors' } },
  { pattern: words([`riskaptit${L}`, `risksentiment${L}`]), target: { kind: 'risk' } },
  { pattern: words(['vix', `volatilitetsindex${L}`]), target: { kind: 'vix' } },
]

/** Plain words for "what is its state". */
const STATE_CUE = words([
  'hur (?:gick|går|handlas|står|ligger|utvecklas|utvecklades|mår|rör sig|rörde sig|mycket|långt|stor)',
  'vad (?:står|ligger|gör|gjorde|kostar|är)',
  '(?:är|var|ligger|står|stängde|öppnade) \\S+ (?:upp|ner|ned|på)',
  'upp eller ner',
  'upp eller ned',
  'idag',
  'i dag',
  'just nu',
  'senaste',
  'nivån?',
  'kursen?',
  'noteringen?',
  'dagens',
  'utveckling(?:en)?',
  'stängning(?:en)?',
  'förändring(?:en)?',
])

/**
 * Cues of judgement, reasoning, meaning or institutional work. Any one
 * refuses the match, whatever else the line says.
 */
const NOT_RETRIEVAL = words([
  'borde',
  'bör',
  'ska (?:jag|vi)',
  'skall (?:jag|vi)',
  `köp${L}`,
  `sälj${L}`,
  `minska${L}`,
  `öka${L}`,
  `vikt${L}`,
  `position${L}`,
  `portfölj${L}`,
  `exponering${L}`,
  'varför',
  'hur kommer det sig',
  'vad betyder',
  'innebär',
  'förklara',
  'tycker',
  'tror (?:du|ni)',
  `attraktiv${L}`,
  `rekommend${L}`,
  `ärende${L}`,
  `kommitt${L}`,
  'tesen?',
  `scenario${L}`,
  `analys${L}`,
  `bedöm${L}`,
  `prognos${L}`,
  'framöver',
  'framtiden',
  'kommer \\S+ att',
  'risk(?:en|er|erna)? (?:med|för|att)',
  `värdering${L}`,
  'p/e',
  `multipl${L}`,
  `billig${L}`,
  `dyr${L}`,
  `övervärder${L}`,
  `undervärder${L}`,
  'driver',
  `drivkraft${L}`,
])

const WORD = /[\p{L}\p{N}&/]+/gu

/** A line is retrieval when it names an instrument and asks only for its state. */
export function recognizeRetrieval(text: string): RetrievalIntent | null {
  const line = text.trim()
  if (!line || line.length > 160) return null
  if (NOT_RETRIEVAL.test(line)) return null

  const hits: { index: number; target: RetrievalTarget }[] = []
  for (const entry of LEXICON) {
    const match = entry.pattern.exec(line)
    if (match) hits.push({ index: match.index, target: entry.target })
  }
  if (hits.length === 0) return null
  hits.sort((a, b) => a.index - b.index)
  /* One target per instrument, first mention wins; more than three names is a survey, not a lookup. */
  const targets: RetrievalTarget[] = []
  for (const hit of hits) {
    if (!targets.some((known) => sameTarget(known, hit.target))) targets.push(hit.target)
  }
  if (targets.length > 3) return null

  const tokens = line.match(WORD) ?? []
  const bareFollowUp = tokens.length <= 5
  if (!STATE_CUE.test(line) && !bareFollowUp) return null
  return { kind: 'retrieval', targets }
}

function sameTarget(a: RetrievalTarget, b: RetrievalTarget): boolean {
  if (a.kind !== b.kind) return false
  if ('symbol' in a && 'symbol' in b) return a.symbol === b.symbol
  return true
}

/** The narrowest brief scope that serves every target. */
export function scopeForRetrieval(intent: RetrievalIntent): MarketScope {
  const regions = new Set<MarketScope>()
  for (const target of intent.targets) {
    if (target.kind === 'sectors' || target.kind === 'risk' || target.kind === 'vix') {
      regions.add('us')
      continue
    }
    const symbol = target.symbol
    if (symbol === SYM_OMXS30 || symbol === SYM_SE10Y) regions.add('sweden')
    else if (symbol === SYM_DAX || symbol === SYM_FTSE100 || symbol === SYM_DE10Y) regions.add('europe')
    else if (symbol === SYM_NIKKEI225) regions.add('global')
    else regions.add('us')
  }
  if (regions.size === 1) return [...regions][0]!
  return 'global'
}

/**
 * Whether a line is about markets at all — the wider net that decides when
 * a fresh brief travels with a general turn as context, so "varför?" after a
 * market answer is answered from the same numbers rather than a second fetch.
 */
const MARKET_VOCABULARY = words([
  `börs${L}`, `marknad${L}`, `index${L}`, `ränt${L}`, `yield${L}`, `kurv${L}`, `dollar${L}`, 'euron?', `krona${L}`, `guld${L}`,
  `olj${L}`, 'brent', `sektor${L}`, `tech${L}`, `teknik${L}`, 'nasdaq', 's\\s?&\\s?p', `omx${L}`, 'dax', 'ftse', 'nikkei', 'vix',
  `riskaptit${L}`, `volatil${L}`, `aktie${L}`, `obligation${L}`, `tioår${L}`, `tvåår${L}`, `inflation${L}`, 'fed', 'ecb',
  `riksbank${L}`, `rapport${L}`, 'usa', 'wall street', 'stockholm', 'europa', 'asien',
])

export function mentionsMarket(text: string): boolean {
  return MARKET_VOCABULARY.test(text)
}
