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
  MarketQuote,
  MarketSentiment,
  MarketSeries,
  NewsItem,
  ProviderTrust,
  SeriesInterval,
  YieldCurve,
} from '~/domain/market'
import type { Clock } from '~/domain/shared/clock'
import type { CorrelationId } from '~/domain/shared/correlation'

export type Capability =
  'quotes' | 'series' | 'fx' | 'yields' | 'commodities' | 'crypto' | 'news' | 'sentiment'

/**
 * Data categories, as configured and cached. Finer-grained than `Capability`
 * because the same capability can have different chains per market — Swedish
 * equities come from Avanza, international indices do not.
 */
export type DataCategory =
  | 'equity-index-se'
  | 'equity-index-intl'
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
