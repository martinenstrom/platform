/**
 * The institutional decision record.
 *
 * What the organization chose, what it declined, why, and what remained
 * unresolved when it decided. The losing arguments are part of the record — an
 * institution that forgets which theses it rejected cannot later discover that
 * a rejected one was right.
 *
 * This is an **analytical** record. It states a position; it does not place a
 * trade, size a position or instruct execution.
 *
 * ## The outcome is a union, not a nullable field
 *
 * `selectedRevisionId: RevisionId | null` was ambiguous in the way that matters
 * most: null meant "the CIO declined all of them", "the CIO chose to wait", and
 * "somebody forgot to fill this in", and the record could not tell them apart.
 * Three different acts with three different follow-ups — a decline closes the
 * question, a deferral opens a watch, a missing field is a bug.
 *
 * ## What is deliberately NOT here
 *
 * **Rejected revisions.** A revision a governance gate stopped never reached
 * the CIO, so it was never an alternative anybody weighed. Listing it on the
 * decision would say it was considered. Its state is already complete in its
 * own lifecycle, its reviews and its blockers, and a reader asking "what else
 * was in play" is better served by the case than by a field on the decision
 * that means something different from every other field beside it.
 *
 * **A governance snapshot.** Every verdict is reachable through the submissions
 * the decision references, by review id rather than by bare status — which is
 * strictly more, because a status without its review cannot be traced to its
 * findings. The previous snapshot also carried a compliance field that had to
 * be invented, since no compliance review exists. See `eligibilityPolicy.ts`.
 */

import type { CaseId } from './cases'
import type { ClaimId } from './claims'
import type { RevisionId } from './theses'
import type { ActorSnapshot } from './authority'
import type { EmployeeId } from './organization'
import type { EvidenceRef } from './identity'
import type { DisagreementMateriality } from './aggregation'
import type { Blocker } from './lifecycle'
import type {
  DevilsAdvocateReview,
  RiskRequirementState,
  RiskStatus,
  VerificationStatus,
} from './review'

/* ----------------------------------------------------------------- outcome */

/**
 * What the CIO actually did.
 *
 * `consideredRevisionIds` is on every arm and always holds everything formally
 * in front of the CIO — including the selected one. `notSelected` is derived as
 * considered minus selected rather than stored, because two lists that must
 * agree eventually do not.
 *
 * A return is not here. `ReturnFromCioReview` records that the material was not
 * ready to be decided at all, which is a different statement from deciding to
 * wait, and it creates no decision.
 */
export type CioDecisionOutcome =
  /** A position the firm now holds, on one exact revision. */
  | {
      kind: 'selected'
      selectedRevisionId: RevisionId
      consideredRevisionIds: readonly RevisionId[]
    }
  /**
   * Decision-ready, and the CIO chose to wait.
   *
   * An act in its own right, which is why it is a decision rather than a
   * return: the material was sound and waiting was the answer. The conditions
   * that should end the wait are required — a deferral with no reconsideration
   * condition is an indefinite silence wearing a decision's clothes.
   */
  | {
      kind: 'deferred'
      consideredRevisionIds: readonly RevisionId[]
      selectedRevisionId?: never
    }
  /** Every presented alternative rejected. The question is closed, not paused. */
  | {
      kind: 'declined'
      declinedRevisionIds: readonly RevisionId[]
      consideredRevisionIds: readonly RevisionId[]
      selectedRevisionId?: never
    }

export const CIO_DECISION_KINDS: readonly CioDecisionOutcome['kind'][] = [
  'selected',
  'deferred',
  'declined',
] as const

/** How one revision stood in one decision. Mirrors the stored relation. */
export type DecisionRelation = 'selected' | 'not-selected' | 'declined' | 'considered'

/**
 * The relation each considered revision holds, derived from the outcome.
 *
 * One place, so the stored rows and the domain cannot disagree about what
 * "not-selected" means.
 */
export function relationsOf(
  outcome: CioDecisionOutcome,
): ReadonlyArray<{ revisionId: RevisionId; relation: DecisionRelation }> {
  if (outcome.kind === 'selected') {
    return outcome.consideredRevisionIds.map((revisionId) => ({
      revisionId,
      relation:
        revisionId === outcome.selectedRevisionId
          ? ('selected' as const)
          : ('not-selected' as const),
    }))
  }
  if (outcome.kind === 'declined') {
    return outcome.consideredRevisionIds.map((revisionId) => ({
      revisionId,
      relation: 'declined' as const,
    }))
  }
  return outcome.consideredRevisionIds.map((revisionId) => ({
    revisionId,
    relation: 'considered' as const,
  }))
}

