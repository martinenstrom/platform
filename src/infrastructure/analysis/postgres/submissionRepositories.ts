/**
 * CIO submissions and returns, in PostgreSQL.
 *
 * Material entering CIO consideration, and material leaving it for more work.
 * One port because a return has no independent existence — it settles exactly
 * one submission — and every method is typed to one record family so sharing a
 * boundary never makes the two look interchangeable.
 *
 * ## Reference ownership is checked here, not only in the commands
 *
 * `analysis.reviews` is keyed on `id` alone. No foreign key from
 * `cio_submissions` can therefore prove that the verification it cites reviewed
 * *this* revision — the database would accept a sibling revision's verdict and
 * every constraint would be satisfied, leaving a record that says the firm
 * verified something it did not.
 *
 * A repository is an institutional integrity boundary, so the check happens
 * here as well as in the command: `validateSubmissionReferences` in the domain
 * states the rule, both adapters call it, and this file's job is only to
 * assemble the facts it needs. The assembly costs no extra statements — the
 * root read carries the referenced reviews and aggregation back through joins,
 * and the child reads carry their run and claim.
 *
 * ## Write-once, except for one field
 *
 * `state` is the only thing about a submission the institution changes. Every
 * other column is write-once by grant, and `recordReturn` writes the return, its
 * concerns and that one state change in a single transaction.
 */

import {
  subjectKey,
  validateCioReturn,
  validateCioSubmission,
  validateReturnReferences,
  validateSubmissionReferences,
  type CioReturn,
  type CioSubmission,
  type ReferencedGovernance,
  type ReferencedSubjects,
} from '~/domain/analysis'
import {
  ConflictingRecordError,
  InvariantViolationError,
  MalformedRowError,
  ReferentialIntegrityError,
  type SettledSubmissionState,
  type SubmissionRepository,
} from '~/application/analysis/repositories'
import {
  cioReturnSemanticKey,
  cioSubmissionSemanticKey,
} from '~/application/analysis/writeOnce'
import { seal } from '../seal'
import {
  returnFromRows,
  returnToRows,
  submissionFromRows,
  submissionToRows,
} from './decisionMapping'
import type {
  CioReturnConcernRow,
  CioReturnRow,
  CioSubmissionRow,
  SubmissionDisagreementRow,
  SubmissionEvidenceRow,
  SubmissionOpenChallengeRow,
  SubmissionRequiredWorkRow,
} from './rows'
import { catalog, run, ts, type Queryable, type SqlContext } from './sql'
import { unitOfWork, type Scope } from './transaction'

/* ------------------------------------------------------------------ reads */

const SUBMISSION_COLUMNS = `
  s.id, s.case_id, s.tenant_id, s.thesis_id, s.revision_id,
  s.submitted_by_department_id, s.submitted_by_employee_id,
  ${ts('s.submitted_at')}, s.case_version, s.state,
  s.eligibility_policy_version, s.aggregation_id,
  s.verification_review_id, s.verification_sequence, s.verification_status,
  s.devils_advocate_review_id, s.devils_advocate_sequence,
  s.risk_review_id, s.risk_sequence, s.risk_status,
  s.risk_requirement, s.risk_rule_id, s.risk_rule_version,
  s.storage_provenance_id, ${ts('s.evaluated_at')}
`

/**
 * The ownership facts, carried back by the same statement that reads the root.
 *
 * Joined rather than queried separately so the reference check costs nothing:
 * the budget is the same whether or not the adapter verifies what it read.
 */
const OWNERSHIP_COLUMNS = `
  v.case_id AS verification_case_id, v.revision_id AS verification_revision_id,
  v.kind AS verification_kind,
  d.case_id AS devils_case_id, d.revision_id AS devils_revision_id,
  d.kind AS devils_kind,
  r.case_id AS risk_case_id, r.revision_id AS risk_revision_id,
  r.kind AS risk_kind,
  a.case_id AS aggregation_case_id,
  a.produced_revision_id AS aggregation_revision_id
`

const OWNERSHIP_JOINS = `
  LEFT JOIN analysis.reviews v ON v.id = s.verification_review_id
  LEFT JOIN analysis.reviews d ON d.id = s.devils_advocate_review_id
  LEFT JOIN analysis.reviews r ON r.id = s.risk_review_id
  LEFT JOIN analysis.aggregations a ON a.id = s.aggregation_id
`

