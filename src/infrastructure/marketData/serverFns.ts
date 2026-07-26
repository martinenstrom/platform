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
  getOverviewSnapshot,
  type OverviewSnapshot,
} from '~/application/marketData/getOverviewSnapshot'
import type { Container } from './container'

let cached: Container | null = null

/**
 * One container per server process. Built lazily so the module can be imported
 * without touching the environment, and memoised so the in-process cache and
 * provider health survive between requests.
 */
async function getContainer(): Promise<Container> {
  if (cached) return cached
  const [{ createContainer }, { createFixtureProvider }] = await Promise.all([
    import('./container'),
    import('./providers/fixture'),
  ])
  const fixture = createFixtureProvider()
  cached = createContainer({
    providers: [
      {
        provider: fixture,
        // The fixture serves every capability — it is the tail of every chain.
        capabilities: new Set([
          'quotes',
          'series',
          'fx',
          'yields',
          'commodities',
          'crypto',
          'news',
          'sentiment',
        ]),
      },
    ],
  })
  return cached
}

/** Assembles the whole Overview server-side. One round trip, one `asOf`. */
export const getOverviewSnapshotFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<OverviewSnapshot> => {
    const container = await getContainer()
    const { createOverviewDataSource } = await import('./overviewDataSource')
    return getOverviewSnapshot(createOverviewDataSource(container))
  },
)
