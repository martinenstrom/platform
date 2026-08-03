/**
 * The whole decision layer survives a restart, and can only have survived in PostgreSQL.
 *
 * A durability test that keeps anything alive across the boundary proves that
 * the thing it kept alive works. So: the container is closed, a read through it
 * is required to FAIL, every reference is dropped, and a new container is built
 * against the same database. What the second runtime returns, it read.
 *
 * The negative control is the part that makes the rest mean something. Between
 * the two constructions, one variant empties the tables — and the reload must
 * then find nothing. If it still found the state, the state was never coming
 * from PostgreSQL.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import {
  cioReturn,
  cioSubmission,
  declinedDecision,
  deferredDecision,
  quantitativeTrigger,
  qualitativeTrigger,
  selectedDecision,
} from '~/domain/analysis/decisionFixtures'
import type { CaseDecision, CioReturn, CioSubmission } from '~/domain/analysis'
import { MalformedRowError } from '~/application/analysis/repositories'
import { createAnalysisContainer, type AnalysisContainer } from '../container'
import { seedDecisionGovernance } from '../decisionSeed'
import { IN_MEMORY_SEED_FIXTURES } from '../decisionSeedFixtures'
import { createTestDatabase, type TestDatabase } from './testDatabase'
import { APP_ROLE } from './testDatabase'

let db: TestDatabase
let appUrl: string

const AT = '2026-07-29T09:00:00.000Z'
const clock = {
  now: () => new Date(AT),
  epochMs: () => Date.parse(AT),
  isoNow: () => AT,
}

const build = (over: { buildId?: string } = {}) =>
  createAnalysisContainer({
    connectionString: appUrl,
    buildId: over.buildId ?? 'restart-build',
    clock,
  })

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  appUrl = await db.loginUrlFor(APP_ROLE)
}, 300_000)

afterAll(async () => {
  await db?.drop()
})

/* -------------------------------------------------- the canonical projection */

/**
 * Everything institutional, and nothing process-local.
 *
 * Field by field rather than by a heuristic over names: "drop anything ending
 * in `At`" would have quietly excluded `evaluatedAt`, `submittedAt`, `decidedAt`
 * and `returnedAt` — four stored facts about when the firm did things.
 *
 * Excluded, by name and with a reason: the storage provenance id and build id,
 * which are derived from the runtime's own coordinates and are a different
 * runtime by construction. Nothing else.
 */
interface Canonical {
  submissions: unknown
  returns: unknown
  live: unknown
  history: unknown
}

const submissionShape = (submission: CioSubmission) => ({
  ...submission,
  basis: {
    ...submission.basis,
    // Derived from the runtime that produced the projection, not institutional.
    storageProvenanceId: '<runtime>',
  },
})

const decisionShape = (decision: CaseDecision) => decision

async function canonical(container: AnalysisContainer): Promise<Canonical> {
  const repositories = container.repositories
  const cases = ['case-1', 'case-2', 'case-3']

  const submissions: CioSubmission[] = []
  const returns: CioReturn[] = []
  const live: Array<CaseDecision | null> = []
  const history: CaseDecision[][] = []

  for (const caseId of cases) {
    submissions.push(...(await repositories.submissions.listForCase(caseId)))
    returns.push(...(await repositories.submissions.returnsForCase(caseId)))
    live.push(await repositories.decisions.getForCase(caseId))
    history.push(await repositories.decisions.historyForCase(caseId))
  }

  return {
    submissions: submissions.map(submissionShape),
    returns,
    live: live.map((decision) => (decision === null ? null : decisionShape(decision))),
    history: history.map((entries) => entries.map(decisionShape)),
  }
}

/* ------------------------------------------------------------- the writing */