const SUBMISSION_ORDER = `ORDER BY s.submitted_at, s.id COLLATE "C"`

export const SUBMISSION_READ_SQL = catalog({
  byId: `SELECT ${SUBMISSION_COLUMNS}, ${OWNERSHIP_COLUMNS}
         FROM analysis.cio_submissions s ${OWNERSHIP_JOINS}
         WHERE s.id = $1`,

  forCase: `SELECT ${SUBMISSION_COLUMNS}, ${OWNERSHIP_COLUMNS}
            FROM analysis.cio_submissions s ${OWNERSHIP_JOINS}
            WHERE s.case_id = $1 ${SUBMISSION_ORDER}`,

  forRevision: `SELECT ${SUBMISSION_COLUMNS}, ${OWNERSHIP_COLUMNS}
                FROM analysis.cio_submissions s ${OWNERSHIP_JOINS}
                WHERE s.revision_id = $1 ${SUBMISSION_ORDER}`,

  pending: `SELECT ${SUBMISSION_COLUMNS}, ${OWNERSHIP_COLUMNS}
            FROM analysis.cio_submissions s ${OWNERSHIP_JOINS}
            WHERE s.state = 'pending' AND s.tenant_id = $1 ${SUBMISSION_ORDER}`,

  /* Each child read carries the owning case of what it references. */
  requiredWorkFor: `SELECT w.submission_id, w.playbook_entry_key, w.run_id,
                           n.case_id AS run_case_id
                    FROM analysis.submission_required_work w
                    LEFT JOIN analysis.runs n ON n.id = w.run_id
                    WHERE w.submission_id = ANY($1)
                    ORDER BY w.playbook_entry_key COLLATE "C"`,

  disagreementsFor: `SELECT g.submission_id, g.claim_id, g.materiality,
                            c.case_id AS claim_case_id
                     FROM analysis.submission_disagreements g
                     LEFT JOIN analysis.claims c ON c.id = g.claim_id
                     WHERE g.submission_id = ANY($1)
                     ORDER BY g.claim_id COLLATE "C"`,

  evidenceFor: `SELECT submission_id, evidence_set_id
                FROM analysis.submission_evidence
                WHERE submission_id = ANY($1)
                ORDER BY evidence_set_id COLLATE "C"`,

  openChallengesFor: `SELECT submission_id, challenge_id
                      FROM analysis.submission_open_challenges
                      WHERE submission_id = ANY($1)
                      ORDER BY challenge_id COLLATE "C"`,

  /**
   * Ownership of everything a submission is about to cite, in one statement.
   *
   * Read BEFORE the insert, because the in-memory reference refuses a
   * cross-revision reference without writing anything and the two stores must
   * refuse it the same way, at the same call boundary, with the same error. A
   * union rather than four queries: the check costs one round trip, not four.
   */
  ownership: `
      SELECT 'review' AS artifact, id, case_id, revision_id, kind AS review_kind
      FROM analysis.reviews WHERE id = ANY($1)
    UNION ALL
      SELECT 'aggregation', id, case_id, produced_revision_id, ''
      FROM analysis.aggregations WHERE id = ANY($2)
    UNION ALL
      SELECT 'run', id, case_id, NULL, ''
      FROM analysis.runs WHERE id = ANY($3)
    UNION ALL
      SELECT 'claim', id, case_id, NULL, ''
      FROM analysis.claims WHERE id = ANY($4)
    UNION ALL
      SELECT 'challenge', id, review_id, NULL, ''
      FROM analysis.challenges WHERE review_id = ANY($1)`,

  /** The challenges each cited Devil's Advocate review actually raised. */
  challengesOfReviews: `SELECT review_id, id
                        FROM analysis.challenges
                        WHERE review_id = ANY($1)
                        ORDER BY id COLLATE "C"`,
})

/* ----------------------------------------------------------------- writes */

