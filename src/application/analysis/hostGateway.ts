/**
 * The gateway: one host request in, one typed product state out.
 *
 * Sits on `FinancialOsSystem` and adds no institutional behaviour. What it adds
 * is translation — the firm interprets its own record and answers in the six
 * product states the host understands — and a refusal to be anything more.
 *
 * ## Three states the firm must never confuse
 *
 * The firm may have work to do. The firm may be unable to proceed. The firm
 * may need the person. `working`, `blocked` and `needs-decision` are those
 * three, and the derivation below keeps them apart because a host turns each
 * into a different sentence — "jag kollar på det", "analysen kan inte
 * fortsätta just nu", "jag behöver ditt beslut" — and the wrong one is a lie.
 *
 * ## `working` is an active execution window, not process liveness
 *
 * A run in state `running` whose recorded deadline the clock has not passed
 * is a run the firm itself still considers inside its authorised execution
 * window. That is what `working` means here — and all it means. It does not
 * prove that an operating-system process or a provider connection is alive at
 * this instant; the firm has no lease or heartbeat that could (TD-92).
 *
 * The window matters because a `running` row outlives the process that wrote
 * it. Measured on the dev firm on 2026-09-14: a stub run started on
 * 2026-09-06 still sat in `running` a week later, and a first cut of this
 * derivation reported it as work. Every live run records the wall clock it
 * was authorised — the firm refuses to start one without — so "running and
 * not past that clock" is a bound the firm wrote down, not a threshold
 * invented here. A running row outside any window is `expired`, and an
 * expired run is `blocked` on recovery: the person is never asked to repair
 * infrastructure.
 *
 * ## `answer-ready` says what kind of authority it carries
 *
 * A live CIO decision on a settled case is `cio-decision`. The committee's
 * conclusion — the current synthesis, after every scrutiny the workflow
 * required of it and with nothing blocking it — is `committee-conclusion`,
 * and is the normal investment answer while CIO authority is deferred. The
 * one is never promoted into the other. A conclusion that has actually been
 * put to the CIO is with the CIO, which is a decision the person may owe.
 *
 * ## `needs-decision` is the person's, and nobody else's
 *
 * TD-88 — a convened case with no thesis, and no authorised path to one —
 * and a case with the CIO. Nothing a desk or a control function owes is ever
 * reported as the person's decision; that is `blocked`, with the semantic
 * reason and the desk that owes it.
 *
 * ## The host holds a reference, and the firm re-reads
 *
 * A reference's `provenanceId` is what the host read it under. It is never
 * used to answer: every call reads the case again, and the reference returned
 * carries the provenance of that read. A stale reference is therefore not a
 * stale answer.
 */

import {
  closureOf,
  dissentRequiresAcknowledgement,
  type AgentRunRecord,
  type Blocker,
  type CaseStep,
  type InvestmentThesis,
} from '~/domain/analysis'
import type { CaseOverview } from './caseOverview'
import {
  boardroomTimeline,
  type BoardroomEntry,
  type BoardroomTimeline,
} from './boardroomTimeline'
import { boardroomSeating } from './boardroomSeating'
import type { CurrentOperatorResult } from './currentOperator'
import type {
  CaseActResult,
  CaseCommission,
  Delegation,
  DomainReference,
  FinancialOsSystem,
} from './domainSystem'
import type { StartInvestmentCaseResult } from './startInvestmentCase'
import { FINANCIAL_OS_SYSTEM_ID } from './domainSystem'
import type {
  AnswerThesis,
  BlockedReason,
  HostActivity,
  HostAmendments,
  HostBlock,
  HostClosure,
  HostCommission,
  HostDecision,
  HostDesk,
  HostInspection,
  HostObjection,
  HostRequest,
  HostResult,
  HostSurfaces,
  InspectView,
  InstitutionalAnswer,
} from './hostContract'

/** How the host is recorded as the initiator of every act it dispatches. */
export const HOST_ORCHESTRATOR_ID = 'jarvis'

/* ------------------------------------------------------- the derivation */

/** The product state of a case, read from its record. Pure. */
export type ProductState =
  | { state: 'working' }
  | { state: 'answer-ready'; kind: InstitutionalAnswer['kind'] }
  | { state: 'blocked'; block: HostBlock }
  | { state: 'needs-decision'; decision: HostDecision }
  | { state: 'closed'; closure: HostClosure }
  | { state: 'unsupported'; reason: 'no-institutional-conclusion' }

