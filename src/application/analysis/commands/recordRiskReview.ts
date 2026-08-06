/**
 * What the firm is exposed to if the argument is wrong.
 *
 * Risk speaks about consequences, never about correctness. It has no field that
 * could change the thesis, its claims, its implications or the manager's
 * dispositions — and that is structural rather than a convention: the input
 * carries a status, findings and limits, and nothing else.
 *
 * ## The requirement comes first, and a verdict cannot create it
 *
 * Risk may only review where `ResolveConditionalRequirement` has recorded, for
 * THIS exact revision, that Risk applies. Recording a verdict against an
 * unresolved or not-required revision is refused — otherwise a Risk review
 * would establish its own mandate, and "was Risk required here?" would be
 * answerable only by observing that Risk turned up.
 *
 * The reverse inference is refused in the gate rather than here: the absence of
 * a Risk review never means Risk was not required. Both directions are
 * conclusions drawn from an absence, and both are how a governance gate gets
 * skipped by accident.
 */

import {
  buildRiskVerdict,
  buildTransitionEvent,
  requirementStatusFor,
  type Organization,
  type RiskFinding,
  type RiskReview,
  type RiskStatus,
} from '~/domain/analysis'
import {
  placeVerdict,
  requireReasonForChangedVerdict,
  RISK_ENTRY_KEY,
} from '../reviewRecording'
import { deriveEventId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'
import { utf8ByteOrder } from '~/domain/shared/canonicalValue'

export interface RecordRiskReviewInput {
  caseId: string
  thesisId: string
  revisionId: string
  byDepartmentId: string
  status: RiskStatus
  findings: readonly RiskFinding[]
  /** Position or exposure limits attached as a condition of acceptance. */
  limits?: readonly string[]
  supersedesReviewId?: string
}

export function recordRiskReview(
  _organization: Organization,
): CommandDefinition<RecordRiskReviewInput, RiskReview> {
  return {
    type: 'RecordRiskReview',
    versionPolicy: 'refuses-expected-version',
    reasonPolicy: 'optional',
    category: 'governance',
    mandate: () => ({ kind: 'governance-verdict', discipline: 'risk' }),
    scope: (input) => ({ caseId: input.caseId, thesisRevisionId: input.revisionId }),
    payload: (input) => ({
      revisionId: input.revisionId,
      thesisId: input.thesisId,
      byDepartmentId: input.byDepartmentId,
      status: input.status,
      findings: [...input.findings]
        .map((finding) => ({
          kind: finding.kind,
          detail: finding.detail,
          severity: finding.severity,
        }))
        .sort((a, b) => utf8ByteOrder(`${a.kind}${a.detail}`, `${b.kind}${b.detail}`)),
      limits: input.limits ? [...input.limits].sort(utf8ByteOrder) : null,
      supersedesReviewId: input.supersedesReviewId ?? null,
    }),

    async execute(repositories, context, input) {
      if (input.byDepartmentId !== 'risk') {
        reject(
          'not-authorised',
          `"${input.byDepartmentId}" is not the Risk department. Only Risk issues ` +
            `the Risk verdict, whatever authority the caller declared.`,
        )
      }

      /*
       * Checked before the verdict is looked at. A Risk review that could be
       * recorded first and justified afterwards is a Risk review that
       * establishes its own mandate.
       */
      const resolutions = await repositories.requirements.listForCase(input.caseId)
      const status = requirementStatusFor(RISK_ENTRY_KEY, input.revisionId, resolutions)
      if (status.state === 'unresolved') {
        reject(
          'illegal-prior-state',
          `Nobody has resolved whether Risk applies to revision ` +
            `"${input.revisionId}". A verdict recorded now would be the answer to ` +
            `a question the firm never asked.`,
        )
      }
      if (status.state === 'not-required') {
        reject(
          'illegal-prior-state',
          `Risk was recorded as not required for revision "${input.revisionId}". ` +
            `Recording a verdict anyway would let the Risk desk create its own ` +
            `mandate; resolve the requirement to "required" first.`,
        )
      }

      /*
       * A refusal owes an explanation. The domain enforces it at the event —
       * work does not stall anonymously — and catching it here turns an
       * operational failure into a rejection the caller can act on.
       */
      if (input.status === 'rejected' && !context.reason?.trim()) {
        reject(
          'invariant-violated',
          `A rejected Risk verdict states no reason. The desk whose work is ` +
            `stopped has to be able to read why.`,
        )
      }

      const existing = await repositories.reviews.riskForCase(input.caseId)
      const placement = await placeVerdict(
        repositories,
        context,
        {
          caseId: input.caseId,
          revisionId: input.revisionId,
          thesisId: input.thesisId,
          byDepartmentId: input.byDepartmentId,
          kind: 'risk',
          playbookEntryKey: RISK_ENTRY_KEY,
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

      /*
       * Findings name an implication of the revision where they name one at
       * all. A concern about an implication the thesis does not carry is a
       * concern about a different argument.
       */
      const implications = new Set(placement.revision.implications.map(String))
      for (const finding of input.findings) {
        if (finding.implication && !implications.has(finding.implication)) {
          reject(
            'invariant-violated',
            `Risk finding names implication "${finding.implication}", which this ` +
              `revision does not carry.`,
          )
        }
      }

      let verdict
      try {
        verdict = buildRiskVerdict({
          status: input.status,
          findings: [...input.findings],
          ...(input.limits ? { limits: [...input.limits] } : {}),
        })
      } catch (error) {
        reject(
          'invariant-violated',
          error instanceof Error ? error.message : String(error),
        )
      }

      /* -------------------------------------------------------- the write */

      const review: RiskReview = {
        scope: 'thesis-revision',
        caseId: input.caseId,
        thesisId: input.thesisId,
        revisionId: input.revisionId,
        reviewId: placement.reviewId,
        sequence: placement.sequence,
        byEmployeeId: context.actor.employeeId!,
        byDepartmentId: input.byDepartmentId,
        at: context.occurredAt,
        ...verdict,
        ...(input.supersedesReviewId
          ? { supersedesReviewId: input.supersedesReviewId }
          : {}),
        ...(context.reason ? { reason: context.reason } : {}),
      }
      await repositories.reviews.saveRisk(review)

      /*
       * The case version the verdict was recorded AGAINST, not one it moved.
       * A governance verdict does not advance case workflow — which is what
       * refusing an expectedVersion says — and stamping a bumped version would
       * read as a movement nobody made.
       */
      const caseVersion = (await repositories.cases.get(input.caseId))?.version ?? 0

      /* ------------------------------------------------------- the events */

      await repositories.events.append(
        buildTransitionEvent({
          eventId: deriveEventId({
            commandId: context.commandId,
            recordType: 'risk-review-completed',
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
      const found = (await repositories.reviews.get(resultRef)) as RiskReview
      if (!found) {
        throw new Error(
          `Risk review "${resultRef}" was committed by this command but no ` +
            `longer reads back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
