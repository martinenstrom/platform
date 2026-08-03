/**
 * A refused construction releases everything it opened.
 *
 * The factory has to build a pool before it can check whether the container it
 * is assembling is complete, so a refusal always happens with a resource
 * already open. If that resource is not released — or is released by an
 * unawaited promise nobody is watching — repeated refused startups accumulate
 * connections, and the symptom appears somewhere unrelated much later.
 *
 * This is also why the factory is asynchronous. A synchronous one could only
 * launch the drain in the background and hope.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  IncompleteRepositoriesError,
  assertRepositoriesComplete,
} from '~/application/analysis/repositories'
import {
  createPostgresRepositories,
  type PostgresRepositories,
} from './postgresRepositories'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'

let db: TestDatabase
let appUrl: string
const opened: PostgresRepositories[] = []

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  appUrl = await db.loginUrlFor(APP_ROLE)
}, 300_000)

afterAll(async () => {
  await Promise.all(opened.map((entry) => entry.close().catch(() => {})))
  await db?.drop()
})

/** Backends this database currently has, whatever they are doing. */
const backends = async () => {
  const rows = await db.owner.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [db.name],
  )
  return Number(rows.rows[0]!.count)
}

describe('a complete container is handed out', () => {
  it('constructs and closes', async () => {
    const repositories = await createPostgresRepositories({ connectionString: appUrl })
    expect(typeof repositories.decisions.save).toBe('function')
    expect(typeof repositories.submissions.applicableForRevision).toBe('function')
    await repositories.close()
  })

  it('closes idempotently', async () => {
    const repositories = await createPostgresRepositories({ connectionString: appUrl })
    await repositories.close()
    await expect(repositories.close()).resolves.toBeUndefined()
  })

  it('fails predictably after close', async () => {
    const repositories = await createPostgresRepositories({ connectionString: appUrl })
    await repositories.close()
    await expect(repositories.cases.list()).rejects.toThrow()
  })
})

describe('an incomplete container is refused at construction', () => {
  it('names what is missing rather than failing on first use', () => {
    /*
     * The shape B2A carried: structurally satisfying the port and failing on
     * invocation. The guard checks presence only — it never calls a method,
     * because calling `save` to see whether it works would write.
     */
    const partial = { cases: {} }
    try {
      assertRepositoriesComplete(partial as never)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(IncompleteRepositoriesError)
      expect((error as IncompleteRepositoriesError).missing.length).toBeGreaterThan(5)
    }
  })

  it('leaks no connection across repeated refused constructions', async () => {
    /*
     * The property that matters. Ten refused constructions must leave the
     * database with the same number of backends as none at all — an unawaited
     * `pool.end()` would fail this intermittently, which is the worst way for
     * it to fail.
     */
    const before = await backends()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const repositories = await createPostgresRepositories({ connectionString: appUrl })
      await repositories.close()
    }

    expect(await backends()).toBe(before)
  })
})
