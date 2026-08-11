/**
 * The two roads to migration 0020 arrive at the same place.
 *
 * Every other schema test runs against a database migrated from empty, which is
 * the path production never takes. A migration that reaches the right shape
 * from nothing and a slightly different one from the schema before it is the
 * failure nobody sees until a deployment — a default, a deferrability or a
 * grant that the clean path has and the upgrade does not.
 *
 * So: two isolated databases, one migrated 0001→0020 and one migrated 0001→0019
 * and then upgraded, compared on everything the database will act on. Then the
 * same behaviour checks against both, because two schemas can be structurally
 * identical and still be asserted differently if a trigger function drifted —
 * which is exactly what 0020 does to `refuse_decision_rewrite`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Client } from 'pg'
import {
  APP_ROLE,
  createTestDatabase,
  isPermissionDenied,
  type TestDatabase,
} from './testDatabase'
import { migrate } from './migrations'
import { fingerprint, type SchemaFingerprint } from './schemaFingerprint'

const MIGRATIONS = join(process.cwd(), 'db', 'migrations')

/**
 * A directory holding only the migrations up to and including `upTo`.
 *
 * The runner applies every file it finds, so "stop at 0019" is expressed by
 * giving it a directory that ends there rather than by adding an option the
 * production path would also carry.
 */
function migrationsThrough(upTo: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'finos-migrations-'))
  for (const entry of readdirSync(MIGRATIONS)) {
    if (!entry.endsWith('.sql')) continue
    if (entry.slice(0, 4) > upTo) continue
    cpSync(join(MIGRATIONS, entry), join(directory, entry))
  }
  return directory
}

let clean: TestDatabase
let upgraded: TestDatabase
let cleanApp: Client
let upgradedApp: Client
let through0019: string

let cleanPrint: SchemaFingerprint
let upgradedPrint: SchemaFingerprint

