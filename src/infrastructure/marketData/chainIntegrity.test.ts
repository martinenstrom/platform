/**
 * Configured providers that cannot actually serve their category.
 *
 * A chain is a list of ids and nothing used to validate that the ids referred
 * to anything usable. Two filters hid a mistake between them: config drops an
 * id with no credential entry, and `chainFor` drops an id the registry cannot
 * resolve — silently, and correctly, because a missing API key legitimately
 * shortens a chain.
 *
 * Two real defects lived in that gap on 2026-08-25. `yahoo` was implemented and
 * registered but absent from `KEYLESS_PROVIDERS`, so the S&P 500 and FTSE 100
 * quietly served fixture constants. `derived` was first in the sentiment chain
 * with no adapter behind it, so the gauge had been a placeholder since it was
 * written. Neither produced a single warning.
 *
 * Two checks now cover it, and they answer different questions:
 *
 *   startup   is this provider registered at all?          eager, every id
 *   resolver  can it serve what this category asks for?    lazy, real requests
 *
 * The resolver half exists because the capability half of the question cannot
 * be answered from a table: `equity-se` resolves through `quotes` for its
 * watchlist and `series` for its sparklines, so category-to-capability is not
 * a function. The resolver is handed both at the moment both are true.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { SeededRandom } from '~/domain/shared/random'
import { NO_CORRELATION } from '~/domain/shared/correlation'
import { buildProvenance, type DataSourceMetadata } from '~/domain/market'
import { resolve, type ResolveDeps } from '~/application/marketData/resolution'
import {
  createProviderRegistry,
  type Logger,
} from '~/application/marketData/providerRegistry'
import { noopMetrics } from '~/application/marketData/metrics'
import type {
  Capability,
  ProviderRegistration,
  QuoteProvider,
} from '~/application/marketData/ports'
import { MemoryCacheStore } from './cache/store'
import { TieredCache } from './cache/tiered'
import { SingleFlight } from './cache/singleFlight'
import { CircuitBreakerRegistry } from './resilience/circuitBreaker'
import { DailyBudget } from './resilience/budget'
import { TokenBucket } from './resilience/tokenBucket'
import { attemptProvider, type AttemptDeps } from './attempt'

const clock = new FakeClock('2026-08-25T12:00:00.000Z')

const source = (providerId: string): DataSourceMetadata => ({
  providerId,
  providerName: providerId,
})

function registration(
  providerId: string,
  capabilities: Capability[],
): ProviderRegistration {
  const provider = {
    id: providerId,
    name: providerId,
    fetchQuotes: async () => [],
  } as unknown as QuoteProvider
  return {
    provider,
    capabilities: new Set(capabilities),
    metadata: {
      trust: 'aggregator',
      expectedLatencyMs: 10,
      updateFrequency: 'minutely',
      delayMinutes: null,
      supportsHistory: false,
      supportsIntraday: false,
      supportsBatch: true,
      requiresAttribution: false,
    },
  } as unknown as ProviderRegistration
}

function harness(registrations: ProviderRegistration[]) {
  const warnings: Array<{ message: string; meta?: unknown }> = []
  const logger: Logger = {
    resolution: () => {},
    warn: (message, meta) => warnings.push({ message, meta }),
  }
  const store = new MemoryCacheStore(clock)
  const attemptDeps: AttemptDeps = {
    clock,
    random: new SeededRandom(1),
    metrics: noopMetrics,
    breakers: new CircuitBreakerRegistry(clock, {
      failureThreshold: 5,
      cooldownMs: 60_000,
    }),
    budget: new DailyBudget(store, clock),
    bucketFor: () => new TokenBucket({ ratePerMinute: null }, clock),
    budgetLimitFor: () => null,
    timeoutMsFor: () => 5_000,
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 2, maxAttemptsRateLimited: 1 },
  }
  const singleFlight = new SingleFlight()
  const deps: ResolveDeps = {
    registry: createProviderRegistry(registrations),
    clock,
    production: false,
    cache: new TieredCache(store),
    logger,
    metrics: noopMetrics,
    runAttempt: (args) => attemptProvider(attemptDeps, args),
    singleFlight: (key, execute) => singleFlight.run(key, execute),
    correlationId: NO_CORRELATION,
    chainGapsSeen: new Set<string>(),
  }
  return { deps, warnings }
}

let counter = 0
const request = (chain: string[], capability: Capability = 'quotes') => ({
  category: 'sentiment' as const,
  capability,
  /* A distinct key per call: the point is to reach the chain, not the cache. */
  cacheKey: `k${(counter += 1)}`,
  chain,
  marketOpen: true,
  attempt: async () => ({
    data: 'value',
    provenance: buildProvenance({
      asOf: clock.isoNow(),
      nowMs: clock.epochMs(),
      source: source('fixture'),
      quality: 'fixture',
    }),
  }),
})

