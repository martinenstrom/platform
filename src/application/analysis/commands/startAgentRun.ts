/**
 * Starting a specialist run.
 *
 * The first half of the external-work boundary. This command commits, and only
 * then does the provider execute — so a PostgreSQL transaction is never open
 * while something slow, remote or failable is happening.
 *
 * That ordering is not a convention. `runCommand` opens the transaction, this
 * body runs inside it, and the body has no way to reach a provider: nothing in
 * `commands/` may import `contributionPort`, asserted by a fitness rule. The
 * orchestrator holds the provider and calls it between two commands.
 *
 * ## What "ready" means here
 *
 * Not a stored flag. An entry is ready when every **blocking** dependency has a
 * completed run — derived from the playbook graph and the runs that exist,
 * rather than from a readiness column that would be a second source of truth
 * about the same fact.
 *
 * Optional inputs never gate readiness. The ones that have not landed are
 * recorded on the run, because which perspectives were unavailable *at the time
 * the work was done* is a fact about the work, and deriving it later would let
 * it change as late contributions arrived.
 */

import {
  buildAssignment,
  buildRunRecord,
  isRunTerminal,
  type AgentRunRecord,
  type ModelRef,
  type Organization,
  type PromptRef,
  type ProviderKind,
} from '~/domain/analysis'
import { buildTransitionEvent } from '~/domain/analysis'
import { requirePlaybook } from '../playbookRegistry'
import { deriveEventId, deriveRunId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'

export interface StartAgentRunInput {
  caseId: string
  assignmentId: string
  /**
   * The department the actor is contributing for.
   *
   * Declared so the mandate can be decided before the assignment is read, and
   * verified inside `execute` against the assignment's own department — the
   * same shape as `InstantiatePlaybook`. A caller naming a department it
   * belongs to, on an assignment owned elsewhere, is rejected.
   */
  departmentId: string
  /** The exact revision this contributes to, where the work is thesis-scoped. */
  revisionId?: string

  /** Declared before execution, so the record says what was asked to run. */
  providerId: string
  providerVersion: string
  providerKind: ProviderKind

  agentContractVersion: string
  outputSchemaVersion: string
  prompt: PromptRef
  model: ModelRef
  evidenceSetId: string
}

export function startAgentRun(
  organization: Organization,
): CommandDefinition<StartAgentRunInput, AgentRunRecord> {
  return {
    type: 'StartAgentRun',
    /* Starting work does not move case-level state. */
    versionPolicy: 'refuses-expected-version',
    reasonPolicy: 'optional',
    category: 'workflow',
    mandate: (input) => ({
      kind: 'department-contribution',
      departmentId: input.departmentId,
    }),
    scope: (input) => ({
      caseId: input.caseId,
      ...(input.revisionId ? { thesisRevisionId: input.revisionId } : {}),
    }),
    payload: (input) => ({
      assignmentId: input.assignmentId,
      departmentId: input.departmentId,
      providerId: input.providerId,
      providerVersion: input.providerVersion,
      providerKind: input.providerKind,
      agentContractVersion: input.agentContractVersion,
      outputSchemaVersion: input.outputSchemaVersion,
      prompt: input.prompt,
      model: input.model,
      evidenceSetId: input.evidenceSetId,
    }),

    async execute(repositories, context, input) {
      const investmentCase = await repositories.cases.get(input.caseId)
      if (!investmentCase) reject('not-found', `Case "${input.caseId}" does not exist`)

      if (investmentCase.stage === 'published' || investmentCase.stage === 'withdrawn') {
        reject(
          'illegal-prior-state',
          `Case "${input.caseId}" is ${investmentCase.stage} and accepts no new work.`,
        )
      }

      const assignment = await repositories.assignments.get(input.assignmentId)
      if (!assignment) {
        reject('not-found', `Assignment "${input.assignmentId}" does not exist`)
      }
      if (assignment.caseId !== input.caseId) {
        reject(
          'invariant-violated',
          `Assignment "${input.assignmentId}" belongs to another case.`,
        )
      }
      if (assignment.departmentId !== input.departmentId) {
        reject(
          'not-authorised',
          `Assignment "${input.assignmentId}" is owed by ` +
            `"${assignment.departmentId}", not by "${input.departmentId}". ` +
            `Contributing for a department is authority over its own work.`,
        )
      }
      if (assignment.status !== 'queued' && assignment.status !== 'returned') {
        reject(
          'illegal-prior-state',
          `Assignment "${input.assignmentId}" is ${assignment.status} and is not ` +
            `waiting to be picked up.`,
        )
      }

      /*
       * The playbook the CASE is pinned to, not the currently approved one. A
       * case runs to completion under the workflow it started on, so readiness
       * must be judged against that graph.
       */
      if (!investmentCase.playbookId || !investmentCase.playbookVersion) {
        reject(
          'illegal-prior-state',
          `Case "${input.caseId}" has no playbook. Instantiate one before ` +
            `starting work against it.`,
        )
      }
      const playbook = requirePlaybook(
        investmentCase.playbookId,
        investmentCase.playbookVersion,
      )

      const entryKey = assignment.playbookEntryKey
      if (!entryKey) {
        reject(
          'invariant-violated',
          `Assignment "${input.assignmentId}" came from no playbook entry. ` +
            `Ad-hoc work has no dependency graph and cannot be started this way.`,
        )
      }
      const entry = playbook.entries.find((candidate) => candidate.key === entryKey)
      if (!entry) {
        reject(
          'invariant-violated',
          `Playbook "${playbook.id}@${playbook.version}" has no entry ` +
            `"${entryKey}".`,
        )
      }

      /* ------------------------------------------------------- readiness */

      const runs = await repositories.runs.listForCase(input.caseId)

      const completedEntryKeys = new Set(
        runs
          .filter((run) => run.state === 'completed')
          .map((run) => run.execution.playbookEntryKey),
      )

      const unmetBlocking = entry.blockedBy.filter((key) => !completedEntryKeys.has(key))
      if (unmetBlocking.length > 0) {
        reject(
          'illegal-prior-state',
          `Entry "${entryKey}" blocks on ${unmetBlocking.join(', ')}, which ` +
            `${unmetBlocking.length === 1 ? 'has' : 'have'} not completed.`,
        )
      }

      // Never a gate. Recorded as the conditions this work was done under.
      const missingOptionalInputs = entry.optionalInputs.filter(
        (key) => !completedEntryKeys.has(key),
      )

      /*
       * At most one live run per assignment. The partial unique index in 0015
       * is what actually enforces it — two concurrent starts would both read
       * "none active" here — but rejecting cleanly is better than surfacing a
       * constraint violation for a condition the caller can understand.
       */
      const active = runs.find(
        (run) => run.assignmentId === input.assignmentId && !isRunTerminal(run.state),
      )
      if (active) {
        reject(
          'illegal-prior-state',
          `Assignment "${input.assignmentId}" already has run "${active.id}" in ` +
            `${active.state}.`,
        )
      }

      if (input.revisionId) {
        const revision = await repositories.theses.get(input.revisionId)
        if (!revision) {
          reject('not-found', `Revision "${input.revisionId}" does not exist`)
        }
        if (revision.caseId !== input.caseId) {
          reject('invariant-violated', `Revision "${input.revisionId}" is another case's`)
        }
        if (revision.lifecycle === 'superseded') {
          reject(
            'illegal-prior-state',
            `Revision "${input.revisionId}" is superseded. Work started against ` +
              `it would reason over assumptions the firm has already replaced.`,
          )
        }
      }

      const employeeId = context.actor.employeeId!
      if (!organization.employees.some((e) => e.id === employeeId)) {
        reject('not-found', `"${employeeId}" is not an employee of the firm`)
      }

      /* -------------------------------------------------------- the write */

      const runId = deriveRunId(context.commandId, input.assignmentId)

      const run = buildRunRecord({
        id: runId,
        caseId: input.caseId,
        assignmentId: input.assignmentId,
        departmentId: assignment.departmentId,
        employeeId,
        agentContractVersion: input.agentContractVersion,
        outputSchemaVersion: input.outputSchemaVersion,
        prompt: input.prompt,
        model: input.model,
        evidenceSetId: input.evidenceSetId,
        state: 'running',
        ...(input.revisionId ? { revisionId: input.revisionId } : {}),
        startedAt: context.occurredAt,
        events: [{ runId, at: context.occurredAt, state: 'running' }],
        claims: [],
        missingOptionalInputs,
        execution: {
          playbookId: playbook.id,
          playbookVersion: playbook.version,
          playbookEntryKey: entryKey,
          providerId: input.providerId,
          providerVersion: input.providerVersion,
          providerKind: input.providerKind,
        },
      })

      const saved = await repositories.runs.save(run, context.provenance)

      await repositories.assignments.save(
        buildAssignment({
          ...assignment,
          status: 'active',
          assigneeEmployeeId: employeeId,
          startedAt: context.occurredAt,
        }),
      )

      const runEventId = deriveEventId({
        commandId: context.commandId,
        recordType: 'run-started',
        entityId: runId,
      })

      await repositories.events.append(
        buildTransitionEvent({
          eventId: runEventId,
          subject: 'run',
          caseId: input.caseId,
          assignmentId: input.assignmentId,
          runId,
          ...(input.revisionId ? { revisionId: input.revisionId } : {}),
          fromState: null,
          toState: 'running',
          actorEmployeeId: employeeId,
          actorDepartmentId: assignment.departmentId,
          occurredAt: context.occurredAt,
          correlationId: context.correlationId,
          aggregateVersion: investmentCase.version,
        }),
      )

      await repositories.events.append(
        buildTransitionEvent({
          eventId: deriveEventId({
            commandId: context.commandId,
            recordType: 'assignment-active',
            entityId: input.assignmentId,
          }),
          subject: 'assignment',
          caseId: input.caseId,
          assignmentId: input.assignmentId,
          fromState: assignment.status,
          toState: 'active',
          actorEmployeeId: employeeId,
          actorDepartmentId: assignment.departmentId,
          occurredAt: context.occurredAt,
          correlationId: context.correlationId,
          causationId: runEventId,
          aggregateVersion: investmentCase.version,
        }),
      )

      return { value: saved, resultKind: 'run', resultRef: saved.id }
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
