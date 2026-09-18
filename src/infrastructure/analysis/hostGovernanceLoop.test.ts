/**
 * The institutional loop, from the person's word to the committee's
 * conclusion, against the in-memory firm with stub producers (G1, 2026-09-17).
 *
 * What the live proof cannot prove on its own: that every act between the
 * person's instruction and the committee's conclusion is performed by the
 * principal whose act it is — initiated by the host, never acted by it; that
 * the conclusion is reached with no further turn from the person; that the
 * CIO is never submitted to; and that the firm stops visibly, without
 * arguing with itself or paying to be refused twice, at a material
 * objection, a control function without a principal, and a provider that
 * does not deliver.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { buildEvidenceSet, observationRef, type AgentClaim } from '~/domain/analysis'
import { createFinancialOsSystem } from '~/application/analysis/domainSystem'
import { resolveCurrentOperator } from '~/application/analysis/currentOperator'
import {
  createHostGateway,
  HOST_ORCHESTRATOR_ID,
  type HostGateway,
} from '~/application/analysis/hostGateway'
import type { HostResult } from '~/application/analysis/hostContract'
import type { CommandDeps } from '~/application/analysis/commands/runCommand'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { ContributionProvider } from '~/application/analysis/contributionPort'
import type { SynthesisContext } from '~/application/analysis/synthesisContext'
import type { GovernanceKind } from '~/application/analysis/governanceContext'
import { standingForCase } from '~/application/analysis/caseStandingFor'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { createStubContributionProvider } from './providers/stub'
import { createStubGovernanceProvider, type StubGovernanceOutcome } from './providers/stubGovernance'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'

const AT = '2026-09-17T09:00:00.000Z'
const OPERATOR = 'research-director'

/** The retained gold instruction, as the person says it. */
const gold = {
  kind: 'ask' as const,
  requestId: 'req-gold',
  question: 'Kolla med kommittén och be dem ta reda på varför guld är upp idag.',
  subject: 'Guld',
}
const explanation = { kind: 'explanation' as const, focus: ['makro', 'flöden', 'specifika händelser'] }

let repositories: AnalysisRepositories
let deps: CommandDeps
let outcomes: Record<GovernanceKind, StubGovernanceOutcome>
/** What the firm's passes reported, kept so a stall explains itself. */
let trace: string[]

beforeEach(async () => {
  repositories = createInMemoryRepositories()
  deps = {
    repositories,
    organization: TEST_ORGANIZATION,
    organizationSeedVersion: TEST_SEED_VERSION,
    provenance: await repositories.provenance(),
    now: () => AT,
  }
  trace = []
  outcomes = {
    verification: { kind: 'verify' },
    'devils-advocate': { kind: 'object', materiality: 'non-material' },
    'peer-examination': { kind: 'silent' },
  }
})

/** The office's synthesis, produced the way a stub produces one: from the record it was handed. */
const synthesisStub = (loadContext: () => Promise<SynthesisContext>): ContributionProvider => ({
  id: 'stub-synthesis',
  version: '1',
  kind: 'stub',
  declare: () => ({
    agentContractVersion: '0',
    outputSchemaVersion: '0',
    identity: { kind: 'scenario', scenarioId: 'synthesis', stubVersion: '1' },
  }),
  contribute: async () => {
    const context = await loadContext()
    const claim: AgentClaim = {
      id: 'stub-office',
      type: 'observation',
      statement: 'The office reconciles the desks.',
      evidenceRefs: [],
      contradictingEvidenceRefs: [],
      confidence: { level: 'insufficient', basis: ['stub'], cappedBy: 'no-evidence' },
      temporalScope: { asOf: AT },
      status: 'insufficient-evidence',
    }
    return {
      claims: [claim],
      synthesis: {
        statement: 'Guldets uppgång drivs främst av lägre realräntor.',
        position: 'explain',
        rationale: 'Makro och Rates läser räntekurvan som den främsta drivkraften.',
        invalidationCriteria: 'Faller om realräntorna stiger utan att guldet faller.',
        implications: [],
        inputRunIds: [...new Set(context.inputs.map((input) => input.runId))],
        dispositions: context.inputs.flatMap((input) =>
          input.claimIds.map((claimId) => ({ claimId, disposition: 'adopted-supporting' as const })),
        ),
        optionalInputs: context.absentOptionalInputs.map((absent) => ({
          playbookEntryKey: absent.playbookEntryKey,
          availability: 'unavailable-at-aggregation' as const,
          materiallyRelevant: false,
          explanation: 'Not contributed.',
        })),
      },
      agentContractVersion: '0',
      outputSchemaVersion: '0',
      usage: { state: 'not-applicable' },
      observedStates: ['running'],
    }
  },
})

