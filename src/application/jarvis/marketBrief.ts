/**
 * What the markets are doing right now, as JARVIS may say it.
 *
 * "Hur ser amerikanska börsen ut idag?" is a question about what is
 * happening — an observation — and not a question about what to do with
 * capital. The ruling of 2026-09-16 draws that line hard: an observation is
 * answered by JARVIS from fresh data, without a case, a committee, a thesis
 * or a scenario. This module is the fresh data, read off the same sources
 * the Overview renders, in a shape a reasoning model can turn into two to
 * five spoken sentences.
 *
 * ## Nothing here is invented
 *
 * Every number comes from a market observation with its own provenance —
 * when it was observed, by which source, of what quality — and the brief
 * carries that beside the number, so an answer can say "kl. 15:42, via
 * Yahoo" rather than pretend. A fixture is never quoted as the market: in
 * hybrid mode a provider failure yields fixture data, and that becomes
 * "unavailable" here, named. A change figure that the source did not give
 * stays `null`. What the platform cannot serve at all — the Dow, a dollar
 * index, market breadth, an intraday series — is listed under
 * `notServed`, so the model says so instead of guessing.
 *
 * ## Freshness is the observation's, not the cache's
 *
 * `freshness` is `observationFreshness` against the instrument's horizon —
 * whether the level still represents the market — and `delivery` says
 * whether it came from a cache that could not revalidate. Two facts, kept
 * apart, as the market-data layer keeps them (`application/marketData/
 * freshness.ts`).
 *
 * ## Rides the Overview's cache
 *
 * The parts are fetched with the Overview's own symbol lists. The resolver's
 * cache key is the sorted symbol set, so asking for the same sets means a
 * JARVIS question inside the page's TTL costs no provider call at all, and
 * none of these categories is quota-metered. Only the headlines
 * (Marketaux, 100/day) and nothing else are metered; they are cached for
 * fifteen minutes and fetched with the same limit the page uses.
 */

import {
  curveSlopeBasisPoints,
  hasData,
  instrumentRef,
  OVERVIEW_COMMODITY_SYMBOLS,
  OVERVIEW_FX_SYMBOLS,
  OVERVIEW_INDEX_SYMBOLS,
  OVERVIEW_SECTOR_SYMBOLS,
  OVERVIEW_YIELD_SYMBOLS,
  SYM_DAX,
  SYM_DE10Y,
  SYM_EURUSD,
  SYM_FTSE100,
  SYM_NASDAQ100,
  SYM_NIKKEI225,
  SYM_OMXS30,
  SYM_SE10Y,
  SYM_SP500,
  SYM_US10Y,
  SYM_US2Y,
  SYM_USDSEK,
  type CanonicalSymbol,
  type Envelope,
  type GovernmentYield,
  type MarketQuote,
  type MarketSentiment,
  type NewsItem,
  type Provenance,
  type Quality,
  type SessionState,
  type YieldCurve,
} from '~/domain/market'
import type { OverviewDataSource } from '~/application/marketData/getOverviewSnapshot'
import { horizonFor, observationFreshness } from '~/application/marketData/freshness'
import { isolate } from '~/application/shared/isolate'
import { withDeadline } from '~/application/shared/deadline'

/* ------------------------------------------------------------- the scope */

export const MARKET_SCOPES = ['us', 'europe', 'sweden', 'global'] as const
export type MarketScope = (typeof MARKET_SCOPES)[number]

export function isMarketScope(value: unknown): value is MarketScope {
  return typeof value === 'string' && (MARKET_SCOPES as readonly string[]).includes(value)
}

/** "Amerikanska börsen" is S&P 500 and Nasdaq 100 unless the person names an index. */
const SCOPE_INDICES: Record<MarketScope, readonly CanonicalSymbol[]> = {
  us: [SYM_SP500, SYM_NASDAQ100],
  europe: [SYM_DAX, SYM_FTSE100, SYM_OMXS30],
  sweden: [SYM_OMXS30],
  global: [SYM_SP500, SYM_NASDAQ100, SYM_DAX, SYM_FTSE100, SYM_OMXS30, SYM_NIKKEI225],
}

