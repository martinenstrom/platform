/**
 * Filing a Devil's Advocate candidate, and a peer examination candidate.
 *
 * The same adoption boundary as Verification, and one difference that must not
 * be smoothed over — the whole reason these two are tested side by side:
 *
 *   Devil's Advocate   zero objections → cannot exist, cannot be filed
 *   peer examination   zero objections → valid completed scrutiny
 *
 * "Examined and found no objection" and "nobody examined it" are different
 * institutional facts, and only the peer path may produce the first.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import { openInvestmentCase } from '~/application/analysis/commands/openInvestmentCase'
import { instantiatePlaybook } from '~/application/analysis/commands/instantiatePlaybook'
import { proposeThesis } from '~/application/analysis/commands/proposeThesis'
import { MACRO_REGIME_PLAYBOOK_V6 } from '~/application/analysis/macroPlaybook'
import { startAgentRun } from '~/application/analysis/commands/startAgentRun'
import { submitForVerification } from '~/application/analysis/commands/submitForVerification'
import { recordGovernanceCandidate } from '~/application/analysis/commands/recordGovernanceCandidate'
import { recordDevilsAdvocateReview } from '~/application/analysis/commands/recordDevilsAdvocateReview'
import { recordPeerExamination } from '~/application/analysis/commands/recordPeerExamination'
import {
  deriveAssignmentId,
  deriveRevisionId,
  deriveRunId,
} from '~/application/analysis/commands/eventIdentity'
import { resolveExecutionBudget } from '~/application/analysis/executionBudget'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'
import {
  AT,
  EVIDENCE_SET_ID,
  LATER,
  contributionFor,
  seedAggregatableCase,
  type Seeded,
} from './aggregationHarness'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'

const organization = TEST_ORGANIZATION
const CASE_ID = 'case-1'
const DA_AGENT = 'devils-advocate-agent'
const RATES_AGENT = 'rates-agent'

let repositories: AnalysisRepositories
let deps: CommandDeps
let seeded: Seeded
let aggregated: string

const envelope = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: 'cmd-x',
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
  occurredAt: LATER,
  ...over,
})

const agent = (id: string) =>
  ({ kind: 'institutional-agent', agentPrincipalId: id }) as const

const committed = <T extends { outcome: string }>(result: T, step: string): T => {
  if (result.outcome !== 'committed') {
    throw new Error(`${step} did not commit: ${JSON.stringify(result)}`)
  }
  return result
}

beforeEach(async () => {
  repositories = createInMemoryRepositories()
  deps = {
    repositories,
    organization,
    organizationSeedVersion: TEST_SEED_VERSION,
    provenance: await repositories.provenance(),
    now: () => AT,
  }
  seeded = await seedAggregatableCase(repositories, deps, organization)

  committed(
    await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId: CASE_ID,
        sourceRevisionId: seeded.revisionId,
        departmentId: 'research-office',
        inputRunIds: [seeded.macroRunId, seeded.quantRunId, seeded.aggregationRunId],
        dispositions: [
          { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
          { claimId: seeded.quantClaimId, disposition: 'adopted-opposing' },
          { claimId: seeded.aggregationClaimId, disposition: 'adopted-supporting' },
        ],
        optionalInputs: [
          {
            playbookEntryKey: 'quant-validation',
            availability: 'received-and-used',
            scope: 'in-scope',
            materiallyRelevant: true,
          },
        ],
        rationale: 'Macro and quant agree on direction and disagree on timing.',
        statement: 'The ECB holds through Q2 and cuts in September.',
        position: 'hold',
        implications: ['position-sizing'],
        invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
      },
      envelope({ commandId: 'cmd-aggregate' }),
      deps,
    ),
    'AggregateManagerConclusion',
  )
  aggregated = deriveRevisionId('cmd-aggregate', seeded.thesisId)
})

/** A run on one entry, started as the principal that will file it. */
async function startRun(
  entryKey: string,
  departmentId: string,
  principal: string,
): Promise<string> {
  const assignmentId = deriveAssignmentId(`${CASE_ID}-inst`, entryKey)
  const startId = `${CASE_ID}-${entryKey}-start`
  committed(
    await runCommand(
      startAgentRun(organization),
      {
        caseId: CASE_ID,
        assignmentId,
        departmentId,
        evidenceSetId: EVIDENCE_SET_ID,
        revisionId: aggregated,
        providerId: 'stub',
        providerVersion: '1',
        providerKind: 'stub' as const,
        agentContractVersion: '0',
        outputSchemaVersion: '0',
        identity: { kind: 'scenario' as const, scenarioId: 'success', stubVersion: '1' },
        budget: resolveExecutionBudget('stub', { firmCeiling: { deadlineMs: 30_000 } }),
      },
      envelope({ commandId: startId, actor: agent(principal) }),
      deps,
    ),
    `StartAgentRun(${entryKey})`,
  )
  return deriveRunId(startId, assignmentId)
}