/* ----------------------------------------------------------------- dissent */

export type DissentSource =
  | 'opposing-claim'
  | 'devils-advocate-challenge'
  | 'manager-disagreement'
  | 'governance-qualification'

/**
 * An objection that did not stop the decision, recorded so it cannot vanish.
 *
 * The failure this prevents is quiet and common: an objection below the
 * blocking threshold is, by construction, one nobody had to act on — so unless
 * the record carries it to the decision, "it did not block" becomes "nobody saw
 * it" within a week. `acknowledgement` is the field that matters: the CIO
 * saying, in writing, why they decided anyway.
 */
export interface DisclosedDissent {
  source: DissentSource
  /** The record it came from: a challenge id, a claim id, a review id. */
  sourceId: string
  /** The exact revision it was raised against. Never a lineage. */
  revisionId: RevisionId
  claimId?: ClaimId
  materiality: DisagreementMateriality
  raisedByEmployeeId?: EmployeeId
  raisedByDepartmentId?: string
  /** The objection, in the words of whoever raised it. */
  rationale: string
  evidence?: readonly EvidenceRef[]
  whyNotBlocking: 'below-threshold' | 'resolved-before-decision' | 'accepted-as-risk'
  /** Required where materiality is `material` or above. */
  acknowledgement?: string
  dispositionAtDecision: 'acknowledged' | 'accepted-as-risk' | 'to-be-monitored'
}

/**
 * Whether a disclosed objection needs the CIO to say something about it.
 *
 * Material and above. Asking for prose on every non-material objection would
 * produce prose nobody reads and devalue the acknowledgements that matter — the
 * same reason a re-review only owes a reason when it changes the verdict.
 */
export function dissentRequiresAcknowledgement(
  materiality: DisagreementMateriality,
): boolean {
  return materiality !== 'non-material'
}

/* ---------------------------------------------------- reconsideration */

export type TriggerConditionType =
  | 'quantitative-threshold'
  | 'date-or-event'
  | 'evidence-revised'
  | 'policy-change'
  | 'fundamental-change'
  | 'valuation-condition'
  | 'risk-condition'
  | 'dissent-validated'

export type TriggerComparator = 'above' | 'below' | 'crosses' | 'changes' | 'restated'

export interface TriggerSubject {
  kind: 'series' | 'instrument' | 'claim' | 'evidence' | 'policy-rate' | 'date' | 'thesis'
  ref: string
}

/**
 * What would make the firm look at this again.
 *
 * Structured so a later capability can evaluate it. **Nothing evaluates it in
 * C1D** — recording a condition and watching for one are different
 * capabilities, and the second needs a scheduler this runtime does not have.
 *
 * There is no `active` column. A trigger is active when it belongs to the live
 * decision, which is derived; a stored flag would be a lifecycle no command
 * owns. A superseding decision mints its own set, and the historical ones stay
 * readable on the decision they belonged to.
 */
export interface ReconsiderationTrigger {
  /** Derived from the command that recorded it. Stable within its decision. */
  id: string
  conditionType: TriggerConditionType
  subject: TriggerSubject
  comparator?: TriggerComparator
  threshold?: { amount: string; unit: string; currency?: string }
  /**
   * For conditions no comparator captures — "the ECB abandons forward
   * guidance". Permitted because refusing it would push real conditions into
   * the rationale, where nothing could ever find them.
   */
  qualitativeCondition?: string
  /** Where the answer would come from when somebody checks. */
  expectedSource?: string
  rationale: string
  createdByEmployeeId: EmployeeId
  createdAt: string
  /** Each trigger carries its own. Never taken from a sibling. */
  policyVersion: string
}

/** The trigger schema in force. Bumped when the shape or its meaning changes. */
export const RECONSIDERATION_POLICY_VERSION = '1'

