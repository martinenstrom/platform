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

/**
 * Maximum live entries before the least recently used one is dropped.
 *
 * A bound, not a tuning parameter. Cache keys embed the symbol SET they were
 * resolved for, so cardinality is a function of what users ask for, not of how
 * many instruments exist: a watchlist screen or a search box turns a fixed key
 * space into a user-driven one. Without a ceiling that is an unbounded `Map`
 * in a long-lived process, which is a slow memory leak diagnosed late.
 *
 * Sized the same way `MAX_SERIES` bounds the metrics recorder — generous
 * enough that normal operation never evicts, small enough to be survivable.
 */
export const MAX_ENTRIES = 2000

/**
 * How long an expired entry is kept before it can be swept.
 *
 * Expiry is NOT eviction. The resolver serves expired entries as `stale`, so
 * dropping one at its TTL would remove the fallback that keeps a panel alive
 * through an outage. An entry is only sweepable once it is older than the
 * longest `maxStaleMs` any category configures, at which point no policy would
 * serve it and it is genuinely dead weight.
 */
export const STALE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** L1. Always present; absorbs nearly all traffic in a long-lived SSR process. */
export class MemoryCacheStore implements CacheStore {
  readonly id = 'memory' as const
  readonly isShared = false

  /**
   * Insertion order IS the LRU order: `Map` preserves it, and `get`/`set`
   * re-insert on hit, so the oldest key is always the first one iterated.
   */
  private readonly entries = new Map<string, CacheEntry<unknown>>()
  private readonly counters = new Map<string, CounterState>()

  constructor(
    private readonly clock: Clock,
    private readonly maxEntries: number = MAX_ENTRIES,
    private readonly staleRetentionMs: number = STALE_RETENTION_MS,
  ) {}

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.entries.get(key) as CacheEntry<T> | undefined
    if (!entry) return null
    // Expired entries are returned, not dropped: the resolver decides whether
    // to serve them as `stale`, and deleting here would destroy that option.
    //
    // Touch it so a key that keeps a panel alive through an outage is not the
    // one evicted for being "old".
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const now = this.clock.epochMs()
    // Re-insert rather than overwrite, so the key moves to the recent end.
    this.entries.delete(key)
    this.entries.set(key, { value, storedAtMs: now, expiresAtMs: now + ttlMs })
    this.evict(now)
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key)
  }

  async increment(key: string, by: number, resetAtMs: number): Promise<number> {
    const now = this.clock.epochMs()
    const existing = this.counters.get(key)
    const state =
      existing && existing.resetAtMs > now ? existing : { count: 0, resetAtMs }
    state.count += by
    this.counters.set(key, state)
    // Budget counters are bounded by provider count, but a reset one is dead.
    for (const [counterKey, counter] of this.counters) {
      if (counter.resetAtMs <= now && counterKey !== key) this.counters.delete(counterKey)
    }
    return state.count
  }

  /**
   * Sweeps entries no policy could still serve, then enforces the ceiling.
   *
   * Sweeping first matters: it means a legitimately busy key space evicts dead
   * weight before it evicts anything a caller might have wanted.
   */
  private evict(nowMs: number): void {
    for (const [key, entry] of this.entries) {
      if (nowMs - entry.storedAtMs > this.staleRetentionMs) this.entries.delete(key)
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  /** Test/diagnostic helper. Not part of `CacheStore`. */
  size(): number {
    return this.entries.size
  }
}
