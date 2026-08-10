/**
 * C1C-4: three control functions, one immutable revision.
 *
 * The failure every test here is built against: a governance verdict that
 * looks like due process while speaking about work its author never saw. A
 * review of revision 1 standing as the verdict on revision 2; a Risk approval
 * for a revision nobody established needed one; a re-review quietly replacing
 * a blocking finding with a passing one and leaving no account of why.
 *
 * Eligibility is asserted only through `revisionEligibility`, which is the
 * adapter, which calls the one domain function. No test here computes it.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { AnalysisRepositories } from '~/application/analysis/repositories'
import type { CommandEnvelope } from '~/application/analysis/commands/envelope'
import { runCommand, type CommandDeps } from '~/application/analysis/commands/runCommand'
import { deriveRevisionId } from '~/application/analysis/commands/eventIdentity'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import { resolveConditionalRequirement } from '~/application/analysis/commands/resolveConditionalRequirement'
import { submitForVerification } from '~/application/analysis/commands/submitForVerification'
import { recordVerificationReview } from '~/application/analysis/commands/recordVerificationReview'
import { recordDevilsAdvocateReview } from '~/application/analysis/commands/recordDevilsAdvocateReview'
import { recordRiskReview } from '~/application/analysis/commands/recordRiskReview'
import { revisionEligibility } from '~/application/analysis/eligibility'
import { createInMemoryRepositories } from './inMemoryRepositories'
import { TEST_ORGANIZATION, TEST_SEED_VERSION } from './testOrganization'
import { AT, LATER, seedAggregatableCase, type Seeded } from './aggregationHarness'
import { eligibilityPolicy } from '~/domain/analysis'

const organization = TEST_ORGANIZATION
const EVEN_LATER = '2026-07-30T13:00:00.000Z'

let repositories: AnalysisRepositories
let deps: CommandDeps
let seeded: Seeded
/** The revision the manager produced — the one governance is allowed to read. */
let aggregated: string

const envelope = (over: Partial<CommandEnvelope> = {}): CommandEnvelope => ({
  commandId: 'cmd-x',
  correlationId: 'corr-1',
  actor: { kind: 'employee', employeeId: 'research-director' },
  initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
  occurredAt: LATER,
  ...over,
})

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
      rationale: 'Macro and quant agree on direction and disagree on timing.',
      statement: 'The ECB holds through Q2 and cuts in September.',
      position: 'hold',
      // Implementable, so the conditional Risk rule can resolve to 'required'.
      implications: ['position-sizing'],
      invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
    },
    envelope({ commandId: 'cmd-aggregate' }),
    deps,
  )
  aggregated = deriveRevisionId('cmd-aggregate', seeded.thesisId)
})

/* -------------------------------------------------------------- helpers */

/** The rejection, or a shape that fails the assertion clearly if there is none. */
const rejectionOf = (result: {
  outcome: string
  rejection?: { code: string; detail: string }
}) => result.rejection ?? { code: result.outcome, detail: JSON.stringify(result) }

/** The committed result reference, or a marker that fails the assertion clearly. */
const refOf = (result: { outcome: string; resultRef?: string }) =>
  result.resultRef ?? `not-committed:${result.outcome}`

const caseVersion = async () => (await repositories.cases.get('case-1'))!.version

const resolveRisk = (over: Record<string, unknown> = {}) =>
  runCommand(
    resolveConditionalRequirement(organization),
    {
      caseId: 'case-1',
      playbookEntryKey: 'risk-review',
      revisionId: aggregated,
      departmentId: 'risk',
      discipline: 'risk',
      ...over,
    },
    envelope({
      commandId: 'cmd-risk-req',
      actor: { kind: 'employee', employeeId: 'chief-risk-officer' },
      reason: 'The position is implementable, so the Risk gate applies.',
    }),
    deps,
  )

const submit = async (over: Record<string, unknown> = {}, commandId = 'cmd-submit') =>
  runCommand(
    submitForVerification(organization),
    {
      caseId: 'case-1',
      revisionId: aggregated,
      submittedByDepartmentId: 'research-office',
      ...over,
    },
    envelope({ commandId, expectedVersion: await caseVersion() }),
    deps,
  )