export function buildReconsiderationTrigger(
  trigger: ReconsiderationTrigger,
): ReconsiderationTrigger {
  if (!trigger.rationale.trim()) {
    throw new Error(
      `Reconsideration trigger "${trigger.id}" states no rationale. A condition ` +
        `nobody explained is one nobody can decide is still relevant.`,
    )
  }
  if (!trigger.policyVersion.trim()) {
    throw new Error(`Reconsideration trigger "${trigger.id}" names no policy version`)
  }

  const quantitative = trigger.conditionType === 'quantitative-threshold'
  const qualitative = Boolean(trigger.qualitativeCondition?.trim())

  if (!trigger.comparator && !qualitative) {
    throw new Error(
      `Reconsideration trigger "${trigger.id}" carries neither a comparator nor ` +
        `a stated condition. Nothing could ever determine whether it fired.`,
    )
  }

  /*
   * "Inflation above 3" is not a condition anybody can evaluate: three percent,
   * three index points, three basis points. A quantitative trigger without a
   * unit reads as precise and is not.
   */
  if (quantitative) {
    if (!trigger.comparator) {
      throw new Error(
        `Quantitative trigger "${trigger.id}" states no comparator. A threshold ` +
          `with nothing to compare it to cannot fire.`,
      )
    }
    if (!trigger.threshold) {
      throw new Error(`Quantitative trigger "${trigger.id}" states no threshold`)
    }
    if (!trigger.threshold.unit.trim()) {
      throw new Error(
        `Quantitative trigger "${trigger.id}" states a threshold of ` +
          `"${trigger.threshold.amount}" with no unit. Three percent, three ` +
          `index points and three basis points are different conditions.`,
      )
    }
  }

  if (trigger.comparator && trigger.comparator !== 'changes' && !trigger.threshold) {
    throw new Error(
      `Reconsideration trigger "${trigger.id}" compares ` +
        `"${trigger.comparator}" against nothing.`,
    )
  }

  return Object.freeze({ ...trigger })
}

/* -------------------------------------------------------- eligibility basis */

/**
 * Why a revision was eligible, at the moment the firm acted on it.
 *
 * **An audit explanation, not a source of truth.** Eligibility stays derived by
 * `evaluateRevisionEligibility` on every read; this is a photograph of what
 * that function said and what it read. If the authoritative state changes
 * afterwards — a new review, a superseding revision — the photograph stays
 * correct about what was known then, which is the whole point.
 *
 * It lives on the **submission** and nowhere else. Copying it onto the decision
 * would be fifteen columns of second source of truth bought for read
 * convenience, which is what a join is for.
 *
 * Never `eligible: true` on its own. `blockers` is carried **as an empty array**
 * rather than omitted, for the same reason `not-required` is an explicit Risk
 * resolution: an audit reader should not infer a conclusion from an absence.
 */
export interface EligibilityBasis {
  revisionId: RevisionId
  thesisId: string
  /** The managerial synthesis the revision came from. */
  aggregationId: string | null
  /** Resolves through `eligibilityPolicy()` to the gates that were in force. */
  eligibilityPolicyVersion: string
  blockers: readonly Blocker[]

  verification: { reviewId: string; sequence: number; status: VerificationStatus } | null
  devilsAdvocate: {
    reviewId: string
    sequence: number
    openChallengeIds: readonly string[]
  } | null
  risk: { reviewId: string; sequence: number; status: RiskStatus } | null
  riskRequirement: RiskRequirementState
  riskRuleId: string | null
  riskRuleVersion: string | null

  requiredWork: ReadonlyArray<{ playbookEntryKey: string; runId: string }>
  materialDisagreements: ReadonlyArray<{
    claimId: ClaimId
    materiality: DisagreementMateriality
  }>

  evidenceSetIds: readonly string[]
  storageProvenanceId: string
  /**
   * When the projection ran — **not** when the revision became eligible.
   *
   * Nothing observes that transition, so the instant it logically changed is
   * unknown. A field implying otherwise would be the most plausible wrong
   * number in the record.
   */
  evaluatedAt: string
}

/* -------------------------------------------------------- submission */

/**
 * A revision put in front of the CIO.
 *
 * Separate from the decision because they are separate acts. Submission says
 * the work is ready to be decided; nothing about it decides anything, and there
 * is no field on it that could.
 */
export interface CioSubmission {
  /** Derived from the command. */
  id: string
  caseId: CaseId
  thesisId: string
  /** The exact revision. Never a lineage. */
  revisionId: RevisionId
  submittedByDepartmentId: string
  submittedByEmployeeId: EmployeeId
  submittedAt: string
  caseVersion: number
  state: 'pending' | 'decided' | 'returned'
  basis: EligibilityBasis
}

/* ------------------------------------------------------------ return */

