/**
 * The CIO brings a deferred case back.
 *
 * The act that made deferral mean something. The firm has always refused a
 * deferral that named no condition for ending the wait, stored those
 * conditions, and had no way to act on them — it recorded an obligation it
 * could not fulfil. This is the fulfilment.
 *
 * ## What is kept, and what is produced again
 *
 * A reopened case keeps its history and its revision-specific recorded
 * findings, but **no eligibility or CIO conclusion is inherited**.
 *
 * That is the precise boundary, and it is narrower than "inherits no
 * judgement": a Verification verdict *is* a judgement, and it does carry over,
 * because it is a finding recorded about an exact revision that has not
 * changed. What must not carry over is what the firm concluded FROM those
 * findings — the eligibility verdict and the decision — because the trigger
 * fired precisely when the world stopped matching the assumptions those
 * conclusions rested on.
 *
 * So reopening assembles a **fresh** `EligibilityBasis` and evaluates it under
 * the policy named here, which may not be the policy the deferral was judged
 * under. The deferral stays readable and grants no approval to what follows.
 *
 * **If the fresh basis fails the gates, the reopening is refused** and the case
 * stays deferred until the work is redone. That is the institution behaving
 * correctly rather than honouring an earlier expectation.
 *
 * ## What does carry over, and why it is not judgement
 *
 * The recorded governance verdicts — Verification, Devil's Advocate, Risk — are
 * facts about an exact revision, and the revision has not changed. A verdict is
 * a statement about a specific argument, and that statement has not stopped
 * being true because time passed.
 *
 * Where the argument itself must change, the desk revises the thesis. That
 * mints a new revision, which reopens every gate and inherits nothing — the
 * domain is already explicit that an objection raised against revision 1 never
 * travels silently to revision 2.
 *
 * ## Why it does not decide
 *
 * Reopening asks for a decision; `RecordCaseDecision` makes one. The firm has
 * drawn that line once already, and a command that both reopened and decided
 * would be a second shape for the same institutional pair.
 */

import {
  assertCioSubmissionWellFormed,
  buildTransitionEvent,
  canTransition,
  eligibilityPolicy,
  transitionCase,
  type CaseReconsideration,
  type CioSubmission,
  type FiredTrigger,
  type Organization,
} from '~/domain/analysis'
import type { CommandDefinition } from './definition'
import { reject } from './envelope'
import { deriveEventId } from './eventIdentity'
import { assembleEligibilityBasis } from '../assembleEligibilityBasis'
import { asCanonicalValue } from '~/domain/shared/canonicalValue'

export interface ReopenForReconsiderationInput {
  caseId: string
  /** The deferral being reconsidered. Named, never inferred. */
  deferredDecisionId: string
  /** Which conditions fired, and what was observed. Non-empty. */
  firedTriggers: readonly FiredTrigger[]
  authorizationBasis: string
  /**
   * The eligibility policy the reopened submission is made under.
   *
   * Explicit, like every other policy selection: the basis stores it, and the
   * firm may well be operating under a different version than when the case
   * was deferred. Defaulting it would quietly re-judge an old case under
   * whatever happens to be current.
   */
  eligibilityPolicyVersion: string
}

