/**
 * Watchlist data on the shared resolution pipeline.
 *
 * Uses the SAME `equity-se` category the Overview's watchlist panel uses, so
 * the two screens share a cache entry, a chain, a policy and a breaker. Two
 * categories for one set of instruments would double the Avanza traffic and
 * let the pages disagree about the same six prices.
 */

import type {
  CanonicalSymbol,
  MarketQuote,
  MarketSeries,
  Provenance,
} from '~/domain/market'
import type { CorrelationId } from '~/domain/shared/correlation'
import type { FetchContext } from '~/application/marketData/ports'
import type { WatchlistDataSource } from '~/application/marketData/getWatchlist'
import { resolve, type ResolveDeps } from '~/application/marketData/resolution'
import type { Container } from './container'
import { quotesKey } from './keys'
import type { FixtureProvider } from './providers/fixture'

function mergedProvenance(items: Array<{ provenance: Provenance }>): Provenance {
  const oldest = items.reduce((worst, item) =>
    item.provenance.ageMs > worst.provenance.ageMs ? item : worst,
  )
  return oldest.provenance
}

export function createWatchlistDataSource(
  container: Container,
  correlationId: CorrelationId = container.newCorrelationId(),
): WatchlistDataSource {
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

  return {
    now: () => container.clock.now(),
    correlationId: () => correlationId,

    quotes: (symbols) =>
      resolve<MarketQuote[], 'quotes'>(deps, {
        category: 'equity-se',
        capability: 'quotes',
        // The same key the Overview builds, so both pages share one entry.
        cacheKey: quotesKey('quotes', symbols),
        chain: container.config.chains['equity-se'],
        marketOpen: true,
        attempt: async (provider, ctx: FetchContext) => {
          const data = await provider.fetchQuotes(symbols, ctx)
          return { data, provenance: mergedProvenance(data) }
        },
      }),

    sparklines: (symbols) =>
      resolve<Record<CanonicalSymbol, MarketSeries>, 'series'>(deps, {
        category: 'equity-se',
        capability: 'series',
        cacheKey: quotesKey('series', symbols) + ':watchlist',
        chain: container.config.chains['equity-se'],
        marketOpen: true,
        attempt: async (provider, ctx: FetchContext) => {
          /*
           * KNOWN DEBT, identical to the Overview's: sparklines are not a
           * port, they are a fixture-only helper from Phase 0. Safe only
           * because the `series` capability has no live provider — and the
           * consequence, deliberately, is that live mode has NO history and
           * the column renders empty rather than inventing a line. Phase 6
           * replaces this with a real `SeriesProvider` call.
           */
          const fixture = provider as unknown as FixtureProvider
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
  }
}
