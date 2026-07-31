/**
 * The contribution port — how a department produces work.
 *
 * Phase B has two implementations and neither is a model: a recorded provider
 * replaying immutable fixtures, and a stub. Phase C adds a live one behind the
 * same interface.
 *
 * The rule that makes this worth doing: **a recorded contribution goes through
 * exactly the same validation, lifecycle, review and gating code a live one
 * will.** A fixture path that skips checks proves nothing about the real path,
 * and the runtime would be tested against a version of itself that will never
 * ship.
 */

import type {
  AgentClaim,
  ExecutionIdentity,
  ProviderKind,
  RunState,
  RunUsage,
} from '~/domain/analysis'

/** What a department is asked to do. */
export interface ContributionRequest {
  caseId: string
  assignmentId: string
  departmentId: string
  employeeId: string
  /** The exact thesis revision this concerns, where the work is thesis-scoped. */
  revisionId?: string
  brief: string
  evidenceSetId: string
  /** Outputs of declared upstream dependencies. Never a shared mutable context. */
  inputs: Readonly<Record<string, readonly AgentClaim[]>>
  budget: ContributionBudget
  signal: AbortSignal
}

/**
 * Budgets, kept separate because they are separate limits.
 *
 * `null` means **not measured in Phase B**, never "unlimited". A live runtime
 * must refuse to begin work when a required authorization is absent, and a
 * null that silently meant infinity would make that refusal impossible to
 * write later.
 */
export interface ContributionBudget {
  tokens: number | null
  costMinorUnits: number | null
  currency: string | null
  deadlineMs: number | null
}

export const PHASE_B_BUDGET: ContributionBudget = Object.freeze({
  tokens: null,
  costMinorUnits: null,
  currency: null,
  deadlineMs: null,
})

export interface ContributionResult {
  claims: readonly AgentClaim[]
  /*
   * The prompt and model are deliberately absent: they were DECLARED before
   * execution and are already on the run. Restating them here would let a
   * provider report having used something other than what it said it would,
   * and the record would quietly take the second answer.
   */
  agentContractVersion: string
  outputSchemaVersion: string
  /**
   * What it consumed, in one of three states.
   *
   * Never a nullable number. A replay reports `not-applicable` — it spent
   * nothing — and a live provider that did not tell us reports `not-reported`,
   * which is a different fact from spending zero. `measured` carries a currency
   * alongside the amount, because an amount without one is not a cost.
   */
  usage: RunUsage
  /**
   * States the provider passed through, so the run's event log reflects what
   * actually happened rather than a synthetic start-and-finish pair.
   */
  observedStates: readonly RunState[]
}

/**
 * What a provider will use, stated before it runs.
 *
 * The run record declares its four version axes at `StartAgentRun`, which
 * commits before any provider executes. Something therefore has to know them
 * in advance, and the provider is the only honest place: a recorded one reads
 * them off its fixture, and a live one knows its prompt and model
 * configuration before it sends anything.
 *
 * The alternative — recording what came back — would make the axes a
 * description of the answer rather than of the question, and a provider that
 * silently switched models mid-flight would leave no trace of having done so.
 */
export interface ContributionDeclaration {
  agentContractVersion: string
  outputSchemaVersion: string
  /**
   * What will run, in the shape the provider's kind permits.
   *
   * A stub declares a scenario; a live provider declares its prompt and model.
   * The provider states it because the provider is the only thing that knows —
   * and stating it here means a stub cannot acquire a model reference by
   * passing through a field that has one.
   */
  identity: ExecutionIdentity
}

export interface ContributionProvider {
  readonly id: string
  /** The provider's own implementation version. Part of the run's provenance. */
  readonly version: string
  /**
   * What kind of producer this is.
   *
   * Declared by the provider rather than chosen by the caller: a fixture must
   * not be able to enter the record as live work because whoever wired it up
   * passed the wrong string.
   */
  readonly kind: ProviderKind
  /** Known before execution, and recorded before execution. */
  declare(request: ContributionRequest): ContributionDeclaration
  contribute(request: ContributionRequest): Promise<ContributionResult>
}
