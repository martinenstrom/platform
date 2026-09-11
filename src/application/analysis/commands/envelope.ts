/**
 * What a command is, and what it can come back as.
 *
 * One handler is one `withTransaction`. No handler calls another — composition
 * happens above by issuing a second command, so every transaction boundary
 * stays visible in the ledger.
 */

import { stableHashHex } from '~/domain/shared/hash'
import {
  type AssertedActor,
  type CommandInitiator,
  type Mandate,
} from '~/domain/analysis'
import type { StorageError, StorageProvenance } from '../repositories'
import type {
  CommandCategory,
  CommandOutcome,
  LedgerEntry,
  RejectionCode,
} from '../commandLog'
import {
  canonicalIdentityInput,
  type CanonicalValue,
} from '~/domain/shared/canonicalValue'

/**
 * The command contract version.
 *
 * Bumped when the **envelope**, the **outcome vocabulary** or the
 * **`expectedVersion` policy** changes in a way that alters what a stored
 * command means. Recorded in provenance, so an audit can tell which contract
 * produced a ledger entry.
 *
 * A stored command keeps the version it was written under. Reading a
 * version-1 record as though it were version 2 would attribute a reason and a
 * category to a command that was issued before either existed.
 *
 * **Payload canonicalization is NOT one of the triggers.** It has its own
 * coordinate below, and that coordinate is the first field inside the hashed
 * input — so a reader can already tell which canonicalization produced a given
 * hash. Listing it here as well would double-version one change: TD-61 altered
 * the payload encoding and nothing about the envelope, the outcome vocabulary
 * or `expectedVersion`, and bumping both would have claimed a command-semantics
 * change that did not happen.
 *
 * History:
 *   1  Phase C1A — the foundation
 *   2  Phase C1B — command reason and category; conditional requirements
 *      resolve explicitly rather than being recomputed
 */
export const COMMAND_CONTRACT_VERSION = '2'

/**
 * How the payload hash is computed.
 *
 * Versioned for the same reason evidence identity is: if canonicalization
 * changes, two identical payloads could hash differently and a replay would
 * look like a conflict.
 *
 * The version is bound **inside** the hashed input, so a version-1 hash and a
 * version-2 hash of the same payload differ by construction and can never be
 * compared as though they were the same claim.
 *
 * History:
 *   1  Phase C1A — `canonicalJson`: JSON.stringify with locale-sorted keys
 *   2  TD-61 — canonical value v1: a specified value model with a specified
 *      byte encoding, refusing the values the previous one silently collided
 *      (NaN, the infinities, undefined, negative zero, every Date)
 */
export const PAYLOAD_CANONICALIZATION_VERSION = '2'

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
  /**
   * Why this was issued, as opposed to what it did.
   *
   * Governed by the command's `reasonPolicy` and enforced in all three
   * directions. Part of the payload identity: two requests differing only in
   * their reason are two different institutional records, and a genuine retry
   * carries the same envelope, so nothing legitimate is broken by counting it.
   */
  reason?: string
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
/** Domain tag for command-payload identity, per `docs/canonical-value-v1.md` §9. */
const COMMAND_PAYLOAD_DOMAIN = 'financial-os:command-payload:v1'

export function commandPayloadHash(input: {
  commandType: string
  caseId?: string
  thesisRevisionId?: string
  expectedVersion?: number
  accountableEmployeeId: string | null
  /**
   * Set only when a named Financial OS specialist is accountable.
   *
   * Deliberately NOT folded into `accountableEmployeeId`: an agent id in a
   * field defined as an employee id would make the record say a person was
   * accountable when none was.
   */
  accountableAgentPrincipalId?: string | null
  reason?: string
  payload: CanonicalValue
}): string {
  /*
   * ## The tenth key is present only for an agent act
   *
   * The canonical object encoding is length-prefixed by member count, so a key
   * that is absent is absent from the bytes. Employee and system acts therefore
   * hash exactly as they always have — measured, not assumed: the nine-key form
   * reproduces every historical hash byte for byte, and `identityCorpus`
   * pins the literal `d9:` string.
   *
   * An agent act encodes `d10:` and so cannot collide with a system act, which
   * also has no accountable employee but carries nine keys.
   *
   * This is why no canonicalization version bump is needed. A bump would signal
   * that existing vectors need reinterpreting, and they do not.
   */
  const agentPrincipalId = input.accountableAgentPrincipalId
  return stableHashHex(
    canonicalIdentityInput(COMMAND_PAYLOAD_DOMAIN, {
      canonicalization: PAYLOAD_CANONICALIZATION_VERSION,
      contract: COMMAND_CONTRACT_VERSION,
      type: input.commandType,
      caseId: input.caseId ?? null,
      thesisRevisionId: input.thesisRevisionId ?? null,
      expectedVersion: input.expectedVersion ?? null,
      accountable: input.accountableEmployeeId,
      ...(agentPrincipalId
        ? {
            accountablePrincipal: {
              kind: 'institutional-agent',
              id: agentPrincipalId,
            },
          }
        : {}),
      reason: input.reason ?? null,
      payload: input.payload,
    }),
  )
}

/* ------------------------------------------------- category versus mandate */

/**
 * Whether a declared category can be true of a command with this mandate.
 *
 * Two taxonomies describing one act will disagree eventually, so this is the
 * rule that stops them. The mandate is the authority the command ran under and
 * is decided by `authorize`; the category is a declaration. Where the mandate
 * implies a category, the declaration must match it — and, just as important,
 * a command whose mandate is *not* a governance verdict may not file itself as
 * governance.
 */
export function categoryMatchesMandate(
  category: CommandCategory,
  mandate: Mandate,
): boolean {
  switch (mandate.kind) {
    case 'governance-verdict':
      return category === 'governance'
    case 'chief-decision':
      return category === 'decision'
    case 'system-operation':
      return category === 'system'
    default:
      // Analysis versus workflow is a genuine judgement the definition makes.
      // The reserved three are not available to it.
      return category === 'analysis' || category === 'workflow'
  }
}

/**
 * Thrown when a command declares a category its mandate cannot support.
 *
 * A programming error rather than a rejection: the command never reaches the
 * ledger, because a mislabelled institutional act is worse than a failed one.
 */
export class CommandCategoryMismatchError extends Error {
  constructor(commandType: string, category: CommandCategory, mandateKind: string) {
    super(
      `Command "${commandType}" declares category "${category}" but runs under ` +
        `mandate "${mandateKind}", which cannot support it. The ledger must not ` +
        `contain an act filed as something it was not authorised as.`,
    )
    this.name = 'CommandCategoryMismatchError'
  }
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
