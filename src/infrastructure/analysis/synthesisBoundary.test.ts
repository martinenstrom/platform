/**
 * The Research Office synthesis candidate boundary, end to end.
 *
 * The rule the whole institution rests on: a model's output is operational
 * until an accountable principal explicitly adopts it. The specialist desks
 * have crossed that boundary through the produced-claim store since C2. The
 * Research Office crossed it for its CLAIMS and not for its SYNTHESIS — the
 * statement, the position, the rationale — which arrived as command input and
 * went straight into `thesis_revisions`.
 *
 * That was harmless while a person typed them. It stops being harmless the
 * moment a model writes them, because the hierarchy would then preserve the
 * boundary for the desks below and lose it for the manager above.
 *
 * Four things are pinned here, and the last two are the ones that matter:
 *
 *   1. Only the accountable synthesis step may produce a candidate at all.
 *   2. Actor kind decides the shape, and the wrong combination fails closed.
 *   3. An agent institutionalises the EXACT persisted candidate — provably, by
 *      run id and content hash, never by matching prose.
 *   4. A candidate produced against work the firm has since moved past is
 *      refused, and no thesis revision comes out of the attempt.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { SynthesisArtifact } from '~/domain/analysis'
import { synthesisHashMatches } from '~/domain/analysis'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import {
  deriveAggregationId,
  deriveAssignmentId,
  deriveClaimId,
  deriveRunId,
} from '~/application/analysis/commands/eventIdentity'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import { recordContribution } from '~/application/analysis/commands/recordContribution'
import { acceptContribution } from '~/application/analysis/commands/acceptContribution'
import { startAgentRun } from '~/application/analysis/commands/startAgentRun'
import { resolveExecutionBudget } from '~/application/analysis/executionBudget'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'
import {
  AT,
  LATER,
  EVIDENCE_SET_ID,
  contributionFor,
  seedAggregatableCase,
  type Seeded,
} from './aggregationHarness'

const organization = TEST_ORGANIZATION
const CASE_ID = 'case-1'
const AGENT = 'research-office-agent'

let repositories: AnalysisRepositories
let deps: CommandDeps
let seeded: Seeded

beforeEach(async () => {
  repositories = createInMemoryRepositories()
  deps = {
    repositories,
    organization,
    organizationSeedVersion: TEST_SEED_VERSION,
    provenance: await repositories.provenance(),
    now: () => AT,
  }
  /*
   * Only Macro contributes. The Research Office's own run is left for each test
   * to drive, because that run is the subject — and QUANT is left untouched so
   * a test can accept an optional contribution AFTER a candidate exists, which
   * is the one kind of staleness the pre-existing rules cannot see.
   */
  seeded = await seedAggregatableCase(repositories, deps, organization, {
    completeQuantRun: false,
    completeAggregationRun: false,
  })
})

const envelope = (
  commandId: string,
  actor: CommandEnvelope['actor'],
  over: Partial<CommandEnvelope> = {},
): CommandEnvelope => ({
  commandId,
  correlationId: 'corr-1',
  actor,
  initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
  occurredAt: LATER,
  ...over,
})

const asAgent: CommandEnvelope['actor'] = {
  kind: 'institutional-agent',
  agentPrincipalId: AGENT,
}
const asDirector: CommandEnvelope['actor'] = {
  kind: 'employee',
  employeeId: 'research-director',
}

const DECLARATION = {
  providerId: 'stub',
  providerVersion: '1',
  providerKind: 'stub' as const,
  agentContractVersion: '0',
  outputSchemaVersion: '0',
  identity: { kind: 'scenario' as const, scenarioId: 'success', stubVersion: '1' },
  budget: resolveExecutionBudget('stub', { firmCeiling: { deadlineMs: 30_000 } }),
}

const claim = (id: string, statement: string) => ({
  id,
  type: 'observation' as const,
  statement,
  evidenceRefs: [],
  contradictingEvidenceRefs: [],
  confidence: {
    level: 'insufficient' as const,
    basis: ['test contribution; no evidence was examined'],
    cappedBy: 'no-evidence' as const,
  },
  temporalScope: { asOf: AT },
  status: 'insufficient-evidence' as const,
})

/**
 * What the Research Office model wrote.
 *
 * The dispositions and input runs are the model's own account of what it
 * reconciled, exactly as a producer would return them.
 */
