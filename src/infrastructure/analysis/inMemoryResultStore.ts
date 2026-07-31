/**
 * In-memory result store.
 *
 * Exact key match only. There is deliberately no lookup that ignores part of
 * the key: no "most recent for this department", no nearest match. Every one of
 * those would eventually serve last week's reasoning against this week's
 * evidence — which reads as current analysis and says nothing about being old.
 *
 * Separate from the in-memory repository container because it is used on its
 * own: a result store is the one part of the runtime that is meaningful
 * without a case around it.
 */

import type { ResultStore, StoredResult } from '~/application/analysis/resultStore'

export function createInMemoryResultStore(): ResultStore {
  const results = new Map<string, StoredResult>()
  return {
    async get(key) {
      return results.get(key) ?? null
    },
    // Provenance is a PostgreSQL foreign key; there is no row here to point at.
    async put(result, _provenance) {
      // Write-once. The key covers every semantic input, so a differing result
      // under the same key means something is wrong; overwriting would hide it.
      const existing = results.get(result.key)
      if (existing) return existing
      results.set(result.key, result)
      return result
    },
  }
}
