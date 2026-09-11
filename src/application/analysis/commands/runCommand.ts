/**
 * The command runner.
 *
 * One command is one transaction, and the ledger entry commits inside it — so
 * a committed command can never exist without its effect, and an effect can
 * never exist without its command identity.
 *
 * The four outcomes stay distinct because they are different facts:
 *
 *   committed   the result and its identity are durably stored
 *   rejected    understood and durably evaluated; a rule prevented it
 *   failed      operational failure before any committed effect
 *   unresolved  the commit outcome cannot yet be proven
 *
 * A rejection is **not** a system failure and must never be reported as one.
 * An unresolved commit is neither success nor failure until it is settled.
 */

import {
  authorize,
  resolveActor,
  UnknownActorError,
  type ActorSnapshot,
  type Organization,
} from '~/domain/analysis'
import {
  AmbiguousCommitError,
  StorageError,
  ConcurrencyConflictError,
  type AnalysisRepositories,
  type StorageProvenance,
} from '../repositories'
import {
  CommandPayloadConflictError,
  type CommandIntent,
  type LedgerEntry,
} from '../commandLog'
import {
  COMMAND_CONTRACT_VERSION,
  CommandCategoryMismatchError,
  CommandRejectedError,
  categoryMatchesMandate,
  commandPayloadHash,
  resultFromLedger,
  type CommandEnvelope,
  type CommandResult,
  type DomainRejection,
} from './envelope'
import type { CommandDefinition } from './definition'

export interface CommandDeps {
  repositories: AnalysisRepositories
  organization: Organization
  organizationSeedVersion: string
  provenance: StorageProvenance
  /** Wall clock for `receivedAt`. Domain time comes from the envelope. */
  now: () => string
}

/** Category label for the ledger. Bounded — never a message. */
function errorCategory(error: unknown): string {
  const name = (error as { name?: string } | null)?.name ?? 'UnknownError'
  return name.replace(/Error$/, '').toLowerCase()
}

