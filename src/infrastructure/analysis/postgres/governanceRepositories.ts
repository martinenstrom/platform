/**
 * Reviews, decisions and the event log.
 *
 * ## Review ids
 *
 * The domain has no review id — a `VerificationReview` is identified by what it
 * reviewed, who reviewed it and when. The schema needs a primary key, so it is
 * **derived** from `reviewIdentity`, the same natural key
 * `reviews_natural_key_unique` uses. A generated uuid would break idempotency:
 * a retry would mint a new id and fail at the index with the intent lost.
 *
 * ## Scope
 *
 * A review is case-wide or attached to one exact revision. The union maps
 * straight onto the discriminator and its two columns; the CHECK constraints
 * from migration 0011 reject anything else, and the composite foreign key
 * enforces that the revision belongs to the thesis and the thesis to the case.
 */

import {
  reviewIdentity,
  type ReviewAttribution,
  type ReviewScope,
} from '~/domain/analysis'
import { stableHashHex } from '~/domain/shared/hash'
import {
  ConflictingRecordError,
  type DecisionRepository,
  type EventRepository,
  type ReviewRepository,
} from '~/application/analysis/repositories'
import { groupBy } from './caseRepositories'
import {
  toCompliance,
  toDecision,
  toDevilsAdvocate,
  toRisk,
  toTransitionEvent,
  toVerification,
} from './mapping'
import type {
  ChallengeEvidenceRow,
  ChallengeRow,
  DecisionRevisionRow,
  DecisionRow,
  ReviewRow,
  TransitionEventRow,
  VerificationFindingRow,
} from './rows'
import {
  decisionSemanticKey,
  transitionEventSemanticKey,
} from '~/application/analysis/writeOnce'
import { catalog, one, run, ts, type Queryable, type SqlContext } from './sql'
import { singleStatement, unitOfWork, type Scope } from './transaction'

type ReviewKind = Parameters<typeof reviewIdentity>[0]

/** Derived, not generated, so a retry computes the same id. */
export function reviewRowId(
  kind: ReviewKind,
  review: ReviewScope & ReviewAttribution,
): string {
  return stableHashHex(reviewIdentity(kind, review))
}

const REVIEW_COLUMNS = `
  id, kind, scope, case_id, tenant_id, thesis_id, revision_id,
  by_employee_id, by_department_id, ${ts('at')}, status, detail
`

/** `at`, then by_employee_id, then revision_id — case-wide sorts first. */
const REVIEW_ORDER = `ORDER BY at, by_employee_id COLLATE "C",
                               coalesce(revision_id, '') COLLATE "C"`

export const REVIEW_SQL = catalog({
  forCase: `SELECT ${REVIEW_COLUMNS} FROM analysis.reviews
            WHERE case_id = $1 AND kind = $2 ${REVIEW_ORDER}`,

  findings: `SELECT id, review_id, kind, claim_id, detail, blocking,
                    evidence_set_id, observation_id, content_hash
             FROM analysis.verification_findings
             WHERE review_id = ANY($1::text[])
             ORDER BY review_id COLLATE "C", id COLLATE "C"`,

  challenges: `SELECT id, review_id, contests_claim_id, contests_thesis_id, kind,
                      argument, would_be_resolved_by, outcome
               FROM analysis.challenges WHERE review_id = ANY($1::text[])
               ORDER BY review_id COLLATE "C", id COLLATE "C"`,

  challengeEvidence: `SELECT challenge_id, evidence_set_id, observation_id, content_hash
                      FROM analysis.challenge_evidence
                      WHERE challenge_id = ANY($1::text[])
                      ORDER BY challenge_id COLLATE "C", observation_id COLLATE "C"`,

  /*
   * `RETURNING id` is the idempotency signal: no id means the natural key
   * already holds a review, and the children are then skipped entirely —
   * matching the in-memory adapter, which discards the whole submission.
   */
  save: `INSERT INTO analysis.reviews
           (id, kind, scope, case_id, tenant_id, thesis_id, revision_id,
            by_employee_id, by_department_id, at, status, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT DO NOTHING
         RETURNING id`,

  /*
   * One statement for every finding. `content_hash` is written because a
   * citation without it cannot be checked for revision — which is the whole
   * reason a verification records what it looked at.
   */
  saveFindings: `INSERT INTO analysis.verification_findings
                   (id, review_id, kind, claim_id, detail, blocking,
                    evidence_set_id, observation_id, content_hash)
                 SELECT i, $2, k, c, d, b, es, o, h
                 FROM unnest($1::text[], $3::text[], $4::text[], $5::text[],
                             $6::boolean[], $7::text[], $8::text[], $9::text[])
                      AS batch(i, k, c, d, b, es, o, h)
                 ON CONFLICT (id) DO NOTHING`,

  saveChallenge: `INSERT INTO analysis.challenges
                    (id, review_id, contests_claim_id, contests_thesis_id, kind,
                     argument, would_be_resolved_by, outcome)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                  ON CONFLICT (id) DO UPDATE SET outcome = EXCLUDED.outcome`,

  saveChallengeEvidence: `INSERT INTO analysis.challenge_evidence
                            (challenge_id, evidence_set_id, observation_id, content_hash)
                          VALUES ($1,$2,$3,$4)
                          ON CONFLICT DO NOTHING`,
})

