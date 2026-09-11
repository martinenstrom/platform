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
  /**
   * A named Financial OS specialist, accountable for its own desk's acts.
   *
   * Neither a human nor a system process, and the distinction is the point: a
   * system actor performs technical work nobody is answerable for, while an
   * institutional agent IS answerable — for one department, under one mandate.
   *
   * The id is the principal, not the model. `global-macro-agent` stays the same
   * principal when the model behind it changes; which model produced a given
   * piece of work is recorded on the run, not here.
   */
  | { kind: 'institutional-agent'; agentPrincipalId: string }
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
  kind: 'employee' | 'institutional-agent' | 'system'
  employeeId: EmployeeId | null
  /**
   * Set on an institutional-agent act, null on every other.
   *
   * Never carries an employee id and an employee act never carries this: the
   * database enforces exactly one, so a reader can always tell which kind of
   * principal was accountable without inferring it from a name.
   */
  agentPrincipalId: string | null
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
  /**
   * Convene the investment committee that will answer a question.
   *
   * Carries the department that will OWN the resulting work, because convening
   * is not ownership: the committee is called for a case that belongs to a
   * desk, and that desk stays accountable for it afterwards.
   *
   * Satisfied by an explicit convenor capability, OR by the owning department's
   * own manager under the pre-existing rule — which is delegated to rather than
   * duplicated, so removing the capability leaves that rule behaving exactly as
   * it did before this mandate existed.
   */
  | { kind: 'investment-committee-convenor'; owningDepartmentId: string }
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
  /** An explicit, named capability to perform a department's analytical acts. */
  | 'holds-department-analysis-mandate'
  /** An explicit, named capability to convene a committee. Never seniority. */
  | 'holds-committee-convenor-mandate'
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
      agentPrincipalId: null,
      roleId: null,
      roleFunction: null,
      departmentId: null,
      departmentIsGovernance: null,
      departmentHandles: [],
      authentication: SYSTEM_ACTOR_AUTHENTICATION,
      organizationSeedVersion: seedVersion,
    }
  }

  if (asserted.kind === 'institutional-agent') {
    const principal = organization.agentPrincipals.find(
      (candidate) => candidate.id === asserted.agentPrincipalId,
    )
    if (!principal) throw new UnknownActorError(asserted.agentPrincipalId)
    /*
     * A retired principal cannot act. Its past acts still resolve — that is why
     * it is retired rather than deleted — but the firm has withdrawn it.
     */
    if (!principal.active) throw new UnknownActorError(asserted.agentPrincipalId)

    const department = organization.departments.find(
      (candidate) => candidate.id === principal.departmentId,
    )
    if (!department) throw new UnknownActorError(asserted.agentPrincipalId)
    const role = organization.roles.find(
      (candidate) => candidate.id === principal.roleId,
    )
    if (!role) throw new UnknownActorError(asserted.agentPrincipalId)

    /*
     * The same organisational snapshot an employee act carries, from the same
     * organisation. That is what lets `department-contribution` and
     * `governance-verdict` authorize an agent without either rule being
     * widened: the fields they read are present and authoritative.
     */
    return {
      kind: 'institutional-agent',
      employeeId: null,
      agentPrincipalId: principal.id,
      roleId: role.id,
      roleFunction: role.function,
      departmentId: department.id,
      departmentIsGovernance: department.isGovernance,
      departmentHandles: [...department.handles],
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
    agentPrincipalId: null,
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
  /*
   * An accountable principal — a human employee or a named institutional agent.
   * A system actor is neither: it performs technical work nobody answers for,
   * and it may not stand in for a desk, a manager, a control function or the
   * chief.
   */
  const accountable =
    (actor.kind === 'employee' && actor.employeeId) ||
    (actor.kind === 'institutional-agent' && actor.agentPrincipalId)
  if (!accountable) {
    return {
      authorized: false,
      reason:
        'this command changes institutional state and requires an accountable ' +
        'principal; a system actor cannot act in place of one',
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

      /*
       * A person: the org chart names them as the department's manager. This is
       * exactly the rule it has always been, and nothing about it moves.
       */
      if (actor.kind === 'employee') {
        return department.managerEmployeeId === actor.employeeId
          ? { authorized: true, basis: 'manager-of-department' }
          : {
              authorized: false,
              reason: `"${actor.employeeId}" does not manage "${mandate.departmentId}"`,
            }
      }

      /*
       * Or an authorised institutional agent of the department itself.
       *
       * THREE conditions, and each is load-bearing:
       *
       *   * the agent belongs to this department — a desk's analytical
       *     authority is over its own work, never another desk's;
       *   * its role holds `canManageDepartmentAnalysis` — an explicit grant,
       *     because the seed already gives agent principals manager-FUNCTION
       *     roles and a rule reading the function would have handed Macro and
       *     Rates authority nobody granted them;
       *   * the principal is active — enforced upstream in `resolveActor`,
       *     which refuses to resolve a retired one at all: it keeps resolving
       *     as a REFERENCE so its past acts stay readable, and performs none.
       *
       * Same-department membership alone is deliberately insufficient. An
       * ordinary Research Office contributor must not acquire manager-level
       * synthesis authority by being in the room.
       *
       * The basis is its own value rather than `manager-of-department`, so the
       * ledger can explain WHY an act was authorised. A desk agent does not
       * manage a department; it holds the department's analytical authority,
       * and those are different sentences about different principals.
       */
      if (actor.departmentId !== mandate.departmentId) {
        return {
          authorized: false,
          reason:
            `"${actor.agentPrincipalId}" acts for "${actor.departmentId}", not ` +
            `for "${mandate.departmentId}"`,
        }
      }
      const agentRole = organization.roles.find((r) => r.id === actor.roleId)
      if (!agentRole?.canManageDepartmentAnalysis) {
        return {
          authorized: false,
          reason:
            `role "${actor.roleId}" does not hold department analysis ` +
            `authority; being a manager-function role is not the grant`,
        }
      }
      return { authorized: true, basis: 'holds-department-analysis-mandate' }
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

    case 'investment-committee-convenor': {
      /*
       * Convening is a human authority in v1, and this is the rule rather than
       * the seed.
       *
       * An agent principal references an organisational role, and a role may
       * carry `canConveneCommittee`. Without this branch, an agent whose role
       * happened to hold it would inherit the authority to set the whole firm
       * working — an authority nobody granted it, arriving through a field
       * chosen for an entirely different reason. Relying on seed discipline to
       * prevent that would be relying on nobody making a reasonable-looking
       * mistake later.
       *
       * Authority over a desk's WORK and authority to CALL the committee are
       * separate, and only the first is delegated to agents today.
       */
      if (actor.kind !== 'employee') {
        return {
          authorized: false,
          reason:
            'convening an investment committee is a human operator authority; ' +
            `an actor of kind "${actor.kind}" may not call the committee`,
        }
      }

      const department = organization.departments.find(
        (d) => d.id === mandate.owningDepartmentId,
      )
      if (!department) {
        return {
          authorized: false,
          reason: `no department "${mandate.owningDepartmentId}"`,
        }
      }

      /*
       * The explicit capability answers first, and the basis says so. Where an
       * actor could be authorised two ways, the ledger should record the
       * authority actually exercised — a chair who convenes does so as chair,
       * not incidentally as somebody's line manager.
       */
      const role = organization.roles.find((r) => r.id === actor.roleId)
      if (role?.canConveneCommittee) {
        return { authorized: true, basis: 'holds-committee-convenor-mandate' }
      }

      /*
       * Otherwise the pre-existing rule, unchanged and unweakened: managing a
       * department is authority over that department's work.
       */
      return department.managerEmployeeId === actor.employeeId
        ? { authorized: true, basis: 'manager-of-department' }
        : {
            authorized: false,
            reason:
              `"${actor.employeeId}" neither convenes committees nor manages ` +
              `"${mandate.owningDepartmentId}"`,
          }
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
