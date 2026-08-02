/**
 * The migration runner and the schema it produces, against real PostgreSQL.
 *
 * SQLite could not stand in for any of this: the ordering contracts are
 * verified against `pg_indexes`, the checksum test depends on transactional
 * DDL leaving nothing behind, and the schema itself uses deferred constraint
 * triggers, column-level grants and `NULLS NOT DISTINCT`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appliedMigrations,
  checksumOf,
  loadMigrations,
  migrate,
  MigrationChecksumError,
  MigrationFailedError,
} from './migrations'
import { createTestDatabase, type TestDatabase } from './testDatabase'

let db: TestDatabase
beforeEach(async () => {
  db = await createTestDatabase()
})
afterEach(async () => {
  await db.drop()
})

/** A throwaway migration directory, for the runner's own behaviour. */
async function scratchMigrations(
  files: Record<string, string>,
): Promise<{ directory: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'finos-mig-'))
  for (const [filename, sql] of Object.entries(files)) {
    await writeFile(join(directory, filename), sql, 'utf8')
  }
  return {
    directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}

/* ------------------------------------------------------- a clean database */

describe('a clean database reaches the expected schema', () => {
  it('applies every migration in order', async () => {
    const result = await migrate(db.owner)
    const expected = await loadMigrations()

    expect(result.applied.map((m) => m.version)).toEqual(expected.map((m) => m.version))
    // Ordered by the numeric prefix, never by directory listing order.
    expect(result.applied.map((m) => m.version)).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
      '0011',
      '0012',
      '0013',
      '0014',
      '0015',
      '0016',
      '0017',
      '0018',
      '0019',
      '0020',
    ])
  })

  it('creates every table the domain needs a home for', async () => {
    await db.migrate()
    const { rows } = await db.owner.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'analysis' ORDER BY table_name`,
    )
    const tables = rows.map((r) => r.table_name)

    // Every approved institutional concept, named explicitly so a dropped
    // table is a failing test rather than a silently missing capability.
    expect(tables).toEqual([
      'agent_results',
      'aggregation_claim_dispositions',
      'aggregation_inputs',
      'aggregation_optional_inputs',
      'aggregations',
      'assignments',
      'case_decisions',
      'case_participants',
      'cases',
      'challenge_evidence',
      'challenges',
      'cio_return_concerns',
      'cio_returns',
      'cio_submissions',
      'claim_evidence',
      'claims',
      'command_outcomes',
      'commands',
      'decision_dissent',
      'decision_dissent_evidence',
      'decision_reconsideration_triggers',
      'decision_submissions',
      'department_handles',
      'departments',
      'eligibility_policies',
      'employees',
      'evidence_items',
      'evidence_sets',
      'organization_seed_versions',
      'organizations',
      'playbook_entries',
      'playbook_entry_dependencies',
      'playbook_versions',
      'playbooks',
      'requirement_resolutions',
      'responsibilities',
      'reviews',
      'risk_findings',
      'risk_limits',
      'roles',
      'run_events',
      'runs',
      'schema_migrations',
      'storage_provenance',
      'submission_disagreements',
      'submission_evidence',
      'submission_open_challenges',
      'submission_required_work',
      'teams',
      'tenants',
      'thesis_claim_links',
      'thesis_revisions',
      'transition_events',
      'verification_claims_reviewed',
      'verification_findings',
    ])
  })

  it('records what it applied, with checksums', async () => {
    await db.migrate()
    const applied = await appliedMigrations(db.owner)
    const onDisk = await loadMigrations()

    expect(applied).toHaveLength(onDisk.length)
    for (const [index, row] of applied.entries()) {
      expect(row.checksum).toBe(onDisk[index]!.checksum)
      expect(row.appliedAt).toBeInstanceOf(Date)
    }
  })
})

/* ------------------------------------------------------------ idempotency */

describe('migrations are idempotent', () => {
  it('applies nothing on a second run', async () => {
    await db.migrate()
    const second = await migrate(db.owner)

    expect(second.applied).toEqual([])
    expect(second.alreadyApplied).toHaveLength((await loadMigrations()).length)
  })

  it('leaves the organization untouched on re-application', async () => {
    await db.migrate()
    const before = await db.owner.query('SELECT * FROM analysis.departments ORDER BY id')
    const seedBefore = await db.owner.query(
      'SELECT version, checksum, applied_at FROM analysis.organization_seed_versions',
    )

    await migrate(db.owner)

    expect(
      (await db.owner.query('SELECT * FROM analysis.departments ORDER BY id')).rows,
    ).toEqual(before.rows)
    expect(
      (
        await db.owner.query(
          'SELECT version, checksum, applied_at FROM analysis.organization_seed_versions',
        )
      ).rows,
    ).toEqual(seedBefore.rows)
  })

  it('is repeatable when the seed is re-run directly', async () => {
    // Not the same as re-running the runner, which skips applied migrations.
    // This proves the seed SQL itself is insert-only.
    await db.migrate()
    const before = await db.owner.query(
      'SELECT id, name, manager_employee_id, is_governance FROM analysis.departments ORDER BY id',
    )

    const seed = (await loadMigrations()).find((m) => m.name === 'seed_organization')!
    await db.owner.query(seed.sql)
    await db.owner.query(seed.sql)

    expect(
      (
        await db.owner.query(
          'SELECT id, name, manager_employee_id, is_governance FROM analysis.departments ORDER BY id',
        )
      ).rows,
    ).toEqual(before.rows)
    expect(
      (await db.owner.query('SELECT count(*)::int n FROM analysis.employees')).rows[0].n,
    ).toBe(15)
  })
})

/* --------------------------------------------------------------- checksums */

describe('an already-applied migration cannot be edited', () => {
  it('refuses to run when a checksum has changed', async () => {
    const { directory, cleanup } = await scratchMigrations({
      '0001_first.sql': 'CREATE TABLE analysis.a (id text PRIMARY KEY);',
    })
    try {
      await migrate(db.owner, { directory })
      await writeFile(
        join(directory, '0001_first.sql'),
        'CREATE TABLE analysis.a (id text PRIMARY KEY, extra text);',
        'utf8',
      )

      await expect(migrate(db.owner, { directory })).rejects.toBeInstanceOf(
        MigrationChecksumError,
      )
    } finally {
      await cleanup()
    }
  })

  it('names both checksums so the change is identifiable', async () => {
    const original = 'CREATE TABLE analysis.a (id text PRIMARY KEY);'
    const edited = 'CREATE TABLE analysis.a (id text PRIMARY KEY, extra text);'
    const { directory, cleanup } = await scratchMigrations({ '0001_first.sql': original })
    try {
      await migrate(db.owner, { directory })
      await writeFile(join(directory, '0001_first.sql'), edited, 'utf8')

      await expect(migrate(db.owner, { directory })).rejects.toThrow(
        new RegExp(`${checksumOf(original)}[\\s\\S]*${checksumOf(edited)}`),
      )
    } finally {
      await cleanup()
    }
  })

  it('checks every migration before applying any of them', async () => {
    // The failure this avoids: an edited 0001 discovered only after a new 0002
    // has already been applied, leaving the database in a state no migration
    // history describes.
    const { directory, cleanup } = await scratchMigrations({
      '0001_first.sql': 'CREATE TABLE analysis.a (id text PRIMARY KEY);',
    })
    try {
      await migrate(db.owner, { directory })
      await writeFile(
        join(directory, '0001_first.sql'),
        'CREATE TABLE analysis.a (id text PRIMARY KEY, extra text);',
        'utf8',
      )
      await writeFile(
        join(directory, '0002_second.sql'),
        'CREATE TABLE analysis.b (id text PRIMARY KEY);',
        'utf8',
      )

      await expect(migrate(db.owner, { directory })).rejects.toBeInstanceOf(
        MigrationChecksumError,
      )
      const { rows } = await db.owner.query(`SELECT to_regclass('analysis.b') AS b`)
      expect(rows[0].b).toBeNull()
    } finally {
      await cleanup()
    }
  })

  it('ignores line-ending differences', async () => {
    // A checkout with core.autocrlf=true must not report a change that never
    // happened — which, on Windows, would be every migration on every run.
    expect(checksumOf('CREATE TABLE a();\nCREATE TABLE b();\n')).toBe(
      checksumOf('CREATE TABLE a();\r\nCREATE TABLE b();\r\n'),
    )
  })
})

/* ------------------------------------------------------------- failure */

describe('a failed migration leaves nothing behind', () => {
  it('rolls back the failing migration entirely', async () => {
    const { directory, cleanup } = await scratchMigrations({
      '0001_good.sql': 'CREATE TABLE analysis.good (id text PRIMARY KEY);',
      // Two statements: the first would succeed on its own, so a runner
      // without a transaction would leave `half` behind.
      '0002_bad.sql':
        'CREATE TABLE analysis.half (id text PRIMARY KEY);\n' +
        'CREATE TABLE analysis.half (id text PRIMARY KEY);',
    })
    try {
      await expect(migrate(db.owner, { directory })).rejects.toBeInstanceOf(
        MigrationFailedError,
      )

      const { rows } = await db.owner.query(
        `SELECT to_regclass('analysis.good') AS good, to_regclass('analysis.half') AS half`,
      )
      // Applied before the failure, and deliberately NOT undone.
      expect(rows[0].good).not.toBeNull()
      // Partially applied, and rolled back.
      expect(rows[0].half).toBeNull()

      const applied = await appliedMigrations(db.owner)
      expect(applied.map((m) => m.version)).toEqual(['0001'])
    } finally {
      await cleanup()
    }
  })

  it('resumes at the failed migration once it is fixed', async () => {
    // The forward-fix strategy, demonstrated: no rollback, no manual repair.
    const { directory, cleanup } = await scratchMigrations({
      '0001_good.sql': 'CREATE TABLE analysis.good (id text PRIMARY KEY);',
      '0002_bad.sql': 'CREATE TABLE analysis.oops (id text PRIMARY KEY, );',
    })
    try {
      await expect(migrate(db.owner, { directory })).rejects.toThrow()
      await writeFile(
        join(directory, '0002_bad.sql'),
        'CREATE TABLE analysis.oops (id text PRIMARY KEY);',
        'utf8',
      )

      const result = await migrate(db.owner, { directory })
      expect(result.applied.map((m) => m.version)).toEqual(['0002'])
    } finally {
      await cleanup()
    }
  })

  it('says which migration failed and that earlier ones stand', async () => {
    const { directory, cleanup } = await scratchMigrations({
      '0001_bad.sql': 'SELECT nonexistent_function();',
    })
    try {
      await expect(migrate(db.owner, { directory })).rejects.toThrow(
        /0001 \(0001_bad\.sql\) failed and was rolled back/,
      )
    } finally {
      await cleanup()
    }
  })
})

/* ------------------------------------------------------- file discipline */

describe('migration files', () => {
  it('rejects a file that is not numbered', async () => {
    const { directory, cleanup } = await scratchMigrations({
      'add_something.sql': 'SELECT 1;',
    })
    try {
      await expect(loadMigrations(directory)).rejects.toThrow(
        /Expected NNNN_lower_snake_case\.sql/,
      )
    } finally {
      await cleanup()
    }
  })

  it('rejects two migrations sharing a version', async () => {
    // Two developers numbering at once is the ordinary way this happens, and
    // the resulting database differs depending on which one ran first.
    const { directory, cleanup } = await scratchMigrations({
      '0001_one.sql': 'SELECT 1;',
      '0001_two.sql': 'SELECT 1;',
    })
    try {
      await expect(loadMigrations(directory)).rejects.toThrow(/share version 0001/)
    } finally {
      await cleanup()
    }
  })

  it('treats every real migration as transactional', async () => {
    // Nothing here needs CREATE INDEX CONCURRENTLY yet. If one does, the
    // directive is required, and this test is where that becomes visible.
    const migrations = await loadMigrations()
    expect(migrations.filter((m) => !m.transactional)).toEqual([])
  })
})

/* -------------------------------------------------- ordering contracts */

describe('indexes support the deterministic ordering contracts', () => {
  /**
   * Each port list method states its ordering; both adapters must produce it.
   * An index whose column order does not match the ORDER BY does not make the
   * order wrong — it makes it a sort of the whole table, which is the kind of
   * thing that is fine at 400 rows and not at 400,000.
   */
  const contracts: Array<{ port: string; index: string; ordering: RegExp }> = [
    {
      port: 'cases.list — opened_at DESC, id',
      index: 'cases_opened_at_idx',
      ordering: /\(opened_at DESC, id\)/,
    },
    {
      port: 'theses.listForCase — thesis_id, revision_number',
      index: 'thesis_revisions_case_idx',
      ordering: /\(case_id, thesis_id, revision_number\)/,
    },
    {
      port: 'assignments.listForCase — priority DESC, created_at, id',
      index: 'assignments_case_queue_idx',
      ordering: /\(case_id, priority DESC, created_at, id\)/,
    },
    {
      port: 'assignments.listForDepartment — priority DESC, created_at, id',
      index: 'assignments_department_queue_idx',
      ordering: /\(department_id, priority DESC, created_at, id\)/,
    },
    {
      port: 'runs.listForCase — started_at, id',
      index: 'runs_case_idx',
      ordering: /\(case_id, started_at, id\)/,
    },
    {
      port: 'claims.listForRun — id',
      index: 'claims_run_idx',
      ordering: /\(run_id, id\)/,
    },
    {
      port: 'claims.listForCase — id',
      index: 'claims_case_idx',
      ordering: /\(case_id, id\)/,
    },
    {
      port: 'reviews.*ForCase — at, by_employee_id, revision_id',
      index: 'reviews_case_idx',
      ordering: /\(case_id, kind, at, by_employee_id, revision_id\)/,
    },
    {
      port: 'events.listForCase — occurred_at, event_id',
      index: 'transition_events_case_idx',
      ordering: /\(case_id, occurred_at, event_id\)/,
    },
    {
      port: 'events.recent — occurred_at DESC, event_id DESC',
      index: 'transition_events_recent_idx',
      ordering: /\(occurred_at DESC, event_id DESC\)/,
    },
    {
      port: 'decisions.list — decided_at DESC, case_id',
      index: 'case_decisions_decided_at_idx',
      ordering: /\(decided_at DESC, case_id\)/,
    },
  ]

  it.each(contracts)('$port', async ({ index, ordering }) => {
    await db.migrate()
    const { rows } = await db.owner.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'analysis' AND indexname = $1`,
      [index],
    )
    expect(rows, `index ${index} does not exist`).toHaveLength(1)
    expect(rows[0]!.indexdef).toMatch(ordering)
  })
})