beforeEach(() => {
  counter = 0
  clock.setTo('2026-08-25T12:00:00.000Z')
})

describe('a configured provider that is registered and capable', () => {
  it('produces no warning at all', async () => {
    /*
     * The control. A check that cannot stay quiet on a correct configuration
     * is a check nobody will keep.
     */
    const { deps, warnings } = harness([
      registration('live', ['quotes']),
      registration('fixture', ['quotes']),
    ])
    await resolve(deps, request(['live', 'fixture']))
    expect(warnings).toEqual([])
  })
})

describe('a configured provider that is not registered', () => {
  it('is reported, naming the category and the id', async () => {
    /* The `derived` defect: first in the sentiment chain, no adapter behind it. */
    const { deps, warnings } = harness([registration('fixture', ['quotes'])])
    await resolve(deps, request(['derived', 'fixture']))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toContain('"derived"')
    expect(warnings[0]!.message).toContain('no adapter is registered under that id')
    expect(warnings[0]!.meta).toMatchObject({
      category: 'sentiment',
      capability: 'quotes',
      providerId: 'derived',
    })
  })
})

describe('a configured provider registered without the capability', () => {
  it('is reported, and distinguished from a missing registration', async () => {
    /*
     * The half a startup registration check cannot see. The adapter exists and
     * would pass any "is it registered" test; it simply cannot do this job.
     * The two need different fixes — a composition-root omission versus an
     * adapter registered for the wrong capability — so the messages differ.
     */
    const { deps, warnings } = harness([
      registration('news-only', ['news']),
      registration('fixture', ['quotes']),
    ])
    await resolve(deps, request(['news-only', 'fixture']))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toContain('"news-only"')
    expect(warnings[0]!.message).toContain('not registered for the "quotes" capability')
    expect(warnings[0]!.message).not.toContain('no adapter is registered')
  })

  it('stays quiet for the same provider on a capability it does serve', async () => {
    /*
     * The reason this cannot be a category-to-capability table: the same
     * provider is a fault for one capability and correct for another, and only
     * the actual request knows which is being asked for.
     */
    const { deps, warnings } = harness([
      registration('news-only', ['news']),
      registration('fixture', ['news', 'quotes']),
    ])
    await resolve(deps, request(['news-only', 'fixture'], 'news'))
    expect(warnings).toEqual([])
  })
})

describe('a permanent fault is reported once, not on every request', () => {
  it('deduplicates by category, capability and provider', async () => {
    const { deps, warnings } = harness([registration('fixture', ['quotes'])])
    for (let i = 0; i < 5; i += 1) {
      await resolve(deps, request(['derived', 'fixture']))
    }
    expect(warnings).toHaveLength(1)
  })

  it('still reports the same provider under a different capability', async () => {
    /*
     * Deduplication must not swallow a second, genuinely different fault: a
     * provider missing for `quotes` and missing for `series` are two problems.
     */
    const { deps, warnings } = harness([registration('fixture', ['quotes', 'series'])])
    await resolve(deps, request(['derived', 'fixture'], 'quotes'))
    await resolve(deps, request(['derived', 'fixture'], 'series'))
    expect(warnings).toHaveLength(2)
  })

  it('reports every distinct phantom in one chain', async () => {
    const { deps, warnings } = harness([registration('fixture', ['quotes'])])
    await resolve(deps, request(['ghost-a', 'ghost-b', 'fixture']))
    expect(warnings.map((w) => (w.meta as { providerId: string }).providerId)).toEqual([
      'ghost-a',
      'ghost-b',
    ])
  })

  it('warns every time when no dedupe set is supplied', async () => {
    /* Omitting the set is what a test wants; the container always supplies one. */
    const { deps, warnings } = harness([registration('fixture', ['quotes'])])
    const undeduped: ResolveDeps = { ...deps, chainGapsSeen: undefined }
    await resolve(undeduped, request(['derived', 'fixture']))
    await resolve(undeduped, request(['derived', 'fixture']))
    expect(warnings).toHaveLength(2)
  })
})

describe('the gap does not stop the category resolving', () => {
  it('still serves from the providers that remain', async () => {
    /*
     * Reporting, not enforcement. A phantom id degrades a category to its
     * fallback, which is a working if diminished product; refusing to serve
     * would turn a configuration warning into an outage.
     */
    const { deps } = harness([registration('fixture', ['quotes'])])
    const envelope = await resolve(deps, request(['derived', 'fixture']))
    expect(envelope.state).toBe('fixture')
  })
})
