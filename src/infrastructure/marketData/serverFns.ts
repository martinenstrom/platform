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
/**
 * The process-wide container. Exported so the health and metrics endpoints
 * read the SAME instance the pipeline uses — a separate container would report
 * on breakers and budgets nobody is using.
 */
export async function getContainer(): Promise<Container> {
  if (cached) return cached
  const [
    { createContainer },
    { createFixtureProvider },
    { createFrankfurterProvider },
    { createCoinGeckoProvider },
    { createUsTreasuryProvider },
    { createBundesbankProvider },
    { createRiksbankProvider },
    { createHttpClient },
    { loadMarketDataConfig },
  ] = await Promise.all([
    import('./container'),
    import('./providers/fixture'),
    import('./providers/frankfurter'),
    import('./providers/coinGecko'),
    import('./providers/usTreasury'),
    import('./providers/bundesbank'),
    import('./providers/riksbank'),
    import('./providers/httpClient'),
    import('./config'),
  ])

  const config = loadMarketDataConfig(process.env as never)
  const fixture = createFixtureProvider()

  /**
   * Network providers are REGISTERED conditionally rather than merely failing
   * their calls. In `fixture` mode, or with `MARKETDATA_DISABLE_NETWORK=true`,
   * no adapter is wired at all — so there is nothing to invoke by accident,
   * no external request is possible, and no provider budget can be consumed.
   *
   * A stronger guarantee than a runtime guard, and what makes "a clean
   * checkout is fully offline" structural rather than aspirational.
   */
  const networkProviders = !config.allowNetworkProviders
    ? []
    : [
        {
          provider: createUsTreasuryProvider(
            createHttpClient({ networkDisabled: false }),
          ),
          capabilities: new Set(['yields'] as const),
          metadata: {
            // The Treasury issues the securities and publishes the curve.
            trust: 'issuer' as const,
            expectedLatencyMs: 600,
            updateFrequency: 'daily' as const,
            delayMinutes: null,
            supportsHistory: true,
            supportsIntraday: false,
            supportsBatch: true,
            requiresAttribution: false,
          },
        },
        {
          provider: createBundesbankProvider(
            createHttpClient({ networkDisabled: false }),
          ),
          capabilities: new Set(['yields'] as const),
          metadata: {
            trust: 'central-bank' as const,
            expectedLatencyMs: 600,
            updateFrequency: 'daily' as const,
            delayMinutes: null,
            supportsHistory: true,
            supportsIntraday: false,
            supportsBatch: false,
            requiresAttribution: true,
          },
        },
        {
          provider: createRiksbankProvider(createHttpClient({ networkDisabled: false })),
          capabilities: new Set(['yields'] as const),
          metadata: {
            // Route trust only. The series originate with Refinitiv, which
            // `RIKSBANK_SOURCE.originatorTrust` records, so `effectiveTrust`
            // reports vendor grade.
            trust: 'central-bank' as const,
            expectedLatencyMs: 500,
            updateFrequency: 'daily' as const,
            delayMinutes: null,
            supportsHistory: true,
            supportsIntraday: false,
            supportsBatch: false,
            requiresAttribution: true,
          },
        },
        {
          provider: createCoinGeckoProvider(
            createHttpClient({ networkDisabled: false }),
            // Read here, never logged, never sent to the client, and passed
            // as a header rather than a query parameter.
            {
              ...(process.env.COINGECKO_API_KEY
                ? { apiKey: process.env.COINGECKO_API_KEY }
                : {}),
            },
          ),
          capabilities: new Set(['crypto'] as const),
          metadata: {
            // A cross-exchange aggregate: the exchanges originate the prices,
            // CoinGecko combines them.
            trust: 'aggregator' as const,
            expectedLatencyMs: 350,
            updateFrequency: 'minutely' as const,
            // Aggregated with a short cache, not a venue feed running behind.
            delayMinutes: null,
            supportsHistory: false,
            supportsIntraday: false,
            supportsBatch: true,
            requiresAttribution: true,
          },
        },
        {
          provider: createFrankfurterProvider(
            createHttpClient({ networkDisabled: false }),
          ),
          capabilities: new Set(['fx'] as const),
          metadata: {
            // Frankfurter is an open republisher; the ECB originates the
            // rates. `originatorTrust` on the source metadata records that the
            // numbers themselves are central-bank grade.
            trust: 'aggregator' as const,
            expectedLatencyMs: 400,
            // One publication per TARGET business day; nothing is gained by
            // asking more often.
            updateFrequency: 'daily' as const,
            // An end-of-day reference rate is not a delayed real-time quote,
            // so it has no meaningful minute delay.
            delayMinutes: null,
            supportsHistory: true,
            supportsIntraday: false,
            supportsBatch: false,
            requiresAttribution: true,
          },
        },
      ]

  cached = createContainer({
    config,
    providers: [
      ...networkProviders,
      {
        provider: fixture,
        metadata: {
          // Invented data. The weakest classification there is, and the
          // reason fixtures are barred from production.
          trust: 'synthetic' as const,
          // A local fixture: instant, never delayed, no attribution owed.
          expectedLatencyMs: 0,
          updateFrequency: 'static',
          delayMinutes: null,
          supportsHistory: true,
          supportsIntraday: true,
          supportsBatch: true,
          requiresAttribution: false,
        },
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
    // One correlation id per inbound request, shared by every category so the
    // whole snapshot can be reconstructed from the logs as a single chain.
    const correlationId = container.newCorrelationId()
    return getOverviewSnapshot(createOverviewDataSource(container, correlationId))
  },
)
