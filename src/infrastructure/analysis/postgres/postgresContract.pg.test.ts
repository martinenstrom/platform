/**
 * The repository contract, against real PostgreSQL — as the runtime role.
 *
 * The same suite that runs against the in-memory reference. If one passes and
 * the other fails, that is a real divergence between the two stores rather
 * than a difference of opinion between two test files.
 *
 * **Connected as `finos_app`, not as the owner.** Every write here goes through
 * the column-level grants the adapter will actually have — and several of them
 * would be denied under a blanket `SET`, so an owner-level run would pass on
 * statements production cannot execute.
 */

import { afterAll, beforeAll } from 'vitest'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import { describeRepositoryContract } from '../repositoryContract'
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
}, 180_000)

afterAll(async () => {
  await Promise.all(opened.map((repositories) => repositories.close().catch(() => {})))
  await db?.drop()
})

describeRepositoryContract('postgres', {
  async create() {
    /*
     * A fresh schema per test rather than a fresh database: creating a
     * database costs a few hundred milliseconds and the contract has fifty
     * tests. Truncating gives the same isolation for a fraction of the time.
     */
    await db.truncateAnalysisData()
    const repositories = createPostgresRepositories({ connectionString: appUrl })
    opened.push(repositories)
    return repositories
  },

  async destroy(repositories: AnalysisRepositories) {
    await (repositories as PostgresRepositories).close()
  },

  fixtures: {
    // Seeded by migration 0010. The foreign keys are real here, so these must
    // be employees and departments that actually exist.
    ownerEmployeeId: 'research-director',
    departmentId: 'global-macro',
    governanceDepartmentId: 'verification',
    governanceEmployeeId: 'verification-head',
  },
})
