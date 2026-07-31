/**
 * Governance: verification, challenge, compliance, approval, publication.
 *
 * Four independent control functions, each a real department with its own
 * queue, and each able to stop work. They check different things and are not
 * interchangeable:
 *
 *   Verification    is it factually and numerically correct?
 *   Devil's Advocate is the reasoning sound, and what would disprove it?
 *   Compliance      may we publish this, in this language, with these
 *                   disclosures?
 *   Risk            what does this do to the portfolio if it is wrong?
 *
 * The distinction that matters most: **Verification is not Compliance.** A
 * perfectly compliant report can contain a wrong number, and a correct report
 * can be unpublishable. Collapsing them would mean one of the two checks never
 * happens.
 */

import type { ClaimId } from './claims'
import type { CaseId } from './cases'
import type { DepartmentId, EmployeeId } from './organization'
import type { EvidenceRef } from './identity'
import {
  evaluateThesisEligibility,
  type Blocker,
  type BlockerKind,
  type ThesisEligibility,
  type ThesisLifecycleState,
} from './lifecycle'
import type { RevisionId, ThesisId } from './theses'

/**
 * What a review is ABOUT.
 *
 * A case-wide review answers "is this body of work sound" — publication
 * compliance on the language of the whole report, an operational review, a
 * risk view of the combined recommendation. A thesis-revision review answers
 * "is THIS argument sound", and with competing theses that is the only useful
 * question: Buy and Sell have opposite downsides, so a single risk verdict per
 * case says nothing about either.
 *
 * ## Why a discriminated union and not an optional `revisionId`
 *
 * The earlier model carried an optional `thesisId` and nothing else, which
 * scoped a review to a LINEAGE. That is the flaw this replaced: revision 1 is
 * verified, revision 2 supersedes it, and "verification approved thesis-1"
 * silently reads as approval of an argument the verifier never saw. An
 * optional `revisionId` would have made that failure rarer without making it
 * impossible.
 *
 * A union makes the illegal states unrepresentable rather than merely
 * discouraged:
 *
 *   - a thesis-revision review without a revision does not typecheck
 *   - a case-wide review has no `thesisId` or `revisionId` FIELD to carry, so
 *     it cannot hold a hidden one
 *   - narrowing on `scope` is the only way to read `revisionId`, so no call
 *     site can forget which it is looking at
 *
 * `caseId` is on both arms, so `review.caseId` is always available and only
 * the revision-scoped fields require narrowing.
 */
export type ReviewScope =
  | {
      scope: 'case'
      caseId: CaseId
      /*
       * Declared as `never` rather than omitted. TypeScript's excess-property
       * check accepts a property that exists on ANY arm of the target union,
       * so simply leaving these out would still let a case-wide literal carry
       * `revisionId: 'r-1'` — present but unreachable, and therefore invisible
       * to every reader while sitting in the database.
       */
      thesisId?: never
      revisionId?: never
    }
  | {
      scope: 'thesis-revision'
      caseId: CaseId
      /** The lineage. Kept alongside the revision so ownership is checkable. */
      thesisId: ThesisId
      /** The exact immutable revision reviewed. Never the lineage's latest. */
      revisionId: RevisionId
    }

export type RevisionScopedReview = Extract<ReviewScope, { scope: 'thesis-revision' }>

/** Who performed the review, and when. Common to all four control functions. */
export interface ReviewAttribution {
  byEmployeeId: EmployeeId
  byDepartmentId: DepartmentId
  at: string
}

export function isRevisionScoped<T extends ReviewScope>(
  review: T,
): review is T & RevisionScopedReview {
  return review.scope === 'thesis-revision'
}

/**
 * Whether a review speaks to a specific revision.
 *
 * The rule that makes the whole model work: a case-wide review applies to
 * every revision of its case, and a revision-scoped review applies to exactly
 * one. **A review of revision n never applies to revision n+1** — not by
 * fallback, not by "most recent", not by lineage. A superseding revision
 * starts with no inherited approval, and `evaluateGate` treats missing
 * verification as a blocker, so the new revision must be verified on its own
 * before it can reach the CIO.
 */
export function reviewApplies(
  review: ReviewScope,
  target: { caseId: CaseId; revisionId: RevisionId },
): boolean {
  if (review.caseId !== target.caseId) return false
  if (review.scope === 'case') return true
  return review.revisionId === target.revisionId
}

/**
 * The natural key a replayed submission must collide on.
 *
 * Includes the full scope, so a retry cannot find a review of a different
 * revision and treat it as this one's. Both adapters compute it from here, and
 * the `reviews_natural_key_unique` index mirrors it, so the in-memory store
 * and PostgreSQL dedupe identically rather than approximately.
 */
