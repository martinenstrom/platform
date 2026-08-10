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
    category: 'governance',
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

      const assembled = await assembleEligibilityBasis({
        repositories,
        caseId: input.caseId,
        revisionId: input.revisionId,
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

      const submissionId = deriveEventId({
        commandId: context.commandId,
        recordType: 'cio-submission',
        entityId: input.revisionId,
      })

      /*
       * A submission is an act by a person. An unattributed one would record
       * that the firm asked for a decision without recording who asked.
       */
      const accountable = context.actor.employeeId
      if (accountable === null) {
        reject('unknown-actor', 'A CIO submission must name the employee making it.')
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

      await repositories.events.append(
        buildTransitionEvent({
          id: deriveEventId({
            commandId: context.commandId,
            recordType: 'transition',
            entityId: input.caseId,
          }),
          caseId: input.caseId,
          occurredAt: context.occurredAt,
          actor: context.actor,
          kind: 'cio-submission-recorded',
          detail: `Revision ${input.revisionId} submitted for CIO decision.`,
        } as never),
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
