/**
 * Disk-backed L2 — local development and single-instance deployments only.
 *
 * `isShared` is false, and that is load-bearing: `config.ts` warns when live
 * mode meets a non-shared store, because the daily budget is then counted per
 * instance. Nothing about production correctness may depend on this class
 * existing (decision D8).
 *
 * Node-only. Reached exclusively from the composition root, which itself is
 * only reachable from a `createServerFn` handler.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Clock } from '~/domain/shared/clock'
import type { CacheEntry, CacheStore } from './store'

interface DiskFile {
  entries: Record<string, CacheEntry<unknown>>
  counters: Record<string, { count: number; resetAtMs: number }>
}

const EMPTY: DiskFile = { entries: {}, counters: {} }

export class DiskCacheStore implements CacheStore {
  readonly id = 'disk' as const
  readonly isShared = false

  private readonly file: string
  private data: DiskFile

  constructor(
    directory: string,
    private readonly clock: Clock,
  ) {
    this.file = join(directory, 'marketdata.json')
    try {
      mkdirSync(directory, { recursive: true })
    } catch {
      // Directory already exists, or the filesystem is read-only. Either way
      // the load below decides whether this store is usable.
    }
    this.data = this.load()
  }

  private load(): DiskFile {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<DiskFile>
      return { entries: parsed.entries ?? {}, counters: parsed.counters ?? {} }
    } catch {
      // A missing or corrupt cache is not an error: it is a cold start.
      return { ...EMPTY }
    }
  }

  private persist(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.data), 'utf8')
    } catch {
      // A cache that cannot write is still a working cache in memory. Failing
      // the request because the disk is full would be the wrong trade.
    }
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    return (this.data.entries[key] as CacheEntry<T> | undefined) ?? null
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const now = this.clock.epochMs()
    this.data.entries[key] = { value, storedAtMs: now, expiresAtMs: now + ttlMs }
    this.persist()
  }

  async delete(key: string): Promise<void> {
    delete this.data.entries[key]
    this.persist()
  }

  async increment(key: string, by: number, resetAtMs: number): Promise<number> {
    const existing = this.data.counters[key]
    const state =
      existing && existing.resetAtMs > this.clock.epochMs()
        ? existing
        : { count: 0, resetAtMs }
    state.count += by
    this.data.counters[key] = state
    if (by !== 0) this.persist()
    return state.count
  }
}
