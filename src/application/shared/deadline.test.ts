/**
 * Snapshot deadline (H2).
 *
 * Uses fake timers rather than real sleeps, so the suite stays fast and the
 * assertions are about ordering rather than wall-clock luck.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Envelope } from '~/domain/shared/provenance'
import { getOverviewSnapshot } from '~/application/marketData/getOverviewSnapshot'
import { DEFAULT_SNAPSHOT_BUDGET_MS, withDeadline } from './deadline'

const ok = <T>(data: T): Envelope<T> => ({
  state: 'ok',
  data,
  provenance: {
    asOf: '2026-07-26T12:00:00.000Z',
    asOfPrecision: 'second',
    receivedAt: '2026-07-26T12:00:00.000Z',
    ageMs: 0,
    source: {
      providerId: 'test',
      providerName: 'Test',
      trust: 'exchange',
    },
    quality: 'realtime',
    isDelayed: false,
    delayMinutes: null,
    isProxy: false,
  },
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('withDeadline', () => {
  it('passes a fast result straight through', async () => {
    const result = await withDeadline('fast', async () => ok('value'), {
      budgetMs: 1000,
    })
    expect(result.state).toBe('ok')
  })

  it('reports a slow unit as exceeded instead of waiting', async () => {
    const pending = withDeadline<string>('slow', () => new Promise(() => {}), {
      budgetMs: 1000,
    })
    await vi.advanceTimersByTimeAsync(1001)
    const result = await pending

    expect(result.state).toBe('error')
    if (result.state !== 'error') throw new Error('unreachable')
    expect(result.error.code).toBe('timeout')
    expect(result.error.message).toMatch(/snapshot deadline/)
  })

  it('marks the exceeded unit retryable, because the work usually lands', async () => {
    // The abandoned call typically completes and warms the cache, so the next
    // request is served immediately. A deadline degrades a cold page.
    const pending = withDeadline<string>('slow', () => new Promise(() => {}), {
      budgetMs: 500,
    })
    await vi.advanceTimersByTimeAsync(501)
    const result = await pending
    if (result.state !== 'error') throw new Error('unreachable')
    expect(result.error.retryable).toBe(true)
  })

  it('does not report `loading`, which would promise a refetch that never comes', async () => {
    const pending = withDeadline<string>('slow', () => new Promise(() => {}), {
      budgetMs: 100,
    })
    await vi.advanceTimersByTimeAsync(101)
    expect((await pending).state).not.toBe('loading')
  })

  it('ignores a result that arrives after the deadline', async () => {
    let settle: (value: Envelope<string>) => void = () => {}
    const pending = withDeadline<string>(
      'late',
      () => new Promise((resolve) => (settle = resolve)),
      { budgetMs: 100 },
    )
    await vi.advanceTimersByTimeAsync(101)
    settle(ok('too late'))

    const result = await pending
    // Already answered. A late value must not rewrite the response.
    expect(result.state).toBe('error')
  })

  it('treats a rejection as exceeded rather than leaving the page pending', async () => {
    const result = await withDeadline<string>(
      'broken',
      () => Promise.reject(new Error('boom')),
      { budgetMs: 1000 },
    )
    expect(result.state).toBe('error')
  })

  it('ships a budget a healthy snapshot never approaches', () => {
    // Providers declare expectedLatencyMs in the hundreds. This exists for the
    // degraded case, not to constrain normal operation.
    expect(DEFAULT_SNAPSHOT_BUDGET_MS).toBeGreaterThanOrEqual(2000)
    expect(DEFAULT_SNAPSHOT_BUDGET_MS).toBeLessThanOrEqual(10_000)
  })
})

describe('the Overview degrades one panel, not the page', () => {
  /** Every category resolves instantly except the one named. */
  function source(slowCategory: string) {
    const fast =
      <T>(data: T) =>
      async () =>
        ok(data)
    const slow = () => new Promise<never>(() => {})
    const pick = <T>(name: string, data: T) => (name === slowCategory ? slow : fast(data))

    return {
      now: () => new Date('2026-07-26T12:00:00.000Z'),
      correlationId: () => 'test',
      quotes: pick('indices', []),
      sparklines: pick('indexSparklines', {}),
      fx: pick('fx', []),
      commodities: pick('commodities', []),
      crypto: pick('crypto', []),
      yields: pick('yields', []),
      yieldCurve: pick('yieldCurve', { countryCode: 'US', points: [] }),
      sectors: pick('sectors', []),
      sentiment: pick('sentiment', {}),
      news: pick('news', []),
      intraday: pick('intraday', {}),
      watchlist: pick('watchlist', []),
      watchlistSparklines: pick('watchlistSparklines', {}),
    } as never
  }

  it('returns the whole snapshot when one category hangs', async () => {
    const pending = getOverviewSnapshot(source('crypto'), 1000)
    await vi.advanceTimersByTimeAsync(1001)
    const snapshot = await pending

    // The hung category is the only casualty.
    expect(snapshot.crypto.state).toBe('error')
    expect(snapshot.fx.state).toBe('ok')
    expect(snapshot.yields.state).toBe('ok')
    expect(snapshot.generatedAt).toBeTruthy()
  })

  it('does not wait for the slow category before answering', async () => {
    const started = Date.now()
    const pending = getOverviewSnapshot(source('news'), 1000)
    await vi.advanceTimersByTimeAsync(1001)
    await pending
    // Bounded by the budget, not by the hung provider — which never settles.
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('resolves everything when the budget is disabled', async () => {
    const snapshot = await getOverviewSnapshot(source('none'), Infinity)
    expect(snapshot.fx.state).toBe('ok')
    expect(snapshot.crypto.state).toBe('ok')
  })
})
