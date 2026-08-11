/**
 * C1C-4.1: the whole Macro workflow, against PostgreSQL, across a real restart.
 *
 * Everything before this proved the pieces. The schema round-trips a review;
 * the commands refuse the right things; the domain decides eligibility. None of
 * that answers the question an institution actually has to answer, which is
 * whether the firm still means the same thing tomorrow morning.
 *
 * So: no in-memory adapter participates, the runtime is destroyed between the
 * two halves and proved dead, and what is compared is a canonical institutional
 * projection rather than a row count. A test that compared counts would pass
 * while a verification verdict had reattached itself to the wrong revision,
 * which is the failure this phase exists to make impossible.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'
import {
  challenge,
  institutionalState,
  LATER,
  LATEST,
  restart,
  resolveRisk,
  riskReview,
  runMacroToAggregation,
  startRuntime,
  submit,
  verify,
  type MacroCase,
  type Runtime,
} from './macroFlowHarness'
import { revisionEligibility } from '~/application/analysis/eligibility'
import { runCommand } from '~/application/analysis/commands/runCommand'
import { recordVerificationReview } from '~/application/analysis/commands/recordVerificationReview'
import { deriveRevisionId } from '~/application/analysis/commands/eventIdentity'
import { aggregateManagerConclusion } from '~/application/analysis/commands/aggregateManagerConclusion'
import { eligibilityPolicy } from '~/domain/analysis'

let db: TestDatabase
let appUrl: string
const live: Runtime[] = []

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  appUrl = await db.loginUrlFor(APP_ROLE)
}, 300_000)

afterAll(async () => {
  await Promise.all(live.splice(0).map((r) => r.container.close().catch(() => {})))
  await db?.drop()
})

const start = async () => {
  const runtime = await startRuntime(appUrl)
  live.push(runtime)
  return runtime
}

/** Restarts, tracking the new runtime so `afterAll` can close it. */
const across = async (runtime: Runtime) => {
  const next = await restart(runtime, appUrl)
  live.splice(live.indexOf(runtime), 1)
  live.push(next)
  return next
}

const eligibilityOf = async (runtime: Runtime, macro: MacroCase) => {
  const all = await revisionEligibility(
    runtime.container.repositories,
    macro.caseId,
    LATEST,
    eligibilityPolicy('1'),
  )
  return all.find((entry) => entry.revisionId === macro.revisionId)!
}

const kindsOf = async (runtime: Runtime, macro: MacroCase) =>
  (await eligibilityOf(runtime, macro)).eligibility.blockedBy.map((b) => b.kind).sort()

/** Every command id a scenario issued, so the ledger is part of the comparison. */
const commandIdsFor = (caseId: string, extra: string[] = []) => [
  `${caseId}-open`,
  `${caseId}-playbook`,
  `${caseId}-propose`,
  `${caseId}-macro-analysis-start`,
  `${caseId}-macro-analysis-record`,
  `${caseId}-aggregation-start`,
  `${caseId}-aggregation-record`,
  `${caseId}-aggregate`,
  `${caseId}-risk-req`,
  `${caseId}-submit`,
  ...extra,
]

/* ------------------------------------------------------------- the boundary */

describe('the restart boundary is real', () => {
  it('refuses to answer through a closed runtime', async () => {
    const first = await start()
    const macro = await runMacroToAggregation(first, {
      caseId: 'pg-boundary',
      quant: 'complete',
    })

    const dying = first.container.repositories.cases
    // Proved by `restart` itself; asserted here so the proof is a named test
    // rather than a side effect of a helper somebody could later soften.
    const second = await across(first)
    await expect(dying.get(macro.caseId)).rejects.toThrow()

    // And the new runtime, which can only have read from PostgreSQL.
    const reloaded = await second.container.repositories.cases.get(macro.caseId)
    expect(reloaded?.id).toBe(macro.caseId)
    expect(second.generation).toBe(2)
  })

  it('gives the second runtime its own provenance and its own organization', async () => {
    const first = await start()
    const before = first.container.provenance.provenanceId
    const second = await across(first)
    // A different reader, a different provenance row: nothing was shared.
    expect(second.container.provenance.provenanceId).not.toBe(before)
    expect(second.container.provenance.schemaVersion).toBe(
      first.container.provenance.schemaVersion,
    )
  })
})

/* ------------------------------------------------------------- scenario A */

