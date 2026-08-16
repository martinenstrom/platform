/**
 * Dependency-graph orchestration.
 *
 * Runs a case's playbook: independent departments concurrently, dependent ones
 * in order, each isolated and each with a deadline.
 *
 * ## It writes nothing
 *
 * This module holds the provider and sequences commands. It has no repository,
 * no transaction and no store — asserted by a fitness rule, because a direct
 * write from here would be an institutional effect with no command, no actor
 * and no ledger entry behind it. Every durable act is `runCommand`:
 *
 * ```
 * StartAgentRun          commits    (run: → running, assignment → active)
 *    ↓
 * provider.contribute()  outside any transaction, may be slow or fail
 *    ↓
 * RecordContribution | FailAgentRun    commits
 * ```
 *
 * The middle step is why the other two are separate commands. A PostgreSQL
 * transaction must never be open while something remote is happening, so the
 * boundary is three durable acts rather than one long one.
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
import type {
  AgentClaim,
  AgentRunRecord,
  RunFailureCategory,
  RunState,
} from '~/domain/analysis'
import {
  blockedEntries,
  readyEntries,
  type CasePlaybook,
  type PlaybookEntry,
} from './playbooks'
import type { ContributionProvider, ContributionRequest } from './contributionPort'
import { runCommand, type CommandDeps } from './commands/runCommand'
import { startAgentRun } from './commands/startAgentRun'
import { recordContribution } from './commands/recordContribution'
import { failAgentRun } from './commands/failAgentRun'
// The rejection code comes through the command envelope rather than from the
// ledger module directly: the orchestrator's only durable surface is
// `runCommand`, and a fitness rule keeps it that way.
import type { CommandEnvelope, DomainRejection } from './commands/envelope'

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
  /**
   * Why it stopped, from the closed vocabulary.
   *
   * Was `failureReason: string`, and the timeout branch put `error.message` —
   * raw provider text — straight into it. A bounded category cannot carry a
   * response body, a prompt or an evidence excerpt into the logs and read
   * models this record flows through.
   */
  failureCategory?: RunFailureCategory
  /**
   * Upstream entries whose work is produced and awaiting a human.
   *
   * Present only on `waiting-for-dependencies`, and the reason this state is
   * distinguishable from "the upstream has not run yet". A dependency is
   * satisfied by **accepted** claims: produced work is operational and does not
   * unlock institutional work downstream, because an agent chain must not build
   * on a premise no human has agreed belongs in the record.
   *
   * Named rather than implied, so a reader sees WHY the playbook stopped and
   * whose desk ends the wait.
   */
  awaitingAcceptanceOf?: readonly string[]
  /**
   * Set when a command refused rather than a provider failing.
   *
   * The two are different facts and were previously indistinguishable: an
   * entry the firm would not start and an entry whose provider fell over both
   * came back as "failed". A refusal is the organization working correctly.
   */
  rejection?: DomainRejection['code']
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

/** The three durable acts one entry can perform. */
export type OrchestrationAct = 'start' | 'record' | 'fail'

export interface OrchestrationContext {
  caseId: string
  evidenceSetId: string
  /** The revision under analysis, when the work is thesis-scoped. */
  revisionId?: string
  /** Assignment id per playbook entry key. */
  assignmentIdFor: (entryKey: string) => string
  employeeIdFor: (departmentId: string) => string
  /**
   * The command id for one act on one entry.
   *
   * Supplied rather than generated here, and required to be deterministic: it
   * is what makes the whole orchestration replayable. Re-running a playbook
   * with the same ids resolves each command from the ledger instead of
   * starting a second run, which is the property that lets a crashed
   * orchestration be resumed rather than restarted.
   */
  commandIdFor: (entryKey: string, act: OrchestrationAct) => string
  correlationId: string
  /** Recorded as the initiator on every command this module issues. */
  orchestratorId: string
  now: () => Date
  /**
   * Whether the target revision is still current.
   *
   * Checked AFTER each contribution returns, not only before it starts: a
   * revision can be superseded while a department is mid-flight, and the
   * result must then be settled as superseded rather than attached to an
   * argument that never saw it.
   *
   * Advisory only — `RecordContribution` checks the stored revision itself and
   * refuses regardless. This exists so the run is settled with the right
   * category instead of being refused for a reason the caller has to guess.
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
  deps: CommandDeps,
): Promise<OrchestrationResult> {
  const outcomes: StageOutcome[] = []
  const completed = new Set<string>()
  const failed = new Set<string>()
  /** Entries that produced work and are waiting on a person. */
  const awaitingAcceptance = new Set<string>()
  const claimsByKey = new Map<string, readonly AgentClaim[]>()

