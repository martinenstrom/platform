/**
 * Completed institutional CIO outcomes, in PostgreSQL.
 *
 * ## Two integrity levels, and they are not the same
 *
 * `decision_submissions` carries two composite foreign keys — `(submission_id,
 * case_id)` and `(submission_id, revision_id)` — so "this submission belongs to
 * this case" and "it targets exactly the revision this relation names" are
 * **enforced by the database**. That is unlike the submission side, where
 * `reviews` is keyed on `id` alone and the repository is the only enforcement
 * (R6).
 *
 * The pre-check below is therefore about **parity, not integrity**: a raw
 * foreign-key violation arrives as `ReferentialIntegrityError`, and the
 * in-memory reference raises `InvariantViolationError` for a cross-case
 * submission. Same rejection, different class, and the shared contract asserts
 * the class. The database remains the final independent backstop.
 *
 * ## What is deliberately not here
 *
 * **No eligibility basis.** The policy version, the review references and the
 * required work live on the submissions this decision references, and a decision
 * considering three revisions may reference three submissions evaluated under
 * three different policy versions. Copying any of it here would answer the audit
 * question worse than the join does.
 *
 * ## Supersession is one act
 *
 * There is no `supersede()` a caller could invoke without inserting the
 * successor -- that would be a way to leave a case with no live decision. The
 * predecessor's link is updated inside `save`, BEFORE the successor row exists,
 * which only works because both supersession foreign keys are `DEFERRABLE
 * INITIALLY DEFERRED`: the predecessor leaves the one-live partial index before
 * the successor enters it, so no instant has two live decisions.
 */

import { validateCaseDecision, type CaseDecision } from '~/domain/analysis'
import {
  ConcurrencyConflictError,
  ConflictingRecordError,
  InvariantViolationError,
  MalformedRowError,
  ReferentialIntegrityError,
  type DecisionRepository,
} from '~/application/analysis/repositories'
import { decisionSemanticKey } from '~/application/analysis/writeOnce'
import { seal } from '../seal'
import { decisionFromRows, decisionToRows } from './decisionMapping'
import type {
  CaseDecisionRow,
  DecisionDissentEvidenceRow,
  DecisionDissentRow,
  DecisionSubmissionRow,
  DecisionTriggerRow,
} from './rows'
import { CONSTRAINT_SQL } from './deferredConstraints'
import { catalog, run, ts, type Queryable, type SqlContext } from './sql'
import { unitOfWork, type Scope } from './transaction'

const DECISION_COLUMNS = `
  decision_id, case_id, tenant_id, aggregate_version, ${ts('decided_at')},
  decided_by_employee_id, outcome_kind, selected_revision_id,
  supersedes_decision_id, superseded_by_decision_id, evidence_set_id, rationale,
  decided_by_role_id, decided_by_role_function, decided_by_department_id,
  decided_by_department_is_governance, decided_by_department_handles,
  organization_seed_version, authentication, authorization_basis
`

export const DECISION_READ_SQL = catalog({
  byId: `SELECT ${DECISION_COLUMNS} FROM analysis.case_decisions
         WHERE decision_id = $1`,

  /**
   * The live decision — and enough to tell whether there is exactly one.
   *
   * `LIMIT 2` is the whole design. A case is supposed to hold at most one
   * unsuperseded decision, and `case_decisions_one_live_per_case` normally
   * makes anything else unreachable. But a read that took the first row would
   * answer "this is what the firm currently holds" from an ambiguous state, and
   * the caller would have no way to know it was a choice. Two rows is not a
   * decision the repository is entitled to make.
   *
   * Reading two rather than counting keeps this one statement, and the
   * aggregate is hydrated only once the cardinality is known.
   */
  liveForCase: `SELECT ${DECISION_COLUMNS} FROM analysis.case_decisions
                WHERE case_id = $1 AND superseded_by_decision_id IS NULL
                LIMIT 2`,

  /*
   * Everything, superseded included, oldest first. The supersession links are
   * projected with it so a history consumer reconstructs the chain without a
   * second query.
   */
  historyForCase: `SELECT ${DECISION_COLUMNS} FROM analysis.case_decisions
                   WHERE case_id = $1
                   ORDER BY decided_at, decision_id COLLATE "C"`,

  /*
   * Live only. The floor shows current positions, not a changelog: returning an
   * original beside its correction would present two simultaneous decisions on
   * one case.
   */
  recent: `SELECT ${DECISION_COLUMNS} FROM analysis.case_decisions
           WHERE tenant_id = $1 AND superseded_by_decision_id IS NULL
           ORDER BY decided_at DESC, decision_id COLLATE "C" DESC
           LIMIT $2`,
})

