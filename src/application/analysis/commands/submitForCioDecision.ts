/**
 * Puts a revision in front of the CIO, or explains precisely why it cannot go.
 *
 * The command does not judge. It assembles the facts, hands them to the domain
 * with the policy in force, and acts on what comes back — which is the same
 * separation the whole institution rests on: specialists record, assembly
 * gathers and applies policy, the CIO decides.
 *
 * ## A refusal names every gate, not the first
 *
 * A rejection carries the complete gate report. "Verification incomplete" and
 * "verification incomplete, everything else clear" are different situations for
 * whoever has to fix it, and a command that reported only the first failure
 * would send a desk round the loop once per gate.
 *
 * The codes are **stable domain vocabulary** — `VERIFICATION_INCOMPLETE`, not a
 * sentence. Logs, the UI and later an agent map them to their own wording, and
 * none of them couples to prose someone may want to rewrite.
 *
 * ## Why the policy is an input
 *
 * The caller selects the policy in force for this submission. Nothing here
 * falls back to v1 or looks up "the current one": the policy version is part of
 * what the submission attests, and a default would be a second place the firm's
 * line is drawn.
 */

import {
  assertCioSubmissionWellFormed,
  buildTransitionEvent,
  eligibilityPolicy,
  transitionCase,
  type CioSubmission,
  type Organization,
} from '~/domain/analysis'
import type { CommandDefinition } from './definition'
import { reject } from './envelope'
import { deriveEventId } from './eventIdentity'
import { assembleEligibilityBasis } from '../assembleEligibilityBasis'

export interface SubmitForCioDecisionInput {
  caseId: string
  thesisId: string
  revisionId: string
  submittedByDepartmentId: string
  /**
   * The eligibility policy this submission is made under.
   *
   * Explicit because it is part of the record: the basis stores it, and every
   * later re-examination of this decision resolves the same version.
   */
  eligibilityPolicyVersion: string
}

