/**
 * Phase 1 primitives, tested in isolation (P1–P7, P9).
 *
 * Composition is covered separately in `pipeline.test.ts`; these assert each
 * mechanism's own contract, which is what makes a composition failure
 * diagnosable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { SeededRandom } from '~/domain/shared/random'
import { newCorrelationId } from '~/domain/shared/correlation'
import { MemoryCacheStore } from '../cache/store'
import { SingleFlight } from '../cache/singleFlight'
import { TieredCache } from '../cache/tiered'
import { TokenBucket } from './tokenBucket'
import { CircuitBreakerRegistry } from './circuitBreaker'
import { DailyBudget, nextUtcMidnightMs } from './budget'
import { backoffDelayMs, DEFAULT_RETRY, isRetryable } from './retry'
import { TimeoutError, withTimeout } from './timeout'
import { createLogger, scrub } from '../logging'
import type { Provenance } from '~/domain/market'

const clock = new FakeClock('2026-07-26T12:00:00.000Z')

beforeEach(() => clock.setTo('2026-07-26T12:00:00.000Z'))

/* ------------------------------------------------------------------- P1 */

describe('SingleFlight', () => {
  it('runs one execution for N concurrent callers', async () => {
    const flight = new SingleFlight()
    let executions = 0
    const slow = async () => {
      executions += 1
      await Promise.resolve()
      return 'value'
    }
    const results = await Promise.all([
      flight.run('k', slow),
      flight.run('k', slow),
      flight.run('k', slow),
    ])
    expect(executions).toBe(1)
    expect(results).toEqual(['value', 'value', 'value'])
  })

  it('does not let a rejection poison the key', async () => {
    const flight = new SingleFlight()
    await expect(
      flight.run('k', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    // A later caller must get a fresh execution, not the cached rejection.
    await expect(flight.run('k', async () => 'ok')).resolves.toBe('ok')
  })

  it('clears the key once settled', async () => {
    const flight = new SingleFlight()
    await flight.run('k', async () => 'ok')
    expect(flight.isInFlight('k')).toBe(false)
    expect(flight.size()).toBe(0)
  })

  it('keeps separate keys independent', async () => {
    const flight = new SingleFlight()
    let executions = 0
    const run = async () => {
      executions += 1
      return executions
    }
    await Promise.all([flight.run('a', run), flight.run('b', run)])
    expect(executions).toBe(2)
  })
})

/* ------------------------------------------------------------------- P2 */

describe('TokenBucket', () => {
  it('allows a burst up to capacity, then refuses', () => {
    const bucket = new TokenBucket({ ratePerMinute: 3 }, clock)
    expect([bucket.tryAcquire(), bucket.tryAcquire(), bucket.tryAcquire()]).toEqual([
      true,
      true,
      true,
    ])
    expect(bucket.tryAcquire()).toBe(false)
  })

  it('refills proportionally to elapsed time', () => {
    const bucket = new TokenBucket({ ratePerMinute: 60 }, clock)
    for (let i = 0; i < 60; i++) bucket.tryAcquire()
    expect(bucket.tryAcquire()).toBe(false)
    clock.advance(2_000) // 60/min = 1/s → two tokens
    expect(bucket.tryAcquire()).toBe(true)
    expect(bucket.tryAcquire()).toBe(true)
    expect(bucket.tryAcquire()).toBe(false)
  })

  it('treats a null rate as unlimited', () => {
    const bucket = new TokenBucket({ ratePerMinute: null }, clock)
    for (let i = 0; i < 1_000; i++) expect(bucket.tryAcquire()).toBe(true)
  })
})

/* ------------------------------------------------------------------- P3 */

describe('DailyBudget', () => {
  it('permits exactly `limit` reservations per UTC day', async () => {
    const budget = new DailyBudget(new MemoryCacheStore(clock), clock)
    for (let i = 0; i < 3; i++) {
      expect(await budget.reserve('p', 3)).toBe(true)
    }
    expect(await budget.reserve('p', 3)).toBe(false)
  })

  it('treats a null limit as unmetered', async () => {
    const budget = new DailyBudget(new MemoryCacheStore(clock), clock)
    for (let i = 0; i < 500; i++) expect(await budget.reserve('p', null)).toBe(true)
  })

  it('resets at the next UTC midnight', async () => {
    const store = new MemoryCacheStore(clock)
    const budget = new DailyBudget(store, clock)
    await budget.reserve('p', 1)
    expect(await budget.reserve('p', 1)).toBe(false)
    clock.setTo('2026-07-27T00:00:01.000Z')
    expect(await budget.reserve('p', 1)).toBe(true)
  })

  it('computes the reset boundary as the next UTC midnight', () => {
    const at = nextUtcMidnightMs(Date.parse('2026-07-26T23:59:59.000Z'))
    expect(new Date(at).toISOString()).toBe('2026-07-27T00:00:00.000Z')
  })

  it('survives a process restart when a durable store backs it', async () => {
    const store = new MemoryCacheStore(clock)
    await new DailyBudget(store, clock).reserve('p', 2)
    // A new DailyBudget over the same store is what a restart looks like.
    const afterRestart = new DailyBudget(store, clock)
    expect(await afterRestart.reserve('p', 2)).toBe(true)
    expect(await afterRestart.reserve('p', 2)).toBe(false)
  })

  it('reports status without consuming a unit', async () => {
    const budget = new DailyBudget(new MemoryCacheStore(clock), clock)
    await budget.reserve('p', 10)
    const first = await budget.status('p', 10)
    const second = await budget.status('p', 10)
    expect(first.used).toBe(1)
    expect(second.used).toBe(1)
    expect(second.remaining).toBe(9)
  })
})

/* ------------------------------------------------------------------- P4 */

describe('CircuitBreakerRegistry', () => {
  it('opens after the failure threshold and blocks further calls', () => {
    const breakers = new CircuitBreakerRegistry(clock, {
      failureThreshold: 3,
      cooldownMs: 60_000,
    })
    expect(breakers.onFailure('p', 'network')).toBe(false)
    expect(breakers.onFailure('p', 'network')).toBe(false)
    expect(breakers.onFailure('p', 'network')).toBe(true)
    expect(breakers.allows('p')).toBe(false)
    expect(breakers.state('p')).toBe('open')
  })

  it('half-opens after the cooldown and closes on a successful probe', () => {
    const breakers = new CircuitBreakerRegistry(clock, {
      failureThreshold: 1,
      cooldownMs: 60_000,
    })
    breakers.onFailure('p', 'network')
    expect(breakers.allows('p')).toBe(false)
    clock.advance(60_000)
    expect(breakers.state('p')).toBe('half-open')
    expect(breakers.allows('p')).toBe(true)
    breakers.onSuccess('p')
    expect(breakers.state('p')).toBe('closed')
  })

  it('reopens immediately when the half-open probe fails', () => {
    const breakers = new CircuitBreakerRegistry(clock, {
      failureThreshold: 1,
      cooldownMs: 60_000,
    })
    breakers.onFailure('p', 'network')
    clock.advance(60_000)
    expect(breakers.state('p')).toBe('half-open')
    breakers.onFailure('p', 'network')
    // The cooldown just proved insufficient; waiting for the threshold again
    // would be pointless.
    expect(breakers.state('p')).toBe('open')
  })

  it('does not trip on a schema error', () => {
    // A schema error means our adapter is wrong, not that the provider is
    // down. Tripping would mask the bug.
    const breakers = new CircuitBreakerRegistry(clock, {
      failureThreshold: 2,
      cooldownMs: 60_000,
    })
    breakers.onFailure('p', 'schema')
    breakers.onFailure('p', 'schema')
    breakers.onFailure('p', 'schema')
    expect(breakers.allows('p')).toBe(true)
  })

  it('exposes a health snapshot', () => {
    const breakers = new CircuitBreakerRegistry(clock, {
      failureThreshold: 1,
      cooldownMs: 30_000,
    })
    breakers.onFailure('p', 'timeout')
    const snapshot = breakers.snapshot('p')
    expect(snapshot.state).toBe('open')
    expect(snapshot.lastFailure?.code).toBe('timeout')
    expect(snapshot.nextProbeAt).toBe('2026-07-26T12:00:30.000Z')
  })
})

/* ------------------------------------------------------------------- P5 */

describe('retry', () => {
  it('retries only failures that could plausibly succeed again', () => {
    expect(isRetryable('network')).toBe(true)
    expect(isRetryable('timeout')).toBe(true)
    expect(isRetryable('rate-limit')).toBe(true)
    // These fail identically every time; retrying just burns budget.
    expect(isRetryable('schema')).toBe(false)
    expect(isRetryable('auth')).toBe(false)
    expect(isRetryable('not-found')).toBe(false)
  })

  it('produces a reproducible jitter sequence from a seeded RNG', () => {
    const a = new SeededRandom(42)
    const b = new SeededRandom(42)
    const seqA = [1, 2, 3].map((n) => backoffDelayMs(n, DEFAULT_RETRY, a))
    const seqB = [1, 2, 3].map((n) => backoffDelayMs(n, DEFAULT_RETRY, b))
    expect(seqA).toEqual(seqB)
  })

  it('grows the ceiling exponentially and caps it', () => {
    // Full jitter means the delay is in [0, ceiling); an RNG pinned near 1
    // reveals the ceiling itself.
    const nearOne = { next: () => 0.999999, intBetween: () => 0, hex: () => '' }
    expect(backoffDelayMs(1, DEFAULT_RETRY, nearOne)).toBeLessThan(250)
    expect(backoffDelayMs(2, DEFAULT_RETRY, nearOne)).toBeLessThan(500)
    expect(backoffDelayMs(9, DEFAULT_RETRY, nearOne)).toBeLessThan(
      DEFAULT_RETRY.maxDelayMs + 1,
    )
  })

  it('never returns a negative delay', () => {
    const zero = { next: () => 0, intBetween: () => 0, hex: () => '' }
    expect(backoffDelayMs(1, DEFAULT_RETRY, zero)).toBe(0)
  })
})

/* ------------------------------------------------------------------- P6 */

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('rejects and aborts once the deadline passes', async () => {
    const controller = new AbortController()
    const promise = withTimeout(1_000, controller, () => new Promise(() => {}))
    const assertion = expect(promise).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(1_001)
    await assertion
    expect(controller.signal.aborted).toBe(true)
  })

  it('resolves normally inside the deadline and clears its timer', async () => {
    const controller = new AbortController()
    const result = await withTimeout(1_000, controller, async () => 'value')
    expect(result).toBe('value')
    expect(controller.signal.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})

/* ------------------------------------------------------------------- P7 */

describe('TieredCache', () => {
  function provenance(): Provenance {
    return {
      asOf: clock.isoNow(),
      asOfPrecision: 'second' as const,
      receivedAt: clock.isoNow(),
      ageMs: 0,
      source: { providerId: 'p', providerName: 'P' },
      quality: 'realtime',
      isDelayed: false,
      delayMinutes: null,
      isProxy: false,
    }
  }

  it('is fully correct with no L2, only colder after a restart', async () => {
    const cache = new TieredCache(new MemoryCacheStore(clock))
    await cache.set('k', 1, provenance(), 60_000)
    expect((await cache.get<number>('k'))?.value).toBe(1)
    expect(cache.isShared).toBe(false)
  })

  it('promotes an L2 hit into L1 without extending its life', async () => {
    const l1 = new MemoryCacheStore(clock)
    const l2 = new MemoryCacheStore(clock)
    const cache = new TieredCache(l1, l2)
    await cache.set('k', 1, provenance(), 60_000)
    const expiresAt = (await cache.get<number>('k'))!.expiresAtMs

    // Simulate a restart: L1 empty, L2 warm.
    const afterRestart = new TieredCache(new MemoryCacheStore(clock), l2)
    const hit = await afterRestart.get<number>('k')
    expect(hit?.value).toBe(1)
    // A restart must not silently give every entry a fresh TTL.
    expect(hit?.expiresAtMs).toBe(expiresAt)
  })

  it('reports sharedness from the durable tier', async () => {
    const shared = new MemoryCacheStore(clock) as unknown as {
      isShared: boolean
    } & MemoryCacheStore
    Object.defineProperty(shared, 'isShared', { value: true })
    expect(new TieredCache(new MemoryCacheStore(clock), shared).isShared).toBe(true)
  })
})

/* ------------------------------------------------------------------- P9 */

describe('logging redaction', () => {
  it('scrubs credentials out of free text', () => {
    expect(scrub('GET https://api.example.com/v1?apikey=SECRET123&x=1')).not.toContain(
      'SECRET123',
    )
    expect(scrub('Authorization: Bearer abcdef123456')).not.toContain('abcdef123456')
    expect(scrub('token=abc123def456&x=1')).not.toContain('abc123def456')
    expect(scrub('api_key: hunter2hunter2')).not.toContain('hunter2hunter2')
  })

  it('removes known secret values wherever they appear', () => {
    expect(scrub('failed with key sk-live-9f8e7d6c', ['sk-live-9f8e7d6c'])).toBe(
      'failed with key [REDACTED]',
    )
  })

  it('emits only allowlisted fields', () => {
    const records: Array<Record<string, unknown>> = []
    // successSampleRate 1 disables sampling; this test is about which FIELDS
    // are emitted, not about whether the record is sampled.
    const logger = createLogger({
      sink: (record) => records.push(record),
      successSampleRate: 1,
    })
    logger.resolution({
      correlationId: 'abc',
      category: 'fx',
      capability: 'fx',
      cacheKey: 's1.n1:fx:fx:eurusd',
      providerId: 'frankfurter',
      outcome: 'provider-success',
      latencyMs: 12,
      // Anything not on the allowlist must be dropped, not merely trusted.
      responseBody: '{"secret":"leak"}',
      url: 'https://x?apikey=LEAK',
    } as unknown as Parameters<typeof logger.resolution>[0])
    const record = records[0]!
    expect(record.responseBody).toBeUndefined()
    expect(record.url).toBeUndefined()
    expect(JSON.stringify(record)).not.toContain('LEAK')
    expect(record.providerId).toBe('frankfurter')
  })
})

/* ------------------------------------------------- correlation determinism */

describe('correlation ids', () => {
  it('are reproducible under a seeded RNG', () => {
    expect(newCorrelationId(new SeededRandom(7))).toBe(
      newCorrelationId(new SeededRandom(7)),
    )
  })

  it('differ between requests', () => {
    const random = new SeededRandom(7)
    expect(newCorrelationId(random)).not.toBe(newCorrelationId(random))
  })
})
