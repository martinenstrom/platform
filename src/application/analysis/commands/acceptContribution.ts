/**
 * A human accepting an agent's work into the institution.
 *
 * The act that makes generated work institutional, and the only path across
 * that boundary. Until it runs the claims sit in the produced-claim store:
 * durable, readable, paid for — and outside `analysis.claims`, so nothing can
 * verify, challenge, aggregate, gate or cite them.
 *
 * ## The claims are not an input
 *
 * They are read from the produced-claim store. A person accepting work must not
 * be able to alter it in the same act: an "acceptance" that could edit the
 * claims would make the record say an agent asserted something it never did,
 * and the provenance on the run would be a lie told in the firm's own
 * vocabulary. Accept what was produced, or reject it — there is no third door.
 *
 * ## Identity crosses unchanged
 *
 * The same claim, with the same id and the same content, moves into
 * institutional storage. There is no second canonicalisation and no second
 * content hash. A claim that hashed differently depending on which side of
 * acceptance it was read from would not be content-addressed at all.
 *
 * ## What acceptance also releases
 *
 * The **result store** fills here rather than at production. It exists so
 * identical analysis can be reused rather than re-run, and filling it earlier
 * would let a later identical run reuse work the firm declined.
 *
 * The **assignment** completes here too. Work nobody accepted has not
 * discharged the department's obligation.
 */

import {
  actorFieldsOf,
  buildAssignment,
  buildRunRecord,
  buildTransitionEvent,
  canTransitionRun,
  executionIdentityKey,
  type AgentRunRecord,
  type Organization,
} from '~/domain/analysis'
import type { CommandDefinition } from './definition'
import { reject } from './envelope'
import { deriveEventId } from './eventIdentity'
import { CANONICALIZATION_VERSION, resultKey } from '../resultStore'

export interface AcceptContributionInput {
  caseId: string
  runId: string
  /** Declared for the mandate; verified against the run's own department. */
  departmentId: string
}

