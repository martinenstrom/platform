/**
 * Research is cached by what kind of source answered, not by one clock: a
 * central-bank statement holds for hours, a news search for minutes, a
 * filing for a day. A question that says "idag", "nu", "i morse" is
 * freshness-critical and never reads an entry older than a quarter of an
 * hour, whatever the source class allows — a market explanation from 08:30
 * can be stale after a 14:30 release.
 *
 * Process-local, like the market-data cache it sits beside; nothing here
 * is persisted.
 */

import type { SearchResponse, RetrievedDocument } from './publicSearch'

export type SourceClass =
  'official' | 'issuer' | 'news' | 'search' | 'calendar' | 'document'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/** How long an answer from each class may serve; measured against the brief's examples, not guessed finer. */
export const CACHE_TTL_MS: Record<SourceClass, number> = {
  official: 6 * HOUR,
  issuer: 24 * HOUR,
  news: 15 * MINUTE,
  search: 10 * MINUTE,
  calendar: 6 * HOUR,
  document: 6 * HOUR,
}

/** The ceiling for a freshness-critical question. */
export const FRESHNESS_CRITICAL_TTL_MS = 15 * MINUTE

type Cached = SearchResponse | RetrievedDocument

interface Entry {
  value: Cached
  storedAt: number
  ttlMs: number
}

export interface ResearchCache {
  get<T extends Cached>(
    key: string,
    options: { now: number; freshnessCritical: boolean },
  ): T | null
  set(key: string, sourceClass: SourceClass, value: Cached, now: number): void
  /** Drop every entry of a class, e.g. when a newer release appears in its feed. */
  invalidate(sourceClass: SourceClass): void
  size(): number
}

export function cacheKey(
  sourceClass: SourceClass,
  query: string,
  domains: readonly string[] = [],
): string {
  const normalised = query.trim().toLowerCase().replace(/\s+/g, ' ')
  return `${sourceClass}|${[...domains].sort().join(',')}|${normalised}`
}

export function createResearchCache(): ResearchCache {
  const entries = new Map<string, Entry & { sourceClass: SourceClass }>()
  return {
    get(key, { now, freshnessCritical }) {
      const entry = entries.get(key)
      if (!entry) return null
      const age = now - entry.storedAt
      const ttl = freshnessCritical
        ? Math.min(entry.ttlMs, FRESHNESS_CRITICAL_TTL_MS)
        : entry.ttlMs
      if (age > ttl) {
        entries.delete(key)
        return null
      }
      return entry.value as never
    },
    set(key, sourceClass, value, now) {
      entries.set(key, {
        value,
        storedAt: now,
        ttlMs: CACHE_TTL_MS[sourceClass],
        sourceClass,
      })
    },
    invalidate(sourceClass) {
      for (const [key, entry] of entries)
        if (entry.sourceClass === sourceClass) entries.delete(key)
    },
    size() {
      return entries.size
    },
  }
}
