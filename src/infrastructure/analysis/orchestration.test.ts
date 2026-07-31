/**
 * C1C-2: the orchestrator as a command caller.
 *
 * It used to write through repositories directly. It now issues `StartAgentRun`,
 * calls the provider outside any transaction, and issues `RecordContribution`
 * or `FailAgentRun` — which is what makes every durable effect an act with an
 * actor, an authority and a ledger entry behind it.
 *
 * Three protections stand behind D-C1C-4. Two are fitness rules in
 * `src/test/importGraph.test.ts`: a command cannot import the provider port,
 * and the orchestrator cannot import a repository port. The third is here — a
 * provider that reads the command ledger mid-flight and asserts its own start
 * command is already committed, which is only true if the transaction closed
 * before it ran.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import {
  deriveAssignmentId,
  deriveRevisionId,
} from '~/application/analysis/commands/eventIdentity'
import { openInvestmentCase } from '~/application/analysis/commands/openInvestmentCase'
import { instantiatePlaybook } from '~/application/analysis/commands/instantiatePlaybook'
import { proposeThesis } from '~/application/analysis/commands/proposeThesis'
import { MACRO_REGIME_PLAYBOOK } from '~/application/analysis/macroPlaybook'
import {
  runPlaybook,
  type OrchestrationContext,
  type OrchestrationResult,
} from '~/application/analysis/orchestrator'
import type {
  ContributionProvider,
  ContributionResult,
} from '~/application/analysis/contributionPort'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { createStubContributionProvider } from './providers'
import {
  EMPLOYEE_BY_DEPARTMENT,
  TEST_ORGANIZATION,
  TEST_SEED_VERSION,
} from './testOrganization'

const AT = '2026-07-29T09:00:00.000Z'
const organization = TEST_ORGANIZATION
const EVIDENCE_SET_ID = 'set-1'

let repositories: AnalysisRepositories
let deps: CommandDeps

const envelope = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: 'cmd-1',
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'employee', employeeId: 'research-director' },
  occurredAt: AT,
  ...over,
})

beforeEach(async () => {
  repositories = createInMemoryRepositories()
  deps = {
    repositories,
    organization,
    organizationSeedVersion: TEST_SEED_VERSION,
    provenance: await repositories.provenance(),
    now: () => AT,
  }

  await repositories.evidence.save({
    id: EVIDENCE_SET_ID,
    assembledAt: AT,
    correlationId: 'corr-1',
    items: [],
    disagreements: [],
    coTemporality: { kind: 'empty' },
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
})

const context = (over: Partial<OrchestrationContext> = {}): OrchestrationContext => ({
  caseId: 'case-1',
  evidenceSetId: EVIDENCE_SET_ID,
  assignmentIdFor: (key) => deriveAssignmentId('cmd-inst', key),
  employeeIdFor: (department) => EMPLOYEE_BY_DEPARTMENT[department]!,
  // Deterministic, which is what makes a re-run resolve from the ledger
  // instead of starting the work a second time.
  commandIdFor: (key, act) => `cmd-${key}-${act}`,
  correlationId: 'corr-1',
  orchestratorId: 'macro-orchestrator',
  now: () => new Date(AT),
  revisionIsCurrent: () => true,
  ...over,
})

const options = { stageDeadlineMs: 1000, maxConcurrency: 4 }

const run = (
  provider: ContributionProvider,
  over: Partial<OrchestrationContext> = {},
): Promise<OrchestrationResult> =>
  runPlaybook(MACRO_REGIME_PLAYBOOK, provider, context(over), options, deps)

const outcomeFor = (result: OrchestrationResult, key: string) =>
  result.outcomes.find((o) => o.entryKey === key)

/* ------------------------------------------------------------ the whole graph */

