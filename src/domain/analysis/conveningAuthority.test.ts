/**
 * Who may convene an investment committee.
 *
 * The Chairman asks the firm a question and convenes the committee that answers
 * it. That is a real institutional authority and it is recorded as one: the
 * Chairman is the actor, under a mandate they actually hold.
 *
 * ## What this authority is NOT
 *
 * It is not ownership of the analytical work. Convening a committee on a case
 * Research Office owns leaves Research Office accountable for it — the desk
 * that answers the question does not change because somebody else asked it.
 *
 * It is also not an executive exemption. The mandate is one named capability on
 * a role, resolved the same way every other mandate is, and an actor who does
 * not hold it is refused however senior they are.
 *
 * ## The existing protection is delegated to, not replaced
 *
 * A department's manager could always instantiate a playbook for a case their
 * department owns, and still can. The new mandate authorises **either** that
 * manager **or** an explicit convenor, so removing the convenor capability
 * leaves the original rule behaving exactly as it did.
 */

import { describe, expect, it } from 'vitest'
import {
  authorize,
  type ActorSnapshot,
  type Mandate,
  type Organization,
} from './index'
import { buildRole } from './organization'

const SEED = '1'

/**
 * A firm with a chair who may convene, and managers who may not — except over
 * their own department's work, which is the pre-existing rule.
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
        canConveneCommittee: false,
      }),
      buildRole({
        id: 'specialist',
        title: 'Specialist',
        function: 'specialist',
        responsibilities: [],
        canBlockPublication: false,
        canConveneCommittee: false,
      }),
    ],
    departments: [
      {
        id: 'executive',
        name: 'Executive',
        managerEmployeeId: 'cio',
        handles: [],
        isGovernance: false,
      },
      {
        id: 'research-office',
        name: 'Research Office',
        managerEmployeeId: 'research-director',
        handles: ['aggregation'],
        isGovernance: false,
      },
      {
        id: 'global-macro',
        name: 'Global Macro',
        managerEmployeeId: 'macro-head',
        handles: ['macro'],
        isGovernance: false,
      },
    ],
    teams: [],
    agentPrincipals: [],
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
        seniority: 'head',
      },
      {
        id: 'macro-head',
        displayName: 'Head of Macro',
        roleId: 'manager',
        departmentId: 'global-macro',
        seniority: 'head',
      },
      {
        id: 'macro-analyst',
        displayName: 'Analyst',
        roleId: 'specialist',
        departmentId: 'global-macro',
        seniority: 'analyst',
      },
    ],
    ...over,
  }
}

const actor = (
  employeeId: string,
  roleId: string,
  departmentId: string,
): ActorSnapshot => ({
  kind: 'employee',
  employeeId,
  agentPrincipalId: null,
  roleId,
  roleFunction:
    roleId === 'chief-investment-officer'
      ? 'executive'
      : roleId === 'manager'
        ? 'manager'
        : 'specialist',
  departmentId,
  departmentIsGovernance: false,
  departmentHandles: [],
  authentication: 'system-asserted',
  organizationSeedVersion: SEED,
})

/** Convening a committee for a case Research Office owns. */
const convene: Mandate = {
  kind: 'investment-committee-convenor',
  owningDepartmentId: 'research-office',
}

describe('the authority to convene an investment committee', () => {
  it('lets the Chairman convene a case another desk owns', () => {
    const decision = authorize(
      organization(),
      actor('cio', 'chief-investment-officer', 'executive'),
      convene,
    )
    expect(decision).toEqual({
      authorized: true,
      basis: 'holds-committee-convenor-mandate',
    })
  })

  it('still lets the owning department manager convene, as it always did', () => {
    const decision = authorize(
      organization(),
      actor('research-director', 'manager', 'research-office'),
      convene,
    )
    // The pre-existing rule, reached through the new mandate unchanged.
    expect(decision).toEqual({ authorized: true, basis: 'manager-of-department' })
  })

  it('refuses an unrelated employee', () => {
    const decision = authorize(
      organization(),
      actor('macro-analyst', 'specialist', 'global-macro'),
      convene,
    )
    expect(decision.authorized).toBe(false)
  })

  it('refuses the manager of another department', () => {
    /*
     * The protection this must not weaken. Managing Global Macro is authority
     * over Global Macro's work, not over a case Research Office owns.
     */
    const decision = authorize(
      organization(),
      actor('macro-head', 'manager', 'global-macro'),
      convene,
    )
    expect(decision.authorized).toBe(false)
  })

  it('refuses the Chairman once the convening capability is taken away', () => {
    const withoutChair = organization({
      roles: organization().roles.map((role) =>
        role.id === 'chief-investment-officer'
          ? buildRole({ ...role, canConveneCommittee: false })
          : role,
      ),
    })
    const decision = authorize(
      withoutChair,
      actor('cio', 'chief-investment-officer', 'executive'),
      convene,
    )
    // Seniority is not authority. Removing the capability removes the power.
    expect(decision.authorized).toBe(false)
  })

  it('refuses when the owning department does not exist', () => {
    const decision = authorize(
      organization(),
      actor('research-director', 'manager', 'research-office'),
      { kind: 'investment-committee-convenor', owningDepartmentId: 'nowhere' },
    )
    expect(decision.authorized).toBe(false)
  })

  it('names the convenor basis only when the capability is what authorised it', () => {
    /*
     * A chair who ALSO manages the owning department must not report the
     * capability as the basis if the manager rule would have sufficed — the
     * ledger should say which authority was actually exercised.
     */
    const chairManagesResearch = organization({
      departments: organization().departments.map((d) =>
        d.id === 'research-office' ? { ...d, managerEmployeeId: 'cio' } : d,
      ),
    })
    const decision = authorize(
      chairManagesResearch,
      actor('cio', 'chief-investment-officer', 'executive'),
      convene,
    )
    expect(decision).toEqual({
      authorized: true,
      basis: 'holds-committee-convenor-mandate',
    })
  })
})

describe('who may hold the convening capability at all', () => {
  it('refuses to build a specialist role that can convene', () => {
    // Convening is a management or executive act. A specialist granting itself
    // the power to commission the whole firm's work is the failure this stops.
    expect(() =>
      buildRole({
        id: 'rogue',
        title: 'Analyst',
        function: 'specialist',
        responsibilities: [],
        canBlockPublication: false,
        canConveneCommittee: true,
      }),
    ).toThrow()
  })

  it('refuses to build a governance role that can convene', () => {
    // A control function checks the work; it does not commission it.
    expect(() =>
      buildRole({
        id: 'rogue-governance',
        title: 'Verifier',
        function: 'governance',
        responsibilities: [],
        canBlockPublication: true,
        canConveneCommittee: true,
      }),
    ).toThrow()
  })

  it('allows an executive role to convene', () => {
    expect(() =>
      buildRole({
        id: 'chair',
        title: 'Chair',
        function: 'executive',
        responsibilities: [],
        canBlockPublication: false,
        canConveneCommittee: true,
      }),
    ).not.toThrow()
  })
})
