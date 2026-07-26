/**
 * Per-provider circuit breaker.
 *
 * Stops a dead provider from adding its timeout to every request. State is
 * held **in process, deliberately**: with several instances the worst case is
 * that each rediscovers the failure once, which costs efficiency rather than
 * correctness. The daily budget is the opposite — see `budget.ts` — and lives
 * in the shared `CacheStore` for exactly that reason.
 */

import type { Clock } from '~/domain/shared/clock'
import type { BreakerState } from '~/application/marketData/health'
import type { ErrorCode } from '~/domain/market'

export interface CircuitBreakerOptions {
  failureThreshold: number
  cooldownMs: number
}

export const DEFAULT_BREAKER: CircuitBreakerOptions = {
  failureThreshold: 5,
  cooldownMs: 60_000,
}

interface BreakerRecord {
  state: BreakerState
  consecutiveFailures: number
  openedAtMs: number | null
  lastSuccessAtMs: number | null
  lastFailure: { atMs: number; code: ErrorCode } | null
}

/**
 * Which failures are evidence that the provider is *unavailable*.
 *
 *  - `schema` / `not-found`: our adapter is wrong, not the provider. Tripping
 *    would mask the bug.
 *  - `rate-limit`: the provider answered, correctly, that we are asking too
 *    often. That is a quota condition, not an outage, and it already has its
 *    own controls — the token bucket, the daily budget and Retry-After.
 *    Letting it open the availability breaker would conflate "we overspent"
 *    with "they are down", and would suppress traffic long after the window
 *    reset.
 */
function countsTowardTripping(code: ErrorCode): boolean {
  return code !== 'schema' && code !== 'not-found' && code !== 'rate-limit'
}

export class CircuitBreakerRegistry {
  private readonly records = new Map<string, BreakerRecord>()

  constructor(
    private readonly clock: Clock,
    private readonly options: CircuitBreakerOptions = DEFAULT_BREAKER,
  ) {}

  private record(providerId: string): BreakerRecord {
    let record = this.records.get(providerId)
    if (!record) {
      record = {
        state: 'closed',
        consecutiveFailures: 0,
        openedAtMs: null,
        lastSuccessAtMs: null,
        lastFailure: null,
      }
      this.records.set(providerId, record)
    }
    return record
  }

  /** Current state, transitioning open → half-open once the cooldown expires. */
  state(providerId: string): BreakerState {
    const record = this.record(providerId)
    if (record.state === 'open' && record.openedAtMs !== null) {
      if (this.clock.epochMs() - record.openedAtMs >= this.options.cooldownMs) {
        record.state = 'half-open'
      }
    }
    return record.state
  }

  /** True when a call may proceed. Half-open allows exactly one probe. */
  allows(providerId: string): boolean {
    return this.state(providerId) !== 'open'
  }

  onSuccess(providerId: string): void {
    const record = this.record(providerId)
    record.state = 'closed'
    record.consecutiveFailures = 0
    record.openedAtMs = null
    record.lastSuccessAtMs = this.clock.epochMs()
  }

  /** Returns true when this failure opened the breaker. */
  onFailure(providerId: string, code: ErrorCode): boolean {
    const record = this.record(providerId)
    record.lastFailure = { atMs: this.clock.epochMs(), code }
    if (!countsTowardTripping(code)) return false

    record.consecutiveFailures += 1
    const wasOpen = record.state === 'open'
    // A failed half-open probe reopens immediately: the cooldown just proved
    // insufficient, so waiting for the threshold again would be pointless.
    if (
      record.state === 'half-open' ||
      record.consecutiveFailures >= this.options.failureThreshold
    ) {
      record.state = 'open'
      record.openedAtMs = this.clock.epochMs()
      return !wasOpen
    }
    return false
  }

  snapshot(providerId: string) {
    const record = this.record(providerId)
    const state = this.state(providerId)
    return {
      state,
      consecutiveFailures: record.consecutiveFailures,
      lastSuccessAt:
        record.lastSuccessAtMs === null
          ? null
          : new Date(record.lastSuccessAtMs).toISOString(),
      lastFailure: record.lastFailure
        ? {
            at: new Date(record.lastFailure.atMs).toISOString(),
            code: record.lastFailure.code,
          }
        : null,
      openedAt:
        record.openedAtMs === null ? null : new Date(record.openedAtMs).toISOString(),
      nextProbeAt:
        record.openedAtMs === null
          ? null
          : new Date(record.openedAtMs + this.options.cooldownMs).toISOString(),
    }
  }

  knownProviders(): string[] {
    return [...this.records.keys()]
  }
}