const artifactFor = (officeClaimId: string): SynthesisArtifact => ({
  statement: 'The ECB holds through Q2 and cuts in September.',
  position: 'hold',
  rationale: 'Macro reads the policy path as unchanged into the summer.',
  invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
  implications: [],
  inputRunIds: [seeded.macroRunId, officeRunId()],
  dispositions: [
    { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
    { claimId: officeClaimId, disposition: 'adopted-supporting' },
  ],
  /*
   * The model's account of what it did not have. This is the sentence that
   * becomes false when the quant desk's work is accepted a moment later.
   */
  optionalInputs: [
    {
      playbookEntryKey: 'quant-validation',
      availability: 'unavailable-at-aggregation',
      materiallyRelevant: false,
      explanation: 'The quant desk had not contributed when this was written.',
    },
  ],
})

const OFFICE_PREFIX = 'office-agent'
const officeAssignmentId = () => deriveAssignmentId(`${CASE_ID}-inst`, 'aggregation')
const officeRunId = () => deriveRunId(`${OFFICE_PREFIX}-start`, officeAssignmentId())

/**
 * The Research Office agent's own run: started, produced, accepted.
 *
 * Every step is a real command. A test that wrote the candidate through the
 * repository would be adopting a synthesis the institution never produced,
 * which is the one thing this boundary exists to refuse.
 */
async function officeContributes(
  synthesis: SynthesisArtifact | ((officeClaimId: string) => SynthesisArtifact) | null,
  options: { accept?: boolean } = {},
) {
  const started = await runCommand(
    startAgentRun(organization),
    {
      caseId: CASE_ID,
      assignmentId: officeAssignmentId(),
      departmentId: 'research-office',
      evidenceSetId: EVIDENCE_SET_ID,
      /* The synthesis is produced FROM this revision, and adopted onto it. */
      revisionId: seeded.revisionId,
      ...DECLARATION,
    },
    envelope(`${OFFICE_PREFIX}-start`, asAgent),
    deps,
  )
  expect(started.outcome).toBe('committed')

  const runId = officeRunId()
  const providerClaimId = 'office-claim'
  const officeClaimId = `${OFFICE_PREFIX}-record`

  const artifact =
    typeof synthesis === 'function'
      ? synthesis(deriveClaimId(officeClaimId, providerClaimId))
      : synthesis

  const recorded = await runCommand(
    recordContribution(organization),
    {
      caseId: CASE_ID,
      runId,
      departmentId: 'research-office',
      claims: [claim(providerClaimId, 'Reconciling the desks leaves direction intact')],
      observedStates: ['running'],
      usage: { state: 'not-applicable' },
      ...(artifact ? { synthesis: artifact } : {}),
    },
    envelope(officeClaimId, asAgent),
    deps,
  )

  if (recorded.outcome === 'committed' && options.accept !== false) {
    const accepted = await runCommand(
      acceptContribution(organization),
      { caseId: CASE_ID, runId, departmentId: 'research-office' },
      envelope(`${OFFICE_PREFIX}-accept`, asAgent),
      deps,
    )
    expect(accepted.outcome).toBe('committed')
  }
  return { recorded, runId }
}

const adopt = (over: Record<string, unknown> = {}, commandId = 'cmd-adopt') =>
  runCommand(
    aggregateManagerConclusion(organization),
    {
      caseId: CASE_ID,
      sourceRevisionId: seeded.revisionId,
      departmentId: 'research-office',
      synthesisFromRunId: officeRunId(),
      ...over,
    },
    envelope(commandId, asAgent),
    deps,
  )

/* ============================================ where a synthesis is legal == */

describe('only the accountable synthesis step may produce one', () => {
  it('accepts one from the Research Office aggregation run', async () => {
    const { recorded, runId } = await officeContributes(artifactFor)
    expect(recorded.outcome).toBe('committed')

    const candidate = await repositories.producedSyntheses.get(runId)
    expect(candidate).not.toBeNull()
    expect(candidate!.basis.sourceRevisionId).toBe(seeded.revisionId)
    expect(candidate!.basis.playbookId).toBe('macro-regime')
    /* The digest attests the candidate it is stored with. */
    expect(synthesisHashMatches(candidate!)).toBe(true)
  })

  it('refuses one from an analytical desk', async () => {
    /*
     * The regression the whole gate exists for. `RecordContribution` grew an
     * optional field, and an optional field is not a licence: Global Macro must
     * not be able to write the firm's position because the input type changed.
     */
    const quantAssignment = deriveAssignmentId(`${CASE_ID}-inst`, 'quant-validation')
    const quantRun = deriveRunId('quant-start', quantAssignment)

    const started = await runCommand(
      startAgentRun(organization),
      {
        caseId: CASE_ID,
        assignmentId: quantAssignment,
        departmentId: 'quant-technical',
        evidenceSetId: EVIDENCE_SET_ID,
        revisionId: seeded.revisionId,
        ...DECLARATION,
      },
      envelope('quant-start', { kind: 'employee', employeeId: 'quant-head' }),
      deps,
    )
    expect(started.outcome).toBe('committed')

    const result = await runCommand(
      recordContribution(organization),
      {
        caseId: CASE_ID,
        runId: quantRun,
        departmentId: 'quant-technical',
        claims: [claim('quant-1', 'The regime indicators put the timing earlier')],
        observedStates: ['running'],
        usage: { state: 'not-applicable' },
        synthesis: artifactFor('whatever'),
      },
      envelope('quant-record', { kind: 'employee', employeeId: 'quant-head' }),
      deps,
    )

    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-authorised' },
    })
    expect(await repositories.producedSyntheses.get(quantRun)).toBeNull()
  })

  it('refuses one from a run that names no revision', async () => {
    /*
     * A synthesis answers the argument it reconciled. One that names no
     * argument could be adopted onto any of them.
     */
    await runCommand(
      startAgentRun(organization),
      {
        caseId: CASE_ID,
        assignmentId: officeAssignmentId(),
        departmentId: 'research-office',
        evidenceSetId: EVIDENCE_SET_ID,
        ...DECLARATION,
      },
      envelope(`${OFFICE_PREFIX}-start`, asAgent),
      deps,
    )
    const result = await runCommand(
      recordContribution(organization),
      {
        caseId: CASE_ID,
        runId: officeRunId(),
        departmentId: 'research-office',
        claims: [claim('office-claim', 'Reconciled')],
        observedStates: ['running'],
        usage: { state: 'not-applicable' },
        synthesis: artifactFor('whatever'),
      },
      envelope(`${OFFICE_PREFIX}-record`, asAgent),
      deps,
    )
    expect(result).toMatchObject({ outcome: 'rejected', rejection: { code: 'invariant-violated' } })
  })

  it('leaves a contribution without a synthesis exactly as it was', async () => {
    const { recorded, runId } = await officeContributes(null)
    expect(recorded.outcome).toBe('committed')
    /* Absent is absent. Nothing was produced, so nothing is stored. */
    expect(await repositories.producedSyntheses.get(runId)).toBeNull()
  })
})

