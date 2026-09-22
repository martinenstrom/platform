/**
 * An explanation cannot be turned into a judgement by the office's synthesis
 * (ruled 2026-09-18, resolving TD-100).
 *
 * Measured live on 2026-09-18: three syntheses of "why is gold up today"
 * declared `portfolio-risk`, Risk applied, and the explanation stopped at a
 * review nobody could perform. The rule is the institution's, applied where
 * the office institutionalises its conclusion — the provider's contract states
 * it too, but a prompt is compliance, not a guarantee.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'
import { AT, LATER, seedAggregatableCase, type Seeded } from './aggregationHarness'

let repositories: AnalysisRepositories
let deps: CommandDeps

const envelope = (commandId: string): CommandEnvelope => ({
  commandId,
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'orchestrator', orchestratorId: 'test' },
  occurredAt: LATER,
})

const aggregate = (seeded: Seeded, position: string, implications: readonly string[], commandId: string) =>
  runCommand(
    aggregateManagerConclusion(TEST_ORGANIZATION),
    {
      caseId: seeded.caseId,
      sourceRevisionId: seeded.revisionId,
      departmentId: 'research-office',
      inputRunIds: [seeded.macroRunId, seeded.quantRunId, seeded.aggregationRunId],
      dispositions: [
        { claimId: seeded.macroClaimId, disposition: 'adopted-supporting' },
        { claimId: seeded.quantClaimId, disposition: 'adopted-opposing' },
        { claimId: seeded.aggregationClaimId, disposition: 'adopted-supporting' },
      ],
      optionalInputs: [
        { playbookEntryKey: 'quant-validation', availability: 'received-and-used', scope: 'in-scope', materiallyRelevant: true },
      ],
      rationale: 'The desks agree on the driver and differ on its weight.',
      statement: 'Gold rose on lower real yields.',
      position,
      implications: implications as never,
      invalidationCriteria: 'Falls if real yields rise without gold falling.',
    },
    envelope(commandId),
    deps,
  )

beforeEach(async () => {
  repositories = createInMemoryRepositories()
  deps = {
    repositories,
    organization: TEST_ORGANIZATION,
    organizationSeedVersion: TEST_SEED_VERSION,
    provenance: await repositories.provenance(),
    now: () => AT,
  }
})

describe('an explanatory opening', () => {
  it('refuses a synthesis that declares an implementation implication, and mints no revision', async () => {
    const seeded = await seedAggregatableCase(repositories, deps, TEST_ORGANIZATION, { openingPosition: 'explain' })
    const result = await aggregate(seeded, 'explain', ['portfolio-risk'], 'cmd-explain-implication')
    expect(result).toMatchObject({ outcome: 'rejected', rejection: { code: 'invariant-violated' } })
    if (result.outcome === 'rejected') expect(result.rejection.detail).toMatch(/portfolio-risk/)
    expect(await repositories.theses.listForCase(seeded.caseId)).toHaveLength(1)
  })

  it('refuses a synthesis that takes a position', async () => {
    const seeded = await seedAggregatableCase(repositories, deps, TEST_ORGANIZATION, { openingPosition: 'explain' })
    const result = await aggregate(seeded, 'hold', [], 'cmd-explain-position')
    expect(result).toMatchObject({ outcome: 'rejected', rejection: { code: 'invariant-violated' } })
    if (result.outcome === 'rejected') expect(result.rejection.detail).toMatch(/did not ask the firm what to do/)
  })

  it('institutionalises an explanation that stays one', async () => {
    const seeded = await seedAggregatableCase(repositories, deps, TEST_ORGANIZATION, { openingPosition: 'explain' })
    const result = await aggregate(seeded, 'explain', [], 'cmd-explain-ok')
    expect(result.outcome).toBe('committed')
    const revisions = await repositories.theses.listForCase(seeded.caseId)
    expect(revisions.map((r) => [r.revisionNumber, r.position, r.implications.length])).toEqual([
      [1, 'explain', 0],
      [2, 'explain', 0],
    ])
  })
})

describe('a judgement opening', () => {
  it('lets the office take a position and declare implications, as before', async () => {
    const seeded = await seedAggregatableCase(repositories, deps, TEST_ORGANIZATION)
    const result = await aggregate(seeded, 'hold', ['portfolio-risk'], 'cmd-judgement')
    expect(result.outcome).toBe('committed')
  })
})
