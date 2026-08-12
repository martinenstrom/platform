/**
 * Captures a real Headquarters queue for the render suite.
 *
 * Its own file, and therefore its own database, on purpose. The queue fixture
 * has to contain exactly the cases this test creates — a capture sharing a
 * database with other tests would pick up whatever they happened to leave
 * behind, and the rendered queue would then be asserted against a list that
 * changed whenever an unrelated test did.
 *
 * The mixture is deliberate: one case decided, one on the chief's desk, one
 * still in governance. A queue is only worth rendering when it holds cases in
 * different states, and a fixture of three identical rows would prove nothing
 * about the ordering the page depends on.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'
import {
  challenge,
  decide,
  LATEST,
  resolveRisk,
  riskReview,
  runMacroToAggregation,
  startRuntime,
  submit,
  submitToCio,
  verify,
  type MacroCase,
  type Runtime,
} from './macroFlowHarness'
import { caseListing } from '~/application/analysis/caseListing'

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

describe('a Headquarters queue holding cases in three states', () => {
  it('captures it exactly as the read model produces it', async () => {
    const runtime = await startRuntime(appUrl)
    live.push(runtime)

    /* Decided FIRST, so filing order and institutional order disagree. */
    const done = await decisionReady(runtime, 'hq-queue-decided')
    const submitted = await submitToCio(runtime, done)
    const outcome = await decide(runtime, done, [
      (submitted as { resultRef: string }).resultRef,
    ])
    if (outcome.outcome === 'rejected') {
      throw new Error(`${outcome.rejection.code}: ${outcome.rejection.detail}`)
    }

    const awaiting = await decisionReady(runtime, 'hq-queue-awaiting')
    await submitToCio(runtime, awaiting)

    await runMacroToAggregation(runtime, {
      caseId: 'hq-queue-inflight',
      quant: 'complete',
    })

    const deps = await runtime.container.commandDeps()
    const cases = await caseListing({
      repositories: runtime.container.repositories,
      organization: deps.organization,
      now: LATEST,
    })

    expect(cases).toHaveLength(3)
    /* Owed before finished — the queue's only ordering claim. */
    expect(cases[0]!.standing.settled).toBe(false)
    expect(cases.at(-1)!.standing.settled).toBe(true)
    expect(cases.some((entry) => entry.standing.ownership.kind === 'chief')).toBe(true)

    const written = capture('caseList.mixed', cases)
    expect(
      written.changed && written.current !== null,
      `${written.path} was out of date and has been regenerated.`,
    ).toBe(false)
  })
})
