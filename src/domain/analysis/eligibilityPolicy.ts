/**
 * Which gates were in force when a revision was allowed to reach the CIO.
 *
 * A decision records `eligibilityPolicyVersion`, and this is what that version
 * resolves to. Without a registry the version would be a number pointing at
 * prose — and prose is edited, so a decision taken under one set of thresholds
 * would silently be read years later under whatever the thresholds became.
 *
 * ## Why Compliance is `outside-policy-scope`
 *
 * The only honest way to record its absence. `not-required` is a **verdict**:
 * it means a control function looked at the work and decided review was
 * unnecessary. Nobody decided that — no command records a compliance review at
 * all (TD-42), and the internal CIO gate does not include one. The distinction
 * matters most to the reader who most needs it: somebody asking, after the
 * fact, whether anyone checked.
 *
 * ## Append-only
 *
 * A policy is frozen the moment a decision cites it. Changing a threshold, or
 * bringing Compliance inside the gate, is a **new version** — historical
 * decisions keep resolving against the one they recorded. The test in
 * `eligibilityPolicy.test.ts` fails if the code's thresholds drift from the
 * current policy's declared ones, so the two cannot separate quietly.
 */

import type { DisagreementMateriality } from './aggregation'
import type { VerificationStatus } from './review'

/** How a gate participates, for one policy version. */
export type GateParticipation =
  /** Must have been performed and must pass. */
  | 'required'
  /** Applies where the firm resolved that it does, per revision. */
  | 'conditional-by-resolution'
  /**
   * Not part of this gate at all.
   *
   * **Not a verdict.** No control function considered the question; the
   * question was not in scope. See the module note.
   */
  | 'outside-policy-scope'

export interface EligibilityPolicy {
  version: string
  /** Human-facing name of the gate this version describes. */
  gate: string
  verification: GateParticipation
  devilsAdvocate: GateParticipation
  risk: GateParticipation
  compliance: GateParticipation
  /** Verification statuses that do not block. */
  verificationAccepts: readonly VerificationStatus[]
  /** An unresolved Devil's Advocate challenge blocks at this level and above. */
  challengeBlocksAtOrAbove: DisagreementMateriality
  /** An unresolved aggregation disagreement blocks at this level and above. */
  disagreementBlocksAtOrAbove: DisagreementMateriality
  /** Whether an unresolved conditional requirement leaves the gate unsatisfied. */
  unresolvedConditionalBlocks: boolean
  /** The domain contract this policy was written against. */
  domainContractVersion: string
}

/**
 * Every policy the firm has ever decided under.
 *
 * Append-only. An entry is never edited: a decision that cited version 1 must
 * keep resolving to the version 1 that was in force when it was taken.
 */
const POLICIES: Readonly<Record<string, EligibilityPolicy>> = Object.freeze({
  '1': Object.freeze({
    version: '1',
    gate: 'internal CIO decision',
    verification: 'required',
    devilsAdvocate: 'required',
    risk: 'conditional-by-resolution',
    /*
     * Outside the gate, not cleared by it. C1C-4 built the internal decision
     * path and deliberately left publication out; Compliance answers "may we
     * publish this", which no decision under this policy asks.
     */
    compliance: 'outside-policy-scope',
    verificationAccepts: Object.freeze([
      'verified',
      'verified-with-qualifications',
    ]) as readonly VerificationStatus[],
    challengeBlocksAtOrAbove: 'material',
    disagreementBlocksAtOrAbove: 'decision-critical',
    unresolvedConditionalBlocks: true,
    domainContractVersion: '8',
  }),
})

/** The version a decision taken now records. */
export const CURRENT_ELIGIBILITY_POLICY_VERSION = '1'

export class UnknownEligibilityPolicyError extends Error {
  constructor(readonly version: string) {
    super(
      `No eligibility policy version "${version}". A decision citing a policy ` +
        `nobody can resolve cannot be audited — the gates it passed are unknown.`,
    )
    this.name = 'UnknownEligibilityPolicyError'
  }
}

export function eligibilityPolicy(version: string): EligibilityPolicy {
  const found = POLICIES[version]
  if (!found) throw new UnknownEligibilityPolicyError(version)
  return found
}

export function knownEligibilityPolicies(): readonly EligibilityPolicy[] {
  return Object.values(POLICIES)
}
