/**
 * Assignments, runs and claims.
 *
 * Claims are stored beside their run rather than inside it, because a claim is
 * cited by theses, contested by challenges and verified individually — so it
 * needs its own identity and its own lookups. `runs.get` therefore hydrates
 * them back onto the record, in a fixed number of statements.
 */

import { ConflictingRecordError } from '~/application/analysis/repositories'
import type {
  AssignmentRepository,
  ClaimRepository,
  RunRepository,
} from '~/application/analysis/repositories'
import type { AgentClaim, AgentRunRecord } from '~/domain/analysis'
import { groupBy } from './caseRepositories'
import { toAssignment, toClaim, toRun } from './mapping'
import type {
  AssignmentRow,
  ClaimEvidenceRow,
  ClaimRow,
  RunEventRow,
  RunRow,
} from './rows'
import { catalog, one, run, ts, type SqlContext } from './sql'
import { activeClient, type Scope } from './transaction'

/* ------------------------------------------------------------ assignments */

const ASSIGNMENT_COLUMNS = `
  id, case_id, tenant_id, department_id, assignee_employee_id, playbook_entry_key,
  brief, status, priority, ${ts('created_at')}, ${ts('started_at')},
  ${ts('completed_at')}, waiting_on_kind, waiting_on_assignment_id,
  waiting_on_description, returned_reason
`

/** `priority DESC, created_at, id` — the port's contract, on both listings. */
const ASSIGNMENT_ORDER = `ORDER BY priority DESC, created_at, id COLLATE "C"`

export const ASSIGNMENT_SQL = catalog({
  get: `SELECT ${ASSIGNMENT_COLUMNS} FROM analysis.assignments WHERE id = $1`,

  listForCase: `SELECT ${ASSIGNMENT_COLUMNS} FROM analysis.assignments
                WHERE case_id = $1 ${ASSIGNMENT_ORDER}`,

  listForDepartment: `SELECT ${ASSIGNMENT_COLUMNS} FROM analysis.assignments
                      WHERE department_id = $1 ${ASSIGNMENT_ORDER}`,

  /*
   * The SET list is exactly the column grant `finos_app` holds. `brief`,
   * `case_id` and `department_id` are what the assignment IS, and are absent
   * on purpose — a blanket SET would be denied as well as wrong.
   */
  save: `INSERT INTO analysis.assignments
           (id, case_id, tenant_id, department_id, assignee_employee_id,
            playbook_entry_key, brief, status, priority, created_at, started_at,
            completed_at, waiting_on_kind, waiting_on_assignment_id,
            waiting_on_description, returned_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           assignee_employee_id = EXCLUDED.assignee_employee_id,
           priority = EXCLUDED.priority,
           started_at = EXCLUDED.started_at,
           completed_at = EXCLUDED.completed_at,
           waiting_on_kind = EXCLUDED.waiting_on_kind,
           waiting_on_assignment_id = EXCLUDED.waiting_on_assignment_id,
           waiting_on_description = EXCLUDED.waiting_on_description,
           returned_reason = EXCLUDED.returned_reason`,
})

export function createAssignmentRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): AssignmentRepository {
  const list = async (operation: string, sql: string, parameter: string) => {
    const client = activeClient(scope, operation)
    const rows = await run<AssignmentRow>(client, context, operation, sql, [parameter])
    return rows.map(toAssignment)
  }

  return {
    async get(assignmentId) {
      const client = activeClient(scope, 'assignments.get')
      const row = await one<AssignmentRow>(
        client,
        context,
        'assignments.get',
        ASSIGNMENT_SQL.get,
        [assignmentId],
      )
      return row ? toAssignment(row) : null
    },

    listForCase: (caseId) =>
      list('assignments.listForCase', ASSIGNMENT_SQL.listForCase, caseId),

    listForDepartment: (departmentId) =>
      list(
        'assignments.listForDepartment',
        ASSIGNMENT_SQL.listForDepartment,
        departmentId,
      ),

    async save(assignment) {
      const client = activeClient(scope, 'assignments.save')
      const waitingOn = assignment.waitingOn
      await run(client, context, 'assignments.save', ASSIGNMENT_SQL.save, [
        assignment.id,
        assignment.caseId,
        tenantId,
        assignment.departmentId,
        assignment.assigneeEmployeeId ?? null,
        null,
        assignment.brief,
        assignment.status,
        assignment.priority,
        assignment.createdAt,
        assignment.startedAt ?? null,
        assignment.completedAt ?? null,
        waitingOn?.kind ?? null,
        waitingOn?.kind === 'assignment' ? waitingOn.assignmentId : null,
        waitingOn?.kind === 'evidence' ? waitingOn.description : null,
        assignment.returnedReason ?? null,
      ])
      return (await this.get(assignment.id))!
    },
  }
}

/* ------------------------------------------------------------------ claims */