const deskOf = (overview: CaseOverview, departmentId: string | null): HostDesk | null => {
  if (!departmentId) return null
  const found = overview.roster.find((desk) => desk.id === departmentId)
  return found
    ? { id: found.id, name: found.name, isGovernance: found.isGovernance }
    : null
}

/**
 * Whether a run's own record places it inside its active execution window.
 *
 * `running`, with a measured deadline the clock has not passed. This is the
 * firm's own view of the run, not a liveness check; a run without a measured
 * deadline has no window to be inside.
 */
export function withinExecutionWindow(run: AgentRunRecord, now: string): boolean {
  if (run.state !== 'running') return false
  if (run.budget.deadline.kind !== 'limit') return false
  return Date.parse(run.startedAt) + run.budget.deadline.deadlineMs > Date.parse(now)
}

const expiredRuns = (overview: CaseOverview, now: string) =>
  overview.runs.filter(
    (run) => run.state === 'running' && !withinExecutionWindow(run, now),
  )

const heldRuns = (overview: CaseOverview) =>
  overview.runs.filter((run) => run.state === 'awaiting-acceptance')

/** The revision governance and the CIO are reading — the latest, as the gate reads it. */
const currentRevision = (overview: CaseOverview): InvestmentThesis | null =>
  overview.revisions[overview.revisions.length - 1] ?? null

/** The gates a committee conclusion must have passed. The CIO's steps are not among them. */
const COMMITTEE_GATES: readonly CaseStep[] = [
  'peer-examination',
  'verification',
  'devils-advocate',
  'risk',
]

/**
 * Whether the committee's conclusion is ready to be presented.
 *
 * A synthesis exists (a revision produced by aggregation, not merely
 * proposed); every scrutiny step the instantiated workflow requires is
 * complete or not applicable, as the standing reads it; and the evaluator
 * that decides eligibility records nothing that blocks a decision. Every
 * input is persisted state read through the firm's own derivations — no
 * approval concept is added here.
 */
export function committeeConclusionReady(overview: CaseOverview): boolean {
  const current = currentRevision(overview)
  if (!current || !current.aggregationId) return false
  /*
   * Everything before the CIO is done, as the firm reads its own process:
   * not returned, not blocked on a stage, and not already put to the CIO. A
   * conclusion the CIO holds is the CIO's decision to make, not an answer.
   */
  if (overview.standing.nextAct.act !== 'submit-for-cio-decision') return false
  const status = new Map(overview.standing.steps.map((step) => [step.step, step.status]))
  if (COMMITTEE_GATES.some((gate) => status.get(gate) === 'outstanding')) return false
  return !overview.standing.blockers.some(
    (blocker) => blocker.severity === 'blocks-decision',
  )
}

/** A live decision the case is settled on. */
const liveDecision = (overview: CaseOverview) =>
  overview.decision && overview.standing.settled ? overview.decision : null

/**
 * What a blocker means to a host. Reads the evaluator's blockers; decides
 * nothing about whether they block — that was decided where they were made.
 */
function reasonFor(kind: Blocker['kind']): BlockedReason {
  switch (kind) {
    case 'verification-missing':
    case 'verification-correction-required':
    case 'unresolved-citation':
      return 'verification-required'
    case 'unresolved-material-challenge':
    case 'decision-critical-disagreement':
      return 'objections-unresolved'
    case 'risk-requirement-unresolved':
    case 'risk-review-missing':
    case 'risk-review-rejected':
    case 'risk-review-not-expected':
      return 'risk-review-required'
    case 'missing-required-contribution':
    case 'required-assignment-failed':
      return 'analysis-required'
    default:
      return 'institutional-requirement-outstanding'
  }
}

function blockedBy(overview: CaseOverview, blockers: readonly Blocker[]): HostBlock {
  const first = blockers[0]
  const owning = blockers.find((blocker) => blocker.owningDepartmentId)
  return {
    reason: first ? reasonFor(first.kind) : 'institutional-requirement-outstanding',
    owner: deskOf(overview, owning?.owningDepartmentId ?? null),
  }
}

/**
 * Whether the firm had started on the case: a run, a claim or a thesis
 * exists. Decides `cancelled` against `abandoned`; never stored.
 */