beforeAll(async () => {
  through0019 = migrationsThrough('0019')

  clean = await createTestDatabase()
  await clean.migrate()

  upgraded = await createTestDatabase()
  await migrate(upgraded.owner, { directory: through0019 })

  // The pre-0020 shape, so "the upgrade path ran" is a fact rather than an
  // assumption about which files the temp directory happened to contain.
  const before = await upgraded.owner.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'analysis' AND table_name IN
       ('decision_revisions', 'cio_submissions')`,
  )
  expect(before.rows.map((row) => row.table_name)).toEqual(['decision_revisions'])

  await migrate(upgraded.owner)

  cleanApp = await clean.connectAs(APP_ROLE)
  upgradedApp = await upgraded.connectAs(APP_ROLE)

  cleanPrint = await fingerprint(clean.owner)
  upgradedPrint = await fingerprint(upgraded.owner)
}, 600_000)

afterAll(async () => {
  await Promise.all([cleanApp?.end().catch(() => {}), upgradedApp?.end().catch(() => {})])
  await clean?.drop()
  await upgraded?.drop()
  if (through0019) rmSync(through0019, { recursive: true, force: true })
})

/* ------------------------------------------------------- the fingerprint */

describe('the clean and upgraded schemas are the same schema', () => {
  const dimensions: Array<keyof SchemaFingerprint> = [
    'tables',
    'columns',
    'constraints',
    'indexes',
    'triggers',
    'functions',
    'tableGrants',
    'columnGrants',
    'policies',
    'seededPolicies',
    'migrationHistory',
  ]

  for (const dimension of dimensions) {
    it(`agrees on ${dimension}`, () => {
      expect(upgradedPrint[dimension]).toEqual(cleanPrint[dimension])
    })
  }

  it('compares something rather than two empty sets', () => {
    /*
     * A fingerprint that queried nothing would agree with itself perfectly.
     * `policies` is exempt and stays in the comparison: this schema uses no
     * row-level security, so empty is the correct answer — and the dimension
     * is still compared, so one appearing on only one path would fail above.
     */
    for (const dimension of dimensions.filter((d) => d !== 'policies')) {
      expect(
        (cleanPrint[dimension] as unknown[]).length,
        `${dimension} is empty, so its comparison proves nothing`,
      ).toBeGreaterThan(0)
    }
  })

  it('carries the deferrability the supersession design depends on', () => {
    // Named explicitly: a fingerprint can only prove equality, and this is the
    // property that has to be TRUE in both, not merely equal.
    const deferred = (cleanPrint.constraints as Array<Record<string, unknown>>).filter(
      (row) =>
        String(row.table_name) === 'case_decisions' &&
        row.condeferred === true &&
        String(row.conname).includes('supersed'),
    )
    expect(deferred.map((row) => row.conname).sort()).toEqual([
      'case_decisions_superseded_by_fk',
      'case_decisions_supersedes_fk',
    ])
  })

  it('carries the narrowed decision-rewrite guard in both', () => {
    /*
     * 0020 REPLACES the function 0008 defined. An upgrade that kept the old
     * body would have the same trigger name enforcing the older, blanket rule —
     * structurally identical and behaviourally different.
     */
    const definitionOf = (print: SchemaFingerprint) =>
      (print.functions as Array<Record<string, string>>).find(
        (row) => row.proname === 'refuse_decision_rewrite',
      )?.definition ?? ''
    expect(definitionOf(cleanPrint)).toContain('superseded_by_decision_id IS NULL')
    expect(definitionOf(upgradedPrint)).toBe(definitionOf(cleanPrint))
  })
})

describe('what 0020 removed is absent on both paths', () => {
  const gone: Array<[table: string, column: string | null]> = [
    ['decision_revisions', null],
    ['case_decisions', 'governance'],
    ['case_decisions', 'unresolved_dissent'],
    ['case_decisions', 'reconsideration_triggers'],
    // Duplicated eligibility basis: it lives on the submission.
    ['case_decisions', 'eligibility_policy_version'],
    ['case_decisions', 'verification_review_id'],
    ['case_decisions', 'risk_requirement'],
    ['case_decisions', 'evaluated_at'],
  ]

  for (const [table, column] of gone) {
    it(`has no ${column ? `${table}.${column}` : table}`, async () => {
      for (const db of [clean, upgraded]) {
        const found = await db.owner.query(
          column === null
            ? `SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'analysis' AND table_name = $1`
            : `SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'analysis' AND table_name = $1
                 AND column_name = $2`,
          column === null ? [table] : [table, column],
        )
        expect(found.rows).toEqual([])
      }
    })
  }

  it('has no compliance verdict column on any decision table, either way', async () => {
    for (const db of [clean, upgraded]) {
      const found = await db.owner.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'analysis'
           AND table_name IN ('case_decisions', 'decision_submissions',
                              'decision_dissent', 'cio_submissions')
           AND column_name LIKE '%compliance%'`,
      )
      expect(found.rows).toEqual([])
    }
  })
})

/* --------------------------------------------------- the legacy-row guard */