export function submitForCioDecision(
  _organization: Organization,
): CommandDefinition<SubmitForCioDecisionInput, CioSubmission> {
  return {
    type: 'SubmitForCioDecision',
    versionPolicy: 'requires-expected-version',
    reasonPolicy: 'optional',
    /*
     * Workflow, not governance. Asking for a decision is moving work; filing
     * the request as governance would make it look like the verdict it asks
     * for -- the same reason `SubmitForVerification` is not governance either.
     */
    category: 'workflow',
    /*
     * A desk act, not a CIO act. Submitting is asking for a decision; making
     * one is `RecordCaseDecision`, and it carries the CIO mandate.
     */
    mandate: (input) => ({
      kind: 'thesis-owner',
      proposedByDepartmentId: input.submittedByDepartmentId,
    }),
    scope: (input) => ({ caseId: input.caseId, thesisRevisionId: input.revisionId }),
    payload: (input) => ({
      revisionId: input.revisionId,
      thesisId: input.thesisId,
      submittedByDepartmentId: input.submittedByDepartmentId,
      eligibilityPolicyVersion: input.eligibilityPolicyVersion,
    }),

    async execute(repositories, context, input) {
      /* ------------------------------------------------ preconditions */

      const existing = await repositories.submissions.applicableForRevision(
        input.revisionId,
      )
      if (existing.some((submission) => submission.state === 'pending')) {
        reject(
          'illegal-prior-state',
          `ALREADY_SUBMITTED: revision "${input.revisionId}" already has a ` +
            `submission awaiting a CIO decision.`,
        )
      }

      /* ---------------------------------------------------- the facts */

      /*
       * Derived before assembly, because the basis manifest is bound to it.
       * Building the manifest against anything else -- the revision id, which
       * is what this did until the end-to-end flow ran -- produces an
       * attestation for a record that does not exist, and the submission is
       * refused by its own validator.
       */
      const submissionId = deriveEventId({
        commandId: context.commandId,
        recordType: 'cio-submission',
        entityId: input.revisionId,
      })

      const assembled = await assembleEligibilityBasis({
        repositories,
        caseId: input.caseId,
        revisionId: input.revisionId,
        submissionId,
        policy: eligibilityPolicy(input.eligibilityPolicyVersion),
        provenance: context.provenance,
        now: context.occurredAt,
      })

      if (!assembled) {
        reject(
          'not-found',
          `REVISION_NOT_CURRENT: revision "${input.revisionId}" is not a revision ` +
            `of case "${input.caseId}".`,
        )
      }

      /* -------------------------------------------------- the verdict */

      if (!assembled.gates.eligible) {
        /*
         * Every gate, passed and failed, under the policy that was applied. A
         * desk reading this should not have to submit again to discover the
         * next problem.
         */
        const summary = assembled.gates.gates
          .map((gate) => `${gate.code}=${gate.status}`)
          .join(' ')

        reject(
          'invariant-violated',
          `${assembled.gates.failed.join(', ')}: revision "${input.revisionId}" is ` +
            `not eligible under eligibility policy ` +
            `"${assembled.gates.policyVersion}". Gates: ${summary}.`,
        )
      }

      /* ---------------------------------------------------- the record */

      /*
       * A submission is an act by a person. An unattributed one would record
       * that the firm asked for a decision without recording who asked.
       */
      const accountable = context.actor.employeeId
      const actingDepartment = context.actor.departmentId
      if (accountable === null || actingDepartment === null) {
        reject(
          'unknown-actor',
          'A CIO submission must name the employee making it and the department ' +
            'they acted for. A department acts through a person, and the case ' +
            'movement this records cannot name an actor it was not given.',
        )
      }

      const investmentCase = await repositories.cases.get(input.caseId)
      if (!investmentCase) {
        reject('not-found', `Case "${input.caseId}" no longer exists.`)
      }

      const submission: CioSubmission = {
        id: submissionId,
        caseId: input.caseId,
        thesisId: input.thesisId,
        revisionId: input.revisionId,
        submittedByDepartmentId: input.submittedByDepartmentId,
        submittedByEmployeeId: accountable,
        submittedAt: context.occurredAt,
        caseVersion: investmentCase.version,
        state: 'pending',
        basis: assembled.basis,
      }

      /*
       * Validated before it is stored, and the validator checks that the
       * manifest describes the basis it is attached to -- so a mis-assembled
       * basis is refused here rather than persisted and discovered on read.
       */
      assertCioSubmissionWellFormed(submission)

      const saved = await repositories.submissions.save(submission)

      /*
       * The case moves `review -> decision`, and this is the point of the whole
       * command.
       *
       * The CIO's queue *is* `stage === 'decision'`. A submission that did not
       * move the case would be a request for a decision that never reaches the
       * desk that makes one -- the record would show a case still in review
       * while a submission sat pending against it, and the two would disagree
       * about where the work actually is.
       *
       * `transitionCase` refuses anything the stage table does not permit, so a
       * revision that never passed governance cannot arrive here sideways.
       */
      const movedCase = transitionCase(investmentCase, 'decision', {
        employeeId: accountable,
        departmentId: actingDepartment,
        at: context.occurredAt,
      })
      const savedCase = await repositories.cases.save(movedCase, context.expectedVersion!)

      await repositories.events.append(
        buildTransitionEvent({
          eventId: deriveEventId({
            commandId: context.commandId,
            recordType: 'cio-submission-recorded',
            entityId: input.caseId,
          }),
          caseId: input.caseId,
          subject: 'case',
          thesisId: input.thesisId,
          revisionId: input.revisionId,
          fromState: investmentCase.stage,
          toState: savedCase.stage,
          occurredAt: context.occurredAt,
          actorEmployeeId: accountable,
          actorDepartmentId: actingDepartment,
          correlationId: context.correlationId,
          aggregateVersion: savedCase.version,
          ...(context.reason ? { reason: context.reason } : {}),
        }),
      )

      return {
        value: saved,
        resultKind: 'cio-submission',
        resultRef: saved.id,
      }
    },

    async rehydrate(repositories, resultRef) {
      const found = await repositories.submissions.get(resultRef)
      if (!found) {
        throw new Error(
          `Submission "${resultRef}" was committed by this command but no longer ` +
            `reads back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