describe('Scenario A — Risk not required', () => {
  it('is eligible before the restart and identically eligible after it', async () => {
    let runtime = await start()
    const caseId = 'pg-a'
    // No implications: the deterministic rule resolves Risk as not required.
    const macro = await runMacroToAggregation(runtime, {
      caseId,
      quant: 'complete',
      implications: [],
    })

    expect((await resolveRisk(runtime, macro)).outcome).toBe('committed')
    expect((await submit(runtime, macro)).outcome).toBe('committed')
    expect((await verify(runtime, macro)).outcome).toBe('committed')
    expect((await challenge(runtime, macro, { challenges: [] })).outcome).toBe('rejected')

    const before = await eligibilityOf(runtime, macro)
    expect(before.riskRequirement).toBe('not-required')
    expect(before.eligibility.eligibleForDecision).toBe(true)

    const ids = commandIdsFor(caseId, [
      `${caseId}-quant-validation-start`,
      `${caseId}-verify`,
    ])
    const stateBefore = await institutionalState(runtime, macro, ids)

    runtime = await across(runtime)

    const after = await eligibilityOf(runtime, macro)
    expect(after.eligibility.eligibleForDecision).toBe(true)
    expect(after.riskRequirement).toBe('not-required')
    expect(await institutionalState(runtime, macro, ids)).toEqual(stateBefore)
  })
})

/* ------------------------------------------------------------- scenario B */

describe('Scenario B — Risk required and approved', () => {
  it('blocks while missing, clears on approval, and survives the restart', async () => {
    let runtime = await start()
    const caseId = 'pg-b'
    const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })

    await resolveRisk(runtime, macro)
    await submit(runtime, macro)
    await verify(runtime, macro)

    // Required and missing.
    expect(await kindsOf(runtime, macro)).toEqual(['risk-review-missing'])
    expect((await eligibilityOf(runtime, macro)).riskRequirement).toBe('required')

    expect((await riskReview(runtime, macro)).outcome).toBe('committed')
    expect((await eligibilityOf(runtime, macro)).eligibility.eligibleForDecision).toBe(
      true,
    )

    const ids = commandIdsFor(caseId, [
      `${caseId}-quant-validation-start`,
      `${caseId}-verify`,
      `${caseId}-risk`,
    ])
    const stateBefore = await institutionalState(runtime, macro, ids)

    runtime = await across(runtime)

    const after = await eligibilityOf(runtime, macro)
    expect(after.eligibility.eligibleForDecision).toBe(true)
    expect(after.riskRequirement).toBe('required')
    // The rule that decided it reloads with its version, not just its answer.
    expect(after.riskRuleVersion).toBe(
      (await institutionalState(runtime, macro, ids)) &&
        (await eligibilityOf(runtime, macro)).riskRuleVersion,
    )
    expect(await institutionalState(runtime, macro, ids)).toEqual(stateBefore)
  })
})

/* ------------------------------------------------------------- scenario C */

describe('Scenario C — Verification correction, then a passing re-review', () => {
  it('keeps the blocking review, selects the latest deterministically, and survives', async () => {
    let runtime = await start()
    const caseId = 'pg-c'
    const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })

    await resolveRisk(runtime, macro)
    await submit(runtime, macro)
    await riskReview(runtime, macro)

    await verify(runtime, macro, {
      status: 'correction-required',
      findings: [
        {
          kind: 'calculation-error',
          claimId: macro.macroClaimId,
          detail: 'The carry calculation double-counts the roll.',
          blocking: true,
          severity: 'critical',
          correctionRequired: 'Recompute the carry without the roll term.',
        },
      ],
    })
    expect(await kindsOf(runtime, macro)).toEqual(['verification-correction-required'])

    // A genuine re-review, with the reason a changed verdict owes.
    const second = await verify(
      runtime,
      macro,
      {},
      {
        occurredAt: LATEST,
        reason: 'The desk recomputed the carry and the figure now reconciles.',
      },
      '-2',
    )
    expect(second.outcome).toBe('committed')
    expect((await eligibilityOf(runtime, macro)).eligibility.eligibleForDecision).toBe(
      true,
    )

    const ids = commandIdsFor(caseId, [
      `${caseId}-quant-validation-start`,
      `${caseId}-risk`,
      `${caseId}-verify`,
      `${caseId}-verify-2`,
    ])
    const stateBefore = await institutionalState(runtime, macro, ids)

    runtime = await across(runtime)

    const reviews =
      await runtime.container.repositories.reviews.verificationsForCase(caseId)
    expect(reviews).toHaveLength(2)
    expect(reviews.map((r) => r.sequence)).toEqual([1, 2])
    // The earlier blocking finding is still there, in full.
    expect(reviews[0]!.status).toBe('correction-required')
    expect(reviews[0]!.findings[0]).toMatchObject({
      kind: 'calculation-error',
      blocking: true,
      correctionRequired: 'Recompute the carry without the roll term.',
    })
    expect(reviews[1]!.reason).toMatch(/recomputed the carry/)

    // And the gate reads the current one.
    expect((await eligibilityOf(runtime, macro)).eligibility.eligibleForDecision).toBe(
      true,
    )
    expect(await institutionalState(runtime, macro, ids)).toEqual(stateBefore)
  })
})

