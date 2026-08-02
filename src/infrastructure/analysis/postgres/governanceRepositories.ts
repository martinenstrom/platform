/**
 * Reviews, decisions and the event log.
 *
 * ## Review ids
 *
 * The id comes from the command, like every record since C1C-1. The natural key
 * — what was reviewed, by whom, and when — survives as
 * `reviews_natural_key_unique`, so one reviewer recording one verdict twice at
 * one instant still collides. `reviewRowId` below computes the identity the
 * schema used before that, and is kept for the parity test asserting the two
 * schemes agree about what counts as the same act.
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
  type ReviewOrder,
  type ReviewRecordId,
  type ReviewScope,
} from '~/domain/analysis'
import { stableHashHex } from '~/domain/shared/hash'
import {
  ConcurrencyConflictError,
  ConflictingRecordError,
  DuplicateRecordError,
  type EventRepository,
  type ReviewRepository,
} from '~/application/analysis/repositories'
import { groupBy } from './caseRepositories'
import {
  toCompliance,
  toDevilsAdvocate,
  toRisk,
  toTransitionEvent,
  toVerification,
} from './mapping'
import type {
  ChallengeEvidenceRow,
  ChallengeRow,
  ReviewRow,
  TransitionEventRow,
  VerificationFindingRow,
  RiskFindingRow,
  RiskLimitRow,
  VerificationClaimReviewedRow,
} from './rows'
import { transitionEventSemanticKey } from '~/application/analysis/writeOnce'
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
  by_employee_id, by_department_id, ${ts('at')}, status, detail,
  sequence, supersedes_review_id, reason
`

/**
 * `sequence`, then `at`, then the natural tiebreaks.
 *
 * Sequence leads because it is the only total order: `at` alone left two
 * verdicts recorded in the same millisecond in an arbitrary order, so "the
 * current verdict" was not a function of the data.
 */
const REVIEW_ORDER = `ORDER BY sequence, at, by_employee_id COLLATE "C",
                               coalesce(revision_id, '') COLLATE "C"`