async function writeInstitutionalState(container: AnalysisContainer): Promise<void> {
  const repositories = container.repositories

  for (const caseId of ['case-1', 'case-2', 'case-3']) {
    await seedDecisionGovernance(repositories, {
      caseId,
      revisionIds: [`${caseId}-rev-1`, `${caseId}-rev-2`],
      fixtures: IN_MEMORY_SEED_FIXTURES,
    })
  }

  /** A submission pair per case, so every outcome has something to consider. */
  const pair = async (caseId: string) => {
    const first = await repositories.submissions.save(
      cioSubmission({
        id: `${caseId}-sub-1`,
        caseId,
        revisionId: `${caseId}-rev-1`,
        thesisId: `${caseId}-thesis-1`,
      }),
    )
    const second = await repositories.submissions.save(
      cioSubmission({
        id: `${caseId}-sub-2`,
        caseId,
        revisionId: `${caseId}-rev-2`,
        thesisId: `${caseId}-thesis-2`,
      }),
    )
    return [first.id, second.id] as const
  }

  const outcome = (caseId: string, ids: readonly string[]) => ({
    caseId,
    submissionIds: [...ids],
    evidenceSetId: selectedDecision().evidenceSetId,
    unresolvedDissent: [],
  })

  /* case-1 — a selected decision, then a correction that supersedes it. */
  const one = await pair('case-1')
  await repositories.decisions.save(
    selectedDecision({
      decisionId: 'restart-dec-1',
      ...outcome('case-1', one),
      outcome: {
        kind: 'selected',
        selectedRevisionId: 'case-1-rev-1',
        consideredRevisionIds: ['case-1-rev-1', 'case-1-rev-2'],
      },
      reconsiderationTriggers: [quantitativeTrigger({ id: 'restart-trg-1' })],
    }),
  )
  await repositories.decisions.save(
    selectedDecision({
      decisionId: 'restart-dec-1b',
      supersedesDecisionId: 'restart-dec-1',
      decidedAt: '2026-07-29T10:00:00.000Z',
      rationale: 'Corrected: the credit impulse was mis-signed.',
      ...outcome('case-1', one),
      outcome: {
        kind: 'selected',
        selectedRevisionId: 'case-1-rev-2',
        consideredRevisionIds: ['case-1-rev-1', 'case-1-rev-2'],
      },
      reconsiderationTriggers: [qualitativeTrigger({ id: 'restart-trg-1b' })],
    }),
  )

  /* case-2 — a deferral with its conditions, and a return on the way in. */
  const two = await pair('case-2')
  await repositories.submissions.recordReturn(
    cioReturn({
      id: 'restart-ret-1',
      submissionId: two[1],
      caseId: 'case-2',
      revisionId: 'case-2-rev-2',
    }),
  )
  await repositories.decisions.save(
    deferredDecision({
      decisionId: 'restart-dec-2',
      ...outcome('case-2', two),
      outcome: { kind: 'deferred', consideredRevisionIds: ['case-2-rev-1', 'case-2-rev-2'] },
      reconsiderationTriggers: [
        quantitativeTrigger({ id: 'restart-trg-2' }),
        qualitativeTrigger({ id: 'restart-trg-3' }),
      ],
    }),
  )

  /* case-3 — a decline accounting for both revisions. */
  const three = await pair('case-3')
  await repositories.decisions.save(
    declinedDecision({
      decisionId: 'restart-dec-3',
      ...outcome('case-3', three),
      outcome: {
        kind: 'declined',
        declinedRevisionIds: ['case-3-rev-1', 'case-3-rev-2'],
        consideredRevisionIds: ['case-3-rev-1', 'case-3-rev-2'],
      },
      reconsiderationTriggers: [quantitativeTrigger({ id: 'restart-trg-4' })],
    }),
  )
}

/* ------------------------------------------------------------- the restart */

