/**
 * Quota enforcement against the REAL configured CoinGecko numbers.
 *
 * This is the phase that first has a quota worth exhausting, so these tests
 * use the production defaults rather than convenient small ones: 30 calls/min,
 * 250/day, a 10-minute TTL. If the defaults change, these fail — which is the
 * point.
 */

import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { SeededRandom } from '~/domain/shared/random'
import { NO_CORRELATION } from '~/domain/shared/correlation'
import { buildProvenance, canonicalSymbol, type Provenance } from '~/domain/market'
import { policyFor } from '~/application/marketData/policy'
import { resolve, type ResolveDeps } from '~/application/marketData/resolution'
import {
  createProviderRegistry,
  noopLogger,
} from '~/application/marketData/providerRegistry'
import { noopMetrics } from '~/application/marketData/metrics'
import type {
  CryptoProvider,
  FetchContext,
  ProviderRegistration,
} from '~/application/marketData/ports'
import { loadMarketDataConfig } from './config'
import { createContainer } from './container'
import { MemoryCacheStore } from './cache/store'
import { TieredCache } from './cache/tiered'
import { SingleFlight } from './cache/singleFlight'
import { CircuitBreakerRegistry } from './resilience/circuitBreaker'
import { DailyBudget } from './resilience/budget'
import { TokenBucket } from './resilience/tokenBucket'
import { DEFAULT_RETRY } from './resilience/retry'
import { attemptProvider, type AttemptDeps } from './attempt'
import { HttpError } from './providers/httpClient'

const BTC = canonicalSymbol('crypto:btc')

/** The configured production numbers, read rather than restated. */
const LIVE_CONFIG = loadMarketDataConfig({
  MARKETDATA_MODE: 'hybrid',
  COINGECKO_API_KEY: 'k',
})
const RPD = LIVE_CONFIG.limits.coingecko!.requestsPerDay!
const RPM = LIVE_CONFIG.limits.coingecko!.requestsPerMinute!
const TTL_MS = policyFor('crypto').ttlOpenMs

describe('configured quota numbers', () => {
  it('matches the CoinGecko Demo plan with headroom', () => {
    expect(RPM).toBe(30)
    expect(RPD).toBe(250)
    expect(TTL_MS).toBe(10 * 60_000)
  })

  it('leaves normal use well inside the daily ceiling', () => {
    const callsPerDay = (24 * 60 * 60_000) / TTL_MS
    expect(callsPerDay).toBe(144)
    expect(callsPerDay).toBeLessThan(RPD)
  })

  it('leaves normal use well inside the MONTHLY allowance', () => {
    // The daily ceiling is not a substitute for watching the monthly one:
    // 250/day sustained would be 7,500/30d against a 10,000 cap.
    const monthly = ((24 * 60 * 60_000) / TTL_MS) * 30
    expect(monthly).toBe(4_320)
    expect(monthly).toBeLessThan(10_000)
    expect(RPD * 30).toBeGreaterThan(4_320)
  })
})

/* --------------------------------------------------------------- harness */

function harness(options: { now: string; behaviour: () => void; rpm?: number | null }) {
  const clock = new FakeClock(options.now)
  const store = new MemoryCacheStore(clock)
  const singleFlight = new SingleFlight()
  const budget = new DailyBudget(store, clock)
  const breakers = new CircuitBreakerRegistry(clock, {
    failureThreshold: 5,
    cooldownMs: 60_000,
  })
  const bucket = new TokenBucket(
    { ratePerMinute: options.rpm === undefined ? RPM : options.rpm },
    clock,
  )

  let externalCalls = 0
  const provider: CryptoProvider = {
    id: 'coingecko',
    name: 'CoinGecko',
    fetchCrypto: async () => {
      externalCalls += 1
      options.behaviour()
      return []
    },
  }
  const registration: ProviderRegistration = {
    provider,
    capabilities: new Set(['crypto'] as const),
  }

  const attemptDeps: AttemptDeps = {
    clock,
    random: new SeededRandom(1),
    metrics: noopMetrics,
    breakers,
    budget,
    bucketFor: () => bucket,
    budgetLimitFor: () => RPD,
    timeoutMsFor: () => 5_000,
    retry: { ...DEFAULT_RETRY, baseDelayMs: 1, maxDelayMs: 2 },
  }

  const provenance = (): Provenance =>
    buildProvenance({
      asOf: clock.isoNow(),
      nowMs: clock.epochMs(),
      source: { providerId: 'coingecko', providerName: 'CoinGecko' },
      quality: 'near-realtime',
    })

  const deps: ResolveDeps = {
    registry: createProviderRegistry([registration]),
    clock,
    production: false,
    cache: new TieredCache(store),
    logger: noopLogger,
    metrics: noopMetrics,
    runAttempt: (args) => attemptProvider(attemptDeps, args),
    singleFlight: (key, execute) => singleFlight.run(key, execute),
    correlationId: NO_CORRELATION,
  }

  const request = {
    category: 'crypto' as const,
    capability: 'crypto' as const,
    cacheKey: 's1.n1:crypto:crypto:btc',
    chain: ['coingecko'],
    marketOpen: true,
    // Routed through the provider so every external call is counted, which
    // is the entire subject of this file.
    attempt: async (p: unknown, fetchCtx: FetchContext) => {
      await (p as CryptoProvider).fetchCrypto([BTC], fetchCtx)
      return { data: [BTC], provenance: provenance() }
    },
  }

  return {
    clock,
    budget,
    breakers,
    calls: () => externalCalls,
    resolve: () => resolve(deps, request),
    /** Bypasses cache and single-flight to exercise the pipeline directly. */
    attemptDirect: () =>
      attemptProvider(attemptDeps, {
        providerId: 'coingecko',
        capability: 'crypto',
        correlationId: NO_CORRELATION,
        call: (fetchCtx) => provider.fetchCrypto([BTC], fetchCtx),
      }),
  }
}

