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
 * The whole contract, supersession included, as of B2B-2.
 */

import { afterAll, beforeAll } from 'vitest'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import { describe, expect, it } from 'vitest'
import {
  assertSharedInventory,
  sharedContractInventory,
  SHARED_CONTRACT_CASES,
  describeDecisionRepositoryContract,
} from '../decisionRepositoryContract'
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

describeDecisionRepositoryContract('postgres', {
  async create() {
    await db.truncateAnalysisData()
    const repositories = await createPostgresRepositories({ connectionString: appUrl })
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

/*
 * The parity half. Each adapter checks, in its own process, that it defined
 * exactly the shared contract -- the two suites run in different vitest
 * projects and cannot observe each other, so one pinned list checked twice is
 * the strongest honest guarantee available.
 */
describe('the postgres adapter runs the whole shared contract', () => {
  it('defines exactly the pinned inventory', () => {
    assertSharedInventory()
    expect(sharedContractInventory()).toHaveLength(SHARED_CONTRACT_CASES.length)
  })
})
