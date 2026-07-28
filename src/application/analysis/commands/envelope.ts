/**
 * What a command is, and what it can come back as.
 *
 * One handler is one `withTransaction`. No handler calls another — composition
 * happens above by issuing a second command, so every transaction boundary
 * stays visible in the ledger.
 */

import { stableHashHex } from '~/domain/shared/hash'
import {
  canonicalJson,
  type AssertedActor,
  type CommandInitiator,
  type Mandate,
} from '~/domain/analysis'
import type { StorageError, StorageProvenance } from '../repositories'
import type { CommandOutcome, LedgerEntry, RejectionCode } from '../commandLog'

/**
 * The command contract version.
 *
 * Bumped when the envelope, the payload canonicalization, the outcome
 * vocabulary or the `expectedVersion` policy changes in a way that alters what
 * a stored command means. Recorded in provenance, so an audit can tell which
 * contract produced a ledger entry.
 *
 * History:
 *   1  Phase C1A — the foundation
 */
export const COMMAND_CONTRACT_VERSION = '1'

/**
 * How the payload hash is computed.
 *
 * Versioned for the same reason evidence identity is: if canonicalization
 * changes, two identical payloads could hash differently and a replay would
 * look like a conflict.
 */
export const PAYLOAD_CANONICALIZATION_VERSION = '1'

export interface CommandEnvelope {
  /** Caller-supplied and stable across retries. Never generated in a handler. */
  commandId: string
  correlationId: string
  actor: AssertedActor
  initiator: CommandInitiator
  /** Domain time, from the Clock. Never the database's clock. */
  occurredAt: string
  /**
   * Required by commands that move case-level state, refused by every other.
   * Enforced in both directions from the command's declaration.
   */
  expectedVersion?: number
}

/* ----------------------------------------------------------------- result */

export interface DomainRejection {
  code: RejectionCode
  /**
   * For a human. May name records and constraints; never carries thesis text,
   * claim content, evidence payloads, SQL or connection details.
   */
  detail: string
}

export type CommandResult<T> =
  /** The result and its command identity are durably stored. */
  | {
      outcome: 'committed'
      value: T
      commandId: string
      resultKind: string
      resultRef: string
      provenance: StorageProvenance
    }
  /**
   * Understood and durably evaluated; a domain, authorization or lifecycle
   * rule prevented it. **Not a system failure**, and must not be reported as
   * one.
   */
  | {
      outcome: 'rejected'
      commandId: string
      rejection: DomainRejection
      durablyRecorded: boolean
    }
  /**
   * Execution failed operationally before any committed effect.
   *
   * `durablyRecorded` is false when the database was unavailable — a store
   * cannot be the durable record of the fact that it could not be reached.
   * That case is an operational delivery failure, not an institutional
   * command.
   */
  | {
      outcome: 'failed'
      commandId: string
      error: StorageError
      durablyRecorded: boolean
    }
  /** The commit outcome cannot yet be proven. Neither success nor failure. */
  | { outcome: 'unresolved'; commandId: string; probe: CommandProbe }

/** Everything `resolveCommand` needs to settle an unresolved command. */
export interface CommandProbe {
  commandId: string
  commandType: string
  /** Present when the intent write itself may not have landed. */
  intentUncertain: boolean
}

/** The one error a command body throws to reject rather than fail. */
export class CommandRejectedError extends Error {
  readonly rejection: DomainRejection

  constructor(code: RejectionCode, detail: string) {
    super(detail)
    this.name = 'CommandRejectedError'
    this.rejection = { code, detail }
  }
}

export function reject(code: RejectionCode, detail: string): never {
  throw new CommandRejectedError(code, detail)
}

/* --------------------------------------------------------- payload identity */

/**
 * The deterministic identity of what was asked.
 *
 * Covers everything that changes the MEANING of the command: its type, its
 * scope, the version it targeted, who was accountable, the contract version
 * and the command's own payload. Excludes delivery detail — the correlation
 * id, the initiator, the receive time — which vary between a request and its
 * retry without changing what was requested.
 */
export function commandPayloadHash(input: {
  commandType: string
  caseId?: string
  thesisRevisionId?: string
  expectedVersion?: number
  accountableEmployeeId: string | null
  payload: unknown
}): string {
  return stableHashHex(
    canonicalJson({
      canonicalization: PAYLOAD_CANONICALIZATION_VERSION,
      contract: COMMAND_CONTRACT_VERSION,
      type: input.commandType,
      caseId: input.caseId ?? null,
      thesisRevisionId: input.thesisRevisionId ?? null,
      expectedVersion: input.expectedVersion ?? null,
      accountable: input.accountableEmployeeId,
      payload: input.payload,
    }),
  )
}

/* ------------------------------------------------------ replaying a result */

/**
 * Turns a stored ledger entry back into the result its caller originally got.
 *
 * An identical replay resolves to the ORIGINAL outcome rather than executing
 * again — which is what makes a retry safe without any store-level trickery.
 */
export function resultFromLedger<T>(
  entry: LedgerEntry,
  provenance: StorageProvenance,
  rehydrate: (outcome: Extract<CommandOutcome, { state: 'committed' }>) => Promise<T>,
): Promise<CommandResult<T>> | CommandResult<T> {
  const settled = entry.outcomes.find((outcome) => outcome.state !== 'unresolved')

  if (!settled) {
    return {
      outcome: 'unresolved',
      commandId: entry.intent.commandId,
      probe: {
        commandId: entry.intent.commandId,
        commandType: entry.intent.commandType,
        intentUncertain: false,
      },
    }
  }

  switch (settled.state) {
    case 'committed':
      return rehydrate(settled).then((value) => ({
        outcome: 'committed' as const,
        value,
        commandId: entry.intent.commandId,
        resultKind: settled.resultKind,
        resultRef: settled.resultRef,
        provenance,
      }))
    case 'rejected':
      return {
        outcome: 'rejected',
        commandId: entry.intent.commandId,
        rejection: {
          code: settled.reasonCode,
          detail: 'replayed from the command ledger',
        },
        durablyRecorded: true,
      }
    case 'failed':
      return {
        outcome: 'failed',
        commandId: entry.intent.commandId,
        error: { name: settled.errorCategory } as StorageError,
        durablyRecorded: true,
      }
  }
}

export type { Mandate }
