/**
 * What a Financial OS specialist may and may not do.
 *
 * An institutional agent is accountable for one desk's work. It is not a system
 * process, which is answerable for nothing, and it is not an employee, which is
 * a person. The whole design rests on one property: the EXISTING mandate rules
 * authorize an agent unchanged, because the agent carries the same
 * organisational snapshot an employee carries — a department and a role, read
 * from the same organisation.
 *
 * So what is pinned here is mostly that nothing was widened. Rates cannot
 * perform Verification for the same reason it never could; Global Macro cannot
 * act for Rates for the same reason; and an analytical desk cannot issue a
 * governance verdict for the same reason.
 *
 * The one genuinely new rule is convening, and it is refused by actor kind
 * rather than by seed discipline — see the last group.
 */

import { describe, expect, it } from 'vitest'
import { authorize, resolveActor, type Mandate, type Organization } from './index'
import { buildRole } from './organization'

const SEED = '1'

/**
 * A firm with agents on both an analytical desk and a control function.
 *
 * Both reference MANAGER roles that hold `canConveneCommittee`, which is
 * deliberate: it is the arrangement that would let convening leak to an agent
 * if the rule were left to the seed.
 */
function organization(over: Partial<Organization> = {}): Organization {
  return {
    id: 'firm',
    name: 'Firm',
    chiefEmployeeId: 'cio',
    roles: [
      buildRole({
        id: 'chief-investment-officer',
        title: 'CIO',
        function: 'executive',
        responsibilities: [],
        canBlockPublication: false,
        canConveneCommittee: true,
      }),
      buildRole({
        id: 'manager',
        title: 'Manager',
        function: 'manager',
        responsibilities: [],
        canBlockPublication: false,
        /* The trap: a role an agent references, holding convening authority. */
        canConveneCommittee: true,
      }),
      buildRole({
        id: 'department-analysis',
        title: 'Head of Research Office',
        function: 'manager',
        responsibilities: [],
        canBlockPublication: false,
        /* Still the trap: the capability does not bring convening with it. */
        canConveneCommittee: true,
        canManageDepartmentAnalysis: true,
      }),
      buildRole({
        id: 'governance',
        title: 'Governance',
        function: 'governance',
        responsibilities: [],
        canBlockPublication: true,
      }),
    ],
    departments: [
      { id: 'executive', name: 'Executive', managerEmployeeId: 'cio', handles: [], isGovernance: false },
      { id: 'research-office', name: 'Research Office', managerEmployeeId: 'research-director', handles: ['aggregation'], isGovernance: false },
      { id: 'global-macro', name: 'Global Macro', managerEmployeeId: 'macro-head', handles: ['macro'], isGovernance: false },
      { id: 'rates', name: 'Rates', managerEmployeeId: 'rates-head', handles: ['rates'], isGovernance: false },
      { id: 'verification', name: 'Verification', managerEmployeeId: 'verification-head', handles: ['verification'], isGovernance: true },
      { id: 'devils-advocate', name: "Devil's Advocate", managerEmployeeId: 'da-head', handles: ['challenge'], isGovernance: true },
    ],
    teams: [],
    agentPrincipals: [
      { id: 'global-macro-agent', departmentId: 'global-macro', roleId: 'manager', displayName: 'Global Macro', active: true },
      { id: 'rates-agent', departmentId: 'rates', roleId: 'manager', displayName: 'Rates', active: true },
      { id: 'research-office-agent', departmentId: 'research-office', roleId: 'manager', displayName: 'Research Office', active: true },
      { id: 'research-office-synthesis-agent', departmentId: 'research-office', roleId: 'department-analysis', displayName: 'Research Office', active: true },
      { id: 'macro-synthesis-agent', departmentId: 'global-macro', roleId: 'department-analysis', displayName: 'Global Macro', active: true },
      { id: 'retired-synthesis-agent', departmentId: 'research-office', roleId: 'department-analysis', displayName: 'Retired', active: false },
      { id: 'verification-agent', departmentId: 'verification', roleId: 'governance', displayName: 'Verification', active: true },
      { id: 'devils-advocate-agent', departmentId: 'devils-advocate', roleId: 'governance', displayName: "Devil's Advocate", active: true },
      { id: 'retired-agent', departmentId: 'global-macro', roleId: 'manager', displayName: 'Retired', active: false },
    ],
    employees: [
      { id: 'cio', displayName: 'CIO', roleId: 'chief-investment-officer', departmentId: 'executive', seniority: 'chief' },
      { id: 'research-director', displayName: 'Research Director', roleId: 'manager', departmentId: 'research-office', seniority: 'head' },
      { id: 'macro-head', displayName: 'Macro Head', roleId: 'manager', departmentId: 'global-macro', seniority: 'head' },
      { id: 'rates-head', displayName: 'Rates Head', roleId: 'manager', departmentId: 'rates', seniority: 'head' },
      { id: 'verification-head', displayName: 'Verification Head', roleId: 'governance', departmentId: 'verification', seniority: 'head' },
      { id: 'da-head', displayName: 'DA Head', roleId: 'governance', departmentId: 'devils-advocate', seniority: 'head' },
    ],
    ...over,
  }
}

