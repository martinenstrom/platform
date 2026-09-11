/**
 * Who may do what.
 *
 * The property that matters most here is that **no rule names a department**.
 * The last group proves it by adding a control function the codebase has never
 * heard of and watching it work — the same test the organization design has
 * carried since Phase A, applied to authority.
 */

import { describe, expect, it } from 'vitest'
import {
  authorize,
  resolveActor,
  UnknownActorError,
  type ActorSnapshot,
  type Mandate,
  type Organization,
} from './index'
import { buildRole } from './organization'

const SEED = '1'

/** A small firm with the shape the seed has: a chief, a desk, a control. */
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
      }),
      buildRole({
        id: 'head-of-macro',
        title: 'Head of Macro',
        function: 'manager',
        responsibilities: [],
        canBlockPublication: false,
      }),
      buildRole({
        id: 'macro-analyst',
        title: 'Macro Analyst',
        function: 'specialist',
        responsibilities: [],
        canBlockPublication: false,
      }),
      buildRole({
        id: 'head-of-verification',
        title: 'Head of Verification',
        function: 'governance',
        responsibilities: [],
        canBlockPublication: true,
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
        id: 'global-macro',
        name: 'Global Macro',
        managerEmployeeId: 'macro-head',
        handles: ['macro', 'rates'],
        isGovernance: false,
      },
      {
        id: 'verification',
        name: 'Verification',
        managerEmployeeId: 'verification-head',
        handles: ['verification'],
        isGovernance: true,
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
        id: 'macro-head',
        displayName: 'Head of Macro',
        roleId: 'head-of-macro',
        departmentId: 'global-macro',
        reportsTo: 'cio',
        seniority: 'head',
      },
      {
        id: 'macro-analyst',
        displayName: 'Analyst',
        roleId: 'macro-analyst',
        departmentId: 'global-macro',
        reportsTo: 'macro-head',
        seniority: 'analyst',
      },
      {
        id: 'verification-head',
        displayName: 'Head of Verification',
        roleId: 'head-of-verification',
        departmentId: 'verification',
        reportsTo: 'cio',
        seniority: 'head',
      },
    ],
    ...over,
  }
}

const actorFor = (employeeId: string, org = organization()): ActorSnapshot =>
  resolveActor(org, SEED, { kind: 'employee', employeeId })

const systemActor = (org = organization()): ActorSnapshot =>
  resolveActor(org, SEED, { kind: 'system', systemId: 'scheduler', reason: 'sweep' })

/* --------------------------------------------------------------- resolution */

describe('resolving an actor', () => {
  it('reads role and department from the organization', async () => {
    const actor = actorFor('verification-head')
    expect(actor.roleId).toBe('head-of-verification')
    expect(actor.departmentId).toBe('verification')
    expect(actor.departmentIsGovernance).toBe(true)
    expect(actor.departmentHandles).toEqual(['verification'])
  })

  it('refuses an employee the organization has never heard of', () => {
    expect(() => actorFor('impostor')).toThrow(UnknownActorError)
  })

  it('never reports an authenticated user', () => {
    // TD-8 is open. Anything else here would be a claim the system cannot make.
    expect(actorFor('cio').authentication).toBe('system-asserted')
    expect(systemActor().authentication).toBe('system-asserted')
  })

  it('records which seeded organization it resolved against', () => {
    // So a later structural change cannot rewrite the authority a past command
    // ran under.
    expect(actorFor('cio').organizationSeedVersion).toBe(SEED)
  })

  it('gives a system actor no employee, role or department', () => {
    const actor = systemActor()
    expect(actor.employeeId).toBeNull()
    expect(actor.roleId).toBeNull()
    expect(actor.departmentId).toBeNull()
  })
})

/* ------------------------------------------------------------ authorization */

