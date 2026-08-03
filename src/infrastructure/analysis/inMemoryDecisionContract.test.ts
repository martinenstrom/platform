/**
 * The contract, against the in-memory reference.
 *
 * The reference implementation, not a reduced test double: every institutional
 * rule the PostgreSQL adapter will enforce is enforced here first, and B2 adds
 * a second call site to the same suite without changing a line of it.
 */

import { createInMemoryRepositories } from './inMemoryRepositories'
import { describe, expect, it } from 'vitest'
import {
  assertSharedInventory,
  sharedContractInventory,
  SHARED_CONTRACT_CASES,
  describeDecisionRepositoryContract,
} from './decisionRepositoryContract'
import { seedDecisionGovernance } from './decisionSeed'
import { IN_MEMORY_SEED_FIXTURES } from './decisionSeedFixtures'

describeDecisionRepositoryContract('in-memory', {
  create: async () => createInMemoryRepositories(),
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
describe('the in-memory adapter runs the whole shared contract', () => {
  it('defines exactly the pinned inventory', () => {
    assertSharedInventory()
    expect(sharedContractInventory()).toHaveLength(SHARED_CONTRACT_CASES.length)
  })
})