describe('0020 refuses to guess about legacy decisions', () => {
  let legacy: TestDatabase

  beforeAll(async () => {
    legacy = await createTestDatabase()
    await migrate(legacy.owner, { directory: through0019 })

    // A decision in the pre-0020 shape: no outcome kind, no submissions. There
    // is no honest mapping — inventing one would fabricate what the CIO did.
    await legacy.owner.query(
      `INSERT INTO analysis.cases
         (id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
          subject_display_name, question, stage, opened_at)
       VALUES ('legacy-case', 'system', 1, 'research-director', 'macro', 'r',
               'R', 'q', 'decision', now())`,
    )
    await legacy.owner.query(
      `INSERT INTO analysis.evidence_sets (id, assembled_at, correlation_id, co_temporality)
       VALUES ('legacy-set', now(), 'corr', '{"kind":"empty"}'::jsonb)`,
    )
    await legacy.owner.query(
      `INSERT INTO analysis.case_decisions
         (case_id, tenant_id, aggregate_version, decided_at, decided_by_employee_id,
          evidence_set_id, rationale, governance)
       VALUES ('legacy-case', 'system', 1, now(), 'cio', 'legacy-set',
               'decided under the old model', '{}'::jsonb)`,
    )
  }, 300_000)

  afterAll(async () => {
    await legacy?.drop()
  })

  it('fails clearly, before restructuring anything', async () => {
    await expect(migrate(legacy.owner)).rejects.toThrow(
      /existing row\(s\); migrate them to the explicit outcome model first/,
    )
  })

  it('leaves the pre-0020 schema and its data intact', async () => {
    // The guard runs before the destructive steps, and the migration is
    // transactional, so a refusal is a refusal rather than a half-restructure.
    const decisions = await legacy.owner.query(
      `SELECT case_id, rationale FROM analysis.case_decisions`,
    )
    expect(decisions.rows).toEqual([
      { case_id: 'legacy-case', rationale: 'decided under the old model' },
    ])

    const survived = await legacy.owner.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'analysis' AND table_name = 'case_decisions'
         AND column_name IN ('governance', 'decision_id')`,
    )
    expect(survived.rows.map((row) => row.column_name)).toEqual(['governance'])

    const oldTable = await legacy.owner.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'analysis' AND table_name = 'decision_revisions'`,
    )
    expect(oldTable.rows).toHaveLength(1)
  })

  it('records no partial 0020 in the migration history', async () => {
    const history = await legacy.owner.query(
      `SELECT version FROM analysis.schema_migrations ORDER BY version DESC LIMIT 1`,
    )
    expect(history.rows[0].version).toBe('0019')

    const created = await legacy.owner.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'analysis' AND table_name = 'cio_submissions'`,
    )
    expect(created.rows).toEqual([])
  })
})

/* ------------------------------------------------------- permissions */

describe('the runtime holds the same rights on both paths', () => {
  const grantsOf = async (db: TestDatabase) => {
    const table = await db.owner.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema = 'analysis' AND grantee = $1
       ORDER BY table_name, privilege_type`,
      [APP_ROLE],
    )
    const column = await db.owner.query(
      `SELECT table_name, column_name, privilege_type
       FROM information_schema.column_privileges
       WHERE table_schema = 'analysis' AND grantee = $1
         AND privilege_type = 'UPDATE'
       ORDER BY table_name, column_name`,
      [APP_ROLE],
    )
    return { table: table.rows, column: column.rows }
  }

  it('grants the same tables and privileges', async () => {
    expect(await grantsOf(upgraded)).toEqual(await grantsOf(clean))
  })

  it('grants no DELETE anywhere, on either path', async () => {
    for (const db of [clean, upgraded]) {
      const deletes = await db.owner.query(
        `SELECT table_name FROM information_schema.role_table_grants
         WHERE table_schema = 'analysis' AND grantee = $1
           AND privilege_type = 'DELETE'`,
        [APP_ROLE],
      )
      expect(deletes.rows).toEqual([])
    }
  })

  it('grants UPDATE on case_decisions only for the supersession column', async () => {
    for (const db of [clean, upgraded]) {
      const { column } = await grantsOf(db)
      const decision = column
        .filter((row) => row.table_name === 'case_decisions')
        .map((row) => row.column_name)
      expect(decision).toEqual(['superseded_by_decision_id'])
    }
  })

  it('lets the runtime read but never write the policy registry', async () => {
    for (const app of [cleanApp, upgradedApp]) {
      await expect(
        app.query(`SELECT version FROM analysis.eligibility_policies`),
      ).resolves.toBeDefined()

      const refusal = await app
        .query(
          `INSERT INTO analysis.eligibility_policies VALUES
             ('99', 'invented', 'outside-policy-scope', 'outside-policy-scope',
              'outside-policy-scope', 'outside-policy-scope', 'material',
              'decision-critical', false, '8')`,
        )
        .then(
          () => null,
          (error: unknown) => error,
        )
      expect(isPermissionDenied(refusal)).toBe(true)
    }
  })

  it('lets the runtime neither disable a trigger nor touch the migration history', async () => {
    for (const app of [cleanApp, upgradedApp]) {
      for (const statement of [
        `ALTER TABLE analysis.case_decisions DISABLE TRIGGER case_decisions_outcome_guard`,
        `ALTER TABLE analysis.case_decisions ADD COLUMN sneaked text`,
        `DELETE FROM analysis.schema_migrations`,
        `UPDATE analysis.schema_migrations SET checksum = 'x'`,
      ]) {
        const refusal = await app.query(statement).then(
          () => null,
          (error: unknown) => error,
        )
        expect(refusal, `"${statement.slice(0, 50)}" was permitted`).not.toBeNull()
        expect(isPermissionDenied(refusal)).toBe(true)
      }
    }
  })
})

