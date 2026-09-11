/**
 * The command ledger, in PostgreSQL.
 *
 * Two tables, because intent and outcome are different kinds of fact. Intent is
 * written once and never rewritten; outcomes are appended, so a command that
 * was unresolved and is later confirmed keeps both — how long the answer was
 * unknown is part of the record.
 *
 * The runtime holds `SELECT` and `INSERT` and nothing else, so neither table
 * can be edited from application code even by mistake.
 */

import {
  CommandPayloadConflictError,
  type CommandCategory,
  type CommandIntent,
  type CommandLog,
  type CommandOutcome,
  type LedgerEntry,
  type RejectionCode,
} from '~/application/analysis/commandLog'
import type { StorageProvenance } from '~/application/analysis/repositories'
import { MalformedRowError } from '~/application/analysis/repositories'
import type {
  ActorSnapshot,
  AuthorizationBasis,
  CommandInitiator,
  Mandate,
  RoleFunction,
} from '~/domain/analysis'
import { seal } from '../seal'
import { ensureProvenance } from './provenance'
import { catalog, one, run, ts, type Queryable, type SqlContext } from './sql'
import { unitOfWork, type Scope } from './transaction'

interface CommandRow {
  command_id: string
  command_type: string
  command_contract_version: string
  category: string | null
  reason: string | null
  payload_hash: string
  case_id: string | null
  thesis_revision_id: string | null
  expected_version: number | null
  actor_kind: string
  actor_employee_id: string | null
  actor_role_id: string | null
  actor_role_function: string | null
  actor_department_id: string | null
  actor_department_is_governance: boolean | null
  actor_department_handles: string[] | null
  actor_authentication: string
  organization_seed_version: string
  mandate_kind: string
  mandate_discipline: string | null
  /**
   * The department the mandate is about.
   *
   * Null on rows written before migration 0039, and on mandates where the
   * actor's own department IS the mandate's — which was every one of them until
   * a convenor could act on another desk's case.
   */
  mandate_department_id: string | null
  /** Set on an institutional-agent act; null on employee and system acts. */
  actor_agent_principal_id: string | null
  authorization_basis: string
  initiator_kind: string
  initiator_id: string
  correlation_id: string
  occurred_at: string
  received_at: string
}

interface OutcomeRow {
  state: string
  result_kind: string | null
  result_ref: string | null
  reason_code: string | null
  error_category: string | null
  resolution_reference: string | null
  recorded_at: string
}

const COMMAND_COLUMNS = `
  command_id, command_type, command_contract_version, category, reason,
  payload_hash,
  case_id, thesis_revision_id, expected_version,
  actor_kind, actor_employee_id, actor_role_id, actor_role_function,
  actor_department_id, actor_department_is_governance, actor_department_handles,
  actor_authentication, organization_seed_version,
  mandate_kind, mandate_discipline, mandate_department_id, authorization_basis,
  actor_agent_principal_id,
  initiator_kind, initiator_id, correlation_id,
  ${ts('occurred_at')}, ${ts('received_at')}
`

export const COMMAND_SQL = catalog({
  find: `SELECT ${COMMAND_COLUMNS} FROM analysis.commands
         WHERE command_id = $1 AND tenant_id = $2`,

  outcomes: `SELECT state, result_kind, result_ref, reason_code, error_category,
                    resolution_reference, ${ts('recorded_at')}
             FROM analysis.command_outcomes
             WHERE command_id = $1 AND tenant_id = $2
             ORDER BY seq`,

  record: `INSERT INTO analysis.commands
             (command_id, tenant_id, command_type, command_contract_version,
              category, reason,
              payload_hash, case_id, thesis_revision_id, expected_version,
              actor_kind, actor_employee_id, actor_role_id, actor_role_function,
              actor_department_id, actor_department_is_governance,
              actor_department_handles, actor_authentication,
              organization_seed_version, mandate_kind, mandate_discipline,
              mandate_department_id, actor_agent_principal_id,
              authorization_basis, initiator_kind, initiator_id, correlation_id,
              occurred_at, received_at, provenance_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                   $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
           ON CONFLICT (command_id, tenant_id) DO NOTHING`,

  /*
   * `seq` is derived inside the statement rather than read first: two
   * concurrent appends would otherwise compute the same number, and the unique
   * constraint would reject one of them for the wrong reason.
   */
  appendOutcome: `INSERT INTO analysis.command_outcomes
                    (command_id, tenant_id, seq, state, result_kind, result_ref,
                     reason_code, error_category, resolution_reference,
                     recorded_at, provenance_id)
                  SELECT $1, $2,
                         coalesce(max(seq), 0) + 1,
                         $3, $4, $5, $6, $7, $8, $9, $10
                  FROM analysis.command_outcomes
                  WHERE command_id = $1 AND tenant_id = $2`,
})

