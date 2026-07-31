/**
 * Recording what a department produced.
 *
 * The second half of the external-work boundary. The provider has already run,
 * outside any transaction; this command takes what came back and decides, in
 * one transaction, whether it becomes part of the record.
 *
 * ## Everything or nothing
 *
 * Run completion, the immutable result, every claim, the assignment's
 * completion and the events commit together. A partial contribution is the
 * worst outcome available: a completed run with half its claims reads as a
 * desk that found less than it did, and nothing downstream could tell.
 *
 * ## Where the checking happens, and why here
 *
 * Between the provider returning and this write is the last moment the firm can
 * refuse a claim. Afterwards it is cited by theses, weighed by governance and
 * rendered as the firm's own reasoning. `contributionValidation` holds the
 * rules; this command decides what to do about them, which is to reject with a
 * bounded code — durably, so "the quant desk answered with something
 * inadmissible" survives as a fact rather than as an absence.
 *
 * ## Late results
 *
 * A provider that answers after the world moved on is refused rather than
 * quietly attached: a run that is no longer running, an assignment that was
 * cancelled, a case that published, or a revision that was superseded while the
 * desk was working. The refusal is recorded in the ledger with its reason code.
 * Settling the run itself is `FailAgentRun`'s job — this command either records
 * a contribution or records nothing.
 */

