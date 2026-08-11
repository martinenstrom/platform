/**
 * The Headquarters read model, against a case that actually travelled.
 *
 * Not a fixture. The case here is built by the same helpers that drive the
 * end-to-end flow, so the overview cannot pass against a shape the workflow
 * does not produce — which is how five defects stayed invisible in commands
 * that no test executed.
 *
 * What is being proved is institutional, not visual: that a reader opening a
 * case learns where it stands, whose desk it is on, what is finished, what is
 * outstanding, what is blocking, and what happens next — and that the
 * eligibility shown is the verdict the firm actually recorded, under the policy
 * it recorded it against.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'
import {
  challenge,
  decide,
  LATEST,
  restart,
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

const across = async (runtime: Runtime) => {
  const next = await restart(runtime, appUrl)
  live.splice(live.indexOf(runtime), 1)
  live.push(next)
  return next
}

async function overviewOf(runtime: Runtime, caseId: string) {
  const deps = await runtime.container.commandDeps()
  const found = await caseOverview({
    repositories: runtime.container.repositories,
    organization: deps.organization,
    caseId,
    now: LATEST,
  })
  expect(found).not.toBeNull()
  return found!
}

/** The non-material open challenge is the state canonicalization v2 unlocked. */
const nonMaterialChallenge = (macro: MacroCase) => ({
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

async function decisionReady(runtime: Runtime, caseId: string): Promise<MacroCase> {
  const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })
  await resolveRisk(runtime, macro)
  await submit(runtime, macro)
  await verify(runtime, macro)
  await challenge(runtime, macro, nonMaterialChallenge(macro))
  await riskReview(runtime, macro)
  return macro
}

const stepStatus = (overview: Awaited<ReturnType<typeof overviewOf>>, step: string) =>
  overview.standing.steps.find((entry) => entry.step === step)!.status

/* ------------------------------------------------------- the workflow first */

describe('a case that has travelled the whole institution', () => {
  it('says where it is, who holds it, and that nothing is outstanding', async () => {
    const runtime = await start()
    const caseId = 'hq-decided'
    const macro = await decisionReady(runtime, caseId)
    const submitted = await submitToCio(runtime, macro)
    await decide(runtime, macro, [(submitted as { resultRef: string }).resultRef])

    const overview = await overviewOf(runtime, caseId)

    expect(overview.standing.stage).toBe('decided')
    expect(overview.standing.settled).toBe(true)
    /* Owned by nobody. A settled case naming a person reads as an open duty. */
    expect(overview.standing.ownership.kind).toBe('settled')
    expect(overview.standing.ownership.employeeId).toBeNull()

    expect(overview.standing.nextAct.act).toBe('none-settled')
    expect(overview.standing.blockers).toEqual([])

    for (const entry of overview.standing.steps) {
      expect(entry.status).not.toBe('outstanding')
    }
  })

  it('carries every section a reader can drill into', async () => {
    const runtime = await start()
    const caseId = 'hq-sections'
    const macro = await decisionReady(runtime, caseId)
    const submitted = await submitToCio(runtime, macro)
    await decide(runtime, macro, [(submitted as { resultRef: string }).resultRef])

    const overview = await overviewOf(runtime, caseId)

    /*
     * Asserted individually. A single "is it truthy" over the whole object
     * would pass with a section silently empty, which on screen is
     * indistinguishable from a case that never had one.
     */
    expect(overview.revisions.length).toBeGreaterThan(0)
    expect(overview.claims.length).toBeGreaterThan(0)
    expect(overview.runs.length).toBeGreaterThan(0)
    expect(overview.evidenceSets.length).toBeGreaterThan(0)
    expect(overview.aggregations.length).toBeGreaterThan(0)
    expect(overview.verification.length).toBeGreaterThan(0)
    expect(overview.devilsAdvocate.length).toBeGreaterThan(0)
    expect(overview.risk.length).toBeGreaterThan(0)
    expect(overview.submissions.length).toBeGreaterThan(0)
    expect(overview.decision).not.toBeNull()
    expect(overview.decisionHistory).toHaveLength(1)
    expect(overview.timeline.length).toBeGreaterThan(0)
  })

  it('shows the eligibility the firm recorded, under the policy it named', async () => {
    const runtime = await start()
    const caseId = 'hq-eligibility'
    const macro = await decisionReady(runtime, caseId)
    const submitted = await submitToCio(runtime, macro)
    await decide(runtime, macro, [(submitted as { resultRef: string }).resultRef])

    const overview = await overviewOf(runtime, caseId)

    expect(overview.eligibility.kind).toBe('recorded')
    if (overview.eligibility.kind !== 'recorded') throw new Error('unreachable')

    /*
     * The policy the BASIS names, resolved from it. Not "the current one" --
     * a case decided under one rule must never be shown re-judged under
     * another.
     */
    expect(overview.eligibility.policyVersion).toBe('1')
    expect(overview.eligibility.report.policyVersion).toBe('1')
    expect(overview.eligibility.report.eligible).toBe(true)
  })

  it('keeps the non-material objection visible without calling it a blocker', async () => {
    const runtime = await start()
    const caseId = 'hq-nonmaterial'
    const macro = await decisionReady(runtime, caseId)
    const submitted = await submitToCio(runtime, macro)
    await decide(runtime, macro, [(submitted as { resultRef: string }).resultRef])

    const overview = await overviewOf(runtime, caseId)
    const basis = overview.submissions[0]!.basis

    /* Recorded, and weighed. */
    expect(basis.devilsAdvocate!.openChallenges).toHaveLength(1)
    expect(basis.devilsAdvocate!.openChallenges[0]!.materiality).toBe('non-material')

    /* And not blocking, under the policy the basis names. */
    if (overview.eligibility.kind !== 'recorded') throw new Error('unreachable')
    const gate = overview.eligibility.report.gates.find(
      (entry) => entry.code === 'CHALLENGE_UNRESOLVED',
    )!
    expect(gate.status).toBe('passed')
    expect(overview.standing.blockers).toEqual([])
  })

  it('reads identically through a runtime that never saw the case built', async () => {
    let runtime = await start()
    const caseId = 'hq-restart'
    const macro = await decisionReady(runtime, caseId)
    const submitted = await submitToCio(runtime, macro)
    await decide(runtime, macro, [(submitted as { resultRef: string }).resultRef])

    const before = await overviewOf(runtime, caseId)
    runtime = await across(runtime)
    const after = await overviewOf(runtime, caseId)

    expect(after.standing).toEqual(before.standing)
    expect(after.eligibility).toEqual(before.eligibility)
    expect(after.decision).toEqual(before.decision)
    expect(after.timeline).toEqual(before.timeline)
  })
})

