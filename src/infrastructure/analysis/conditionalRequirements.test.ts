/**
 * C1C-3: who decides whether a governance gate applies, and on what basis.
 *
 * TD-29 closed. The command takes no outcome at all — the result comes from the
 * rule, over the revision's declared implications — so there is nothing for a
 * caller to disagree with, and nothing that reads prose.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  RISK_REVIEW_WHEN_IMPLEMENTABLE,
  requirementInputHash,
  requirementStatusFor,
  type InvestmentImplication,
} from '~/domain/analysis'
import { ConflictingRecordError } from '~/application/analysis/repositories'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import { deriveRevisionId } from '~/application/analysis/commands/eventIdentity'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import { resolveConditionalRequirement } from '~/application/analysis/commands/resolveConditionalRequirement'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'
import { AT, LATER, seedAggregatableCase, type Seeded } from './aggregationHarness'

const organization = TEST_ORGANIZATION

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
  seeded = await seedAggregatableCase(repositories, deps, organization)
})

const envelope = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: 'cmd-risk',
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'chief-risk-officer' },
  initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
  occurredAt: LATER,
  reason: 'Risk assessed whether this revision creates exposure.',
  ...over,
})

/** Aggregates, so the gate is decided against the argument governance reviews. */
async function aggregatedRevision(
  implications: readonly InvestmentImplication[],
): Promise<string> {
  await runCommand(
    aggregateManagerConclusion(organization),
    {
      caseId: 'case-1',
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
      rationale: 'The desks reconcile on direction.',
      statement: 'The ECB holds through Q2.',
      position: 'hold',
      implications,
      invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
    },
    {
      commandId: 'cmd-aggregate',
      correlationId: 'corr-1',
      actor: { kind: 'employee', employeeId: 'research-director' },
      initiator: { kind: 'employee', employeeId: 'research-director' },
      occurredAt: LATER,
    },
    deps,
  )
  return deriveRevisionId('cmd-aggregate', seeded.thesisId)
}

const resolve = (revisionId: string, over: Record<string, unknown> = {}, env = {}) =>
  runCommand(
    resolveConditionalRequirement(organization),
    {
      caseId: 'case-1',
      playbookEntryKey: 'risk-review',
      revisionId,
      departmentId: 'risk',
      discipline: 'risk',
      ...over,
    },
    envelope(env),
    deps,
  )

/* ------------------------------------------------------------ computation */

describe('the outcome is computed, never supplied', () => {
  it('requires Risk when the revision could be acted on', async () => {
    const revisionId = await aggregatedRevision(['position-sizing'])
    const result = await resolve(revisionId)

    expect(result.outcome).toBe('committed')
    const resolutions = await repositories.requirements.listForCase('case-1')
    expect(requirementStatusFor('risk-review', revisionId, resolutions).state).toBe(
      'required',
    )
  })

  it('records not-required explicitly for descriptive analysis', async () => {
    const revisionId = await aggregatedRevision([])
    await resolve(revisionId)

    const resolutions = await repositories.requirements.listForCase('case-1')
    const status = requirementStatusFor('risk-review', revisionId, resolutions)

    // An explicit row: the firm looked and decided. Absence would mean nobody
    // looked, and the two must never be confused.
    expect(status.state).toBe('not-required')
    expect(status.state !== 'unresolved' && status.reason).toMatch(/descriptive analysis/)
  })

  it('offers no field through which a caller could state an outcome', async () => {
    /*
     * Stronger than validating a supplied answer: there is nothing to supply.
     * Asserted structurally, because the absence is the guarantee.
     */
    const revisionId = await aggregatedRevision(['hedging'])
    const input = {
      caseId: 'case-1',
      playbookEntryKey: 'risk-review',
      revisionId,
      departmentId: 'risk',
      discipline: 'risk',
    }
    expect(Object.keys(input)).not.toContain('required')
    expect(Object.keys(input)).not.toContain('outcome')
    expect(Object.keys(input)).not.toContain('state')

    // And an extra field changes nothing about the stored answer.
    await resolve(revisionId, { required: false } as never)
    const resolutions = await repositories.requirements.listForCase('case-1')
    expect(requirementStatusFor('risk-review', revisionId, resolutions).state).toBe(
      'required',
    )
  })

  it('stores the rule identity and a hash of exactly what it read', async () => {
    const revisionId = await aggregatedRevision(['leverage', 'hedging'])
    await resolve(revisionId)

    const [resolution] = await repositories.requirements.listForCase('case-1')
    expect(resolution!.ruleId).toBe(RISK_REVIEW_WHEN_IMPLEMENTABLE.ruleId)
    expect(resolution!.ruleVersion).toBe(RISK_REVIEW_WHEN_IMPLEMENTABLE.ruleVersion)

    // Re-derivable from the revision, without re-running the rule.
    const revision = await repositories.theses.get(revisionId)
    expect(resolution!.inputHash).toBe(
      requirementInputHash({ implications: revision!.implications }),
    )
  })
})

