/**
 * Commissioning a live run from the product path, against PostgreSQL.
 *
 * The stage's central proof, and the one that has to be done against a real
 * database rather than in memory: everything commissioning depends on — the
 * case's pinned workflow version, the assignment the playbook created, the runs
 * that decide readiness, the produced-claim store on the far side of acceptance
 * — is durable state, and a suite that assembled it in a process would be
 * proving that the code agrees with itself.
 *
 * ## The provider is live to the institution and offline to the world
 *
 * `createOfflineLiveProvider` declares `kind: 'live'`, which is the whole point.
 * A stub resolves its tokens and cost to `not-applicable`, so a commissioning
 * test built on one would run a path where the budget rules **do not apply** —
 * and would pass identically against a case whose workflow authorizes nothing.
 * Declaring live means the budget is resolved from the playbook proposal, an
 * unmeasured dimension is refused, and reported usage is enforced. No money is
 * spent because no model is called.
 *
 * ## Two cases, on purpose
 *
 * One pinned to `macro-regime` **v2**, which carries the approved
 * `macro-analysis` budget, and one pinned to **v1**, which carries none. The
 * second is not a negative case bolted on: it is the stage ruling, executable.
 * A firm that had never proved the refusal would not know whether its budget
 * gate was load-bearing or decorative.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { APP_ROLE, createTestDatabase, type TestDatabase } from './testDatabase'
import { AT, startRuntime, type Runtime } from './macroFlowHarness'
import { runCommand } from '~/application/analysis/commands/runCommand'
import { openInvestmentCase } from '~/application/analysis/commands/openInvestmentCase'
import { instantiatePlaybook } from '~/application/analysis/commands/instantiatePlaybook'
import {
  MACRO_REGIME_CASE_KIND,
  MACRO_REGIME_PLAYBOOK,
  MACRO_REGIME_PLAYBOOK_V2,
} from '~/application/analysis/macroPlaybook'
import { registeredPlaybooks } from '~/application/analysis/playbookRegistry'
import {
  commissionAnalysis,
  commissionBrief,
} from '~/application/analysis/commissionAnalysis'
import { agentDirectory } from '~/application/analysis/agentDirectory'
import { runReview } from '~/application/analysis/runReview'
import { createOfflineLiveProvider } from '~/test/offlineLiveProvider'
import { buildEvidenceSet, observationRef, type EvidenceSet } from '~/domain/analysis'
import { buildProvenance } from '~/domain/shared/provenance'

const FIXTURES = resolve(process.cwd(), 'src/test/fixtures')

const V2_CASE = 'commission-v2'
const V1_CASE = 'commission-v1'
const DEPARTMENT = 'global-macro'
const ENTRY = 'macro-analysis'
/** The desk's own manager, and therefore an operator the mandate authorizes. */
const MACRO_OPERATOR = 'macro-head'

let db: TestDatabase
let appUrl: string
let runtime: Runtime

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  appUrl = await db.loginUrlFor(APP_ROLE)
  runtime = await startRuntime(appUrl)
}, 300_000)

