/**
 * What makes a submission, a return and a decision well-formed.
 *
 * These rules already existed inside `buildDecision` and
 * `buildReconsiderationTrigger`, reachable only by constructing the thing. That
 * was enough while commands were the only writer. It stops being enough the
 * moment a repository can be handed an aggregate somebody assembled by hand —
 * and it must stop being enough in two places at once, because the in-memory
 * store and PostgreSQL have to refuse the same aggregate for the same reason.
 *
 * The alternative was writing the rules again in each adapter. That is how a
 * governance rule acquires a second opinion: the copies agree on the day they
 * are written and diverge on the day one of them is fixed.
 *
 * ## Pure, by construction
 *
 * Deterministic, side-effect free, no clock, no repository, no SQL, no
 * presentation. A validator returns problems rather than throwing, so a caller
 * that wants all of them gets all of them, and `assert*` is the thin wrapper
 * for callers that want the first.
 *
 * ## What is deliberately NOT here
 *
 * Anything needing state the aggregate does not carry. Whether the selected
 * revision was superseded, whether a submission belongs to this case, whether
 * the decision being superseded exists — those are checks against a store, they
 * live in `buildDecision`'s context or in the repositories, and a validator
 * that pretended to make them would be reading `undefined` and passing.
 */

import { verifyBasisManifest } from './basisManifest'
import { DISAGREEMENT_MATERIALITIES } from './aggregation'
import {
  dissentRequiresAcknowledgement,
  type CaseDecision,
  type CioReturn,
  type CioSubmission,
  type ReconsiderationTrigger,
} from './decisions'

/**
 * One thing wrong, named by a stable code.
 *
 * The code is what a test and a repository error carry; `detail` is for the
 * human reading the failure. Asserting on codes rather than on sentences keeps
 * the tests from breaking when the wording improves.
 */
export interface AggregateProblem {
  code: string
  detail: string
}

const problem = (code: string, detail: string): AggregateProblem => ({ code, detail })

const blank = (value: string | undefined | null): boolean => !value || !value.trim()

/* ------------------------------------------------------------- submissions */

/**
 * A submission the firm could legitimately have made.
 *
 * The blocker rule is the one worth reading twice. `blockers` has no column in
 * migration 0020 and never will: a submission exists only where eligibility
 * held, so the array is empty on every submission that can legitimately be
 * stored. That makes emptiness an invariant rather than a stored fact — and it
 * has to be refused here, because the alternative is a mapper silently dropping
 * the blockers and writing a record that says the firm found none.
 */
export function validateCioSubmission(
  submission: CioSubmission,
): readonly AggregateProblem[] {
  const found: AggregateProblem[] = []
  const basis = submission.basis

  if (basis.blockers.length > 0) {
    found.push(
      problem(
        'submission-blockers-present',
        `Submission "${submission.id}" carries ${basis.blockers.length} eligibility ` +
          `blocker(s). A submission is a statement that the revision was eligible; ` +
          `one that was not is not a submission the firm can make.`,
      ),
    )
  }

  if (basis.revisionId !== submission.revisionId) {
    found.push(
      problem(
        'submission-basis-revision-mismatch',
        `Submission "${submission.id}" targets revision "${submission.revisionId}" ` +
          `and carries an eligibility basis for "${basis.revisionId}". The basis ` +
          `would be a photograph of a different argument.`,
      ),
    )
  }

  /*
   * `unresolved` means the Risk gate was never answered. The three-state model
   * exists precisely so that "we looked and it was not required" cannot be
   * confused with "nobody looked".
   */
  if (basis.riskRequirement === 'unresolved') {
    found.push(
      problem(
        'submission-risk-unresolved',
        `Submission "${submission.id}" leaves the Risk requirement unresolved. ` +
          `Eligibility requires the question to have been answered.`,
      ),
    )
  }

  if (basis.riskRequirement === 'required' && basis.risk === null) {
    found.push(
      problem(
        'submission-risk-review-missing',
        `Submission "${submission.id}" requires a Risk review and names none.`,
      ),
    )
  }

  if (blank(basis.eligibilityPolicyVersion)) {
    found.push(
      problem(
        'submission-no-policy-version',
        `Submission "${submission.id}" names no eligibility policy version, so ` +
          `nothing records which gates were in force.`,
      ),
    )
  }

  if (blank(basis.storageProvenanceId)) {
    found.push(
      problem(
        'submission-no-provenance',
        `Submission "${submission.id}" carries no storage provenance.`,
      ),
    )
  }

  /*
   * The witness must describe THIS basis. A submission carrying a manifest for
   * something else is not a smaller failure than a corrupt row -- it is a
   * caller presenting an attestation that does not attest to what it is
   * attached to.
   */
  const mismatch = verifyBasisManifest(
    { submissionId: submission.id, caseId: submission.caseId },
    basis,
    basis.manifest,
  )
  if (mismatch !== null) {
    found.push(
      problem(
        mismatch,
        `Submission "${submission.id}" carries a manifest that does not ` +
          `describe its own eligibility basis (${mismatch}).`,
      ),
    )
  }

  for (const disagreement of basis.materialDisagreements) {
    if (disagreement.materiality === 'decision-critical') {
      found.push(
        problem(
          'submission-decision-critical-disagreement',
          `Submission "${submission.id}" carries a decision-critical disagreement ` +
            `on claim "${disagreement.claimId}", which blocks eligibility.`,
        ),
      )
    }
  }

  return found
}