/* ------------------------------------------------------------- authority */

describe('who may resolve it', () => {
  it('lets the Risk function decide', async () => {
    const revisionId = await aggregatedRevision(['position-sizing'])
    expect((await resolve(revisionId)).outcome).toBe('committed')
  })

  it('refuses Verification, which is governance but handles verification', async () => {
    const revisionId = await aggregatedRevision(['position-sizing'])
    const result = await resolve(
      revisionId,
      { departmentId: 'verification', discipline: 'verification' },
      { actor: { kind: 'employee', employeeId: 'verification-head' } },
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-authorised' },
    })
  })

  it('refuses a manager', async () => {
    const revisionId = await aggregatedRevision(['position-sizing'])
    const result = await resolve(
      revisionId,
      {},
      { actor: { kind: 'employee', employeeId: 'research-director' } },
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-authorised' },
    })
  })

  it('requires a reason', async () => {
    const revisionId = await aggregatedRevision(['position-sizing'])
    const result = await runCommand(
      resolveConditionalRequirement(organization),
      {
        caseId: 'case-1',
        playbookEntryKey: 'risk-review',
        revisionId,
        departmentId: 'risk',
        discipline: 'risk',
      },
      {
        commandId: 'cmd-risk-noreason',
        correlationId: 'corr-1',
        actor: { kind: 'employee', employeeId: 'chief-risk-officer' },
        initiator: { kind: 'employee', employeeId: 'chief-risk-officer' },
        occurredAt: LATER,
      },
      deps,
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })
})

/* --------------------------------------------------------------- the scope */

describe('what it may be resolved against', () => {
  it('refuses an entry that is not conditional', async () => {
    const revisionId = await aggregatedRevision(['position-sizing'])
    const result = await resolve(revisionId, {
      playbookEntryKey: 'verification',
      departmentId: 'verification',
      discipline: 'verification',
    })
    expect(result.outcome).toBe('rejected')
  })

  it('refuses a superseded revision', async () => {
    // Resolving against the pre-aggregation revision would answer a question
    // about an argument nobody is going to review.
    await aggregatedRevision(['position-sizing'])
    const result = await resolve(seeded.revisionId)
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
  })

  it('is write-once for one revision and rule', async () => {
    const revisionId = await aggregatedRevision(['position-sizing'])
    await resolve(revisionId)

    // The same evaluation replays; a different one is a real disagreement and
    // the store refuses it.
    const replay = await resolve(revisionId)
    expect(replay.outcome).toBe('committed')

    const resolutions = await repositories.requirements.listForCase('case-1')
    expect(resolutions).toHaveLength(1)

    await expect(
      repositories.requirements.save(
        { ...resolutions[0]!, state: 'not-required' },
        deps.provenance,
      ),
    ).rejects.toBeInstanceOf(ConflictingRecordError)
  })

  it('records a requirement event rather than a review', async () => {
    const revisionId = await aggregatedRevision(['position-sizing'])
    await resolve(revisionId)

    const events = await repositories.events.listForCase('case-1')
    const requirementEvents = events.filter((event) => event.subject === 'requirement')

    // Nobody reviewed anything: the firm decided whether a review is owed.
    expect(requirementEvents).toHaveLength(1)
    expect(requirementEvents[0]!.toState).toBe('required')
    expect(requirementEvents[0]!.revisionId).toBe(revisionId)
  })
})
