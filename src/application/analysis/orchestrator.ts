/**
 * Dependency-graph orchestration.
 *
 * Runs a case's playbook: independent departments concurrently, dependent ones
 * in order, each isolated and each with a deadline.
 *
 * ## What is deliberately absent
 *
 * There is no shared accumulating context. Each department receives **only the
 * outputs of the dependencies it declared** — the legacy prototype threaded one
 * mutable object through eleven stages, which meant stage 11's prompt carried
 * everything and no dependency was ever stated. Here `inputs` is built from
 * `dependsOn`, so what a department saw is knowable after the fact.
 *
 * ## Failure is not one thing
 *
 * A run that failed and a run that never ran are different facts and are
 * recorded differently. A department whose dependency failed is `blocked`, not
 * `failed`: it did not error, it never got the chance. The distinction matters
 * on the floor, where "three teams blocked behind macro" is actionable and
 * "four failures" is not.
 */

import { isolate } from '~/application/shared/isolate'
import { withDeadline } from '~/application/shared/deadline'
import type { AgentClaim, RunState } from '~/domain/analysis'
import {
  blockedEntries,
  readyEntries,
  type CasePlaybook,
  type PlaybookEntry,
} from './playbooks'
import type { ContributionProvider, ContributionRequest } from './contributionPort'

export interface OrchestrationOptions {
  /** Per-contribution deadline. */
  stageDeadlineMs: number
  /** Maximum contributions in flight at once. */
  maxConcurrency: number
  signal?: AbortSignal
}

export interface StageOutcome {
  entryKey: string
  departmentId: string
  state: RunState
  claims: readonly AgentClaim[]
  startedAt: string
  completedAt?: string
  failureReason?: string
  /** True when the target revision was superseded while this was in flight. */
  obsolete?: boolean
}

export interface OrchestrationResult {
  outcomes: readonly StageOutcome[]
  completedKeys: readonly string[]
  failedKeys: readonly string[]
  blockedKeys: readonly string[]
  /** Required entries that did not complete. Drives case-level blocking. */
  missingRequired: readonly string[]
}

export interface OrchestrationContext {
  caseId: string
  evidenceSetId: string
  /** The revision under analysis, when the work is thesis-scoped. */
  revisionId?: string
  /** Assignment id per playbook entry key. */
  assignmentIdFor: (entryKey: string) => string
  employeeIdFor: (departmentId: string) => string
  now: () => Date
  /**
   * Whether the target revision is still current.
   *
   * Checked AFTER each contribution returns, not only before it starts: a
   * revision can be superseded while a department is mid-flight, and the
   * result must then be marked obsolete rather than attached to an argument
   * that never saw it.
   */
  revisionIsCurrent: () => boolean
}

/**
 * Runs the playbook to completion or to a stable blocked state.
 *
 * Proceeds in waves: everything whose dependencies are satisfied runs
 * together, bounded by `maxConcurrency`. When a wave produces no progress the
 * remainder is blocked and the loop ends — a graph that cannot advance is a
 * finished orchestration with blocked work in it, not a hang.
 */