export function reviewIdentity(
  kind: 'verification' | 'devils-advocate' | 'compliance' | 'risk',
  review: ReviewScope & ReviewAttribution,
): string {
  const revisionId = isRevisionScoped(review) ? review.revisionId : ''
  const thesisId = isRevisionScoped(review) ? review.thesisId : ''
  return [
    kind,
    review.caseId,
    thesisId,
    revisionId,
    review.byDepartmentId,
    review.byEmployeeId,
    review.at,
  ].join('|')
}

/* ------------------------------------------------------------- verification */

/**
 * What the Fact Checker found on one claim.
 *
 * The list is what it verifies, and each entry is a distinct way a number can
 * be wrong. `unit-mismatch` and `basis-point-confusion` are separate because
 * they are separate mistakes: percent versus percentage point is a unit error,
 * while 0.25 % versus 25 bp is a scale error, and each has bitten real
 * institutions.
 */
export type VerificationFindingKind =
  | 'value-mismatch'
  | 'unit-mismatch'
  | 'currency-mismatch'
  | 'basis-point-confusion'
  | 'percentage-point-confusion'
  | 'calculation-error'
  | 'unresolved-citation'
  | 'revised-evidence'
  | 'stale-evidence'
  | 'fixture-evidence'
  | 'methodology-incompatible'
  | 'assumption-unstated'
  | 'conclusion-exceeds-evidence'
  | 'meaning-altered-in-summary'
  | 'source-unreachable'

export interface VerificationFinding {
  kind: VerificationFindingKind
  claimId: ClaimId
  detail: string
  /** The evidence the finding concerns, where one is identifiable. */
  evidence?: EvidenceRef
  /** A finding that must be resolved before the case may progress. */
  blocking: boolean
}

export type VerificationStatus =
  | 'verified'
  | 'verified-with-qualifications'
  | 'correction-required'
  | 'unresolved-discrepancy'
  | 'insufficient-evidence'
  | 'blocked'

/** The verdict, separate from where it applies. */
export interface VerificationVerdict {
  status: VerificationStatus
  findings: readonly VerificationFinding[]
  /** Claims explicitly checked, so unchecked claims are visible as unchecked. */
  claimsReviewed: readonly ClaimId[]
}

export type VerificationReview = ReviewScope & ReviewAttribution & VerificationVerdict

/** Statuses that stop a case reaching the CIO. */
const VERIFICATION_BLOCKING: readonly VerificationStatus[] = [
  'correction-required',
  'unresolved-discrepancy',
  'insufficient-evidence',
  'blocked',
] as const

export function verificationBlocks(review: VerificationReview): boolean {
  return (
    VERIFICATION_BLOCKING.includes(review.status) ||
    review.findings.some((f) => f.blocking)
  )
}

/* --------------------------------------------------------- devil's advocate */

/**
 * A structured objection.
 *
 * Note `counterEvidence`: the Devil's Advocate must argue from evidence like
 * anyone else. An objection with nothing behind it is theatre, and
 * `buildChallenge` refuses it — which is what keeps the role from degrading
 * into reflexive disagreement.
 */
export interface Challenge {
  id: string
  /** The claim being contested. */
  contests: ClaimId
  /**
   * The thesis being contested, where the objection is to the whole argument
   * rather than to one of its claims.
   *
   * The Devil's Advocate may also PROPOSE a competing thesis rather than
   * challenge an existing one; that is an `InvestmentThesis` with the Devil's
   * Advocate as proposer, not a `Challenge`.
   */
  contestsThesis?: ThesisId
  kind:
    | 'alternative-explanation'
    | 'fragile-assumption'
    | 'contradicting-evidence'
    | 'confirmation-bias'
    | 'groupthink'
    | 'overconfidence'
    | 'adverse-scenario'
    | 'correlation-not-causation'
  argument: string
  counterEvidence: readonly EvidenceRef[]
  /** What would have to be true for the original claim to survive. */
  wouldBeResolvedBy?: string
}

export function buildChallenge(challenge: Challenge): Challenge {
  const evidenceLess =
    challenge.counterEvidence.length === 0 &&
    challenge.kind !== 'fragile-assumption' &&
    challenge.kind !== 'overconfidence'
  if (evidenceLess) {
    throw new Error(
      `Challenge "${challenge.id}" cites no counter-evidence. The Devil's ` +
        `Advocate argues from evidence; disagreement alone is not a finding.`,
    )
  }
  return Object.freeze({
    ...challenge,
    counterEvidence: Object.freeze([...challenge.counterEvidence]),
  })
}

