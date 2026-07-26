/**
 * Instrument search as an application service.
 *
 * Thin by design: the resolution pipeline already owns caching, retry,
 * breaking and fallback, so this exists to name the category, bound the query,
 * and hand back an envelope the UI can render honestly — including when the
 * search failed, which the legacy path could only express as an empty list.
 */

import type { Envelope, InstrumentSearchResults } from '~/domain/market'

/** Ceiling on results, so a provider cannot flood the UI. */
export const MAX_SEARCH_RESULTS = 10

/**
 * Shortest query worth sending.
 *
 * One character matches nearly everything and costs a provider call per
 * keystroke. The UI debounces as well; this is the backstop.
 */
export const MIN_QUERY_LENGTH = 2

export interface SearchDataSource {
  search(query: string, limit: number): Promise<Envelope<InstrumentSearchResults>>
}

export async function searchInstruments(
  source: SearchDataSource,
  rawQuery: string,
): Promise<Envelope<InstrumentSearchResults>> {
  const query = rawQuery.trim()
  if (query.length < MIN_QUERY_LENGTH) {
    // Not an error — the user simply has not typed enough yet. `loading` is
    // wrong too, since nothing is in flight. An empty ok result is the truth.
    return {
      state: 'ok',
      data: { query, results: [], provenance: EMPTY_PROVENANCE },
      provenance: EMPTY_PROVENANCE,
    }
  }
  return source.search(query, MAX_SEARCH_RESULTS)
}

/**
 * Provenance for a result nobody produced.
 *
 * Marked `derived` rather than borrowing a provider's identity: no source was
 * consulted, and saying otherwise would be the smallest possible version of
 * exactly the dishonesty this architecture exists to prevent.
 */
const EMPTY_PROVENANCE = {
  asOf: '1970-01-01T00:00:00.000Z',
  asOfPrecision: 'second' as const,
  receivedAt: '1970-01-01T00:00:00.000Z',
  ageMs: 0,
  source: {
    providerId: 'none',
    providerName: 'No query',
    trust: 'derived' as const,
  },
  quality: 'derived' as const,
  isDelayed: false,
  delayMinutes: null,
  isProxy: false,
}