/* ================================================ who may adopt, and how == */

describe('actor kind decides the shape, and the wrong one fails closed', () => {
  it('refuses an agent stating a synthesis directly', async () => {
    await officeContributes(artifactFor)
    const result = await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId: CASE_ID,
        sourceRevisionId: seeded.revisionId,
        departmentId: 'research-office',
        inputRunIds: [seeded.macroRunId, officeRunId()],
        dispositions: [],
        optionalInputs: [],
        rationale: 'Because I say so.',
        statement: 'Something the model never produced.',
        position: 'hold',
        implications: [],
        invalidationCriteria: 'Never.',
      },
      envelope('cmd-direct-agent', asAgent),
      deps,
    )
    expect(result).toMatchObject({ outcome: 'rejected', rejection: { code: 'not-authorised' } })
  })

  it('refuses an employee adopting a candidate', async () => {
    await officeContributes(artifactFor)
    const result = await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId: CASE_ID,
        sourceRevisionId: seeded.revisionId,
        departmentId: 'research-office',
        synthesisFromRunId: officeRunId(),
      },
      envelope('cmd-adopt-human', asDirector),
      deps,
    )
    expect(result).toMatchObject({ outcome: 'rejected', rejection: { code: 'invariant-violated' } })
  })

  it('refuses adopting a candidate that was never produced', async () => {
    await officeContributes(null)
    const result = await adopt()
    expect(result).toMatchObject({ outcome: 'rejected', rejection: { code: 'not-found' } })
  })

  it('refuses an agent of another department', async () => {
    await officeContributes(artifactFor)
    const result = await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId: CASE_ID,
        sourceRevisionId: seeded.revisionId,
        departmentId: 'research-office',
        synthesisFromRunId: officeRunId(),
      },
      envelope('cmd-adopt-macro', {
        kind: 'institutional-agent',
        agentPrincipalId: 'global-macro-agent',
      }),
      deps,
    )
    expect(result).toMatchObject({ outcome: 'rejected', rejection: { code: 'not-authorised' } })
  })
})

/* ========================================= the candidate becomes the act == */

