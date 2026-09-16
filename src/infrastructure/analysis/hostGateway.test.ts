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
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'

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
