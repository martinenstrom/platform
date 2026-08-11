/**
 * The First Defensible Decision, end to end, against PostgreSQL.
 *
 * The whole path in one run: a case opened, work assigned and contributed,
 * a manager's synthesis, three governance verdicts, a submission, a CIO
 * decision — then a restart, and the same decision read back by a runtime that
 * never saw it being made.
 *
 * ## Why this suite exists
 *
 * Every command below passed a typecheck and two green suites while being
 * unable to execute. They never moved the case stage, they wrote transition
 * events of a shape the interface does not have, and three of them declared a
 * category their mandate forbids. None of it was reachable by any test, because
 * no test ran them — a command with no caller is not merely untested, its
 * defects are inexpressible.
 *
 * So this is not only the product milestone. It is the verification layer that
 * catches composition: the one place where the parts are asked to be a firm
 * rather than a set of correct pieces.
 *
 * ## What "defensible" is being taken to mean
 *
 * Not that the decision was good. That the record of it survives a restart
 * intact and answers, without inference: who decided, under what authority, on
 * which exact revision, against which assembled facts, under which named
 * policy, and who disagreed at the time.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'
import {
  decide,
  LATEST,
  restart,
  resolveRisk,
  returnToDesk,
  riskReview,
  runMacroToAggregation,
  startRuntime,
  submit,
  submitToCio,
  verify,
  challenge,
  type MacroCase,
  type Runtime,
} from './macroFlowHarness'
import type { CommandResult } from '~/application/analysis/commands/envelope'

/**
 * Reads a result as the outcome it claims to be.
 *
 * Deliberately not a cast. `as` would let this suite assert against a shape the
 * result does not have and pass -- which is precisely how four commands reached
 * `main` unable to run.
 */
function committed<T>(result: CommandResult<T>) {
  if (result.outcome === 'committed') return result
  if (result.outcome === 'rejected') {
    throw new Error(
      `Expected a committed command, got ${result.rejection.code}: ` +
        result.rejection.detail,
    )
  }
  if (result.outcome === 'failed') {
    throw new Error(
      `Expected a committed command, got a storage failure: ${result.error.message}`,
    )
  }
  throw new Error(`Expected a committed command, got ${result.outcome}`)
}

function rejected<T>(result: CommandResult<T>) {
  if (result.outcome !== 'rejected') {
    throw new Error(`Expected a rejection, got ${result.outcome}`)
  }
  return result.rejection
}

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

/** Everything up to and including eligibility, with no CIO act yet. */
async function toDecisionReady(runtime: Runtime, caseId: string): Promise<MacroCase> {
  const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })
  await resolveRisk(runtime, macro)
  await submit(runtime, macro)
  expect((await verify(runtime, macro)).outcome).toBe('committed')
  /*
   * The Devil's Advocate raised an objection and judged it immaterial.
   *
   * It stays OPEN and unresolved, and the case still reaches a decision. That
   * is the whole point of basis canonicalization v2: materiality is a fact the
   * record carries, and whether it blocks is the policy's answer, not the
   * gate's opinion. Until v2 this exact state was refused, and this suite had
   * to route around it.
   *
   * The objection does not disappear -- the CIO reads it beside the thesis,
   * and the assertions below check it survived to the decision.
   */
  expect(
    (
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
    ).outcome,
  ).toBe('committed')
  expect((await riskReview(runtime, macro)).outcome).toBe('committed')
  return macro
}

const stageOf = async (runtime: Runtime, caseId: string) =>
  (await runtime.container.repositories.cases.get(caseId))!.stage

/* ------------------------------------------------------------ the full path */

