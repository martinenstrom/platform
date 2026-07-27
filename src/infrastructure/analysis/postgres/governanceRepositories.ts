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
import { catalog, one, run, ts, type SqlContext } from './sql'
import { activeClient, type Scope } from './transaction'

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
                    evidence_set_id, observation_id
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

  saveFinding: `INSERT INTO analysis.verification_findings
                  (id, review_id, kind, claim_id, detail, blocking,
                   evidence_set_id, observation_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
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
  async function rowsFor(kind: ReviewKind, caseId: string, operation: string) {
    const client = activeClient(scope, operation)
    return run<ReviewRow>(client, context, operation, REVIEW_SQL.forCase, [caseId, kind])
  }

  /** Writes the review, and reports whether it was new. */
  async function insertReview(
    kind: ReviewKind,
    review: ReviewScope & ReviewAttribution,
    status: string | null,
    detail: unknown,
    operation: string,
  ): Promise<string | null> {
    const client = activeClient(scope, operation)
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
    async verificationsForCase(caseId) {
      const operation = 'reviews.verificationsForCase'
      const rows = await rowsFor('verification', caseId, operation)
      if (rows.length === 0) return []
      const client = activeClient(scope, operation)
      const findings = await run<VerificationFindingRow>(
        client,
        context,
        operation,
        REVIEW_SQL.findings,
        [rows.map((row) => row.id)],
      )
      const byReview = groupBy(findings, (finding) => finding.review_id)
      return rows.map((row) => toVerification(row, byReview.get(row.id) ?? []))
    },

    async challengesForCase(caseId) {
      const operation = 'reviews.challengesForCase'
      const rows = await rowsFor('devils-advocate', caseId, operation)
      if (rows.length === 0) return []
      const client = activeClient(scope, operation)

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
    },

    async complianceForCase(caseId) {
      const rows = await rowsFor('compliance', caseId, 'reviews.complianceForCase')
      return rows.map(toCompliance)
    },

    async riskForCase(caseId) {
      const rows = await rowsFor('risk', caseId, 'reviews.riskForCase')
      return rows.map(toRisk)
    },

    async saveVerification(review) {
      const operation = 'reviews.saveVerification'
      const id = await insertReview(
        'verification',
        review,
        review.status,
        { claimsReviewed: [...review.claimsReviewed] },
        operation,
      )
      if (!id) return

      const client = activeClient(scope, operation)
      for (const [index, finding] of review.findings.entries()) {
        await run(client, context, operation, REVIEW_SQL.saveFinding, [
          // Ordinal, so the id is stable and the verifier's order is preserved.
          `${id}#${index}`,
          id,
          finding.kind,
          finding.claimId,
          finding.detail,
          finding.blocking,
          finding.evidence?.setId ?? null,
          finding.evidence?.observationId ?? null,
        ])
      }
    },

    async saveDevilsAdvocate(review) {
      const operation = 'reviews.saveDevilsAdvocate'
      const id = await insertReview('devils-advocate', review, null, {}, operation)
      if (!id) return

      const client = activeClient(scope, operation)
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
    },

    async saveCompliance(review) {
      await insertReview(
        'compliance',
        review,
        review.status,
        { findings: [...review.findings] },
        'reviews.saveCompliance',
      )
    },

    async saveRisk(review) {
      await insertReview(
        'risk',
        review,
        review.status,
        {
          concerns: [...review.concerns],
          limits: review.limits ? [...review.limits] : null,
        },
        'reviews.saveRisk',
      )
    },
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

  saveRevision: `INSERT INTO analysis.decision_revisions (case_id, revision_id, relation)
                 VALUES ($1, $2, $3)
                 ON CONFLICT DO NOTHING`,
})

export function createDecisionRepository(
  scope: Scope,
  context: SqlContext,
  tenantId: string,
): DecisionRepository {
  async function hydrate(rows: DecisionRow[], operation: string) {
    if (rows.length === 0) return []
    const client = activeClient(scope, operation)
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

  return {
    async getForCase(caseId) {
      const client = activeClient(scope, 'decisions.getForCase')
      const row = await one<DecisionRow>(
        client,
        context,
        'decisions.getForCase',
        DECISION_SQL.getForCase,
        [caseId],
      )
      if (!row) return null
      return (await hydrate([row], 'decisions.getForCase'))[0]!
    },

    async list(limit) {
      const client = activeClient(scope, 'decisions.list')
      const rows = await run<DecisionRow>(
        client,
        context,
        'decisions.list',
        DECISION_SQL.list,
        [limit],
      )
      return hydrate(rows, 'decisions.list')
    },

    async save(decision) {
      const client = activeClient(scope, 'decisions.save')
      const existing = await this.getForCase(decision.caseId)
      if (existing) {
        if (
          existing.selectedRevisionId !== decision.selectedRevisionId ||
          existing.rationale !== decision.rationale
        ) {
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

      const relations: Array<[string, readonly string[]]> = [
        ['selected', decision.selectedRevisionId ? [decision.selectedRevisionId] : []],
        ['not-selected', decision.notSelectedRevisionIds],
        ['rejected', decision.rejectedRevisionIds],
      ]
      for (const [relation, ids] of relations) {
        for (const revisionId of ids) {
          await run(client, context, 'decisions.save', DECISION_SQL.saveRevision, [
            decision.caseId,
            revisionId,
            relation,
          ])
        }
      }
      return (await this.getForCase(decision.caseId))!
    },
  }
}

/* ----------------------------------------------------------------- events */

const EVENT_COLUMNS = `
  event_id, subject, case_id, tenant_id, thesis_id, revision_id, assignment_id,
  run_id, from_state, to_state, actor_employee_id, actor_department_id, reason,
  ${ts('occurred_at')}, correlation_id, causation_id, aggregate_version, corrects
`

export const EVENT_SQL = catalog({
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
    async append(event) {
      const client = activeClient(scope, 'events.append')
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
    },

    async listForCase(caseId) {
      const client = activeClient(scope, 'events.listForCase')
      const rows = await run<TransitionEventRow>(
        client,
        context,
        'events.listForCase',
        EVENT_SQL.listForCase,
        [caseId],
      )
      return rows.map(toTransitionEvent)
    },

    async recent(limit) {
      const client = activeClient(scope, 'events.recent')
      const rows = await run<TransitionEventRow>(
        client,
        context,
        'events.recent',
        EVENT_SQL.recent,
        [limit],
      )
      return rows.map(toTransitionEvent)
    },
  }
}
