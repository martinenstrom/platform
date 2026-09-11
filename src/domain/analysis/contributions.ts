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
/**
 * Why a human declined an agent's work.
 *
 * A **code**, not a sentence. This vocabulary exists to be measured over years
 * — which agents are rejected most, why, whether it clusters by capability,
 * prompt, task or market regime, and whether an agent improves. None of that is
 * answerable over prose.
 *
 * `Blocker` already paid for that lesson here: it carried `detail: string`,
 * prose became a data channel, the category was recovered by matching sentence
 * prefixes, and renaming a message silently reclassified a blocker.
 *
 * Each names **what was wrong**, never how it scored. A code naming a
 * deficiency can be improved against; one naming a verdict cannot — which is
 * why `insufficient-analysis` exists and `below-quality-bar` does not.
 */
export type ContributionRejectionCode =
  /** The claim outruns what the evidence shows. */
  | 'unsupported-by-evidence'
  /** Answered a different question from the one briefed. */
  | 'misread-the-brief'
  /** The reasoning contradicts itself. */
  | 'internally-inconsistent'
  /** Already known. Adds nothing the firm did not have. */
  | 'duplicates-existing-work'
  /** Went in the right direction and did not go far enough. */
  | 'insufficient-analysis'
  /** Correct, and not this department's work. */
  | 'out-of-scope'

export const CONTRIBUTION_REJECTION_CODES: readonly ContributionRejectionCode[] =
  Object.freeze([
    'unsupported-by-evidence',
    'misread-the-brief',
    'internally-inconsistent',
    'duplicates-existing-work',
    'insufficient-analysis',
    'out-of-scope',
  ])

/**
 * A principal declining an agent's work, and why.
 *
 * **One primary code, and prose that is required rather than optional.** A code
 * alone teaches nobody anything, and a rejection nobody can learn from is the
 * discarded history this record exists to prevent. Secondary codes are
 * deliberately not modelled.
 *
 * This used to say "the person who declined it. Never an agent." That stopped
 * being true when P4 widened `RejectContribution` to the accountable
 * institutional principal: the same authority that may adopt a desk's work may
 * decline it. The storage contract still required an employee, so an agent
 * declining a contribution failed at the foreign key — repaired in `0044`.
 */
export interface ContributionRejection {
  code: ContributionRejectionCode
  /** Required. What was actually wrong, for whoever tries to fix it. */
  detail: string
  /**
   * The accountable institutional principal that declined the produced
   * contribution.
   *
   * Exactly one of these two is set, enforced by the database. Two optional
   * fields rather than one required id, for the reason `AgentRunRecord` carries
   * them that way: a single column holding either kind would make "which sort
   * of principal was this" a lookup rather than a fact.
   */
  rejectedByEmployeeId?: EmployeeId
  /** The institutional agent that declined it, where one did. */
  rejectedByAgentPrincipalId?: string
  rejectedAt: string
}

/**
 * The principal that declined, whichever kind it was.
 *
 * For readers that need to name the decliner and do not care which kind it is.
 * Anything that renders a person's name, or attributes the act to staff, must
 * read the two fields directly instead — an agent id shown under a heading that
 * says "employee" is the fiction this pair exists to prevent.
 */
export function rejectingPrincipalId(rejection: ContributionRejection): string {
  const principal =
    rejection.rejectedByEmployeeId ?? rejection.rejectedByAgentPrincipalId
  if (!principal) {
    throw new Error(
      'A rejection names no accountable principal. Exactly one of ' +
        '`rejectedByEmployeeId` and `rejectedByAgentPrincipalId` is required.',
    )
  }
  return principal
}

export type RunState =
  | 'queued'
  /** Cannot start: a declared dependency has not completed. */
  | 'waiting-for-dependencies'
  /** Dependencies satisfied, awaiting a slot. */
  | 'ready'
  | 'running'
  /**
   * The work is produced and durable, and is not institutional.
   *
   * Generated work is **operational** until a human accepts it. The claims are
   * in the produced-claim store — readable, paid for, and outside
   * `analysis.claims`, so nothing can verify, gate, aggregate or cite them.
   */
  | 'awaiting-acceptance'
  | 'completed'
  /**
   * A human read the work and declined it.
   *
   * **Never a kind of `failed`.** A failed run produced nothing; a rejected run
   * produced work the firm judged inadequate, and every call succeeded.
   * Collapsing them would make "how often does this agent fail" and "how often
   * is its work not good enough" one number, and those are the two different
   * questions worth asking about an employee.
   */
  | 'rejected'
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
  /*
   * A run no longer reaches `completed` directly. Work produced is work
   * awaiting a decision, and the only path into the institutional record runs
   * through a person.
   */
  running: ['awaiting-acceptance', 'failed', 'timed-out', 'cancelled', 'superseded'],
  'awaiting-acceptance': ['completed', 'rejected', 'cancelled', 'superseded'],
  completed: ['superseded'],
  rejected: [],
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
  'rejected',
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

