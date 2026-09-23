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
import { ContributionFailure, type ContributionProvider } from '~/application/analysis/contributionPort'
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
        /* The kind of question decides what the office may say (ruled 2026-09-18). */
        position: context.inquiry === 'explanation' ? 'explain' : 'hold',
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
function firm(
  over: {
    deskProvider?: ContributionProvider
    synthesisProvider?: (loadContext: () => Promise<SynthesisContext>) => ContributionProvider
  } = {},
): HostGateway {
  return createHostGateway({
    system: createFinancialOsSystem({
      repositories,
      commandDeps: async () => deps,
      now: () => AT,
      advance: {
        provider: () => over.deskProvider ?? createStubContributionProvider(),
        synthesisProvider: (loadContext) => (over.synthesisProvider ?? synthesisStub)(loadContext),
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

    /* The no-correction path (ruled 2026-09-22): Verification passed, so no round was taken and revision 2 is the conclusion. */
    expect(await repositories.commands.find(`${caseId}-return-correction-${revision.revisionId}`)).toBeNull()
    expect(await repositories.theses.listForCase(caseId)).toHaveLength(2)
    expect(answer.answer.thesis.revisionId).toBe(revision.revisionId)
    expect(answer.answer.priorDissent).toEqual([])
  }, 20_000)
})

describe('what an explanation retains', () => {
  it('reaches a scrutinised explanation over material analytical dissent, retained on the record and said as dissent (ruled 2026-09-18)', async () => {
    outcomes['devils-advocate'] = { kind: 'object', materiality: 'material' }
    const gateway = firm()
    const { caseId, reference } = await begun(gateway)

    await until(
      async () => (await gateway({ kind: 'status', reference })).state === 'answer-ready',
      () => gateway({ kind: 'status', reference }),
    )
    const answer = positive(await gateway({ kind: 'result', reference }))
    if (answer.state !== 'answer-ready' || answer.answer?.kind !== 'committee-conclusion') {
      throw new Error(JSON.stringify(answer))
    }
    expect(answer.answer.inquiry).toBe('explanation')
    expect(answer.answer.thesis.position).toBe('explain')
    expect(answer.answer.thesis.implications).toEqual([])
    /* The objection is the Devil's Advocate's, filed, open, and retained — it did not stop the explanation. */
    expect(answer.answer.dissent).toHaveLength(1)
    expect(answer.answer.dissent[0]).toMatchObject({ byDepartmentId: 'devils-advocate', materiality: 'material', outcome: 'open' })
    /* Risk was asked whether it applies and said no: an explanation declares no implementation implication. */
    const resolutions = await repositories.requirements.listForCase(caseId)
    expect(resolutions.map((r) => r.state)).toEqual(['not-required'])
    expect((await repositories.cases.get(caseId))!.stage).toBe('review')
  })
})

describe('where the firm stops', () => {
  it('stops a JUDGEMENT visibly at a material objection, says whose and what it is, and does not argue with itself', async () => {
    outcomes['devils-advocate'] = { kind: 'object', materiality: 'material' }
    const gateway = firm()
    /* A capital question: the person's view, examined. Material dissent decides it (ruled 2026-09-18). */
    const judgement = { kind: 'position' as const, focus: [] as string[], view: { statement: 'Jag vill minska guldexponeringen.', position: 'reduce' } }
    const asked = positive(await gateway({ ...gold, question: 'Borde jag minska min guldexponering?' }))
    const caseId = asked.reference.id
    const reference = asked.reference
    await evidenceFor(caseId)
    positive(await gateway({ kind: 'begin', reference, requestId: 'req-begin', opening: judgement }))

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

/**
 * The bounded correction round (TD-99, ruled 2026-09-22), on the firm's own
 * initiative: Verification demands corrections on revision 2, the office
 * returns the defective claim to the desk that produced it, the desk corrects,
 * the office synthesises revision 3 as a correction, fresh governance examines
 * the successor, and JARVIS answers with the scrutinised explanation — zero
 * further turns, zero CIO acts, zero acts by the host.
 */
describe('the correction round', () => {
  const requests: { departmentId: string; corrections?: readonly { claimId: string; correctionRequired: string }[] }[] = []
  const observingDesks = (): ContributionProvider => {
    /* Rates answers slower than Global Macro, so its correction is still in flight when Macro's is adopted (measured live, 2026-09-23). */
    const inner = createStubContributionProvider({ outcomes: { rates: { kind: 'delayed', ms: 400 } } })
    return {
      ...inner,
      async contribute(request) {
        requests.push({ departmentId: request.departmentId, ...(request.corrections ? { corrections: request.corrections } : {}) })
        return inner.contribute(request)
      },
    }
  }

  it('corrects once, by provenance, and reaches the explanation on the successor with the old dissent kept as history', async () => {
    requests.length = 0
    /* Both desks' claims found against, so both correct — and the office must wait for the slower one. */
    outcomes.verification = { kind: 'verify', byRevisionNumber: { 2: 'correction-required', 3: 'verified' }, findings: 2 }
    outcomes['devils-advocate'] = { kind: 'object', materiality: 'material' }
    const gateway = firm({ deskProvider: observingDesks() })
    const { caseId, reference } = await begun(gateway)

    await until(
      async () => (await gateway({ kind: 'status', reference })).state === 'answer-ready',
      () => gateway({ kind: 'status', reference }),
      10_000,
    )
    const answer = positive(await gateway({ kind: 'result', reference }))
    if (answer.state !== 'answer-ready' || answer.answer?.kind !== 'committee-conclusion') {
      throw new Error(JSON.stringify(answer))
    }

    /* Lineage: revision 2 → findings → correction work → revision 3, explicit on the record. */
    const lineage = await repositories.theses.listForCase(caseId)
    expect(lineage).toHaveLength(3)
    const [, second, third] = lineage as [unknown, (typeof lineage)[number], (typeof lineage)[number]]
    expect(second).toMatchObject({ revisionNumber: 2, lifecycle: 'superseded' })
    expect(third).toMatchObject({ revisionNumber: 3, revisionCause: 'correction', supersedesRevisionId: second.revisionId, lifecycle: 'verified' })
    expect(answer.answer.thesis.revisionId).toBe(third.revisionId)
    expect(answer.answer.inquiry).toBe('explanation')
    expect(answer.answer.scrutiny.verification).toBe('verified')

    /* Verification's first verdict stands as history; its second stands for the successor. */
    const verdicts = await repositories.reviews.verificationsForCase(caseId)
    expect(verdicts).toHaveLength(2)
    const verdictOn = (revisionId: string) =>
      verdicts.find((review) => review.scope === 'thesis-revision' && review.revisionId === revisionId)!
    const verdictOn2 = verdictOn(second.revisionId)
    expect(verdictOn2.status).toBe('correction-required')
    expect(verdictOn(third.revisionId).status).toBe('verified')
    expect(third.revisionReason).toContain(`Correction of revision 2 after Verification ${verdictOn2.reviewId}`)

    /* The return: the office's act, initiated by the orchestrator, exactly once. */
    const returned = await repositories.commands.find(`${caseId}-return-correction-${second.revisionId}`)
    expect(returned).not.toBeNull()
    expect(returned!.intent.commandType).toBe('ReturnForCorrection')
    expect(returned!.intent.actor).toMatchObject({ kind: 'institutional-agent', agentPrincipalId: 'research-office-agent' })
    expect(returned!.intent.initiator).toEqual({ kind: 'orchestrator', orchestratorId: HOST_ORCHESTRATOR_ID })
    expect(await repositories.commands.find(`${caseId}-return-correction-${third.revisionId}`)).toBeNull()

    /* Targeted: each desk whose claim was found against worked again, briefed with its own finding; each replaced run is kept and marked obsolete. */
    const runs = await runsOf(caseId)
    const byEntry = (key: string) => runs.filter((run) => run.execution.playbookEntryKey === key)
    expect(byEntry('macro-analysis')).toHaveLength(2)
    expect(byEntry('rates-analysis')).toHaveLength(2)
    for (const finding of verdictOn2.findings) {
      const producer = runs.find((run) => run.claims.some((claim) => claim.id === finding.claimId))!
      expect(producer.obsolete, finding.claimId).toBe(true)
      const briefed = requests.find((request) => request.departmentId === producer.departmentId && request.corrections)
      expect(briefed?.corrections, producer.departmentId).toEqual([
        expect.objectContaining({ claimId: finding.claimId, correctionRequired: finding.correctionRequired }),
      ])
    }
    for (const entryKey of ['macro-analysis', 'rates-analysis']) {
      expect(byEntry(entryKey).find((run) => run.revisionId === second.revisionId)!.state, entryKey).toBe('completed')
    }
    /*
     * The office waited for the slower desk: ONE re-synthesis, onto both
     * corrected contributions, and no candidate refused at adoption for
     * having been produced against work the firm no longer stands behind.
     */
    expect(byEntry('aggregation')).toHaveLength(2)
    expect(trace.filter((line) => line.includes('institutionalises') && line.includes('rejected'))).toEqual([])
    /* Every claim of the successor is a corrected or reused claim; the claim found against is gone. */
    expect(third.supportingClaimIds).not.toContain(verdictOn2.findings[0]!.claimId)

    /* Fresh governance on the successor: each control function examined revision 3 under its own principal. */
    for (const [entryKey, principal] of [['verification', 'verification-agent'], ['challenge', 'devils-advocate-agent'], ['peer-examination', 'rates-agent']] as const) {
      const examinations = byEntry(entryKey)
      expect(examinations.map((run) => run.revisionId).sort(), entryKey).toEqual([second.revisionId, third.revisionId].sort())
      for (const run of examinations) {
        expect(run.agentPrincipalId, entryKey).toBe(principal)
        expect(run.state, entryKey).toBe('completed')
      }
    }
    /* Risk: not required on either revision of an explanation, resolved by its own principal each time. */
    expect((await repositories.requirements.listForCase(caseId)).map((r) => r.state)).toEqual(['not-required', 'not-required'])

    /* Retained dissent survives correction: the objection to revision 2 is history beside the conclusion, renewed by the fresh examination. */
    expect(answer.answer.dissent).toHaveLength(1)
    expect(answer.answer.dissent[0]).toMatchObject({ byDepartmentId: 'devils-advocate', materiality: 'material', outcome: 'open', revisionId: third.revisionId })
    expect(answer.answer.priorDissent).toHaveLength(1)
    expect(answer.answer.priorDissent[0]).toMatchObject({ byDepartmentId: 'devils-advocate', revisionId: second.revisionId, renewed: true })

    /* Nobody was asked, nobody decided, and the host performed nothing. */
    expect(await repositories.commands.find(`${caseId}-submit-cio`)).toBeNull()
    expect((await repositories.cases.get(caseId))!.stage).toBe('review')
  }, 20_000)

  it('stops visibly when the office’s correction synthesis times out, and resumes on the person’s word without rerunning the desks', async () => {
    /*
     * Measured live (run 13, 2026-09-23): the re-synthesis hit its 180 s
     * deadline and settled `timed-out / provider-timeout`. The round is a
     * visible stop — a system failure, said as one — and the person's next
     * word commissions the office alone; the desks' corrections stand.
     */
    outcomes.verification = { kind: 'verify', byRevisionNumber: { 2: 'correction-required', 3: 'verified' } }
    let synthesisCalls = 0
    const flaky = (loadContext: () => Promise<SynthesisContext>): ContributionProvider => {
      const inner = synthesisStub(loadContext)
      return {
        ...inner,
        async contribute(request) {
          synthesisCalls += 1
          /* The second synthesis — the correction — hangs on every attempt the run allows. */
          if (synthesisCalls >= 2 && synthesisCalls <= 4) throw new ContributionFailure('provider-timeout')
          return inner.contribute(request)
        },
      }
    }
    const gateway = firm({ synthesisProvider: flaky })
    const { caseId, reference } = await begun(gateway)

    await until(
      async () => {
        const status = await gateway({ kind: 'status', reference })
        return status.state === 'blocked' && status.block.reason === 'verification-correction-required' && status.activity.failed === 1
      },
      () => gateway({ kind: 'status', reference }),
      10_000,
    )
    const stopped = await runsOf(caseId)
    const timedOut = stopped.find((run) => run.state === 'timed-out')!
    expect(timedOut.execution.playbookEntryKey).toBe('aggregation')
    expect(timedOut.failure).toMatchObject({ category: 'provider-timeout', retryable: true })
    /* Nothing further starts on the firm's own initiative. */
    await sleep(300)
    expect((await runsOf(caseId)).length).toBe(stopped.length)
    const deskRunsBefore = stopped.filter((run) => ['macro-analysis', 'rates-analysis'].includes(run.execution.playbookEntryKey)).length

    /* The person's word resumes the round: the office alone is commissioned again, onto the corrections that stand. */
    const again = positive(await gateway({ kind: 'begin', reference, requestId: 'req-again', opening: explanation }))
    expect(again.commission!.started.map((desk) => desk.id)).toEqual(['research-office'])
    await until(
      async () => (await gateway({ kind: 'status', reference })).state === 'answer-ready',
      () => gateway({ kind: 'status', reference }),
      10_000,
    )
    const runs = await runsOf(caseId)
    expect(runs.filter((run) => ['macro-analysis', 'rates-analysis'].includes(run.execution.playbookEntryKey))).toHaveLength(deskRunsBefore)
    expect(runs.filter((run) => run.execution.playbookEntryKey === 'aggregation').map((run) => run.state).sort()).toEqual(['completed', 'completed', 'timed-out'])
    const lineage = await repositories.theses.listForCase(caseId)
    expect(lineage).toHaveLength(3)
    const answer = positive(await gateway({ kind: 'result', reference }))
    if (answer.state !== 'answer-ready' || answer.answer?.kind !== 'committee-conclusion') throw new Error(JSON.stringify(answer))
    expect(answer.answer.thesis.revisionId).toBe(lineage[2]!.revisionId)
  }, 20_000)

  it('returns for correction even when a control function failed on the revision, and does not re-examine a revision being replaced', async () => {
    /*
     * Measured live (run 14, 2026-09-23): the Devil's Advocate's candidate was
     * refused and its run failed AFTER Verification had demanded corrections;
     * nothing advanced the case again, and the return it was holding up never
     * came. A finished run advances the case whatever way it finished; a
     * revision returned for correction is not examined again.
     */
    outcomes.verification = { kind: 'verify', byRevisionNumber: { 2: 'correction-required', 3: 'verified' } }
    outcomes['devils-advocate'] = { kind: 'failure' }
    const gateway = firm()
    const { caseId, reference } = await begun(gateway)

    await until(
      async () => (await repositories.theses.listForCase(caseId)).length === 3 && (await repositories.reviews.verificationsForCase(caseId)).length === 2,
      () => gateway({ kind: 'status', reference }),
      10_000,
    )
    await sleep(300)
    const lineage = await repositories.theses.listForCase(caseId)
    expect(await repositories.commands.find(`${caseId}-return-correction-${lineage[1]!.revisionId}`)).not.toBeNull()
    const challenges = (await runsOf(caseId)).filter((run) => run.execution.playbookEntryKey === 'challenge')
    /* One failed examination of revision 2, never retried on the firm's own; one of revision 3, owed afresh. */
    expect(challenges.filter((run) => run.revisionId === lineage[1]!.revisionId).map((run) => run.state)).toEqual(['failed'])
    expect(challenges.filter((run) => run.revisionId === lineage[2]!.revisionId).map((run) => run.state)).toEqual(['failed'])
    expect(await gateway({ kind: 'status', reference })).toMatchObject({
      state: 'blocked',
      block: { reason: 'challenge-required' },
      activity: { failed: 2 },
    })
  }, 20_000)

  it('stops visibly after the one automatic round, with what remains and whose it is', async () => {
    outcomes.verification = { kind: 'verify', byRevisionNumber: { 2: 'correction-required', 3: 'correction-required' } }
    const gateway = firm()
    const { caseId, reference } = await begun(gateway)

    await until(
      async () => {
        const status = await gateway({ kind: 'status', reference })
        return status.state === 'blocked' && status.block.reason === 'verification-correction-required' && (status.block.corrections?.roundsTaken ?? 0) === 1
      },
      () => gateway({ kind: 'status', reference }),
      10_000,
    )
    /* The firm's own passes take no second round: nothing further starts. */
    await sleep(300)
    const before = (await runsOf(caseId)).length
    await sleep(300)
    expect((await runsOf(caseId)).length).toBe(before)

    const lineage = await repositories.theses.listForCase(caseId)
    expect(lineage).toHaveLength(3)
    expect(lineage[2]).toMatchObject({ revisionNumber: 3, revisionCause: 'correction' })
    /* Targeted, not blind: one desk was found against and corrected; the other desk's work was reused. */
    const runs = await runsOf(caseId)
    const deskRuns = ['macro-analysis', 'rates-analysis'].map((key) => runs.filter((run) => run.execution.playbookEntryKey === key).length)
    expect(deskRuns.sort()).toEqual([1, 2])
    expect(await repositories.commands.find(`${caseId}-return-correction-${lineage[1]!.revisionId}`)).not.toBeNull()
    expect(await repositories.commands.find(`${caseId}-return-correction-${lineage[2]!.revisionId}`)).toBeNull()
    expect((await repositories.reviews.verificationsForCase(caseId)).map((review) => review.status)).toEqual(['correction-required', 'correction-required'])

    const status = await gateway({ kind: 'status', reference })
    expect(status).toMatchObject({
      state: 'blocked',
      block: {
        reason: 'verification-correction-required',
        owner: { id: 'research-office' },
        corrections: { revisionNumber: 3, blockingFindings: 1, owners: [{ id: expect.stringMatching(/^(global-macro|rates)$/) }], roundsTaken: 1, automaticRoundAvailable: false },
      },
    })
    expect(await repositories.commands.find(`${caseId}-submit-cio`)).toBeNull()
  }, 20_000)
})
