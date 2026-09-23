/**
 * The control functions produce their candidates through the firm's one
 * commission path (G1, 2026-09-17).
 *
 * The filing suite (`governanceAdoption.test.ts`) starts from a candidate on
 * the record. This suite proves how one gets there: `commissionAnalysis`, the
 * path every desk runs under, working the queue a submission opened, as the
 * control function's own principal, and recording what the provider produced
 * as a candidate — never as a verdict. And what it refuses on the way: a
 * Devil's Advocate that raises nothing, a provider that does not deliver, a
 * live control function nobody budgeted, an actor that is not the function,
 * and a Risk resolution by anyone but Risk.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { buildEvidenceSet, observationRef } from '~/domain/analysis'
import { MACRO_REGIME_PLAYBOOK_V7 } from '~/application/analysis/macroPlaybook'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import { submitForVerification } from '~/application/analysis/commands/submitForVerification'
import { resolveConditionalRequirement } from '~/application/analysis/commands/resolveConditionalRequirement'
import { deriveRevisionId } from '~/application/analysis/commands/eventIdentity'
import { commissionAnalysis, type CommissionResult } from '~/application/analysis/commissionAnalysis'
import { governanceContext, type GovernanceKind } from '~/application/analysis/governanceContext'
import type { ContributionProvider } from '~/application/analysis/contributionPort'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { createStubGovernanceProvider, type StubGovernanceOutcome } from './providers/stubGovernance'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'
import { AT, LATER, seedAggregatableCase, type Seeded } from './aggregationHarness'

const organization = TEST_ORGANIZATION
const CASE_ID = 'case-1'
const QUESTION = 'Does the ECB cut before Q2?'

let repositories: AnalysisRepositories
let deps: CommandDeps
let seeded: Seeded
let aggregated: string
let evidenceSetId: string
const CORRELATION = 'corr-1'

/** One observation, so the desks are handed evidence rather than an empty set the firm refuses to commission on. */
const observed = () =>
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
    correlationId: CORRELATION,
  })

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
  /* v7: the committee's budgets. A run needs a deadline, and only a budgeted entry carries one. */
  seeded = await seedAggregatableCase(repositories, deps, organization, { playbook: MACRO_REGIME_PLAYBOOK_V7 })
  evidenceSetId = (await repositories.evidence.save(observed())).id
  committed(
    await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId: CASE_ID,
        sourceRevisionId: seeded.revisionId,
        departmentId: 'research-office',
        inputRunIds: [seeded.macroRunId, seeded.ratesRunId!, seeded.quantRunId, seeded.aggregationRunId],
        dispositions: [
          { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
          { claimId: seeded.ratesClaimId!, disposition: 'adopted-supporting' },
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
        implications: [],
        invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
      },
      envelope({ commandId: 'cmd-aggregate' }),
      deps,
    ),
    'AggregateManagerConclusion',
  )
  aggregated = deriveRevisionId('cmd-aggregate', seeded.thesisId)

  /* The submission opens the control functions' queues. Nobody has picked them up. */
  committed(
    await runCommand(
      submitForVerification(organization),
      { caseId: CASE_ID, revisionId: aggregated, submittedByDepartmentId: 'research-office' },
      envelope({ commandId: 'cmd-submit', expectedVersion: (await repositories.cases.get(CASE_ID))!.version }),
      deps,
    ),
    'SubmitForVerification',
  )
})

type ControlFunction = Exclude<GovernanceKind, 'peer-examination'>

const SEAT: Record<ControlFunction, { departmentId: string; entryKey: string; principal: string }> = {
  verification: { departmentId: 'verification', entryKey: 'verification', principal: 'verification-agent' },
  'devils-advocate': { departmentId: 'devils-advocate', entryKey: 'challenge', principal: 'devils-advocate-agent' },
}

function providerFor(kind: GovernanceKind, outcome: StubGovernanceOutcome): ContributionProvider {
  return createStubGovernanceProvider({
    kind,
    outcome,
    loadContext: async () => {
      const revision = await repositories.theses.get(aggregated)
      return revision ? governanceContext({ repositories, kind, caseId: CASE_ID, question: QUESTION, revision }) : null
    },
  })
}

function commission(
  kind: ControlFunction,
  outcome: StubGovernanceOutcome,
  over: { provider?: ContributionProvider; principal?: string } = {},
): Promise<CommissionResult> {
  const seat = SEAT[kind]
  return commissionAnalysis({
    repositories,
    deps,
    provider: over.provider ?? providerFor(kind, outcome),
    caseId: CASE_ID,
    departmentId: seat.departmentId,
    entryKey: seat.entryKey,
    evidenceSetId,
    revisionId: aggregated,
    actingPrincipal: { kind: 'institutional-agent', agentPrincipalId: over.principal ?? seat.principal },
    now: () => new Date(LATER),
  })
}

const runIdOf = (result: CommissionResult): string => {
  if (result.outcome !== 'ran') throw new Error(`no run: ${JSON.stringify(result)}`)
  return result.runId
}

const runsOf = async (departmentId: string) =>
  (await repositories.runs.listForCase(CASE_ID)).filter((run) => run.departmentId === departmentId)

/* ------------------------------------------------- the queue a submission opened */

