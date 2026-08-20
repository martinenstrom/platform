/**
 * C1C-1: derived identity, playbook resolution and the run boundary.
 *
 * The claim this file exists to prove is the boundary one: `StartAgentRun`
 * commits before a provider executes. It is tested three ways — two fitness
 * rules in `importGraph.test.ts` about what commands may import, and here, by
 * having a stand-in provider read the command ledger and assert its own start
 * command is already durably visible.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { authorize, isRunTerminal, resolveActor } from '~/domain/analysis'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import {
  deriveAssignmentId,
  deriveEventId,
  deriveRunId,
} from '~/application/analysis/commands/eventIdentity'
import {
  UnknownPlaybookError,
  UnsupportedCaseKindError,
  registeredContentHash,
  requirePlaybook,
  resolveForCaseKind,
  validateRegistry,
} from '~/application/analysis/playbookRegistry'
import { openInvestmentCase } from '~/application/analysis/commands/openInvestmentCase'
import { instantiatePlaybook } from '~/application/analysis/commands/instantiatePlaybook'
import { startAgentRun } from '~/application/analysis/commands/startAgentRun'
import { resolveExecutionBudget } from '~/application/analysis/executionBudget'
import { failAgentRun } from '~/application/analysis/commands/failAgentRun'
import { MACRO_REGIME_PLAYBOOK } from '~/application/analysis/macroPlaybook'
import { playbookContentHash } from '~/application/analysis/playbooks'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'

const AT = '2026-07-28T09:00:00.000Z'
const LATER = '2026-07-28T11:00:00.000Z'
const SEED = TEST_SEED_VERSION

/** The seeded firm these commands are authorized against. */
const organization = TEST_ORGANIZATION

/* ------------------------------------------------------------- the harness */

let repositories: AnalysisRepositories
let deps: CommandDeps

beforeEach(async () => {
  repositories = createInMemoryRepositories()
  deps = {
    repositories,
    organization,
    organizationSeedVersion: SEED,
    provenance: await repositories.provenance(),
    now: () => AT,
  }
})

const envelope = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: 'cmd-1',
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'employee', employeeId: 'research-director' },
  occurredAt: AT,
  ...over,
})

const evidenceSetId = 'set-1'

async function seedInstantiatedCase() {
  await repositories.evidence.save({
    id: evidenceSetId,
    assembledAt: AT,
    correlationId: 'corr-1',
    items: [],
    disagreements: [],
    revisions: [],
    coTemporality: { publication: { kind: 'empty' }, reference: { kind: 'empty' } },
  })

  await runCommand(
    openInvestmentCase(organization),
    {
      caseId: 'case-1',
      subject: { kind: 'macro-regime', ref: 'ecb', displayName: 'ECB path' },
      question: 'Does the ECB cut before Q2?',
      ownerEmployeeId: 'research-director',
      participatingDepartmentIds: ['research-office'],
    },
    envelope({ commandId: 'cmd-open' }),
    deps,
  )

  await runCommand(
    instantiatePlaybook(organization),
    {
      caseId: 'case-1',
      playbookId: MACRO_REGIME_PLAYBOOK.id,
      playbookVersion: MACRO_REGIME_PLAYBOOK.version,
      onBehalfOfDepartmentId: 'research-office',
    },
    envelope({ commandId: 'cmd-inst', expectedVersion: 1 }),
    deps,
  )

  return deriveAssignmentId('cmd-inst', 'macro-analysis')
}

const startInput = (assignmentId: string, over: Record<string, unknown> = {}) => ({
  caseId: 'case-1',
  assignmentId,
  departmentId: 'global-macro',
  providerId: 'recorded-macro',
  providerVersion: '1',
  providerKind: 'recorded' as const,
  agentContractVersion: '1',
  outputSchemaVersion: '1',
  identity: {
    kind: 'model' as const,
    prompt: { id: 'macro-brief', version: '1', contentHash: 'ph' },
    model: { id: 'sonnet', provider: 'anthropic', parameters: {}, parametersHash: 'mh' },
  },
  evidenceSetId,
  // A replay consumes nothing external, so tokens and cost resolve to
  // `not-applicable`; the deadline is the dimension that still binds it.
  budget: resolveExecutionBudget('recorded', { firmCeiling: { deadlineMs: 30_000 } }),
  ...over,
})