/**
 * The department a mandate is about, where it names one.
 *
 * Written explicitly because the actor's department stopped being a safe proxy
 * for it: a convenor acts on a case another desk owns.
 */
function mandateDepartmentOf(mandate: Mandate): string | null {
  if ('departmentId' in mandate) return mandate.departmentId
  if ('owningDepartmentId' in mandate) return mandate.owningDepartmentId
  if ('proposedByDepartmentId' in mandate) return mandate.proposedByDepartmentId
  return null
}

function toMandate(row: CommandRow): Mandate {
  switch (row.mandate_kind) {
    case 'investment-committee-convenor':
      /*
       * No fallback to `actor_department_id`. For every other department-scoped
       * mandate the two coincide; for this one they deliberately do not, and
       * guessing would make the ledger say the Chairman convened for their own
       * desk. Migration 0039 constrains the column to be present.
       */
      return {
        kind: 'investment-committee-convenor',
        owningDepartmentId: row.mandate_department_id!,
      }
    case 'governance-verdict':
      return { kind: 'governance-verdict', discipline: row.mandate_discipline! }
    case 'department-contribution':
      return { kind: 'department-contribution', departmentId: row.actor_department_id! }
    case 'department-manager':
      return { kind: 'department-manager', departmentId: row.actor_department_id! }
    case 'thesis-owner':
      return { kind: 'thesis-owner', proposedByDepartmentId: row.actor_department_id! }
    case 'chief-decision':
      return { kind: 'chief-decision' }
    case 'any-employee':
      return { kind: 'any-employee' }
    case 'system-operation':
      return { kind: 'system-operation' }
    default:
      throw new MalformedRowError(
        'command',
        `unknown mandate "${row.mandate_kind}"`,
        'commands.find',
      )
  }
}

/**
 * The stored actor kind, mapped exhaustively.
 *
 * **This used to be `row.actor_kind === 'system' ? 'system' : 'employee'`**,
 * which was correct while two kinds existed and became a falsification the
 * moment a third did: an institutional agent would have rehydrated as a human
 * employee, and the ledger would have reported a person performing an act no
 * person performed.
 *
 * Unknown values fail closed. A principal kind this build does not understand
 * is not a reason to guess the most familiar one — it is a reason to refuse,
 * the same discipline `toMandate` and the authentication check already apply.
 */
function toActorKind(stored: string): ActorSnapshot['kind'] {
  switch (stored) {
    case 'employee':
      return 'employee'
    case 'institutional-agent':
      return 'institutional-agent'
    case 'system':
      return 'system'
    default:
      throw new MalformedRowError(
        'command',
        `unknown actor kind "${stored}"`,
        'commands.find',
      )
  }
}

function toActor(row: CommandRow): ActorSnapshot {
  if (row.actor_authentication !== 'system-asserted') {
    throw new MalformedRowError(
      'command',
      `unknown authentication state "${row.actor_authentication}"`,
      'commands.find',
    )
  }
  return {
    kind: toActorKind(row.actor_kind),
    employeeId: row.actor_employee_id,
    agentPrincipalId: row.actor_agent_principal_id,
    roleId: row.actor_role_id,
    roleFunction: (row.actor_role_function as RoleFunction | null) ?? null,
    departmentId: row.actor_department_id,
    departmentIsGovernance: row.actor_department_is_governance,
    departmentHandles: row.actor_department_handles ?? [],
    authentication: 'system-asserted',
    organizationSeedVersion: row.organization_seed_version,
  }
}

function toOutcome(row: OutcomeRow): CommandOutcome {
  switch (row.state) {
    case 'committed':
      return {
        state: 'committed',
        resultKind: row.result_kind!,
        resultRef: row.result_ref!,
        recordedAt: row.recorded_at,
      }
    case 'rejected':
      return {
        state: 'rejected',
        reasonCode: row.reason_code as RejectionCode,
        recordedAt: row.recorded_at,
      }
    case 'failed':
      return {
        state: 'failed',
        errorCategory: row.error_category!,
        recordedAt: row.recorded_at,
      }
    case 'unresolved':
      return {
        state: 'unresolved',
        resolutionReference: row.resolution_reference ?? '',
        recordedAt: row.recorded_at,
      }
    default:
      throw new MalformedRowError(
        'command outcome',
        `unknown state "${row.state}"`,
        'commands.find',
      )
  }
}

