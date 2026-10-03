/**
 * The structured answer to a market query — one answer, two renderers.
 *
 * Every figure here comes from the market brief (today) or from a series
 * the platform holds (a period), with its provenance beside it. What the
 * platform cannot serve for the period asked is listed as missing with its
 * reason, and today's figure for the same instrument travels separately,
 * labelled as today's — so a renderer can say "I have today's S&P 500, not
 * a weekly series" and never pass the day off as the week.
 */

import type { CanonicalSymbol, ChangePeriod, SessionState } from '~/domain/market'
import type { BriefQuote, BriefYield, MarketBrief, MarketScope } from './marketBrief'
import {
  periodPerformance,
  type MarketHistorySource,
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
} from './marketQuery'

export interface MarketAnswerItem {
  symbol: CanonicalSymbol
  name: string
  /** The period the change covers. */
  period: MarketPeriod
  changePercent: number | null
  /** The level at the end of the period: today's level, or the series' last point. */
  level: number | null
  observedAt: string | null
  source: string | null
  session: SessionState | null
  freshness: 'current' | 'stale' | null
  /** What the change figure covers at the source: a day, a publication gap, or the period itself. */
  changePeriod: ChangePeriod | 'period'
}

export interface MarketAnswerMissing {
  symbol: CanonicalSymbol
  name: string
  reason: PeriodMissingReason | 'unavailable-today'
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
  best: MarketAnswerItem | null
  worst: MarketAnswerItem | null
  notServed: readonly string[]
  generatedAt: string
  conversation: MarketConversation
  method: 'market-answer-v1'
}

export interface MarketAnswerDeps {
  brief: (scope: MarketScope) => Promise<MarketBrief>
  history: MarketHistorySource | null
  now: () => Date
}

const TODAY: MarketPeriod = { kind: 'today' }

function quoteIn(brief: MarketBrief, symbol: CanonicalSymbol): BriefQuote | null {
  return (
    brief.indices.find((q) => q.symbol === symbol) ??
    brief.sectors.find((q) => q.symbol === symbol) ??
    brief.fx.find((q) => q.symbol === symbol) ??
    brief.commodities.find((q) => q.symbol === symbol) ??
    null
  )
}

function todayItem(quote: BriefQuote): MarketAnswerItem {
  return {
    symbol: quote.symbol as CanonicalSymbol,
    name: quote.name,
    period: TODAY,
    changePercent: quote.changePercent,
    level: quote.level,
    observedAt: quote.observedAt,
    source: quote.source,
    session: quote.session,
    freshness: quote.freshness,
    changePeriod: quote.changePeriod,
  }
}

const byChangeDesc = (a: MarketAnswerItem, b: MarketAnswerItem) =>
  (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity)

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
  const quoted = query.symbols.filter((symbol) => !symbol.startsWith('rate:'))

  if (query.period.kind === 'today') {
    for (const symbol of quoted) {
      const quote = quoteIn(brief, symbol)
      if (quote) items.push(todayItem(quote))
      else
        missing.push({ symbol, name: nameIn(brief, symbol), reason: 'unavailable-today' })
    }
  } else {
    const performance = await periodPerformance(deps.history, quoted, query.period, now)
    for (const symbol of quoted) {
      const move = performance.moves.find((entry) => entry.symbol === symbol)
      if (move) {
        items.push({
          symbol,
          name: move.name,
          period: query.period,
          changePercent: move.changePercent,
          level: move.to.v,
          observedAt: move.observedAt,
          source: move.source,
          session: null,
          freshness: 'current',
          changePeriod: 'period',
        })
        continue
      }
      const gap = performance.missing.find((entry) => entry.symbol === symbol)
      missing.push({
        symbol,
        name: gap?.name ?? nameIn(brief, symbol),
        reason: gap?.reason ?? 'no-series',
      })
      const quote = quoteIn(brief, symbol)
      if (quote) todayOf.push(todayItem(quote))
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

  const ranked = items.filter((item) => item.changePercent !== null).sort(byChangeDesc)
  const best = ranked[0] ?? null
  const worst = ranked.length > 1 ? ranked[ranked.length - 1]! : null

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
    best,
    worst,
    notServed: query.notServed,
    generatedAt: brief.generatedAt,
    conversation: conversationAfter(query),
    method: 'market-answer-v1',
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
  'cmd:gold': 'Gold',
  'cmd:brent': 'Brent',
  'fx:usdsek': 'USD/SEK',
  'fx:eurusd': 'EUR/USD',
}