export type ChallengeStatus = 'open' | 'accepted' | 'rejected' | 'resolved'

/**
 * A challenge belongs to the revision its review is scoped to.
 *
 * So an objection raised against revision 1 stays attached to revision 1 when
 * revision 2 arrives. It neither blocks nor approves the new argument; if the
 * objection still stands, it is raised again as new review work against the
 * new revision, explicitly and visibly, rather than silently carried over.
 */
export interface DevilsAdvocateVerdict {
  challenges: readonly Challenge[]
  /** Per challenge, how the organization answered it. */
  outcomes: Readonly<Record<string, ChallengeStatus>>
}

export type DevilsAdvocateReview = ReviewScope & ReviewAttribution & DevilsAdvocateVerdict

export function unresolvedChallenges(review: DevilsAdvocateReview): Challenge[] {
  return review.challenges.filter((c) => (review.outcomes[c.id] ?? 'open') === 'open')
}

/* ----------------------------------------------------------------- compliance */

export type ComplianceStatus = 'approved' | 'changes-required' | 'rejected'

export interface ComplianceFinding {
  rule: string
  detail: string
  claimId?: ClaimId
}

export interface ComplianceVerdict {
  status: ComplianceStatus
  findings: readonly ComplianceFinding[]
}

export type ComplianceReview = ReviewScope & ReviewAttribution & ComplianceVerdict

export function complianceBlocks(review: ComplianceReview): boolean {
  return review.status !== 'approved'
}

/* ----------------------------------------------------------------------- risk */

export interface RiskVerdict {
  status: 'accepted' | 'accepted-with-limits' | 'rejected'
  concerns: readonly string[]
  /** Position or exposure limits attached as a condition of acceptance. */
  limits?: readonly string[]
}

export type RiskReview = ReviewScope & ReviewAttribution & RiskVerdict

export function riskBlocks(review: RiskReview): boolean {
  return review.status === 'rejected'
}

/* ------------------------------------------------------- approval & escalation */

/** A manager passing a case upward. Not a correctness check. */
export interface ManagerApproval {
  caseId: CaseId
  byEmployeeId: EmployeeId
  byDepartmentId: DepartmentId
  at: string
  /** What the manager judged most important. The CIO reads this, not everything. */
  summary: string
  /** Disagreements the manager could not resolve. Escalated, never hidden. */
  unresolvedDisagreements: readonly string[]
}

export interface Escalation {
  caseId: CaseId
  at: string
  fromDepartmentId: DepartmentId
  toEmployeeId: EmployeeId
  reason: string
  severity: 'informational' | 'attention' | 'urgent'
}

export type PublicationState =
  'draft' | 'in-review' | 'blocked' | 'approved' | 'published' | 'withdrawn'

/* ---------------------------------------------------------------- gate check */

export interface GovernanceGate {
  verification?: VerificationReview
  devilsAdvocate?: DevilsAdvocateReview
  compliance?: ComplianceReview
  risk?: RiskReview
}

export interface GateResult {
  passed: boolean
  /** Every reason the case cannot progress, so all are fixed in one pass. */
  blockers: readonly string[]
}

/** One gate verdict per REVISION, plus the case-wide reviews that apply to all. */
export interface RevisionGateResult extends GateResult {
  thesisId: ThesisId
  revisionId: RevisionId
}

/**
 * Whether a case may reach the CIO.
 *
 * Verification is REQUIRED — its absence is a blocker, not a pass. "Nothing
 * reaches the CIO before the Fact Checker has approved it" only holds if a
 * missing review counts as a failure, otherwise skipping the check is the way
 * through it.
 */
export function evaluateGate(gate: GovernanceGate): GateResult {
  const blockers: string[] = []

  if (!gate.verification) {
    blockers.push('verification has not been performed')
  } else if (verificationBlocks(gate.verification)) {
    blockers.push(`verification: ${gate.verification.status}`)
  }

  if (gate.devilsAdvocate) {
    const open = unresolvedChallenges(gate.devilsAdvocate)
    if (open.length > 0) {
      blockers.push(`${open.length} unresolved challenge(s)`)
    }
  }
  if (gate.compliance && complianceBlocks(gate.compliance)) {
    blockers.push(`compliance: ${gate.compliance.status}`)
  }
  if (gate.risk && riskBlocks(gate.risk)) {
    blockers.push('risk rejected the case')
  }

  return { passed: blockers.length === 0, blockers: Object.freeze(blockers) }
}

