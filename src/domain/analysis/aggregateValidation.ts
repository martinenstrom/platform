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
      problem('trigger-no-policy-version', `Trigger "${trigger.id}" names no policy version`),
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
        problem('dissent-no-rationale', `Dissent "${dissent.sourceId}" records no rationale.`),
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