export const SUBMISSION_WRITE_SQL = catalog({
  insertSubmission: `
    INSERT INTO analysis.cio_submissions
      (id, case_id, tenant_id, thesis_id, revision_id,
       submitted_by_department_id, submitted_by_employee_id, submitted_at,
       case_version, state, eligibility_policy_version, aggregation_id,
       verification_review_id, verification_sequence, verification_status,
       devils_advocate_review_id, devils_advocate_sequence,
       risk_review_id, risk_sequence, risk_status,
       risk_requirement, risk_rule_id, risk_rule_version,
       storage_provenance_id, evaluated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
            $19,$20,$21,$22,$23,$24,$25)`,

  /* One statement per child TABLE, never one per row. */
  insertRequiredWork: `
    INSERT INTO analysis.submission_required_work
      (submission_id, playbook_entry_key, run_id)
    SELECT $1, * FROM unnest($2::text[], $3::text[])`,

  insertDisagreements: `
    INSERT INTO analysis.submission_disagreements
      (submission_id, claim_id, materiality)
    SELECT $1, * FROM unnest($2::text[], $3::text[])`,

  insertEvidence: `
    INSERT INTO analysis.submission_evidence (submission_id, evidence_set_id)
    SELECT $1, * FROM unnest($2::text[])`,

  insertOpenChallenges: `
    INSERT INTO analysis.submission_open_challenges (submission_id, challenge_id)
    SELECT $1, * FROM unnest($2::text[])`,

  /** Current states, so settle can tell missing from replayed from conflicting. */
  statesOf: `SELECT id, state FROM analysis.cio_submissions WHERE id = ANY($1)`,

  /*
   * Conditional on `pending`, which is what makes two incompatible settlements
   * unable to both succeed: the loser updates zero rows rather than overwriting
   * the winner's outcome.
   */
  settle: `UPDATE analysis.cio_submissions SET state = $2
           WHERE id = ANY($1) AND state = 'pending'
           RETURNING id`,
})

export const RETURN_READ_SQL = catalog({
  byId: `SELECT id, submission_id, case_id, tenant_id, revision_id,
                ${ts('returned_at')}, returned_by_employee_id, returned_by_role_id,
                returned_by_role_function, returned_by_department_id,
                returned_by_department_is_governance,
                returned_by_department_handles, organization_seed_version,
                authentication, authorization_basis, returned_for, reason,
                case_version
         FROM analysis.cio_returns WHERE id = $1`,

  forCase: `SELECT id, submission_id, case_id, tenant_id, revision_id,
                   ${ts('returned_at')}, returned_by_employee_id, returned_by_role_id,
                   returned_by_role_function, returned_by_department_id,
                   returned_by_department_is_governance,
                   returned_by_department_handles, organization_seed_version,
                   authentication, authorization_basis, returned_for, reason,
                   case_version
            FROM analysis.cio_returns WHERE case_id = $1
            ORDER BY returned_at, id COLLATE "C"`,

  forRevision: `SELECT id, submission_id, case_id, tenant_id, revision_id,
                       ${ts('returned_at')}, returned_by_employee_id, returned_by_role_id,
                       returned_by_role_function, returned_by_department_id,
                       returned_by_department_is_governance,
                       returned_by_department_handles, organization_seed_version,
                       authentication, authorization_basis, returned_for, reason,
                       case_version
                FROM analysis.cio_returns WHERE revision_id = $1
                ORDER BY returned_at, id COLLATE "C"`,

  concernsFor: `SELECT return_id, ordinal, concern_kind, subject_kind,
                       subject_id, detail
                FROM analysis.cio_return_concerns
                WHERE return_id = ANY($1)
                ORDER BY return_id COLLATE "C", ordinal`,

  /**
   * Who owns each thing a concern points at, in one statement.
   *
   * A union rather than a query per subject kind: a concern already says which
   * kind it means, and the ownership question -- this case, and this revision
   * where the subject is scoped to one -- is identical for all of them.
   *
   * `evidence` is absent deliberately. Evidence sets are content-addressed and
   * belong to no case, so there is nothing to own.
   */
  subjectOwnership: `
      SELECT 'review' AS kind, id, case_id, revision_id
      FROM analysis.reviews WHERE id = ANY($1)
    UNION ALL
      SELECT 'finding', id, case_id, revision_id
      FROM analysis.reviews WHERE id = ANY($1)
    UNION ALL
      SELECT 'challenge', c.id, r.case_id, r.revision_id
      FROM analysis.challenges c
      JOIN analysis.reviews r ON r.id = c.review_id
      WHERE c.id = ANY($1)
    UNION ALL
      SELECT 'claim', id, case_id, NULL FROM analysis.claims WHERE id = ANY($1)
    UNION ALL
      SELECT 'revision', revision_id, case_id, revision_id
      FROM analysis.thesis_revisions WHERE revision_id = ANY($1)
    UNION ALL
      SELECT 'aggregation', id, case_id, produced_revision_id
      FROM analysis.aggregations WHERE id = ANY($1)`,
})

