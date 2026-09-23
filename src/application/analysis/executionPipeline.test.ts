/**
 * The analysis execution pipeline.
 *
 * The properties tested here are the ones §6 of the client decision rules on,
 * and each is written so that a plausible wrong implementation fails it: the
 * deadline is per run rather than per attempt, retries stay inside one run, and
 * retryability is keyed to a producer that samples rather than to one that
 * answers deterministically.
 */

import { describe, expect, it } from 'vitest'
import type { Random } from '~/domain/shared/random'
import type { RunFailureCategory } from '~/domain/analysis'
import {
  executeWithinRun,
  isRetryableFailure,
  type AttemptOutcome,
} from './executionPipeline'

/** Full jitter multiplies by this, so 1 makes delays exactly the cap. */
const fixedRandom = (value: number): Random => ({
  next: () => value,
  intBetween: (min) => min,
  hex: (length) => 'a'.repeat(length),
})

/**
 * A clock the test advances, plus a `sleep` that advances it.
 *
 * Real sleeping would make these tests slow and flaky; more importantly, a
 * `sleep` that did not move the clock would let a backoff appear free and the
 * run-level deadline would never be reached by waiting.
 */
function fakeClock(startMs = 0) {
  let nowMs = startMs
  return {
    monotonicNowMs: () => nowMs,
    advance: (ms: number) => {
      nowMs += ms
    },
    sleep: async (ms: number) => {
      nowMs += ms
    },
  }
}

const ok = <T>(value: T): AttemptOutcome<T> => ({ state: 'ok', value })
const failed = (category: RunFailureCategory): AttemptOutcome<never> => ({
  state: 'failed',
  category,
})

describe('isRetryableFailure', () => {
  it('retries a sampled producer that returned unparseable output', () => {
    /*
     * The entry that proves this vocabulary could not be shared with market
     * data. There, a schema error means the API and the parser disagree and
     * will disagree identically forever. Here the producer samples, so the same
     * prompt genuinely may parse next time.
     */
    expect(isRetryableFailure('malformed-output')).toBe(true)
  })

  it('does not retry a provider answering against a contract it never declared', () => {
    // Not sampling noise: a configuration mismatch that will repeat.
    expect(isRetryableFailure('schema-violation')).toBe(false)
  })

  it('never retries an exhausted budget, because spending more is not the remedy', () => {
    expect(isRetryableFailure('budget-exhausted')).toBe(false)
  })

  it.each(['provider-unavailable', 'provider-timeout'] as const)(
    'retries %s, which is transient',
    (category) => expect(isRetryableFailure(category)).toBe(true),
  )

  it.each(['provider-error', 'evidence-unavailable', 'internal-error'] as const)(
    'does not retry %s, which needs a person or another part of the firm',
    (category) => expect(isRetryableFailure(category)).toBe(false),
  )
})