export const REVIEW_SQL = catalog({
  forCase: `SELECT ${REVIEW_COLUMNS} FROM analysis.reviews
            WHERE case_id = $1 AND kind = $2 ${REVIEW_ORDER}`,

  byId: `SELECT ${REVIEW_COLUMNS} FROM analysis.reviews WHERE id = $1`,

  /*
   * The next position for one (case, revision, kind).
   *
   * Read-then-increment, and safe because `reviews_sequence_unique` is what
   * actually protects it: two transactions racing for the same position cannot
   * both commit, so the loser fails on the constraint rather than silently
   * taking a position that is already claimed. Locking instead would serialise
   * Verification against the Devil's Advocate, which is the concurrency the
   * firm needs most.
   */
  nextSequence: `SELECT coalesce(max(sequence), 0) + 1 AS next
                 FROM analysis.reviews
                 WHERE case_id = $1 AND revision_id = $2 AND kind = $3`,

  findings: `SELECT id, review_id, kind, claim_id, detail, blocking,
                    evidence_set_id, observation_id, content_hash, severity,
                    expected_amount, expected_unit, expected_currency,
                    observed_amount, observed_unit, observed_currency,
                    methodology, correction_required, cited_content_hash
             FROM analysis.verification_findings
             WHERE review_id = ANY($1::text[])
             ORDER BY review_id COLLATE "C", id COLLATE "C"`,

  claimsReviewed: `SELECT review_id, claim_id
                   FROM analysis.verification_claims_reviewed
                   WHERE review_id = ANY($1::text[])
                   ORDER BY review_id COLLATE "C", claim_id COLLATE "C"`,

  riskFindings: `SELECT review_id, ordinal, kind, detail, severity,
                        implication, mitigated_by
                 FROM analysis.risk_findings
                 WHERE review_id = ANY($1::text[])
                 ORDER BY review_id COLLATE "C", ordinal`,

  riskLimits: `SELECT review_id, ordinal, limit_text
               FROM analysis.risk_limits
               WHERE review_id = ANY($1::text[])
               ORDER BY review_id COLLATE "C", ordinal`,

  challenges: `SELECT id, review_id, contests_claim_id, contests_thesis_id, kind,
                      argument, would_be_resolved_by, outcome, materiality, resolved_by
               FROM analysis.challenges WHERE review_id = ANY($1::text[])
               ORDER BY review_id COLLATE "C", id COLLATE "C"`,

  challengeEvidence: `SELECT challenge_id, evidence_set_id, observation_id, content_hash
                      FROM analysis.challenge_evidence
                      WHERE challenge_id = ANY($1::text[])
                      ORDER BY challenge_id COLLATE "C", observation_id COLLATE "C"`,

  /*
   * No `ON CONFLICT DO NOTHING`, and that is the point.
   *
   * It used to swallow every unique violation, which is right for two of the
   * three and catastrophic for the third. The primary key collides when one
   * command writes twice — a replay, correctly a no-op. The natural key
   * collides when one reviewer records one verdict on one revision at one
   * instant twice — the same institutional act, also a no-op. But
   * `reviews_sequence_unique` collides when two GENUINELY DIFFERENT reviews
   * race for the same position, and swallowing that silently discarded one of
   * them: a control function's verdict would vanish, and the record would show
   * a review that was never filed.
   *
   * The caller distinguishes them by constraint name and reallocates only for
   * the sequence — see `insertReview`.
   */
  save: `INSERT INTO analysis.reviews
           (id, kind, scope, case_id, tenant_id, thesis_id, revision_id,
            by_employee_id, by_department_id, at, status, detail,
            sequence, supersedes_review_id, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id`,

  /*
   * One statement for every finding. `content_hash` is written because a
   * citation without it cannot be checked for revision — which is the whole
   * reason a verification records what it looked at.
   */
  saveFindings: `INSERT INTO analysis.verification_findings
                   (id, review_id, kind, claim_id, detail, blocking,
                    evidence_set_id, observation_id, content_hash, severity,
                    expected_amount, expected_unit, expected_currency,
                    observed_amount, observed_unit, observed_currency,
                    methodology, correction_required, cited_content_hash)
                 SELECT i, $2, k, c, d, b, es, o, h, sv,
                        ea, eu, ec, oa, ou, oc, me, cr, ch
                 FROM unnest($1::text[], $3::text[], $4::text[], $5::text[],
                             $6::boolean[], $7::text[], $8::text[], $9::text[],
                             $10::text[], $11::text[], $12::text[], $13::text[],
                             $14::text[], $15::text[], $16::text[], $17::text[],
                             $18::text[], $19::text[])
                      AS batch(i, k, c, d, b, es, o, h, sv,
                               ea, eu, ec, oa, ou, oc, me, cr, ch)
                 ON CONFLICT (id) DO NOTHING`,

  saveClaimsReviewed: `INSERT INTO analysis.verification_claims_reviewed
                         (review_id, claim_id)
                       SELECT $1, c FROM unnest($2::text[]) AS batch(c)
                       ON CONFLICT DO NOTHING`,

  saveRiskFindings: `INSERT INTO analysis.risk_findings
                       (review_id, ordinal, kind, detail, severity,
                        implication, mitigated_by)
                     SELECT $1, o, k, d, s, i, m
                     FROM unnest($2::int[], $3::text[], $4::text[], $5::text[],
                                 $6::text[], $7::text[])
                          AS batch(o, k, d, s, i, m)
                     ON CONFLICT DO NOTHING`,

  saveRiskLimits: `INSERT INTO analysis.risk_limits (review_id, ordinal, limit_text)
                   SELECT $1, o, t
                   FROM unnest($2::int[], $3::text[]) AS batch(o, t)
                   ON CONFLICT DO NOTHING`,

  saveChallenge: `INSERT INTO analysis.challenges
                    (id, review_id, contests_claim_id, contests_thesis_id, kind,
                     argument, would_be_resolved_by, outcome, materiality, resolved_by)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                  ON CONFLICT (id) DO UPDATE
                    SET outcome = EXCLUDED.outcome,
                        resolved_by = EXCLUDED.resolved_by`,

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

  /**
   * How many times a verdict may lose the race for a position before giving up.
   *
   * Bounded rather than open: a loop that reallocated forever would turn a
   * stuck row into a hung transaction holding a connection. Five is far beyond
   * the number of control functions that can file on one revision at one
   * instant, so exhausting it means something other than contention.
   */
  const SEQUENCE_ATTEMPTS = 5

  /**
   * Writes the review, and reports whether it was new.
   *
   * `null` means the act is already recorded — a replay, or the same reviewer's
   * same verdict at the same instant — and the caller then skips the children,
   * matching the in-memory adapter, which discards the whole submission.
   *
   * A `reviews_sequence_unique` collision is neither: it means another verdict
   * took this position between the read and the write, and both reviews are
   * real. The position is reallocated inside a savepoint and the insert
   * retried, so both commit and the order is whatever the database decided —
   * deterministic afterwards, because `sequence` is a total order.
   *
   * A savepoint is what makes retrying possible at all: a constraint violation
   * aborts the whole transaction otherwise, and the command has already written
   * events and assignment state by this point.
   */
  async function insertReview(
    client: Queryable,
    kind: ReviewKind,
    review: ReviewScope & ReviewAttribution & ReviewRecordId & ReviewOrder,
    status: string | null,
    detail: unknown,
    operation: string,
  ): Promise<string | null> {
    const id = review.reviewId
    const revisionId = review.scope === 'thesis-revision' ? review.revisionId : null
    let sequence = review.sequence

    for (let attempt = 0; attempt < SEQUENCE_ATTEMPTS; attempt += 1) {
      await client.query(`SAVEPOINT review_insert`)
      try {
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
            revisionId,
            review.byEmployeeId,
            review.byDepartmentId,
            review.at,
            status,
            JSON.stringify(detail ?? {}),
            sequence,
            review.supersedesReviewId ?? null,
            review.reason ?? null,
          ],
        )
        await client.query(`RELEASE SAVEPOINT review_insert`)
        return inserted.length > 0 ? id : null
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT review_insert`)
        if (!(error instanceof DuplicateRecordError)) throw error

        if (error.constraint === 'reviews_sequence_unique') {
          if (!revisionId) throw error
          const next = await run<{ next: number }>(
            client,
            context,
            operation,
            REVIEW_SQL.nextSequence,
            [review.caseId, revisionId, kind],
          )
          const reallocated = Number(next[0]?.next ?? sequence + 1)
          /*
           * Refuse to go backwards or stand still. Either would mean the read
           * disagrees with the constraint, and looping on it would spin.
           */
          if (reallocated <= sequence) throw error
          sequence = reallocated
          continue
        }

        /*
         * The primary key or the natural key: this exact act is already
         * recorded. Idempotent, and the caller skips the children.
         */
        return null
      }
    }

    throw new ConcurrencyConflictError(review.caseId, review.sequence, sequence)
  }

  return {
    nextSequence: ({ caseId, revisionId, kind }) =>
      unitOfWork(scope, 'reviews.nextSequence', async (client) => {
        const rows = await run<{ next: number }>(
          client,
          context,
          'reviews.nextSequence',
          REVIEW_SQL.nextSequence,
          [caseId, revisionId, kind],
        )
        return Number(rows[0]?.next ?? 1)
      }),

    get: (reviewId) =>
      unitOfWork(scope, 'reviews.get', async (client) => {
        const operation = 'reviews.get'
        const rows = await run<ReviewRow>(client, context, operation, REVIEW_SQL.byId, [
          reviewId,
        ])
        const row = rows[0]
        if (!row) return null

        /*
         * The children are fetched per kind rather than always, so reading one
         * verdict costs one statement plus that discipline's own tables — not
         * every governance table in the schema.
         */
        if (row.kind === 'verification') {
          const findings = await run<VerificationFindingRow>(
            client,
            context,
            operation,
            REVIEW_SQL.findings,
            [[row.id]],
          )
          const claims = await run<VerificationClaimReviewedRow>(
            client,
            context,
            operation,
            REVIEW_SQL.claimsReviewed,
            [[row.id]],
          )
          return toVerification(row, findings, claims)
        }
        if (row.kind === 'devils-advocate') {
          const challenges = await run<ChallengeRow>(
            client,
            context,
            operation,
            REVIEW_SQL.challenges,
            [[row.id]],
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
          return toDevilsAdvocate(row, challenges, evidence)
        }
        if (row.kind === 'risk') {
          const findings = await run<RiskFindingRow>(
            client,
            context,
            operation,
            REVIEW_SQL.riskFindings,
            [[row.id]],
          )
          const limits = await run<RiskLimitRow>(
            client,
            context,
            operation,
            REVIEW_SQL.riskLimits,
            [[row.id]],
          )
          return toRisk(row, findings, limits)
        }
        return toCompliance(row)
      }),

    verificationsForCase: (caseId) =>
      unitOfWork(scope, 'reviews.verificationsForCase', async (client) => {
        const operation = 'reviews.verificationsForCase'
        const rows = await rowsFor(client, 'verification', caseId, operation)
        if (rows.length === 0) return []
        const ids = rows.map((row) => row.id)
        const findings = await run<VerificationFindingRow>(
          client,
          context,
          operation,
          REVIEW_SQL.findings,
          [ids],
        )
        const claims = await run<VerificationClaimReviewedRow>(
          client,
          context,
          operation,
          REVIEW_SQL.claimsReviewed,
          [ids],
        )
        const byReview = groupBy(findings, (finding) => finding.review_id)
        const claimsByReview = groupBy(claims, (claim) => claim.review_id)
        return rows.map((row) =>
          toVerification(
            row,
            byReview.get(row.id) ?? [],
            claimsByReview.get(row.id) ?? [],
          ),
        )
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

    riskForCase: (caseId) =>
      unitOfWork(scope, 'reviews.riskForCase', async (client) => {
        const operation = 'reviews.riskForCase'
        const rows = await rowsFor(client, 'risk', caseId, operation)
        if (rows.length === 0) return []
        const ids = rows.map((row) => row.id)
        const findings = await run<RiskFindingRow>(
          client,
          context,
          operation,
          REVIEW_SQL.riskFindings,
          [ids],
        )
        const limits = await run<RiskLimitRow>(
          client,
          context,
          operation,
          REVIEW_SQL.riskLimits,
          [ids],
        )
        const findingsByReview = groupBy(findings, (finding) => finding.review_id)
        const limitsByReview = groupBy(limits, (limit) => limit.review_id)
        return rows.map((row) =>
          toRisk(
            row,
            findingsByReview.get(row.id) ?? [],
            limitsByReview.get(row.id) ?? [],
          ),
        )
      }),

    saveVerification: (review) =>
      unitOfWork(scope, 'reviews.saveVerification', async (client) => {
        const operation = 'reviews.saveVerification'
        const id = await insertReview(
          client,
          'verification',
          review,
          review.status,
          {},
          operation,
        )
        if (!id) return

        if (review.claimsReviewed.length > 0) {
          await run(client, context, operation, REVIEW_SQL.saveClaimsReviewed, [
            id,
            [...review.claimsReviewed],
          ])
        }

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
          findings.map((finding) => finding.severity),
          findings.map((finding) => finding.expected?.amount ?? null),
          findings.map((finding) => finding.expected?.unit ?? null),
          findings.map((finding) => finding.expected?.currency ?? null),
          findings.map((finding) => finding.observed?.amount ?? null),
          findings.map((finding) => finding.observed?.unit ?? null),
          findings.map((finding) => finding.observed?.currency ?? null),
          findings.map((finding) => finding.methodology ?? null),
          findings.map((finding) => finding.correctionRequired ?? null),
          findings.map((finding) => finding.citedContentHash ?? null),
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
            challenge.materiality,
            challenge.resolvedBy ?? null,
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
        const operation = 'reviews.saveRisk'
        const id = await insertReview(
          client,
          'risk',
          review,
          review.status,
          {},
          operation,
        )
        if (!id) return

        const findings = [...review.findings]
        if (findings.length > 0) {
          await run(client, context, operation, REVIEW_SQL.saveRiskFindings, [
            id,
            findings.map((_, index) => index),
            findings.map((finding) => finding.kind),
            findings.map((finding) => finding.detail),
            findings.map((finding) => finding.severity),
            findings.map((finding) => finding.implication ?? null),
            findings.map((finding) => finding.mitigatedBy ?? null),
          ])
        }

        const limits = [...(review.limits ?? [])]
        if (limits.length > 0) {
          await run(client, context, operation, REVIEW_SQL.saveRiskLimits, [
            id,
            limits.map((_, index) => index),
            limits,
          ])
        }
      }),
  }
}

/* ----------------------------------------------------------------- events */

const EVENT_COLUMNS = `
  event_id, subject, case_id, tenant_id, thesis_id, revision_id, assignment_id,
  run_id, review_id, challenge_id, from_state, to_state, actor_employee_id, actor_department_id, reason,
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
              assignment_id, run_id, review_id, challenge_id, from_state, to_state, actor_employee_id,
              actor_department_id, reason, occurred_at, correlation_id,
              causation_id, aggregate_version, corrects)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
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
          event.reviewId ?? null,
          event.challengeId ?? null,
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