/* ------------------------------------------------ mid-flight, and refusals */

describe('a case still in flight', () => {
  it('names governance as the next act while verdicts are outstanding', async () => {
    const runtime = await start()
    const caseId = 'hq-inflight'
    const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })
    await resolveRisk(runtime, macro)
    await submit(runtime, macro)

    const overview = await overviewOf(runtime, caseId)

    expect(overview.standing.stage).toBe('review')
    expect(overview.standing.settled).toBe(false)
    expect(stepStatus(overview, 'verification')).toBe('outstanding')
    expect(stepStatus(overview, 'cio-decision')).toBe('outstanding')

    /* The next act is a governance verdict, owed by the department that owes it. */
    expect(overview.standing.nextAct.act).toBe('record-verification-review')
    expect(overview.standing.nextAct.owningDepartmentId).toBe('verification')
  })

  it('has no recorded eligibility before anything is submitted', async () => {
    const runtime = await start()
    const caseId = 'hq-unsubmitted'
    const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })
    await resolveRisk(runtime, macro)
    await submit(runtime, macro)

    const overview = await overviewOf(runtime, caseId)

    /*
     * Distinct from "submitted and every gate passed". A nullable report would
     * render as the same blank for both, and the difference is whether the firm
     * has judged this at all.
     */
    expect(overview.eligibility.kind).toBe('not-submitted')
    expect(stepStatus(overview, 'cio-submission')).toBe('outstanding')
  })

  it('puts a submitted case on the chief’s desk', async () => {
    const runtime = await start()
    const caseId = 'hq-awaiting'
    const macro = await decisionReady(runtime, caseId)
    await submitToCio(runtime, macro)

    const overview = await overviewOf(runtime, caseId)

    expect(overview.standing.stage).toBe('decision')
    expect(overview.standing.ownership.kind).toBe('chief')
    expect(overview.standing.ownership.employeeId).toBe('cio')
    expect(overview.standing.nextAct.act).toBe('decide-or-return')
    /* Submitted is complete; decided is not. */
    expect(stepStatus(overview, 'cio-submission')).toBe('complete')
    expect(stepStatus(overview, 'cio-decision')).toBe('outstanding')
  })

  it('returns null for a case that does not exist', async () => {
    const runtime = await start()
    const deps = await runtime.container.commandDeps()
    expect(
      await caseOverview({
        repositories: runtime.container.repositories,
        organization: deps.organization,
        caseId: 'no-such-case',
        now: LATEST,
      }),
    ).toBeNull()
  })
})
