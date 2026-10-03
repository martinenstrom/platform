/**
 * Binds JARVIS's `MarketHistorySource` port to the registry's `series`
 * capability: a daily series for a symbol over a range, resolved through
 * the same chain, cache and policy as every other category.
 *
 * On 2026-10-03 the `intraday` chain is fixture-only, so what comes back is
 * a fixture envelope — which the application service refuses, and says so.
 * The moment a live `SeriesProvider` stands in the chain, the same call
 * serves a real series and "i veckan" is answered from it, with nothing to
 * change above this file. The provider is called through the port, never
 * through the fixture's own helpers.
 */

import type { MarketHistorySource } from '~/application/jarvis/marketHistory'
import { resolve, type ResolveDeps } from '~/application/marketData/providerRegistry'
import type {
  CanonicalSymbol,
  Envelope,
  MarketSeries,
  SeriesRange,
} from '~/domain/market'
import type { CorrelationId } from '~/domain/shared/correlation'
import { getMarketStatus, MARKET_CENTERS } from '~/data/countryExplorer/marketCenters'
import type { Container } from './container'
import { seriesKey } from './keys'

const DAY_MS = 24 * 60 * 60 * 1000

/** The calendar window a range covers at `now`, as the series port takes it. */
function windowFor(range: SeriesRange, now: Date): { from: string; to: string } {
  const days = { '1d': 1, '1w': 7, '1m': 31, '3m': 93, '1y': 366, ytd: 0 }[range]
  const from =
    range === 'ytd'
      ? new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
      : new Date(now.getTime() - days * DAY_MS)
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }
}

export function createMarketHistorySource(
  container: Container,
  correlationId: CorrelationId = container.newCorrelationId(),
): MarketHistorySource {
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
      range: SeriesRange,
    ): Promise<Envelope<MarketSeries>> => {
      const now = container.clock.now()
      const window = windowFor(range, now)
      return resolve<MarketSeries, 'series'>(deps, {
        category: 'intraday',
        capability: 'series',
        cacheKey: seriesKey(symbol, '1d', window),
        chain: container.config.chains.intraday,
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