/* --------------------------------------------------- behavioural parity */

/**
 * The same institutional rules, asserted against whichever schema is given.
 *
 * The fingerprint proves the structures match; this proves they mean the same
 * thing. A trigger function that drifted would pass the first and fail here.
 */
function behaviouralChecks(name: string, get: () => { db: TestDatabase; app: Client }) {
  describe(`${name} enforces the decision rules`, () => {
    let sql: Client
    let counter = 0
    const id = (prefix: string) => `${prefix}-${name}-${++counter}`

    beforeAll(async () => {
      sql = get().db.owner
      await sql.query(
        `INSERT INTO analysis.storage_provenance
           (id, adapter_id, adapter_version, build_id, query_catalog_hash,
            schema_version, domain_contract_version, command_contract_version,
            first_seen_at)
         VALUES ('parity-prov', 'postgres', 'v', 't', 'c', '0020', '8', '2', now())
         ON CONFLICT (id) DO NOTHING`,
      )
      await sql.query(
        `INSERT INTO analysis.evidence_sets (id, assembled_at, correlation_id, co_temporality)
         VALUES ('parity-set', now(), 'corr', '{"kind":"empty"}'::jsonb)
         ON CONFLICT (id) DO NOTHING`,
      )
    })

    interface Seeded {
      caseId: string
      revisionA: string
      revisionB: string
      submissionA: string
      submissionB: string
    }

    async function seed(): Promise<Seeded> {
      const caseId = id('case')
      await sql.query(
        `INSERT INTO analysis.cases
           (id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
            subject_display_name, question, stage, opened_at)
         VALUES ($1, 'system', 1, 'research-director', 'macro', 'r', 'R', 'q',
                 'decision', now())`,
        [caseId],
      )
      const made: string[] = []
      for (let index = 0; index < 2; index += 1) {
        const revisionId = id('rev')
        await sql.query(
          `INSERT INTO analysis.thesis_revisions
             (revision_id, thesis_id, revision_number, case_id, statement, position,
              lifecycle, invalidation_criteria, implications,
              proposed_by_department_id, proposed_by_employee_id, proposed_at,
              revision_cause)
           VALUES ($1, $2, 1, $3, 's', 'hold', 'verified', 'i', '{}',
                   'research-office', 'research-director', now(), 'initial-proposal')`,
          [revisionId, id('thesis'), caseId],
        )
        made.push(revisionId)
      }
      const submissions: string[] = []
      for (const revisionId of made) {
        const submissionId = id('sub')
        await sql.query(
          `INSERT INTO analysis.cio_submissions
             (id, case_id, tenant_id, thesis_id, revision_id,
              submitted_by_department_id, submitted_by_employee_id, submitted_at,
              case_version, state, eligibility_policy_version, risk_requirement,
              storage_provenance_id, evaluated_at,
              manifest_algorithm, manifest_canon_version, manifest_digest)
           VALUES ($1, $2, 'system', $3, $4, 'research-office',
                   'research-director', now(), 1, 'pending', '1', 'not-required',
                   'parity-prov', now(), 'sha256', '2', '0000000000000000000000000000000000000000000000000000000000000000')`,
          [submissionId, caseId, id('thesis'), revisionId],
        )
        submissions.push(submissionId)
      }
      return {
        caseId,
        revisionA: made[0]!,
        revisionB: made[1]!,
        submissionA: submissions[0]!,
        submissionB: submissions[1]!,
      }
    }

    const ACTOR = `'role-cio', 'executive', 'executive', false, '{}', '1',
                   'system-asserted', 'chief-decision'`

    async function decide(
      s: Seeded,
      outcome: string,
      relations: ReadonlyArray<[string, string, string]>,
      options: { selected?: string; supersedes?: string; triggers?: number } = {},
    ): Promise<string> {
      const decisionId = id('dec')
      await sql.query('BEGIN')
      try {
        if (options.supersedes) {
          await sql.query(
            `UPDATE analysis.case_decisions SET superseded_by_decision_id = $2
             WHERE decision_id = $1`,
            [options.supersedes, decisionId],
          )
        }
        await sql.query(
          `INSERT INTO analysis.case_decisions
             (decision_id, case_id, tenant_id, aggregate_version, decided_at,
              decided_by_employee_id, outcome_kind, selected_revision_id,
              supersedes_decision_id, evidence_set_id, rationale,
              decided_by_role_id, decided_by_role_function, decided_by_department_id,
              decided_by_department_is_governance, decided_by_department_handles,
              organization_seed_version, authentication, authorization_basis)
           VALUES ($1, $2, 'system', 1, now(), 'cio', $3, $4, $5, 'parity-set',
                   'because', ${ACTOR})`,
          [
            decisionId,
            s.caseId,
            outcome,
            options.selected ?? null,
            options.supersedes ?? null,
          ],
        )
        for (const [revisionId, submissionId, relation] of relations) {
          await sql.query(
            `INSERT INTO analysis.decision_submissions
               (decision_id, submission_id, case_id, revision_id, relation)
             VALUES ($1, $2, $3, $4, $5)`,
            [decisionId, submissionId, s.caseId, revisionId, relation],
          )
        }
        for (let index = 0; index < (options.triggers ?? 0); index += 1) {
          await sql.query(
            `INSERT INTO analysis.decision_reconsideration_triggers
               (id, decision_id, ordinal, condition_type, subject_kind, subject_ref,
                comparator, qualitative_condition, rationale,
                created_by_employee_id, created_at, policy_version)
             VALUES ($1, $2, $3, 'policy-change', 'policy-rate', 'ecb', 'changes',
                     'the ECB abandons guidance', 'it breaks the path', 'cio',
                     now(), '1')`,
            [id('trg'), decisionId, index],
          )
        }
        await sql.query('COMMIT')
      } catch (error) {
        await sql.query('ROLLBACK').catch(() => {})
        throw error
      }
      return decisionId
    }

    const bothDeclined = (s: Seeded): ReadonlyArray<[string, string, string]> => [
      [s.revisionA, s.submissionA, 'declined'],
      [s.revisionB, s.submissionB, 'declined'],
    ]

    it('commits a valid selected decision', async () => {
      const s = await seed()
      const decisionId = await decide(
        s,
        'selected',
        [
          [s.revisionA, s.submissionA, 'selected'],
          [s.revisionB, s.submissionB, 'not-selected'],
        ],
        { selected: s.revisionA },
      )
      expect(decisionId).toContain('dec')
    })

    it('fails an invalid selected outcome at COMMIT', async () => {
      const s = await seed()
      await expect(
        decide(s, 'selected', [[s.revisionA, s.submissionA, 'not-selected']], {
          selected: s.revisionA,
        }),
      ).rejects.toThrow(/decision_outcome/)
    })

    it('fails a deferral with no reconsideration condition', async () => {
      const s = await seed()
      await expect(
        decide(s, 'deferred', [[s.revisionA, s.submissionA, 'considered']]),
      ).rejects.toThrow(/no condition/)
    })

    it('fails a decline that leaves a revision unaccounted for', async () => {
      const s = await seed()
      await expect(
        decide(s, 'declined', [
          [s.revisionA, s.submissionA, 'declined'],
          [s.revisionB, s.submissionB, 'considered'],
        ]),
      ).rejects.toThrow(/without a disposition/)
    })

    it('fails a submission belonging to another case', async () => {
      const mine = await seed()
      const other = await seed()
      await expect(
        decide(mine, 'declined', [[mine.revisionA, other.submissionA, 'declined']]),
      ).rejects.toThrow(/foreign key/)
    })

    it('holds one live decision per case', async () => {
      const s = await seed()
      await decide(s, 'declined', bothDeclined(s))
      await expect(decide(s, 'declined', bothDeclined(s))).rejects.toThrow(
        /one_live_per_case|duplicate key/,
      )
    })

    it('commits a valid supersession', async () => {
      const s = await seed()
      const first = await decide(s, 'declined', bothDeclined(s))
      const second = await decide(s, 'declined', bothDeclined(s), {
        supersedes: first,
      })
      const live = await sql.query(
        `SELECT decision_id FROM analysis.case_decisions
         WHERE case_id = $1 AND superseded_by_decision_id IS NULL`,
        [s.caseId],
      )
      expect(live.rows.map((row) => row.decision_id)).toEqual([second])
    })

    it('preserves the prior live decision when the supersession rolls back', async () => {
      const s = await seed()
      const first = await decide(s, 'declined', bothDeclined(s))
      await expect(
        decide(s, 'selected', [[s.revisionA, s.submissionA, 'not-selected']], {
          selected: s.revisionA,
          supersedes: first,
        }),
      ).rejects.toThrow()
      const live = await sql.query(
        `SELECT decision_id FROM analysis.case_decisions
         WHERE case_id = $1 AND superseded_by_decision_id IS NULL`,
        [s.caseId],
      )
      expect(live.rows.map((row) => row.decision_id)).toEqual([first])
    })

    it('refuses the runtime any edit to a committed decision', async () => {
      const s = await seed()
      const decisionId = await decide(s, 'declined', bothDeclined(s))
      const refusal = await get()
        .app.query(
          `UPDATE analysis.case_decisions SET rationale = 'edited'
           WHERE decision_id = $1`,
          [decisionId],
        )
        .then(
          () => null,
          (error: unknown) => error,
        )
      expect(isPermissionDenied(refusal)).toBe(true)
    })

    it('fails a quantitative trigger with no unit', async () => {
      const s = await seed()
      const decisionId = await decide(
        s,
        'deferred',
        [[s.revisionA, s.submissionA, 'considered']],
        { triggers: 1 },
      )
      await expect(
        sql.query(
          `INSERT INTO analysis.decision_reconsideration_triggers
             (id, decision_id, ordinal, condition_type, subject_kind, subject_ref,
              comparator, threshold_amount, rationale, created_by_employee_id,
              created_at, policy_version)
           VALUES ($1, $2, 99, 'quantitative-threshold', 'series', 'cpi', 'above',
                   '3', 'because', 'cio', now(), '1')`,
          [id('trg'), decisionId],
        ),
      ).rejects.toThrow(/triggers_quantitative_complete/)
    })
  })
}

behaviouralChecks('the clean schema', () => ({ db: clean, app: cleanApp }))
behaviouralChecks('the upgraded schema', () => ({ db: upgraded, app: upgradedApp }))