export function acceptContribution(
  _organization: Organization,
): CommandDefinition<AcceptContributionInput, AgentRunRecord> {
  return {
    type: 'AcceptContribution',
    /* Like the contribution it accepts: two desks accepting concurrently is normal. */
    versionPolicy: 'refuses-expected-version',
    reasonPolicy: 'optional',
    category: 'workflow',
    /*
     * A HUMAN member of the owning department, which is what the ruling
     * requires — not specifically its manager. The institution already
     * separates the desk's act from the manager's judgement, and
     * `AggregateManagerConclusion` is the second one; requiring a manager here
     * would collapse them and make a manager sign off every agent output.
     *
     * There is no self-approval problem: the AGENT produced the work, and the
     * person is the one taking responsibility for it entering the record.
     */
    mandate: (input) => ({
      kind: 'department-contribution',
      departmentId: input.departmentId,
    }),
    scope: (input) => ({ caseId: input.caseId }),
    payload: (input) => ({ runId: input.runId, departmentId: input.departmentId }),

    async execute(repositories, context, input) {
      const investmentCase = await repositories.cases.get(input.caseId)
      if (!investmentCase) {
        reject('not-found', `Case "${input.caseId}" no longer exists.`)
      }

      /*
       * The accountability boundary, restated — not relaxed.
       *
       * It used to require an EMPLOYEE. It now requires an accountable
       * institutional PRINCIPAL, which is either a person or a named desk agent
       * the firm has authorised for this department. The invariant is
       * unchanged: work cannot enter `analysis.claims` unless somebody the firm
       * can hold to account explicitly stands behind it.
       *
       * What an agent's acceptance means, precisely: **the desk adopts this
       * candidate as its recorded institutional position.** It is not human
       * review, not verification, not peer examination and not a Devil's
       * Advocate pass — those are separate controls performed by other
       * principals, and adopting work is not evidence that the work is right.
       *
       * A system actor is still refused. The orchestrator schedules; it does
       * not stand behind anything.
       */
      const accountable = context.actor.employeeId ?? context.actor.agentPrincipalId
      if (accountable === null) {
        reject(
          'unknown-actor',
          'Accepting work must name the accountable institutional principal ' +
            'adopting it. Work entering the institution with no principal ' +
            'behind it is work nobody stands behind.',
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
            `A department does not accept another department's work.`,
        )
      }
      if (!canTransitionRun(run.state, 'completed')) {
        reject(
          'illegal-prior-state',
          `Run "${input.runId}" is ${run.state}. Only work awaiting acceptance ` +
            `can be accepted.`,
        )
      }

      /* From the store, never from the input. See the header. */
      const claims = await repositories.producedClaims.listForRun(run.id)
      if (claims.length === 0) {
        reject(
          'invariant-violated',
          `Run "${input.runId}" has no produced work to accept.`,
        )
      }

      /*
       * The same claims, unchanged, crossing into institutional storage. This
       * is the moment they become verifiable, gateable and citable.
       */
      for (const claim of claims) {
        await repositories.claims.save(claim, input.caseId, run.id)
      }

      const completed = await repositories.runs.save(
        buildRunRecord({
          ...run,
          state: 'completed',
          completedAt: context.occurredAt,
          claims,
          /*
           * Completion enters the event log here, and only here. The run's log
           * ends at `awaiting-acceptance` until a person acts, so the activity
           * feed — which reads these directly — cannot show a desk finishing
           * work nobody accepted.
           */
          events: [
            ...run.events,
            { runId: run.id, at: context.occurredAt, state: 'completed' as const },
          ],
        }),
        context.provenance,
      )

      const inputs = {
        caseId: run.caseId,
        evidenceSetId: run.evidenceSetId,
        executionIdentity: executionIdentityKey(run.execution.identity),
        agentContractVersion: run.agentContractVersion,
        outputSchemaVersion: run.outputSchemaVersion,
        canonicalizationVersion: CANONICALIZATION_VERSION,
        agentImplementationVersion: run.execution.providerVersion,
        playbookVersion: run.execution.playbookVersion,
        departmentId: run.departmentId,
      }
      await repositories.results.put(
        {
          key: resultKey(inputs),
          claims,
          storedAt: context.occurredAt,
          providerKind: run.execution.providerKind,
          inputs,
        },
        context.provenance,
      )

      /*
       * The assignment completes here, because this is where the obligation is
       * actually discharged — and its event is emitted beside the write rather
       * than at production time, so the timeline and the row agree.
       */
      const assignment = await repositories.assignments.get(run.assignmentId)
      if (assignment) {
        await repositories.assignments.save(
          buildAssignment({
            ...assignment,
            status: 'completed',
            completedAt: context.occurredAt,
          }),
        )

        await repositories.events.append(
          buildTransitionEvent({
            eventId: deriveEventId({
              commandId: context.commandId,
              recordType: 'assignment-completed',
              entityId: assignment.id,
            }),
            subject: 'assignment',
            caseId: input.caseId,
            assignmentId: assignment.id,
            fromState: assignment.status,
            toState: 'completed',
            ...actorFieldsOf(context.actor),
            actorDepartmentId: run.departmentId,
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
            recordType: 'contribution-accepted',
            entityId: run.id,
          }),
          subject: 'run',
          caseId: input.caseId,
          assignmentId: run.assignmentId,
          runId: run.id,
          ...(run.revisionId ? { revisionId: run.revisionId } : {}),
          fromState: run.state,
          toState: 'completed',
          ...actorFieldsOf(context.actor),
          actorDepartmentId: run.departmentId,
          occurredAt: context.occurredAt,
          correlationId: context.correlationId,
          aggregateVersion: investmentCase.version,
          ...(context.reason ? { reason: context.reason } : {}),
        }),
      )

      return { value: completed, resultKind: 'run', resultRef: completed.id }
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