const workHadStarted = (overview: CaseOverview): boolean =>
  overview.runs.length > 0 || overview.claims.length > 0 || overview.revisions.length > 0

/** How a withdrawn case was closed, as a host may say it. `null` unless withdrawn. */
export function closureFor(overview: CaseOverview): HostClosure | null {
  const closure = closureOf(overview.investmentCase, workHadStarted(overview))
  if (!closure) return null
  return {
    kind: closure.kind,
    reason: closure.reason,
    at: closure.at,
    byDesk: deskOf(overview, closure.byDepartmentId),
  }
}

export function productStateFor(overview: CaseOverview, now: string): ProductState {
  /*
   * Closed wins over everything, including a run still inside its window:
   * the person ended the case, and work the firm will not adopt is not
   * "work in progress" to them. What is in flight is still counted in
   * `activity`, because it is true and it costs money.
   */
  const closure = closureFor(overview)
  if (closure) return { state: 'closed', closure }

  /* In flight wins. A run inside its window is work the firm is doing now. */
  if (overview.runs.some((run) => withinExecutionWindow(run, now)))
    return { state: 'working' }

  /* The firm decided, and the case is settled on it. */
  if (liveDecision(overview)) return { state: 'answer-ready', kind: 'cio-decision' }

  /*
   * Work the firm holds and cannot move on its own. Before any decision the
   * person might owe, because these are the firm's to recover or adopt and a
   * person asked to decide first would be asked to repair the machinery.
   */
  const expired = expiredRuns(overview, now)
  if (expired.length > 0) {
    return {
      state: 'blocked',
      block: {
        reason: 'execution-recovery-required',
        owner: deskOf(overview, expired[0]!.departmentId),
      },
    }
  }
  const held = heldRuns(overview)
  if (held.length > 0) {
    return {
      state: 'blocked',
      block: {
        reason: 'adoption-required',
        owner: deskOf(overview, held[0]!.departmentId),
      },
    }
  }

  const next = overview.standing.nextAct
  const governanceOwner = (departmentId: string | null): HostDesk | null =>
    deskOf(overview, departmentId)

  switch (next.act) {
    case 'propose-thesis':
      /* TD-88. Registered, convened, and no one is authorised to open. */
      return {
        state: 'needs-decision',
        decision: { reason: 'institutional-initialization-required' },
      }
    case 'decide-or-return':
      /* Actually with the CIO. */
      return { state: 'needs-decision', decision: { reason: 'cio-decision-required' } }
    case 'none-settled':
      /* Settled with nothing to stand behind. Reported, not dressed up. */
      return { state: 'unsupported', reason: 'no-institutional-conclusion' }
    case 'submit-for-cio-decision':
      /*
       * Every step before the CIO is done. Whether the committee's conclusion
       * can be presented is the gate's answer, and if it cannot, the gate says
       * what stands in the way.
       */
      return committeeConclusionReady(overview)
        ? { state: 'answer-ready', kind: 'committee-conclusion' }
        : { state: 'blocked', block: blockedBy(overview, overview.standing.blockers) }
    case 'unblock':
      return { state: 'blocked', block: blockedBy(overview, overview.standing.blockers) }
    /*
     * Owners below come only from the firm's governance table. The desk the
     * standing names for the analytical acts is `participatingDepartmentIds[0]`,
     * which is an array order rather than an owner (TD-91), and is not
     * repeated here.
     */
    case 'aggregate-conclusion': {
      /*
       * The opening exists and the desks owe their analysis before anyone can
       * synthesise it: the person is told a desk's analysis is missing — and
       * which desk — not that the Research Office has failed to weigh work
       * that does not exist yet. Once the contributions are in, it is the
       * synthesis that is owed.
       */
      const missing = overview.standing.blockers.find(
        (blocker) =>
          blocker.kind === 'missing-required-contribution' || blocker.kind === 'required-assignment-failed',
      )
      if (missing) {
        return {
          state: 'blocked',
          block: { reason: 'analysis-required', owner: deskOf(overview, missing.owningDepartmentId ?? null) },
        }
      }
      return { state: 'blocked', block: { reason: 'synthesis-required', owner: null } }
    }
    case 'submit-for-verification':
      return { state: 'blocked', block: { reason: 'verification-required', owner: null } }
    case 'record-peer-examination':
      return {
        state: 'blocked',
        block: { reason: 'peer-scrutiny-required', owner: null },
      }
    case 'record-verification-review':
      return {
        state: 'blocked',
        block: {
          reason: 'verification-required',
          owner: governanceOwner(next.owningDepartmentId),
        },
      }
    case 'record-devils-advocate-review':
      return {
        state: 'blocked',
        block: {
          reason: 'challenge-required',
          owner: governanceOwner(next.owningDepartmentId),
        },
      }
    case 'resolve-risk-requirement':
    case 'record-risk-review':
      return {
        state: 'blocked',
        block: {
          reason: 'risk-review-required',
          owner: governanceOwner(next.owningDepartmentId),
        },
      }
    case 'resubmit-after-return':
      return { state: 'blocked', block: { reason: 'returned-for-revision', owner: null } }
    default:
      return exhaustive(next.act)
  }
}