/** The firm as the product wires it, with every producer a stub. */
function firm(): HostGateway {
  return createHostGateway({
    system: createFinancialOsSystem({
      repositories,
      commandDeps: async () => deps,
      now: () => AT,
      advance: {
        provider: () => createStubContributionProvider(),
        synthesisProvider: (loadContext) => synthesisStub(loadContext),
        governanceProvider: (kind, loadContext) =>
          createStubGovernanceProvider({ kind, outcome: outcomes[kind], loadContext: () => loadContext() }),
        startWaitMs: 50,
        log: (line) => trace.push(line),
      },
    }),
    operator: async () => resolveCurrentOperator(OPERATOR, TEST_ORGANIZATION),
    surfaces: (caseId) => ({ boardroom: `/cases/${caseId}`, record: `/cases/${caseId}/underlag` }),
    orchestratorId: HOST_ORCHESTRATOR_ID,
    now: () => AT,
  })
}

const positive = (result: HostResult) => {
  if (result.state === 'unsupported' || result.state === 'failed') throw new Error(JSON.stringify(result))
  return result
}

/** The standing evidence the firm would assemble, held for the case so the desks can be handed it. */
async function evidenceFor(caseId: string): Promise<void> {
  await repositories.evidence.save(
    buildEvidenceSet({
      items: [
        {
          ref: observationRef(
            { subjectKind: 'series', subject: 'US10Y', kind: 'yield', observedAt: AT, referencePeriod: '2026-09-16', sourceId: 'treasury' },
            { yieldPercent: '4.1', changeBasisPoints: null, observationDate: '2026-09-16' },
          ),
          value: { yieldPercent: '4.1', changeBasisPoints: null, observationDate: '2026-09-16', unit: 'percent' },
          provenance: { source: { providerId: 'test' }, quality: 'ok' } as never,
        },
      ],
      assembledAt: AT,
      correlationId: caseId,
    }),
  )
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Waits for the firm's own passes to bring the record to a condition, or says what it found instead. */
async function until(condition: () => Promise<boolean>, describe: () => Promise<unknown>, ms = 4_000): Promise<void> {
  const deadline = Date.now() + ms
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`did not settle: ${JSON.stringify(await describe())}` + String.fromCharCode(10) + trace.join(String.fromCharCode(10)))
    }
    await sleep(20)
  }
}

/** The person's two acts — the instruction and the word to begin — and nothing else. */
async function begun(gateway: HostGateway) {
  const asked = positive(await gateway(gold))
  const caseId = asked.reference.id
  await evidenceFor(caseId)
  const result = positive(
    await gateway({ kind: 'begin', reference: asked.reference, requestId: 'req-begin', opening: explanation }),
  )
  return { caseId, reference: asked.reference, result }
}

const runsOf = (caseId: string) => repositories.runs.listForCase(caseId)
const runFor = async (caseId: string, entryKey: string) =>
  (await runsOf(caseId)).find((run) => run.execution.playbookEntryKey === entryKey)!

