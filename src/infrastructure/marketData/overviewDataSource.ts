/**
 * Binds the Overview use case's `OverviewDataSource` port to real
 * infrastructure: the provider registry, the cache, the clock and the policy.
 *
 * This is where a category name becomes a configured provider chain, a cache
 * key and a `resolve()` call. The application layer above it never learns
 * which provider answered; the adapters below it never learn about caching or
 * fallback.
 */

import type { OverviewDataSource } from '~/application/marketData/getOverviewSnapshot'
import { resolve, type ResolveDeps } from '~/application/marketData/providerRegistry'
import type {
  Capability,
  CommodityProvider,
  CryptoProvider,
  DataCategory,
  FetchContext,
  FxProvider,
  NewsProvider,
  QuoteProvider,
  SentimentProvider,
  YieldProvider,
} from '~/application/marketData/ports'
import {
  SERIES_RANGES,
  type CanonicalSymbol,
  type Envelope,
  type MarketSeries,
  type Provenance,
  type SeriesRange,
} from '~/domain/market'
import type { Container } from './container'
import type { FixtureProvider } from './providers/fixture'
import { newsKey, quotesKey, sentimentKey, seriesKey } from './keys'

/**
 * Whether the relevant market is open, for TTL selection. Phase 0 has only
 * fixture data, whose TTL is immaterial; Phase 2 onward wires this to
 * `getMarketStatus` over `MARKET_CENTERS`.
 */
function marketOpen(): boolean {
  return true
}

/** Provenance for a set of values that were resolved together. */
function mergedProvenance(items: Array<{ provenance: Provenance }>): Provenance {
  const first = items[0]
  if (!first) throw new Error('mergedProvenance: no items')
  return items.reduce(
    (oldest, item) =>
      new Date(item.provenance.asOf) < new Date(oldest.provenance.asOf) ? item : oldest,
    first,
  ).provenance
}

