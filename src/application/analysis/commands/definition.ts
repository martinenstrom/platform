/**
 * What a command declares about itself.
 *
 * Every policy field here is **required**, and that is the point of the file. A
 * command added without deciding whether it moves case-level state, whether it
 * owes a reason, or what kind of institutional act it is does not typecheck —
 * which is what stops those three contracts from drifting out of the ledger
 * they are supposed to be part of.
 */

import type { Mandate } from '~/domain/analysis'
import type { TransactionalAnalysisRepositories } from '../repositories'
import type { ActorSnapshot } from '~/domain/analysis'
import type { CommandCategory } from '../commandLog'

/**
 * Whether the command moves case-level aggregate state.
 *
 * Enforced in **both** directions: a `requires` command that omits
 * `expectedVersion` is rejected, and a `refuses` command that supplies one is
 * rejected too. Silently ignoring a stray version would let a caller believe
 * it had concurrency protection it did not have.
 */
export type VersionPolicy = 'requires-expected-version' | 'refuses-expected-version'

/**
 * Whether the command owes an explanation.
 *
 * Three states rather than two, because there is a real third case: a
 * technical operation with no institutional effect has no legitimate use for
 * free-form prose, and accepting one would create an unreviewed text field on
 * a record nobody audits.
 *
 * Enforced in all three directions. A `required` command without a reason is
 * rejected, a `forbidden` command carrying one is rejected, and a blank or
 * whitespace-only reason never counts as a reason.
 */
export type ReasonPolicy = 'required' | 'optional' | 'forbidden'

/** What a command targeted, for the ledger. */
export interface CommandScope {
  caseId?: string
  thesisRevisionId?: string
}

/** What a command produced, for the ledger and for a replay. */
export interface CommandEffect<T> {
  value: T
  /** 'case' | 'revision' | 'run' | 'review' | 'decision' | … */
  resultKind: string
  resultRef: string
}

export interface CommandContext {
  actor: ActorSnapshot
  occurredAt: string
  correlationId: string
  expectedVersion?: number
}

export interface CommandDefinition<Input, Result> {
  type: string
  versionPolicy: VersionPolicy
  reasonPolicy: ReasonPolicy
  /**
   * What kind of institutional act this is.
   *
   * Cross-checked against the mandate at execution time, so a routine workflow
   * movement cannot file itself as governance.
   */
  category: CommandCategory
  /** The authority this command requires, derived from its input. */
  mandate: (input: Input) => Mandate
  /** What it targets, for the ledger. */
  scope: (input: Input) => CommandScope
  /**
   * The semantic payload the identity hash covers.
   *
   * Deliberately separate from `Input`: a command may accept delivery detail
   * that does not change what was asked, and including it would make a retry
   * look like a different command.
   */
  payload: (input: Input) => unknown
  /**
   * The work, inside the caller's transaction.
   *
   * Throws `CommandRejectedError` to reject; anything else is a failure.
   * Must not open a transaction, and must not call another command.
   */
  execute: (
    repositories: TransactionalAnalysisRepositories,
    context: CommandContext,
    input: Input,
  ) => Promise<CommandEffect<Result>>
  /**
   * Re-reads a committed result when a replay returns from the ledger.
   *
   * Separate from `execute` because a replay must not re-run the work — it
   * returns what the original command produced.
   */
  rehydrate: (
    repositories: TransactionalAnalysisRepositories,
    resultRef: string,
  ) => Promise<Result>
}

/**
 * The commands that require `expectedVersion`, as data.
 *
 * Kept here rather than inferred, so the approved list is greppable and a test
 * can assert that every registered command's policy matches it.
 */
export const VERSION_GUARDED_COMMANDS: readonly string[] = [
  'InstantiatePlaybook',
  'SubmitForVerification',
  'SubmitForCioDecision',
  'RecordCaseDecision',
  'CloseCase',
  'ReopenCase',
] as const

/**
 * The commands that must state why, as data.
 *
 * The shared property: each one reverses, refuses or materially redirects
 * institutional work. Ordinary forward motion — opening a case, instantiating
 * its workflow, proposing the first thesis — does not appear here, because
 * requiring prose for routine progress produces prose nobody reads and
 * devalues the reasons that matter.
 *
 * Kept beside `VERSION_GUARDED_COMMANDS` and asserted against every registered
 * definition, so the approved list stays greppable rather than scattered
 * across handlers.
 */
export const REASON_REQUIRED_COMMANDS: readonly string[] = [
  'BlockCase',
  'ReturnWork',
  'ReopenCase',
  'ReviseThesis',
  'WithdrawThesis',
  'SupersedeThesisRevision',
  'RecordCaseDecision',
  'ResolveConditionalRequirement',
  'OverrideGovernanceBlock',
  'ResolveException',
] as const
