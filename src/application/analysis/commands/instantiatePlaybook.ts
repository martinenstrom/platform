/**
 * Instantiating a case's workflow.
 *
 * One transaction: the playbook version is registered, the case is pinned to
 * it, every assignment is created, the case moves `intake → research`, and one
 * event is written per fact. A crash leaves the complete instantiation or none
 * of it — there is no state in which a case has three of its six assignments.
 *
 * ## What is idempotent, and on what
 *
 * Registration is idempotent on `(playbookId, version)` **by content**;
 * assignments on `(caseId, playbookEntryKey)`; events on their own ids. The
 * stage move is guarded by `expectedVersion`, so a replay after a successful
 * run loses the version race rather than moving the case twice.
 *
 * That combination is what makes a retry after an ambiguous commit safe: the
 * parts that landed are recognised as landed, and the one part that must not
 * happen twice is protected by the aggregate version.
 *
 * ## Conditional entries get an assignment
 *
 * A conditionally required entry — Risk Review — is created like any other, so
 * the department sees it in its queue from the start. Whether it is actually
 * required is decided later against an exact thesis revision, and until then
 * the entry is `unresolved`. Creating it lazily would hide pending work from
 * the department that owns it.
 */

import {
  buildAssignment,
  caseEvent,
  pinPlaybook,
  transitionCase,
  type Assignment,
  type InvestmentCase,
  type Organization,
  type TransitionEvent,
} from '~/domain/analysis'
import { buildTransitionEvent } from '~/domain/analysis'
import { validatePlaybook } from '../playbooks'
import { UnknownPlaybookError, requirePlaybook } from '../playbookRegistry'
import { deriveAssignmentId, deriveEventId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'

export interface InstantiatePlaybookInput {
  caseId: string
  /**
   * The workflow, by stable identity.
   *
   * Not a playbook OBJECT. A caller that could hand in an arbitrary definition
   * could run a case under a workflow the firm never approved, and with two
   * playbooks it would make the routing decision at every call site. The
   * registry owns both concerns.
   */
  playbookId: string
  playbookVersion: string
  /**
   * The department whose manager is instantiating this.
   *
   * Declared by the caller because the mandate must be decided before the case
   * is read, and verified inside `execute` against the case owner's actual
   * department. A caller naming a department it happens to manage, on a case
   * owned elsewhere, is rejected — otherwise any manager could choose the
   * workflow for any case by nominating their own department.
   */
  onBehalfOfDepartmentId: string
}

export function instantiatePlaybook(
  organization: Organization,
): CommandDefinition<InstantiatePlaybookInput, InvestmentCase> {
  return {
    type: 'InstantiatePlaybook',
    /* Moves the case out of intake, so it is version-guarded. */
    versionPolicy: 'requires-expected-version',
    reasonPolicy: 'optional',
    category: 'workflow',
    /*
     * The manager who owns the case's department. Choosing how the firm works
     * a question is a managerial act, not something any contributor may do.
     */
    mandate: (input) => ({
      kind: 'department-manager',
      departmentId: input.onBehalfOfDepartmentId,
    }),
    scope: (input) => ({ caseId: input.caseId }),
    payload: (input) => ({
      playbookId: input.playbookId,
      playbookVersion: input.playbookVersion,
      onBehalfOfDepartmentId: input.onBehalfOfDepartmentId,
    }),

    async execute(repositories, context, input) {
      const existing = await repositories.cases.get(input.caseId)
      if (!existing) {
        reject('not-found', `Case "${input.caseId}" does not exist`)
      }

      /*
       * The mandate was granted for the department the caller NAMED. This is
       * where that name is checked against the case: managing a department is
       * authority over that department's work, not over every case in the
       * firm.
       */
      const owner = organization.employees.find((e) => e.id === existing.ownerEmployeeId)
      if (!owner || owner.departmentId !== input.onBehalfOfDepartmentId) {
        reject(
          'not-authorised',
          `Case "${input.caseId}" is owned by ${owner?.departmentId ?? 'nobody'}, ` +
            `not by "${input.onBehalfOfDepartmentId}". Managing a department is ` +
            `authority over its work, not over every case in the firm.`,
        )
      }

      if (existing.stage !== 'intake') {
        reject(
          'illegal-prior-state',
          `Case "${input.caseId}" is in ${existing.stage}. A playbook is ` +
            `instantiated once, out of intake.`,
        )
      }

      /*
       * Resolved through the registry, so the definition is the immutable one
       * this build ships rather than whatever the caller had in hand.
       */
      let requested
      try {
        requested = requirePlaybook(input.playbookId, input.playbookVersion)
      } catch (error) {
        if (error instanceof UnknownPlaybookError) reject('not-found', error.message)
        throw error
      }

      if (existing.subject.kind !== requested.caseKind) {
        reject(
          'invariant-violated',
          `Playbook "${requested.id}" applies to ${requested.caseKind} ` +
            `cases; "${input.caseId}" is a ${existing.subject.kind} case.`,
        )
      }

      /*
       * Validated against the ORGANIZATION, not against itself. A playbook
       * that names a department the firm does not have would otherwise produce
       * assignments nobody owns, discovered hours later as a case that never
       * moves.
       */
      try {
        validatePlaybook(requested, {
          knownDepartmentIds: organization.departments.map((d) => d.id),
          handlesByDepartment: Object.fromEntries(
            organization.departments.map((d) => [d.id, d.handles]),
          ),
        })
      } catch (error) {
        reject(
          'invariant-violated',
          error instanceof Error ? error.message : String(error),
        )
      }

      /*
       * Registration first. It is append-only and content-addressed, so this
       * either records the version or proves the stored one is identical —
       * and a version that was edited without being bumped fails here rather
       * than producing a case running under a workflow nobody can reproduce.
       */
      const playbook = await repositories.playbooks.register(requested)

      const events: TransitionEvent[] = []
      const assignments: Assignment[] = []

      const caseEventId = deriveEventId({
        commandId: context.commandId,
        recordType: 'case-instantiated',
        entityId: input.caseId,
      })

      for (const entry of playbook.entries) {
        const assignmentId = deriveAssignmentId(context.commandId, entry.key)
        const assignment = buildAssignment({
          id: assignmentId,
          caseId: input.caseId,
          playbookEntryKey: entry.key,
          departmentId: entry.departmentId,
          brief: entry.brief,
          status: 'queued',
          createdAt: context.occurredAt,
          priority: entry.priority,
        })
        assignments.push(await repositories.assignments.save(assignment))

        events.push(
          buildTransitionEvent({
            eventId: deriveEventId({
              commandId: context.commandId,
              recordType: 'assignment-queued',
              entityId: assignmentId,
            }),
            subject: 'assignment',
            caseId: input.caseId,
            assignmentId,
            fromState: null,
            toState: 'queued',
            actorEmployeeId: context.actor.employeeId ?? undefined,
            actorDepartmentId: context.actor.departmentId ?? undefined,
            occurredAt: context.occurredAt,
            correlationId: context.correlationId,
            /*
             * Every assignment points back at the movement that created it, so
             * a timeline can show one command producing seven facts rather than
             * seven unrelated ones.
             */
            causationId: caseEventId,
            aggregateVersion: existing.version + 1,
          }),
        )
      }

      /*
       * Participants grow to cover every department the playbook engages. A
       * case that assigns work to a department it does not list as a
       * participant would be invisible in that department's own view of what
       * it is involved in.
       */
      const participants = new Set([
        ...existing.participatingDepartmentIds,
        ...playbook.entries.map((entry) => entry.departmentId),
      ])

      const pinned = pinPlaybook(
        { ...existing, participatingDepartmentIds: [...participants].sort() },
        playbook.id,
        playbook.version,
      )

      const moved = transitionCase(pinned, 'research', {
        employeeId: context.actor.employeeId!,
        departmentId: context.actor.departmentId!,
        at: context.occurredAt,
      })

      const saved = await repositories.cases.save(moved, context.expectedVersion!)

      await repositories.events.append(
        caseEvent({
          eventId: caseEventId,
          caseId: input.caseId,
          from: 'intake',
          to: 'research',
          actorEmployeeId: context.actor.employeeId ?? undefined,
          actorDepartmentId: context.actor.departmentId ?? undefined,
          occurredAt: context.occurredAt,
          correlationId: context.correlationId,
          aggregateVersion: saved.version,
        }),
      )

      for (const event of events) await repositories.events.append(event)

      return { value: saved, resultKind: 'case', resultRef: saved.id }
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