/** An institutional act the contract has not mapped cannot reach a host unnamed. */
function exhaustive(act: never): never {
  throw new Error(`Unmapped institutional act: ${String(act)}`)
}

/**
 * The person's additions, counted, with the one fact a host must say beside
 * them: whether work already done predates the latest.
 */
export function amendmentsFor(overview: CaseOverview): HostAmendments {
  const latest = overview.amendments[overview.amendments.length - 1] ?? null
  return {
    count: overview.amendments.length,
    latestAt: latest?.at ?? null,
    workPredates:
      latest !== null && overview.runs.some((run) => run.startedAt < latest.at),
  }
}

export function activityFor(overview: CaseOverview, now: string): HostActivity {
  const engaged = new Set<string>([
    ...overview.assignments.map((assignment) => assignment.departmentId),
    ...overview.departments.map((department) => department.id),
  ])
  return {
    stage: overview.standing.stage,
    desks: overview.roster
      .filter((desk) => engaged.has(desk.id))
      .map(({ id, name, isGovernance }) => ({ id, name, isGovernance })),
    outstanding: overview.standing.steps
      .filter((step) => step.status === 'outstanding')
      .map((step) => step.step),
    inFlight: overview.runs.filter((run) => withinExecutionWindow(run, now)).length,
    expired: expiredRuns(overview, now).length,
    awaitingAdoption: heldRuns(overview).length,
  }
}

/* ---------------------------------------------------------- the answer */

const thesisOf = (revision: InvestmentThesis): AnswerThesis => ({
  revisionId: revision.revisionId,
  statement: revision.statement,
  position: revision.position,
  invalidationCriteria: revision.invalidationCriteria,
  ...(revision.horizon ? { horizon: revision.horizon } : {}),
  implications: revision.implications,
  proposedByDepartmentId: revision.proposedByDepartmentId,
})

/** Every objection in the timeline, with the act that filed it beside it. */
function objectionsOf(timeline: BoardroomTimeline): HostObjection[] {
  const objections: HostObjection[] = []
  for (const entry of timeline.entries) {
    if (!entry.objections) continue
    const raisedAs =
      entry.kind === 'peer-examination' ? 'peer-examination' : 'devils-advocate'
    for (const objection of entry.objections) {
      objections.push({
        ...objection,
        reviewId: entry.id,
        byDepartmentId: entry.byDepartmentId,
        raisedAs,
        superseded: entry.superseded === true,
      })
    }
  }
  return objections
}

/**
 * The answer, read from the record. The CIO's decision where the case is
 * settled on one; otherwise the committee's conclusion where it is ready;
 * otherwise `null`. The same predicates `productStateFor` uses, so the kind a
 * `status` announces is the kind a `result` delivers.
 */
