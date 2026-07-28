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
 *
 * A version also carries a **content hash**, so "v1" registered twice with
 * different entries is a loud conflict rather than a silently divergent
 * workflow. Two deployments of the same build register identical bytes; a
 * deployment that changed the playbook without changing the version is caught
 * at the moment it tries.
 *
 * ## Two kinds of edge
 *
 * A dependency is either **blocking** — the downstream work cannot start until
 * it lands — or an **optional input**, which is consumed when available and
 * recorded as missing when not.
 *
 * Collapsing them was the original mistake. One `dependsOn` list forced a
 * choice between two bad outcomes: either Research Office blocks on Quant, and
 * a case stalls forever when Quant legitimately has nothing to add, or Quant is
 * not a dependency at all and its absence disappears from the record. Neither
 * is what a firm means by "aggregate the quant view if we have one".
 */

import { stableHashHex } from '~/domain/shared/hash'
import {
  canonicalJson,
  requirementRule,
  type DepartmentId,
  type RequirementLevel,
} from '~/domain/analysis'

export type PlaybookId = string

/** A rule identity on a conditional entry. Resolved against the registry. */
export interface ConditionalRuleReference {
  ruleId: string
  ruleVersion: string
}

export interface PlaybookEntry {
  /** Stable within the playbook. Becomes part of the assignment id. */
  key: string
  departmentId: DepartmentId
  /** What this department is asked for, in its own discipline's terms. */
  brief: string
  /**
   * Hard dependencies. This entry cannot become ready until every one of them
   * has completed.
   *
   * May name only entries the playbook guarantees will happen — see
   * `validatePlaybook`. A blocking dependency on work that may legitimately
   * never occur is a deadlock with a schedule.
   */
  blockedBy: readonly string[]
  /**
   * Work this entry consumes **if it is available**, and proceeds without if
   * it is not.
   *
   * The absence is not silence: `missingOptionalInputs` makes it visible, the
   * manager's aggregation records it, and the decision record preserves that
   * the perspective was unavailable. An optional input that vanished from the
   * record would let a thesis claim evidence coverage it never had.
   */
  optionalInputs: readonly string[]
  /**
   * How much this entry is needed.
   *
   * `conditional` means the answer depends on the argument being reviewed and
   * is resolved per revision — see `domain/analysis/requirements`.
   */
  requirement: RequirementLevel
  /** Required when `requirement` is `conditional`, forbidden otherwise. */
  conditionalRule?: ConditionalRuleReference
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

/**
 * Content address of everything that determines the workflow.
 *
 * Covers the entries and their edges, not the display name — renaming a
 * playbook does not change what it instantiates. Registration compares this,
 * so one version cannot quietly mean two different things.
 */
export function playbookContentHash(playbook: CasePlaybook): string {
  return stableHashHex(
    canonicalJson({
      id: playbook.id,
      version: playbook.version,
      caseKind: playbook.caseKind,
      entries: [...playbook.entries]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((entry) => ({
          key: entry.key,
          departmentId: entry.departmentId,
          brief: entry.brief,
          blockedBy: [...entry.blockedBy].sort((a, b) => a.localeCompare(b)),
          optionalInputs: [...entry.optionalInputs].sort((a, b) => a.localeCompare(b)),
          requirement: entry.requirement,
          conditionalRule: entry.conditionalRule
            ? `${entry.conditionalRule.ruleId}@${entry.conditionalRule.ruleVersion}`
            : null,
          priority: entry.priority,
          disciplineTag: entry.disciplineTag ?? null,
        })),
    }),
  )
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

  const byKey = new Map(playbook.entries.map((e) => [e.key, e]))
  const known = new Set(context.knownDepartmentIds)

  for (const entry of playbook.entries) {
    if (!known.has(entry.departmentId)) {
      throw new Error(
        `Playbook "${playbook.id}" assigns work to unknown department ` +
          `"${entry.departmentId}"`,
      )
    }

    for (const [kind, edges] of [
      ['blocking dependency', entry.blockedBy],
      ['optional input', entry.optionalInputs],
    ] as const) {
      for (const other of edges) {
        if (other === entry.key) {
          throw new Error(`Entry "${entry.key}" names itself as a ${kind}`)
        }
        if (!byKey.has(other)) {
          throw new Error(
            `Entry "${entry.key}" names "${other}" as a ${kind}, which does not exist`,
          )
        }
      }
    }

    /*
     * One edge is one kind. An entry that both blocks on something and treats
     * it as optional carries two contradictory scheduling rules, and whichever
     * the orchestrator happened to consult first would decide the workflow.
     */
    const both = entry.blockedBy.filter((key) => entry.optionalInputs.includes(key))
    if (both.length > 0) {
      throw new Error(
        `Entry "${entry.key}" names ${both.join(', ')} as both a blocking ` +
          `dependency and an optional input. An edge is one or the other.`,
      )
    }

    /*
     * A blocking dependency must be on work the playbook GUARANTEES happens.
     * An optional entry may legitimately never complete and a conditional one
     * may resolve `not-required`, so blocking on either leaves the downstream
     * entry — and the case — waiting for something that is never coming.
     *
     * Optional entries are exempt: an optional entry that never starts costs
     * nothing, because nothing downstream is waiting for it.
     */
    if (entry.requirement !== 'optional') {
      for (const dependency of entry.blockedBy) {
        const upstream = byKey.get(dependency)
        if (upstream && upstream.requirement !== 'required') {
          throw new Error(
            `${entry.requirement} entry "${entry.key}" blocks on ` +
              `${upstream.requirement} entry "${dependency}", which may ` +
              `legitimately never complete. Make it an optional input instead, ` +
              `so the absence is recorded rather than fatal.`,
          )
        }
      }
    }

    /*
     * A conditional entry names the rule that decides it, at an exact version.
     * Without one, "conditional" would mean "somebody will decide somehow",
     * which is not a rule and cannot be audited.
     */
    if (entry.requirement === 'conditional') {
      if (!entry.conditionalRule) {
        throw new Error(
          `Conditional entry "${entry.key}" names no rule. A condition nobody ` +
            `can name is a decision waiting to be made informally.`,
        )
      }
      // Throws `UnknownRequirementRuleError` when that version does not exist.
      requirementRule(entry.conditionalRule)
    } else if (entry.conditionalRule) {
      throw new Error(
        `Entry "${entry.key}" is ${entry.requirement} but names a conditional ` +
          `rule. The rule would never run, and reading the playbook would ` +
          `suggest a gate that does not exist.`,
      )
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

/**
 * Depth-first cycle detection over the **blocking** graph.
 *
 * Optional inputs are deliberately excluded: two desks that each consume the
 * other's output when available is a legitimate arrangement rather than a
 * deadlock, because neither is waiting.
 */
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
    for (const dependency of byKey.get(key)?.blockedBy ?? []) {
      visit(dependency, [...path, key])
    }
    visiting.delete(key)
    done.add(key)
  }

  for (const entry of playbook.entries) visit(entry.key, [])
}

/**
 * Entries whose blocking dependencies have all completed.
 *
 * The orchestrator's scheduling primitive. An entry whose dependency FAILED is
 * not ready — it is blocked, which is a different fact and is recorded as one.
 * Optional inputs never gate readiness; that is what makes them optional.
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
      entry.blockedBy.every((d) => completed.has(d)),
  )
}

/** Entries that can never run because an upstream blocking dependency failed. */
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
      if (entry.blockedBy.some((d) => failed.has(d) || blocked.has(d))) {
        blocked.add(entry.key)
        changed = true
      }
    }
  }
  return playbook.entries.filter((e) => blocked.has(e.key))
}

/**
 * Optional inputs an entry did NOT get.
 *
 * The visible half of "proceeds without it". A manager aggregating while this
 * is non-empty is aggregating on partial coverage, and both the thesis and the
 * decision record are entitled to say so.
 */
export function missingOptionalInputs(
  playbook: CasePlaybook,
  entryKey: string,
  completedKeys: readonly string[],
): string[] {
  const completed = new Set(completedKeys)
  const entry = playbook.entries.find((e) => e.key === entryKey)
  if (!entry) return []
  return entry.optionalInputs.filter((key) => !completed.has(key))
}

/** Entries every case under this playbook must have a verdict on. */
export function requiredEntries(playbook: CasePlaybook): PlaybookEntry[] {
  return playbook.entries.filter((entry) => entry.requirement === 'required')
}

/** Entries whose necessity is decided per revision. */
export function conditionalEntries(playbook: CasePlaybook): PlaybookEntry[] {
  return playbook.entries.filter((entry) => entry.requirement === 'conditional')
}
