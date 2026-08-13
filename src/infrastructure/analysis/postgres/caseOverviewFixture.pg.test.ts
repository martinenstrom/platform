/**
 * Captures real institutional records for the jsdom render tests.
 *
 * The Headquarters page has to be provable against records the institution
 * actually produced, not against an object somebody typed. So the fixtures are
 * **generated here** — from a case driven through the whole workflow against
 * PostgreSQL — and written to disk for the unit suite to render.
 *
 * ## Why this is a test and not a script
 *
 * A generator nobody runs produces a fixture that silently ages. As a test it
 * regenerates on every `test:db` run and fails if the written file no longer
 * matches what the read model produces — so a change to the overview cannot
 * leave the render suite asserting against a shape that no longer exists.
 *
 * ## What is scrubbed, and why nothing else is
 *
 * Only `provenanceId` and `buildId`, which name the process that happened to
 * write the row. Everything else — ids, digests, timestamps — is left exactly
 * as recorded, because a fixture with tidied values would prove the page
 * renders tidy values.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'
import {
  AFTER_DEFERRAL,
  AFTER_RECONSIDERATION,
  challenge,
  decide,
  LATEST,
  resolveRisk,
  riskReview,
  runMacroToAggregation,
  startRuntime,
  submit,
  defer,
  reopen,
  submitToCio,
  verify,
  type MacroCase,
  type Runtime,
} from './macroFlowHarness'
import { caseOverview } from '~/application/analysis/caseOverview'

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

const start = async () => {
  const runtime = await startRuntime(appUrl)
  live.push(runtime)
  return runtime
}

async function decisionReady(runtime: Runtime, caseId: string): Promise<MacroCase> {
  const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })
  await resolveRisk(runtime, macro)
  await submit(runtime, macro)
  await verify(runtime, macro)
  /* Open, non-material: the state canonicalization v2 made reachable. */
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

/** Names the writing process, and only that. Nothing institutional is touched. */
function scrub(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, entry) =>
      key === 'provenanceId' || key === 'storageProvenanceId' || key === 'buildId'
        ? 'fixture-provenance'
        : entry,
    ),
  )
}

