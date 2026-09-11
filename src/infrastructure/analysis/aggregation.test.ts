/**
 * C1C-3: the managerial synthesis, and what it may not lose.
 *
 * The failure every test here is built against: a manager reconciling four
 * desks can quietly drop the one that disagreed, and the result reads exactly
 * like a manager who reconciled four desks that agreed. So most of this file is
 * about claims that must survive — as adopted opposition, as unresolved
 * disagreement, or as an exclusion with a reason somebody signed.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  evaluateRevisionEligibility,
  type AgentClaim,
  type ManagerAggregation,
} from '~/domain/analysis'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import {
  deriveAggregationId,
  deriveRevisionId,
} from '~/application/analysis/commands/eventIdentity'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'
import {
  AT,
  LATER,
  contributionFor,
  seedAggregatableCase,
  type Seeded,
} from './aggregationHarness'
import { eligibilityPolicy } from '~/domain/analysis'

/** Version 1's mandates, read from the registry rather than restated. */
const DA_ONLY = eligibilityPolicy('1').challengeMandates


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
  commandId: 'cmd-aggregate',
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
  occurredAt: LATER,
  ...over,
})

/** Aggregation with sensible defaults: everything in scope, everything adopted. */
const aggregate = (
  over: Record<string, unknown> = {},
  env: Partial<CommandEnvelope> = {},
) =>
  runCommand(
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
      rationale: 'Macro and quant agree on direction and disagree on timing.',
      statement: 'The ECB holds through Q2 and cuts in September.',
      position: 'hold',
      implications: [],
      invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
      ...over,
    },
    envelope(env),
    deps,
  )

const storedAggregation = async (): Promise<ManagerAggregation> => {
  const found = await repositories.aggregations.get(
    deriveAggregationId('cmd-aggregate', seeded.revisionId),
  )
  expect(found).not.toBeNull()
  return found!
}

/* --------------------------------------------------------- the two records */

describe('the desk contribution and the manager act', () => {
  it('keeps both, and neither replaces the other', async () => {
    const result = await aggregate()
    expect(result.outcome).toBe('committed')

    // The Research Office's run keeps its claims, untouched.
    const run = await repositories.runs.get(seeded.aggregationRunId)
    expect(run!.state).toBe('completed')
    expect(run!.claims.map((claim) => claim.id)).toEqual([seeded.aggregationClaimId])

    // And the managerial act is its own record beside it.
    const aggregation = await storedAggregation()
    expect(aggregation.sourceRevisionId).toBe(seeded.revisionId)
    expect(aggregation.producedRevisionId).toBe(
      deriveRevisionId('cmd-aggregate', seeded.thesisId),
    )
  })

  it('records the accountable manager, not the run’s provider or employee', async () => {
    await aggregate()
    const aggregation = await storedAggregation()
    const run = await repositories.runs.get(seeded.aggregationRunId)

    expect(aggregation.managerEmployeeId).toBe('research-director')
    // The run was executed by a stub on behalf of the desk. The manager is a
    // person taking responsibility for the firm's position.
    expect(run!.execution.providerKind).toBe('stub')
    expect(aggregation.managerEmployeeId).not.toBe(run!.execution.providerId)
  })

  it('refuses to aggregate before the Research Office has contributed', async () => {
    // A fresh case whose aggregation run never completed.
    const bare = await seedAggregatableCase(repositories, deps, organization, {
      caseId: 'case-2',
      completeAggregationRun: false,
    })

    const result = await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId: 'case-2',
        sourceRevisionId: bare.revisionId,
        departmentId: 'research-office',
        inputRunIds: [bare.macroRunId],
        dispositions: [{ claimId: bare.macroClaimId, disposition: 'adopted-supporting' }],
        optionalInputs: [
          {
            playbookEntryKey: 'quant-validation',
            availability: 'unavailable-at-aggregation',
            materiallyRelevant: false,
          },
        ],
        rationale: 'Only macro landed.',
        statement: 'x',
        position: 'hold',
        implications: [],
        invalidationCriteria: 'y',
      },
      envelope({ commandId: 'cmd-aggregate-2' }),
      deps,
    )

    // The Research Office's own contribution is required work for its own
    // aggregation entry — the desk's analysis comes before the manager's act.
    expect(result.outcome).toBe('rejected')
  })
})

/* -------------------------------------------------------------- required work */

