/**
 * The submission and return contract, against real PostgreSQL — as `finos_app`.
 *
 * The same bodies that run against the in-memory reference, invoked from a
 * second call site. If one passes and the other fails, that is a real
 * divergence between the two stores rather than a difference of opinion
 * between two test files.
 *
 * **Not as the owner.** Every write goes through the column-level grants the
 * adapter will actually have, and several of them would be denied under a
 * blanket `SET` — an owner-level run would pass statements production cannot
 * execute.
 *
 * The decision half is invoked once B2B implements it.
 */

import { afterAll, beforeAll } from 'vitest'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import { describeSubmissionRepositoryContract } from '../decisionRepositoryContract'
import { seedDecisionGovernance } from '../decisionSeed'
import { IN_MEMORY_SEED_FIXTURES } from '../decisionSeedFixtures'
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
  await Promise.all(opened.map((repositories) => repositories.close().catch(() => {})))
  await db?.drop()
})

describeSubmissionRepositoryContract('postgres', {
  async create() {
    await db.truncateAnalysisData()
    const repositories = createPostgresRepositories({ connectionString: appUrl })
    opened.push(repositories)
    return repositories
  },

  async destroy(repositories: AnalysisRepositories) {
    await (repositories as PostgresRepositories).close()
  },

  seed: (repositories, fixture) =>
    seedDecisionGovernance(repositories, {
      ...fixture,
      fixtures: IN_MEMORY_SEED_FIXTURES,
    }),
})