/** The submission that makes the argument reviewable, after the runs are picked up. */
async function submit(): Promise<void> {
  committed(
    await runCommand(
      submitForVerification(organization),
      {
        caseId: CASE_ID,
        revisionId: aggregated,
        submittedByDepartmentId: 'research-office',
      },
      envelope({
        commandId: 'cmd-submit',
        expectedVersion: (await repositories.cases.get(CASE_ID))!.version,
      }),
      deps,
    ),
    'SubmitForVerification',
  )
}

const objection = (contests: string) => ({
  contests,
  kind: 'fragile-assumption' as const,
  argument: 'The September timing rests on an assumption no desk established.',
  counterEvidence: [],
  wouldBeResolvedBy: 'A dated policy-path decomposition.',
  materiality: 'material' as const,
})

/* ----------------------------------------------------- devil's advocate */

describe("the Devil's Advocate files what it produced", () => {
  let runId: string

  beforeEach(async () => {
    runId = await startRun('challenge', 'devils-advocate', DA_AGENT)
    await submit()
    committed(
      await runCommand(
        recordGovernanceCandidate(organization),
        {
          caseId: CASE_ID,
          runId,
          departmentId: 'devils-advocate',
          observedStates: ['running'],
          usage: { state: 'not-applicable' },
          candidate: {
            kind: 'devils-advocate',
            artifact: { challenges: [objection(seeded.macroClaimId)] },
          },
        },
        envelope({ commandId: 'cmd-da-produce', actor: agent(DA_AGENT) }),
        deps,
      ),
      'RecordGovernanceCandidate',
    )
  })

  it('creates the objections and completes the producing work, together', async () => {
    committed(
      await runCommand(
        recordDevilsAdvocateReview(organization),
        {
          caseId: CASE_ID,
          byDepartmentId: 'devils-advocate',
          candidateFromRunId: runId,
        },
        envelope({ commandId: 'cmd-da-file', actor: agent(DA_AGENT) }),
        deps,
      ),
      'RecordDevilsAdvocateReview',
    )

    const reviews = await repositories.reviews.challengesForCase(CASE_ID)
    expect(reviews).toHaveLength(1)
    const review = reviews[0]!

    expect(review.byAgentPrincipalId).toBe(DA_AGENT)
    expect(review.byEmployeeId).toBeUndefined()
    expect(review.filedFromCandidateRunId).toBe(runId)

    /* The objection is institutional now, and carries the proposed materiality. */
    expect(review.challenges).toHaveLength(1)
    expect(review.challenges[0]!.contests).toBe(seeded.macroClaimId)
    expect(review.challenges[0]!.materiality).toBe('material')
    /* The mandate is the firm's, never the producer's. */
    expect(review.challenges[0]!.challengerKind).toBe('devils-advocate')
    expect(review.challenges[0]!.byDepartmentId).toBe('devils-advocate')
    /* Filed open: the producer objected; it did not settle anything. */
    expect(review.outcomes[review.challenges[0]!.id]).toBe('open')

    const run = (await repositories.runs.get(runId))!
    expect(run.state).toBe('completed')
    const assignment = (await repositories.assignments.get(run.assignmentId))!
    expect(assignment.status).toBe('completed')
  })

  it('refuses to file against a superseded argument', async () => {
    committed(
      await runCommand(
        aggregateManagerConclusion(organization),
        {
          caseId: CASE_ID,
          sourceRevisionId: aggregated,
          departmentId: 'research-office',
          inputRunIds: [seeded.macroRunId, seeded.quantRunId, seeded.aggregationRunId],
          dispositions: [
            { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
            { claimId: seeded.quantClaimId, disposition: 'adopted-opposing' },
            { claimId: seeded.aggregationClaimId, disposition: 'adopted-supporting' },
          ],
          optionalInputs: [
            {
              playbookEntryKey: 'quant-validation',
              availability: 'received-and-used',
              scope: 'in-scope',
              materiallyRelevant: true,
            },
          ],
          rationale: 'Reconsidered.',
          statement: 'The ECB holds through Q3.',
          position: 'hold',
          implications: ['position-sizing'],
          invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
        },
        envelope({ commandId: 'cmd-aggregate-2' }),
        deps,
      ),
      'second aggregation',
    )

    const result = await runCommand(
      recordDevilsAdvocateReview(organization),
      { caseId: CASE_ID, byDepartmentId: 'devils-advocate', candidateFromRunId: runId },
      envelope({ commandId: 'cmd-da-file', actor: agent(DA_AGENT) }),
      deps,
    )

    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') throw new Error('unreachable')
    expect(result.rejection.detail).toMatch(/revision-superseded/)

    expect(await repositories.reviews.challengesForCase(CASE_ID)).toEqual([])
    const run = (await repositories.runs.get(runId))!
    expect(run.state).toBe('awaiting-acceptance')
  })
})

describe("a Devil's Advocate draft with nothing in it never exists", () => {
  it('is refused at production, so there is no empty filing to make', async () => {
    const runId = await startRun('challenge', 'devils-advocate', DA_AGENT)
    await submit()

    const result = await runCommand(
      recordGovernanceCandidate(organization),
      {
        caseId: CASE_ID,
        runId,
        departmentId: 'devils-advocate',
        observedStates: ['running'],
        usage: { state: 'not-applicable' },
        candidate: { kind: 'devils-advocate', artifact: { challenges: [] } },
      },
      envelope({ commandId: 'cmd-da-empty', actor: agent(DA_AGENT) }),
      deps,
    )

    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') throw new Error('unreachable')
    expect(result.rejection.detail).toMatch(/must object/)

    /* No draft, so nothing to file and no requirement satisfied. */
    expect(await repositories.producedChallenges.get(runId)).toBeNull()
    const run = (await repositories.runs.get(runId))!
    expect(run.state).toBe('running')
  })
})

/* ------------------------------------------------------ peer examination */

/**
 * Peer examination needs a workflow that HAS a peer entry.
 *
 * The shared harness seeds `macro-regime` v1, where the entry does not exist —
 * it arrives with v5. So this block seeds v6 for itself rather than pretending
 * v1 can carry the act: a test that started the run on some other entry would
 * be proving something the institution never permits.
 *
 * v6's aggregation blocks on BOTH analytical desks, so Macro and Rates both
 * contribute before the office synthesises. That is the real graph, not a
 * shortcut around it.
 */
describe('a peer files what it examined', () => {
  const PEER_CASE = 'peer-case'
  const PEER_THESIS = `${PEER_CASE}-thesis`
  let runId: string
  let peerAggregated: string
  let macroClaimId: string

  async function seedV6(): Promise<void> {
    await repositories.evidence.save({
      id: EVIDENCE_SET_ID,
      assembledAt: AT,
      correlationId: 'corr-1',
      items: [],
      disagreements: [],
      revisions: [],
      coTemporality: { publication: { kind: 'empty' }, reference: { kind: 'empty' } },
    })

    committed(
      await runCommand(
        openInvestmentCase(organization),
        {
          caseId: PEER_CASE,
          subject: { kind: 'macro-regime', ref: 'ecb', displayName: 'ECB path' },
          question: 'Does the ECB cut before Q2?',
          ownerEmployeeId: 'research-director',
          participatingDepartmentIds: ['research-office'],
        },
        envelope({ commandId: `${PEER_CASE}-open` }),
        deps,
      ),
      'OpenInvestmentCase',
    )
    committed(
      await runCommand(
        instantiatePlaybook(organization),
        {
          caseId: PEER_CASE,
          playbookId: MACRO_REGIME_PLAYBOOK_V6.id,
          playbookVersion: MACRO_REGIME_PLAYBOOK_V6.version,
          onBehalfOfDepartmentId: 'research-office',
        },
        envelope({ commandId: `${PEER_CASE}-inst`, expectedVersion: 1 }),
        deps,
      ),
      'InstantiatePlaybook(v6)',
    )
    committed(
      await runCommand(
        proposeThesis(organization),
        {
          caseId: PEER_CASE,
          thesisId: PEER_THESIS,
          statement: 'The ECB holds through Q2.',
          position: 'hold',
          invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
          implications: [],
          proposedByDepartmentId: 'research-office',
        },
        envelope({ commandId: `${PEER_CASE}-propose` }),
        deps,
      ),
      'ProposeThesis',
    )

    const macro = await contributionFor(repositories, deps, organization, {
      caseId: PEER_CASE,
      entryKey: 'macro-analysis',
      departmentId: 'global-macro',
      commandPrefix: `${PEER_CASE}-macro`,
    })
    macroClaimId = macro.claimId
    const rates = await contributionFor(repositories, deps, organization, {
      caseId: PEER_CASE,
      entryKey: 'rates-analysis',
      departmentId: 'rates',
      commandPrefix: `${PEER_CASE}-rates`,
    })
    const office = await contributionFor(repositories, deps, organization, {
      caseId: PEER_CASE,
      entryKey: 'aggregation',
      departmentId: 'research-office',
      commandPrefix: `${PEER_CASE}-office`,
    })

    committed(
      await runCommand(
        aggregateManagerConclusion(organization),
        {
          caseId: PEER_CASE,
          sourceRevisionId: deriveRevisionId(`${PEER_CASE}-propose`, PEER_THESIS),
          departmentId: 'research-office',
          inputRunIds: [macro.runId, rates.runId, office.runId],
          dispositions: [
            { claimId: macro.claimId, disposition: 'adopted-supporting' },
            { claimId: rates.claimId, disposition: 'adopted-supporting' },
            { claimId: office.claimId, disposition: 'adopted-supporting' },
          ],
          optionalInputs: [
            {
              playbookEntryKey: 'quant-validation',
              availability: 'unavailable-at-aggregation',
              materiallyRelevant: false,
            },
          ],
          rationale: 'Both desks point the same way.',
          statement: 'The ECB holds through Q2 and cuts in September.',
          position: 'hold',
          implications: ['position-sizing'],
          invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
        },
        envelope({ commandId: `${PEER_CASE}-aggregate` }),
        deps,
      ),
      'AggregateManagerConclusion(v6)',
    )
    peerAggregated = deriveRevisionId(`${PEER_CASE}-aggregate`, PEER_THESIS)
  }

  const produce = (challenges: ReturnType<typeof objection>[]) =>
    runCommand(
      recordGovernanceCandidate(organization),
      {
        caseId: PEER_CASE,
        runId,
        departmentId: 'rates',
        observedStates: ['running'],
        usage: { state: 'not-applicable' },
        candidate: {
          kind: 'peer-examination',
          artifact: { challenges },
          examinedDepartmentId: 'global-macro',
        },
      },
      envelope({ commandId: 'cmd-peer-produce', actor: agent(RATES_AGENT) }),
      deps,
    )

  const file = () =>
    runCommand(
      recordPeerExamination(organization),
      { caseId: PEER_CASE, byDepartmentId: 'rates', candidateFromRunId: runId },
      envelope({ commandId: 'cmd-peer-file', actor: agent(RATES_AGENT) }),
      deps,
    )

  beforeEach(async () => {
    await seedV6()

    const assignmentId = deriveAssignmentId(`${PEER_CASE}-inst`, 'peer-examination')
    const startId = `${PEER_CASE}-peer-start`
    committed(
      await runCommand(
        startAgentRun(organization),
        {
          caseId: PEER_CASE,
          assignmentId,
          departmentId: 'rates',
          evidenceSetId: EVIDENCE_SET_ID,
          revisionId: peerAggregated,
          providerId: 'stub',
          providerVersion: '1',
          providerKind: 'stub' as const,
          agentContractVersion: '0',
          outputSchemaVersion: '0',
          identity: {
            kind: 'scenario' as const,
            scenarioId: 'success',
            stubVersion: '1',
          },
          budget: resolveExecutionBudget('stub', { firmCeiling: { deadlineMs: 30_000 } }),
        },
        envelope({ commandId: startId, actor: agent(RATES_AGENT) }),
        deps,
      ),
      'StartAgentRun(peer-examination)',
    )
    runId = deriveRunId(startId, assignmentId)

    committed(
      await runCommand(
        submitForVerification(organization),
        {
          caseId: PEER_CASE,
          revisionId: peerAggregated,
          submittedByDepartmentId: 'research-office',
        },
        envelope({
          commandId: `${PEER_CASE}-submit`,
          expectedVersion: (await repositories.cases.get(PEER_CASE))!.version,
        }),
        deps,
      ),
      'SubmitForVerification',
    )
  })

  it('records an examination that raised nothing as completed scrutiny', async () => {
    committed(await produce([]), 'RecordGovernanceCandidate')
    committed(await file(), 'RecordPeerExamination')

    const reviews = await repositories.reviews.peerExaminationsForCase(PEER_CASE)
    expect(reviews).toHaveLength(1)
    const review = reviews[0]!

    /*
     * The row exists and carries no objections. That is the fact the gate
     * reads: scrutiny happened, and it is not the same as silence.
     */
    expect(review.challenges).toEqual([])
    expect(review.examinedDepartmentId).toBe('global-macro')
    expect(review.byAgentPrincipalId).toBe(RATES_AGENT)
    expect(review.byEmployeeId).toBeUndefined()
    expect(review.filedFromCandidateRunId).toBe(runId)

    /* It synthesises no agreement: no challenge rows, and no new claims. */
    expect(await repositories.reviews.challengesForCase(PEER_CASE)).toEqual([])

    const run = (await repositories.runs.get(runId))!
    expect(run.state).toBe('completed')
    const assignment = (await repositories.assignments.get(run.assignmentId))!
    expect(assignment.status).toBe('completed')
  })

  it('records an examination that objected', async () => {
    committed(await produce([objection(macroClaimId)]), 'produce')
    committed(await file(), 'RecordPeerExamination')

    const review = (await repositories.reviews.peerExaminationsForCase(PEER_CASE))[0]!
    expect(review.challenges).toHaveLength(1)
    /* Filed under the PEER mandate, not the Devil's Advocate's. */
    expect(review.challenges[0]!.challengerKind).toBe('peer')
    expect(review.challenges[0]!.byDepartmentId).toBe('rates')

    const run = (await repositories.runs.get(runId))!
    expect(run.state).toBe('completed')
  })

  it('cannot be redirected at a desk the examination never read', async () => {
    /*
     * The examined desk is in the candidate's basis, not in the filing input —
     * so there is no field on the agent path to point it somewhere else.
     */
    committed(await produce([]), 'produce')
    committed(await file(), 'RecordPeerExamination')

    const review = (await repositories.reviews.peerExaminationsForCase(PEER_CASE))[0]!
    expect(review.examinedDepartmentId).toBe('global-macro')
    expect(review.examinedDepartmentId).not.toBe('rates')
  })
})
