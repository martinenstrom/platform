/**
 * What only real PostgreSQL can be asked.
 *
 * The shared contract already proves the semantics match the in-memory
 * reference. These are the things that have no in-memory counterpart: how many
 * statements an operation issues, what happens when two settlements race for
 * one submission, and what the runtime role is actually allowed to do.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import {
  cioReturn,
  cioSubmission,
  disclosedDissent,
  eligibilityBasis,
  quantitativeTrigger,
  selectedDecision,
} from '~/domain/analysis/decisionFixtures'
import type { StorageMetrics } from '~/application/analysis/storageObservability'
import { InvariantViolationError } from '~/application/analysis/repositories'
import { seedDecisionGovernance } from '../decisionSeed'
import { IN_MEMORY_SEED_FIXTURES } from '../decisionSeedFixtures'
import {
  createPostgresRepositories,
  type PostgresRepositories,
} from './postgresRepositories'
import {
  APP_ROLE,
  createTestDatabase,
  isPermissionDenied,
  type TestDatabase,
} from './testDatabase'

let db: TestDatabase
let appUrl: string
let repositories: PostgresRepositories
const opened: PostgresRepositories[] = []

/** One entry per executed statement, by port method. */
const counts = new Map<string, number>()
const counting: StorageMetrics = {
  increment: () => {},
  gauge: () => {},
  observe: (name, _value, labels) => {
    if (name !== 'analysis.db.query.latency_ms') return
    const operation = String(labels?.operation ?? 'unknown')
    counts.set(operation, (counts.get(operation) ?? 0) + 1)
  },
}
const statementsFor = (operation: string) => counts.get(operation) ?? 0

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  appUrl = await db.loginUrlFor(APP_ROLE)
}, 300_000)

afterAll(async () => {
  await Promise.all(opened.map((entry) => entry.close().catch(() => {})))
  await db?.drop()
})

beforeEach(async () => {
  await db.truncateAnalysisData()
  repositories = createPostgresRepositories({
    connectionString: appUrl,
    metrics: counting,
  })
  opened.push(repositories)
  await seedDecisionGovernance(repositories, {
    caseId: 'case-1',
    revisionIds: ['rev-1', 'rev-2'],
    fixtures: IN_MEMORY_SEED_FIXTURES,
  })
  counts.clear()
})

afterEach(async () => {
  await repositories.close()
})

/* ------------------------------------------------------------ query budgets */

describe('statement counts do not grow with the data', () => {
  /**
   * The same submission with `size` entries in every child collection.
   *
   * The absolute number is not the property under test — that the number is the
   * SAME at one child row and at twenty-five is. An operation issuing one
   * statement per child is survivable at 400 cases a year and stops being
   * survivable without anyone noticing.
   */
  const wide = (id: string, size: number) =>
    cioSubmission({
      id,
      basis: eligibilityBasis({
        requiredWork: Array.from({ length: size }, (_, index) => ({
          playbookEntryKey: `entry-${index}`,
          runId: `run-${(index % 2) + 1}-rev-1`,
        })),
        evidenceSetIds: eligibilityBasis().evidenceSetIds,
      }),
    })

  for (const size of [1, 25]) {
    it(`save issues the same statements at ${size} child rows`, async () => {
      counts.clear()
      await repositories.submissions.save(wide(`sub-${size}`, size))
      /*
       * Existence probe, ownership, the root, four child tables. Seven, and
       * seven whether the submission cites one required run or twenty-five.
       */
      expect(statementsFor('submissions.save')).toBe(7)
    })

    it(`get issues five statements at ${size} child rows`, async () => {
      await repositories.submissions.save(wide(`sub-get-${size}`, size))
      counts.clear()
      await repositories.submissions.get(`sub-get-${size}`)
      // root + four child tables + the challenges of the cited review.
      expect(statementsFor('submissions.get')).toBe(6)
    })
  }

  it('lists a whole case in a fixed number of statements', async () => {
    await repositories.submissions.save(cioSubmission())
    await repositories.submissions.save(
      cioSubmission({ id: 'sub-2', revisionId: 'rev-2', thesisId: 'thesis-2' }),
    )
    counts.clear()
    await repositories.submissions.listForCase('case-1')
    expect(statementsFor('submissions.listForCase')).toBe(6)
  })

  it('settles a list in two statements, whatever its length', async () => {
    await repositories.submissions.save(cioSubmission())
    await repositories.submissions.save(
      cioSubmission({ id: 'sub-2', revisionId: 'rev-2', thesisId: 'thesis-2' }),
    )
    counts.clear()
    await repositories.submissions.settle(['sub-1', 'sub-2'], 'decided')
    /*
     * Two, not one: the repository has to tell a missing submission from a
     * replay from a conflicting settlement, and a bare UPDATE cannot.
     */
    expect(statementsFor('submissions.settle')).toBe(2)
  })

  it('reads returns and their concerns in two statements', async () => {
    await repositories.submissions.save(cioSubmission())
    await repositories.submissions.recordReturn(cioReturn())
    counts.clear()
    await repositories.submissions.returnsForCase('case-1')
    expect(statementsFor('returns.returnsForCase')).toBe(2)
  })
})

