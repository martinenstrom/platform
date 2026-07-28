/**
 * Reading the seeded organization.
 *
 * Five small tables, about sixty rows, changing only by migration — so it is
 * loaded once per process and cached on the seed checksum. A changed checksum
 * means a migration changed the firm and the cache reloads; nothing else can
 * invalidate it, because nothing else can change it.
 */

import {
  buildRole,
  validateOrganization,
  type Department,
  type Employee,
  type Organization,
  type Responsibility,
  type Role,
  type RoleFunction,
  type Team,
} from '~/domain/analysis'
import {
  OrganizationNotSeededError,
  type OrganizationReader,
  type SeededOrganization,
} from '~/application/analysis/organizationReader'
import { MalformedRowError } from '~/application/analysis/repositories'
import { seal } from '../seal'
import { catalog, one, run, type Queryable, type SqlContext } from './sql'

export const ORGANIZATION_SQL = catalog({
  seed: `SELECT version, checksum FROM analysis.organization_seed_versions
         ORDER BY version DESC LIMIT 1`,

  organization: `SELECT id, name, chief_employee_id FROM analysis.organizations
                 WHERE tenant_id = $1`,

  roles: `SELECT id, title, function, can_block_publication FROM analysis.roles
          ORDER BY id COLLATE "C"`,

  responsibilities: `SELECT id, role_id, summary, interpretive
                     FROM analysis.responsibilities ORDER BY id COLLATE "C"`,

  departments: `SELECT id, name, manager_employee_id, is_governance
                FROM analysis.departments WHERE tenant_id = $1
                ORDER BY id COLLATE "C"`,

  handles: `SELECT department_id, discipline FROM analysis.department_handles
            ORDER BY department_id COLLATE "C", discipline COLLATE "C"`,

  employees: `SELECT id, display_name, role_id, department_id, team_id,
                     reports_to, seniority
              FROM analysis.employees ORDER BY id COLLATE "C"`,

  teams: `SELECT id, name, department_id, lead_employee_id FROM analysis.teams
          ORDER BY id COLLATE "C"`,
})

export function createOrganizationReader(
  client: Queryable,
  context: SqlContext,
  tenantId: string,
): OrganizationReader {
  let cached: SeededOrganization | null = null

  async function read(): Promise<SeededOrganization> {
    const seed = await one<{ version: string; checksum: string }>(
      client,
      context,
      'organization.load',
      ORGANIZATION_SQL.seed,
    )
    if (!seed) throw new OrganizationNotSeededError()

    if (cached && cached.seedChecksum === seed.checksum) return cached

    const [
      organizationRow,
      roleRows,
      responsibilityRows,
      departmentRows,
      handleRows,
      employeeRows,
      teamRows,
    ] = await Promise.all([
      one<{ id: string; name: string; chief_employee_id: string }>(
        client,
        context,
        'organization.load',
        ORGANIZATION_SQL.organization,
        [tenantId],
      ),
      run<{
        id: string
        title: string
        function: string
        can_block_publication: boolean
      }>(client, context, 'organization.load', ORGANIZATION_SQL.roles),
      run<{ id: string; role_id: string; summary: string; interpretive: boolean }>(
        client,
        context,
        'organization.load',
        ORGANIZATION_SQL.responsibilities,
      ),
      run<{
        id: string
        name: string
        manager_employee_id: string
        is_governance: boolean
      }>(client, context, 'organization.load', ORGANIZATION_SQL.departments, [tenantId]),
      run<{ department_id: string; discipline: string }>(
        client,
        context,
        'organization.load',
        ORGANIZATION_SQL.handles,
      ),
      run<{
        id: string
        display_name: string
        role_id: string
        department_id: string
        team_id: string | null
        reports_to: string | null
        seniority: string
      }>(client, context, 'organization.load', ORGANIZATION_SQL.employees),
      run<{ id: string; name: string; department_id: string; lead_employee_id: string }>(
        client,
        context,
        'organization.load',
        ORGANIZATION_SQL.teams,
      ),
    ])

    if (!organizationRow) throw new OrganizationNotSeededError()

    const responsibilitiesByRole = new Map<string, Responsibility[]>()
    for (const row of responsibilityRows) {
      const existing = responsibilitiesByRole.get(row.role_id) ?? []
      existing.push({ id: row.id, summary: row.summary, interpretive: row.interpretive })
      responsibilitiesByRole.set(row.role_id, existing)
    }

    const handlesByDepartment = new Map<string, string[]>()
    for (const row of handleRows) {
      const existing = handlesByDepartment.get(row.department_id) ?? []
      existing.push(row.discipline)
      handlesByDepartment.set(row.department_id, existing)
    }

    /*
     * Through `buildRole`, not around it. The rule that a governance role and
     * blocking authority move together holds on the way out of the database
     * too — a row that violated it would otherwise enter the domain as a
     * plausible role.
     */
    const roles: Role[] = roleRows.map((row) => {
      try {
        return buildRole({
          id: row.id,
          title: row.title,
          function: row.function as RoleFunction,
          responsibilities: responsibilitiesByRole.get(row.id) ?? [],
          canBlockPublication: row.can_block_publication,
        })
      } catch (error) {
        throw new MalformedRowError(
          'role',
          error instanceof Error ? error.message : String(error),
          'organization.load',
        )
      }
    })

    const departments: Department[] = departmentRows.map((row) => ({
      id: row.id,
      name: row.name,
      managerEmployeeId: row.manager_employee_id,
      handles: handlesByDepartment.get(row.id) ?? [],
      isGovernance: row.is_governance,
    }))

    const employees: Employee[] = employeeRows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      roleId: row.role_id,
      departmentId: row.department_id,
      ...(row.team_id ? { teamId: row.team_id } : {}),
      ...(row.reports_to ? { reportsTo: row.reports_to } : {}),
      seniority: row.seniority as Employee['seniority'],
    }))

    const teams: Team[] = teamRows.map((row) => ({
      id: row.id,
      name: row.name,
      departmentId: row.department_id,
      leadEmployeeId: row.lead_employee_id,
    }))

    const organization: Organization = {
      id: organizationRow.id,
      name: organizationRow.name,
      chiefEmployeeId: organizationRow.chief_employee_id,
      roles,
      departments,
      teams,
      employees,
    }

    /*
     * Validated on load. Every invariant a real organization chart has — one
     * chief, every manager in their own department, no reporting cycles — is
     * checked before a single command resolves an actor against it.
     */
    try {
      validateOrganization(organization)
    } catch (error) {
      throw new MalformedRowError(
        'organization',
        error instanceof Error ? error.message : String(error),
        'organization.load',
      )
    }

    cached = seal(
      { organization, seedVersion: seed.version, seedChecksum: seed.checksum },
      'organization',
    )
    return cached
  }

  return { load: read }
}