describe('required work', () => {
  it('refuses when a required upstream entry has no accepted contribution', async () => {
    const bare = await seedAggregatableCase(repositories, deps, organization, {
      caseId: 'case-3',
      completeMacroRun: false,
    })

    const result = await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId: 'case-3',
        sourceRevisionId: bare.revisionId,
        departmentId: 'research-office',
        inputRunIds: [bare.aggregationRunId],
        dispositions: [
          { claimId: bare.aggregationClaimId, disposition: 'adopted-supporting' },
        ],
        optionalInputs: [
          {
            playbookEntryKey: 'quant-validation',
            availability: 'unavailable-at-aggregation',
            materiallyRelevant: false,
          },
        ],
        rationale: 'Proceeding without macro.',
        statement: 'x',
        position: 'hold',
        implications: [],
        invalidationCriteria: 'y',
      },
      envelope({ commandId: 'cmd-aggregate-3' }),
      deps,
    )

    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })

    // Nothing partial: no aggregation, no revision.
    expect(await repositories.aggregations.listForCase('case-3')).toEqual([])
    const revisions = await repositories.theses.listForCase('case-3')
    expect(revisions).toHaveLength(1)
  })

  it('records the refusal in the ledger with a reason code', async () => {
    const bare = await seedAggregatableCase(repositories, deps, organization, {
      caseId: 'case-4',
      completeMacroRun: false,
    })
    await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId: 'case-4',
        sourceRevisionId: bare.revisionId,
        departmentId: 'research-office',
        inputRunIds: [bare.aggregationRunId],
        dispositions: [
          { claimId: bare.aggregationClaimId, disposition: 'adopted-supporting' },
        ],
        optionalInputs: [
          {
            playbookEntryKey: 'quant-validation',
            availability: 'unavailable-at-aggregation',
            materiallyRelevant: false,
          },
        ],
        rationale: 'x',
        statement: 'x',
        position: 'hold',
        implications: [],
        invalidationCriteria: 'y',
      },
      envelope({ commandId: 'cmd-aggregate-4' }),
      deps,
    )

    const entry = await repositories.commands.find('cmd-aggregate-4')
    expect(entry!.outcomes).toEqual([
      { state: 'rejected', reasonCode: 'illegal-prior-state', recordedAt: AT },
    ])
  })
})

/* -------------------------------------------------------------- optional work */

