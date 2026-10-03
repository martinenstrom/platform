/**
 * What public research produces: evidence with provenance, claims with
 * their basis, conflicts named rather than hidden, and a confidence class
 * that is a judgement of support, never a percentage.
 *
 * A search result is discovery. It becomes evidence only as an item here,
 * with the publisher, the time and the authority of its source, and a claim
 * is a sentence the source itself carries — retrieved from the document,
 * or cited in a provider's narrative — never a sentence nobody wrote.
 */

export type SourceType =
  /** A central bank, a statistics agency, a treasury, a regulator. */
  | 'official'
  /** The platform's own market data. */
  | 'market-data'
  /** A company's filing, release or investor-relations page. */
  | 'issuer'
  /** A government body that is not a statistics agency. */
  | 'government'
  /** Reputable financial news. */
  | 'news'
  | 'other'

/** 1 is the most authoritative; 6 an unknown site. */
export type AuthorityRank = 1 | 2 | 3 | 4 | 5 | 6

export type ClaimBasis =
  /** Read from the source document itself. */
  | 'retrieved'
  /** A search snippet or a provider's cited narrative sentence. */
  | 'snippet'
  /** The platform's own number. */
  | 'market-data'

export interface ClaimFigure {
  /** What the figure measures: `us:cpi`, `se:policy-rate`, `idx:sp500:1w`. */
  key: string
  value: number
  unit: 'percent' | 'bp' | 'index' | 'other'
}

export interface ResearchClaim {
  text: string
  basis: ClaimBasis
  figure?: ClaimFigure
}

export type Freshness = 'fresh' | 'aging' | 'stale' | 'unknown'

export interface ResearchEvidence {
  id: string
  title: string
  publisher: string
  url: string | null
  /** ISO 8601, when the source states it; null when it does not. */
  publishedAt: string | null
  retrievedAt: string
  sourceType: SourceType
  authority: AuthorityRank
  snippet: string
  claims: ResearchClaim[]
  /** Topic keys the evidence speaks to: `fed`, `us:cpi`, `company:nvidia`, `idx:sp500`. */
  relevantTo: string[]
  freshness: Freshness
}

export interface ResearchConflict {
  key: string
  values: { evidenceId: string; value: number; unit: ClaimFigure['unit'] }[]
  /** The evidence whose figure the answer states: the most authoritative. */
  preferredEvidenceId: string
}

export type ResearchConfidence =
  'STRONG_EVIDENCE' | 'SUPPORTED' | 'MIXED' | 'INSUFFICIENT'

export type ResearchUnavailableReason =
  /** No search provider is configured for this environment. */
  | 'public-research-disabled'
  /** Every public step failed: the network, the provider, a timeout. */
  | 'public-research-unavailable'

export interface PublicResearchResult {
  /** The queries that left the platform, after the firewall. */
  queries: readonly string[]
  answerable: boolean
  evidence: ResearchEvidence[]
  conflicts: ResearchConflict[]
  missingInformation: string[]
  /** The latest publication or retrieval instant among the evidence. */
  asOf: string | null
  confidence: ResearchConfidence
  unavailable: ResearchUnavailableReason | null
  /** How many public steps ran, and how many of them failed. */
  steps: { run: number; failed: number }
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** How old a publication is against the question's horizon: a day's news ages in hours, a filing in weeks. */
export function freshnessOf(
  publishedAt: string | null,
  now: Date,
  horizon: 'day' | 'week' | 'month' | 'any',
): Freshness {
  if (!publishedAt) return 'unknown'
  const age = now.getTime() - Date.parse(publishedAt)
  if (Number.isNaN(age)) return 'unknown'
  const fresh =
    horizon === 'day'
      ? 12 * HOUR_MS
      : horizon === 'week'
        ? 3 * DAY_MS
        : horizon === 'month'
          ? 14 * DAY_MS
          : 60 * DAY_MS
  if (age <= fresh) return 'fresh'
  if (age <= fresh * 3) return 'aging'
  return 'stale'
}

/** "3-3/4 to 4 percent", "3,75–4,00 procent": a range a sentence states, as its two ends. */
export function rangeIn(
  text: string,
): { low: number; high: number; unit: 'percent' } | null {
  const match =
    /(\d+(?:[.,]\d+)?(?:-\d+\/\d+)?)\s*(?:to|till|–|—|-)\s*(\d+(?:[.,]\d+)?(?:-\d+\/\d+)?)\s*(?:%|procent|percent)/iu.exec(
      text,
    )
  if (!match) return null
  const parse = (raw: string): number => {
    const fraction = /^(\d+)-(\d+)\/(\d+)$/.exec(raw)
    if (fraction) return Number(fraction[1]) + Number(fraction[2]) / Number(fraction[3])
    return Number(raw.replace(',', '.'))
  }
  const low = parse(match[1]!)
  const high = parse(match[2]!)
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) return null
  return { low, high, unit: 'percent' }
}

/** Percent and basis-point figures a sentence states, in order. */
export function figuresIn(text: string): { value: number; unit: 'percent' | 'bp' }[] {
  const figures: { value: number; unit: 'percent' | 'bp' }[] = []
  const percent = /(-?\d+(?:[.,]\d+)?)\s?(?:%|procent|percent)/giu
  const bp = /(-?\d+(?:[.,]\d+)?)\s?(?:bp|baspunkter|basis points?)/giu
  for (const match of text.matchAll(percent))
    figures.push({ value: Number(match[1]!.replace(',', '.')), unit: 'percent' })
  for (const match of text.matchAll(bp))
    figures.push({ value: Number(match[1]!.replace(',', '.')), unit: 'bp' })
  return figures
}