/* ------------------------------------------------------------- scenario D */

describe('Scenario D — a material challenge', () => {
  it('blocks with a structured blocker that survives the restart intact', async () => {
    let runtime = await start()
    const caseId = 'pg-d'
    const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })

    await resolveRisk(runtime, macro)
    await submit(runtime, macro)
    await verify(runtime, macro)
    await riskReview(runtime, macro)
    expect((await challenge(runtime, macro)).outcome).toBe('committed')

    const before = await eligibilityOf(runtime, macro)
    const blocker = before.eligibility.blockedBy.find(
      (b) => b.kind === 'unresolved-material-challenge',
    )!
    expect(blocker).toMatchObject({
      contests: macro.macroClaimId,
      materiality: 'material',
    })
    expect(before.eligibility.eligibleForDecision).toBe(false)

    const ids = commandIdsFor(caseId, [
      `${caseId}-quant-validation-start`,
      `${caseId}-verify`,
      `${caseId}-risk`,
      `${caseId}-challenge`,
    ])
    const stateBefore = await institutionalState(runtime, macro, ids)

    runtime = await across(runtime)

    const after = await eligibilityOf(runtime, macro)
    const reloaded = after.eligibility.blockedBy.find(
      (b) => b.kind === 'unresolved-material-challenge',
    )!
    // Not merely "a blocker of the same kind": the same challenge, the same
    // claim, the same review.
    expect(reloaded).toEqual(blocker)
    expect(await institutionalState(runtime, macro, ids)).toEqual(stateBefore)
  })

  it('keeps a non-material challenge visible without blocking, across a restart', async () => {
    let runtime = await start()
    const caseId = 'pg-d2'
    const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })

    await resolveRisk(runtime, macro)
    await submit(runtime, macro)
    await verify(runtime, macro)
    await riskReview(runtime, macro)
    await challenge(runtime, macro, {
      challenges: [
        {
          contests: macro.macroClaimId,
          kind: 'fragile-assumption',
          argument: 'The wording overstates confidence slightly.',
          counterEvidence: [],
          wouldBeResolvedBy: 'A softer qualifier.',
          materiality: 'non-material',
        },
      ],
    })

    expect((await eligibilityOf(runtime, macro)).eligibility.eligibleForDecision).toBe(
      true,
    )

    runtime = await across(runtime)

    const stored = await runtime.container.repositories.reviews.challengesForCase(caseId)
    expect(stored[0]!.challenges).toHaveLength(1)
    expect(stored[0]!.challenges[0]!.materiality).toBe('non-material')
    expect((await eligibilityOf(runtime, macro)).eligibility.eligibleForDecision).toBe(
      true,
    )
  })
})

/* ------------------------------------------------------------- scenario E */

