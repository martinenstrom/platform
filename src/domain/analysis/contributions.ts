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

export type RunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  /** Stopped because it would exceed its cost or token budget. */
  | 'budget-exceeded'
  | 'timed-out'

/**
 * A recorded change of run status.
 *
 * The other half of the live activity feed. Together with `CaseTransition`
 * these are the ONLY permitted sources of visible organizational activity —
 * the headquarters may show "Fact Checker verifying earnings numbers, 09:07"
 * exactly when a run entered that state at 09:07, and never otherwise. The
 * floor looks alive because it is, not because a timer is inventing events.
 */
export interface RunEvent {
  runId: RunId
  at: string
  status: RunStatus
  /** Short, human-readable: what the department is doing right now. */
  activity?: string
}

/** Cost accounting. Defined in Phase A, populated in Phase B. */
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

  status: RunStatus
  startedAt: string
  completedAt?: string
  /** Ordered, oldest first. Feeds the activity projection. */
  events: readonly RunEvent[]

  claims: readonly AgentClaim[]
  cost?: RunCost
  /** Present when `status` is `failed`. */
  failureReason?: string
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
  if (record.status === 'failed' && !record.failureReason) {
    throw new Error(`Run "${record.id}" failed without a reason`)
  }
  if (record.status === 'completed' && !record.completedAt) {
    throw new Error(`Run "${record.id}" is completed but has no completion time`)
  }
  return Object.freeze({
    ...record,
    events: Object.freeze([...record.events]),
    claims: Object.freeze([...record.claims]),
  })
}

/* ------------------------------------------------------------ activity feed */

/** One line on the headquarters activity feed. */
export interface ActivityItem {
  at: string
  departmentId: DepartmentId
  description: string
  source: 'run' | 'case'
}

/**
 * Projects the activity feed from recorded state changes.
 *
 * The signature is the guarantee: it takes run events and case transitions and
 * nothing else. There is no parameter through which invented activity could
 * enter, which is how "the organization must feel alive" and "never fabricate
 * activity" are satisfied at the same time.
 */
export function projectActivity(
  runs: readonly AgentRunRecord[],
  caseTransitions: ReadonlyArray<{
    at: string
    byDepartmentId: DepartmentId
    from: string
    to: string
  }>,
  limit = 20,
): ActivityItem[] {
  const fromRuns: ActivityItem[] = runs.flatMap((run) =>
    run.events.map((event) => ({
      at: event.at,
      departmentId: run.departmentId,
      description: event.activity ?? `run ${event.status}`,
      source: 'run' as const,
    })),
  )

  const fromCases: ActivityItem[] = caseTransitions.map((transition) => ({
    at: transition.at,
    departmentId: transition.byDepartmentId,
    description: `case moved ${transition.from} → ${transition.to}`,
    source: 'case' as const,
  }))

  return [...fromRuns, ...fromCases]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
}
