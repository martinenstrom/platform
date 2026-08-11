/**
 * What migration 0018 makes impossible.
 *
 * The aggregation record exists so that "which claims did the manager set
 * aside, and why" has an answer. These are the shapes that would make it
 * answerable only in principle: an exclusion with no reason, a materiality
 * that decides nothing, a downgrade nobody explained, and a revision claiming
 * to be a synthesis with no synthesis behind it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'

let db: TestDatabase
let sql: Client

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  sql = db.owner

  await sql.query(
    `INSERT INTO analysis.playbooks (id, case_kind, name)
     VALUES ('c1c3', 'macro', 'C1C-3 test playbook') ON CONFLICT (id) DO NOTHING`,
  )
  await sql.query(
    `INSERT INTO analysis.playbook_versions (playbook_id, version, content_hash)
     VALUES ('c1c3', '1', 'hash') ON CONFLICT DO NOTHING`,
  )
  await sql.query(
    `INSERT INTO analysis.playbook_entries
       (playbook_id, version, entry_key, department_id, brief, requirement, priority)
     VALUES ('c1c3', '1', 'entry', 'global-macro', 'Regime read', 'required', 5)
     ON CONFLICT DO NOTHING`,
  )
  await sql.query(
    `INSERT INTO analysis.storage_provenance
       (id, adapter_id, adapter_version, build_id, query_catalog_hash,
        schema_version, domain_contract_version, command_contract_version,
        first_seen_at)
     VALUES ('c1c3-prov', 'postgres', 'v', 'test', 'catalog', '0018', '6', '2',
             now())
     ON CONFLICT (id) DO NOTHING`,
  )
}, 180_000)

afterAll(async () => {
  await db?.drop()
})

let unique = 0
const id = (prefix: string) => `${prefix}-${++unique}`

/** A case with two revisions, so an aggregation has something to point at. */
async function seed() {
  const caseId = id('case')
  const thesisId = id('thesis')
  const first = id('rev')
  const second = id('rev')

  await sql.query(
    `INSERT INTO analysis.cases
       (id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
        subject_display_name, question, stage, opened_at)
     VALUES ($1, 'system', 1, 'research-director', 'macro', 'regime',
             'Regime', 'Is it mispriced?', 'research', now())`,
    [caseId],
  )

  const revision = (revisionId: string, number: number, cause: string) =>
    sql.query(
      `INSERT INTO analysis.thesis_revisions
         (revision_id, thesis_id, revision_number, supersedes_revision_id, case_id,
          statement, position, lifecycle, invalidation_criteria,
          implications, proposed_by_department_id, proposed_by_employee_id,
          proposed_at, revision_cause)
       VALUES ($1, $2, $3, $4, $5, 's', 'hold', 'proposed', 'i',
               '{}', 'research-office', 'research-director', now(), $6)`,
      [revisionId, thesisId, number, number === 1 ? null : first, caseId, cause],
    )

  await revision(first, 1, 'initial-proposal')

  /*
   * A run and two claims, because the disposition rows carry real foreign
   * keys: a manager's account of what happened to a claim has to point at a
   * claim that exists.
   */
  const assignmentId = id('assignment')
  const setId = id('set')
  const runId = id('run')

  await sql.query(
    `INSERT INTO analysis.assignments
       (id, case_id, tenant_id, department_id, brief, status, priority, created_at)
     VALUES ($1, $2, 'system', 'global-macro', 'Regime read', 'completed', 5, now())`,
    [assignmentId, caseId],
  )
  await sql.query(
    `INSERT INTO analysis.evidence_sets
       (id, assembled_at, correlation_id, co_temporality)
     VALUES ($1, now(), 'corr', '{"kind":"empty"}'::jsonb)`,
    [setId],
  )
  await sql.query(
    `INSERT INTO analysis.runs
       (id, case_id, tenant_id, assignment_id, department_id, employee_id, state,
        agent_contract_version, output_schema_version, identity_kind,
        scenario_id, stub_version, usage_state, evidence_set_id, started_at,
        completed_at, playbook_id, playbook_version, playbook_entry_key,
        provider_id, provider_version, provider_kind, missing_optional_inputs,
        provenance_id)
     VALUES ($1, $2, 'system', $3, 'global-macro', 'macro-head', 'completed',
             '1', '1', 'scenario', 'success', '1', 'not-applicable', $4, now(),
             now(), 'c1c3', '1', 'entry', 'stub', '1', 'stub', '{}',
             'c1c3-prov')`,
    [runId, caseId, assignmentId, setId],
  )

  const claim = async () => {
    const claimId = id('claim')
    await sql.query(
      `INSERT INTO analysis.claims
         (id, case_id, tenant_id, run_id, type, statement, status,
          confidence_level, confidence_basis, temporal_as_of)
       VALUES ($1, $2, 'system', $3, 'observation', 'x', 'insufficient-evidence',
               'low', '[]'::jsonb, now())`,
      [claimId, caseId, runId],
    )
    return claimId
  }

  return {
    caseId,
    thesisId,
    first,
    second,
    runId,
    claimA: await claim(),
    claimB: await claim(),
  }
}

