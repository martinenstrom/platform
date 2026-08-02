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
 * **No supersession.** B2B-2 builds the correcting-decision transaction, its
 * zero-row disambiguation and the named constraint forcing. A decision naming a
 * predecessor is refused here rather than half-written.
 */

import { validateCaseDecision, type CaseDecision } from '~/domain/analysis'
import {
  ConflictingRecordError,
  InvariantViolationError,
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

  /** The live decision — the one nothing has superseded. */
  liveForCase: `SELECT ${DECISION_COLUMNS} FROM analysis.case_decisions
                WHERE case_id = $1 AND superseded_by_decision_id IS NULL`,

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

  const readRoots = (client: Queryable, operation: string, sql: string, values: unknown[]) =>
    run<CaseDecisionRow>(client, context, operation, sql, values)

  return {
    get: (decisionId) =>
      unitOfWork(scope, 'decisions.get', async (client) =>
        (
          await hydrate(
            client,
            'decisions.get',
            await readRoots(client, 'decisions.get', DECISION_READ_SQL.byId, [decisionId]),
          )
        )[0] ?? null,
      ),

    getForCase: (caseId) =>
      unitOfWork(scope, 'decisions.getForCase', async (client) =>
        (
          await hydrate(
            client,
            'decisions.getForCase',
            await readRoots(client, 'decisions.getForCase', DECISION_READ_SQL.liveForCase, [
              caseId,
            ]),
          )
        )[0] ?? null,
      ),

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

        if (decision.supersedesDecisionId !== undefined) {
          /*
           * Refused rather than half-written. The correcting transaction needs
           * the deferred foreign keys, the zero-row disambiguation and the
           * named constraint forcing, and writing the successor without them
           * would leave a case with two live decisions or none.
           */
          throw new InvariantViolationError(
            'decision-supersession-not-implemented',
            'decisions.save',
          )
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
            throw new InvariantViolationError('decision-submission-case', 'decisions.save')
          }
          if (submission.revision_id !== relation.revision_id) {
            throw new InvariantViolationError(
              'decision-submission-revision',
              'decisions.save',
            )
          }
          /*
           * A settled submission is NOT rejected for being settled: a
           * correction legitimately reuses the basis it corrects. Whether this
           * particular reuse is authorised is the command's question.
           */
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
