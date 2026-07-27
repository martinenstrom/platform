/**
 * The repository contract, against the in-memory reference implementation.
 *
 * The same suite runs against PostgreSQL in `postgresContract.pg.test.ts`. If
 * one passes and the other fails, that is a real divergence between the two
 * stores rather than a difference of opinion between two test files.
 */

import { createInMemoryRepositories } from './inMemoryRepositories'
import { describeRepositoryContract } from './repositoryContract'

describeRepositoryContract('in-memory', {
  create: async () => createInMemoryRepositories(),
  fixtures: {
    // This store has no foreign keys, so the ids only need to be consistent.
    ownerEmployeeId: 'research-director',
    departmentId: 'global-macro',
    governanceDepartmentId: 'verification',
    governanceEmployeeId: 'verification-head',
  },
})
