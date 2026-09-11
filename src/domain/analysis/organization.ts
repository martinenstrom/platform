/**
 * The investment organization.
 *
 * Modelled as a FIRM, not as an agent system. That distinction is structural,
 * not cosmetic: an agent system has a list of agents and a router, while a firm
 * has departments that own work, managers who own departments, and a chief
 * investment officer who owns the organization. Work moves between departments;
 * it is not dispatched to functions.
 *
 * The practical test this design has to pass: **adding ESG Research, Credit
 * Research, Fixed Income, Commodities, FX, Emerging Markets, Options, Private
 * Equity or Venture Capital must be data, not code.** Every one of them is a
 * new `Department` record with responsibilities and a queue. Nothing in the
 * type system enumerates the departments that exist, and
 * `organization.test.ts` proves it by constructing one the codebase has never
 * heard of.
 *
 * Nothing here runs. These are contracts.
 */

/* ---------------------------------------------------------------- identity */

/** Stable identifiers. Kebab-case, assigned once, never reused. */
export type OrganizationId = string
export type DepartmentId = string
export type TeamId = string
export type EmployeeId = string
export type RoleId = string

/* -------------------------------------------------------------------- roles */

/**
 * What a role is FOR, in organizational terms.
 *
 * Deliberately about authority and reporting rather than about subject matter.
 * "Equity research" is a department; "specialist" is what its analysts are.
 * A new asset class adds departments, never a new function.
 */
export type RoleFunction =
  /** Produces evidence and claims within a discipline. */
  | 'specialist'
  /** Owns a department: aggregates, reconciles, prioritises, escalates. */
  | 'manager'
  /** Independent control. May block. Not subordinate to what it reviews. */
  | 'governance'
  /** Owns the organization. Consumes verified work; performs no analysis. */
  | 'executive'
  /** Turns approved analysis into published material. Adds no conclusions. */
  | 'editorial'

/**
 * A named responsibility, written down so a mandate is inspectable rather than
 * implied by a prompt.
 *
 * `interpretive` marks a responsibility whose output is a reading rather than a
 * measurement — Elliott Wave is the standing example, and it is required to be
 * labelled as such wherever it appears.
 */
export interface Responsibility {
  id: string
  summary: string
  /** True where the discipline yields interpretation, not objective fact. */
  interpretive: boolean
}

export interface Role {
  id: RoleId
  title: string
  function: RoleFunction
  /** What this role is accountable for. */
  responsibilities: readonly Responsibility[]
  /**
   * Whether the role may stop work reaching the CIO or the reader.
   *
   * Only `governance` roles may hold this, enforced by `buildRole`. A
   * specialist cannot grant itself a veto, and a manager's authority is to
   * prioritise and return work, not to block on correctness grounds.
   */
  canBlockPublication: boolean
  /**
   * Whether the role may convene an investment committee.
   *
   * Authority to CALL the committee that answers a question — not authority
   * over the work it produces, which stays with the department that owns the
   * case. Held explicitly rather than inferred from seniority, so it can be
   * granted and withdrawn without touching anything else.
   *
   * Only `executive` and `manager` roles may hold it, enforced below.
   * Commissioning the firm's work is a management act: a specialist who could
   * grant it to itself could set the whole firm working, and a control function
   * that held it would be commissioning the work it exists to check.
   *
   * Optional at the call site and normalised to `false` by `buildRole`, because
   * a capability nobody granted is a capability nobody holds. Every role that
   * predates this authority therefore keeps exactly the powers it had.
   */
  canConveneCommittee?: boolean
  /**
   * Whether the role may back an autonomous department-analysis principal.
   *
   * The three department-level analytical and workflow acts the
   * `department-manager` mandate covers: assembling evidence, the managerial
   * synthesis, and submitting the resulting revision to Verification. It is
   * **not** personnel authority, organisation administration, committee
   * convening or CIO authority, and holding it grants none of them.
   *
   * Explicit, because role FUNCTION is not a safe discriminator: the firm's
   * agent principals already hold manager-function roles (`head-of-macro`,
   * `head-of-rates`), and a rule reading `function === 'manager'` would have
   * given the Macro and Rates agents department authority nobody granted them,
   * through a field chosen for a different reason.
   *
   * Consulted only on the institutional-agent branch of `department-manager`.
   * A human manager's authority is unchanged and still comes from the org
   * chart: the department names them as its manager.
   *
   * Management roles only, enforced below. A specialist granting itself
   * department authority would collapse the desk's act into the manager's
   * judgement; the chief is excluded because the CIO consumes department
   * analysis and performs none.
   *
   * Optional at the call site and normalised to `false`, because a capability
   * nobody granted is a capability nobody holds.
   */
  canManageDepartmentAnalysis?: boolean
}

