/**
 * C1C-3: one minting operation, and what a new revision does not inherit.
 *
 * Three commands produce revisions. The rules about lineage, numbering,
 * supersession and inheritance live in one operation rather than three times
 * over — because two of them fail silently when duplicated: a revision that
 * supersedes the wrong predecessor, and a revision that inherits a verdict it
 * was never given.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { requirementStatusFor, type VerificationReview } from '~/domain/analysis'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import { deriveRevisionId } from '~/application/analysis/commands/eventIdentity'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import { reviseThesis } from '~/application/analysis/commands/reviseThesis'
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
  commandId: 'cmd-aggregate',
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'employee', employeeId: 'research-director' },
  occurredAt: LATER,
  ...over,
})

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
      rationale: 'Both desks read the same data and differ only on timing.',
      statement: 'The ECB holds through Q2 and cuts in September.',
      position: 'hold',
      implications: ['position-sizing'],
      invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
      ...over,
    },
    envelope(env),
    deps,
  )

const aggregatedRevisionId = () => deriveRevisionId('cmd-aggregate', seeded.thesisId)

/* --------------------------------------------------------------- the lineage */

describe('minting a revision', () => {
  it('creates revision 2 and leaves revision 1 exactly as it was', async () => {
    const before = await repositories.theses.get(seeded.revisionId)
    await aggregate()

    const revision = await repositories.theses.get(aggregatedRevisionId())
    expect(revision!.revisionNumber).toBe(2)
    expect(revision!.supersedesRevisionId).toBe(seeded.revisionId)

    const after = await repositories.theses.get(seeded.revisionId)
    // Only its lifecycle moved. Its statement, claims and implications are the
    // argument the desks actually contributed to.
    expect(after!.lifecycle).toBe('superseded')
    expect(after!.statement).toBe(before!.statement)
    expect(after!.implications).toEqual(before!.implications)
    expect(after!.revisionNumber).toBe(1)
  })

  it('numbers revisions monotonically across propose, aggregate and revise', async () => {
    await aggregate()
    await runCommand(
      reviseThesis(organization),
      {
        caseId: 'case-1',
        revisionId: aggregatedRevisionId(),
        proposedByDepartmentId: 'research-office',
        cause: 'new-evidence',
        statement: 'The ECB cuts in July after all.',
      },
      envelope({
        commandId: 'cmd-revise',
        reason: 'June inflation came in below the invalidation threshold.',
      }),
      deps,
    )

    const lineage = (await repositories.theses.listForCase('case-1')).filter(
      (revision) => revision.thesisId === seeded.thesisId,
    )
    expect(lineage.map((revision) => revision.revisionNumber)).toEqual([1, 2, 3])
    expect(lineage[2]!.supersedesRevisionId).toBe(lineage[1]!.revisionId)
  })

  it('refuses to revise a superseded revision', async () => {
    await aggregate()
    const result = await runCommand(
      reviseThesis(organization),
      {
        caseId: 'case-1',
        // Revision 1, which aggregation just superseded.
        revisionId: seeded.revisionId,
        proposedByDepartmentId: 'research-office',
        cause: 'correction',
        statement: 'x',
      },
      envelope({ commandId: 'cmd-revise-old', reason: 'A late correction.' }),
      deps,
    )

    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'illegal-prior-state' },
    })
  })

  it('replays to the same revision rather than minting a second', async () => {
    await aggregate()
    await aggregate()

    const lineage = (await repositories.theses.listForCase('case-1')).filter(
      (revision) => revision.thesisId === seeded.thesisId,
    )
    expect(lineage).toHaveLength(2)
  })

  it('refuses a different synthesis under one command id', async () => {
    await aggregate()
    const conflicting = await aggregate({ statement: 'Something else entirely.' })
    expect(conflicting).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'payload-conflict' },
    })
  })

  it('keeps derived revision ids stable across a restart', async () => {
    await aggregate()
    // No clock, no counter, no randomness: the same command produces the same
    // revision id on another machine a year later.
    expect(deriveRevisionId('cmd-aggregate', seeded.thesisId)).toBe(
      aggregatedRevisionId(),
    )
    expect((await repositories.theses.get(aggregatedRevisionId()))!.revisionNumber).toBe(
      2,
    )
  })
})

/* ------------------------------------------------------------- inheritance */

