/**
 * What the store refuses to hand back, and what it refuses to accept at all.
 *
 * Four enforcement categories, kept apart on purpose:
 *
 *   **S** — schema-prevented. The insert fails; the mapper is never reached.
 *   **P** — permission-prevented. The owner can; `finos_app` cannot.
 *   **H** — privileged corruption stored successfully, then refused on hydration.
 *   **N** — not detectable from the persisted representation at all.
 *
 * The distinction is the whole point. **A failed corrupt insert is not proof
 * that the mapper refuses anything** — it proves the database does. So every
 * **H** case asserts the malformed state exists *first*, and only then reads
 * it; and every **S** case says plainly that hydration was never exercised.
 *
 * ## What weakens the schema, and what does not
 *
 * `cio_submissions`, `cio_returns` and `cio_return_concerns` carry no
 * immutability trigger, so the owner can corrupt them directly and the database
 * stays intact and reusable. `case_decisions` carries `case_decisions_immutable`
 * from 0008 plus the deferred outcome guards, so corrupting a decision means
 * disabling triggers — those cases run in a database that is destroyed rather
 * than truncated back into use.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  cioReturn,
  cioSubmission,
  claimIdFor,
  deferredDecision,
  selectedDecision,
  verificationIdFor,
} from '~/domain/analysis/decisionFixtures'
import {
  InvariantViolationError,
  MalformedRowError,
} from '~/application/analysis/repositories'
import { seedDecisionGovernance } from '../decisionSeed'
import { IN_MEMORY_SEED_FIXTURES } from '../decisionSeedFixtures'
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
  repositories = await createPostgresRepositories({ connectionString: appUrl })
  opened.push(repositories)
  await seedDecisionGovernance(repositories, {
    caseId: 'case-1',
    revisionIds: ['rev-1', 'rev-2'],
    fixtures: IN_MEMORY_SEED_FIXTURES,
  })
  await seedDecisionGovernance(repositories, {
    caseId: 'case-2',
    revisionIds: ['rev-3', 'rev-4'],
    fixtures: IN_MEMORY_SEED_FIXTURES,
  })
})

afterEach(async () => {
  await repositories.close()
})

/** Every read that hydrates a submission. Corruption must be refused by all of them. */
const submissionReads = () =>
  [
    ['get', () => repositories.submissions.get('sub-1')],
    ['listForCase', () => repositories.submissions.listForCase('case-1')],
    [
      'applicableForRevision',
      () => repositories.submissions.applicableForRevision('rev-1'),
    ],
    ['pending', () => repositories.submissions.pending()],
  ] as const

/* =========================================================== submissions === */

