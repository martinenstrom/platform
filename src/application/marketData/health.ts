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
): MarketDataHealth {
  const unservable = categories
    .filter((entry) => entry.bestAvailable === 'unavailable')
    .map((entry) => entry.category)

  const status: MarketDataHealth['status'] = unservable.length
    ? 'critical'
    : categories.some((entry) => entry.bestAvailable !== 'live')
      ? 'degraded'
      : 'healthy'

  return { status, checkedAt, providers, categories, unservableCategories: unservable }
}
