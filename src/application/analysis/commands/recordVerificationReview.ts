/**
 * What the Fact Checker found, against one exact revision.
 *
 * Verification answers whether the analysis is factually, numerically,
 * evidentially and methodologically correct. Not whether it is a good idea —
 * that is the Devil's Advocate — and not whether the firm can carry it, which
 * is Risk.
 *
 * ## Why it is not version-guarded
 *
 * Verification and the Devil's Advocate review the same immutable revision
 * concurrently, and neither touches anything the other does. Guarding both on
 * the case version would make whichever committed second fail over a conflict
 * that does not exist. Protection comes from the review's own identity, the
 * sequence constraint and command idempotency — none of which serialise one
 * discipline against another.
 *
 * ## Evidence that moved
 *
 * A claim cites evidence by content hash. Where the stored evidence no longer
 * hashes to what the claim cited, the source has been revised under the
 * argument, and this command refuses a verdict that is silent about it. It does
 * not invent the finding — whether a revision matters is the verifier's
 * judgement — it refuses a clean bill of health on evidence that moved.
 */

import {
  buildTransitionEvent,
  buildVerificationFinding,
  type Organization,
  type VerificationFinding,
  type VerificationReview,
  type VerificationStatus,
} from '~/domain/analysis'
import {
  claimsInScopeOf,
  placeVerdict,
  requireReasonForChangedVerdict,
} from '../reviewRecording'
import { deriveEventId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'
import { utf8ByteOrder } from '~/domain/shared/canonicalValue'

/** Findings that assert the cited evidence has changed since it was cited. */
const EVIDENCE_MOVED_KINDS: readonly VerificationFinding['kind'][] = [
  'revised-evidence',
  'stale-evidence',
] as const

export interface RecordVerificationReviewInput {
  caseId: string
  thesisId: string
  /** The exact revision reviewed. Never a lineage. */
  revisionId: string
  byDepartmentId: string
  status: VerificationStatus
  findings: readonly VerificationFinding[]
  /** The claims actually checked, so an unchecked claim reads as unchecked. */
  claimsReviewed: readonly string[]
  /** Set when this replaces an earlier verdict of the same discipline. */
  supersedesReviewId?: string
}

export function recordVerificationReview(
  _organization: Organization,
): CommandDefinition<RecordVerificationReviewInput, VerificationReview> {
  return {
    type: 'RecordVerificationReview',
    versionPolicy: 'refuses-expected-version',
    /* Required only when a re-review changes the answer — checked in execute. */
    reasonPolicy: 'optional',
    category: 'governance',
    mandate: () => ({ kind: 'governance-verdict', discipline: 'verification' }),
    scope: (input) => ({ caseId: input.caseId, thesisRevisionId: input.revisionId }),
    payload: (input) => ({
      revisionId: input.revisionId,
      thesisId: input.thesisId,
      byDepartmentId: input.byDepartmentId,
      status: input.status,
      claimsReviewed: [...input.claimsReviewed].sort(utf8ByteOrder),
      findings: [...input.findings]
        .map((finding) => ({
          kind: finding.kind,
          claimId: finding.claimId,
          detail: finding.detail,
          blocking: finding.blocking,
          severity: finding.severity,
        }))
        .sort((a, b) => utf8ByteOrder(`${a.claimId}${a.kind}`, `${b.claimId}${b.kind}`)),
      supersedesReviewId: input.supersedesReviewId ?? null,
    }),

    async execute(repositories, context, input) {
      if (input.byDepartmentId !== 'verification') {
        reject(
          'not-authorised',
          `"${input.byDepartmentId}" is not the Verification department. Only ` +
            `Verification records a verification verdict, whatever authority ` +
            `the caller declared.`,
        )
      }

      /* A refusal owes an explanation — see the Risk command. */
      if (input.status === 'blocked' && !context.reason?.trim()) {
        reject(
          'invariant-violated',
          `A blocked verification states no reason. The desk whose work is ` +
            `stopped has to be able to read why.`,
        )
      }

      const existing = await repositories.reviews.verificationsForCase(input.caseId)
      const placement = await placeVerdict(
        repositories,
        context,
        {
          caseId: input.caseId,
          revisionId: input.revisionId,
          thesisId: input.thesisId,
          byDepartmentId: input.byDepartmentId,
          kind: 'verification',
          playbookEntryKey: 'verification',
          status: input.status,
          ...(input.supersedesReviewId
            ? { supersedesReviewId: input.supersedesReviewId }
            : {}),
        },
        existing,
      )

      requireReasonForChangedVerdict(
        placement.superseded as { status?: string } | null,
        input.status,
        context.reason,
      )

      /* ------------------------------------------------------ the findings */

      const inScope = await claimsInScopeOf(repositories, placement.revision)
      const findings: VerificationFinding[] = []
      for (const finding of input.findings) {
        if (inScope.size > 0 && !inScope.has(finding.claimId)) {
          reject(
            'invariant-violated',
            `Finding on claim "${finding.claimId}" names a claim the manager did ` +
              `not put in this revision's scope. Governance reviews the argument ` +
              `the firm made, not work beside it.`,
          )
        }
        try {
          findings.push(buildVerificationFinding(finding))
        } catch (error) {
          reject(
            'invariant-violated',
            error instanceof Error ? error.message : String(error),
          )
        }
      }

      /*
       * The evidence-change check. Every ref a finding cites is compared with
       * the stored evidence item's current hash; a mismatch the verdict has not
       * reported is refused.
       */
      const reportedMoved = new Set(
        findings
          .filter((finding) => EVIDENCE_MOVED_KINDS.includes(finding.kind))
          .map((finding) => finding.claimId),
      )
      const claims = await repositories.claims.listForCase(input.caseId)
      for (const stored of claims) {
        if (inScope.size > 0 && !inScope.has(stored.id)) continue
        if (!input.claimsReviewed.includes(stored.id)) continue
        for (const ref of stored.evidenceRefs) {
          const set = await repositories.evidence.get(ref.setId)
          const item = set?.items.find(
            (candidate) => candidate.ref.id === ref.observationId,
          )
          if (!item) continue
          if (item.ref.contentHash === ref.contentHash) continue
          if (reportedMoved.has(stored.id)) continue
          reject(
            'invariant-violated',
            `Claim "${stored.id}" cites observation "${ref.observationId}" at ` +
              `hash "${ref.contentHash}", and the stored evidence now hashes to ` +
              `"${item.ref.contentHash}". The source moved after the claim was ` +
              `made; a verdict that does not report it would certify a number ` +
              `nobody re-checked.`,
          )
        }
      }

      /* -------------------------------------------------------- the write */

      const review: VerificationReview = {
        scope: 'thesis-revision',
        caseId: input.caseId,
        thesisId: input.thesisId,
        revisionId: input.revisionId,
        reviewId: placement.reviewId,
        sequence: placement.sequence,
        byEmployeeId: context.actor.employeeId!,
        byDepartmentId: input.byDepartmentId,
        at: context.occurredAt,
        status: input.status,
        findings,
        claimsReviewed: [...input.claimsReviewed],
        ...(input.supersedesReviewId
          ? { supersedesReviewId: input.supersedesReviewId }
          : {}),
        ...(context.reason ? { reason: context.reason } : {}),
      }
      await repositories.reviews.saveVerification(review)

      /*
       * A passing verdict moves the revision along its OWN axis:
       * `awaiting-verification → verified` is what the lifecycle word means.
       * Not an eligibility decision — `verified` is necessary and nowhere near
       * sufficient, and `evaluateRevisionEligibility` still has to agree about
       * Risk, challenges and the manager's unresolved disagreements.
       *
       * A blocking verdict leaves the revision where it is. It is not sent back
       * to `under-analysis`, because a correction produces a NEW revision
       * through a new aggregation; moving this one would suggest the reviewed
       * argument could be edited into shape.
       */
      const passed =
        !findings.some((finding) => finding.blocking) &&
        (input.status === 'verified' || input.status === 'verified-with-qualifications')
      if (passed && placement.revision.lifecycle === 'awaiting-verification') {
        await repositories.theses.save({ ...placement.revision, lifecycle: 'verified' })
      }

      /*
       * The case version the verdict was recorded AGAINST, not one it moved.
       * A governance verdict does not advance case workflow — which is what
       * refusing an expectedVersion says — and stamping a bumped version would
       * read as a movement nobody made.
       */
      const caseVersion = (await repositories.cases.get(input.caseId))?.version ?? 0

      /* ------------------------------------------------------- the events */

      const blocking = findings.filter((finding) => finding.blocking)
      await repositories.events.append(
        buildTransitionEvent({
          eventId: deriveEventId({
            commandId: context.commandId,
            recordType: 'verification-completed',
            entityId: placement.reviewId,
          }),
          caseId: input.caseId,
          subject: 'review',
          thesisId: input.thesisId,
          revisionId: input.revisionId,
          reviewId: placement.reviewId,
          fromState: null,
          toState: input.status,
          occurredAt: context.occurredAt,
          actorEmployeeId: context.actor.employeeId ?? undefined,
          actorDepartmentId: context.actor.departmentId ?? undefined,
          correlationId: context.correlationId,
          aggregateVersion: caseVersion,
          ...(context.reason ? { reason: context.reason } : {}),
        }),
      )

      if (blocking.length > 0) {
        await repositories.events.append(
          buildTransitionEvent({
            eventId: deriveEventId({
              commandId: context.commandId,
              recordType: 'verification-correction-required',
              entityId: placement.reviewId,
            }),
            caseId: input.caseId,
            subject: 'review',
            thesisId: input.thesisId,
            revisionId: input.revisionId,
            reviewId: placement.reviewId,
            fromState: null,
            toState: 'correction-required',
            occurredAt: context.occurredAt,
            actorEmployeeId: context.actor.employeeId ?? undefined,
            actorDepartmentId: context.actor.departmentId ?? undefined,
            correlationId: context.correlationId,
            aggregateVersion: caseVersion,
          }),
        )
      }

      if (placement.superseded) {
        await repositories.events.append(
          buildTransitionEvent({
            eventId: deriveEventId({
              commandId: context.commandId,
              recordType: 'governance-verdict-superseded',
              entityId: placement.superseded.reviewId,
            }),
            caseId: input.caseId,
            subject: 'review',
            thesisId: input.thesisId,
            revisionId: input.revisionId,
            reviewId: placement.superseded.reviewId,
            fromState: 'current',
            toState: 'superseded',
            occurredAt: context.occurredAt,
            actorEmployeeId: context.actor.employeeId ?? undefined,
            actorDepartmentId: context.actor.departmentId ?? undefined,
            correlationId: context.correlationId,
            aggregateVersion: caseVersion,
          }),
        )
      }

      return { value: review, resultKind: 'review', resultRef: placement.reviewId }
    },

    async rehydrate(repositories, resultRef) {
      const found = (await repositories.reviews.get(resultRef)) as VerificationReview
      if (!found) {
        throw new Error(
          `Verification review "${resultRef}" was committed by this command but ` +
            `no longer reads back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
