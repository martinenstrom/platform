/**
 * Captures a real Agent Headquarters floor for the render suite.
 *
 * Its own file, and therefore its own database, for the reason
 * `caseListFixture` gives: a capture sharing a database with other tests would
 * pick up whatever they left behind, and the rendered floor would then be
 * asserted against a firm that changed whenever an unrelated test did.
 *
 * ## The mixture is the point
 *
 * Four runs, in four states the surface must never collapse into one another:
 *
 * | state | how it got there |
 * |---|---|
 * | `completed` | produced and accepted by a person |
 * | `failed` | the desk tried and its provider fell over |
 * | `awaiting-acceptance` | produced, durable, and nobody has judged it |
 * | `rejected` | produced, and a person declined it with a code and prose |
 *
 * A fixture holding only completed runs would prove the page draws a list. It
 * would not prove the page can tell a failure from a rejection — which is the
 * distinction C2-1 spent a run state, a command and a vocabulary to preserve,
 * and the one a floor is most likely to flatten back into "something went
 * wrong".
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'
import {
  runMacroAwaitingAcceptance,
  runMacroToAggregation,
  startRuntime,
  type Runtime,
} from './macroFlowHarness'
import { agentDirectory } from '~/application/analysis/agentDirectory'
import { registeredPlaybooks } from '~/application/analysis/playbookRegistry'
import { runReview } from '~/application/analysis/runReview'

const FIXTURES = resolve(process.cwd(), 'src/test/fixtures')

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

function capture(name: string, value: unknown) {
  const path = resolve(FIXTURES, `${name}.json`)
  const next = `${JSON.stringify(
    JSON.parse(
      JSON.stringify(value, (key, entry) =>
        key === 'provenanceId' || key === 'storageProvenanceId' || key === 'buildId'
          ? 'fixture-provenance'
          : entry,
      ),
    ),
    null,
    2,
  )}\n`
  mkdirSync(dirname(path), { recursive: true })

  let current: string | null = null
  try {
    current = readFileSync(path, 'utf8')
  } catch {
    current = null
  }
  if (current !== next) writeFileSync(path, next, 'utf8')
  return { path, changed: current !== next, current }
}

describe('an Agent Headquarters floor holding runs in four states', () => {
  it('captures it exactly as the read model produces it', async () => {
    const runtime = await startRuntime(appUrl)
    live.push(runtime)

    /* Accepted macro work, and a Quant desk whose run failed. */
    await runMacroToAggregation(runtime, { caseId: 'hq-floor-accepted', quant: 'fail' })
    /* Work produced and waiting on a person. */
    await runMacroAwaitingAcceptance(runtime, { caseId: 'hq-floor-awaiting' })
    /* Work produced and declined. */
    await runMacroAwaitingAcceptance(runtime, {
      caseId: 'hq-floor-rejected',
      settle: 'reject',
    })

    const deps = await runtime.container.commandDeps()
    const desks = await agentDirectory({
      repositories: runtime.container.repositories,
      organization: deps.organization,
      playbooks: registeredPlaybooks(),
    })

    /*
     * The registry assigns work to seven departments, and the seed contains
     * more than seven. A floor that listed every department would be
     * describing the org chart rather than the desks the firm can commission.
     *
     * Seven since playbook v5: `rates` appears because v5 gives it work —
     * `rates-analysis` and `peer-examination` — and a desk with no assignable
     * entry is not commissionable however real its seat is.
     */
    expect(desks.map((desk) => desk.departmentId)).toEqual([
      'global-macro',
      'quant-technical',
      'rates',
      'research-office',
      'devils-advocate',
      'risk',
      'verification',
    ])

    /* Producing desks before control functions, which is the only ordering claim. */
    expect(desks.filter((desk) => desk.isGovernance).map((desk) => desk.departmentId)) //
      .toEqual(['devils-advocate', 'risk', 'verification'])

    const macro = desks.find((desk) => desk.departmentId === 'global-macro')!
    expect(new Set(macro.runs.map((run) => run.state))).toEqual(
      new Set(['completed', 'awaiting-acceptance', 'rejected']),
    )
    expect(macro.assignableWork.map((work) => work.entryKey)).toEqual(['macro-analysis'])

    /*
     * The produced-claim boundary, visible in the capture: an accepted run
     * carries its claims because they are institutional, and the two runs that
     * never crossed acceptance carry none. Asserted here so the render suite
     * cannot be read as evidence that unaccepted work is empty — it is not
     * empty, it is elsewhere, and Stage B is what reads it.
     */
    const awaiting = macro.runs.find((run) => run.state === 'awaiting-acceptance')!
    const rejected = macro.runs.find((run) => run.state === 'rejected')!
    const completed = macro.runs.find((run) => run.state === 'completed')!
    expect(awaiting.claims).toHaveLength(0)
    expect(rejected.claims).toHaveLength(0)
    expect(completed.claims.length).toBeGreaterThan(0)

    /* A rejection carries a code AND the prose a person wrote. */
    expect(rejected.rejection?.code).toBe('unsupported-by-evidence')
    expect(rejected.rejection?.detail).not.toBe('')
    expect(rejected.failure).toBeUndefined()

    /* And the failure beside it is a failure, with no rejection on it. */
    const quant = desks.find((desk) => desk.departmentId === 'quant-technical')!
    const failed = quant.runs.find((run) => run.state === 'failed')!
    expect(failed.failure?.category).toBeDefined()
    expect(failed.rejection).toBeUndefined()

    /*
     * The review of the awaiting run, captured from THIS database.
     *
     * Its run id therefore matches the one on the floor above, which is what
     * makes a journey test possible: the render suite can start at `/agents`,
     * follow the link the desk actually renders, and land on the review of that
     * exact run. Two fixtures from two databases would have two different run
     * ids, and the test would have to fabricate the connection it exists to
     * prove.
     */
    const review = await runReview({
      repositories: runtime.container.repositories,
      organization: deps.organization,
      runId: awaiting.id,
    })
    expect(review?.decision).toEqual({ kind: 'open' })

    const writtenFloor = capture('agentFloor.mixed', desks)
    const writtenReview = capture('agentFloor.awaitingReview', review)
    for (const written of [writtenFloor, writtenReview]) {
      expect(
        written.changed && written.current !== null,
        `${written.path} was out of date and has been regenerated.`,
      ).toBe(false)
    }
  })
})
