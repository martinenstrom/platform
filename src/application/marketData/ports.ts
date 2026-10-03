/**
 * Provider ports — the capability interfaces infrastructure implements.
 *
 * Small interfaces, one per capability, so a provider declares exactly what it
 * can do and the registry routes around what it cannot. A single oversized
 * `MarketDataProvider` would force Frankfurter (FX only) to stub seven methods
 * it will never serve.
 *
 * An adapter's entire job is **fetch → validate → normalize**. Caching,
 * retrying, rate limiting, circuit breaking and fallback are cross-cutting and
 * live in the registry — an adapter that implements any of them is a bug.
 */

import type {
  CanonicalSymbol,
  GovernmentYield,
  InstrumentSearchResult,
  MarketQuote,
  MarketSentiment,
  MarketSeries,
  NewsItem,
  ProviderTrust,
  SeriesInterval,
  YieldCurve,
} from '~/domain/market'
import type {
  CentralBankId,
  EcbPolicyState,
  FederalReservePolicyState,
  RiksbankPolicyState,
} from '~/domain/policy'
import type { Clock } from '~/domain/shared/clock'
import type { CorrelationId } from '~/domain/shared/correlation'

export type Capability =
  | 'quotes'
  | 'series'
  | 'fx'
  | 'yields'
  | 'commodities'
  | 'crypto'
  | 'news'
  | 'sentiment'
  /** Official monetary-policy state. A different domain from `yields`. */
  | 'policy-rates'
  /** User-facing instrument discovery. Never identity resolution. */
  | 'search'

/**
 * Data categories, as configured and cached. Finer-grained than `Capability`
 * because the same capability can have different chains per market — Swedish
 * equities come from Avanza, international indices do not.
 */
export type DataCategory =
  | 'equity-index-se'
  /**
   * International indices with no approved live route. Fixture only.
   *
   * Kept separate from the broker-routed set below so a provider outage and an
   * absent source stay distinguishable: one is a failure, the other is a
   * capability the firm does not have.
   */
  | 'equity-index-intl'
  /** International indices Avanza exposes as actual index instruments. */
  | 'equity-index-intl-broker'
  | 'equity-se'
  | 'fx'
  | 'yields-us'
  | 'yields-de'
  | 'yields-se'
  /** The US par curve, resolved separately from the headline rates. */
  | 'curve-us'
  | 'commodities'
  | 'crypto'
  | 'news'
  | 'sentiment'
  | 'intraday'
  | 'sectors'
  /*
   * Daily history, one category per source family, so that a period
   * question ("i veckan", "i år") is answered from a real daily series and
   * the fixture behind the chart ranges never stands in for one. Separate
   * from `intraday` on purpose: today's intraday series and a daily history
   * are different observations, and the chains differ.
   */
  | 'history-index'
  | 'history-fx'
  | 'history-yields-us'
  /*
   * Monetary policy, one category per institution. Separate from the yield
   * categories on purpose: a Fed outage must not be able to reach for a
   * Treasury yield, and the two are not the same measure.
   */
  | 'policy-us'
  | 'policy-ea'
  | 'policy-se'
  /** Instrument search, currently Swedish coverage only. */
  | 'search-se'

/** Injected into every port call. Never `Date.now()` inside an adapter. */
export interface FetchContext {
  signal: AbortSignal
  clock: Clock
  /**
   * Threaded from the inbound request through every provider call, log record
   * and metric, so a complete request chain can be reconstructed later.
   */
  correlationId: CorrelationId
}

export interface ProviderIdentity {
  readonly id: string
  readonly name: string
  readonly attributionUrl?: string
}

export interface QuoteProvider extends ProviderIdentity {
  fetchQuotes(
    symbols: readonly CanonicalSymbol[],
    ctx: FetchContext,
  ): Promise<MarketQuote[]>
}

/**
 * A central bank's current policy state.
 *
 * Unlike every other port here, this one takes no symbols: an institution has
 * one policy state, not a list of instruments. Each provider returns its own
 * concrete state type, so the Fed's target range and the ECB's three key rates
 * never have to be flattened into a shared shape.
 */
export interface PolicyRateProvider extends ProviderIdentity {
  /**
   * `centralBank` names which institution is being asked for.
   *
   * The three official adapters each serve exactly one and validate the
   * argument, but the parameter is not ceremony: without it a provider serving
   * several institutions — a fixture, or a future multi-series source — has no
   * way to know what to return, and silently answers with whichever one it
   * happens to implement.
   */
  fetchPolicyState(
    centralBank: CentralBankId,
    ctx: FetchContext,
  ): Promise<FederalReservePolicyState | EcbPolicyState | RiksbankPolicyState>
}

/**
 * Instrument discovery.
 *
 * The ONE place a fuzzy provider search is legitimate: the user is reading the
 * results and choosing. It must never be used to bind a canonical symbol —
 * `InstrumentSearchResult` carries a provider ref rather than a
 * `CanonicalSymbol` precisely so that cannot happen by assignment.
 */
export interface InstrumentSearchProvider extends ProviderIdentity {
  searchInstruments(
    query: string,
    limit: number,
    ctx: FetchContext,
  ): Promise<InstrumentSearchResult[]>
}