/* ----------------------------------------------------------------- returns */

/** A return the CIO could legitimately have made. */
export function validateCioReturn(cioReturn: CioReturn): readonly AggregateProblem[] {
  const found: AggregateProblem[] = []

  if (blank(cioReturn.reason)) {
    found.push(
      problem(
        'return-no-reason',
        `Return "${cioReturn.id}" states no reason. Work sent back without one ` +
          `cannot be acted on by whoever receives it.`,
      ),
    )
  }

  if (blank(cioReturn.authorizationBasis)) {
    found.push(
      problem(
        'return-no-authorization',
        `Return "${cioReturn.id}" records no authorization basis.`,
      ),
    )
  }

  /*
   * A return exists to send work back WITH reasons. One that records only
   * "the CIO returned this" tells whoever receives it that something was
   * wrong and nothing about what — which is not an instruction anybody can
   * act on.
   */
  if (cioReturn.concerns.length === 0) {
    found.push(
      problem(
        'return-no-concerns',
        `Return "${cioReturn.id}" raises no concern. A return records what was ` +
          `insufficient; without one it records only that somebody was unhappy.`,
      ),
    )
  }

  cioReturn.concerns.forEach((concern, index) => {
    if (blank(concern.detail)) {
      found.push(
        problem(
          'return-concern-no-detail',
          `Concern ${index} on return "${cioReturn.id}" states no detail.`,
        ),
      )
    }
    if (blank(concern.subjectId)) {
      found.push(
        problem(
          'return-concern-no-subject',
          `Concern ${index} on return "${cioReturn.id}" names no subject, so ` +
            `nobody can tell what it is about.`,
        ),
      )
    }
  })

  return found
}

/* ---------------------------------------------------------------- triggers */

/**
 * A reconsideration condition somebody could later determine had fired.
 *
 * The same rules `buildReconsiderationTrigger` enforces, as data rather than as
 * throws, so a decision can be checked whole instead of one trigger at a time.
 */
export function validateReconsiderationTrigger(
  trigger: ReconsiderationTrigger,
): readonly AggregateProblem[] {
  const found: AggregateProblem[] = []

  if (blank(trigger.rationale)) {
    found.push(
      problem(
        'trigger-no-rationale',
        `Trigger "${trigger.id}" states no rationale. A condition nobody ` +
          `explained is one nobody can decide is still relevant.`,
      ),
    )
  }
  if (blank(trigger.policyVersion)) {
    found.push(
      problem(
        'trigger-no-policy-version',
        `Trigger "${trigger.id}" names no policy version`,
      ),
    )
  }

  const qualitative = !blank(trigger.qualitativeCondition)

  if (!trigger.comparator && !qualitative) {
    found.push(
      problem(
        'trigger-unevaluable',
        `Trigger "${trigger.id}" carries neither a comparator nor a stated ` +
          `condition. Nothing could ever determine whether it fired.`,
      ),
    )
  }

  if (trigger.conditionType === 'quantitative-threshold') {
    if (!trigger.comparator) {
      found.push(
        problem(
          'trigger-threshold-no-comparator',
          `Quantitative trigger "${trigger.id}" states no comparator.`,
        ),
      )
    }
    if (!trigger.threshold) {
      found.push(
        problem(
          'trigger-threshold-missing',
          `Quantitative trigger "${trigger.id}" states no threshold.`,
        ),
      )
    } else if (blank(trigger.threshold.unit)) {
      /*
       * "Inflation above 3" reads as precise and is not: three percent, three
       * index points and three basis points are different conditions.
       */
      found.push(
        problem(
          'trigger-threshold-no-unit',
          `Quantitative trigger "${trigger.id}" states a threshold of ` +
            `"${trigger.threshold.amount}" with no unit.`,
        ),
      )
    }
  }

  if (trigger.comparator && trigger.comparator !== 'changes' && !trigger.threshold) {
    found.push(
      problem(
        'trigger-comparison-without-threshold',
        `Trigger "${trigger.id}" compares "${trigger.comparator}" against nothing.`,
      ),
    )
  }

  return found
}

