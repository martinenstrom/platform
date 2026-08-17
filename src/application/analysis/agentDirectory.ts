/**
 * The firm's desks, and what each of them has actually done.
 *
 * Agent Headquarters reads this. It is the staff-side counterpart to
 * `caseListing`: that one answers *what is the firm holding*, this one answers
 * *who works here, what are they asked for, and what have they produced*.
 *
 * ## Derived, never stored
 *
 * A desk exists here when **the seeded organization has the department** and
 * **a registered playbook assigns work to it**. Neither half alone is enough:
 *
 *   - A department nobody assigns work to is a box on an org chart, not a desk
 *     the firm can commission. The seed contains several — Equity Research,
 *     Compliance, Editorial — and listing them beside desks that actually
 *     receive assignments would describe a plan as though it were staff.
 *   - A playbook entry naming a department that does not exist is a build
 *     error, caught by `validateRegistry` long before this runs.
 *
 * So the intersection is the answer, and it is computed on every read. There is
 * deliberately **no agent catalogue** — a second list of who the firm employs
 * would be free to disagree with the organization the commands authorize
 * against, and only the list would know which one was right.
 *
 * ## Runs are read, not summarised
 *
 * Each desk carries the `AgentRunRecord`s it produced, unchanged. No projection,
 * no status roll-up, no counts computed here: a run already says what it is —
 * its state, its budget, what it spent, what identity produced it, and how it
 * failed or was declined. Recomputing any of that would be a second answer to a
 * question the record already answers.
 *
 * **A run in `awaiting-acceptance` carries no claims**, and that is a property
 * of the store rather than an omission here: `claims` on a run is a projection
 * of the institutional claims table, and produced work is deliberately not in
 * it. Reading produced work is Stage B's boundary and is not done from here.
 *
 * ## The query cost, stated rather than discovered
 *
 * Runs are keyed by case, so assembling the floor walks the case list and reads
 * each case's runs. That is the same shape TD-71 records for the queue, for the
 * same reason: correct at the firm's present size, and the thing to revisit
 * before it holds hundreds of cases rather than after.
 */

import type {
  AgentRunRecord,
  DepartmentId,
  Organization,
  RequirementLevel,
  Responsibility,
} from '~/domain/analysis'
import type { AnalysisRepositories } from './repositories'
import type { CasePlaybook } from './playbooks'

/**
 * A piece of work the firm's registered workflow asks this desk for.
 *
 * The playbook entry as it stands, named by the playbook version that contains
 * it. Not "what this desk can do" — what the firm's approved workflow actually
 * assigns to it, which is a fact about the institution rather than a claim
 * about the desk's capability.
 */
export interface DeskAssignableWork {
  playbookId: string
  playbookVersion: string
  entryKey: string
  brief: string
  requirement: RequirementLevel
  priority: number
  disciplineTag?: string
}

/** Who owns the desk. Read from the organization, never invented. */
export interface DeskManager {
  employeeId: string
  displayName: string
  roleTitle: string
  seniority: string
}

export interface AgentDesk {
  departmentId: DepartmentId
  name: string
  /** True for the independent control functions. Rendered, never ranked. */
  isGovernance: boolean
  /** Free-form discipline tags, as the seed states them. */
  handles: readonly string[]
  manager: DeskManager
  /**
   * What the desk's manager is accountable for.
   *
   * Carries `interpretive` through unchanged: a discipline that yields a
   * reading rather than a measurement is required to be labelled as such
   * wherever it appears, and this is one of the places it appears.
   */
  responsibilities: readonly Responsibility[]
  /** Ordered by `priority` descending, then `entryKey`. */
  assignableWork: readonly DeskAssignableWork[]
  /** Newest first: `startedAt` descending, then `id` descending. */
  runs: readonly AgentRunRecord[]
}

export interface AgentDirectoryInput {
  repositories: AnalysisRepositories
  organization: Organization
  /** The registered playbooks this build ships. Passed in, never imported. */
  playbooks: readonly CasePlaybook[]
}

/**
 * Every desk the firm can commission, with its real work.
 *
 * ## Ordering
 *
 * Desks that produce analysis come before the independent control functions,
 * then `departmentId` ascending as a total tie-break.
 *
 * That first claim is structural, not a ranking: `isGovernance` is a property
 * the seed records, control functions review what the other desks produce, and
 * a reader scanning the floor is looking for the producing desks first.
 * Nothing here claims one desk matters more than another, and no ordering by
 * volume of work exists — a desk that has run nothing is not further down the
 * page than one that has run twice.
 */
