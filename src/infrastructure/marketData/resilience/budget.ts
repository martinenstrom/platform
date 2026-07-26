/**
 * Persistent daily request budget.
 *
 * Counted **per attempt**, not per logical resolution — a retry is a request,
 * and the provider counts it as one. See §19 of the architecture doc for the
 * trade-off; the short version is that a budget which does not match the
 * provider's own accounting is not a budget.
 *
 * Held in `CacheStore` rather than in memory, because this is the one piece of
 * resilience state where a per-instance view is a correctness problem: three
 * instances each counting to 100 will attempt 300 against a 100/day quota.
 * Moving to a shared KV store therefore fixes it with no caller change.
 */

import type { Clock } from '~/domain/shared/clock'
import type { BudgetStatus } from '~/application/marketData/health'
import type { CacheStore } from '../cache/store'
import { budgetKey } from '../keys'

/** Next UTC midnight — the reset boundary every provider quota uses. */
export function nextUtcMidnightMs(nowMs: number): number {
  const now = new Date(nowMs)
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  )
}

function utcDate(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

export class DailyBudget {
  constructor(
    private readonly store: CacheStore,
    private readonly clock: Clock,
  ) {}

  /**
   * Reserves one unit **before** the call. A crash mid-request then costs a
   * unit rather than allowing an overdraft — the safe direction to be wrong.
   * Returns false when the provider is out of budget for the UTC day.
   */
  async reserve(providerId: string, limit: number | null): Promise<boolean> {
    if (limit === null) return true
    const nowMs = this.clock.epochMs()
    const used = await this.store.increment(
      budgetKey(providerId, utcDate(nowMs)),
      1,
      nextUtcMidnightMs(nowMs),
    )
    return used <= limit
  }

  async status(providerId: string, limit: number | null): Promise<BudgetStatus> {
    const nowMs = this.clock.epochMs()
    const resetsAt = new Date(nextUtcMidnightMs(nowMs)).toISOString()
    // Increment by zero: reads the counter without consuming a unit.
    const used = await this.store.increment(
      budgetKey(providerId, utcDate(nowMs)),
      0,
      nextUtcMidnightMs(nowMs),
    )
    return {
      limit,
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
      resetsAt,
    }
  }
}