/* --------------------------------------------------------------- decisions */

/**
 * A decision aggregate that is internally coherent.
 *
 * Everything checkable from the record alone. The checks needing a store — was
 * the selected revision superseded, does the superseded decision exist, does
 * each submission belong to this case — stay in `buildDecision`'s context and
 * in the repositories, where the answers actually are.
 */
export function validateCaseDecision(
  decision: CaseDecision,
): readonly AggregateProblem[] {
  const found: AggregateProblem[] = []
  const outcome = decision.outcome
  const considered = outcome.consideredRevisionIds

  if (blank(decision.rationale)) {
    found.push(
      problem(
        'decision-no-rationale',
        `Decision "${decision.decisionId}" records no rationale.`,
      ),
    )
  }
  if (blank(decision.evidenceSetId)) {
    found.push(
      problem(
        'decision-no-evidence',
        `Decision "${decision.decisionId}" cites no evidence set — a decision ` +
          `whose evidence cannot be located cannot be reviewed.`,
      ),
    )
  }
  if (blank(decision.authorizationBasis)) {
    found.push(
      problem(
        'decision-no-authorization',
        `Decision "${decision.decisionId}" records no authorization basis.`,
      ),
    )
  }

  if (considered.length === 0) {
    found.push(
      problem(
        'decision-considers-nothing',
        `Decision "${decision.decisionId}" considers nothing. Every decision is ` +
          `about an argument somebody put in front of the CIO.`,
      ),
    )
  }
  if (new Set(considered).size !== considered.length) {
    found.push(
      problem(
        'decision-duplicate-considered',
        `Decision "${decision.decisionId}" names a revision twice among those ` +
          `considered.`,
      ),
    )
  }

  if (outcome.kind === 'selected') {
    if (!considered.includes(outcome.selectedRevisionId)) {
      found.push(
        problem(
          'decision-selected-not-considered',
          `Decision "${decision.decisionId}" selects ` +
            `"${outcome.selectedRevisionId}", which is not among the revisions ` +
            `it considered.`,
        ),
      )
    }
  }

  if (outcome.kind === 'deferred' && decision.reconsiderationTriggers.length === 0) {
    found.push(
      problem(
        'decision-deferral-without-condition',
        `Decision "${decision.decisionId}" defers and records no condition that ` +
          `would end the wait. An indefinite deferral is not a decision.`,
      ),
    )
  }

  if (outcome.kind === 'declined') {
    const declined = new Set(outcome.declinedRevisionIds)
    const unaccounted = considered.filter((revisionId) => !declined.has(revisionId))
    if (unaccounted.length > 0 || declined.size !== considered.length) {
      found.push(
        problem(
          'decision-decline-incomplete',
          `Decision "${decision.decisionId}" declines ${declined.size} of ` +
            `${considered.length} considered revisions. A revision that was ` +
            `considered and neither selected nor declined is an alternative the ` +
            `record cannot account for.`,
        ),
      )
    }
  }

  /*
   * One submission per considered revision. Checked on count here because the
   * pairing itself needs the submissions, which the aggregate does not carry —
   * the repositories close that half.
   */
  if (decision.submissionIds.length !== considered.length) {
    found.push(
      problem(
        'decision-submission-count',
        `Decision "${decision.decisionId}" references ` +
          `${decision.submissionIds.length} submission(s) for ${considered.length} ` +
          `considered revision(s). Each revision is considered on the basis of ` +
          `exactly one submission.`,
      ),
    )
  }
  if (new Set(decision.submissionIds).size !== decision.submissionIds.length) {
    found.push(
      problem(
        'decision-duplicate-submission',
        `Decision "${decision.decisionId}" references one submission twice.`,
      ),
    )
  }

  for (const dissent of decision.unresolvedDissent) {
    if (blank(dissent.rationale)) {
      found.push(
        problem(
          'dissent-no-rationale',
          `Dissent "${dissent.sourceId}" records no rationale.`,
        ),
      )
    }
    if (
      dissentRequiresAcknowledgement(dissent.materiality) &&
      blank(dissent.acknowledgement)
    ) {
      found.push(
        problem(
          'dissent-unacknowledged',
          `Dissent "${dissent.sourceId}" is ${dissent.materiality} and the ` +
            `decision does not acknowledge it. Deciding past a material ` +
            `objection is legitimate; doing so without saying why is not.`,
        ),
      )
    }
    if (!considered.includes(dissent.revisionId)) {
      found.push(
        problem(
          'dissent-revision-not-considered',
          `Dissent "${dissent.sourceId}" is about revision "${dissent.revisionId}", ` +
            `which this decision did not consider.`,
        ),
      )
    }
  }

  for (const trigger of decision.reconsiderationTriggers) {
    found.push(...validateReconsiderationTrigger(trigger))
  }
  const triggerIds = decision.reconsiderationTriggers.map((trigger) => trigger.id)
  if (new Set(triggerIds).size !== triggerIds.length) {
    found.push(
      problem(
        'decision-duplicate-trigger',
        `Decision "${decision.decisionId}" records two triggers under one id.`,
      ),
    )
  }

  /*
   * Self-supersession is the only supersession check the aggregate can make
   * alone. Whether the predecessor exists, is live, and belongs to this case
   * are store questions, and the repositories answer them identically.
   */
  if (decision.supersedesDecisionId === decision.decisionId) {
    found.push(
      problem(
        'decision-supersedes-itself',
        `Decision "${decision.decisionId}" supersedes itself.`,
      ),
    )
  }

  return found
}