export function institutionalAnswerFor(
  overview: CaseOverview,
): InstitutionalAnswer | null {
  const decision = liveDecision(overview)
  if (decision) {
    const selected =
      decision.outcome.kind === 'selected'
        ? (overview.revisions.find(
            (revision) => revision.revisionId === decision.outcome.selectedRevisionId,
          ) ?? null)
        : null

    return {
      kind: 'cio-decision',
      decision: {
        decisionId: decision.decisionId,
        outcome: decision.outcome.kind,
        consideredRevisionIds: decision.outcome.consideredRevisionIds,
        rationale: decision.rationale,
        decidedAt: decision.decidedAt,
        decidedByEmployeeId: decision.decidedByEmployeeId,
        authorizationBasis: decision.authorizationBasis,
        evidenceSetId: decision.evidenceSetId,
      },
      thesis: selected ? thesisOf(selected) : null,
      dissent: decision.unresolvedDissent.map((entry) => ({
        sourceId: entry.sourceId,
        source: entry.source,
        materiality: entry.materiality,
        rationale: entry.rationale,
        ...(entry.raisedByDepartmentId
          ? { raisedByDepartmentId: entry.raisedByDepartmentId }
          : {}),
        ...(entry.acknowledgement ? { acknowledgement: entry.acknowledgement } : {}),
        disposition: entry.dispositionAtDecision,
      })),
      /*
       * "Material or above" is the domain's reading, not this module's: the
       * same rule that decides whether the CIO owed an acknowledgement decides
       * whether a host may leave it unsaid.
       */
      materialDissentCount: decision.unresolvedDissent.filter((entry) =>
        dissentRequiresAcknowledgement(entry.materiality),
      ).length,
      reconsiderationTriggers: decision.reconsiderationTriggers.map((trigger) => ({
        id: trigger.id,
        conditionType: trigger.conditionType,
        rationale: trigger.rationale,
        ...(trigger.qualitativeCondition
          ? { qualitativeCondition: trigger.qualitativeCondition }
          : {}),
        ...(trigger.threshold ? { threshold: trigger.threshold } : {}),
      })),
    }
  }

  if (!committeeConclusionReady(overview)) return null
  const current = currentRevision(overview)!
  const forCurrent = <T extends { revisionId?: string }>(reviews: readonly T[]) =>
    reviews.filter((review) => review.revisionId === current.revisionId)
  const latest = <T>(reviews: readonly T[]) => reviews[reviews.length - 1] ?? null
  const timeline = boardroomTimeline(overview)
  const open = objectionsOf(timeline).filter(
    (objection) => objection.outcome === 'open' && !objection.superseded,
  )
  const synthesis = overview.aggregations.find(
    (aggregation) => aggregation.producedRevisionId === current.revisionId,
  )

  return {
    kind: 'committee-conclusion',
    thesis: thesisOf(current),
    synthesisedBy: deskOf(overview, synthesis?.departmentId ?? null),
    scrutiny: {
      verification: latest(forCurrent(overview.verification))?.status ?? null,
      risk: latest(forCurrent(overview.risk))?.status ?? null,
      peerExaminations: forCurrent(overview.peerExaminations).length,
      devilsAdvocateReviews: forCurrent(overview.devilsAdvocate).length,
    },
    dissent: open,
    materialDissentCount: open.filter((objection) =>
      dissentRequiresAcknowledgement(objection.materiality),
    ).length,
  }
}

/* --------------------------------------------------------- inspection */

/**
 * Deeper material, from the projections the Boardroom already renders.
 * `null` for a desk the organisation does not have.
 */
export function inspectionFor(
  overview: CaseOverview,
  view: InspectView,
): HostInspection | null {
  const timeline = boardroomTimeline(overview)

  if (view.kind === 'debate') {
    return {
      view: 'debate',
      entries: timeline.entries,
      seats: boardroomSeating(overview, timeline),
    }
  }

  if (view.kind === 'objections') {
    return { view: 'objections', objections: objectionsOf(timeline) }
  }

  const desk = deskOf(overview, view.departmentId)
  if (!desk) return null
  const seat = boardroomSeating(overview, timeline).find(
    (candidate) => candidate.departmentId === desk.id,
  )
  const entries: BoardroomEntry[] = timeline.entries.filter(
    (entry) => entry.byDepartmentId === desk.id,
  )
  const claimIds = new Set(entries.flatMap((entry) => entry.claimIds ?? []))
  return {
    view: 'desk',
    desk,
    participation: seat?.participation ?? 'not-in-case',
    entries,
    claims: overview.claims
      .filter((claim) => claimIds.has(claim.id))
      .map((claim) => ({
        id: claim.id,
        statement: claim.statement,
        type: claim.type,
        status: claim.status,
        confidence: claim.confidence.level,
        ...(claim.supportsThesisId ? { supportsThesisId: claim.supportsThesisId } : {}),
        ...(claim.opposesThesisId ? { opposesThesisId: claim.opposesThesisId } : {}),
      })),
  }
}

/* ------------------------------------------------------------ the gateway */

