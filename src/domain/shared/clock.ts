/**
 * Clock abstraction.
 *
 * No code below the presentation layer may call `Date.now()` or `new Date()`
 * directly. Time is an input, so it is injected — that is what makes TTL
 * expiry, staleness thresholds, rate-limit windows, circuit-breaker cooldowns
 * and daily-budget resets testable without sleeping, and what stops a fixture
 * provider from being non-deterministic.
 *
 * `Clock` lives in `domain/shared` rather than `domain/market` because it is
 * not a financial concept — the portfolio and agent experiences will need the
 * same abstraction.
 */

export interface Clock {
  /** Current instant. */
  now(): Date
  /** Current instant as epoch milliseconds — the form most call sites want. */
  epochMs(): number
  /** Current instant as ISO 8601 with offset. The domain's timestamp format. */
  isoNow(): string
}

/** Production clock. The only place `Date.now()` is permitted in this codebase. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }
  epochMs(): number {
    return Date.now()
  }
  isoNow(): string {
    return new Date().toISOString()
  }
}

/**
 * Deterministic clock for tests and for any fixture that must reproduce
 * identical output across runs and machines (Phase 0 exit criterion X-G4).
 *
 * Time only moves when the test moves it, so a test can assert "this entry is
 * exactly 61 seconds stale" without a real delay.
 */
export class FakeClock implements Clock {
  private current: Date

  constructor(start: Date | string = '2026-07-26T12:00:00.000Z') {
    this.current = typeof start === 'string' ? new Date(start) : new Date(start)
  }

  now(): Date {
    return new Date(this.current)
  }
  epochMs(): number {
    return this.current.getTime()
  }
  isoNow(): string {
    return this.current.toISOString()
  }

  /** Moves time forward. Negative values are rejected — clocks do not rewind. */
  advance(ms: number): this {
    if (ms < 0) throw new Error('FakeClock cannot move backwards')
    this.current = new Date(this.current.getTime() + ms)
    return this
  }

  /** Jumps to an absolute instant, for tests that need a specific wall time. */
  setTo(instant: Date | string): this {
    this.current = typeof instant === 'string' ? new Date(instant) : new Date(instant)
    return this
  }
}

/** Shared production instance — injected at the composition root, not imported ad hoc. */
export const systemClock: Clock = new SystemClock()
