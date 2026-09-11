/**
 * Recording what a department produced.
 *
 * The second half of the external-work boundary. The provider has already run,
 * outside any transaction; this command takes what came back and decides, in
 * one transaction, whether it is admissible enough to keep.
 *
 * ## It does not make the work institutional
 *
 * The run lands in `awaiting-acceptance` and the claims land in the
 * produced-claim store — durable, readable, paid for, and outside
 * `analysis.claims`, so nothing can verify, gate, aggregate or cite them.
 * `AcceptContribution` is the only path across that boundary, and it is where
 * the result store fills and the assignment completes. Neither happens here: a
 * rejected result must never become reusable merely because the model produced
 * it successfully, and work nobody accepted has not discharged the department's
 * obligation.
 *
 * ## Everything or nothing
 *
 * The produced claims, the run's new state and the events commit together. A
 * partial contribution is the worst outcome available: a run recorded with half
 * its claims reads as a desk that found less than it did, and nothing
 * downstream could tell.
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
  budgetOverruns,
  buildClaim,
  buildRunRecord,
  canTransitionRun,
  type AgentClaim,
  type AgentRunRecord,
  type Organization,
  type RunEvent,
  type RunState,
  type RunUsage,
  type SynthesisArtifact,
  buildProducedSynthesis,
} from '~/domain/analysis'
import { buildTransitionEvent } from '~/domain/analysis'
import { describeDefect, validateContribution } from '../contributionValidation'
import { deriveClaimId, deriveEventId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'
import { asCanonicalValue, utf8ByteOrder } from '~/domain/shared/canonicalValue'
import { accountableEntryKeyFor } from '../caseIntake'
import { requirePlaybook } from '../playbookRegistry'

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
   * States the provider passed through, describing its own execution.
   *
   * Appended to the run's event log so the floor reflects what actually
   * happened rather than a synthetic start-and-finish pair. Bounded by
   * `OBSERVABLE_BY_PROVIDER`: a provider reports progress, never an outcome the
   * firm has not granted.
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
  /**
   * The department's synthesis, where the department's work IS a synthesis.
   *
   * Legal for exactly one step: the entry the case's accountable desk answers
   * for, in the playbook the case pinned. Every other desk supplying one is
   * refused — this command is not a generic artifact envelope, and an optional
   * field is not a licence.
   *
   * Absent everywhere else, and absent is absent. A contribution that produced
   * no synthesis produced none.
   */
  synthesis?: SynthesisArtifact
}

/**
 * The states a provider may report having passed through.
 *
 * Progress only. Every outcome is excluded, and for two different reasons:
 * `awaiting-acceptance` and `completed` are institutional facts the firm
 * grants — the first by this command, the second only by a person — and every
 * stopped state belongs to `FailAgentRun`, which is a separate command because
 * failure is a different institutional fact rather than a completion with no
 * output.
 */