export function createReviewRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): ReviewRepository {
  const rowsFor = (
    client: Queryable,
    kind: ReviewKind,
    caseId: string,
    operation: string,
  ) => run<ReviewRow>(client, context, operation, REVIEW_SQL.forCase, [caseId, kind])

  /** Writes the review, and reports whether it was new. */
  async function insertReview(
    client: Queryable,
    kind: ReviewKind,
    review: ReviewScope & ReviewAttribution,
    status: string | null,
    detail: unknown,
    operation: string,
  ): Promise<string | null> {
    const id = reviewRowId(kind, review)
    const inserted = await run<{ id: string }>(
      client,
      context,
      operation,
      REVIEW_SQL.save,
      [
        id,
        kind,
        review.scope,
        review.caseId,
        tenantId,
        review.scope === 'thesis-revision' ? review.thesisId : null,
        review.scope === 'thesis-revision' ? review.revisionId : null,
        review.byEmployeeId,
        review.byDepartmentId,
        review.at,
        status,
        JSON.stringify(detail ?? {}),
      ],
    )
    return inserted.length > 0 ? id : null
  }

  return {
    verificationsForCase: (caseId) =>
      unitOfWork(scope, 'reviews.verificationsForCase', async (client) => {
        const operation = 'reviews.verificationsForCase'
        const rows = await rowsFor(client, 'verification', caseId, operation)
        if (rows.length === 0) return []
        const findings = await run<VerificationFindingRow>(
          client,
          context,
          operation,
          REVIEW_SQL.findings,
          [rows.map((row) => row.id)],
        )
        const byReview = groupBy(findings, (finding) => finding.review_id)
        return rows.map((row) => toVerification(row, byReview.get(row.id) ?? []))
      }),

    challengesForCase: (caseId) =>
      unitOfWork(scope, 'reviews.challengesForCase', async (client) => {
        const operation = 'reviews.challengesForCase'
        const rows = await rowsFor(client, 'devils-advocate', caseId, operation)
        if (rows.length === 0) return []

        const challenges = await run<ChallengeRow>(
          client,
          context,
          operation,
          REVIEW_SQL.challenges,
          [rows.map((row) => row.id)],
        )
        const evidence =
          challenges.length === 0
            ? []
            : await run<ChallengeEvidenceRow>(
                client,
                context,
                operation,
                REVIEW_SQL.challengeEvidence,
                [challenges.map((challenge) => challenge.id)],
              )

        const byReview = groupBy(challenges, (challenge) => challenge.review_id)
        return rows.map((row) =>
          toDevilsAdvocate(row, byReview.get(row.id) ?? [], evidence),
        )
      }),

    /** One statement: compliance carries no typed children. */
    async complianceForCase(caseId) {
      const operation = 'reviews.complianceForCase'
      const rows = await rowsFor(
        singleStatement(scope, operation),
        'compliance',
        caseId,
        operation,
      )
      return rows.map(toCompliance)
    },

    /** One statement: risk carries no typed children. */
    async riskForCase(caseId) {
      const operation = 'reviews.riskForCase'
      const rows = await rowsFor(
        singleStatement(scope, operation),
        'risk',
        caseId,
        operation,
      )
      return rows.map(toRisk)
    },

    saveVerification: (review) =>
      unitOfWork(scope, 'reviews.saveVerification', async (client) => {
        const operation = 'reviews.saveVerification'
        const id = await insertReview(
          client,
          'verification',
          review,
          review.status,
          { claimsReviewed: [...review.claimsReviewed] },
          operation,
        )
        if (!id) return

        const findings = [...review.findings]
        if (findings.length === 0) return
        await run(client, context, operation, REVIEW_SQL.saveFindings, [
          // Ordinal, so the id is stable and the verifier's order is preserved.
          findings.map((_, index) => `${id}#${index}`),
          id,
          findings.map((finding) => finding.kind),
          findings.map((finding) => finding.claimId),
          findings.map((finding) => finding.detail),
          findings.map((finding) => finding.blocking),
          findings.map((finding) => finding.evidence?.setId ?? null),
          findings.map((finding) => finding.evidence?.observationId ?? null),
          findings.map((finding) => finding.evidence?.contentHash ?? null),
        ])
      }),

    saveDevilsAdvocate: (review) =>
      unitOfWork(scope, 'reviews.saveDevilsAdvocate', async (client) => {
        const operation = 'reviews.saveDevilsAdvocate'
        const id = await insertReview(
          client,
          'devils-advocate',
          review,
          null,
          {},
          operation,
        )
        if (!id) return

        for (const challenge of review.challenges) {
          await run(client, context, operation, REVIEW_SQL.saveChallenge, [
            challenge.id,
            id,
            challenge.contests,
            challenge.contestsThesis ?? null,
            challenge.kind,
            challenge.argument,
            challenge.wouldBeResolvedBy ?? null,
            review.outcomes[challenge.id] ?? 'open',
          ])
          for (const ref of challenge.counterEvidence) {
            await run(client, context, operation, REVIEW_SQL.saveChallengeEvidence, [
              challenge.id,
              ref.setId,
              ref.observationId,
              ref.contentHash,
            ])
          }
        }
      }),

    saveCompliance: (review) =>
      unitOfWork(scope, 'reviews.saveCompliance', async (client) => {
        await insertReview(
          client,
          'compliance',
          review,
          review.status,
          { findings: [...review.findings] },
          'reviews.saveCompliance',
        )
      }),

    saveRisk: (review) =>
      unitOfWork(scope, 'reviews.saveRisk', async (client) => {
        await insertReview(
          client,
          'risk',
          review,
          review.status,
          {
            concerns: [...review.concerns],
            limits: review.limits ? [...review.limits] : null,
          },
          'reviews.saveRisk',
        )
      }),
  }
}