const SCOPE_RATES: Record<MarketScope, readonly CanonicalSymbol[]> = {
  us: [SYM_US10Y, SYM_US2Y],
  europe: [SYM_DE10Y, SYM_SE10Y],
  sweden: [SYM_SE10Y],
  global: [SYM_US10Y, SYM_US2Y, SYM_DE10Y, SYM_SE10Y],
}

const SCOPE_FX: Record<MarketScope, readonly CanonicalSymbol[]> = {
  us: [SYM_EURUSD, SYM_USDSEK],
  europe: [SYM_EURUSD, SYM_USDSEK],
  sweden: [SYM_USDSEK, SYM_EURUSD],
  global: [SYM_EURUSD, SYM_USDSEK],
}

/** The US sector aggregates and VIX describe the US market; they travel with `us` and `global`. */
const scopeHasUsBreadth = (scope: MarketScope) => scope === 'us' || scope === 'global'

/**
 * What the platform has no source for. Said once, here, so the model can
 * tell the person rather than reach for a number it remembers.
 */
export const MARKET_NOT_SERVED: readonly string[] = [
  'Dow Jones',
  'Russell 2000',
  'dollarindex (DXY)',
  /*
   * VIX enters the platform only as an input to the risk-appetite score;
   * the level itself is not served as a quote. Measured 2026-09-16: the
   * sentiment components carry percentile scores, and a brief that read
   * one as a VIX level would have said "VIX 39" about a reading of 38.5
   * on a 0–100 scale.
   */
  'VIX-nivå',
  'marknadsbredd (advance/decline)',
  'intradagsserier',
]

/* ------------------------------------------------------------- the brief */

export type BriefFreshness = 'current' | 'stale'

export interface BriefObservation {
  symbol: string
  name: string
  /** When the source observed it, ISO 8601. */
  observedAt: string
  source: string
  quality: Quality
  session: SessionState
  /** Whether the observation still represents its market, by the instrument's horizon. */
  freshness: BriefFreshness
  /** Whether it was served from a cache that could not revalidate. */
  delivery: 'fresh' | 'stale'
}

export interface BriefQuote extends BriefObservation {
  level: number
  changePercent: number | null
  changeAbsolute: number | null
  /** What the change covers: intraday, publication to publication, a rolling day. */
  changePeriod: MarketQuote['changePeriod']
}

export interface BriefYield extends BriefObservation {
  yieldPercent: number
  changeBasisPoints: number | null
  observationDate: string
}

export interface BriefHeadline {
  headline: string
  outlet: string
  publishedAt: string
}

export interface MarketBrief {
  scope: MarketScope
  generatedAt: string
  indices: BriefQuote[]
  /** Best to worst by the day's change; a sector with no change figure last. */
  sectors: BriefQuote[]
  rates: BriefYield[]
  /** US 10y minus 2y, in basis points, when the curve is served. */
  curveSlopeBasisPoints: number | null
  fx: BriefQuote[]
  commodities: BriefQuote[]
  /**
   * The platform's cross-asset risk-appetite reading: a derived score on a
   * 0–100 scale, 50 neutral, higher risk-on — never a VIX level, and to be
   * named for what it is.
   */
  riskAppetite: { score: number; label: 'risk-off' | 'neutral' | 'risk-on'; observedAt: string } | null
  headlines: BriefHeadline[]
  /** Asked for by the scope and not served right now — named, never filled in. */
  unavailable: string[]
  /** What the platform cannot serve at all. */
  notServed: readonly string[]
}

/** The envelopes a brief is composed from: the Overview's own categories, a subset. */
export interface MarketBriefParts {
  indices: Envelope<MarketQuote[]>
  sectors: Envelope<MarketQuote[]>
  yields: Envelope<GovernmentYield[]>
  yieldCurve: Envelope<YieldCurve>
  fx: Envelope<MarketQuote[]>
  commodities: Envelope<MarketQuote[]>
  sentiment: Envelope<MarketSentiment>
  news: Envelope<NewsItem[]>
}

