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
  type MissingWork,
  type ThesisEligibility,
  type ThesisLifecycleState,
} from './lifecycle'
import type { DisagreementMateriality } from './aggregation'
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

/**
 * A value, with the two things that make two numbers comparable.
 *
 * `amount` is text rather than a number on purpose. A finding reading "expected
 * 2.5 %, observed 2.50000000000000004 %" is a finding about IEEE-754, not about
 * the analysis, and a verifier who typed 2.5 must be recorded as having typed
 * 2.5.
 */
export interface FindingValue {
  amount: string
  unit?: string
  currency?: string
}

export type FindingSeverity = 'advisory' | 'material' | 'critical'

export interface VerificationFinding {
  kind: VerificationFindingKind
  claimId: ClaimId
  /** The verifier's own words. Never generated, never parsed. */
  detail: string
  /** The evidence the finding concerns, where one is identifiable. */
  evidence?: EvidenceRef
  /**
   * The content hash the claim cited, when it differs from the evidence's
   * current hash. Present only on `revised-evidence` and `stale-evidence`,
   * which is what makes "the source moved under this claim" checkable years
   * later without re-fetching anything.
   */
  citedContentHash?: string
  /** A finding that must be resolved before the case may progress. */
  blocking: boolean
  severity: FindingSeverity
  /** What the claim asserted. */
  expected?: FindingValue
  /** What the verifier measured. */
  observed?: FindingValue
  /** How the verifier arrived at `observed`. */
  methodology?: string
  /** What must happen before this stops blocking. Required when `blocking`. */
  correctionRequired?: string
}

/**
 * A blocking finding must say what would clear it.
 *
 * Otherwise "correction required" names a state with no exit: the desk is told
 * its work is wrong and not what would make it right, and the only way forward
 * is to ask the verifier — off the record.
 */
export function buildVerificationFinding(
  finding: VerificationFinding,
): VerificationFinding {
  if (finding.blocking && !finding.correctionRequired?.trim()) {
    throw new Error(
      `Finding "${finding.kind}" on claim "${finding.claimId}" blocks the case ` +
        `without stating what would clear it. A blocker with no exit is a ` +
        `stall the record cannot explain.`,
    )
  }
  const hashBearing =
    finding.kind === 'revised-evidence' || finding.kind === 'stale-evidence'
  if (hashBearing && !finding.citedContentHash) {
    throw new Error(
      `Finding "${finding.kind}" on claim "${finding.claimId}" reports that the ` +
        `evidence moved but does not record the hash the claim cited. Without ` +
        `it the finding cannot be checked once the source has moved again.`,
    )
  }
  return Object.freeze({ ...finding })
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

/**
 * Where this verdict sits among the reviews of one revision by one discipline.
 *
 * Monotonic from 1, allocated inside the transaction that writes the review.
 * Timestamps are not a sufficient ordering key: two verdicts on one revision by
 * one discipline at one instant is exactly what a retry storm produces, and
 * `at` alone leaves their order to `localeCompare` on equal strings.
 */
export interface ReviewOrder {
  sequence: number
  /** The review this one replaces, when it is a re-review. */
  supersedesReviewId?: string
  /** Required when a re-review changes the institutional verdict. */
  reason?: string
}

/** The identity the store assigns. Derived from the command, never supplied. */
export interface ReviewRecordId {
  reviewId: string
}

export type VerificationReview = ReviewScope &
  ReviewAttribution &
  ReviewRecordId &
  ReviewOrder &
  VerificationVerdict

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
  /**
   * How much the objection decides, on the scale the manager's aggregation
   * already uses.
   *
   * Reused rather than redefined: a Devil's Advocate objection and a manager's
   * unresolved disagreement are both "the firm does not agree with itself, this
   * much". Two scales would mean the CIO reading two words for one idea. The
   * BLOCKING THRESHOLDS differ — see `challengeBlocks` — and that difference is
   * deliberate and named.
   */
  materiality: DisagreementMateriality
  /** Who or what settled it. Required once the outcome is not `open`. */
  resolvedBy?: string
}

/**
 * The two kinds that may argue without counter-evidence, and their price.
 *
 * A fragile assumption and an overconfident conclusion are objections to
 * REASONING, and demanding a counter-source for them would mean the Devil's
 * Advocate could not say "this rests on something nobody established". So they
 * are permitted — but they must state what would settle them, which is the
 * mechanical difference between an objection and a mood.
 */
const REASONING_CHALLENGE_KINDS: readonly Challenge['kind'][] = [
  'fragile-assumption',
  'overconfidence',
] as const