/* ----------------------------------------------------------------- asserts */

/** Thrown by the `assert*` wrappers. Carries the first problem's code. */
export class InvalidAggregateError extends Error {
  constructor(
    readonly code: string,
    readonly problems: readonly AggregateProblem[],
  ) {
    super(problems[0]?.detail ?? 'Invalid aggregate')
    this.name = 'InvalidAggregateError'
  }
}

const assertNone = (problems: readonly AggregateProblem[]): void => {
  if (problems.length > 0) throw new InvalidAggregateError(problems[0]!.code, problems)
}

export function assertCioSubmissionWellFormed(submission: CioSubmission): void {
  assertNone(validateCioSubmission(submission))
}

export function assertCioReturnWellFormed(cioReturn: CioReturn): void {
  assertNone(validateCioReturn(cioReturn))
}

export function assertCaseDecisionWellFormed(decision: CaseDecision): void {
  assertNone(validateCaseDecision(decision))
}

/* --------------------------------------------- referenced governance */

/**
 * What the store knows about the artifacts a submission's basis names.
 *
 * Supplied rather than looked up: the rule is the same for both adapters, but
 * "read the reviews" means a Map lookup in one and a join in the other. Keeping
 * the rule pure is what lets it be the same rule.
 */
export interface ReferencedGovernance {
  /** Reviews by id. `revisionId` is null for a case-wide review. */
  reviews: ReadonlyMap<
    string,
    {
      caseId: string
      revisionId: string | null
      kind: string
      /** The challenges recorded on this review. */
      challengeIds: readonly string[]
    }
  >
  /** Aggregations by id, and the revision each produced. */
  aggregations: ReadonlyMap<string, { caseId: string; producedRevisionId: string }>
  runs: ReadonlyMap<string, { caseId: string }>
  claims: ReadonlyMap<string, { caseId: string }>
}

/**
 * Every governance artifact a submission cites belongs to it.
 *
 * The failure this prevents is the one a foreign key cannot see. `reviews` is
 * keyed on `id` alone, so the schema can prove a review EXISTS and can prove
 * nothing about which revision it reviewed — meaning a submission could cite the
 * verification of a sibling revision and every constraint in the database would
 * be satisfied. The record would then say the firm verified something it did
 * not.
 *
 * A repository is an institutional integrity boundary: it must not depend on
 * every future caller getting this right. The commands check it too; this is
 * what makes the check true regardless.
 *
 * **It validates references, not the gate.** Whether the verdicts add up to
 * eligibility is the domain's question and stays there — this only asks whether
 * the things cited are the things they claim to be.
 */