const verify = (over: Record<string, unknown> = {}, env: Partial<CommandEnvelope> = {}) =>
  runCommand(
    recordVerificationReview(organization),
    {
      caseId: 'case-1',
      thesisId: seeded.thesisId,
      revisionId: aggregated,
      byDepartmentId: 'verification',
      status: 'verified',
      findings: [],
      claimsReviewed: [seeded.macroClaimId],
      ...over,
    },
    envelope({
      commandId: 'cmd-verify',
      actor: { kind: 'employee', employeeId: 'verification-head' },
      ...env,
    }),
    deps,
  )

const challenge = (
  over: Record<string, unknown> = {},
  env: Partial<CommandEnvelope> = {},
) =>
  runCommand(
    recordDevilsAdvocateReview(organization),
    {
      caseId: 'case-1',
      thesisId: seeded.thesisId,
      revisionId: aggregated,
      byDepartmentId: 'devils-advocate',
      challenges: [
        {
          contests: seeded.macroClaimId,
          kind: 'fragile-assumption',
          argument: 'The path assumes no fiscal impulse.',
          counterEvidence: [],
          wouldBeResolvedBy: 'A fiscal impulse estimate for the next two quarters.',
          materiality: 'material',
        },
      ],
      ...over,
    },
    envelope({
      commandId: 'cmd-challenge',
      actor: { kind: 'employee', employeeId: 'devils-advocate-head' },
      ...env,
    }),
    deps,
  )

const riskReview = (
  over: Record<string, unknown> = {},
  env: Partial<CommandEnvelope> = {},
) =>
  runCommand(
    recordRiskReview(organization),
    {
      caseId: 'case-1',
      thesisId: seeded.thesisId,
      revisionId: aggregated,
      byDepartmentId: 'risk',
      status: 'accepted',
      findings: [],
      ...over,
    },
    envelope({
      commandId: 'cmd-risk',
      actor: { kind: 'employee', employeeId: 'chief-risk-officer' },
      ...env,
    }),
    deps,
  )

/** Eligibility for the aggregated revision, through the approved path only. */
const eligibilityOf = async () => {
  const all = await revisionEligibility(repositories, 'case-1', EVEN_LATER, eligibilityPolicy('1'))
  return all.find((entry) => entry.revisionId === aggregated)!
}
const blockerKinds = async () =>
  (await eligibilityOf()).eligibility.blockedBy.map((blocker) => blocker.kind)

/* ------------------------------------------------------------ submission */

