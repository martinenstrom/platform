/**
 * Binds the `HistoricalSeriesSource` port to the registry's `series`
 * capability: a daily series for a symbol over a window, resolved through
 * the same chain, cache and policy as every other category.
 *
 * The category is the symbol's source family — the Yahoo-bound indices,
 * the ECB pairs, the US Treasury yields — so a Yahoo outage cannot reach for
 * an FX series and a symbol no chain serves is answered as "no series"
 * rather than guessed at. The cache key is the symbol and the window, and
 * the window is rounded to a month start by the period resolver, so S&P
 * week → Nasdaq week → the comparison costs one fetch per symbol a day.
 *
 * The provider is always called through the `SeriesProvider` port, never
 * through the fixture's own helpers; the fixture, when the chain falls to
 * it, returns a fixture envelope the history service refuses.
 */

import type {
  HistoricalSeriesSource,
  SeriesWindow,
} from '~/application/marketData/history'
import type { DataCategory } from '~/application/marketData/ports'
import { resolve, type ResolveDeps } from '~/application/marketData/providerRegistry'
import type { CanonicalSymbol, Envelope, MarketSeries } from '~/domain/market'
import type { CorrelationId } from '~/domain/shared/correlation'
import { getMarketStatus, MARKET_CENTERS } from '~/data/countryExplorer/marketCenters'
import type { Container } from './container'
import { seriesKey } from './keys'

/** The symbols each history category serves; a symbol outside every family has no series. */
const HISTORY_SYMBOLS: Record<
  'history-index' | 'history-fx' | 'history-yields-us',
  readonly string[]
> = {
  'history-index': [
    'idx:sp500',
    'idx:nasdaq100',
    'idx:omxs30',
    'idx:dax',
    'idx:ftse100',
    'idx:nikkei225',
    'idx:djia',
    'idx:russell2000',
  ],
  'history-fx': ['fx:usdsek', 'fx:eurusd', 'fx:eursek'],
  'history-yields-us': [
    'rate:us10y',
    'rate:us2y',
    'rate:us30y',
    'rate:us5y',
    'rate:us3m',
  ],
}

/** The category that serves a symbol's history, or null when none does. */
export function historyCategoryFor(symbol: CanonicalSymbol): DataCategory | null {
  for (const [category, symbols] of Object.entries(HISTORY_SYMBOLS)) {
    if (symbols.includes(symbol)) return category as DataCategory
  }
  return null
}

/** Every symbol a real history chain is configured for. */
export const HISTORY_SERVED_SYMBOLS: readonly CanonicalSymbol[] = Object.values(
  HISTORY_SYMBOLS,
).flat() as CanonicalSymbol[]

export function createMarketHistorySource(
  container: Container,
  correlationId: CorrelationId = container.newCorrelationId(),
): HistoricalSeriesSource {
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
    chainGapsSeen: container.chainGapsSeen,
  }
  return {
    series: (
      symbol: CanonicalSymbol,
      window: SeriesWindow,
    ): Promise<Envelope<MarketSeries>> => {
      const category = historyCategoryFor(symbol)
      if (!category) {
        return Promise.resolve({
          state: 'error',
          error: {
            code: 'no-provider-configured',
            message: `No history chain serves ${symbol}`,
            providerId: null,
            retryable: false,
          },
        })
      }
      const now = container.clock.now()
      return resolve<MarketSeries, 'series'>(deps, {
        category,
        capability: 'series',
        cacheKey: seriesKey(symbol, '1d', window),
        chain: container.config.chains[category],
        marketOpen: MARKET_CENTERS.some(
          (center) => getMarketStatus(center, now) === 'OPEN',
        ),
        attempt: async (provider, ctx) => {
          const series = await provider.fetchSeries(symbol, '1d', window, ctx)
          return { data: series, provenance: series.provenance }
        },
      })
    },
  }
}
