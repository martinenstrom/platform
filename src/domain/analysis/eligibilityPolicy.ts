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
import type { ChallengerKind, VerificationStatus } from './review'

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
  /**
   * Whether a qualified analytical peer must have examined the revision.
   *
   * Distinct from `devilsAdvocate` and never a substitute for it. The Devil's
   * Advocate attacks the reasoning under a standing obligation to object; a
   * peer brings a second competent reading of the SUBJECT. A firm whose only
   * dissent comes from the desk paid to dissent has never been disagreed with.
   */
  peerScrutiny: GateParticipation
  risk: GateParticipation
  compliance: GateParticipation
  /** Verification statuses that do not block. */
  verificationAccepts: readonly VerificationStatus[]
  /**
   * Whose unresolved challenges `CHALLENGE_UNRESOLVED` weighs.
   *
   * Separate from `devilsAdvocate` and `peerScrutiny`, which say whether a
   * REVIEW OF THAT KIND must exist. This says whose OBJECTIONS count once they
   * do. A peer examining does not excuse a missing Devil's Advocate review, and
   * a Devil's Advocate review does not make a peer's open objection disappear.
   *
   * Declared per version rather than decided in the evaluator, for the same
   * reason `challengeBlocksAtOrAbove` is: the gate applies the firm's rule and
   * is never the place the rule is chosen. It is also what keeps version 1
   * replay honest — a v1 basis is evaluated against `['devils-advocate']`
   * because that is what version 1 declares, not because the code has been
   * taught to recognise old records.
   *
   * A challenge is ONE institutional object whichever mandate raised it. This
   * is a filter over provenance, never a second gate.
   */
  challengeMandates: readonly ChallengerKind[]
  /** An unresolved mandated challenge blocks at this level and above. */
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
    /*
     * Outside the gate because the firm had no second analytical desk when
     * this policy was in force — `rates` did not exist and `global-macro` held
     * the rates handle, so there was nobody who COULD examine a macro
     * conclusion as a peer.
     *
     * Stating it explicitly is not an edit to version 1. `outside-policy-scope`
     * is precisely "the question was not in scope", which is what was true;
     * making the field optional instead would let a future policy omit the
     * question by accident rather than by decision.
     */
    peerScrutiny: 'outside-policy-scope',
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
    /*
     * The Devil's Advocate alone, which is what version 1 has always meant.
     *
     * Stated explicitly rather than left implicit in the absence of any other
     * challenger. When peer scrutiny arrived, an unqualified evaluator would
     * have started weighing peer objections against decisions taken under this
     * policy — convicting the record of failing a test that did not exist. The
     * declaration is what makes that impossible rather than merely unintended.
     */
    challengeMandates: Object.freeze(['devils-advocate']) as readonly ChallengerKind[],
    challengeBlocksAtOrAbove: 'material',
    disagreementBlocksAtOrAbove: 'decision-critical',
    unresolvedConditionalBlocks: true,
    domainContractVersion: '8',
  }),

  /**
   * Version 2: peer scrutiny enters the gate.
   *
   * A NEW VERSION rather than an edit to 1, and the difference is the whole
   * point of the registry. Decisions already taken were taken by a firm that
   * had one analytical desk capable of speaking about rates; re-reading them
   * under a rule requiring a second desk would convict the record of failing a
   * test that did not exist. They keep resolving to version 1.
   *
   * Everything else is unchanged from version 1 — deliberately. This version
   * adds one requirement and adjusts no threshold, so a difference in outcome
   * between the two is attributable to peer scrutiny and to nothing else.
   */
  '2': Object.freeze({
    version: '2',
    gate: 'internal CIO decision',
    verification: 'required',
    devilsAdvocate: 'required',
    /*
     * Required, now that the firm has a second analytical desk. Migration 0035
     * seated Rates with a mandate that deliberately overlaps Global Macro's,
     * which is what makes a peer's disagreement substantive rather than
     * procedural.
     *
     * `required` means an examination must have been RECORDED — not that a
     * peer must have agreed, and not that one must have objected. A desk that
     * read the argument and raised nothing satisfies this gate; so does one
     * that objected and had its objection resolved. Silence does not.
     */
    peerScrutiny: 'required',
    risk: 'conditional-by-resolution',
    compliance: 'outside-policy-scope',
    verificationAccepts: Object.freeze([
      'verified',
      'verified-with-qualifications',
    ]) as readonly VerificationStatus[],
    /*
     * Both mandates, under ONE gate and one threshold.
     *
     * A peer's unresolved objection blocks exactly as the Devil's Advocate's
     * does, because it is the same institutional object — a formal objection to
     * a claim, filed on the record, with a materiality and a statement of what
     * would settle it. Only its provenance differs, and provenance is carried
     * on the challenge rather than expressed by putting it in a different gate.
     *
     * The alternative — a second `PEER_CHALLENGE_UNRESOLVED` code — would ask
     * the CIO to reconcile two answers to one question, and would let the two
     * thresholds drift apart the first time either was tuned.
     */
    challengeMandates: Object.freeze([
      'devils-advocate',
      'peer',
    ]) as readonly ChallengerKind[],
    challengeBlocksAtOrAbove: 'material',
    disagreementBlocksAtOrAbove: 'decision-critical',
    unresolvedConditionalBlocks: true,
    domainContractVersion: '8',
  }),
})

/** The version a decision taken now records. */
export const CURRENT_ELIGIBILITY_POLICY_VERSION = '2'

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
