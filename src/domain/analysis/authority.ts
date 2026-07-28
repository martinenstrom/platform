/**
 * Who may do what, and on whose authority.
 *
 * Domain rather than application: "only Verification may issue a verification
 * verdict" is a rule about the firm, expressible over the organization graph
 * with no I/O. Putting it in a service would make it untestable without a
 * container, and would put an organizational rule somewhere the organization
 * is not.
 *
 * ## Nothing here is hardcoded to a department
 *
 * A governance verdict requires that the actor's department **handles the
 * discipline** and **is a governance department** — both read from the graph.
 * No rule names `verification` or `risk`, which is what keeps the promise that
 * adding a fifth control function is data rather than code.
 *
 * ## Authority is snapshotted, not re-derived
 *
 * `authorize` returns the BASIS on which it decided, and that basis is stored
 * on the command. Re-deriving historical authority from the current
 * organization would mean an employee moving department silently rewrites who
 * was allowed to do what last year.
 */

import type {
  Department,
  Employee,
  EmployeeId,
  Organization,
  Role,
  RoleFunction,
} from './organization'

/* ------------------------------------------------------------------ actors */

/**
 * What the caller claims.
 *
 * Deliberately minimal: an employee id and nothing else. A caller that could
 * assert its own department could assert that it is Verification, which would
 * make authorization advisory.
 */
export type AssertedActor =
  | { kind: 'employee'; employeeId: EmployeeId }
  | { kind: 'system'; systemId: string; reason: string }

/**
 * Who INITIATED the evaluation, which is not who is accountable for it.
 *
 * The orchestrator may decide that the next step is due; it is not the
 * verifier. Conflating the two would let the activity feed say "the system
 * verified this", which is both false and the kind of false that is hard to
 * notice.
 */
export type CommandInitiator =
  | { kind: 'employee'; employeeId: EmployeeId }
  | { kind: 'orchestrator'; orchestratorId: string }
  | { kind: 'system'; systemId: string }
  | { kind: 'recorded-provider'; providerId: string }

/**
 * What the organization says, captured at execution time.
 *
 * Stored on the command, not reconstructed later. If the employee moves
 * department in March, a command executed in February must still show the
 * authority it actually ran under.
 */
export interface ActorSnapshot {
  kind: 'employee' | 'system'
  employeeId: EmployeeId | null
  roleId: string | null
  roleFunction: RoleFunction | null
  departmentId: string | null
  /** Whether the department was a control function at the time. */
  departmentIsGovernance: boolean | null
  /** The disciplines the department handled at the time. */
  departmentHandles: readonly string[]
  /** Never `authenticated` while TD-8 is open. */
  authentication: 'system-asserted'
  /** Which seeded organization this was resolved against. */
  organizationSeedVersion: string
}

export const SYSTEM_ACTOR_AUTHENTICATION = 'system-asserted' as const

/* ---------------------------------------------------------------- mandates */

/**
 * The authority a command requires.
 *
 * A closed set on purpose: a command that needs authority nobody has thought
 * about should not typecheck.
 */
export type Mandate =
  /** Issue a formal governance verdict in a named discipline. */
  | { kind: 'governance-verdict'; discipline: string }
  /** Contribute work a department owes. */
  | { kind: 'department-contribution'; departmentId: string }
  /** Act as the manager who owns a department. */
  | { kind: 'department-manager'; departmentId: string }
  /** Act for the department that proposed a thesis. */
  | { kind: 'thesis-owner'; proposedByDepartmentId: string }
  /** Record the organization's decision. */
  | { kind: 'chief-decision' }
  /** Open work, which any employee of the firm may do. */
  | { kind: 'any-employee' }
  /** Technical operations with no institutional effect. */
  | { kind: 'system-operation' }

export type AuthorizationBasis =
  | 'governance-department-handles-discipline'
  | 'member-of-owning-department'
  | 'manager-of-department'
  | 'member-of-proposing-department'
  | 'organization-chief'
  | 'employee-of-the-firm'
  | 'system-actor'

export type AuthorizationDecision =
  { authorized: true; basis: AuthorizationBasis } | { authorized: false; reason: string }

/* -------------------------------------------------------------- resolution */

export class UnknownActorError extends Error {
  constructor(readonly employeeId: string) {
    super(
      `"${employeeId}" is not an employee of this organization. Actors are ` +
        `resolved against the seeded organization; a caller cannot introduce one.`,
    )
    this.name = 'UnknownActorError'
  }
}

function departmentOf(organization: Organization, employee: Employee): Department {
  const department = organization.departments.find((d) => d.id === employee.departmentId)
  if (!department) {
    throw new UnknownActorError(employee.id)
  }
  return department
}

function roleFor(organization: Organization, employee: Employee): Role {
  const role = organization.roles.find((r) => r.id === employee.roleId)
  if (!role) throw new UnknownActorError(employee.id)
  return role
}