/**
 * What a run spent in money, as a state of its own.
 *
 * Separate from the token count because **the two do not arrive together.**
 * The live path proved it: the Messages API reports `input_tokens` and
 * `output_tokens` and no price at all. The previous shape required all four
 * numbers to be present or none, which left one truthful combination —
 * *tokens measured, monetary cost unknown* — with no way to be said.
 *
 * The options that shape forced were both falsehoods. `costMinorUnits: 0`
 * states that the provider reported a free call, which is a measurement.
 * Reporting the whole usage as `not-reported` throws away token counts the
 * provider did give, and — worse — makes a token budget unenforceable, because
 * enforcement reads measured usage only.
 *
 * **Zero still means genuinely free.** That distinction is the reason this is a
 * state rather than a nullable number, and it is unchanged: `measured` with
 * `costMinorUnits: 0` is a provider saying the call cost nothing, and
 * `not-reported` is a provider saying nothing.
 */
export type RunMoneyCost =
  | { state: 'not-reported' }
  | { state: 'measured'; costMinorUnits: number; currency: string }

/** Token accounting, with money reported separately. */
export interface RunCost {
  inputTokens: number
  outputTokens: number
  /**
   * Money, in minor units, where the provider said. Minor units throughout to
   * avoid float drift, and a currency travels with any amount.
   */
  cost: RunMoneyCost
}

/**
 * What a run consumed, in three states rather than a nullable number.
 *
 * A nullable column cannot distinguish the things that are actually true of
 * different runs, and the ambiguity falls on the side that costs money: `null`
 * reads as free.
 *
 *   not-applicable  there was nothing to spend — a replay, a stub
 *   not-reported    real work whose provider reported nothing at all
 *   measured        tokens were counted; money is `RunMoneyCost` beside them
 *
 * **`measured` is about tokens.** Whether the provider also priced the call is
 * a separate state, because a provider may genuinely report one and not the
 * other — see `RunMoneyCost`. Reading `measured` as "everything is known"
 * is what made *tokens measured, cost unknown* unsayable, and what made a
 * token budget unenforceable against the only provider that spends tokens.
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

/* --------------------------------------------------------- execution budget */

/**
 * What a run was **authorized** to consume, as against `RunUsage`, which is
 * what it actually did.
 *
 * Three states per dimension rather than a nullable number, for the reason
 * `RunUsage` gives one line up: a nullable column cannot distinguish the
 * things that are separately true, and the ambiguity falls on the side that
 * costs money.
 *
 *   limit           bounded. Exceeding it fails the run
 *   not-applicable  the provider cannot consume this at all
 *   not-measured    nobody decided, and a live run therefore refuses to start
 *
 * `not-measured` preserves exactly the meaning the original nullable field was
 * documented with — *"not measured, never unlimited"* — which existed so that a
 * live runtime could refuse to begin work when a required authorization was
 * absent. What it could not express is the other half: a local or simulated
 * provider **cannot** incur a monetary cost, and refusing it for lacking a
 * limit on something it is incapable of spending would be refusing a fact.
 *
 * The same distinction the eligibility gates already draw between
 * `not-applicable` and `passed`, for the same reason: a limit that does not
 * apply and a limit nobody set are different facts about the firm.
 */
export type TokenBudget =
  | { kind: 'limit'; tokens: number }
  | { kind: 'not-applicable' }
  | { kind: 'not-measured' }

/**
 * Currency travels with the amount, never beside it.
 *
 * `RunCost` pairs them for the same reason: an amount without a currency is
 * not a cost, and two nullable columns permit a record that names one without
 * the other.
 */