describe('SubmitForVerification', () => {
  it('targets the exact aggregated revision and opens the governance queues', async () => {
    const result = await submit()
    expect(result.outcome).toBe('committed')

    const revision = await repositories.theses.get(aggregated)
    expect(revision!.lifecycle).toBe('awaiting-verification')

    const assignments = await repositories.assignments.listForCase('case-1')
    const active = assignments
      .filter((a) => a.status === 'active')
      .map((a) => a.playbookEntryKey)
    expect(active).toContain('verification')
    expect(active).toContain('challenge')
    // Risk is unresolved, so its desk is given nothing to do.
    expect(active).not.toContain('risk-review')
  })

  it('opens the Risk queue only once Risk has been established as required', async () => {
    await resolveRisk()
    await submit()
    const assignments = await repositories.assignments.listForCase('case-1')
    expect(assignments.find((a) => a.playbookEntryKey === 'risk-review')!.status).toBe(
      'active',
    )
  })

  it('is not approval: it records no verdict of any kind', async () => {
    await submit()
    expect(await repositories.reviews.verificationsForCase('case-1')).toEqual([])
    expect(await repositories.reviews.challengesForCase('case-1')).toEqual([])
    expect(await repositories.reviews.riskForCase('case-1')).toEqual([])
    expect(await blockerKinds()).toContain('verification-missing')
  })

  it('refuses a revision no manager aggregated', async () => {
    // A case whose desk proposed a thesis and whose manager never synthesised
    // one. On `case-1` the desk's revision has already been superseded by the
    // aggregation, so that refusal would fire first and prove nothing.
    const other = await seedAggregatableCase(repositories, deps, organization, {
      caseId: 'case-2',
    })
    const otherCase = (await repositories.cases.get('case-2'))!
    const result = await runCommand(
      submitForVerification(organization),
      {
        caseId: 'case-2',
        revisionId: other.revisionId,
        submittedByDepartmentId: 'research-office',
      },
      envelope({ commandId: 'cmd-submit-raw', expectedVersion: otherCase.version }),
      deps,
    )
    expect(result.outcome).toBe('rejected')
    expect(rejectionOf(result).detail).toMatch(/not produced by a manager aggregation/)
  })

  it('refuses a superseded revision', async () => {
    await repositories.theses.save({
      ...(await repositories.theses.get(aggregated))!,
      lifecycle: 'superseded',
    })
    const result = await submit()
    expect(result.outcome).toBe('rejected')
    expect(rejectionOf(result).detail).toMatch(/superseded/)
  })

  it('refuses another department submitting the manager’s synthesis', async () => {
    const result = await runCommand(
      submitForVerification(organization),
      {
        caseId: 'case-1',
        revisionId: aggregated,
        submittedByDepartmentId: 'global-macro',
      },
      envelope({
        commandId: 'cmd-submit-wrong',
        actor: { kind: 'employee', employeeId: 'macro-head' },
        expectedVersion: await caseVersion(),
      }),
      deps,
    )
    expect(result.outcome).toBe('rejected')
    expect(rejectionOf(result).code).toBe('not-authorised')
  })

  it('refuses a stale expected version', async () => {
    const result = await runCommand(
      submitForVerification(organization),
      {
        caseId: 'case-1',
        revisionId: aggregated,
        submittedByDepartmentId: 'research-office',
      },
      envelope({ commandId: 'cmd-submit-stale', expectedVersion: 1 }),
      deps,
    )
    expect(result.outcome).toBe('rejected')
    expect(rejectionOf(result).code).toBe('aggregate-conflict')
  })
})

/* ---------------------------------------------------------- verification */

