/**
 * Per-provider token bucket.
 *
 * Enforces requests-per-minute. Deliberately non-blocking: an exhausted bucket
 * causes the provider to be **skipped**, not queued. Queueing would convert a
 * rate limit into latency, and a page that renders stale data now is better
 * than one that renders fresh data in nine seconds.
 */

import type { Clock } from '~/domain/shared/clock'

export interface TokenBucketOptions {
  /** Sustained rate. `null` means unlimited — `tryAcquire` always succeeds. */
  ratePerMinute: number | null
  /** Burst capacity. Defaults to the per-minute rate. */
  capacity?: number
}

export class TokenBucket {
  private tokens: number
  private lastRefillMs: number
  private readonly capacity: number

  constructor(
    private readonly options: TokenBucketOptions,
    private readonly clock: Clock,
  ) {
    this.capacity = options.capacity ?? options.ratePerMinute ?? 0
    this.tokens = this.capacity
    this.lastRefillMs = clock.epochMs()
  }

  private refill(): void {
    if (this.options.ratePerMinute === null) return
    const now = this.clock.epochMs()
    const elapsed = now - this.lastRefillMs
    if (elapsed <= 0) return
    const refilled = (elapsed / 60_000) * this.options.ratePerMinute
    this.tokens = Math.min(this.capacity, this.tokens + refilled)
    this.lastRefillMs = now
  }

  /** Consumes one token if available. Never waits. */
  tryAcquire(): boolean {
    if (this.options.ratePerMinute === null) return true
    this.refill()
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }

  available(): number {
    if (this.options.ratePerMinute === null) return Number.POSITIVE_INFINITY
    this.refill()
    return Math.floor(this.tokens)
  }
}
