/**
 * The reconsideration loop, closed.
 *
 * `deferred → decision` was legal from the day the stage table was written and
 * nothing took it. So the firm refused a deferral that named no condition for
 * ending the wait, stored those conditions, and had no way to act on them — an
 * obligation it recorded and could not fulfil. This proves the fulfilment.
 *
 * ## The two properties being proved
 *
 * **It inherits history, never judgement.** The reopened case carries a freshly
 * assembled basis judged under the policy named at reopening. The deferral
 * stays readable and grants no approval to what follows.
 *
 * **Governance verdicts are facts, not judgement, for an unchanged revision.**
 * No review is re-run and none is copied: the *same verdict identities* appear
 * in the new basis, because they are statements about a revision that has not
 * changed.
 *
 * ## Two institutional facts, proved in two places
 *
 * This suite proves the narrow half: **the fresh basis may reuse a governance
 * verdict only when it belongs to the exact immutable revision being
 * reconsidered.** Reconsideration preserves valid judgement for an unchanged
 * argument.
 *
 * The other half — **a change of revision invalidates prior judgement** — is
 * proved by `macroFlow.pg.test.ts`, *Scenario E, "a new revision inherits
 * nothing"*, which mints a second revision and asserts every gate reopens.
 *
 * They are kept apart on purpose. Reproducing Scenario E here would be a
 * second, weaker answer to a question already answered, and the two properties
 * are genuinely different claims: one is about what survives when nothing
 * changed, the other about what dies when something did.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'
import {
  challenge,
  decide,
  defer,
  reopen,
  restart,
  resolveRisk,
  riskReview,
  runMacroToAggregation,
  startRuntime,
  submit,
  submitToCio,
  triggerIdFor,
  verify,
  type MacroCase,
  type Runtime,
} from './macroFlowHarness'
import type { CommandResult } from '~/application/analysis/commands/envelope'

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

const across = async (runtime: Runtime) => {
  const next = await restart(runtime, appUrl)
  live.splice(live.indexOf(runtime), 1)
  live.push(next)
  return next
}

/**
 * Narrows a command result to the committed arm.
 *
 * Not a cast past the union: a rejected reopening is reported with its code and
 * detail, which is the difference between a test that says what the institution
 * refused and one that says an object lacked a property.
 */
function committed<T>(result: CommandResult<T>) {
  if (result.outcome === 'committed') return result
  if (result.outcome === 'rejected') {
    throw new Error(`${result.rejection.code}: ${result.rejection.detail}`)
  }
  throw new Error(`Expected a committed command, got ${result.outcome}`)
}

function rejection<T>(result: CommandResult<T>) {
  if (result.outcome !== 'rejected') {
    throw new Error(`Expected a rejection, got ${result.outcome}`)
  }
  return result.rejection
}

async function decisionReady(runtime: Runtime, caseId: string): Promise<MacroCase> {
  const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })
  await resolveRisk(runtime, macro)
  await submit(runtime, macro)
  await verify(runtime, macro)
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
  await riskReview(runtime, macro)
  return macro
}

/** Everything up to and including the deferral. */
async function deferred(runtime: Runtime, caseId: string) {
  const macro = await decisionReady(runtime, caseId)
  const submitted = committed(await submitToCio(runtime, macro))
  const deferral = committed(await defer(runtime, macro, [submitted.resultRef]))

  const investmentCase = (await runtime.container.repositories.cases.get(caseId))!
  expect(investmentCase.stage).toBe('deferred')
  return { macro, deferralId: deferral.resultRef, submissionId: submitted.resultRef }
}

/* ------------------------------------------------------------ the exit test */