const CLAIM_COLUMNS = `
  id, case_id, tenant_id, run_id, type, statement, status, confidence_level,
  confidence_capped_by, confidence_basis, ${ts('temporal_as_of')},
  temporal_horizon, contests_claim_id, supports_thesis_id, opposes_thesis_id,
  causal_attribution
`

export const CLAIM_SQL = catalog({
  get: `SELECT ${CLAIM_COLUMNS} FROM analysis.claims WHERE id = $1`,

  listForRun: `SELECT ${CLAIM_COLUMNS} FROM analysis.claims
               WHERE run_id = $1 ORDER BY id COLLATE "C"`,

  listForCase: `SELECT ${CLAIM_COLUMNS} FROM analysis.claims
                WHERE case_id = $1 ORDER BY id COLLATE "C"`,

  forRuns: `SELECT ${CLAIM_COLUMNS} FROM analysis.claims
            WHERE run_id = ANY($1::text[]) ORDER BY run_id COLLATE "C", id COLLATE "C"`,

  evidence: `SELECT claim_id, evidence_set_id, observation_id, content_hash, stance
             FROM analysis.claim_evidence WHERE claim_id = ANY($1::text[])
             ORDER BY claim_id COLLATE "C", stance COLLATE "C",
                      evidence_set_id COLLATE "C", observation_id COLLATE "C"`,

  // Write-once. A claim that has been cited must not change underneath it.
  save: `INSERT INTO analysis.claims
           (id, case_id, tenant_id, run_id, type, statement, status,
            confidence_level, confidence_capped_by, confidence_basis,
            temporal_as_of, temporal_horizon, contests_claim_id,
            supports_thesis_id, opposes_thesis_id, causal_attribution)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (id) DO NOTHING`,

  saveEvidence: `INSERT INTO analysis.claim_evidence
                   (claim_id, evidence_set_id, observation_id, content_hash, stance)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT DO NOTHING`,
})

async function hydrateClaims(
  scope: Scope,
  context: SqlContext,
  operation: string,
  rows: ClaimRow[],
): Promise<AgentClaim[]> {
  if (rows.length === 0) return []
  const client = activeClient(scope, operation)
  const evidence = await run<ClaimEvidenceRow>(
    client,
    context,
    operation,
    CLAIM_SQL.evidence,
    [rows.map((row) => row.id)],
  )
  const byClaim = groupBy(evidence, (item) => item.claim_id)
  return rows.map((row) => toClaim(row, byClaim.get(row.id) ?? []))
}

export function createClaimRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): ClaimRepository {
  const list = async (operation: string, sql: string, parameter: string) => {
    const client = activeClient(scope, operation)
    const rows = await run<ClaimRow>(client, context, operation, sql, [parameter])
    return hydrateClaims(scope, context, operation, rows)
  }

  return {
    async get(claimId) {
      const client = activeClient(scope, 'claims.get')
      const row = await one<ClaimRow>(client, context, 'claims.get', CLAIM_SQL.get, [
        claimId,
      ])
      if (!row) return null
      return (await hydrateClaims(scope, context, 'claims.get', [row]))[0]!
    },

    listForRun: (runId) => list('claims.listForRun', CLAIM_SQL.listForRun, runId),
    listForCase: (caseId) => list('claims.listForCase', CLAIM_SQL.listForCase, caseId),

    async save(claim, caseId, runId) {
      const client = activeClient(scope, 'claims.save')
      const existing = await this.get(claim.id)
      if (existing) {
        /*
         * Write-once, so a re-save is either a replay or a fault. Returning
         * the stored claim on a replay matches the in-memory adapter;
         * different content under the same id means something upstream is
         * wrong, and silence would hide it for as long as anyone cared to look.
         */
        if (existing.statement !== claim.statement || existing.type !== claim.type) {
          throw new ConflictingRecordError('Claim', claim.id, 'claims.save')
        }
        return existing
      }

      await run(client, context, 'claims.save', CLAIM_SQL.save, [
        claim.id,
        caseId,
        tenantId,
        runId,
        claim.type,
        claim.statement,
        claim.status,
        claim.confidence.level,
        claim.confidence.cappedBy ?? null,
        JSON.stringify(claim.confidence.basis),
        claim.temporalScope.asOf,
        claim.temporalScope.horizon ?? null,
        claim.contests ?? null,
        claim.supportsThesisId ?? null,
        claim.opposesThesisId ?? null,
        claim.type === 'causal' ? JSON.stringify(claim.attribution) : null,
      ])

      for (const [stance, refs] of [
        ['supporting', claim.evidenceRefs],
        ['contradicting', claim.contradictingEvidenceRefs],
      ] as const) {
        for (const ref of refs) {
          await run(client, context, 'claims.save', CLAIM_SQL.saveEvidence, [
            claim.id,
            ref.setId,
            ref.observationId,
            ref.contentHash,
            stance,
          ])
        }
      }
      return (await this.get(claim.id))!
    },
  }
}

/* -------------------------------------------------------------------- runs */