export function buildChallenge(challenge: Challenge): Challenge {
  const reasoningOnly = REASONING_CHALLENGE_KINDS.includes(challenge.kind)
  if (challenge.counterEvidence.length === 0 && !reasoningOnly) {
    throw new Error(
      `Challenge "${challenge.id}" cites no counter-evidence. The Devil's ` +
        `Advocate argues from evidence; disagreement alone is not a finding.`,
    )
  }
  if (challenge.counterEvidence.length === 0 && !challenge.wouldBeResolvedBy?.trim()) {
    throw new Error(
      `Challenge "${challenge.id}" is a "${challenge.kind}" objection with no ` +
        `counter-evidence and no statement of what would resolve it. An ` +
        `objection nothing could settle is not a finding the firm can act on.`,
    )
  }
  if (!challenge.argument.trim()) {
    throw new Error(`Challenge "${challenge.id}" states no argument`)
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

export type DevilsAdvocateReview = ReviewScope &
  ReviewAttribution &
  ReviewRecordId &
  ReviewOrder &
  DevilsAdvocateVerdict

export function unresolvedChallenges(review: DevilsAdvocateReview): Challenge[] {
  return review.challenges.filter((c) => (review.outcomes[c.id] ?? 'open') === 'open')
}

/**
 * Whether an unresolved challenge stops the revision reaching the CIO.
 *
 * `material` and above, which is a LOWER threshold than
 * `disagreementBlocksEligibility` applies to an aggregation disagreement. The
 * asymmetry is deliberate and is the reason these are two named functions
 * rather than one shared predicate: a formal objection filed by the control
 * function whose entire mandate is to attack the argument is a stronger
 * institutional signal than a manager recording that two desks did not agree.
 *
 * A non-material open challenge does not block, does not disappear, and is read
 * by the CIO alongside the thesis.
 */
export function challengeBlocks(materiality: DisagreementMateriality): boolean {
  return materiality !== 'non-material'
}

/** Open challenges at or above the blocking threshold. */
export function blockingChallenges(review: DevilsAdvocateReview): Challenge[] {
  return unresolvedChallenges(review).filter((c) => challengeBlocks(c.materiality))
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

export type ComplianceReview = ReviewScope &
  ReviewAttribution &
  ReviewRecordId &
  ReviewOrder &
  ComplianceVerdict

export function complianceBlocks(review: ComplianceReview): boolean {
  return review.status !== 'approved'
}

/* ----------------------------------------------------------------------- risk */

/**
 * What a Risk verdict is allowed to be about.
 *
 * Bounded, because `concerns: string[]` made "what did Risk actually object
 * to" a reading exercise. Risk speaks about the portfolio consequences of being
 * wrong; it never speaks about whether the thesis is right, which is
 * Verification's question and the Devil's Advocate's.
 */
export type RiskFindingKind =
  | 'allocation'
  | 'position-sizing'
  | 'concentration'
  | 'leverage'
  | 'liquidity'
  | 'currency-exposure'
  | 'correlation'
  | 'downside'
  | 'tail-risk'
  | 'implementation-constraint'

export interface RiskFinding {
  kind: RiskFindingKind
  /** The risk officer's own words. */
  detail: string
  severity: FindingSeverity
  /** The implication this concerns, where one is identifiable. */
  implication?: string
  /** What would have to change for the concern to fall away. */
  mitigatedBy?: string
}

export type RiskStatus = 'accepted' | 'accepted-with-limits' | 'rejected'

export interface RiskVerdict {
  status: RiskStatus
  findings: readonly RiskFinding[]
  /** Position or exposure limits attached as a condition of acceptance. */
  limits?: readonly string[]
}

export type RiskReview = ReviewScope &
  ReviewAttribution &
  ReviewRecordId &
  ReviewOrder &
  RiskVerdict

export function buildRiskVerdict<T extends RiskVerdict>(verdict: T): T {
  if (verdict.status === 'accepted-with-limits' && (verdict.limits ?? []).length === 0) {
    throw new Error(
      `A risk verdict of "accepted-with-limits" states no limits. The limits ARE ` +
        `the condition of acceptance; without them the verdict is an unqualified ` +
        `acceptance wearing a qualified name.`,
    )
  }
  if (verdict.status === 'rejected' && verdict.findings.length === 0) {
    throw new Error(
      `A risk verdict of "rejected" records no finding. A refusal nobody can ` +
        `read is a refusal nobody can answer.`,
    )
  }
  return Object.freeze({ ...verdict })
}

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

/**
 * Whether Risk applies to this exact revision, as the firm recorded it.
 *
 * Three states, and the third is not a soft "no". `unresolved` means nobody has
 * decided, and the gate treats that as unsatisfied — an approving Risk verdict
 * cannot rescue it, because an approval of a review nobody established was
 * needed is not evidence that the question was asked.
 *
 * Neither direction may be inferred: not `required` because a Risk review
 * happens to exist, and not `not-required` because none does. Both are
 * conclusions drawn from an absence, and both are how a governance gate gets
 * skipped by accident.
 */
export type RiskRequirementState = 'unresolved' | 'not-required' | 'required'

export interface GovernanceGate {
  verification?: VerificationReview
  devilsAdvocate?: DevilsAdvocateReview
  compliance?: ComplianceReview
  risk?: RiskReview
  /**
   * Supplied by the application layer from the stored `RequirementResolution`
   * for this exact revision. Defaults to `unresolved`, which blocks — the safe
   * direction, and the one that makes forgetting to supply it visible.
   */
  riskRequirement?: RiskRequirementState
  /** The conditional entry Risk is declared under, for the blocker to name. */
  riskEntryKey?: string
}

export interface GateResult {
  passed: boolean
  /** Every reason the case cannot progress, so all are fixed in one pass. */
  blockers: readonly Blocker[]
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
  const blockers: Blocker[] = []

  /* ------------------------------------------------------- verification */

  if (!gate.verification) {
    blockers.push({ kind: 'verification-missing', severity: 'blocks-decision' })
  } else if (verificationBlocks(gate.verification)) {
    blockers.push({
      kind: 'verification-correction-required',
      reviewId: gate.verification.reviewId,
      status: gate.verification.status,
      blockingClaimIds: Object.freeze([
        ...new Set(
          gate.verification.findings.filter((f) => f.blocking).map((f) => f.claimId),
        ),
      ]),
      owningDepartmentId: gate.verification.byDepartmentId,
      severity: 'blocks-decision',
    })
  }

  if (gate.verification) {
    for (const finding of gate.verification.findings) {
      if (finding.kind === 'unresolved-citation' && finding.blocking) {
        blockers.push({
          kind: 'unresolved-citation',
          reviewId: gate.verification.reviewId,
          claimId: finding.claimId,
          severity: 'blocks-decision',
        })
      }
    }
  }

  /* ---------------------------------------------------- devil's advocate */

  if (gate.devilsAdvocate) {
    for (const challenge of blockingChallenges(gate.devilsAdvocate)) {
      blockers.push({
        kind: 'unresolved-material-challenge',
        reviewId: gate.devilsAdvocate.reviewId,
        challengeId: challenge.id,
        contests: challenge.contests,
        materiality: challenge.materiality,
        owningDepartmentId: gate.devilsAdvocate.byDepartmentId,
        severity: 'blocks-decision',
      })
    }
  }

  /* -------------------------------------------------------------- risk */

  /*
   * The requirement is read first and the verdict second, because the verdict
   * is only meaningful once the firm has said the question applies. Reading
   * them the other way round is precisely how a Risk approval comes to
   * establish its own mandate.
   */
  const requirement = gate.riskRequirement ?? 'unresolved'
  const riskEntryKey = gate.riskEntryKey ?? 'risk-review'

  if (requirement === 'unresolved') {
    blockers.push({
      kind: 'risk-requirement-unresolved',
      playbookEntryKey: riskEntryKey,
      severity: 'blocks-decision',
    })
  } else if (requirement === 'required') {
    if (!gate.risk) {
      blockers.push({
        kind: 'risk-review-missing',
        playbookEntryKey: riskEntryKey,
        severity: 'blocks-decision',
      })
    } else if (riskBlocks(gate.risk)) {
      blockers.push({
        kind: 'risk-review-rejected',
        reviewId: gate.risk.reviewId,
        owningDepartmentId: gate.risk.byDepartmentId,
        severity: 'blocks-decision',
      })
    }
  } else if (gate.risk) {
    // `not-required`, and a verdict exists anyway. Not a pass: the Risk desk
    // would be creating its own mandate. Cleared by resolving to `required`.
    blockers.push({
      kind: 'risk-review-not-expected',
      reviewId: gate.risk.reviewId,
      owningDepartmentId: gate.risk.byDepartmentId,
      severity: 'blocks-decision',
    })
  }

  /* -------------------------------------------------------- compliance */

  if (gate.compliance && complianceBlocks(gate.compliance)) {
    /*
     * `blocks-decision`, which preserves the behaviour this replaced.
     *
     * Arguably wrong — compliance answers "may we publish this", which is
     * `eligibleForPublication` — but nothing records a compliance review yet,
     * so changing the severity here would be a silent governance change with
     * no test that could observe it. Tracked as TD-42 for the publication
     * phase, which is the first one that can decide it with evidence.
     */
    blockers.push({
      kind: 'compliance-block',
      reviewId: gate.compliance.reviewId,
      status: gate.compliance.status,
      owningDepartmentId: gate.compliance.byDepartmentId,
      severity: 'blocks-decision',
    })
  }

  const decisive = blockers.filter((b) => b.severity === 'blocks-decision')
  return { passed: decisive.length === 0, blockers: Object.freeze(blockers) }
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
  revisions: ReadonlyArray<{
    thesisId: ThesisId
    revisionId: RevisionId
    /** Read from the stored resolution for this exact revision. */
    riskRequirement?: RiskRequirementState
    riskEntryKey?: string
  }>,
  caseId: CaseId,
  reviews: CaseReviews,
): RevisionGateResult[] {
  return revisions.map((revision) => {
    const result = evaluateGate({
      verification: latestApplicable(reviews.verification, caseId, revision.revisionId),
      devilsAdvocate: latestApplicable(
        reviews.devilsAdvocate,
        caseId,
        revision.revisionId,
      ),
      compliance: latestApplicable(reviews.compliance, caseId, revision.revisionId),
      risk: latestApplicable(reviews.risk, caseId, revision.revisionId),
      riskRequirement: revision.riskRequirement,
      riskEntryKey: revision.riskEntryKey,
    })
    return { thesisId: revision.thesisId, revisionId: revision.revisionId, ...result }
  })
}

/**
 * The authoritative review of one kind for one revision.
 *
 * Ordered by `sequence`, which is allocated per `(case, revision, kind)` inside
 * the transaction that writes the review. `at` is the tiebreak and then
 * `reviewId`, so the answer is total even for records written before sequences
 * existed — but `at` alone was the whole ordering, and two verdicts on one
 * revision by one discipline at one instant is exactly what a retry storm
 * produces.
 *
 * Exported because the eligibility adapter reports which reviews it read, and
 * "the latest one" has to mean the same thing there as it does here.
 */
export function latestApplicable<
  T extends ReviewScope & ReviewAttribution & ReviewRecordId & ReviewOrder,
>(all: readonly T[] | undefined, caseId: CaseId, revisionId: RevisionId): T | undefined {
  const matching = (all ?? []).filter((review) =>
    reviewApplies(review, { caseId, revisionId }),
  )
  if (matching.length === 0) return undefined
  return [...matching]
    .sort(
      (a, b) =>
        a.sequence - b.sequence ||
        a.at.localeCompare(b.at) ||
        a.reviewId.localeCompare(b.reviewId),
    )
    .at(-1)
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
export interface RevisionEligibilityInput {
  thesisId: ThesisId
  revisionId: RevisionId
  lifecycle: ThesisLifecycleState
  /** Whether Risk applies to this exact revision, as the firm recorded it. */
  riskRequirement?: RiskRequirementState
  riskEntryKey?: string
  /** Required playbook contributions for this revision that have not landed. */
  missingRequiredContributions?: readonly MissingWork[]
  /** Claims the manager retained as decision-critical unresolved disagreement. */
  blockingDisagreements?: readonly ClaimId[]
  /** Blockers the application layer derived from evidence and provenance. */
  additionalBlockers?: readonly Blocker[]
}

export function evaluateRevisionEligibility(
  revisions: readonly RevisionEligibilityInput[],
  caseId: CaseId,
  reviews: CaseReviews,
): ThesisEligibility[] {
  const gates = evaluateRevisionGates(revisions, caseId, reviews)

  return revisions.map((revision, index) => {
    const gate = gates[index]!
    return evaluateThesisEligibility(revision.thesisId, revision.revisionId, {
      lifecycle: revision.lifecycle,
      blockers: [...gate.blockers, ...(revision.additionalBlockers ?? [])],
      missingRequiredContributions: revision.missingRequiredContributions ?? [],
      blockingDisagreements: revision.blockingDisagreements ?? [],
    })
  })
}

/*
 * `governanceBlockers` and `blockerKindFor` are gone.
 *
 * `evaluateGate` used to compose a sentence per blocker and `blockerKindFor`
 * recovered the category by matching prefixes of those sentences — prose used
 * as a data channel. Renaming a message silently reclassified a blocker, and
 * nothing failed, because the round trip was never checked against anything.
 * `evaluateGate` returns `Blocker[]` directly now, so there is nothing to
 * parse and no way for the two to disagree.
 */
