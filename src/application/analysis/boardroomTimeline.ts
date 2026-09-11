/**
 * The case as a debate: which desk said what, who objected, what blocked it.
 *
 * A projection of `CaseOverview` and nothing else. Every entry resolves back to
 * a persisted institutional object by its durable id, and the projection holds
 * no opinion about any of them.
 *
 * ## What this must never do
 *
 * It does not evaluate eligibility, infer materiality, recompute confidence,
 * decide which review is authoritative, or read organisational mandate. Those
 * answers already exist — in `overview.eligibility`, on the challenge, on the
 * claim, in the repository's own supersession, in the organisation — and a
 * second derivation would be a second answer free to disagree with the first.
 *
 * Above all it never converts an ABSENCE into a position. A revision nobody
 * challenged is not a revision everyone agreed with, and a desk that raised no
 * objection has not endorsed anything. The entries below say what happened; a
 * reader draws the conclusion.
 *
 * ## Chronology, and the part of it the record does not establish
 *
 * Institutional acts carry the instant they were recorded, and that instant is
 * the only ordering the firm actually wrote down. Where two acts share it, the
 * record does not say which came first — so this does not decide either.
 *
 * Entries are therefore grouped: a group holds one or more acts recorded at the
 * same instant, and `concurrent` says which case a group is. A presentation
 * layer can render a sequence as a sequence and a same-time group as a group,
 * and cannot accidentally draw an arrow between two acts the record never
 * ordered.
 *
 * Ordering WITHIN a group is by id, purely so two renders of one case do not
 * shuffle. It carries no meaning and must never be drawn as though it did.
 *
 * A per-kind `sequence` is not promoted into a global order. Review sequences
 * are allocated per `(case, revision, kind)`; comparing a verification's
 * sequence 1 against a risk review's sequence 1 would be comparing two
 * different countings.
 */

import type {
  ChallengeStatus,
  ClaimId,
  DevilsAdvocateReview,
  DisagreementMateriality,
  PeerExaminationReview,
} from '~/domain/analysis'
import type { CaseOverview } from './caseOverview'

/** What kind of institutional act an entry stands for. */
export type BoardroomEntryKind =
  | 'analysis-recorded'
  | 'synthesis-produced'
  | 'peer-examination'
  | 'governance-review'
  | 'cio-submission'
  | 'cio-decision'

/** Which lane an act belongs to. Analytical desks and control functions are
 * not the same kind of voice, and the surface must not blend them. */
export type BoardroomLane = 'analysis' | 'governance' | 'chief'

/** One objection, exactly as the challenge recorded it. */
export interface BoardroomObjection {
  challengeId: string
  /** The claim disputed. A real `ClaimId`, never a paraphrase. */
  contests: ClaimId
  argument: string
  /** Assigned when the objection was filed. Read, never inferred. */
  materiality: DisagreementMateriality
  /** As the organisation answered it. `open` until somebody settles it. */
  outcome: ChallengeStatus
  /** Present once settled. The record of who is accountable for settling it. */
  resolvedBy?: string
  counterEvidenceCount: number
}

export interface BoardroomEntry {
  /** The durable id of the underlying institutional object. */
  id: string
  kind: BoardroomEntryKind
  lane: BoardroomLane
  /** The instant the firm recorded it. */
  at: string
  /** The desk that performed the act. */
  byDepartmentId: string
  /** For a peer examination: whose work was read. */
  examinedDepartmentId?: string
  /** The revision an act speaks about, where it speaks about one. */
  revisionId?: string
  /** Claims the act produced, by id. */
  claimIds?: readonly ClaimId[]
  /** Objections the act filed. Empty is a finding, not an absence of one. */
  objections?: readonly BoardroomObjection[]
  /** The review this one replaced, where it replaced one. */
  supersedesReviewId?: string
  /** True when a later act of the same kind replaced this one. */
  superseded?: boolean
  /** A governance verdict, as stored. Absent where the kind carries none. */
  status?: string
}

/**
 * Acts the record places at one instant.
 *
 * `concurrent` is the whole point: `false` means the firm established that this
 * act came after the previous group, and `true` means it did not.
 */
export interface BoardroomMoment {
  at: string
  concurrent: boolean
  entries: readonly BoardroomEntry[]
}

export interface BoardroomTimeline {
  moments: readonly BoardroomMoment[]
  /** Every entry flat, in the same order, for callers that want a list. */
  entries: readonly BoardroomEntry[]
}

/** Stable within a same-time group. Rendering only; carries no chronology. */
const byId = (left: BoardroomEntry, right: BoardroomEntry) =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0

/**
 * The objections one review filed, as the review recorded them.
 *
 * Shared by the peer and the Devil's Advocate because a challenge is one
 * institutional object under either mandate. Which mandate raised it is on the
 * ENTRY, where the lane already distinguishes them — not restated per
 * objection, which would let the two drift apart.
 */
const objectionsOf = (
  review: PeerExaminationReview | DevilsAdvocateReview,
): BoardroomObjection[] =>
  review.challenges.map((challenge) => ({
    challengeId: challenge.id,
    contests: challenge.contests,
    argument: challenge.argument,
    materiality: challenge.materiality,
    outcome: review.outcomes[challenge.id] ?? 'open',
    ...(challenge.resolvedBy ? { resolvedBy: challenge.resolvedBy } : {}),
    counterEvidenceCount: challenge.counterEvidence.length,
  }))