export interface ReturnConcern {
  concernKind: string
  subjectKind:
    'review' | 'finding' | 'challenge' | 'claim' | 'revision' | 'aggregation' | 'evidence'
  subjectId: string
  detail: string
}

/**
 * The CIO sending work back, rather than deciding it.
 *
 * Distinct from a deferred decision, and the distinction is the point. A
 * deferral means the material was decision-ready and the CIO chose to wait; a
 * return means it was not ready to be decided at all.
 *
 * **It creates no assignment and carries no addressed flag.** Whether a return
 * has been answered is derived — a later qualifying submission for that
 * revision answers it — because a stored flag would be a lifecycle no command
 * owns. TD-43 is the capability that turns a return into assigned work with a
 * department, a due state and an expected revision; until then the headquarters
 * must render this as awaiting human action, never as work in progress.
 */
export interface CioReturn {
  id: string
  submissionId: string
  caseId: CaseId
  revisionId: RevisionId
  returnedAt: string
  /** The CIO as the organization described them then. */
  returnedBy: ActorSnapshot
  /** Why the ledger allowed it, carried alongside the snapshot. */
  authorizationBasis: string
  returnedFor:
    | 'insufficient-evidence'
    | 'unaddressed-dissent'
    | 'scope-too-narrow'
    | 'alternative-not-considered'
    | 'timing'
    | 'aggregation-incomplete'
  reason: string
  caseVersion: number
  concerns: readonly ReturnConcern[]
}

/* ---------------------------------------------------------------- decision */

export interface CaseDecision {
  /** Derived from the command. A case may hold several over its life. */
  decisionId: string
  caseId: CaseId
  /** The case version this was decided against. Pins the decision in time. */
  aggregateVersion: number
  decidedAt: string
  decidedByEmployeeId: EmployeeId
  /** The CIO as the organization described them then — not a join. */
  decidedBy: ActorSnapshot
  authorizationBasis: string

  /** What the CIO did. Never inferred from a nullable field. */
  outcome: CioDecisionOutcome
  /**
   * One submission per considered revision.
   *
   * The eligibility basis lives on each of them, which is how the record can
   * answer whether the ALTERNATIVES were eligible when they were passed over —
   * the audit question that a single submission could not reach.
   */
  submissionIds: readonly string[]

  /** The evidence the decision was made against. */
  evidenceSetId: string
  rationale: string
  /** Objections acknowledged and decided against. Never dropped. */
  unresolvedDissent: readonly DisclosedDissent[]
  reconsiderationTriggers: readonly ReconsiderationTrigger[]

  /**
   * The decision this one replaces.
   *
   * A committed decision is immutable. Correcting one, or reconsidering it
   * later, appends a decision naming its predecessor — so the record grows and
   * never loses what the firm believed at the time.
   */
  supersedesDecisionId?: string
}

/** Every revision a decision speaks about. */
export function revisionsInDecision(decision: CaseDecision): readonly RevisionId[] {
  return decision.outcome.consideredRevisionIds
}

/** Everything a decision needs to be checked against. */
export interface DecisionContext {
  /** Eligibility for every revision that was in play. */
  eligibility: ReadonlyArray<{
    revisionId: RevisionId
    lifecycle: string
    eligibleForDecision: boolean
    /**
     * Structurally typed on `kind` alone, so this stays readable against
     * `ThesisEligibility` without importing the whole blocker union.
     */
    blockedBy: ReadonlyArray<{ kind: string }>
  }>
  /**
   * The submissions the decision references, by the revision each targets.
   *
   * Supplied rather than looked up: the domain checks that every considered
   * revision has one, and the application layer is what knows how to read them.
   */
  submissionsByRevision?: ReadonlyMap<RevisionId, { id: string; caseId: CaseId }>
  devilsAdvocate?: DevilsAdvocateReview
}

/**
 * Builds a decision, refusing every case the review named.
 *
 * The refusals are the point. A decision record whose selected thesis was
 * superseded, unverified or blocked is worse than no record, because it looks
 * like due process was followed.
 */
