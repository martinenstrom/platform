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
  SeriesInterval,
  YieldCurve,
} from '~/domain/market'
import type { Clock } from '~/domain/shared/clock'

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
 * A registered provider: its identity plus which capabilities it serves.
 * Registration is explicit rather than inferred from method presence, so a
 * partially-implemented adapter cannot silently advertise a capability.
 */
export interface ProviderRegistration {
  provider: AnyProvider
  capabilities: ReadonlySet<Capability>
}
