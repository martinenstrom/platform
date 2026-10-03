/**
 * The process-wide market-data container, built once and memoised.
 *
 * Server-only by construction: nothing imports this module statically. The
 * server functions in `./serverFns` and `./healthFns` reach it through a
 * dynamic `import()` inside their handler bodies, which TanStack Start strips
 * from the client build — so the providers wired here, and the MCP stdio
 * client one of them spawns, never enter the browser bundle.
 *
 * It used to live in `serverFns.ts` as an exported plain function. A plain
 * export is not stripped: every route imports `serverFns`, so rollup followed
 * its dynamic imports down to `@modelcontextprotocol/sdk`'s stdio transport
 * and failed on `node:stream`. Measured 2026-09-24: neutralising that one
 * function made `vite build` pass. This module is the smallest cut.
 */

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
    { createAvanzaProvider },
    { createYahooProvider },
    { createDerivedProvider },
    { createAvanzaSearchProvider },
    { createNewYorkFedProvider },
    { createEcbProvider },
    { createRiksbankPolicyProvider },
    { callAvanzaTool },
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
    import('./providers/avanza'),
    import('./providers/yahoo'),
    import('./providers/derived'),
    import('./providers/avanza/search'),
    import('./providers/newYorkFed'),
    import('./providers/ecb'),
    import('./providers/riksbankPolicy'),
    // The transport seam. A dynamic import inside this server-only handler is
    // what keeps a child-process spawner out of the client graph entirely.
    import('~/services/avanzaMcp/client'),
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
          /* `series` since 2026-10-03: the par-yield history, for "vad gjorde tioåringen i veckan?". */
          capabilities: new Set(['yields', 'series'] as const),
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
          /*
           * Yahoo — S&P 500 and FTSE 100 only.
           *
           * Best-effort and free: no service commitment, no delay guarantee,
           * and no relationship with the index owners. `aggregator` trust and
           * a `delayed` ceiling are what that honestly supports, and the
           * alternative for these two was a fixture constant.
           */
          provider: createYahooProvider(createHttpClient({ networkDisabled: false })),
          /*
           * `series` since 2026-10-03: daily closes for the six indices
           * (`YAHOO_HISTORY_INDICES`), so a period question is answered from
           * a real series. The quotes keep their routes; only history is new.
           */
          capabilities: new Set(['quotes', 'series'] as const),
          metadata: {
            trust: 'aggregator' as const,
            expectedLatencyMs: 400,
            updateFrequency: 'minutely' as const,
            /* Yahoo publishes no delay figure, so none is claimed. */
            delayMinutes: null,
            supportsHistory: true,
            supportsIntraday: false,
            supportsBatch: false,
            requiresAttribution: true,
          },
        },
        {
          /*
           * The only provider that computes rather than obtains. Registered
           * for `sentiment` alone, and deliberately weaker than every route it
           * consumes: a derived figure inherits its inputs' weakness and adds
           * a methodology on top.
           */
          provider: createDerivedProvider(createHttpClient({ networkDisabled: false })),
          capabilities: new Set(['sentiment'] as const),
          metadata: {
            trust: 'derived' as const,
            /* Four daily-history requests, so slower than a single quote. */
            expectedLatencyMs: 2500,
            updateFrequency: 'daily' as const,
            delayMinutes: null,
            supportsHistory: true,
            supportsIntraday: false,
            supportsBatch: false,
            requiresAttribution: false,
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
          provider: createNewYorkFedProvider(
            createHttpClient({ networkDisabled: false }),
          ),
          capabilities: new Set(['policy-rates'] as const),
          metadata: {
            // The desk publishes what the FOMC decided; `NY_FED_SOURCE`
            // records the committee as originator.
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
          provider: createEcbProvider(createHttpClient({ networkDisabled: false })),
          capabilities: new Set(['policy-rates'] as const),
          metadata: {
            // Sets and publishes its own rates.
            trust: 'central-bank' as const,
            // Three series fetched in parallel.
            expectedLatencyMs: 900,
            updateFrequency: 'daily' as const,
            delayMinutes: null,
            supportsHistory: true,
            supportsIntraday: false,
            supportsBatch: false,
            requiresAttribution: true,
          },
        },
        {
          provider: createRiksbankPolicyProvider(
            createHttpClient({ networkDisabled: false }),
          ),
          capabilities: new Set(['policy-rates'] as const),
          metadata: {
            // Unlike the SWEA yield series on this same API, the policy rate
            // is the Riksbank's own decision — no vendor originator.
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
          provider: createAvanzaSearchProvider(callAvanzaTool),
          capabilities: new Set(['search'] as const),
          metadata: {
            trust: 'broker' as const,
            expectedLatencyMs: 900,
            // A catalog lookup, not a market observation.
            updateFrequency: 'realtime' as const,
            delayMinutes: null,
            supportsHistory: false,
            supportsIntraday: false,
            supportsBatch: false,
            requiresAttribution: true,
          },
        },
        {
          provider: createAvanzaProvider(callAvanzaTool),
          /*
           * `commodities` since 2026-08-25: Gold and Brent spot, the same
           * transport and the same identity verification as the indices.
           */
          capabilities: new Set(['quotes', 'commodities'] as const),
          metadata: {
            // A broker redistributing venue prices. Not the exchange, and no
            // originator is claimed — the payload never speaks for one.
            trust: 'broker' as const,
            // A `uvx` child process and an upstream call, not a bare fetch.
            expectedLatencyMs: 1200,
            updateFrequency: 'minutely' as const,
            // `isRealTime: false`, but Avanza never states by how much.
            delayMinutes: null,
            supportsHistory: false,
            supportsIntraday: false,
            // One order book id per call; there is no batch quote tool.
            supportsBatch: false,
            requiresAttribution: true,
          },
        },
        {
          provider: createFrankfurterProvider(
            createHttpClient({ networkDisabled: false }),
          ),
          /* `series` since 2026-10-03: the ECB reference-rate history of a pair. */
          capabilities: new Set(['fx', 'series'] as const),
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
          'policy-rates',
          'search',
        ]),
      },
    ],
  })
  return cached
}