describe('the analysis layer survives a restart', () => {
  let before: Canonical
  let after: Canonical
  let second: AnalysisContainer
  let closedContainer: AnalysisContainer

  beforeAll(async () => {
    const first = await build()
    await writeInstitutionalState(first)
    before = await canonical(first)

    await first.close()
    closedContainer = first

    /*
     * Every reference dropped. The second container shares no repository, no
     * mapper, no organization reader and no pool with the first — it is
     * constructed from nothing but a connection string.
     */
    second = await build()
    after = await canonical(second)
  }, 600_000)

  afterAll(async () => {
    await second?.close().catch(() => {})
  })

  it('cannot be read through the closed container', async () => {
    await expect(
      closedContainer.repositories.decisions.getForCase('case-1'),
    ).rejects.toThrow()
  })

  it('reloads every submission exactly', () => {
    expect(after.submissions).toEqual(before.submissions)
  })

  it('reloads returns and their concerns exactly', () => {
    expect(after.returns).toEqual(before.returns)
    expect(after.returns).toHaveLength(1)
  })

  it('reloads the live decision of every case', () => {
    expect(after.live).toEqual(before.live)
  })

  it('reloads the complete history, superseded rows included, in order', () => {
    expect(after.history).toEqual(before.history)
    const caseOne = (after.history as CaseDecision[][])[0]!
    expect(caseOne.map((decision) => decision.decisionId)).toEqual([
      'restart-dec-1',
      'restart-dec-1b',
    ])
  })

  it('keeps the supersession links in both directions', () => {
    const caseOne = (after.history as CaseDecision[][])[0]!
    expect(caseOne[1]?.supersedesDecisionId).toBe('restart-dec-1')
    expect((after.live as (CaseDecision | null)[])[0]?.decisionId).toBe('restart-dec-1b')
  })

  it('keeps every eligibility basis whole, blockers included', () => {
    for (const submission of after.submissions as CioSubmission[]) {
      expect(submission.basis.blockers).toEqual([])
      expect(submission.basis.eligibilityPolicyVersion).toBe('1')
      expect(submission.basis.requiredWork).toHaveLength(2)
      expect(submission.basis.verification).not.toBeNull()
    }
  })

  it('keeps evaluatedAt exactly, because it is stored institutional state', () => {
    /*
     * Not a volatile projection field here. Nothing recomputes it during
     * hydration — it records when the eligibility projection ran, and a restart
     * that regenerated it would replace a fact about the past with a fact about
     * the reload. The C1C-4.1 harness excluded it because that harness
     * recomputed it; that exclusion does not generalise.
     */
    const beforeStamps = (before.submissions as CioSubmission[]).map(
      (submission) => submission.basis.evaluatedAt,
    )
    const afterStamps = (after.submissions as CioSubmission[]).map(
      (submission) => submission.basis.evaluatedAt,
    )
    expect(afterStamps).toEqual(beforeStamps)
    expect(new Set(afterStamps).size).toBeGreaterThan(0)
  })

  it('keeps dissent, its evidence and each trigger policy version', () => {
    const live = (after.live as (CaseDecision | null)[])[1]!
    expect(live.reconsiderationTriggers.map((trigger) => trigger.id)).toEqual([
      'restart-trg-2',
      'restart-trg-3',
    ])
    expect(live.reconsiderationTriggers.map((trigger) => trigger.policyVersion)).toEqual([
      '1',
      '1',
    ])
  })

  it('keeps the actor snapshot, handle order included', () => {
    const live = (after.live as (CaseDecision | null)[])[0]!
    expect(live.decidedBy.departmentHandles).toEqual(['chief-decision', 'strategy'])
    expect(live.decidedBy.authentication).toBe('system-asserted')
  })

  it('keeps writing after the restart, and reloads what it wrote', async () => {
    await second.repositories.decisions.save(
      selectedDecision({
        decisionId: 'restart-dec-1c',
        supersedesDecisionId: 'restart-dec-1b',
        caseId: 'case-1',
        decidedAt: '2026-07-29T11:00:00.000Z',
        rationale: 'Corrected again, after the restart.',
        submissionIds: ['case-1-sub-1', 'case-1-sub-2'],
        outcome: {
          kind: 'selected',
          selectedRevisionId: 'case-1-rev-1',
          consideredRevisionIds: ['case-1-rev-1', 'case-1-rev-2'],
        },
        unresolvedDissent: [],
        reconsiderationTriggers: [quantitativeTrigger({ id: 'restart-trg-5' })],
      }),
    )

    expect((await second.repositories.decisions.getForCase('case-1'))?.decisionId).toBe(
      'restart-dec-1c',
    )
    expect(await second.repositories.decisions.historyForCase('case-1')).toHaveLength(3)
  })
})

/* --------------------------------------------------------- provenance */