describe('from the person’s word to the committee’s conclusion', () => {
  it('reaches the conclusion with no further turn, every act by its own principal, none by the host, and the CIO not submitted to', async () => {
    const gateway = firm()
    const { caseId, reference, result } = await begun(gateway)
    expect(result.commission!.started.map((desk) => desk.id).sort(), JSON.stringify(result.commission)).toEqual(['global-macro', 'rates'])

    await until(
      async () => (await gateway({ kind: 'status', reference })).state === 'answer-ready',
      () => gateway({ kind: 'status', reference }),
    )
    const answer = positive(await gateway({ kind: 'result', reference }))
    if (answer.state !== 'answer-ready' || answer.answer?.kind !== 'committee-conclusion') {
      throw new Error(JSON.stringify(answer))
    }
    expect(answer.answer.thesis.statement).toBe('Guldets uppgång drivs främst av lägre realräntor.')
    expect(answer.answer.scrutiny).toMatchObject({ verification: 'verified', peerExaminations: 1, devilsAdvocateReviews: 1 })
    /* The Devil's Advocate objected below the threshold: on the record as dissent, not as a stop. */
    expect(answer.answer.dissent).toHaveLength(1)
    expect(answer.answer.materialDissentCount).toBe(0)

    /* Every act between the word and the conclusion, by the principal whose act it is. */
    const revision = (await repositories.theses.listForCase(caseId)).find((candidate) => candidate.revisionNumber === 2)!
    const acts: [string, string, string][] = [
      [`agent-accept-${(await runFor(caseId, 'macro-analysis')).id}`, 'AcceptContribution', 'global-macro-agent'],
      [`agent-accept-${(await runFor(caseId, 'rates-analysis')).id}`, 'AcceptContribution', 'rates-agent'],
      [`agent-accept-${(await runFor(caseId, 'aggregation')).id}`, 'AcceptContribution', 'research-office-agent'],
      [`office-adopt-${(await runFor(caseId, 'aggregation')).id}`, 'AggregateManagerConclusion', 'research-office-agent'],
      [`${caseId}-risk-resolve-${revision.revisionId}`, 'ResolveConditionalRequirement', 'risk-agent'],
      [`${caseId}-submit-verification-${revision.revisionId}`, 'SubmitForVerification', 'research-office-agent'],
      [`file-${(await runFor(caseId, 'verification')).id}`, 'RecordVerificationReview', 'verification-agent'],
      [`file-${(await runFor(caseId, 'challenge')).id}`, 'RecordDevilsAdvocateReview', 'devils-advocate-agent'],
      [`file-${(await runFor(caseId, 'peer-examination')).id}`, 'RecordPeerExamination', 'rates-agent'],
    ]
    for (const [commandId, commandType, principal] of acts) {
      const entry = await repositories.commands.find(commandId)
      expect(entry, commandId).not.toBeNull()
      expect(entry!.intent.commandType, commandId).toBe(commandType)
      expect(entry!.intent.actor, commandId).toMatchObject({ kind: 'institutional-agent', agentPrincipalId: principal })
      expect(entry!.intent.initiator, commandId).toEqual({ kind: 'orchestrator', orchestratorId: HOST_ORCHESTRATOR_ID })
    }
    /* Each control function's run is its own principal's, against the revision it examined. */
    for (const [entryKey, principal] of [
      ['verification', 'verification-agent'],
      ['challenge', 'devils-advocate-agent'],
      ['peer-examination', 'rates-agent'],
    ] as const) {
      const run = await runFor(caseId, entryKey)
      expect(run.agentPrincipalId, entryKey).toBe(principal)
      expect(run.revisionId, entryKey).toBe(revision.revisionId)
      expect(run.state, entryKey).toBe('completed')
    }

    /* The committee's conclusion stops the firm: the CIO's act is still owed, and nobody performed it. */
    const investmentCase = (await repositories.cases.get(caseId))!
    expect(investmentCase.stage).toBe('review')
    const standing = await standingForCase({ repositories, organization: TEST_ORGANIZATION, investmentCase, now: AT })
    expect(standing.nextAct.act).toBe('submit-for-cio-decision')
  }, 20_000)
})