export function validateSubmissionReferences(
  submission: CioSubmission,
  governance: ReferencedGovernance,
): readonly AggregateProblem[] {
  const found: AggregateProblem[] = []
  const basis = submission.basis

  const checkReview = (
    reviewId: string,
    expectedKind: string,
    label: string,
  ): { challengeIds: readonly string[] } | null => {
    const review = governance.reviews.get(reviewId)
    if (!review) {
      found.push(
        problem(
          'submission-review-missing',
          `Submission "${submission.id}" cites ${label} review "${reviewId}", ` +
            `which does not exist.`,
        ),
      )
      return null
    }
    if (review.caseId !== submission.caseId) {
      found.push(
        problem(
          'submission-review-wrong-case',
          `Submission "${submission.id}" cites ${label} review "${reviewId}" from ` +
            `case "${review.caseId}".`,
        ),
      )
    }
    /*
     * A case-wide review legitimately applies to every revision of its case —
     * that is what the scope means. Anything scoped to a DIFFERENT revision is
     * a verdict about a different argument.
     */
    if (review.revisionId !== null && review.revisionId !== submission.revisionId) {
      found.push(
        problem(
          'submission-review-wrong-revision',
          `Submission "${submission.id}" targets revision ` +
            `"${submission.revisionId}" and cites ${label} review "${reviewId}", ` +
            `which reviewed "${review.revisionId}".`,
        ),
      )
    }
    if (review.kind !== expectedKind) {
      found.push(
        problem(
          'submission-review-wrong-kind',
          `Submission "${submission.id}" cites "${reviewId}" as its ${label} ` +
            `review; it is a ${review.kind} review.`,
        ),
      )
    }
    return { challengeIds: review.challengeIds }
  }

  if (basis.verification) {
    checkReview(basis.verification.reviewId, 'verification', 'the verification')
  }

  if (basis.devilsAdvocate) {
    const review = checkReview(
      basis.devilsAdvocate.reviewId,
      'devils-advocate',
      "the Devil's Advocate",
    )
    /*
     * An open challenge belongs to the review that raised it. Checking
     * membership rather than looking the challenge up separately is both
     * cheaper and stricter: a challenge from another review would be a
     * different reviewer's objection attributed to this one.
     */
    if (review) {
      const known = new Set(review.challengeIds)
      for (const { challengeId, materiality } of basis.devilsAdvocate.openChallenges) {
        if (!DISAGREEMENT_MATERIALITIES.includes(materiality)) {
          found.push(
            problem(
              'submission-challenge-materiality-unknown',
              `Submission "${submission.id}" gives challenge "${challengeId}" a ` +
                `materiality the firm does not define.`,
            ),
          )
        }
        if (!known.has(challengeId)) {
          found.push(
            problem(
              'submission-challenge-not-in-review',
              `Submission "${submission.id}" lists challenge "${challengeId}" as ` +
                `open, and it does not belong to the Devil's Advocate review it ` +
                `cites.`,
            ),
          )
        }
      }
    }
  }

  if (basis.risk) {
    checkReview(basis.risk.reviewId, 'risk', 'the Risk')
  }

  if (basis.aggregationId !== null) {
    const aggregation = governance.aggregations.get(basis.aggregationId)
    if (!aggregation) {
      found.push(
        problem(
          'submission-aggregation-missing',
          `Submission "${submission.id}" cites aggregation ` +
            `"${basis.aggregationId}", which does not exist.`,
        ),
      )
    } else {
      if (aggregation.caseId !== submission.caseId) {
        found.push(
          problem(
            'submission-aggregation-wrong-case',
            `Submission "${submission.id}" cites an aggregation from case ` +
              `"${aggregation.caseId}".`,
          ),
        )
      }
      if (aggregation.producedRevisionId !== submission.revisionId) {
        found.push(
          problem(
            'submission-aggregation-wrong-revision',
            `Submission "${submission.id}" targets revision ` +
              `"${submission.revisionId}" and cites the aggregation that produced ` +
              `"${aggregation.producedRevisionId}".`,
          ),
        )
      }
    }
  }

  for (const work of basis.requiredWork) {
    const run = governance.runs.get(work.runId)
    if (!run) {
      found.push(
        problem(
          'submission-run-missing',
          `Submission "${submission.id}" cites run "${work.runId}", which does ` +
            `not exist.`,
        ),
      )
    } else if (run.caseId !== submission.caseId) {
      found.push(
        problem(
          'submission-run-wrong-case',
          `Submission "${submission.id}" cites run "${work.runId}" from case ` +
            `"${run.caseId}".`,
        ),
      )
    }
  }

  for (const disagreement of basis.materialDisagreements) {
    const claim = governance.claims.get(disagreement.claimId)
    if (!claim) {
      found.push(
        problem(
          'submission-claim-missing',
          `Submission "${submission.id}" cites claim "${disagreement.claimId}", ` +
            `which does not exist.`,
        ),
      )
    } else if (claim.caseId !== submission.caseId) {
      found.push(
        problem(
          'submission-claim-wrong-case',
          `Submission "${submission.id}" cites claim "${disagreement.claimId}" ` +
            `from case "${claim.caseId}".`,
        ),
      )
    }
  }

  /*
   * Evidence sets are deliberately unchecked. They are content-addressed and
   * belong to no case: the same observations assembled for two cases are one
   * set by construction, so there is no ownership to verify.
   */

  return found
}