describe('what a new revision does not inherit', () => {
  it('carries no governance verdict from the revision it replaced', async () => {
    // Verification passes revision 1.
    await repositories.reviews.saveVerification({
      scope: 'thesis-revision',
      caseId: 'case-1',
      thesisId: seeded.thesisId,
      revisionId: seeded.revisionId,
      reviewId: 'v-seeded',
      sequence: 1,
      byEmployeeId: 'verification-head',
      byDepartmentId: 'verification',
      at: AT,
      status: 'verified',
      findings: [],
      claimsReviewed: [],
    } as VerificationReview)

    await aggregate()

    const verifications = await repositories.reviews.verificationsForCase('case-1')
    // The verdict stays attached to the revision it reviewed. Nothing carries
    // it forward, because reviews are scoped to an exact revision id.
    expect(verifications.map((review) => review.revisionId)).toEqual([seeded.revisionId])
    expect(
      verifications.some((review) => review.revisionId === aggregatedRevisionId()),
    ).toBe(false)
  })

  it('reopens the conditional Risk gate', async () => {
    await aggregate()
    const revisionId = aggregatedRevisionId()

    await runCommand(
      resolveConditionalRequirement(organization),
      {
        caseId: 'case-1',
        playbookEntryKey: 'risk-review',
        revisionId,
        departmentId: 'risk',
        discipline: 'risk',
      },
      envelope({
        commandId: 'cmd-risk',
        actor: { kind: 'employee', employeeId: 'chief-risk-officer' },
        reason: 'The aggregated revision declares position sizing.',
      }),
      deps,
    )

    // Resolved for revision 2 …
    const resolutions = await repositories.requirements.listForCase('case-1')
    expect(requirementStatusFor('risk-review', revisionId, resolutions).state).toBe(
      'required',
    )

    // … and a third revision starts unresolved, with nobody having to remember.
    await runCommand(
      reviseThesis(organization),
      {
        caseId: 'case-1',
        revisionId,
        proposedByDepartmentId: 'research-office',
        cause: 'changed-implications',
        implications: [],
      },
      envelope({
        commandId: 'cmd-revise',
        reason: 'The recommendation was withdrawn; this is now descriptive.',
      }),
      deps,
    )

    const third = deriveRevisionId('cmd-revise', seeded.thesisId)
    expect(
      requirementStatusFor(
        'risk-review',
        third,
        await repositories.requirements.listForCase('case-1'),
      ).state,
    ).toBe('unresolved')
  })
})

/* ------------------------------------------------------------ ReviseThesis */

describe('ReviseThesis', () => {
  const revise = (
    over: Record<string, unknown> = {},
    env: Partial<CommandEnvelope> = {},
  ) =>
    runCommand(
      reviseThesis(organization),
      {
        caseId: 'case-1',
        revisionId: seeded.revisionId,
        proposedByDepartmentId: 'research-office',
        cause: 'new-evidence',
        statement: 'The ECB cuts in July.',
        ...over,
      },
      envelope({
        commandId: 'cmd-revise',
        reason: 'June inflation came in below the invalidation threshold.',
        ...env,
      }),
      deps,
    )

  it('mints a new revision rather than editing the old one', async () => {
    const result = await revise()
    expect(result.outcome).toBe('committed')

    const next = await repositories.theses.get(
      deriveRevisionId('cmd-revise', seeded.thesisId),
    )
    expect(next!.revisionNumber).toBe(2)
    expect(next!.statement).toBe('The ECB cuts in July.')
    expect((await repositories.theses.get(seeded.revisionId))!.statement).toBe(
      'The ECB holds through Q2.',
    )
  })

  it('refuses to masquerade as a manager aggregation', async () => {
    /*
     * Without this a specialist could file a revision that reads as a
     * managerial synthesis and bypass the required-work gate, the disposition
     * map and the accountability aggregation carries.
     */
    const result = await revise({ cause: 'manager-aggregation' })
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('requires a reason', async () => {
    const result = await runCommand(
      reviseThesis(organization),
      {
        caseId: 'case-1',
        revisionId: seeded.revisionId,
        proposedByDepartmentId: 'research-office',
        cause: 'correction',
        statement: 'x',
      },
      envelope({ commandId: 'cmd-revise-noreason' }),
      deps,
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'invariant-violated' },
    })
  })

  it('refuses a department revising another’s argument', async () => {
    const result = await revise(
      { proposedByDepartmentId: 'global-macro' },
      { actor: { kind: 'employee', employeeId: 'macro-analyst' } },
    )
    expect(result).toMatchObject({
      outcome: 'rejected',
      rejection: { code: 'not-authorised' },
    })
  })

  it('records the cause beside the reason', async () => {
    await revise({ cause: 'resolved-challenge' })
    const entry = await repositories.commands.find('cmd-revise')

    expect(entry!.intent.reason).toMatch(/June inflation/)

    // The prose says what happened; the cause makes it countable, and it is
    // stored on the revision rather than only hashed into the ledger.
    const next = await repositories.theses.get(
      deriveRevisionId('cmd-revise', seeded.thesisId),
    )
    expect(next!.revisionCause).toBe('resolved-challenge')
  })
})