describe('the exact persisted candidate becomes the institutional synthesis', () => {
  it('institutionalises what the model wrote, provably', async () => {
    const { runId } = await officeContributes(artifactFor)
    const candidate = await repositories.producedSyntheses.get(runId)

    const result = await adopt()
    expect(result.outcome).toBe('committed')

    const aggregation = await repositories.aggregations.get(
      deriveAggregationId('cmd-adopt', seeded.revisionId),
    )
    expect(aggregation).not.toBeNull()

    /*
     * The proof, and it is a join rather than a comparison of prose: the
     * aggregation names the run whose candidate it adopted, and that candidate
     * still hashes to its own contents.
     */
    expect(aggregation!.synthesisRunId).toBe(runId)
    expect(synthesisHashMatches(candidate!)).toBe(true)

    /* The agent stood behind it. Not the human Research Director. */
    expect(aggregation!.managerAgentPrincipalId).toBe(AGENT)
    expect(aggregation!.managerEmployeeId).toBeUndefined()

    const revision = await repositories.theses.get(
      (result as { value: { revisionId: string } }).value.revisionId,
    )
    expect(revision!.statement).toBe(candidate!.artifact.statement)
    expect(revision!.proposedByAgentPrincipalId).toBe(AGENT)
    expect(revision!.proposedByEmployeeId).toBeUndefined()
    expect(revision!.aggregationId).toBe(aggregation!.id)
  })

  it('refuses a candidate produced from a different revision', async () => {
    await officeContributes(artifactFor)
    const result = await adopt({ sourceRevisionId: 'some-other-revision' })
    expect(result.outcome).toBe('rejected')
  })

  it('leaves the human path untouched', async () => {
    /*
     * A person may still read the contributions and state a position they stand
     * behind, in one act, with no candidate anywhere. No historical aggregation
     * is given a synthetic one to look like an adoption.
     */
    const office = await contributionFor(repositories, deps, organization, {
      caseId: CASE_ID,
      entryKey: 'aggregation',
      departmentId: 'research-office',
      commandPrefix: `${CASE_ID}-agg`,
      statement: 'Reconciling the desks leaves the direction intact',
      instantiateCommandId: `${CASE_ID}-inst`,
    })

    const result = await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId: CASE_ID,
        sourceRevisionId: seeded.revisionId,
        departmentId: 'research-office',
        inputRunIds: [seeded.macroRunId, office.runId],
        dispositions: [
          { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
          { claimId: office.claimId, disposition: 'adopted-supporting' },
        ],
        optionalInputs: [
          {
            playbookEntryKey: 'quant-validation',
            availability: 'unavailable-at-aggregation',
            materiallyRelevant: false,
            explanation: 'The quant desk did not contribute for this case.',
          },
        ],
        rationale: 'Macro reads the policy path as unchanged into the summer.',
        statement: 'The ECB holds through Q2 and cuts in September.',
        position: 'hold',
        implications: [],
        invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
      },
      envelope('cmd-human', asDirector),
      deps,
    )
    expect(result.outcome).toBe('committed')

    const aggregation = await repositories.aggregations.get(
      deriveAggregationId('cmd-human', seeded.revisionId),
    )
    expect(aggregation!.managerEmployeeId).toBe('research-director')
    expect(aggregation!.managerAgentPrincipalId).toBeUndefined()
    expect(aggregation!.synthesisRunId).toBeUndefined()
  })
})

/* ================================================== the stale-candidate == */

describe('a candidate produced against work the firm has moved past', () => {
  it('is refused, and no thesis revision comes out of the attempt', async () => {
    /*
     * The discriminating test of this whole slice.
     *
     * The Research Office produces a candidate saying the quant desk was
     * unavailable. The quant desk's contribution — optional, and arguing
     * against nothing — is then accepted. None of the pre-existing rules
     * notice: it is not required work, it is not opposition, and every optional
     * playbook entry is still accounted for. But
     * the candidate's account of what the firm held has become false, and a
     * synthesis whose account of what it saw is wrong is not a weaker
     * synthesis. It is a different one.
     */
    await officeContributes(artifactFor)

    const before = await repositories.theses.listForCase(CASE_ID)

    await contributionFor(repositories, deps, organization, {
      caseId: CASE_ID,
      entryKey: 'quant-validation',
      departmentId: 'quant-technical',
      commandPrefix: `${CASE_ID}-quant-late`,
      statement: 'The indicators moved after the office concluded',
      instantiateCommandId: `${CASE_ID}-inst`,
    })

    const result = await adopt()
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
    expect((result as { rejection: { detail: string } }).rejection.detail).toContain(
      'since accepted',
    )

    /* Nothing was minted. A refused adoption produces no institutional state. */
    const after = await repositories.theses.listForCase(CASE_ID)
    expect(after.length).toBe(before.length)
    expect(
      await repositories.aggregations.get(
        deriveAggregationId('cmd-adopt', seeded.revisionId),
      ),
    ).toBeNull()
  })

  it('adopts cleanly when nothing moved', async () => {
    /*
     * The near-miss. Without it the test above would pass just as well against
     * a rule that refused everything.
     */
    await officeContributes(artifactFor)
    expect((await adopt()).outcome).toBe('committed')
  })
})