export interface CaseReviews {
  verification?: readonly VerificationReview[]
  devilsAdvocate?: readonly DevilsAdvocateReview[]
  compliance?: readonly ComplianceReview[]
  risk?: readonly RiskReview[]
}

/**
 * Evaluates the gate for each REVISION separately.
 *
 * Two reasons it is per revision rather than per thesis. Competing positions:
 * Buy may clear while Sell is blocked, and one verdict per case would either
 * hide a blocked argument or suppress a sound one. And revisions: an argument
 * that has been revised is a different argument, so the verdicts on its
 * predecessor say nothing about it.
 *
 * A revision-scoped review is matched EXACTLY. There is deliberately no
 * fallback to the lineage and no "most recent review wins" — those are the
 * two ways a stale approval reattaches itself to work nobody reviewed. A
 * case-wide review applies to every revision, which is what makes publication
 * compliance on the whole report expressible.
 *
 * Where several reviews of one kind apply, the LATEST is authoritative: a
 * control function that re-reviews has changed its mind, and the record keeps
 * both while the gate reads the current one.
 */
export function evaluateRevisionGates(
  revisions: ReadonlyArray<{ thesisId: ThesisId; revisionId: RevisionId }>,
  caseId: CaseId,
  reviews: CaseReviews,
): RevisionGateResult[] {
  const applicable = <T extends ReviewScope & ReviewAttribution>(
    all: readonly T[] | undefined,
    revisionId: RevisionId,
  ): T | undefined => {
    const matching = (all ?? []).filter((review) =>
      reviewApplies(review, { caseId, revisionId }),
    )
    if (matching.length === 0) return undefined
    return [...matching].sort((a, b) => a.at.localeCompare(b.at)).at(-1)
  }

  return revisions.map(({ thesisId, revisionId }) => {
    const result = evaluateGate({
      verification: applicable(reviews.verification, revisionId),
      devilsAdvocate: applicable(reviews.devilsAdvocate, revisionId),
      compliance: applicable(reviews.compliance, revisionId),
      risk: applicable(reviews.risk, revisionId),
    })
    return { thesisId, revisionId, ...result }
  })
}

/**
 * Gate plus lifecycle, in one call, per revision.
 *
 * Exists so that nothing assembles `ThesisGateInputs` by hand. Hand-assembly
 * is precisely where a lineage-scoped match creeps back in: a caller with a
 * list of reviews and a list of theses will reach for `find(r => r.thesisId
 * === t)`, and the resulting eligibility looks entirely plausible.
 *
 * A `CaseDecision` is refused for any revision this reports as ineligible, so
 * a revision whose only reviews belong to its predecessor cannot be decided —
 * `evaluateGate` counts missing verification as a blocker, and a superseding
 * revision inherits none.
 */
export function evaluateRevisionEligibility(
  revisions: ReadonlyArray<{
    thesisId: ThesisId
    revisionId: RevisionId
    lifecycle: ThesisLifecycleState
    /** Required playbook contributions for this revision that have not landed. */
    missingRequiredContributions?: readonly string[]
    /** Claims the manager retained as decision-critical unresolved disagreement. */
    blockingDisagreements?: readonly string[]
  }>,
  caseId: CaseId,
  reviews: CaseReviews,
): ThesisEligibility[] {
  const gates = evaluateRevisionGates(revisions, caseId, reviews)

  return revisions.map((revision, index) => {
    const gate = gates[index]!
    return evaluateThesisEligibility(revision.thesisId, revision.revisionId, {
      lifecycle: revision.lifecycle,
      blockers: governanceBlockers(gate),
      missingRequiredContributions: revision.missingRequiredContributions ?? [],
      blockingDisagreements: revision.blockingDisagreements ?? [],
    })
  })
}

/**
 * Turns the gate verdicts into the blockers eligibility is computed from.
 *
 * Exists so no call site derives blockers from reviews by hand — which is
 * exactly where a lineage-scoped match would creep back in. The application
 * layer supplies contribution state; governance comes from here.
 */
export function governanceBlockers(gate: GateResult): Blocker[] {
  return gate.blockers.map((detail) => ({
    kind: blockerKindFor(detail),
    detail,
    severity: 'blocks-decision' as const,
  }))
}

function blockerKindFor(detail: string): BlockerKind {
  if (detail.startsWith('verification has not been performed')) {
    return 'verification-missing'
  }
  if (detail.startsWith('verification:')) return 'verification-correction-required'
  if (detail.includes('unresolved challenge')) return 'unresolved-challenge'
  if (detail.startsWith('compliance:')) return 'compliance-block'
  return 'risk-rejected'
}