const start = (
  assignmentId: string,
  over: Record<string, unknown> = {},
  cmd = 'cmd-run',
) =>
  runCommand(
    startAgentRun(organization),
    startInput(assignmentId, over),
    envelope({
      commandId: cmd,
      actor: { kind: 'employee', employeeId: 'macro-analyst' },
      initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
    }),
    deps,
  )

/* -------------------------------------------------------- derived identity */

describe('derived record identity', () => {
  it('produces the same ids for the same command, every time', () => {
    const first = deriveEventId({
      commandId: 'cmd-a',
      recordType: 'case-opened',
      entityId: 'case-1',
    })
    const second = deriveEventId({
      commandId: 'cmd-a',
      recordType: 'case-opened',
      entityId: 'case-1',
    })
    expect(first).toBe(second)
    // No clock, no counter, no randomness: a restart cannot change this.
    expect(first).toMatch(/^evt-[0-9a-f]{32}$/)
  })

  it('separates two commands that write about the same entity', () => {
    const a = deriveEventId({ commandId: 'cmd-a', recordType: 't', entityId: 'case-1' })
    const b = deriveEventId({ commandId: 'cmd-b', recordType: 't', entityId: 'case-1' })
    expect(a).not.toBe(b)
  })

  it('separates two record types within one command', () => {
    const a = deriveEventId({ commandId: 'cmd-a', recordType: 'x', entityId: 'e' })
    const b = deriveEventId({ commandId: 'cmd-a', recordType: 'y', entityId: 'e' })
    expect(a).not.toBe(b)
  })

  it('separates ordinals within one type and entity', () => {
    const a = deriveEventId({ commandId: 'c', recordType: 'x', entityId: 'e' })
    const b = deriveEventId({
      commandId: 'c',
      recordType: 'x',
      entityId: 'e',
      ordinal: 1,
    })
    expect(a).not.toBe(b)
  })

  it('gives assignments and runs their own namespaces', () => {
    expect(deriveAssignmentId('cmd-a', 'macro')).toMatch(/^asg-/)
    expect(deriveRunId('cmd-a', 'asg-1')).toMatch(/^run-/)
  })

  it('writes the same event ids when a command replays', async () => {
    await seedInstantiatedCase()
    const first = (await repositories.events.listForCase('case-1')).map((e) => e.eventId)

    // The same commands again: an identical replay, resolved from the ledger.
    await runCommand(
      instantiatePlaybook(organization),
      {
        caseId: 'case-1',
        playbookId: MACRO_REGIME_PLAYBOOK.id,
        playbookVersion: MACRO_REGIME_PLAYBOOK.version,
        onBehalfOfDepartmentId: 'research-office',
      },
      envelope({ commandId: 'cmd-inst', expectedVersion: 1 }),
      deps,
    )

    const second = (await repositories.events.listForCase('case-1')).map((e) => e.eventId)
    expect(second).toEqual(first)
  })
})

/* ------------------------------------------------------- playbook registry */