/* ----------------------------------------------------------------- tests */

describe('worst-case request accounting', () => {
  it('one call serves any number of concurrent page loads', async () => {
    const h = harness({ now: '2026-07-26T12:00:00.000Z', behaviour: () => {} })
    await Promise.all(Array.from({ length: 50 }, () => h.resolve()))
    // Single-flight plus the cache: load count is irrelevant to spend.
    expect(h.calls()).toBe(1)
  })

  it('spends nothing on cache hits inside the TTL', async () => {
    const h = harness({ now: '2026-07-26T12:00:00.000Z', behaviour: () => {} })
    await h.resolve()
    h.clock.advance(TTL_MS - 1_000)
    await h.resolve()
    expect(h.calls()).toBe(1)
  })

  it('spends at most once per TTL window over a simulated day', async () => {
    const h = harness({ now: '2026-07-26T00:00:00.000Z', behaviour: () => {} })
    // 144 windows in 24 h at a 10-minute TTL.
    // 143 windows, stopping short of the UTC midnight where the daily
    // counter legitimately resets.
    for (let i = 0; i < 143; i++) {
      await h.resolve()
      h.clock.advance(TTL_MS)
    }
    // At MOST 144, not exactly: stale-while-revalidate serves the cached
    // value and refreshes behind, and background refreshes that overlap are
    // deduplicated by single-flight. Fewer calls than windows is the system
    // working, and every one of them is budgeted.
    expect(h.calls()).toBeGreaterThan(0)
    expect(h.calls()).toBeLessThanOrEqual(143)
    expect((await h.budget.status('coingecko', RPD)).used).toBe(h.calls())
  })

  it('counts every retry as a real external request', async () => {
    const h = harness({
      now: '2026-07-26T12:00:00.000Z',
      behaviour: () => {
        throw new HttpError('network', 'flaky')
      },
    })
    await h.resolve()
    // 3 attempts = 3 external requests = 3 budget units. A retry IS a request.
    expect(h.calls()).toBe(3)
    expect((await h.budget.status('coingecko', RPD)).used).toBe(3)
  })

  it('is the hard ceiling regardless of anything upstream of it', async () => {
    // Driven straight at the attempt pipeline, so nothing — not the cache, not
    // single-flight, not the TTL — stands between the caller and the budget.
    // Even a TTL misconfigured to zero cannot spend past this.
    // rpm null isolates the budget from the token bucket, which would
    // otherwise stop this loop at 30 with no clock advance.
    const h = harness({ now: '2026-07-26T12:00:00.000Z', behaviour: () => {}, rpm: null })
    for (let i = 0; i < RPD + 50; i++) await h.attemptDirect()
    expect(h.calls()).toBe(RPD)
    expect((await h.budget.status('coingecko', RPD)).remaining).toBe(0)
  })

  it('reports budget-exhausted rather than silently overspending', async () => {
    const h = harness({ now: '2026-07-26T12:00:00.000Z', behaviour: () => {}, rpm: null })
    for (let i = 0; i < RPD; i++) await h.attemptDirect()
    const outcome = await h.attemptDirect()
    expect(outcome.kind).toBe('skipped')
    if (outcome.kind === 'skipped') expect(outcome.reason).toBe('budget-exhausted')
  })

  it('resets at the next UTC midnight', async () => {
    const h = harness({ now: '2026-07-26T23:00:00.000Z', behaviour: () => {}, rpm: null })
    for (let i = 0; i < RPD; i++) await h.attemptDirect()
    expect((await h.budget.status('coingecko', RPD)).remaining).toBe(0)
    h.clock.advance(2 * 60 * 60_000)
    expect((await h.attemptDirect()).kind).toBe('success')
  })
})