describe('RecordVerificationReview', () => {
  beforeEach(async () => {
    await submit()
  })

  it('records a verdict against the exact revision, and clears nothing else', async () => {
    const result = await verify()
    expect(result.outcome).toBe('committed')

    const stored = await repositories.reviews.verificationsForCase('case-1')
    expect(stored).toHaveLength(1)
    expect(stored[0]!.revisionId).toBe(aggregated)
    expect(stored[0]!.sequence).toBe(1)
  })

  it('preserves the structure of a finding rather than a sentence about it', async () => {
    await verify({
      status: 'correction-required',
      findings: [
        {
          kind: 'unit-mismatch',
          claimId: seeded.macroClaimId,
          detail: 'Reported in percent; the release is in percentage points.',
          blocking: true,
          severity: 'critical',
          expected: { amount: '0.25', unit: 'percentage-point' },
          observed: { amount: '0.25', unit: 'percent' },
          methodology: 'Compared against the September release table 2.',
          correctionRequired: 'Restate as percentage points.',
        },
      ],
    })
    const stored = (await repositories.reviews.verificationsForCase('case-1'))[0]!
    expect(stored.findings[0]).toMatchObject({
      expected: { amount: '0.25', unit: 'percentage-point' },
      observed: { amount: '0.25', unit: 'percent' },
      severity: 'critical',
    })
  })

  it('refuses a blocking finding that does not say what would clear it', async () => {
    const result = await verify({
      status: 'correction-required',
      findings: [
        {
          kind: 'value-mismatch',
          claimId: seeded.macroClaimId,
          detail: 'wrong',
          blocking: true,
          severity: 'critical',
        },
      ],
    })
    expect(result.outcome).toBe('rejected')
    expect(rejectionOf(result).detail).toMatch(/what would clear it/)
  })

  it('refuses a finding against a claim outside the manager’s scope', async () => {
    const result = await verify({
      findings: [
        {
          kind: 'value-mismatch',
          claimId: 'claim-nobody-aggregated',
          detail: 'wrong',
          blocking: false,
          severity: 'advisory',
        },
      ],
    })
    expect(result.outcome).toBe('rejected')
    expect(rejectionOf(result).detail).toMatch(/did not put in this revision's scope/)
  })

  it('refuses any department but Verification', async () => {
    const result = await verify({ byDepartmentId: 'risk' })
    expect(result.outcome).toBe('rejected')
    expect(rejectionOf(result).code).toBe('not-authorised')
  })

  it('does not bump the case version', async () => {
    const before = await caseVersion()
    await verify()
    expect(await caseVersion()).toBe(before)
  })

  it('blocks eligibility on a correction requirement, through the domain', async () => {
    await resolveRisk()
    await verify({
      status: 'correction-required',
      findings: [
        {
          kind: 'calculation-error',
          claimId: seeded.macroClaimId,
          detail: 'The carry calculation double-counts the roll.',
          blocking: true,
          severity: 'critical',
          correctionRequired: 'Recompute the carry without the roll term.',
        },
      ],
    })
    expect(await blockerKinds()).toContain('verification-correction-required')
  })
})

/* ------------------------------------------------------- devil's advocate */

describe('RecordDevilsAdvocateReview', () => {
  beforeEach(async () => {
    await submit()
    await verify()
    await resolveRisk()
    await riskReview()
  })

  it('blocks eligibility on an unresolved material challenge', async () => {
    await challenge()
    const kinds = await blockerKinds()
    expect(kinds).toContain('unresolved-material-challenge')
    expect((await eligibilityOf()).eligibility.eligibleForDecision).toBe(false)
  })

  it('keeps a non-material challenge visible without blocking', async () => {
    await challenge({
      challenges: [
        {
          contests: seeded.macroClaimId,
          kind: 'fragile-assumption',
          argument: 'The wording overstates confidence slightly.',
          counterEvidence: [],
          wouldBeResolvedBy: 'A softer qualifier.',
          materiality: 'non-material',
        },
      ],
    })
    const stored = (await repositories.reviews.challengesForCase('case-1'))[0]!
    expect(stored.challenges).toHaveLength(1)
    expect(await blockerKinds()).not.toContain('unresolved-material-challenge')
    expect((await eligibilityOf()).eligibility.eligibleForDecision).toBe(true)
  })

  it('stops blocking once the challenge is resolved', async () => {
    await challenge({
      challenges: [
        {
          contests: seeded.macroClaimId,
          kind: 'contradicting-evidence',
          argument: 'The order book disagrees.',
          counterEvidence: [{ setId: 'set-agg', observationId: 'o1', contentHash: 'h1' }],
          materiality: 'decision-critical',
          resolvedBy: 'research-director',
          outcome: 'resolved',
        },
      ],
    })
    expect(await blockerKinds()).not.toContain('unresolved-material-challenge')
  })

  it('refuses an objection with nothing behind it', async () => {
    const result = await challenge({
      challenges: [
        {
          contests: seeded.macroClaimId,
          kind: 'contradicting-evidence',
          argument: 'I disagree.',
          counterEvidence: [],
          materiality: 'material',
        },
      ],
    })
    expect(result.outcome).toBe('rejected')
    expect(rejectionOf(result).detail).toMatch(/argues from evidence/)
  })

  it('refuses a challenge against a claim outside scope', async () => {
    const result = await challenge({
      challenges: [
        {
          contests: 'claim-nobody-aggregated',
          kind: 'fragile-assumption',
          argument: 'Unrelated.',
          counterEvidence: [],
          wouldBeResolvedBy: 'Something.',
          materiality: 'material',
        },
      ],
    })
    expect(result.outcome).toBe('rejected')
  })

  it('mints challenge ids rather than accepting them', async () => {
    await challenge()
    const stored = (await repositories.reviews.challengesForCase('case-1'))[0]!
    expect(stored.challenges[0]!.id).toMatch(/^chl-/)
  })
})

/* -------------------------------------------------------------------- risk */

describe('the conditional Risk gate, end to end', () => {
  beforeEach(async () => {
    await submit()
    await verify()
  })

  it('leaves the revision blocked while the requirement is unresolved', async () => {
    expect(await blockerKinds()).toContain('risk-requirement-unresolved')
    expect((await eligibilityOf()).riskRequirement).toBe('unresolved')
  })

  it('refuses a Risk verdict before the requirement is resolved', async () => {
    const result = await riskReview()
    expect(result.outcome).toBe('rejected')
    expect(rejectionOf(result).detail).toMatch(/never asked/)
  })

  it('blocks when Risk is required and no review has been recorded', async () => {
    await resolveRisk()
    expect(await blockerKinds()).toEqual(['risk-review-missing'])
  })

  it('clears when Risk is required and accepts', async () => {
    await resolveRisk()
    await riskReview()
    expect((await eligibilityOf()).eligibility.eligibleForDecision).toBe(true)
  })

  it('blocks when Risk is required and rejects', async () => {
    await resolveRisk()
    await riskReview(
      {
        status: 'rejected',
        findings: [
          { kind: 'tail-risk', detail: 'Unhedged convexity.', severity: 'critical' },
        ],
      },
      { reason: 'The convexity is unhedged and the book cannot carry the tail.' },
    )
    expect(await blockerKinds()).toEqual(['risk-review-rejected'])
  })

  it('refuses a limited acceptance that states no limits', async () => {
    await resolveRisk()
    const result = await riskReview({ status: 'accepted-with-limits' })
    expect(result.outcome).toBe('rejected')
  })

  it('refuses any department but Risk', async () => {
    await resolveRisk()
    const result = await riskReview({ byDepartmentId: 'verification' })
    expect(result.outcome).toBe('rejected')
    expect(rejectionOf(result).code).toBe('not-authorised')
  })
})

/* ------------------------------------------------------ repeated reviews */

describe('a re-review is a new record', () => {
  beforeEach(async () => {
    await submit()
    await resolveRisk()
    await riskReview()
  })

  it('returns the original review on an identical replay', async () => {
    const first = await verify()
    const replay = await verify()
    expect(replay.outcome).toBe('committed')
    expect(refOf(replay)).toBe(refOf(first))
    expect(await repositories.reviews.verificationsForCase('case-1')).toHaveLength(1)
  })

  it('records a later re-review at the next position, keeping the first', async () => {
    await verify({
      status: 'correction-required',
      findings: [
        {
          kind: 'calculation-error',
          claimId: seeded.macroClaimId,
          detail: 'The carry double-counts the roll.',
          blocking: true,
          severity: 'critical',
          correctionRequired: 'Recompute without the roll term.',
        },
      ],
    })
    const second = await verify(
      {},
      {
        commandId: 'cmd-verify-2',
        occurredAt: EVEN_LATER,
        reason: 'The desk recomputed the carry and the figure now reconciles.',
      },
    )
    expect(second.outcome).toBe('committed')

    const stored = await repositories.reviews.verificationsForCase('case-1')
    expect(stored.map((review) => review.sequence)).toEqual([1, 2])
    // The earlier blocking finding is still readable.
    expect(stored[0]!.findings[0]!.blocking).toBe(true)
    // And the gate reads the current verdict.
    expect((await eligibilityOf()).eligibility.eligibleForDecision).toBe(true)
  })

  it('refuses a re-review that changes the verdict with no reason', async () => {
    const first = await verify({ status: 'correction-required', findings: [] })
    const second = await verify(
      { supersedesReviewId: refOf(first) },
      { commandId: 'cmd-verify-2', occurredAt: EVEN_LATER },
    )
    expect(second.outcome).toBe('rejected')
    expect(rejectionOf(second).detail).toMatch(/states no reason/)
  })

  it('refuses a re-review retargeted at another revision', async () => {
    const first = await verify()
    const result = await runCommand(
      recordVerificationReview(organization),
      {
        caseId: 'case-1',
        thesisId: seeded.thesisId,
        revisionId: seeded.revisionId,
        byDepartmentId: 'verification',
        status: 'verified',
        findings: [],
        claimsReviewed: [],
        supersedesReviewId: refOf(first),
      },
      envelope({
        commandId: 'cmd-verify-retarget',
        actor: { kind: 'employee', employeeId: 'verification-head' },
        occurredAt: EVEN_LATER,
      }),
      deps,
    )
    expect(result.outcome).toBe('rejected')
  })
})

/* -------------------------------------------------------- concurrency */

describe('the three control functions do not collide', () => {
  beforeEach(async () => {
    await submit()
    await resolveRisk()
  })

  it('records all three against one revision without a shared version bump', async () => {
    const before = await caseVersion()
    const results = await Promise.all([verify(), challenge(), riskReview()])
    expect(results.map((r) => r.outcome)).toEqual(['committed', 'committed', 'committed'])
    expect(await caseVersion()).toBe(before)
  })

  it('gives each discipline its own sequence numbering', async () => {
    await verify()
    await challenge()
    await riskReview()
    const sequences = [
      (await repositories.reviews.verificationsForCase('case-1'))[0]!.sequence,
      (await repositories.reviews.challengesForCase('case-1'))[0]!.sequence,
      (await repositories.reviews.riskForCase('case-1'))[0]!.sequence,
    ]
    expect(sequences).toEqual([1, 1, 1])
  })
})

/* ------------------------------------------------------------ eligibility */

describe('eligibility is derived, never stored', () => {
  it('reports projection time rather than a transition instant', async () => {
    await submit()
    await resolveRisk()
    await verify()
    await riskReview()
    const result = await eligibilityOf()
    expect(result.evaluatedAt).toBe(EVEN_LATER)
    expect(result.eligibility.eligibleForDecision).toBe(true)
  })

  it('names the verdicts it read, so the answer can be traced', async () => {
    await submit()
    await resolveRisk()
    const verification = await verify()
    const risk = await riskReview()
    const result = await eligibilityOf()
    expect(result.reviewsRead.verificationReviewId).toBe(refOf(verification))
    expect(result.reviewsRead.riskReviewId).toBe(refOf(risk))
    expect(result.reviewsRead.devilsAdvocateReviewId).toBeNull()
  })

  it('stores no eligibility flag anywhere', async () => {
    await submit()
    await resolveRisk()
    await verify()
    await riskReview()
    const revision = await repositories.theses.get(aggregated)
    expect(Object.keys(revision!)).not.toContain('eligible')
    expect(Object.keys(revision!)).not.toContain('eligibleForDecision')
  })

  it('inherits nothing onto a revision the control functions never saw', async () => {
    await submit()
    await resolveRisk()
    await verify()
    await riskReview()
    expect((await eligibilityOf()).eligibility.eligibleForDecision).toBe(true)

    // A second aggregation supersedes it, and every gate reopens.
    await runCommand(
      aggregateManagerConclusion(organization),
      {
        caseId: 'case-1',
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
        rationale: 'The carry figure was corrected and the timing shifts a quarter.',
        statement: 'The ECB holds through Q3 and cuts in December.',
        position: 'hold',
        // Implementable, so the conditional Risk rule can resolve to 'required'.
        implications: ['position-sizing'],
        invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
      },
      envelope({ commandId: 'cmd-aggregate-2', occurredAt: EVEN_LATER }),
      deps,
    )

    const next = deriveRevisionId('cmd-aggregate-2', seeded.thesisId)
    const all = await revisionEligibility(repositories, 'case-1', EVEN_LATER, eligibilityPolicy('1'))
    const fresh = all.find((entry) => entry.revisionId === next)!

    expect(fresh.eligibility.eligibleForDecision).toBe(false)
    const kinds = fresh.eligibility.blockedBy.map((blocker) => blocker.kind)
    // No verification, and Risk unresolved: neither carried over.
    expect(kinds).toContain('verification-missing')
    expect(kinds).toContain('risk-requirement-unresolved')
    expect(fresh.riskRequirement).toBe('unresolved')
  })
})