describe('the playbook registry', () => {
  it('resolves the approved workflow for a case kind', () => {
    /*
     * v2 since the C2-2 budget gate. The highest version is the default for
     * NEW cases, which is the whole reason registration is append-only: cases
     * pinned to v1 keep v1, and `macroPlaybook.test.ts` holds v1's content hash
     * to a literal so that stays true.
     */
    expect(resolveForCaseKind('macro-regime')).toEqual({
      playbookId: 'macro-regime',
      version: '4',
    })
  })

  it('refuses a case kind no playbook covers', () => {
    expect(() => resolveForCaseKind('single-stock')).toThrow(UnsupportedCaseKindError)
  })

  it('refuses a playbook this build does not ship', () => {
    expect(() => requirePlaybook('invented', '1')).toThrow(UnknownPlaybookError)
  })

  it('refuses a version of a known playbook that does not exist', () => {
    expect(() => requirePlaybook('macro-regime', '99')).toThrow(UnknownPlaybookError)
  })

  it('returns the immutable registered definition', () => {
    const playbook = requirePlaybook('macro-regime', '1')
    expect(playbook).toBe(MACRO_REGIME_PLAYBOOK)
    expect(registeredContentHash('macro-regime', '1')).toBe(
      playbookContentHash(MACRO_REGIME_PLAYBOOK),
    )
  })

  it('validates every shipped playbook against the seeded firm', () => {
    expect(() =>
      validateRegistry({
        knownDepartmentIds: organization.departments.map((d) => d.id),
        handlesByDepartment: Object.fromEntries(
          organization.departments.map((d) => [d.id, d.handles]),
        ),
      }),
    ).not.toThrow()
  })
})

/* ----------------------------------------------------------- StartAgentRun */

