/**
 * A human declining an agent's work.
 *
 * The counterpart to accepting, and the reason acceptance is a decision rather
 * than a formality. A firm that could only accept would accept.
 *
 * ## Rejection is institutional knowledge, not discarded history
 *
 * The claims stay in the produced-claim store, exactly as produced, readable
 * for as long as the run is. They are never copied into `analysis.claims`, so
 * they remain structurally uncitable — but the firm keeps what it paid for and
 * what it thought of it.
 *
 * The point is not only auditability. Over years the record should answer:
 * which agents are rejected most, why, whether it clusters by capability,
 * prompt, task or market regime, and whether an agent improves. That is why the
 * reason is a **code**, and why prose is required beside it rather than instead
 * of it — a code nobody can learn from and prose nobody can count are each half
 * a record.
 *
 * ## Nothing is released
 *
 * No claim, and no result-store entry. A rejected result must never become
 * reusable merely because the model produced it successfully.
 *
 * ## Not a failure
 *
 * A failed run produced nothing. A rejected run produced work the firm judged
 * inadequate, and every call succeeded.
 */

import {
  buildRunRecord,
  buildTransitionEvent,
  canTransitionRun,
  CONTRIBUTION_REJECTION_CODES,
  type AgentRunRecord,
  type ContributionRejectionCode,
  type Organization,
} from '~/domain/analysis'
import type { CommandDefinition } from './definition'
import { reject } from './envelope'
import { deriveEventId } from './eventIdentity'

export interface RejectContributionInput {
  caseId: string
  runId: string
  /** Declared for the mandate; verified against the run's own department. */
  departmentId: string
  /** One primary code. Secondary codes are deliberately not modelled. */
  code: ContributionRejectionCode
  /**
   * What was actually wrong, for whoever tries to fix it.
   *
   * Required. A code alone teaches nobody anything, and a rejection nobody can
   * learn from is the discarded history this record exists to prevent.
   */
  detail: string
}

export function rejectContribution(
  _organization: Organization,
): CommandDefinition<RejectContributionInput, AgentRunRecord> {
  return {
    type: 'RejectContribution',
    versionPolicy: 'refuses-expected-version',
    reasonPolicy: 'optional',
    category: 'workflow',
    /*
     * The same authority that could accept it can decline it. A desk able to
     * admit work but not refuse it would have no judgement at all.
     */
    mandate: (input) => ({
      kind: 'department-contribution',
      departmentId: input.departmentId,
    }),
    scope: (input) => ({ caseId: input.caseId }),
    payload: (input) => ({
      runId: input.runId,
      departmentId: input.departmentId,
      code: input.code,
      detail: input.detail,
    }),

    async execute(repositories, context, input) {
      const investmentCase = await repositories.cases.get(input.caseId)
      if (!investmentCase) {
        reject('not-found', `Case "${input.caseId}" no longer exists.`)
      }

      const accountable = context.actor.employeeId
      if (accountable === null) {
        reject(
          'unknown-actor',
          'Declining work must name the employee who declined it. A rejection ' +
            'nobody is accountable for teaches the firm nothing.',
        )
      }

      const run = await repositories.runs.get(input.runId)
      if (!run) {
        reject('not-found', `No run "${input.runId}".`)
      }
      if (run.caseId !== input.caseId) {
        reject(
          'invariant-violated',
          `Run "${input.runId}" belongs to case "${run.caseId}", not ` +
            `"${input.caseId}".`,
        )
      }
      if (run.departmentId !== input.departmentId) {
        reject(
          'invariant-violated',
          `Run "${input.runId}" belongs to department "${run.departmentId}". ` +
            `A department does not judge another department's work.`,
        )
      }
      if (!canTransitionRun(run.state, 'rejected')) {
        reject(
          'illegal-prior-state',
          `Run "${input.runId}" is ${run.state}. Only work awaiting acceptance ` +
            `can be rejected.`,
        )
      }

      if (!CONTRIBUTION_REJECTION_CODES.includes(input.code)) {
        reject(
          'invariant-violated',
          `"${input.code}" is not a reason the firm defines. The vocabulary is ` +
            `counted over years, so it does not accept new entries in passing.`,
        )
      }
      if (input.detail.trim() === '') {
        reject(
          'invariant-violated',
          'A rejection must say what was wrong. A code with no explanation ' +
            'records that the firm declined the work without recording what ' +
            'would make the next attempt better.',
        )
      }

      /*
       * The produced claims are not touched. They stay where they are —
       * durable, readable, and outside the table every citation resolves
       * against.
       */
      const rejected = await repositories.runs.save(
        buildRunRecord({
          ...run,
          state: 'rejected',
          completedAt: context.occurredAt,
          rejection: {
            code: input.code,
            detail: input.detail,
            rejectedByEmployeeId: accountable,
            rejectedAt: context.occurredAt,
          },
          /*
           * The code, never the prose. Run events flow into the activity feed,
           * and the detail is written for whoever tries to fix the work — not
           * for the floor.
           */
          events: [
            ...run.events,
            {
              runId: run.id,
              at: context.occurredAt,
              state: 'rejected' as const,
              reason: input.code,
            },
          ],
        }),
        context.provenance,
      )

      await repositories.events.append(
        buildTransitionEvent({
          eventId: deriveEventId({
            commandId: context.commandId,
            recordType: 'contribution-rejected',
            entityId: run.id,
          }),
          subject: 'run',
          caseId: input.caseId,
          assignmentId: run.assignmentId,
          runId: run.id,
          ...(run.revisionId ? { revisionId: run.revisionId } : {}),
          fromState: run.state,
          toState: 'rejected',
          actorEmployeeId: accountable,
          actorDepartmentId: run.departmentId,
          occurredAt: context.occurredAt,
          correlationId: context.correlationId,
          aggregateVersion: investmentCase.version,
          /* The code travels on the event too, so a timeline can be counted. */
          reason: input.code,
        }),
      )

      return { value: rejected, resultKind: 'run', resultRef: rejected.id }
    },

    async rehydrate(repositories, resultRef) {
      const found = await repositories.runs.get(resultRef)
      if (!found) {
        throw new Error(
          `Run "${resultRef}" was committed by this command but no longer reads ` +
            `back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