describe('Scenario E — a new revision inherits nothing', () => {
  it('reopens every gate and leaves the old revision’s history intact', async () => {
    let runtime = await start()
    const caseId = 'pg-e'
    const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })

    await resolveRisk(runtime, macro)
    await submit(runtime, macro)
    await verify(runtime, macro)
    await riskReview(runtime, macro)
    expect((await eligibilityOf(runtime, macro)).eligibility.eligibleForDecision).toBe(
      true,
    )

    runtime = await across(runtime)

    // The manager aggregates again after the restart — the workflow is
    // resumable, not merely readable.
    const deps = await runtime.container.commandDeps()
    const repositories = runtime.container.repositories
    const runs = await repositories.runs.listForCase(caseId)
    const claims = await repositories.claims.listForCase(caseId)
    const claimOf = (entryKey: string) => {
      const run = runs.find(
        (r) => r.state === 'completed' && r.execution.playbookEntryKey === entryKey,
      )!
      return { runId: run.id, claimId: run.claims[0]!.id }
    }
    const macroInput = claimOf('macro-analysis')
    const quantInput = claimOf('quant-validation')
    const officeInput = claimOf('aggregation')
    expect(claims.length).toBeGreaterThan(0)

    const secondAggregate = `${caseId}-aggregate-2`
    const result = await runCommand(
      aggregateManagerConclusion(deps.organization),
      {
        caseId,
        sourceRevisionId: macro.revisionId,
        departmentId: 'research-office',
        inputRunIds: [macroInput.runId, quantInput.runId, officeInput.runId],
        dispositions: [
          { claimId: macroInput.claimId, disposition: 'adopted-supporting' },
          { claimId: quantInput.claimId, disposition: 'adopted-opposing' },
          { claimId: officeInput.claimId, disposition: 'adopted-supporting' },
        ],
        optionalInputs: [
          {
            playbookEntryKey: 'quant-validation',
            availability: 'received-and-used',
            scope: 'in-scope',
            materiallyRelevant: true,
          },
        ],
        rationale: 'The carry was corrected and the timing shifts a quarter.',
        statement: 'The ECB holds through Q3 and cuts in December.',
        position: 'hold',
        implications: ['position-sizing'],
        invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
      },
      {
        commandId: secondAggregate,
        correlationId: 'macro-flow',
        actor: { kind: 'employee', employeeId: 'research-director' },
        initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
        occurredAt: LATEST,
      },
      deps,
    )
    expect(result.outcome).toBe('committed')

    const nextRevisionId = deriveRevisionId(secondAggregate, macro.thesisId)
    const all = await revisionEligibility(
      repositories,
      caseId,
      LATEST,
      eligibilityPolicy('1'),
    )
    const fresh = all.find((entry) => entry.revisionId === nextRevisionId)!

    expect(fresh.eligibility.eligibleForDecision).toBe(false)
    expect(fresh.riskRequirement).toBe('unresolved')
    const kinds = fresh.eligibility.blockedBy.map((b) => b.kind).sort()
    expect(kinds).toContain('verification-missing')
    expect(kinds).toContain('risk-requirement-unresolved')
    expect(fresh.reviewsRead).toEqual({
      verificationReviewId: null,
      devilsAdvocateReviewId: null,
      riskReviewId: null,
    })

    // The old revision keeps its verdicts and its own history.
    const old = all.find((entry) => entry.revisionId === macro.revisionId)!
    expect(old.reviewsRead.verificationReviewId).not.toBeNull()
    expect(old.reviewsRead.riskReviewId).not.toBeNull()
    expect(old.eligibility.lifecycle).toBe('superseded')
  })
})

/* ------------------------------------------------------------- scenario F */

describe('Scenario F — a decision-critical aggregation disagreement', () => {
  it('blocks, and the blocker names the same claim after a restart', async () => {
    let runtime = await start()
    const caseId = 'pg-f'
    const macro = await runMacroToAggregation(runtime, {
      caseId,
      quant: 'complete',
      decisionCriticalDisagreement: true,
    })

    await resolveRisk(runtime, macro)
    await submit(runtime, macro)
    await verify(runtime, macro)
    await riskReview(runtime, macro)

    const before = await eligibilityOf(runtime, macro)
    const blocker = before.eligibility.blockedBy.find(
      (b) => b.kind === 'decision-critical-disagreement',
    )!
    expect(blocker).toMatchObject({ claimId: macro.quantClaimId })
    expect(before.eligibility.eligibleForDecision).toBe(false)

    const ids = commandIdsFor(caseId, [
      `${caseId}-quant-validation-start`,
      `${caseId}-verify`,
      `${caseId}-risk`,
    ])
    const stateBefore = await institutionalState(runtime, macro, ids)

    runtime = await across(runtime)

    const after = await eligibilityOf(runtime, macro)
    expect(
      after.eligibility.blockedBy.find(
        (b) => b.kind === 'decision-critical-disagreement',
      ),
    ).toEqual(blocker)
    expect(await institutionalState(runtime, macro, ids)).toEqual(stateBefore)
  })
})

/* -------------------------------------------------- optional work that failed */