describe('StartAgentRun', () => {
  let assignmentId: string

  beforeEach(async () => {
    assignmentId = await seedInstantiatedCase()
  })

  it('starts a run and takes the assignment active, in one transaction', async () => {
    const result = await start(assignmentId)
    expect(result.outcome).toBe('committed')

    const runs = await repositories.runs.listForCase('case-1')
    expect(runs).toHaveLength(1)
    expect(runs[0]!.state).toBe('running')
    expect(runs[0]!.employeeId).toBe('macro-analyst')

    const assignment = await repositories.assignments.get(assignmentId)
    expect(assignment?.status).toBe('active')
    expect(assignment?.assigneeEmployeeId).toBe('macro-analyst')
  })

  it('records execution provenance, including that this is not live work', async () => {
    await start(assignmentId)
    const [run] = await repositories.runs.listForCase('case-1')

    expect(run!.execution).toEqual({
      playbookId: 'macro-regime',
      playbookVersion: '1',
      playbookEntryKey: 'macro-analysis',
      providerId: 'recorded-macro',
      providerVersion: '1',
      providerKind: 'recorded',
      // A replay whose artifact captured what produced it keeps that model.
      // `providerKind` is what stops it reading as live work.
      identity: {
        kind: 'model',
        prompt: { id: 'macro-brief', version: '1', contentHash: 'ph' },
        model: {
          id: 'sonnet',
          provider: 'anthropic',
          parameters: {},
          parametersHash: 'mh',
        },
      },
    })
  })

  it('records which optional inputs were absent when the work began', async () => {
    // Aggregation consumes quant if available. Nothing has run yet.
    const aggregationId = deriveAssignmentId('cmd-inst', 'aggregation')
    await start(assignmentId)

    // Complete macro so aggregation becomes ready.
    const [macroRun] = await repositories.runs.listForCase('case-1')
    await repositories.runs.save(
      { ...macroRun!, state: 'completed', completedAt: AT },
      deps.provenance,
    )

    const result = await runCommand(
      startAgentRun(organization),
      startInput(aggregationId, { departmentId: 'research-office' }),
      envelope({ commandId: 'cmd-agg-run' }),
      deps,
    )
    expect(result.outcome).toBe('committed')

    const aggregationRun = (await repositories.runs.listForCase('case-1')).find(
      (r) => r.execution.playbookEntryKey === 'aggregation',
    )
    expect(aggregationRun!.missingOptionalInputs).toEqual(['quant-validation'])
  })

  it('refuses an entry whose blocking dependency has not completed', async () => {
    const aggregationId = deriveAssignmentId('cmd-inst', 'aggregation')
    const result = await runCommand(
      startAgentRun(organization),
      startInput(aggregationId, { departmentId: 'research-office' }),
      envelope({ commandId: 'cmd-agg-early' }),
      deps,
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
  })

  it('lets two independent entries run at once', async () => {
    const quantId = deriveAssignmentId('cmd-inst', 'quant-validation')

    const [macro, quant] = await Promise.all([
      start(assignmentId, {}, 'cmd-macro'),
      runCommand(
        startAgentRun(organization),
        startInput(quantId, { departmentId: 'quant-technical' }),
        envelope({
          commandId: 'cmd-quant',
          actor: { kind: 'employee', employeeId: 'quant-head' },
        }),
        deps,
      ),
    ])

    expect(macro.outcome).toBe('committed')
    expect(quant.outcome).toBe('committed')
    expect(await repositories.runs.listForCase('case-1')).toHaveLength(2)
  })

  it('refuses a second active run on one assignment', async () => {
    await start(assignmentId, {}, 'cmd-run-a')
    const second = await start(assignmentId, {}, 'cmd-run-b')

    expect(second).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
    expect(await repositories.runs.listForCase('case-1')).toHaveLength(1)
  })

  it('refuses a department starting another department’s work', async () => {
    const quantId = deriveAssignmentId('cmd-inst', 'quant-validation')
    const result = await runCommand(
      startAgentRun(organization),
      // Claims to act for global-macro on an assignment owed by quant.
      startInput(quantId, { departmentId: 'global-macro' }),
      envelope({
        commandId: 'cmd-wrong-dept',
        actor: { kind: 'employee', employeeId: 'macro-analyst' },
      }),
      deps,
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-authorised' },
    })
  })

  it('refuses work on a case with no playbook', async () => {
    await runCommand(
      openInvestmentCase(organization),
      {
        caseId: 'case-2',
        subject: { kind: 'macro-regime', ref: 'fed', displayName: 'Fed path' },
        question: 'Does the Fed hold?',
        ownerEmployeeId: 'research-director',
        participatingDepartmentIds: ['research-office'],
      },
      envelope({ commandId: 'cmd-open-2' }),
      deps,
    )

    const result = await runCommand(
      startAgentRun(organization),
      startInput(assignmentId, { caseId: 'case-2' }),
      envelope({ commandId: 'cmd-no-playbook' }),
      deps,
    )
    expect(result.outcome).toBe('rejected')
  })

  it('refuses an expectedVersion it has no use for', async () => {
    const result = await runCommand(
      startAgentRun(organization),
      startInput(assignmentId),
      envelope({ commandId: 'cmd-ver', expectedVersion: 2 }),
      deps,
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('replays to the same run', async () => {
    const first = await start(assignmentId)
    const replay = await start(assignmentId)

    expect(replay.outcome).toBe('committed')
    expect(await repositories.runs.listForCase('case-1')).toHaveLength(1)
    expect(first.outcome).toBe('committed')
  })
})

/* ------------------------------------------------------- the execution budget */

describe('what a run is authorized to spend', () => {
  let assignmentId: string

  beforeEach(async () => {
    assignmentId = await seedInstantiatedCase()
  })

  it('records the effective limit, not the policies that produced it', async () => {
    /*
     * The run stores "this was allowed 40,000 tokens", never "the playbook
     * proposed X, the case constrained Y, policy capped Z". Storing the
     * sources would make an old run's limits re-derivable only from documents
     * that have since moved.
     */
    const budget = resolveExecutionBudget('live', {
      proposed: { tokens: 90_000 },
      caseConstraint: { tokens: 40_000 },
      firmCeiling: {
        tokens: 100_000,
        cost: { costMinorUnits: 5_000, currency: 'USD' },
        deadlineMs: 30_000,
      },
    })

    await start(assignmentId, { providerKind: 'live', budget })
    const [run] = await repositories.runs.listForCase('case-1')

    expect(run!.budget).toEqual({
      tokens: { kind: 'limit', tokens: 40_000 },
      cost: { kind: 'limit', costMinorUnits: 5_000, currency: 'USD' },
      deadline: { kind: 'limit', deadlineMs: 30_000 },
    })
  })

  it('reads its own limits back unchanged after every source has moved', async () => {
    /*
     * The exit criterion stated as a test. The three policy sources are all
     * rewritten after the run committed — a different playbook proposal, a
     * different case constraint, a different firm ceiling — and the run still
     * reports what it was actually authorized to spend.
     *
     * This is what "the record carries what was in force, not a pointer to
     * wherever it currently lives" has to mean operationally.
     */
    const atTheTime = resolveExecutionBudget('live', {
      proposed: { tokens: 90_000 },
      caseConstraint: { tokens: 40_000 },
      firmCeiling: {
        tokens: 100_000,
        cost: { costMinorUnits: 5_000, currency: 'USD' },
        deadlineMs: 30_000,
      },
    })
    await start(assignmentId, { providerKind: 'live', budget: atTheTime })

    // Every source changes. None of them is what the run reads.
    const laterAndDifferent = resolveExecutionBudget('live', {
      proposed: { tokens: 1 },
      caseConstraint: { tokens: 2 },
      firmCeiling: {
        tokens: 3,
        cost: { costMinorUnits: 4, currency: 'USD' },
        deadlineMs: 5,
      },
    })
    expect(laterAndDifferent.tokens).toEqual({ kind: 'limit', tokens: 1 })

    const [run] = await repositories.runs.listForCase('case-1')
    expect(run!.budget.tokens).toEqual({ kind: 'limit', tokens: 40_000 })
    expect(run!.budget.deadline).toEqual({ kind: 'limit', deadlineMs: 30_000 })
  })

  it('refuses to start live work against a dimension nobody decided', async () => {
    /*
     * "Not measured" is not "unlimited" — the reason the original nullable
     * field carried that comment. The firm does not begin work it has not
     * authorized.
     */
    const unbounded = resolveExecutionBudget('live', { firmCeiling: {} })
    expect(unbounded.tokens).toEqual({ kind: 'not-measured' })

    const result = await start(assignmentId, {
      providerKind: 'live',
      budget: unbounded,
    })

    expect(result.outcome).toBe('rejected')
    expect(await repositories.runs.listForCase('case-1')).toEqual([])
  })

  it('does not refuse a producer for lacking a limit it could never spend', async () => {
    /*
     * The other half, and the whole reason `not-applicable` exists as a state.
     * A stub has no monetary cost by construction; refusing it for having no
     * cost limit would be refusing a fact rather than enforcing a policy.
     */
    const budget = resolveExecutionBudget('stub', { firmCeiling: {} })
    expect(budget.cost).toEqual({ kind: 'not-applicable' })

    const result = await start(assignmentId, {
      providerId: 'stub',
      providerKind: 'stub',
      identity: { kind: 'scenario', scenarioId: 'success', stubVersion: '1' },
      budget,
    })

    expect(result.outcome).toBe('committed')
    const [run] = await repositories.runs.listForCase('case-1')
    expect(run!.budget.cost).toEqual({ kind: 'not-applicable' })
  })

  it('keeps "cannot spend this" and "nobody decided" distinguishable on the record', async () => {
    // A single nullable number could not tell these two runs apart, and the
    // ambiguity would fall on the side that costs money.
    const stub = resolveExecutionBudget('stub', { firmCeiling: {} })
    expect(stub.cost.kind).toBe('not-applicable')

    const live = resolveExecutionBudget('live', { firmCeiling: {} })
    expect(live.cost.kind).toBe('not-measured')

    expect(stub.cost).not.toEqual(live.cost)
  })
})

/* ------------------------------------------------- the external-work boundary */

describe('the provider boundary', () => {
  it('has committed the start command before the provider could run', async () => {
    /*
     * The runtime half of D-C1C-4.
     *
     * A stand-in provider runs where the orchestrator would call one, and
     * asserts that its own `StartAgentRun` is already a committed ledger entry.
     * If the command's transaction were still open, the entry would not be
     * settled — so this proves the boundary through the public surface rather
     * than by inspecting connections.
     */
    const assignmentId = await seedInstantiatedCase()
    await start(assignmentId, {}, 'cmd-boundary')

    const contribute = async () => {
      const entry = await repositories.commands.find('cmd-boundary')
      expect(entry).not.toBeNull()
      expect(entry!.outcomes.map((o) => o.state)).toEqual(['committed'])

      const runs = await repositories.runs.listForCase('case-1')
      expect(runs[0]!.state).toBe('running')
      return 'contribution'
    }

    await expect(contribute()).resolves.toBe('contribution')
  })
})

/* ------------------------------------------------------------ FailAgentRun */

describe('FailAgentRun', () => {
  let assignmentId: string

  const fail = (over: Record<string, unknown> = {}, cmd = 'cmd-fail') =>
    runCommand(
      failAgentRun(organization),
      {
        caseId: 'case-1',
        runId: deriveRunId('cmd-run', assignmentId),
        departmentId: 'global-macro',
        category: 'provider-timeout' as const,
        retryable: true,
        attempt: 1,
        ...over,
      },
      envelope({
        commandId: cmd,
        reason: 'The macro provider did not answer within the deadline.',
        actor: { kind: 'employee', employeeId: 'macro-analyst' },
      }),
      deps,
    )

  beforeEach(async () => {
    assignmentId = await seedInstantiatedCase()
    await start(assignmentId)
  })

  it('records a bounded failure and nothing else', async () => {
    const result = await fail()
    expect(result.outcome).toBe('committed')

    const run = await repositories.runs.get(deriveRunId('cmd-run', assignmentId))
    expect(run!.state).toBe('failed')
    expect(run!.failure).toEqual({
      category: 'provider-timeout',
      retryable: true,
      attempt: 1,
      at: AT,
    })
    // The record has nowhere to put a provider's own words.
    expect(Object.keys(run!.failure!)).toEqual(['category', 'retryable', 'attempt', 'at'])
  })

  it('requires a reason', async () => {
    const result = await runCommand(
      failAgentRun(organization),
      {
        caseId: 'case-1',
        runId: deriveRunId('cmd-run', assignmentId),
        departmentId: 'global-macro',
        category: 'provider-error' as const,
        retryable: false,
        attempt: 1,
      },
      envelope({
        commandId: 'cmd-fail-noreason',
        actor: { kind: 'employee', employeeId: 'macro-analyst' },
      }),
      deps,
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('returns a retryable assignment to the queue', async () => {
    await fail({ retryable: true })
    expect((await repositories.assignments.get(assignmentId))?.status).toBe('queued')
  })

  it('leaves a non-retryable assignment failed rather than cancelled', async () => {
    await fail({ retryable: false })
    const assignment = await repositories.assignments.get(assignmentId)

    // `cancelled` would attribute a managerial decision to a provider outage.
    expect(assignment?.status).toBe('failed')
  })

  it('lets the department try again after a retryable failure', async () => {
    await fail({ retryable: true })
    const again = await start(assignmentId, {}, 'cmd-run-2')

    expect(again.outcome).toBe('committed')
    expect(
      (await repositories.runs.listForCase('case-1')).filter(
        (r) => !isRunTerminal(r.state),
      ),
    ).toHaveLength(1)
  })

  it('blocks a downstream required entry until its dependency completes', async () => {
    await fail({ retryable: false })

    const aggregationId = deriveAssignmentId('cmd-inst', 'aggregation')
    const downstream = await runCommand(
      startAgentRun(organization),
      startInput(aggregationId, { departmentId: 'research-office' }),
      envelope({ commandId: 'cmd-agg-blocked' }),
      deps,
    )
    // Derived from the graph, not written onto anything by the failure.
    expect(downstream).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
  })

  it('lets a failed OPTIONAL entry leave the required path alone', async () => {
    const quantId = deriveAssignmentId('cmd-inst', 'quant-validation')
    await runCommand(
      startAgentRun(organization),
      startInput(quantId, { departmentId: 'quant-technical' }),
      envelope({
        commandId: 'cmd-quant-run',
        actor: { kind: 'employee', employeeId: 'quant-head' },
      }),
      deps,
    )
    await runCommand(
      failAgentRun(organization),
      {
        caseId: 'case-1',
        runId: deriveRunId('cmd-quant-run', quantId),
        departmentId: 'quant-technical',
        category: 'provider-error' as const,
        retryable: false,
        attempt: 1,
      },
      envelope({
        commandId: 'cmd-quant-fail',
        reason: 'The quant desk could not produce a regime test.',
        actor: { kind: 'employee', employeeId: 'quant-head' },
      }),
      deps,
    )

    // Macro completes; aggregation must still be startable.
    const macroRun = await repositories.runs.get(deriveRunId('cmd-run', assignmentId))
    await repositories.runs.save(
      { ...macroRun!, state: 'completed', completedAt: AT },
      deps.provenance,
    )

    const aggregationId = deriveAssignmentId('cmd-inst', 'aggregation')
    const aggregation = await runCommand(
      startAgentRun(organization),
      startInput(aggregationId, { departmentId: 'research-office' }),
      envelope({ commandId: 'cmd-agg-after-optional-failure' }),
      deps,
    )

    expect(aggregation.outcome).toBe('committed')
    const run = (await repositories.runs.listForCase('case-1')).find(
      (r) => r.execution.playbookEntryKey === 'aggregation',
    )
    // Visible, not silent.
    expect(run!.missingOptionalInputs).toEqual(['quant-validation'])
  })

  it('refuses to fail a run that already settled', async () => {
    await fail({}, 'cmd-fail-a')
    const second = await fail({ attempt: 2 }, 'cmd-fail-b')

    expect(second).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
  })

  it('refuses a completion dressed as a failure', async () => {
    const result = await fail({ state: 'completed' }, 'cmd-fail-completed')
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('records the orchestrator as initiator and the analyst as accountable', async () => {
    await start(assignmentId, {}, 'cmd-init')
    const entry = await repositories.commands.find('cmd-init')

    expect(entry!.intent.initiator).toEqual({
      kind: 'orchestrator',
      orchestratorId: 'macro-orchestrator',
    })
    expect(entry!.intent.actor.employeeId).toBe('macro-analyst')
  })
})

/* ------------------------------------------------------- Risk authority */

describe('who may resolve a conditional Risk requirement', () => {
  /*
   * C1C-3 builds the command; the authority rule it will rely on is asserted
   * here, before anything depends on it. A generic control function must not
   * be able to waive Risk merely by being governance.
   */
  const riskVerdict = { kind: 'governance-verdict', discipline: 'risk' } as const

  it('lets the Risk function decide', () => {
    const actor = resolveActor(organization, SEED, {
      kind: 'employee',
      employeeId: 'chief-risk-officer',
    })
    const decision = authorize(organization, actor, riskVerdict)

    expect(decision.authorized).toBe(true)
    expect(decision.authorized && decision.basis).toBe(
      'governance-department-handles-discipline',
    )
  })

  it('refuses Verification, which is governance but handles verification', () => {
    const actor = resolveActor(organization, SEED, {
      kind: 'employee',
      employeeId: 'verification-head',
    })
    expect(authorize(organization, actor, riskVerdict).authorized).toBe(false)
  })

  it('refuses the Devil’s Advocate', () => {
    const actor = resolveActor(organization, SEED, {
      kind: 'employee',
      employeeId: 'devils-advocate-head',
    })
    expect(authorize(organization, actor, riskVerdict).authorized).toBe(false)
  })

  it('refuses the manager whose desk produced the work', () => {
    const actor = resolveActor(organization, SEED, {
      kind: 'employee',
      employeeId: 'research-director',
    })
    expect(authorize(organization, actor, riskVerdict).authorized).toBe(false)
  })
})

/* -------------------------------------------------------- restart durability */

describe('restart durability', () => {
  it('keeps derived identities stable across a fresh container', async () => {
    const assignmentId = await seedInstantiatedCase()
    await start(assignmentId, {}, 'cmd-durable')
    const before = await repositories.runs.listForCase('case-1')

    // Same command id, computed again after everything is rebuilt.
    expect(deriveRunId('cmd-durable', assignmentId)).toBe(before[0]!.id)
    expect(before[0]!.startedAt).toBe(AT)
    expect(LATER).not.toBe(AT)
  })
})