describe('where the firm stops', () => {
  it('stops visibly at a material objection, says whose and what it is, and does not argue with itself', async () => {
    outcomes['devils-advocate'] = { kind: 'object', materiality: 'material' }
    const gateway = firm()
    const { caseId, reference } = await begun(gateway)

    await until(
      async () => {
        const status = await gateway({ kind: 'status', reference })
        return status.state === 'blocked' && status.block.reason === 'objections-unresolved'
      },
      () => gateway({ kind: 'status', reference }),
    )
    /* The firm's own passes do not answer the objection: nothing further starts. */
    await sleep(200)
    const before = (await runsOf(caseId)).length
    await sleep(200)
    expect((await runsOf(caseId)).length).toBe(before)
    expect((await runsOf(caseId)).filter((run) => run.departmentId === 'devils-advocate')).toHaveLength(1)

    const inspected = positive(await gateway({ kind: 'inspect', reference, view: { kind: 'objections' } }))
    if (inspected.state !== 'blocked' || inspected.inspection?.view !== 'objections') throw new Error(JSON.stringify(inspected))
    expect(inspected.inspection.objections).toHaveLength(1)
    expect(inspected.inspection.objections[0]).toMatchObject({
      byDepartmentId: 'devils-advocate',
      raisedAs: 'devils-advocate',
      materiality: 'material',
      outcome: 'open',
    })
    expect((await repositories.cases.get(caseId))!.stage).toBe('review')
  }, 20_000)

  it('stops visibly when a control function has no principal, and lets nobody else perform its act', async () => {
    deps = {
      ...deps,
      organization: {
        ...TEST_ORGANIZATION,
        agentPrincipals: TEST_ORGANIZATION.agentPrincipals.filter((principal) => principal.id !== 'verification-agent'),
      },
    }
    const gateway = firm()
    const { caseId, reference } = await begun(gateway)

    /* The other two control functions file; Verification's queue stays open with nobody to work it. */
    await until(
      async () =>
        (await repositories.reviews.challengesForCase(caseId)).length === 1 &&
        (await repositories.reviews.peerExaminationsForCase(caseId)).length === 1,
      () => runsOf(caseId),
    )
    await sleep(200)
    expect((await runsOf(caseId)).filter((run) => run.departmentId === 'verification')).toEqual([])
    expect(await repositories.reviews.verificationsForCase(caseId)).toEqual([])
    expect(await gateway({ kind: 'status', reference })).toMatchObject({ state: 'blocked', block: { reason: 'verification-required' } })

    /* A fresh beginning says so, plainly. */
    const again = positive(await gateway({ kind: 'begin', reference, requestId: 'req-again', opening: explanation }))
    expect(again.commission!.withheld).toContainEqual(
      expect.objectContaining({ desk: expect.objectContaining({ id: 'verification', isGovernance: true }), reason: 'no-principal' }),
    )
  }, 20_000)

  it('stops visibly when a control function’s provider does not deliver, and does not pay to be refused again', async () => {
    outcomes.verification = { kind: 'failure' }
    const gateway = firm()
    const { caseId, reference } = await begun(gateway)

    await until(
      async () =>
        (await repositories.reviews.challengesForCase(caseId)).length === 1 &&
        (await repositories.reviews.peerExaminationsForCase(caseId)).length === 1,
      () => runsOf(caseId),
    )
    await sleep(300)
    const verification = (await runsOf(caseId)).filter((run) => run.departmentId === 'verification')
    expect(verification).toHaveLength(1)
    expect(verification[0]!.state).toBe('failed')
    expect(await gateway({ kind: 'status', reference })).toMatchObject({
      state: 'blocked',
      block: { reason: 'verification-required' },
      activity: { failed: 1 },
    })
  }, 20_000)
})