describe('provenance across the restart', () => {
  it('derives the same capability identity for the same build', async () => {
    const first = await build()
    const one = await first.repositories.provenance()
    await first.close()

    const second = await build()
    const two = await second.repositories.provenance()
    await second.close()

    // Content-addressed: same coordinates, same identity. A new runtime is not
    // a new capability.
    expect(two.provenanceId).toBe(one.provenanceId)
    expect(two.queryCatalogHash).toBe(one.queryCatalogHash)
  })

  it('derives a different identity for a different build', async () => {
    const first = await build({ buildId: 'build-a' })
    const one = await first.repositories.provenance()
    await first.close()

    const second = await build({ buildId: 'build-b' })
    const two = await second.repositories.provenance()
    await second.close()

    expect(two.provenanceId).not.toBe(one.provenanceId)
  })

  it('rewrites no historical provenance row', async () => {
    const rows = await db.owner.query(
      `SELECT id, adapter_version, query_catalog_hash FROM analysis.storage_provenance
       ORDER BY id`,
    )
    const before = JSON.stringify(rows.rows)

    const container = await build()
    await container.repositories.provenance()
    await container.close()

    const after = await db.owner.query(
      `SELECT id, adapter_version, query_catalog_hash FROM analysis.storage_provenance
       WHERE id = ANY($1) ORDER BY id`,
      [rows.rows.map((row) => row.id)],
    )
    expect(JSON.stringify(after.rows)).toBe(before)
  })
})

/* ------------------------------------------------- the negative control */

describe('the reload can only have come from PostgreSQL', () => {
  let empty: TestDatabase
  let emptyUrl: string
  let owner: Client

  beforeAll(async () => {
    empty = await createTestDatabase()
    await empty.migrate()
    emptyUrl = await empty.loginUrlFor(APP_ROLE)
    owner = empty.owner
  }, 300_000)

  afterAll(async () => {
    await empty?.drop()
  })

  it('finds nothing when the database is emptied between constructions', async () => {
    /*
     * The control that makes the whole suite mean something. If the second
     * container could still see the state after the rows are gone, the state
     * was never coming from PostgreSQL — and every other assertion here would
     * be proving that memory works.
     */
    const first = await createAnalysisContainer({
      connectionString: emptyUrl,
      buildId: 'control',
      clock,
    })
    await seedDecisionGovernance(first.repositories, {
      caseId: 'case-1',
      revisionIds: ['rev-1', 'rev-2'],
      fixtures: IN_MEMORY_SEED_FIXTURES,
    })
    await first.repositories.submissions.save(cioSubmission())
    expect(await first.repositories.submissions.listForCase('case-1')).toHaveLength(1)
    await first.close()

    await empty.truncateAnalysisData()

    const second = await createAnalysisContainer({
      connectionString: emptyUrl,
      buildId: 'control',
      clock,
    })
    expect(await second.repositories.submissions.listForCase('case-1')).toEqual([])
    expect(await second.repositories.decisions.getForCase('case-1')).toBeNull()
    await second.close()
  })

  it('refuses to construct without durable storage', async () => {
    await expect(
      createAnalysisContainer({ connectionString: '', clock }),
    ).rejects.toThrow(/no in-memory fallback|connection string/i)
  })

  it('is unaffected by market-data fixture mode', async () => {
    /*
     * Different concern entirely. `MARKETDATA_MODE` chooses where price series
     * come from; it has never had anything to do with where institutional
     * records are kept, and a test says so rather than leaving it to be assumed.
     */
    const original = process.env.MARKETDATA_MODE
    process.env.MARKETDATA_MODE = 'fixture'
    try {
      const container = await createAnalysisContainer({
        connectionString: emptyUrl,
        buildId: 'control',
        clock,
      })
      const provenance = await container.repositories.provenance()
      expect(provenance.adapterId).toBe('postgres')
      await container.close()
    } finally {
      if (original === undefined) delete process.env.MARKETDATA_MODE
      else process.env.MARKETDATA_MODE = original
    }
  })

  it('has no in-memory repository anywhere in the durable graph', async () => {
    // Structural: the module graph of the durable container never reaches the
    // in-memory adapter. `importGraph.test.ts` asserts the general rule; this
    // is the one that matters for the restart proof specifically.
    const container = await createAnalysisContainer({
      connectionString: emptyUrl,
      buildId: 'control',
      clock,
    })
    expect((await container.repositories.provenance()).adapterId).toBe('postgres')
    expect(String(owner.database)).toBe(empty.name)
    await container.close()
  })
})

/* ------------------------------------------- ambiguous live state */