/**
 * Turns an asserted actor into what the organization says about them.
 *
 * The caller supplies an employee id; **role and department are looked up**,
 * never accepted. A system actor resolves to a snapshot with no employee,
 * which is what stops it standing in for one.
 */
export function resolveActor(
  organization: Organization,
  seedVersion: string,
  asserted: AssertedActor,
): ActorSnapshot {
  if (asserted.kind === 'system') {
    return {
      kind: 'system',
      employeeId: null,
      roleId: null,
      roleFunction: null,
      departmentId: null,
      departmentIsGovernance: null,
      departmentHandles: [],
      authentication: SYSTEM_ACTOR_AUTHENTICATION,
      organizationSeedVersion: seedVersion,
    }
  }

  const employee = organization.employees.find((e) => e.id === asserted.employeeId)
  if (!employee) throw new UnknownActorError(asserted.employeeId)

  const department = departmentOf(organization, employee)
  const role = roleFor(organization, employee)

  return {
    kind: 'employee',
    employeeId: employee.id,
    roleId: role.id,
    roleFunction: role.function,
    departmentId: department.id,
    departmentIsGovernance: department.isGovernance,
    departmentHandles: [...department.handles],
    authentication: SYSTEM_ACTOR_AUTHENTICATION,
    organizationSeedVersion: seedVersion,
  }
}

/* ----------------------------------------------------------- authorization */

/**
 * Whether this actor may execute a command requiring this mandate.
 *
 * Returns the basis rather than a boolean so the command can record **why** it
 * was allowed. "Verification issued this" is a weaker statement than
 * "the employee's department was a governance function handling verification
 * at the time", and only the second survives a reorganization.
 */
export function authorize(
  organization: Organization,
  actor: ActorSnapshot,
  mandate: Mandate,
): AuthorizationDecision {
  if (mandate.kind === 'system-operation') {
    return actor.kind === 'system'
      ? { authorized: true, basis: 'system-actor' }
      : { authorized: false, reason: 'a system operation requires a system actor' }
  }

  /*
   * Everything below requires an accountable employee. A system actor may
   * initiate evaluation and perform technical work; it may not stand in for
   * the department, manager, control function or chief that the institutional
   * model holds responsible.
   */
  if (actor.kind !== 'employee' || !actor.employeeId) {
    return {
      authorized: false,
      reason:
        'this command changes institutional state and requires an accountable ' +
        'employee; a system actor cannot act in place of one',
    }
  }

  switch (mandate.kind) {
    case 'any-employee':
      return { authorized: true, basis: 'employee-of-the-firm' }

    case 'governance-verdict': {
      if (!actor.departmentIsGovernance) {
        return {
          authorized: false,
          reason: `department "${actor.departmentId}" is not a control function`,
        }
      }
      if (actor.roleFunction !== 'governance') {
        return {
          authorized: false,
          reason: `role "${actor.roleId}" is not a governance role`,
        }
      }
      if (!actor.departmentHandles.includes(mandate.discipline)) {
        return {
          authorized: false,
          reason:
            `department "${actor.departmentId}" does not handle ` +
            `"${mandate.discipline}"`,
        }
      }
      return { authorized: true, basis: 'governance-department-handles-discipline' }
    }

    case 'department-contribution':
      return actor.departmentId === mandate.departmentId
        ? { authorized: true, basis: 'member-of-owning-department' }
        : {
            authorized: false,
            reason: `work is owed by "${mandate.departmentId}", not "${actor.departmentId}"`,
          }

    case 'department-manager': {
      const department = organization.departments.find(
        (d) => d.id === mandate.departmentId,
      )
      if (!department) {
        return { authorized: false, reason: `no department "${mandate.departmentId}"` }
      }
      return department.managerEmployeeId === actor.employeeId
        ? { authorized: true, basis: 'manager-of-department' }
        : {
            authorized: false,
            reason: `"${actor.employeeId}" does not manage "${mandate.departmentId}"`,
          }
    }

    case 'thesis-owner':
      return actor.departmentId === mandate.proposedByDepartmentId
        ? { authorized: true, basis: 'member-of-proposing-department' }
        : {
            authorized: false,
            reason:
              `the thesis was proposed by "${mandate.proposedByDepartmentId}", ` +
              `not "${actor.departmentId}"`,
          }

    case 'chief-decision':
      if (actor.employeeId !== organization.chiefEmployeeId) {
        return { authorized: false, reason: 'only the chief records a decision' }
      }
      return actor.roleFunction === 'executive'
        ? { authorized: true, basis: 'organization-chief' }
        : { authorized: false, reason: 'the chief must hold an executive role' }
  }
}

/** The discipline each control function's verdict requires. */
export const GOVERNANCE_DISCIPLINE = {
  verification: 'verification',
  'devils-advocate': 'challenge',
  risk: 'risk',
  compliance: 'compliance',
} as const

export type GovernanceKind = keyof typeof GOVERNANCE_DISCIPLINE