export interface SeriesProvider extends ProviderIdentity {
  fetchSeries(
    symbol: CanonicalSymbol,
    interval: SeriesInterval,
    range: { from: string; to: string },
    ctx: FetchContext,
  ): Promise<MarketSeries>
}

export interface FxProvider extends ProviderIdentity {
  fetchFxRates(
    pairs: readonly CanonicalSymbol[],
    ctx: FetchContext,
  ): Promise<MarketQuote[]>
}

export interface YieldProvider extends ProviderIdentity {
  fetchYields(
    symbols: readonly CanonicalSymbol[],
    ctx: FetchContext,
  ): Promise<GovernmentYield[]>
  /** Optional: not every yield source publishes a full term structure. */
  fetchYieldCurve?(countryCode: string, ctx: FetchContext): Promise<YieldCurve>
  /**
   * Every observation the source published in a range, not just the latest.
   *
   * Optional, like `fetchYieldCurve`, and for the same reason: history is a
   * capability a source either has or does not, and a provider without one
   * should not be made to stub it. `ProviderCapabilityMetadata.supportsHistory`
   * is what declares it; this is what serves it.
   *
   * Distinct from `fetchYields`, which answers *what is it now*. This answers
   * *what did it do*, which is the question a series is made of — and the two
   * cannot be the same call, because the first collapses a term structure of
   * observations into one point per symbol.
   *
   * `range` bounds the SOURCE's own observation dates, never our retrieval
   * time. Implementations page the upstream however it paginates and return
   * every published observation in the range, ascending.
   */
  fetchYieldHistory?(
    symbols: readonly CanonicalSymbol[],
    range: { from: string; to: string },
    ctx: FetchContext,
  ): Promise<GovernmentYield[]>
}

export interface CommodityProvider extends ProviderIdentity {
  fetchCommodities(
    symbols: readonly CanonicalSymbol[],
    ctx: FetchContext,
  ): Promise<MarketQuote[]>
}

export interface CryptoProvider extends ProviderIdentity {
  fetchCrypto(
    symbols: readonly CanonicalSymbol[],
    ctx: FetchContext,
  ): Promise<MarketQuote[]>
}

export interface NewsQuery {
  symbols?: readonly CanonicalSymbol[]
  limit: number
}

export interface NewsProvider extends ProviderIdentity {
  fetchNews(query: NewsQuery, ctx: FetchContext): Promise<NewsItem[]>
}

export interface SentimentProvider extends ProviderIdentity {
  fetchSentiment(ctx: FetchContext): Promise<MarketSentiment>
}

/** Any provider. Narrowed by the registry via the capability it was asked for. */
export type AnyProvider =
  | QuoteProvider
  | SeriesProvider
  | FxProvider
  | YieldProvider
  | CommodityProvider
  | CryptoProvider
  | NewsProvider
  | SentimentProvider
  | PolicyRateProvider
  | InstrumentSearchProvider

/** Maps a capability to the port that serves it. */
export interface PortByCapability {
  quotes: QuoteProvider
  series: SeriesProvider
  fx: FxProvider
  yields: YieldProvider
  commodities: CommodityProvider
  crypto: CryptoProvider
  news: NewsProvider
  sentiment: SentimentProvider
  'policy-rates': PolicyRateProvider
  search: InstrumentSearchProvider
}

/**
 * Declared operational characteristics of a provider.
 *
 * Lets orchestration reason about a provider without hardcoding its name:
 * ordering a chain by latency, skipping a daily-update source whose value
 * cannot have changed, choosing a history-capable provider for a range
 * request, or sizing a timeout per provider instead of globally.
 */
export interface ProviderCapabilityMetadata {
  /**
   * What kind of party this provider is.
   *
   * Metadata only — nothing reads it for a decision yet. It exists so that
   * provenance survives long enough for a future provider-quality policy to be
   * written without touching the domain models again. A test asserts every
   * registration declares one, so it cannot quietly drift out of date.
   */
  trust: ProviderTrust
  /** Typical successful round trip, for timeout and ordering decisions. */
  expectedLatencyMs: number
  /** How often the upstream itself changes; polling faster gains nothing. */
  updateFrequency: 'realtime' | 'minutely' | 'hourly' | 'daily' | 'static'
  /** Known delay behind the live market; null when the provider does not say. */
  delayMinutes: number | null
  supportsHistory: boolean
  supportsIntraday: boolean
  /** True when one call serves many symbols — the free-tier survival trait. */
  supportsBatch: boolean
  /** Attribution the presentation layer is obliged to surface, if any. */
  requiresAttribution: boolean
}

/** Sensible defaults so a provider declares only what differs. */
export const DEFAULT_PROVIDER_METADATA: ProviderCapabilityMetadata = {
  trust: 'aggregator',
  expectedLatencyMs: 500,
  updateFrequency: 'minutely',
  delayMinutes: null,
  supportsHistory: false,
  supportsIntraday: false,
  supportsBatch: false,
  requiresAttribution: false,
}

/**
 * A registered provider: its identity, which capabilities it serves, and how
 * it behaves. Registration is explicit rather than inferred from method
 * presence, so a partially-implemented adapter cannot silently advertise a
 * capability.
 */
export interface ProviderRegistration {
  provider: AnyProvider
  capabilities: ReadonlySet<Capability>
  metadata?: ProviderCapabilityMetadata
}