  for (;;) {
    /*
     * Anything already awaiting a person is not ready again. It has produced
     * its work; re-selecting it would loop forever, because it will never
     * complete without an act the orchestrator is not permitted to perform.
     */
    const ready = readyEntries(playbook, [...completed], [...failed]).filter(
      (entry) => !awaitingAcceptance.has(entry.key),
    )
    if (ready.length === 0) break

    // Highest priority first, so a wave that exceeds the cap runs the most
    // important work rather than whatever the array order happened to be.
    const wave = [...ready]
      .sort((a, b) => b.priority - a.priority)
      .slice(0, options.maxConcurrency)

    const results = await Promise.all(
      wave.map((entry) => runEntry(entry, provider, context, options, deps, claimsByKey)),
    )

    for (const outcome of results) {
      outcomes.push(outcome)
      /*
       * Three destinations, not two. Work awaiting a human is neither a
       * success that unlocks the graph nor a failure that blocks it — treating
       * it as either would be the whole boundary collapsing into a boolean.
       */
      if (outcome.state === 'awaiting-acceptance') {
        awaitingAcceptance.add(outcome.entryKey)
      } else if (outcome.state === 'completed' && !outcome.obsolete) {
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
   * have — and never written to a run, because no run exists: `StartAgentRun`
   * refuses an entry whose blocking dependencies have not completed, so the
   * block is a consequence of the graph rather than rows that can disagree
   * with it.
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
      failureCategory: 'upstream-failed',
    })
  }

  /*
   * Entries that neither completed, failed, nor were blocked by a failure.
   *
   * They are waiting on a human. An upstream entry produced work that is in
   * `awaiting-acceptance`, and until somebody accepts it the dependency is not
   * satisfied — accepted claims satisfy dependencies, produced ones do not, and
   * rejected ones never will.
   *
   * Recorded explicitly rather than left out of the outcomes. An entry that
   * simply did not appear would be indistinguishable from one the playbook
   * never contained, and "the run stopped and nobody can see why" is the
   * failure this whole record exists to prevent.
   */
  const accountedFor = new Set([
    ...completed,
    ...failed,
    ...awaitingAcceptance,
    ...blocked.map((entry) => entry.key),
  ])
  for (const entry of playbook.entries) {
    if (accountedFor.has(entry.key)) continue
    const waitingOn = entry.blockedBy.filter((key) => awaitingAcceptance.has(key))
    outcomes.push({
      entryKey: entry.key,
      departmentId: entry.departmentId,
      state: 'waiting-for-dependencies',
      claims: [],
      startedAt: context.now().toISOString(),
      ...(waitingOn.length > 0 ? { awaitingAcceptanceOf: waitingOn } : {}),
    })
  }

  const blockedKeys = blocked.map((e) => e.key)
  const missingRequired = playbook.entries
    .filter((e) => e.requirement === 'required' && !completed.has(e.key))
    .map((e) => e.key)

  return {
    outcomes,
    completedKeys: [...completed],
    failedKeys: [...failed],
    blockedKeys,
    missingRequired,
  }
}

/* ------------------------------------------------------------------ one entry */

