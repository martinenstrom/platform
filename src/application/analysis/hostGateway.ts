/**
 * The gateway: one host request in, one typed product state out.
 *
 * Sits on `FinancialOsSystem` and adds no institutional behaviour. What it adds
 * is translation — the firm interprets its own record and answers in the five
 * product states the host understands — and a refusal to be anything more.
 *
 * ## `working` is proven, never assumed
 *
 * A run in state `running` **and inside its own recorded deadline** is the
 * only persisted fact that means work is genuinely under way. A case that was
 * just convened has nothing running; a run that finished and awaits its
 * desk's adoption has nothing running; a case blocked on a human act has
 * nothing running. None of them is `working`, because a host that says "jag
 * återkommer" on the strength of any of them would be promising work nobody
 * is doing.
 *
 * The deadline matters because a `running` row outlives the process that
 * wrote it. Measured on the dev firm on 2026-09-14: a stub run started on
 * 2026-09-06 still sat in `running` a week later, and a first cut of this
 * derivation reported it as work. Every live run records the wall clock it
 * was authorised — the firm refuses to start one without — so "running and
 * not yet past that clock" is a bound the firm wrote down, not a threshold
 * invented here. A running row with no measured deadline, or past it, is
 * counted as `unverified` and is not work the host may promise.
 *
 * ## `answer-ready` is the firm's decision, not a model's prose
 *
 * A live CIO decision on a settled case. The answer that travels with it is
 * read field by field from that decision, the revision it selected, the
 * dissent it acknowledged and the triggers it set. Nothing generates it.
 *
 * ## `needs-decision` names the seam it stopped at
 *
 * TD-88 first: a convened case with no thesis is `institutional-initialization-
 * required`, and the gateway does not propose one. A case with the CIO is
 * `cio-decision-required`. Anything else outstanding is
 * `institutional-act-required` with the firm's own name for the act and the
 * desk that owes it.
 *
 * ## The host holds a reference, and the firm re-reads
 *
 * A reference's `provenanceId` is what the host read it under. It is never
 * used to answer: every call reads the case again, and the reference returned
 * carries the provenance of that read. A stale reference is therefore not a
 * stale answer.
 */