export function boardroomTimeline(overview: CaseOverview): BoardroomTimeline {
  const entries: BoardroomEntry[] = []

  /* ------------------------------------------------- the analytical desks */

  /*
   * One entry per accepted run, not per claim. A desk's contribution is one
   * act of analysis however many claims it produced, and a claim on its own
   * has no author, department or instant to place it by.
   */
  for (const run of overview.runs) {
    /*
     * `completed` IS the persisted acceptance fact, and there is no separate
     * one to prefer. Execution finishing lands a run in `awaiting-acceptance`;
     * the run-state machine admits exactly one transition into `completed`
     * (`'awaiting-acceptance' -> ['completed', ...]`), and only
     * `acceptContribution` performs it. That command is also where claims cross
     * into `repositories.claims` — "the moment they become verifiable,
     * gateable and citable" — and `completedAt` is stamped with the instant a
     * person accepted.
     *
     * So this reads an existing institutional fact rather than defining one. A
     * model run that merely succeeded is not an adopted position, and showing
     * it would put a view on the floor the firm has not taken.
     */
    if (run.state !== 'completed') continue
    entries.push({
      id: run.id,
      kind: 'analysis-recorded',
      lane: 'analysis',
      at: run.completedAt ?? run.startedAt,
      byDepartmentId: run.departmentId,
      ...(run.revisionId ? { revisionId: run.revisionId } : {}),
      claimIds: run.claims.map((claim) => claim.id),
    })
  }

  /* --------------------------------------------------------- the synthesis */

  for (const aggregation of overview.aggregations) {
    entries.push({
      id: aggregation.id,
      kind: 'synthesis-produced',
      lane: 'analysis',
      at: aggregation.aggregatedAt,
      byDepartmentId: aggregation.departmentId,
      revisionId: aggregation.producedRevisionId,
    })
  }

  /* --------------------------------------------------- the peer examinations */

  /*
   * Supersession is read from what the reviews themselves record, not decided
   * here: a review names the one it replaces, so the replaced one is known
   * without this projection ranking them.
   */
  const supersededReviewIds = new Set(
    overview.peerExaminations
      .map((review) => review.supersedesReviewId)
      .filter((id): id is string => Boolean(id)),
  )

  for (const review of overview.peerExaminations) {
    entries.push({
      id: review.reviewId,
      kind: 'peer-examination',
      lane: 'analysis',
      at: review.at,
      byDepartmentId: review.byDepartmentId,
      examinedDepartmentId: review.examinedDepartmentId,
      ...(review.scope === 'thesis-revision' ? { revisionId: review.revisionId } : {}),
      /*
       * Every challenge the examination filed, open or settled. An examination
       * that raised none produces an EMPTY list rather than no field — the
       * difference between a desk that looked and found nothing to contest and
       * a desk that never looked is the whole reason this act is recorded.
       */
      objections: objectionsOf(review),
      ...(review.supersedesReviewId
        ? { supersedesReviewId: review.supersedesReviewId }
        : {}),
      ...(supersededReviewIds.has(review.reviewId) ? { superseded: true } : {}),
    })
  }

  /* ------------------------------------------------ the control functions */

  for (const review of overview.verification) {
    entries.push({
      id: review.reviewId,
      kind: 'governance-review',
      lane: 'governance',
      at: review.at,
      byDepartmentId: review.byDepartmentId,
      ...(review.scope === 'thesis-revision' ? { revisionId: review.revisionId } : {}),
      status: review.status,
    })
  }

  for (const review of overview.devilsAdvocate) {
    entries.push({
      id: review.reviewId,
      kind: 'governance-review',
      lane: 'governance',
      at: review.at,
      byDepartmentId: review.byDepartmentId,
      ...(review.scope === 'thesis-revision' ? { revisionId: review.revisionId } : {}),
      objections: objectionsOf(review),
    })
  }

  for (const review of overview.risk) {
    entries.push({
      id: review.reviewId,
      kind: 'governance-review',
      lane: 'governance',
      at: review.at,
      byDepartmentId: review.byDepartmentId,
      ...(review.scope === 'thesis-revision' ? { revisionId: review.revisionId } : {}),
      status: review.status,
    })
  }

  /* -------------------------------------------------------------- the CIO */

  for (const submission of overview.submissions) {
    entries.push({
      id: submission.id,
      kind: 'cio-submission',
      lane: 'chief',
      at: submission.submittedAt,
      byDepartmentId: submission.submittedByDepartmentId,
      revisionId: submission.revisionId,
    })
  }

  for (const decision of overview.decisionHistory) {
    entries.push({
      id: decision.decisionId,
      kind: 'cio-decision',
      lane: 'chief',
      at: decision.decidedAt,
      byDepartmentId: 'executive',
      status: decision.outcome.kind,
    })
  }

  /* ------------------------------------------------------ into moments */

  /*
   * Grouped by the recorded instant, and by nothing else. Two acts at one
   * instant land in one group because that is exactly what the record says
   * about them — that they share a time, and not that either preceded the
   * other.
   */
  const byInstant = new Map<string, BoardroomEntry[]>()
  for (const entry of entries) {
    const existing = byInstant.get(entry.at)
    if (existing) existing.push(entry)
    else byInstant.set(entry.at, [entry])
  }

  const moments: BoardroomMoment[] = [...byInstant.keys()]
    .sort()
    .map((at) => ({
      at,
      concurrent: byInstant.get(at)!.length > 1,
      entries: Object.freeze([...byInstant.get(at)!].sort(byId)),
    }))

  return Object.freeze({
    moments: Object.freeze(moments),
    entries: Object.freeze(moments.flatMap((moment) => [...moment.entries])),
  })
}
