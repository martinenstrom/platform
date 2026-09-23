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
  CorrectionFinding,
  ExecutionBudget,
  ExecutionIdentity,
  ProviderKind,
  RunFailureCategory,
  RunState,
  RunUsage,
  SynthesisArtifact,
} from '~/domain/analysis'

/** What a department is asked to do. */
export interface ContributionRequest {
  caseId: string
  assignmentId: string
  departmentId: string
  /**
   * The principal accountable for the work — a human employee id or an
   * institutional agent principal id.
   *
   * Renamed from `employeeId` when desks became able to act for themselves: a
   * field defined as a person, carrying an agent, would misdescribe every
   * autonomous run. No provider reads it; it travels with the request so the
   * record of what was asked names who it was asked of.
   */
  accountablePrincipalId: string
  /** The exact thesis revision this concerns, where the work is thesis-scoped. */
  revisionId?: string
  brief: string
  /**
   * Corrections Verification demands of THIS desk's accepted claims, when the
   * run is correction work (TD-99, 2026-09-22). Rendered into the desk's
   * prompt beside the brief; absent on a first contribution. The desk answers
   * with a complete fresh contribution that replaces the earlier one.
   */
  corrections?: readonly CorrectionFinding[]
  evidenceSetId: string
  /** Outputs of declared upstream dependencies. Never a shared mutable context. */
  inputs: Readonly<Record<string, readonly AgentClaim[]>>
  /** The effective limit, already resolved. A provider enforces, never decides. */
  budget: ExecutionBudget
  signal: AbortSignal
}

import type {
  DevilsAdvocateCandidateArtifact,
  PeerExaminationCandidateArtifact,
  VerificationCandidateArtifact,
} from '~/domain/analysis'

/**
 * What a control function's provider produced, when the entry is a control
 * act rather than a desk's analysis (2026-09-17, G1).
 *
 * The same three shapes `RecordGovernanceCandidate` takes, declared here so
 * the port names the output without importing a command. A result that
 * carries one carries no claims: a verdict, an objection set or an
 * examination is not a claim, and the orchestrator records it through the
 * candidate command instead of `RecordContribution`.
 */
export type GovernanceCandidateOutput =
  | { kind: 'verification'; artifact: VerificationCandidateArtifact }
  | { kind: 'devils-advocate'; artifact: DevilsAdvocateCandidateArtifact }
  | {
      kind: 'peer-examination'
      artifact: PeerExaminationCandidateArtifact
      examinedDepartmentId: string
    }

export interface ContributionResult {
  claims: readonly AgentClaim[]
  /** A control function's candidate, where the entry is a control act. Never beside claims. */
  governance?: GovernanceCandidateOutput
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
  /**
   * A department synthesis, where the department's work IS a synthesis.
   *
   * Present only for the accountable synthesis step, and `RecordContribution`
   * refuses it anywhere else — an optional field on a shared port is not a
   * licence for every desk to state the firm's position.
   *
   * It travels here rather than being assembled by the caller for the reason
   * the claims do: this is what the model produced, and the boundary exists so
   * that what the model produced is what gets persisted, unedited, as a
   * candidate nobody has yet adopted.
   */
  synthesis?: SynthesisArtifact
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

/**
 * How a provider reports a failure it can classify.
 *
 * Defined by the PORT rather than by any one provider, because the orchestrator
 * has to read it and the application layer may not import infrastructure. A
 * provider that knows why it failed throws this; one that does not throws
 * anything, and the caller records `provider-error` — it errored, but it did
 * not say how.
 *
 * This exists because the seam above it was flattening every live failure into
 * one category. The client classified an auth rejection as
 * `provider-unavailable`, and the record said `provider-error`, so the run said
 * "the provider answered with an error" about a request the provider never
 * accepted. A bounded vocabulary that cannot survive the trip to the record is
 * a vocabulary in name only.
 */
export class ContributionFailure extends Error {
  constructor(readonly category: RunFailureCategory) {
    // No provider prose, here or anywhere: this message reaches logs.
    super(`contribution failed: ${category}`)
    this.name = 'ContributionFailure'
  }
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