const RUN_COLUMNS = `
  id, case_id, tenant_id, assignment_id, department_id, employee_id, revision_id,
  state, obsolete, agent_contract_version, output_schema_version, prompt_id,
  prompt_version, prompt_content_hash, model_id, model_provider,
  model_parameters_hash, model_parameters, evidence_set_id,
  ${ts('started_at')}, ${ts('completed_at')}, failure_reason,
  input_tokens, output_tokens, cost_minor_units, currency
`

export const RUN_SQL = catalog({
  get: `SELECT ${RUN_COLUMNS} FROM analysis.runs WHERE id = $1`,

  listForCase: `SELECT ${RUN_COLUMNS} FROM analysis.runs
                WHERE case_id = $1 ORDER BY started_at, id COLLATE "C"`,

  events: `SELECT run_id, ${ts('at')}, state, reason FROM analysis.run_events
           WHERE run_id = ANY($1::text[]) ORDER BY run_id COLLATE "C", at, id`,

  save: `INSERT INTO analysis.runs
           (id, case_id, tenant_id, assignment_id, department_id, employee_id,
            revision_id, state, obsolete, agent_contract_version,
            output_schema_version, prompt_id, prompt_version, prompt_content_hash,
            model_id, model_provider, model_parameters_hash, model_parameters,
            evidence_set_id, started_at, completed_at, failure_reason,
            input_tokens, output_tokens, cost_minor_units, currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                 $19,$20,$21,$22,$23,$24,$25,$26)
         ON CONFLICT (id) DO UPDATE SET
           state = EXCLUDED.state,
           obsolete = EXCLUDED.obsolete,
           completed_at = EXCLUDED.completed_at,
           failure_reason = EXCLUDED.failure_reason,
           input_tokens = EXCLUDED.input_tokens,
           output_tokens = EXCLUDED.output_tokens,
           cost_minor_units = EXCLUDED.cost_minor_units,
           currency = EXCLUDED.currency`,

  // Append-only: a run's state history is a record, not a current value.
  appendEvent: `INSERT INTO analysis.run_events (run_id, at, state, reason)
                SELECT $1, $2::timestamptz, $3, $4
                WHERE NOT EXISTS (
                  SELECT 1 FROM analysis.run_events
                  WHERE run_id = $1 AND at = $2::timestamptz AND state = $3
                )`,
})

export function createRunRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): RunRepository {
  async function hydrate(rows: RunRow[], operation: string): Promise<AgentRunRecord[]> {
    if (rows.length === 0) return []
    const client = activeClient(scope, operation)
    const ids = rows.map((row) => row.id)

    // Two statements for any number of runs, never one per run.
    const [events, claimRows] = await Promise.all([
      run<RunEventRow>(client, context, operation, RUN_SQL.events, [ids]),
      run<ClaimRow>(client, context, operation, CLAIM_SQL.forRuns, [ids]),
    ])
    const claims = await hydrateClaims(scope, context, operation, claimRows)

    const eventsByRun = groupBy(events, (event) => event.run_id)
    const claimsByRun = groupBy(
      claimRows.map((row, index) => ({ runId: row.run_id, claim: claims[index]! })),
      (entry) => entry.runId,
    )

    return rows.map((row) =>
      toRun(
        row,
        eventsByRun.get(row.id) ?? [],
        (claimsByRun.get(row.id) ?? []).map((entry) => entry.claim),
      ),
    )
  }

  return {
    async get(runId) {
      const client = activeClient(scope, 'runs.get')
      const row = await one<RunRow>(client, context, 'runs.get', RUN_SQL.get, [runId])
      if (!row) return null
      return (await hydrate([row], 'runs.get'))[0]!
    },

    async listForCase(caseId) {
      const client = activeClient(scope, 'runs.listForCase')
      const rows = await run<RunRow>(
        client,
        context,
        'runs.listForCase',
        RUN_SQL.listForCase,
        [caseId],
      )
      return hydrate(rows, 'runs.listForCase')
    },

    async save(record) {
      const client = activeClient(scope, 'runs.save')
      await run(client, context, 'runs.save', RUN_SQL.save, [
        record.id,
        record.caseId,
        tenantId,
        record.assignmentId,
        record.departmentId,
        record.employeeId,
        record.revisionId ?? null,
        record.state,
        record.obsolete ?? false,
        record.agentContractVersion,
        record.outputSchemaVersion,
        record.prompt.id,
        record.prompt.version,
        record.prompt.contentHash,
        record.model.id,
        record.model.provider,
        record.model.parametersHash,
        JSON.stringify(record.model.parameters),
        record.evidenceSetId,
        record.startedAt,
        record.completedAt ?? null,
        record.failureReason ?? null,
        record.cost?.inputTokens ?? null,
        record.cost?.outputTokens ?? null,
        record.cost?.costMinorUnits ?? null,
        record.cost?.currency ?? null,
      ])

      for (const event of record.events) {
        await run(client, context, 'runs.save', RUN_SQL.appendEvent, [
          record.id,
          event.at,
          event.state,
          event.reason ?? null,
        ])
      }
      return (await this.get(record.id))!
    },
  }
}
