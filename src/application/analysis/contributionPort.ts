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

import type { AgentClaim, ModelRef, PromptRef, RunState } from '~/domain/analysis'

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
  prompt: PromptRef
  model: ModelRef
  agentContractVersion: string
  outputSchemaVersion: string
  /** Reported by the provider; `null` where nothing was measured. */
  usage: { inputTokens: number; outputTokens: number; costMinorUnits: number } | null
  /**
   * States the provider passed through, so the run's event log reflects what
   * actually happened rather than a synthetic start-and-finish pair.
   */
  observedStates: readonly RunState[]
}

export interface ContributionProvider {
  readonly id: string
  contribute(request: ContributionRequest): Promise<ContributionResult>
}