interface AggregationOverrides {
  producedRevisionId: string
  rationale: string
}

async function insertAggregation(
  seeded: Awaited<ReturnType<typeof seed>>,
  over: Partial<AggregationOverrides> = {},
) {
  const aggregationId = id('agg')
  const producedRevisionId = over.producedRevisionId ?? seeded.second

  /*
   * Both records in one transaction, because they reference each other: the
   * revision names the aggregation that produced it and the aggregation names
   * the revision it produced. The revision's foreign key is deferred to COMMIT
   * for exactly this — the alternative is writing one of them twice.
   */
  await sql.query('BEGIN')
  try {
    if (producedRevisionId === seeded.second) {
      await sql.query(
        `INSERT INTO analysis.thesis_revisions
           (revision_id, thesis_id, revision_number, supersedes_revision_id,
            case_id, statement, position, lifecycle, invalidation_criteria,
            implications, proposed_by_department_id, proposed_by_employee_id,
            proposed_at, revised_at, revision_reason, revision_cause,
            aggregation_id)
         VALUES ($1, $2, 2, $3, $4, 's', 'hold', 'under-analysis', 'i', '{}',
                 'research-office', 'research-director', now(), now(),
                 'The desks reconcile on direction.', 'manager-aggregation', $5)
         ON CONFLICT (revision_id) DO NOTHING`,
        [seeded.second, seeded.thesisId, seeded.first, seeded.caseId, aggregationId],
      )
    }

    await sql.query(
      `INSERT INTO analysis.aggregations
         (id, case_id, tenant_id, thesis_id, source_revision_id,
          produced_revision_id, manager_employee_id, department_id, rationale,
          aggregated_at, provenance_id)
       VALUES ($1, $2, 'system', $3, $4, $5, 'research-director',
               'research-office', $6, now(), 'c1c3-prov')`,
      [
        aggregationId,
        seeded.caseId,
        seeded.thesisId,
        seeded.first,
        producedRevisionId,
        over.rationale ?? 'The desks reconcile on direction.',
      ],
    )
    await sql.query('COMMIT')
  } catch (error) {
    await sql.query('ROLLBACK')
    throw error
  }
  return aggregationId
}

/* -------------------------------------------------------- the aggregation */

describe('a manager aggregation', () => {
  it('records who synthesised, from what, into what', async () => {
    const seeded = await seed()
    const aggregationId = await insertAggregation(seeded)

    const { rows } = await sql.query(
      `SELECT manager_employee_id, source_revision_id, produced_revision_id
       FROM analysis.aggregations WHERE id = $1`,
      [aggregationId],
    )
    expect(rows[0]).toEqual({
      manager_employee_id: 'research-director',
      source_revision_id: seeded.first,
      produced_revision_id: seeded.second,
    })
  })

  it('refuses a synthesis with no rationale', async () => {
    const seeded = await seed()
    await expect(insertAggregation(seeded, { rationale: '   ' })).rejects.toThrow(
      /aggregations_rationale_stated/,
    )
  })

  it('refuses a revision synthesised from itself', async () => {
    const seeded = await seed()
    await expect(
      insertAggregation(seeded, { producedRevisionId: seeded.first }),
    ).rejects.toThrow(/aggregations_source_is_not_result/)
  })

  it('allows one aggregation per produced revision', async () => {
    const seeded = await seed()
    await insertAggregation(seeded)

    // Two accounts of how one position was reached is not a record.
    await expect(insertAggregation(seeded)).rejects.toThrow(
      /aggregations_one_per_revision/,
    )
  })
})

