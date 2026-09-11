/**
 * Manager aggregations, in PostgreSQL.
 *
 * Four tables rather than one document. Every field a headquarters or
 * governance query needs — claim ids, run ids, revision ids, disposition,
 * materiality, scope, the eligibility flag — is a column, filterable and
 * joinable. The only prose is the manager's rationale, which nothing filters
 * on.
 *
 * That is a deliberate choice against the easier one. "Which claims did the
 * manager set aside, and why" is the question the CIO asks before selecting a
 * thesis; behind a `jsonb` blob it is a scan and a parse, and the first read
 * model to need it would extract columns anyway.
 *
 * Write-once, like every other record of a judgement: `ON CONFLICT DO NOTHING`
 * then read back, with the semantic comparison the in-memory adapter uses.
 */

import {
  ConflictingRecordError,
  type AggregationRepository,
} from '~/application/analysis/repositories'
import { managerAggregationSemanticKey } from '~/application/analysis/writeOnce'
import { toManagerAggregation } from './mapping'
import { ensureProvenance } from './provenance'
import type {
  AggregationClaimDispositionRow,
  AggregationInputRow,
  AggregationOptionalInputRow,
  AggregationRow,
} from './rows'
import { catalog, one, run, ts, type Queryable, type SqlContext } from './sql'
import { unitOfWork, type Scope } from './transaction'

const AGGREGATION_COLUMNS = `
  id, case_id, thesis_id, source_revision_id, produced_revision_id,
  manager_employee_id, manager_agent_principal_id, synthesis_run_id,
  department_id, rationale, ${ts('aggregated_at')}
`

export const AGGREGATION_SQL = catalog({
  get: `SELECT ${AGGREGATION_COLUMNS} FROM analysis.aggregations WHERE id = $1`,

  forRevision: `SELECT ${AGGREGATION_COLUMNS} FROM analysis.aggregations
                WHERE produced_revision_id = $1`,

  /** `aggregatedAt`, then `id` — the port's stated ordering. */
  listForCase: `SELECT ${AGGREGATION_COLUMNS} FROM analysis.aggregations
                WHERE case_id = $1
                ORDER BY aggregated_at, id COLLATE "C"`,

  inputs: `SELECT aggregation_id, run_id, playbook_entry_key, requirement_level
           FROM analysis.aggregation_inputs
           WHERE aggregation_id = ANY($1::text[])
           ORDER BY aggregation_id COLLATE "C", run_id COLLATE "C"`,

  dispositions: `SELECT aggregation_id, claim_id, run_id, disposition, explanation,
                        superseded_by_claim_id, materiality, escalation_required,
                        downgraded_from
                 FROM analysis.aggregation_claim_dispositions
                 WHERE aggregation_id = ANY($1::text[])
                 ORDER BY aggregation_id COLLATE "C", claim_id COLLATE "C"`,

  optionalInputs: `SELECT aggregation_id, playbook_entry_key, availability, run_id,
                          scope, materially_relevant, explanation
                   FROM analysis.aggregation_optional_inputs
                   WHERE aggregation_id = ANY($1::text[])
                   ORDER BY aggregation_id COLLATE "C",
                            playbook_entry_key COLLATE "C"`,

  save: `INSERT INTO analysis.aggregations
           (id, case_id, tenant_id, thesis_id, source_revision_id,
            produced_revision_id, manager_employee_id,
            manager_agent_principal_id, synthesis_run_id, department_id,
            rationale, aggregated_at, provenance_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO NOTHING`,

  /* One statement per collection, never one per row. */
  saveInputs: `INSERT INTO analysis.aggregation_inputs
                 (aggregation_id, run_id, playbook_entry_key, requirement_level)
               SELECT $1, r, k, l
               FROM unnest($2::text[], $3::text[], $4::text[]) AS t(r, k, l)
               ON CONFLICT DO NOTHING`,

  saveDispositions: `INSERT INTO analysis.aggregation_claim_dispositions
                       (aggregation_id, claim_id, run_id, disposition, explanation,
                        superseded_by_claim_id, materiality, escalation_required,
                        downgraded_from)
                     SELECT $1, c, r, d, e, s, m, er, df
                     FROM unnest($2::text[], $3::text[], $4::text[], $5::text[],
                                 $6::text[], $7::text[], $8::boolean[],
                                 $9::text[])
                       AS t(c, r, d, e, s, m, er, df)
                     ON CONFLICT DO NOTHING`,

  saveOptionalInputs: `INSERT INTO analysis.aggregation_optional_inputs
                         (aggregation_id, playbook_entry_key, availability, run_id,
                          scope, materially_relevant, explanation)
                       SELECT $1, k, a, r, s, mr, e
                       FROM unnest($2::text[], $3::text[], $4::text[], $5::text[],
                                   $6::boolean[], $7::text[])
                         AS t(k, a, r, s, mr, e)
                       ON CONFLICT DO NOTHING`,
})

