/**
 * The gateway against the in-memory firm: delegation, identity, references.
 *
 * What the fixture suite cannot prove: that an `ask` lands as the operator's
 * act with the host as initiator, that a request cannot choose the actor, that
 * a fresh case surfaces TD-88 as a decision and never as work, that a stale
 * reference is re-read rather than trusted, and that nothing internal leaks.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildRunRecord,
  NON_CONSUMING_BUDGET,
  type AgentRunRecord,
} from '~/domain/analysis'
import { createFinancialOsSystem } from '~/application/analysis/domainSystem'
import { resolveCurrentOperator } from '~/application/analysis/currentOperator'
import {
  createHostGateway,
  HOST_ORCHESTRATOR_ID,
  type HostGateway,
} from '~/application/analysis/hostGateway'
import { parseHostRequest, type HostResult } from '~/application/analysis/hostContract'
import type { CommandDeps } from '~/application/analysis/commands/runCommand'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { DomainReference } from '~/application/analysis/domainSystem'
import { runCommand } from '~/application/analysis/commands/runCommand'
import { startAgentRun } from '~/application/analysis/commands/startAgentRun'
import { recordContribution } from '~/application/analysis/commands/recordContribution'
import { resolveExecutionBudget } from '~/application/analysis/executionBudget'
import { deriveClaimId } from '~/application/analysis/commands/eventIdentity'
import type { AgentClaim, SynthesisArtifact } from '~/domain/analysis'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { createStubContributionProvider } from './providers/stub'
import { EMPLOYEE_BY_DEPARTMENT, TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'

const AT = '2026-09-14T09:00:00.000Z'
const OPERATOR = 'research-director'

let repositories: AnalysisRepositories
let deps: CommandDeps
let gateway: HostGateway
let configured: string | undefined

const question = {
  kind: 'ask' as const,
  requestId: 'req-1',
  question: 'Är Nvidia köpvärd på 12–24 månaders sikt?',
  subject: 'Nvidia',
}

beforeEach(async () => {
  repositories = createInMemoryRepositories()
  deps = {
    repositories,
    organization: TEST_ORGANIZATION,
    organizationSeedVersion: TEST_SEED_VERSION,
    provenance: await repositories.provenance(),
    now: () => AT,
  }
  configured = OPERATOR
  gateway = createHostGateway({
    system: createFinancialOsSystem({
      repositories,
      commandDeps: async () => deps,
      now: () => AT,
    }),
    /* Exactly the server's rule: the configured id, resolved against the firm. */
    operator: async () => resolveCurrentOperator(configured, TEST_ORGANIZATION),
    surfaces: (caseId) => ({
      boardroom: `/cases/${caseId}`,
      record: `/cases/${caseId}/underlag`,
    }),
    orchestratorId: HOST_ORCHESTRATOR_ID,
    now: () => AT,
  })
})

/** A run bounded by a minute of wall clock, started at `startedAt`. */
const runningSince = (
  startedAt: string,
  caseId: string,
  assignment: { id: string; departmentId: string; playbookEntryKey?: string },
): AgentRunRecord =>
  buildRunRecord({
    id: `run-${startedAt}`,
    caseId,
    assignmentId: assignment.id,
    departmentId: assignment.departmentId,
    employeeId: OPERATOR,
    agentContractVersion: '1',
    outputSchemaVersion: '1',
    usage: { state: 'not-applicable' },
    budget: { ...NON_CONSUMING_BUDGET, deadline: { kind: 'limit', deadlineMs: 60_000 } },
    evidenceSetId: 'set-1',
    state: 'running',
    execution: {
      playbookId: 'macro-regime',
      playbookVersion: '1',
      playbookEntryKey: assignment.playbookEntryKey ?? 'macro-analysis',
      providerId: 'recorded-macro',
      providerVersion: '1',
      providerKind: 'recorded',
      identity: {
        kind: 'model',
        prompt: { id: 'p', version: '1', contentHash: 'ph' },
        model: { id: 'm', provider: 'x', parameters: {}, parametersHash: 'mh' },
      },
    },
    missingOptionalInputs: [],
    startedAt,
    events: [{ runId: `run-${startedAt}`, at: startedAt, state: 'running' }],
    claims: [],
  })

