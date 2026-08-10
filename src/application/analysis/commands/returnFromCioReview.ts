/**
 * The CIO sends work back instead of deciding it.
 *
 * The counterpart to `RecordCaseDecision`, and the reason the loop is a loop.
 * A firm that could only decide would answer questions it was not ready to
 * answer, because the alternative on offer would be nothing at all.
 *
 * ## A return is a governance act, not an absence of one
 *
 * It carries the same mandate as a decision, and for the same reason: sending
 * work back changes what the firm does next just as surely as selecting an
 * investment does. Somebody without the authority to decide does not acquire
 * the authority to send the question away.
 *
 * ## It must say what would satisfy it
 *
 * The concerns are required and must be non-empty. A return with no concern is
 * a refusal the desk cannot act on — it names no evidence to gather, no
 * alternative to consider, nothing that would make the next attempt different.
 * That is not a return, it is an unbounded delay wearing one's clothes, and it
 * is precisely how work disappears in real institutions.
 *
 * Each concern names its subject, so "insufficient evidence" points at the
 * claim that lacks it rather than leaving a desk to guess which one.
 *
 * ## The case goes back, not forward
 *
 * `decision -> returned`, and the stage table requires a reason for it. The
 * case leaves the CIO's queue and re-enters the floor's, which is what makes a
 * return survivable: the work is somebody's again.
 */

import {
  buildTransitionEvent,
  transitionCase,
  type CioReturn,
  type Organization,
  type ReturnConcern,
} from '~/domain/analysis'
import type { CommandDefinition } from './definition'
import { reject } from './envelope'
import { deriveEventId } from './eventIdentity'
import { asCanonicalValue } from '~/domain/shared/canonicalValue'

export interface ReturnFromCioReviewInput {
  caseId: string
  /** The submission being sent back. One return answers one submission. */
  submissionId: string
  returnedFor: CioReturn['returnedFor']
  reason: string
  authorizationBasis: string
  /**
   * What must change before this comes back.
   *
   * Required and non-empty: see the header. A return that names nothing
   * actionable cannot be answered, only waited out.
   */
  concerns: readonly ReturnConcern[]
}

export function returnFromCioReview(
  _organization: Organization,
): CommandDefinition<ReturnFromCioReviewInput, CioReturn> {
  return {
    type: 'ReturnFromCioReview',
    versionPolicy: 'requires-expected-version',
    /*
     * The prose reason is required, not optional. `transitionCase` refuses a
     * move to `returned` without one, and the desk reading it needs the
     * sentence as much as the structured concerns.
     */
    reasonPolicy: 'optional',
    category: 'governance',
    /* The same mandate as deciding. Sending work back is deciding not to. */
    mandate: () => ({ kind: 'chief-decision' }),
    scope: (input) => ({ caseId: input.caseId }),
    payload: (input) => ({
      submissionId: input.submissionId,
      returnedFor: input.returnedFor,
      reason: input.reason,
      authorizationBasis: input.authorizationBasis,
      concerns: asCanonicalValue(input.concerns),
    }),

    async execute(repositories, context, input) {
      const investmentCase = await repositories.cases.get(input.caseId)
      if (!investmentCase) {
        reject('not-found', `Case "${input.caseId}" no longer exists.`)
      }

      const accountable = context.actor.employeeId
      const actingDepartment = context.actor.departmentId
      if (accountable === null || actingDepartment === null) {
        reject(
          'unknown-actor',
          'A return must name the employee who sent the work back and the ' +
            'department they acted for. Work does not come back from nobody.',
        )
      }

      /* ------------------------------------------------ what is returned */

      if (input.concerns.length === 0) {
        reject(
          'invariant-violated',
          'A return must name at least one concern. A return that names nothing ' +
            'to address cannot be answered, and leaves the desk with no way to ' +
            'know what a second attempt should change.',
        )
      }

      const submission = await repositories.submissions.get(input.submissionId)
      if (!submission) {
        reject('not-found', `No submission "${input.submissionId}".`)
      }

      if (submission.caseId !== input.caseId) {
        reject(
          'invariant-violated',
          `Submission "${input.submissionId}" belongs to case ` +
            `"${submission.caseId}", not "${input.caseId}". A return may only ` +
            `send back its own case's work.`,
        )
      }

      if (submission.state !== 'pending') {
        reject(
          'illegal-prior-state',
          `Submission "${input.submissionId}" is already ${submission.state}. ` +
            `Work that has been settled is not sent back a second time.`,
        )
      }

      /* ------------------------------------------------------ the record */

      const returnId = deriveEventId({
        commandId: context.commandId,
        recordType: 'cio-return',
        entityId: input.submissionId,
      })

      /*
       * One save. `recordReturn` records the return and settles its submission
       * together -- a return that did not settle would leave the case pending
       * before a CIO who has already answered it.
       */
      const saved = await repositories.submissions.recordReturn({
        id: returnId,
        submissionId: input.submissionId,
        caseId: input.caseId,
        revisionId: submission.revisionId,
        returnedAt: context.occurredAt,
        returnedBy: context.actor,
        authorizationBasis: input.authorizationBasis,
        returnedFor: input.returnedFor,
        reason: input.reason,
        caseVersion: investmentCase.version,
        concerns: [...input.concerns],
      })

      /*
       * `decision -> returned`. The reason is passed because the stage table
       * requires one for this move specifically: a case can be stuck without
       * explanation by accident, but it cannot be sent back without one.
       */
      const savedCase = await repositories.cases.save(
        transitionCase(investmentCase, 'returned', {
          employeeId: accountable,
          departmentId: actingDepartment,
          at: context.occurredAt,
          reason: input.reason,
        }),
        context.expectedVersion!,
      )

      await repositories.events.append(
        buildTransitionEvent({
          eventId: deriveEventId({
            commandId: context.commandId,
            recordType: 'cio-return-recorded',
            entityId: input.caseId,
          }),
          caseId: input.caseId,
          subject: 'case',
          revisionId: submission.revisionId,
          fromState: investmentCase.stage,
          toState: savedCase.stage,
          occurredAt: context.occurredAt,
          actorEmployeeId: accountable,
          actorDepartmentId: actingDepartment,
          correlationId: context.correlationId,
          aggregateVersion: savedCase.version,
          reason: input.reason,
        }),
      )

      return { value: saved, resultKind: 'cio-return', resultRef: saved.id }
    },

    async rehydrate(repositories, resultRef) {
      const found = await repositories.submissions.getReturn(resultRef)
      if (!found) {
        throw new Error(
          `Return "${resultRef}" was committed by this command but no longer ` +
            `reads back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
