/**
 * Where a case stands as an institution, rather than as data.
 *
 * Somebody opening a case needs six answers before they need any record:
 * where it is, whose desk it is on, what the firm has finished, what it has
 * not, what is stopping it, and what happens next. Everything else is
 * drill-down.
 *
 * ## Codes, never sentences
 *
 * Every field here is an identifier. `Blocker` already learned this lesson the
 * expensive way — it once carried `detail: string`, prose was composed into it,
 * and the category was recovered by matching sentence prefixes, so renaming a
 * message silently reclassified a blocker. The wording of "Risk must review
 * this" belongs to whatever renders it, in whatever language it renders in.
 *
 * ## Derived, never stored
 *
 * Standing is a reading of facts that already exist. Storing it would create a
 * second answer to "where is this case", free to disagree with the stage table
 * and the gate report that produced it.
 *
 * ## It describes, it does not offer
 *
 * `nextAct` names what the institution does next. It does not claim a command
 * exists to do it: the stage table deliberately permits transitions nothing
 * implements yet, and the honest thing is to say what the firm's process
 * requires and let the caller decide what it can actually offer.
 */

import type { DepartmentId, EmployeeId, Organization } from './organization'
import type { CaseStage, InvestmentCase } from './cases'
import { isTerminal } from './cases'
import type { Blocker } from './lifecycle'
import type { RiskRequirementState } from './review'

/* --------------------------------------------------------------- the steps */

/**
 * The institutional milestones, in the order the firm performs them.
 *
 * Not the same as `CaseStage`. A stage is where the case is; a step is
 * something the organization did. Governance can hold three steps at once while
 * the case sits in a single stage, which is exactly what a reader needs to see.
 */
export type CaseStep =
  | 'thesis-proposed'
  | 'work-aggregated'
  /**
   * A qualified analytical desk reading the synthesised revision.
   *
   * Between synthesis and the control functions, because that is where the
   * workflow puts it: a peer examines finished work, and the desks that check
   * the argument come after the desk that disputes it.
   */
  | 'peer-examination'
  | 'verification'
  | 'devils-advocate'
  | 'risk'
  | 'cio-submission'
  | 'cio-decision'

export const CASE_STEPS: readonly CaseStep[] = Object.freeze([
  'thesis-proposed',
  'work-aggregated',
  'peer-examination',
  'verification',
  'devils-advocate',
  'risk',
  'cio-submission',
  'cio-decision',
])

/**
 * `not-applicable` is not a quiet completion.
 *
 * Risk that the firm decided was not required, and Risk that approved, are
 * different facts about the process. The same distinction `GateStatus` draws,
 * for the same reason: collapsing them lets a reader believe a control ran that
 * never did.
 */
export type StepStatus = 'complete' | 'outstanding' | 'not-applicable'

export interface StepStanding {
  step: CaseStep
  status: StepStatus
}

/* ---------------------------------------------------------- the next act */

/**
 * What the institution does next, as a code.
 *
 * `none-settled` is a real answer, not an absence: a decided case is not
 * waiting for anything, and rendering that as an empty next step would read as
 * a system that lost track of it.
 */
export type InstitutionalAct =
  | 'propose-thesis'
  | 'aggregate-conclusion'
  | 'submit-for-verification'
  | 'record-verification-review'
  | 'record-peer-examination'
  | 'record-devils-advocate-review'
  | 'resolve-risk-requirement'
  | 'record-risk-review'
  | 'submit-for-cio-decision'
  | 'decide-or-return'
  | 'resubmit-after-return'
  | 'unblock'
  | 'none-settled'

export interface NextAct {
  act: InstitutionalAct
  /** Whose queue it is in. `null` where nothing is owed. */
  owningDepartmentId: DepartmentId | null
}

/* ------------------------------------------------------------ the standing */

/**
 * Who holds the case now.
 *
 * A department acts through a person, so both travel together where both are
 * known. A settled case is owned by nobody, and says so rather than naming the
 * last person to touch it — which would read as an open obligation.
 */
export interface CaseOwnership {
  kind: 'department' | 'chief' | 'settled'
  departmentId: DepartmentId | null
  employeeId: EmployeeId | null
}

export interface CaseStanding {
  stage: CaseStage
  /** Terminal stages: the case no longer occupies anybody's queue. */
  settled: boolean
  ownership: CaseOwnership
  steps: readonly StepStanding[]
  /** Structural reasons progress has stopped. Codes, resolved by the caller. */
  blockers: readonly Blocker[]
  nextAct: NextAct
}