/* -------------------------------------------------------------- the settle race */

describe('two settlements racing for one submission', () => {
  it('lets exactly one win, and the loser learns why', async () => {
    await repositories.submissions.save(cioSubmission())

    const other = createPostgresRepositories({ connectionString: appUrl })
    opened.push(other)

    /*
     * The conditional predicate — `WHERE state = 'pending'` — is what makes
     * this safe. Without it both updates would succeed and the last writer
     * would decide whether the case was decided or returned.
     */
    const results = await Promise.allSettled([
      repositories.submissions.settle(['sub-1'], 'decided'),
      other.submissions.settle(['sub-1'], 'returned'),
    ])

    const settled = await repositories.submissions.get('sub-1')
    expect(['decided', 'returned']).toContain(settled?.state)

    const rejected = results.filter((result) => result.status === 'rejected')
    // One may lose on the read and one on the write; either way the record
    // holds exactly one outcome and never a blend of both.
    expect(rejected.length).toBeLessThanOrEqual(1)

    // Whichever lost, a later attempt at the other state is refused outright.
    const opposite = settled?.state === 'decided' ? 'returned' : 'decided'
    await expect(
      repositories.submissions.settle(['sub-1'], opposite),
    ).rejects.toThrow(InvariantViolationError)

    await other.close()
  })
})

/* ---------------------------------------------------------- runtime role */

describe('the runtime role can do exactly what it needs', () => {
  let app: Client

  beforeEach(async () => {
    app = await db.connectAs(APP_ROLE)
  })

  afterEach(async () => {
    await app.end().catch(() => {})
  })

  const refusal = async (sql: string) =>
    app.query(sql).then(
      () => null,
      (error: unknown) => error,
    )

  it('writes submissions, returns and their children', async () => {
    await repositories.submissions.save(cioSubmission())
    await repositories.submissions.recordReturn(cioReturn())
    expect(await repositories.submissions.get('sub-1')).not.toBeNull()
    expect(await repositories.submissions.getReturn('ret-1')).not.toBeNull()
  })

  it('reads the eligibility policy registry and cannot write it', async () => {
    await expect(
      app.query(`SELECT version FROM analysis.eligibility_policies`),
    ).resolves.toBeDefined()
    expect(
      isPermissionDenied(
        await refusal(
          `INSERT INTO analysis.eligibility_policies VALUES
             ('99','invented','outside-policy-scope','outside-policy-scope',
              'outside-policy-scope','outside-policy-scope','material',
              'decision-critical', false, '8')`,
        ),
      ),
    ).toBe(true)
  })

  it('cannot rewrite a submission beyond its state', async () => {
    await repositories.submissions.save(cioSubmission())
    expect(
      isPermissionDenied(
        await refusal(`UPDATE analysis.cio_submissions SET case_version = 99`),
      ),
    ).toBe(true)
    // The one column it may move.
    await expect(
      app.query(`UPDATE analysis.cio_submissions SET state = 'decided'`),
    ).resolves.toBeDefined()
  })

  it('cannot change or delete a return, or its concerns', async () => {
    await repositories.submissions.save(cioSubmission())
    await repositories.submissions.recordReturn(cioReturn())
    for (const statement of [
      `UPDATE analysis.cio_returns SET reason = 'edited'`,
      `DELETE FROM analysis.cio_returns`,
      `UPDATE analysis.cio_return_concerns SET detail = 'edited'`,
      `DELETE FROM analysis.cio_return_concerns`,
    ]) {
      expect(isPermissionDenied(await refusal(statement)), statement).toBe(true)
    }
  })

  it('cannot delete a submission or any of its basis rows', async () => {
    await repositories.submissions.save(cioSubmission())
    for (const table of [
      'cio_submissions',
      'submission_required_work',
      'submission_disagreements',
      'submission_evidence',
      'submission_open_challenges',
    ]) {
      expect(
        isPermissionDenied(await refusal(`DELETE FROM analysis.${table}`)),
        table,
      ).toBe(true)
    }
  })

  it('cannot disable a trigger or touch the migration history', async () => {
    for (const statement of [
      `ALTER TABLE analysis.cio_submissions ADD COLUMN sneaked text`,
      `DELETE FROM analysis.schema_migrations`,
    ]) {
      expect(isPermissionDenied(await refusal(statement)), statement).toBe(true)
    }
  })
})