const org = organization()
const agent = (id: string) =>
  resolveActor(org, SEED, { kind: 'institutional-agent', agentPrincipalId: id })
const employee = (id: string) => resolveActor(org, SEED, { kind: 'employee', employeeId: id })
const system = () =>
  resolveActor(org, SEED, { kind: 'system', systemId: 'runner', reason: 'orchestration' })

const contribution = (departmentId: string): Mandate => ({
  kind: 'department-contribution',
  departmentId,
})
const verdict = (discipline: string): Mandate => ({ kind: 'governance-verdict', discipline })

describe('an agent resolves to its own institutional position', () => {
  it('carries the department and role the firm gave it', () => {
    const macro = agent('global-macro-agent')
    expect(macro.kind).toBe('institutional-agent')
    expect(macro.agentPrincipalId).toBe('global-macro-agent')
    expect(macro.departmentId).toBe('global-macro')
    expect(macro.roleFunction).toBe('manager')
    /* Never an employee. The two identities cannot be confused downstream. */
    expect(macro.employeeId).toBeNull()
  })

  it('carries the governance classification of its department', () => {
    expect(agent('verification-agent').departmentIsGovernance).toBe(true)
    expect(agent('global-macro-agent').departmentIsGovernance).toBe(false)
  })

  it('refuses a principal the firm does not hold', () => {
    expect(() => agent('nobody-agent')).toThrow()
  })

  it('refuses a retired principal', () => {
    /* Its past acts still resolve; it may not perform new ones. */
    expect(() => agent('retired-agent')).toThrow()
  })
})

describe('analytical desks act only for themselves', () => {
  it('lets Global Macro contribute to Global Macro', () => {
    expect(authorize(org, agent('global-macro-agent'), contribution('global-macro'))).toEqual({
      authorized: true,
      basis: 'member-of-owning-department',
    })
  })

  it('refuses Global Macro contributing for Rates', () => {
    expect(authorize(org, agent('global-macro-agent'), contribution('rates')).authorized).toBe(false)
  })

  it('lets Rates contribute to Rates', () => {
    expect(authorize(org, agent('rates-agent'), contribution('rates')).authorized).toBe(true)
  })

  it('lets Research Office contribute for Research Office', () => {
    expect(
      authorize(org, agent('research-office-agent'), contribution('research-office')).authorized,
    ).toBe(true)
  })

  it('refuses department-manager to an agent whose role was never granted it', () => {
    /*
     * `research-office-agent` holds a MANAGER-function role. That is exactly
     * the arrangement that must not be enough: the firm's seed already gives
     * `global-macro-agent` and `rates-agent` manager-function roles, and a rule
     * reading the function would have handed both of them authority over their
     * own desks the moment it shipped.
     */
    expect(org.roles.find((r) => r.id === 'manager')!.function).toBe('manager')
    expect(
      authorize(org, agent('research-office-agent'), {
        kind: 'department-manager',
        departmentId: 'research-office',
      }),
    ).toEqual({
      authorized: false,
      reason:
        'role "manager" does not hold department analysis authority; being a ' +
        'manager-function role is not the grant',
    })
  })
})

/**
 * The department-analysis capability, and everything it deliberately is not.
 *
 * `department-manager` covers three acts — evidence assembly, the managerial
 * synthesis, and submission to Verification. Its qualification used to be a
 * person, which no agent could ever satisfy. It is now a person OR an
 * authorised agent of the department, and "authorised" is an explicit grant on
 * the role rather than anything inferred from function, title or membership.
 */
