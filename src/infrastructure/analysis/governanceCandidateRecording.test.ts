/**
 * Recording a governance candidate, against the in-memory store.
 *
 * What matters here is not that a row appears. It is that the command refuses
 * every way a control function could reach further than producing work:
 *
 *   - a desk cannot produce an act its playbook entry does not carry;
 *   - the basis is read off the record, so a caller cannot declare its own;
 *   - the run reaches `awaiting-acceptance` and NOT `completed`, because
 *     producing a verdict is not performing the control;
 *   - nothing institutional is written — no review, no finding, no challenge,
 *     and no lifecycle move on the thesis.
 *
 * ## What this suite does not reach
 *
 * The shared harness seeds `macro-regime` v1, which has no `peer-examination`
 * entry — that arrives with v5. So the peer path is covered here only where a
 * NON-peer entry must refuse it; a run on the real peer entry needs a v6 case,
 * and is proved where such a case exists rather than simulated here.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import { startAgentRun } from '~/application/analysis/commands/startAgentRun'
import { recordGovernanceCandidate } from '~/application/analysis/commands/recordGovernanceCandidate'
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
  seedAggregatableCase,
  type Seeded,
} from './aggregationHarness'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'

const organization = TEST_ORGANIZATION
const CASE_ID = 'case-1'

let repositories: AnalysisRepositories
let deps: CommandDeps
let seeded: Seeded
/** The revision the manager produced — the argument a control function reads. */
let aggregated: string
/** The claims the manager put in scope, which is what a verdict may speak about. */
let inScope: string[]

const envelope = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: 'cmd-x',
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
  occurredAt: LATER,
  ...over,
})

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
  inScope = [seeded.macroClaimId, seeded.quantClaimId, seeded.aggregationClaimId]
})

/**
 * A run on one playbook entry, targeting the aggregated revision.
 *
 * Started through `StartAgentRun` directly: what is under test is what the
 * recording command does with a run, not whether the orchestrator would have
 * produced one. The blockers are genuinely satisfied — the harness completed
 * `aggregation` — so the institution would have permitted this start.
 */
async function startRun(
  entryKey: string,
  departmentId: string,
  employeeId: string,
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
      envelope({ commandId: startId, actor: { kind: 'employee', employeeId } }),
      deps,
    ),
    `StartAgentRun(${entryKey})`,
  )
  return deriveRunId(startId, assignmentId)
}

const record = (
  runId: string,
  departmentId: string,
  employeeId: string,
  candidate: RecordInput['candidate'],
) =>
  runCommand(
    recordGovernanceCandidate(organization),
    {
      caseId: CASE_ID,
      runId,
      departmentId,
      observedStates: ['running'],
      usage: { state: 'not-applicable' },
      candidate,
    },
    envelope({
      commandId: `${runId}-produce`,
      actor: { kind: 'employee', employeeId },
    }),
    deps,
  )

type RecordInput = Parameters<ReturnType<typeof recordGovernanceCandidate>['payload']>[0]

const objection = (contests: string) => ({
  contests,
  kind: 'fragile-assumption' as const,
  argument: 'The timing rests on an assumption no desk established.',
  counterEvidence: [],
  wouldBeResolvedBy: 'A dated policy-path decomposition.',
  materiality: 'material' as const,
})

/* ------------------------------------------------- the act a desk may produce */

describe('a desk may only produce the act its entry carries', () => {
  it('refuses a verification candidate from the Risk desk', async () => {
    /*
     * Risk is a control function too, and still not THIS one. The rule is the
     * entry's discipline, not whether the desk happens to be governance.
     */
    const runId = await startRun('risk-review', 'risk', 'chief-risk-officer')
    const result = await record(runId, 'risk', 'chief-risk-officer', {
      kind: 'verification',
      artifact: { status: 'verified', findings: [], claimsReviewed: inScope },
    })

    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') throw new Error('unreachable')
    expect(result.rejection.code).toBe('not-authorised')
    expect(result.rejection.detail).toMatch(/not "verification"/)
  })

  it('refuses a peer examination from a desk that is not the peer step', async () => {
    const runId = await startRun('verification', 'verification', 'verification-head')
    const result = await record(runId, 'verification', 'verification-head', {
      kind: 'peer-examination',
      artifact: { challenges: [] },
      examinedDepartmentId: 'research-office',
    })

    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') throw new Error('unreachable')
    expect(result.rejection.detail).toMatch(/not the peer examination step/)
  })

  it("refuses a Devil's Advocate candidate from the Verification desk", async () => {
    /* Independence, at the production boundary as well as the filing one. */
    const runId = await startRun('verification', 'verification', 'verification-head')
    const result = await record(runId, 'verification', 'verification-head', {
      kind: 'devils-advocate',
      artifact: { challenges: [objection(seeded.macroClaimId)] },
    })

    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') throw new Error('unreachable')
    expect(result.rejection.detail).toMatch(/not "challenge"/)
  })
})