describe('executeWithinRun', () => {
  it('returns the first success without retrying', async () => {
    const clock = fakeClock()
    let calls = 0
    const result = await executeWithinRun(
      30_000,
      async () => {
        calls += 1
        return ok('claims')
      },
      {
        random: fixedRandom(0),
        monotonicNowMs: clock.monotonicNowMs,
        sleep: clock.sleep,
      },
    )

    expect(result).toEqual({ state: 'ok', value: 'claims', attempts: 1 })
    expect(calls).toBe(1)
  })

  it('counts retries as attempts of ONE run, never as separate runs', async () => {
    /*
     * The rule both pipelines share, and the one this must never break: the
     * caller records a single run that took three attempts. Three runs would be
     * the record claiming the firm commissioned the work three times.
     */
    const clock = fakeClock()
    let calls = 0
    const result = await executeWithinRun(
      30_000,
      async () => {
        calls += 1
        return calls < 3 ? failed('provider-unavailable') : ok('claims')
      },
      {
        random: fixedRandom(0),
        monotonicNowMs: clock.monotonicNowMs,
        sleep: clock.sleep,
      },
    )

    expect(result).toEqual({ state: 'ok', value: 'claims', attempts: 3 })
  })

  it('stops immediately on a failure that will repeat', async () => {
    const clock = fakeClock()
    let calls = 0
    const result = await executeWithinRun(
      30_000,
      async () => {
        calls += 1
        return failed('provider-error')
      },
      {
        random: fixedRandom(0),
        monotonicNowMs: clock.monotonicNowMs,
        sleep: clock.sleep,
      },
    )

    expect(calls).toBe(1)
    expect(result).toMatchObject({
      state: 'failed',
      category: 'provider-error',
      attempts: 1,
    })
  })

  it('spends its attempts and reports the last failure', async () => {
    const clock = fakeClock()
    let calls = 0
    const result = await executeWithinRun(
      600_000,
      async () => {
        calls += 1
        return failed('malformed-output')
      },
      {
        random: fixedRandom(0),
        monotonicNowMs: clock.monotonicNowMs,
        sleep: clock.sleep,
      },
    )

    expect(calls).toBe(3)
    expect(result).toMatchObject({
      state: 'failed',
      category: 'malformed-output',
      attempts: 3,
      // The organization may queue it again; this run is spent.
      retryable: true,
    })
  })

  describe('the deadline belongs to the run, not to the attempt', () => {
    it('does not give each attempt a fresh copy of the whole budget', async () => {
      /*
       * The property that distinguishes this pipeline from market data's. Each
       * attempt burns 6s of a 10s run. A per-attempt deadline would allow all
       * three the policy permits — 18s of work inside a 10s authorisation —
       * because no single attempt exceeds 10s on its own. Sharing one clock
       * stops after the second, with the time genuinely gone.
       */
      const clock = fakeClock()
      let calls = 0
      const result = await executeWithinRun(
        10_000,
        async () => {
          calls += 1
          clock.advance(6_000)
          return failed('provider-unavailable')
        },
        {
          random: fixedRandom(0),
          monotonicNowMs: clock.monotonicNowMs,
          sleep: clock.sleep,
        },
      )

      expect(calls).toBe(2)
      /*
       * The second attempt itself ran past the run's deadline — under a real
       * clock the timer would have cut it at 10 s — so what the record says is
       * that the provider did not answer inside the window (TD-102), not that
       * the authorised time was spent between attempts.
       */
      expect(result).toMatchObject({ state: 'failed', category: 'provider-timeout' })
    })

    it('counts the time spent waiting between attempts against the run', async () => {
      // Backoff is time the run spent. A pipeline that only counted time
      // inside calls would let waiting be free.
      const clock = fakeClock()
      let calls = 0
      await executeWithinRun(
        10_000,
        async () => {
          calls += 1
          return failed('provider-unavailable')
        },
        {
          // Full jitter at 1.0 makes every delay exactly the capped maximum.
          random: fixedRandom(0.999999),
          monotonicNowMs: clock.monotonicNowMs,
          sleep: clock.sleep,
          policy: { maxAttempts: 5, baseDelayMs: 4_000, maxDelayMs: 8_000 },
        },
      )

      // Attempt 1, wait ~4s, attempt 2, wait ~8s — which would exceed the run,
      // so it stops rather than sleeping into its own deadline.
      expect(calls).toBe(2)
    })

    it('aborts the call when the run deadline expires mid-attempt', async () => {
      /*
       * The reason `withTimeout` was worth sharing rather than reimplementing:
       * the signal is aborted, so an expensive call is told to stop instead of
       * being abandoned while it keeps spending.
       */
      const clock = fakeClock()
      let aborted = false
      const result = await executeWithinRun(
        50,
        (signal) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => {
              aborted = true
              resolve(failed('provider-timeout'))
            })
          }),
        {
          random: fixedRandom(0),
          monotonicNowMs: clock.monotonicNowMs,
          sleep: clock.sleep,
        },
      )

      expect(aborted).toBe(true)
      // A hung provider stays retryable: it may well answer next time.
      expect(result).toMatchObject({
        state: 'failed',
        category: 'provider-timeout',
        retryable: true,
      })
    })

    it('refuses a partial result the call produced after being cancelled', async () => {
      /*
       * The worst version of the ordering problem. `withTimeout` aborts before
       * it rejects, so a callee can resolve `ok` with whatever it had
       * assembled — and the firm would record a contribution built from a call
       * it had already cancelled.
       */
      const clock = fakeClock()
      const result = await executeWithinRun(
        50,
        (signal) =>
          new Promise<AttemptOutcome<string>>((resolve) => {
            signal.addEventListener('abort', () => resolve(ok('half-written claims')))
          }),
        {
          random: fixedRandom(0),
          monotonicNowMs: clock.monotonicNowMs,
          sleep: clock.sleep,
        },
      )

      expect(result).toMatchObject({ state: 'failed', category: 'provider-timeout' })
    })

    it('refuses an answer that arrived after the deadline, even a good one', async () => {
      /*
       * The planted stall of TD-102, in the shape the record measured: the
       * timer never fires — the process was not running to fire it — but the
       * clock moved on, and the attempt settles `ok` 59 minutes late. The
       * answer is a late answer, and a late answer never resurrects an
       * expired run.
       */
      const clock = fakeClock()
      let attempts = 0
      const result = await executeWithinRun(
        180_000,
        async () => {
          attempts += 1
          clock.advance(59 * 60_000)
          return ok('an answer the firm cannot use')
        },
        {
          random: fixedRandom(0),
          monotonicNowMs: clock.monotonicNowMs,
          sleep: clock.sleep,
        },
      )

      expect(result).toEqual({
        state: 'failed',
        category: 'provider-timeout',
        attempts: 1,
        retryable: true,
      })
      // Not retried in this run: the window is spent. The queue is where it is tried again.
      expect(attempts).toBe(1)
    })

    it('names a failure that settled after the deadline a timeout, not spent budget', async () => {
      /*
       * Run 11 as recorded: the call errored on resume, an hour late, and the
       * pipeline called it `budget-exhausted / not retryable` — a label that
       * says nothing external misbehaved and leaves the assignment where it
       * is. The deadline passed mid-attempt; that is a provider timeout.
       */
      const clock = fakeClock()
      const result = await executeWithinRun(
        180_000,
        async () => {
          clock.advance(59 * 60_000)
          return failed('provider-error')
        },
        {
          random: fixedRandom(0),
          monotonicNowMs: clock.monotonicNowMs,
          sleep: clock.sleep,
        },
      )

      expect(result).toEqual({
        state: 'failed',
        category: 'provider-timeout',
        attempts: 1,
        retryable: true,
      })
    })

    it('accepts an answer that arrived with time to spare', async () => {
      // The near miss: the same clock, the same attempt, inside the window.
      const clock = fakeClock()
      const result = await executeWithinRun(
        180_000,
        async () => {
          clock.advance(179_999)
          return ok('claims')
        },
        {
          random: fixedRandom(0),
          monotonicNowMs: clock.monotonicNowMs,
          sleep: clock.sleep,
        },
      )
      expect(result).toEqual({ state: 'ok', value: 'claims', attempts: 1 })
    })

    it('runs unbounded only when the producer has no deadline at all', async () => {
      // `null` is for a producer whose deadline dimension is not-applicable.
      // A live run always has one, because it refuses to start without.
      const clock = fakeClock()
      const result = await executeWithinRun(null, async () => ok('claims'), {
        random: fixedRandom(0),
        monotonicNowMs: clock.monotonicNowMs,
        sleep: clock.sleep,
      })
      expect(result).toEqual({ state: 'ok', value: 'claims', attempts: 1 })
    })
  })

  it('reports an unclassified throw as ours, not the provider’s', async () => {
    const clock = fakeClock()
    const result = await executeWithinRun(
      30_000,
      async () => {
        throw new Error('a bug in our own mapping code')
      },
      {
        random: fixedRandom(0),
        monotonicNowMs: clock.monotonicNowMs,
        sleep: clock.sleep,
      },
    )

    expect(result).toMatchObject({
      state: 'failed',
      category: 'internal-error',
      attempts: 1,
    })
  })
})