describe('The First Defensible Decision', () => {
  it('travels the whole path and reaches a recorded decision', async () => {
    const runtime = await start()
    const caseId = 'cio-full'
    const macro = await toDecisionReady(runtime, caseId)

    /*
     * The case is in review, not decision. Nothing has asked the CIO yet, and
     * the distinction is the one the defect made invisible: work that is ready
     * to be decided is not work that has been put in front of anybody.
     */
    expect(await stageOf(runtime, caseId)).toBe('review')

    const submitted = await submitToCio(runtime, macro)
    const submissionId = committed(submitted).resultRef
    expect(await stageOf(runtime, caseId)).toBe('decision')
    committed(await decide(runtime, macro, [submissionId]))

    /* The terminal stage, reached by the decision and not by anything else. */
    expect(await stageOf(runtime, caseId)).toBe('decided')

    const submission = await runtime.container.repositories.submissions.get(submissionId)
    expect(submission!.state).toBe('decided')
  })

  it('records who decided, on what, and under which named policy', async () => {
    const runtime = await start()
    const caseId = 'cio-record'
    const macro = await toDecisionReady(runtime, caseId)

    const submitted = await submitToCio(runtime, macro)
    const submissionId = committed(submitted).resultRef
    await decide(runtime, macro, [submissionId])

    const repositories = runtime.container.repositories
    const decision = (await repositories.decisions.getForCase(caseId))!

    expect(decision.decidedByEmployeeId).toBe('cio')
    expect(decision.authorizationBasis).toBe('chief-investment-officer')
    expect(decision.outcome.kind).toBe('selected')
    expect(decision.outcome.selectedRevisionId).toBe(macro.revisionId)
    expect(decision.submissionIds).toEqual([submissionId])

    /*
     * The policy the eligibility was judged under is on the record, not
     * implied. Re-examining this decision later resolves the same version
     * rather than whatever version is current then.
     */
    const stored = await repositories.submissions.get(submissionId)
    expect(stored!.basis.eligibilityPolicyVersion).toBe('1')
    expect(stored!.basis.blockers).toEqual([])

    /*
     * The non-material objection is IN the basis the CIO decided on. Not
     * blocking and not dropped -- a basis that had filtered it would make the
     * record of this decision quieter than the firm's own rule allows.
     */
    expect(stored!.basis.devilsAdvocate!.openChallenges).toHaveLength(1)
    expect(stored!.basis.devilsAdvocate!.openChallenges[0]!.materiality).toBe(
      'non-material',
    )
    expect(stored!.basis.manifest.canonicalizationVersion).toBe(2)
  })

  it('writes a case movement the timeline can be read from', async () => {
    const runtime = await start()
    const caseId = 'cio-events'
    const macro = await toDecisionReady(runtime, caseId)

    const submitted = await submitToCio(runtime, macro)
    await decide(runtime, macro, [committed(submitted).resultRef])

    const events = await runtime.container.repositories.events.listForCase(caseId)
    const movements = events
      .filter((event) => event.subject === 'case')
      .map((event) => `${event.fromState}->${event.toState}`)

    expect(movements).toContain('review->decision')
    expect(movements).toContain('decision->decided')

    /*
     * Every case movement names a person and a department. This is the
     * assertion the malformed events would have failed: they carried no
     * `eventId`, no subject and no actor at all.
     */
    for (const event of events.filter((e) => e.subject === 'case' && e.fromState)) {
      expect(event.eventId).toBeTruthy()
      expect(event.actorEmployeeId).toBeTruthy()
      expect(event.actorDepartmentId).toBeTruthy()
    }
  })
})

/* ---------------------------------------------------------- the refusal path */

describe('the CIO sending work back', () => {
  it('returns the case to the floor and settles the submission', async () => {
    const runtime = await start()
    const caseId = 'cio-return'
    const macro = await toDecisionReady(runtime, caseId)

    const submitted = await submitToCio(runtime, macro)
    const submissionId = committed(submitted).resultRef

    const returned = await returnToDesk(runtime, macro, submissionId)
    expect(returned.outcome).toBe('committed')

    /* Back to the floor, not forward and not stuck. */
    expect(await stageOf(runtime, caseId)).toBe('returned')

    const settled = await runtime.container.repositories.submissions.get(submissionId)
    expect(settled!.state).toBe('returned')

    const record = (await runtime.container.repositories.submissions.returnsForCase(
      caseId,
    ))![0]!
    expect(record.returnedBy.employeeId).toBe('cio')
    expect(record.concerns).toHaveLength(1)
    expect(record.concerns[0]!.subjectId).toBe(macro.macroClaimId)
    expect(record.reason).toBe('The central claim rests on a single source.')
  })

  it('refuses a return that names nothing to address', async () => {
    const runtime = await start()
    const caseId = 'cio-return-empty'
    const macro = await toDecisionReady(runtime, caseId)

    const submitted = await submitToCio(runtime, macro)
    const result = await returnToDesk(
      runtime,
      macro,
      committed(submitted).resultRef,
      { concerns: [] },
      {},
      '-empty',
    )

    expect(result.outcome).toBe('rejected')
    expect(rejected(result).code).toBe('invariant-violated')
    /* The case did not move on a refusal. */
    expect(await stageOf(runtime, caseId)).toBe('decision')
  })

  it('will not decide a submission that has already been returned', async () => {
    const runtime = await start()
    const caseId = 'cio-return-then-decide'
    const macro = await toDecisionReady(runtime, caseId)

    const submitted = await submitToCio(runtime, macro)
    const submissionId = committed(submitted).resultRef
    await returnToDesk(runtime, macro, submissionId)

    const result = await decide(runtime, macro, [submissionId], {}, {}, '-after-return')
    expect(result.outcome).toBe('rejected')
    expect(rejected(result).code).toBe('illegal-prior-state')
  })
})