/** Facts in, standing out. Nothing here reads a repository or a policy. */
/**
 * Whether this case owes a peer examination, and whether it has had one.
 *
 * A three-state answer rather than a boolean, because absence and
 * inapplicability are different institutional facts. A case whose instantiated
 * workflow never assigned a peer examination does not owe one; a case that does
 * owe one and has not had it is waiting.
 *
 * ## Resolved by the caller, never decided here
 *
 * Applicability comes from the workflow the case actually instantiated — a
 * persisted assignment — and completeness from the existing
 * `applicablePeerExaminations` reading of the current revision. Neither is
 * derived in this module, and no eligibility policy is consulted: standing
 * answers *what work does this case owe*, which is a different question from
 * *does this revision satisfy the policy a submission names*.
 *
 * ## `complete` is not "the objections were settled"
 *
 * A desk that examined the revision has completed the examination whatever it
 * found. Whether its objections still block is `CHALLENGE_UNRESOLVED`'s answer,
 * under the policy in force, and folding the two together would let an
 * unresolved objection read as work nobody has done.
 */
export type PeerScrutinyStanding =
  | { applicability: 'not-applicable' }
  | { applicability: 'required'; complete: boolean }

export interface CaseStandingInput {
  investmentCase: InvestmentCase
  organization: Organization
  hasThesis: boolean
  hasAggregation: boolean
  hasVerification: boolean
  hasDevilsAdvocate: boolean
  hasRisk: boolean
  /** As the instantiated workflow and the current revision report it. */
  peerScrutiny: PeerScrutinyStanding
  /**
   * The desk that produced the current revision, and therefore the desk that
   * submits it.
   *
   * Read from the aggregation that made the revision — the same institutional
   * actor `submitForCioDecision` is called with. It used to be
   * `participatingDepartmentIds[0]`, which is an array order rather than an
   * owner, and which reported the Devil's Advocate as owing the submission.
   */
  submittingDepartmentId: DepartmentId | null
  /**
   * Whether the current revision has been put before the control functions
   * — submitted for verification, or past it. An aggregated revision that
   * has not is owed exactly that act, whatever stage the case rests at: the
   * submission is what moves the case, so a case never rests at
   * `aggregation` on its own, and the peer, Verification and the Devil's
   * Advocate can file nothing against a draft (G1, 2026-09-18).
   */
  revisionSubmitted: boolean
  /** As the firm resolved it for the current revision. */
  riskRequirement: RiskRequirementState
  hasSubmission: boolean
  hasDecision: boolean
  blockers: readonly Blocker[]
}

/** The governance department that owes each review step. */
const GOVERNANCE_OWNER: Readonly<Record<string, DepartmentId>> = Object.freeze({
  verification: 'verification',
  'devils-advocate': 'devils-advocate',
  risk: 'risk',
})

export function caseStanding(input: CaseStandingInput): CaseStanding {
  const { investmentCase, organization } = input
  const stage = investmentCase.stage
  const settled = isTerminal(stage) || stage === 'deferred'

  const steps = standingSteps(input)
  const outstanding = steps.filter((entry) => entry.status === 'outstanding')

  return {
    stage,
    settled,
    ownership: ownershipFor(stage, investmentCase, organization, input.blockers),
    steps,
    blockers: input.blockers,
    nextAct: nextActFor(stage, outstanding, input),
  }
}

function standingSteps(input: CaseStandingInput): StepStanding[] {
  /*
   * Read from the records, not from the stage. A case sitting in `review` may
   * have two of three verdicts in, and a stage-derived answer would show all
   * three as outstanding or all three as done.
   */
  return [
    { step: 'thesis-proposed', status: done(input.hasThesis) },
    { step: 'work-aggregated', status: done(input.hasAggregation) },
    {
      step: 'peer-examination',
      /*
       * `not-applicable` when the instantiated workflow assigned none — which
       * is not the same as outstanding. A case running a workflow that never
       * asked for peer scrutiny is not behind on it.
       */
      status:
        input.peerScrutiny.applicability === 'not-applicable'
          ? 'not-applicable'
          : done(input.peerScrutiny.complete),
    },
    { step: 'verification', status: done(input.hasVerification) },
    { step: 'devils-advocate', status: done(input.hasDevilsAdvocate) },
    {
      step: 'risk',
      /*
       * The firm decided Risk does not apply here. Distinct from approved, and
       * distinct from unresolved -- an unresolved requirement is outstanding,
       * because nobody has yet decided whether the control is owed.
       */
      status:
        input.riskRequirement === 'not-required' ? 'not-applicable' : done(input.hasRisk),
    },
    { step: 'cio-submission', status: done(input.hasSubmission) },
    { step: 'cio-decision', status: done(input.hasDecision) },
  ]
}

const done = (complete: boolean): StepStatus => (complete ? 'complete' : 'outstanding')

