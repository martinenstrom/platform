/**
 * Opening an investment case.
 *
 * The first production command. It creates the case and nothing else: no
 * assignments, no playbook, no thesis. `intake` is a legal resting state
 * meaning *received, not yet assigned*, and a case sitting in it with no work
 * attached is a case waiting for a manager, not a half-written record.
 *
 * That is why this is separate from `InstantiatePlaybook`. Merging them would
 * force the playbook choice at the moment the question arrives, which a
 * manager may legitimately defer — and it would hide a state the headquarters
 * has every reason to display.
 */

import {
  caseEvent,
  type CaseSubject,
  type InvestmentCase,
  type Organization,
} from '~/domain/analysis'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'

export interface OpenInvestmentCaseInput {
  caseId: string
  subject: CaseSubject
  question: string
  /** The manager accountable for the case as a whole. */
  ownerEmployeeId: string
  /** Departments asked to contribute. Grows as the case moves. */
  participatingDepartmentIds: readonly string[]
  /** The id of the creation event, supplied so a retry writes the same one. */
  creationEventId: string
}

export function openInvestmentCase(
  organization: Organization,
): CommandDefinition<OpenInvestmentCaseInput, InvestmentCase> {
  return {
    type: 'OpenInvestmentCase',
    /*
     * There is no prior version to check. A case that does not exist cannot
     * have moved on, and accepting a version here would offer concurrency
     * protection against nothing.
     */
    versionPolicy: 'refuses-expected-version',
    /*
     * Asking a question is ordinary forward motion. Requiring prose for it
     * produces prose nobody reads and devalues the reasons that matter.
     */
    reasonPolicy: 'optional',
    category: 'workflow',
    mandate: () => ({ kind: 'any-employee' }),
    scope: (input) => ({ caseId: input.caseId }),
    payload: (input) => ({
      subject: input.subject,
      question: input.question,
      ownerEmployeeId: input.ownerEmployeeId,
      participatingDepartmentIds: [...input.participatingDepartmentIds].sort(),
    }),

    async execute(repositories, context, input) {
      if (!input.question.trim()) {
        reject(
          'invariant-violated',
          `A case is a question the firm is asked. "${input.caseId}" carries none.`,
        )
      }

      const owner = organization.employees.find((e) => e.id === input.ownerEmployeeId)
      if (!owner) {
        reject(
          'not-found',
          `"${input.ownerEmployeeId}" is not an employee of the firm and cannot ` +
            `own a case. No ownerless or anonymous work.`,
        )
      }

      for (const departmentId of input.participatingDepartmentIds) {
        if (!organization.departments.some((d) => d.id === departmentId)) {
          reject('not-found', `Department "${departmentId}" does not exist`)
        }
      }

      /*
       * `cases.create` is idempotent on id, so a retry returns the stored case
       * rather than failing. The event append dedupes on its own id for the
       * same reason.
       */
      const created = await repositories.cases.create({
        id: input.caseId,
        version: 1,
        subject: input.subject,
        question: input.question,
        stage: 'intake',
        openedAt: context.occurredAt,
        ownerEmployeeId: input.ownerEmployeeId,
        participatingDepartmentIds: [...input.participatingDepartmentIds],
        transitions: [],
      })

      /*
       * `from: null` — a creation is not a movement.
       *
       * The distinction is enforced by `buildTransitionEvent`: a case event
       * with a previous state must name an actor, and one without may not
       * invent a transition from a state that never existed.
       */
      await repositories.events.append(
        caseEvent({
          eventId: input.creationEventId,
          caseId: input.caseId,
          from: null,
          to: 'intake',
          actorEmployeeId: context.actor.employeeId ?? undefined,
          actorDepartmentId: context.actor.departmentId ?? undefined,
          occurredAt: context.occurredAt,
          correlationId: context.correlationId,
          aggregateVersion: created.version,
        }),
      )

      return { value: created, resultKind: 'case', resultRef: created.id }
    },

    async rehydrate(repositories, resultRef) {
      const found = await repositories.cases.get(resultRef)
      if (!found) {
        throw new Error(
          `Case "${resultRef}" was committed by this command but no longer ` +
            `reads back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
