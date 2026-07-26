/**
 * Agent run records — a department's contribution to a case.
 *
 * Note what this is NOT: the aggregate root. An earlier draft made the run
 * central, which quietly models an agent system rather than a firm. A run is
 * one department doing one piece of work on one case, and it is subordinate to
 * the case for the same reason a memo is subordinate to the deal it concerns.
 *
 * Four version axes are recorded, because any one of them changing invalidates
 * a cached result and has to be visible in an audit: the agent contract, the
 * output schema, the prompt, and the model. "The macro team said X last
 * Tuesday" means nothing without them.
 *
 * Nothing here calls a model. Phase A defines the record; Phase B fills it.
 */

import type { AgentClaim } from './claims'
import type { CaseId } from './cases'
import type { AssignmentId } from './work'
import type { DepartmentId, EmployeeId } from './organization'

export type RunId = string

/* ------------------------------------------------------ prompt and model ids */

/**
 * Which prompt produced this.
 *
 * `contentHash` alongside the version because a version number is a promise
 * and a hash is a fact — an edited prompt that kept its version is detectable.
 */
export interface PromptRef {
  id: string
  version: string
  contentHash: string
}

/**
 * Which model, configured how.
 *
 * `parametersHash` covers temperature, top-p, seed and anything else that
 * changes the output. Two runs of the same prompt on the same model with
 * different temperatures are not the same run and must not share a cache key.
 */
export interface ModelRef {
  id: string
  provider: string
  parameters: Readonly<Record<string, string | number | boolean>>
  parametersHash: string
}

/* --------------------------------------------------------------- run record */

/**
 * The run state machine.
 *
 * Deliberately richer than "running / done / failed", because the intermediate
 * states are the ones the headquarters floor needs: a department waiting on a
 * dependency looks identical to an idle one unless the difference is recorded.
 *
 * These describe EXECUTION only. Whether the resulting work is verified,
 * challenged, approved, selected or published are separate dimensions carried
 * by the review records — a technically completed contribution is not an
 * approved one, and folding them into one status field would make it
 * impossible to say "finished, and rejected".
 */
export type RunState =
  | 'queued'
  /** Cannot start: a declared dependency has not completed. */
  | 'waiting-for-dependencies'
  /** Dependencies satisfied, awaiting a slot. */
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed-out'
  | 'cancelled'
  /** The thesis revision it was working against was superseded mid-flight. */
  | 'superseded'
  /** An upstream dependency failed, so this can never run. Not a failure. */
  | 'blocked'

const RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = Object.freeze({
  queued: ['waiting-for-dependencies', 'ready', 'cancelled', 'blocked'],
  'waiting-for-dependencies': ['ready', 'blocked', 'cancelled', 'superseded'],
  ready: ['running', 'cancelled', 'blocked', 'superseded'],
  running: ['completed', 'failed', 'timed-out', 'cancelled', 'superseded'],
  completed: ['superseded'],
  failed: [],
  'timed-out': [],
  cancelled: [],
  superseded: [],
  blocked: ['ready'],
})

export function canTransitionRun(from: RunState, to: RunState): boolean {
  return RUN_TRANSITIONS[from].includes(to)
}

/** States after which no further work happens. */
export const TERMINAL_RUN_STATES: readonly RunState[] = [
  'completed',
  'failed',
  'timed-out',
  'cancelled',
  'superseded',
] as const

export function isRunTerminal(state: RunState): boolean {
  return TERMINAL_RUN_STATES.includes(state)
}

/**
 * A recorded change of run state.
 *
 * Together with case and thesis transitions, the ONLY permitted source of
 * visible organizational activity. Carries no prose: the floor's wording is
 * generated in the presentation layer from these structured facts, so nothing
 * can write "Macro Team is studying the Fed" without a run having entered a
 * state to support it.
 */
export interface RunEvent {
  runId: RunId
  at: string
  state: RunState
  /** Required when moving to a stalling state. */
  reason?: string
}

/** Cost accounting. Defined in Phase A, populated when a live provider exists. */
export interface RunCost {
  inputTokens: number
  outputTokens: number
  /** Minor currency units, to avoid float drift on money. */
  costMinorUnits: number
  currency: string
}