const positive = (result: HostResult) => {
  if (result.state === 'unsupported' || result.state === 'failed') {
    throw new Error(JSON.stringify(result))
  }
  return result
}

/* ------------------------------------------------------------- ask */

describe('ask delegates on the operator’s behalf', () => {
  it('surfaces a freshly convened case as TD-88, never as working', async () => {
    const result = positive(await gateway(question))
    expect(result.state).toBe('needs-decision')
    if (result.state !== 'needs-decision') throw new Error(result.state)
    expect(result.decision).toEqual({ reason: 'institutional-initialization-required' })
    expect(result.activity.inFlight).toBe(0)
    expect(result.question).toBe(question.question)
    expect(result.subject).toBe('Nvidia')
    expect(result.surfaces).toEqual({
      boardroom: `/cases/${result.reference.id}`,
      record: `/cases/${result.reference.id}/underlag`,
    })
  })

  it('records the host as initiator and the operator as actor', async () => {
    const result = positive(await gateway(question))
    for (const suffix of ['open', 'convene']) {
      const entry = await repositories.commands.find(`${result.reference.id}-${suffix}`)
      expect(entry, suffix).not.toBeNull()
      expect(entry!.intent.initiator).toEqual({
        kind: 'orchestrator',
        orchestratorId: HOST_ORCHESTRATOR_ID,
      })
      expect(entry!.intent.actor).toMatchObject({
        kind: 'employee',
        employeeId: OPERATOR,
      })
    }
  })

  it('cannot be made to act as anybody the request names', async () => {
    /*
     * The parser is the door, and this is the doctrine at the door: the
     * request field is refused by name, and nothing is created.
     */
    const smuggled = parseHostRequest({
      ...question,
      actingEmployeeId: 'verification-agent',
    })
    expect(smuggled).toEqual({ ok: false, field: 'actingEmployeeId' })
    expect(await repositories.cases.list()).toHaveLength(0)
  })

  it('fails closed when no operator is configured, and creates nothing', async () => {
    configured = undefined
    expect(await gateway(question)).toEqual({
      state: 'failed',
      reason: 'operator-unresolved',
      code: 'NOT_CONFIGURED',
    })
    expect(await repositories.cases.list()).toHaveLength(0)
  })

  it('lands a retried delegation on the same reference', async () => {
    const first = positive(await gateway(question))
    const again = positive(await gateway(question))
    expect(again.reference).toEqual(first.reference)
    expect(await repositories.cases.list()).toHaveLength(1)
  })
})

/* ------------------------------------------------------------ reads */

