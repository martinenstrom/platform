/**
 * Whether the work a step depends on has actually arrived.
 *
 * Derived, every time, from four authoritative sources — the pinned playbook's
 * entries and edges, the case's assignments, its runs, and the contributions
 * that were accepted. Nothing stores a `missingRequiredContributions` field,
 * and that is the point: a stored blocker is a second source of truth about
 * work, and the two disagree the first time a late contribution lands.
 *
 * "Accepted" has one meaning here and it is not "a run finished". A run reaches
 * `completed` only through `RecordContribution`, which refuses inadmissible
 * claims — so a completed run with stored claims is the institution having
 * accepted the work, and nothing else counts.
 */

import type { AgentRunRecord, Assignment, RequirementResolution } from '~/domain/analysis'
import { requirementStatusFor } from '~/domain/analysis'
import type { CasePlaybook, PlaybookEntry } from './playbooks'

/** Why a dependency is not satisfied. Bounded — this reaches a rejection. */
export type UnmetReason =
  /** No assignment exists for the entry at all. */
  | 'not-assigned'
  /** The desk has not finished. */
  | 'assignment-incomplete'
  /** A run exists and did not produce a contribution. */
  | 'run-failed'
  /** No run reached `completed`. */
  | 'no-accepted-contribution'
  /** The run completed but the contribution carried no claims. */
  | 'contribution-empty'

export interface UnmetDependency {
  playbookEntryKey: string
  departmentId: string
  reason: UnmetReason
}

/**
 * Every entry the given one transitively blocks on.
 *
 * Blocking edges only. An optional input is not a dependency in this sense —
 * it may legitimately never arrive, which is what `optional` means.
 */
export function blockingClosure(
  playbook: CasePlaybook,
  entryKey: string,
): PlaybookEntry[] {
  const byKey = new Map(playbook.entries.map((entry) => [entry.key, entry]))
  const closure = new Map<string, PlaybookEntry>()
  const pending = [...(byKey.get(entryKey)?.blockedBy ?? [])]

  while (pending.length > 0) {
    const key = pending.pop()!
    if (closure.has(key)) continue
    const entry = byKey.get(key)
    if (!entry) continue
    closure.set(key, entry)
    pending.push(...entry.blockedBy)
  }
  return [...closure.values()]
}

/**
 * The effective requirement of an entry for one exact revision.
 *
 * A conditional entry counts as required only where the firm has recorded that
 * it is. Absence means unresolved, which is not the same as not required — but
 * an unresolved conditional entry upstream of aggregation cannot block it
 * either, because nothing has decided it applies. It surfaces as a governance
 * gate later rather than as a missing contribution now.
 */
export function effectiveRequirement(
  entry: PlaybookEntry,
  revisionId: string | null,
  resolutions: readonly RequirementResolution[],
): 'required' | 'optional' {
  if (entry.requirement === 'required') return 'required'
  if (entry.requirement === 'optional') return 'optional'
  const status = requirementStatusFor(entry.key, revisionId, resolutions)
  return status.state === 'required' ? 'required' : 'optional'
}

export interface RequiredWorkInput {
  playbook: CasePlaybook
  /** The entry whose dependencies are being checked. */
  entryKey: string
  /** The revision conditional requirements are resolved against. */
  revisionId: string | null
  assignments: readonly Assignment[]
  runs: readonly AgentRunRecord[]
  resolutions: readonly RequirementResolution[]
}

/**
 * The required upstream work that has not been accepted.
 *
 * Empty means the step may proceed. Anything else is a refusal, and each item
 * names the entry, the department that owes it and a bounded reason — enough
 * for a rejection message that tells someone what to do without carrying prose
 * from anywhere.
 */
export function unmetRequiredWork(input: RequiredWorkInput): UnmetDependency[] {
  const unmet: UnmetDependency[] = []

  for (const entry of blockingClosure(input.playbook, input.entryKey)) {
    if (effectiveRequirement(entry, input.revisionId, input.resolutions) !== 'required') {
      continue
    }

    const assignment = input.assignments.find(
      (candidate) => candidate.playbookEntryKey === entry.key,
    )
    if (!assignment) {
      unmet.push({
        playbookEntryKey: entry.key,
        departmentId: entry.departmentId,
        reason: 'not-assigned',
      })
      continue
    }

    const runs = input.runs.filter((run) => run.assignmentId === assignment.id)
    const accepted = runs.find((run) => run.state === 'completed')

    if (!accepted) {
      const failed = runs.some(
        (run) =>
          run.state === 'failed' ||
          run.state === 'timed-out' ||
          run.state === 'cancelled',
      )
      unmet.push({
        playbookEntryKey: entry.key,
        departmentId: entry.departmentId,
        reason: failed
          ? 'run-failed'
          : assignment.status === 'completed'
            ? 'no-accepted-contribution'
            : 'assignment-incomplete',
      })
      continue
    }

    if (accepted.claims.length === 0) {
      // A completed run with nothing in it cannot happen through
      // `RecordContribution`, which refuses an empty contribution. Checked
      // anyway: this is the one place that decides whether work exists.
      unmet.push({
        playbookEntryKey: entry.key,
        departmentId: entry.departmentId,
        reason: 'contribution-empty',
      })
    }
  }

  return unmet
}

/** The accepted contributions for a step's blocking dependencies. */
export function acceptedContributions(input: RequiredWorkInput): AgentRunRecord[] {
  const keys = new Set(blockingClosure(input.playbook, input.entryKey).map((e) => e.key))
  const mine = new Set(
    input.assignments
      .filter((a) => a.playbookEntryKey && keys.has(a.playbookEntryKey))
      .map((a) => a.id),
  )
  return input.runs.filter(
    (run) => mine.has(run.assignmentId) && run.state === 'completed',
  )
}
