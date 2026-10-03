/**
 * A market answer in Swedish, twice: the full text the presence shows, with
 * levels, times and sources; and the spoken form the voice reads, which is
 * the same facts in fewer words. Nothing here interprets, and nothing here
 * says the day for the week: a period that could not be served is said to
 * be missing, and today's figure beside it is called today's.
 */

import type { CanonicalSymbol } from '~/domain/market'
import type { MarketAnswer, MarketAnswerItem } from '~/application/jarvis/marketAnswer'
import type { BriefYield, MarketScope } from '~/application/jarvis/marketBrief'
import type { RetrievalTarget } from '~/application/jarvis/marketIntent'
import type { MarketPeriod } from '~/application/jarvis/marketQuery'
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
  const digits = symbol.startsWith('fx:') ? 4 : value >= 1000 ? 0 : 2
  return sv(value, { min: digits, max: digits })
}
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

/** "idag", "under veckan", "hittills i år", "i september". */
export function periodPhrase(period: MarketPeriod): string {
  switch (period.kind) {
    case 'today':
      return 'idag'
    case 'range':
      return {
        '1w': 'under veckan',
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

/** What is missing, as a series: "veckoserie", "månadsserie", "serie för september". */
function seriesNoun(period: MarketPeriod): string {
  switch (period.kind) {
    case 'today':
      return 'dagsnotering'
    case 'range':
      return {
        '1w': 'veckoserie',
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

/** A period a series could serve, once a provider does; a period nothing could. */
const periodServable = (period: MarketPeriod): boolean => period.kind !== 'unsupported'

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

/** "steg 1,4 procent" / "föll 0,8 procent" / "var oförändrad" — the past, for a period. */
const movePast = (changePercent: number): string =>
  Math.abs(changePercent) < 0.005
    ? 'var oförändrad'
    : `${changePercent > 0 ? 'steg' : 'föll'} ${pct(changePercent)} procent`

/** "är upp 0,42 procent" / "är ned 0,42 procent" / "är oförändrad" — the present, for today. */
const movePresent = (changePercent: number): string =>
  Math.abs(changePercent) < 0.005
    ? 'är oförändrad'
    : `är ${changePercent > 0 ? 'upp' : 'ned'} ${pct(changePercent)} procent`

/** "upp 0,8" — a second instrument in the same breath, the unit already said. */
const moveShort = (changePercent: number): string =>
  Math.abs(changePercent) < 0.005
    ? 'oförändrad'
    : `${changePercent > 0 ? 'upp' : 'ned'} ${pct(changePercent)}`

const joinSv = (parts: readonly string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} och ${parts[parts.length - 1]}`

/** "överlag positiv" / "överlag negativ" / "blandad", from the items with a figure. */
function tone(
  items: readonly MarketAnswerItem[],
): 'positiv' | 'negativ' | 'blandad' | null {
  const moves = items
    .map((item) => item.changePercent)
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

/** The provenance of a set of period moves: sources and the last point, once. */
function periodProvenance(items: readonly MarketAnswerItem[]): string {
  const served = items.filter((item) => item.source && item.observedAt)
  if (served.length === 0) return ''
  const sources = [...new Set(served.map((item) => item.source!))].join(' och ')
  const latest = served
    .map((item) => item.observedAt!)
    .sort()
    .at(-1)!
  return ` (${sources}, t.o.m. ${dayShort(latest)})`
}

/**
 * "Jag har dagens S&P 500-data, men inte en komplett veckoserie i den här
 * datakällan." — exactly what is missing: the period for the instruments
 * today's figure exists for, and the instrument itself for the rest.
 */
function missingSentence(answer: MarketAnswer): string {
  if (answer.missing.length === 0) return ''
  const noun = seriesNoun(answer.period)
  const servable = periodServable(answer.period)
  const withToday = answer.missing
    .filter((entry) => answer.todayOf.some((item) => item.symbol === entry.symbol))
    .map((entry) => entry.name)
  const without = answer.missing
    .filter((entry) => !answer.todayOf.some((item) => item.symbol === entry.symbol))
    .map((entry) => entry.name)
  const sentences: string[] = []
  if (withToday.length > 0) {
    const have =
      withToday.length === 1
        ? `dagens ${withToday[0]}-data`
        : `dagens data för ${joinSv(withToday)}`
    sentences.push(
      servable
        ? `Jag har ${have}, men inte en komplett ${noun} i den här datakällan.`
        : `Jag har ${have}, men ingen ${noun} i den här datakällan.`,
    )
  }
  if (without.length > 0) {
    sentences.push(
      withToday.length > 0
        ? `${joinSv(without)} saknas i datan just nu.`
        : `${joinSv(without)} saknas i datan just nu, och jag har ingen ${noun} i den här datakällan.`,
    )
  }
  return sentences.join(' ')
}

/* ------------------------------------------------------------------ text */

/** The full answer, as the presence shows it: levels, times and sources. */
export function marketAnswerText(answer: MarketAnswer): string {
  const { brief } = answer
  const sentences: string[] = []

  if (answer.kind === 'MARKET_RATES') {
    return answer.rates.length > 0
      ? retrievalSpeech(rateTargetsOf(answer.rates), brief)
      : 'Räntorna saknas i datan just nu; jag vill inte gissa.'
  }

  if (answer.period.kind === 'today') {
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
      sentences.push(
        `${label} idag är ${pick.name}, som ${movePresent(pick.changePercent!)}.`,
      )
    }
    if (answer.items.length > 0)
      sentences.push(
        `${lead ? `${lead} ` : ''}${retrievalSpeech(quoteTargetsOf(answer.items), brief)}`,
      )
    if (answer.missing.length > 0)
      sentences.push(
        `${joinSv(answer.missing.map((entry) => entry.name))} saknas i datan just nu — källan svarar inte, och jag vill inte gissa.`,
      )
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
  if (answer.items.length > 0) {
    const lead = answer.region
      ? `${regionName(answer.region)} ${phrase}${tone(answer.items) ? ` — ${verdict(answer.region, tone(answer.items)!)}` : ''}`
      : capitalize(phrase)
    const parts = answer.items.map(
      (item) =>
        `${item.name} ${movePast(item.changePercent!)} (${level(item.level!, item.symbol)})`,
    )
    sentences.push(`${lead}: ${joinSv(parts)}${periodProvenance(answer.items)}.`)
    if (
      (answer.kind === 'MARKET_COMPARE' || answer.kind === 'MARKET_BEST') &&
      answer.best
    ) {
      const pick =
        answer.superlative === 'worst' ? (answer.worst ?? answer.best) : answer.best
      const label = answer.superlative === 'worst' ? 'svagast' : 'bäst'
      if (answer.items.length > 1) sentences.push(`${pick.name} gick ${label}.`)
    }
  }
  const missing = missingSentence(answer)
  if (missing) sentences.push(missing)
  if (answer.todayOf.length > 0)
    sentences.push(`Idag: ${retrievalSpeech(quoteTargetsOf(answer.todayOf), brief)}`)
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

  if (answer.kind === 'MARKET_RATES') {
    if (answer.rates.length === 0)
      return 'Räntorna saknas i datan just nu; jag vill inte gissa.'
    const parts = answer.rates.slice(0, MAX_SPOKEN_ITEMS).map((rate, index) => {
      const name = rateName(rate)
      const value = sv(rate.yieldPercent, { min: 2, max: 2 })
      const change =
        rate.changeBasisPoints === null
          ? ''
          : Math.round(rate.changeBasisPoints) === 0
            ? ', oförändrad'
            : `, ${rate.changeBasisPoints > 0 ? 'upp' : 'ned'} ${Math.abs(Math.round(rate.changeBasisPoints))} ${Math.abs(Math.round(rate.changeBasisPoints)) === 1 ? 'baspunkt' : 'baspunkter'}`
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
      sentences.push(
        `${answer.superlative === 'worst' ? 'Svagast' : 'Bäst'} idag gick ${pick.name}, som ${movePresent(pick.changePercent!)}.`,
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
    /* What is missing is said once; an overview says what it has and leaves the gaps to the screen. */
    if (
      answer.missing.length > 0 &&
      (answer.kind !== 'MARKET_OVERVIEW' || items.length === 0)
    )
      sentences.push(
        `${joinSv(answer.missing.map((entry) => entry.name))} saknas i datan just nu.`,
      )
    if (answer.kind === 'MARKET_OVERVIEW' && brief.riskAppetite)
      sentences.push(`Riskaptiten står i ${brief.riskAppetite.score} av 100.`)
    for (const name of answer.notServed)
      sentences.push(`${name} serveras inte av plattformen.`)
    return sentences.join(' ')
  }

  /* A period. */
  const phrase = periodPhrase(answer.period)
  const items = answer.items.slice(0, MAX_SPOKEN_ITEMS)
  if (items.length === 1) {
    sentences.push(`${items[0]!.name} ${movePast(items[0]!.changePercent!)} ${phrase}.`)
  } else if (items.length > 1) {
    const [first, ...rest] = items
    const restParts = rest.map((item) => `${item.name} ${moveShort(item.changePercent!)}`)
    sentences.push(
      `${first!.name} ${movePast(first!.changePercent!)} ${phrase} medan ${joinSv(restParts)}.`,
    )
    if (
      (answer.kind === 'MARKET_COMPARE' || answer.kind === 'MARKET_BEST') &&
      answer.best
    ) {
      const pick =
        answer.superlative === 'worst' ? (answer.worst ?? answer.best) : answer.best
      sentences.push(
        `${pick.name} gick alltså ${answer.superlative === 'worst' ? 'svagast' : 'bäst'}.`,
      )
    } else {
      const mood = tone(items)
      if (answer.region && mood)
        sentences.push(
          `${regionName(answer.region)} var alltså ${verdict(answer.region, mood)} ${phrase}.`,
        )
    }
  }
  const missing = missingSentence(answer)
  if (missing) sentences.push(missing)
  if (answer.todayOf.length > 0) {
    const todays = answer.todayOf.slice(0, MAX_SPOKEN_ITEMS)
    const parts = todays
      .filter((item) => item.changePercent !== null)
      .map((item, index) =>
        index === 0
          ? `${item.name} ${movePresent(item.changePercent!)}`
          : `${item.name} ${moveShort(item.changePercent!)}`,
      )
    if (parts.length) sentences.push(`Idag ${joinSv(parts)}.`)
  }
  for (const name of answer.notServed)
    sentences.push(`${name} serveras inte av plattformen.`)
  return sentences.join(' ')
}

function rateName(rate: BriefYield): string {
  switch (rate.symbol) {
    case 'rate:us10y':
      return 'USA:s tioårsränta'
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

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)
