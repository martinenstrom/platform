/**
 * The contract, against the in-memory reference.
 *
 * The reference implementation, not a reduced test double: every institutional
 * rule the PostgreSQL adapter will enforce is enforced here first, and B2 adds
 * a second call site to the same suite without changing a line of it.
 */

import { createInMemoryRepositories } from './inMemoryRepositories'
import { describeDecisionRepositoryContract } from './decisionRepositoryContract'

describeDecisionRepositoryContract('in-memory', {
  create: async () => createInMemoryRepositories(),
})
