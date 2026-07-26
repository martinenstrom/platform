/**
 * Provider and subsystem health.
 *
 * Operational metadata, not a UI feature. `ProviderHealth` is per adapter;
 * `MarketDataHealth` aggregates it into the answer to "can this subsystem
 * currently serve the product?".
 */

import type { ErrorCode } from '~/domain/market'
import type { DataCategory } from './ports'

export type BreakerState = 'closed' | 'open' | 'half-open'

export interface BudgetStatus {
  /** Requests per UTC day, or `null` when the provider imposes none. */
  limit: number | null
  used: number
  remaining: number | null
  /** ISO instant at which the counter resets. */
  resetsAt: string
}

export interface RateLimitStatus {
  rpm: number | null
  tokensAvailable: number
}

export interface ProviderHealth {
  providerId: string
  /** Latency of the most recent completed call, when one has happened. */
  lastLatencyMs: number | null
  state: BreakerState
  consecutiveFailures: number
  lastSuccessAt: string | null
  lastFailure: { at: string; code: ErrorCode } | null
  openedAt: string | null
  /** When the breaker will allow its next half-open probe. */
  nextProbeAt: string | null
  budget: BudgetStatus
  rateLimit: RateLimitStatus
}

/** What a category can currently achieve, given breakers, budgets and policy. */
export type CategoryAvailability = 'live' | 'stale' | 'fixture' | 'unavailable'

export interface CategoryHealth {
  category: DataCategory
  bestAvailable: CategoryAvailability
  liveProvidersConfigured: number
  liveProvidersAvailable: number
}

export interface MarketDataHealth {
  /**
   * Always `'instance'` for now.
   *
   * Breaker state and metrics live in process memory, and the budget is only
   * global when `sharedBudget` is true. Describing this as system-wide health
   * in a multi-instance deployment would be a claim the data cannot support.
   */
  scope: 'instance'
  /**
   * Whether provider budgets are counted in a store shared across instances.
   *
   * False means the budget figures describe THIS process only, so the global
   * quota position is unknown from here.
   */
  sharedBudget: boolean
  /** Metrics recorder state, for diagnosing gaps in what was captured. */
  metrics?: {
    scope: 'instance'
    seriesCount: number
    droppedWrites: { invalidLabel: number; capacity: number; invalidValue: number }
  }
  /**
   * `degraded` — at least one category cannot reach a live provider.
   * `critical` — at least one category is `unavailable`: no live provider, no
   *              acceptable stale value, and fixtures forbidden by policy.
   */
  status: 'healthy' | 'degraded' | 'critical'
  checkedAt: string
  providers: ProviderHealth[]
  categories: CategoryHealth[]
  /** Categories that would return an error rather than render, in live mode. */
  unservableCategories: DataCategory[]
}

export function summarizeHealth(
  providers: ProviderHealth[],
  categories: CategoryHealth[],
  checkedAt: string,
  context: {
    sharedBudget: boolean
    metrics?: MarketDataHealth['metrics']
  } = { sharedBudget: false },
): MarketDataHealth {
  const unservable = categories
    .filter((entry) => entry.bestAvailable === 'unavailable')
    .map((entry) => entry.category)

  const status: MarketDataHealth['status'] = unservable.length
    ? 'critical'
    : categories.some((entry) => entry.bestAvailable !== 'live')
      ? 'degraded'
      : 'healthy'

  return {
    scope: 'instance',
    sharedBudget: context.sharedBudget,
    ...(context.metrics ? { metrics: context.metrics } : {}),
    status,
    checkedAt,
    providers,
    categories,
    unservableCategories: unservable,
  }
}