/* -------------------------------------------------------------- decisions */

export const DECISION_SQL = catalog({
  getForCase: `SELECT case_id, tenant_id, aggregate_version, ${ts('decided_at')},
                      decided_by_employee_id, selected_revision_id, evidence_set_id,
                      rationale, governance, unresolved_dissent, reconsideration_triggers
               FROM analysis.case_decisions WHERE case_id = $1`,

  list: `SELECT case_id, tenant_id, aggregate_version, ${ts('decided_at')},
                decided_by_employee_id, selected_revision_id, evidence_set_id,
                rationale, governance, unresolved_dissent, reconsideration_triggers
         FROM analysis.case_decisions
         ORDER BY decided_at DESC, case_id COLLATE "C"
         LIMIT $1`,

  revisions: `SELECT case_id, revision_id, relation FROM analysis.decision_revisions
              WHERE case_id = ANY($1::text[])
              ORDER BY case_id COLLATE "C", relation COLLATE "C", revision_id COLLATE "C"`,

  // One per case, immutable once committed. A correction appends a superseding
  // decision rather than rewriting one that has already been communicated.
  save: `INSERT INTO analysis.case_decisions
           (case_id, tenant_id, aggregate_version, decided_at, decided_by_employee_id,
            selected_revision_id, evidence_set_id, rationale, governance,
            unresolved_dissent, reconsideration_triggers)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (case_id) DO NOTHING`,

  saveRevisions: `INSERT INTO analysis.decision_revisions (case_id, revision_id, relation)
                  SELECT $1, r, rel
                  FROM unnest($2::text[], $3::text[]) AS batch(r, rel)
                  ON CONFLICT DO NOTHING`,
})