/* ------------------------------------------------------------- authorisation */

describe('the authority to decide', () => {
  it('refuses a decision from a senior employee without the mandate', async () => {
    const runtime = await start()
    const caseId = 'cio-mandate'
    const macro = await toDecisionReady(runtime, caseId)

    const submitted = await submitToCio(runtime, macro)
    const result = await decide(
      runtime,
      macro,
      [committed(submitted).resultRef],
      {},
      { actor: { kind: 'employee', employeeId: 'research-director' } },
      '-unauthorised',
    )

    expect(result.outcome).toBe('rejected')
    expect(rejected(result).code).toBe('not-authorised')

    /* Nothing was recorded, and the case is still waiting. */
    expect(await stageOf(runtime, caseId)).toBe('decision')
    expect(await runtime.container.repositories.decisions.getForCase(caseId)).toBeNull()
  })

  it('refuses a return from a senior employee without the mandate', async () => {
    const runtime = await start()
    const caseId = 'cio-mandate-return'
    const macro = await toDecisionReady(runtime, caseId)

    const submitted = await submitToCio(runtime, macro)
    const result = await returnToDesk(
      runtime,
      macro,
      committed(submitted).resultRef,
      {},
      { actor: { kind: 'employee', employeeId: 'research-director' } },
      '-unauthorised',
    )

    expect(result.outcome).toBe('rejected')
    expect(rejected(result).code).toBe('not-authorised')
    expect(await stageOf(runtime, caseId)).toBe('decision')
  })
})

/* ------------------------------------------------------------- the reload */

describe('the decision survives a restart', () => {
  it('reads back identically through a runtime that never saw it made', async () => {
    let runtime = await start()
    const caseId = 'cio-reload'
    const macro = await toDecisionReady(runtime, caseId)

    const submitted = await submitToCio(runtime, macro)
    const submissionId = committed(submitted).resultRef
    await decide(runtime, macro, [submissionId])

    const before = await runtime.container.repositories.decisions.getForCase(caseId)
    const submissionBefore =
      await runtime.container.repositories.submissions.get(submissionId)

    runtime = await across(runtime)

    const after = await runtime.container.repositories.decisions.getForCase(caseId)
    expect(after).toEqual(before)
    expect(await stageOf(runtime, caseId)).toBe('decided')

    /*
     * The assembled basis is the part that must survive exactly. It is what
     * makes the decision re-examinable: the facts as they stood, under the
     * policy named at the time.
     */
    const submissionAfter =
      await runtime.container.repositories.submissions.get(submissionId)
    expect(submissionAfter!.basis).toEqual(submissionBefore!.basis)
  })
})

/* --------------------------------------------------------------- the replay */