describe('a deferred case returns, is decided, and stays one history', () => {
  it('travels the whole loop without re-running governance', async () => {
    const runtime = await start()
    const caseId = 'rc-loop'
    const repositories = runtime.container.repositories
    const { macro, deferralId } = await deferred(runtime, caseId)

    /* The verdicts as they stood at the deferral. Nothing is re-run below. */
    const verdictsBefore = {
      verification: (await repositories.reviews.verificationsForCase(caseId)).map(
        (review) => review.reviewId,
      ),
      devilsAdvocate: (await repositories.reviews.challengesForCase(caseId)).map(
        (review) => review.reviewId,
      ),
      risk: (await repositories.reviews.riskForCase(caseId)).map(
        (review) => review.reviewId,
      ),
    }

    /* ---- the condition is satisfied, and the CIO reopens ---- */
    const reopened = committed(await reopen(runtime, macro, deferralId))

    const afterReopen = (await repositories.cases.get(caseId))!
    expect(afterReopen.stage).toBe('decision')

    /* ---- NO new governance verdicts were created ---- */
    const verdictsAfter = {
      verification: (await repositories.reviews.verificationsForCase(caseId)).map(
        (review) => review.reviewId,
      ),
      devilsAdvocate: (await repositories.reviews.challengesForCase(caseId)).map(
        (review) => review.reviewId,
      ),
      risk: (await repositories.reviews.riskForCase(caseId)).map(
        (review) => review.reviewId,
      ),
    }
    expect(verdictsAfter).toEqual(verdictsBefore)

    /* ---- and the PRIOR verdict identities appear in the fresh basis ---- */
    const record = (await repositories.submissions.getReconsideration(
      reopened.resultRef,
    ))!
    const reopenedSubmission = (await repositories.submissions.get(record.submissionId))!
    const basis = reopenedSubmission.basis

    expect(basis.verification!.reviewId).toBe(verdictsBefore.verification[0])
    expect(basis.devilsAdvocate!.reviewId).toBe(verdictsBefore.devilsAdvocate[0])
    expect(basis.risk!.reviewId).toBe(verdictsBefore.risk[0])

    /*
     * A FRESH basis, not the deferral's. Same facts, assembled again — the
     * submission id differs, and the manifest is bound to this one.
     */
    expect(reopenedSubmission.id).not.toBe(record.reconsidersDecisionId)
    expect(basis.eligibilityPolicyVersion).toBe('1')
    expect(basis.blockers).toEqual([])

    /* ---- a superseding decision moves it to decided ---- */
    const final = committed(
      await decide(
        runtime,
        macro,
        [record.submissionId],
        { supersedesDecisionId: deferralId },
        {},
        '-final',
      ),
    )

    /*
     * THE assertion the `canTransition` correction was made for. Under the old
     * rule -- move only when not superseding -- the case would have stayed in
     * `decision` holding a live decision while appearing to await one.
     */
    expect((await repositories.cases.get(caseId))!.stage).toBe('decided')

    /* ---- one history, not two ---- */
    const history = await repositories.decisions.historyForCase(caseId)
    expect(history).toHaveLength(2)
    expect(history[0]!.decisionId).toBe(deferralId)
    expect(history[0]!.outcome.kind).toBe('deferred')
    expect(history[1]!.decisionId).toBe(final.resultRef)

    /* The deferral survives with its reasons and its conditions intact. */
    expect(history[0]!.rationale).toContain('June projections')
    expect(history[0]!.reconsiderationTriggers).toHaveLength(1)

    const liveNow = (await repositories.decisions.getForCase(caseId))!
    expect(liveNow.decisionId).toBe(final.resultRef)
  })

  it('records why the case came back', async () => {
    const runtime = await start()
    const caseId = 'rc-why'
    const { macro, deferralId } = await deferred(runtime, caseId)
    const reopened = committed(await reopen(runtime, macro, deferralId))

    const record = (await runtime.container.repositories.submissions.getReconsideration(
      reopened.resultRef,
    ))!

    expect(record.reconsidersDecisionId).toBe(deferralId)
    expect(record.reopenedByEmployeeId).toBe('cio')
    expect(record.firedTriggers).toHaveLength(1)
    expect(record.firedTriggers[0]!.triggerId).toBe(triggerIdFor(caseId))
    expect(record.firedTriggers[0]!.observation).toContain('June projections published')
  })

  it('keeps the timeline continuous across the whole loop', async () => {
    const runtime = await start()
    const caseId = 'rc-timeline'
    const { macro, deferralId } = await deferred(runtime, caseId)
    const reopened = committed(await reopen(runtime, macro, deferralId))
    committed(
      await decide(
        runtime,
        macro,
        [
          (await runtime.container.repositories.submissions.getReconsideration(
            reopened.resultRef,
          ))!.submissionId,
        ],
        { supersedesDecisionId: deferralId },
        {},
        '-final',
      ),
    )

    const events = await runtime.container.repositories.events.listForCase(caseId)
    const movements = events
      .filter((event) => event.subject === 'case')
      .map((event) => `${event.fromState}->${event.toState}`)

    /* One sequence, one case, the whole way through. */
    expect(movements).toContain('review->decision')
    expect(movements).toContain('decision->deferred')
    expect(movements).toContain('deferred->decision')
    expect(movements).toContain('decision->decided')

    for (const event of events.filter((e) => e.subject === 'case' && e.fromState)) {
      expect(event.actorEmployeeId).toBeTruthy()
      expect(event.actorDepartmentId).toBeTruthy()
    }
  })

  it('reads back identically through a runtime that never saw it', async () => {
    let runtime = await start()
    const caseId = 'rc-restart'
    const { macro, deferralId } = await deferred(runtime, caseId)
    const reopened = committed(await reopen(runtime, macro, deferralId))

    const before = await runtime.container.repositories.submissions.getReconsideration(
      reopened.resultRef,
    )
    runtime = await across(runtime)
    const after = await runtime.container.repositories.submissions.getReconsideration(
      reopened.resultRef,
    )

    expect(after).toEqual(before)
    expect((await runtime.container.repositories.cases.get(caseId))!.stage).toBe(
      'decision',
    )
  })
})

