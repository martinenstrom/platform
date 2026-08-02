/**
 * Revision-scoped reviews, enforced by the database.
 *
 * Two things are being proved. That the constraints in 0011 make the wrong
 * attachment impossible rather than merely discouraged — including the two
 * ownership rules a single composite key covers. And that 0011 reaches the
 * same schema whether it is applied to an existing Stage 1 database or to an
 * empty one, which is the property that stops a long-lived database drifting
 * away from a freshly created one.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Client } from 'pg'
import { reviewIdentity, type VerificationReview } from '~/domain/analysis'
import { DEFAULT_MIGRATIONS_DIR, loadMigrations, migrate } from './migrations'
import {
  APP_ROLE,
  createTestDatabase,
  isPermissionDenied,
  type TestDatabase,
} from './testDatabase'

let db: TestDatabase
let sql: Client

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  sql = db.owner
})
afterAll(async () => {
  await db.drop()
})

/* ------------------------------------------------------------- fixtures */

let unique = 0
const id = (prefix: string) => `${prefix}-${++unique}`

async function insertCase(): Promise<string> {
  const caseId = id('case')
  await sql.query(
    `INSERT INTO analysis.cases
       (id, tenant_id, version, owner_employee_id, subject_kind, subject_ref,
        subject_display_name, question, stage, opened_at)
     VALUES ($1, 'system', 1, 'research-director', 'macro', 'regime',
             'Policy regime', 'Is the policy path mispriced?', 'intake', now())`,
    [caseId],
  )
  return caseId
}

/**
 * A revision in its own lineage.
 *
 * The thesis id is fresh unless given, because `(thesis_id, revision_number)`
 * is unique across the whole table — a readable shared name like `th-buy`
 * collides between tests rather than between cases.
 */
async function insertRevision(
  caseId: string,
  options: { thesisId?: string; number?: number; supersedes?: string | null } = {},
): Promise<{ thesisId: string; revisionId: string }> {
  const thesisId = options.thesisId ?? id('thesis')
  const number = options.number ?? 1
  const revisionId = id('rev')
  await sql.query(
    `INSERT INTO analysis.thesis_revisions
       (revision_id, thesis_id, revision_number, supersedes_revision_id, case_id,
        statement, position, lifecycle, invalidation_criteria, implications,
        proposed_by_department_id, proposed_by_employee_id, proposed_at,
        revision_reason, revision_cause)
     VALUES ($1, $2, $3, $4, $5, 'The policy path is mispriced', 'buy', 'proposed',
             'The curve reprices above 4%', '{}', 'global-macro', 'macro-head',
             now(), $6,
             CASE WHEN $3::int = 1 THEN 'initial-proposal' ELSE 'correction' END)`,
    [
      revisionId,
      thesisId,
      number,
      options.supersedes ?? null,
      caseId,
      number > 1 ? 'new data' : null,
    ],
  )
  return { thesisId, revisionId }
}

interface ReviewRow {
  reviewId?: string
  kind?: string
  scope: 'case' | 'thesis-revision'
  caseId: string
  thesisId?: string | null
  revisionId?: string | null
  by?: { employee: string; department: string }
  at?: string
}

/** Each kind has its own verdict vocabulary; a Devil's Advocate review has none. */
const STATUS_FOR: Record<string, string | null> = {
  verification: 'verified',
  compliance: 'approved',
  risk: 'accepted',
  'devils-advocate': null,
}

function insertReview(row: ReviewRow) {
  const kind = row.kind ?? 'verification'
  return sql.query(
    `INSERT INTO analysis.reviews
       (id, kind, scope, case_id, tenant_id, thesis_id, revision_id,
        by_employee_id, by_department_id, at, status, sequence)
     VALUES ($1, $2, $3, $4, 'system', $5, $6, $7, $8, $9, $10, 1)`,
    [
      row.reviewId ?? id('review'),
      kind,
      row.scope,
      row.caseId,
      row.thesisId ?? null,
      row.revisionId ?? null,
      row.by?.employee ?? 'verification-head',
      row.by?.department ?? 'verification',
      row.at ?? new Date().toISOString(),
      STATUS_FOR[kind] ?? null,
    ],
  )
}

/* ------------------------------------------------------------ the shapes */