export type CostBudget =
  | { kind: 'limit'; costMinorUnits: number; currency: string }
  | { kind: 'not-applicable' }
  | { kind: 'not-measured' }

export type DeadlineBudget =
  | { kind: 'limit'; deadlineMs: number }
  | { kind: 'not-applicable' }
  | { kind: 'not-measured' }

/**
 * The **effective** limit a run executed under.
 *
 * Deliberately not the policies that produced it. A playbook proposes, a case
 * may constrain, and firm-wide policy is the hard ceiling — but what the run
 * records is the number those three resolved to, because a historical run must
 * stay self-describing after all three have since changed. A run whose limits
 * could only be read by reconstructing three policies would not be a record of
 * what the firm permitted; it would be a reference to it.
 *
 * The same rule the eligibility basis already follows: the record carries what
 * was in force, not a pointer to wherever it currently lives.
 */
export interface ExecutionBudget {
  tokens: TokenBudget
  cost: CostBudget
  deadline: DeadlineBudget
}

/**
 * What a producer that consumes nothing external runs under.
 *
 * A replay and a stub cannot spend tokens or money, so both are
 * `not-applicable` rather than unmeasured — the distinction that keeps a
 * producer incapable of spending from being refused for lacking a limit on
 * something it could never consume. The deadline is `not-measured` because
 * whether one was set is a fact about the caller, not about the producer.
 */
export const NON_CONSUMING_BUDGET: ExecutionBudget = Object.freeze({
  tokens: { kind: 'not-applicable' } as const,
  cost: { kind: 'not-applicable' } as const,
  deadline: { kind: 'not-measured' } as const,
})

export type BudgetKind = TokenBudget['kind']

export const BUDGET_KINDS: readonly BudgetKind[] = [
  'limit',
  'not-applicable',
  'not-measured',
]

/** Named so a refusal can say which dimension nobody decided. */
export function unmeasuredBudgetDimensions(
  budget: ExecutionBudget,
): readonly (keyof ExecutionBudget)[] {
  return (['tokens', 'cost', 'deadline'] as const).filter(
    (dimension) => budget[dimension].kind === 'not-measured',
  )
}

/**
 * Whether a producer of this kind may begin under this budget.
 *
 * Only live work is refused. A replay and a stub consume nothing external, so
 * an unmeasured dimension on one authorizes no spend and blocks no fact — but
 * a live call against a dimension nobody bounded is precisely the thing the
 * original `null` comment was written to make refusable.
 */
export function budgetPermitsStart(
  providerKind: ProviderKind,
  budget: ExecutionBudget,
): boolean {
  if (providerKind !== 'live') return true
  return unmeasuredBudgetDimensions(budget).length === 0
}

/**
 * Which authorized dimensions the reported usage overran.
 *
 * Reads `measured` usage only. A provider that did not report cannot be shown
 * to have exceeded anything, and treating silence as an overrun would fail
 * runs for the provider's reticence rather than for their spend. That gap is
 * closed at the other end — `not-reported` is a state a live provider may
 * return, and what it costs the firm is visibility, not enforcement here.
 */
