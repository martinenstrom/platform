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

/* ------------------------------------------------------- execution identity */

/**
 * What actually ran, expressed so that a stub cannot pretend to be a model.
 *
 * The columns were `prompt_*` and `model_*`, NOT NULL, from a design where
 * every run came from a model. A deterministic stub has neither, so it filled
 * them with placeholders — and a placeholder in a field named `model_provider`
 * is a real model identity to every reader downstream, however honest the
 * intent was. The rule this union exists to make structural: **nothing may
 * carry a model reference unless a model produced it.**
 *
 * Three shapes, and the provider kind decides which are legal:
 *
 * | provider kind | permitted identities        |
 * | ------------- | --------------------------- |
 * | `live`        | `model`                     |
 * | `recorded`    | `model`, `unavailable`      |
 * | `stub`        | `scenario`                  |
 *
 * `recorded` takes both because a recording either captured what produced it
 * or did not. Where it did, that is the true model and must be preserved —
 * overwriting it with a placeholder would destroy the provenance the recording
 * exists for. Where it did not, the honest answer is that it is unavailable,
 * which is a fact and not a gap to fill.
 */
export type ExecutionIdentity =
  /** A model produced this, and here is exactly which. */
  | { kind: 'model'; prompt: PromptRef; model: ModelRef }
  /**
   * A replay whose artifact did not capture what produced it.
   *
   * Stated rather than left empty, because "we do not know" and "there was
   * nothing to know" are different facts about a contribution.
   */
  | { kind: 'unavailable'; reason: 'not-captured-by-recording'; recordingId: string }
  /** Synthetic output. There is no model and no prompt, and there was none. */
  | { kind: 'scenario'; scenarioId: string; stubVersion: string }

/** Which identities each kind of producer may present. */
const IDENTITIES_BY_PROVIDER: Readonly<
  Record<ProviderKind, readonly ExecutionIdentity['kind'][]>
> = Object.freeze({
  live: ['model'],
  recorded: ['model', 'unavailable'],
  stub: ['scenario'],
})

export function identityPermitted(
  providerKind: ProviderKind,
  identity: ExecutionIdentity,
): boolean {
  return IDENTITIES_BY_PROVIDER[providerKind].includes(identity.kind)
}

/**
 * The identity as a cache coordinate.
 *
 * Every field that can change the output, and nothing else. A stub keys on its
 * scenario and its build; an unavailable recording keys on the recording,
 * which is the only thing that determines what it replays.
 */
export function executionIdentityKey(identity: ExecutionIdentity): string {
  switch (identity.kind) {
    case 'model':
      return [
        'model',
        identity.prompt.id,
        identity.prompt.version,
        identity.prompt.contentHash,
        identity.model.provider,
        identity.model.id,
        identity.model.parametersHash,
      ].join('|')
    case 'unavailable':
      return ['unavailable', identity.reason, identity.recordingId].join('|')
    case 'scenario':
      return ['scenario', identity.scenarioId, identity.stubVersion].join('|')
  }
}

/** The model reference, where one legitimately exists. */
export function modelOf(identity: ExecutionIdentity): ModelRef | null {
  return identity.kind === 'model' ? identity.model : null
}