describe('replaying a decision', () => {
  it('returns the original rather than deciding twice', async () => {
    const runtime = await start()
    const caseId = 'cio-replay'
    const macro = await toDecisionReady(runtime, caseId)

    const submitted = await submitToCio(runtime, macro)
    const submissionId = committed(submitted).resultRef

    const at = (await runtime.container.repositories.cases.get(caseId))!.version
    const first = await decide(
      runtime,
      macro,
      [submissionId],
      {},
      { expectedVersion: at },
    )
    expect(first.outcome).toBe('committed')

    /*
     * The same command id, issued again. A firm that decided twice from one
     * instruction would hold two positions it believes are one, so the ledger
     * answers from the record instead of running the command again.
     */
    /*
     * The SAME envelope, version included: `payloadHash` covers
     * `expectedVersion`, so a replay that re-read the version would be a
     * different command wearing one identity -- which the ledger refuses, and
     * should.
     */
    const replayed = await decide(
      runtime,
      macro,
      [submissionId],
      {},
      { expectedVersion: at },
    )
    expect(replayed.outcome).toBe('committed')
    expect(committed(replayed).resultRef).toBe(committed(first).resultRef)

    /*
     * A replay reports `committed` and hands back the original reference; there
     * is no separate outcome for it. The count is what proves nothing ran
     * twice -- a second decision would also have reported `committed`.
     */
    const decisions =
      await runtime.container.repositories.decisions.historyForCase(caseId)
    expect(decisions).toHaveLength(1)
  })

  it('replays identically after a restart', async () => {
    let runtime = await start()
    const caseId = 'cio-replay-restart'
    const macro = await toDecisionReady(runtime, caseId)

    const submitted = await submitToCio(runtime, macro)
    const submissionId = committed(submitted).resultRef
    const at = (await runtime.container.repositories.cases.get(caseId))!.version
    const first = await decide(
      runtime,
      macro,
      [submissionId],
      {},
      { expectedVersion: at },
    )

    runtime = await across(runtime)

    /*
     * Idempotence has to come from the store, not from anything the process
     * remembers. A second runtime replaying the same command id is the only
     * way to prove that.
     */
    const replayed = await decide(
      runtime,
      macro,
      [submissionId],
      {},
      { expectedVersion: at },
    )
    expect(replayed.outcome).toBe('committed')
    expect(committed(replayed).resultRef).toBe(committed(first).resultRef)
    expect(
      await runtime.container.repositories.decisions.historyForCase(caseId),
    ).toHaveLength(1)
  })
})

/* -------------------------------------------------------------- the gate */

describe('the eligibility gate in front of the CIO', () => {
  it('refuses a submission whose governance is incomplete, naming every gate', async () => {
    const runtime = await start()
    const caseId = 'cio-gate'
    const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })
    await resolveRisk(runtime, macro)
    await submit(runtime, macro)
    /* Verification only. The other two verdicts are missing on purpose. */
    await verify(runtime, macro)

    const result = await submitToCio(runtime, macro)
    expect(result.outcome).toBe('rejected')

    const message = rejected(result).detail
    /* The complete report, so a desk fixes everything in one pass. */
    expect(message).toContain('RISK_UNRESOLVED')
    expect(message).toContain('eligibility policy "1"')

    /* Refused, so the case never left review. */
    expect(await stageOf(runtime, caseId)).toBe('review')
    expect(
      await runtime.container.repositories.submissions.applicableForRevision(
        macro.revisionId,
      ),
    ).toHaveLength(0)
  })
})

/* ------------------------------------------------------- the whole sequence */

describe('the institution end to end', () => {
  it('carries one case from intake to a decision that reads back after a restart', async () => {
    let runtime = await start()
    const caseId = 'cio-institution'

    const macro = await toDecisionReady(runtime, caseId)
    const submitted = await submitToCio(runtime, macro)
    const submissionId = committed(submitted).resultRef

    /* The CIO decides through a runtime that did not do the research. */
    runtime = await across(runtime)
    expect((await decide(runtime, macro, [submissionId])).outcome).toBe('committed')

    /* And it is read back through a third. */
    runtime = await across(runtime)

    const repositories = runtime.container.repositories
    const decision = (await repositories.decisions.getForCase(caseId))!
    const submission = (await repositories.submissions.get(submissionId))!
    const investmentCase = (await repositories.cases.get(caseId))!

    expect(investmentCase.stage).toBe('decided')
    expect(decision.caseId).toBe(caseId)
    expect(decision.decidedByEmployeeId).toBe('cio')
    expect(decision.decidedAt).toBe(LATEST)
    expect(submission.state).toBe('decided')
    expect(submission.basis.eligibilityPolicyVersion).toBe('1')

    /*
     * The chain a later reader has to be able to walk: decision names the
     * submission, submission names the revision, revision belongs to the case.
     */
    expect(decision.submissionIds).toContain(submissionId)
    expect(submission.revisionId).toBe(macro.revisionId)
    const revisions = await repositories.theses.listForCase(caseId)
    expect(revisions.some((r) => r.revisionId === macro.revisionId)).toBe(true)
  })
})
