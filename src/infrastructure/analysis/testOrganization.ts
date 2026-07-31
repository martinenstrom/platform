/**
 * The firm the command tests run against.
 *
 * One organization, shared, because the commands are authorized against a
 * seeded firm rather than against hard-coded department ids — three test files
 * each maintaining their own copy would drift, and the first symptom would be
 * a command that passes in one file and is refused in another for reasons
 * nobody could see.
 *
 * It mirrors the departments the Macro Regime playbook names, so
 * `validateRegistry` holds against it.
 *
 * Not a `.test.ts` file: it defines no tests, and naming it one would make
 * vitest report an empty suite every run.
 */

import { buildRole, type Organization, type RoleFunction } from '~/domain/analysis'

const role = (id: string, fn: RoleFunction) =>
  buildRole({
    id,
    title: id,
    function: fn,
    responsibilities: [],
    canBlockPublication: fn === 'governance',
  })

const department = (id: string, manager: string, handles: string[], gov = false) => ({
  id,
  name: id,
  managerEmployeeId: manager,
  handles,
  isGovernance: gov,
})

export const TEST_SEED_VERSION = 'seed-1'

export const TEST_ORGANIZATION: Organization = {
  id: 'firm',
  name: 'Firm',
  chiefEmployeeId: 'cio',
  roles: [
    role('chief-investment-officer', 'executive'),
    role('manager', 'manager'),
    role('specialist', 'specialist'),
    role('governance', 'governance'),
  ],
  departments: [
    department('executive', 'cio', []),
    department('research-office', 'research-director', ['aggregation']),
    department('global-macro', 'macro-head', ['macro', 'rates']),
    department('quant-technical', 'quant-head', ['quant']),
    department('verification', 'verification-head', ['verification'], true),
    department('devils-advocate', 'devils-advocate-head', ['challenge'], true),
    department('risk', 'chief-risk-officer', ['risk'], true),
  ],
  teams: [],
  employees: [
    {
      id: 'cio',
      displayName: 'CIO',
      roleId: 'chief-investment-officer',
      departmentId: 'executive',
      seniority: 'chief',
    },
    {
      id: 'research-director',
      displayName: 'Research Director',
      roleId: 'manager',
      departmentId: 'research-office',
      reportsTo: 'cio',
      seniority: 'head',
    },
    {
      id: 'macro-head',
      displayName: 'Macro Head',
      roleId: 'manager',
      departmentId: 'global-macro',
      reportsTo: 'cio',
      seniority: 'head',
    },
    {
      id: 'macro-analyst',
      displayName: 'Macro Analyst',
      roleId: 'specialist',
      departmentId: 'global-macro',
      reportsTo: 'macro-head',
      seniority: 'analyst',
    },
    {
      id: 'quant-head',
      displayName: 'Quant Head',
      roleId: 'manager',
      departmentId: 'quant-technical',
      reportsTo: 'cio',
      seniority: 'head',
    },
    {
      id: 'verification-head',
      displayName: 'Verification Head',
      roleId: 'governance',
      departmentId: 'verification',
      reportsTo: 'cio',
      seniority: 'head',
    },
    {
      id: 'devils-advocate-head',
      displayName: "Devil's Advocate Head",
      roleId: 'governance',
      departmentId: 'devils-advocate',
      reportsTo: 'cio',
      seniority: 'head',
    },
    {
      id: 'chief-risk-officer',
      displayName: 'CRO',
      roleId: 'governance',
      departmentId: 'risk',
      reportsTo: 'cio',
      seniority: 'chief',
    },
  ],
}

/** Who acts for each department. One employee per desk is enough here. */
export const EMPLOYEE_BY_DEPARTMENT: Readonly<Record<string, string>> = Object.freeze({
  'research-office': 'research-director',
  'global-macro': 'macro-analyst',
  'quant-technical': 'quant-head',
  verification: 'verification-head',
  'devils-advocate': 'devils-advocate-head',
  risk: 'chief-risk-officer',
})