function ownershipFor(
  stage: CaseStage,
  investmentCase: InvestmentCase,
  organization: Organization,
  blockers: readonly Blocker[],
): CaseOwnership {
  if (isTerminal(stage) || stage === 'deferred') {
    return { kind: 'settled', departmentId: null, employeeId: null }
  }

  if (stage === 'decision') {
    /* The one stage owned by a person rather than a function. */
    return {
      kind: 'chief',
      departmentId: null,
      employeeId: organization.chiefEmployeeId,
    }
  }

  if (stage === 'blocked') {
    /*
     * Whoever must clear the blocker owns a blocked case. `Blocker` carries
     * `owningDepartmentId` for exactly this, so the floor can show whose queue
     * it is in rather than showing "blocked" and leaving the reader to guess.
     */
    const owning = blockers.find((blocker) => blocker.owningDepartmentId)
    return {
      kind: 'department',
      departmentId: owning?.owningDepartmentId ?? null,
      employeeId: null,
    }
  }

  if (stage === 'review') {
    const owed = blockers.find((blocker) => blocker.owningDepartmentId)
    if (owed?.owningDepartmentId) {
      return {
        kind: 'department',
        departmentId: owed.owningDepartmentId,
        employeeId: null,
      }
    }
  }

  /*
   * Otherwise the desk that owns the thesis. `returned` lands here too, which
   * is the point of returning work: it becomes somebody's again.
   */
  return {
    kind: 'department',
    departmentId: investmentCase.participatingDepartmentIds[0] ?? null,
    employeeId: investmentCase.ownerEmployeeId,
  }
}

function nextActFor(
  stage: CaseStage,
  outstanding: readonly StepStanding[],
  input: CaseStandingInput,
): NextAct {
  if (isTerminal(stage) || stage === 'deferred') {
    return { act: 'none-settled', owningDepartmentId: null }
  }
  if (stage === 'blocked') {
    const owning = input.blockers.find((blocker) => blocker.owningDepartmentId)
    return { act: 'unblock', owningDepartmentId: owning?.owningDepartmentId ?? null }
  }
  if (stage === 'returned') {
    return {
      act: 'resubmit-after-return',
      owningDepartmentId: input.investmentCase.participatingDepartmentIds[0] ?? null,
    }
  }
  if (stage === 'decision') {
    return { act: 'decide-or-return', owningDepartmentId: null }
  }

  const pending = new Set(outstanding.map((entry) => entry.step))

  if (pending.has('thesis-proposed')) {
    return {
      act: 'propose-thesis',
      owningDepartmentId: input.investmentCase.participatingDepartmentIds[0] ?? null,
    }
  }
  if (pending.has('work-aggregated')) {
    return {
      act: 'aggregate-conclusion',
      owningDepartmentId: input.investmentCase.participatingDepartmentIds[0] ?? null,
    }
  }

  /*
   * Governance, in the order the firm reads it. Risk is asked whether it
   * APPLIES before it is asked to review -- an unresolved requirement is a
   * different outstanding act from a missing review, and conflating them sends
   * the wrong desk a request.
   */
  if (stage === 'aggregation' || (stage === 'research' && !input.revisionSubmitted)) {
    /* The desk that synthesised the revision submits it — the same actor `submitForVerification` expects. */
    return {
      act: 'submit-for-verification',
      owningDepartmentId:
        input.submittingDepartmentId ?? input.investmentCase.participatingDepartmentIds[0] ?? null,
    }
  }
  /*
   * Before the control functions. A peer reads the synthesis, and asking
   * Verification to check an argument the firm has not yet had a second
   * qualified opinion on inverts the workflow v5 describes.
   */
  if (pending.has('peer-examination')) {
    return { act: 'record-peer-examination', owningDepartmentId: null }
  }
  if (pending.has('verification')) {
    return {
      act: 'record-verification-review',
      owningDepartmentId: GOVERNANCE_OWNER.verification!,
    }
  }
  if (pending.has('devils-advocate')) {
    return {
      act: 'record-devils-advocate-review',
      owningDepartmentId: GOVERNANCE_OWNER['devils-advocate']!,
    }
  }
  if (input.riskRequirement === 'unresolved') {
    return { act: 'resolve-risk-requirement', owningDepartmentId: GOVERNANCE_OWNER.risk! }
  }
  if (pending.has('risk')) {
    return { act: 'record-risk-review', owningDepartmentId: GOVERNANCE_OWNER.risk! }
  }
  if (pending.has('cio-submission')) {
    return {
      act: 'submit-for-cio-decision',
      /*
       * The desk that produced the revision, never an array position. See
       * `submittingDepartmentId`.
       */
      owningDepartmentId: input.submittingDepartmentId,
    }
  }
  return { act: 'decide-or-return', owningDepartmentId: null }
}