export function buildRole(role: Role): Role {
  if (role.canBlockPublication && role.function !== 'governance') {
    throw new Error(
      `Role "${role.id}" is ${role.function} and cannot block publication. ` +
        `Blocking authority belongs to independent governance functions.`,
    )
  }
  if (
    role.canConveneCommittee &&
    role.function !== 'executive' &&
    role.function !== 'manager'
  ) {
    throw new Error(
      `Role "${role.id}" is ${role.function} and cannot convene a committee. ` +
        `Commissioning the firm's work is an executive or management act.`,
    )
  }
  if (role.canManageDepartmentAnalysis && role.function !== 'manager') {
    throw new Error(
      `Role "${role.id}" is ${role.function} and cannot hold department ` +
        `analysis authority. Evidence assembly, managerial synthesis and ` +
        `submission to governance are a department manager's acts.`,
    )
  }
  if (role.function === 'governance' && !role.canBlockPublication) {
    throw new Error(
      `Governance role "${role.id}" must be able to block publication, ` +
        `otherwise it is advisory and not a control function.`,
    )
  }
  return Object.freeze({
    ...role,
    /* A capability nobody granted is a capability nobody holds. */
    canConveneCommittee: role.canConveneCommittee ?? false,
    canManageDepartmentAnalysis: role.canManageDepartmentAnalysis ?? false,
    responsibilities: Object.freeze(role.responsibilities),
  })
}

/* ---------------------------------------------------------------- employees */

/**
 * A human employee of the firm.
 *
 * **This used to say "an AI agent is an employee, not a feature."** That was
 * the right instinct — agents are institutional participants rather than
 * plumbing — expressed the wrong way. An agent is now an `AgentPrincipal`, held
 * beside the employees: it participates and is accountable, and it is still not
 * a person. Modelling one as an employee gave the firm staff with a seniority
 * nobody has and a reporting line to nobody.
 *
 * `seniority` exists because the behavioural specification calls for senior
 * professionals with 15-30 years of experience rather than assistants, and a
 * future prompt builder needs somewhere to read that from other than prose.
 */
export interface Employee {
  id: EmployeeId
  displayName: string
  roleId: RoleId
  departmentId: DepartmentId
  /** Present when the department is subdivided. */
  teamId?: TeamId
  /** The employee this one reports to. Absent only for the executive. */
  reportsTo?: EmployeeId
  seniority: 'analyst' | 'senior' | 'lead' | 'head' | 'chief'
}

/* -------------------------------------------------------- teams, departments */

export interface Team {
  id: TeamId
  name: string
  departmentId: DepartmentId
  leadEmployeeId: EmployeeId
}

/**
 * A department owns work.
 *
 * `handles` is what routes cases here — a list of open-ended discipline tags,
 * not an enum, which is the whole reason a new asset-class department needs no
 * code change.
 */
export interface Department {
  id: DepartmentId
  name: string
  /** The manager who owns it. Governance departments have one too. */
  managerEmployeeId: EmployeeId
  /** Free-form discipline tags used for routing. Deliberately not an enum. */
  handles: readonly string[]
  /**
   * True for the independent control functions: Devil's Advocate, Fact
   * Checker / Verification, Compliance, Chief Risk Officer.
   *
   * A first-class department with its own queue and workload, not a stage
   * bolted onto someone else's pipeline — which is what makes "who is
   * reviewing what" answerable from the organization rather than inferred.
   */
  isGovernance: boolean
}

/* ------------------------------------------------------------- organization */

/**
 * A named Financial OS specialist that may act for one desk.
 *
 * Held beside the employees and never among them. An agent is not staff: it has
 * no seniority, no reporting line and no person behind it. What it does have is
 * the institutional position the mandate engine reads — a department and a role
 * — which is why it can be authorized by the same rules without any of them
 * being widened.
 */