describe('department-analysis authority is granted, never inferred', () => {
  const manage = (departmentId: string): Mandate => ({
    kind: 'department-manager',
    departmentId,
  })

  it("lets the granted Research Office agent hold its department authority", () => {
    expect(authorize(org, agent('research-office-synthesis-agent'), manage('research-office'))).toEqual({
      authorized: true,
      /*
       * Its own basis, not `manager-of-department`. A desk agent does not
       * manage a department; it holds the department's analytical authority,
       * and the ledger should say which sentence is true.
       */
      basis: 'holds-department-analysis-mandate',
    })
  })

  it('refuses the granted agent authority over another department', () => {
    /*
     * The grant is on the role and the role is shared, so this is the test that
     * proves the department check is doing work rather than being implied.
     */
    expect(
      authorize(org, agent('research-office-synthesis-agent'), manage('global-macro'))
        .authorized,
    ).toBe(false)
    expect(
      authorize(org, agent('macro-synthesis-agent'), manage('research-office')).authorized,
    ).toBe(false)
  })

  it('refuses an ordinary desk agent of the same department', () => {
    /*
     * Same department, active, manager-function role — and refused. Membership
     * is not management: a Research Office contributor must not acquire
     * synthesis authority by being in the room.
     */
    const contributor = agent('research-office-agent')
    expect(contributor.departmentId).toBe('research-office')
    expect(authorize(org, contributor, manage('research-office')).authorized).toBe(false)
  })

  it('refuses Global Macro and Rates, which hold manager-function roles', () => {
    /* The exact regression the explicit capability exists to prevent. */
    for (const [id, departmentId] of [
      ['global-macro-agent', 'global-macro'],
      ['rates-agent', 'rates'],
    ] as const) {
      expect(agent(id).roleFunction).toBe('manager')
      expect(authorize(org, agent(id), manage(departmentId)).authorized).toBe(false)
    }
  })

  it('refuses a retired principal before authority is even consulted', () => {
    expect(() => agent('retired-synthesis-agent')).toThrow()
  })

  it('refuses the system actor', () => {
    /* The orchestrator schedules the synthesis; it does not stand behind one. */
    expect(authorize(org, system(), manage('research-office')).authorized).toBe(false)
  })

  it('leaves the human manager exactly as authorised as before', () => {
    expect(authorize(org, employee('research-director'), manage('research-office'))).toEqual({
      authorized: true,
      basis: 'manager-of-department',
    })
    expect(
      authorize(org, employee('macro-head'), manage('research-office')).authorized,
    ).toBe(false)
  })

  it('still refuses convening, even to a role that holds both capabilities', () => {
    /*
     * The capability names department-level analytical acts. It is not
     * seniority, and it does not accumulate: convening is refused by ACTOR KIND
     * before either capability is read.
     */
    const role = org.roles.find((r) => r.id === 'department-analysis')!
    expect(role.canManageDepartmentAnalysis).toBe(true)
    expect(role.canConveneCommittee).toBe(true)
    expect(
      authorize(org, agent('research-office-synthesis-agent'), {
        kind: 'investment-committee-convenor',
        owningDepartmentId: 'research-office',
      }).authorized,
    ).toBe(false)
  })
})

describe('governance independence survives autonomy', () => {
  it('lets Verification issue a verification verdict', () => {
    expect(authorize(org, agent('verification-agent'), verdict('verification')).authorized).toBe(true)
  })

  it("refuses Verification issuing a Devil's Advocate verdict", () => {
    expect(authorize(org, agent('verification-agent'), verdict('challenge')).authorized).toBe(false)
  })

  it("lets Devil's Advocate issue its own verdict", () => {
    expect(authorize(org, agent('devils-advocate-agent'), verdict('challenge')).authorized).toBe(true)
  })

  it('refuses an analytical agent any governance verdict', () => {
    /* Rates is not a control function, autonomous or otherwise. */
    for (const discipline of ['verification', 'challenge', 'risk']) {
      expect(authorize(org, agent('rates-agent'), verdict(discipline)).authorized).toBe(false)
    }
  })
})

describe('the orchestrator is not a principal', () => {
  it('refuses a system actor any accountable desk act', () => {
    expect(authorize(org, system(), contribution('global-macro')).authorized).toBe(false)
    expect(authorize(org, system(), verdict('verification')).authorized).toBe(false)
  })

  it('still allows a genuine system operation', () => {
    expect(authorize(org, system(), { kind: 'system-operation' })).toEqual({
      authorized: true,
      basis: 'system-actor',
    })
  })
})

describe('convening remains a human authority in v1', () => {
  const convene: Mandate = {
    kind: 'investment-committee-convenor',
    owningDepartmentId: 'research-office',
  }

  it('refuses an agent whose role holds the convening capability', () => {
    /*
     * The trap this rule exists for. `research-office-agent` references the
     * manager role, that role holds `canConveneCommittee`, and it manages the
     * owning department — so BOTH branches of the convenor mandate would have
     * authorized it. The refusal is by actor kind, before either is reached.
     */
    const role = org.roles.find((r) => r.id === 'manager')!
    expect(role.canConveneCommittee).toBe(true)

    const decision = authorize(org, agent('research-office-agent'), convene)
    expect(decision.authorized).toBe(false)
  })

  it('refuses every institutional agent, whatever its desk', () => {
    for (const id of ['global-macro-agent', 'rates-agent', 'verification-agent']) {
      expect(authorize(org, agent(id), convene).authorized).toBe(false)
    }
  })

  it('separates authority over work from authority to call the committee', () => {
    /*
     * The positive half, and the point of the distinction: the same agent that
     * may not convene may still do Research Office's actual work.
     */
    const principal = agent('research-office-agent')
    expect(authorize(org, principal, contribution('research-office')).authorized).toBe(true)
    expect(authorize(org, principal, convene).authorized).toBe(false)
  })

  it('does not regress the human convenor', () => {
    expect(authorize(org, employee('cio'), convene)).toEqual({
      authorized: true,
      basis: 'holds-committee-convenor-mandate',
    })
    expect(authorize(org, employee('research-director'), convene).authorized).toBe(true)
  })
})