afterAll(async () => {
  await runtime?.container.close().catch(() => {})
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

/** One real observation, so a desk has something it can legitimately cite. */
function institutionalEvidence(): EvidenceSet {
  const observedAt = '2026-07-31T00:00:00.000Z'
  const value = {
    yieldPercent: '2.41',
    changeBasisPoints: null,
    observationDate: '2026-07-31',
  }
  return buildEvidenceSet({
    items: [
      {
        ref: observationRef(
          {
            subjectKind: 'series',
            subject: 'de10y',
            kind: 'yield',
            observedAt,
            sourceId: 'ecb',
          },
          value,
        ),
        value,
        provenance: buildProvenance({
          asOf: observedAt,
          nowMs: Date.parse(AT),
          quality: 'official-daily',
          source: { providerId: 'ecb', providerName: 'ECB', trust: 'central-bank' },
        }),
      },
    ],
    assembledAt: AT,
    correlationId: 'commission',
  })
}

/**
 * Opens a case pinned to an exact workflow version.
 *
 * Through the real commands, with a real employee — the same route
 * `scripts/open-case.ts` takes, because there is no other way to open a case
 * and a fixture that inserted rows would be proving something else.
 */
async function openCaseAt(
  caseId: string,
  playbook: { id: string; version: string },
  question: string,
): Promise<void> {
  const deps = await runtime.container.commandDeps()
  const repositories = runtime.container.repositories
  const envelope = (commandId: string, over: Record<string, unknown> = {}) => ({
    commandId,
    correlationId: caseId,
    actor: { kind: 'employee' as const, employeeId: 'research-director' },
    initiator: { kind: 'employee' as const, employeeId: 'research-director' },
    occurredAt: AT,
    ...over,
  })

  const opened = await runCommand(
    openInvestmentCase(deps.organization),
    {
      caseId,
      subject: { kind: MACRO_REGIME_CASE_KIND, ref: 'ecb', displayName: 'ECB path' },
      question,
      ownerEmployeeId: 'research-director',
      participatingDepartmentIds: ['research-office'],
    },
    envelope(`${caseId}-open`),
    deps,
  )
  expect(opened.outcome, JSON.stringify(opened)).toBe('committed')

  const instantiated = await runCommand(
    instantiatePlaybook(deps.organization),
    {
      caseId,
      playbookId: playbook.id,
      playbookVersion: playbook.version,
      onBehalfOfDepartmentId: 'research-office',
    },
    envelope(`${caseId}-playbook`, {
      expectedVersion: (await repositories.cases.get(caseId))!.version,
    }),
    deps,
  )
  expect(instantiated.outcome, JSON.stringify(instantiated)).toBe('committed')
}

async function brief() {
  const deps = await runtime.container.commandDeps()
  return commissionBrief({
    repositories: runtime.container.repositories,
    organization: deps.organization,
    playbooks: registeredPlaybooks(),
    departmentId: DEPARTMENT,
    providerKind: 'live',
  })
}

function offlineProvider(
  over: Parameters<typeof createOfflineLiveProvider>[0] | null = null,
) {
  return createOfflineLiveProvider({
    loadEvidenceSet: (id) => runtime.container.repositories.evidence.get(id),
    ...(over ?? {}),
  })
}

async function commission(
  caseId: string,
  evidenceSetId: string,
  over: {
    actingEmployeeId?: string
    provider?: ReturnType<typeof createOfflineLiveProvider>
  } = {},
) {
  const deps = await runtime.container.commandDeps()
  return commissionAnalysis({
    repositories: runtime.container.repositories,
    deps,
    provider: over.provider ?? offlineProvider(),
    caseId,
    departmentId: DEPARTMENT,
    entryKey: ENTRY,
    evidenceSetId,
    actingEmployeeId: over.actingEmployeeId ?? MACRO_OPERATOR,
    now: () => new Date(AT),
  })
}

describe('commissioning a desk from the product', () => {
  it('runs the whole path, and refuses what the firm has not authorized', async () => {
    const repositories = runtime.container.repositories
    const evidence = institutionalEvidence()
    await repositories.evidence.save(evidence)

    await openCaseAt(
      V2_CASE,
      MACRO_REGIME_PLAYBOOK_V2,
      'Where is the German 10y heading, and what does it show about the ECB path?',
    )
    await openCaseAt(V1_CASE, MACRO_REGIME_PLAYBOOK, 'Does the ECB cut before Q2?')

    /* ------------------------------------------- what the surface is offered */

    const before = (await brief())!
    expect(before.desk.departmentId).toBe(DEPARTMENT)
    expect(before.entryKey).toBe(ENTRY)
    expect(before.providerKind).toBe('live')

    const v2 = before.cases.find((c) => c.investmentCase.id === V2_CASE)!
    const v1 = before.cases.find((c) => c.investmentCase.id === V1_CASE)!

    /*
     * The v2 case is eligible, and the budget it would run under is the
     * playbook's proposal — the source the stage ruled on, not a constant
     * copied from anywhere.
     */
    expect(v2.playbookVersion).toBe('2')
    expect(v2.eligibility).toEqual({
      kind: 'eligible',
      budget: {
        tokens: { kind: 'limit', tokens: 12_000 },
        cost: { kind: 'limit', costMinorUnits: 100, currency: 'USD' },
        deadline: { kind: 'limit', deadlineMs: 90_000 },
      },
    })

    /*
     * The v1 case is refused, by the budget design rather than by a screen.
     * `not-measured` is not `unlimited`, and a workflow that authorized no
     * spend authorizes none.
     *
     * All three dimensions, deadline included — which is the measurement that
     * matters most here. With no firm-wide ceiling to read (TD-76) and no
     * proposal on the entry, there is no authorized wall clock either, so the
     * commissioning path has no honest number to run under and does not invent
     * one. Every deadline a run records under this path came from a playbook
     * version that proposed it.
     */
    expect(v1.playbookVersion).toBe('1')
    expect(v1.eligibility).toEqual({
      kind: 'refused',
      reason: 'no-authorized-budget',
      unmeasured: ['tokens', 'cost', 'deadline'],
    })

    /* Both are on the list. A refusal a person cannot see is not an answer. */
    expect(before.cases.map((c) => c.investmentCase.id).sort()).toEqual(
      [V1_CASE, V2_CASE].sort(),
    )

    /* The evidence the firm actually holds, offered because it holds it. */
    expect(before.evidence).toHaveLength(1)
    expect(before.evidence[0]!.evidenceSetId).toBe(evidence.id)
    expect(before.evidence[0]!.observationCount).toBe(1)
    expect(before.evidence[0]!.sources).toEqual(['ECB'])
    expect(before.evidence[0]!.eligibility).toEqual({ kind: 'eligible' })

    /* --------------------------------------------- the mandate is real */

    /*
     * An operator who works elsewhere is declined by the institution, not
     * filtered out of a dropdown. The refusal comes from `StartAgentRun`'s
     * `department-contribution` mandate — the same rule that stops a desk
     * accepting another desk's work.
     */
    const foreign = await commission(V2_CASE, evidence.id, {
      actingEmployeeId: 'research-director',
    })
    expect(foreign).toEqual({ outcome: 'declined', code: 'not-authorised' })
    expect(await repositories.runs.listForCase(V2_CASE)).toHaveLength(0)

    /* ------------------------------------------- commissioning the v1 case */

    /*
     * Refused before any command is issued, and therefore before any money
     * could have been spent. Nothing is recorded: no run, no ledger entry.
     */
    const v1Result = await commission(V1_CASE, evidence.id)
    expect(v1Result).toEqual({ outcome: 'refused', reason: 'no-authorized-budget' })
    expect(await repositories.runs.listForCase(V1_CASE)).toHaveLength(0)

    /* ------------------------------------------------------ the real thing */

    const result = await commission(V2_CASE, evidence.id)
    expect(result.outcome, JSON.stringify(result)).toBe('ran')
    if (result.outcome !== 'ran') throw new Error('unreachable')
    expect(result.state).toBe('awaiting-acceptance')

    const run = (await repositories.runs.get(result.runId))!
    expect(run.caseId).toBe(V2_CASE)
    expect(run.departmentId).toBe(DEPARTMENT)
    expect(run.execution.playbookEntryKey).toBe(ENTRY)
    /* The version the CASE is pinned to, which is what it ran under. */
    expect(run.execution.playbookVersion).toBe('2')
    expect(run.execution.providerKind).toBe('live')
    /* The operator is the accountable actor, not the department's manager by default. */
    expect(run.employeeId).toBe(MACRO_OPERATOR)

    /* What the firm authorized, on the record, resolved from the proposal. */
    expect(run.budget).toEqual({
      tokens: { kind: 'limit', tokens: 12_000 },
      cost: { kind: 'limit', costMinorUnits: 100, currency: 'USD' },
      deadline: { kind: 'limit', deadlineMs: 90_000 },
    })

    /* ------------------------------------- selection did not run the firm */

    /*
     * The requested-entry filter, proved against the database rather than
     * against the orchestration's return value: five other entries exist in
     * this case's playbook, every one of them has an assignment, and not one
     * has a run. Commissioning macro-analysis commissioned macro-analysis.
     */
    const runs = await repositories.runs.listForCase(V2_CASE)
    expect(runs).toHaveLength(1)
    const assignments = await repositories.assignments.listForCase(V2_CASE)
    expect(assignments.length).toBeGreaterThan(1)
    expect(
      assignments
        .filter((a) => a.playbookEntryKey !== ENTRY)
        .every((a) => a.status === 'queued'),
      'an entry nobody asked for was moved out of the queue',
    ).toBe(true)

    /* ------------------------------------------- produced, not institutional */

    const produced = await repositories.producedClaims.listForRun(run.id)
    expect(produced.length).toBeGreaterThan(0)
    /*
     * And nothing is citable. The acceptance boundary is structural — every
     * citation in the firm is a foreign key into `analysis.claims` — so this is
     * asserted against the store rather than against a filter.
     */
    expect(await repositories.claims.listForCase(V2_CASE)).toHaveLength(0)

    /* The produced claim cites the evidence the run was actually given. */
    expect(produced[0]!.evidenceRefs[0]!.setId).toBe(evidence.id)

    /* --------------------------------------- a second commission is refused */

    /*
     * The assignment now carries a live run, so the institution declines a
     * second one — which is the rule `StartAgentRun` enforces and the partial
     * unique index in migration 0015 guarantees.
     */
    const again = await commission(V2_CASE, evidence.id)
    expect(again).toEqual({
      outcome: 'refused',
      reason: 'assignment-not-waiting',
    })

    /* ------------------------------------------------- into the review path */

    const deps = await runtime.container.commandDeps()
    const review = await runReview({
      repositories,
      organization: deps.organization,
      runId: run.id,
    })
    expect(review?.decision).toEqual({ kind: 'open' })
    expect(review?.produced.length).toBeGreaterThan(0)
    /* The citation resolves against the set the run was given. */
    expect(review?.produced[0]!.supporting[0]!.status).toBe('resolved')

    /* ------------------------------------------------------------ fixtures */

    /*
     * Captured from THIS database, so the run the commission returns is the run
     * the review resolves and the desk the journey starts from is the desk the
     * brief describes. Three captures from three databases would have three
     * different ids, and the journey test would have to fabricate the
     * connection it exists to prove.
     */
    const desks = await agentDirectory({
      repositories,
      organization: deps.organization,
      playbooks: registeredPlaybooks(),
    })

    const written = [
      capture('commissionFloor', desks),
      capture('commissionBrief', before),
      capture('commissionResult', result),
      capture('commissionReview', review),
    ]
    for (const file of written) {
      expect(
        file.changed && file.current !== null,
        `${file.path} was out of date and has been regenerated.`,
      ).toBe(false)
    }
  })
})

describe('a live run that overruns what the firm authorized', () => {
  it('fails honestly, stores no claim, and offers nothing to accept', async () => {
    const repositories = runtime.container.repositories
    const evidence = institutionalEvidence()
    await repositories.evidence.save(evidence)

    await openCaseAt(
      'commission-overrun',
      MACRO_REGIME_PLAYBOOK_V2,
      'What does the German 10y show?',
    )

    const deps = await runtime.container.commandDeps()
    const result = await commissionAnalysis({
      repositories,
      deps,
      /* Above the 12,000-token authorization, reported as measured. */
      provider: offlineProvider({
        loadEvidenceSet: (id) => repositories.evidence.get(id),
        usage: { inputTokens: 12_000, outputTokens: 4_000 },
      }),
      caseId: 'commission-overrun',
      departmentId: DEPARTMENT,
      entryKey: ENTRY,
      evidenceSetId: evidence.id,
      actingEmployeeId: MACRO_OPERATOR,
      now: () => new Date(AT),
    })

    expect(result.outcome).toBe('ran')
    if (result.outcome !== 'ran') throw new Error('unreachable')
    expect(result.state).toBe('failed')
    expect(result.failureCategory).toBe('budget-exhausted')

    /*
     * The run exists and the work does not. Offering someone the option to
     * accept spend the firm never authorized would put the decision in the
     * wrong place, so the claims are discarded rather than flagged.
     */
    const produced = await repositories.producedClaims.listForRun(result.runId)
    expect(produced).toHaveLength(0)

    const review = await runReview({
      repositories,
      organization: deps.organization,
      runId: result.runId,
    })
    expect(review?.decision).toEqual({ kind: 'settled', state: 'failed' })
    expect(review?.produced).toHaveLength(0)
  })
})
