import { describeAdvisoryRepositoryContract } from './advisoryRepositoryContract'
import { createSyntheticAdvisoryRepositories } from './syntheticRepositories'

describeAdvisoryRepositoryContract({
  name: 'synthetic record',
  open: async (seed) => createSyntheticAdvisoryRepositories(seed),
})