export async function agentDirectory(
  input: AgentDirectoryInput,
): Promise<readonly AgentDesk[]> {
  const { repositories, organization, playbooks } = input

  const runsByDepartment = await runsByDepartmentId(repositories)
  const workByDepartment = assignableWorkByDepartmentId(playbooks)

  const desks: AgentDesk[] = []
  for (const department of organization.departments) {
    const assignableWork = workByDepartment.get(department.id)
    /*
     * No registered entry assigns work here. The department is real and stays
     * in the organization; it is simply not a desk the firm can commission,
     * and presenting it as one would be the org chart pretending to be staff.
     */
    if (!assignableWork) continue

    const manager = organization.employees.find(
      (employee) => employee.id === department.managerEmployeeId,
    )
    /*
     * `validateOrganization` already refuses a department whose manager is
     * unknown or works elsewhere, so this cannot happen against a seeded firm.
     * Skipped rather than substituted anyway: a desk rendered with an invented
     * manager would be exactly the fiction this surface replaces.
     */
    if (!manager) continue

    const role = organization.roles.find((candidate) => candidate.id === manager.roleId)
    if (!role) continue

    desks.push({
      departmentId: department.id,
      name: department.name,
      isGovernance: department.isGovernance,
      handles: department.handles,
      manager: {
        employeeId: manager.id,
        displayName: manager.displayName,
        roleTitle: role.title,
        seniority: manager.seniority,
      },
      responsibilities: role.responsibilities,
      assignableWork,
      runs: runsByDepartment.get(department.id) ?? [],
    })
  }

  return desks.sort(producingDesksFirst)
}

/**
 * One desk, or `null` where the firm has no such desk to commission.
 *
 * Deliberately the same derivation rather than a cheaper direct read. A desk
 * page that assembled itself differently from the floor is how the two start
 * disagreeing about what a department is responsible for, and "the floor said
 * one thing, the desk page another" is the failure `caseListing` and
 * `caseOverview` already share one derivation to avoid.
 */
export async function agentDesk(
  input: AgentDirectoryInput & { departmentId: string },
): Promise<AgentDesk | null> {
  const desks = await agentDirectory(input)
  return desks.find((desk) => desk.departmentId === input.departmentId) ?? null
}

/* --------------------------------------------------------------- assembly */

function producingDesksFirst(a: AgentDesk, b: AgentDesk): number {
  if (a.isGovernance !== b.isGovernance) return a.isGovernance ? 1 : -1
  return compareText(a.departmentId, b.departmentId)
}

/** Byte order, not locale order: an ordering that varies by host is not one. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Which desks the registered workflows assign work to.
 *
 * Across every registered playbook, because a desk is commissionable if **any**
 * approved workflow asks it for something.
 *
 * ## One row per piece of work, at its current version
 *
 * Two versions of one playbook coexist by design, and both assign
 * `macro-analysis` to Global Macro. That is one job the desk owes, described
 * twice — so the highest version wins and the desk shows what the firm's
 * current workflow asks of it. Listing both would put two identical rows in
 * front of a reader whose only difference is a version number they cannot act
 * on: work is commissioned against an **assignment**, which carries its own
 * case's pin, and this list is what the desk is for rather than what any
 * particular case is running.
 *
 * Older versions stay visible where they are load-bearing — on the runs that
 * executed under them, and on the cases pinned to them.
 */
function assignableWorkByDepartmentId(
  playbooks: readonly CasePlaybook[],
): Map<DepartmentId, readonly DeskAssignableWork[]> {
  const byDepartment = new Map<DepartmentId, DeskAssignableWork[]>()

  /* Ascending, so a later version overwrites the entry an earlier one added. */
  const ordered = [...playbooks].sort((a, b) =>
    a.id === b.id ? compareText(a.version, b.version) : compareText(a.id, b.id),
  )

  for (const playbook of ordered) {
    for (const entry of playbook.entries) {
      const work: DeskAssignableWork = {
        playbookId: playbook.id,
        playbookVersion: playbook.version,
        entryKey: entry.key,
        brief: entry.brief,
        requirement: entry.requirement,
        priority: entry.priority,
        ...(entry.disciplineTag ? { disciplineTag: entry.disciplineTag } : {}),
      }
      const existing = byDepartment.get(entry.departmentId)
      if (!existing) {
        byDepartment.set(entry.departmentId, [work])
        continue
      }
      const supersedes = existing.findIndex(
        (candidate) =>
          candidate.playbookId === work.playbookId && candidate.entryKey === work.entryKey,
      )
      if (supersedes === -1) existing.push(work)
      else existing[supersedes] = work
    }
  }

  for (const work of byDepartment.values()) {
    work.sort((a, b) => b.priority - a.priority || compareText(a.entryKey, b.entryKey))
  }
  return byDepartment
}

/**
 * Every run the firm has recorded, grouped by the desk that produced it.
 *
 * Sequential rather than parallel, for the reason `caseListing` gives: firing a
 * query per case at once would take the connection pool from the request path,
 * making the page slowest under exactly the load that makes it matter.
 */
async function runsByDepartmentId(
  repositories: AnalysisRepositories,
): Promise<Map<DepartmentId, AgentRunRecord[]>> {
  const byDepartment = new Map<DepartmentId, AgentRunRecord[]>()

  for (const investmentCase of await repositories.cases.list()) {
    for (const run of await repositories.runs.listForCase(investmentCase.id)) {
      const existing = byDepartment.get(run.departmentId)
      if (existing) existing.push(run)
      else byDepartment.set(run.departmentId, [run])
    }
  }

  /* Newest first, with the id as a total tie-break so the order is stable. */
  for (const runs of byDepartment.values()) {
    runs.sort(
      (a, b) =>
        b.startedAt.localeCompare(a.startedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    )
  }
  return byDepartment
}