describe('running a playbook', () => {
  it('carries every entry through to a completed run', async () => {
    const result = await run(createStubContributionProvider())

    expect([...result.completedKeys].sort()).toEqual([
      'aggregation',
      'challenge',
      'macro-analysis',
      'quant-validation',
      'risk-review',
      'verification',
    ])
    expect(result.missingRequired).toEqual([])

    const runs = await repositories.runs.listForCase('case-1')
    expect(runs).toHaveLength(6)
    expect(runs.every((r) => r.state === 'completed')).toBe(true)
  })

  it('leaves a command behind every durable effect', async () => {
    await run(createStubContributionProvider())

    for (const entry of MACRO_REGIME_PLAYBOOK.entries) {
      for (const act of ['start', 'record'] as const) {
        const ledger = await repositories.commands.find(`cmd-${entry.key}-${act}`)
        expect(ledger?.outcomes.map((o) => o.state)).toEqual(['committed'])
        // Who set it in motion is not who is accountable for it.
        expect(ledger!.intent.initiator).toEqual({
          kind: 'orchestrator',
          orchestratorId: 'macro-orchestrator',
        })
        expect(ledger!.intent.actor.employeeId).toBe(
          EMPLOYEE_BY_DEPARTMENT[entry.departmentId],
        )
      }
    }
  })

  it('records what produced the work, and that it is not live', async () => {
    await run(createStubContributionProvider())
    const runs = await repositories.runs.listForCase('case-1')

    for (const record of runs) {
      expect(record.execution.providerId).toBe('stub')
      expect(record.execution.providerKind).toBe('stub')
      expect(record.execution.playbookVersion).toBe('1')
    }
  })

  it('passes only declared dependency outputs downstream', async () => {
    const seen: Array<Record<string, unknown>> = []
    const provider = spy((request) => {
      if (request.departmentId === 'research-office') seen.push(request.inputs)
    })

    await run(provider)

    // Aggregation declared `macro-analysis` blocking and `quant-validation`
    // optional. It must not receive verification, challenge or risk.
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual([
      'macro-analysis',
      'quant-validation',
    ])
  })

  it('runs independent desks in the same wave', async () => {
    let inFlight = 0
    let peak = 0
    const provider = spy(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight -= 1
    })

    await run(provider)
    // Macro and quant have no blocking dependency on each other.
    expect(peak).toBeGreaterThan(1)
  })

  it('resolves a re-run from the ledger instead of starting the work again', async () => {
    await run(createStubContributionProvider())
    const replay = await run(createStubContributionProvider())

    expect(replay.completedKeys).toHaveLength(6)
    // Same command ids: six runs, not twelve.
    expect(await repositories.runs.listForCase('case-1')).toHaveLength(6)
  })
})

/* ------------------------------------------------------- the durable boundary */

describe('the external-work boundary', () => {
  it('has committed the start command before the provider runs', async () => {
    /*
     * The runtime half of D-C1C-4. The provider reads the ledger from the same
     * store the command wrote to: if the command's transaction were still
     * open, its outcome would not yet be settled.
     */
    const seenByProvider: string[][] = []
    const provider = spy(async (request) => {
      const ledger = await repositories.commands.find(
        `cmd-${entryKeyFor(request.departmentId)}-start`,
      )
      seenByProvider.push((ledger?.outcomes ?? []).map((o) => o.state))
    })

    await run(provider)

    expect(seenByProvider).toHaveLength(6)
    expect(seenByProvider.every((states) => states.join() === 'committed')).toBe(true)
  })

  it('has the run already running and the assignment already taken', async () => {
    const states: Array<string | undefined> = []
    const provider = spy(async (request) => {
      const runs = await repositories.runs.listForCase('case-1')
      states.push(runs.find((r) => r.departmentId === request.departmentId)?.state)
    })

    await run(provider)
    expect(states.every((state) => state === 'running')).toBe(true)
  })
})

/* ------------------------------------------------------------------ failure */

