/**
 * The structured answer to a market query — one answer, two renderers and a
 * card.
 *
 * Every figure here comes from the market brief (today) or from a real
 * daily series the platform holds (a period), with its provenance beside
 * it. A period move is measured by the kind of instrument — a price in
 * percent, a yield in basis points, an FX pair in percent of the quoted
 * pair — and never derived from today's change. What the platform cannot
 * serve for the period asked is listed as missing with its reason, and
 * today's figure for the same instrument travels separately, labelled as
 * today's, so a renderer can say "I cannot verify a complete weekly series
 * for S&P 500; today's change is +0,7 %" and never pass the day off as
 * the week.
 */

import {
  SYM_DJIA,
  SYM_RUSSELL2000,
  type CanonicalSymbol,
  type ChangePeriod,
  type SessionState,
} from '~/domain/market'
import type { SeriesMetric } from '~/application/marketData/history'
import type { BriefQuote, BriefYield, MarketBrief, MarketScope } from './marketBrief'
import {
  periodPerformance,
  type MarketHistorySource,
  type PeriodChange,
  type PeriodMissingReason,
} from './marketHistory'
import type { RetrievalTarget } from './marketIntent'
import {
  conversationAfter,
  scopeForQuery,
  type MarketConversation,
  type MarketIntentKind,
  type MarketPeriod,
  type MarketQuery,
  type MarketUniverse,
} from './marketQuery'

export interface MarketObservationRef {
  date: string
  value: number
}

export interface MarketAnswerItem {
  symbol: CanonicalSymbol
  name: string
  metric: SeriesMetric
  /** The period the change covers. */
  period: MarketPeriod
  /** A price or an FX pair's move, in percent; null for a yield or where the source gave none. */
  changePercent: number | null
  /** A yield's move, in basis points; null for a price or an FX pair. */
  changeBasisPoints: number | null
  /** The level at the end of the period: today's level, or the series' last observation. */
  level: number | null
  /** The observations the period was measured between; null for today. */
  start: MarketObservationRef | null
  end: MarketObservationRef | null
  /** Sessions measured; null for today. */
  sessions: number | null
  observedAt: string | null
  source: string | null
  session: SessionState | null
  freshness: 'current' | 'stale' | null
  /** What the change figure covers at the source: a day, a publication gap, or the period itself. */
  changePeriod: ChangePeriod | 'period'
  /** The latest observation is older than the policy allows for "now". */
  latestIsStale: boolean
  /** The measured series, thinned to a sparkline; empty for today. */
  spark: readonly number[]
}

export interface MarketAnswerMissing {
  symbol: CanonicalSymbol
  name: string
  /** `no-live-quote`: served for history only (the Dow, the Russell), so today has no figure by design. */
  reason: PeriodMissingReason | 'unavailable-today' | 'no-live-quote'
}

/** Indices with a daily history route and no live quote: a period answers, today says so. */
const HISTORY_ONLY: ReadonlySet<string> = new Set([SYM_DJIA, SYM_RUSSELL2000])

/** Two instruments over one period, and the gap between them. */
export interface MarketComparison {
  a: MarketAnswerItem
  b: MarketAnswerItem
  /** `a − b`, in percentage points for prices and FX. */
  differencePercentagePoints: number | null
  /** `a − b`, in basis points for yields. */
  differenceBasisPoints: number | null
}

export interface MarketAnswer {
  kind: MarketIntentKind
  period: MarketPeriod
  region: MarketScope | null
  symbols: readonly CanonicalSymbol[]
  targets: readonly RetrievalTarget[]
  superlative?: 'best' | 'worst'
  /** The brief the answer was read from: today's numbers with their provenance, the rates, the risk reading. */
  brief: MarketBrief
  /** The instruments answered for the period asked, in order. */
  items: MarketAnswerItem[]
  /** The instruments that could not be answered for the period asked, with the reason. */
  missing: MarketAnswerMissing[]
  /** Today's figure for each missing instrument, labelled as today's, so the answer can offer what it has. */
  todayOf: MarketAnswerItem[]
  /** The rates of the scope, for a rates question or an overview. */
  rates: BriefYield[]
  comparison: MarketComparison | null
  best: MarketAnswerItem | null
  worst: MarketAnswerItem | null
  notServed: readonly string[]
  /** The ranking's universe, when the thread's region decided it. */
  universe?: MarketUniverse
  /** The one question back, for `MARKET_CLARIFY`; the renderers return it as the answer. */
  clarification?: string
  generatedAt: string
  conversation: MarketConversation
  method: 'market-answer-v2'
}

