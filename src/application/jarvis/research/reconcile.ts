/**
 * When reliable sources disagree, the answer says so and states the more
 * authoritative figure; it never silently picks one. And every researched
 * answer classifies its support — strong, supported, mixed, insufficient —
 * from what the evidence is, never as a percentage nobody measured.
 */

import {
  figuresIn,
  rangeIn,
  type ClaimFigure,
  type ResearchConfidence,
  type ResearchConflict,
  type ResearchEvidence,
} from './evidence'

/** Two figures for the same thing that differ by more than rounding. */
const TOLERANCE: Record<ClaimFigure['unit'], number> = {
  percent: 0.05,
  bp: 0.5,
  index: 0.5,
  other: 0.5,
}

interface Stated {
  evidenceId: string
  /** The sentence's first figure, the one the answer states. */
  value: number
  /** Every figure the sentence states in that unit — a monthly and an annual rate in one sentence are both there. */
  values: number[]
  unit: ClaimFigure['unit']
  authority: number
  publishedAt: string | null
  /** The range the sentence stated, when it stated one: "3-3/4 to 4 percent". */
  range: { low: number; high: number } | null
}

/** Two statements agree when any figure of one meets any figure of the other, or lies inside a range the other stated. */
function agree(a: Stated, b: Stated, tolerance: number): boolean {
  const inside = (value: number, range: { low: number; high: number }) =>
    value >= range.low - tolerance && value <= range.high + tolerance
  if (a.range && b.values.some((value) => inside(value, a.range!))) return true
  if (b.range && a.values.some((value) => inside(value, b.range!))) return true
  if (
    a.range &&
    b.range &&
    a.range.low <= b.range.high + tolerance &&
    b.range.low <= a.range.high + tolerance
  )
    return true
  return a.values.some((x) => b.values.some((y) => Math.abs(x - y) <= tolerance))
}

/**
 * Figures stated for the same key by different sources, where they
 * disagree: the official one preferred. A sentence that states several
 * figures — a monthly and an annual rate — agrees when any of them meets
 * the other's; a stated range agrees with any figure inside it.
 */
export function reconcile(evidence: readonly ResearchEvidence[]): ResearchConflict[] {
  const byKey = new Map<string, Stated[]>()
  for (const item of evidence) {
    for (const claim of item.claims) {
      if (!claim.figure) continue
      const list = byKey.get(claim.figure.key) ?? []
      if (list.some((entry) => entry.evidenceId === item.id)) continue
      const unit = claim.figure.unit
      const range = unit === 'percent' ? rangeIn(claim.text) : null
      const stated = figuresIn(claim.text)
        .filter((figure) => figure.unit === unit)
        .map((figure) => figure.value)
      list.push({
        evidenceId: item.id,
        value: claim.figure.value,
        values: stated.length > 0 ? stated : [claim.figure.value],
        unit,
        authority: item.authority,
        publishedAt: item.publishedAt,
        range: range ? { low: range.low, high: range.high } : null,
      })
      byKey.set(claim.figure.key, list)
    }
  }
  const conflicts: ResearchConflict[] = []
  for (const [key, values] of byKey) {
    if (values.length < 2) continue
    const tolerance = TOLERANCE[values[0]!.unit]
    const disagreement = values.some((a, i) =>
      values.some((b, j) => j > i && !agree(a, b, tolerance)),
    )
    if (!disagreement) continue
    const preferred = [...values].sort(
      (a, b) =>
        a.authority - b.authority ||
        (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''),
    )[0]!
    conflicts.push({
      key,
      values: values.map(({ evidenceId, value, unit: u }) => ({
        evidenceId,
        value,
        unit: u,
      })),
      preferredEvidenceId: preferred.evidenceId,
    })
  }
  return conflicts
}

/**
 * The support class. Strong: a fact read from an official or issuer source,
 * or two independent reputable reports agreeing. Supported: one reputable
 * or official source with a claim. Mixed: sources that disagree without an
 * official figure to settle it, or only sources the table does not rank.
 * Insufficient: nothing with a claim.
 */
export function confidenceOf(
  evidence: readonly ResearchEvidence[],
  conflicts: readonly ResearchConflict[],
): ResearchConfidence {
  const withClaims = evidence.filter((item) => item.claims.length > 0)
  if (withClaims.length === 0) return 'INSUFFICIENT'
  const unsettled = conflicts.some((conflict) => {
    const preferred = evidence.find((item) => item.id === conflict.preferredEvidenceId)
    return !preferred || preferred.authority > 2
  })
  if (unsettled) return 'MIXED'
  const retrievedPrimary = withClaims.some(
    (item) =>
      item.authority <= 2 && item.claims.some((claim) => claim.basis === 'retrieved'),
  )
  const reputable = withClaims.filter((item) => item.authority <= 4)
  if (retrievedPrimary || reputable.length >= 2) return 'STRONG_EVIDENCE'
  if (reputable.length === 1) return 'SUPPORTED'
  return 'MIXED'
}

/**
 * The latest moment the evidence speaks from: the latest publication time
 * where any source states one; only when none does, the retrieval. An
 * undated source never makes the answer look fresher than its dated ones.
 */
export function asOfOf(evidence: readonly ResearchEvidence[]): string | null {
  let published: string | null = null
  let retrieved: string | null = null
  for (const item of evidence) {
    if (item.publishedAt && (!published || item.publishedAt > published))
      published = item.publishedAt
    if (!retrieved || item.retrievedAt > retrieved) retrieved = item.retrievedAt
  }
  return published ?? retrieved
}