describe('a review is exactly one of two shapes', () => {
  it('accepts a case-wide review with no thesis and no revision', async () => {
    const caseId = await insertCase()
    await expect(insertReview({ scope: 'case', caseId })).resolves.toBeDefined()
  })

  it('accepts a thesis-revision review naming both', async () => {
    const caseId = await insertCase()
    const { thesisId, revisionId } = await insertRevision(caseId)
    await expect(
      insertReview({ scope: 'thesis-revision', caseId, thesisId, revisionId }),
    ).resolves.toBeDefined()
  })

  it('refuses a thesis-revision review with no revision', async () => {
    // The exact defect TD-21 described, now unrepresentable.
    const caseId = await insertCase()
    await expect(
      insertReview({
        scope: 'thesis-revision',
        caseId,
        thesisId: 'th-orphan',
        revisionId: null,
      }),
    ).rejects.toThrow(/reviews_revision_scope_is_complete/)
  })

  it('refuses a case-wide review carrying a revision', async () => {
    const caseId = await insertCase()
    const { thesisId, revisionId } = await insertRevision(caseId)
    await expect(
      insertReview({ scope: 'case', caseId, thesisId, revisionId }),
    ).rejects.toThrow(/reviews_case_scope_is_bare/)
  })

  it('refuses a case-wide review carrying only a thesis', async () => {
    // The old model's shape: a lineage attachment with no revision. It is no
    // longer expressible under either scope.
    const caseId = await insertCase()
    await expect(
      insertReview({ scope: 'case', caseId, thesisId: 'th-lineage' }),
    ).rejects.toThrow(/reviews_case_scope_is_bare/)
  })

  it('refuses an unknown scope', async () => {
    const caseId = await insertCase()
    await expect(
      insertReview({ scope: 'lineage' as ReviewRow['scope'], caseId }),
      // PostgreSQL reports whichever CHECK it evaluates first. All of them
      // reject this row; which one speaks is not the property under test.
    ).rejects.toThrow(/violates check constraint/)
  })
})

/* ----------------------------------------------------------- ownership */

describe('ownership is mechanically enforced', () => {
  it('refuses a revision that belongs to another thesis', async () => {
    const caseId = await insertCase()
    const buy = await insertRevision(caseId)
    const sell = await insertRevision(caseId)
    await expect(
      insertReview({
        scope: 'thesis-revision',
        caseId,
        // Both exist. They are not each other's.
        thesisId: sell.thesisId,
        revisionId: buy.revisionId,
      }),
    ).rejects.toThrow(/reviews_revision_ownership_fk/)
  })

  it('refuses a thesis that belongs to another case', async () => {
    // One composite key covers both rules: two separate foreign keys could
    // each be satisfied by rows that disagree with each other.
    const caseA = await insertCase()
    const caseB = await insertCase()
    const { thesisId, revisionId } = await insertRevision(caseA)
    await expect(
      insertReview({ scope: 'thesis-revision', caseId: caseB, thesisId, revisionId }),
    ).rejects.toThrow(/reviews_revision_ownership_fk/)
  })

  it('refuses a revision that does not exist', async () => {
    const caseId = await insertCase()
    await expect(
      insertReview({
        scope: 'thesis-revision',
        caseId,
        thesisId: 'th-missing',
        revisionId: 'no-such-revision',
      }),
    ).rejects.toThrow(/reviews_revision_ownership_fk/)
  })
})

/* --------------------------------------------------------- permanence */

describe('a recorded review cannot be retargeted', () => {
  it('refuses to move it to another revision', async () => {
    const caseId = await insertCase()
    const first = await insertRevision(caseId)
    const second = await insertRevision(caseId, {
      thesisId: first.thesisId,
      number: 2,
      supersedes: first.revisionId,
    })
    const reviewId = id('review')
    await insertReview({
      reviewId,
      scope: 'thesis-revision',
      caseId,
      thesisId: first.thesisId,
      revisionId: first.revisionId,
    })

    await expect(
      sql.query('UPDATE analysis.reviews SET revision_id = $1 WHERE id = $2', [
        second.revisionId,
        reviewId,
      ]),
    ).rejects.toThrow(/cannot be reattached/)
  })

  it('refuses to widen it into a case-wide review', async () => {
    const caseId = await insertCase()
    const { thesisId, revisionId } = await insertRevision(caseId)
    const reviewId = id('review')
    await insertReview({
      reviewId,
      scope: 'thesis-revision',
      caseId,
      thesisId,
      revisionId,
    })

    await expect(
      sql.query(
        `UPDATE analysis.reviews
         SET scope = 'case', thesis_id = NULL, revision_id = NULL WHERE id = $1`,
        [reviewId],
      ),
    ).rejects.toThrow(/cannot be reattached/)
  })

  it('refuses to change which control function performed it', async () => {
    const caseId = await insertCase()
    const reviewId = id('review')
    await insertReview({ reviewId, scope: 'case', caseId })

    await expect(
      sql.query(`UPDATE analysis.reviews SET kind = 'risk' WHERE id = $1`, [reviewId]),
    ).rejects.toThrow(/cannot be reattached/)
  })
})

/* -------------------------------------------------------- idempotency */

