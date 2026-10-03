/**
 * A market answer in Swedish, twice: the full text the presence shows, with
 * levels, dates, times and sources; and the spoken form the voice reads,
 * which is the same facts in fewer words. Nothing here interprets, and
 * nothing here says the day for the week: a period that could not be served
 * is said to be missing, and today's figure beside it is called today's.
 * A yield moves in basis points, never in "performance".
 */

import type { CanonicalSymbol } from '~/domain/market'
import type {
  MarketAnswer,
  MarketAnswerItem,
  MarketAnswerMissing,
} from '~/application/jarvis/marketAnswer'
import type { BriefYield, MarketScope } from '~/application/jarvis/marketBrief'
import type { RetrievalTarget } from '~/application/jarvis/marketIntent'
import {
  BEST_UNIVERSE_QUESTION,
  UNIVERSES,
  type MarketPeriod,
} from '~/application/jarvis/marketQuery'
import { retrievalSpeech } from './marketSpeech'

const TZ = 'Europe/Stockholm'

const MONTH_NAMES = [
  'januari',
  'februari',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'augusti',
  'september',
  'oktober',
  'november',
  'december',
] as const

/* Swedish formatting, with the locale's non-breaking thousands separator made an ordinary space for speech and text. */
const sv = (value: number, digits: { min: number; max: number }) =>
  new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: digits.min,
    maximumFractionDigits: digits.max,
  })
    .format(value)
    .replace(/ /g, ' ')
const pct = (value: number): string => sv(Math.abs(value), { min: 1, max: 2 })
const level = (value: number, symbol: string): string => {
  const digits = symbol.startsWith('fx:')
    ? 4
    : symbol.startsWith('rate:')
      ? 2
      : value >= 1000
        ? 0
        : 2
  return sv(value, { min: digits, max: digits })
}
const bpWord = (value: number): string =>
  Math.abs(Math.round(value)) === 1 ? 'baspunkt' : 'baspunkter'
const bpAbs = (value: number): string => String(Math.abs(Math.round(value)))
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('sv-SE', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  })
const dayShort = (iso: string) =>
  new Date(iso).toLocaleDateString('sv-SE', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
  })
const dayLong = (iso: string) =>
  new Date(iso).toLocaleDateString('sv-SE', {
    timeZone: TZ,
    day: 'numeric',
    month: 'long',
  })
const dateOnly = (date: string) => dayShort(`${date}T12:00:00.000Z`)

/* --------------------------------------------------------------- periods */

/** "idag", "den här veckan", "hittills i år", "i september". */
export function periodPhrase(period: MarketPeriod): string {
  switch (period.kind) {
    case 'today':
      return 'idag'
    case 'range':
      return {
        'this-week': 'den här veckan',
        '5d': 'de senaste fem handelsdagarna',
        '1w': 'den senaste veckan',
        mtd: 'den här månaden',
        '1m': 'den senaste månaden',
        '3m': 'det senaste kvartalet',
        '1y': 'det senaste året',
        ytd: 'hittills i år',
      }[period.range]
    case 'month':
      return `i ${MONTH_NAMES[period.month - 1]}`
    case 'unsupported':
      return period.label
  }
}

/** The period as a card label: "DEN HÄR VECKAN", "SEPTEMBER". */
export function periodLabel(period: MarketPeriod): string {
  if (period.kind === 'month') return MONTH_NAMES[period.month - 1]!.toUpperCase()
  return periodPhrase(period).toUpperCase()
}

/** What is missing, as a series: "veckoserie", "månadsserie", "serie för september". */
function seriesNoun(period: MarketPeriod): string {
  switch (period.kind) {
    case 'today':
      return 'dagsnotering'
    case 'range':
      return {
        'this-week': 'veckoserie',
        '5d': 'serie för de senaste handelsdagarna',
        '1w': 'veckoserie',
        mtd: 'månadsserie',
        '1m': 'månadsserie',
        '3m': 'kvartalsserie',
        '1y': 'årsserie',
        ytd: 'serie för året',
      }[period.range]
    case 'month':
      return `serie för ${MONTH_NAMES[period.month - 1]}`
    case 'unsupported':
      return `serie för ${period.label}`
  }
}