/* ------------------------------------------------------------ dispositions */

describe('claim dispositions', () => {
  const insertDisposition = async (
    aggregationId: string,
    claimId: string,
    runId: string,
    over: Record<string, unknown> = {},
  ) =>
    sql.query(
      `INSERT INTO analysis.aggregation_claim_dispositions
         (aggregation_id, claim_id, run_id, disposition, explanation,
          superseded_by_claim_id, materiality, escalation_required,
          downgraded_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        aggregationId,
        claimId,
        runId,
        (over.disposition as string) ?? 'adopted-supporting',
        (over.explanation as string) ?? null,
        (over.supersededByClaimId as string) ?? null,
        (over.materiality as string) ?? null,
        (over.escalationRequired as boolean) ?? null,
        (over.downgradedFrom as string) ?? null,
      ],
    )

  /*
   * The guard for migration 0023's positional shift.
   *
   * Removing `blocks_eligibility` renumbered every parameter after it, and the
   * columns either side of the gap include several `text` fields. PostgreSQL
   * would accept a value landing in the wrong one of those without complaint,
   * so a one-slot slide is not a type error -- it is silently wrong data.
   *
   * Every field therefore carries a value that could only have come from its
   * own parameter, and each is asserted **column by column** rather than
   * through a hydrated aggregate. A hydrated read would map columns back onto
   * fields and could hide a swap that is symmetrical in both directions.
   */
  it('writes every disposition field into its own column', async () => {
    const seeded = await seed()
    const aggregationId = await insertAggregation(seeded)

    await insertDisposition(aggregationId, seeded.claimA, seeded.runId, {
      // Supersession is the only disposition permitted to name a superseding
      // claim, so it is the one that exercises that column at all.
      disposition: 'superseded-by-stronger-evidence',
      explanation: 'SENTINEL-explanation',
      supersededByClaimId: seeded.claimB,
      materiality: null,
      escalationRequired: null,
      downgradedFrom: null,
    })

    const stored = await sql.query(
      `SELECT claim_id, run_id, disposition, explanation, superseded_by_claim_id,
              materiality, escalation_required, downgraded_from
         FROM analysis.aggregation_claim_dispositions
        WHERE aggregation_id = $1`,
      [aggregationId],
    )

    const row = stored.rows[0]
    expect(row.claim_id).toBe(seeded.claimA)
    expect(row.run_id).toBe(seeded.runId)
    expect(row.disposition).toBe('superseded-by-stronger-evidence')
    expect(row.explanation).toBe('SENTINEL-explanation')
    expect(row.superseded_by_claim_id).toBe(seeded.claimB)
    expect(row.materiality).toBeNull()
    expect(row.escalation_required).toBeNull()
    expect(row.downgraded_from).toBeNull()
  })

  it('writes the materiality group into its own columns', async () => {
    /*
     * The second half, because the first leaves the three trailing fields null
     * and a shift among nulls is invisible. Here each carries a distinct value
     * and a distinct TYPE boundary: text, boolean, text.
     */
    const seeded = await seed()
    const aggregationId = await insertAggregation(seeded)

    await insertDisposition(aggregationId, seeded.claimA, seeded.runId, {
      disposition: 'retained-unresolved',
      explanation: 'SENTINEL-why-unresolved',
      materiality: 'material',
      escalationRequired: true,
      downgradedFrom: 'decision-critical',
    })

    const stored = await sql.query(
      `SELECT explanation, materiality, escalation_required, downgraded_from
         FROM analysis.aggregation_claim_dispositions
        WHERE aggregation_id = $1`,
      [aggregationId],
    )

    const row = stored.rows[0]
    expect(row.explanation).toBe('SENTINEL-why-unresolved')
    expect(row.materiality).toBe('material')
    expect(row.escalation_required).toBe(true)
    expect(row.downgraded_from).toBe('decision-critical')

    // And the dropped column is gone, not merely unwritten.
    const columns = await sql.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'analysis'
          AND table_name = 'aggregation_claim_dispositions'
          AND column_name = 'blocks_eligibility'`,
    )
    expect(columns.rows).toEqual([])
  })

  it('refuses an exclusion with no explanation', async () => {
    const seeded = await seed()
    const aggregationId = await insertAggregation(seeded)

    await expect(
      insertDisposition(aggregationId, seeded.claimA, seeded.runId, {
        disposition: 'excluded-duplicate',
      }),
    ).rejects.toThrow(/aggregation_disposition_explained/)
  })

  it('refuses materiality on anything but unresolved disagreement', async () => {
    const seeded = await seed()
    const aggregationId = await insertAggregation(seeded)

    await expect(
      insertDisposition(aggregationId, seeded.claimA, seeded.runId, {
        disposition: 'adopted-supporting',
        materiality: 'material',
        escalationRequired: true,
        blocksEligibility: false,
      }),
    ).rejects.toThrow(/aggregation_materiality_where_unresolved/)
  })

  it('refuses an unresolved disagreement with no materiality', async () => {
    const seeded = await seed()
    const aggregationId = await insertAggregation(seeded)

    await expect(
      insertDisposition(aggregationId, seeded.claimA, seeded.runId, {
        disposition: 'retained-unresolved',
        explanation: 'The desks disagree on timing.',
      }),
    ).rejects.toThrow(/aggregation_materiality_where_unresolved/)
  })

  it('refuses a downgrade nobody explained', async () => {
    const seeded = await seed()
    const aggregationId = await insertAggregation(seeded)

    await expect(
      insertDisposition(aggregationId, seeded.claimA, seeded.runId, {
        disposition: 'retained-unresolved',
        materiality: 'non-material',
        escalationRequired: false,
        blocksEligibility: false,
        downgradedFrom: 'decision-critical',
      }),
    ).rejects.toThrow(/aggregation_(disposition_explained|downgrade_explained)/)
  })

  it('refuses a disposition outside the vocabulary', async () => {
    const seeded = await seed()
    const aggregationId = await insertAggregation(seeded)

    await expect(
      insertDisposition(aggregationId, seeded.claimA, seeded.runId, {
        disposition: 'ignored',
      }),
    ).rejects.toThrow(/aggregation_disposition_known/)
  })

  it('refuses superseding evidence that is not named', async () => {
    const seeded = await seed()
    const aggregationId = await insertAggregation(seeded)

    await expect(
      insertDisposition(aggregationId, seeded.claimA, seeded.runId, {
        disposition: 'superseded-by-stronger-evidence',
        explanation: 'Better evidence exists.',
      }),
    ).rejects.toThrow(/aggregation_supersession_names_evidence/)
  })
})