export function createCommandLog(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): CommandLog {
  async function read(
    client: Queryable,
    commandId: string,
    operation: string,
  ): Promise<LedgerEntry | null> {
    const row = await one<CommandRow>(client, context, operation, COMMAND_SQL.find, [
      commandId,
      tenantId,
    ])
    if (!row) return null

    const outcomes = await run<OutcomeRow>(
      client,
      context,
      operation,
      COMMAND_SQL.outcomes,
      [commandId, tenantId],
    )

    return seal(
      {
        intent: {
          commandId: row.command_id,
          commandType: row.command_type,
          commandContractVersion: row.command_contract_version,
          /*
           * A version-1 record carries no category, and is read as the
           * version-1 record it is. Substituting a plausible default would
           * make the ledger describe a declaration nobody made.
           */
          ...(row.category ? { category: row.category as CommandCategory } : {}),
          ...(row.reason ? { reason: row.reason } : {}),
          payloadHash: row.payload_hash,
          ...(row.case_id ? { caseId: row.case_id } : {}),
          ...(row.thesis_revision_id ? { thesisRevisionId: row.thesis_revision_id } : {}),
          ...(row.expected_version !== null
            ? { expectedVersion: row.expected_version }
            : {}),
          actor: toActor(row),
          mandate: toMandate(row),
          authorizationBasis: row.authorization_basis as AuthorizationBasis,
          initiator: {
            kind: row.initiator_kind,
            ...(row.initiator_kind === 'employee'
              ? { employeeId: row.initiator_id }
              : row.initiator_kind === 'orchestrator'
                ? { orchestratorId: row.initiator_id }
                : row.initiator_kind === 'recorded-provider'
                  ? { providerId: row.initiator_id }
                  : { systemId: row.initiator_id }),
          } as CommandInitiator,
          correlationId: row.correlation_id,
          occurredAt: row.occurred_at,
          receivedAt: row.received_at,
        } as CommandIntent,
        outcomes: outcomes.map(toOutcome),
      },
      'commands',
    )
  }

  const initiatorId = (initiator: CommandInitiator) =>
    initiator.kind === 'employee'
      ? initiator.employeeId
      : initiator.kind === 'orchestrator'
        ? initiator.orchestratorId
        : initiator.kind === 'recorded-provider'
          ? initiator.providerId
          : initiator.systemId

  return {
    find: (commandId) =>
      unitOfWork(scope, 'commands.find', (client) =>
        read(client, commandId, 'commands.find'),
      ),

    record: (intent, provenance: StorageProvenance) =>
      unitOfWork(scope, 'commands.record', async (client) => {
        const existing = await read(client, intent.commandId, 'commands.record')
        if (existing) {
          // One command id identifies one request. Reusing it for a different
          // payload is not a retry.
          if (existing.intent.payloadHash !== intent.payloadHash) {
            throw new CommandPayloadConflictError(
              intent.commandId,
              existing.intent.payloadHash,
              intent.payloadHash,
            )
          }
          return existing.intent
        }

        /*
         * The ledger owns its foreign key. Ensuring the provenance row here
         * rather than at startup means a command can be recorded by any code
         * path without a separate bootstrap step having run first.
         */
        await ensureProvenance(client, context, provenance, intent.receivedAt)

        const actor = intent.actor
        await run(client, context, 'commands.record', COMMAND_SQL.record, [
          intent.commandId,
          tenantId,
          intent.commandType,
          intent.commandContractVersion,
          intent.category,
          intent.reason ?? null,
          intent.payloadHash,
          intent.caseId ?? null,
          intent.thesisRevisionId ?? null,
          intent.expectedVersion ?? null,
          actor.kind,
          actor.employeeId,
          actor.roleId,
          actor.roleFunction,
          actor.departmentId,
          actor.departmentIsGovernance,
          actor.departmentHandles.length > 0 ? [...actor.departmentHandles] : null,
          actor.authentication,
          actor.organizationSeedVersion,
          intent.mandate.kind,
          'discipline' in intent.mandate ? intent.mandate.discipline : null,
          mandateDepartmentOf(intent.mandate),
          actor.agentPrincipalId,
          intent.authorizationBasis,
          intent.initiator.kind,
          initiatorId(intent.initiator),
          intent.correlationId,
          intent.occurredAt,
          intent.receivedAt,
          provenance.provenanceId,
        ])
        return intent
      }),

    appendOutcome: (commandId, outcome, provenance: StorageProvenance) =>
      unitOfWork(scope, 'commands.appendOutcome', async (client) => {
        await run(client, context, 'commands.appendOutcome', COMMAND_SQL.appendOutcome, [
          commandId,
          tenantId,
          outcome.state,
          outcome.state === 'committed' ? outcome.resultKind : null,
          outcome.state === 'committed' ? outcome.resultRef : null,
          outcome.state === 'rejected' ? outcome.reasonCode : null,
          outcome.state === 'failed' ? outcome.errorCategory : null,
          outcome.state === 'unresolved' ? outcome.resolutionReference : null,
          outcome.recordedAt,
          provenance.provenanceId,
        ])
      }),
  }
}
