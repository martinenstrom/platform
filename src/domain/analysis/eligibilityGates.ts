/**
 * Which gates a stored eligibility basis passes, and which it does not.
 *
 * `evaluateThesisEligibility` already returns **every** blocker rather than the
 * first, so the failing side was never the gap. The gap was the passing side: a
 * refusal that names only what went wrong tells a portfolio manager nothing
 * about what went right, and "verification incomplete" reads very differently
 * from "verification incomplete, everything else clear".
 *
 * So this reports **every gate the policy defines**, each as passed, failed or
 * not applicable. The verdict is unchanged — a basis is eligible when no gate
 * failed — but the explanation is now complete rather than truncated.
 *
 * ## Why the domain owns this
 *
 * Eligibility is decided in the domain and a fitness rule enforces it. The
 * *explanation* of a decision is part of the decision: if the application
 * assembled the report it would be re-deriving the verdict from the same
 * inputs, and two derivations of one rule eventually disagree — which this
 * codebase has already watched happen three times.
 *
 * ## Why the codes are stable
 *
 * `VERIFICATION_INCOMPLETE` is a **domain code**, not a message. Logs, the UI
 * and later an agent map it to whatever wording suits them, and none of them
 * couples to a sentence someone may want to rewrite. Renaming one of these is a
 * contract change, not copy-editing.
 */

import type { EligibilityPolicy } from './eligibilityPolicy'
import { disagreementBlocksEligibility } from './aggregation'
import type { BasisContent } from './basisCanonical'

/** The stable vocabulary. Codes, never user-facing strings. */
export type EligibilityGateCode =
  | 'VERIFICATION_INCOMPLETE'
  | 'CHALLENGE_UNRESOLVED'
  | 'RISK_UNRESOLVED'
  | 'REQUIRED_WORK_INCOMPLETE'
  | 'DISAGREEMENT_BLOCKING'

export const ELIGIBILITY_GATE_CODES: readonly EligibilityGateCode[] = Object.freeze([
  'VERIFICATION_INCOMPLETE',
  'CHALLENGE_UNRESOLVED',
  'RISK_UNRESOLVED',
  'REQUIRED_WORK_INCOMPLETE',
  'DISAGREEMENT_BLOCKING',
])

/**
 * `not-applicable` is not a quiet pass.
 *
 * A policy that does not require Risk, and a Risk review that passed, are
 * different facts about the firm's process, and collapsing them would let a
 * reader believe a gate ran that never did.
 */
export type GateStatus = 'passed' | 'failed' | 'not-applicable'

export interface GateOutcome {
  code: EligibilityGateCode
  status: GateStatus
  /**
   * Why, in bounded terms. Names counts and identifiers, never rationale text
   * or evidence content -- a refusal must not become a way to read the case.
   */
  detail: string
}

export interface EligibilityGateReport {
  /** True when no gate failed. Not-applicable gates do not block. */
  eligible: boolean
  policyVersion: string
  /** Every gate the policy defines, in a fixed order. */
  gates: readonly GateOutcome[]
  /** The failing subset, for a caller that only wants the refusal. */
  failed: readonly EligibilityGateCode[]
}

/**
 * Every gate, evaluated against the basis as stored.
 *
 * Takes the basis rather than raw repository reads on purpose: the basis is
 * what the submission will attest, so the report explains **the thing that gets
 * stored**. A report derived from anything else could disagree with the record
 * it accompanies.
 */