export const DECISION_HYDRATE_SQL = catalog({
  relationsFor: `SELECT decision_id, submission_id, case_id, revision_id, relation
                 FROM analysis.decision_submissions
                 WHERE decision_id = ANY($1)
                 ORDER BY decision_id COLLATE "C", revision_id COLLATE "C"`,

  dissentFor: `SELECT decision_id, ordinal, source, source_id, revision_id,
                      claim_id, materiality, raised_by_employee_id,
                      raised_by_department_id, rationale, why_not_blocking,
                      acknowledgement, disposition
               FROM analysis.decision_dissent
               WHERE decision_id = ANY($1)
               ORDER BY decision_id COLLATE "C", ordinal`,

  dissentEvidenceFor: `SELECT decision_id, ordinal, evidence_set_id,
                              observation_id, content_hash
                       FROM analysis.decision_dissent_evidence
                       WHERE decision_id = ANY($1)
                       ORDER BY decision_id COLLATE "C", ordinal,
                                evidence_set_id COLLATE "C",
                                observation_id COLLATE "C"`,

  triggersFor: `SELECT id, decision_id, ordinal, condition_type, subject_kind,
                       subject_ref, comparator, threshold_amount, threshold_unit,
                       threshold_currency, qualitative_condition, expected_source,
                       rationale, created_by_employee_id, ${ts('created_at')},
                       policy_version
                FROM analysis.decision_reconsideration_triggers
                WHERE decision_id = ANY($1)
                ORDER BY decision_id COLLATE "C", ordinal`,
})

