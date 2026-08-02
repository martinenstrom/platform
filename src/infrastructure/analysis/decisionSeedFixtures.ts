/**
 * The employees and departments the seed writes against.
 *
 * Real ids from the organization migration 0010 seeds, so the same constant
 * satisfies PostgreSQL's foreign keys and the in-memory store's absence of
 * them. A fixture that invented `research-office-2` would pass in memory and
 * fail against the database, which is the divergence the shared suite exists
 * to prevent.
 */

import type { SeedFixtures } from './decisionSeed'

export const IN_MEMORY_SEED_FIXTURES: SeedFixtures = {
  ownerEmployeeId: 'research-director',
  departmentId: 'global-macro',
  governanceEmployeeId: 'verification-head',
  governanceDepartmentId: 'verification',
  riskEmployeeId: 'chief-risk-officer',
  riskDepartmentId: 'risk',
  challengeEmployeeId: 'devils-advocate-head',
  challengeDepartmentId: 'devils-advocate',
}