describe('rate limiting is a quota condition, not an outage', () => {
  it('retries a 429 at most once and honours Retry-After', async () => {
    const h = harness({
      now: '2026-07-26T12:00:00.000Z',
      behaviour: () => {
        throw new HttpError('rate-limit', 'HTTP 429', 429, 1)
      },
    })
    await h.resolve()
    // maxAttemptsRateLimited = 2, versus 3 for ordinary failures: hammering a
    // healthy provider that told us to slow down only spends more budget.
    expect(h.calls()).toBe(2)
  })

  it('does not open the availability breaker', async () => {
    const h = harness({
      now: '2026-07-26T12:00:00.000Z',
      behaviour: () => {
        throw new HttpError('rate-limit', 'HTTP 429', 429, 1)
      },
    })
    for (let i = 0; i < 10; i++) {
      await h.resolve()
      h.clock.advance(TTL_MS)
    }
    // "We asked too often" is not "they are down". Conflating them would
    // suppress traffic long after the rate window reset.
    expect(h.breakers.state('coingecko')).toBe('closed')
  })

  it('by contrast, ordinary failures do open it', async () => {
    const h = harness({
      now: '2026-07-26T12:00:00.000Z',
      behaviour: () => {
        throw new HttpError('network', 'down')
      },
    })
    // Checked without advancing the clock: a 10-minute advance would carry it
    // past the 60-second cooldown into half-open.
    for (let i = 0; i < 6; i++) await h.attemptDirect()
    expect(h.breakers.state('coingecko')).toBe('open')
  })
})

describe('sustained outage', () => {
  const down = () => {
    throw new HttpError('network', 'down')
  }

  it('probes once per window instead of retrying the probe', async () => {
    const h = harness({ now: '2026-07-26T12:00:00.000Z', behaviour: down })
    for (let i = 0; i < 20; i++) {
      await h.attemptDirect()
      // Longer than the 60 s cooldown, so every later window finds the
      // breaker half-open.
      h.clock.advance(TTL_MS)
    }
    // Five windows of 3 attempts to reach the failure threshold, then a
    // SINGLE probe per window: 5x3 + 15x1 = 30. Retrying a probe cannot
    // improve the answer to "are you back?", but it would have made this
    // 20x3 = 60, and 432/day across a full outage.
    expect(h.calls()).toBe(30)
  })

  it('cannot exhaust the budget even across a full day of outage', async () => {
    // An honest correction to the Phase 3 plan, which credited the breaker
    // with capping outage spend. It does not, once the refresh interval
    // exceeds the cooldown — every window gets a fresh probe. What actually
    // holds is that single-request probes keep a whole day of outage
    // (~15 + 138 = 153 calls) inside the 250 budget.
    const h = harness({ now: '2026-07-26T00:00:00.000Z', behaviour: down })
    for (let i = 0; i < 143; i++) {
      await h.attemptDirect()
      h.clock.advance(TTL_MS)
    }
    expect(h.calls()).toBeLessThan(RPD)
    expect((await h.budget.status('coingecko', RPD)).remaining).toBeGreaterThan(0)
  })
})

describe('multi-instance guard', () => {
  it('divides the daily budget floor-wise across instances', () => {
    const three = loadMarketDataConfig({
      MARKETDATA_MODE: 'hybrid',
      COINGECKO_API_KEY: 'k',
      MARKETDATA_INSTANCE_COUNT: '3',
    })
    expect(three.limits.coingecko?.requestsPerDay).toBe(83)
    // Conservative by construction: 83 x 3 = 249 <= 250.
    expect(83 * 3).toBeLessThanOrEqual(RPD)
  })

  it('never divides below one request', () => {
    const many = loadMarketDataConfig({
      MARKETDATA_MODE: 'hybrid',
      COINGECKO_API_KEY: 'k',
      MARKETDATA_INSTANCE_COUNT: '1000',
    })
    expect(many.limits.coingecko?.requestsPerDay).toBe(1)
  })
})

describe('multi-instance budgets fail closed (H1)', () => {
  const liveEnv = {
    MARKETDATA_MODE: 'live',
    MARKETDATA_CHAIN_CRYPTO: 'coingecko,fixture',
    COINGECKO_API_KEY: 'test-key',
  }

  it('refuses to start with several instances and no shared store', () => {
    // The case that used to be a warning. Declaring the instance count is the
    // operator confirming budgets are counted N times, not mitigating it.
    expect(() =>
      createContainer({ env: { ...liveEnv, MARKETDATA_INSTANCE_COUNT: '3' } }),
    ).toThrow(/multiplied by the instance count/i)
  })

  it('refuses to start when the instance count is simply unstated', () => {
    expect(() => createContainer({ env: liveEnv })).toThrow(
      /Unsafe market-data configuration/i,
    )
  })

  it('allows a single live instance', () => {
    expect(() =>
      createContainer({ env: { ...liveEnv, MARKETDATA_INSTANCE_COUNT: '1' } }),
    ).not.toThrow()
  })

  it('leaves non-production deployments alone', () => {
    // Hybrid is a developer's machine. The guard exists for real quotas.
    expect(() =>
      createContainer({
        env: {
          MARKETDATA_MODE: 'hybrid',
          MARKETDATA_CHAIN_CRYPTO: 'coingecko,fixture',
          MARKETDATA_INSTANCE_COUNT: '3',
        },
      }),
    ).not.toThrow()
  })

  it('does not fire when no metered provider is in a chain', () => {
    // Every Phase 4B and 6A source is keyless and uncapped; nothing to protect.
    expect(() =>
      createContainer({
        env: { MARKETDATA_MODE: 'live', MARKETDATA_INSTANCE_COUNT: '5' },
      }),
    ).not.toThrow()
  })
})