/* --------------------------------------------------------- optional inputs */

describe('optional input accounting', () => {
  const insertOptional = (aggregationId: string, over: Record<string, unknown> = {}) =>
    sql.query(
      `INSERT INTO analysis.aggregation_optional_inputs
         (aggregation_id, playbook_entry_key, availability, run_id, scope,
          materially_relevant, explanation)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        aggregationId,
        (over.key as string) ?? id('entry'),
        (over.availability as string) ?? 'unavailable-at-aggregation',
        (over.runId as string) ?? null,
        (over.scope as string) ?? null,
        (over.materiallyRelevant as boolean) ?? false,
        (over.explanation as string) ?? null,
      ],
    )

  it('records an absent perspective without a scope', async () => {
    const seeded = await seed()
    const aggregationId = await insertAggregation(seeded)

    await expect(insertOptional(aggregationId)).resolves.toBeDefined()
  })

  it('refuses an available contribution that says nothing about its scope', async () => {
    const seeded = await seed()
    const aggregationId = await insertAggregation(seeded)

    await expect(
      insertOptional(aggregationId, {
        availability: 'received-and-used',
        runId: seeded.runId,
        scope: 'in-scope',
      }),
    ).resolves.toBeDefined()
  })

  it('refuses excluding a materially relevant contribution', async () => {
    /*
     * Scope selection is not a way to set aside work that bears on the thesis.
     * The command refuses it too; this is the wall behind the wall.
     */
    const seeded = await seed()
    const aggregationId = await insertAggregation(seeded)

    await expect(
      insertOptional(aggregationId, {
        availability: 'received-not-adopted',
        runId: seeded.runId,
        scope: 'excluded-out-of-scope',
        materiallyRelevant: true,
        explanation: 'It did not fit.',
      }),
    ).rejects.toThrow(/aggregation_optional_(scope_where_available|exclusion_justified)/)
  })
})

/* ------------------------------------------------------------- the revision */

describe('a revision and its aggregation', () => {
  it('requires a managerial synthesis to name one', async () => {
    const seeded = await seed()
    await expect(
      sql.query(
        `INSERT INTO analysis.thesis_revisions
           (revision_id, thesis_id, revision_number, supersedes_revision_id,
            case_id, statement, position, lifecycle,
            invalidation_criteria, implications, proposed_by_department_id,
            proposed_by_employee_id, proposed_at, revised_at, revision_reason,
            revision_cause)
         VALUES ($1, $2, 2, $3, $4, 's', 'hold', 'under-analysis', 'i',
                 '{}', 'research-office', 'research-director', now(), now(),
                 'why', 'manager-aggregation')`,
        [id('rev'), seeded.thesisId, seeded.first, seeded.caseId],
      ),
    ).rejects.toThrow(/thesis_revision_aggregation_where_synthesised/)
  })

  it('lets only revision 1 be an initial proposal', async () => {
    const seeded = await seed()
    await expect(
      sql.query(
        `INSERT INTO analysis.thesis_revisions
           (revision_id, thesis_id, revision_number, supersedes_revision_id,
            case_id, statement, position, lifecycle,
            invalidation_criteria, implications, proposed_by_department_id,
            proposed_by_employee_id, proposed_at, revised_at, revision_reason,
            revision_cause)
         VALUES ($1, $2, 2, $3, $4, 's', 'hold', 'proposed', 'i',
                 '{}', 'research-office', 'research-director', now(), now(),
                 'why', 'initial-proposal')`,
        [id('rev'), seeded.thesisId, seeded.first, seeded.caseId],
      ),
    ).rejects.toThrow(/thesis_revision_cause_matches_number/)
  })

  it('refuses a cause outside the vocabulary', async () => {
    const seeded = await seed()
    await expect(
      sql.query(
        `INSERT INTO analysis.thesis_revisions
           (revision_id, thesis_id, revision_number, case_id,
            statement, position, lifecycle, invalidation_criteria, implications,
            proposed_by_department_id, proposed_by_employee_id, proposed_at,
            revision_cause)
         VALUES ($1, $2, 1, $3, 's', 'hold', 'proposed', 'i', '{}',
                 'research-office', 'research-director', now(), 'because')`,
        [id('rev'), id('thesis'), seeded.caseId],
      ),
    ).rejects.toThrow(/thesis_revision_cause_known/)
  })
})

/* ---------------------------------------------------------------- grants */

describe('what the runtime may change on an aggregation', () => {
  it('may write one and never rewrite it', async () => {
    const { rows } = await sql.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type FROM information_schema.table_privileges
       WHERE table_schema = 'analysis' AND grantee = $1
         AND table_name LIKE 'aggregation%'
       ORDER BY table_name, privilege_type`,
      [APP_ROLE],
    )

    const byTable = new Map<string, string[]>()
    for (const row of rows) {
      byTable.set(row.table_name, [
        ...(byTable.get(row.table_name) ?? []),
        row.privilege_type,
      ])
    }

    for (const [, privileges] of byTable) {
      expect(privileges.sort()).toEqual(['INSERT', 'SELECT'])
    }
    expect(byTable.size).toBe(4)
  })
})
