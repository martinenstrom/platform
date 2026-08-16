/**
 * Assignments, runs and claims.
 *
 * Claims are stored beside their run rather than inside it, because a claim is
 * cited by theses, contested by challenges and verified individually — so it
 * needs its own identity and its own lookups. `runs.get` hydrates them back
 * onto the record in a fixed number of statements.
 *
 * Run events are **append-only**: a save carrying fewer events than a previous
 * one does not erase what was recorded. Migration 0012 put a unique constraint
 * behind that, because the previous `WHERE NOT EXISTS` guard was a race rather
 * than a rule.
 */

import {
  ConflictingRecordError,
  InvariantViolationError,
  MalformedRowError,
} from '~/application/analysis/repositories'
import type {
  AssignmentRepository,
  ClaimRepository,
  ProducedClaimRepository,
  RunRepository,
} from '~/application/analysis/repositories'
import {
  claimSemanticKey,
  producedClaimsSemanticKey,
  runEventIdentity,
  runEventSemanticKey,
} from '~/application/analysis/writeOnce'
import {
  measuredCost,
  modelOf,
  promptOf,
  type AgentClaim,
  type AgentRunRecord,
  type RunEvent,
} from '~/domain/analysis'
import { groupBy } from './caseRepositories'
import { ensureProvenance } from './provenance'
import { toAssignment, toClaim, toRun, toRunEvent } from './mapping'
import type {
  AssignmentRow,
  ClaimEvidenceRow,
  ClaimRow,
  RunEventRow,
  RunRow,
} from './rows'
import { catalog, one, run, ts, type Queryable, type SqlContext } from './sql'
import { singleStatement, unitOfWork, type Scope } from './transaction'

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
   * `case_id`, `department_id` and `playbook_entry_key` are what the assignment
   * IS, and are absent on purpose — a blanket SET would be denied as well as
   * wrong.
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
  /** One statement, so no transaction is needed to make it consistent. */
  const list = async (operation: string, sql: string, parameter: string) => {
    const rows = await run<AssignmentRow>(
      singleStatement(scope, operation),
      context,
      operation,
      sql,
      [parameter],
    )
    return rows.map(toAssignment)
  }

  return {
    async get(assignmentId) {
      const row = await one<AssignmentRow>(
        singleStatement(scope, 'assignments.get'),
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

    save: (assignment) =>
      unitOfWork(scope, 'assignments.save', async (client) => {
        const waitingOn = assignment.waitingOn
        await run(client, context, 'assignments.save', ASSIGNMENT_SQL.save, [
          assignment.id,
          assignment.caseId,
          tenantId,
          assignment.departmentId,
          assignment.assigneeEmployeeId ?? null,
          // Half of the identity that makes opening a case idempotent. Null for
          // ad-hoc work, several of which on one case is legitimate.
          assignment.playbookEntryKey ?? null,
          assignment.brief,
          assignment.status,
          assignment.priority,
          assignment.createdAt,
          assignment.startedAt ?? null,
          assignment.completedAt ?? null,
          waitingOn?.kind ?? null,
          waitingOn?.kind === 'assignment' ? waitingOn.assignmentId : null,
          waitingOn?.kind === 'evidence' ? waitingOn.evidenceSought : null,
          assignment.returnedReason ?? null,
        ])
        const row = await one<AssignmentRow>(
          client,
          context,
          'assignments.save',
          ASSIGNMENT_SQL.get,
          [assignment.id],
        )
        return toAssignment(row!)
      }),
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

  /** One statement for every citation, rather than one round trip each. */
  saveEvidence: `INSERT INTO analysis.claim_evidence
                   (claim_id, evidence_set_id, observation_id, content_hash, stance)
                 SELECT $1, s, o, h, t
                 FROM unnest($2::text[], $3::text[], $4::text[], $5::text[])
                      AS batch(s, o, h, t)
                 ON CONFLICT DO NOTHING`,
})

export async function hydrateClaims(
  client: Queryable,
  context: SqlContext,
  operation: string,
  rows: ClaimRow[],
): Promise<AgentClaim[]> {
  if (rows.length === 0) return []
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

export const PRODUCED_CLAIM_SQL = catalog({
  listForRun: `SELECT claims FROM analysis.produced_claims WHERE run_id = $1`,

  record: `INSERT INTO analysis.produced_claims
             (run_id, case_id, tenant_id, claims, produced_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (run_id) DO NOTHING`,
})

/**
 * Produced work, kept out of `analysis.claims` on purpose.
 *
 * See `ProducedClaimRepository` and migration 0027: every citation in the
 * institution is a foreign key into the claims table, so work that is not in it
 * cannot be cited — by the database, not by a convention.
 *
 * Claims are stored as canonical JSON exactly as `agent_results` stores them.
 * Acceptance moves the same claim, unchanged, into institutional storage; there
 * is no second canonicalisation on either side of that boundary.
 */
export function createProducedClaimRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): ProducedClaimRepository {
  const readForRun = async (client: Queryable, runId: string, operation: string) => {
    const row = await one<{ claims: unknown }>(
      client,
      context,
      operation,
      PRODUCED_CLAIM_SQL.listForRun,
      [runId],
    )
    if (!row) return null
    if (!Array.isArray(row.claims)) {
      throw new MalformedRowError(
        'produced claims',
        'claims is not an array',
        'produced_claims',
      )
    }
    return row.claims as AgentClaim[]
  }

  return {
    record: (runId: string, caseId: string, claims: readonly AgentClaim[]) =>
      unitOfWork(scope, 'producedClaims.record', async (client) => {
        if (claims.length === 0) {
          throw new InvariantViolationError(
            'produced-claims-empty',
            'producedClaims.record',
          )
        }
        const existing = await readForRun(client, runId, 'producedClaims.record')
        if (existing) {
          /*
           * One run produces one set. A second write with different content is
           * a disagreement about what the agent returned, not a retry.
           *
           * Compared by the shared rule rather than by string: `jsonb` re-orders
           * object keys on the way in, so comparing the round-tripped row
           * against the caller's own object would call every replayed write a
           * conflict here and none in memory.
           */
          if (producedClaimsSemanticKey(existing) !== producedClaimsSemanticKey(claims)) {
            throw new ConflictingRecordError(
              'Produced claims',
              runId,
              'producedClaims.record',
            )
          }
          return
        }
        await run(client, context, 'producedClaims.record', PRODUCED_CLAIM_SQL.record, [
          runId,
          caseId,
          tenantId,
          JSON.stringify([...claims]),
        ])
      }),

    listForRun: (runId: string) =>
      unitOfWork(scope, 'producedClaims.listForRun', async (client) => {
        const found = await readForRun(client, runId, 'producedClaims.listForRun')
        /* Id order, matching the institutional repository it mirrors. */
        return found
          ? [...found].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          : []
      }),
  }
}

export function createClaimRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): ClaimRepository {
  async function readOne(client: Queryable, claimId: string, operation: string) {
    const row = await one<ClaimRow>(client, context, operation, CLAIM_SQL.get, [claimId])
    if (!row) return null
    return (await hydrateClaims(client, context, operation, [row]))[0]!
  }

  const list = (operation: string, sql: string, parameter: string) =>
    unitOfWork(scope, operation, async (client) => {
      const rows = await run<ClaimRow>(client, context, operation, sql, [parameter])
      return hydrateClaims(client, context, operation, rows)
    })

  return {
    get: (claimId) =>
      unitOfWork(scope, 'claims.get', (client) => readOne(client, claimId, 'claims.get')),

    listForRun: (runId) => list('claims.listForRun', CLAIM_SQL.listForRun, runId),
    listForCase: (caseId) => list('claims.listForCase', CLAIM_SQL.listForCase, caseId),

    save: (claim, caseId, runId) =>
      unitOfWork(scope, 'claims.save', async (client) => {
        const existing = await readOne(client, claim.id, 'claims.save')
        if (existing) {
          /*
           * Write-once, so a re-save is either a replay or a fault. The
           * comparison lives in `writeOnce.ts` so both adapters use exactly
           * the same definition of "the same claim" — the Stage 2 review found
           * them disagreeing here, with the authoritative store the lenient one.
           */
          if (claimSemanticKey(existing) !== claimSemanticKey(claim)) {
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

        const citations = [
          ...claim.evidenceRefs.map((ref) => ({ ref, stance: 'supporting' })),
          ...claim.contradictingEvidenceRefs.map((ref) => ({
            ref,
            stance: 'contradicting',
          })),
        ]
        if (citations.length > 0) {
          await run(client, context, 'claims.save', CLAIM_SQL.saveEvidence, [
            claim.id,
            citations.map((entry) => entry.ref.setId),
            citations.map((entry) => entry.ref.observationId),
            citations.map((entry) => entry.ref.contentHash),
            citations.map((entry) => entry.stance),
          ])
        }
        return (await readOne(client, claim.id, 'claims.save'))!
      }),
  }
}

/* -------------------------------------------------------------------- runs */

const RUN_COLUMNS = `
  id, case_id, tenant_id, assignment_id, department_id, employee_id, revision_id,
  state, obsolete, agent_contract_version, output_schema_version,
  identity_kind, prompt_id,
  prompt_version, prompt_content_hash, model_id, model_provider,
  model_parameters_hash, model_parameters,
  scenario_id, stub_version, identity_unavailable_reason, recording_id,
  evidence_set_id,
  ${ts('started_at')}, ${ts('completed_at')},
  failure_category, failure_retryable, failure_attempt, ${ts('failed_at')},
  rejection_code, rejection_detail, rejected_by_employee_id, ${ts('rejected_at')},
  playbook_id, playbook_version, playbook_entry_key,
  provider_id, provider_version, provider_kind, missing_optional_inputs,
  usage_state, input_tokens, output_tokens, cost_minor_units, currency,
  budget_tokens_kind, budget_tokens,
  budget_cost_kind, budget_cost_minor_units, budget_currency,
  budget_deadline_kind, budget_deadline_ms
`

export const RUN_SQL = catalog({
  get: `SELECT ${RUN_COLUMNS} FROM analysis.runs WHERE id = $1`,

  listForCase: `SELECT ${RUN_COLUMNS} FROM analysis.runs
                WHERE case_id = $1 ORDER BY started_at, id COLLATE "C"`,

  events: `SELECT run_id, ${ts('at')}, state, reason FROM analysis.run_events
           WHERE run_id = ANY($1::text[])
           ORDER BY run_id COLLATE "C", at, state COLLATE "C"`,

  eventsForRun: `SELECT run_id, ${ts('at')}, state, reason FROM analysis.run_events
                 WHERE run_id = $1`,

  save: `INSERT INTO analysis.runs
           (id, case_id, tenant_id, assignment_id, department_id, employee_id,
            revision_id, state, obsolete, agent_contract_version,
            output_schema_version, identity_kind,
            prompt_id, prompt_version, prompt_content_hash,
            model_id, model_provider, model_parameters_hash, model_parameters,
            scenario_id, stub_version, identity_unavailable_reason, recording_id,
            evidence_set_id, started_at, completed_at,
            failure_category, failure_retryable, failure_attempt, failed_at,
            rejection_code, rejection_detail, rejected_by_employee_id, rejected_at,
            playbook_id, playbook_version, playbook_entry_key,
            provider_id, provider_version, provider_kind, missing_optional_inputs,
            provenance_id,
            usage_state, input_tokens, output_tokens, cost_minor_units, currency,
            budget_tokens_kind, budget_tokens,
            budget_cost_kind, budget_cost_minor_units, budget_currency,
            budget_deadline_kind, budget_deadline_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                 $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,
                 $34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,
                 $48,$49,$50,$51,$52,$53,$54)
         ON CONFLICT (id) DO UPDATE SET
           state = EXCLUDED.state,
           obsolete = EXCLUDED.obsolete,
           completed_at = EXCLUDED.completed_at,
           failure_category = EXCLUDED.failure_category,
           failure_retryable = EXCLUDED.failure_retryable,
           failure_attempt = EXCLUDED.failure_attempt,
           failed_at = EXCLUDED.failed_at,
           rejection_code = EXCLUDED.rejection_code,
           rejection_detail = EXCLUDED.rejection_detail,
           rejected_by_employee_id = EXCLUDED.rejected_by_employee_id,
           rejected_at = EXCLUDED.rejected_at,
           usage_state = EXCLUDED.usage_state,
           input_tokens = EXCLUDED.input_tokens,
           output_tokens = EXCLUDED.output_tokens,
           cost_minor_units = EXCLUDED.cost_minor_units,
           currency = EXCLUDED.currency`,
  /*
   * The budget columns are deliberately absent from that list. What a run was
   * authorized to spend is decided before it starts and is never revised by
   * later work — the same treatment identity and provider get. Migration 0028
   * grants no UPDATE on them, so the statement and the grant agree rather than
   * one silently permitting what the other forbids.
   */

  /*
   * Append-only, one statement for the whole batch. `ON CONFLICT DO NOTHING`
   * against `run_events_identity_unique` (0012) rather than a `WHERE NOT
   * EXISTS` probe: an existence test without a unique index behind it is a
   * race two concurrent saves both win.
   */
  appendEvents: `INSERT INTO analysis.run_events (run_id, at, state, reason)
                 SELECT $1, a::timestamptz, s, r
                 FROM unnest($2::text[], $3::text[], $4::text[]) AS batch(a, s, r)
                 ON CONFLICT ON CONSTRAINT run_events_identity_unique DO NOTHING`,
})

export function createRunRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): RunRepository {
  async function hydrate(
    client: Queryable,
    rows: RunRow[],
    operation: string,
  ): Promise<AgentRunRecord[]> {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)

    // Two statements for any number of runs, never one per run.
    const [events, claimRows] = await Promise.all([
      run<RunEventRow>(client, context, operation, RUN_SQL.events, [ids]),
      run<ClaimRow>(client, context, operation, CLAIM_SQL.forRuns, [ids]),
    ])
    const claims = await hydrateClaims(client, context, operation, claimRows)

    const eventsByRun = groupBy(events, (event) => event.run_id)
    const claimsByRun = new Map<string, AgentClaim[]>()
    claimRows.forEach((row, index) => {
      const existing = claimsByRun.get(row.run_id)
      if (existing) existing.push(claims[index]!)
      else claimsByRun.set(row.run_id, [claims[index]!])
    })

    return rows.map((row) =>
      toRun(row, eventsByRun.get(row.id) ?? [], claimsByRun.get(row.id) ?? []),
    )
  }

  async function readOne(client: Queryable, runId: string, operation: string) {
    const row = await one<RunRow>(client, context, operation, RUN_SQL.get, [runId])
    if (!row) return null
    return (await hydrate(client, [row], operation))[0]!
  }

  /**
   * Refuses the same instant and state recorded with a different reason.
   *
   * One query for the run's whole history, compared in memory. Checking each
   * incoming event with its own `SELECT` made a ten-event save fifteen round
   * trips instead of five — the kind of shape that is survivable at this
   * volume and stops being survivable without anyone noticing.
   */
  async function assertNoConflictingEvents(
    client: Queryable,
    runId: string,
    events: readonly RunEvent[],
    operation: string,
  ) {
    const stored = await run<RunEventRow>(
      client,
      context,
      operation,
      RUN_SQL.eventsForRun,
      [runId],
    )
    const byIdentity = new Map(
      stored.map((row) => {
        const event = toRunEvent(row)
        return [runEventIdentity(event), runEventSemanticKey(event)]
      }),
    )

    for (const event of events) {
      const existing = byIdentity.get(runEventIdentity(event))
      if (existing !== undefined && existing !== runEventSemanticKey(event)) {
        throw new ConflictingRecordError('Run event', runEventIdentity(event), operation)
      }
    }
  }

  return {
    get: (runId) =>
      unitOfWork(scope, 'runs.get', (client) => readOne(client, runId, 'runs.get')),

    listForCase: (caseId) =>
      unitOfWork(scope, 'runs.listForCase', async (client) => {
        const rows = await run<RunRow>(
          client,
          context,
          'runs.listForCase',
          RUN_SQL.listForCase,
          [caseId],
        )
        return hydrate(client, rows, 'runs.listForCase')
      }),

    save: (record, provenance) =>
      unitOfWork(scope, 'runs.save', async (client) => {
        /*
         * The run owns its foreign key, as the ledger does. Requiring the
         * caller to have written the provenance row first would make an
         * ordering rule out of something the store can guarantee.
         */
        await ensureProvenance(client, context, provenance, record.startedAt)

        /*
         * A model reference is written only where a model produced the work.
         * The identity union is what makes that decidable here rather than a
         * convention every caller has to remember.
         */
        const identity = record.execution.identity
        const prompt = promptOf(identity)
        const model = modelOf(identity)
        const cost = measuredCost(record.usage)
        const budget = record.budget

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
          record.execution.identity.kind,
          prompt?.id ?? null,
          prompt?.version ?? null,
          prompt?.contentHash ?? null,
          model?.id ?? null,
          model?.provider ?? null,
          model?.parametersHash ?? null,
          model ? JSON.stringify(model.parameters) : null,
          identity.kind === 'scenario' ? identity.scenarioId : null,
          identity.kind === 'scenario' ? identity.stubVersion : null,
          identity.kind === 'unavailable' ? identity.reason : null,
          identity.kind === 'unavailable' ? identity.recordingId : null,
          record.evidenceSetId,
          record.startedAt,
          record.completedAt ?? null,
          record.failure?.category ?? null,
          record.failure?.retryable ?? null,
          record.failure?.attempt ?? null,
          record.failure?.at ?? null,
          record.rejection?.code ?? null,
          record.rejection?.detail ?? null,
          record.rejection?.rejectedByEmployeeId ?? null,
          record.rejection?.rejectedAt ?? null,
          record.execution.playbookId,
          record.execution.playbookVersion,
          record.execution.playbookEntryKey,
          record.execution.providerId,
          record.execution.providerVersion,
          record.execution.providerKind,
          [...record.missingOptionalInputs],
          provenance.provenanceId,
          record.usage.state,
          cost?.inputTokens ?? null,
          cost?.outputTokens ?? null,
          cost?.costMinorUnits ?? null,
          cost?.currency ?? null,
          budget.tokens.kind,
          budget.tokens.kind === 'limit' ? budget.tokens.tokens : null,
          budget.cost.kind,
          budget.cost.kind === 'limit' ? budget.cost.costMinorUnits : null,
          budget.cost.kind === 'limit' ? budget.cost.currency : null,
          budget.deadline.kind,
          budget.deadline.kind === 'limit' ? budget.deadline.deadlineMs : null,
        ])

        if (record.events.length > 0) {
          await assertNoConflictingEvents(client, record.id, record.events, 'runs.save')
          await run(client, context, 'runs.save', RUN_SQL.appendEvents, [
            record.id,
            record.events.map((event) => event.at),
            record.events.map((event) => event.state),
            record.events.map((event) => event.reason ?? null),
          ])
        }
        return (await readOne(client, record.id, 'runs.save'))!
      }),
  }
}
