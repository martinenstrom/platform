/**
 * The review read model, against PostgreSQL, across the acceptance boundary.
 *
 * Two jobs, and the first is the one that matters: **proving that a person can
 * read work no human has accepted, and that reading it changes nothing.** Until
 * `runReview` existed, produced claims were durable, paid for, and reachable
 * only from inside a command — the acceptance boundary C2-1 built could be
 * exercised by a test and by nothing else.
 *
 * The second job is capturing the fixtures the render suite draws, from the
 * same real firm.
 *
 * ## What is asserted on each side of the boundary
 *
 * Before acceptance: the work is readable, its citations resolve against the
 * evidence the desk was actually given, and **the case holds no institutional
 * claim** — the review is looking at something that is not in the record.
 *
 * After acceptance: the same claims are in `analysis.claims` and therefore
 * citable, and the review reports the decision as settled.
 *
 * After rejection: the produced claims are **still readable** and still absent
 * from `analysis.claims`, which is what "durable operational history, and never
 * citable" means when the database rather than a filter enforces it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'
import {
  AT,
  runMacroAwaitingAcceptance,
  startRuntime,
  type Runtime,
} from './macroFlowHarness'
import { runReview } from '~/application/analysis/runReview'
import { operatorIdentities } from '~/application/analysis/operatorIdentity'
import { runCommand } from '~/application/analysis/commands/runCommand'
import { acceptContribution } from '~/application/analysis/commands/acceptContribution'

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

const review = async (runtime: Runtime, runId: string) => {
  const deps = await runtime.container.commandDeps()
  return runReview({
    repositories: runtime.container.repositories,
    organization: deps.organization,
    runId,
  })
}

describe('work awaiting a person is readable before anybody accepts it', () => {
  it('reads produced claims, their evidence and their confidence', async () => {
    const runtime = await startRuntime(appUrl)
    live.push(runtime)

    const { caseId, runId } = await runMacroAwaitingAcceptance(runtime, {
      caseId: 'review-awaiting',
    })

    const found = (await review(runtime, runId))!
    expect(found).not.toBeNull()
    expect(found.decision).toEqual({ kind: 'open' })
    expect(found.run.state).toBe('awaiting-acceptance')
    expect(found.department.name).toBe('Global Macro')

    /* The produced work — the first read path in the system that reaches it. */
    expect(found.produced).toHaveLength(1)
    const [reviewed] = found.produced
    expect(reviewed!.claim.statement).toMatch(/German 10-year/)

    /* Its citation resolves against the evidence the desk was actually given. */
    expect(reviewed!.supporting).toHaveLength(1)
    const citation = reviewed!.supporting[0]!
    expect(citation.status).toBe('resolved')
    if (citation.status !== 'resolved') throw new Error('unreachable')
    expect(citation.item.provenance.source.providerName).toBe('ECB')
    expect(citation.item.provenance.quality).toBe('official-daily')

    /* Confidence arrives decided, and says it is the model's proposal. */
    expect(reviewed!.claim.confidence.level).toBe('moderate')
    expect(reviewed!.claim.confidence.basis.join(' ')).toMatch(/proposed by the model/)

    /*
     * And none of it is in the record. This is the assertion the whole boundary
     * exists for: the reviewer is looking at work the institution does not yet
     * hold, and reading it has not changed that.
     */
    expect(await runtime.container.repositories.claims.listForCase(caseId)).toHaveLength(0)

    const written = capture('runReview.awaiting', found)
    expect(
      written.changed && written.current !== null,
      `${written.path} was out of date and has been regenerated.`,
    ).toBe(false)
  })

  it('offers every employee as an operator identity, unfiltered', async () => {
    const runtime = live[0]!
    const deps = await runtime.container.commandDeps()
    const identities = operatorIdentities(deps.organization)

    /*
     * Not narrowed to whoever may judge the run in front of the operator.
     * Filtering here would move an authority decision out of the mandate and
     * into a dropdown, where nobody would ever see it again.
     */
    expect(identities.length).toBe(deps.organization.employees.length)
    expect(identities.some((i) => i.employeeId === 'macro-head')).toBe(true)
    expect(identities.some((i) => i.isGovernance)).toBe(true)

    const written = capture('operatorIdentities', identities)
    expect(
      written.changed && written.current !== null,
      `${written.path} was out of date and has been regenerated.`,
    ).toBe(false)
  })
})

describe('the two sides of the decision', () => {
  it('accepting makes the same claims institutional, and settles the review', async () => {
    const runtime = live[0]!
    const { caseId, runId } = await runMacroAwaitingAcceptance(runtime, {
      caseId: 'review-accepted',
    })

    const before = (await review(runtime, runId))!
    const producedIds = before.produced.map((entry) => entry.claim.id)

    const deps = await runtime.container.commandDeps()
    const outcome = await runCommand(
      acceptContribution(deps.organization),
      { caseId, runId, departmentId: 'global-macro' },
      {
        commandId: `accept-${runId}-macro-head`,
        correlationId: caseId,
        actor: { kind: 'employee', employeeId: 'macro-head' },
        initiator: { kind: 'employee', employeeId: 'macro-head' },
        occurredAt: AT,
      },
      deps,
    )
    expect(outcome.outcome).toBe('committed')

    /* The same ids, now in the table every citation resolves against. */
    const institutional = await runtime.container.repositories.claims.listForCase(caseId)
    expect(institutional.map((claim) => claim.id).sort()).toEqual([...producedIds].sort())

    const after = (await review(runtime, runId))!
    expect(after.decision).toEqual({ kind: 'settled', state: 'completed' })
    /* Still readable as produced work: the claims were copied, not moved. */
    expect(after.produced).toHaveLength(before.produced.length)

    const written = capture('runReview.accepted', after)
    expect(
      written.changed && written.current !== null,
      `${written.path} was out of date and has been regenerated.`,
    ).toBe(false)
  })

  it('rejecting keeps the work readable and out of the record forever', async () => {
    const runtime = live[0]!
    const { caseId, runId } = await runMacroAwaitingAcceptance(runtime, {
      caseId: 'review-rejected',
      settle: 'reject',
      rejection: {
        code: 'unsupported-by-evidence',
        detail:
          'One observation cannot carry a statement about the policy stance. Cite the ' +
          'policy rate and the forward curve, or narrow the claim to the yield itself.',
      },
    })

    const found = (await review(runtime, runId))!
    expect(found.decision).toEqual({ kind: 'settled', state: 'rejected' })

    /* Durable operational history: still there, still readable, still cited. */
    expect(found.produced).toHaveLength(1)
    expect(found.produced[0]!.supporting[0]!.status).toBe('resolved')

    /* And structurally non-citable, because it is not in the claims table. */
    expect(await runtime.container.repositories.claims.listForCase(caseId)).toHaveLength(0)

    /* The reason survives in both halves — the code and the prose. */
    expect(found.run.rejection?.code).toBe('unsupported-by-evidence')
    expect(found.run.rejection?.detail).toMatch(/forward curve/)
    expect(found.run.failure).toBeUndefined()

    const written = capture('runReview.rejected', found)
    expect(
      written.changed && written.current !== null,
      `${written.path} was out of date and has been regenerated.`,
    ).toBe(false)
  })
})
