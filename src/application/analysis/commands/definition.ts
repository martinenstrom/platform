/**
 * What a command declares about itself.
 *
 * The point of this file is the `versionPolicy` field. It is **required**, so a
 * command added without deciding whether it moves case-level state does not
 * typecheck — which is what stops the `expectedVersion` list from quietly
 * drifting out of the contract it is supposed to be part of.
 */

import type { Mandate } from '~/domain/analysis'
import type { TransactionalAnalysisRepositories } from '../repositories'
import type { ActorSnapshot } from '~/domain/analysis'

/**
 * Whether the command moves case-level aggregate state.
 *
 * Enforced in **both** directions: a `requires` command that omits
 * `expectedVersion` is rejected, and a `refuses` command that supplies one is
 * rejected too. Silently ignoring a stray version would let a caller believe
 * it had concurrency protection it did not have.
 */
export type VersionPolicy = 'requires-expected-version' | 'refuses-expected-version'

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