export function reopenForReconsideration(
  _organization: Organization,
): CommandDefinition<ReopenForReconsiderationInput, CaseReconsideration> {
  return {
    type: 'ReopenForReconsideration',
    versionPolicy: 'requires-expected-version',
    reasonPolicy: 'optional',
    /* `chief-decision` supports exactly this category, and no other. */
    category: 'decision',
    /*
     * Deferring is a governance act and so is ending a deferral. A desk that
     * could reopen at will could put work in front of the CIO repeatedly; its
     * route stays what it already is — revise the thesis.
     */
    mandate: () => ({ kind: 'chief-decision' }),
    scope: (input) => ({ caseId: input.caseId }),
    payload: (input) => ({
      deferredDecisionId: input.deferredDecisionId,
      firedTriggers: asCanonicalValue(input.firedTriggers),
      authorizationBasis: input.authorizationBasis,
      eligibilityPolicyVersion: input.eligibilityPolicyVersion,
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
          'A reconsideration must name the employee who reopened the case and ' +
            'the department they acted for.',
        )
      }

      /* ------------------------------------------------ the prior state */

      if (investmentCase.stage !== 'deferred') {
        reject(
          'illegal-prior-state',
          `Case "${input.caseId}" is ${investmentCase.stage}, not deferred. ` +
            `Only a case the CIO chose to wait on can be reconsidered; ` +
            `reopening a committed decision is a different act.`,
        )
      }

      const live = await repositories.decisions.getForCase(input.caseId)
      if (!live || live.decisionId !== input.deferredDecisionId) {
        reject(
          'not-found',
          `Decision "${input.deferredDecisionId}" is not the live decision for ` +
            `case "${input.caseId}".`,
        )
      }
      if (live.outcome.kind !== 'deferred') {
        reject(
          'illegal-prior-state',
          `Decision "${input.deferredDecisionId}" is ${live.outcome.kind}, not a ` +
            `deferral. There is no wait to end.`,
        )
      }

      /* ------------------------------------------------- what fired */

      if (input.firedTriggers.length === 0) {
        reject(
          'invariant-violated',
          'A reconsideration must name at least one condition that fired. A ' +
            'reopening citing nothing is the CIO changing their mind — a ' +
            'legitimate act, but a different one.',
        )
      }

      const owned = new Set(live.reconsiderationTriggers.map((entry) => entry.id))
      const foreign = input.firedTriggers.filter((fired) => !owned.has(fired.triggerId))
      if (foreign.length > 0) {
        reject(
          'invariant-violated',
          `Trigger "${foreign[0]!.triggerId}" does not belong to decision ` +
            `"${input.deferredDecisionId}". A condition from another deferral ` +
            `did not end this one.`,
        )
      }

      /* -------------------------------------- the facts, assembled afresh */

      const revisionId = live.outcome.consideredRevisionIds[0]
      if (!revisionId) {
        reject(
          'invariant-violated',
          `Decision "${input.deferredDecisionId}" considered no revision.`,
        )
      }

      const submissionId = deriveEventId({
        commandId: context.commandId,
        recordType: 'cio-submission',
        entityId: revisionId,
      })

      const assembled = await assembleEligibilityBasis({
        repositories,
        caseId: input.caseId,
        revisionId,
        submissionId,
        policy: eligibilityPolicy(input.eligibilityPolicyVersion),
        provenance: context.provenance,
        now: context.occurredAt,
      })

      if (!assembled) {
        reject(
          'not-found',
          `REVISION_NOT_CURRENT: revision "${revisionId}" is not a revision of ` +
            `case "${input.caseId}".`,
        )
      }

      /*
       * The gates, applied again. A deferral is not a standing approval: if the
       * work no longer clears the bar, the case stays deferred and the desk has
       * something to fix. Refusing here is the whole point of assembling afresh.
       */
      if (!assembled.gates.eligible) {
        const summary = assembled.gates.gates
          .map((gate) => `${gate.code}=${gate.status}`)
          .join(' ')

        reject(
          'invariant-violated',
          `${assembled.gates.failed.join(', ')}: revision "${revisionId}" is no ` +
            `longer eligible under eligibility policy ` +
            `"${assembled.gates.policyVersion}". The case stays deferred. ` +
            `Gates: ${summary}.`,
        )
      }

      /* ------------------------------------------------------ the records */

      const submission: CioSubmission = {
        id: submissionId,
        caseId: input.caseId,
        /* From the assembled basis, which read it from the revision itself. */
        thesisId: assembled.basis.thesisId,
        revisionId,
        /*
         * Submitted by the CIO's own department. The desk did not ask for this
         * decision -- the office that deferred it brought it back, and the
         * record should not imply otherwise.
         */
        submittedByDepartmentId: actingDepartment,
        submittedByEmployeeId: accountable,
        submittedAt: context.occurredAt,
        caseVersion: investmentCase.version,
        state: 'pending',
        basis: assembled.basis,
      }
      assertCioSubmissionWellFormed(submission)
      await repositories.submissions.save(submission)

      const reconsideration: CaseReconsideration = {
        id: deriveEventId({
          commandId: context.commandId,
          recordType: 'case-reconsideration',
          entityId: input.caseId,
        }),
        caseId: input.caseId,
        revisionId,
        reconsidersDecisionId: input.deferredDecisionId,
        submissionId,
        reopenedAt: context.occurredAt,
        reopenedBy: context.actor,
        reopenedByEmployeeId: accountable,
        authorizationBasis: input.authorizationBasis,
        firedTriggers: [...input.firedTriggers],
        caseVersion: investmentCase.version,
      }
      const saved = await repositories.submissions.recordReconsideration(reconsideration)

      /*
       * `deferred -> decision`. Legal since the stage table was written and
       * taken by nothing until now.
       */
      const savedCase = canTransition(investmentCase.stage, 'decision')
        ? await repositories.cases.save(
            transitionCase(investmentCase, 'decision', {
              employeeId: accountable,
              departmentId: actingDepartment,
              at: context.occurredAt,
            }),
            context.expectedVersion!,
          )
        : investmentCase

      await repositories.events.append(
        buildTransitionEvent({
          eventId: deriveEventId({
            commandId: context.commandId,
            recordType: 'case-reconsidered',
            entityId: input.caseId,
          }),
          caseId: input.caseId,
          subject: 'case',
          revisionId,
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

      return { value: saved, resultKind: 'case-reconsideration', resultRef: saved.id }
    },

    async rehydrate(repositories, resultRef) {
      const found = await repositories.submissions.getReconsideration(resultRef)
      if (!found) {
        throw new Error(
          `Reconsideration "${resultRef}" was committed by this command but no ` +
            `longer reads back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
