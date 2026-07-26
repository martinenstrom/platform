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

export interface VerificationReview {
  caseId: CaseId
  byEmployeeId: EmployeeId
  byDepartmentId: DepartmentId
  at: string
  status: VerificationStatus
  findings: readonly VerificationFinding[]
  /** Claims explicitly checked, so unchecked claims are visible as unchecked. */
  claimsReviewed: readonly ClaimId[]
}

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

export interface DevilsAdvocateReview {
  caseId: CaseId
  byEmployeeId: EmployeeId
  byDepartmentId: DepartmentId
  at: string
  challenges: readonly Challenge[]
  /** Per challenge, how the organization answered it. */
  outcomes: Readonly<Record<string, ChallengeStatus>>
}

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

export interface ComplianceReview {
  caseId: CaseId
  byEmployeeId: EmployeeId
  byDepartmentId: DepartmentId
  at: string
  status: ComplianceStatus
  findings: readonly ComplianceFinding[]
}

export function complianceBlocks(review: ComplianceReview): boolean {
  return review.status !== 'approved'
}

/* ----------------------------------------------------------------------- risk */

export interface RiskReview {
  caseId: CaseId
  byEmployeeId: EmployeeId
  byDepartmentId: DepartmentId
  at: string
  status: 'accepted' | 'accepted-with-limits' | 'rejected'
  concerns: readonly string[]
  /** Position or exposure limits attached as a condition of acceptance. */
  limits?: readonly string[]
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
