/**
 * Settling an unresolved command.
 *
 * After an `AmbiguousCommitError` the commit outcome is genuinely unknown, and
 * guessing is the one thing that must not happen: a blind retry of a command
 * without a safe identity produces a second run, a second review, or a second
 * decision.
 *
 * The answer comes from the **durable command identity**, never from inspecting
 * aggregate state. Because intent and outcome commit inside the command's own
 * transaction, the presence of the command id IS the answer.
 */

import type { AnalysisRepositories, StorageProvenance } from '../repositories'
import { settledOutcome } from '../commandLog'
import type { CommandProbe, CommandResult } from './envelope'
import { resultFromLedger } from './envelope'
import type { CommandDefinition } from './definition'

export type Resolution<T> =
  | { state: 'committed'; result: CommandResult<T> }
  /** Definitely did not commit. Safe to reissue with the SAME command id. */
  | { state: 'not-committed' }
  /** Still unknown — usually because the database is still unreachable. */
  | { state: 'unresolved'; reason: string }
  /**
   * The ledger says something that should be impossible.
   *
   * Intent and outcome commit together, so a command with intent and no
   * terminal outcome means something wrote outside a command. Manual.
   */
  | { state: 'blocked'; reason: string }

export async function resolveCommand<Input, Result>(
  probe: CommandProbe,
  definition: CommandDefinition<Input, Result>,
  repositories: AnalysisRepositories,
  provenance: StorageProvenance,
): Promise<Resolution<Result>> {
  let entry
  try {
    entry = await repositories.commands.find(probe.commandId)
  } catch (error) {
    return {
      state: 'unresolved',
      reason:
        `the command ledger could not be read, so "${probe.commandId}" is still ` +
        `unsettled (${(error as Error).name})`,
    }
  }

  if (!entry) {
    /*
     * The intent write was inside the transaction whose commit was in doubt.
     * No row means the transaction did not commit, so nothing happened and the
     * command may be reissued — with the same id, so a late landing would
     * collide on the primary key rather than duplicate.
     */
    return { state: 'not-committed' }
  }

  const settled = settledOutcome(entry)
  if (!settled) {
    return {
      state: 'blocked',
      reason:
        `command "${probe.commandId}" has intent but no terminal outcome. These ` +
        `commit together, so this means something wrote outside a command.`,
    }
  }

  const result = await resultFromLedger(entry, provenance, (committed) =>
    repositories.withTransaction((tx) => definition.rehydrate(tx, committed.resultRef)),
  )

  return settled.state === 'committed'
    ? { state: 'committed', result }
    : { state: 'not-committed' }
}