describe('when the provider does not deliver', () => {
  it('settles the run as failed and blocks what depended on it', async () => {
    const result = await run(
      createStubContributionProvider({
        outcomes: { 'global-macro': { kind: 'failure' } },
      }),
    )

    expect(outcomeFor(result, 'macro-analysis')).toMatchObject({
      state: 'failed',
      failureCategory: 'provider-error',
    })
    expect(result.missingRequired).toContain('macro-analysis')

    const runs = await repositories.runs.listForCase('case-1')
    const failed = runs.find((r) => r.departmentId === 'global-macro')
    expect(failed!.state).toBe('failed')
    expect(failed!.failure).toMatchObject({
      category: 'provider-error',
      retryable: false,
      attempt: 1,
    })

    // Downstream is blocked, and nothing wrote that onto it: StartAgentRun
    // refuses an entry whose blocking dependency has not completed.
    expect([...result.blockedKeys].sort()).toEqual([
      'aggregation',
      'challenge',
      'risk-review',
      'verification',
    ])
    expect(runs.some((r) => r.departmentId === 'research-office')).toBe(false)
  })

  it('leaves an optional desk’s failure off the required path', async () => {
    const result = await run(
      createStubContributionProvider({
        outcomes: { 'quant-technical': { kind: 'failure' } },
      }),
    )

    expect(result.failedKeys).toContain('quant-validation')
    expect(result.missingRequired).toEqual([])
    expect(result.completedKeys).toContain('aggregation')

    // Absent, and visible as absent.
    const aggregation = (await repositories.runs.listForCase('case-1')).find(
      (r) => r.execution.playbookEntryKey === 'aggregation',
    )
    expect(aggregation!.missingOptionalInputs).toEqual(['quant-validation'])
  })

  it('times a hung provider out rather than waiting', async () => {
    vi.useFakeTimers()
    try {
      const pending = run(
        createStubContributionProvider({
          outcomes: { 'global-macro': { kind: 'timeout' } },
        }),
      )
      await vi.advanceTimersByTimeAsync(1500)
      const result = await pending

      expect(outcomeFor(result, 'macro-analysis')).toMatchObject({
        state: 'timed-out',
        failureCategory: 'provider-timeout',
      })
      const failed = (await repositories.runs.listForCase('case-1')).find(
        (r) => r.departmentId === 'global-macro',
      )
      // A timeout may be transient, so the work goes back to the queue.
      expect(failed!.failure).toMatchObject({ retryable: true })
      expect((await repositories.assignments.get(macroAssignment()))!.status).toBe(
        'queued',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses inadmissible output and settles the run rather than storing it', async () => {
    const result = await run(
      createStubContributionProvider({
        outcomes: { 'global-macro': { kind: 'malformed' } },
      }),
    )

    expect(outcomeFor(result, 'macro-analysis')).toMatchObject({
      state: 'failed',
      failureCategory: 'malformed-output',
      rejection: 'invariant-violated',
    })
    // Nothing stored, and no run left running.
    expect(await repositories.claims.listForCase('case-1')).toEqual([])
    const macro = (await repositories.runs.listForCase('case-1')).find(
      (r) => r.departmentId === 'global-macro',
    )
    expect(macro!.state).toBe('failed')
  })

  it('treats a contribution with no claims the same way', async () => {
    const result = await run(
      createStubContributionProvider({
        outcomes: { 'global-macro': { kind: 'silent' } },
      }),
    )
    expect(outcomeFor(result, 'macro-analysis')).toMatchObject({
      failureCategory: 'malformed-output',
    })
  })

  it('refuses a provider that answers against a contract it did not declare', async () => {
    const provider = spy(undefined, (result) => ({
      ...result,
      outputSchemaVersion: '99',
    }))

    const result = await run(provider)
    expect(outcomeFor(result, 'macro-analysis')).toMatchObject({
      state: 'failed',
      failureCategory: 'schema-violation',
    })
  })
})

/* --------------------------------------------------------------- superseded */

describe('when the thesis moves while a desk is working', () => {
  it('settles the run as superseded rather than attaching the result', async () => {
    await runCommand(
      proposeThesis(organization),
      {
        caseId: 'case-1',
        thesisId: 'thesis-1',
        statement: 'The ECB cuts in March',
        position: 'directional',
        invalidationCriteria: 'Core inflation above 3% in February',
        implications: [],
        proposedByDepartmentId: 'research-office',
      },
      envelope({ commandId: 'cmd-thesis' }),
      deps,
    )

    // The revision is current when the work starts and is replaced while it
    // runs, which is the only way this can happen for real.
    const result = await run(createStubContributionProvider(), {
      revisionId: deriveRevisionId('cmd-thesis', 'thesis-1'),
      revisionIsCurrent: () => false,
    })

    const macro = outcomeFor(result, 'macro-analysis')
    expect(macro).toMatchObject({
      state: 'superseded',
      obsolete: true,
      failureCategory: 'revision-superseded',
    })
    expect(result.completedKeys).not.toContain('macro-analysis')

    const stored = (await repositories.runs.listForCase('case-1')).find(
      (r) => r.departmentId === 'global-macro',
    )
    expect(stored!.state).toBe('superseded')
    // The desk did nothing wrong; the firm moved the thesis out from under it.
    expect((await repositories.assignments.get(macroAssignment()))!.status).toBe(
      'cancelled',
    )
    expect(await repositories.claims.listForCase('case-1')).toEqual([])
  })
})

/* ------------------------------------------------------------------ helpers */

const macroAssignment = () => deriveAssignmentId('cmd-inst', 'macro-analysis')

const ENTRY_BY_DEPARTMENT = Object.fromEntries(
  MACRO_REGIME_PLAYBOOK.entries.map((entry) => [entry.departmentId, entry.key]),
)
const entryKeyFor = (departmentId: string) => ENTRY_BY_DEPARTMENT[departmentId]

/**
 * A provider that behaves like the stub and lets a test watch or bend it.
 *
 * Built on the stub rather than hand-rolled so that what it returns stays
 * admissible: a test provider drifting into output the firm would refuse makes
 * every assertion around it meaningless.
 */
function spy(
  observe?: (request: Parameters<ContributionProvider['contribute']>[0]) => unknown,
  transform?: (result: ContributionResult) => ContributionResult,
): ContributionProvider {
  const inner = createStubContributionProvider()
  return {
    ...inner,
    async contribute(request) {
      await observe?.(request)
      const result = await inner.contribute(request)
      return transform ? transform(result) : result
    },
  }
}