export async function runCommand<Input, Result>(
  definition: CommandDefinition<Input, Result>,
  input: Input,
  envelope: CommandEnvelope,
  deps: CommandDeps,
): Promise<CommandResult<Result>> {
  const { repositories, organization, provenance } = deps

  /* ---------------------------------------------------- the declarations */

  const declarationRejection =
    checkVersionPolicy(definition, envelope) ?? checkReasonPolicy(definition, envelope)
  if (declarationRejection) {
    return recordRejection(definition, input, envelope, deps, null, declarationRejection)
  }

  /* --------------------------------------------------------- the actor */

  let actor: ActorSnapshot
  try {
    actor = resolveActor(organization, deps.organizationSeedVersion, envelope.actor)
  } catch (error) {
    if (error instanceof UnknownActorError) {
      // No snapshot exists, so nothing can be recorded against an employee who
      // is not one. Reported, not written.
      return {
        outcome: 'rejected',
        commandId: envelope.commandId,
        rejection: { code: 'unknown-actor', detail: error.message },
        durablyRecorded: false,
      }
    }
    throw error
  }

  /* ---------------------------------------------------------- the mandate */

  const mandate = definition.mandate(input)

  /*
   * The category is checked against the mandate BEFORE anything is written.
   * A mislabelled institutional act in an immutable ledger is worse than a
   * failed request, and this is a programming error rather than something a
   * caller did — so it throws rather than rejecting.
   */
  if (!categoryMatchesMandate(definition.category, mandate)) {
    throw new CommandCategoryMismatchError(
      definition.type,
      definition.category,
      mandate.kind,
    )
  }

  const decision = authorize(organization, actor, mandate)
  if (!decision.authorized) {
    return recordRejection(definition, input, envelope, deps, actor, {
      code: 'not-authorised',
      detail: decision.reason,
    })
  }

  /* -------------------------------------------------------- prior identity */

  const scope = definition.scope(input)
  const reason = normalizedReason(envelope)
  const payloadHash = commandPayloadHash({
    commandType: definition.type,
    caseId: scope.caseId,
    thesisRevisionId: scope.thesisRevisionId,
    expectedVersion: envelope.expectedVersion,
    accountableEmployeeId: actor.employeeId,
    accountableAgentPrincipalId: actor.agentPrincipalId,
    ...(reason ? { reason } : {}),
    payload: definition.payload(input),
  })

  const existing = await findExisting(repositories, envelope.commandId)
  if (existing) {
    if (existing.intent.payloadHash !== payloadHash) {
      // Loud: two different requests are travelling under one identity.
      return {
        outcome: 'rejected',
        commandId: envelope.commandId,
        rejection: {
          code: 'payload-conflict',
          detail: new CommandPayloadConflictError(
            envelope.commandId,
            existing.intent.payloadHash,
            payloadHash,
          ).message,
        },
        durablyRecorded: true,
      }
    }
    // An identical replay resolves to the original outcome, without executing.
    return resultFromLedger(existing, provenance, (committed) =>
      repositories.withTransaction((tx) => definition.rehydrate(tx, committed.resultRef)),
    )
  }

  const intent: CommandIntent = {
    commandId: envelope.commandId,
    commandType: definition.type,
    commandContractVersion: COMMAND_CONTRACT_VERSION,
    category: definition.category,
    payloadHash,
    ...(scope.caseId ? { caseId: scope.caseId } : {}),
    ...(scope.thesisRevisionId ? { thesisRevisionId: scope.thesisRevisionId } : {}),
    ...(envelope.expectedVersion !== undefined
      ? { expectedVersion: envelope.expectedVersion }
      : {}),
    actor,
    mandate,
    authorizationBasis: decision.basis,
    initiator: envelope.initiator,
    ...(reason ? { reason } : {}),
    correlationId: envelope.correlationId,
    occurredAt: envelope.occurredAt,
    receivedAt: deps.now(),
  }

  /* ------------------------------------------------------------ execution */

  try {
    const effect = await repositories.withTransaction(async (tx) => {
      const produced = await definition.execute(
        tx,
        {
          commandId: envelope.commandId,
          actor,
          occurredAt: envelope.occurredAt,
          correlationId: envelope.correlationId,
          provenance,
          ...(reason ? { reason } : {}),
          ...(envelope.expectedVersion !== undefined
            ? { expectedVersion: envelope.expectedVersion }
            : {}),
        },
        input,
      )

      /*
       * Intent and outcome commit with the effect. That is what makes
       * "a committed command never exists without its effect, and an effect
       * never exists without its command identity" true rather than intended.
       */
      await tx.commands.record(intent, provenance)
      await tx.commands.appendOutcome(
        envelope.commandId,
        {
          state: 'committed',
          resultKind: produced.resultKind,
          resultRef: produced.resultRef,
          recordedAt: deps.now(),
        },
        provenance,
      )
      return produced
    })

    return {
      outcome: 'committed',
      value: effect.value,
      commandId: envelope.commandId,
      resultKind: effect.resultKind,
      resultRef: effect.resultRef,
      provenance,
    }
  } catch (error) {
    /*
     * The effect has already rolled back, so the rejection is recorded in its
     * own transaction. That is how a refusal becomes durable without the
     * forbidden effect coming with it.
     */
    if (error instanceof CommandRejectedError) {
      return recordRejection(definition, input, envelope, deps, actor, error.rejection)
    }
    if (error instanceof ConcurrencyConflictError) {
      return recordRejection(definition, input, envelope, deps, actor, {
        code: 'aggregate-conflict',
        detail: error.message,
      })
    }

    if (error instanceof AmbiguousCommitError) {
      /*
       * Neither success nor failure. The intent write was inside the same
       * transaction, so even it is uncertain — `resolveCommand` settles it by
       * looking for the command id once the database answers again.
       */
      return {
        outcome: 'unresolved',
        commandId: envelope.commandId,
        probe: {
          commandId: envelope.commandId,
          commandType: definition.type,
          intentUncertain: true,
        },
      }
    }

    const storageError =
      error instanceof StorageError
        ? error
        : new StorageError(String(error), definition.type)

    // Best effort. When the database is unavailable this cannot be written,
    // and saying so is the honest answer — see `durablyRecorded`.
    const durablyRecorded = await tryRecord(deps, intent, {
      state: 'failed',
      errorCategory: errorCategory(storageError),
      recordedAt: deps.now(),
    })

    return {
      outcome: 'failed',
      commandId: envelope.commandId,
      error: storageError,
      durablyRecorded,
    }
  }
}

/* -------------------------------------------------------------- helpers */

function checkVersionPolicy<I, R>(
  definition: CommandDefinition<I, R>,
  envelope: CommandEnvelope,
): DomainRejection | null {
  const supplied = envelope.expectedVersion !== undefined
  if (definition.versionPolicy === 'requires-expected-version' && !supplied) {
    return {
      code: 'invariant-violated',
      detail:
        `"${definition.type}" moves case-level state and requires an expected ` +
        `version. Read the case, then supply the version you read.`,
    }
  }
  if (definition.versionPolicy === 'refuses-expected-version' && supplied) {
    return {
      code: 'invariant-violated',
      detail:
        `"${definition.type}" does not move case-level state and must not carry ` +
        `an expected version. Ignoring it would offer concurrency protection ` +
        `that does not exist.`,
    }
  }
  return null
}