export const DECISION_WRITE_SQL = catalog({
  insertDecision: `
    INSERT INTO analysis.case_decisions
      (decision_id, case_id, tenant_id, aggregate_version, decided_at,
       decided_by_employee_id, outcome_kind, selected_revision_id,
       supersedes_decision_id, evidence_set_id, rationale,
       decided_by_role_id, decided_by_role_function, decided_by_department_id,
       decided_by_department_is_governance, decided_by_department_handles,
       organization_seed_version, authentication, authorization_basis)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,

  /* One statement per child TABLE. Never one per row. */
  insertRelations: `
    INSERT INTO analysis.decision_submissions
      (decision_id, submission_id, case_id, revision_id, relation)
    SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[])`,

  insertDissent: `
    INSERT INTO analysis.decision_dissent
      (decision_id, ordinal, source, source_id, revision_id, claim_id,
       materiality, raised_by_employee_id, raised_by_department_id, rationale,
       why_not_blocking, acknowledgement, disposition)
    SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[], $5::text[],
                             $6::text[], $7::text[], $8::text[], $9::text[],
                             $10::text[], $11::text[], $12::text[], $13::text[])`,

  insertDissentEvidence: `
    INSERT INTO analysis.decision_dissent_evidence
      (decision_id, ordinal, evidence_set_id, observation_id, content_hash)
    SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[], $5::text[])`,

  insertTriggers: `
    INSERT INTO analysis.decision_reconsideration_triggers
      (id, decision_id, ordinal, condition_type, subject_kind, subject_ref,
       comparator, threshold_amount, threshold_unit, threshold_currency,
       qualitative_condition, expected_source, rationale,
       created_by_employee_id, created_at, policy_version)
    SELECT t.id, $1, t.ordinal, t.condition_type, t.subject_kind, t.subject_ref,
           t.comparator, t.threshold_amount, t.threshold_unit,
           t.threshold_currency, t.qualitative_condition, t.expected_source,
           t.rationale, t.created_by_employee_id, t.created_at, t.policy_version
    FROM unnest($2::text[], $3::int[], $4::text[], $5::text[], $6::text[],
                $7::text[], $8::text[], $9::text[], $10::text[], $11::text[],
                $12::text[], $13::text[], $14::text[], $15::timestamptz[],
                $16::text[])
      AS t(id, ordinal, condition_type, subject_kind, subject_ref, comparator,
           threshold_amount, threshold_unit, threshold_currency,
           qualitative_condition, expected_source, rationale,
           created_by_employee_id, created_at, policy_version)`,

  /** Structural facts about every submission the decision references. */
  submissionsById: `SELECT id, case_id, revision_id, state
                    FROM analysis.cio_submissions WHERE id = ANY($1)`,
})

export const SUPERSESSION_SQL = catalog({
  /** The predecessor, and whether anything has already superseded it. */
  predecessorFor: `SELECT decision_id, case_id, superseded_by_decision_id
                   FROM analysis.case_decisions WHERE decision_id = $1`,

  /** Which submissions the predecessor referenced, for a reuse claim. */
  predecessorSubmissions: `SELECT submission_id FROM analysis.decision_submissions
                           WHERE decision_id = $1`,

  /*
   * Guarded on `IS NULL`, which is what makes two corrections unable to both
   * win: the loser updates zero rows rather than overwriting the winner's link.
   * The deferrable foreign keys are what let this run BEFORE the successor
   * exists, so the predecessor leaves the one-live partial index before the
   * successor enters it and no instant has two live decisions.
   */
  markSuperseded: `UPDATE analysis.case_decisions
                      SET superseded_by_decision_id = $2
                    WHERE decision_id = $1
                      AND superseded_by_decision_id IS NULL
                RETURNING decision_id`,
})

type RelationRow = DecisionSubmissionRow

const groupBy = <T>(rows: readonly T[], key: (row: T) => string) => {
  const byId = new Map<string, T[]>()
  for (const row of rows) {
    const list = byId.get(key(row)) ?? []
    list.push(row)
    byId.set(key(row), list)
  }
  return byId
}

export function createDecisionRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): DecisionRepository {
  /**
   * Roots plus their four child tables, in five statements.
   *
   * Constant whether one decision comes back or fifty, and whether it carries
   * one dissent entry or twenty-five: every child table is read once with
   * `= ANY($1)` and grouped in memory.
   */
  async function hydrate(
    client: Queryable,
    operation: string,
    roots: readonly CaseDecisionRow[],
  ): Promise<CaseDecision[]> {
    if (roots.length === 0) return []
    const ids = roots.map((root) => root.decision_id)

    const relations = await run<RelationRow>(
      client,
      context,
      operation,
      DECISION_HYDRATE_SQL.relationsFor,
      [ids],
    )
    const dissent = await run<DecisionDissentRow>(
      client,
      context,
      operation,
      DECISION_HYDRATE_SQL.dissentFor,
      [ids],
    )
    const dissentEvidence = await run<DecisionDissentEvidenceRow>(
      client,
      context,
      operation,
      DECISION_HYDRATE_SQL.dissentEvidenceFor,
      [ids],
    )
    const triggers = await run<DecisionTriggerRow>(
      client,
      context,
      operation,
      DECISION_HYDRATE_SQL.triggersFor,
      [ids],
    )

    const relationsById = groupBy(relations, (row) => row.decision_id)
    const dissentById = groupBy(dissent, (row) => row.decision_id)
    const evidenceById = groupBy(dissentEvidence, (row) => row.decision_id)
    const triggersById = groupBy(triggers, (row) => row.decision_id)

    return roots.map((root) =>
      seal(
        decisionFromRows(
          {
            decision: root,
            submissions: relationsById.get(root.decision_id) ?? [],
            dissent: dissentById.get(root.decision_id) ?? [],
            dissentEvidence: evidenceById.get(root.decision_id) ?? [],
            triggers: triggersById.get(root.decision_id) ?? [],
          },
          operation,
        ),
        `Case decision ${root.decision_id}`,
      ),
    )
  }

  const readRoots = (
    client: Queryable,
    operation: string,
    sql: string,
    values: unknown[],
  ) => run<CaseDecisionRow>(client, context, operation, sql, values)

  return {
    get: (decisionId) =>
      unitOfWork(
        scope,
        'decisions.get',
        async (client) =>
          (
            await hydrate(
              client,
              'decisions.get',
              await readRoots(client, 'decisions.get', DECISION_READ_SQL.byId, [
                decisionId,
              ]),
            )
          )[0] ?? null,
      ),

    getForCase: (caseId) =>
      unitOfWork(scope, 'decisions.getForCase', async (client) => {
        const roots = await readRoots(
          client,
          'decisions.getForCase',
          DECISION_READ_SQL.liveForCase,
          [caseId],
        )

        if (roots.length === 0) return null
        if (roots.length > 1) {
          /*
           * Refused, not resolved. Picking the first, the newest, or the
           * lowest id would manufacture certainty the stored state does not
           * contain -- and would hide the second decision from whoever most
           * needs to know it exists. The database normally prevents this; if it
           * is ever reachable, that is corruption and the read says so.
           */
          throw new MalformedRowError(
            'Case decision',
            `case "${caseId}" holds more than one live decision`,
            'decisions.getForCase',
          )
        }

        return (await hydrate(client, 'decisions.getForCase', roots))[0] ?? null
      }),

    historyForCase: (caseId) =>
      unitOfWork(scope, 'decisions.historyForCase', async (client) =>
        hydrate(
          client,
          'decisions.historyForCase',
          await readRoots(
            client,
            'decisions.historyForCase',
            DECISION_READ_SQL.historyForCase,
            [caseId],
          ),
        ),
      ),

    listRecent: (limit) =>
      unitOfWork(scope, 'decisions.listRecent', async (client) =>
        hydrate(
          client,
          'decisions.listRecent',
          await readRoots(client, 'decisions.listRecent', DECISION_READ_SQL.recent, [
            tenantId,
            limit,
          ]),
        ),
      ),

    save: (decision) =>
      unitOfWork(scope, 'decisions.save', async (client) => {
        /*
         * The validation order is fixed and load-bearing. Everything checkable
         * from the record alone comes first, so an invalid aggregate reaches no
         * statement at all.
         */
        const problems = validateCaseDecision(decision)
        if (problems.length > 0) {
          throw new InvariantViolationError(problems[0]!.code, 'decisions.save')
        }

        const existing = (
          await hydrate(
            client,
            'decisions.save',
            await readRoots(client, 'decisions.save', DECISION_READ_SQL.byId, [
              decision.decisionId,
            ]),
          )
        )[0]
        if (existing) {
          if (decisionSemanticKey(existing) !== decisionSemanticKey(decision)) {
            throw new ConflictingRecordError(
              'Case decision',
              decision.decisionId,
              'decisions.save',
            )
          }
          return existing
        }

        /*
         * The predecessor, before anything is written. Its case is checked here
         * rather than left to the composite foreign key, so the rejection is the
         * same CLASS as the in-memory reference's: a raw foreign-key violation
         * would arrive as ReferentialIntegrityError.
         */
        const predecessorId = decision.supersedesDecisionId
        let predecessorSubmissions: ReadonlySet<string> = new Set()

        if (predecessorId !== undefined) {
          const found = await run<{
            decision_id: string
            case_id: string
            superseded_by_decision_id: string | null
          }>(client, context, 'decisions.save', SUPERSESSION_SQL.predecessorFor, [
            predecessorId,
          ])
          const predecessor = found[0]
          if (!predecessor) {
            throw new ReferentialIntegrityError(
              'case_decisions_supersedes_fk',
              'decisions.save',
            )
          }
          if (predecessor.case_id !== decision.caseId) {
            throw new InvariantViolationError(
              'decision-supersedes-other-case',
              'decisions.save',
            )
          }
          const referenced = await run<{ submission_id: string }>(
            client,
            context,
            'decisions.save',
            SUPERSESSION_SQL.predecessorSubmissions,
            [predecessorId],
          )
          predecessorSubmissions = new Set(referenced.map((row) => row.submission_id))
        }

        /*
         * Structural facts about the referenced submissions, in one statement.
         * The composite foreign keys enforce the same rules; reading them first
         * is what makes the rejection the same CLASS as the in-memory
         * reference's, from the same call.
         */
        const rows = decisionToRows(decision)
        const structural = await run<{
          id: string
          case_id: string
          revision_id: string
          state: string
        }>(client, context, 'decisions.save', DECISION_WRITE_SQL.submissionsById, [
          decision.submissionIds,
        ])
        const byId = new Map(structural.map((row) => [row.id, row]))

        for (const relation of rows.submissions) {
          const submission = byId.get(relation.submission_id)
          if (!submission) {
            throw new ReferentialIntegrityError(
              'decision_submissions_submission_fk',
              'decisions.save',
            )
          }
          if (submission.case_id !== decision.caseId) {
            throw new InvariantViolationError(
              'decision-submission-case',
              'decisions.save',
            )
          }
          if (submission.revision_id !== relation.revision_id) {
            throw new InvariantViolationError(
              'decision-submission-revision',
              'decisions.save',
            )
          }
          /*
           * A settled submission is NOT rejected for being settled: a
           * correction legitimately reuses the basis it corrects. What the
           * repository does check is that the reuse is structurally real -- the
           * predecessor must actually have referenced it. Whether the reuse
           * remains institutionally permissible after later evidence or
           * governance is the command's question, not this one's.
           */
          if (
            submission.state !== 'pending' &&
            predecessorId !== undefined &&
            !predecessorSubmissions.has(submission.id)
          ) {
            throw new InvariantViolationError(
              'decision-submission-not-reusable',
              'decisions.save',
            )
          }
        }

        if (predecessorId !== undefined) {
          const marked = await run<{ decision_id: string }>(
            client,
            context,
            'decisions.save',
            SUPERSESSION_SQL.markSuperseded,
            [predecessorId, decision.decisionId],
          )

          if (marked.length === 0) {
            /*
             * Zero rows is neither success nor conflict on its own.
             *
             * The replay probe above already missed, so the successor did not
             * exist when this transaction started -- but under READ COMMITTED a
             * concurrent winner may have committed while this statement waited
             * on the row lock. Which of the three it is gets decided by looking,
             * in this same transaction, at what actually happened.
             */
            const raced = (
              await hydrate(
                client,
                'decisions.save',
                await readRoots(client, 'decisions.save', DECISION_READ_SQL.byId, [
                  decision.decisionId,
                ]),
              )
            )[0]

            if (raced) {
              /*
               * The SAME successor won. An identical retry is a replay and gets
               * the winner; a different one under that id is two decisions
               * wearing one name.
               */
              if (decisionSemanticKey(raced) !== decisionSemanticKey(decision)) {
                throw new ConflictingRecordError(
                  'Case decision',
                  decision.decisionId,
                  'decisions.save',
                )
              }
              return raced
            }

            /*
             * A DIFFERENT successor won, or the predecessor was not live when
             * this caller read it. Either way this correction is against a
             * decision that has moved on: re-read and decide again.
             */
            throw new ConcurrencyConflictError(
              decision.caseId,
              decision.aggregateVersion,
              decision.aggregateVersion,
            )
          }
        }

        const root = rows.decision
        await run(client, context, 'decisions.save', DECISION_WRITE_SQL.insertDecision, [
          root.decision_id,
          root.case_id,
          tenantId,
          root.aggregate_version,
          root.decided_at,
          root.decided_by_employee_id,
          root.outcome_kind,
          root.selected_revision_id,
          root.supersedes_decision_id,
          root.evidence_set_id,
          root.rationale,
          root.decided_by_role_id,
          root.decided_by_role_function,
          root.decided_by_department_id,
          root.decided_by_department_is_governance,
          root.decided_by_department_handles,
          root.organization_seed_version,
          root.authentication,
          root.authorization_basis,
        ])

        /*
         * The relation of each considered revision came from `relationsOf`, in
         * `decisionToRows`, and from nowhere else. Nothing here computes one
         * from the outcome kind — fitness rule 13 asserts that in B2C.
         */
        await run(client, context, 'decisions.save', DECISION_WRITE_SQL.insertRelations, [
          root.decision_id,
          rows.submissions.map((row) => row.submission_id),
          rows.submissions.map((row) => row.case_id),
          rows.submissions.map((row) => row.revision_id),
          rows.submissions.map((row) => row.relation),
        ])

        await run(client, context, 'decisions.save', DECISION_WRITE_SQL.insertDissent, [
          root.decision_id,
          rows.dissent.map((row) => row.ordinal),
          rows.dissent.map((row) => row.source),
          rows.dissent.map((row) => row.source_id),
          rows.dissent.map((row) => row.revision_id),
          rows.dissent.map((row) => row.claim_id),
          rows.dissent.map((row) => row.materiality),
          rows.dissent.map((row) => row.raised_by_employee_id),
          rows.dissent.map((row) => row.raised_by_department_id),
          rows.dissent.map((row) => row.rationale),
          rows.dissent.map((row) => row.why_not_blocking),
          rows.dissent.map((row) => row.acknowledgement),
          rows.dissent.map((row) => row.disposition),
        ])

        await run(
          client,
          context,
          'decisions.save',
          DECISION_WRITE_SQL.insertDissentEvidence,
          [
            root.decision_id,
            rows.dissentEvidence.map((row) => row.ordinal),
            rows.dissentEvidence.map((row) => row.evidence_set_id),
            rows.dissentEvidence.map((row) => row.observation_id),
            rows.dissentEvidence.map((row) => row.content_hash),
          ],
        )

        await run(client, context, 'decisions.save', DECISION_WRITE_SQL.insertTriggers, [
          root.decision_id,
          rows.triggers.map((row) => row.id),
          rows.triggers.map((row) => row.ordinal),
          rows.triggers.map((row) => row.condition_type),
          rows.triggers.map((row) => row.subject_kind),
          rows.triggers.map((row) => row.subject_ref),
          rows.triggers.map((row) => row.comparator),
          rows.triggers.map((row) => row.threshold_amount),
          rows.triggers.map((row) => row.threshold_unit),
          rows.triggers.map((row) => row.threshold_currency),
          rows.triggers.map((row) => row.qualitative_condition),
          rows.triggers.map((row) => row.expected_source),
          rows.triggers.map((row) => row.rationale),
          rows.triggers.map((row) => row.created_by_employee_id),
          rows.triggers.map((row) => row.created_at),
          rows.triggers.map((row) => row.policy_version),
        ])

        /*
         * The rules that span these writes fire at COMMIT, which is the wrong
         * moment for a repository to learn it was wrong. Forcing exactly the
         * six the decision owns makes an invalid relation set fail from `save`,
         * where the in-memory reference fails, and restores the caller's mode
         * so unrelated deferred work is untouched.
         */
        await run(
          client,
          context,
          'decisions.save',
          CONSTRAINT_SQL.forceDecisionConstraints,
        )
        await run(
          client,
          context,
          'decisions.save',
          CONSTRAINT_SQL.restoreDecisionConstraints,
        )

        /*
         * The argument, sealed — not a read-back. The references were checked
         * before the insert and whether the rows read back identically is what
         * `get` is tested for; a second hydration would spend four statements
         * re-deriving what is already known. The in-memory reference returns
         * the same thing.
         */
        return seal(decision, `Case decision ${decision.decisionId}`)
      }),
  }
}