export function budgetOverruns(
  budget: ExecutionBudget,
  usage: RunUsage,
): readonly (keyof ExecutionBudget)[] {
  const cost = measuredCost(usage)
  if (!cost) return []

  const overrun: (keyof ExecutionBudget)[] = []

  /*
   * Tokens are enforced whenever tokens were counted — independently of
   * whether anyone priced the call. That independence is the whole point of
   * separating the two states: the provider that actually spends tokens is
   * also the one that reports no money, so tying token enforcement to a known
   * cost would leave the token limit permanently unenforceable.
   */
  if (
    budget.tokens.kind === 'limit' &&
    cost.inputTokens + cost.outputTokens > budget.tokens.tokens
  ) {
    overrun.push('tokens')
  }

  /*
   * Money is enforced only against a measurement. An unknown cost neither
   * trips the limit nor satisfies it — it is simply not evidence either way,
   * and treating silence as zero would let unpriced spend pass a monetary
   * budget while treating it as infinite would fail every honest live run.
   *
   * A limit in one currency also says nothing about spend in another.
   * Comparing the numbers would silently treat 100 öre as 100 cents, so a
   * mismatch is not an overrun here — it is refused where the budget is built.
   */
  if (
    budget.cost.kind === 'limit' &&
    cost.cost.state === 'measured' &&
    budget.cost.currency === cost.cost.currency &&
    cost.cost.costMinorUnits > budget.cost.costMinorUnits
  ) {
    overrun.push('cost')
  }
  return overrun
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
  /**
   * The human accountable for the run, where one is.
   *
   * Optional since a desk may act for itself: exactly one of this and
   * `agentPrincipalId` is set, enforced by the database.
   */
  employeeId?: EmployeeId
  /** The institutional agent accountable for the run, where one is. */
  agentPrincipalId?: string

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
   * What it was authorized to consume, resolved before it started.
   *
   * Beside `usage` because the pair is the whole accounting question: what the
   * firm permitted, and what was actually spent. Recorded rather than looked
   * up, so the answer survives every later change to the policies that set it.
   */
  budget: ExecutionBudget
  /**
   * What it consumed. Required, because "we did not record this" is one of the
   * states rather than the absence of all of them.
   */
  usage: RunUsage
  /** Present when the run failed, timed out, was blocked or cancelled. */
  failure?: RunFailure
  /**
   * Present when a human declined the work.
   *
   * Beside `failure`, never folded into it: an operational failure and an
   * institutional rejection answer different questions, and a reader must not
   * have to guess which one a run holds.
   */
  rejection?: ContributionRejection
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

  /*
   * A live run under a dimension nobody bounded. Refused here as well as at
   * `StartAgentRun`, because the command is one way in and the record is the
   * thing that must not exist: a stored live run whose authorization was never
   * decided is a record that the firm approved spend it never approved.
   */
  if (!budgetPermitsStart(record.execution.providerKind, record.budget)) {
    const unmeasured = unmeasuredBudgetDimensions(record.budget).join(', ')
    throw new Error(
      `Run "${record.id}" is live work with no decided budget for ${unmeasured}. ` +
        `"Not measured" is not "unlimited", and a live call against an ` +
        `unbounded dimension is spend nobody authorized.`,
    )
  }
  if (record.budget.cost.kind === 'limit' && record.budget.cost.currency.trim() === '') {
    // An amount without a currency is not a cost. Mirrors `RunCost`.
    throw new Error(`Run "${record.id}" carries a cost budget with no currency`)
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
  /*
   * The state and the rejection agree, in both directions. A rejected run that
   * cannot say why teaches the firm nothing, and a run carrying a rejection it
   * did not receive misreports an agent's record. Mirrored by
   * `runs_rejected_has_reason` in migration 0027.
   */
  if (record.state === 'rejected' && !record.rejection) {
    throw new Error(
      `Run "${record.id}" is rejected without a rejection record. A rejection ` +
        `nobody can learn from is the discarded history this record prevents.`,
    )
  }
  if (record.rejection && record.state !== 'rejected') {
    throw new Error(`Run "${record.id}" is ${record.state} and also carries a rejection`)
  }
  if (record.rejection && record.rejection.detail.trim() === '') {
    throw new Error(`Run "${record.id}" is rejected with no explanation`)
  }
  /*
   * Exactly one accountable rejecting principal. Mirrors
   * `runs_rejected_by_one_principal` in migration 0044, so a record that the
   * database would refuse does not get as far as the database.
   */
  if (record.rejection) {
    const named = [
      record.rejection.rejectedByEmployeeId,
      record.rejection.rejectedByAgentPrincipalId,
    ].filter((principal) => principal !== undefined).length
    if (named !== 1) {
      throw new Error(
        `Run "${record.id}" names ${named} accountable principals for its ` +
          `rejection. A rejection is declined by exactly one principal the ` +
          `firm can ask about it.`,
      )
    }
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

/**
 * States in which a failure record would contradict the run's own state.
 *
 * `awaiting-acceptance` and `rejected` are here for the reason the two states
 * exist at all: work that was produced and then declined is not work that
 * failed. A run holding both a rejection and a failure would be two answers
 * about the same contribution, and a reader would have to guess which one the
 * firm meant. Mirrored by `runs_progress_without_failure` in migration 0027.
 */
const RUN_STATES_WITHOUT_FAILURE: readonly RunState[] = [
  'queued',
  'waiting-for-dependencies',
  'ready',
  'running',
  'awaiting-acceptance',
  'completed',
  'rejected',
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
