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
  VERIFICATION_CANDIDATE_CANONICALIZATION_VERSION,
  verificationCandidateHashMatches,
  type AgentRunRecord,
  type GovernanceCandidateBasis,
  type Organization,
  type VerificationFinding,
  type VerificationReview,
  type VerificationStatus,
} from '~/domain/analysis'
import type { TransactionalAnalysisRepositories } from '../repositories'
import type { CanonicalValue } from '~/domain/shared/canonicalValue'
import {
  accountablePrincipal,
  candidateReadyToFile,
  claimsInScopeOf,
  completeProducingWork,
  placeVerdict,
  requireReasonForChangedVerdict,
} from '../reviewRecording'
import { deriveEventId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'
import { utf8ByteOrder } from '~/domain/shared/canonicalValue'

/**
 * The semantic payload, in one of two shapes because there are two acts.
 *
 * The direct one is byte-for-byte what it always was, so every historical
 * verdict keeps the identity it was recorded under. The filed one is the
 * candidate reference and nothing else — and it is STRONGER, not weaker: the
 * candidate is immutable and its hash covers the verdict and the institutional
 * basis together, so the payload is content-bound rather than a hash of prose
 * the caller could have retyped.
 */
function verificationPayload(
  input: RecordVerificationReviewInput,
): Record<string, CanonicalValue> {
  if (input.candidateFromRunId !== undefined) {
    return {
      byDepartmentId: input.byDepartmentId,
      candidateFromRunId: input.candidateFromRunId,
      supersedesReviewId: input.supersedesReviewId ?? null,
    }
  }
  return {
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
  }
}

/**
 * Loads the candidate this act files, and refuses it if it cannot still be.
 *
 * Everything institutional comes from here: the revision, the claims, the
 * verdict. The caller supplied a reference and nothing else, so there is no
 * second version of any of it to disagree with.
 */
async function loadVerificationCandidate(
  repositories: TransactionalAnalysisRepositories,
  caseId: string,
  byDepartmentId: string,
  candidateFromRunId: string,
): Promise<{
  runId: string
  run: AgentRunRecord
  basis: GovernanceCandidateBasis
  verdict: {
    thesisId: string
    revisionId: string
    status: VerificationStatus
    findings: readonly VerificationFinding[]
    claimsReviewed: readonly string[]
  }
}> {
  const candidate = await repositories.producedVerifications.get(candidateFromRunId)
  if (!candidate) {
    reject(
      'not-found',
      `Run "${candidateFromRunId}" produced no verification candidate. There ` +
        `is nothing to file.`,
    )
  }

  const adoption = await candidateReadyToFile(repositories, {
    caseId,
    byDepartmentId,
    runId: candidateFromRunId,
    basis: candidate.basis,
    hashMatches: verificationCandidateHashMatches(candidate),
    knownCanonicalization:
      candidate.canonicalizationVersion ===
      String(VERIFICATION_CANDIDATE_CANONICALIZATION_VERSION),
    refuse: reject,
  })

  return {
    runId: adoption.runId,
    run: adoption.run,
    basis: adoption.basis,
    verdict: {
      thesisId: candidate.basis.thesisId,
      revisionId: candidate.basis.sourceRevisionId,
      status: candidate.artifact.status,
      findings: candidate.artifact.findings,
      claimsReviewed: candidate.artifact.claimsReviewed,
    },
  }
}

/** Findings that assert the cited evidence has changed since it was cited. */
const EVIDENCE_MOVED_KINDS: readonly VerificationFinding['kind'][] = [
  'revised-evidence',
  'stale-evidence',
] as const

/**
 * A verdict a human verifier authors in this act.
 *
 * Unchanged, deliberately. A person can read the claims and state a verdict
 * they stand behind in one act; requiring them to produce a candidate first and
 * file it second would be ceremony, and would mean manufacturing candidate
 * records for work no model produced.
 */
export interface DirectVerificationInput {
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
  /** Absent: nothing is being filed, because this verdict is being written. */
  candidateFromRunId?: undefined
}

/**
 * A verdict the Verification function files, having produced it as a candidate.
 *
 * The reference is the whole input, and every other field is `never`. That is
 * the point: a caller cannot name candidate A and supply verdict B, so a
 * candidate cannot survive as decorative provenance beside a verdict it does
 * not match. The command loads the immutable candidate and institutionalises
 * exactly what it holds.
 *
 * The revision and the claims come from the candidate's basis rather than from
 * the caller, for the same reason.
 */
export interface FiledVerificationInput {
  caseId: string
  byDepartmentId: string
  /** The run whose produced verdict this act files. */
  candidateFromRunId: string
  supersedesReviewId?: string

  thesisId?: undefined
  revisionId?: undefined
  status?: undefined
  findings?: undefined
  claimsReviewed?: undefined
}

export type RecordVerificationReviewInput =
  DirectVerificationInput | FiledVerificationInput

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
    /*
     * The filed path names no revision here, because it does not know one yet:
     * the revision is the candidate's, and reading it would mean loading the
     * candidate before the ledger entry exists. The case is what this act
     * targets either way, and the revision is recoverable through the candidate
     * the review names.
     */
    scope: (input) => ({
      caseId: input.caseId,
      ...(input.revisionId ? { thesisRevisionId: input.revisionId } : {}),
    }),
    /*
     * Two payload shapes, because there are two acts.
     *
     * The direct one is byte-for-byte what it always was, so every historical
     * verdict keeps the identity it was recorded under. The filed one is the
     * candidate reference and nothing else — and it is STRONGER, not weaker:
     * the candidate is immutable and its hash covers the verdict and the
     * institutional basis together, so the payload is content-bound rather than
     * a hash of prose the caller could have retyped.
     */
    payload: verificationPayload,

    async execute(repositories, context, input) {
      if (input.byDepartmentId !== 'verification') {
        reject(
          'not-authorised',
          `"${input.byDepartmentId}" is not the Verification department. Only ` +
            `Verification records a verification verdict, whatever authority ` +
            `the caller declared.`,
        )
      }

      /* ------------------------------------------------- what is being filed */

      /*
       * On the filed path the verdict comes from the immutable candidate and
       * from nowhere else. `adoption` is null for a person authoring directly,
       * which is what keeps that path exactly as it was.
       */
      const adoption = input.candidateFromRunId
        ? await loadVerificationCandidate(
            repositories,
            input.caseId,
            input.byDepartmentId,
            input.candidateFromRunId,
          )
        : null

      const verdict = adoption?.verdict ?? {
        thesisId: input.thesisId!,
        revisionId: input.revisionId!,
        status: input.status!,
        findings: input.findings!,
        claimsReviewed: input.claimsReviewed!,
      }

      /* A refusal owes an explanation — see the Risk command. */
      if (verdict.status === 'blocked' && !context.reason?.trim()) {
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
          revisionId: verdict.revisionId,
          thesisId: verdict.thesisId,
          byDepartmentId: input.byDepartmentId,
          kind: 'verification',
          playbookEntryKey: 'verification',
          status: verdict.status,
          ...(input.supersedesReviewId
            ? { supersedesReviewId: input.supersedesReviewId }
            : {}),
        },
        existing,
      )

      requireReasonForChangedVerdict(
        placement.superseded as { status?: string } | null,
        verdict.status,
        context.reason,
      )

      /* ------------------------------------------------------ the findings */

      const inScope = await claimsInScopeOf(repositories, placement.revision)
      const findings: VerificationFinding[] = []
      for (const finding of verdict.findings) {
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
        if (!verdict.claimsReviewed.includes(stored.id)) continue
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
        thesisId: verdict.thesisId,
        revisionId: verdict.revisionId,
        reviewId: placement.reviewId,
        sequence: placement.sequence,
        /*
         * Exactly one accountable principal, taken from whoever acted. The
         * `employeeId!` this used to assert would have written `null` into a
         * NOT NULL column the moment an agent filed — the measured gap E3 left
         * open.
         */
        ...accountablePrincipal(context),
        byDepartmentId: input.byDepartmentId,
        at: context.occurredAt,
        status: verdict.status,
        findings,
        claimsReviewed: [...verdict.claimsReviewed],
        ...(adoption ? { filedFromCandidateRunId: adoption.runId } : {}),
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
        (verdict.status === 'verified' ||
          verdict.status === 'verified-with-qualifications')
      if (passed && placement.revision.lifecycle === 'awaiting-verification') {
        await repositories.theses.save({ ...placement.revision, lifecycle: 'verified' })
      }

      /*
       * Filing completes the producing run and the assignment it discharged.
       *
       * The other half of adoption, in the same transaction as the verdict. A
       * candidate was adopted if and only if this filing succeeded, so a
       * persisted state where the review exists and the run still reads
       * `awaiting-acceptance` must not be reachable — nor one where the run
       * completed and the verdict did not persist.
       */
      if (adoption) {
        await completeProducingWork(repositories, context, adoption)
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
          thesisId: verdict.thesisId,
          revisionId: verdict.revisionId,
          reviewId: placement.reviewId,
          fromState: null,
          toState: verdict.status,
          occurredAt: context.occurredAt,
          actorEmployeeId: context.actor.employeeId ?? undefined,
          actorAgentPrincipalId: context.actor.agentPrincipalId ?? undefined,
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
            thesisId: verdict.thesisId,
            revisionId: verdict.revisionId,
            reviewId: placement.reviewId,
            fromState: null,
            toState: 'correction-required',
            occurredAt: context.occurredAt,
            actorEmployeeId: context.actor.employeeId ?? undefined,
            actorAgentPrincipalId: context.actor.agentPrincipalId ?? undefined,
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
            thesisId: verdict.thesisId,
            revisionId: verdict.revisionId,
            reviewId: placement.superseded.reviewId,
            fromState: 'current',
            toState: 'superseded',
            occurredAt: context.occurredAt,
            actorEmployeeId: context.actor.employeeId ?? undefined,
            actorAgentPrincipalId: context.actor.agentPrincipalId ?? undefined,
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