export function buildDecision(
  decision: CaseDecision,
  context: DecisionContext,
): CaseDecision {
  if (!decision.rationale.trim()) {
    throw new Error(`Decision on "${decision.caseId}" records no rationale`)
  }
  if (!decision.evidenceSetId) {
    throw new Error(
      `Decision on "${decision.caseId}" cites no evidence set — a decision ` +
        `whose evidence cannot be located cannot be reviewed`,
    )
  }

  const outcome = decision.outcome
  const considered = outcome.consideredRevisionIds

  if (considered.length === 0) {
    throw new Error(
      `Decision on "${decision.caseId}" considers nothing. Every decision is ` +
        `about an argument somebody put in front of the CIO.`,
    )
  }
  if (new Set(considered).size !== considered.length) {
    throw new Error(
      `Decision on "${decision.caseId}" names a revision twice among those ` +
        `considered.`,
    )
  }

  if (outcome.kind === 'selected') {
    if (!considered.includes(outcome.selectedRevisionId)) {
      throw new Error(
        `Decision on "${decision.caseId}" selects ` +
          `"${outcome.selectedRevisionId}", which is not among the revisions it ` +
          `considered.`,
      )
    }
    const selected = context.eligibility.find(
      (e) => e.revisionId === outcome.selectedRevisionId,
    )
    if (!selected) {
      throw new Error(
        `Decision on "${decision.caseId}" selects a revision that was not in play`,
      )
    }
    if (selected.lifecycle === 'superseded') {
      throw new Error(
        `Revision "${selected.revisionId}" was superseded and cannot be selected. ` +
          `Select the current revision of that thesis.`,
      )
    }
    if (!selected.eligibleForDecision) {
      const reasons = selected.blockedBy.map((b) => b.kind).join(', ')
      throw new Error(
        `Revision "${selected.revisionId}" is not eligible for decision` +
          (reasons ? `: ${reasons}` : ' — it has not been verified'),
      )
    }
  }

  if (outcome.kind === 'deferred' && decision.reconsiderationTriggers.length === 0) {
    throw new Error(
      `Decision on "${decision.caseId}" defers and records no condition that ` +
        `would end the wait. An indefinite deferral is not a decision.`,
    )
  }

  if (outcome.kind === 'declined') {
    const declined = new Set(outcome.declinedRevisionIds)
    const unaccounted = considered.filter((revisionId) => !declined.has(revisionId))
    if (unaccounted.length > 0 || declined.size !== considered.length) {
      throw new Error(
        `Decision on "${decision.caseId}" declines ${declined.size} of ` +
          `${considered.length} considered revisions. A revision that was ` +
          `considered and neither selected nor declined is an alternative the ` +
          `record cannot account for.`,
      )
    }
  }

  /*
   * Every considered revision was formally submitted, and every submission
   * belongs to this case. Without this the decision could name an alternative
   * nobody ever established was eligible — the audit question a single
   * submission per decision could not reach.
   */
  if (context.submissionsByRevision) {
    for (const revisionId of considered) {
      const submission = context.submissionsByRevision.get(revisionId)
      if (!submission) {
        throw new Error(
          `Revision "${revisionId}" is recorded as considered by the CIO and has ` +
            `no submission. An alternative nobody submitted is one nobody ` +
            `established was eligible.`,
        )
      }
      if (submission.caseId !== decision.caseId) {
        throw new Error(
          `Submission "${submission.id}" belongs to case "${submission.caseId}", ` +
            `not "${decision.caseId}".`,
        )
      }
    }
    if (decision.submissionIds.length !== considered.length) {
      throw new Error(
        `Decision on "${decision.caseId}" references ` +
          `${decision.submissionIds.length} submission(s) for ` +
          `${considered.length} considered revision(s). Each revision is ` +
          `considered on the basis of exactly one submission.`,
      )
    }
  }

  for (const dissent of decision.unresolvedDissent) {
    if (!dissent.rationale.trim()) {
      throw new Error(`Dissent "${dissent.sourceId}" records no rationale`)
    }
    if (
      dissentRequiresAcknowledgement(dissent.materiality) &&
      !dissent.acknowledgement?.trim()
    ) {
      throw new Error(
        `Dissent "${dissent.sourceId}" is ${dissent.materiality} and the decision ` +
          `does not acknowledge it. Deciding past a material objection is ` +
          `legitimate; doing so without saying why is not.`,
      )
    }
  }

  return Object.freeze({
    ...decision,
    outcome: Object.freeze({
      ...outcome,
      consideredRevisionIds: Object.freeze([...considered]),
    }) as CioDecisionOutcome,
    submissionIds: Object.freeze([...decision.submissionIds]),
    unresolvedDissent: Object.freeze([...decision.unresolvedDissent]),
    reconsiderationTriggers: Object.freeze([...decision.reconsiderationTriggers]),
  })
}