export function evaluateEligibilityGates(
  basis: BasisContent,
  /**
   * The policy in force, supplied by the caller.
   *
   * **This evaluator does not resolve its own policy.** It used to, reading the
   * version off the basis and looking it up -- which is the same shape the
   * ruling rejected elsewhere: an evaluator that can reach for a policy is an
   * evaluator that can reach for the wrong one, and it cannot be exercised
   * against a policy the registry has not yet been taught.
   *
   * The caller selects; the evaluator applies. One answer to "which policy
   * applied", and it lives with whoever chose it.
   */
  policy: EligibilityPolicy,
): EligibilityGateReport {
  if (policy.version !== basis.eligibilityPolicyVersion) {
    /*
     * The basis records which policy the submission selected. Evaluating it
     * under a different one would produce a verdict the record cannot explain,
     * so the mismatch is refused rather than silently preferred either way.
     */
    throw new Error(
      `Basis cites eligibility policy "${basis.eligibilityPolicyVersion}" but was ` +
        `evaluated under "${policy.version}".`,
    )
  }

  const gates: GateOutcome[] = []

  /* ------------------------------------------------------------ verification */
  if (policy.verification === 'outside-policy-scope') {
    gates.push({
      code: 'VERIFICATION_INCOMPLETE',
      status: 'not-applicable',
      detail: `policy ${policy.version} places verification outside its scope`,
    })
  } else if (basis.verification === null) {
    gates.push({
      code: 'VERIFICATION_INCOMPLETE',
      status: 'failed',
      detail: 'no verification review is recorded for this revision',
    })
  } else if (!policy.verificationAccepts.includes(basis.verification.status)) {
    gates.push({
      code: 'VERIFICATION_INCOMPLETE',
      status: 'failed',
      detail: `verification status "${basis.verification.status}" is not accepted by policy ${policy.version}`,
    })
  } else {
    gates.push({
      code: 'VERIFICATION_INCOMPLETE',
      status: 'passed',
      detail: `verified as "${basis.verification.status}"`,
    })
  }

  /* -------------------------------------------------------- devil's advocate */
  if (policy.devilsAdvocate === 'outside-policy-scope') {
    gates.push({
      code: 'CHALLENGE_UNRESOLVED',
      status: 'not-applicable',
      detail: `policy ${policy.version} places the devil's advocate outside its scope`,
    })
  } else if (basis.devilsAdvocate === null) {
    gates.push({
      code: 'CHALLENGE_UNRESOLVED',
      status: 'failed',
      detail: "no devil's advocate review is recorded for this revision",
    })
  } else if (basis.devilsAdvocate.openChallengeIds.length > 0) {
    gates.push({
      code: 'CHALLENGE_UNRESOLVED',
      status: 'failed',
      detail: `${basis.devilsAdvocate.openChallengeIds.length} challenge(s) remain open`,
    })
  } else {
    gates.push({
      code: 'CHALLENGE_UNRESOLVED',
      status: 'passed',
      detail: 'every challenge raised has been resolved',
    })
  }

  /* -------------------------------------------------------------------- risk */
  if (basis.riskRequirement === 'not-required') {
    gates.push({
      code: 'RISK_UNRESOLVED',
      status: 'not-applicable',
      detail: `rule ${basis.riskRuleId ?? 'unnamed'} determined risk review was not required`,
    })
  } else if (basis.riskRequirement === 'unresolved') {
    /*
     * Three-state on purpose. "Unresolved" is not "not required": nobody has
     * yet decided whether Risk must look, and treating that as a pass would let
     * an undecided question read as a cleared one.
     */
    gates.push({
      code: 'RISK_UNRESOLVED',
      status: 'failed',
      detail: 'whether risk review is required has not been resolved',
    })
  } else if (basis.risk === null) {
    gates.push({
      code: 'RISK_UNRESOLVED',
      status: 'failed',
      detail: 'risk review is required and none is recorded',
    })
  } else if (basis.risk.status === 'rejected') {
    gates.push({
      code: 'RISK_UNRESOLVED',
      status: 'failed',
      detail: 'risk rejected this revision',
    })
  } else {
    gates.push({
      code: 'RISK_UNRESOLVED',
      status: 'passed',
      detail: `risk ${basis.risk.status}`,
    })
  }

  /* ----------------------------------------------------------- required work */
  const unfinished = basis.requiredWork.filter((work) => work.runId === '')
  if (basis.requiredWork.length === 0) {
    /*
     * Zero required entries is a legitimate basis, so this is a pass rather
     * than a not-applicable: the playbook was consulted and required nothing.
     */
    gates.push({
      code: 'REQUIRED_WORK_INCOMPLETE',
      status: 'passed',
      detail: 'the playbook required no work of this revision',
    })
  } else if (unfinished.length > 0) {
    gates.push({
      code: 'REQUIRED_WORK_INCOMPLETE',
      status: 'failed',
      detail: `${unfinished.length} of ${basis.requiredWork.length} required entries have no completed run`,
    })
  } else {
    gates.push({
      code: 'REQUIRED_WORK_INCOMPLETE',
      status: 'passed',
      detail: `all ${basis.requiredWork.length} required entries completed`,
    })
  }

  /* ----------------------------------------------------------- disagreements */
  /*
   * The domain's own rule, applied with THIS policy's threshold.
   * `disagreementBlocksEligibility` is the only implementation of the
   * comparison; a second one here would be free to drift from it.
   */
  const blocking = basis.materialDisagreements.filter((entry) =>
    disagreementBlocksEligibility(entry.materiality, policy.disagreementBlocksAtOrAbove),
  )
  if (basis.materialDisagreements.length === 0) {
    gates.push({
      code: 'DISAGREEMENT_BLOCKING',
      status: 'passed',
      detail: 'no unresolved disagreement was carried into the submission',
    })
  } else if (blocking.length > 0) {
    gates.push({
      code: 'DISAGREEMENT_BLOCKING',
      status: 'failed',
      detail:
        `${blocking.length} disagreement(s) at or above ` +
        `"${policy.disagreementBlocksAtOrAbove}" remain unresolved under policy ` +
        `${policy.version}`,
    })
  } else {
    gates.push({
      code: 'DISAGREEMENT_BLOCKING',
      status: 'passed',
      detail: `${basis.materialDisagreements.length} disagreement(s) recorded, none blocking`,
    })
  }

  const failed = gates.filter((gate) => gate.status === 'failed').map((gate) => gate.code)

  return Object.freeze({
    eligible: failed.length === 0,
    policyVersion: policy.version,
    gates: Object.freeze(gates),
    failed: Object.freeze(failed),
  })
}
