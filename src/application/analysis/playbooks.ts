/**
 * Case playbooks — the standard workflow for a kind of case.
 *
 * Something has to create assignments. In a real firm a "single-stock deep
 * dive" has a known shape: research contributes, quant validates, risk sizes,
 * governance reviews. A playbook is that shape written down as **data**, so a
 * new kind of case is a new record rather than new orchestration code — the
 * same principle that makes a new department data.
 *
 * ## Versioning, and why it is not optional
 *
 * A case records the exact playbook version that created its workflow. Editing
 * a playbook must not reach back and change cases already in flight: a case
 * half-way through a five-stage workflow does not silently acquire a sixth
 * stage because someone improved the template this morning. Existing cases run
 * to completion under the version they were instantiated from.
 */

import type { DepartmentId } from '~/domain/analysis'

export type PlaybookId = string

export interface PlaybookEntry {
  /** Stable within the playbook. Becomes part of the assignment id. */
  key: string
  departmentId: DepartmentId
  /** What this department is asked for, in its own discipline's terms. */
  brief: string
  /** Entry keys that must complete first. */
  dependsOn: readonly string[]
  /**
   * A required entry blocks downstream work and the decision when it fails.
   * An optional one degrades coverage and confidence.
   *
   * Optional does NOT mean irrelevant: an unavailable perspective is visible
   * in the decision record, and a later review may still judge it material.
   */
  required: boolean
  priority: number
  /**
   * The discipline this entry needs, checked against the department's
   * `handles`. Optional: omit it where the assignment is plainly within the
   * department's remit and the check would be ceremony.
   */
  disciplineTag?: string
}

export interface CasePlaybook {
  id: PlaybookId
  /** Bumped on any change to entries. Cases pin the version they started on. */
  version: string
  /** Which kind of case this applies to — matches `CaseSubject.kind`. */
  caseKind: string
  name: string
  entries: readonly PlaybookEntry[]
}

export interface PlaybookValidationContext {
  /** Departments that exist in the organization. */
  knownDepartmentIds: readonly DepartmentId[]
  /** Disciplines each department handles, for the mandate check. */
  handlesByDepartment: Readonly<Record<DepartmentId, readonly string[]>>
}

/**
 * Validates a playbook before it can instantiate anything.
 *
 * Every check here is a failure that would otherwise surface as a stuck case
 * hours later: a dependency cycle deadlocks silently, an unknown department
 * produces an assignment nobody owns, and a duplicate key produces two
 * assignments that overwrite each other's results.
 */
export function validatePlaybook(
  playbook: CasePlaybook,
  context: PlaybookValidationContext,
): void {
  const keys = playbook.entries.map((e) => e.key)
  if (new Set(keys).size !== keys.length) {
    throw new Error(`Playbook "${playbook.id}" has duplicate entry keys`)
  }
  if (playbook.entries.length === 0) {
    throw new Error(`Playbook "${playbook.id}" has no entries`)
  }

  const known = new Set(context.knownDepartmentIds)
  for (const entry of playbook.entries) {
    if (!known.has(entry.departmentId)) {
      throw new Error(
        `Playbook "${playbook.id}" assigns work to unknown department ` +
          `"${entry.departmentId}"`,
      )
    }
    for (const dependency of entry.dependsOn) {
      if (!keys.includes(dependency)) {
        throw new Error(
          `Entry "${entry.key}" depends on "${dependency}", which does not exist`,
        )
      }
      if (dependency === entry.key) {
        throw new Error(`Entry "${entry.key}" depends on itself`)
      }
    }
    /*
     * A required entry cannot depend on an optional one. The optional entry may
     * legitimately never complete, which would leave the required entry —
     * and therefore the case — permanently blocked with no way forward.
     */
    if (entry.required) {
      for (const dependency of entry.dependsOn) {
        const upstream = playbook.entries.find((e) => e.key === dependency)
        if (upstream && !upstream.required) {
          throw new Error(
            `Required entry "${entry.key}" depends on optional entry ` +
              `"${dependency}", which may never complete`,
          )
        }
      }
    }
    /*
     * Mandate check: a department is asked only for work it handles. The brief
     * is matched loosely — this catches a playbook pointing Compliance at a
     * valuation, not a wording difference.
     */
    const handles = context.handlesByDepartment[entry.departmentId] ?? []
    if (handles.length > 0 && entry.disciplineTag) {
      if (!handles.includes(entry.disciplineTag)) {
        throw new Error(
          `Department "${entry.departmentId}" does not handle ` +
            `"${entry.disciplineTag}" and cannot be assigned this entry ` +
            `without an explicit escalation rule`,
        )
      }
    }
  }

  detectCycle(playbook)
}

/** Depth-first cycle detection over the dependency graph. */
function detectCycle(playbook: CasePlaybook): void {
  const byKey = new Map(playbook.entries.map((e) => [e.key, e]))
  const visiting = new Set<string>()
  const done = new Set<string>()

  const visit = (key: string, path: string[]): void => {
    if (done.has(key)) return
    if (visiting.has(key)) {
      throw new Error(
        `Playbook "${playbook.id}" has a dependency cycle: ${[...path, key].join(' -> ')}`,
      )
    }
    visiting.add(key)
    for (const dependency of byKey.get(key)?.dependsOn ?? []) {
      visit(dependency, [...path, key])
    }
    visiting.delete(key)
    done.add(key)
  }

  for (const entry of playbook.entries) visit(entry.key, [])
}

/**
 * Entries whose dependencies have all completed.
 *
 * The orchestrator's scheduling primitive. An entry whose dependency FAILED is
 * not ready — it is blocked, which is a different fact and is recorded as one.
 */
export function readyEntries(
  playbook: CasePlaybook,
  completedKeys: readonly string[],
  failedKeys: readonly string[] = [],
): PlaybookEntry[] {
  const completed = new Set(completedKeys)
  const failed = new Set(failedKeys)
  return playbook.entries.filter(
    (entry) =>
      !completed.has(entry.key) &&
      !failed.has(entry.key) &&
      entry.dependsOn.every((d) => completed.has(d)),
  )
}

/** Entries that can never run because an upstream dependency failed. */
export function blockedEntries(
  playbook: CasePlaybook,
  failedKeys: readonly string[],
): PlaybookEntry[] {
  const failed = new Set(failedKeys)
  const blocked = new Set<string>()

  let changed = true
  while (changed) {
    changed = false
    for (const entry of playbook.entries) {
      if (blocked.has(entry.key) || failed.has(entry.key)) continue
      if (entry.dependsOn.some((d) => failed.has(d) || blocked.has(d))) {
        blocked.add(entry.key)
        changed = true
      }
    }
  }
  return playbook.entries.filter((e) => blocked.has(e.key))
}