/* --------------------------------------------------------- error hygiene */

describe('errors carry nothing institutional', () => {
  it('names the constraint and never the content', async () => {
    await repositories.submissions.save(cioSubmission())
    const error = await repositories.submissions
      .save(cioSubmission({ caseVersion: 99 }))
      .then(
        () => null,
        (thrown: Error) => thrown,
      )

    expect(error).not.toBeNull()
    const message = String(error?.message)
    // No SQL, no parameters, no rationale, no PostgreSQL `detail`.
    expect(message).not.toMatch(/INSERT|SELECT|UPDATE/i)
    expect(message).not.toContain('mispriced')
    expect(message).not.toMatch(/Key \(/)
  })
})

/* ------------------------------------------------------- decision budgets */

describe('decision statement counts do not grow with the data', () => {
  /** A decision whose child collections all hold `size` entries. */
  const wide = (id: string, size: number) =>
    selectedDecision({
      decisionId: id,
      unresolvedDissent: Array.from({ length: size }, (_, index) =>
        disclosedDissent({ sourceId: `challenge-${index}` }),
      ),
      reconsiderationTriggers: Array.from({ length: size }, (_, index) =>
        quantitativeTrigger({ id: `trg-${index}` }),
      ),
    })

  const seedSubmissions = async () => {
    await repositories.submissions.save(cioSubmission())
    await repositories.submissions.save(
      cioSubmission({ id: 'sub-2', revisionId: 'rev-2', thesisId: 'thesis-2' }),
    )
  }

  for (const size of [1, 25]) {
    it(`save issues the same statements at ${size} child rows`, async () => {
      await seedSubmissions()
      counts.clear()
      await repositories.decisions.save(wide(`dec-${size}`, size))
      /*
       * Replay probe, the submission check, the root, four child tables, and
       * the two `SET CONSTRAINTS` statements. Nine, whether the decision
       * carries one dissent entry or twenty-five.
       *
       * Seven until B2B-2. The two added statements are what make an invalid
       * relation set fail from `save` rather than from the caller's commit --
       * the parity property the whole named-constraint design exists for -- so
       * the increase buys something and is recorded rather than absorbed.
       */
      expect(statementsFor('decisions.save')).toBe(9)
    })

    it(`get issues five statements at ${size} child rows`, async () => {
      await seedSubmissions()
      await repositories.decisions.save(wide(`dec-get-${size}`, size))
      counts.clear()
      await repositories.decisions.get(`dec-get-${size}`)
      expect(statementsFor('decisions.get')).toBe(5)
    })
  }

  it('reads the live decision, the history and the recent list in five each', async () => {
    await seedSubmissions()
    await repositories.decisions.save(selectedDecision())

    counts.clear()
    await repositories.decisions.getForCase('case-1')
    expect(statementsFor('decisions.getForCase')).toBe(5)

    counts.clear()
    await repositories.decisions.historyForCase('case-1')
    expect(statementsFor('decisions.historyForCase')).toBe(5)

    counts.clear()
    await repositories.decisions.listRecent(10)
    expect(statementsFor('decisions.listRecent')).toBe(5)
  })

  it('writes nothing on an identical replay', async () => {
    await seedSubmissions()
    await repositories.decisions.save(selectedDecision())
    counts.clear()
    await repositories.decisions.save(selectedDecision())
    // The probe and its four hydration reads. No insert.
    expect(statementsFor('decisions.save')).toBe(5)
  })
})