export interface AgentRunRecord {
  id: RunId
  /** The case this contributes to. A run never exists on its own. */
  caseId: CaseId
  assignmentId: AssignmentId
  departmentId: DepartmentId
  employeeId: EmployeeId

  /** Four independent version axes. */
  agentContractVersion: string
  outputSchemaVersion: string
  prompt: PromptRef
  model: ModelRef

  /** What it reasoned over. Content-addressed, so replay is exact. */
  evidenceSetId: string

  state: RunState
  /** The thesis revision this contributes to, when the work is thesis-scoped. */
  revisionId?: string
  startedAt: string
  completedAt?: string
  /** Ordered, oldest first. Feeds the activity projection. */
  events: readonly RunEvent[]

  claims: readonly AgentClaim[]
  cost?: RunCost
  /** Present when the run failed, timed out, was blocked or cancelled. */
  failureReason?: string
  /**
   * True when the result arrived after the revision it targeted was
   * superseded.
   *
   * Retained against the OLD revision rather than silently reattached to the
   * new one: the work reasoned over different assumptions, and moving it would
   * attribute conclusions to a thesis that never saw them.
   */
  obsolete?: boolean
}

/**
 * The key a Phase B cache would use.
 *
 * Every input that can change the output, and nothing else. Deliberately NOT
 * the market-data cache key shape: agent results are expensive, immutable and
 * exact-match only — a stale agent conclusion about last week's evidence is
 * more dangerous than stale data, because it reads as current analysis.
 */
export function runCacheKey(run: {
  departmentId: DepartmentId
  agentContractVersion: string
  outputSchemaVersion: string
  prompt: PromptRef
  model: ModelRef
  evidenceSetId: string
}): string {
  return [
    run.departmentId,
    run.agentContractVersion,
    run.outputSchemaVersion,
    run.prompt.id,
    run.prompt.version,
    run.prompt.contentHash,
    run.model.provider,
    run.model.id,
    run.model.parametersHash,
    run.evidenceSetId,
  ].join('|')
}

export function buildRunRecord(record: AgentRunRecord): AgentRunRecord {
  const needsReason: readonly RunState[] = ['failed', 'timed-out', 'blocked', 'cancelled']
  if (needsReason.includes(record.state) && !record.failureReason) {
    throw new Error(`Run "${record.id}" is ${record.state} without a reason`)
  }
  if (record.state === 'completed' && !record.completedAt) {
    throw new Error(`Run "${record.id}" is completed but has no completion time`)
  }
  return Object.freeze({
    ...record,
    events: Object.freeze([...record.events]),
    claims: Object.freeze([...record.claims]),
  })
}

/* ------------------------------------------------------------ activity feed */

/**
 * A structured activity fact.
 *
 * No prose. The presentation layer turns this into a sentence; storing the
 * sentence would let anything write activity with no work behind it.
 */
export interface ActivityItem {
  at: string
  departmentId: DepartmentId
  subject: 'run' | 'case'
  fromState: string | null
  toState: string
  caseId: CaseId
  runId?: RunId
}

/**
 * Projects activity from recorded state changes.
 *
 * The signature is the guarantee: run events and case transitions in, activity
 * out. There is no parameter through which invented activity could enter,
 * which is how "the organization must feel alive" and "never fabricate
 * activity" hold at the same time.
 */
export function projectActivity(
  runs: readonly AgentRunRecord[],
  caseTransitions: ReadonlyArray<{
    at: string
    byDepartmentId: DepartmentId
    caseId: CaseId
    from: string
    to: string
  }>,
  limit = 20,
): ActivityItem[] {
  const fromRuns: ActivityItem[] = runs.flatMap((run) =>
    run.events.map((event, index) => ({
      at: event.at,
      departmentId: run.departmentId,
      subject: 'run' as const,
      fromState: run.events[index - 1]?.state ?? null,
      toState: event.state,
      caseId: run.caseId,
      runId: run.id,
    })),
  )

  const fromCases: ActivityItem[] = caseTransitions.map((transition) => ({
    at: transition.at,
    departmentId: transition.byDepartmentId,
    subject: 'case' as const,
    fromState: transition.from,
    toState: transition.to,
    caseId: transition.caseId,
  }))

  return [...fromRuns, ...fromCases]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
}
