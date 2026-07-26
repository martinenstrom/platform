/**
 * Financial news.
 *
 * Note the policy this model serves: fixture news is never production-eligible
 * (decision D2). Plausible but fabricated headlines are the worst failure mode
 * on a financial screen — a reader can discount a stale price, but cannot
 * discount a story that never happened.
 */

import type { CanonicalSymbol } from './instruments'
import type { Provenance } from './provenance'

export interface NewsItem {
  /** Stable across refetches, so a re-render does not reorder or duplicate. */
  id: string
  headline: string
  summary: string | null
  /** `null` when the provider gives no link — the UI must then not linkify. */
  url: string | null
  /** Publication, e.g. 'Reuters'. Distinct from the API provider. */
  outlet: string
  /** ISO 8601 with offset. */
  publishedAt: string
  /** Instruments the article is tagged against; may be empty. */
  symbols: CanonicalSymbol[]
  /** -1..1. `null` when the provider gives none — never fabricated. */
  sentimentScore: number | null
  provenance: Provenance
}

export function buildNewsItem(args: {
  id: string
  headline: string
  summary?: string | null
  url?: string | null
  outlet: string
  publishedAt: string
  symbols?: CanonicalSymbol[]
  sentimentScore?: number | null
  provenance: Provenance
}): NewsItem {
  if (Number.isNaN(new Date(args.publishedAt).getTime())) {
    throw new Error(`buildNewsItem: invalid publishedAt "${args.publishedAt}"`)
  }
  const score = args.sentimentScore ?? null
  if (score !== null && (!Number.isFinite(score) || score < -1 || score > 1)) {
    throw new Error(`buildNewsItem: sentimentScore must be within -1..1, got ${score}`)
  }
  return {
    id: args.id,
    headline: args.headline,
    summary: args.summary ?? null,
    url: args.url ?? null,
    outlet: args.outlet,
    publishedAt: args.publishedAt,
    symbols: args.symbols ?? [],
    sentimentScore: score,
    provenance: args.provenance,
  }
}

/** Newest first — the order every news surface in the product wants. */
export function sortByRecency(items: NewsItem[]): NewsItem[] {
  return [...items].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  )
}