async function runEntry(
  entry: PlaybookEntry,
  provider: ContributionProvider,
  context: OrchestrationContext,
  options: OrchestrationOptions,
  deps: CommandDeps,
  claimsByKey: Map<string, readonly AgentClaim[]>,
): Promise<StageOutcome> {
  const startedAt = context.now().toISOString()
  const departmentId = entry.departmentId
  const employeeId = context.employeeIdFor(departmentId)
  const assignmentId = context.assignmentIdFor(entry.key)

  const stage = (over: Partial<StageOutcome>): StageOutcome => ({
    entryKey: entry.key,
    departmentId,
    state: 'failed',
    claims: [],
    startedAt,
    ...over,
  })

  /*
   * Only declared edges. Never everything produced so far.
   *
   * Blocking dependencies are always present by the time an entry runs.
   * Optional inputs are included only when they actually completed — an absent
   * one is left out rather than passed as an empty list, so the contributor can
   * tell "the quant desk found nothing" from "the quant desk did not
   * contribute".
   */
  const inputs: Record<string, readonly AgentClaim[]> = {}
  for (const dependency of entry.blockedBy) {
    inputs[dependency] = claimsByKey.get(dependency) ?? []
  }
  for (const optional of entry.optionalInputs) {
    const claims = claimsByKey.get(optional)
    if (claims) inputs[optional] = claims
  }

  const request: ContributionRequest = {
    caseId: context.caseId,
    assignmentId,
    departmentId,
    employeeId,
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

  const envelope = (act: OrchestrationAct, reason?: string): CommandEnvelope => ({
    commandId: context.commandIdFor(entry.key, act),
    correlationId: context.correlationId,
    actor: { kind: 'employee', employeeId },
    // Who set it in motion, which is not who is accountable for it.
    initiator: { kind: 'orchestrator', orchestratorId: context.orchestratorId },
    occurredAt: context.now().toISOString(),
    ...(reason ? { reason } : {}),
  })

  /* ------------------------------------------------------------- act one */

  /*
   * What the provider WILL use, recorded before it uses it. Asking afterwards
   * would make the run's version axes a description of the answer rather than
   * of the question.
   */
  const declaration = provider.declare(request)

  const started = await runCommand(
    startAgentRun(deps.organization),
    {
      caseId: context.caseId,
      assignmentId,
      departmentId,
      ...(context.revisionId ? { revisionId: context.revisionId } : {}),
      providerId: provider.id,
      providerVersion: provider.version,
      providerKind: provider.kind,
      agentContractVersion: declaration.agentContractVersion,
      outputSchemaVersion: declaration.outputSchemaVersion,
      identity: declaration.identity,
      evidenceSetId: context.evidenceSetId,
    },
    envelope('start'),
    deps,
  )

  if (started.outcome !== 'committed') {
    /*
     * Nothing started, so there is nothing to fail. An entry the firm refused
     * to start is reported as blocked with the refusal's code — a rejection is
     * the organization working correctly, and reporting it as a provider
     * failure would send someone looking at the wrong system.
     */
    return stage({
      state: 'blocked',
      failureCategory: 'upstream-failed',
      ...(started.outcome === 'rejected' ? { rejection: started.rejection.code } : {}),
      completedAt: context.now().toISOString(),
    })
  }

  const run: AgentRunRecord = started.value

  /* ------------------------------------------------------------- act two */

  /*
   * `isolate` and `withDeadline` are reused because the semantics genuinely
   * match — one unit failing must not take the others down, and a reader must
   * not wait indefinitely. What is NOT reused is the market-data envelope: a
   * contribution is not an observation, and forcing it into `Envelope` would
   * give it a provenance and a staleness it does not have.
   *
   * No transaction is open here. That is the whole reason this sits between
   * two commands rather than inside one.
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

  /* ----------------------------------------------------------- act three */

  if (settled.state !== 'ok') {
    const timedOut = settled.state === 'error' && settled.error.code === 'timeout'
    const category: RunFailureCategory = timedOut ? 'provider-timeout' : 'provider-error'
    await settle(entry, context, deps, run.id, departmentId, {
      category,
      state: timedOut ? 'timed-out' : 'failed',
      // A timeout may be transient; an error the provider chose to return is
      // not, and returning the work to the queue would repeat it forever.
      retryable: timedOut,
    })
    return stage({
      state: timedOut ? 'timed-out' : 'failed',
      failureCategory: category,
      completedAt: context.now().toISOString(),
    })
  }

  /*
   * Checked after the fact: the revision may have been superseded while this
   * ran. The result stays attached to the revision it targeted, settled as
   * superseded, rather than being reattached to an argument built on different
   * assumptions.
   */
  if (context.revisionId && !context.revisionIsCurrent()) {
    await settle(entry, context, deps, run.id, departmentId, {
      category: 'revision-superseded',
      state: 'superseded',
      retryable: false,
    })
    return stage({
      state: 'superseded',
      claims: settled.data.claims,
      obsolete: true,
      failureCategory: 'revision-superseded',
      completedAt: context.now().toISOString(),
    })
  }

  /*
   * A provider that answered against a different contract than it declared has
   * not answered the question that was asked. Caught here rather than stored,
   * because the run's version axes are what a cached result and an audit both
   * key on.
   */
  if (
    settled.data.agentContractVersion !== declaration.agentContractVersion ||
    settled.data.outputSchemaVersion !== declaration.outputSchemaVersion
  ) {
    await settle(entry, context, deps, run.id, departmentId, {
      category: 'schema-violation',
      state: 'failed',
      retryable: false,
    })
    return stage({
      failureCategory: 'schema-violation',
      completedAt: context.now().toISOString(),
    })
  }

  const recorded = await runCommand(
    recordContribution(deps.organization),
    {
      caseId: context.caseId,
      runId: run.id,
      departmentId,
      claims: settled.data.claims,
      observedStates: settled.data.observedStates,
      // Passed through exactly as reported. The orchestrator has no basis for
      // converting one usage state into another.
      usage: settled.data.usage,
    },
    envelope('record'),
    deps,
  )

  if (recorded.outcome !== 'committed') {
    /*
     * The firm refused what came back. The run is still running, so it is
     * settled explicitly — an unsettled run is a department that appears to be
     * working forever.
     */
    const category: RunFailureCategory =
      recorded.outcome === 'rejected' && recorded.rejection.code === 'invariant-violated'
        ? 'malformed-output'
        : 'internal-error'
    await settle(entry, context, deps, run.id, departmentId, {
      category,
      state: 'failed',
      retryable: false,
    })
    return stage({
      failureCategory: category,
      ...(recorded.outcome === 'rejected' ? { rejection: recorded.rejection.code } : {}),
      completedAt: context.now().toISOString(),
    })
  }

  /*
   * Produced, not completed.
   *
   * The work is real and durable and sits in `awaiting-acceptance`. It has not
   * satisfied anything: a dependency is satisfied by ACCEPTED claims, because
   * an agent chain must not build on a premise no human has agreed belongs in
   * the record. Reporting this as `completed` would unlock every downstream
   * entry on work nobody has looked at.
   */
  return stage({
    state: 'awaiting-acceptance',
    // The stored claims, with the identities the firm gave them — not the
    // provider's own ids, which are local to one contribution.
    claims: recorded.value.claims,
    completedAt: recorded.value.completedAt ?? context.now().toISOString(),
  })
}

/**
 * Why work stopped, in the firm's words.
 *
 * `FailAgentRun` requires a reason, and the reason must not be the provider's
 * own text — it flows into logs and read models. These are fixed sentences
 * keyed by a bounded category, so nothing a provider returns can reach them.
 */
const FAILURE_REASONS: Readonly<Record<RunFailureCategory, string>> = Object.freeze({
  'provider-unavailable': 'The provider could not be reached.',
  'provider-timeout': 'The provider did not answer within the deadline.',
  'provider-error': 'The provider answered with an error.',
  'malformed-output': 'The contribution was not admissible and was refused.',
  'schema-violation': 'The provider answered against a contract it did not declare.',
  'budget-exhausted': 'A budget was exhausted before the work finished.',
  'evidence-unavailable': 'The evidence this work needed could not be resolved.',
  'upstream-failed': 'A dependency failed, so this could never have run.',
  'cancelled-by-organization': 'The organization withdrew this work.',
  'revision-superseded': 'The thesis revision was superseded while this was in flight.',
  'internal-error': 'The runtime could not complete this work.',
})

/** Settles a started run that will not produce a contribution. */
async function settle(
  entry: PlaybookEntry,
  context: OrchestrationContext,
  deps: CommandDeps,
  runId: string,
  departmentId: string,
  failure: { category: RunFailureCategory; state: RunState; retryable: boolean },
): Promise<void> {
  await runCommand(
    failAgentRun(deps.organization),
    {
      caseId: context.caseId,
      runId,
      departmentId,
      category: failure.category,
      retryable: failure.retryable,
      attempt: 1,
      state: failure.state,
    },
    {
      commandId: context.commandIdFor(entry.key, 'fail'),
      correlationId: context.correlationId,
      actor: { kind: 'employee', employeeId: context.employeeIdFor(departmentId) },
      initiator: { kind: 'orchestrator', orchestratorId: context.orchestratorId },
      occurredAt: context.now().toISOString(),
      reason: FAILURE_REASONS[failure.category],
    },
    deps,
  )
}
