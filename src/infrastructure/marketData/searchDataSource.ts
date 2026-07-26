/**
 * Search on the shared resolution pipeline.
 *
 * The cache key is the query, which makes this the first category whose key
 * space is driven by user input. That is precisely why `MemoryCacheStore` is
 * LRU-bounded: before the bound, a search box was an unbounded `Map`.
 */

import type { Envelope, InstrumentSearchResults } from '~/domain/market'
import type { CorrelationId } from '~/domain/shared/correlation'
import type { SearchDataSource } from '~/application/marketData/searchInstruments'
import { resolve, type ResolveDeps } from '~/application/marketData/resolution'
import type { Container } from './container'
import { searchKey } from './keys'

export function createSearchDataSource(
  container: Container,
  correlationId: CorrelationId = container.newCorrelationId(),
): SearchDataSource {
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
    search(query: string, limit: number): Promise<Envelope<InstrumentSearchResults>> {
      return resolve<InstrumentSearchResults, 'search'>(deps, {
        category: 'search-se',
        capability: 'search',
        cacheKey: searchKey(query, limit),
        chain: container.config.chains['search-se'],
        // Search has no trading session; both TTLs are identical so the flag
        // cannot quietly mean anything.
        marketOpen: true,
        attempt: async (provider, ctx) => {
          const results = await provider.searchInstruments(query, limit, ctx)
          // One provider, one provenance — nothing to merge.
          const provenance = providerProvenance(provider.id, ctx)
          return { data: { query, results, provenance }, provenance }
        },
      })
    },
  }
}

/**
 * Search results have no observation time of their own — Avanza's payload
 * carries none — so the retrieval time is the only honest `asOf`, at second
 * precision, and `quality` is `realtime` because the list genuinely reflects
 * the provider's catalog at the moment we asked.
 */
function providerProvenance(providerId: string, ctx: { clock: { now(): Date } }) {
  const now = ctx.clock.now()
  return {
    asOf: now.toISOString(),
    asOfPrecision: 'second' as const,
    receivedAt: now.toISOString(),
    ageMs: 0,
    source: {
      providerId,
      providerName: 'Avanza',
      attributionUrl: 'https://www.avanza.se',
      trust: 'broker' as const,
    },
    quality: 'realtime' as const,
    isDelayed: false,
    delayMinutes: null,
    isProxy: false,
  }
}