export function createDecisionRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): DecisionRepository {
  async function hydrate(client: Queryable, rows: DecisionRow[], operation: string) {
    if (rows.length === 0) return []
    const revisions = await run<DecisionRevisionRow>(
      client,
      context,
      operation,
      DECISION_SQL.revisions,
      [rows.map((row) => row.case_id)],
    )
    const byCase = groupBy(revisions, (row) => row.case_id)
    return rows.map((row) => toDecision(row, byCase.get(row.case_id) ?? []))
  }

  async function readOne(client: Queryable, caseId: string, operation: string) {
    const row = await one<DecisionRow>(
      client,
      context,
      operation,
      DECISION_SQL.getForCase,
      [caseId],
    )
    if (!row) return null
    return (await hydrate(client, [row], operation))[0]!
  }

  return {
    getForCase: (caseId) =>
      unitOfWork(scope, 'decisions.getForCase', (client) =>
        readOne(client, caseId, 'decisions.getForCase'),
      ),

    list: (limit) =>
      unitOfWork(scope, 'decisions.list', async (client) => {
        const rows = await run<DecisionRow>(
          client,
          context,
          'decisions.list',
          DECISION_SQL.list,
          [limit],
        )
        return hydrate(client, rows, 'decisions.list')
      }),

    save: (decision) =>
      unitOfWork(scope, 'decisions.save', async (client) => {
        const existing = await readOne(client, decision.caseId, 'decisions.save')
        if (existing) {
          // The whole record, through the shared comparison — not two fields.
          if (decisionSemanticKey(existing) !== decisionSemanticKey(decision)) {
            throw new ConflictingRecordError(
              'Case decision',
              decision.caseId,
              'decisions.save',
            )
          }
          return existing
        }

        await run(client, context, 'decisions.save', DECISION_SQL.save, [
          decision.caseId,
          tenantId,
          decision.aggregateVersion,
          decision.decidedAt,
          decision.decidedByEmployeeId,
          decision.selectedRevisionId,
          decision.evidenceSetId,
          decision.rationale,
          JSON.stringify(decision.governance),
          JSON.stringify(decision.unresolvedDissent),
          JSON.stringify(decision.reconsiderationTriggers),
        ])

        /*
         * No `selected` row. The selected revision lives in one place — the
         * column a foreign key already protects — and migration 0012 removed
         * the second representation rather than trying to keep two in step.
         */
        const alternatives = [
          ...decision.notSelectedRevisionIds.map((id) => ({
            id,
            relation: 'not-selected',
          })),
          ...decision.rejectedRevisionIds.map((id) => ({ id, relation: 'rejected' })),
        ]
        if (alternatives.length > 0) {
          await run(client, context, 'decisions.save', DECISION_SQL.saveRevisions, [
            decision.caseId,
            alternatives.map((entry) => entry.id),
            alternatives.map((entry) => entry.relation),
          ])
        }
        return (await readOne(client, decision.caseId, 'decisions.save'))!
      }),
  }
}

/* ----------------------------------------------------------------- events */

const EVENT_COLUMNS = `
  event_id, subject, case_id, tenant_id, thesis_id, revision_id, assignment_id,
  run_id, from_state, to_state, actor_employee_id, actor_department_id, reason,
  ${ts('occurred_at')}, correlation_id, causation_id, aggregate_version, corrects
`

export const EVENT_SQL = catalog({
  get: `SELECT ${EVENT_COLUMNS} FROM analysis.transition_events WHERE event_id = $1`,

  listForCase: `SELECT ${EVENT_COLUMNS} FROM analysis.transition_events
                WHERE case_id = $1
                ORDER BY occurred_at, event_id COLLATE "C"`,

  recent: `SELECT ${EVENT_COLUMNS} FROM analysis.transition_events
           ORDER BY occurred_at DESC, event_id COLLATE "C" DESC
           LIMIT $1`,

  // Append-only. There is deliberately no update and no delete statement here,
  // and the runtime role holds no grant for either.
  append: `INSERT INTO analysis.transition_events
             (event_id, subject, case_id, tenant_id, thesis_id, revision_id,
              assignment_id, run_id, from_state, to_state, actor_employee_id,
              actor_department_id, reason, occurred_at, correlation_id,
              causation_id, aggregate_version, corrects)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           ON CONFLICT (event_id) DO NOTHING`,
})

export function createEventRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): EventRepository {
  return {
    append: (event) =>
      unitOfWork(scope, 'events.append', async (client) => {
        const stored = await one<TransitionEventRow>(
          client,
          context,
          'events.append',
          EVENT_SQL.get,
          [event.eventId],
        )
        if (stored) {
          // Append-only: the same id carrying different facts is a rewrite of
          // history attempted through the one door meant to refuse it.
          if (
            transitionEventSemanticKey(toTransitionEvent(stored)) !==
            transitionEventSemanticKey(event)
          ) {
            throw new ConflictingRecordError(
              'Transition event',
              event.eventId,
              'events.append',
            )
          }
          return
        }
        await run(client, context, 'events.append', EVENT_SQL.append, [
          event.eventId,
          event.subject,
          event.caseId,
          tenantId,
          event.thesisId ?? null,
          event.revisionId ?? null,
          event.assignmentId ?? null,
          event.runId ?? null,
          event.fromState,
          event.toState,
          event.actorEmployeeId ?? null,
          event.actorDepartmentId ?? null,
          event.reason ?? null,
          event.occurredAt,
          event.correlationId,
          event.causationId ?? null,
          event.aggregateVersion,
          event.corrects ?? null,
        ])
      }),

    /** One statement. */
    async listForCase(caseId) {
      const rows = await run<TransitionEventRow>(
        singleStatement(scope, 'events.listForCase'),
        context,
        'events.listForCase',
        EVENT_SQL.listForCase,
        [caseId],
      )
      return rows.map(toTransitionEvent)
    },

    /** One statement. The activity feed, read on every headquarters render. */
    async recent(limit) {
      const rows = await run<TransitionEventRow>(
        singleStatement(scope, 'events.recent'),
        context,
        'events.recent',
        EVENT_SQL.recent,
        [limit],
      )
      return rows.map(toTransitionEvent)
    },
  }
}
