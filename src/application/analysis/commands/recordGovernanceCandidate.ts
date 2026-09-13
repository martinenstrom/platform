/**
 * What a control function's model produced, before any principal files it.
 *
 * ## Why this is not `RecordContribution`
 *
 * Measured, not preferred. A governance run produces findings, a verdict or
 * objections — it produces no CLAIMS — and two independent guards refuse a
 * claimless contribution, both of them correctly:
 *
 *   - `validateContribution` returns `no-claims`, because "a desk that
 *     completes and asserts nothing has not contributed; silence is recorded as
 *     a failure, which is a different institutional fact";
 *   - `produced_claims_not_empty` refuses an empty array, because "recording an
 *     empty set would make 'the agent returned nothing' and 'the agent was
 *     never asked' the same row".
 *
 * Neither is relaxed. Making a verification finding into a claim so that it
 * fits an existing pipe would destroy the distinction the pipe exists to keep,
 * so a control function records through its own command into its own store.
 *
 * ## What it is NOT
 *
 * It is not a governance verdict, and it carries no `governance-verdict`
 * mandate. Producing a candidate is a desk doing the work it was assigned; the
 * institutional act is FILING it, through `RecordVerificationReview`,
 * `RecordDevilsAdvocateReview` or `RecordPeerExamination`, under the authority
 * those commands already require. A model that could reach a verdict by
 * recording one would make the control function's mandate decorative.
 *
 * So this command creates no review, no finding, no challenge and no lifecycle
 * transition on the thesis. It writes one row to one candidate store and leaves
 * the run **awaiting acceptance** — not completed. A produced-but-unfiled
 * verification run that read as `completed` would say the control had been
 * performed, which is the precise laundering the candidate boundary exists to
 * prevent. Filing is what completes it.
 *
 * ## The basis is read, never supplied
 *
 * The caller supplies the ARTIFACT — the judgement, which is the model's. It
 * does not supply the basis. Which revision was under review and which claims
 * were in scope are facts of the record, and a producer that could declare its
 * own basis could declare a false one, leaving the stale check at filing time
 * comparing against a fiction of the producer's choosing.
 *
 * `claimsInScopeOf` is the same function the filing commands use to decide what
 * a verdict may speak about, so a candidate's observed set and the scope check
 * that will judge it cannot disagree.
 */