export interface AgentPrincipal {
  id: string
  departmentId: string
  roleId: string
  displayName: string
  /** Retired principals stay, so their past acts keep resolving. */
  active: boolean
}

export interface Organization {
  id: OrganizationId
  name: string
  /** The CIO. Owns the organization; performs no analysis. */
  chiefEmployeeId: EmployeeId
  roles: readonly Role[]
  departments: readonly Department[]
  teams: readonly Team[]
  employees: readonly Employee[]
  /**
   * The firm's autonomous specialists.
   *
   * A separate collection on purpose. Merging them into  would give
   * the firm fake staff in every roster and seat, and the human/agent boundary
   * is the thing this model exists to keep.
   */
  agentPrincipals: readonly AgentPrincipal[]
}

/* --------------------------------------------------------------- projections */

/**
 * Reporting line from an employee up to the chief.
 *
 * Returned as a path rather than a boolean so the UI can render "who reports to
 * whom" without walking the graph itself, and so a cycle is detectable.
 */
export function reportingLine(
  organization: Organization,
  from: EmployeeId,
): EmployeeId[] {
  const byId = new Map(organization.employees.map((e) => [e.id, e]))
  const path: EmployeeId[] = []
  const seen = new Set<EmployeeId>()

  let current = byId.get(from)
  while (current) {
    if (seen.has(current.id)) {
      throw new Error(`Reporting cycle detected at "${current.id}"`)
    }
    seen.add(current.id)
    path.push(current.id)
    if (!current.reportsTo) break
    current = byId.get(current.reportsTo)
  }
  return path
}

export function roleOf(organization: Organization, employeeId: EmployeeId): Role {
  const employee = organization.employees.find((e) => e.id === employeeId)
  if (!employee) throw new Error(`Unknown employee "${employeeId}"`)
  const role = organization.roles.find((r) => r.id === employee.roleId)
  if (!role) throw new Error(`Employee "${employeeId}" holds unknown role`)
  return role
}

export function departmentsHandling(
  organization: Organization,
  discipline: string,
): Department[] {
  return organization.departments.filter((d) => d.handles.includes(discipline))
}

export function governanceDepartments(organization: Organization): Department[] {
  return organization.departments.filter((d) => d.isGovernance)
}

/**
 * Validates the firm's structure.
 *
 * Checks the invariants a real organization chart has and a list of agents does
 * not: every employee has a known role and department, every department has a
 * manager who works there, exactly one chief, the chief reports to nobody, and
 * no reporting cycles.
 */
export function validateOrganization(organization: Organization): void {
  const employees = new Map(organization.employees.map((e) => [e.id, e]))
  const roles = new Map(organization.roles.map((r) => [r.id, r]))
  const departments = new Map(organization.departments.map((d) => [d.id, d]))

  for (const employee of organization.employees) {
    if (!roles.has(employee.roleId)) {
      throw new Error(`Employee "${employee.id}" holds unknown role`)
    }
    if (!departments.has(employee.departmentId)) {
      throw new Error(`Employee "${employee.id}" is in an unknown department`)
    }
    if (employee.reportsTo && !employees.has(employee.reportsTo)) {
      throw new Error(`Employee "${employee.id}" reports to an unknown employee`)
    }
  }

  for (const department of organization.departments) {
    const manager = employees.get(department.managerEmployeeId)
    if (!manager) {
      throw new Error(`Department "${department.id}" has an unknown manager`)
    }
    if (manager.departmentId !== department.id) {
      throw new Error(
        `Department "${department.id}" is managed by someone in another department`,
      )
    }
  }

  const chief = employees.get(organization.chiefEmployeeId)
  if (!chief) throw new Error('Organization has no chief')
  if (chief.reportsTo) throw new Error('The chief must not report to anyone')
  if (roles.get(chief.roleId)?.function !== 'executive') {
    throw new Error('The chief must hold an executive role')
  }

  // Walking every line also proves the graph is acyclic.
  for (const employee of organization.employees) {
    const line = reportingLine(organization, employee.id)
    if (line[line.length - 1] !== organization.chiefEmployeeId) {
      throw new Error(`Employee "${employee.id}" does not report up to the chief`)
    }
  }
}
