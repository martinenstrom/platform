/**
 * Every client the adapter takes, it gives back.
 *
 * A leaked connection does not fail anything immediately. It fails later,
 * somewhere else, when the pool is exhausted by traffic that has nothing to do
 * with whatever leaked — which is why this is measured against
 * `pg_stat_activity` rather than inferred from the absence of a timeout. A
 * suite that finishes without hanging proves the pool was big enough, not that
 * it was returned.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  cioReturn,
  cioSubmission,
  selectedDecision,
} from '~/domain/analysis/decisionFixtures'
import {
  ConflictingRecordError,
  MalformedRowError,
  TransactionClosedError,
  type TransactionalAnalysisRepositories,
} from '~/application/analysis/repositories'
import { seedDecisionGovernance } from '../decisionSeed'
import { IN_MEMORY_SEED_FIXTURES } from '../decisionSeedFixtures'
import {
  createPostgresRepositories,
  type PostgresRepositories,
} from './postgresRepositories'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'

let db: TestDatabase
let appUrl: string
let repositories: PostgresRepositories
const opened: PostgresRepositories[] = []

/** Backends on this database other than the observer's own. */
async function backends(): Promise<number> {
  const rows = await db.owner.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [db.name],
  )
  return Number(rows.rows[0]!.count)
}

