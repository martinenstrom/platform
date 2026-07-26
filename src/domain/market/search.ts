/**
 * Instrument search — discovery, not identity.
 *
 * A search result is a CANDIDATE the user is choosing between. It is
 * deliberately NOT an `InstrumentRef`, which is the reviewed catalog entry
 * behind a tracked instrument, and the distinction is the same one Phase 5
 * settled: searching "Atlas Copco A" returns Atlas Copco B first, so a fuzzy
 * match may never bind a canonical symbol.
 *
 * The type enforces that. A result carries the PROVIDER's own identifier, not
 * a `CanonicalSymbol`, so nothing downstream can accidentally treat a search
 * hit as a tracked instrument. Promoting one to the catalog is a deliberate,
 * reviewed act — `AVANZA_INSTRUMENTS` with an ISIN — and cannot happen by
 * assignment.
 */

import type { Provenance } from '~/domain/shared/provenance'

/**
 * What the PROVIDER says this candidate is.
 *
 * Distinct from the catalog's `InstrumentKind`, which is our own domain
 * classification of a reviewed instrument. A search hit has not been reviewed,
 * so its kind is the provider's claim, not ours.
 */
export type SearchResultKind =
  'stock' | 'fund' | 'etf' | 'index' | 'certificate' | 'warrant' | 'future' | 'unknown'

export interface InstrumentSearchResult {
  /**
   * The provider's own id, namespaced by provider — `avanza:5269`.
   *
   * Not a `CanonicalSymbol`, on purpose. A search hit has not been reviewed,
   * and the branded type is what stops it being used as though it had.
   */
  providerRef: string
  displayName: string
  ticker: string | null
  kind: SearchResultKind
  /** ISO 10383 MIC where the provider states one. */
  venue: string | null
  countryCode: string | null
  currency: string | null
  /**
   * True when this candidate is already a tracked instrument, so the UI can
   * show it differently. Resolved against the catalog, never assumed.
   */
  isTracked: boolean
}

export interface InstrumentSearchResults {
  query: string
  results: InstrumentSearchResult[]
  provenance: Provenance
}
