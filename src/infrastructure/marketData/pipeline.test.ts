/**
 * P8 — composition.
 *
 * The primitives each have their own suite. These assert the properties that
 * only emerge when they are wired together, which is where the interesting
 * failures live: duplicate requests, retry storms, fixtures leaking into the
 * live cache, stale data losing its label, and one dead provider taking the
 * page with it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { SeededRandom } from '~/domain/shared/random'
import { NO_CORRELATION } from '~/domain/shared/correlation'
import {
  buildProvenance,
  type DataSourceMetadata,
  type Envelope,
  type Provenance,
} from '~/domain/market'
import { resolve, type ResolveDeps } from '~/application/marketData/resolution'
import {
  createProviderRegistry,
  noopLogger,
} from '~/application/marketData/providerRegistry'
import { noopMetrics } from '~/application/marketData/metrics'
import type { ProviderRegistration, QuoteProvider } from '~/application/marketData/ports'
import { MemoryCacheStore } from './cache/store'
import { TieredCache } from './cache/tiered'
import { SingleFlight } from './cache/singleFlight'
import { CircuitBreakerRegistry } from './resilience/circuitBreaker'
import { DailyBudget } from './resilience/budget'
import { TokenBucket } from './resilience/tokenBucket'
import { attemptProvider, type AttemptDeps } from './attempt'
import { getOverviewSnapshot } from '~/application/marketData/getOverviewSnapshot'

const clock = new FakeClock('2026-07-26T12:00:00.000Z')

function source(providerId: string): DataSourceMetadata {
  return { providerId, providerName: providerId }
}

function provenance(providerId: string, asOf = clock.isoNow()): Provenance {
  return buildProvenance({
    asOf,
    nowMs: clock.epochMs(),
    source: source(providerId),
    quality: providerId === 'fixture' ? 'fixture' : 'realtime',
  })
}

function registration(id: string): ProviderRegistration {
  const provider: QuoteProvider = { id, name: id, fetchQuotes: async () => [] }
  return { provider, capabilities: new Set(['quotes'] as const) }
}

/** A full pipeline over real primitives — only the provider call is a stub. */
function harness(
  options: {
    providers?: string[]
    rpm?: number | null
    rpd?: number | null
    timeoutMs?: number
    maxAttempts?: number
    maxAttemptsRateLimited?: number
    production?: boolean
  } = {},
) {
  const ids = options.providers ?? ['live', 'fixture']
  const store = new MemoryCacheStore(clock)
  const cache = new TieredCache(store)
  const breakers = new CircuitBreakerRegistry(clock, {
    failureThreshold: 5,
    cooldownMs: 60_000,
  })
  const budget = new DailyBudget(store, clock)
  const buckets = new Map<string, TokenBucket>()
  const singleFlight = new SingleFlight()

  const attemptDeps: AttemptDeps = {
    clock,
    random: new SeededRandom(1),
    metrics: noopMetrics,
    breakers,
    budget,
    bucketFor: (providerId) => {
      let bucket = buckets.get(providerId)
      if (!bucket) {
        bucket = new TokenBucket({ ratePerMinute: options.rpm ?? null }, clock)
        buckets.set(providerId, bucket)
      }
      return bucket
    },
    budgetLimitFor: () => options.rpd ?? null,
    timeoutMsFor: () => options.timeoutMs ?? 5_000,
    retry: {
      maxAttempts: options.maxAttempts ?? 3,
      baseDelayMs: 1,
      maxDelayMs: 4,
      maxAttemptsRateLimited: options.maxAttemptsRateLimited ?? 2,
    },
  }

  const deps: ResolveDeps = {
    registry: createProviderRegistry(ids.map(registration)),
    clock,
    production: options.production ?? false,
    cache,
    logger: noopLogger,
    metrics: noopMetrics,
    runAttempt: (args) => attemptProvider(attemptDeps, args),
    singleFlight: (key, execute) => singleFlight.run(key, execute),
    correlationId: NO_CORRELATION,
  }

  return { deps, store, cache, breakers, budget, singleFlight, ids }
}

beforeEach(() => clock.setTo('2026-07-26T12:00:00.000Z'))

