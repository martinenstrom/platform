/**
 * Supersession, the constraints that make it safe, and the races it must survive.
 *
 * The shared contract already proves the semantics match the in-memory
 * reference. These are the things that have no in-memory counterpart: whether
 * the six named constraints are what the catalogue claims, whether forcing them
 * actually checks anything, what two concurrent corrections do to one case, and
 * what the runtime role is allowed to write.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import {
  cioSubmission,
  qualitativeTrigger,
  quantitativeTrigger,
  selectedDecision,
  deferredDecision,
} from '~/domain/analysis/decisionFixtures'
import type { CaseDecision } from '~/domain/analysis'
import {
  ConcurrencyConflictError,
  ImmutableRecordError,
  InvariantViolationError,
} from '~/application/analysis/repositories'
import type { StorageMetrics } from '~/application/analysis/storageObservability'
import { seedDecisionGovernance } from '../decisionSeed'
import { IN_MEMORY_SEED_FIXTURES } from '../decisionSeedFixtures'
import { DEFERRED_DECISION_CONSTRAINTS } from './deferredConstraints'
import {
  createPostgresRepositories,
  type PostgresRepositories,
} from './postgresRepositories'
import {
  APP_ROLE,
  createTestDatabase,
  isPermissionDenied,
  type TestDatabase,
} from './testDatabase'

let db: TestDatabase
let appUrl: string
let repositories: PostgresRepositories
const opened: PostgresRepositories[] = []

const counts = new Map<string, number>()
const counting: StorageMetrics = {
  increment: () => {},
  gauge: () => {},
  observe: (name, _value, labels) => {
    if (name !== 'analysis.db.query.latency_ms') return
    const operation = String(labels?.operation ?? 'unknown')
    counts.set(operation, (counts.get(operation) ?? 0) + 1)
  },
}
const statementsFor = (operation: string) => counts.get(operation) ?? 0

beforeAll(async () => {
  db = await createTestDatabase()
  await db.migrate()
  appUrl = await db.loginUrlFor(APP_ROLE)
}, 300_000)

afterAll(async () => {
  await Promise.all(opened.map((entry) => entry.close().catch(() => {})))
  await db?.drop()
})

beforeEach(async () => {
  await db.truncateAnalysisData()
  repositories = createPostgresRepositories({
    connectionString: appUrl,
    metrics: counting,
  })
  opened.push(repositories)
  await seedDecisionGovernance(repositories, {
    caseId: 'case-1',
    revisionIds: ['rev-1', 'rev-2'],
    fixtures: IN_MEMORY_SEED_FIXTURES,
  })
  await repositories.submissions.save(cioSubmission())
  await repositories.submissions.save(
    cioSubmission({ id: 'sub-2', revisionId: 'rev-2', thesisId: 'thesis-2' }),
  )
  counts.clear()
})

afterEach(async () => {
  await repositories.close()
})

/** A correction of `dec-1`, with its own conditions. Trigger ids are global. */
const correction = (over: Partial<CaseDecision> = {}): CaseDecision =>
  selectedDecision({
    decisionId: 'dec-2',
    supersedesDecisionId: 'dec-1',
    decidedAt: '2026-07-28T15:00:00.000Z',
    rationale: 'Corrected: the credit impulse was mis-signed.',
    reconsiderationTriggers: [
      quantitativeTrigger({ id: 'trg-c1' }),
      qualitativeTrigger({ id: 'trg-c2' }),
    ],
    ...over,
  })

/* ------------------------------------------------- the constraint catalogue */

describe('the named deferred constraints are what the catalogue claims', () => {
  it('names six, and each exists on its expected table, deferrable and deferred', async () => {
    /*
     * The test that matters most. `SET CONSTRAINTS` on a name that does not
     * exist raises — but on one that exists and is NOT deferrable it succeeds
     * and does nothing, so a constraint renamed or quietly made immediate would
     * turn the whole forcing mechanism into a no-op every other test still
     * passes. All four properties are checked, from the live catalogue.
     */
    const rows = await db.owner.query<{
      conname: string
      table_name: string
      condeferrable: boolean
      condeferred: boolean
    }>(
      `SELECT con.conname, rel.relname AS table_name,
              con.condeferrable, con.condeferred
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = rel.relnamespace
       WHERE ns.nspname = 'analysis' AND con.conname = ANY($1)`,
      [DEFERRED_DECISION_CONSTRAINTS.map((entry) => entry.name)],
    )

    expect(DEFERRED_DECISION_CONSTRAINTS).toHaveLength(6)
    expect(rows.rows).toHaveLength(6)

    for (const expected of DEFERRED_DECISION_CONSTRAINTS) {
      const actual = rows.rows.find((row) => row.conname === expected.name)
      expect(actual, `${expected.name} does not exist`).toBeDefined()
      expect(actual!.table_name, `${expected.name} table`).toBe(expected.table)
      expect(actual!.condeferrable, `${expected.name} deferrable`).toBe(true)
      expect(actual!.condeferred, `${expected.name} initially deferred`).toBe(true)
    }
  })
})

