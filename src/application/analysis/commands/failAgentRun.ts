/**
 * Recording that a run did not produce a contribution.
 *
 * Deliberately a separate command from `RecordContribution`, because failure is
 * a different institutional fact rather than a completion with no output. It is
 * also where the provider boundary's second half lands when the provider was
 * unreachable, slow, or answered with something that is not a contribution.
 *
 * ## Nothing sensitive is stored here
 *
 * The record carries a bounded `RunFailureCategory`, a retryability judgement
 * and an attempt number. **No provider response body, prompt, evidence excerpt
 * or raw error text.** A free-text failure field is where all four eventually
 * land, and this record flows into logs, metrics and read models. The specific
 * detail belongs in the provider's own telemetry, correlated by run id.
 *
 * ## Downstream blocking is derived, not cascaded
 *
 * A failed required entry does not write "blocked" onto anything downstream.
 * `StartAgentRun` refuses to start an entry whose blocking dependencies have
 * not completed, so the block is a consequence of the graph rather than a
 * second set of rows that can disagree with it. A failed OPTIONAL entry blocks
 * nothing at all, which is exactly what makes it optional — its absence stays
 * visible through `missingOptionalInputs` and the manager's aggregation.
 */

import {
  buildAssignment,
  buildRunRecord,
  canTransitionRun,
  type AgentRunRecord,
  type Organization,
  type RunFailureCategory,
  type RunState,
} from '~/domain/analysis'
import { buildTransitionEvent } from '~/domain/analysis'
import { deriveEventId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'

/** The states a failing run may land in. Not a free choice. */
const FAILURE_STATES: readonly RunState[] = ['failed', 'timed-out', 'cancelled']

export interface FailAgentRunInput {
  caseId: string
  runId: string
  /** Declared for the mandate; verified against the run's own department. */
  departmentId: string
  category: RunFailureCategory
  /**
   * Whether the organization may try again.
   *
   * A retryable failure returns the assignment to its queue; a non-retryable
   * one leaves the assignment `failed` for a person to decide about. The
   * difference is institutional, not technical, which is why it is recorded
   * rather than inferred from the category.
   */
  retryable: boolean
  /** 1 for the first attempt. */
  attempt: number
  /** `timed-out` and `cancelled` are distinct facts from `failed`. */
  state?: RunState
}

export function failAgentRun(
  _organization: Organization,
): CommandDefinition<FailAgentRunInput, AgentRunRecord> {
  return {
    type: 'FailAgentRun',
    versionPolicy: 'refuses-expected-version',
    /*
     * Required. Work that stops owes an explanation — the same rule that makes
     * `transitionCase` demand one for `blocked`. The bounded category says
     * WHAT failed; the reason says what the organization understands about it.
     */
    reasonPolicy: 'required',
    category: 'workflow',
    mandate: (input) => ({
      kind: 'department-contribution',
      departmentId: input.departmentId,
    }),
    scope: (input) => ({ caseId: input.caseId }),
    payload: (input) => ({
      runId: input.runId,
      departmentId: input.departmentId,
      category: input.category,
      retryable: input.retryable,
      attempt: input.attempt,
      state: input.state ?? 'failed',
    }),

    async execute(repositories, context, input) {
      const targetState = input.state ?? 'failed'
      if (!FAILURE_STATES.includes(targetState)) {
        reject(
          'invariant-violated',
          `"${targetState}" is not a failure state. Use RecordContribution for ` +
            `work that produced something.`,
        )
      }
      if (input.attempt < 1) {
        reject('invariant-violated', `Attempt numbers start at 1`)
      }

      const run = await repositories.runs.get(input.runId)
      if (!run) reject('not-found', `Run "${input.runId}" does not exist`)
      if (run.caseId !== input.caseId) {
        reject('invariant-violated', `Run "${input.runId}" belongs to another case`)
      }
      if (run.departmentId !== input.departmentId) {
        reject(
          'not-authorised',
          `Run "${input.runId}" belongs to "${run.departmentId}", not to ` +
            `"${input.departmentId}".`,
        )
      }

      /*
       * A run that already settled does not fail again. This is the late-result
       * guard on the failure side: a provider that errors after the
       * organization already cancelled the work must not overwrite the
       * cancellation with its own account of events.
       */
      if (!canTransitionRun(run.state, targetState)) {
        reject(
          'illegal-prior-state',
          `Run "${input.runId}" is ${run.state} and cannot move to ` +
            `${targetState}. A settled run keeps the outcome it settled on.`,
        )
      }

      const investmentCase = await repositories.cases.get(input.caseId)
      if (!investmentCase) reject('not-found', `Case "${input.caseId}" does not exist`)

      const failure = {
        category: input.category,
        retryable: input.retryable,
        attempt: input.attempt,
        at: context.occurredAt,
      }

      const failed = await repositories.runs.save(
        buildRunRecord({
          ...run,
          state: targetState,
          failure,
          events: [
            ...run.events,
            {
              runId: run.id,
              at: context.occurredAt,
              state: targetState,
              // The bounded category, never prose.
              reason: input.category,
            },
          ],
        }),
        context.provenance,
      )

      /*
       * Retryable work goes back to the queue; non-retryable work stops as
       * `failed`. `cancelled` is not used here — a provider failure is not the
       * organization withdrawing the work, and conflating them would attribute
       * a managerial decision to an outage.
       */
      const assignment = await repositories.assignments.get(run.assignmentId)
      if (assignment) {
        const nextStatus = input.retryable ? 'queued' : 'failed'
        await repositories.assignments.save(
          buildAssignment({
            ...assignment,
            status: nextStatus,
            ...(input.retryable ? {} : { completedAt: context.occurredAt }),
          }),
        )

        await repositories.events.append(
          buildTransitionEvent({
            eventId: deriveEventId({
              commandId: context.commandId,
              recordType: `assignment-${nextStatus}`,
              entityId: assignment.id,
            }),
            subject: 'assignment',
            caseId: input.caseId,
            assignmentId: assignment.id,
            fromState: assignment.status,
            toState: nextStatus,
            actorEmployeeId: context.actor.employeeId ?? undefined,
            actorDepartmentId: run.departmentId,
            // A stalling state needs a reason, and the category is one.
            reason: input.category,
            occurredAt: context.occurredAt,
            correlationId: context.correlationId,
            aggregateVersion: investmentCase.version,
          }),
        )
      }

      await repositories.events.append(
        buildTransitionEvent({
          eventId: deriveEventId({
            commandId: context.commandId,
            recordType: `run-${targetState}`,
            entityId: run.id,
          }),
          subject: 'run',
          caseId: input.caseId,
          assignmentId: run.assignmentId,
          runId: run.id,
          ...(run.revisionId ? { revisionId: run.revisionId } : {}),
          fromState: run.state,
          toState: targetState,
          actorEmployeeId: context.actor.employeeId ?? undefined,
          actorDepartmentId: run.departmentId,
          reason: input.category,
          occurredAt: context.occurredAt,
          correlationId: context.correlationId,
          aggregateVersion: investmentCase.version,
        }),
      )

      return { value: failed, resultKind: 'run', resultRef: failed.id }
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
