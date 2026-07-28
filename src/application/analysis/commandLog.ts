/**
 * The command ledger.
 *
 * Replaces `IdempotencyStore`, which described a thirty-day operational cache
 * and could not answer the questions Phase C needs: what was asked, by whom,
 * under what authority, against what version, and what came of it.
 *
 * ## Intent and outcome are separate
 *
 * `CommandIntent` is what was ASKED and is immutable. `CommandOutcome` is what
 * HAPPENED and is append-only. A command that was unresolved and is later
 * confirmed gains a second outcome; the first is not overwritten, because how
 * long the answer was unknown is itself part of the record.
 *
 * ## What this cannot record
 *
 * Its own unavailability. If the database is unreachable before a command
 * reaches the durable boundary, there is no institutional command — only an
 * operational delivery failure, which belongs in logs and metrics. A store
 * cannot be the durable record of the fact that it could not be reached, and
 * pretending otherwise would invent a guarantee.
 */

import type {
  ActorSnapshot,
  AuthorizationBasis,
  CommandInitiator,
  Mandate,
} from '~/domain/analysis'
import type { StorageProvenance } from './repositories'

/** What was asked. Written once, never rewritten. */
export interface CommandIntent {
  commandId: string
  commandType: string
  /**
   * The contract in force when this was written.
   *
   * Stored per command rather than assumed, so a version-1 record is read as
   * version 1 forever. Reinterpreting old records under a newer contract is
   * how a ledger starts describing things that never happened.
   */
  commandContractVersion: string
  /**
   * What kind of institutional act this was.
   *
   * Cross-checked against the mandate, so the ledger cannot contain a routine
   * workflow movement filed as governance.
   */
  category: CommandCategory

  /**
   * Deterministic hash of the semantic input.
   *
   * Reusing a command id with a different payload is a different command
   * wearing the same name, and fails rather than returning the earlier result.
   */
  payloadHash: string

  /** What it targeted. */
  caseId?: string
  thesisRevisionId?: string
  expectedVersion?: number

  /** The accountable actor, as the organization described them at the time. */
  actor: ActorSnapshot
  /** Why it was allowed, decided at execution time rather than re-derived. */
  mandate: Mandate
  authorizationBasis: AuthorizationBasis
  /** Who set it in motion, which is not who is accountable for it. */
  initiator: CommandInitiator

  /**
   * Why it was issued, when the command's policy asks for one.
   *
   * Sensitive institutional content: persisted and exposed to authorized
   * audit reads, and **never** placed in a metric label, a routine log line or
   * a generic exception message. A blocking reason can name a person, a
   * counterparty or an unpublished finding.
   */
  reason?: string

  correlationId: string
  /** Domain time, from the Clock. */
  occurredAt: string
  /** When the runtime received it. */
  receivedAt: string
}

/**
 * What kind of institutional act a command is.
 *
 * A closed set, kept small on purpose. Its value is that "show me every
 * governance action on this case" is one predicate rather than a list of
 * command types that grows every time someone adds one.
 */
export type CommandCategory =
  /** Produces analysis: claims, evidence, a thesis. */
  | 'analysis'
  /** Moves work: opens, assigns, routes, transitions. */
  | 'workflow'
  /** A control function issuing a verdict. */
  | 'governance'
  /** The organization committing to a position. */
  | 'decision'
  /** Technical operation with no institutional effect. */
  | 'system'

export const COMMAND_CATEGORIES: readonly CommandCategory[] = [
  'analysis',
  'workflow',
  'governance',
  'decision',
  'system',
] as const

/** Bounded machine-readable codes. Never free text, never a metric label. */
export type RejectionCode =
  | 'unknown-actor'
  | 'not-authorised'
  | 'illegal-prior-state'
  | 'aggregate-conflict'
  | 'invariant-violated'
  | 'not-found'
  | 'payload-conflict'

export type CommandOutcome =
  | { state: 'committed'; resultKind: string; resultRef: string; recordedAt: string }
  | { state: 'rejected'; reasonCode: RejectionCode; recordedAt: string }
  /** Operational failure BEFORE any committed effect. */
  | { state: 'failed'; errorCategory: string; recordedAt: string }
  /** The commit outcome cannot yet be proven. */
  | { state: 'unresolved'; resolutionReference: string; recordedAt: string }

export interface LedgerEntry {
  intent: CommandIntent
  /** Ordered, oldest first. Empty only in the instant between the two writes. */
  outcomes: readonly CommandOutcome[]
}

/**
 * Thrown when one command id is reused for a different payload.
 *
 * Loud rather than silent: returning the earlier result would answer a
 * question nobody asked, and hide that two different commands are travelling
 * under one identity.
 */
export class CommandPayloadConflictError extends Error {
  readonly commandId: string
  readonly expectedPayloadHash: string
  readonly actualPayloadHash: string

  constructor(commandId: string, expected: string, actual: string) {
    super(
      `Command "${commandId}" was already recorded with a different payload.\n` +
        `  recorded: ${expected}\n` +
        `  now:      ${actual}\n` +
        `A command id identifies one request. Reusing it for a different one is ` +
        `not a retry.`,
    )
    this.name = 'CommandPayloadConflictError'
    this.commandId = commandId
    this.expectedPayloadHash = expected
    this.actualPayloadHash = actual
  }
}

export interface CommandLog {
  /** The whole entry, or null when the command never reached the ledger. */
  find(commandId: string): Promise<LedgerEntry | null>

  /**
   * Records intent.
   *
   * Idempotent on `commandId` when the payload matches; raises
   * `CommandPayloadConflictError` when it does not.
   */
  record(intent: CommandIntent, provenance: StorageProvenance): Promise<CommandIntent>

  /**
   * Appends an outcome.
   *
   * `committed`, `rejected` and `failed` are terminal — a rejected command did
   * not happen, a failed one wrote nothing, a committed one has its result.
   * Only `unresolved` may be followed by anything, and appending after a
   * terminal outcome raises.
   */
  appendOutcome(
    commandId: string,
    outcome: CommandOutcome,
    provenance: StorageProvenance,
  ): Promise<void>
}

/** The settled outcome, or null while a command is still unresolved. */
export function settledOutcome(entry: LedgerEntry): CommandOutcome | null {
  return entry.outcomes.find((outcome) => outcome.state !== 'unresolved') ?? null
}
