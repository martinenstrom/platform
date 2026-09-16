/**
 * The person closes a case on explicit instruction.
 *
 * "Stäng ner det pågående ärendet." The committee was convened to answer a
 * question, and the person who put it no longer wants it answered. The firm
 * has always had the stage for this — `withdrawn`, terminal, reachable from
 * every stage that is not already terminal — and never the act. A host that
 * could only say "det går inte att stänga" about a case the person opened
 * ten seconds earlier was not serving the person; a host that said "jag
 * stänger det" with no act behind the sentence was lying.
 *
 * ## Cancelled and abandoned are read, not chosen
 *
 * One act, one stage, and a distinction a person can hear: a case with work
 * under way was **cancelled**; a case nothing had been done on was
 * **abandoned**. That is derived from the record at read time
 * (`closureOf`), never stored — storing it would let the label and the
 * facts disagree, and the facts are what the firm keeps.
 *
 * ## What it stops, and what it does not
 *
 * The terminal stage is what makes further work ineligible: every command
 * that starts, records or adopts work refuses a `withdrawn` case, and the
 * gateway reports `closed` before it looks for runs. A run already inside
 * its execution window is not killed here — the firm has no lease on a
 * process (TD-92) and a command that claimed to stop one would claim
 * something it cannot see. It is reported: `activity.inFlight` on a closed
 * case is work the firm will not adopt.
 *
 * ## History is kept
 *
 * The transition carries the reason and the actor into the append-only event
 * log, beside every act before it. "Varför stängde vi det?" is answered from
 * that record, not from anyone's memory. There is no reopening here; a
 * `ReopenCase` command is on the guarded list and unwritten, and a case
 * closed on instruction stays closed until the firm writes one.
 *
 * ## Who may
 *
 * The convening authority for the owning desk, checked against the case's
 * actual owner — the same rule as convening, because dismissing the
 * committee is the convenor's mirror act. A reason is required: the stage
 * table does not demand one for `withdrawn`, but a closed case with no
 * sentence beside it cannot answer the question above, and the ledger's
 * reason-required list exists for exactly the acts that end or redirect
 * work.
 */

import {
  buildTransitionEvent,
  canTransition,
  transitionCase,
  type InvestmentCase,
  type Organization,
} from '~/domain/analysis'
import type { CommandDefinition } from './definition'
import { reject } from './envelope'
import { deriveEventId } from './eventIdentity'

export interface CloseCaseInput {
  caseId: string
  /** Checked against the case owner's department inside `execute`. */
  onBehalfOfDepartmentId: string
}

export function closeCase(
  organization: Organization,
): CommandDefinition<CloseCaseInput, InvestmentCase> {
  return {
    type: 'CloseCase',
    /* Already on VERSION_GUARDED_COMMANDS, from before the act existed. */
    versionPolicy: 'requires-expected-version',
    /* On REASON_REQUIRED_COMMANDS: see the header. */
    reasonPolicy: 'required',
    category: 'workflow',
    mandate: (input) => ({
      kind: 'investment-committee-convenor',
      owningDepartmentId: input.onBehalfOfDepartmentId,
    }),
    scope: (input) => ({ caseId: input.caseId }),
    payload: (input) => ({ onBehalfOfDepartmentId: input.onBehalfOfDepartmentId }),

    async execute(repositories, context, input) {
      const investmentCase = await repositories.cases.get(input.caseId)
      if (!investmentCase) {
        reject('not-found', `Case "${input.caseId}" does not exist`)
      }

      const owner = organization.employees.find(
        (employee) => employee.id === investmentCase.ownerEmployeeId,
      )
      if (!owner || owner.departmentId !== input.onBehalfOfDepartmentId) {
        reject(
          'not-authorised',
          `Case "${input.caseId}" is owned by ${owner?.departmentId ?? 'nobody'}, ` +
            `not by "${input.onBehalfOfDepartmentId}". Closing a case is the ` +
            `convenor's act, on the convenor's own case.`,
        )
      }

      const accountable = context.actor.employeeId
      const actingDepartment = context.actor.departmentId
      if (accountable === null || actingDepartment === null) {
        reject(
          'unknown-actor',
          'A closure must name the person who closed the case and the ' +
            'department they acted for. Work does not end by itself.',
        )
      }

      if (!canTransition(investmentCase.stage, 'withdrawn')) {
        reject(
          'illegal-prior-state',
          `Case "${input.caseId}" is ${investmentCase.stage}. A case the firm ` +
            `has settled is not closed again; its record stands as decided.`,
        )
      }

      const closed = await repositories.cases.save(
        transitionCase(investmentCase, 'withdrawn', {
          employeeId: accountable,
          departmentId: actingDepartment,
          at: context.occurredAt,
          /* Guaranteed by `reasonPolicy: 'required'`, enforced before `execute`. */
          reason: context.reason!,
        }),
        context.expectedVersion!,
      )

      await repositories.events.append(
        buildTransitionEvent({
          eventId: deriveEventId({
            commandId: context.commandId,
            recordType: 'case-closed',
            entityId: input.caseId,
          }),
          caseId: input.caseId,
          subject: 'case',
          fromState: investmentCase.stage,
          toState: closed.stage,
          occurredAt: context.occurredAt,
          actorEmployeeId: accountable,
          actorDepartmentId: actingDepartment,
          correlationId: context.correlationId,
          aggregateVersion: closed.version,
          reason: context.reason!,
        }),
      )

      return { value: closed, resultKind: 'case', resultRef: closed.id }
    },

    async rehydrate(repositories, resultRef) {
      const found = await repositories.cases.get(resultRef)
      if (!found) {
        throw new Error(
          `Case "${resultRef}" was closed by this command but no longer reads ` +
            `back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
