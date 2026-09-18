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

const role = (
  id: string,
  fn: RoleFunction,
  capabilities: {
    canConveneCommittee?: boolean
    canManageDepartmentAnalysis?: boolean
  } = {},
) =>
  buildRole({
    id,
    title: id,
    function: fn,
    responsibilities: [],
    canConveneCommittee: capabilities.canConveneCommittee ?? false,
    canManageDepartmentAnalysis: capabilities.canManageDepartmentAnalysis ?? false,
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
    /*
     * The chair convenes. Explicit capability, not seniority: `authorize`
     * refuses this same role the moment the flag is taken away.
     */
    role('chief-investment-officer', 'executive', { canConveneCommittee: true }),
    role('manager', 'manager'),
    /*
     * The one role that backs an autonomous department-analysis principal.
     * Separate from `manager` on purpose: `manager` is what Macro, Rates and
     * Quant hold, and none of them was granted this.
     */
    role('department-analysis', 'manager', { canManageDepartmentAnalysis: true }),
    role('specialist', 'specialist'),
    role('governance', 'governance'),
  ],
  departments: [
    department('executive', 'cio', []),
    department('research-office', 'research-director', ['aggregation']),
    /*
     * The `rates` handle sits on the Rates desk, not here. Mirrors migration
     * 0035, which moves it EXCLUSIVELY: held jointly, a case tagged `rates`
     * would reach two desks with no rule saying which owns the work.
     */
    department('global-macro', 'macro-head', ['macro']),
    department('quant-technical', 'quant-head', ['quant']),
    /*
     * A second analytical desk whose mandate overlaps Macro's, and the reason
     * peer examination is testable at all: one desk cannot disagree with
     * itself. Deliberately NOT governance — see 0035.
     */
    department('rates', 'rates-head', ['rates']),
    department('verification', 'verification-head', ['verification'], true),
    department('devils-advocate', 'devils-advocate-head', ['challenge'], true),
    department('risk', 'chief-risk-officer', ['risk'], true),
  ],
  teams: [],
  agentPrincipals: [
    /*
     * The Research Office's autonomous principal, and two desks that are NOT
     * granted department authority — so a test that widened the rule by
     * accident would have something to fail against.
     */
    {
      id: 'research-office-agent',
      departmentId: 'research-office',
      roleId: 'department-analysis',
      displayName: 'Research Office',
      active: true,
    },
    {
      id: 'global-macro-agent',
      departmentId: 'global-macro',
      roleId: 'manager',
      displayName: 'Global Macro',
      active: true,
    },
    {
      id: 'rates-agent',
      departmentId: 'rates',
      roleId: 'manager',
      displayName: 'Rates',
      active: true,
    },
    /*
     * The three control functions, each on the `governance` role, which is
     * what `governance-verdict` actually checks — so a test proving an
     * analytical agent cannot verify has something real to fail against, and
     * is not passing merely because no such principal exists.
     *
     * Risk was deliberately absent while its requirement-resolution seam was
     * unruled. G1 (2026-09-17) ruled it: the Risk principal resolves whether
     * its review applies to a revision, and holds no budget for the review
     * itself (TD-98) — as migration 0051 seats it.
     */
    {
      id: 'verification-agent',
      departmentId: 'verification',
      roleId: 'governance',
      displayName: 'Verification',
      active: true,
    },
    {
      id: 'devils-advocate-agent',
      departmentId: 'devils-advocate',
      roleId: 'governance',
      displayName: "Devil's Advocate",
      active: true,
    },
    {
      id: 'risk-agent',
      departmentId: 'risk',
      roleId: 'governance',
      displayName: 'Risk',
      active: true,
    },
  ],
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
      id: 'rates-head',
      displayName: 'Head of Rates',
      roleId: 'manager',
      departmentId: 'rates',
      reportsTo: 'research-director',
      seniority: 'head',
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
  /* The Rates desk, seated by migration 0035 and given work by playbook v5. */
  rates: 'rates-head',
  verification: 'verification-head',
  'devils-advocate': 'devils-advocate-head',
  risk: 'chief-risk-officer',
})