export function createOverviewDataSource(container: Container): OverviewDataSource {
  const deps: ResolveDeps = {
    registry: container.registry,
    clock: container.clock,
    production: container.config.production,
    cache: container.cache,
    logger: container.logger,
  }

  const chain = (category: DataCategory) => container.config.chains[category]

  /** One resolution, with the boilerplate that every category shares. */
  function run<T>(args: {
    category: DataCategory
    capability: Capability
    cacheKey: string
    attempt: (
      provider: unknown,
      ctx: FetchContext,
    ) => Promise<{ data: T; provenance: Provenance }>
  }): Promise<Envelope<T>> {
    return resolve<T>(deps, {
      category: args.category,
      capability: args.capability,
      cacheKey: args.cacheKey,
      chain: chain(args.category),
      marketOpen: marketOpen(),
      attempt: args.attempt,
    })
  }

  const quoteLike = (
    category: DataCategory,
    capability: Capability,
    symbols: readonly CanonicalSymbol[],
    call: (
      provider: never,
      symbols: readonly CanonicalSymbol[],
      ctx: FetchContext,
    ) => Promise<Array<{ provenance: Provenance }>>,
  ) =>
    run({
      category,
      capability,
      cacheKey: quotesKey(capability, symbols),
      attempt: async (provider, ctx) => {
        const data = await call(provider as never, symbols, ctx)
        return { data: data as never, provenance: mergedProvenance(data) }
      },
    })

  return {
    now: () => container.clock.now(),

    quotes: (symbols) =>
      quoteLike('equity-index-intl', 'quotes', symbols, (p: QuoteProvider, s, ctx) =>
        p.fetchQuotes(s, ctx),
      ) as never,

    fx: (symbols) =>
      quoteLike('fx', 'fx', symbols, (p: FxProvider, s, ctx) =>
        p.fetchFxRates(s, ctx),
      ) as never,

    commodities: (symbols) =>
      quoteLike('commodities', 'commodities', symbols, (p: CommodityProvider, s, ctx) =>
        p.fetchCommodities(s, ctx),
      ) as never,

    crypto: (symbols) =>
      quoteLike('crypto', 'crypto', symbols, (p: CryptoProvider, s, ctx) =>
        p.fetchCrypto(s, ctx),
      ) as never,

    sectors: (symbols) =>
      quoteLike('sectors', 'quotes', symbols, (p: QuoteProvider, s, ctx) =>
        p.fetchQuotes(s, ctx),
      ) as never,

    watchlist: (symbols) =>
      quoteLike('equity-se', 'quotes', symbols, (p: QuoteProvider, s, ctx) =>
        p.fetchQuotes(s, ctx),
      ) as never,

    yields: (symbols) =>
      quoteLike('yields-us', 'yields', symbols, (p: YieldProvider, s, ctx) =>
        p.fetchYields(s, ctx),
      ) as never,

    yieldCurve: (countryCode) =>
      run({
        category: 'yields-us',
        capability: 'yields',
        cacheKey: `v1:yieldcurve:${countryCode}`,
        attempt: async (provider, ctx) => {
          const yieldProvider = provider as YieldProvider
          if (!yieldProvider.fetchYieldCurve) {
            throw new Error(`${yieldProvider.id} does not publish a yield curve`)
          }
          const curve = await yieldProvider.fetchYieldCurve(countryCode, ctx)
          return { data: curve, provenance: curve.provenance }
        },
      }),

    news: (limit) =>
      run({
        category: 'news',
        capability: 'news',
        cacheKey: newsKey([], limit),
        attempt: async (provider, ctx) => {
          const items = await (provider as NewsProvider).fetchNews({ limit }, ctx)
          return { data: items, provenance: mergedProvenance(items) }
        },
      }),

    sentiment: () =>
      run({
        category: 'sentiment',
        capability: 'sentiment',
        cacheKey: sentimentKey('v1'),
        attempt: async (provider, ctx) => {
          const value = await (provider as SentimentProvider).fetchSentiment(ctx)
          return { data: value, provenance: value.provenance }
        },
      }),

    sparklines: (symbols) =>
      run({
        category: 'intraday',
        capability: 'series',
        cacheKey: quotesKey('series', symbols),
        attempt: async (provider, ctx) => {
          const fixture = provider as FixtureProvider
          const series = await Promise.all(
            symbols.map((symbol) => fixture.fetchSparkline(symbol, ctx)),
          )
          return {
            data: Object.fromEntries(series.map((s) => [s.symbol, s])) as Record<
              CanonicalSymbol,
              MarketSeries
            >,
            provenance: mergedProvenance(series),
          }
        },
      }),

    watchlistSparklines: (symbols) =>
      run({
        category: 'equity-se',
        capability: 'series',
        cacheKey: quotesKey('series', symbols) + ':watchlist',
        attempt: async (provider, ctx) => {
          const fixture = provider as FixtureProvider
          const series = await Promise.all(
            symbols.map((symbol) => fixture.fetchWatchlistSeries(symbol, ctx)),
          )
          return {
            data: Object.fromEntries(series.map((s) => [s.symbol, s])) as Record<
              CanonicalSymbol,
              MarketSeries
            >,
            provenance: mergedProvenance(series),
          }
        },
      }),

    intraday: () =>
      run({
        category: 'intraday',
        capability: 'series',
        cacheKey: seriesKey('idx:all' as CanonicalSymbol, '15m', {
          from: 'session',
          to: 'session',
        }),
        attempt: async (provider, ctx) => {
          const fixture = provider as FixtureProvider
          const entries = await Promise.all(
            SERIES_RANGES.map(
              async (range) => [range, await fixture.fetchIntraday(range, ctx)] as const,
            ),
          )
          const byRange = Object.fromEntries(entries) as Record<
            SeriesRange,
            MarketSeries[]
          >
          return {
            data: byRange,
            provenance: mergedProvenance(entries.flatMap(([, series]) => series)),
          }
        },
      }),
  }
}