/* ------------------------------------------------------- the negative boundary */

describe('the boundary: reuse is scoped to the unchanged revision', () => {
  it('reuses only verdicts attached to the revision being reconsidered', async () => {
    /*
     * The line between reusing a fact about an unchanged argument and blessing
     * a changed one. Every verdict the fresh basis names must belong to the
     * exact revision that was deferred — a verdict about some other revision
     * appearing here would be inheritance, not reuse.
     *
     * That a NEW revision receives none of these is proved by
     * `macroFlow.pg.test.ts` Scenario E, which mints one and asserts every gate
     * reopens. It is referenced rather than reproduced: a second, weaker copy
     * of that setup would be a second answer to the same question.
     */
    const runtime = await start()
    const caseId = 'rc-scoped'
    const repositories = runtime.container.repositories
    const { macro, deferralId } = await deferred(runtime, caseId)

    const reopened = committed(await reopen(runtime, macro, deferralId))
    const record = (await repositories.submissions.getReconsideration(
      reopened.resultRef,
    ))!
    const basis = (await repositories.submissions.get(record.submissionId))!.basis

    /* The reopening stayed on the deferred revision. */
    expect(record.revisionId).toBe(macro.revisionId)

    const cited = [
      basis.verification!.reviewId,
      basis.devilsAdvocate!.reviewId,
      basis.risk!.reviewId,
    ]
    const reviews = [
      ...(await repositories.reviews.verificationsForCase(caseId)),
      ...(await repositories.reviews.challengesForCase(caseId)),
      ...(await repositories.reviews.riskForCase(caseId)),
    ]

    for (const reviewId of cited) {
      const review = reviews.find((entry) => entry.reviewId === reviewId)!
      expect(
        review,
        `basis cites ${reviewId}, which is not a review of this case`,
      ).toBeDefined()
      expect(review.revisionId).toBe(macro.revisionId)
    }
  })
})

/* --------------------------------------------------------------- refusals */

describe('what reconsideration refuses', () => {
  it('refuses a case that is not deferred', async () => {
    const runtime = await start()
    const caseId = 'rc-not-deferred'
    const macro = await decisionReady(runtime, caseId)
    const submitted = committed(await submitToCio(runtime, macro))
    committed(await decide(runtime, macro, [submitted.resultRef]))

    const live = (await runtime.container.repositories.decisions.getForCase(caseId))!
    const result = await reopen(runtime, macro, live.decisionId)

    expect(rejection(result).code).toBe('illegal-prior-state')
    expect(rejection(result).detail).toContain('decided')
    expect((await runtime.container.repositories.cases.get(caseId))!.stage).toBe(
      'decided',
    )
  })

  it('refuses a trigger belonging to another decision', async () => {
    const runtime = await start()
    const caseId = 'rc-foreign-trigger'
    const { macro, deferralId } = await deferred(runtime, caseId)

    const result = await reopen(
      runtime,
      macro,
      deferralId,
      {
        firedTriggers: [
          { triggerId: 'trg-somebody-elses', observation: 'Something happened.' },
        ],
      },
      {},
      '-foreign',
    )

    expect(rejection(result).code).toBe('invariant-violated')
    /* The case did not move on a refusal. */
    expect((await runtime.container.repositories.cases.get(caseId))!.stage).toBe(
      'deferred',
    )
  })

  it('refuses a reopening that names no condition', async () => {
    const runtime = await start()
    const caseId = 'rc-no-trigger'
    const { macro, deferralId } = await deferred(runtime, caseId)

    const result = await reopen(
      runtime,
      macro,
      deferralId,
      { firedTriggers: [] },
      {},
      '-none',
    )

    expect(rejection(result).code).toBe('invariant-violated')
    expect((await runtime.container.repositories.cases.get(caseId))!.stage).toBe(
      'deferred',
    )
  })

  it('refuses a reopening from somebody without the mandate', async () => {
    const runtime = await start()
    const caseId = 'rc-unauthorised'
    const { macro, deferralId } = await deferred(runtime, caseId)

    const result = await reopen(
      runtime,
      macro,
      deferralId,
      {},
      { actor: { kind: 'employee', employeeId: 'research-director' } },
      '-unauthorised',
    )

    expect(rejection(result).code).toBe('not-authorised')
    expect((await runtime.container.repositories.cases.get(caseId))!.stage).toBe(
      'deferred',
    )
  })
})
