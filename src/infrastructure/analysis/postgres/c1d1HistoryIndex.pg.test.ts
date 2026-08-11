/**
 * Migration 0021, and the property it was added for.
 *
 * The index is justified by one query — `decisions.historyForCase` — so the
 * test asserts what that query does rather than what the index looks like.
 * Full `EXPLAIN` output is not pinned: it moves with the PostgreSQL version and
 * with row estimates, and a test that breaks on a planner improvement teaches
 * people to delete tests. What is stable is the property: at a representative
 * volume the query must not fall back to scanning the whole table.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrate } from './migrations'
import { fingerprint } from './schemaFingerprint'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'

const MIGRATIONS = join(process.cwd(), 'db', 'migrations')

function migrationsThrough(upTo: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'finos-0021-'))
  for (const entry of readdirSync(MIGRATIONS)) {
    if (!entry.endsWith('.sql')) continue
    if (entry.slice(0, 4) > upTo) continue
    cpSync(join(MIGRATIONS, entry), join(directory, entry))
  }
  return directory
}

let clean: TestDatabase
let upgraded: TestDatabase
let through0020: string

beforeAll(async () => {
  through0020 = migrationsThrough('0020')

  clean = await createTestDatabase()
  await clean.migrate()

  upgraded = await createTestDatabase()
  await migrate(upgraded.owner, { directory: through0020 })

  // The pre-0021 shape, so "the upgrade ran" is a fact rather than an
  // assumption about what the temporary directory happened to hold.
  const before = await upgraded.owner.query(
    `SELECT 1 FROM pg_indexes
     WHERE schemaname = 'analysis' AND indexname = 'case_decisions_history_idx'`,
  )
  expect(before.rows).toEqual([])

  await migrate(upgraded.owner)
}, 600_000)

afterAll(async () => {
  await clean?.drop()
  await upgraded?.drop()
  if (through0020) rmSync(through0020, { recursive: true, force: true })
})

describe('0021 reaches the same place from both directions', () => {
  it('creates the index on the clean path and on the upgrade', async () => {
    for (const db of [clean, upgraded]) {
      const found = await db.owner.query(
        `SELECT indexdef FROM pg_indexes
         WHERE schemaname = 'analysis' AND indexname = 'case_decisions_history_idx'`,
      )
      expect(found.rows).toHaveLength(1)
      expect(String(found.rows[0].indexdef)).toContain('case_id')
      expect(String(found.rows[0].indexdef)).toContain('decided_at')
      // Byte order, matching the query's COLLATE "C" and the in-memory
      // reference's comparator.
      expect(String(found.rows[0].indexdef)).toContain('"C"')
    }
  })

  it('produces identical schema fingerprints', async () => {
    const [a, b] = [await fingerprint(clean.owner), await fingerprint(upgraded.owner)]
    // The whole fingerprint, not just the index dimension: an index migration
    // that changed anything else would be the interesting failure.
    expect(b).toEqual(a)
  })

  it('changes no grant', async () => {
    const grantsOf = async (db: TestDatabase) =>
      (
        await db.owner.query(
          `SELECT table_name, privilege_type FROM information_schema.role_table_grants
           WHERE table_schema = 'analysis' AND grantee = $1
           ORDER BY table_name, privilege_type`,
          [APP_ROLE],
        )
      ).rows
    expect(await grantsOf(upgraded)).toEqual(await grantsOf(clean))
  })

  it('records 0021 in the migration history exactly once', async () => {
    for (const db of [clean, upgraded]) {
      const history = await db.owner.query(
        `SELECT version FROM analysis.schema_migrations WHERE version = '0021'`,
      )
      expect(history.rows).toHaveLength(1)
    }
  })

  it('leaves the live-recent index unbuilt (TD-55)', async () => {
    // Speculative indexes are what this project has been removing, not adding.
    for (const db of [clean, upgraded]) {
      const partial = await db.owner.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'analysis' AND tablename = 'case_decisions'
           AND indexdef LIKE '%superseded_by_decision_id IS NULL%'`,
      )
      expect(partial.rows.map((row) => row.indexname)).toEqual([
        'case_decisions_one_live_per_case',
      ])
    }
  })
})

describe('the query the index was added for', () => {
  /**
   * A representative volume, seeded as the owner.
   *
   * Below a few thousand rows PostgreSQL chooses a sequential scan whatever
   * indexes exist, and rightly — so a plan assertion at fixture scale would
   * assert nothing. `ANALYZE` matters as much as the row count: without fresh
   * statistics the planner is guessing.
   *
   * **Measured while writing this**: at 240 decisions the planner still scans;
   * at 4,000 it takes the index. At the stated institutional volume — ~400
   * cases a year, one to three decisions each — that is roughly three to five
   * years of operation. The index is not speculative, because no existing
   * index can serve `WHERE case_id = $1` over superseded rows at all, but it
   * earns its keep in the medium term rather than on day one, and saying so is
   * more useful than implying it helps immediately.
   */
  beforeAll(async () => {
    const sql = clean.owner

    /*
     * Set-based rather than looped, and valid rather than minimal. A decision
     * with no relations trips `decision_outcome_guard` at COMMIT, so the seed
     * has to build the whole chain: a revision, a submission, a decision and
     * the relation between them. `declined` is the cheapest valid outcome --
     * every considered revision declined, and no reconsideration trigger
     * required.
     */
    await sql.query(
      `INSERT INTO analysis.evidence_sets (id, assembled_at, correlation_id, co_temporality)
       VALUES ('plan-set', now(), 'corr', '{"kind":"empty"}'::jsonb)`,
    )
    await sql.query(
      `INSERT INTO analysis.storage_provenance
         (id, adapter_id, adapter_version, build_id, query_catalog_hash,
          schema_version, domain_contract_version, command_contract_version,
          first_seen_at)
       VALUES ('plan-prov', 'postgres', 'v', 'b', 'c', '0021', '8', '2', now())`,
    )

    await sql.query(`
      INSERT INTO analysis.cases
        (id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
         subject_display_name, question, stage, opened_at)
      SELECT 'plan-case-' || n, 'system', 1, 'research-director', 'macro', 'r',
             'R', 'q', 'decision', now()
      FROM generate_series(0, 999) AS n`)

    await sql.query(`
      INSERT INTO analysis.thesis_revisions
        (revision_id, thesis_id, revision_number, case_id, statement, position,
         lifecycle, invalidation_criteria, implications,
         proposed_by_department_id, proposed_by_employee_id, proposed_at,
         revision_cause)
      SELECT 'plan-rev-' || n, 'plan-thesis-' || n, 1, 'plan-case-' || n,
             's', 'hold', 'proposed', 'i', '{}', 'global-macro',
             'research-director', now(), 'initial-proposal'
      FROM generate_series(0, 999) AS n`)

    await sql.query(`
      INSERT INTO analysis.cio_submissions
        (id, case_id, tenant_id, thesis_id, revision_id,
         submitted_by_department_id, submitted_by_employee_id, submitted_at,
         case_version, state, eligibility_policy_version, risk_requirement,
         storage_provenance_id, evaluated_at,
         manifest_algorithm, manifest_canon_version, manifest_digest)
      SELECT 'plan-sub-' || n, 'plan-case-' || n, 'system', 'plan-thesis-' || n,
             'plan-rev-' || n, 'global-macro', 'research-director', now(), 1,
             'decided', '1', 'not-required', 'plan-prov', now(),
             -- A synthetic witness. Nothing here hydrates through the mapper,
             -- so it is never verified; it exists so the seed satisfies the
             -- real CHECKs rather than a relaxed schema.
             'sha256', '2', '0000000000000000000000000000000000000000000000000000000000000000'
      FROM generate_series(0, 999) AS n`)

    /*
     * Four decisions per case, the newest live and the rest superseded --
     * which is the point. History must return rows the live index cannot see.
     *
     * One transaction for the decisions AND their relations: the outcome guard
     * is DEFERRABLE INITIALLY DEFERRED, so it fires at COMMIT. Two separate
     * statements are two separate transactions, and the first would commit a
     * decision that considers nothing.
     */
    await sql.query('BEGIN')
    await sql.query(`
      INSERT INTO analysis.case_decisions
        (decision_id, case_id, tenant_id, aggregate_version, decided_at,
         decided_by_employee_id, outcome_kind, evidence_set_id, rationale,
         superseded_by_decision_id, organization_seed_version, authentication,
         authorization_basis)
      SELECT 'plan-dec-' || c || '-' || d, 'plan-case-' || c, 'system', 1,
             now() - (d || ' days')::interval, 'cio', 'declined', 'plan-set',
             'seeded for the plan test',
             CASE WHEN d = 0 THEN NULL
                  ELSE 'plan-dec-' || c || '-' || (d - 1) END,
             '1', 'system-asserted', 'mandate:chief-decision'
      FROM generate_series(0, 999) AS c, generate_series(0, 3) AS d`)

    await sql.query(`
      INSERT INTO analysis.decision_submissions
        (decision_id, submission_id, case_id, revision_id, relation)
      SELECT 'plan-dec-' || c || '-' || d, 'plan-sub-' || c, 'plan-case-' || c,
             'plan-rev-' || c, 'declined'
      FROM generate_series(0, 999) AS c, generate_series(0, 3) AS d`)
    await sql.query('COMMIT')

    await sql.query('ANALYZE analysis.case_decisions')
  }, 300_000)

  const planFor = async (caseId: string) => {
    const explained = await clean.owner.query(
      `EXPLAIN (FORMAT JSON)
       SELECT decision_id FROM analysis.case_decisions
       WHERE case_id = $1 ORDER BY decided_at, decision_id COLLATE "C"`,
      [caseId],
    )
    return JSON.stringify(explained.rows[0]['QUERY PLAN'])
  }

  it('does not scan the whole table', async () => {
    const plan = await planFor('plan-case-7')
    expect(plan).not.toContain('"Node Type":"Seq Scan"')
  })

  it('selects the history index', async () => {
    expect(await planFor('plan-case-7')).toContain('case_decisions_history_idx')
  })

  it('returns the case history in a deterministic order, superseded included', async () => {
    const rows = await clean.owner.query(
      `SELECT decision_id FROM analysis.case_decisions
       WHERE case_id = $1 ORDER BY decided_at, decision_id COLLATE "C"`,
      ['plan-case-7'],
    )
    // Seeded newest-first by `decided_at`, so oldest-first reverses them — and
    // three of the four are superseded, which the live index would have hidden.
    expect(rows.rows.map((row) => row.decision_id)).toEqual([
      'plan-dec-7-3',
      'plan-dec-7-2',
      'plan-dec-7-1',
      'plan-dec-7-0',
    ])
  })
})
