/**
 * Cache store abstraction (decision D8).
 *
 * One interface, three intended implementations: memory now, optional disk
 * JSON for local development and single-instance deployments, and a shared KV
 * store later. **Production correctness must never depend on local disk** —
 * with no L2 the system is fully correct, only colder after a restart.
 *
 * Phase A ships the interface and the memory store. Disk and KV land in Phase 1
 * behind this same interface, with no caller changes.
 */

import type { Clock } from '~/domain/shared/clock'

export interface CacheEntry<T> {
  value: T
  storedAtMs: number
  expiresAtMs: number
}

export interface CacheStore {
  readonly id: 'memory' | 'disk' | 'kv'
  /**
   * True when the store is shared across process instances.
   *
   * This is not cosmetic. Cached values degrade gracefully when unshared (N×
   * cold misses, still correct data), but the **daily request budget does
   * not**: three instances against a 100/day quota will attempt 300 calls. A
   * shared store is therefore a prerequisite for multi-instance deployment,
   * and `config.ts` warns when live mode is combined with `isShared: false`.
   */
  readonly isShared: boolean
  get<T>(key: string): Promise<CacheEntry<T> | null>
  set<T>(key: string, value: T, ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
  /**
   * Atomic counter for the daily request budget. Returns the value after
   * incrementing. Only correct across instances when `isShared` is true.
   */
  increment(key: string, by: number, resetAtMs: number): Promise<number>
}

interface CounterState {
  count: number
  resetAtMs: number
}

/** L1. Always present; absorbs nearly all traffic in a long-lived SSR process. */
export class MemoryCacheStore implements CacheStore {
  readonly id = 'memory' as const
  readonly isShared = false

  private readonly entries = new Map<string, CacheEntry<unknown>>()
  private readonly counters = new Map<string, CounterState>()

  constructor(private readonly clock: Clock) {}

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.entries.get(key) as CacheEntry<T> | undefined
    if (!entry) return null
    // Expired entries are returned, not dropped: the resolver decides whether
    // to serve them as `stale`, and deleting here would destroy that option.
    return entry
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const now = this.clock.epochMs()
    this.entries.set(key, { value, storedAtMs: now, expiresAtMs: now + ttlMs })
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key)
  }

  async increment(key: string, by: number, resetAtMs: number): Promise<number> {
    const existing = this.counters.get(key)
    const state =
      existing && existing.resetAtMs > this.clock.epochMs()
        ? existing
        : { count: 0, resetAtMs }
    state.count += by
    this.counters.set(key, state)
    return state.count
  }

  /** Test/diagnostic helper. Not part of `CacheStore`. */
  size(): number {
    return this.entries.size
  }
}