describe('reads re-read the firm', () => {
  it('derives status from the store, not from the reference it was handed', async () => {
    const asked = positive(await gateway(question))
    const stale = { ...asked.reference, provenanceId: 'something-the-host-remembered' }

    const result = positive(await gateway({ kind: 'status', reference: stale }))
    expect(result.state).toBe('needs-decision')
    /* The reference handed back is the read's, never the one handed in. */
    expect(result.reference.provenanceId).toBe(asked.reference.provenanceId)
    expect(result.reference.provenanceId).not.toBe(stale.provenanceId)
  })

  it('reports working only once a run is genuinely executing', async () => {
    const asked = positive(await gateway(question))
    const caseId = asked.reference.id
    const assignment = (await repositories.assignments.listForCase(caseId))[0]!

    await repositories.runs.save(
      runningSince(AT, caseId, assignment),
      await repositories.provenance(),
    )

    const result = positive(await gateway({ kind: 'status', reference: asked.reference }))
    expect(result.state).toBe('working')
    expect(result.activity.inFlight).toBe(1)
    expect(result.activity.expired).toBe(0)
  })

  it('reports a running row outside its window as blocked on recovery, never as work', async () => {
    /*
     * The orphan the live probe found: a run persisted as `running` by a
     * process that died. Its recorded minute of wall clock ended an hour
     * before "now"; the firm cannot vouch for it, and the host is not told to
     * wait for it — nor is the person asked to decide anything about it. It
     * is the firm's to recover.
     */
    const asked = positive(await gateway(question))
    const caseId = asked.reference.id
    const assignment = (await repositories.assignments.listForCase(caseId))[0]!

    await repositories.runs.save(
      runningSince('2026-09-14T08:00:00.000Z', caseId, assignment),
      await repositories.provenance(),
    )

    const result = positive(await gateway({ kind: 'status', reference: asked.reference }))
    expect(result.state).toBe('blocked')
    if (result.state !== 'blocked') throw new Error(result.state)
    expect(result.block).toMatchObject({
      reason: 'execution-recovery-required',
      owner: { id: assignment.departmentId },
    })
    expect(result.activity.inFlight).toBe(0)
    expect(result.activity.expired).toBe(1)
  })

  it('answers result without an answer where the firm has not decided', async () => {
    const asked = positive(await gateway(question))
    const result = positive(await gateway({ kind: 'result', reference: asked.reference }))
    expect(result.state).toBe('needs-decision')
    expect('answer' in result).toBe(false)
  })

  it('inspects the debate of a case nobody has spoken in yet', async () => {
    const asked = positive(await gateway(question))
    const result = positive(
      await gateway({
        kind: 'inspect',
        reference: asked.reference,
        view: { kind: 'debate' },
      }),
    )
    if (result.inspection?.view !== 'debate') throw new Error('expected debate')
    expect(result.inspection.entries).toHaveLength(0)
    expect(result.inspection.seats.length).toBeGreaterThan(0)
  })

  it('refuses a reference that is not the firm’s', async () => {
    const asked = positive(await gateway(question))
    expect(
      await gateway({
        kind: 'status',
        reference: { ...asked.reference, system: 'financial-os', id: 'case-nope' },
      }),
    ).toEqual({ state: 'unsupported', reason: 'unknown-reference' })
    expect(
      await gateway({
        kind: 'status',
        reference: { ...asked.reference, system: 'other-system' as never },
      }),
    ).toEqual({ state: 'unsupported', reason: 'unknown-reference' })
    expect(
      await gateway({
        kind: 'inspect',
        reference: asked.reference,
        view: { kind: 'desk', departmentId: 'ghost' },
      }),
    ).toMatchObject({ state: 'unsupported', reason: 'unknown-desk' })
  })
})

/* ------------------------------------------------------------- leaks */

describe('nothing internal crosses the contract', () => {
  it('carries no run state, no candidate, no entry key and no command name', async () => {
    const asked = positive(await gateway(question))
    const results = [
      asked,
      await gateway({ kind: 'status', reference: asked.reference }),
      await gateway({ kind: 'result', reference: asked.reference }),
      await gateway({
        kind: 'inspect',
        reference: asked.reference,
        view: { kind: 'debate' },
      }),
      await gateway({
        kind: 'inspect',
        reference: asked.reference,
        view: { kind: 'objections' },
      }),
    ]
    for (const result of results) {
      const text = JSON.stringify(result)
      expect(text).not.toMatch(
        /awaiting-acceptance|illegal-prior-state|payload-conflict|"queued"|"running"|candidate|playbookEntryKey|entryKey|AcceptContribution|Record\w+Review|propose-thesis|aggregate-conclusion|submit-for-|record-verification|record-peer|record-devils|record-risk|resolve-risk|decide-or-return/,
      )
    }
  })

  it('consults no model: the gateway module imports no provider', () => {
    /*
     * `result` is the firm's decision read back, and this is the structural
     * half of that promise: the module that derives it cannot reach a provider.
     */
    const source = readGatewaySource()
    expect(source).not.toMatch(
      /providers\/|createLiveContributionProvider|anthropic|openai/i,
    )
  })
})

function readGatewaySource(): string {
  /* eslint-disable-next-line @typescript-eslint/no-require-imports -- a source read */
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  /* eslint-disable-next-line @typescript-eslint/no-require-imports -- a source read */
  const { resolve } = require('node:path') as typeof import('node:path')
  return readFileSync(
    resolve(process.cwd(), 'src/application/analysis/hostGateway.ts'),
    'utf8',
  )
}

/* ------------------------------------------------- the open case, acted on */

