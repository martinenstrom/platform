/**
 * The one door to the public web: search, news search, official-source
 * search, and opening a result. The application layer plans and gathers
 * through this port and never learns what stands behind it — a search API,
 * a provider's web research, an enterprise connector — so any of them can
 * replace the current one without a line above this file changing.
 *
 * Everything that crosses this port has passed the firewall first
 * (`firewall.ts`): no client name, id, figure or record vocabulary is ever
 * part of a request.
 */

export type SearchFreshness = 'day' | 'week' | 'month' | 'any'

export interface SearchRequest {
  query: string
  freshness: SearchFreshness
  /** Restrict results to these registrable domains, where the adapter can. */
  domains?: readonly string[]
  limit?: number
  /** The language the question was asked in; the adapter answers in it where it synthesises. */
  locale?: 'sv' | 'en'
}

export interface SearchHit {
  title: string
  url: string
  snippet: string
  publisher: string | null
  publishedAt: string | null
}

export interface SearchNarrative {
  /** A provider's own synthesis over what it found; discovery, never evidence by itself. */
  text: string
  /** The spans of the narrative the provider ties to a source. */
  citations: { url: string; title: string | null; start: number; end: number }[]
}

export interface SearchResponse {
  hits: SearchHit[]
  narrative: SearchNarrative | null
  provider: string
  searchedAt: string
}

export interface RetrievedDocument {
  url: string
  title: string | null
  /** The readable text of the page, scripts and navigation stripped, bounded in length. */
  text: string
  publishedAt: string | null
  retrievedAt: string
  publisher: string | null
}

export interface PublicSearchPort {
  search(request: SearchRequest): Promise<SearchResponse>
  searchNews(request: SearchRequest): Promise<SearchResponse>
  searchOfficial(request: SearchRequest): Promise<SearchResponse>
  /** Open a source to read the fact itself, rather than trusting a snippet. */
  retrieve(url: string): Promise<RetrievedDocument>
}

export type PublicResearchFailure =
  'disabled' | 'network' | 'refused' | 'timeout' | 'unsupported'

/** Thrown by an adapter when the public web cannot be reached; the answer then rests on internal data. */
export class PublicResearchUnavailable extends Error {
  constructor(
    readonly reason: PublicResearchFailure,
    detail = '',
  ) {
    super(`public research unavailable (${reason})${detail ? `: ${detail}` : ''}`)
    this.name = 'PublicResearchUnavailable'
  }
}