import {
  buildDevilsAdvocateCandidate,
  buildPeerExaminationCandidate,
  buildRunRecord,
  buildTransitionEvent,
  buildVerificationCandidate,
  canTransitionRun,
  budgetOverruns,
  type AgentRunRecord,
  type DevilsAdvocateCandidateArtifact,
  type GovernanceCandidateBasis,
  type Organization,
  type PeerExaminationCandidateArtifact,
  type RunEvent,
  type RunState,
  type RunUsage,
  type VerificationCandidateArtifact,
} from '~/domain/analysis'
import { claimsInScopeOf, PEER_EXAMINATION_ENTRY_KEY } from '../reviewRecording'
import { requirePlaybook } from '../playbookRegistry'
import { deriveEventId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'
import { asCanonicalValue, utf8ByteOrder } from '~/domain/shared/canonicalValue'

/**
 * Which control act was produced.
 *
 * A discriminated union rather than three optional fields, so "a run produced
 * exactly one kind of candidate" is a shape the type system holds rather than a
 * rule this command has to restate. The three stores stay separate underneath.
 */
export type ProducedGovernanceCandidate =
  | { kind: 'verification'; artifact: VerificationCandidateArtifact }
  | { kind: 'devils-advocate'; artifact: DevilsAdvocateCandidateArtifact }
  | {
      kind: 'peer-examination'
      artifact: PeerExaminationCandidateArtifact
      /**
       * Whose work was read.
       *
       * Declared at production and bound into the candidate's identity, so the
       * desk examined cannot change between producing and filing. Whether the
       * examiner is ALLOWED to examine it — not itself, not as a governance
       * department, not as the Devil's Advocate — stays on the filing command,
       * which is where those rules already live.
       */
      examinedDepartmentId: string
    }

export interface RecordGovernanceCandidateInput {
  caseId: string
  runId: string
  /** The desk that ran. Authority over its own work, as everywhere else. */
  departmentId: string
  observedStates: readonly RunState[]
  usage: RunUsage
  candidate: ProducedGovernanceCandidate
}

/**
 * Turns a domain builder's refusal into the institution's answer.
 *
 * The builders state their invariants by throwing — a blocking finding with no
 * correction, an objection nothing could settle, a Devil's Advocate filing with
 * nothing in it. Left to propagate, those arrive as a command that FAILED,
 * which reads as "the firm broke" rather than "the firm refused". They are
 * refusals, and a refusal is the organization working correctly, so they are
 * reported as one with the code the rest of the command already uses.
 *
 * The message is the builder's own: it names the rule and the claim, and a
 * rewritten one here would be a second description of the same rule, free to
 * drift from it.
 */
function refusing<T>(build: () => T): T {
  try {
    return build()
  } catch (error) {
    reject(
      'invariant-violated',
      error instanceof Error ? error.message : 'The candidate is not well formed.',
    )
  }
}

/** The discipline tag the playbook entry must carry to produce each act. */
const DISCIPLINE_FOR = {
  verification: 'verification',
  'devils-advocate': 'challenge',
} as const

export function recordGovernanceCandidate(
  _organization: Organization,
): CommandDefinition<RecordGovernanceCandidateInput, AgentRunRecord> {
  return {
    type: 'RecordGovernanceCandidate',
    /* Producing work does not move case-level state. */
    versionPolicy: 'refuses-expected-version',
    reasonPolicy: 'optional',
    /*
     * `analysis`, deliberately, and NOT `governance`. The governance category
     * is paired with the `governance-verdict` mandate, and this command issues
     * no verdict. A desk producing work it was assigned is analysis whatever
     * the desk happens to be.
     */
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
       * The artifact is part of what was asked, so it is part of the identity:
       * two different verdicts travelling under one command id must not resolve
       * to each other.
       */
      kind: input.candidate.kind,
      artifact: asCanonicalValue(input.candidate.artifact),
      ...(input.candidate.kind === 'peer-examination'
        ? { examinedDepartmentId: input.candidate.examinedDepartmentId }
        : {}),
      observedStates: input.observedStates,
      usage: asCanonicalValue(input.usage),
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
            `"${input.departmentId}". Recording produced work for a department ` +
            `is authority over its own work.`,
        )
      }

      /* The late-result guard, as on every other result-bearing command. */
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

      const overrun = budgetOverruns(run.budget, input.usage)
      if (overrun.length > 0) {
        reject(
          'invariant-violated',
          `Run "${input.runId}" reports spending beyond its authorized ` +
            `${overrun.join(' and ')}. Work the firm did not authorize is not ` +
            `recorded as work the firm may file.`,
        )
      }

      const investmentCase = await repositories.cases.get(input.caseId)
      if (!investmentCase) reject('not-found', `Case "${input.caseId}" does not exist`)
      if (investmentCase.stage === 'published' || investmentCase.stage === 'withdrawn') {
        reject(
          'illegal-prior-state',
          `Case "${input.caseId}" is ${investmentCase.stage} and accepts no ` +
            `further work.`,
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

      /* ------------------------------------------- the act this run may do */

      /*
       * Which control act a run is entitled to produce comes from the workflow
       * the case pinned, never from the caller. The alternative — believing the
       * `kind` on the input — would let the Rates desk produce a verification
       * verdict because the union has a member for it.
       */
      if (!investmentCase.playbookId || !investmentCase.playbookVersion) {
        reject(
          'illegal-prior-state',
          `Case "${input.caseId}" has no playbook, so no step is a control ` +
            `function and none may produce a candidate.`,
        )
      }
      const playbook = requirePlaybook(
        investmentCase.playbookId,
        investmentCase.playbookVersion,
      )
      const entryKey = assignment.playbookEntryKey
      const entry = entryKey
        ? playbook.entries.find((candidate) => candidate.key === entryKey)
        : undefined
      if (!entry || !entryKey) {
        reject(
          'invariant-violated',
          `Assignment "${run.assignmentId}" names no entry in ` +
            `"${playbook.id}@${playbook.version}".`,
        )
      }

      if (input.candidate.kind === 'peer-examination') {
        if (entry.key !== PEER_EXAMINATION_ENTRY_KEY) {
          reject(
            'not-authorised',
            `"${entry.key}" is not the peer examination step. A desk states ` +
              `claims; examining a peer is a different act, and this command ` +
              `does not carry it for whoever asks.`,
          )
        }
        if (input.candidate.examinedDepartmentId === run.departmentId) {
          reject(
            'invariant-violated',
            `"${run.departmentId}" cannot examine itself. A desk reading its ` +
              `own work is not peer scrutiny.`,
          )
        }
      } else {
        const required = DISCIPLINE_FOR[input.candidate.kind]
        if (entry.disciplineTag !== required) {
          reject(
            'not-authorised',
            `"${entry.key}" carries discipline "${entry.disciplineTag ?? 'none'}", ` +
              `not "${required}", so it is not the step that produces a ` +
              `${input.candidate.kind} candidate.`,
          )
        }
      }

      /* ---------------------------------------------------------- the basis */

      /*
       * Scrutiny is produced FROM a revision, and filed ONTO one. Binding them
       * here is what stops a verdict produced against one argument being filed
       * against another.
       */
      if (!run.revisionId) {
        reject(
          'invariant-violated',
          `Run "${input.runId}" declares no revision. Scrutiny is produced ` +
            `against the argument it examined, and one that names no argument ` +
            `could be filed against any of them.`,
        )
      }
      const revision = await repositories.theses.get(run.revisionId)
      if (!revision) {
        reject('not-found', `Revision "${run.revisionId}" does not exist`)
      }
      if (revision.lifecycle === 'superseded') {
        reject(
          'illegal-prior-state',
          `Revision "${run.revisionId}" was superseded while this work was in ` +
            `flight. The result stays attached to the revision it examined.`,
        )
      }

      /*
       * Exactly the claims the manager put in scope — the same set the filing
       * command will check a finding or an objection against. Read here rather
       * than accepted from the caller, so the basis a candidate declares is the
       * basis the institution will judge it by.
       */
      const inScope = await claimsInScopeOf(repositories, revision)
      const basis: GovernanceCandidateBasis = {
        caseId: input.caseId,
        thesisId: revision.thesisId,
        sourceRevisionId: revision.revisionId,
        playbookId: playbook.id,
        playbookVersion: playbook.version,
        playbookEntryKey: entryKey,
        observedClaimIds: [...inScope].sort(utf8ByteOrder),
      }

      /* ------------------------------------------------------- the write */

      /*
       * Built through the domain builders, which refuse what the filing command
       * would refuse: a blocking finding with no correction, an objection
       * nothing could settle, a Devil's Advocate filing with nothing in it, a
       * verdict on claims outside the basis. A candidate the institution could
       * not file is not stored.
       */
      switch (input.candidate.kind) {
        case 'verification': {
          const artifact = input.candidate.artifact
          await repositories.producedVerifications.record(
            refusing(() =>
              buildVerificationCandidate({
                runId: run.id,
                artifact,
                basis,
                producedAt: context.occurredAt,
              }),
            ),
          )
          break
        }
        case 'devils-advocate': {
          const artifact = input.candidate.artifact
          await repositories.producedChallenges.record(
            refusing(() =>
              buildDevilsAdvocateCandidate({
                runId: run.id,
                artifact,
                basis,
                producedAt: context.occurredAt,
              }),
            ),
          )
          break
        }
        case 'peer-examination': {
          const { artifact, examinedDepartmentId } = input.candidate
          await repositories.producedPeerExaminations.record(
            refusing(() =>
              buildPeerExaminationCandidate({
                runId: run.id,
                artifact,
                basis: { ...basis, examinedDepartmentId },
                producedAt: context.occurredAt,
              }),
            ),
          )
          break
        }
      }

      const produced = await repositories.runs.save(
        buildRunRecord({
          ...run,
          state: 'awaiting-acceptance',
          /*
           * Empty, and correctly so. A control function produces no claims, and
           * the run's `claims` is a projection of the institutional table.
           */
          claims: [],
          usage: input.usage,
          events: [
            ...run.events,
            ...producedEvents(run, input.observedStates, context.occurredAt),
          ],
        }),
        context.provenance,
      )

      /*
       * `run-produced-work`, the same transition the analytical path emits, and
       * deliberately not a governance event: nothing was verified, challenged
       * or examined as far as the institution is concerned. The floor may say
       * the desk produced something; it may not say the control was performed.
       *
       * The actor is written through both principal fields, so an agent's
       * production is attributed to the agent rather than to nobody.
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
          revisionId: revision.revisionId,
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
       * The assignment does not move, for the reason `RecordContribution` gives:
       * the desk still owes work nobody has acted on, and `awaiting-acceptance`
       * is not an assignment status. It completes when the candidate is filed.
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
 * The run events this production adds.
 *
 * Only states the provider actually reported, plus the state the run actually
 * reached — `awaiting-acceptance`, never `completed`. Writing `completed` here
 * would put "Verification finished" on the activity floor for a verdict nobody
 * has filed, which is exactly the claim the candidate boundary withholds.
 * Completion belongs to the filing act.
 */
function producedEvents(
  run: AgentRunRecord,
  observedStates: readonly RunState[],
  at: string,
): RunEvent[] {
  const added: RunEvent[] = []
  let previous: RunState = run.events[run.events.length - 1]?.state ?? run.state

  for (const state of [...observedStates, 'awaiting-acceptance' as const]) {
    if (state === previous) continue
    added.push({ runId: run.id, at, state })
    previous = state
  }
  return added
}