describe('the person acts on their open case', () => {
  const addition = (reference: DomainReference, requestId: string, text = 'Ta hänsyn till dollarn också.') =>
    ({ kind: 'amend', reference, requestId, text }) as const

  it('records an addition as the operator’s act, initiated by the host, beside an unchanged question', async () => {
    const asked = positive(await gateway(question))
    const result = positive(await gateway(addition(asked.reference, 'req-2')))
    /* TD-88 still stands; the addition changed no stage. */
    expect(result.state).toBe('needs-decision')
    expect(result.amendments).toEqual({ count: 1, latestAt: AT, workPredates: false })

    const stored = await repositories.amendments.listForCase(asked.reference.id)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      text: 'Ta hänsyn till dollarn också.',
      byEmployeeId: OPERATOR,
      byDepartmentId: 'research-office',
      at: AT,
    })
    const investmentCase = (await repositories.cases.get(asked.reference.id))!
    expect(stored[0]!.caseVersion).toBe(investmentCase.version)
    expect(investmentCase.question).toBe(question.question)

    const entry = await repositories.commands.find(`${asked.reference.id}-amend-req-2`)
    expect(entry).not.toBeNull()
    expect(entry!.intent.commandType).toBe('AmendCase')
    expect(entry!.intent.initiator).toEqual({
      kind: 'orchestrator',
      orchestratorId: HOST_ORCHESTRATOR_ID,
    })
    expect(entry!.intent.actor).toMatchObject({ kind: 'employee', employeeId: OPERATOR })
  })

  it('lands a retried addition once, and a second addition beside the first', async () => {
    const asked = positive(await gateway(question))
    await gateway(addition(asked.reference, 'req-2'))
    const again = positive(await gateway(addition(asked.reference, 'req-2')))
    expect(again.amendments.count).toBe(1)
    const more = positive(await gateway(addition(asked.reference, 'req-3', 'Och oljan.')))
    expect(more.amendments.count).toBe(2)
    expect(
      (await repositories.amendments.listForCase(asked.reference.id)).map((a) => a.text),
    ).toEqual(['Ta hänsyn till dollarn också.', 'Och oljan.'])
  })

  it('says work predates an addition made after the firm started', async () => {
    const asked = positive(await gateway(question))
    const caseId = asked.reference.id
    const assignment = (await repositories.assignments.listForCase(caseId))[0]!
    /* Started half a minute before the addition, still inside its minute. */
    await repositories.runs.save(
      runningSince('2026-09-14T08:59:30.000Z', caseId, assignment),
      await repositories.provenance(),
    )
    const result = positive(await gateway(addition(asked.reference, 'req-2')))
    expect(result.state).toBe('working')
    expect(result.amendments).toEqual({ count: 1, latestAt: AT, workPredates: true })
  })

  it('closes the case on instruction with the reason, keeps the history, and refuses further acts', async () => {
    const asked = positive(await gateway(question))
    const closed = positive(
      await gateway({ kind: 'close', reference: asked.reference, reason: 'Behövs inte längre.' }),
    )
    expect(closed.state).toBe('closed')
    if (closed.state !== 'closed') throw new Error(closed.state)
    expect(closed.closure).toEqual({
      kind: 'abandoned',
      reason: 'Behövs inte längre.',
      at: AT,
      byDesk: { id: 'research-office', name: expect.any(String), isGovernance: false },
    })

    const stored = (await repositories.cases.get(asked.reference.id))!
    expect(stored.stage).toBe('withdrawn')
    /* The suite's clock is fixed, so every movement shares one instant; find it by its kind. */
    expect(stored.transitions.find((t) => t.to === 'withdrawn')).toMatchObject({
      reason: 'Behövs inte längre.',
      byEmployeeId: OPERATOR,
      byDepartmentId: 'research-office',
    })
    const entry = await repositories.commands.find(
      `${asked.reference.id}-close-v${stored.version - 1}`,
    )
    expect(entry?.intent.commandType).toBe('CloseCase')
    expect(entry?.intent.reason).toBe('Behövs inte längre.')
    expect(entry?.intent.initiator).toEqual({
      kind: 'orchestrator',
      orchestratorId: HOST_ORCHESTRATOR_ID,
    })

    /* Read back later, it is closed; and nothing more enters it. */
    expect(positive(await gateway({ kind: 'status', reference: asked.reference })).state).toBe(
      'closed',
    )
    expect(await gateway(addition(asked.reference, 'req-9'))).toEqual({
      state: 'failed',
      reason: 'case-settled',
      reference: expect.objectContaining({ id: asked.reference.id }),
    })
    expect(await gateway({ kind: 'close', reference: asked.reference, reason: 'igen' })).toEqual({
      state: 'failed',
      reason: 'case-settled',
      reference: expect.objectContaining({ id: asked.reference.id }),
    })
    expect((await repositories.cases.get(asked.reference.id))!.version).toBe(stored.version)
  })

  it('reads a closure as cancelled when work was under way, and still counts what is in flight', async () => {
    const asked = positive(await gateway(question))
    const caseId = asked.reference.id
    const assignment = (await repositories.assignments.listForCase(caseId))[0]!
    await repositories.runs.save(
      runningSince(AT, caseId, assignment),
      await repositories.provenance(),
    )

    const closed = positive(
      await gateway({ kind: 'close', reference: asked.reference, reason: 'Fel fråga.' }),
    )
    if (closed.state !== 'closed') throw new Error(closed.state)
    expect(closed.closure.kind).toBe('cancelled')
    expect(closed.activity.inFlight).toBe(1)
    /* Closed wins over working, whatever the run's window says. */
    expect(positive(await gateway({ kind: 'status', reference: asked.reference })).state).toBe(
      'closed',
    )
  })

  it('needs an operator for either act, and changes nothing without one', async () => {
    const asked = positive(await gateway(question))
    configured = undefined
    const refused = { state: 'failed', reason: 'operator-unresolved', code: 'NOT_CONFIGURED' }
    expect(await gateway(addition(asked.reference, 'req-2'))).toEqual(refused)
    expect(await gateway({ kind: 'close', reference: asked.reference, reason: 'x' })).toEqual(
      refused,
    )
    expect(await repositories.amendments.listForCase(asked.reference.id)).toEqual([])
    expect((await repositories.cases.get(asked.reference.id))!.stage).not.toBe('withdrawn')
  })

  it('refuses a reference that is not the firm’s, for either act', async () => {
    const asked = positive(await gateway(question))
    const elsewhere = { ...asked.reference, id: 'case-nope' }
    expect(await gateway(addition(elsewhere, 'req-2'))).toEqual({
      state: 'unsupported',
      reason: 'unknown-reference',
      reference: elsewhere,
    })
    expect(await gateway({ kind: 'close', reference: elsewhere, reason: 'x' })).toEqual({
      state: 'unsupported',
      reason: 'unknown-reference',
      reference: elsewhere,
    })
  })

  it('carries no command name, version or stage in what comes back', async () => {
    const asked = positive(await gateway(question))
    const results = [
      await gateway(addition(asked.reference, 'req-2')),
      await gateway({ kind: 'close', reference: asked.reference, reason: 'Klart.' }),
      await gateway({ kind: 'status', reference: asked.reference }),
    ]
    for (const result of results) {
      expect(JSON.stringify(result)).not.toMatch(
        /AmendCase|CloseCase|expectedVersion|caseVersion|illegal-prior-state|onBehalfOf/,
      )
      /* The stage word is contract vocabulary in `activity.stage`, and nowhere else. */
      expect(JSON.stringify({ ...result, activity: undefined })).not.toMatch(/"withdrawn"/)
    }
  })
})