/**
 * The reason as it will be stored: trimmed, or absent.
 *
 * A whitespace-only reason is not a reason, and normalizing here means the
 * policy check, the payload hash and the stored row all agree on that.
 */
function normalizedReason(envelope: CommandEnvelope): string | undefined {
  const trimmed = envelope.reason?.trim()
  return trimmed ? trimmed : undefined
}

function checkReasonPolicy<I, R>(
  definition: CommandDefinition<I, R>,
  envelope: CommandEnvelope,
): DomainRejection | null {
  const reason = normalizedReason(envelope)

  if (definition.reasonPolicy === 'required' && !reason) {
    return {
      code: 'invariant-violated',
      detail:
        `"${definition.type}" reverses or materially redirects institutional ` +
        `work and requires a reason. A blank or whitespace-only reason is not ` +
        `a reason.`,
    }
  }
  if (definition.reasonPolicy === 'forbidden' && reason) {
    return {
      code: 'invariant-violated',
      detail:
        `"${definition.type}" is a technical operation with no institutional ` +
        `effect and must not carry a free-form reason. Storing one would ` +
        `create unreviewed prose on a record nobody audits.`,
    }
  }
  return null
}

async function findExisting(
  repositories: AnalysisRepositories,
  commandId: string,
): Promise<LedgerEntry | null> {
  try {
    return await repositories.commands.find(commandId)
  } catch {
    // A read failure here is not the command's outcome; execution will fail
    // and be reported on its own terms.
    return null
  }
}

/** Records a refusal durably, without the effect it refused. */
async function recordRejection<I, R>(
  definition: CommandDefinition<I, R>,
  input: I,
  envelope: CommandEnvelope,
  deps: CommandDeps,
  actor: ActorSnapshot | null,
  rejection: DomainRejection,
): Promise<CommandResult<R>> {
  if (!actor) {
    return {
      outcome: 'rejected',
      commandId: envelope.commandId,
      rejection,
      durablyRecorded: false,
    }
  }

  const scope = definition.scope(input)
  const reason = normalizedReason(envelope)
  const intent: CommandIntent = {
    commandId: envelope.commandId,
    commandType: definition.type,
    commandContractVersion: COMMAND_CONTRACT_VERSION,
    category: definition.category,
    payloadHash: commandPayloadHash({
      commandType: definition.type,
      caseId: scope.caseId,
      thesisRevisionId: scope.thesisRevisionId,
      expectedVersion: envelope.expectedVersion,
      accountableEmployeeId: actor.employeeId,
      accountableAgentPrincipalId: actor.agentPrincipalId,
      ...(reason ? { reason } : {}),
      payload: definition.payload(input),
    }),
    ...(scope.caseId ? { caseId: scope.caseId } : {}),
    ...(scope.thesisRevisionId ? { thesisRevisionId: scope.thesisRevisionId } : {}),
    ...(envelope.expectedVersion !== undefined
      ? { expectedVersion: envelope.expectedVersion }
      : {}),
    actor,
    mandate: definition.mandate(input),
    // A refusal has no authorizing basis; the reason is on the outcome.
    authorizationBasis: 'employee-of-the-firm',
    initiator: envelope.initiator,
    ...(reason ? { reason } : {}),
    correlationId: envelope.correlationId,
    occurredAt: envelope.occurredAt,
    receivedAt: deps.now(),
  }

  const durablyRecorded = await tryRecord(deps, intent, {
    state: 'rejected',
    reasonCode: rejection.code,
    recordedAt: deps.now(),
  })

  return {
    outcome: 'rejected',
    commandId: envelope.commandId,
    rejection,
    durablyRecorded,
  }
}

/**
 * Writes intent and one outcome in their own transaction.
 *
 * Returns whether it landed. **The database cannot record its own
 * unavailability**, so a false here is an operational delivery failure rather
 * than an institutional command, and the caller is told which it got.
 */
async function tryRecord(
  deps: CommandDeps,
  intent: CommandIntent,
  outcome: Parameters<AnalysisRepositories['commands']['appendOutcome']>[1],
): Promise<boolean> {
  try {
    await deps.repositories.withTransaction(async (tx) => {
      await tx.commands.record(intent, deps.provenance)
      await tx.commands.appendOutcome(intent.commandId, outcome, deps.provenance)
    })
    return true
  } catch {
    return false
  }
}