/** The prompt reference, where one legitimately exists. */
export function promptOf(identity: ExecutionIdentity): PromptRef | null {
  return identity.kind === 'model' ? identity.prompt : null
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

/**
 * Why a run stopped, from a closed vocabulary.
 *
 * Closed on purpose. The previous field was a free-text `failureReason`, and a
 * free-text field on a failure path is where a provider's response body, a
 * prompt or an evidence excerpt eventually lands — none of which may be stored
 * on a record that ends up in logs, metrics and read models. A category cannot
 * carry any of that.
 *
 * The specific detail belongs where detail belongs: the provider's own
 * telemetry, correlated by the run id.
 */
export type RunFailureCategory =
  /** The provider could not be reached at all. */
  | 'provider-unavailable'
  /** It was reached and did not answer in time. */
  | 'provider-timeout'
  /** It answered with an error. */
  | 'provider-error'
  /** It answered with something that is not a contribution. */
  | 'malformed-output'
  /** It answered in the right shape against the wrong schema version. */
  | 'schema-violation'
  /** A token, cost or time budget was exhausted. */
  | 'budget-exhausted'
  /** The evidence the run needed could not be resolved. */
  | 'evidence-unavailable'
  /** An upstream dependency failed, so this could never have run. */
  | 'upstream-failed'
  /** Withdrawn by the organization rather than failed by the provider. */
  | 'cancelled-by-organization'
  /** The revision it was working against was superseded mid-flight. */
  | 'revision-superseded'
  /** Ours, not theirs. */
  | 'internal-error'

export const RUN_FAILURE_CATEGORIES: readonly RunFailureCategory[] = [
  'provider-unavailable',
  'provider-timeout',
  'provider-error',
  'malformed-output',
  'schema-violation',
  'budget-exhausted',
  'evidence-unavailable',
  'upstream-failed',
  'cancelled-by-organization',
  'revision-superseded',
  'internal-error',
] as const

/**
 * The failure record.
 *
 * `retryable` is a judgement the provider boundary makes and the organization
 * acts on: a retryable failure returns the assignment to its queue, and a
 * non-retryable one leaves it failed for a person to decide about.
 */
export interface RunFailure {
  category: RunFailureCategory
  retryable: boolean
  /** 1 for the first attempt. Lets repeated provider trouble be visible. */
  attempt: number
  at: string
}

/** Cost accounting. Minor currency units throughout, to avoid float drift. */
export interface RunCost {
  inputTokens: number
  outputTokens: number
  costMinorUnits: number
  currency: string
}

/**
 * What a run consumed, in three states rather than a nullable number.
 *
 * A nullable column cannot distinguish the three things that are actually
 * true of different runs, and the ambiguity falls on the side that costs
 * money: `null` reads as free.
 *
 *   not-applicable  there was nothing to spend — a replay, a stub
 *   not-reported    real work whose provider did not tell us what it cost
 *   measured        a measurement, and **zero is a measurement**
 *
 * The third line is the one that needs saying. Once the state carries the
 * meaning, `costMinorUnits: 0` is a provider reporting that this call was
 * free, which is a different fact from a provider that said nothing — and
 * budget enforcement in C2 has to treat them differently or it will authorize
 * spend against unknowns.
 */
export type RunUsage =
  | { state: 'not-applicable' }
  | { state: 'not-reported' }
  | ({ state: 'measured' } & RunCost)

/** Which usage states each kind of producer may report. */
const USAGE_BY_PROVIDER: Readonly<Record<ProviderKind, readonly RunUsage['state'][]>> =
  Object.freeze({
    // A live call always consumed something; the question is whether anyone
    // measured it. `not-applicable` would be a claim that it was free.
    live: ['measured', 'not-reported'],
    // A replay consumes nothing now. Where the artifact captured what the
    // original cost, that measurement is worth keeping.
    recorded: ['not-applicable', 'measured'],
    stub: ['not-applicable'],
  })

export function usagePermitted(providerKind: ProviderKind, usage: RunUsage): boolean {
  return USAGE_BY_PROVIDER[providerKind].includes(usage.state)
}

/** The measurement, where one exists. */
export function measuredCost(usage: RunUsage): RunCost | null {
  return usage.state === 'measured' ? usage : null
}

/**
 * What kind of thing produced a contribution.
 *
 * The distinction the whole record rests on. A recorded fixture replayed in a
 * test and a live institutional agent doing real analysis must never be
 * indistinguishable once stored — a read model that cannot tell them apart
 * would present test output as work the firm stands behind, which is the same
 * failure as presenting fixture market data as live.
 */
export type ProviderKind =
  /** A captured real contribution, replayed deterministically. */
  | 'recorded'
  /** Synthetic output, generated to exercise a path. */
  | 'stub'
  /** A live provider doing real work. Not permitted before Phase C2. */
  | 'live'

export const PROVIDER_KINDS: readonly ProviderKind[] = ['recorded', 'stub', 'live']

/**
 * Which workflow and which producer stand behind a run.
 *
 * Distinct from `StorageProvenance`, which records the code that read and
 * wrote the row. This records the code that *decided the content*. TD-28
 * existed because only the first was answerable.
 */
export interface ExecutionProvenance {
  /** The exact playbook version whose entry this run is executing. */
  playbookId: string
  playbookVersion: string
  playbookEntryKey: string
  providerId: string
  providerVersion: string
  providerKind: ProviderKind
  /**
   * What ran, in a form the provider kind constrains.
   *
   * Beside `providerKind` rather than at the top of the record, so the two can
   * be checked against each other in one place: a stub carrying a model
   * reference is not a run to be interpreted carefully, it is a run that must
   * not exist.
   */
  identity: ExecutionIdentity
}

export interface AgentRunRecord {
  id: RunId
  /** The case this contributes to. A run never exists on its own. */
  caseId: CaseId
  assignmentId: AssignmentId
  departmentId: DepartmentId
  employeeId: EmployeeId

  /**
   * The two version axes every producer has.
   *
   * The other two — prompt and model — live on `execution.identity`, because
   * only a producer that used a model has them at all.
   */
  agentContractVersion: string
  outputSchemaVersion: string

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
  /**
   * What it consumed. Required, because "we did not record this" is one of the
   * states rather than the absence of all of them.
   */
  usage: RunUsage
  /** Present when the run failed, timed out, was blocked or cancelled. */
  failure?: RunFailure
  /**
   * What produced this work, and under which workflow.
   *
   * Required, and `providerKind` is the field that matters: a recorded fixture
   * and a live institutional agent must never be indistinguishable downstream.
   * A run that could not say which it was would let test output serialize as
   * analysis the firm stands behind.
   */
  execution: ExecutionProvenance
  /**
   * Declared optional inputs that had NOT completed when this run started.
   *
   * Captured at start rather than derived later, because it is a fact about
   * the conditions the work was done under. Derived at read time it would
   * change as late contributions arrived, and the record would stop describing
   * what the desk actually had.
   */
  missingOptionalInputs: readonly string[]
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
  identity: ExecutionIdentity
  evidenceSetId: string
}): string {
  return [
    run.departmentId,
    run.agentContractVersion,
    run.outputSchemaVersion,
    executionIdentityKey(run.identity),
    run.evidenceSetId,
  ].join('|')
}