describe('forcing the named constraints', () => {
  it('fails an invalid decision from save, not from the caller commit', async () => {
    /*
     * Hand-assembled past the domain builder, which is the case the triggers
     * exist for. Without forcing, this would surface from withTransaction after
     * the callback returned — a different call boundary from the in-memory
     * reference's.
     */
    const invalid = {
      ...deferredDecision({ decisionId: 'dec-bad' }),
      reconsiderationTriggers: [],
    } as CaseDecision

    await expect(repositories.decisions.save(invalid)).rejects.toThrow(
      InvariantViolationError,
    )
  })

  it('leaves an unrelated deferred constraint deferred', async () => {
    /*
     * The property `SET CONSTRAINTS ALL IMMEDIATE` would have destroyed. The
     * unrelated work is a second decision's rows, written in the same outer
     * transaction and completed only after the first decision's write has
     * already forced its own six.
     */
    await repositories.withTransaction(async (scoped) => {
      await scoped.decisions.save(selectedDecision())
      // If the first save had forced ALL constraints, a decision written after
      // it in the same transaction would be checked eagerly and fail here.
      await scoped.decisions.save(
        selectedDecision({
          decisionId: 'dec-other-case',
          caseId: 'case-1',
          supersedesDecisionId: 'dec-1',
          reconsiderationTriggers: [quantitativeTrigger({ id: 'trg-x' })],
        }),
      )
    })

    expect((await repositories.decisions.getForCase('case-1'))?.decisionId).toBe(
      'dec-other-case',
    )
  })
})

/* -------------------------------------------------------------- the races */

describe('two corrections racing for one live decision', () => {
  beforeEach(async () => {
    await repositories.decisions.save(selectedDecision())
  })

  it('lets one different successor win and bounds the loser', async () => {
    const other = createPostgresRepositories({ connectionString: appUrl })
    opened.push(other)

    const results = await Promise.allSettled([
      repositories.decisions.save(correction()),
      other.decisions.save(
        correction({
          decisionId: 'dec-3',
          reconsiderationTriggers: [quantitativeTrigger({ id: 'trg-d1' })],
        }),
      ),
    ])

    const won = results.filter((result) => result.status === 'fulfilled')
    const lost = results.filter((result) => result.status === 'rejected')
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConcurrencyConflictError,
    )

    // Exactly one live decision, and it is the winner.
    const live = await db.owner.query(
      `SELECT decision_id FROM analysis.case_decisions
       WHERE case_id = 'case-1' AND superseded_by_decision_id IS NULL`,
    )
    expect(live.rows).toHaveLength(1)
    expect(live.rows[0].decision_id).not.toBe('dec-1')

    await other.close()
  })

  it('returns the winner to an identical concurrent successor', async () => {
    /*
     * The zero-row case that must NOT be a conflict. Both callers submit the
     * same correction; the loser's guarded update affects nothing, looks for
     * the successor, finds the winner's, and returns it.
     */
    const other = createPostgresRepositories({ connectionString: appUrl })
    opened.push(other)

    const results = await Promise.allSettled([
      repositories.decisions.save(correction()),
      other.decisions.save(correction()),
    ])

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true)
    for (const result of results) {
      expect((result as PromiseFulfilledResult<CaseDecision>).value.decisionId).toBe(
        'dec-2',
      )
    }

    const all = await db.owner.query(
      `SELECT decision_id FROM analysis.case_decisions WHERE case_id = 'case-1'`,
    )
    expect(all.rows).toHaveLength(2)

    await other.close()
  })

  it('treats a sequential identical retry as a replay', async () => {
    const first = await repositories.decisions.save(correction())
    const again = await repositories.decisions.save(correction())
    expect(again.decisionId).toBe(first.decisionId)

    const all = await db.owner.query(
      `SELECT decision_id FROM analysis.case_decisions WHERE case_id = 'case-1'`,
    )
    expect(all.rows).toHaveLength(2)
  })

  it('refuses a different decision under the successor id', async () => {
    await repositories.decisions.save(correction())
    await expect(
      repositories.decisions.save(correction({ rationale: 'Something else entirely.' })),
    ).rejects.toThrow(/already exists with different content/)
  })
})

/* ------------------------------------------------------- error taxonomy */