describe('the natural key includes the exact scope', () => {
  it('refuses a replay of the same revision-scoped submission', async () => {
    const caseId = await insertCase()
    const { thesisId, revisionId } = await insertRevision(caseId)
    const at = new Date().toISOString()
    const row: ReviewRow = { scope: 'thesis-revision', caseId, thesisId, revisionId, at }

    await insertReview(row)
    await expect(insertReview(row)).rejects.toThrow(/reviews_natural_key_unique/)
  })

  it('accepts a verdict on a second revision at the same instant', async () => {
    // Over-matching here would silently discard a real review of revision 2.
    const caseId = await insertCase()
    const first = await insertRevision(caseId)
    const second = await insertRevision(caseId, {
      thesisId: first.thesisId,
      number: 2,
      supersedes: first.revisionId,
    })
    const at = new Date().toISOString()

    await insertReview({
      scope: 'thesis-revision',
      caseId,
      thesisId: first.thesisId,
      revisionId: first.revisionId,
      at,
    })
    await expect(
      insertReview({
        scope: 'thesis-revision',
        caseId,
        thesisId: second.thesisId,
        revisionId: second.revisionId,
        at,
      }),
    ).resolves.toBeDefined()
  })

  it('accepts a second control function at the same instant', async () => {
    const caseId = await insertCase()
    const { thesisId, revisionId } = await insertRevision(caseId)
    const at = new Date().toISOString()
    const base: ReviewRow = { scope: 'thesis-revision', caseId, thesisId, revisionId, at }

    await insertReview(base)
    await expect(
      insertReview({
        ...base,
        kind: 'risk',
        by: { employee: 'chief-risk-officer', department: 'risk' },
      }),
    ).resolves.toBeDefined()
  })

  it('agrees with the domain’s reviewIdentity', async () => {
    /*
     * The two stores must dedupe identically, not similarly. Two submissions
     * the domain considers distinct must both be insertable.
     */
    const caseId = await insertCase()
    const { thesisId, revisionId } = await insertRevision(caseId)
    const at = new Date().toISOString()

    const scoped: VerificationReview = {
      scope: 'thesis-revision',
      caseId,
      thesisId,
      revisionId,
      reviewId: 'v-scoped',
      sequence: 1,
      byEmployeeId: 'verification-head',
      byDepartmentId: 'verification',
      at,
      status: 'verified',
      findings: [],
      claimsReviewed: [],
    }
    const caseWide: VerificationReview = {
      scope: 'case',
      caseId,
      reviewId: 'v-case-wide',
      sequence: 1,
      byEmployeeId: 'verification-head',
      byDepartmentId: 'verification',
      at,
      status: 'verified',
      findings: [],
      claimsReviewed: [],
    }

    expect(reviewIdentity('verification', scoped)).not.toBe(
      reviewIdentity('verification', caseWide),
    )

    await insertReview({ scope: 'thesis-revision', caseId, thesisId, revisionId, at })
    // The domain calls them different, so PostgreSQL must accept both.
    await expect(insertReview({ scope: 'case', caseId, at })).resolves.toBeDefined()
  })
})

/* -------------------------------------------------------- permissions */

describe('runtime-role permissions still hold', () => {
  it('lets the runtime record a review but never change its scope', async () => {
    const app = await db.connectAs(APP_ROLE)
    const caseId = await insertCase()
    const { thesisId, revisionId } = await insertRevision(caseId)

    await expect(
      app.query(
        `INSERT INTO analysis.reviews
           (id, kind, scope, case_id, tenant_id, thesis_id, revision_id,
            by_employee_id, by_department_id, at, status, sequence)
         VALUES ($1, 'verification', 'thesis-revision', $2, 'system', $3, $4,
                 'verification-head', 'verification', now(), 'verified', 1)`,
        [id('review'), caseId, thesisId, revisionId],
      ),
    ).resolves.toBeDefined()

    // No UPDATE grant at all — the trigger is never even reached. The column
    // was added after 0009, so this also proves 0011 re-granted correctly.
    const error = await app.query(`UPDATE analysis.reviews SET revision_id = NULL`).then(
      () => null,
      (caught: unknown) => caught,
    )
    expect(isPermissionDenied(error)).toBe(true)
  })
})

/* ------------------------------------------------------- the upgrade path */

/**
 * A comparable description of the schema.
 *
 * Columns, constraints, indexes, triggers and grants — everything a later
 * migration could change without changing a table name. Ordered, so two
 * databases produce identical text when they genuinely match.
 */
