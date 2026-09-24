/**
 * The only client-reachable surface of the market-data layer.
 *
 * `createServerFn` handlers execute exclusively on the server — calling one
 * from client code performs a network round trip rather than bundling the
 * handler body into the browser build. Every provider adapter is therefore
 * reached through a dynamic `import()` inside a handler, so an API key or a
 * Node-only dependency can never be pulled into the client graph.
 *
 * This is the same belt-and-braces pattern already documented in
 * `services/avanzaMcp/serverFns.ts:11-15`, applied to the new layer.
 */

import { createServerFn } from '@tanstack/react-start'
import {
  getCentralBanksSnapshot,
  type CentralBanksSnapshot,
} from '~/application/policy/getCentralBanksSnapshot'
import { searchInstruments } from '~/application/marketData/searchInstruments'
import {
  getWatchlist,
  type WatchlistSnapshot,
} from '~/application/marketData/getWatchlist'
import { getMarkets, type MarketsSnapshot } from '~/application/marketData/getMarkets'
import type { Envelope, InstrumentSearchResults } from '~/domain/market'
import {
  getOverviewSnapshot,
  type OverviewSnapshot,
} from '~/application/marketData/getOverviewSnapshot'

/*
 * The container is reached inside each handler through a dynamic import of
 * `./containerInstance`, and only there. A module-level reference — even a
 * helper wrapping the same dynamic import — is loaded by the client build and
 * pulls the providers into the browser bundle; only handler bodies are
 * stripped.
 */

/** The Marknader route's data, server-side. Four categories, no new ones. */
export const getMarketsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MarketsSnapshot> => {
    const { getContainer } = await import('./containerInstance')
    const container = await getContainer()
    const { createMarketsDataSource } = await import('./marketsDataSource')
    const correlationId = container.newCorrelationId()
    return getMarkets(createMarketsDataSource(container, correlationId))
  },
)

/**
 * The Bevakning route's data, server-side.
 *
 * Route-scoped rather than a slice of the Overview payload: the two pages
 * share the `equity-se` resolution and therefore a cache entry, but not a
 * response shape.
 */
export const getWatchlistFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WatchlistSnapshot> => {
    const { getContainer } = await import('./containerInstance')
    const container = await getContainer()
    const { createWatchlistDataSource } = await import('./watchlistDataSource')
    const correlationId = container.newCorrelationId()
    return getWatchlist(createWatchlistDataSource(container, correlationId))
  },
)

/**
 * Instrument search, server-side.
 *
 * The browser never talks to Avanza. This replaced the legacy
 * `searchAvanzaInstrumentsFn`, whose result was a bare list with no provenance
 * and no way to distinguish "no matches" from "the search failed" — the header
 * showed an empty dropdown for both.
 */
export const searchInstrumentsFn = createServerFn({ method: 'GET' })
  .validator((query: string) => query)
  .handler(async ({ data }): Promise<Envelope<InstrumentSearchResults>> => {
    const { getContainer } = await import('./containerInstance')
    const container = await getContainer()
    const { createSearchDataSource } = await import('./searchDataSource')
    return searchInstruments(
      createSearchDataSource(container, container.newCorrelationId()),
      data,
    )
  })

/**
 * Assembles the central-bank snapshot server-side.
 *
 * A SEPARATE server function, not part of the Overview payload. Nothing
 * renders it in Phase 6A, so bundling it into every page load would ship an
 * unused payload and couple two things meant to stay separable.
 */
export const getCentralBanksSnapshotFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CentralBanksSnapshot> => {
    const { getContainer } = await import('./containerInstance')
    const container = await getContainer()
    const { createCentralBanksDataSource } = await import('./centralBanksDataSource')
    const correlationId = container.newCorrelationId()
    return getCentralBanksSnapshot(createCentralBanksDataSource(container, correlationId))
  },
)

/** Assembles the whole Overview server-side. One round trip, one `asOf`. */
export const getOverviewSnapshotFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<OverviewSnapshot> => {
    const { getContainer } = await import('./containerInstance')
    const container = await getContainer()
    const { createOverviewDataSource } = await import('./overviewDataSource')
    // One correlation id per inbound request, shared by every category so the
    // whole snapshot can be reconstructed from the logs as a single chain.
    const correlationId = container.newCorrelationId()
    return getOverviewSnapshot(createOverviewDataSource(container, correlationId))
  },
)