/* ------------------------------------------------------------ fetching */

export const MARKET_BRIEF_BUDGET_MS = 4_000

/**
 * The parts, fetched with the Overview's symbol lists so the resolver's
 * cache is shared with the page. Every category is isolated and bounded:
 * one slow source degrades its own line of the brief, nothing else.
 */
export async function fetchMarketBriefParts(
  source: OverviewDataSource,
  scope: MarketScope,
  budgetMs: number = MARKET_BRIEF_BUDGET_MS,
): Promise<MarketBriefParts> {
  const unit = <T>(label: string, run: () => Promise<Envelope<T>>) =>
    Number.isFinite(budgetMs)
      ? withDeadline(label, () => isolate(label, run), { budgetMs })
      : isolate(label, run)
  const none = <T>(): Promise<Envelope<T>> => Promise.resolve({ state: 'loading' })
  const us = scopeHasUsBreadth(scope)

  const [indices, sectors, yields, yieldCurve, fx, commodities, sentiment, news] = await Promise.all([
    unit('indices', () => source.quotes(OVERVIEW_INDEX_SYMBOLS)),
    us ? unit('sectors', () => source.sectors(OVERVIEW_SECTOR_SYMBOLS)) : none<MarketQuote[]>(),
    unit('yields', () => source.yields(OVERVIEW_YIELD_SYMBOLS)),
    us ? unit('yieldCurve', () => source.yieldCurve('US')) : none<YieldCurve>(),
    unit('fx', () => source.fx(OVERVIEW_FX_SYMBOLS)),
    unit('commodities', () => source.commodities(OVERVIEW_COMMODITY_SYMBOLS)),
    us ? unit('sentiment', () => source.sentiment()) : none<MarketSentiment>(),
    unit('news', () => source.news(4)),
  ])
  return { indices, sectors, yields, yieldCurve, fx, commodities, sentiment, news }
}

/* ----------------------------------------------------------- composing */

/**
 * An envelope that carries data, and how it was delivered.
 *
 * Whether a value inside may be quoted is that value's own business: an
 * Overview category merges several sources, and its state is the worst of
 * them. Measured on 2026-09-16: the index envelope read `fixture` because
 * the broker-served indices were circuit-open, while S&P 500 inside it was
 * a real Yahoo observation minutes old. Refusing the envelope would have
 * refused the one number the person asked for.
 */
function served<T>(envelope: Envelope<T>): { data: T; delivery: 'fresh' | 'stale' } | null {
  if (!hasData(envelope)) return null
  return { data: envelope.data, delivery: envelope.state === 'stale' ? 'stale' : 'fresh' }
}

/** A real observation: not a fixture standing in for a source that did not answer. */
const real = (provenance: Provenance): boolean =>
  provenance.quality !== 'fixture' && provenance.source.providerId !== 'fixture'

function nameOf(symbol: CanonicalSymbol): string {
  try {
    return instrumentRef(symbol).displayName
  } catch {
    return symbol
  }
}

function observation(
  symbol: CanonicalSymbol,
  provenance: Provenance,
  session: SessionState,
  delivery: 'fresh' | 'stale',
  now: Date,
): BriefObservation {
  const ageMs = Math.max(0, now.getTime() - new Date(provenance.asOf).getTime())
  return {
    symbol,
    name: nameOf(symbol),
    observedAt: provenance.asOf,
    source: provenance.source.providerName,
    quality: provenance.quality,
    session,
    freshness: observationFreshness({ quality: provenance.quality, session, ageMs, horizon: horizonFor(symbol) }),
    delivery,
  }
}

function briefQuote(quote: MarketQuote, delivery: 'fresh' | 'stale', now: Date): BriefQuote {
  return {
    ...observation(quote.symbol, quote.provenance, quote.session, delivery, now),
    level: quote.value,
    changePercent: quote.percentageChange,
    changeAbsolute: quote.absoluteChange,
    changePeriod: quote.changePeriod,
  }
}