export interface MarketAnswerDeps {
  brief: (scope: MarketScope) => Promise<MarketBrief>
  history: MarketHistorySource | null
  now: () => Date
}

const TODAY: MarketPeriod = { kind: 'today' }
const SPARK_POINTS = 60

function quoteIn(brief: MarketBrief, symbol: CanonicalSymbol): BriefQuote | null {
  return (
    brief.indices.find((q) => q.symbol === symbol) ??
    brief.sectors.find((q) => q.symbol === symbol) ??
    brief.fx.find((q) => q.symbol === symbol) ??
    brief.commodities.find((q) => q.symbol === symbol) ??
    null
  )
}

const metricOfSymbol = (symbol: string): SeriesMetric =>
  symbol.startsWith('rate:') ? 'yield' : symbol.startsWith('fx:') ? 'fx' : 'price'

function todayItem(quote: BriefQuote): MarketAnswerItem {
  return {
    symbol: quote.symbol as CanonicalSymbol,
    name: quote.name,
    metric: metricOfSymbol(quote.symbol),
    period: TODAY,
    changePercent: quote.changePercent,
    changeBasisPoints: null,
    level: quote.level,
    start: null,
    end: null,
    sessions: null,
    observedAt: quote.observedAt,
    source: quote.source,
    session: quote.session,
    freshness: quote.freshness,
    changePeriod: quote.changePeriod,
    latestIsStale: false,
    spark: [],
  }
}

function todayYield(rate: BriefYield): MarketAnswerItem {
  return {
    symbol: rate.symbol as CanonicalSymbol,
    name: rate.name,
    metric: 'yield',
    period: TODAY,
    changePercent: null,
    changeBasisPoints: rate.changeBasisPoints,
    level: rate.yieldPercent,
    start: null,
    end: null,
    sessions: null,
    observedAt: rate.observedAt,
    source: rate.source,
    session: rate.session,
    freshness: rate.freshness,
    changePeriod: 'daily',
    latestIsStale: false,
    spark: [],
  }
}

/** The measured series thinned to at most SPARK_POINTS values, first and last kept. */
function sparkOf(change: PeriodChange): number[] {
  const values = change.series.observations.map((point) => point.value)
  if (values.length <= SPARK_POINTS) return values
  const step = (values.length - 1) / (SPARK_POINTS - 1)
  return Array.from(
    { length: SPARK_POINTS },
    (_, index) => values[Math.round(index * step)]!,
  )
}

function periodItem(change: PeriodChange, period: MarketPeriod): MarketAnswerItem {
  return {
    symbol: change.symbol,
    name: change.name,
    metric: change.metric,
    period,
    changePercent: change.changePercent,
    changeBasisPoints: change.changeBasisPoints,
    level: change.end.value,
    start: { date: change.start.date, value: change.start.value },
    end: { date: change.end.date, value: change.end.value },
    sessions: change.sessions,
    observedAt: change.series.observedAt,
    source: change.series.source.providerName,
    session: null,
    freshness: change.latestIsStale ? 'stale' : 'current',
    changePeriod: 'period',
    latestIsStale: change.latestIsStale,
    spark: sparkOf(change),
  }
}

/** The move that ranks an item: percent for a price, basis points for a yield. */
const magnitude = (item: MarketAnswerItem): number | null =>
  item.metric === 'yield' ? item.changeBasisPoints : item.changePercent

const byMoveDesc = (a: MarketAnswerItem, b: MarketAnswerItem) =>
  (magnitude(b) ?? -Infinity) - (magnitude(a) ?? -Infinity)