/** "vecka", "månad", "kvartal", "år" — for "USA-börsen hade en positiv vecka". */
function periodNoun(period: MarketPeriod): string | null {
  if (period.kind === 'month') return 'månad'
  if (period.kind !== 'range') return null
  return {
    'this-week': 'vecka',
    '5d': 'vecka',
    '1w': 'vecka',
    mtd: 'månad',
    '1m': 'månad',
    '3m': 'kvartal',
    '1y': 'år',
    ytd: 'år',
  }[period.range]
}

/** A period a series could serve, once a provider does; a period nothing could. */
const periodServable = (period: MarketPeriod): boolean => period.kind !== 'unsupported'

/** A named month already over is spoken in the past; a period still under way in the present. */
function completed(answer: MarketAnswer): boolean {
  if (answer.period.kind !== 'month') return false
  const end = new Date(Date.UTC(answer.period.year, answer.period.month, 0, 23, 59, 59))
  return end.getTime() < new Date(answer.generatedAt).getTime()
}

export function regionName(region: MarketScope): string {
  return {
    us: 'USA-börsen',
    europe: 'Europabörserna',
    sweden: 'Stockholmsbörsen',
    global: 'Börserna',
  }[region]
}

/** The verdict agreeing with its subject: "USA-börsen var överlag positiv", "Börserna var överlag positiva". */
function verdict(region: MarketScope, mood: 'positiv' | 'negativ' | 'blandad'): string {
  const plural = region === 'global' || region === 'europe'
  if (mood === 'blandad') return plural ? 'blandade' : 'blandad'
  return `överlag ${mood}${plural ? 'a' : ''}`
}

/* ----------------------------------------------------------------- moves */

/** "är upp 0,42 procent" / "är ned 0,42 procent" / "är oförändrad" — the present. */
const movePresent = (changePercent: number): string =>
  Math.abs(changePercent) < 0.005
    ? 'är oförändrad'
    : `är ${changePercent > 0 ? 'upp' : 'ned'} ${pct(changePercent)} procent`

/** "steg 1,4 procent" / "föll 0,8 procent" / "var oförändrad" — the past. */
const movePast = (changePercent: number): string =>
  Math.abs(changePercent) < 0.005
    ? 'var oförändrad'
    : `${changePercent > 0 ? 'steg' : 'föll'} ${pct(changePercent)} procent`

/** "upp 0,8" — a second instrument in the same breath, the unit already said. */
const moveShort = (changePercent: number): string =>
  Math.abs(changePercent) < 0.005
    ? 'oförändrad'
    : `${changePercent > 0 ? 'upp' : 'ned'} ${pct(changePercent)}`

/** "är upp 14 baspunkter" / "steg 14 baspunkter" / "är oförändrad". */
const bpMove = (basisPoints: number, past: boolean): string => {
  const rounded = Math.round(basisPoints)
  if (rounded === 0) return past ? 'var oförändrad' : 'är oförändrad'
  const direction = rounded > 0 ? (past ? 'steg' : 'är upp') : past ? 'föll' : 'är ned'
  return `${direction} ${bpAbs(basisPoints)} ${bpWord(basisPoints)}`
}

/** An item's move, by its kind, in the tense asked for. */
function itemMove(item: MarketAnswerItem, past: boolean): string {
  if (item.metric === 'yield') {
    if (item.changeBasisPoints === null) return 'saknar förändring i källan'
    return bpMove(item.changeBasisPoints, past)
  }
  if (item.changePercent === null) return 'saknar förändring i källan'
  return past ? movePast(item.changePercent) : movePresent(item.changePercent)
}

