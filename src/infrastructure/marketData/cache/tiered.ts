/**
 * Two-tier cache: L1 in process over an optional L2.
 *
 * With no L2 the system is fully correct, only colder after a restart — that
 * is the invariant behind "production correctness must never depend on local
 * disk" (decision D8). Nothing in the resolution path branches on which store
 * is present.
 */

import type { Provenance } from '~/domain/market'
import type {
  CachedValue,
  ResolutionCache,
} from '~/application/marketData/providerRegistry'
import type { CacheStore } from './store'

interface Wrapped<T> {
  value: T
  provenance: Provenance
}

export class TieredCache implements ResolutionCache {
  constructor(
    private readonly l1: CacheStore,
    private readonly l2?: CacheStore,
  ) {}

  async get<T>(key: string): Promise<CachedValue<T> | null> {
    const hit = await this.l1.get<Wrapped<T>>(key)
    if (hit) {
      return {
        value: hit.value.value,
        provenance: hit.value.provenance,
        expiresAtMs: hit.expiresAtMs,
      }
    }
    if (!this.l2) return null

    const cold = await this.l2.get<Wrapped<T>>(key)
    if (!cold) return null
    // Promote so the next read stays in process. The remaining TTL is
    // preserved rather than restarted, or a restart would silently extend
    // every entry's life.
    const remaining = cold.expiresAtMs - Date.now()
    if (remaining > 0) await this.l1.set(key, cold.value, remaining)
    return {
      value: cold.value.value,
      provenance: cold.value.provenance,
      expiresAtMs: cold.expiresAtMs,
    }
  }

  async set<T>(
    key: string,
    value: T,
    provenance: Provenance,
    ttlMs: number,
  ): Promise<void> {
    const wrapped: Wrapped<T> = { value, provenance }
    await this.l1.set(key, wrapped, ttlMs)
    await this.l2?.set(key, wrapped, ttlMs)
  }

  /** True when every layer is shared across instances. Drives the budget warning. */
  get isShared(): boolean {
    return this.l2 ? this.l2.isShared : this.l1.isShared
  }
}
