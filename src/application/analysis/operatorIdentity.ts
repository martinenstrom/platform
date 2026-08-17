/**
 * Who the operator can act as.
 *
 * **This is operator identity, not authentication.** Nothing here proves that
 * the person at the keyboard is the employee they select, and nothing built on
 * it may claim otherwise. What it does is make every institutional act name a
 * real employee of the seeded firm, so the mandate checks the commands already
 * perform are genuinely load-bearing rather than decorative: a desk cannot
 * accept another desk's work, and selecting the wrong person produces a real
 * refusal from the institution rather than a permitted act with a misleading
 * signature.
 *
 * Real authentication is TD-8 and is a different thing entirely. The record
 * already distinguishes them — `authentication` stays `system-asserted` — and
 * the interface is required to say so where a person makes the choice.
 *
 * ## Derived from the organization, like everything else
 *
 * A projection of the seeded firm, computed on read. There is deliberately no
 * user table, no operator list and no second employee registry: the people who
 * can act are the people who work here, and a separate list would be free to
 * disagree with the organization the commands authorize against.
 *
 * ## Everyone is offered, and the institution decides
 *
 * The list is not filtered to whoever may act on a particular piece of work.
 * Filtering it would put an authority decision in the layer that renders the
 * dropdown, and the mandate would then be checked twice by two different rules
 * — one of which nobody wrote down. The surface may state which desk owns the
 * work, because that is a fact it can read; what it may not do is decide who is
 * allowed to judge it.
 */

import type { Organization, RoleFunction } from '~/domain/analysis'

export interface OperatorIdentity {
  employeeId: string
  displayName: string
  /** The role's title, so two people in one department are distinguishable. */
  roleTitle: string
  /** What the role is FOR: specialist, manager, governance, executive, editorial. */
  roleFunction: RoleFunction
  seniority: string
  departmentId: string
  departmentName: string
  /** True for the independent control functions. */
  isGovernance: boolean
}

/**
 * Every employee, with the desk they work at.
 *
 * Ordered by department name, then display name — a list a person scans rather
 * than one a machine joins, and stable so the selection does not move under a
 * cursor between reads.
 */
export function operatorIdentities(
  organization: Organization,
): readonly OperatorIdentity[] {
  const departments = new Map(organization.departments.map((d) => [d.id, d]))
  const roles = new Map(organization.roles.map((r) => [r.id, r]))

  const identities: OperatorIdentity[] = []
  for (const employee of organization.employees) {
    const department = departments.get(employee.departmentId)
    const role = roles.get(employee.roleId)
    /*
     * `validateOrganization` refuses an employee with an unknown role or
     * department, so neither can happen against a seeded firm. Skipped rather
     * than substituted anyway: an operator identity with an invented department
     * would sign institutional acts with a desk that does not exist.
     */
    if (!department || !role) continue

    identities.push({
      employeeId: employee.id,
      displayName: employee.displayName,
      roleTitle: role.title,
      roleFunction: role.function,
      seniority: employee.seniority,
      departmentId: department.id,
      departmentName: department.name,
      isGovernance: department.isGovernance,
    })
  }

  return identities.sort(
    (a, b) =>
      compare(a.departmentName, b.departmentName) || compare(a.displayName, b.displayName),
  )
}

/** Byte order, not locale order: the list must not reorder by host collation. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