export interface HostGatewayDeps {
  system: FinancialOsSystem
  /** Who is asking — resolved by the server from its own configuration, never by the caller. */
  operator: () => Promise<CurrentOperatorResult>
  /** Where the product's surfaces for a case live. Route knowledge stays with the caller. */
  surfaces: (caseId: string) => HostSurfaces
  /** How this host is recorded as initiator. */
  orchestratorId: string
  /** Domain time, for reading a run's execution window against. */
  now: () => string
}

export type HostGateway = (request: HostRequest) => Promise<HostResult>

export function createHostGateway(deps: HostGatewayDeps): HostGateway {
  const { system, operator, surfaces, orchestratorId, now } = deps

  /** What the firm started and withheld, with the desks named as the organisation names them. */
  const commissionFor = (overview: CaseOverview, commission: CaseCommission): HostCommission => ({
    evidence: commission.evidence
      ? {
          family: commission.evidence.family,
          from: commission.evidence.from,
          to: commission.evidence.to,
          observations: commission.evidence.observations,
        }
      : null,
    started: commission.started
      .map((entry) => deskOf(overview, entry.departmentId))
      .filter((desk): desk is HostDesk => desk !== null),
    withheld: commission.withheld.map((entry) => ({
      desk: deskOf(overview, entry.departmentId),
      reason: entry.reason,
    })),
  })

  /** The case as the host sees it, read now. */
  async function present(
    caseId: string,
    wants: { answer?: boolean; view?: InspectView; commission?: CaseCommission } = {},
  ): Promise<HostResult> {
    const overview = await system.overview(caseId)
    if (!overview) return { state: 'unsupported', reason: 'unknown-reference' }
    const reference = await system.reference(caseId)

    const at = now()
    const product = productStateFor(overview, at)

    /*
     * The first commit landed and the second did not. Not a state of the
     * committee's work, because there is no committee yet; the remedy is the
     * host's `resume`, and the result says so. A case closed before it was
     * ever convened is closed, not resumable.
     */
    if (!overview.investmentCase.playbookId && product.state !== 'closed') {
      return {
        state: 'failed',
        reason: 'convening-incomplete',
        reference,
        resumable: true,
      }
    }
    if (product.state === 'unsupported') {
      return { state: 'unsupported', reason: product.reason, reference }
    }

    let inspection: HostInspection | undefined
    if (wants.view) {
      const built = inspectionFor(overview, wants.view)
      if (!built) return { state: 'unsupported', reason: 'unknown-desk', reference }
      inspection = built
    }

    const context = {
      reference,
      question: overview.investmentCase.question,
      subject: overview.investmentCase.subject.displayName,
      surfaces: surfaces(caseId),
      activity: activityFor(overview, at),
      amendments: amendmentsFor(overview),
      ...(inspection ? { inspection } : {}),
      ...(wants.commission ? { commission: commissionFor(overview, wants.commission) } : {}),
    }

    switch (product.state) {
      case 'closed':
        return { ...context, state: 'closed', closure: product.closure }
      case 'working':
        return { ...context, state: 'working' }
      case 'answer-ready': {
        const answer = wants.answer ? institutionalAnswerFor(overview) : null
        return {
          ...context,
          state: 'answer-ready',
          kind: product.kind,
          ...(answer ? { answer } : {}),
        }
      }
      case 'blocked':
        return { ...context, state: 'blocked', block: product.block }
      case 'needs-decision':
        return { ...context, state: 'needs-decision', decision: product.decision }
    }
  }

  /** What a delegation came back with, in product terms. */
  async function afterDelegation(
    outcome: StartInvestmentCaseResult,
  ): Promise<HostResult> {
    if (outcome.state === 'convened') return present(outcome.caseId)
    if (outcome.state === 'convening-incomplete') {
      return {
        state: 'failed',
        reason: 'convening-incomplete',
        code: outcome.code,
        reference: await system.reference(outcome.caseId),
        resumable: true,
      }
    }
    switch (outcome.code) {
      case 'NOT_ROUTABLE':
        return { state: 'unsupported', reason: 'not-routable' }
      case 'NOT_FOUND':
        return { state: 'unsupported', reason: 'unknown-reference' }
      case 'UNKNOWN_OPERATOR':
        return { state: 'failed', reason: 'operator-unresolved', code: outcome.code }
      case 'QUESTION_REQUIRED':
      case 'SUBJECT_REQUIRED':
      case 'REQUEST_ID_REQUIRED':
        return { state: 'failed', reason: 'invalid-request', code: outcome.code }
      case 'SERVICE_UNAVAILABLE':
        return { state: 'failed', reason: 'service-unavailable' }
      default:
        return { state: 'failed', reason: 'refused', code: outcome.code }
    }
  }

  /**
   * What an act on the open case came back with, in product terms. Done is
   * the case re-read — an addition shows in `amendments`, a closure as
   * `closed` — so the host never holds a claim the record does not make.
   */
  async function afterAct(
    outcome: CaseActResult<unknown>,
    reference: DomainReference,
  ): Promise<HostResult> {
    switch (outcome.state) {
      case 'done':
        return present(reference.id)
      case 'refused':
        switch (outcome.code) {
          case 'not-found':
            return { state: 'unsupported', reason: 'unknown-reference', reference }
          case 'illegal-prior-state':
            return { state: 'failed', reason: 'case-settled', reference }
          default:
            return { state: 'failed', reason: 'refused', code: outcome.code, reference }
        }
      case 'failed':
      case 'unresolved':
        return { state: 'failed', reason: 'service-unavailable', reference }
    }
  }

  /** The firm's reference or nothing: another system's, or another kind's, is not ours. */
  const ours = (reference: DomainReference): boolean =>
    reference.system === FINANCIAL_OS_SYSTEM_ID && reference.kind === 'case'

  /** Whoever the server says is asking. The request never says. */
  async function delegationFor(
    requestId: string,
  ): Promise<{ ok: false; result: HostResult } | { ok: true; delegation: Delegation }> {
    const who = await operator()
    if (!who.ok) {
      return {
        ok: false,
        result: { state: 'failed', reason: 'operator-unresolved', code: who.code },
      }
    }
    return {
      ok: true,
      delegation: {
        requestId,
        actingEmployeeId: who.operator.employeeId,
        orchestratorId,
      },
    }
  }

  return async (request): Promise<HostResult> => {
    switch (request.kind) {
      case 'ask': {
        const who = await delegationFor(request.requestId)
        if (!who.ok) return who.result
        return afterDelegation(
          await system.ask(who.delegation, {
            question: request.question,
            subjectDisplayName: request.subject,
          }),
        )
      }
      case 'resume': {
        if (!ours(request.reference))
          return { state: 'unsupported', reason: 'unknown-reference' }
        const who = await delegationFor(request.reference.id)
        if (!who.ok) return who.result
        return afterDelegation(await system.resume(who.delegation, request.reference.id))
      }
      case 'status':
        if (!ours(request.reference))
          return { state: 'unsupported', reason: 'unknown-reference' }
        return present(request.reference.id)
      case 'result':
        if (!ours(request.reference))
          return { state: 'unsupported', reason: 'unknown-reference' }
        return present(request.reference.id, { answer: true })
      case 'inspect':
        if (!ours(request.reference))
          return { state: 'unsupported', reason: 'unknown-reference' }
        return present(request.reference.id, { view: request.view })
      case 'amend': {
        if (!ours(request.reference))
          return { state: 'unsupported', reason: 'unknown-reference' }
        const who = await delegationFor(request.requestId)
        if (!who.ok) return who.result
        return afterAct(
          await system.amend(who.delegation, request.reference.id, request.text),
          request.reference,
        )
      }
      case 'close': {
        if (!ours(request.reference))
          return { state: 'unsupported', reason: 'unknown-reference' }
        const who = await delegationFor(`${request.reference.id}-close`)
        if (!who.ok) return who.result
        return afterAct(
          await system.close(who.delegation, request.reference.id, request.reason),
          request.reference,
        )
      }
      case 'begin': {
        if (!ours(request.reference))
          return { state: 'unsupported', reason: 'unknown-reference' }
        const who = await delegationFor(request.requestId)
        if (!who.ok) return who.result
        const outcome = await system.begin(who.delegation, request.reference.id, request.opening)
        if (outcome.state !== 'done') return afterAct(outcome, request.reference)
        /* The case re-read, with what the firm started and withheld beside it. */
        return present(request.reference.id, { commission: outcome.value.commission })
      }
      default:
        return unreachable(request)
    }
  }
}

/** A request kind the contract does not name cannot get here: the parser is the door. */
function unreachable(request: never): never {
  throw new Error(`Unhandled host request: ${JSON.stringify(request)}`)
}