import {
  buildAssignment,
  buildClaim,
  buildRunRecord,
  canTransitionRun,
  type AgentClaim,
  type AgentRunRecord,
  executionIdentityKey,
  type Organization,
  type RunEvent,
  type RunState,
  type RunUsage,
} from '~/domain/analysis'
import { buildTransitionEvent } from '~/domain/analysis'
import { describeDefect, validateContribution } from '../contributionValidation'
import { CANONICALIZATION_VERSION, resultKey } from '../resultStore'
import { deriveClaimId, deriveEventId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'

export interface RecordContributionInput {
  caseId: string
  runId: string
  /** Declared for the mandate; verified against the run's own department. */
  departmentId: string
  /**
   * What the department asserts, as the provider named them.
   *
   * The ids are the provider's and stay the provider's only until they are
   * stored — see `deriveClaimId`. A counterclaim contesting another claim in
   * the same contribution is translated with them, so the link survives.
   */
  claims: readonly AgentClaim[]
  /**
   * States the provider passed through.
   *
   * Appended to the run's event log so the floor reflects what actually
   * happened rather than a synthetic start-and-finish pair. Nothing invents a
   * state here: a provider that reported none produces one completion event.
   */
  observedStates: readonly RunState[]
  /**
   * What it consumed.
   *
   * Three states, never a nullable number: a replay and a stub report
   * `not-applicable`, a live provider that measured nothing reports
   * `not-reported`, and a measurement is a measurement — including zero. The
   * combination is checked against the run's provider kind, so a stub cannot
   * report spend and a live call cannot claim it was free.
   */
  usage: RunUsage
}

export function recordContribution(
  _organization: Organization,
): CommandDefinition<RecordContributionInput, AgentRunRecord> {
  return {
    type: 'RecordContribution',
    /* Completing one department's work does not move case-level state. */
    versionPolicy: 'refuses-expected-version',
    /*
     * Optional. Ordinary forward motion: a desk delivering what it was asked
     * for owes no explanation, and requiring prose for routine progress
     * produces prose nobody reads.
     */
    reasonPolicy: 'optional',
    category: 'analysis',
    mandate: (input) => ({
      kind: 'department-contribution',
      departmentId: input.departmentId,
    }),
    scope: (input) => ({ caseId: input.caseId }),
    payload: (input) => ({
      runId: input.runId,
      departmentId: input.departmentId,
      /*
       * The claims are part of what was asked, so they are part of the
       * identity: two different contributions travelling under one command id
       * must not resolve to each other. Their provider-supplied ids are
       * included for the same reason.
       */
      claims: input.claims,
      observedStates: input.observedStates,
      usage: input.usage,
    }),

    async execute(repositories, context, input) {
      /* ------------------------------------------------------ the world */

      const run = await repositories.runs.get(input.runId)
      if (!run) reject('not-found', `Run "${input.runId}" does not exist`)
      if (run.caseId !== input.caseId) {
        reject('invariant-violated', `Run "${input.runId}" belongs to another case`)
      }
      if (run.departmentId !== input.departmentId) {
        reject(
          'not-authorised',
          `Run "${input.runId}" belongs to "${run.departmentId}", not to ` +
            `"${input.departmentId}". Recording a contribution for a department ` +
            `is authority over its own work.`,
        )
      }

      /*
       * The late-result guard. A settled run keeps the outcome it settled on:
       * a provider answering after the organization cancelled the work must
       * not overwrite the cancellation with its own account of events.
       */
      if (run.state !== 'running') {
        reject(
          'illegal-prior-state',
          `Run "${input.runId}" is ${run.state}, not running. A result that ` +
            `arrives after the run settled is late, not authoritative.`,
        )
      }
      if (!canTransitionRun(run.state, 'completed')) {
        reject(
          'illegal-prior-state',
          `Run "${input.runId}" cannot move from ${run.state} to completed`,
        )
      }

      const investmentCase = await repositories.cases.get(input.caseId)
      if (!investmentCase) reject('not-found', `Case "${input.caseId}" does not exist`)
      if (investmentCase.stage === 'published' || investmentCase.stage === 'withdrawn') {
        reject(
          'illegal-prior-state',
          `Case "${input.caseId}" is ${investmentCase.stage} and accepts no ` +
            `further contributions.`,
        )
      }

      const assignment = await repositories.assignments.get(run.assignmentId)
      if (!assignment) {
        reject('not-found', `Assignment "${run.assignmentId}" does not exist`)
      }
      if (assignment.status === 'cancelled') {
        reject(
          'illegal-prior-state',
          `Assignment "${run.assignmentId}" was cancelled. The organization ` +
            `withdrew this work before the answer arrived.`,
        )
      }

      /*
       * A superseded revision is refused rather than reattached. The work
       * reasoned over assumptions the firm has already replaced, and moving it
       * onto the current revision would attribute conclusions to a thesis that
       * never saw them. The run is settled as `superseded` by `FailAgentRun`.
       */
      if (run.revisionId) {
        const revision = await repositories.theses.get(run.revisionId)
        if (!revision) {
          reject('not-found', `Revision "${run.revisionId}" does not exist`)
        }
        if (revision.lifecycle === 'superseded') {
          reject(
            'illegal-prior-state',
            `Revision "${run.revisionId}" was superseded while this work was in ` +
              `flight. The result stays attached to the revision it targeted ` +
              `rather than to an argument built on different assumptions.`,
          )
        }
      }

      /* -------------------------------------------------- admissibility */

      const evidenceSet = await repositories.evidence.get(run.evidenceSetId)
      if (!evidenceSet) {
        reject(
          'not-found',
          `Evidence set "${run.evidenceSetId}" does not exist. A contribution ` +
            `cannot be checked against evidence that is not stored.`,
        )
      }

      const defects = validateContribution({ claims: input.claims, evidenceSet })
      if (defects.length > 0) {
        reject('invariant-violated', defects.map(describeDefect).join(' '))
      }

      /*
       * A counterclaim may contest a claim from another desk's run, which is
       * the Devil's Advocate's whole purpose. Those ids are already stored, so
       * they are verified rather than translated — a dangling contest would be
       * an objection to nothing.
       */
      const localIds = new Set(input.claims.map((claim) => claim.id))
      for (const claim of input.claims) {
        if (!claim.contests || localIds.has(claim.contests)) continue
        const contested = await repositories.claims.get(claim.contests)
        if (!contested) {
          reject(
            'not-found',
            `Claim "${claim.id}" contests "${claim.contests}", which is neither ` +
              `part of this contribution nor a claim the firm has recorded.`,
          )
        }
      }

      /* ------------------------------------------------------- the write */

      const stored = input.claims.map((claim) =>
        buildClaim({
          ...claim,
          id: deriveClaimId(context.commandId, claim.id),
          ...(claim.contests && localIds.has(claim.contests)
            ? { contests: deriveClaimId(context.commandId, claim.contests) }
            : {}),
        }),
      )

      for (const claim of stored) {
        await repositories.claims.save(claim, input.caseId, run.id)
      }

      const events = [
        ...run.events,
        ...contributionEvents(run, input, context.occurredAt),
      ]

      const completed = await repositories.runs.save(
        buildRunRecord({
          ...run,
          state: 'completed',
          completedAt: context.occurredAt,
          claims: stored,
          usage: input.usage,
          events,
        }),
        context.provenance,
      )

      /*
       * The immutable result, keyed on every semantic input.
       *
       * Written inside the same transaction as the run it describes: a stored
       * result whose run rolled back would be reusable analysis attributed to
       * work that never completed.
       */
      const inputs = {
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
          claims: stored,
          storedAt: context.occurredAt,
          providerKind: run.execution.providerKind,
          inputs,
        },
        context.provenance,
      )

      await repositories.assignments.save(
        buildAssignment({
          ...assignment,
          status: 'completed',
          completedAt: context.occurredAt,
        }),
      )

      const runEventId = deriveEventId({
        commandId: context.commandId,
        recordType: 'run-completed',
        entityId: run.id,
      })

      await repositories.events.append(
        buildTransitionEvent({
          eventId: runEventId,
          subject: 'run',
          caseId: input.caseId,
          assignmentId: run.assignmentId,
          runId: run.id,
          ...(run.revisionId ? { revisionId: run.revisionId } : {}),
          fromState: run.state,
          toState: 'completed',
          actorEmployeeId: context.actor.employeeId ?? undefined,
          actorDepartmentId: run.departmentId,
          occurredAt: context.occurredAt,
          correlationId: context.correlationId,
          aggregateVersion: investmentCase.version,
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
          actorEmployeeId: context.actor.employeeId ?? undefined,
          actorDepartmentId: run.departmentId,
          occurredAt: context.occurredAt,
          correlationId: context.correlationId,
          causationId: runEventId,
          aggregateVersion: investmentCase.version,
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

/**
 * The run events this contribution adds.
 *
 * Only states the provider actually reported, plus the completion. A state
 * repeated from the one already recorded is dropped rather than written as a
 * transition to itself — the activity feed reads these directly, and a
 * department appearing to start work it was already doing is invented activity
 * however honestly it got there.
 */
function contributionEvents(
  run: AgentRunRecord,
  input: RecordContributionInput,
  at: string,
): RunEvent[] {
  const added: RunEvent[] = []
  let previous: RunState = run.events[run.events.length - 1]?.state ?? run.state

  for (const state of [...input.observedStates, 'completed' as const]) {
    if (state === previous) continue
    added.push({ runId: run.id, at, state })
    previous = state
  }
  return added
}