describe('the opening, on the person’s behalf (v4, ruled 2026-09-17)', () => {
  const gold = {
    kind: 'ask' as const,
    requestId: 'req-gold',
    question: 'Kolla med kommittén och be dem ta reda på varför guld är upp idag.',
    subject: 'Guld',
  }
  const explanation = { kind: 'explanation' as const, focus: ['makro', 'flöden', 'specifika händelser'] }

  it('proposes revision 1 from the person’s words as the operator’s act, initiated by the host', async () => {
    const asked = positive(await gateway(gold))
    expect(asked.state).toBe('needs-decision')
    const result = positive(await gateway({ kind: 'begin', reference: asked.reference, requestId: 'req-2', opening: explanation }))

    const revisions = await repositories.theses.listForCase(asked.reference.id)
    expect(revisions).toHaveLength(1)
    expect(revisions[0]).toMatchObject({
      revisionNumber: 1,
      statement: `${gold.question} Prövas mot: makro, flöden, specifika händelser.`,
      position: 'explain',
      implications: [],
      proposedByDepartmentId: 'research-office',
      proposedByEmployeeId: OPERATOR,
      revisionCause: 'initial-proposal',
    })
    const entry = await repositories.commands.find(`${asked.reference.id}-begin-req-2`)
    expect(entry).not.toBeNull()
    expect(entry!.intent.commandType).toBe('ProposeThesis')
    expect(entry!.intent.initiator).toEqual({ kind: 'orchestrator', orchestratorId: HOST_ORCHESTRATOR_ID })
    expect(entry!.intent.actor).toMatchObject({ kind: 'employee', employeeId: OPERATOR })

    /* The firm no longer waits for the person; it waits for its desks, and says which. */
    expect(result.state).toBe('blocked')
    expect(result.state === 'blocked' && result.block.reason).toBe('analysis-required')
    expect(result.state === 'blocked' && result.block.owner).not.toBeNull()
    expect(TEST_ORGANIZATION.departments.map((d) => d.id)).toContain(result.state === 'blocked' && result.block.owner?.id)
    /* This firm cannot execute work; the person is told, not promised. */
    expect(result.commission).toEqual({ evidence: null, started: [], adopted: [], withheld: [{ desk: null, reason: 'no-provider' }] })
  })

  it('opens once: a second beginning proposes nothing new and reports the same standing', async () => {
    const asked = positive(await gateway(gold))
    await gateway({ kind: 'begin', reference: asked.reference, requestId: 'req-2', opening: explanation })
    const again = positive(await gateway({ kind: 'begin', reference: asked.reference, requestId: 'req-3', opening: { kind: 'position', focus: [], view: null } }))
    expect(await repositories.theses.listForCase(asked.reference.id)).toHaveLength(1)
    expect(again.state).toBe('blocked')
    expect((await repositories.commands.find(`${asked.reference.id}-begin-req-3`))).toBeNull()
  })

  it('writes the person’s view and the position word read off it, with position-sizing declared', async () => {
    const asked = positive(await gateway(question))
    await gateway({
      kind: 'begin',
      reference: asked.reference,
      requestId: 'req-2',
      opening: { kind: 'position', focus: ['värdering'], view: { statement: 'Jag är negativ till Nvidia, värderingen är för hög.', position: 'reduce' } },
    })
    const revision = (await repositories.theses.listForCase(asked.reference.id))[0]!
    expect(revision.statement).toBe('Jag är negativ till Nvidia, värderingen är för hög. Prövas mot: värdering.')
    expect(revision.position).toBe('reduce')
    expect(revision.implications).toEqual(['position-sizing'])
  })

  it('assembles the standing evidence and reports, truthfully, that the firm holds no observations', async () => {
    const executing = createHostGateway({
      system: createFinancialOsSystem({
        repositories,
        commandDeps: async () => deps,
        now: () => AT,
        advance: { provider: () => createStubContributionProvider(), startWaitMs: 200 },
      }),
      operator: async () => resolveCurrentOperator(configured, TEST_ORGANIZATION),
      surfaces: (caseId) => ({ boardroom: `/cases/${caseId}`, record: `/cases/${caseId}/underlag` }),
      orchestratorId: HOST_ORCHESTRATOR_ID,
      now: () => AT,
    })
    const asked = positive(await executing(gold))
    const result = positive(await executing({ kind: 'begin', reference: asked.reference, requestId: 'req-2', opening: explanation }))
    expect(result.commission).toEqual({ evidence: null, started: [], adopted: [], withheld: [{ desk: null, reason: 'no-observations' }] })
    expect((await repositories.runs.listForCase(asked.reference.id))).toHaveLength(0)
    expect(await repositories.theses.listForCase(asked.reference.id)).toHaveLength(1)
  })

  /**
   * A desk's run left awaiting adoption, produced the way the stub provider
   * produces one: started under the firm's commands, one claim recorded.
   */
  async function awaitingRun(
    caseId: string,
    entryKey: string,
    departmentId: string,
    options: { revisionId?: string; synthesis?: (officeClaimId: string, runId: string) => SynthesisArtifact } = {},
  ): Promise<string> {
    const employeeId = EMPLOYEE_BY_DEPARTMENT[departmentId]!
    const assignment = (await repositories.assignments.listForCase(caseId)).find(
      (candidate) => candidate.playbookEntryKey === entryKey && candidate.departmentId === departmentId,
    )!
    if (!(await repositories.evidence.get('set-host'))) {
      await repositories.evidence.save({
        id: 'set-host',
        assembledAt: AT,
        correlationId: 'corr-host',
        items: [],
        disagreements: [],
        revisions: [],
        coTemporality: { publication: { kind: 'empty' }, reference: { kind: 'empty' } },
      })
    }
    const envelope = (commandId: string) => ({
      commandId,
      correlationId: caseId,
      actor: { kind: 'employee' as const, employeeId },
      initiator: { kind: 'orchestrator' as const, orchestratorId: 'test' },
      occurredAt: AT,
    })
    const startedRun = await runCommand(
      startAgentRun(TEST_ORGANIZATION),
      {
        caseId,
        assignmentId: assignment.id,
        departmentId,
        evidenceSetId: 'set-host',
        ...(options.revisionId ? { revisionId: options.revisionId } : {}),
        providerId: 'stub',
        providerVersion: '1',
        providerKind: 'stub',
        agentContractVersion: '0',
        outputSchemaVersion: '0',
        identity: { kind: 'scenario', scenarioId: 'success', stubVersion: '1' },
        budget: resolveExecutionBudget('stub', { firmCeiling: { deadlineMs: 30_000 } }),
      },
      envelope(`${caseId}-${entryKey}-start`),
      deps,
    )
    if (startedRun.outcome !== 'committed') throw new Error(JSON.stringify(startedRun))
    const runId = startedRun.value.id
    const recordCommandId = `${caseId}-${entryKey}-record`
    const providerClaimId = `${entryKey}-claim`
    const recorded = await runCommand(
      recordContribution(TEST_ORGANIZATION),
      {
        caseId,
        runId,
        departmentId,
        claims: [
          {
            id: providerClaimId,
            type: 'observation',
            statement: `${departmentId} reports on gold`,
            evidenceRefs: [],
            contradictingEvidenceRefs: [],
            confidence: { level: 'insufficient', basis: ['test contribution'], cappedBy: 'no-evidence' },
            temporalScope: { asOf: AT },
            status: 'insufficient-evidence',
          } as AgentClaim,
        ],
        observedStates: ['running'],
        usage: { state: 'not-applicable' },
        ...(options.synthesis ? { synthesis: options.synthesis(deriveClaimId(recordCommandId, providerClaimId), runId) } : {}),
      },
      envelope(recordCommandId),
      deps,
    )
    if (recorded.outcome !== 'committed') throw new Error(JSON.stringify(recorded))
    return runId
  }
  const claimIdOf = (caseId: string, entryKey: string) => deriveClaimId(`${caseId}-${entryKey}-record`, `${entryKey}-claim`)

  it('adopts finished candidate work through the desk’s own principal, and leaves a desk without one waiting', async () => {
    const asked = positive(await gateway(gold))
    const caseId = asked.reference.id
    const macroRun = await awaitingRun(caseId, 'macro-analysis', 'global-macro')
    const quantRun = await awaitingRun(caseId, 'quant-validation', 'quant-technical')
    expect((await repositories.runs.get(macroRun))!.state).toBe('awaiting-acceptance')

    const result = positive(await gateway({ kind: 'begin', reference: asked.reference, requestId: 'req-2', opening: explanation }))
    expect(result.commission!.adopted.map((desk) => desk.id)).toEqual(['global-macro'])
    expect(result.commission!.withheld.some((entry) => entry.desk?.id === 'quant-technical' && entry.reason === 'no-principal')).toBe(true)
    expect((await repositories.runs.get(macroRun))!.state).toBe('completed')
    expect((await repositories.runs.get(quantRun))!.state).toBe('awaiting-acceptance')

    /* The desk's own agent adopted it; JARVIS only initiated; no person pressed anything. */
    const entry = await repositories.commands.find(`agent-accept-${macroRun}`)
    expect(entry).not.toBeNull()
    expect(entry!.intent.commandType).toBe('AcceptContribution')
    expect(entry!.intent.actor).toMatchObject({ kind: 'institutional-agent', agentPrincipalId: 'global-macro-agent' })
    expect(entry!.intent.initiator).toEqual({ kind: 'orchestrator', orchestratorId: HOST_ORCHESTRATOR_ID })
    /* Adopted once: a later beginning finds nothing waiting for that desk. */
    const again = positive(await gateway({ kind: 'begin', reference: asked.reference, requestId: 'req-3', opening: explanation }))
    expect(again.commission!.adopted).toEqual([])
  })

  it('institutionalises the office’s synthesis candidate through the office’s own act, as the revision', async () => {
    const asked = positive(await gateway(gold))
    const caseId = asked.reference.id
    positive(await gateway({ kind: 'begin', reference: asked.reference, requestId: 'req-2', opening: explanation }))
    const opening = (await repositories.theses.listForCase(caseId))[0]!
    /* Both analytical desks, because the office's synthesis waits for both. */
    const macroRun = await awaitingRun(caseId, 'macro-analysis', 'global-macro')
    const ratesRun = await awaitingRun(caseId, 'rates-analysis', 'rates')
    positive(await gateway({ kind: 'begin', reference: asked.reference, requestId: 'req-3', opening: explanation }))
    expect((await repositories.runs.get(macroRun))!.state).toBe('completed')
    expect((await repositories.runs.get(ratesRun))!.state).toBe('completed')

    /* The office's run, thesis-scoped, with the candidate the provider would have produced. */
    const officeRun = await awaitingRun(caseId, 'aggregation', 'research-office', {
      revisionId: opening.revisionId,
      synthesis: (officeClaimId, officeRunId) => ({
        statement: 'Guldets uppgång drivs främst av lägre realräntor.',
        position: 'explain',
        rationale: 'Makro läser räntekurvan som den främsta drivkraften.',
        invalidationCriteria: 'Faller om realräntorna stiger utan att guldet faller.',
        implications: [],
        inputRunIds: [macroRun, ratesRun, officeRunId],
        dispositions: [
          { claimId: claimIdOf(caseId, 'macro-analysis'), disposition: 'adopted-supporting' },
          { claimId: claimIdOf(caseId, 'rates-analysis'), disposition: 'adopted-supporting' },
          { claimId: officeClaimId, disposition: 'adopted-supporting' },
        ],
        optionalInputs: [
          {
            playbookEntryKey: 'quant-validation',
            availability: 'unavailable-at-aggregation',
            materiallyRelevant: false,
            explanation: 'The quant desk had not contributed when this was written.',
          },
        ],
      }),
    })
    const result = positive(await gateway({ kind: 'begin', reference: asked.reference, requestId: 'req-4', opening: explanation }))
    expect(result.commission!.adopted.map((desk) => desk.id)).toEqual(['research-office'])

    const revisions = await repositories.theses.listForCase(caseId)
    expect(revisions.map((revision) => revision.revisionNumber).sort()).toEqual([1, 2])
    const minted = revisions.find((revision) => revision.revisionNumber === 2)!
    expect(minted.statement).toBe('Guldets uppgång drivs främst av lägre realräntor.')
    expect(minted.proposedByAgentPrincipalId).toBe('research-office-agent')
    expect(minted.aggregationId).toBeTruthy()
    for (const commandId of [`agent-accept-${officeRun}`, `office-adopt-${officeRun}`]) {
      const entry = await repositories.commands.find(commandId)
      expect(entry, commandId).not.toBeNull()
      expect(entry!.intent.actor).toMatchObject({ kind: 'institutional-agent', agentPrincipalId: 'research-office-agent' })
      expect(entry!.intent.initiator).toEqual({ kind: 'orchestrator', orchestratorId: HOST_ORCHESTRATOR_ID })
    }
    /* No person's decision anywhere in it, and the firm now owes governance, which nobody here can perform. */
    expect(result.state).toBe('blocked')
  })

  it('refuses a foreign reference, needs an operator, and refuses a settled case', async () => {
    const asked = positive(await gateway(gold))
    expect(
      await gateway({ kind: 'begin', reference: { ...asked.reference, system: 'other' as never }, requestId: 'r', opening: explanation }),
    ).toEqual({ state: 'unsupported', reason: 'unknown-reference' })
    configured = undefined
    expect((await gateway({ kind: 'begin', reference: asked.reference, requestId: 'r', opening: explanation })).state).toBe('failed')
    expect(await repositories.theses.listForCase(asked.reference.id)).toHaveLength(0)
    configured = OPERATOR
    await gateway({ kind: 'close', reference: asked.reference, reason: 'Klart.' })
    expect(await gateway({ kind: 'begin', reference: asked.reference, requestId: 'r2', opening: explanation })).toMatchObject({
      state: 'failed',
      reason: 'case-settled',
    })
  })
})