/* --------------------------------------------------------------- the basis */

describe('the basis is the record, not the caller', () => {
  it('refuses a verdict reviewing a claim the manager never put in scope', async () => {
    const runId = await startRun('verification', 'verification', 'verification-head')
    const result = await record(runId, 'verification', 'verification-head', {
      kind: 'verification',
      artifact: {
        status: 'verified',
        findings: [],
        claimsReviewed: [...inScope, 'clm-invented'],
      },
    })

    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') throw new Error('unreachable')
    expect(result.rejection.detail).toMatch(/not in the claim set/)
  })

  it('refuses an objection against a claim outside the scope', async () => {
    const runId = await startRun('challenge', 'devils-advocate', 'devils-advocate-head')
    const result = await record(runId, 'devils-advocate', 'devils-advocate-head', {
      kind: 'devils-advocate',
      artifact: { challenges: [objection('clm-invented')] },
    })

    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') throw new Error('unreachable')
    expect(result.rejection.detail).toMatch(/not in the claim set/)
  })

  it("refuses a Devil's Advocate filing with nothing in it", async () => {
    const runId = await startRun('challenge', 'devils-advocate', 'devils-advocate-head')
    const result = await record(runId, 'devils-advocate', 'devils-advocate-head', {
      kind: 'devils-advocate',
      artifact: { challenges: [] },
    })

    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') throw new Error('unreachable')
    expect(result.rejection.detail).toMatch(/must object/)
  })

  it('records the scope it read rather than the scope it was told', async () => {
    const runId = await startRun('verification', 'verification', 'verification-head')
    committed(
      await record(runId, 'verification', 'verification-head', {
        kind: 'verification',
        artifact: {
          status: 'verified-with-qualifications',
          findings: [],
          /* A subset: reviewing fewer claims than exist is legitimate. */
          claimsReviewed: [seeded.macroClaimId],
        },
      }),
      'RecordGovernanceCandidate',
    )

    const candidate = (await repositories.producedVerifications.get(runId))!
    expect(candidate.artifact.claimsReviewed).toEqual([seeded.macroClaimId])
    /* The BASIS is every claim in scope, whatever the verdict chose to read. */
    expect([...candidate.basis.observedClaimIds].sort()).toEqual([...inScope].sort())
    expect(candidate.basis.sourceRevisionId).toBe(aggregated)
    expect(candidate.basis.thesisId).toBe(seeded.thesisId)
    expect(candidate.basis.playbookEntryKey).toBe('verification')
  })
})

/* ------------------------------------------ produced is not institutional */

describe('producing a verdict is not performing the control', () => {
  it('leaves the run awaiting acceptance and writes nothing institutional', async () => {
    const runId = await startRun('verification', 'verification', 'verification-head')
    committed(
      await record(runId, 'verification', 'verification-head', {
        kind: 'verification',
        artifact: { status: 'verified', findings: [], claimsReviewed: inScope },
      }),
      'RecordGovernanceCandidate',
    )

    const run = (await repositories.runs.get(runId))!
    expect(run.state).toBe('awaiting-acceptance')
    expect(run.events.some((event) => event.state === 'completed')).toBe(false)

    /*
     * The boundary, asserted against the institutional stores directly. A
     * verification candidate exists; Verification has not happened.
     */
    expect(await repositories.producedVerifications.get(runId)).not.toBeNull()
    expect(await repositories.reviews.verificationsForCase(CASE_ID)).toEqual([])
    expect(await repositories.reviews.challengesForCase(CASE_ID)).toEqual([])

    const revision = (await repositories.theses.get(aggregated))!
    expect(revision.lifecycle).not.toBe('verified')
  })

  it('records an objection without creating a challenge', async () => {
    const runId = await startRun('challenge', 'devils-advocate', 'devils-advocate-head')
    committed(
      await record(runId, 'devils-advocate', 'devils-advocate-head', {
        kind: 'devils-advocate',
        artifact: { challenges: [objection(seeded.macroClaimId)] },
      }),
      'RecordGovernanceCandidate',
    )

    const candidate = (await repositories.producedChallenges.get(runId))!
    expect(candidate.artifact.challenges).toHaveLength(1)
    expect(candidate.artifact.challenges[0]!.materiality).toBe('material')

    /*
     * The objection exists as produced work and as nothing else. Until the
     * Devil's Advocate files it, the case has no open challenge — so no gate
     * reads one, which is what stops a model's objection blocking a case by
     * itself.
     */
    expect(await repositories.reviews.challengesForCase(CASE_ID)).toEqual([])
  })
})