export async function runPlaybook(
  playbook: CasePlaybook,
  provider: ContributionProvider,
  context: OrchestrationContext,
  options: OrchestrationOptions,
): Promise<OrchestrationResult> {
  const outcomes: StageOutcome[] = []
  const completed = new Set<string>()
  const failed = new Set<string>()
  const claimsByKey = new Map<string, readonly AgentClaim[]>()

  for (;;) {
    const ready = readyEntries(playbook, [...completed], [...failed])
    if (ready.length === 0) break

    // Highest priority first, so a wave that exceeds the cap runs the most
    // important work rather than whatever the array order happened to be.
    const wave = [...ready]
      .sort((a, b) => b.priority - a.priority)
      .slice(0, options.maxConcurrency)

    const results = await Promise.all(
      wave.map((entry) => runEntry(entry, provider, context, options, claimsByKey)),
    )

    for (const outcome of results) {
      outcomes.push(outcome)
      if (outcome.state === 'completed' && !outcome.obsolete) {
        completed.add(outcome.entryKey)
        claimsByKey.set(outcome.entryKey, outcome.claims)
      } else {
        failed.add(outcome.entryKey)
      }
    }
  }

  /*
   * Anything still unaccounted for could not run because something upstream
   * failed. Recorded as blocked with the reason, never as a failure it did not
   * have.
   */
  const blocked = blockedEntries(playbook, [...failed]).filter(
    (entry) => !completed.has(entry.key) && !failed.has(entry.key),
  )
  for (const entry of blocked) {
    outcomes.push({
      entryKey: entry.key,
      departmentId: entry.departmentId,
      state: 'blocked',
      claims: [],
      startedAt: context.now().toISOString(),
      failureReason: `blocked by an upstream failure in ${entry.dependsOn.join(', ')}`,
    })
  }

  const blockedKeys = blocked.map((e) => e.key)
  const missingRequired = playbook.entries
    .filter((e) => e.required && !completed.has(e.key))
    .map((e) => e.key)

  return {
    outcomes,
    completedKeys: [...completed],
    failedKeys: [...failed],
    blockedKeys,
    missingRequired,
  }
}

async function runEntry(
  entry: PlaybookEntry,
  provider: ContributionProvider,
  context: OrchestrationContext,
  options: OrchestrationOptions,
  claimsByKey: Map<string, readonly AgentClaim[]>,
): Promise<StageOutcome> {
  const startedAt = context.now().toISOString()

  // Only declared dependencies. Never everything produced so far.
  const inputs: Record<string, readonly AgentClaim[]> = {}
  for (const dependency of entry.dependsOn) {
    inputs[dependency] = claimsByKey.get(dependency) ?? []
  }

  const request: ContributionRequest = {
    caseId: context.caseId,
    assignmentId: context.assignmentIdFor(entry.key),
    departmentId: entry.departmentId,
    employeeId: context.employeeIdFor(entry.departmentId),
    ...(context.revisionId ? { revisionId: context.revisionId } : {}),
    brief: entry.brief,
    evidenceSetId: context.evidenceSetId,
    inputs,
    budget: {
      tokens: null,
      costMinorUnits: null,
      currency: null,
      deadlineMs: options.stageDeadlineMs,
    },
    signal: options.signal ?? new AbortController().signal,
  }

  /*
   * `isolate` and `withDeadline` are reused because the semantics genuinely
   * match — one unit failing must not take the others down, and a reader must
   * not wait indefinitely. What is NOT reused is the market-data envelope: a
   * contribution is not an observation, and forcing it into `Envelope` would
   * give it a provenance and a staleness it does not have.
   */
  const settled = await withDeadline(
    `contribution:${entry.key}`,
    () =>
      isolate(`contribution:${entry.key}`, async () => {
        const result = await provider.contribute(request)
        return { state: 'ok' as const, data: result, provenance: undefined as never }
      }),
    { budgetMs: options.stageDeadlineMs },
  )

  if (settled.state !== 'ok') {
    const timedOut = settled.state === 'error' && settled.error.code === 'timeout'
    return {
      entryKey: entry.key,
      departmentId: entry.departmentId,
      state: timedOut ? 'timed-out' : 'failed',
      claims: [],
      startedAt,
      completedAt: context.now().toISOString(),
      failureReason:
        settled.state === 'error'
          ? settled.error.message
          : 'contribution did not resolve',
    }
  }

  /*
   * Checked after the fact: the revision may have been superseded while this
   * ran. A late result stays attached to the revision it targeted, flagged
   * obsolete, rather than being reattached to an argument built on different
   * assumptions.
   */
  if (context.revisionId && !context.revisionIsCurrent()) {
    return {
      entryKey: entry.key,
      departmentId: entry.departmentId,
      state: 'superseded',
      claims: settled.data.claims,
      startedAt,
      completedAt: context.now().toISOString(),
      obsolete: true,
      failureReason: `thesis revision ${context.revisionId} was superseded while this ran`,
    }
  }

  return {
    entryKey: entry.key,
    departmentId: entry.departmentId,
    state: 'completed',
    claims: settled.data.claims,
    startedAt,
    completedAt: context.now().toISOString(),
  }
}