import { dissentRequiresAcknowledgement, type AgentRunRecord } from '~/domain/analysis'
import type { CaseOverview } from './caseOverview'
import { boardroomTimeline, type BoardroomEntry } from './boardroomTimeline'
import { boardroomSeating } from './boardroomSeating'
import type { CurrentOperatorResult } from './currentOperator'
import type { Delegation, DomainReference, FinancialOsSystem } from './domainSystem'
import type { StartInvestmentCaseResult } from './startInvestmentCase'
import { FINANCIAL_OS_SYSTEM_ID } from './domainSystem'
import type {
  HostActivity,
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
  | { state: 'answer-ready' }
  | { state: 'needs-decision'; decision: HostDecision }
  | { state: 'unsupported'; reason: 'no-institutional-conclusion' }

const deskOf = (overview: CaseOverview, departmentId: string | null): HostDesk | null => {
  if (!departmentId) return null
  const found = overview.roster.find((desk) => desk.id === departmentId)
  return found
    ? { id: found.id, name: found.name, isGovernance: found.isGovernance }
    : null
}

/**
 * Whether a run's own record says it can still be executing.
 *
 * `running`, with a measured deadline the clock has not passed. A run without
 * a measured deadline cannot be verified either way, and is not claimed.
 */
export function verifiablyRunning(run: AgentRunRecord, now: string): boolean {
  if (run.state !== 'running') return false
  if (run.budget.deadline.kind !== 'limit') return false
  return Date.parse(run.startedAt) + run.budget.deadline.deadlineMs > Date.parse(now)
}

export function productStateFor(overview: CaseOverview, now: string): ProductState {
  /*
   * In flight wins. Whatever else the case owes, a run that is verifiably
   * executing is work the firm is doing right now, and that is the one thing
   * `working` may mean.
   */
  if (overview.runs.some((run) => verifiablyRunning(run, now)))
    return { state: 'working' }

  /*
   * A live decision on a settled case. A decision that still stands while the
   * case is back with the CIO — a deferral reopened — is history, not the
   * answer, and falls through to the CIO's queue below.
   */
  if (overview.decision && overview.standing.settled) return { state: 'answer-ready' }

  const next = overview.standing.nextAct
  switch (next.act) {
    case 'propose-thesis':
      /* TD-88. The question is registered, the committee convened, and no one is authorised to open. */
      return {
        state: 'needs-decision',
        decision: { reason: 'institutional-initialization-required' },
      }
    case 'decide-or-return':
      return { state: 'needs-decision', decision: { reason: 'cio-decision-required' } }
    case 'none-settled':
      /* Settled with nothing to stand behind. Reported, not dressed up. */
      return { state: 'unsupported', reason: 'no-institutional-conclusion' }
    default:
      return {
        state: 'needs-decision',
        decision: {
          reason: 'institutional-act-required',
          act: next.act,
          owner: deskOf(overview, next.owningDepartmentId),
        },
      }
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
    inFlight: overview.runs.filter((run) => verifiablyRunning(run, now)).length,
    unverified: overview.runs.filter(
      (run) => run.state === 'running' && !verifiablyRunning(run, now),
    ).length,
    awaitingAdoption: overview.runs.filter((run) => run.state === 'awaiting-acceptance')
      .length,
  }
}

/**
 * The answer, read from the decision. `null` where the case holds no live
 * decision — the caller has already established that it does.
 */
export function institutionalAnswerFor(
  overview: CaseOverview,
): InstitutionalAnswer | null {
  const decision = overview.decision
  if (!decision) return null

  const selected =
    decision.outcome.kind === 'selected'
      ? (overview.revisions.find(
          (revision) => revision.revisionId === decision.outcome.selectedRevisionId,
        ) ?? null)
      : null

  return {
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
    thesis: selected
      ? {
          revisionId: selected.revisionId,
          statement: selected.statement,
          position: selected.position,
          invalidationCriteria: selected.invalidationCriteria,
          ...(selected.horizon ? { horizon: selected.horizon } : {}),
          implications: selected.implications,
          proposedByDepartmentId: selected.proposedByDepartmentId,
        }
      : null,
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
    return { view: 'objections', objections }
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
  /** Domain time, for reading a run's deadline against. */
  now: () => string
}

export type HostGateway = (request: HostRequest) => Promise<HostResult>

export function createHostGateway(deps: HostGatewayDeps): HostGateway {
  const { system, operator, surfaces, orchestratorId, now } = deps

  /** The case as the host sees it, read now. */
  async function present(
    caseId: string,
    wants: { answer?: boolean; view?: InspectView } = {},
  ): Promise<HostResult> {
    const overview = await system.overview(caseId)
    if (!overview) return { state: 'unsupported', reason: 'unknown-reference' }
    const reference = await system.reference(caseId)

    /*
     * The first commit landed and the second did not. Not a state of the
     * committee's work, because there is no committee yet; the remedy is the
     * host's `resume`, and the result says so.
     */
    if (!overview.investmentCase.playbookId) {
      return {
        state: 'failed',
        reason: 'convening-incomplete',
        reference,
        resumable: true,
      }
    }

    const at = now()
    const product = productStateFor(overview, at)
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
      ...(inspection ? { inspection } : {}),
    }

    switch (product.state) {
      case 'working':
        return { ...context, state: 'working' }
      case 'answer-ready': {
        const answer = wants.answer ? institutionalAnswerFor(overview) : null
        return { ...context, state: 'answer-ready', ...(answer ? { answer } : {}) }
      }
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
      default:
        return unreachable(request)
    }
  }
}

/** A request kind the contract does not name cannot get here: the parser is the door. */
function unreachable(request: never): never {
  throw new Error(`Unhandled host request: ${JSON.stringify(request)}`)
}