/** The move as a signed figure for the screen: "+1,6 %", "−0,8 %", "+14 bp". */
export function signedMove(item: MarketAnswerItem): string {
  if (item.metric === 'yield') {
    if (item.changeBasisPoints === null) return '–'
    const rounded = Math.round(item.changeBasisPoints)
    return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${bpAbs(item.changeBasisPoints)} bp`
  }
  if (item.changePercent === null) return '–'
  return `${item.changePercent > 0.005 ? '+' : item.changePercent < -0.005 ? '−' : '±'}${pct(item.changePercent)} %`
}

const joinSv = (parts: readonly string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} och ${parts[parts.length - 1]}`

/** "överlag positiv" / "överlag negativ" / "blandad", from the items with a figure. */
function tone(
  items: readonly MarketAnswerItem[],
): 'positiv' | 'negativ' | 'blandad' | null {
  const moves = items
    .map((item) =>
      item.metric === 'yield' ? item.changeBasisPoints : item.changePercent,
    )
    .filter((c): c is number => c !== null)
  if (moves.length === 0) return null
  if (moves.every((c) => c > 0.005)) return 'positiv'
  if (moves.every((c) => c < -0.005)) return 'negativ'
  return 'blandad'
}

const quoteTargetsOf = (items: readonly MarketAnswerItem[]): RetrievalTarget[] =>
  items.map((item) => ({ kind: 'quote', symbol: item.symbol }))

const rateTargetsOf = (rates: readonly BriefYield[]): RetrievalTarget[] =>
  rates.map((rate) => ({ kind: 'rate', symbol: rate.symbol as CanonicalSymbol }))

export function rateName(symbol: string, fallback: string): string {
  switch (symbol) {
    case 'rate:us10y':
      return 'USA:s tioårsränta'
    case 'rate:us2y':
      return 'USA:s tvåårsränta'
    case 'rate:de10y':
      return 'Tysklands tioårsränta'
    case 'rate:se10y':
      return 'Sveriges tioårsränta'
    default:
      return fallback
  }
}

const spokenName = (item: MarketAnswerItem): string =>
  item.metric === 'yield' ? rateName(item.symbol, item.name) : item.name

/** "7 650 → 7 773, 25 sep – 2 okt" */
function spanText(item: MarketAnswerItem): string {
  if (!item.start || !item.end) return ''
  return `${level(item.start.value, item.symbol)} → ${level(item.end.value, item.symbol)}, ${dateOnly(item.start.date)} – ${dateOnly(item.end.date)}`
}

/** "Yahoo Finance, t.o.m. 2 okt 16:59" */
function provenanceText(item: MarketAnswerItem): string {
  if (!item.source) return ''
  const when = item.observedAt
    ? item.observedAt.endsWith('T00:00:00.000Z')
      ? dayShort(item.observedAt)
      : `${dayShort(item.observedAt)} ${clock(item.observedAt)}`
    : ''
  return `${item.source}${when ? `, t.o.m. ${when}` : ''}`
}

/** "Senaste observationen är från 26 september." */
function staleNote(items: readonly MarketAnswerItem[]): string {
  const stale = items.find((item) => item.latestIsStale && item.end)
  return stale
    ? `Senaste observationen för ${stale.name} är från ${dayLong(`${stale.end!.date}T12:00:00.000Z`)}.`
    : ''
}

/* ---------------------------------------------------------------- missing */

/**
 * Exactly what is missing. Where no source exists at all the answer says
 * what data it has; where a source exists but could not serve a complete
 * series, it says it cannot verify one right now. Today's figure follows,
 * named as today's.
 */
function missingSentences(answer: MarketAnswer, spoken: boolean): string[] {
  if (answer.missing.length === 0) return []
  const noun = seriesNoun(answer.period)
  const sentences: string[] = []
  const unverifiable = answer.missing.filter((entry) =>
    ['no-series', 'fixture', 'insufficient-coverage', 'incomplete-series'].includes(
      entry.reason,
    ),
  )
  const absent = answer.missing.filter((entry) => !unverifiable.includes(entry))
  if (unverifiable.length > 0) {
    sentences.push(
      `Jag kan inte verifiera en komplett ${noun} för ${joinSv(unverifiable.map((entry) => entry.name))} just nu.`,
    )
  }
  if (absent.length > 0) {
    const withToday = absent.filter((entry) =>
      answer.todayOf.some((item) => item.symbol === entry.symbol),
    )
    const without = absent.filter((entry) => !withToday.includes(entry))
    if (withToday.length > 0) {
      const have =
        withToday.length === 1
          ? `dagens ${withToday[0]!.name}-data`
          : `dagens data för ${joinSv(withToday.map((entry) => entry.name))}`
      sentences.push(
        periodServable(answer.period)
          ? `Jag har ${have}, men inte en komplett ${noun} i den här datakällan.`
          : `Jag har ${have}, men ingen ${noun} i den här datakällan.`,
      )
    }
    if (without.length > 0) {
      sentences.push(
        withToday.length > 0 || unverifiable.length > 0
          ? `${joinSv(without.map((entry) => entry.name))} saknas i datan just nu.`
          : `${joinSv(without.map((entry) => entry.name))} saknas i datan just nu, och jag har ingen ${noun} i den här datakällan.`,
      )
    }
  }
  const todays = answer.todayOf.filter(
    (item) => item.changePercent !== null || item.changeBasisPoints !== null,
  )
  if (todays.length > 0) {
    const parts = todays
      .slice(0, 3)
      .map((item) =>
        item.metric === 'yield'
          ? `${spokenName(item)} ${bpMove(item.changeBasisPoints!, false)}`
          : `${item.name} ${movePresent(item.changePercent!).replace(/^är /, '')}`,
      )
    sentences.push(
      spoken
        ? `Dagens förändring: ${joinSv(parts)}.`
        : `Idag: ${retrievalSpeech(todayTargets(todays), answer.brief)}`,
    )
  }
  return sentences
}

const todayTargets = (items: readonly MarketAnswerItem[]): RetrievalTarget[] =>
  items.map((item) =>
    item.metric === 'yield'
      ? { kind: 'rate', symbol: item.symbol }
      : { kind: 'quote', symbol: item.symbol },
  )

/** Today's gaps, told apart: an index served for history only, and a source that did not answer. */
const missingOnly = (entries: readonly MarketAnswerMissing[]): string => {
  const historyOnly = entries.filter((entry) => entry.reason === 'no-live-quote')
  const unserved = entries.filter((entry) => entry.reason !== 'no-live-quote')
  const sentences: string[] = []
  if (historyOnly.length > 0)
    sentences.push(
      `${joinSv(historyOnly.map((entry) => entry.name))} har ingen dagsnotering i den här datakällan; jag kan svara om veckan, månaden eller året.`,
    )
  if (unserved.length > 0)
    sentences.push(
      `${joinSv(unserved.map((entry) => entry.name))} saknas i datan just nu — källan svarar inte, och jag vill inte gissa.`,
    )
  return sentences.join(' ')
}

/** The same two gaps, spoken shorter. */
const missingSpoken = (entries: readonly MarketAnswerMissing[]): string => {
  const historyOnly = entries.filter((entry) => entry.reason === 'no-live-quote')
  const unserved = entries.filter((entry) => entry.reason !== 'no-live-quote')
  const sentences: string[] = []
  if (historyOnly.length > 0)
    sentences.push(
      `${joinSv(historyOnly.map((entry) => entry.name))} har ingen dagsnotering här, men jag kan svara om perioder.`,
    )
  if (unserved.length > 0)
    sentences.push(
      `${joinSv(unserved.map((entry) => entry.name))} saknas i datan just nu.`,
    )
  return sentences.join(' ')
}

/** "Bland de stora USA-indexen", when the ranking's universe was inferred rather than named. */
const universeLead = (answer: MarketAnswer): string | null =>
  answer.universe ? `Bland ${UNIVERSES[answer.universe].name}` : null

/* ------------------------------------------------------------------ text */

/** The full answer, as the presence shows it: levels, dates, times and sources. */
export function marketAnswerText(answer: MarketAnswer): string {
  const { brief } = answer
  const sentences: string[] = []

  /* The one question back is the whole answer. */
  if (answer.kind === 'MARKET_CLARIFY')
    return answer.clarification ?? BEST_UNIVERSE_QUESTION

  if (answer.kind === 'MARKET_RATES') {
    return answer.rates.length > 0
      ? retrievalSpeech(rateTargetsOf(answer.rates), brief)
      : 'Räntorna saknas i datan just nu; jag vill inte gissa.'
  }

  if (answer.period.kind === 'today') {
    /* An index served for history only has no Tier-0 sentence; the gap is said, beside what was served. */
    const historyOnly = answer.missing.filter((entry) => entry.reason === 'no-live-quote')
    if (historyOnly.length > 0 && answer.kind === 'MARKET_INDEX_PERFORMANCE') {
      const served = answer.targets.filter(
        (target) =>
          !('symbol' in target) ||
          !historyOnly.some((entry) => entry.symbol === target.symbol),
      )
      return [
        served.length > 0 ? retrievalSpeech(served, brief) : '',
        missingOnly(historyOnly),
      ]
        .filter(Boolean)
        .join(' ')
    }
    if (
      answer.kind === 'MARKET_SECTORS' ||
      answer.kind === 'MARKET_RISK' ||
      answer.kind === 'MARKET_VIX' ||
      answer.kind === 'MARKET_NOT_SERVED' ||
      answer.kind === 'MARKET_INDEX_PERFORMANCE'
    ) {
      /* The Tier-0 sentence, unchanged: a level, a move, a session, a time, a source. */
      return retrievalSpeech(answer.targets, brief)
    }
    const lead =
      answer.kind === 'MARKET_OVERVIEW'
        ? 'Läget idag:'
        : answer.region
          ? `${regionName(answer.region)} idag${tone(answer.items) ? ` — ${verdict(answer.region, tone(answer.items)!)}` : ''}:`
          : ''
    if (answer.kind === 'MARKET_BEST' && answer.best) {
      const label = answer.superlative === 'worst' ? 'Svagast' : 'Starkast'
      const pick =
        answer.superlative === 'worst' ? (answer.worst ?? answer.best) : answer.best
      const among = universeLead(answer)
      sentences.push(
        among
          ? `${among} är ${pick.name} ${label.toLowerCase()} idag, ${movePresent(pick.changePercent!).replace(/^är /, '')}.`
          : `${label} idag är ${pick.name}, som ${movePresent(pick.changePercent!)}.`,
      )
    }
    if (answer.items.length > 0)
      sentences.push(
        `${lead ? `${lead} ` : ''}${retrievalSpeech(quoteTargetsOf(answer.items), brief)}`,
      )
    const missing = missingOnly(answer.missing)
    if (missing) sentences.push(missing)
    if (answer.kind === 'MARKET_OVERVIEW' && brief.riskAppetite)
      sentences.push(
        `Riskaptitindexet står i ${brief.riskAppetite.score} av 100 (härlett, aldrig en VIX-nivå).`,
      )
    for (const name of answer.notServed)
      sentences.push(`${name} serveras inte av plattformen.`)
    return sentences.filter(Boolean).join(' ')
  }

  /* A period. */
  const phrase = periodPhrase(answer.period)
  const past = completed(answer)
  if (answer.items.length > 0) {
    const mood = tone(answer.items)
    if (answer.region && mood) {
      const noun = periodNoun(answer.period)
      sentences.push(
        noun
          ? `${regionName(answer.region)} ${past ? 'hade' : 'har'} en ${mood === 'blandad' ? 'blandad' : mood} ${noun}${answer.period.kind === 'month' ? ` ${phrase}` : ''}.`
          : `${regionName(answer.region)} ${phrase}: ${verdict(answer.region, mood)}.`,
      )
    }
    for (const item of answer.items) {
      const span = spanText(item)
      const provenance = provenanceText(item)
      const detail = [span, provenance].filter(Boolean).join('; ')
      sentences.push(
        `${spokenName(item)} ${itemMove(item, past)} ${phrase}${item.metric === 'yield' && item.level !== null ? `, till ${level(item.level, item.symbol)} procent` : ''}${detail ? ` (${detail})` : ''}.`,
      )
    }
    if (answer.comparison) {
      const { a, b, differencePercentagePoints, differenceBasisPoints } =
        answer.comparison
      if (differencePercentagePoints !== null)
        sentences.push(
          `${a.name} ${differencePercentagePoints >= 0 ? 'före' : 'efter'} ${b.name} med ${sv(Math.abs(differencePercentagePoints), { min: 1, max: 2 })} procentenheter.`,
        )
      else if (differenceBasisPoints !== null)
        sentences.push(
          `Skillnaden är ${bpAbs(differenceBasisPoints)} ${bpWord(differenceBasisPoints)} till ${differenceBasisPoints >= 0 ? spokenName(a) : spokenName(b)}s fördel.`,
        )
    } else if (answer.kind === 'MARKET_BEST' && answer.best && answer.items.length > 1) {
      const pick =
        answer.superlative === 'worst' ? (answer.worst ?? answer.best) : answer.best
      const among = universeLead(answer)
      const word = answer.superlative === 'worst' ? 'svagast' : 'bäst'
      sentences.push(
        among ? `${among} gick ${pick.name} ${word}.` : `${pick.name} gick ${word}.`,
      )
    }
    const stale = staleNote(answer.items)
    if (stale) sentences.push(stale)
  }
  sentences.push(...missingSentences(answer, false))
  for (const name of answer.notServed)
    sentences.push(`${name} serveras inte av plattformen.`)
  return sentences.filter(Boolean).join(' ')
}

/* ---------------------------------------------------------------- speech */

const MAX_SPOKEN_ITEMS = 3

function spokenToday(item: MarketAnswerItem): string {
  if (item.changePercent === null)
    return `${item.name} står i ${level(item.level!, item.symbol)}, men dagsförändringen saknas i källan.`
  if (item.freshness === 'stale')
    return `Senaste noteringen för ${item.name} är från kl. ${clock(item.observedAt!)}: ${movePresent(item.changePercent).replace(/^är /, '')}.`
  return `${item.name} ${movePresent(item.changePercent)} idag.`
}

/** The spoken answer: the same facts in one or two sentences. */
export function marketAnswerSpeech(answer: MarketAnswer): string {
  const { brief } = answer

  if (answer.kind === 'MARKET_CLARIFY')
    return answer.clarification ?? BEST_UNIVERSE_QUESTION

  if (answer.kind === 'MARKET_RATES') {
    if (answer.rates.length === 0)
      return 'Räntorna saknas i datan just nu; jag vill inte gissa.'
    const parts = answer.rates.slice(0, MAX_SPOKEN_ITEMS).map((rate, index) => {
      const name = index === 0 ? rateName(rate.symbol, rate.name) : shortRateName(rate)
      const value = sv(rate.yieldPercent, { min: 2, max: 2 })
      const change =
        rate.changeBasisPoints === null
          ? ''
          : Math.round(rate.changeBasisPoints) === 0
            ? ', oförändrad'
            : `, ${rate.changeBasisPoints > 0 ? 'upp' : 'ned'} ${bpAbs(rate.changeBasisPoints)} ${bpWord(rate.changeBasisPoints)}`
      return index === 0
        ? `${name} ligger på ${value} procent${change}`
        : `${name} på ${value}${change}`
    })
    return `${joinSv(parts)}.`
  }

  if (
    answer.kind === 'MARKET_SECTORS' ||
    answer.kind === 'MARKET_RISK' ||
    answer.kind === 'MARKET_VIX' ||
    answer.kind === 'MARKET_NOT_SERVED'
  )
    return retrievalSpeech(answer.targets, brief)

  const sentences: string[] = []

  if (answer.period.kind === 'today') {
    const items = answer.items.slice(0, MAX_SPOKEN_ITEMS)
    /* An index served for history only: the gap said shortly, beside what was served. */
    const historyOnly = answer.missing.filter((entry) => entry.reason === 'no-live-quote')
    if (historyOnly.length > 0 && answer.kind === 'MARKET_INDEX_PERFORMANCE') {
      const served = answer.targets.filter(
        (target) =>
          !('symbol' in target) ||
          !historyOnly.some((entry) => entry.symbol === target.symbol),
      )
      return [
        served.length > 0 ? retrievalSpeech(served, brief) : '',
        missingSpoken(historyOnly),
      ]
        .filter(Boolean)
        .join(' ')
    }
    /* A rate, or an instrument the brief could not serve: the Tier-0 sentence already says it shortly and honestly. */
    if (
      items.length === 0 &&
      answer.targets.length > 0 &&
      answer.kind !== 'MARKET_OVERVIEW'
    )
      return retrievalSpeech(answer.targets, brief)
    if (answer.kind === 'MARKET_BEST' && answer.best) {
      const pick =
        answer.superlative === 'worst' ? (answer.worst ?? answer.best) : answer.best
      const among = universeLead(answer)
      sentences.push(
        among
          ? `${among} gick ${pick.name} ${answer.superlative === 'worst' ? 'svagast' : 'bäst'} idag, ${movePresent(pick.changePercent!).replace(/^är /, '')}.`
          : `${answer.superlative === 'worst' ? 'Svagast' : 'Bäst'} idag gick ${pick.name}, som ${movePresent(pick.changePercent!)}.`,
      )
    } else if (items.length === 1) {
      sentences.push(spokenToday(items[0]!))
    } else if (items.length > 1) {
      const [first, ...rest] = items
      const restParts = rest
        .filter((item) => item.changePercent !== null)
        .map((item) => `${item.name} ${moveShort(item.changePercent!)}`)
      sentences.push(
        `${first!.name} ${first!.changePercent === null ? 'saknar dagsförändring' : movePresent(first!.changePercent)} idag${restParts.length ? ` och ${joinSv(restParts)}` : ''}.`,
      )
      const mood = tone(items)
      if (answer.region && mood)
        sentences.push(
          `${regionName(answer.region)} är alltså ${verdict(answer.region, mood)} idag.`,
        )
    }
    if (
      answer.missing.length > 0 &&
      (answer.kind !== 'MARKET_OVERVIEW' || items.length === 0)
    )
      sentences.push(missingSpoken(answer.missing))
    if (answer.kind === 'MARKET_OVERVIEW' && brief.riskAppetite)
      sentences.push(`Riskaptiten står i ${brief.riskAppetite.score} av 100.`)
    for (const name of answer.notServed)
      sentences.push(`${name} serveras inte av plattformen.`)
    return sentences.join(' ')
  }

  /* A period. */
  const phrase = periodPhrase(answer.period)
  const past = completed(answer)
  const items = answer.items.slice(0, MAX_SPOKEN_ITEMS)
  if (answer.comparison) {
    const { a, b, differencePercentagePoints, differenceBasisPoints } = answer.comparison
    if (a.metric === 'yield' && differenceBasisPoints !== null) {
      sentences.push(
        `${spokenName(a)} ${bpMove(a.changeBasisPoints!, past)} ${phrase} mot ${spokenName(b)}s ${Math.round(b.changeBasisPoints!)}, alltså ${bpAbs(differenceBasisPoints)} ${bpWord(differenceBasisPoints)} ${differenceBasisPoints >= 0 ? 'mer' : 'mindre'}.`,
      )
    } else if (differencePercentagePoints !== null) {
      const bMove =
        b.changePercent! < -0.005
          ? `minus ${pct(b.changePercent!)}`
          : pct(b.changePercent!)
      sentences.push(
        `${a.name} ${itemMove(a, past)} ${phrase} mot ${b.name}:s ${bMove}, alltså ${sv(Math.abs(differencePercentagePoints), { min: 1, max: 2 })} procentenheter ${differencePercentagePoints >= 0 ? 'mer' : 'mindre'}.`,
      )
    } else {
      sentences.push(
        `${a.name} ${itemMove(a, past)} ${phrase} och ${b.name} ${itemMove(b, past)}.`,
      )
    }
  } else if (answer.kind === 'MARKET_BEST' && answer.best && answer.items.length > 1) {
    const pick =
      answer.superlative === 'worst' ? (answer.worst ?? answer.best) : answer.best
    const other = pick === answer.best ? answer.worst : answer.best
    const among = universeLead(answer)
    sentences.push(
      among
        ? `${among} gick ${pick.name} ${answer.superlative === 'worst' ? 'svagast' : 'bäst'} ${phrase}, ${itemMove(pick, past).replace(/^(?:är|var) /, '')}${other ? `; ${other.name} ${itemMove(other, past)}` : ''}.`
        : `${answer.superlative === 'worst' ? 'Svagast' : 'Bäst'} ${phrase} gick ${pick.name}, som ${itemMove(pick, past)}${other ? `; ${other.name} ${itemMove(other, past)}` : ''}.`,
    )
  } else if (items.length === 1) {
    const item = items[0]!
    const tail =
      item.metric === 'yield' && item.level !== null
        ? `, till ${level(item.level, item.symbol)} procent`
        : item.metric === 'price' && item.level !== null
          ? `. Indexet står senast i ${level(item.level, item.symbol)}`
          : item.metric === 'fx' && item.level !== null
            ? `, senast ${level(item.level, item.symbol)}`
            : ''
    sentences.push(`${spokenName(item)} ${itemMove(item, past)} ${phrase}${tail}.`)
  } else if (items.length > 1) {
    const [first, ...rest] = items
    const restParts = rest.map((item) =>
      item.metric === 'yield'
        ? `${spokenName(item)} ${bpMove(item.changeBasisPoints ?? 0, past)}`
        : `${item.name} ${item.changePercent === null ? 'saknar förändring' : moveShort(item.changePercent)}`,
    )
    sentences.push(
      `${spokenName(first!)} ${itemMove(first!, past)} ${phrase} och ${joinSv(restParts)}.`,
    )
    const mood = tone(items)
    const noun = periodNoun(answer.period)
    if (answer.region && mood && noun)
      sentences.push(
        `${regionName(answer.region)} ${past ? 'hade' : 'har'} alltså en ${mood === 'blandad' ? 'blandad' : mood} ${noun}.`,
      )
  }
  const stale = staleNote(items)
  if (stale) sentences.push(stale)
  sentences.push(...missingSentences(answer, true))
  for (const name of answer.notServed)
    sentences.push(`${name} serveras inte av plattformen.`)
  return sentences.join(' ')
}

function shortRateName(rate: BriefYield): string {
  switch (rate.symbol) {
    case 'rate:us10y':
      return 'tioåringen'
    case 'rate:us2y':
      return 'tvååringen'
    case 'rate:de10y':
      return 'Tysklands tioårsränta'
    case 'rate:se10y':
      return 'Sveriges tioårsränta'
    default:
      return rate.name
  }
}
