/**
 * Filing a governance candidate: the adoption boundary, end to end.
 *
 * The canonical state machine for autonomous governance, pinned in one place
 * because three control functions share it and any of them drifting would
 * reopen the boundary:
 *
 *   after production   run awaiting-acceptance · candidate exists · no review
 *   after filing       run completed · assignment completed · review exists
 *   after a refusal    run awaiting-acceptance · candidate exists · no review
 *
 * The two halves of adoption are coupled deliberately. A filing that wrote a
 * verdict and left the run awaiting acceptance would say the control had not
 * been performed while the record showed its result; a production that
 * completed the run would say it HAD been performed before anyone filed it.
 * Both are asserted against, in both directions.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import { startAgentRun } from '~/application/analysis/commands/startAgentRun'
import { submitForVerification } from '~/application/analysis/commands/submitForVerification'
import { recordGovernanceCandidate } from '~/application/analysis/commands/recordGovernanceCandidate'
import { recordVerificationReview } from '~/application/analysis/commands/recordVerificationReview'
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
const VERIFICATION_AGENT = 'verification-agent'

let repositories: AnalysisRepositories
let deps: CommandDeps
let seeded: Seeded
let aggregated: string
let inScope: string[]
let verificationRunId: string

const envelope = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: 'cmd-x',
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
  occurredAt: LATER,
  ...over,
})

const asAgent = {
  kind: 'institutional-agent' as const,
  agentPrincipalId: VERIFICATION_AGENT,
}

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

  /*
   * The run is started before the submission, because submitting hands the
   * work to Verification and leaves its assignment `active` — and
   * `StartAgentRun` only picks up an assignment that is waiting. That ordering
   * is the institution's, not a convenience: the desk picks the work up, and
   * the manager then declares the argument finished.
   */
  verificationRunId = await startVerificationRun()

  /* A verdict is filed against a finished argument — the rule `placeVerdict` applies. */
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
})

