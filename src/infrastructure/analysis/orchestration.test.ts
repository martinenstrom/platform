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
import { ContributionFailure } from '~/application/analysis/contributionPort'
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

/**
 * The entries that reached a provider and produced work in this pass.
 *
 * Derived, never hardcoded. A single pass ends at the first human checkpoint,
 * so which entries run depends on the playbook's shape — and a hand-written
 * list would turn every one of these tests into an assertion about the
 * scheduler rather than about the boundary.
 */
const producedIn = (result: OrchestrationResult) =>
  result.outcomes
    .filter((o) => o.state === 'awaiting-acceptance')
    .map((o) => o.entryKey)
    .sort()

/** The entries that could not run because somebody has not accepted yet. */
const waitingIn = (result: OrchestrationResult) =>
  result.outcomes
    .filter((o) => o.state === 'waiting-for-dependencies')
    .map((o) => o.entryKey)
    .sort()

/* ------------------------------------------------------------ the whole graph */

describe('running a playbook', () => {
  it('stops at the human acceptance checkpoint, and says what it is waiting for', async () => {
    /*
     * The boundary, encoded rather than described.
     *
     * A dependency is satisfied by **accepted** claims. Produced work is
     * operational: it may be inspected, accepted or rejected, and it does not
     * unlock institutional work downstream — an agent chain must not build on a
     * premise no human has agreed belongs in the record.
     *
     * So a live multi-step playbook stops at each checkpoint. That is
     * deliberate for the first live-agent phase, and it is NOT a permanent
     * removal of multi-step workflows: the eventual capability is checkpointed
     * orchestration that resumes from newly eligible entries after acceptance,
     * without replaying completed work. Recorded as TD-72 rather than smuggled
     * in here.
     */
    const result = await run(createStubContributionProvider())

    /*
     * NOTHING completed. The two entries with nothing upstream of them
     * produced work, and producing is not completing — completion is what a
     * human grants.
     */
    expect([...result.completedKeys]).toEqual([])

    const produced = result.outcomes.filter(
      (outcome) => outcome.state === 'awaiting-acceptance',
    )
    /*
     * Exactly the entries with nothing blocking them. Derived from the playbook
     * rather than hardcoded: which of them land in one wave depends on
     * concurrency, and a list written by hand would be asserting the scheduler
     * rather than the boundary.
     */
    const independent = MACRO_REGIME_PLAYBOOK.entries
      .filter((entry) => entry.blockedBy.length === 0)
      .map((entry) => entry.key)
      .sort()
    expect(produced.map((outcome) => outcome.entryKey).sort()).toEqual(independent)

    /*
     * And the rest are visibly WAITING, not missing and not failed. An entry
     * absent from the outcomes would be indistinguishable from one the playbook
     * never contained.
     */
    const waiting = result.outcomes.filter(
      (outcome) => outcome.state === 'waiting-for-dependencies',
    )
    /* And everything else is visibly waiting — nothing is silently absent. */
    const dependent = MACRO_REGIME_PLAYBOOK.entries
      .filter((entry) => entry.blockedBy.length > 0)
      .map((entry) => entry.key)
      .sort()
    expect(waiting.map((outcome) => outcome.entryKey).sort()).toEqual(dependent)

    /* Nothing failed. Waiting on a person is not an error. */
    expect(result.outcomes.filter((outcome) => outcome.state === 'failed')).toEqual([])

    /* The reason is readable: which upstream work is awaiting acceptance. */
    const anyWaiting = waiting.find((outcome) => outcome.awaitingAcceptanceOf)!
    expect(anyWaiting).toBeDefined()
    for (const key of anyWaiting.awaitingAcceptanceOf!) {
      expect(independent).toContain(key)
    }

    /* The produced work is real, durable, and not yet institutional. */
    const runs = await repositories.runs.listForCase('case-1')
    const pendingRuns = runs.filter((entry) => entry.state === 'awaiting-acceptance')
    expect(pendingRuns).toHaveLength(independent.length)
    expect(await repositories.claims.listForCase('case-1')).toEqual([])
    for (const pending of pendingRuns) {
      expect(
        (await repositories.producedClaims.listForRun(pending.id)).length,
      ).toBeGreaterThan(0)
    }
  })

  it('leaves a command behind every durable effect, and none behind work that never ran', async () => {
    const result = await run(createStubContributionProvider())

    /*
     * Derived from the outcomes rather than hardcoded. Which entries reach a
     * provider in one pass is the checkpoint's business; a list written by hand
     * would assert the scheduler instead of the rule.
     */
    const produced = producedIn(result)
    expect(produced.length).toBeGreaterThan(0)

    for (const key of produced) {
      const entry = MACRO_REGIME_PLAYBOOK.entries.find((e) => e.key === key)!
      for (const act of ['start', 'record'] as const) {
        const ledger = await repositories.commands.find(`cmd-${key}-${act}`)
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

    /*
     * And the converse, which the checkpoint makes worth stating: an entry
     * waiting on a person left NOTHING in the ledger. Work that did not happen
     * must not have a command behind it claiming that it did.
     */
    const waiting = waitingIn(result)
    expect(waiting.length).toBeGreaterThan(0)
    for (const key of waiting) {
      for (const act of ['start', 'record'] as const) {
        expect(await repositories.commands.find(`cmd-${key}-${act}`)).toBeNull()
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

  it('passes no unaccepted work downstream, to anyone', async () => {
    /*
     * The input side of the same boundary.
     *
     * `quant-validation` declares `macro-analysis` as an optional input, and
     * macro-analysis produces its work in this very pass. It is still not
     * passed on: a dependency — blocking or optional — is satisfied by
     * ACCEPTED claims, and nobody has accepted anything yet.
     *
     * Absent rather than empty, too, which is a distinction the orchestrator
     * makes deliberately: a contributor can tell "the macro desk found nothing"
     * from "the macro desk has not contributed", and an empty list would erase
     * that difference.
     *
     * What this test can no longer reach is a DEPENDENT desk receiving exactly
     * its declared edges — aggregation never starts, because the pass ends at
     * the checkpoint above it. That coverage returns with TD-72; the rule
     * itself is still enforced by `runEntry`, which builds `inputs` only from
     * `blockedBy` and `optionalInputs`.
     */
    const seen = new Map<string, Record<string, readonly unknown[]>>()
    const provider = spy((request) => {
      seen.set(request.departmentId, request.inputs)
    })

    const result = await run(provider)

    // Only the entries with nothing upstream of them were ever invoked.
    const invokedDepartments = MACRO_REGIME_PLAYBOOK.entries
      .filter((entry) => producedIn(result).includes(entry.key))
      .map((entry) => entry.departmentId)
      .sort()
    expect([...seen.keys()].sort()).toEqual(invokedDepartments)

    // And not one of them was handed anything at all.
    for (const [departmentId, inputs] of seen) {
      expect({ departmentId, inputs: Object.keys(inputs) }).toEqual({
        departmentId,
        inputs: [],
      })
    }
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
    const first = await run(createStubContributionProvider())
    const replay = await run(createStubContributionProvider())

    /*
     * Re-invoking replays; it does not resume. Both passes stop at the same
     * checkpoint and produce the same outcome, because the deterministic
     * command ids resolve from the ledger instead of starting the work a
     * second time. Resuming from newly accepted work is TD-72.
     */
    expect(producedIn(replay)).toEqual(producedIn(first))
    expect(producedIn(first).length).toBeGreaterThan(0)

    // Same command ids: the same runs, not a second set beside them.
    expect(await repositories.runs.listForCase('case-1')).toHaveLength(
      producedIn(first).length,
    )
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

    const result = await run(provider)

    // One reading per entry that actually reached the provider, and at least
    // one — an empty list would satisfy `every` while proving nothing.
    expect(seenByProvider).toHaveLength(producedIn(result).length)
    expect(seenByProvider.length).toBeGreaterThan(0)
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

    /*
     * What makes an optional entry optional: its failure blocks nothing.
     * Nothing declares `quant-validation` as a BLOCKING dependency, so no entry
     * is blocked by it — and the required desk produced its work regardless.
     */
    expect([...result.blockedKeys]).toEqual([])
    expect(outcomeFor(result, 'macro-analysis')).toMatchObject({
      state: 'awaiting-acceptance',
    })

    /*
     * Aggregation is waiting on a PERSON, not on the desk that fell over. The
     * distinction is the whole reason `awaitingAcceptanceOf` is recorded: "the
     * quant desk failed" and "somebody has to read the macro desk's work" send
     * a reader to two different places.
     */
    expect(outcomeFor(result, 'aggregation')).toMatchObject({
      state: 'waiting-for-dependencies',
      awaitingAcceptanceOf: ['macro-analysis'],
    })

    // An optional entry is never on the required path, failed or not.
    expect(result.missingRequired).not.toContain('quant-validation')
  })

  it('records the category the provider classified, not a generic one', async () => {
    /*
     * The regression. The orchestrator used to wrap the call in `isolate`,
     * which turned every throw into one market-data envelope, and then
     * hard-coded `provider-error` — so an auth rejection, unparseable output
     * and missing evidence all reached the record as the same category. The
     * live client was classifying correctly the whole time; the seam above it
     * discarded the answer.
     *
     * `evidence-unavailable` is used deliberately: nothing else in the
     * orchestrator can produce it, so seeing it on the run proves it came from
     * the provider rather than from a coincidence upstream.
     */
    const classifying: ContributionProvider = {
      id: 'classifying',
      version: '1',
      kind: 'stub',
      declare: () => ({
        agentContractVersion: '0',
        outputSchemaVersion: '0',
        identity: { kind: 'scenario', scenarioId: 'success', stubVersion: '1' },
      }),
      contribute: () => {
        throw new ContributionFailure('evidence-unavailable')
      },
    }

    const result = await run(classifying)

    expect(outcomeFor(result, 'macro-analysis')).toMatchObject({
      state: 'failed',
      failureCategory: 'evidence-unavailable',
    })
    const failed = (await repositories.runs.listForCase('case-1')).find(
      (r) => r.departmentId === 'global-macro',
    )
    expect(failed!.failure).toMatchObject({ category: 'evidence-unavailable' })
  })

  it('records provider-error when the provider does not say why it failed', async () => {
    // The near-miss: an unclassified throw must still land somewhere bounded,
    // and must not borrow a category the provider never claimed.
    const opaque: ContributionProvider = {
      id: 'opaque',
      version: '1',
      kind: 'stub',
      declare: () => ({
        agentContractVersion: '0',
        outputSchemaVersion: '0',
        identity: { kind: 'scenario', scenarioId: 'success', stubVersion: '1' },
      }),
      contribute: () => {
        throw new Error('something went wrong inside the provider')
      },
    }

    const result = await run(opaque)

    expect(outcomeFor(result, 'macro-analysis')).toMatchObject({
      state: 'failed',
      failureCategory: 'provider-error',
    })
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