describe('an optional input that failed is recorded, not forgotten', () => {
  it('survives the restart as an unavailable optional input', async () => {
    let runtime = await start()
    const caseId = 'pg-optional'
    const macro = await runMacroToAggregation(runtime, { caseId, quant: 'fail' })

    runtime = await across(runtime)

    const aggregation = await runtime.container.repositories.aggregations.get(
      macro.aggregationId,
    )
    expect(aggregation!.optionalInputs[0]).toMatchObject({
      playbookEntryKey: 'quant-validation',
      availability: 'unavailable-at-aggregation',
      materiallyRelevant: false,
    })
    // And the failed run is still there with its category.
    const runs = await runtime.container.repositories.runs.listForCase(caseId)
    const failed = runs.find((run) => run.state === 'failed')!
    expect(failed.failure?.category).toBe('provider-timeout')
  })
})

/* ------------------------------------------------ same-kind review concurrency */

describe('two genuinely new reviews of one revision racing for a position', () => {
  it('commits both, in a deterministic order, with no raw constraint error', async () => {
    /*
     * The behaviour the design commits to: option 2. The loser reallocates
     * inside a savepoint and both immutable verdicts commit. Discarding one
     * would lose a control function's verdict; surfacing a unique-violation to
     * the caller would make a routine race look like corruption.
     */
    const runtime = await start()
    const caseId = 'pg-race'
    const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })
    await resolveRisk(runtime, macro)
    await submit(runtime, macro)

    const deps = await runtime.container.commandDeps()
    const file = (commandId: string, at: string) =>
      runCommand(
        recordVerificationReview(deps.organization),
        {
          caseId,
          thesisId: macro.thesisId,
          revisionId: macro.revisionId,
          byDepartmentId: 'verification',
          status: 'verified',
          findings: [],
          claimsReviewed: [macro.macroClaimId],
        },
        {
          commandId,
          correlationId: 'macro-flow',
          actor: { kind: 'employee', employeeId: 'verification-head' },
          initiator: { kind: 'orchestrator', orchestratorId: 'macro-orchestrator' },
          occurredAt: at,
        },
        deps,
      )

    // Two different commands, two different reviewers, issued together against
    // two real connections from the pool.
    const [a, b] = await Promise.all([
      file(`${caseId}-verify-a`, LATER),
      file(`${caseId}-verify-b`, LATEST),
    ])

    expect([a.outcome, b.outcome]).toEqual(['committed', 'committed'])

    const stored =
      await runtime.container.repositories.reviews.verificationsForCase(caseId)
    expect(stored).toHaveLength(2)
    // Both positions taken, neither discarded, and the order is total.
    expect(stored.map((r) => r.sequence)).toEqual([1, 2])
    expect(new Set(stored.map((r) => r.reviewId)).size).toBe(2)
  })

  it('returns the original review on an identical replay, consuming no position', async () => {
    const runtime = await start()
    const caseId = 'pg-replay'
    const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })
    await resolveRisk(runtime, macro)
    await submit(runtime, macro)

    const first = await verify(runtime, macro)
    const replay = await verify(runtime, macro)

    expect(first.outcome).toBe('committed')
    expect(replay.outcome).toBe('committed')
    expect('resultRef' in first && 'resultRef' in replay).toBe(true)
    expect((replay as { resultRef?: string }).resultRef).toBe(
      (first as { resultRef?: string }).resultRef,
    )

    const stored =
      await runtime.container.repositories.reviews.verificationsForCase(caseId)
    expect(stored).toHaveLength(1)
    expect(stored[0]!.sequence).toBe(1)
  })
})

/* ------------------------------------------------------------ resumability */

describe('the workflow continues after a restart', () => {
  it('accepts the verdicts the second runtime records, and reaches eligibility', async () => {
    let runtime = await start()
    const caseId = 'pg-resume'
    const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })

    await resolveRisk(runtime, macro)
    await submit(runtime, macro)

    // Everything after this point is issued by a runtime that never saw the
    // case being opened.
    runtime = await across(runtime)

    expect((await verify(runtime, macro)).outcome).toBe('committed')
    expect((await riskReview(runtime, macro)).outcome).toBe('committed')

    const after = await eligibilityOf(runtime, macro)
    expect(after.eligibility.eligibleForDecision).toBe(true)
    expect(after.reviewsRead.verificationReviewId).not.toBeNull()
    expect(after.reviewsRead.riskReviewId).not.toBeNull()

    // Events written by both runtimes, in one ordered history.
    const events = await runtime.container.repositories.events.listForCase(caseId)
    expect(events.some((e) => e.subject === 'review' && e.toState === 'verified')).toBe(
      true,
    )
    expect(events.some((e) => e.subject === 'thesis')).toBe(true)
  })
})