/** The Verification desk's own run, started as the agent that will file it. */
async function startVerificationRun(): Promise<string> {
  const assignmentId = deriveAssignmentId(`${CASE_ID}-inst`, 'verification')
  const startId = `${CASE_ID}-verification-start`
  committed(
    await runCommand(
      startAgentRun(organization),
      {
        caseId: CASE_ID,
        assignmentId,
        departmentId: 'verification',
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
      envelope({ commandId: startId, actor: asAgent }),
      deps,
    ),
    'StartAgentRun(verification)',
  )
  return deriveRunId(startId, assignmentId)
}

const produce = (status: 'verified' | 'correction-required' = 'verified') =>
  runCommand(
    recordGovernanceCandidate(organization),
    {
      caseId: CASE_ID,
      runId: verificationRunId,
      departmentId: 'verification',
      observedStates: ['running'],
      usage: { state: 'not-applicable' },
      candidate: {
        kind: 'verification',
        artifact: {
          status,
          findings:
            status === 'correction-required'
              ? [
                  {
                    kind: 'conclusion-exceeds-evidence' as const,
                    claimId: seeded.macroClaimId,
                    detail: 'The conclusion runs past what the cited work supports.',
                    blocking: true,
                    severity: 'material' as const,
                    correctionRequired: 'Narrow the conclusion or cite more.',
                  },
                ]
              : [],
          claimsReviewed: inScope,
        },
      },
    },
    envelope({ commandId: 'cmd-produce', actor: asAgent }),
    deps,
  )

const file = (over: Partial<CommandEnvelope> = {}) =>
  runCommand(
    recordVerificationReview(organization),
    {
      caseId: CASE_ID,
      byDepartmentId: 'verification',
      candidateFromRunId: verificationRunId,
    },
    envelope({ commandId: 'cmd-file', actor: asAgent, ...over }),
    deps,
  )

/* ------------------------------------------------------------ production */

describe('after production, nothing has been performed', () => {
  it('leaves the run awaiting acceptance with no institutional verdict', async () => {
    committed(await produce(), 'RecordGovernanceCandidate')

    const run = (await repositories.runs.get(verificationRunId))!
    expect(run.state).toBe('awaiting-acceptance')
    expect(await repositories.producedVerifications.get(verificationRunId)).not.toBeNull()
    expect(await repositories.reviews.verificationsForCase(CASE_ID)).toEqual([])

    const revision = (await repositories.theses.get(aggregated))!
    expect(revision.lifecycle).not.toBe('verified')

    const assignment = (await repositories.assignments.get(run.assignmentId))!
    expect(assignment.status).not.toBe('completed')
  })
})

/* --------------------------------------------------------------- filing */

describe('filing is the institutional act', () => {
  it('creates the verdict and completes the producing work, together', async () => {
    committed(await produce(), 'RecordGovernanceCandidate')
    committed(await file(), 'RecordVerificationReview')

    const reviews = await repositories.reviews.verificationsForCase(CASE_ID)
    expect(reviews).toHaveLength(1)
    const review = reviews[0]!
    expect(review.status).toBe('verified')
    expect(review.claimsReviewed).toEqual(inScope)

    /*
     * Attributed to the agent that filed it, and to no employee. The measured
     * E3 gap: the column existed and nothing bound it, so an agent's verdict
     * would have been booked to a person who never filed it.
     */
    expect(review.byAgentPrincipalId).toBe(VERIFICATION_AGENT)
    expect(review.byEmployeeId).toBeUndefined()

    /* Provenance by join, not by matching prose. */
    expect(review.filedFromCandidateRunId).toBe(verificationRunId)

    /* Both halves of adoption, in the same act. */
    const run = (await repositories.runs.get(verificationRunId))!
    expect(run.state).toBe('completed')
    const assignment = (await repositories.assignments.get(run.assignmentId))!
    expect(assignment.status).toBe('completed')

    /* The candidate survives its own adoption — it is the evidence. */
    expect(await repositories.producedVerifications.get(verificationRunId)).not.toBeNull()

    /* And the lifecycle moved, because the FILING moved it. */
    const revision = (await repositories.theses.get(aggregated))!
    expect(revision.lifecycle).toBe('verified')
  })

  it('institutionalises the candidate rather than anything the caller says', async () => {
    committed(await produce('correction-required'), 'RecordGovernanceCandidate')
    committed(
      await file({ reason: 'The cited work does not carry the conclusion.' }),
      'RecordVerificationReview',
    )

    const review = (await repositories.reviews.verificationsForCase(CASE_ID))[0]!
    expect(review.status).toBe('correction-required')
    expect(review.findings).toHaveLength(1)
    expect(review.findings[0]!.claimId).toBe(seeded.macroClaimId)

    /* A blocking verdict leaves the revision where it is. */
    const revision = (await repositories.theses.get(aggregated))!
    expect(revision.lifecycle).not.toBe('verified')
  })

  it('files a candidate once', async () => {
    committed(await produce(), 'RecordGovernanceCandidate')
    committed(await file(), 'first filing')

    const again = await file({ commandId: 'cmd-file-again' })
    expect(again.outcome).toBe('rejected')
    if (again.outcome !== 'rejected') throw new Error('unreachable')
    expect(again.rejection.detail).toMatch(/filed once/)
  })
})

/* ------------------------------------------------------------- refusals */

describe('a refused filing leaves the candidate non-institutional', () => {
  it('refuses a candidate that was never produced', async () => {
    const result = await file()
    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') throw new Error('unreachable')
    expect(result.rejection.code).toBe('not-found')

    /*
     * Still `running`, because production never happened — the run never
     * reached `awaiting-acceptance` to be filed from. What matters is that the
     * refused filing moved nothing and wrote nothing.
     */
    const run = (await repositories.runs.get(verificationRunId))!
    expect(run.state).toBe('running')
    expect(await repositories.reviews.verificationsForCase(CASE_ID)).toEqual([])
  })

  it('refuses when the argument moved under the candidate', async () => {
    committed(await produce(), 'RecordGovernanceCandidate')

    /*
     * A second aggregation supersedes the revision the verdict examined. The
     * prose still reads perfectly well, which is exactly why staleness is
     * measured against durable state instead of against how recent it is.
     */
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
          rationale: 'Reconsidered after the desks were re-read.',
          statement: 'The ECB holds through Q3.',
          position: 'hold',
          implications: ['position-sizing'],
          invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
        },
        envelope({ commandId: 'cmd-aggregate-2' }),
        deps,
      ),
      'second AggregateManagerConclusion',
    )

    const result = await file()
    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') throw new Error('unreachable')
    expect(result.rejection.detail).toMatch(/revision-superseded/)

    /* Nothing institutional, and the run is still where production left it. */
    expect(await repositories.reviews.verificationsForCase(CASE_ID)).toEqual([])
    const run = (await repositories.runs.get(verificationRunId))!
    expect(run.state).toBe('awaiting-acceptance')
    const assignment = (await repositories.assignments.get(run.assignmentId))!
    expect(assignment.status).not.toBe('completed')
  })

  it('refuses a principal that is not the control function', async () => {
    committed(await produce(), 'RecordGovernanceCandidate')

    const result = await runCommand(
      recordVerificationReview(organization),
      {
        caseId: CASE_ID,
        byDepartmentId: 'verification',
        candidateFromRunId: verificationRunId,
      },
      envelope({
        commandId: 'cmd-file-wrong',
        actor: { kind: 'institutional-agent', agentPrincipalId: 'research-office-agent' },
      }),
      deps,
    )

    expect(result.outcome).toBe('rejected')
    if (result.outcome !== 'rejected') throw new Error('unreachable')
    expect(result.rejection.code).toBe('not-authorised')
    expect(await repositories.reviews.verificationsForCase(CASE_ID)).toEqual([])
  })
})