const OBSERVABLE_BY_PROVIDER: readonly RunState[] = [
  'queued',
  'waiting-for-dependencies',
  'ready',
  'running',
]

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
      claims: asCanonicalValue(input.claims),
      observedStates: input.observedStates,
      usage: asCanonicalValue(input.usage),
      /*
       * Included only when a synthesis was produced, so a contribution without
       * one hashes to exactly the bytes it always did. The same conditional-key
       * rule the accountable principal follows in `commandPayloadHash`: an
       * absent key is absent from the encoding, and every historical
       * contribution keeps the identity it was recorded under.
       */
      ...(input.synthesis ? { synthesis: asCanonicalValue(input.synthesis) } : {}),
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
      if (!canTransitionRun(run.state, 'awaiting-acceptance')) {
        reject(
          'illegal-prior-state',
          `Run "${input.runId}" cannot move from ${run.state} to ` +
            `awaiting-acceptance`,
        )
      }

      /*
       * Work that cost more than the run was authorized to spend does not
       * enter the produced store.
       *
       * The orchestrator settles such a run as `budget-exhausted` before ever
       * reaching this command; this is the copy that holds when something
       * calls the command directly. Refused rather than recorded-and-flagged,
       * because a produced claim is work a person may accept, and offering
       * someone the choice to accept unauthorized spend puts the decision in
       * the wrong place.
       *
       * Compared against the budget carried on the run, never against current
       * policy: the authorization is a fact of the record, and re-reading it
       * from a source that has since changed would let a policy edit decide
       * whether finished work was affordable.
       */
      const overrun = budgetOverruns(run.budget, input.usage)
      if (overrun.length > 0) {
        reject(
          'invariant-violated',
          `Run "${input.runId}" reports spending beyond its authorized ` +
            `${overrun.join(' and ')}. Work the firm did not authorize is not ` +
            `recorded as work the firm may accept.`,
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
       * A provider describes its own execution and nothing beyond it. These
       * states are appended to the run's event log, which the activity feed
       * renders directly — so a provider permitted to report `completed` could
       * put "the desk finished" on the headquarters floor for work no human has
       * read, which is the one claim this whole boundary exists to withhold.
       */
      const unobservable = input.observedStates.filter(
        (state) => !OBSERVABLE_BY_PROVIDER.includes(state),
      )
      if (unobservable.length > 0) {
        reject(
          'invariant-violated',
          `A provider reported passing through ${unobservable
            .map((state) => `"${state}"`)
            .join(', ')}. A provider reports its own progress; how the work ` +
            `settles is the firm's to record.`,
        )
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

      /* ------------------------------------------- the synthesis candidate */

      /*
       * A synthesis is legal for exactly one step, and which step that is comes
       * from persisted facts: the case's own kind, routed through the intake
       * policy to an accountable discipline, resolved against the playbook THIS
       * CASE PINNED. Not from the caller, not from the department id on the
       * input, and not from a hardcoded department name — an equity workflow
       * whose synthesis desk is Equity Research routes the same way without a
       * line of code changing.
       *
       * The alternative — accepting a synthesis from whoever supplies one —
       * would turn this command into a generic artifact envelope, and Global
       * Macro would be able to write the firm's position because the input type
       * grew an optional field.
       */
      const candidate = input.synthesis
      if (candidate) {
        if (!investmentCase.playbookId || !investmentCase.playbookVersion) {
          reject(
            'illegal-prior-state',
            `Case "${input.caseId}" has no playbook, so no step is the ` +
              `accountable synthesis and none may produce one.`,
          )
        }
        const playbook = requirePlaybook(
          investmentCase.playbookId,
          investmentCase.playbookVersion,
        )
        const synthesisEntryKey = accountableEntryKeyFor(
          investmentCase.subject.kind,
          playbook,
        )
        if (synthesisEntryKey === null) {
          reject(
            'invariant-violated',
            `Playbook "${playbook.id}@${playbook.version}" names no single ` +
              `accountable desk for a "${investmentCase.subject.kind}" case, so ` +
              `there is no step whose work is a synthesis.`,
          )
        }
        if (assignment.playbookEntryKey !== synthesisEntryKey) {
          reject(
            'not-authorised',
            `"${assignment.playbookEntryKey}" is not the accountable synthesis ` +
              `step for this case; "${synthesisEntryKey}" is. A desk states ` +
              `claims. Stating the firm's position is a different act, and this ` +
              `command does not carry it for whoever asks.`,
          )
        }

        /*
         * A synthesis is produced FROM a revision, and the adoption command
         * synthesises ONTO one. Binding them here is what stops a candidate
         * produced against one argument being adopted onto another.
         */
        if (!run.revisionId) {
          reject(
            'invariant-violated',
            `Run "${input.runId}" declares no revision. A synthesis is produced ` +
              `from the argument it reconciles, and one that names no argument ` +
              `could be adopted onto any of them.`,
          )
        }

        /*
         * The exact run universe the adoption command reasons over — every
         * completed run on the case — captured now. Adoption recomputes it and
         * refuses on inequality. Not a timestamp: "produced two minutes ago"
         * says nothing about whether the inputs moved.
         */
        const completed = await repositories.runs.listForCase(input.caseId)
        const observedCompletedRunIds = completed
          .filter((other) => other.state === 'completed')
          /*
           * Excluding this run itself, and necessarily: the synthesis is
           * produced BEFORE its own contribution is accepted, so its own run is
           * still `running` here and `completed` by the time anyone adopts.
           * Including it would make every candidate stale against itself.
           *
           * It is also the truthful scope. A synthesis's basis is the other
           * accepted contributions it reconciled; a desk does not reconcile its
           * own unaccepted work.
           */
          .filter((other) => other.id !== run.id)
          .map((other) => other.id)
          .sort(utf8ByteOrder)

        const produced = buildProducedSynthesis({
          runId: run.id,
          artifact: candidate,
          basis: {
            caseId: input.caseId,
            sourceRevisionId: run.revisionId,
            playbookId: playbook.id,
            playbookVersion: playbook.version,
            observedCompletedRunIds,
          },
          producedAt: context.occurredAt,
        })
        await repositories.producedSyntheses.record(produced)
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

      /*
       * Into the produced-claim store, NOT the case.
       *
       * Generated work is operational until a human accepts it. These claims
       * are durable and readable — the firm paid for them — and outside
       * `analysis.claims`, so nothing can verify, gate, aggregate or cite them.
       * `AcceptContribution` is the only path across that boundary.
       */
      await repositories.producedClaims.record(run.id, input.caseId, stored)

      const events = [
        ...run.events,
        ...contributionEvents(run, input, context.occurredAt),
      ]

      const produced = await repositories.runs.save(
        buildRunRecord({
          ...run,
          state: 'awaiting-acceptance',
          /*
           * `claims` is a projection of the institutional table, so it is
           * empty here and correctly so: nothing has been accepted. The work
           * lives in the produced-claim store until somebody says otherwise.
           */
          claims: [],
          usage: input.usage,
          events,
        }),
        context.provenance,
      )

      /*
       * The result store is deliberately NOT written here, and the assignment
       * is deliberately NOT completed.
       *
       * The store exists so identical analysis can be reused rather than
       * re-run. Filling it before acceptance would let a later identical run
       * reuse work the firm declined — a rejected result becoming reusable
       * merely because the model produced it successfully. And work nobody has
       * accepted has not discharged the department's obligation.
       *
       * Both happen in `AcceptContribution`, atomically with the claims.
       */

      await repositories.events.append(
        buildTransitionEvent({
          eventId: deriveEventId({
            commandId: context.commandId,
            recordType: 'run-produced-work',
            entityId: run.id,
          }),
          subject: 'run',
          caseId: input.caseId,
          assignmentId: run.assignmentId,
          runId: run.id,
          ...(run.revisionId ? { revisionId: run.revisionId } : {}),
          fromState: run.state,
          toState: 'awaiting-acceptance',
          actorEmployeeId: context.actor.employeeId ?? undefined,
          actorAgentPrincipalId: context.actor.agentPrincipalId ?? undefined,
          actorDepartmentId: run.departmentId,
          occurredAt: context.occurredAt,
          correlationId: context.correlationId,
          aggregateVersion: investmentCase.version,
        }),
      )

      /*
       * There is no assignment event here, because the assignment did not move.
       * It stays `active`: the desk still owes work nobody has accepted. An
       * event announcing a transition the row did not make would leave the
       * timeline and the record disagreeing about the same assignment — and
       * `awaiting-acceptance` is not an assignment status at all. The
       * assignment completes in `AcceptContribution`, and its event is emitted
       * there, where it is true.
       */

      return { value: produced, resultKind: 'run', resultRef: produced.id }
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
 * Only states the provider actually reported, plus the state the run actually
 * reached — `awaiting-acceptance`, not `completed`. The activity feed reads
 * these directly, so writing `completed` here would put "the macro desk
 * finished" on the floor for work no human has looked at, which is precisely
 * the claim this whole boundary exists to withhold. Completion is appended by
 * `AcceptContribution`, when it is true.
 *
 * A state repeated from the one already recorded is dropped rather than written
 * as a transition to itself — a department appearing to start work it was
 * already doing is invented activity however honestly it got there.
 */
function contributionEvents(
  run: AgentRunRecord,
  input: RecordContributionInput,
  at: string,
): RunEvent[] {
  const added: RunEvent[] = []
  let previous: RunState = run.events[run.events.length - 1]?.state ?? run.state

  for (const state of [...input.observedStates, 'awaiting-acceptance' as const]) {
    if (state === previous) continue
    added.push({ runId: run.id, at, state })
    previous = state
  }
  return added
}