describe('governance verdicts', () => {
  const verify: Mandate = { kind: 'governance-verdict', discipline: 'verification' }

  it('accepts the control function that handles the discipline', () => {
    const decision = authorize(organization(), actorFor('verification-head'), verify)
    expect(decision).toEqual({
      authorized: true,
      basis: 'governance-department-handles-discipline',
    })
  })

  it('refuses a specialist', () => {
    // A desk cannot grant itself a veto.
    const decision = authorize(organization(), actorFor('macro-analyst'), verify)
    expect(decision.authorized).toBe(false)
  })

  it('refuses a control function that does not handle this discipline', () => {
    const decision = authorize(organization(), actorFor('verification-head'), {
      kind: 'governance-verdict',
      discipline: 'risk',
    })
    expect(decision.authorized).toBe(false)
  })

  it('refuses a system actor outright', () => {
    // The system may schedule the work. It is not Verification.
    const decision = authorize(organization(), systemActor(), verify)
    expect(decision.authorized).toBe(false)
    expect(decision).toMatchObject({ authorized: false })
  })

  it('accepts a control function the codebase has never heard of', () => {
    /*
     * The whole point of deriving authority from the graph. A fifth governance
     * department is data — no rule names a department id, so nothing needs to
     * change for `esg-assurance` to be able to block.
     */
    const org = organization({
      roles: [
        ...organization().roles,
        buildRole({
          id: 'head-of-esg-assurance',
          title: 'Head of ESG Assurance',
          function: 'governance',
          responsibilities: [],
          canBlockPublication: true,
        }),
      ],
      departments: [
        ...organization().departments,
        {
          id: 'esg-assurance',
          name: 'ESG Assurance',
          managerEmployeeId: 'esg-head',
          handles: ['esg-assurance'],
          isGovernance: true,
        },
      ],
      employees: [
        ...organization().employees,
        {
          id: 'esg-head',
          displayName: 'Head of ESG Assurance',
          roleId: 'head-of-esg-assurance',
          departmentId: 'esg-assurance',
          reportsTo: 'cio',
          seniority: 'head',
        },
      ],
    })

    const decision = authorize(org, actorFor('esg-head', org), {
      kind: 'governance-verdict',
      discipline: 'esg-assurance',
    })
    expect(decision.authorized).toBe(true)
  })
})

describe('departmental work', () => {
  it('lets a department contribute its own work', () => {
    expect(
      authorize(organization(), actorFor('macro-analyst'), {
        kind: 'department-contribution',
        departmentId: 'global-macro',
      }),
    ).toEqual({ authorized: true, basis: 'member-of-owning-department' })
  })

  it('refuses a department contributing another department’s work', () => {
    expect(
      authorize(organization(), actorFor('macro-analyst'), {
        kind: 'department-contribution',
        departmentId: 'verification',
      }).authorized,
    ).toBe(false)
  })

  it('lets the manager act for the department they manage', () => {
    expect(
      authorize(organization(), actorFor('macro-head'), {
        kind: 'department-manager',
        departmentId: 'global-macro',
      }),
    ).toEqual({ authorized: true, basis: 'manager-of-department' })
  })

  it('refuses a member who is not the manager', () => {
    expect(
      authorize(organization(), actorFor('macro-analyst'), {
        kind: 'department-manager',
        departmentId: 'global-macro',
      }).authorized,
    ).toBe(false)
  })

  it('lets the proposing department act on its own thesis', () => {
    expect(
      authorize(organization(), actorFor('macro-analyst'), {
        kind: 'thesis-owner',
        proposedByDepartmentId: 'global-macro',
      }),
    ).toEqual({ authorized: true, basis: 'member-of-proposing-department' })
  })

  it('refuses another department acting on it', () => {
    expect(
      authorize(organization(), actorFor('verification-head'), {
        kind: 'thesis-owner',
        proposedByDepartmentId: 'global-macro',
      }).authorized,
    ).toBe(false)
  })
})

describe('the decision', () => {
  it('accepts the chief', () => {
    expect(
      authorize(organization(), actorFor('cio'), { kind: 'chief-decision' }),
    ).toEqual({
      authorized: true,
      basis: 'organization-chief',
    })
  })

  it('refuses a governance head', () => {
    // Governance may block. It does not decide.
    expect(
      authorize(organization(), actorFor('verification-head'), { kind: 'chief-decision' })
        .authorized,
    ).toBe(false)
  })

  it('refuses the system', () => {
    expect(
      authorize(organization(), systemActor(), { kind: 'chief-decision' }).authorized,
    ).toBe(false)
  })
})

describe('system operations', () => {
  it('accept a system actor', () => {
    expect(
      authorize(organization(), systemActor(), { kind: 'system-operation' }),
    ).toEqual({ authorized: true, basis: 'system-actor' })
  })

  it('refuse an employee', () => {
    // Technical operations are not institutional acts, and vice versa.
    expect(
      authorize(organization(), actorFor('cio'), { kind: 'system-operation' }).authorized,
    ).toBe(false)
  })
})

describe('the basis is recorded, not re-derived', () => {
  it('names why the actor was allowed', () => {
    /*
     * "Verification issued this" is weaker than "the employee's department was
     * a governance function handling verification at the time", and only the
     * second survives a reorganization — which is why the command stores it.
     */
    const decision = authorize(organization(), actorFor('verification-head'), {
      kind: 'governance-verdict',
      discipline: 'verification',
    })
    expect(decision).toHaveProperty('basis')
  })
})
