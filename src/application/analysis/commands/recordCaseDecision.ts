/**
 * The CIO decides, and the case settles.
 *
 * The act this whole institution exists to reach. Everything before it —
 * claims, contributions, reviews, aggregation, assembly, submission — produces
 * the question. This records the answer.
 *
 * ## Three outcomes, none of them inferred
 *
 * `selected`, `deferred` and `declined` are a union, so a decision is never
 * read out of a nullable field. Deferral is an act in its own right: the
 * material was sound and waiting was the answer, which is why it carries
 * reconsideration conditions — a deferral with no condition ending it is an
 * indefinite silence wearing a decision's clothes.
 *
 * ## Dissent survives the decision
 *
 * A disclosed dissent is part of the record, not a comment on it. The firm
 * decided *knowing* someone disagreed, and erasing that would make the record
 * describe an agreement that never happened.
 *
 * ## Settlement is not a separate step
 *
 * Deciding settles the submissions the decision considered, in the same
 * transaction. A decided case still holding a pending submission would be a
 * case the system believes is both answered and waiting.
 */

import {
  buildTransitionEvent,
  type CaseDecision,
  type CioDecisionOutcome,
  type DisclosedDissent,
  type Organization,
  type ReconsiderationTrigger,
  transitionCase,
} from '~/domain/analysis'
import type { CommandDefinition } from './definition'
import { reject } from './envelope'
import { deriveEventId } from './eventIdentity'
import { asCanonicalValue, utf8ByteOrder } from '~/domain/shared/canonicalValue'

export interface RecordCaseDecisionInput {
  caseId: string
  /** Every submission this decision speaks about, decided together. */
  submissionIds: readonly string[]
  outcome: CioDecisionOutcome
  evidenceSetId: string
  rationale: string
  authorizationBasis: string
  unresolvedDissent?: readonly DisclosedDissent[]
  reconsiderationTriggers?: readonly ReconsiderationTrigger[]
  /**
   * The decision this one replaces.
   *
   * A committed decision is immutable; correcting or reconsidering one appends
   * a decision naming its predecessor, so the record grows and never loses what
   * the firm believed at the time.
   */
  supersedesDecisionId?: string
}

export function recordCaseDecision(
  _organization: Organization,
): CommandDefinition<RecordCaseDecisionInput, CaseDecision> {
  return {
    type: 'RecordCaseDecision',
    versionPolicy: 'requires-expected-version',
    reasonPolicy: 'optional',
    category: 'governance',
    /*
     * A CIO act. The most important refusal in the group: a decision recorded
     * by someone without the mandate is worse than no decision, because it
     * looks exactly like one afterwards.
     */
    mandate: () => ({ kind: 'chief-decision' }),
    scope: (input) => ({ caseId: input.caseId }),
    payload: (input) => ({
      submissionIds: [...input.submissionIds].sort(utf8ByteOrder),
      outcome: asCanonicalValue(input.outcome),
      evidenceSetId: input.evidenceSetId,
      rationale: input.rationale,
      authorizationBasis: input.authorizationBasis,
      unresolvedDissent: asCanonicalValue(input.unresolvedDissent ?? []),
      reconsiderationTriggers: asCanonicalValue(input.reconsiderationTriggers ?? []),
      supersedesDecisionId: input.supersedesDecisionId ?? null,
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
          'A case decision must name the employee who made it and the department ' +
            'they acted for. An unattributed decision records that the firm ' +
            'decided without recording who decided.',
        )
      }

      /* ------------------------------------------ the submissions decided */

      if (input.submissionIds.length === 0) {
        reject(
          'invariant-violated',
          'A decision must speak about at least one submission. A decision ' +
            'considering nothing has no basis to have been decided on.',
        )
      }

      const submissions = await Promise.all(
        input.submissionIds.map((id) => repositories.submissions.get(id)),
      )

      const missing = input.submissionIds.filter((_id, index) => !submissions[index])
      if (missing.length > 0) {
        reject('not-found', `No submission "${missing[0]}".`)
      }

      const foreign = submissions.filter(
        (submission) => submission!.caseId !== input.caseId,
      )
      if (foreign.length > 0) {
        reject(
          'invariant-violated',
          `Submission "${foreign[0]!.id}" belongs to case "${foreign[0]!.caseId}", ` +
            `not "${input.caseId}". A decision may only settle its own case.`,
        )
      }

      const alreadySettled = submissions.filter(
        (submission) => submission!.state !== 'pending',
      )
      if (alreadySettled.length > 0) {
        reject(
          'illegal-prior-state',
          `Submission "${alreadySettled[0]!.id}" is already ` +
            `${alreadySettled[0]!.state}. A settled submission is not decided twice.`,
        )
      }

      /* ------------------------------------------------------ the record */

      const decisionId = deriveEventId({
        commandId: context.commandId,
        recordType: 'case-decision',
        entityId: input.caseId,
      })

      const decision: CaseDecision = {
        decisionId,
        caseId: input.caseId,
        aggregateVersion: investmentCase.version,
        decidedAt: context.occurredAt,
        decidedByEmployeeId: accountable,
        decidedBy: context.actor,
        authorizationBasis: input.authorizationBasis,
        outcome: input.outcome,
        submissionIds: [...input.submissionIds],
        evidenceSetId: input.evidenceSetId,
        rationale: input.rationale,
        unresolvedDissent: input.unresolvedDissent ?? [],
        reconsiderationTriggers: input.reconsiderationTriggers ?? [],
        ...(input.supersedesDecisionId
          ? { supersedesDecisionId: input.supersedesDecisionId }
          : {}),
      }

      /*
       * One save. The predecessor is marked superseded and the successor
       * inserted together -- there is deliberately no `supersede()` a caller
       * could invoke on its own, because half of that operation is a case with
       * no live decision or with two.
       */
      const saved = await repositories.decisions.save(decision)

      /*
       * Settled in the same transaction. A decided case still holding a pending
       * submission would be a case the system believes is both answered and
       * waiting.
       */
      await repositories.submissions.settle([...input.submissionIds], 'decided')

      /*
       * The case reaches its terminal stage.
       *
       * `deferred` is its own stage, not a variety of `decision`: "nobody has
       * looked at this yet" and "the CIO looked and chose to wait" are opposite
       * institutional facts, and a floor that could not tell them apart would
       * show a waiting decision as an idle one.
       *
       * A SUPERSEDING decision does not move the case. It replaces the live
       * decision while the stage stays where it is -- which is why the stage
       * table has no `decided -> decided`, and why attempting the move here
       * would refuse a correction the firm is entitled to make.
       */
      const terminalStage = input.outcome.kind === 'deferred' ? 'deferred' : 'decided'
      const moves = !input.supersedesDecisionId && investmentCase.stage !== terminalStage

      const savedCase = moves
        ? await repositories.cases.save(
            transitionCase(investmentCase, terminalStage, {
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
            recordType: 'cio-decision-recorded',
            entityId: input.caseId,
          }),
          caseId: input.caseId,
          subject: 'case',
          /*
           * A supersession is recorded as a movement that stayed put, rather
           * than omitted. The firm did act, and an event missing from the
           * timeline would make a corrected decision look like it appeared
           * without anyone deciding anything.
           */
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

      return { value: saved, resultKind: 'case-decision', resultRef: saved.decisionId }
    },

    async rehydrate(repositories, resultRef) {
      const found = await repositories.decisions.get(resultRef)
      if (!found) {
        throw new Error(
          `Decision "${resultRef}" was committed by this command but no longer ` +
            `reads back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