export function buildRunRecord(record: AgentRunRecord): AgentRunRecord {
  /*
   * The illegal combination, refused by construction rather than by review: a
   * stub presenting a model, or a live run that cannot say which model ran.
   * Both are records that would read as something they are not, and a record
   * that misdescribes what produced it is worse than no record.
   */
  if (!identityPermitted(record.execution.providerKind, record.execution.identity)) {
    throw new Error(
      `Run "${record.id}" is ${record.execution.providerKind} work presenting a ` +
        `"${record.execution.identity.kind}" identity. A stub has no model and a ` +
        `live run must name the one it used.`,
    )
  }
  if (!usagePermitted(record.execution.providerKind, record.usage)) {
    throw new Error(
      `Run "${record.id}" is ${record.execution.providerKind} work reporting ` +
        `"${record.usage.state}" usage. A replay and a stub spend nothing; a live ` +
        `call spends something, measured or not.`,
    )
  }

  const needsReason: readonly RunState[] = ['failed', 'timed-out', 'blocked', 'cancelled']
  if (needsReason.includes(record.state) && !record.failure) {
    throw new Error(`Run "${record.id}" is ${record.state} without a failure record`)
  }
  if (record.state === 'completed' && !record.completedAt) {
    throw new Error(`Run "${record.id}" is completed but has no completion time`)
  }
  if (record.failure && record.failure.attempt < 1) {
    throw new Error(`Run "${record.id}" records attempt ${record.failure.attempt}`)
  }
  if (record.failure && RUN_STATES_WITHOUT_FAILURE.includes(record.state)) {
    // A completed or still-running run carrying a failure would be two answers.
    throw new Error(
      `Run "${record.id}" is ${record.state} and also carries a failure record`,
    )
  }
  return Object.freeze({
    ...record,
    events: Object.freeze([...record.events]),
    claims: Object.freeze([...record.claims]),
    missingOptionalInputs: Object.freeze([...record.missingOptionalInputs]),
    execution: Object.freeze({
      ...record.execution,
      identity: Object.freeze({ ...record.execution.identity }),
    }),
  })
}

/** States in which a failure record would contradict the run's own state. */
const RUN_STATES_WITHOUT_FAILURE: readonly RunState[] = [
  'queued',
  'waiting-for-dependencies',
  'ready',
  'running',
  'completed',
] as const

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