describe('optional work', () => {
  it('proceeds without it, and snapshots that it was missing', async () => {
    const withoutQuant = await seedAggregatableCase(repositories, deps, organization, {
      caseId: 'case-5',
      completeQuantRun: false,
    })

    const result = await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId: 'case-5',
        sourceRevisionId: withoutQuant.revisionId,
        departmentId: 'research-office',
        inputRunIds: [withoutQuant.macroRunId, withoutQuant.aggregationRunId],
        dispositions: [
          { claimId: withoutQuant.macroClaimId, disposition: 'adopted-supporting' },
          {
            claimId: withoutQuant.aggregationClaimId,
            disposition: 'adopted-supporting',
          },
        ],
        optionalInputs: [
          {
            playbookEntryKey: 'quant-validation',
            availability: 'failed',
            materiallyRelevant: false,
          },
        ],
        rationale: 'The quant desk could not produce a regime test.',
        statement: 'x',
        position: 'hold',
        implications: [],
        invalidationCriteria: 'y',
      },
      envelope({ commandId: 'cmd-aggregate-5' }),
      deps,
    )

    expect(result.outcome).toBe('committed')
    const aggregation = (await repositories.aggregations.listForCase('case-5'))[0]!
    expect(aggregation.optionalInputs).toEqual([
      {
        playbookEntryKey: 'quant-validation',
        availability: 'failed',
        materiallyRelevant: false,
      },
    ])
  })

  it('refuses to leave an optional entry unaccounted for', async () => {
    const result = await aggregate({ optionalInputs: [] })
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('refuses to exclude a materially relevant contribution from scope', async () => {
    const result = await aggregate({
      inputRunIds: [seeded.macroRunId, seeded.aggregationRunId],
      dispositions: [
        { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
        { claimId: seeded.aggregationClaimId, disposition: 'adopted-supporting' },
      ],
      optionalInputs: [
        {
          playbookEntryKey: 'quant-validation',
          availability: 'received-not-adopted',
          scope: 'excluded-out-of-scope',
          materiallyRelevant: true,
          explanation: 'It did not fit the narrative.',
        },
      ],
    })

    // Scope selection is not a way to set aside work that bears on the thesis.
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('does not let a later contribution change a committed snapshot', async () => {
    const withoutQuant = await seedAggregatableCase(repositories, deps, organization, {
      caseId: 'case-6',
      completeQuantRun: false,
    })
    await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId: 'case-6',
        sourceRevisionId: withoutQuant.revisionId,
        departmentId: 'research-office',
        inputRunIds: [withoutQuant.macroRunId, withoutQuant.aggregationRunId],
        dispositions: [
          { claimId: withoutQuant.macroClaimId, disposition: 'adopted-supporting' },
          {
            claimId: withoutQuant.aggregationClaimId,
            disposition: 'adopted-supporting',
          },
        ],
        optionalInputs: [
          {
            playbookEntryKey: 'quant-validation',
            availability: 'unavailable-at-aggregation',
            materiallyRelevant: false,
          },
        ],
        rationale: 'Quant had not answered.',
        statement: 'x',
        position: 'hold',
        implications: [],
        invalidationCriteria: 'y',
      },
      envelope({ commandId: 'cmd-aggregate-6' }),
      deps,
    )

    // The quant desk answers afterwards.
    await contributionFor(repositories, deps, organization, {
      caseId: 'case-6',
      entryKey: 'quant-validation',
      departmentId: 'quant-technical',
      commandPrefix: 'late-quant',
    })

    const aggregation = (await repositories.aggregations.listForCase('case-6'))[0]!
    expect(aggregation.optionalInputs[0]!.availability).toBe('unavailable-at-aggregation')
  })
})

/* ---------------------------------------------------------- claim dispositions */

describe('what happens to every claim', () => {
  it('refuses a claim in scope with no disposition', async () => {
    const result = await aggregate({
      dispositions: [{ claimId: seeded.macroClaimId, disposition: 'adopted-supporting' }],
    })
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('refuses two dispositions for one claim', async () => {
    const result = await aggregate({
      dispositions: [
        { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
        { claimId: seeded.macroClaimId, disposition: 'adopted-opposing' },
        { claimId: seeded.quantClaimId, disposition: 'adopted-opposing' },
        { claimId: seeded.aggregationClaimId, disposition: 'adopted-supporting' },
      ],
    })
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('keeps an opposing claim on the revision rather than losing it', async () => {
    await aggregate()
    const revision = await repositories.theses.get(
      deriveRevisionId('cmd-aggregate', seeded.thesisId),
    )

    expect(revision!.opposingClaimIds).toContain(seeded.quantClaimId)
    expect(revision!.supportingClaimIds).toContain(seeded.macroClaimId)
  })

  it('requires an explanation for an exclusion', async () => {
    const result = await aggregate({
      dispositions: [
        { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
        { claimId: seeded.quantClaimId, disposition: 'excluded-duplicate' },
        { claimId: seeded.aggregationClaimId, disposition: 'adopted-supporting' },
      ],
    })
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('requires superseding evidence to be evidence the firm adopted', async () => {
    const result = await aggregate({
      dispositions: [
        { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
        {
          claimId: seeded.quantClaimId,
          disposition: 'superseded-by-stronger-evidence',
          explanation: 'The macro read is better sourced.',
          supersededByClaimId: 'a-claim-nobody-adopted',
        },
        { claimId: seeded.aggregationClaimId, disposition: 'adopted-supporting' },
      ],
    })
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('accepts a supersession that names an adopted claim', async () => {
    const result = await aggregate({
      dispositions: [
        { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
        {
          claimId: seeded.quantClaimId,
          disposition: 'superseded-by-stronger-evidence',
          explanation: 'The macro read is better sourced and more recent.',
          supersededByClaimId: seeded.macroClaimId,
        },
        { claimId: seeded.aggregationClaimId, disposition: 'adopted-supporting' },
      ],
    })
    expect(result.outcome).toBe('committed')
  })

  it('leaves the original claims exactly as they were', async () => {
    const before = await repositories.claims.listForCase('case-1')
    await aggregate()
    const after = await repositories.claims.listForCase('case-1')

    // Byte-identical: an aggregation references claims and never rewrites one.
    expect(JSON.stringify(after)).toBe(JSON.stringify(before))
  })
})

/* ------------------------------------------------------------- materiality */

describe('unresolved disagreement', () => {
  const retained = (materiality: string, over: Record<string, unknown> = {}) =>
    aggregate({
      dispositions: [
        { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
        {
          claimId: seeded.quantClaimId,
          disposition: 'retained-unresolved',
          explanation: 'The two desks disagree about timing and neither is wrong.',
          materiality,
        },
        { claimId: seeded.aggregationClaimId, disposition: 'adopted-supporting' },
      ],
      ...over,
    })

  it('stays attached to the revision as opposing', async () => {
    await retained('non-material')
    const revision = await repositories.theses.get(
      deriveRevisionId('cmd-aggregate', seeded.thesisId),
    )
    expect(revision!.opposingClaimIds).toContain(seeded.quantClaimId)
  })

  it('blocks nothing when it is non-material', async () => {
    await retained('non-material')
    const aggregation = await storedAggregation()
    const record = aggregation.dispositions.find(
      (d) => d.claimId === seeded.quantClaimId,
    )!

    expect(record.escalationRequired).toBe(false)
  })

  it('owes an escalation when it is material', async () => {
    await retained('material')
    const aggregation = await storedAggregation()
    const record = aggregation.dispositions.find(
      (d) => d.claimId === seeded.quantClaimId,
    )!

    expect(record.escalationRequired).toBe(true)
  })

  it('blocks the CIO when it is decision-critical', async () => {
    await retained('decision-critical')
    const aggregation = await storedAggregation()
    const record = aggregation.dispositions.find(
      (d) => d.claimId === seeded.quantClaimId,
    )!

    /*
     * Materiality is the fact aggregation records -- and now the ONLY thing it
     * records about consequence. Whether it blocks is a policy judgement made
     * at submission, under the policy in force then; migration 0023 removed the
     * stored boolean that pre-empted it.
     */
    expect(record.materiality).toBe('decision-critical')
    expect(record).not.toHaveProperty('blocksEligibility')

    /*
     * And the eligibility DECISION is the domain's, not the handler's. The
     * aggregation records the fact; `evaluateRevisionEligibility` is the one
     * place that turns facts into a verdict.
     */
    const revisionId = deriveRevisionId('cmd-aggregate', seeded.thesisId)
    const [eligibility] = evaluateRevisionEligibility(
      [
        {
          thesisId: seeded.thesisId,
          revisionId,
          lifecycle: 'verified',
          blockingDisagreements: [seeded.quantClaimId],
        },
      ],
      'case-1',
      {},
      'material',
      DA_ONLY,
    )
    expect(eligibility!.eligibleForDecision).toBe(false)
    expect(eligibility!.blockedBy.map((blocker) => blocker.kind)).toContain(
      'decision-critical-disagreement',
    )
  })

  it('refuses an unresolved disagreement with no materiality', async () => {
    const result = await aggregate({
      dispositions: [
        { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
        {
          claimId: seeded.quantClaimId,
          disposition: 'retained-unresolved',
          explanation: 'They disagree.',
        },
        { claimId: seeded.aggregationClaimId, disposition: 'adopted-supporting' },
      ],
    })
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('records a downgrade as one, with the level it came from', async () => {
    // First aggregation: decision-critical.
    await retained('decision-critical')

    // A second synthesis on the same lineage, calling the same disagreement
    // non-material. Permitted, and permanently visible as a downgrade.
    const second = await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId: 'case-1',
        sourceRevisionId: deriveRevisionId('cmd-aggregate', seeded.thesisId),
        departmentId: 'research-office',
        inputRunIds: [seeded.macroRunId, seeded.quantRunId, seeded.aggregationRunId],
        dispositions: [
          { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
          {
            claimId: seeded.quantClaimId,
            disposition: 'retained-unresolved',
            explanation: 'On reflection the timing gap does not change the call.',
            materiality: 'non-material',
          },
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
        rationale: 'Second pass after the desks spoke.',
        statement: 'x',
        position: 'hold',
        implications: [],
        invalidationCriteria: 'y',
      },
      envelope({ commandId: 'cmd-aggregate-again' }),
      deps,
    )

    expect(second.outcome).toBe('committed')
    const later = await repositories.aggregations.get(
      deriveAggregationId(
        'cmd-aggregate-again',
        deriveRevisionId('cmd-aggregate', seeded.thesisId),
      ),
    )
    const record = later!.dispositions.find((d) => d.claimId === seeded.quantClaimId)!

    // A manager may change their mind. Not invisibly.
    expect(record.materiality).toBe('non-material')
    expect(record.downgradedFrom).toBe('decision-critical')
  })
})

/* ---------------------------------------------------------------- authority */

describe('who may aggregate', () => {
  const as = (employeeId: string) =>
    aggregate(
      {},
      { commandId: `cmd-as-${employeeId}`, actor: { kind: 'employee', employeeId } },
    )

  it('lets the department’s manager act', async () => {
    expect((await as('research-director')).outcome).toBe('committed')
  })

  it('refuses a specialist from another desk', async () => {
    expect(await as('macro-analyst')).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-authorised' },
    })
  })

  it('refuses a governance employee', async () => {
    expect(await as('verification-head')).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-authorised' },
    })
  })

  it('refuses another department’s manager', async () => {
    expect(await as('macro-head')).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-authorised' },
    })
  })

  it('lets the orchestrator initiate but not author', async () => {
    const result = await aggregate(
      {},
      {
        commandId: 'cmd-orchestrated',
        initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
      },
    )
    expect(result.outcome).toBe('committed')

    const entry = await repositories.commands.find('cmd-orchestrated')
    expect(entry!.intent.initiator).toEqual({
      kind: 'orchestrator',
      orchestratorId: 'macro-orchestrator',
    })
    // Accountability is the manager's, whoever set it in motion.
    expect(entry!.intent.actor.employeeId).toBe('research-director')
  })
})

/* ------------------------------------------------------------ scope hiding */

describe('scope cannot hide contrary work', () => {
  it('refuses a declared scope that omits an opposing contribution', async () => {
    /*
     * The quant desk's claim argues against this lineage. Leaving its run out
     * of the declared set would remove it from the disposition map entirely —
     * mechanically refused, whatever the manager declares about relevance.
     */
    const result = await aggregate({
      inputRunIds: [seeded.macroRunId, seeded.aggregationRunId],
      dispositions: [
        { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
        { claimId: seeded.aggregationClaimId, disposition: 'adopted-supporting' },
      ],
      optionalInputs: [
        {
          playbookEntryKey: 'quant-validation',
          availability: 'received-not-adopted',
          scope: 'excluded-out-of-scope',
          materiallyRelevant: false,
          explanation: 'Covered by the macro read.',
        },
      ],
    })

    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('refuses a declared scope that omits required work', async () => {
    const result = await aggregate({
      inputRunIds: [seeded.quantRunId, seeded.aggregationRunId],
      dispositions: [
        { claimId: seeded.quantClaimId, disposition: 'adopted-opposing' },
        { claimId: seeded.aggregationClaimId, disposition: 'adopted-supporting' },
      ],
    })
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })
})

/* ------------------------------------------------------------- atomicity */

describe('the aggregation and the revision', () => {
  it('commit together', async () => {
    await aggregate()

    const aggregation = await storedAggregation()
    const revision = await repositories.theses.get(aggregation.producedRevisionId)

    expect(revision).not.toBeNull()
    expect(revision!.aggregationId).toBe(aggregation.id)
    expect(aggregation.producedRevisionId).toBe(revision!.revisionId)
  })

  it('write nothing when the synthesis is refused', async () => {
    await aggregate({ rationale: '   ' })

    expect(await repositories.aggregations.listForCase('case-1')).toEqual([])
    const revisions = await repositories.theses.listForCase('case-1')
    expect(revisions).toHaveLength(1)
    expect(revisions[0]!.lifecycle).not.toBe('superseded')
  })

  it('replays to the same aggregation and the same revision', async () => {
    const first = await aggregate()
    const replay = await aggregate()

    expect(first.outcome).toBe('committed')
    expect(replay.outcome).toBe('committed')
    expect(await repositories.aggregations.listForCase('case-1')).toHaveLength(1)
    expect(await repositories.theses.listForCase('case-1')).toHaveLength(2)
  })

  it('refuses a different synthesis under one command id', async () => {
    await aggregate()
    const conflicting = await aggregate({ rationale: 'A different account entirely.' })

    expect(conflicting).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'payload-conflict' },
    })
  })
})

/* --------------------------------------------------------- claim immutability */

describe('claims are references, not material', () => {
  it('offers the command no way to write a claim', async () => {
    await aggregate()
    const claim: AgentClaim | null = await repositories.claims.get(seeded.quantClaimId)

    // Still opposing, still the quant desk's words, still from its own run.
    expect(claim!.opposesThesisId).toBe(seeded.thesisId)
    expect(claim!.statement).toContain('timing')
  })
})