/* ------------------------------------------------- referenced return subjects */

/**
 * What the store knows about the things a return's concerns point at.
 *
 * Keyed `kind:id` rather than as one map per table, because a concern already
 * carries its own `subjectKind` and the check is the same shape whatever the
 * subject is: does it exist, is it this case's, and — where it is scoped to a
 * revision — is it this revision's.
 *
 * `revisionId` is null for a subject that is case-wide rather than about one
 * argument. Evidence sets are absent by design: they are content-addressed and
 * belong to no case, so there is no ownership to verify.
 */
export interface ReferencedSubjects {
  byKindAndId: ReadonlyMap<string, { caseId: string; revisionId: string | null }>
}

export const subjectKey = (kind: string, id: string) => `${kind}:${id}`

/** Subjects that are content-addressed and therefore own nothing. */
const UNOWNED_SUBJECT_KINDS = new Set(['evidence'])

/**
 * Every concern a return raises is about this case, and this revision.
 *
 * A return sends work back with reasons attached. If one of those reasons cites
 * a finding from another case, whoever picks the work up is being pointed at
 * something that has nothing to do with what they are being asked to fix — and
 * the record says the CIO objected to it.
 *
 * Structural ownership only. Whether the concern is *substantively* right is
 * the CIO's judgement and no repository's business.
 */
export function validateReturnReferences(
  cioReturn: CioReturn,
  subjects: ReferencedSubjects,
): readonly AggregateProblem[] {
  const found: AggregateProblem[] = []

  cioReturn.concerns.forEach((concern, index) => {
    if (UNOWNED_SUBJECT_KINDS.has(concern.subjectKind)) return

    const subject = subjects.byKindAndId.get(
      subjectKey(concern.subjectKind, concern.subjectId),
    )

    if (!subject) {
      found.push(
        problem(
          'return-concern-subject-missing',
          `Concern ${index} on return "${cioReturn.id}" cites ` +
            `${concern.subjectKind} "${concern.subjectId}", which does not exist.`,
        ),
      )
      return
    }

    if (subject.caseId !== cioReturn.caseId) {
      found.push(
        problem(
          'return-concern-wrong-case',
          `Concern ${index} on return "${cioReturn.id}" cites a ` +
            `${concern.subjectKind} from case "${subject.caseId}". Work sent ` +
            `back with a reason from another case points whoever receives it at ` +
            `something that has nothing to do with the fix.`,
        ),
      )
    }

    /*
     * A case-wide subject applies to every revision of its case. Only one
     * scoped to a DIFFERENT revision is about a different argument.
     */
    if (subject.revisionId !== null && subject.revisionId !== cioReturn.revisionId) {
      found.push(
        problem(
          'return-concern-wrong-revision',
          `Concern ${index} on return "${cioReturn.id}" is about revision ` +
            `"${cioReturn.revisionId}" and cites a ${concern.subjectKind} ` +
            `scoped to "${subject.revisionId}".`,
        ),
      )
    }
  })

  return found
}
