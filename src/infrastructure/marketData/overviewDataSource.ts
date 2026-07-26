/**
 * Binds the Overview use case's `OverviewDataSource` port to real
 * infrastructure: the provider registry, the cache, the clock and the policy.
 *
 * This is where a category name becomes a configured provider chain, a cache
 * key and a `resolve()` call. The application layer above it never learns
 * which provider answered; the adapters below it never learn about caching or
 * fallback.
 */

import { getMarketStatus, MARKET_CENTERS } from '~/data/countryExplorer/marketCenters'
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
import { avanzaCovers } from './providers/avanza/map'
import {
  hasData,
  SERIES_RANGES,
  type CanonicalSymbol,
  type Envelope,
  type GovernmentYield,
  type MarketQuote,
  type MarketSeries,
  type Provenance,
  type SeriesRange,
} from '~/domain/market'
import type { CorrelationId } from '~/domain/shared/correlation'
import type { Container } from './container'
import type { FixtureProvider } from './providers/fixture'
import { newsKey, quotesKey, sentimentKey, seriesKey, yieldCurveKey } from './keys'

/**
 * Whether any major venue is currently trading, for TTL selection: a closed
 * market has nothing new to report, so spending quota on it is waste. Uses the
 * existing published-session calendar rather than a new mechanism.
 */
function marketOpen(now: Date): boolean {
  return MARKET_CENTERS.some((center) => getMarketStatus(center, now) === 'OPEN')
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

/**
 * Recombines envelopes resolved from several categories into the single
 * envelope a panel consumes, preserving the Overview's display order.
 *
 * The combined state is the WORST of the parts, on the same ordering the rest
 * of the system uses: a panel that is partly stale is stale, and a panel where
 * one part failed outright reports that rather than quietly showing the
 * remaining rows as though nothing happened.
 *
 * Used by two panels that split for the same underlying reason — the sources
 * differ per market, so one shared chain would let a failure in one market
 * pull in a different kind of number from another.
 */
export function combineBySymbol<T extends { symbol: CanonicalSymbol }>(
  envelopes: Array<Envelope<T[]>>,
  order: readonly CanonicalSymbol[],
  emptyError: { code: 'unknown'; message: string; providerId: null; retryable: boolean },
): Envelope<T[]> {
  const withData = envelopes.filter(hasData)
  const merged = withData.flatMap((envelope) => envelope.data)
  const ordered = order
    .map((symbol) => merged.find((entry) => entry.symbol === symbol))
    .filter((entry): entry is T => entry !== undefined)

  const failed = envelopes.find((envelope) => envelope.state === 'error')
  if (ordered.length === 0) {
    return failed ?? { state: 'error', error: emptyError }
  }

  const provenance = mergedProvenance(
    withData.map((envelope) => ({ provenance: envelope.provenance })),
  )
  const fixture = withData.find((envelope) => envelope.state === 'fixture')
  const stale = withData.find((envelope) => envelope.state === 'stale')

  if (failed) {
    return {
      state: 'stale',
      data: ordered,
      provenance,
      staleReason: 'provider-error',
    }
  }
  if (fixture && fixture.state === 'fixture') {
    return { state: 'fixture', data: ordered, provenance, reason: fixture.reason }
  }
  if (stale && stale.state === 'stale') {
    return { state: 'stale', data: ordered, provenance, staleReason: stale.staleReason }
  }
  return { state: 'ok', data: ordered, provenance }
}

export function combineYieldEnvelopes(
  envelopes: Array<Envelope<GovernmentYield[]>>,
  order: readonly CanonicalSymbol[],
): Envelope<GovernmentYield[]> {
  return combineBySymbol(envelopes, order, NO_YIELDS_ERROR)
}

const NO_YIELDS_ERROR = {
  code: 'unknown' as const,
  message: 'No country produced a yield observation',
  providerId: null,
  retryable: true,
}

const NO_INDEX_QUOTES_ERROR = {
  code: 'unknown' as const,
  message: 'No market produced an index quote',
  providerId: null,
  retryable: true,
}

export function createOverviewDataSource(
  container: Container,
  /** One id for the whole snapshot, so every category shares a request chain. */
  correlationId: CorrelationId = container.newCorrelationId(),
): OverviewDataSource {
  const deps: ResolveDeps = {
    registry: container.registry,
    clock: container.clock,
    production: container.config.production,
    cache: container.cache,
    logger: container.logger,
    metrics: container.metrics,
    runAttempt: container.runAttempt,
    singleFlight: (key, execute) => container.singleFlight.run(key, execute),
    correlationId,
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
      marketOpen: marketOpen(container.clock.now()),
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
    correlationId: () => correlationId,

    /**
     * Index tiles split by market, because only OMXS30 has a real provider.
     * Avanza covers Stockholm; the five international indices have no approved
     * source until D1 is resolved, and routing them through one chain would
     * make a Swedish outage look like a global one — or worse, let an
     * international fixture ride in on a successful Swedish fetch.
     */
    quotes: async (symbols) => {
      const groups: Array<[DataCategory, CanonicalSymbol[]]> = [
        ['equity-index-se', symbols.filter((symbol) => avanzaCovers(symbol))],
        ['equity-index-intl', symbols.filter((symbol) => !avanzaCovers(symbol))],
      ]

      const resolved = await Promise.all(
        groups
          .filter(([, group]) => group.length > 0)
          .map(([category, group]) =>
            run<MarketQuote[]>({
              category,
              capability: 'quotes',
              cacheKey: quotesKey('quotes', group),
              attempt: async (provider, ctx) => {
                const data = await (provider as QuoteProvider).fetchQuotes(group, ctx)
                return { data, provenance: mergedProvenance(data) }
              },
            }),
          ),
      )

      return combineBySymbol(resolved, symbols, NO_INDEX_QUOTES_ERROR) as never
    },

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

    /**
     * Yields resolve PER COUNTRY, because the sources differ and so do their
     * methodologies: US par yields from the Treasury, a Bundesbank fitted zero
     * rate for Germany, a Refinitiv benchmark via the Riksbank for Sweden.
     * One shared chain would let a failure in one country silently pull in a
     * different measure from another.
     *
     * The results are recombined in display order. A country that fails
     * entirely contributes no rows and its state surfaces on the combined
     * envelope, so a missing row is visible as a degraded panel rather than a
     * silent omission.
     */
    yields: async (symbols) => {
      const byCountry: Array<[DataCategory, CanonicalSymbol[]]> = [
        ['yields-us', symbols.filter((symbol) => symbol.startsWith('rate:us'))],
        ['yields-de', symbols.filter((symbol) => symbol.startsWith('rate:de'))],
        ['yields-se', symbols.filter((symbol) => symbol.startsWith('rate:se'))],
      ]

      const resolved = await Promise.all(
        byCountry
          .filter(([, group]) => group.length > 0)
          .map(async ([category, group]) => {
            const envelope = await run<GovernmentYield[]>({
              category,
              capability: 'yields',
              cacheKey: quotesKey('yields', group),
              attempt: async (provider, ctx) => {
                const data = await (provider as YieldProvider).fetchYields(group, ctx)
                return { data, provenance: mergedProvenance(data) }
              },
            })
            return envelope
          }),
      )

      return combineYieldEnvelopes(resolved, symbols)
    },

    yieldCurve: (countryCode) =>
      run({
        category: 'curve-us',
        capability: 'yields',
        cacheKey: yieldCurveKey(countryCode),
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
