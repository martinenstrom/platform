/**
 * The Headquarters queue, against cases that actually travelled.
 *
 * The property worth most here is not that the list renders. It is that the
 * list and the case page **cannot disagree**: a queue saying a case is with
 * Risk while the case itself says it is with the CIO would be the firm holding
 * two beliefs about where its own work is, and neither page would look wrong on
 * its own.
 *
 * So the strongest test below takes every case in the list and asserts its
 * standing is identical to the one `caseOverview` produces for that case.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'
import {
  challenge,
  decide,
  defer,
  LATEST,
  resolveRisk,
  riskReview,
  reopen,
  runMacroToAggregation,
  startRuntime,
  submit,
  submitToCio,
  verify,
  type MacroCase,
  type Runtime,
} from './macroFlowHarness'
import { caseListing } from '~/application/analysis/caseListing'
import { caseOverview } from '~/application/analysis/caseOverview'

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

const listOf = async (runtime: Runtime) => {
  const deps = await runtime.container.commandDeps()
  return caseListing({
    repositories: runtime.container.repositories,
    organization: deps.organization,
    now: LATEST,
  })
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

describe('the Headquarters queue', () => {
  it('is empty for a firm holding nothing, which is not a failure', async () => {
    const runtime = await start()
    expect(await listOf(runtime)).toEqual([])
  })

  it('lists every case with where it stands', async () => {
    const runtime = await start()
    await runMacroToAggregation(runtime, { caseId: 'q-a', quant: 'complete' })
    await runMacroToAggregation(runtime, { caseId: 'q-b', quant: 'complete' })

    const listed = await listOf(runtime)
    expect(listed.map((entry) => entry.investmentCase.id).sort()).toEqual(['q-a', 'q-b'])
    for (const entry of listed) {
      expect(entry.standing.stage).toBeTruthy()
      expect(entry.standing.nextAct.act).toBeTruthy()
    }
  })

  it('puts work still owed before work already finished', async () => {
    const runtime = await start()

    /* Decided first, so date order and institutional order disagree. */
    const done = await decisionReady(runtime, 'q-decided')
    const submitted = await submitToCio(runtime, done)
    await decide(runtime, done, [(submitted as { resultRef: string }).resultRef])

    await runMacroToAggregation(runtime, { caseId: 'q-open', quant: 'complete' })

    const listed = await listOf(runtime)
    const settledFlags = listed.map((entry) => entry.standing.settled)

    /*
     * Every outstanding case precedes every settled one. Asserted as a
     * partition rather than an exact order: the ordering claim this makes is
     * "owed before finished", and nothing more.
     */
    expect(settledFlags.indexOf(true)).toBe(settledFlags.lastIndexOf(false) + 1)
    expect(listed[0]!.standing.settled).toBe(false)
    expect(listed.at(-1)!.standing.settled).toBe(true)
  })

  it('agrees with the case page about every case it lists', async () => {
    /*
     * THE test. Two readers of one institution must give one answer. A cheaper
     * derivation for the list is exactly how they would part company, and this
     * is what makes that impossible to do quietly.
     */
    const runtime = await start()

    const decided = await decisionReady(runtime, 'q-agree-decided')
    const submitted = await submitToCio(runtime, decided)
    await decide(runtime, decided, [(submitted as { resultRef: string }).resultRef])

    const awaiting = await decisionReady(runtime, 'q-agree-awaiting')
    await submitToCio(runtime, awaiting)

    await runMacroToAggregation(runtime, {
      caseId: 'q-agree-inflight',
      quant: 'complete',
    })

    const deps = await runtime.container.commandDeps()
    const listed = await listOf(runtime)

    /*
     * The suite shares one database, so this sees every case the file created —
     * which makes the check stronger, not weaker. The three added here are
     * asserted present so the loop cannot pass by finding nothing.
     */
    const ids = listed.map((entry) => entry.investmentCase.id)
    expect(ids).toEqual(
      expect.arrayContaining(['q-agree-decided', 'q-agree-awaiting', 'q-agree-inflight']),
    )
    expect(listed.length).toBeGreaterThanOrEqual(3)

    for (const entry of listed) {
      const overview = await caseOverview({
        repositories: runtime.container.repositories,
        organization: deps.organization,
        caseId: entry.investmentCase.id,
        now: LATEST,
      })
      expect(overview).not.toBeNull()
      expect(
        entry.standing,
        `list and case page disagree about ${entry.investmentCase.id}`,
      ).toEqual(overview!.standing)
    }
  })

  it('names the chief on a case awaiting decision, and nobody on a decided one', async () => {
    const runtime = await start()

    const awaiting = await decisionReady(runtime, 'q-owner-awaiting')
    await submitToCio(runtime, awaiting)

    const done = await decisionReady(runtime, 'q-owner-decided')
    const submitted = await submitToCio(runtime, done)
    await decide(runtime, done, [(submitted as { resultRef: string }).resultRef])

    const listed = await listOf(runtime)
    const byId = new Map(listed.map((entry) => [entry.investmentCase.id, entry]))

    expect(byId.get('q-owner-awaiting')!.standing.ownership.kind).toBe('chief')
    expect(byId.get('q-owner-awaiting')!.standing.nextAct.act).toBe('decide-or-return')

    const settled = byId.get('q-owner-decided')!.standing
    expect(settled.ownership.kind).toBe('settled')
    expect(settled.ownership.employeeId).toBeNull()
    expect(settled.nextAct.act).toBe('none-settled')
  })

  it('moves a reconsidered case out of settled and back into outstanding', async () => {
    /*
     * The queue half of reconsideration, and the reason it needs no new
     * plumbing: a deferred case is settled, a reopened one is not, and the
     * standing derivation already answers that. What is proved here is that
     * the queue actually reflects it — a firm whose queue still showed a
     * reopened case as finished would have work nobody could see was owed.
     */
    const runtime = await start()
    const caseId = 'q-reconsidered'
    const macro = await decisionReady(runtime, caseId)
    const submitted = await submitToCio(runtime, macro)

    const deferral = await defer(runtime, macro, [
      (submitted as { resultRef: string }).resultRef,
    ])
    if (deferral.outcome !== 'committed') throw new Error(deferral.outcome)

    /* Deferred: the CIO chose to wait, so nothing is owed. */
    const whileDeferred = (await listOf(runtime)).find(
      (entry) => entry.investmentCase.id === caseId,
    )!
    expect(whileDeferred.standing.stage).toBe('deferred')
    expect(whileDeferred.standing.settled).toBe(true)
    expect(whileDeferred.standing.ownership.kind).toBe('settled')
    expect(whileDeferred.standing.nextAct.act).toBe('none-settled')

    const reopened = await reopen(runtime, macro, deferral.resultRef)
    if (reopened.outcome !== 'committed') throw new Error(reopened.outcome)

    /* Reopened: owed again, and on the chief's desk. */
    const listed = await listOf(runtime)
    const afterReopen = listed.find((entry) => entry.investmentCase.id === caseId)!
    expect(afterReopen.standing.stage).toBe('decision')
    expect(afterReopen.standing.settled).toBe(false)
    expect(afterReopen.standing.ownership.kind).toBe('chief')
    expect(afterReopen.standing.nextAct.act).toBe('decide-or-return')

    /*
     * And it sorts with the outstanding work. Stated as "before every settled
     * case" rather than as an index comparison, which would pass vacuously in
     * a run where no other test happened to leave a settled case behind.
     */
    const settledPositions = listed
      .map((entry, index) => ({ settled: entry.standing.settled, index }))
      .filter((entry) => entry.settled)
      .map((entry) => entry.index)
    expect(settledPositions.length).toBeGreaterThan(0)
    for (const position of settledPositions) {
      expect(listed.indexOf(afterReopen)).toBeLessThan(position)
    }
  })
})