export const RETURN_WRITE_SQL = catalog({
  insertReturn: `
    INSERT INTO analysis.cio_returns
      (id, submission_id, case_id, tenant_id, revision_id, returned_at,
       returned_by_employee_id, returned_by_role_id, returned_by_role_function,
       returned_by_department_id, returned_by_department_is_governance,
       returned_by_department_handles, organization_seed_version,
       authentication, authorization_basis, returned_for, reason, case_version)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,

  insertConcerns: `
    INSERT INTO analysis.cio_return_concerns
      (return_id, ordinal, concern_kind, subject_kind, subject_id, detail)
    SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[])`,
})

/* ---------------------------------------------------------------- helpers */

type SubmissionRootRow = CioSubmissionRow & Record<string, unknown>
type WorkRow = SubmissionRequiredWorkRow & { run_case_id: string | null }
type DisagreementRow = SubmissionDisagreementRow & { claim_case_id: string | null }

const group = <T extends { submission_id: string }>(rows: readonly T[]) => {
  const byId = new Map<string, T[]>()
  for (const row of rows) {
    const list = byId.get(row.submission_id) ?? []
    list.push(row)
    byId.set(row.submission_id, list)
  }
  return byId
}

/**
 * The facts the shared validator needs, from what the reads already returned.
 *
 * Nothing here decides anything: it copies the joined columns into the shape the
 * domain rule consumes. A `null` case id means the join found no row, which the
 * rule reports as a missing reference.
 */
function governanceFrom(
  roots: readonly SubmissionRootRow[],
  work: readonly WorkRow[],
  disagreements: readonly DisagreementRow[],
  challengesByReview: ReadonlyMap<string, string[]>,
): ReferencedGovernance {
  const reviews = new Map<
    string,
    { caseId: string; revisionId: string | null; kind: string; challengeIds: readonly string[] }
  >()

  for (const root of roots) {
    const add = (id: string | null, prefix: string) => {
      if (id === null) return
      const caseId = root[`${prefix}_case_id`] as string | null
      if (caseId === null || caseId === undefined) return
      reviews.set(id, {
        caseId,
        revisionId: (root[`${prefix}_revision_id`] as string | null) ?? null,
        kind: (root[`${prefix}_kind`] as string | null) ?? '',
        challengeIds: challengesByReview.get(id) ?? [],
      })
    }
    add(root.verification_review_id, 'verification')
    add(root.devils_advocate_review_id, 'devils')
    add(root.risk_review_id, 'risk')
  }

  const aggregations = new Map<string, { caseId: string; producedRevisionId: string }>()
  for (const root of roots) {
    const id = root.aggregation_id
    const caseId = root['aggregation_case_id'] as string | null
    const revisionId = root['aggregation_revision_id'] as string | null
    if (id !== null && caseId !== null && revisionId !== null) {
      aggregations.set(id, { caseId, producedRevisionId: revisionId })
    }
  }

  return {
    reviews,
    aggregations,
    runs: new Map(
      work
        .filter((row) => row.run_case_id !== null)
        .map((row) => [row.run_id, { caseId: row.run_case_id! }]),
    ),
    claims: new Map(
      disagreements
        .filter((row) => row.claim_case_id !== null)
        .map((row) => [row.claim_id, { caseId: row.claim_case_id! }]),
    ),
  }
}

export function createSubmissionRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): SubmissionRepository {
  /**
   * Roots plus their children plus the ownership facts, in five statements.
   *
   * Constant regardless of how many submissions or child rows come back: every
   * child table is read once with `= ANY($1)` and grouped in memory.
   */
  async function hydrate(
    client: Queryable,
    operation: string,
    roots: readonly SubmissionRootRow[],
  ): Promise<CioSubmission[]> {
    if (roots.length === 0) return []
    const ids = roots.map((root) => root.id)

    const [work, disagreements, evidence, challenges] = [
      await run<WorkRow>(client, context, operation, SUBMISSION_READ_SQL.requiredWorkFor, [ids]),
      await run<DisagreementRow>(
        client,
        context,
        operation,
        SUBMISSION_READ_SQL.disagreementsFor,
        [ids],
      ),
      await run<SubmissionEvidenceRow>(
        client,
        context,
        operation,
        SUBMISSION_READ_SQL.evidenceFor,
        [ids],
      ),
      await run<SubmissionOpenChallengeRow>(
        client,
        context,
        operation,
        SUBMISSION_READ_SQL.openChallengesFor,
        [ids],
      ),
    ]

    /*
     * Which challenges each cited review actually raised. One statement, and
     * only when a review was cited at all — a submission with no Devil's
     * Advocate review has nothing to verify.
     */
    const reviewIds = roots
      .map((root) => root.devils_advocate_review_id)
      .filter((id): id is string => id !== null)
    const challengesByReview = new Map<string, string[]>()
    if (reviewIds.length > 0) {
      const rows = await run<{ review_id: string; id: string }>(
        client,
        context,
        operation,
        SUBMISSION_READ_SQL.challengesOfReviews,
        [reviewIds],
      )
      for (const row of rows) {
        const list = challengesByReview.get(row.review_id) ?? []
        list.push(row.id)
        challengesByReview.set(row.review_id, list)
      }
    }

    const governance = governanceFrom(roots, work, disagreements, challengesByReview)
    const workById = group(work)
    const disagreementsById = group(disagreements)
    const evidenceById = group(evidence)
    const challengesById = group(challenges)

    return roots.map((root) => {
      const submission = submissionFromRows(
        {
          submission: root,
          requiredWork: workById.get(root.id) ?? [],
          disagreements: disagreementsById.get(root.id) ?? [],
          evidence: evidenceById.get(root.id) ?? [],
          openChallenges: challengesById.get(root.id) ?? [],
        },
        operation,
      )

      /*
       * Re-checked on the way out. A reference that was valid when written can
       * stop being valid, and reading it back as a valid submission would
       * launder that into the record.
       */
      const problems = validateSubmissionReferences(submission, governance)
      if (problems.length > 0) {
        throw new MalformedRowError('CIO submission', problems[0]!.code, operation)
      }
      return seal(submission, `CIO submission ${submission.id}`)
    })
  }

  const readRoots = (client: Queryable, operation: string, sql: string, values: unknown[]) =>
    run<SubmissionRootRow>(client, context, operation, sql, values)

  /**
   * The ownership facts a set of concerns needs, in one statement.
   *
   * Every subject id is passed to every arm of the union; the arms disagree
   * about which table to look in, and only the rows that exist come back. One
   * round trip whatever mix of kinds the concerns use.
   */
  async function subjectsFor(
    client: Queryable,
    operation: string,
    concerns: readonly CioReturnConcernRow[],
  ): Promise<ReferencedSubjects> {
    const ids = [...new Set(concerns.map((concern) => concern.subject_id))]
    const byKindAndId = new Map<string, { caseId: string; revisionId: string | null }>()
    if (ids.length === 0) return { byKindAndId }

    const rows = await run<{
      kind: string
      id: string
      case_id: string
      revision_id: string | null
    }>(client, context, operation, RETURN_READ_SQL.subjectOwnership, [ids])

    for (const row of rows) {
      byKindAndId.set(subjectKey(row.kind, row.id), {
        caseId: row.case_id,
        revisionId: row.revision_id,
      })
    }
    return { byKindAndId }
  }

  async function hydrateReturns(
    client: Queryable,
    operation: string,
    roots: readonly CioReturnRow[],
  ): Promise<CioReturn[]> {
    if (roots.length === 0) return []
    const concerns = await run<CioReturnConcernRow>(
      client,
      context,
      operation,
      RETURN_READ_SQL.concernsFor,
      [roots.map((root) => root.id)],
    )
    const byReturn = new Map<string, CioReturnConcernRow[]>()
    for (const row of concerns) {
      const list = byReturn.get(row.return_id) ?? []
      list.push(row)
      byReturn.set(row.return_id, list)
    }
    const subjects = await subjectsFor(client, operation, concerns)

    return roots.map((root) => {
      const mapped = returnFromRows(
        { cioReturn: root, concerns: byReturn.get(root.id) ?? [] },
        operation,
      )

      /*
       * Re-checked on the way out, like a submission. A concern citing another
       * case was refused when written; reading it back as a valid return would
       * launder a later corruption into the record.
       */
      const problems = [
        ...validateCioReturn(mapped),
        ...validateReturnReferences(mapped, subjects),
      ]
      if (problems.length > 0) {
        throw new MalformedRowError('CIO return', problems[0]!.code, operation)
      }
      return seal(mapped, `CIO return ${root.id}`)
    })
  }

  return {
    get: (submissionId) =>
      unitOfWork(scope, 'submissions.get', async (client) => {
        const roots = await readRoots(client, 'submissions.get', SUBMISSION_READ_SQL.byId, [
          submissionId,
        ])
        return (await hydrate(client, 'submissions.get', roots))[0] ?? null
      }),

    listForCase: (caseId) =>
      unitOfWork(scope, 'submissions.listForCase', async (client) =>
        hydrate(
          client,
          'submissions.listForCase',
          await readRoots(client, 'submissions.listForCase', SUBMISSION_READ_SQL.forCase, [
            caseId,
          ]),
        ),
      ),

    applicableForRevision: (revisionId) =>
      unitOfWork(scope, 'submissions.applicableForRevision', async (client) =>
        hydrate(
          client,
          'submissions.applicableForRevision',
          await readRoots(
            client,
            'submissions.applicableForRevision',
            SUBMISSION_READ_SQL.forRevision,
            [revisionId],
          ),
        ),
      ),

    pending: (limit) =>
      unitOfWork(scope, 'submissions.pending', async (client) => {
        const queue = await hydrate(
          client,
          'submissions.pending',
          await readRoots(client, 'submissions.pending', SUBMISSION_READ_SQL.pending, [
            tenantId,
          ]),
        )
        return limit === undefined ? queue : queue.slice(0, limit)
      }),

    save: (submission) =>
      unitOfWork(scope, 'submissions.save', async (client) => {
        /*
         * Everything checkable from the record alone, before any statement is
         * issued. A blocked submission never reaches the database.
         */
        const problems = validateCioSubmission(submission)
        if (problems.length > 0) {
          throw new InvariantViolationError(problems[0]!.code, 'submissions.save')
        }

        const existing = (
          await hydrate(
            client,
            'submissions.save',
            await readRoots(client, 'submissions.save', SUBMISSION_READ_SQL.byId, [
              submission.id,
            ]),
          )
        )[0]
        if (existing) {
          if (cioSubmissionSemanticKey(existing) !== cioSubmissionSemanticKey(submission)) {
            throw new ConflictingRecordError(
              'CIO submission',
              submission.id,
              'submissions.save',
            )
          }
          return existing
        }

        /*
         * Ownership before the write. The in-memory reference refuses a
         * cross-revision reference having written nothing, so this one must
         * too — otherwise the same mistake is an InvariantViolationError in one
         * store and a MalformedRowError from a later read in the other.
         */
        const basis = submission.basis
        const reviewIds = [
          basis.verification?.reviewId,
          basis.devilsAdvocate?.reviewId,
          basis.risk?.reviewId,
        ].filter((id): id is string => id !== undefined)

        const ownership = await run<{
          artifact: string
          id: string
          case_id: string
          revision_id: string | null
          review_kind: string
        }>(client, context, 'submissions.save', SUBMISSION_READ_SQL.ownership, [
          reviewIds,
          basis.aggregationId === null ? [] : [basis.aggregationId],
          basis.requiredWork.map((entry) => entry.runId),
          basis.materialDisagreements.map((entry) => entry.claimId),
        ])

        const challengesByReview = new Map<string, string[]>()
        for (const row of ownership) {
          if (row.artifact !== 'challenge') continue
          // `case_id` carries the owning review for a challenge row.
          const list = challengesByReview.get(row.case_id) ?? []
          list.push(row.id)
          challengesByReview.set(row.case_id, list)
        }

        const governance: ReferencedGovernance = {
          reviews: new Map(
            ownership
              .filter((row) => row.artifact === 'review')
              .map((row) => [
                row.id,
                {
                  caseId: row.case_id,
                  revisionId: row.revision_id,
                  kind: row.review_kind,
                  challengeIds: challengesByReview.get(row.id) ?? [],
                },
              ]),
          ),
          aggregations: new Map(
            ownership
              .filter((row) => row.artifact === 'aggregation')
              .map((row) => [
                row.id,
                { caseId: row.case_id, producedRevisionId: row.revision_id ?? '' },
              ]),
          ),
          runs: new Map(
            ownership
              .filter((row) => row.artifact === 'run')
              .map((row) => [row.id, { caseId: row.case_id }]),
          ),
          claims: new Map(
            ownership
              .filter((row) => row.artifact === 'claim')
              .map((row) => [row.id, { caseId: row.case_id }]),
          ),
        }

        const referenceProblems = validateSubmissionReferences(submission, governance)
        if (referenceProblems.length > 0) {
          throw new InvariantViolationError(referenceProblems[0]!.code, 'submissions.save')
        }

        const rows = submissionToRows(submission)
        const root = rows.submission
        await run(client, context, 'submissions.save', SUBMISSION_WRITE_SQL.insertSubmission, [
          root.id,
          root.case_id,
          tenantId,
          root.thesis_id,
          root.revision_id,
          root.submitted_by_department_id,
          root.submitted_by_employee_id,
          root.submitted_at,
          root.case_version,
          root.state,
          root.eligibility_policy_version,
          root.aggregation_id,
          root.verification_review_id,
          root.verification_sequence,
          root.verification_status,
          root.devils_advocate_review_id,
          root.devils_advocate_sequence,
          root.risk_review_id,
          root.risk_sequence,
          root.risk_status,
          root.risk_requirement,
          root.risk_rule_id,
          root.risk_rule_version,
          root.storage_provenance_id,
          root.evaluated_at,
        ])

        await run(client, context, 'submissions.save', SUBMISSION_WRITE_SQL.insertRequiredWork, [
          root.id,
          rows.requiredWork.map((entry) => entry.playbook_entry_key),
          rows.requiredWork.map((entry) => entry.run_id),
        ])
        await run(
          client,
          context,
          'submissions.save',
          SUBMISSION_WRITE_SQL.insertDisagreements,
          [
            root.id,
            rows.disagreements.map((entry) => entry.claim_id),
            rows.disagreements.map((entry) => entry.materiality),
          ],
        )
        await run(client, context, 'submissions.save', SUBMISSION_WRITE_SQL.insertEvidence, [
          root.id,
          rows.evidence.map((entry) => entry.evidence_set_id),
        ])
        await run(
          client,
          context,
          'submissions.save',
          SUBMISSION_WRITE_SQL.insertOpenChallenges,
          [root.id, rows.openChallenges.map((entry) => entry.challenge_id)],
        )

        /*
         * The argument, sealed — not a read-back.
         *
         * A second full hydration here would cost six statements to re-derive
         * something already known: the references were checked before the
         * insert, and whether the stored rows read back identically is what
         * `get` is tested for. The in-memory reference returns the same thing
         * for the same reason.
         */
        return seal(submission, `CIO submission ${submission.id}`)
      }),

    settle: (submissionIds, state) =>
      unitOfWork(scope, 'submissions.settle', async (client) => {
        if (submissionIds.length === 0) return

        const current = await run<{ id: string; state: string }>(
          client,
          context,
          'submissions.settle',
          SUBMISSION_WRITE_SQL.statesOf,
          [submissionIds],
        )
        const byId = new Map(current.map((row) => [row.id, row.state]))

        for (const submissionId of submissionIds) {
          const found = byId.get(submissionId)
          if (found === undefined) {
            throw new ReferentialIntegrityError(
              'cio_submissions_exists',
              'submissions.settle',
            )
          }
          /*
           * `decided` and `returned` describe different institutional
           * histories, so moving between them would rewrite what happened to
           * the queue item. Settling to the state it already holds is a replay.
           */
          if (found !== 'pending' && found !== state) {
            throw new InvariantViolationError(
              'submission-already-settled',
              'submissions.settle',
            )
          }
        }

        await run(client, context, 'submissions.settle', SUBMISSION_WRITE_SQL.settle, [
          submissionIds,
          state satisfies SettledSubmissionState,
        ])
      }),

    recordReturn: (cioReturn) =>
      unitOfWork(scope, 'returns.recordReturn', async (client) => {
        const problems = validateCioReturn(cioReturn)
        if (problems.length > 0) {
          throw new InvariantViolationError(problems[0]!.code, 'returns.recordReturn')
        }

        /*
         * Ownership before the write, so a cross-case concern is refused with
         * the same class and from the same call as the in-memory reference's.
         */
        const rowsForSubjects = returnToRows(cioReturn).concerns
        const referenceProblems = validateReturnReferences(
          cioReturn,
          await subjectsFor(client, 'returns.recordReturn', rowsForSubjects),
        )
        if (referenceProblems.length > 0) {
          throw new InvariantViolationError(
            referenceProblems[0]!.code,
            'returns.recordReturn',
          )
        }

        const existing = (
          await hydrateReturns(
            client,
            'returns.recordReturn',
            await run<CioReturnRow>(
              client,
              context,
              'returns.recordReturn',
              RETURN_READ_SQL.byId,
              [cioReturn.id],
            ),
          )
        )[0]
        if (existing) {
          if (cioReturnSemanticKey(existing) !== cioReturnSemanticKey(cioReturn)) {
            throw new ConflictingRecordError(
              'CIO return',
              cioReturn.id,
              'returns.recordReturn',
            )
          }
          return existing
        }

        const rows = returnToRows(cioReturn)
        const root = rows.cioReturn
        await run(client, context, 'returns.recordReturn', RETURN_WRITE_SQL.insertReturn, [
          root.id,
          root.submission_id,
          root.case_id,
          tenantId,
          root.revision_id,
          root.returned_at,
          root.returned_by_employee_id,
          root.returned_by_role_id,
          root.returned_by_role_function,
          root.returned_by_department_id,
          root.returned_by_department_is_governance,
          root.returned_by_department_handles,
          root.organization_seed_version,
          root.authentication,
          root.authorization_basis,
          root.returned_for,
          root.reason,
          root.case_version,
        ])
        await run(client, context, 'returns.recordReturn', RETURN_WRITE_SQL.insertConcerns, [
          root.id,
          rows.concerns.map((concern) => concern.ordinal),
          rows.concerns.map((concern) => concern.concern_kind),
          rows.concerns.map((concern) => concern.subject_kind),
          rows.concerns.map((concern) => concern.subject_id),
          rows.concerns.map((concern) => concern.detail),
        ])

        // The submission leaves the queue in the same transaction.
        await run(client, context, 'returns.recordReturn', SUBMISSION_WRITE_SQL.settle, [
          [cioReturn.submissionId],
          'returned',
        ])

        return seal(cioReturn, `CIO return ${cioReturn.id}`)
      }),

    getReturn: (returnId) =>
      unitOfWork(scope, 'returns.getReturn', async (client) => {
        const roots = await run<CioReturnRow>(
          client,
          context,
          'returns.getReturn',
          RETURN_READ_SQL.byId,
          [returnId],
        )
        return (await hydrateReturns(client, 'returns.getReturn', roots))[0] ?? null
      }),

    returnsForCase: (caseId) =>
      unitOfWork(scope, 'returns.returnsForCase', async (client) =>
        hydrateReturns(
          client,
          'returns.returnsForCase',
          await run<CioReturnRow>(
            client,
            context,
            'returns.returnsForCase',
            RETURN_READ_SQL.forCase,
            [caseId],
          ),
        ),
      ),

    returnsForRevision: (revisionId) =>
      unitOfWork(scope, 'returns.returnsForRevision', async (client) =>
        hydrateReturns(
          client,
          'returns.returnsForRevision',
          await run<CioReturnRow>(
            client,
            context,
            'returns.returnsForRevision',
            RETURN_READ_SQL.forRevision,
            [revisionId],
          ),
        ),
      ),
  }
}