describe('the schema raises, classified', () => {
  it('maps an outcome-guard failure to an invariant violation', async () => {
    const invalid = {
      ...deferredDecision({ decisionId: 'dec-guard' }),
      reconsiderationTriggers: [],
    } as CaseDecision
    const error = await repositories.decisions.save(invalid).then(
      () => null,
      (thrown: Error) => thrown,
    )
    expect(error).toBeInstanceOf(InvariantViolationError)
    expect(error).not.toBeInstanceOf(ImmutableRecordError)
  })

  it('maps a committed-decision rewrite to an immutability failure', async () => {
    await repositories.decisions.save(selectedDecision())
    const owner = db.owner
    // As the OWNER, so the refusal comes from the guard rather than a grant.
    const error = await owner
      .query(`UPDATE analysis.case_decisions SET rationale = 'edited'`)
      .then(
        () => null,
        (thrown: unknown) => thrown,
      )
    expect((error as { code?: string })?.code).toBe('23000')
    expect(String((error as Error).message)).toContain('cannot be')
  })

  it('lets no SQL, parameter or PostgreSQL detail escape', async () => {
    const invalid = {
      ...deferredDecision({ decisionId: 'dec-hygiene' }),
      reconsiderationTriggers: [],
    } as CaseDecision
    const error = await repositories.decisions.save(invalid).then(
      () => null,
      (thrown: Error) => thrown,
    )
    const message = String(error?.message)
    expect(message).not.toMatch(/INSERT|SELECT|UPDATE/i)
    expect(message).not.toMatch(/Key \(/)
    expect(message).not.toContain('disinflation')
    /*
     * A bounded code, not a sentence. This particular decision never reaches
     * SQL -- the shared validator refuses it first, which is the designed order
     * -- so the code is the validator's. The database guard's own
     * classification is unit-tested in `errorTaxonomy.test.ts`, where the
     * raised message can be presented directly.
     */
    expect(message).toContain('decision-deferral-without-condition')
  })
})

/* ------------------------------------------------------- query budgets */

describe('supersession statement counts', () => {
  beforeEach(async () => {
    await repositories.decisions.save(selectedDecision())
    counts.clear()
  })

  it('writes a first correction in a fixed number of statements', async () => {
    await repositories.decisions.save(correction())
    /*
     * Replay probe · predecessor · its submissions · the submission check ·
     * the guarded update · the root · four children · two constraint
     * statements. Twelve, and twelve at any child count.
     */
    expect(statementsFor('decisions.save')).toBe(12)
  })

  it('replays an identical correction in five', async () => {
    await repositories.decisions.save(correction())
    counts.clear()
    await repositories.decisions.save(correction())
    // The probe and its four hydration reads. Nothing written.
    expect(statementsFor('decisions.save')).toBe(5)
  })

  it('reads live and history at five each after a supersession', async () => {
    await repositories.decisions.save(correction())

    counts.clear()
    await repositories.decisions.getForCase('case-1')
    expect(statementsFor('decisions.getForCase')).toBe(5)

    counts.clear()
    const history = await repositories.decisions.historyForCase('case-1')
    expect(statementsFor('decisions.historyForCase')).toBe(5)
    expect(history.map((decision) => decision.decisionId)).toEqual(['dec-1', 'dec-2'])
  })
})

/* ---------------------------------------------------------- runtime role */

describe('the runtime role writes only the supersession link', () => {
  let app: Client

  beforeEach(async () => {
    await repositories.decisions.save(selectedDecision())
    app = await db.connectAs(APP_ROLE)
  })

  afterEach(async () => {
    await app.end().catch(() => {})
  })

  const refusal = async (sql: string) =>
    app.query(sql).then(
      () => null,
      (error: unknown) => error,
    )

  it('performs the whole supersession as finos_app', async () => {
    await repositories.decisions.save(correction())
    expect((await repositories.decisions.getForCase('case-1'))?.decisionId).toBe('dec-2')
    expect(await repositories.decisions.historyForCase('case-1')).toHaveLength(2)
  })

  it('cannot rewrite or delete either decision', async () => {
    await repositories.decisions.save(correction())
    for (const statement of [
      `UPDATE analysis.case_decisions SET rationale = 'edited'`,
      `UPDATE analysis.case_decisions SET outcome_kind = 'declined'`,
      `DELETE FROM analysis.case_decisions`,
    ]) {
      const error = await refusal(statement)
      expect(error, statement).not.toBeNull()
    }
  })

  it('cannot rewrite relations, dissent or triggers', async () => {
    await repositories.decisions.save(correction())
    for (const table of [
      'decision_submissions',
      'decision_dissent',
      'decision_dissent_evidence',
      'decision_reconsideration_triggers',
    ]) {
      expect(
        isPermissionDenied(await refusal(`DELETE FROM analysis.${table}`)),
        table,
      ).toBe(true)
    }
    expect(
      isPermissionDenied(
        await refusal(`UPDATE analysis.decision_submissions SET relation = 'selected'`),
      ),
    ).toBe(true)
  })

  it('cannot disable the guards that make supersession safe', async () => {
    expect(
      isPermissionDenied(
        await refusal(
          `ALTER TABLE analysis.case_decisions DISABLE TRIGGER case_decisions_outcome_guard`,
        ),
      ),
    ).toBe(true)
  })
})