describe('the queue a submission opened', () => {
  it('is worked by the control function’s own principal, and leaves a candidate — not a verdict', async () => {
    const assignment = (await repositories.assignments.listForCase(CASE_ID)).find(
      (candidate) => candidate.playbookEntryKey === 'verification',
    )!
    expect(assignment.status).toBe('active')

    const result = await commission('verification', { kind: 'verify' })
    const run = (await repositories.runs.get(runIdOf(result)))!
    expect(result).toMatchObject({ outcome: 'ran', state: 'awaiting-acceptance' })
    expect(run.agentPrincipalId).toBe('verification-agent')
    expect(run.revisionId).toBe(aggregated)
    expect((await repositories.producedVerifications.get(run.id))!.artifact.status).toBe('verified')

    /* Produced is not performed: no verdict, the revision unverified, the queue still open. */
    expect(await repositories.reviews.verificationsForCase(CASE_ID)).toEqual([])
    expect((await repositories.theses.get(aggregated))!.lifecycle).toBe('awaiting-verification')
    expect((await repositories.assignments.get(run.assignmentId))!.status).toBe('active')
  })

  it('is worked once: a second commission is refused while the first is on record', async () => {
    await commission('verification', { kind: 'verify' })
    expect(await commission('verification', { kind: 'verify' })).toEqual({
      outcome: 'refused',
      reason: 'assignment-not-waiting',
    })
    expect(await runsOf('verification')).toHaveLength(1)
  })

  it('refuses a principal that is not the control function, before anything runs', async () => {
    const result = await commission('verification', { kind: 'verify' }, { principal: 'devils-advocate-agent' })
    expect(result).toMatchObject({ outcome: 'declined', code: 'not-authorised' })
    expect(await runsOf('verification')).toEqual([])
  })

  it('refuses a live control function nobody budgeted, before anything is spent', async () => {
    /* A case pinned to v1, which budgets no entry at all: eligible in every other respect. */
    const unbudgeted = await seedAggregatableCase(repositories, deps, organization, { caseId: 'case-v1' })
    const live = { ...providerFor('verification', { kind: 'verify' }), kind: 'live' as const }
    const result = await commissionAnalysis({
      repositories,
      deps,
      provider: live,
      caseId: unbudgeted.caseId,
      departmentId: 'verification',
      entryKey: 'verification',
      evidenceSetId,
      revisionId: unbudgeted.revisionId,
      actingPrincipal: { kind: 'institutional-agent', agentPrincipalId: 'verification-agent' },
      now: () => new Date(LATER),
    })
    expect(result).toMatchObject({ outcome: 'refused', reason: 'no-authorized-budget' })
    expect((await repositories.runs.listForCase(unbudgeted.caseId)).filter((run) => run.departmentId === 'verification')).toEqual([])
  })

  it('records a provider that does not deliver as a failed run, in the open', async () => {
    const result = await commission('verification', { kind: 'failure' })
    expect(result).toMatchObject({ outcome: 'ran', state: 'failed', failureCategory: 'provider-error' })
    expect(await repositories.producedVerifications.get(runIdOf(result))).toBeNull()
    expect(await repositories.reviews.verificationsForCase(CASE_ID)).toEqual([])
  })
})

/* -------------------------------------------------------- the Devil's Advocate */

describe('the Devil’s Advocate', () => {
  it('records an objection as a candidate carrying the materiality it assigned', async () => {
    const result = await commission('devils-advocate', { kind: 'object', materiality: 'material' })
    expect(result).toMatchObject({ outcome: 'ran', state: 'awaiting-acceptance' })
    const candidate = (await repositories.producedChallenges.get(runIdOf(result)))!
    expect(candidate.artifact.challenges).toHaveLength(1)
    expect(candidate.artifact.challenges[0]!.materiality).toBe('material')
    /* Still a candidate: the objection is nobody's until the function files it. */
    expect(await repositories.reviews.challengesForCase(CASE_ID)).toEqual([])
  })

  it('that raises nothing is settled as malformed output, and files nothing', async () => {
    const result = await commission('devils-advocate', { kind: 'silent' })
    expect(result).toMatchObject({ outcome: 'ran', state: 'failed', failureCategory: 'malformed-output' })
    expect(await repositories.producedChallenges.get(runIdOf(result))).toBeNull()
    expect(await repositories.reviews.challengesForCase(CASE_ID)).toEqual([])
  })
})

/* ----------------------------------------------------------------- Risk */

describe('whether Risk applies', () => {
  const resolve = (agentPrincipalId: string) =>
    runCommand(
      resolveConditionalRequirement(organization),
      {
        caseId: CASE_ID,
        playbookEntryKey: 'risk-review',
        revisionId: aggregated,
        departmentId: 'risk',
        discipline: 'risk',
      },
      envelope({
        commandId: `resolve-by-${agentPrincipalId}`,
        actor: { kind: 'institutional-agent', agentPrincipalId },
        reason: 'The revision declares no implementation implications.',
      }),
      deps,
    )

  it('is resolved by the Risk principal, and by nobody else', async () => {
    expect(await resolve('research-office-agent')).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-authorised' },
    })
    expect(await resolve('verification-agent')).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-authorised' },
    })
    const resolved = await resolve('risk-agent')
    if (resolved.outcome !== 'committed') throw new Error(JSON.stringify(resolved))
    expect(resolved).toMatchObject({ outcome: 'committed', value: { state: 'not-required' } })
  })
})