describe('submissions — H: stored by privilege, refused on hydration', () => {
  beforeEach(async () => {
    await repositories.submissions.save(cioSubmission())
  })

  /** No immutability trigger on this table: the owner simply writes. */
  const corrupt = (sql: string, values: unknown[] = []) => db.owner.query(sql, values)

  const provenExists = async (column: string, expected: string) => {
    const row = await db.owner.query(
      `SELECT ${column} AS value FROM analysis.cio_submissions WHERE id = 'sub-1'`,
    )
    expect(row.rows[0].value, 'the malformed state was not created').toBe(expected)
  }

  it('refuses a Verification review from another revision, on every read', async () => {
    await corrupt(
      `UPDATE analysis.cio_submissions SET verification_review_id = $1 WHERE id = 'sub-1'`,
      [verificationIdFor('rev-2')],
    )
    await provenExists('verification_review_id', verificationIdFor('rev-2'))

    for (const [name, read] of submissionReads()) {
      await expect(read(), name).rejects.toThrow(MalformedRowError)
    }
  })

  it("refuses a Devil's Advocate challenge from another revision", async () => {
    await corrupt(
      `UPDATE analysis.submission_open_challenges
          SET challenge_id = 'challenge-a-rev-2'
        WHERE submission_id = 'sub-1' AND challenge_id = 'challenge-a-rev-1'`,
    )
    await expect(repositories.submissions.get('sub-1')).rejects.toThrow(MalformedRowError)
  })

  it('refuses a Risk review from another revision', async () => {
    await corrupt(
      `UPDATE analysis.cio_submissions SET risk_review_id = 'review-r-rev-2'
        WHERE id = 'sub-1'`,
    )
    await provenExists('risk_review_id', 'review-r-rev-2')
    await expect(repositories.submissions.get('sub-1')).rejects.toThrow(MalformedRowError)
  })

  it('refuses a governance artifact from another case', async () => {
    await corrupt(
      `UPDATE analysis.cio_submissions SET verification_review_id = $1 WHERE id = 'sub-1'`,
      [verificationIdFor('rev-3')],
    )
    await expect(repositories.submissions.get('sub-1')).rejects.toThrow(MalformedRowError)
  })

  it('refuses an aggregation that produced another revision', async () => {
    await corrupt(
      `UPDATE analysis.cio_submissions SET aggregation_id = 'agg-rev-2' WHERE id = 'sub-1'`,
    )
    await expect(repositories.submissions.get('sub-1')).rejects.toThrow(MalformedRowError)
  })

  it('refuses an actor claiming an authentication the runtime cannot perform', async () => {
    /*
     * The submission has no actor columns of its own; the return does. Proven
     * on the return, and recorded here so the matrix is not silently missing a
     * row it claims to cover.
     */
    await repositories.submissions.recordReturn(cioReturn())
    await corrupt(
      `UPDATE analysis.cio_returns SET authentication = 'authenticated' WHERE id = 'ret-1'`,
    )
    await expect(repositories.submissions.getReturn('ret-1')).rejects.toThrow(
      MalformedRowError,
    )
  })

  it('refuses a required-work run belonging to another case', async () => {
    await corrupt(
      `UPDATE analysis.submission_required_work SET run_id = 'run-1-rev-3'
        WHERE submission_id = 'sub-1' AND playbook_entry_key = 'macro-scan'`,
    )
    await expect(repositories.submissions.get('sub-1')).rejects.toThrow(MalformedRowError)
  })

  it('leaves the corrupt row exactly as it found it', async () => {
    await corrupt(
      `UPDATE analysis.cio_submissions SET risk_review_id = 'review-r-rev-2'
        WHERE id = 'sub-1'`,
    )
    await repositories.submissions.get('sub-1').catch(() => {})

    // Refusing is not repairing. A mapper that "fixed" this would be laundering
    // corruption into the record.
    await provenExists('risk_review_id', 'review-r-rev-2')
  })

  it('leaks no SQL, column or parameter', async () => {
    await corrupt(
      `UPDATE analysis.cio_submissions SET risk_review_id = 'review-r-rev-2'
        WHERE id = 'sub-1'`,
    )
    const error = await repositories.submissions.get('sub-1').then(
      () => null,
      (thrown: Error) => thrown,
    )
    const message = String(error?.message)
    expect(message).not.toMatch(/SELECT|UPDATE|INSERT/i)
    expect(message).not.toMatch(/Key \(/)
    expect(message).toContain('submission-review-wrong-revision')
  })
})

describe('submissions — S: the schema refuses the insert', () => {
  /*
   * Hydration is NOT exercised in any of these. The database prevents the state
   * from existing, so there is nothing for the mapper to refuse — and saying so
   * is the difference between a matrix and a list of green ticks.
   */
  const refused = async (sql: string) =>
    db.owner.query(sql).then(
      () => null,
      (error: unknown) => error,
    )

  beforeEach(async () => {
    await repositories.submissions.save(cioSubmission())
  })

  it('refuses an unknown eligibility policy version', async () => {
    expect(
      await refused(
        `UPDATE analysis.cio_submissions SET eligibility_policy_version = '99'
          WHERE id = 'sub-1'`,
      ),
    ).not.toBeNull()
  })

  it('refuses an unresolved Risk requirement', async () => {
    expect(
      await refused(
        `UPDATE analysis.cio_submissions SET risk_requirement = 'unresolved'
          WHERE id = 'sub-1'`,
      ),
    ).not.toBeNull()
  })

  it('refuses a dangling storage provenance reference', async () => {
    expect(
      await refused(
        `UPDATE analysis.cio_submissions SET storage_provenance_id = 'prov-nowhere'
          WHERE id = 'sub-1'`,
      ),
    ).not.toBeNull()
  })

  it('refuses a state outside the vocabulary', async () => {
    expect(
      await refused(
        `UPDATE analysis.cio_submissions SET state = 'maybe' WHERE id = 'sub-1'`,
      ),
    ).not.toBeNull()
  })
})

describe('submissions — P: the runtime role cannot reach it', () => {
  it('cannot rewrite anything but the state', async () => {
    await repositories.submissions.save(cioSubmission())
    const app = await db.connectAs(APP_ROLE)
    try {
      const error = await app
        .query(`UPDATE analysis.cio_submissions SET verification_review_id = 'x'`)
        .then(
          () => null,
          (thrown: unknown) => thrown,
        )
      expect(isPermissionDenied(error)).toBe(true)
    } finally {
      await app.end()
    }
  })
})

describe('submissions — N: not detectable, and no test pretends otherwise', () => {
  it('cannot tell a deleted required-work row from a smaller basis (TD-58)', async () => {
    /*
     * Deliberately NOT an assertion that corruption is refused, because it is
     * not. `cio_submissions` carries no expected count, manifest or hash; the
     * child rows are the entire representation; and zero required-work rows is
     * a legitimate basis. A deleted row therefore produces another internally
     * valid submission.
     *
     * This test records the gap so it cannot be forgotten, and it FAILS if the
     * representation ever gains the witness that would close TD-58 — at which
     * point the case moves to category H and this test is replaced by a real
     * refusal.
     */
    await repositories.submissions.save(cioSubmission())
    await db.owner.query(
      `DELETE FROM analysis.submission_required_work
        WHERE submission_id = 'sub-1' AND playbook_entry_key = 'macro-scan'`,
    )

    const smaller = await repositories.submissions.get('sub-1')
    expect(smaller).not.toBeNull()
    expect(smaller!.basis.requiredWork).toHaveLength(1)

    const columns = await db.owner.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'analysis' AND table_name = 'cio_submissions'
         AND (column_name LIKE '%manifest%' OR column_name LIKE '%hash%'
              OR column_name LIKE '%expected%')`,
    )
    expect(
      columns.rows,
      'a basis witness now exists — TD-58 can close and this case becomes H',
    ).toEqual([])
  })
})

/* =============================================================== returns === */

describe('returns — H: stored by privilege, refused on hydration', () => {
  beforeEach(async () => {
    await repositories.submissions.save(cioSubmission())
    await repositories.submissions.recordReturn(cioReturn())
  })

  it('refuses a return whose concerns were all deleted', async () => {
    await db.owner.query(
      `DELETE FROM analysis.cio_return_concerns WHERE return_id = 'ret-1'`,
    )
    const remaining = await db.owner.query(
      `SELECT count(*)::int AS n FROM analysis.cio_return_concerns WHERE return_id = 'ret-1'`,
    )
    expect(remaining.rows[0].n, 'the malformed state was not created').toBe(0)

    await expect(repositories.submissions.getReturn('ret-1')).rejects.toThrow(
      MalformedRowError,
    )
    await expect(repositories.submissions.returnsForCase('case-1')).rejects.toThrow(
      MalformedRowError,
    )
  })

  it('refuses a concern about another case', async () => {
    await db.owner.query(
      `UPDATE analysis.cio_return_concerns SET subject_id = $1
        WHERE return_id = 'ret-1' AND subject_kind = 'claim'`,
      [claimIdFor('rev-3')],
    )
    await expect(repositories.submissions.getReturn('ret-1')).rejects.toThrow(
      MalformedRowError,
    )
  })

  it('refuses a concern about another revision', async () => {
    await db.owner.query(
      `UPDATE analysis.cio_return_concerns SET subject_kind = 'review', subject_id = $1
        WHERE return_id = 'ret-1' AND subject_kind = 'claim'`,
      [verificationIdFor('rev-2')],
    )
    await expect(repositories.submissions.getReturn('ret-1')).rejects.toThrow(
      MalformedRowError,
    )
  })

  it('refuses a concern whose subject does not exist', async () => {
    await db.owner.query(
      `UPDATE analysis.cio_return_concerns SET subject_id = 'claim-nowhere'
        WHERE return_id = 'ret-1' AND subject_kind = 'claim'`,
    )
    await expect(repositories.submissions.getReturn('ret-1')).rejects.toThrow(
      MalformedRowError,
    )
  })

  it('refuses a concern-kind and reference combination that cannot be true', async () => {
    // A claim id presented as a review: the id exists, but not as that kind.
    await db.owner.query(
      `UPDATE analysis.cio_return_concerns SET subject_kind = 'review', subject_id = $1
        WHERE return_id = 'ret-1' AND subject_kind = 'claim'`,
      [claimIdFor('rev-1')],
    )
    await expect(repositories.submissions.getReturn('ret-1')).rejects.toThrow(
      MalformedRowError,
    )
  })

  it('refuses a malformed actor snapshot', async () => {
    await db.owner.query(
      `UPDATE analysis.cio_returns SET authentication = 'authenticated' WHERE id = 'ret-1'`,
    )
    await expect(repositories.submissions.getReturn('ret-1')).rejects.toThrow(
      MalformedRowError,
    )
  })
})

describe('returns — S and P', () => {
  beforeEach(async () => {
    await repositories.submissions.save(cioSubmission())
    await repositories.submissions.recordReturn(cioReturn())
  })

  it('S · refuses a returned_for outside the vocabulary', async () => {
    const error = await db.owner
      .query(
        `UPDATE analysis.cio_returns SET returned_for = 'because' WHERE id = 'ret-1'`,
      )
      .then(
        () => null,
        (thrown: unknown) => thrown,
      )
    expect(error).not.toBeNull()
  })

  it('S · refuses a concern subject_kind outside the vocabulary', async () => {
    const error = await db.owner
      .query(`UPDATE analysis.cio_return_concerns SET subject_kind = 'vibes'`)
      .then(
        () => null,
        (thrown: unknown) => thrown,
      )
    expect(error).not.toBeNull()
  })

  it('P · the runtime cannot edit or delete a return or its concerns', async () => {
    const app = await db.connectAs(APP_ROLE)
    try {
      for (const statement of [
        `UPDATE analysis.cio_returns SET reason = 'edited'`,
        `DELETE FROM analysis.cio_returns`,
        `UPDATE analysis.cio_return_concerns SET detail = 'edited'`,
        `DELETE FROM analysis.cio_return_concerns`,
      ]) {
        const error = await app.query(statement).then(
          () => null,
          (thrown: unknown) => thrown,
        )
        expect(isPermissionDenied(error), statement).toBe(true)
      }
    } finally {
      await app.end()
    }
  })

  it('I · a caller cannot save a return with no concerns', async () => {
    await expect(
      repositories.submissions.recordReturn(cioReturn({ id: 'ret-2', concerns: [] })),
    ).rejects.toThrow(InvariantViolationError)
  })
})

/* ============================================================== decisions === */

describe('decisions — S: the schema refuses the state', () => {
  beforeEach(async () => {
    await repositories.submissions.save(cioSubmission())
    await repositories.submissions.save(
      cioSubmission({ id: 'sub-2', revisionId: 'rev-2', thesisId: 'thesis-2' }),
    )
  })

  const refused = async (sql: string, values: unknown[] = []) =>
    db.owner.query(sql, values).then(
      () => null,
      (error: unknown) => error,
    )

  it('refuses a deferral with no reconsideration trigger', async () => {
    await expect(
      repositories.decisions.save({
        ...deferredDecision(),
        reconsiderationTriggers: [],
      } as never),
    ).rejects.toThrow(InvariantViolationError)
  })

  it('refuses a declined outcome leaving a revision unaccounted for', async () => {
    await expect(
      repositories.decisions.save(
        selectedDecision({
          decisionId: 'dec-bad',
          outcome: {
            kind: 'declined',
            declinedRevisionIds: ['rev-1'],
            consideredRevisionIds: ['rev-1', 'rev-2'],
          },
        }),
      ),
    ).rejects.toThrow(InvariantViolationError)
  })

  it('refuses two selected relations for one decision', async () => {
    await repositories.decisions.save(selectedDecision())
    expect(
      await refused(
        `UPDATE analysis.decision_submissions SET relation = 'selected'
          WHERE decision_id = 'dec-1'`,
      ),
    ).not.toBeNull()
  })

  it('refuses a relation naming another case', async () => {
    await repositories.decisions.save(selectedDecision())
    expect(
      await refused(
        `UPDATE analysis.decision_submissions SET case_id = 'case-2'
          WHERE decision_id = 'dec-1'`,
      ),
    ).not.toBeNull()
  })

  it('refuses a relation naming another revision', async () => {
    await repositories.decisions.save(selectedDecision())
    expect(
      await refused(
        `UPDATE analysis.decision_submissions SET revision_id = 'rev-3'
          WHERE decision_id = 'dec-1' AND revision_id = 'rev-1'`,
      ),
    ).not.toBeNull()
  })

  it('refuses dissent materiality outside the vocabulary', async () => {
    await repositories.decisions.save(selectedDecision())
    expect(
      await refused(`UPDATE analysis.decision_dissent SET materiality = 'quite bad'`),
    ).not.toBeNull()
  })

  it('refuses dissent evidence citing a missing observation', async () => {
    await repositories.decisions.save(selectedDecision())
    expect(
      await refused(
        `UPDATE analysis.decision_dissent_evidence SET observation_id = 'obs-nowhere'`,
      ),
    ).not.toBeNull()
  })

  it('refuses a quantitative trigger with no unit', async () => {
    await repositories.decisions.save(selectedDecision())
    expect(
      await refused(
        `UPDATE analysis.decision_reconsideration_triggers SET threshold_unit = NULL
          WHERE condition_type = 'quantitative-threshold'`,
      ),
    ).not.toBeNull()
  })

  it('refuses a supersession link to another case', async () => {
    await repositories.decisions.save(selectedDecision())
    expect(
      await refused(
        `UPDATE analysis.case_decisions SET supersedes_decision_id = 'dec-elsewhere'
          WHERE decision_id = 'dec-1'`,
      ),
    ).not.toBeNull()
  })
})

describe('decisions — P: the runtime cannot reach the record', () => {
  beforeEach(async () => {
    await repositories.submissions.save(cioSubmission())
    await repositories.submissions.save(
      cioSubmission({ id: 'sub-2', revisionId: 'rev-2', thesisId: 'thesis-2' }),
    )
    await repositories.decisions.save(selectedDecision())
  })

  it('cannot rewrite or delete a decision, its relations, dissent or triggers', async () => {
    const app = await db.connectAs(APP_ROLE)
    try {
      for (const statement of [
        `UPDATE analysis.case_decisions SET rationale = 'edited'`,
        `DELETE FROM analysis.case_decisions`,
        `UPDATE analysis.decision_submissions SET relation = 'selected'`,
        `DELETE FROM analysis.decision_dissent`,
        `DELETE FROM analysis.decision_reconsideration_triggers`,
      ]) {
        const error = await app.query(statement).then(
          () => null,
          (thrown: unknown) => thrown,
        )
        expect(error, statement).not.toBeNull()
      }
    } finally {
      await app.end()
    }
  })
})

/* ------------------------------------ decisions needing triggers disabled --- */

describe('decisions — H: corruption that needs the guards disabled', () => {
  /**
   * `case_decisions` carries `case_decisions_immutable` from 0008 and the
   * deferred outcome guards from 0020. Corrupting a committed decision means
   * turning those off, so these cases run in a database that is **destroyed**
   * rather than truncated back into the shared pool.
   */
  let corrupt: TestDatabase
  let repos: PostgresRepositories

  beforeAll(async () => {
    corrupt = await createTestDatabase()
    await corrupt.migrate()
    const url = await corrupt.loginUrlFor(APP_ROLE)
    repos = await createPostgresRepositories({ connectionString: url })

    await seedDecisionGovernance(repos, {
      caseId: 'case-1',
      revisionIds: ['rev-1', 'rev-2'],
      fixtures: IN_MEMORY_SEED_FIXTURES,
    })
    await repos.submissions.save(cioSubmission())
    await repos.submissions.save(
      cioSubmission({ id: 'sub-2', revisionId: 'rev-2', thesisId: 'thesis-2' }),
    )
    await repos.decisions.save(selectedDecision())

    // Deliberately weakening the schema, in a database nothing else will use.
    await corrupt.owner.query(`ALTER TABLE analysis.case_decisions DISABLE TRIGGER USER`)
    await corrupt.owner.query(
      `ALTER TABLE analysis.decision_submissions DISABLE TRIGGER USER`,
    )
  }, 300_000)

  afterAll(async () => {
    await repos?.close().catch(() => {})
    await corrupt?.drop()
  })

  /** Puts the decision back the way it was, so each case stands alone. */
  const restore = async () => {
    await corrupt.owner.query(
      `UPDATE analysis.case_decisions SET outcome_kind = 'selected'
        WHERE decision_id = 'dec-1'`,
    )
    await corrupt.owner.query(
      `UPDATE analysis.decision_submissions SET relation = 'not-selected'
        WHERE decision_id = 'dec-1'`,
    )
    await corrupt.owner.query(
      `UPDATE analysis.decision_submissions SET relation = 'selected'
        WHERE decision_id = 'dec-1' AND revision_id = 'rev-1'`,
    )
  }

  beforeEach(restore)

  it('refuses a selected decision whose relations select nothing', async () => {
    await corrupt.owner.query(
      `UPDATE analysis.decision_submissions SET relation = 'not-selected'
        WHERE decision_id = 'dec-1'`,
    )
    const stored = await corrupt.owner.query(
      `SELECT count(*)::int AS n FROM analysis.decision_submissions
        WHERE decision_id = 'dec-1' AND relation = 'selected'`,
    )
    expect(stored.rows[0].n, 'the malformed state was not created').toBe(0)

    await expect(repos.decisions.get('dec-1')).rejects.toThrow(MalformedRowError)
  })

  it('refuses a selected decision whose column and relations disagree', async () => {
    await corrupt.owner.query(
      `UPDATE analysis.decision_submissions SET relation = 'not-selected'
        WHERE decision_id = 'dec-1' AND revision_id = 'rev-1'`,
    )
    await corrupt.owner.query(
      `UPDATE analysis.decision_submissions SET relation = 'selected'
        WHERE decision_id = 'dec-1' AND revision_id = 'rev-2'`,
    )
    await expect(repos.decisions.get('dec-1')).rejects.toThrow(MalformedRowError)
  })

  it('S · an unknown outcome kind cannot be written, even with triggers off', async () => {
    /*
     * Reclassified from H to S while writing this. `DISABLE TRIGGER` does not
     * disable CHECK constraints, and `case_decisions_outcome_known` refuses the
     * value outright -- so the mapper is never reached and cannot be said to
     * refuse it. `decisionFromRows` does refuse an unknown kind; that path is
     * covered as a unit, in `decisionMapping.test.ts`, where a row can be
     * fabricated without a database at all.
     */
    const error = await corrupt.owner
      .query(
        `UPDATE analysis.case_decisions SET outcome_kind = 'vetoed'
          WHERE decision_id = 'dec-1'`,
      )
      .then(
        () => null,
        (thrown: unknown) => thrown,
      )
    expect(error).not.toBeNull()
    expect(String((error as Error).message)).toContain('case_decisions_outcome_known')
  })

  it('S · a deferred decision cannot keep a selected revision', async () => {
    /*
     * Also reclassified. The shape CHECK ties `outcome_kind` to
     * `selected_revision_id`, so a selected decision cannot simply be relabelled
     * as deferred. The mapper adds no independent detection here -- it builds a
     * deferred outcome from the considered set and ignores relations, because a
     * deferral selects nothing by definition -- and claiming otherwise would
     * overstate what hydration checks.
     */
    const error = await corrupt.owner
      .query(
        `UPDATE analysis.case_decisions SET outcome_kind = 'deferred'
          WHERE decision_id = 'dec-1'`,
      )
      .then(
        () => null,
        (thrown: unknown) => thrown,
      )
    expect(error).not.toBeNull()
  })

  it('leaves the corrupt rows unchanged', async () => {
    await corrupt.owner.query(
      `UPDATE analysis.decision_submissions SET relation = 'not-selected'
        WHERE decision_id = 'dec-1'`,
    )
    await repos.decisions.get('dec-1').catch(() => {})

    // Refusing is not repairing.
    const rows = await corrupt.owner.query(
      `SELECT count(*)::int AS n FROM analysis.decision_submissions
        WHERE decision_id = 'dec-1' AND relation = 'selected'`,
    )
    expect(rows.rows[0].n).toBe(0)
  })
})