async function schemaFingerprint(client: Client): Promise<string> {
  const columns = await client.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema = 'analysis'
     ORDER BY table_name, column_name`,
  )
  const constraints = await client.query(
    `SELECT conrelid::regclass::text AS rel, conname, pg_get_constraintdef(oid) AS def
     FROM pg_constraint
     WHERE connamespace = 'analysis'::regnamespace
     ORDER BY rel, conname`,
  )
  const indexes = await client.query(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'analysis' ORDER BY indexname`,
  )
  const triggers = await client.query(
    `SELECT tgrelid::regclass::text AS rel, tgname
     FROM pg_trigger WHERE NOT tgisinternal
       AND tgrelid IN (
         SELECT oid FROM pg_class WHERE relnamespace = 'analysis'::regnamespace
       )
     ORDER BY rel, tgname`,
  )
  const grants = await client.query(
    `SELECT grantee, table_name, privilege_type, coalesce(column_name, '*') AS col
     FROM information_schema.column_privileges
     WHERE table_schema = 'analysis' AND grantee IN ('finos_app', 'finos_readonly')
     ORDER BY grantee, table_name, col, privilege_type`,
  )

  return JSON.stringify(
    {
      columns: columns.rows,
      constraints: constraints.rows,
      indexes: indexes.rows,
      triggers: triggers.rows,
      grants: grants.rows,
    },
    null,
    1,
  )
}

describe('0011 upgrades an existing database to the same schema as a clean one', () => {
  let upgraded: TestDatabase
  let clean: TestDatabase
  let stageOneDir: string

  beforeAll(async () => {
    // A copy of the migration directory with 0011 removed, so an existing
    // Stage 1 database can be reproduced exactly — same files, same checksums.
    stageOneDir = await mkdtemp(join(tmpdir(), 'finos-stage1-'))
    await cp(DEFAULT_MIGRATIONS_DIR, stageOneDir, { recursive: true })
    await rm(join(stageOneDir, '0011_revision_scoped_reviews.sql'))

    upgraded = await createTestDatabase()
    clean = await createTestDatabase()

    const stageOne = await migrate(upgraded.owner, { directory: stageOneDir })
    expect(stageOne.applied.map((m) => m.version)).not.toContain('0011')
    const upgrade = await migrate(upgraded.owner)
    expect(upgrade.applied.map((m) => m.version)).toEqual(['0011'])

    await migrate(clean.owner)
  }, 180_000)

  afterAll(async () => {
    await upgraded?.drop()
    await clean?.drop()
    await rm(stageOneDir, { recursive: true, force: true })
  })

  it('reaches an identical schema by either route', async () => {
    expect(await schemaFingerprint(upgraded.owner)).toBe(
      await schemaFingerprint(clean.owner),
    )
  })

  it('records the same migration history by either route', async () => {
    const history = async (client: Client) =>
      (
        await client.query(
          'SELECT version, name, checksum FROM analysis.schema_migrations ORDER BY version',
        )
      ).rows

    expect(await history(upgraded.owner)).toEqual(await history(clean.owner))
  })

  it('leaves the seeded organization identical', async () => {
    const organization = async (client: Client) =>
      (
        await client.query(
          `SELECT id, name, manager_employee_id, is_governance
           FROM analysis.departments ORDER BY id`,
        )
      ).rows

    expect(await organization(upgraded.owner)).toEqual(await organization(clean.owner))
  })

  it('computes the same SHA-256 seed checksum by either route', async () => {
    const checksum = async (client: Client) =>
      (
        await client.query(
          `SELECT version, checksum FROM analysis.organization_seed_versions
           ORDER BY version`,
        )
      ).rows

    const upgradedChecksum = await checksum(upgraded.owner)
    expect(upgradedChecksum).toEqual(await checksum(clean.owner))
    // 64 hex characters: SHA-256, not the MD5 that 0010 originally wrote.
    expect(upgradedChecksum[0]!.checksum).toMatch(/^[0-9a-f]{64}$/)
  })

  it('enforces the new constraints on the upgraded database too', async () => {
    // A schema fingerprint proves the constraints exist. This proves one of
    // them actually fires on a database that predates it.
    await expect(
      upgraded.owner.query(
        `INSERT INTO analysis.reviews
           (id, kind, scope, case_id, tenant_id, thesis_id, revision_id,
            by_employee_id, by_department_id, at, status, sequence)
         VALUES ('r', 'verification', 'thesis-revision', 'c', 'system', 'th', NULL,
                 'verification-head', 'verification', now(), 'verified', 1)`,
      ),
    ).rejects.toThrow(/reviews_revision_scope_is_complete/)
  })
})

/* ---------------------------------------------------------- file hygiene */

describe('the migration set', () => {
  it('leaves 0006 unedited', async () => {
    // 0011 is a forward migration. An applied migration is a historical fact,
    // and every database that ran 0006 already has its effects.
    const governance = (await loadMigrations()).find((m) => m.name === 'governance')!
    expect(governance.sql).toContain('reviews_revision_implies_thesis')
    expect(governance.sql).not.toContain('scope')
  })
})