export function createAggregationRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): AggregationRepository {
  const hydrate = async (
    client: Queryable,
    rows: readonly AggregationRow[],
    operation: string,
  ) => {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)

    const inputs = await run<AggregationInputRow>(
      client,
      context,
      operation,
      AGGREGATION_SQL.inputs,
      [ids],
    )
    const dispositions = await run<AggregationClaimDispositionRow>(
      client,
      context,
      operation,
      AGGREGATION_SQL.dispositions,
      [ids],
    )
    const optionalInputs = await run<AggregationOptionalInputRow>(
      client,
      context,
      operation,
      AGGREGATION_SQL.optionalInputs,
      [ids],
    )

    return rows.map((row) =>
      toManagerAggregation(
        row,
        inputs.filter((input) => input.aggregation_id === row.id),
        dispositions.filter((record) => record.aggregation_id === row.id),
        optionalInputs.filter((record) => record.aggregation_id === row.id),
      ),
    )
  }

  const readOne = async (client: Queryable, id: string, operation: string) => {
    const row = await one<AggregationRow>(
      client,
      context,
      operation,
      AGGREGATION_SQL.get,
      [id],
    )
    if (!row) return null
    return (await hydrate(client, [row], operation))[0] ?? null
  }

  return {
    get: (aggregationId) =>
      unitOfWork(scope, 'aggregations.get', (client) =>
        readOne(client, aggregationId, 'aggregations.get'),
      ),

    forRevision: (revisionId) =>
      unitOfWork(scope, 'aggregations.forRevision', async (client) => {
        const row = await one<AggregationRow>(
          client,
          context,
          'aggregations.forRevision',
          AGGREGATION_SQL.forRevision,
          [revisionId],
        )
        if (!row) return null
        return (await hydrate(client, [row], 'aggregations.forRevision'))[0] ?? null
      }),

    listForCase: (caseId) =>
      unitOfWork(scope, 'aggregations.listForCase', async (client) => {
        const rows = await run<AggregationRow>(
          client,
          context,
          'aggregations.listForCase',
          AGGREGATION_SQL.listForCase,
          [caseId],
        )
        return hydrate(client, rows, 'aggregations.listForCase')
      }),

    save: (aggregation, provenance) =>
      unitOfWork(scope, 'aggregations.save', async (client) => {
        const existing = await readOne(client, aggregation.id, 'aggregations.save')
        if (existing) {
          /*
           * Two accounts of how the firm reached one position, under one id.
           * Returning either silently would settle that by luck.
           */
          if (
            managerAggregationSemanticKey(existing) !==
            managerAggregationSemanticKey(aggregation)
          ) {
            throw new ConflictingRecordError(
              'Manager aggregation',
              aggregation.id,
              'aggregations.save',
            )
          }
          return existing
        }

        await ensureProvenance(client, context, provenance, aggregation.aggregatedAt)

        await run(client, context, 'aggregations.save', AGGREGATION_SQL.save, [
          aggregation.id,
          aggregation.caseId,
          tenantId,
          aggregation.thesisId,
          aggregation.sourceRevisionId,
          aggregation.producedRevisionId,
          /* Exactly one principal; the other column stays null. */
          aggregation.managerEmployeeId ?? null,
          aggregation.managerAgentPrincipalId ?? null,
          aggregation.synthesisRunId ?? null,
          aggregation.departmentId,
          aggregation.rationale,
          aggregation.aggregatedAt,
          provenance.provenanceId,
        ])

        if (aggregation.inputs.length > 0) {
          await run(client, context, 'aggregations.save', AGGREGATION_SQL.saveInputs, [
            aggregation.id,
            aggregation.inputs.map((input) => input.runId),
            aggregation.inputs.map((input) => input.playbookEntryKey),
            aggregation.inputs.map((input) => input.requirementLevel),
          ])
        }

        if (aggregation.dispositions.length > 0) {
          await run(
            client,
            context,
            'aggregations.save',
            AGGREGATION_SQL.saveDispositions,
            [
              aggregation.id,
              aggregation.dispositions.map((record) => record.claimId),
              aggregation.dispositions.map((record) => record.runId),
              aggregation.dispositions.map((record) => record.disposition),
              aggregation.dispositions.map((record) => record.explanation ?? null),
              aggregation.dispositions.map(
                (record) => record.supersededByClaimId ?? null,
              ),
              aggregation.dispositions.map((record) => record.materiality ?? null),
              aggregation.dispositions.map((record) => record.escalationRequired ?? null),
              aggregation.dispositions.map((record) => record.downgradedFrom ?? null),
            ],
          )
        }

        if (aggregation.optionalInputs.length > 0) {
          await run(
            client,
            context,
            'aggregations.save',
            AGGREGATION_SQL.saveOptionalInputs,
            [
              aggregation.id,
              aggregation.optionalInputs.map((record) => record.playbookEntryKey),
              aggregation.optionalInputs.map((record) => record.availability),
              aggregation.optionalInputs.map((record) => record.runId ?? null),
              aggregation.optionalInputs.map((record) => record.scope ?? null),
              aggregation.optionalInputs.map((record) => record.materiallyRelevant),
              aggregation.optionalInputs.map((record) => record.explanation ?? null),
            ],
          )
        }

        return (await readOne(client, aggregation.id, 'aggregations.save'))!
      }),
  }
}