/** The answer to a query: today from the brief, a period from the series, missing named. */
export async function answerMarketQuery(
  query: MarketQuery,
  deps: MarketAnswerDeps,
): Promise<MarketAnswer> {
  const scope = scopeForQuery(query)
  const brief = await deps.brief(scope)
  const now = deps.now()
  const items: MarketAnswerItem[] = []
  const missing: MarketAnswerMissing[] = []
  const todayOf: MarketAnswerItem[] = []
  const todayFor = (symbol: CanonicalSymbol): MarketAnswerItem | null => {
    const quote = quoteIn(brief, symbol)
    if (quote) return todayItem(quote)
    const rate = brief.rates.find((entry) => entry.symbol === symbol)
    return rate ? todayYield(rate) : null
  }

  if (query.period.kind === 'today') {
    /* Today's rates are the brief's own sentences; the items here are the quotes. */
    for (const symbol of query.symbols.filter((entry) => !entry.startsWith('rate:'))) {
      const quote = quoteIn(brief, symbol)
      if (quote) items.push(todayItem(quote))
      else
        missing.push({
          symbol,
          name: nameIn(brief, symbol),
          reason: HISTORY_ONLY.has(symbol) ? 'no-live-quote' : 'unavailable-today',
        })
    }
  } else {
    const performance = await periodPerformance(
      deps.history,
      query.symbols,
      query.period,
      now,
    )
    for (const symbol of query.symbols) {
      const move = performance.moves.find((entry) => entry.symbol === symbol)
      if (move) {
        items.push(periodItem(move, query.period))
        continue
      }
      const gap = performance.missing.find((entry) => entry.symbol === symbol)
      missing.push({
        symbol,
        name: gap?.name ?? nameIn(brief, symbol),
        reason: gap?.reason ?? 'no-series',
      })
      const today = todayFor(symbol)
      if (today) todayOf.push(today)
    }
  }

  const rates =
    query.kind === 'MARKET_RATES' || query.kind === 'MARKET_OVERVIEW'
      ? brief.rates.filter((rate) =>
          query.kind === 'MARKET_OVERVIEW'
            ? true
            : query.symbols.includes(rate.symbol as CanonicalSymbol),
        )
      : []

  const ranked = items.filter((item) => magnitude(item) !== null).sort(byMoveDesc)
  const best = ranked[0] ?? null
  const worst = ranked.length > 1 ? ranked[ranked.length - 1]! : null

  let comparison: MarketComparison | null = null
  if (query.kind === 'MARKET_COMPARE' && items.length === 2) {
    const [a, b] = items as [MarketAnswerItem, MarketAnswerItem]
    comparison = {
      a,
      b,
      differencePercentagePoints:
        a.changePercent !== null && b.changePercent !== null
          ? a.changePercent - b.changePercent
          : null,
      differenceBasisPoints:
        a.changeBasisPoints !== null && b.changeBasisPoints !== null
          ? a.changeBasisPoints - b.changeBasisPoints
          : null,
    }
  }

  return {
    kind: query.kind,
    period: query.period,
    region: query.region,
    symbols: query.symbols,
    targets: query.targets,
    ...(query.superlative ? { superlative: query.superlative } : {}),
    brief,
    items,
    missing,
    todayOf,
    rates,
    comparison,
    best,
    worst,
    notServed: query.notServed,
    ...(query.universe ? { universe: query.universe } : {}),
    ...(query.clarification ? { clarification: query.clarification } : {}),
    generatedAt: brief.generatedAt,
    conversation: conversationAfter(query),
    method: 'market-answer-v2',
  }
}

function nameIn(brief: MarketBrief, symbol: CanonicalSymbol): string {
  const stub = symbol.split(':')[1] ?? symbol
  return (
    brief.unavailable.find((name) =>
      name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .includes(stub.replace(/[^a-z0-9]/g, '')),
    ) ??
    DISPLAY_NAMES[symbol] ??
    symbol
  )
}

const DISPLAY_NAMES: Partial<Record<string, string>> = {
  'idx:sp500': 'S&P 500',
  'idx:nasdaq100': 'Nasdaq 100',
  'idx:omxs30': 'OMXS30',
  'idx:dax': 'DAX',
  'idx:ftse100': 'FTSE 100',
  'idx:nikkei225': 'Nikkei 225',
  'idx:djia': 'Dow Jones',
  'idx:russell2000': 'Russell 2000',
  'rate:us10y': '10Y U.S. Yield',
  'rate:us2y': '2Y U.S. Yield',
  'cmd:gold': 'Gold',
  'cmd:brent': 'Brent',
  'fx:usdsek': 'USD/SEK',
  'fx:eurusd': 'EUR/USD',
}