/** Backends sitting in an open transaction — the shape a leak actually takes. */
async function idleInTransaction(): Promise<number> {
  const rows = await db.owner.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM pg_stat_activity
     WHERE datname = $1 AND state = 'idle in transaction'`,
    [db.name],
  )
  return Number(rows.rows[0]!.count)
}

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
  repositories = await createPostgresRepositories({ connectionString: appUrl })
  opened.push(repositories)
  await seedDecisionGovernance(repositories, {
    caseId: 'case-1',
    revisionIds: ['rev-1', 'rev-2'],
    fixtures: IN_MEMORY_SEED_FIXTURES,
  })
  await repositories.submissions.save(cioSubmission())
  await repositories.submissions.save(
    cioSubmission({ id: 'sub-2', revisionId: 'rev-2', thesisId: 'thesis-2' }),
  )
})

afterEach(async () => {
  await repositories.close()
})

describe('an internally owned unit of work releases its client', () => {
  it('after twenty successful reads', async () => {
    const before = await backends()
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await repositories.submissions.listForCase('case-1')
    }
    expect(await backends()).toBe(before)
    expect(await idleInTransaction()).toBe(0)
  })

  it('after twenty successful writes', async () => {
    const before = await backends()
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await repositories.submissions.save(
        cioSubmission({ id: `sub-loop-${attempt}`, revisionId: 'rev-1' }),
      )
    }
    expect(await backends()).toBe(before)
    expect(await idleInTransaction()).toBe(0)
  })

  it('after twenty rejected writes', async () => {
    /*
     * A rollback that failed to release would leave the connection in `idle in
     * transaction` — the exact state that exhausts a pool while every
     * individual operation still looks like it succeeded.
     */
    const before = await backends()
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await repositories.decisions
        .save(selectedDecision({ decisionId: `dec-bad-${attempt}`, rationale: '' }))
        .catch(() => {})
    }
    expect(await backends()).toBe(before)
    expect(await idleInTransaction()).toBe(0)
  })

  it('after twenty conflicting replays', async () => {
    await repositories.decisions.save(selectedDecision())
    const before = await backends()

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const error = await repositories.decisions
        .save(selectedDecision({ rationale: `different ${attempt}` }))
        .then(
          () => null,
          (thrown: unknown) => thrown,
        )
      expect(error).toBeInstanceOf(ConflictingRecordError)
    }

    expect(await backends()).toBe(before)
    expect(await idleInTransaction()).toBe(0)
  })

  it('after twenty malformed hydrations', async () => {
    // Corrupted as the owner; `cio_submissions` carries no immutability trigger.
    await db.owner.query(
      `UPDATE analysis.cio_submissions SET risk_review_id = 'review-r-rev-2'
        WHERE id = 'sub-1'`,
    )
    const before = await backends()

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const error = await repositories.submissions.get('sub-1').then(
        () => null,
        (thrown: unknown) => thrown,
      )
      expect(error).toBeInstanceOf(MalformedRowError)
    }

    expect(await backends()).toBe(before)
    expect(await idleInTransaction()).toBe(0)
  })
})

describe('an outer transaction keeps ownership of its client', () => {
  it('runs the whole callback on one connection', async () => {
    /*
     * `unitOfWork` joins an open transaction rather than opening its own, so a
     * callback issuing operations across three ports observes one backend and
     * not three.
     */
    let duringCallback = 0
    await repositories.withTransaction(async (scoped) => {
      await scoped.submissions.listForCase('case-1')
      await scoped.decisions.historyForCase('case-1')
      await scoped.submissions.applicableForRevision('rev-1')
      duringCallback = await idleInTransaction()
    })
    expect(duringCallback).toBe(1)
    expect(await idleInTransaction()).toBe(0)
  })

  it('does not release the caller client when a joined operation finishes', async () => {
    await repositories.withTransaction(async (scoped) => {
      await scoped.decisions.save(selectedDecision())
      // If the joined save had released the connection, this would fail.
      const seen = await scoped.decisions.getForCase('case-1')
      expect(seen?.decisionId).toBe('dec-1')
    })
    expect((await repositories.decisions.getForCase('case-1'))?.decisionId).toBe('dec-1')
  })

  it('rolls back writes across all three ports', async () => {
    await expect(
      repositories.withTransaction(async (scoped) => {
        await scoped.submissions.save(cioSubmission({ id: 'sub-rolled' }))
        await scoped.submissions.recordReturn(cioReturn({ id: 'ret-rolled' }))
        await scoped.decisions.save(selectedDecision({ decisionId: 'dec-rolled' }))
        throw new Error('rolled back')
      }),
    ).rejects.toThrow('rolled back')

    expect(await repositories.submissions.get('sub-rolled')).toBeNull()
    expect(await repositories.submissions.getReturn('ret-rolled')).toBeNull()
    expect(await repositories.decisions.get('dec-rolled')).toBeNull()
    expect(await idleInTransaction()).toBe(0)
  })

  it('preserves writes across all three ports on commit', async () => {
    await repositories.withTransaction(async (scoped) => {
      await scoped.submissions.recordReturn(cioReturn({ id: 'ret-kept' }))
      await scoped.decisions.save(selectedDecision({ decisionId: 'dec-kept' }))
    })

    expect(await repositories.submissions.getReturn('ret-kept')).not.toBeNull()
    expect(await repositories.decisions.get('dec-kept')).not.toBeNull()
    expect(await idleInTransaction()).toBe(0)
  })

  it('releases the client after a rolled-back transaction', async () => {
    const before = await backends()
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await repositories
        .withTransaction(async (scoped) => {
          await scoped.submissions.save(cioSubmission({ id: `sub-rb-${attempt}` }))
          throw new Error('rolled back')
        })
        .catch(() => {})
    }
    expect(await backends()).toBe(before)
    expect(await idleInTransaction()).toBe(0)
  })
})

describe('scope lifetime', () => {
  it('refuses a repository that escaped its transaction', async () => {
    let escaped: TransactionalAnalysisRepositories | null = null
    await repositories.withTransaction(async (scoped) => {
      escaped = scoped
    })

    await expect(escaped!.submissions.get('sub-1')).rejects.toThrow(
      TransactionClosedError,
    )
    await expect(escaped!.decisions.getForCase('case-1')).rejects.toThrow(
      TransactionClosedError,
    )
  })

  it('fails predictably after the container closes', async () => {
    const container = await createPostgresRepositories({ connectionString: appUrl })
    await container.close()

    await expect(container.submissions.listForCase('case-1')).rejects.toThrow()
    await expect(container.decisions.historyForCase('case-1')).rejects.toThrow()
    // Idempotent, from B2C-1 — relied on here rather than retested as new work.
    await expect(container.close()).resolves.toBeUndefined()
  })

  it('leaves nothing behind across the whole file', async () => {
    // The summary check: whatever every test above did, the database is quiet.
    expect(await idleInTransaction()).toBe(0)
  })
})