function capture(name: string, overview: unknown) {
  const path = resolve(FIXTURES, `${name}.json`)
  const next = `${JSON.stringify(scrub(overview), null, 2)}\n`
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

describe('institutional fixtures for the Headquarters render suite', () => {
  it('captures a case that travelled the whole institution and was decided', async () => {
    const runtime = await start()
    const caseId = 'hq-fixture-decided'
    const macro = await decisionReady(runtime, caseId)
    const submitted = await submitToCio(runtime, macro)
    const decided = await decide(
      runtime,
      macro,
      [(submitted as { resultRef: string }).resultRef],
      {
        /*
         * The firm decided KNOWING somebody disagreed. Carried into the fixture
         * because a decision record that quietly drops its dissent describes an
         * agreement that never happened -- and the page must be proved to show
         * it, not merely capable of it.
         */
        unresolvedDissent: [
          {
            source: 'devils-advocate-challenge',
            sourceId: 'challenge-fixture-1',
            revisionId: macro.revisionId,
            materiality: 'material',
            raisedByDepartmentId: 'devils-advocate',
            rationale: 'Fiskal impuls är inte prissatt i den centrala banan.',
            whyNotBlocking: 'accepted-as-risk',
            dispositionAtDecision: 'accepted-as-risk',
            /*
             * Required at this materiality, and the field the domain calls the
             * one that matters: the CIO saying in writing why they decided
             * anyway. A page showing the objection without this shows half a
             * record.
             */
            acknowledgement:
              'Risken är känd och accepterad; positionen storleksanpassas därefter.',
          },
        ],
      },
    )

    /*
     * Narrowed, not cast. This exists because the decision was refused three
     * times while the fixture was written -- `dissent-unacknowledged`, then a
     * missing `whyNotBlocking`, then a missing `dispositionAtDecision` -- and
     * each refusal arrived as an opaque failure until the reason was read out
     * of it. A generator that swallows a refusal writes an empty fixture and
     * the render suite then proves nothing.
     */
    if (decided.outcome === 'rejected') {
      throw new Error(`${decided.rejection.code}: ${decided.rejection.detail}`)
    }
    if (decided.outcome !== 'committed') {
      throw new Error(`Decision was not committed: ${decided.outcome}`)
    }

    const deps = await runtime.container.commandDeps()
    const overview = await caseOverview({
      repositories: runtime.container.repositories,
      organization: deps.organization,
      caseId,
      now: LATEST,
    })

    expect(overview).not.toBeNull()
    expect(overview!.standing.stage).toBe('decided')
    expect(overview!.decision!.unresolvedDissent).toHaveLength(1)

    const written = capture('caseOverview.decided', overview)
    /*
     * A stale fixture is the failure this guards. If the read model changed,
     * the file is rewritten and this fails once — deliberately — so the change
     * is seen rather than absorbed.
     */
    expect(
      written.changed && written.current !== null,
      `${written.path} was out of date and has been regenerated. Re-run the ` +
        `unit suite to check the rendered page against the new record.`,
    ).toBe(false)
  })

  it('captures a case still awaiting its CIO decision', async () => {
    const runtime = await start()
    const caseId = 'hq-fixture-awaiting'
    const macro = await decisionReady(runtime, caseId)
    await submitToCio(runtime, macro)

    const deps = await runtime.container.commandDeps()
    const overview = await caseOverview({
      repositories: runtime.container.repositories,
      organization: deps.organization,
      caseId,
      now: LATEST,
    })

    expect(overview!.standing.stage).toBe('decision')

    const written = capture('caseOverview.awaiting', overview)
    expect(
      written.changed && written.current !== null,
      `${written.path} was out of date and has been regenerated.`,
    ).toBe(false)
  })

  it('captures a case with governance still outstanding', async () => {
    const runtime = await start()
    const caseId = 'hq-fixture-inflight'
    const macro = await runMacroToAggregation(runtime, { caseId, quant: 'complete' })
    await resolveRisk(runtime, macro)
    await submit(runtime, macro)

    const deps = await runtime.container.commandDeps()
    const overview = await caseOverview({
      repositories: runtime.container.repositories,
      organization: deps.organization,
      caseId,
      now: LATEST,
    })

    expect(overview!.standing.stage).toBe('review')
    expect(overview!.eligibility.kind).toBe('not-submitted')

    const written = capture('caseOverview.inflight', overview)
    expect(
      written.changed && written.current !== null,
      `${written.path} was out of date and has been regenerated.`,
    ).toBe(false)
  })

  it('captures a case where the firm ruled Risk was not required', async () => {
    /*
     * The only way to produce a genuine `not-applicable` step. A hand-edited
     * fixture would prove the page renders the string, not that the workflow
     * can reach the state -- and the whole reason `not-applicable` exists is
     * that it is a real institutional outcome, not a display value.
     */
    const runtime = await start()
    const caseId = 'hq-fixture-norisk'
    const macro = await runMacroToAggregation(runtime, {
      caseId,
      quant: 'complete',
      implications: [],
    })
    await resolveRisk(runtime, macro)
    await submit(runtime, macro)
    await verify(runtime, macro)

    const deps = await runtime.container.commandDeps()
    const overview = await caseOverview({
      repositories: runtime.container.repositories,
      organization: deps.organization,
      caseId,
      now: LATEST,
    })

    const risk = overview!.standing.steps.find((entry) => entry.step === 'risk')!
    expect(risk.status).toBe('not-applicable')

    const written = capture('caseOverview.noRisk', overview)
    expect(
      written.changed && written.current !== null,
      `${written.path} was out of date and has been regenerated.`,
    ).toBe(false)
  })

  it('captures a case that was deferred, reopened and then decided', async () => {
    /*
     * The whole reconsideration loop in one record, so the rendered page is
     * proved against a case that actually travelled it. Three acts on the
     * decision boundary — a deferral, the reopening that ended it, and the
     * decision that followed — which is the shape the history has to render as
     * one sequence rather than as a single live decision.
     */
    const runtime = await start()
    const caseId = 'hq-reconsidered'
    const macro = await decisionReady(runtime, caseId)

    const submitted = await submitToCio(runtime, macro)
    const deferral = await defer(runtime, macro, [
      (submitted as { resultRef: string }).resultRef,
    ])
    if (deferral.outcome === 'rejected') {
      throw new Error(`${deferral.rejection.code}: ${deferral.rejection.detail}`)
    }
    if (deferral.outcome !== 'committed') throw new Error(deferral.outcome)

    /* Days later: the condition was met, and the firm looked again. */
    const reopened = await reopen(
      runtime,
      macro,
      deferral.resultRef,
      {},
      {
        occurredAt: AFTER_DEFERRAL,
      },
    )
    if (reopened.outcome === 'rejected') {
      throw new Error(`${reopened.rejection.code}: ${reopened.rejection.detail}`)
    }
    if (reopened.outcome !== 'committed') throw new Error(reopened.outcome)

    const record = (await runtime.container.repositories.submissions.getReconsideration(
      reopened.resultRef,
    ))!
    const final = await decide(
      runtime,
      macro,
      [record.submissionId],
      { supersedesDecisionId: deferral.resultRef },
      { occurredAt: AFTER_RECONSIDERATION },
      '-final',
    )
    if (final.outcome !== 'committed') throw new Error(final.outcome)

    const deps = await runtime.container.commandDeps()
    const overview = await caseOverview({
      repositories: runtime.container.repositories,
      organization: deps.organization,
      caseId,
      now: LATEST,
    })

    expect(overview!.standing.stage).toBe('decided')
    expect(overview!.decisionHistory).toHaveLength(2)
    expect(overview!.reconsiderations).toHaveLength(1)

    const written = capture('caseOverview.reconsidered', overview)
    expect(
      written.changed && written.current !== null,
      `${written.path} was out of date and has been regenerated.`,
    ).toBe(false)
  })
})