describe('pipeline composition', () => {
  it('makes one provider call for N concurrent resolutions of one key', async () => {
    const { deps } = harness()
    let calls = 0
    const request = {
      category: 'crypto' as const,
      capability: 'quotes' as const,
      cacheKey: 'k',
      chain: ['live', 'fixture'],
      marketOpen: true,
      attempt: async () => {
        calls += 1
        await Promise.resolve()
        return { data: 'v', provenance: provenance('live') }
      },
    }
    const results = await Promise.all([
      resolve(deps, request),
      resolve(deps, request),
      resolve(deps, request),
      resolve(deps, request),
    ])
    // Without single-flight this would be 4 calls — or 12 with retries.
    expect(calls).toBe(1)
    expect(results.every((r) => r.state === 'ok')).toBe(true)
  })

  it('does not let retries exceed the daily budget', async () => {
    // Budget 2, three attempts allowed: the third must never reach the
    // provider, because a retry is a request and is accounted as one.
    const { deps } = harness({ rpd: 2, maxAttempts: 3 })
    let calls = 0
    const result = await resolve(deps, {
      category: 'crypto',
      capability: 'quotes',
      cacheKey: 'k',
      chain: ['live'],
      marketOpen: true,
      attempt: async () => {
        calls += 1
        throw Object.assign(new Error('flaky'), { code: 'network' })
      },
    })
    expect(calls).toBe(2)
    expect(result.state).toBe('error')
  })

  it('never writes a fixture result into the cache', async () => {
    const { deps, store } = harness({ providers: ['fixture'] })
    const result = await resolve(deps, {
      category: 'crypto',
      capability: 'quotes',
      cacheKey: 'k',
      chain: ['fixture'],
      marketOpen: true,
      attempt: async (provider) => ({
        data: 'fixture-value',
        provenance: provenance(provider.id),
      }),
    })
    expect(result.state).toBe('fixture')
    // A cached fixture could later be resurrected and served as stale REAL
    // data. The only safe answer is never to store one.
    expect(await store.get('k')).toBeNull()
  })

  it('labels an expired entry stale even while revalidating it', async () => {
    const { deps, cache } = harness()
    await cache.set('k', 'old', provenance('live', '2026-07-26T11:00:00.000Z'), 1)
    clock.advance(60_000)

    let refreshes = 0
    const result = await resolve(deps, {
      category: 'crypto', // staleWhileRevalidate: true
      capability: 'quotes',
      cacheKey: 'k',
      chain: ['live'],
      marketOpen: true,
      attempt: async () => {
        refreshes += 1
        return { data: 'new', provenance: provenance('live') }
      },
    })

    // Served immediately from cache, and honestly labelled.
    expect(result.state).toBe('stale')
    expect(result.state === 'stale' && result.data).toBe('old')
    await vi.waitFor(() => expect(refreshes).toBe(1))
  })

  it('does not stack background refreshes for the same key', async () => {
    const { deps, cache } = harness()
    await cache.set('k', 'old', provenance('live', '2026-07-26T11:00:00.000Z'), 1)
    clock.advance(60_000)

    let refreshes = 0
    const request = {
      category: 'crypto' as const,
      capability: 'quotes' as const,
      cacheKey: 'k',
      chain: ['live'],
      marketOpen: true,
      attempt: async () => {
        refreshes += 1
        await Promise.resolve()
        return { data: 'new', provenance: provenance('live') }
      },
    }
    await Promise.all([
      resolve(deps, request),
      resolve(deps, request),
      resolve(deps, request),
    ])
    await vi.waitFor(() => expect(refreshes).toBeGreaterThan(0))
    expect(refreshes).toBe(1)
  })

  it('stops calling a provider once its breaker opens', async () => {
    const { deps, breakers } = harness({ providers: ['live'], maxAttempts: 1 })
    let calls = 0
    const request = {
      category: 'crypto' as const,
      capability: 'quotes' as const,
      chain: ['live'],
      marketOpen: true,
      attempt: async () => {
        calls += 1
        throw Object.assign(new Error('down'), { code: 'network' })
      },
    }
    // Distinct keys so single-flight does not mask the repetition.
    for (let i = 0; i < 5; i++) {
      await resolve(deps, { ...request, capability: 'quotes', cacheKey: `k${i}` })
    }
    expect(breakers.state('live')).toBe('open')

    const callsBefore = calls
    await resolve(deps, { ...request, cacheKey: 'k-after' })
    // Open breaker: no further provider calls, and no budget spent.
    expect(calls).toBe(callsBefore)
  })

  it('returns a genuine error in production rather than a fixture', async () => {
    const { deps } = harness({ production: true })
    const result = await resolve(deps, {
      category: 'crypto',
      capability: 'quotes',
      cacheKey: 'k',
      chain: ['live', 'fixture'],
      marketOpen: true,
      attempt: async (provider) => {
        if (provider.id === 'live') throw Object.assign(new Error('x'), { code: 'auth' })
        return { data: 'fixture', provenance: provenance('fixture') }
      },
    })
    expect(result.state).toBe('error')
    expect(result.state === 'error' && result.error.code).toBe('fallback-disallowed')
  })
})

describe('category isolation', () => {
  it('degrades one panel rather than the whole snapshot when a category throws', async () => {
    const ok = <T>(data: T): Envelope<T> => ({
      state: 'ok',
      data,
      provenance: provenance('live'),
    })
    // `resolve` is designed never to throw, but a bug in an adapter or the
    // pipeline must still not take the page down.
    const snapshot = await getOverviewSnapshot({
      quotes: async () => {
        throw new Error('indices adapter blew up')
      },
      fx: async () => ok([]),
      commodities: async () => ok([]),
      crypto: async () => ok([]),
      sectors: async () => ok([]),
      watchlist: async () => ok([]),
      yields: async () => ok([]),
      yieldCurve: async () =>
        ok({
          countryCode: 'US',
          methodology: 'par-yield' as const,
          observationDate: '2026-07-24',
          points: [],
          provenance: provenance('live'),
        }),
      news: async () => ok([]),
      sentiment: async () =>
        ok({
          score: 50,
          label: 'neutral',
          origin: 'derived',
          components: [],
          formulaVersion: 'v1',
          provenance: provenance('live'),
        }),
      sparklines: async () => ok({}),
      watchlistSparklines: async () => ok({}),
      intraday: async () => ok({} as never),
      now: () => clock.now(),
      correlationId: () => 'test-correlation',
    })

    expect(snapshot.indices.state).toBe('error')
    expect(snapshot.fx.state).toBe('ok')
    expect(snapshot.news.state).toBe('ok')
    expect(snapshot.hasDegradedCategory).toBe(true)
  })
})