function briefYield(entry: GovernmentYield, delivery: 'fresh' | 'stale', now: Date): BriefYield {
  return {
    ...observation(entry.symbol, entry.provenance, 'unknown', delivery, now),
    yieldPercent: entry.yieldPercent,
    changeBasisPoints: entry.changeBasisPoints,
    observationDate: entry.observationDate,
  }
}

/** The quotes for `wanted`, in that order; a wanted symbol the source did not serve is named. */
function pick(
  envelope: Envelope<MarketQuote[]>,
  wanted: readonly CanonicalSymbol[],
  now: Date,
  unavailable: string[],
): BriefQuote[] {
  const category = served(envelope)
  if (!category) {
    for (const symbol of wanted) unavailable.push(nameOf(symbol))
    return []
  }
  const out: BriefQuote[] = []
  for (const symbol of wanted) {
    const quote = category.data.find((entry) => entry.symbol === symbol)
    if (!quote || !real(quote.provenance)) unavailable.push(nameOf(symbol))
    else out.push(briefQuote(quote, category.delivery, now))
  }
  return out
}

const byChangeDesc = (a: BriefQuote, b: BriefQuote) => {
  if (a.changePercent === null && b.changePercent === null) return 0
  if (a.changePercent === null) return 1
  if (b.changePercent === null) return -1
  return b.changePercent - a.changePercent
}

export function composeMarketBrief(parts: MarketBriefParts, scope: MarketScope, now: Date): MarketBrief {
  const unavailable: string[] = []
  const us = scopeHasUsBreadth(scope)

  const indices = pick(parts.indices, SCOPE_INDICES[scope], now, unavailable)
  const fx = pick(parts.fx, SCOPE_FX[scope], now, unavailable)
  const commodities = pick(parts.commodities, OVERVIEW_COMMODITY_SYMBOLS, now, unavailable)

  let sectors: BriefQuote[] = []
  if (us) {
    const category = served(parts.sectors)
    const quotes = category ? category.data.filter((quote) => real(quote.provenance)) : []
    if (!category || quotes.length === 0) unavailable.push('sektorer')
    else sectors = quotes.map((quote) => briefQuote(quote, category.delivery, now)).sort(byChangeDesc)
  }

  const rates: BriefYield[] = []
  {
    const category = served(parts.yields)
    for (const symbol of SCOPE_RATES[scope]) {
      const entry = category?.data.find((candidate) => candidate.symbol === symbol)
      if (!category || !entry || !real(entry.provenance)) unavailable.push(nameOf(symbol))
      else rates.push(briefYield(entry, category.delivery, now))
    }
  }

  let curveSlope: number | null = null
  if (us) {
    const category = served(parts.yieldCurve)
    const curve = category?.data
    curveSlope = curve && curve.points.every((point) => real(point.provenance)) ? curveSlopeBasisPoints(curve) : null
  }

  let riskAppetite: MarketBrief['riskAppetite'] = null
  if (us) {
    const category = served(parts.sentiment)
    const sentiment = category?.data
    if (sentiment && sentiment.origin !== 'fixture' && real(sentiment.provenance))
      riskAppetite = { score: Math.round(sentiment.score), label: sentiment.label, observedAt: sentiment.provenance.asOf }
    else unavailable.push('riskaptit')
  }

  let headlines: BriefHeadline[] = []
  {
    const category = served(parts.news)
    if (category)
      headlines = category.data
        .filter((item) => real(item.provenance))
        .slice(0, 4)
        .map((item) => ({ headline: item.headline, outlet: item.outlet, publishedAt: item.publishedAt }))
  }

  return {
    scope,
    generatedAt: now.toISOString(),
    indices,
    sectors,
    rates,
    curveSlopeBasisPoints: curveSlope,
    fx,
    commodities,
    riskAppetite,
    headlines,
    unavailable,
    notServed: MARKET_NOT_SERVED,
  }
}