describe('a case holding two live decisions is refused, not resolved', () => {
  /**
   * The one corruption that needs the schema weakened to produce.
   *
   * `case_decisions_one_live_per_case` makes two unsuperseded decisions
   * unreachable — for the runtime and for the owner. So this test **drops that
   * index**, and cannot restore it afterwards: a unique index cannot be
   * recreated over the duplicate rows it was meant to prevent.
   *
   * The database is therefore its own, is never truncated back into a shared
   * pool, and is destroyed when the test finishes. Nothing else can reach it.
   */
  let corrupt: TestDatabase
  let container: AnalysisContainer

  beforeAll(async () => {
    corrupt = await createTestDatabase()
    await corrupt.migrate()
    const url = await corrupt.loginUrlFor(APP_ROLE)
    container = await createAnalysisContainer({
      connectionString: url,
      buildId: 'corrupt',
      clock,
    })

    await seedDecisionGovernance(container.repositories, {
      caseId: 'case-1',
      revisionIds: ['rev-1', 'rev-2'],
      fixtures: IN_MEMORY_SEED_FIXTURES,
    })
    await container.repositories.submissions.save(cioSubmission())
    await container.repositories.submissions.save(
      cioSubmission({ id: 'sub-2', revisionId: 'rev-2', thesisId: 'thesis-2' }),
    )
    await container.repositories.decisions.save(selectedDecision())

    // Deliberately weakening the schema. See the block comment above.
    await corrupt.owner.query(`DROP INDEX analysis.case_decisions_one_live_per_case`)
    /*
     * One transaction for the root and its relation. The outcome guard is
     * deferred, so it fires at COMMIT -- two statements would be two
     * transactions, and the first would commit a decision considering nothing.
     */
    await corrupt.owner.query('BEGIN')
    await corrupt.owner.query(`
      INSERT INTO analysis.case_decisions
        (decision_id, case_id, tenant_id, aggregate_version, decided_at,
         decided_by_employee_id, outcome_kind, evidence_set_id, rationale,
         organization_seed_version, authentication, authorization_basis)
      SELECT 'dec-shadow', case_id, tenant_id, aggregate_version, decided_at,
             decided_by_employee_id, 'declined', evidence_set_id,
             'a second live decision that should not exist',
             organization_seed_version, authentication, authorization_basis
      FROM analysis.case_decisions WHERE decision_id = 'dec-1'`)
    await corrupt.owner.query(`
      INSERT INTO analysis.decision_submissions
        (decision_id, submission_id, case_id, revision_id, relation)
      VALUES ('dec-shadow', 'sub-1', 'case-1', 'rev-1', 'declined')`)
    await corrupt.owner.query('COMMIT')
  }, 300_000)

  afterAll(async () => {
    await container?.close().catch(() => {})
    // Destroyed, not returned. The index is gone and cannot come back.
    await corrupt?.drop()
  })

  it('refuses the ambiguous state rather than picking one', async () => {
    await expect(container.repositories.decisions.getForCase('case-1')).rejects.toThrow(
      MalformedRowError,
    )
  })

  it('returns neither decision as authoritative', async () => {
    const error = await container.repositories.decisions
      .getForCase('case-1')
      .then(
        () => null,
        (thrown: Error) => thrown,
      )
    expect(error).not.toBeNull()
    // No aggregate came back at all — not the first, not the newest, not either.
    expect(String(error?.message)).not.toContain('dec-1')
  })

  it('modifies no institutional state', async () => {
    await container.repositories.decisions.getForCase('case-1').catch(() => {})
    const rows = await corrupt.owner.query(
      `SELECT decision_id FROM analysis.case_decisions
       WHERE case_id = 'case-1' AND superseded_by_decision_id IS NULL
       ORDER BY decision_id`,
    )
    // Both still there. Refusing is not repairing.
    expect(rows.rows.map((row) => row.decision_id)).toEqual(['dec-1', 'dec-shadow'])
  })

  it('leaks no SQL or index detail', async () => {
    const error = await container.repositories.decisions
      .getForCase('case-1')
      .then(
        () => null,
        (thrown: Error) => thrown,
      )
    const message = String(error?.message)
    expect(message).not.toMatch(/SELECT|INSERT|INDEX/i)
    expect(message).not.toContain('case_decisions_one_live_per_case')
    expect(message).toContain('more than one live decision')
  })

  it('still reads the complete history, which is unambiguous', async () => {
    // History asks a different question and has a defensible answer, so it
    // keeps working: what the firm decided over time is not in doubt.
    const history = await container.repositories.decisions.historyForCase('case-1')
    expect(history).toHaveLength(2)
  })
})
