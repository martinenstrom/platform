/**
 * Putting one exact revision in front of the control functions.
 *
 * **Submission is not approval.** It is the act of saying "this argument is
 * finished enough to be checked", and the strongest form of that is structural:
 * the input has no status, outcome or verdict field, so a caller cannot state
 * an opinion because there is nowhere to put one. The same shape that closed
 * TD-29 for `ResolveConditionalRequirement`.
 *
 * ## It activates a queue rather than inventing one
 *
 * The playbook already declares `verification`, `challenge` and `risk-review`
 * as entries blocked on `aggregation`, and `InstantiatePlaybook` already
 * created their assignments. Submission moves those assignments to `active`,
 * which is what makes a governance review appear on a department's floor in
 * exactly the way a Global Macro assignment does. A second queue concept beside
 * assignments would be a second answer to "what is this desk working on".
 *
 * Risk is activated only where the conditional requirement for THIS revision
 * resolved to `required`. Unresolved and `not-required` both leave the Risk desk
 * with nothing to do, and the event record distinguishes them — an unresolved
 * requirement is a gate nobody has opened, not a gate that does not apply.
 *
 * ## Why it is version-guarded
 *
 * It moves case workflow state, which is aggregate-level: two managers
 * submitting two revisions of one case concurrently is a real conflict, and the
 * case version is what detects it. The three verdict commands are NOT guarded,
 * because Verification and the Devil's Advocate reviewing the same immutable
 * revision is not a conflict and must not be reported as one.
 */

import {
  actorFieldsOf,
  buildTransitionEvent,
  requirementStatusFor,
  transitionCase,
  type Assignment,
  type InvestmentCase,
  type InvestmentThesis,
  type Organization,
} from '~/domain/analysis'
import { requirePlaybook } from '../playbookRegistry'
import { unmetRequiredWork } from '../requiredWork'
import { GOVERNANCE_ENTRY_KEYS, RISK_ENTRY_KEY } from '../reviewRecording'
import { deriveEventId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'

export interface SubmitForVerificationInput {
  caseId: string
  /** The exact aggregated revision. Never a lineage. */
  revisionId: string
  /** The department that aggregated it; verified against the aggregation. */
  submittedByDepartmentId: string
  /*
   * Deliberately no status, outcome or verdict. Submission asks for a review;
   * it does not contain one.
   */
}

export function submitForVerification(
  _organization: Organization,
): CommandDefinition<SubmitForVerificationInput, InvestmentThesis> {
  return {
    type: 'SubmitForVerification',
    /* Already on VERSION_GUARDED_COMMANDS — see the header. */
    versionPolicy: 'requires-expected-version',
    reasonPolicy: 'optional',
    category: 'workflow',
    mandate: (input) => ({
      kind: 'department-manager',
      departmentId: input.submittedByDepartmentId,
    }),
    scope: (input) => ({ caseId: input.caseId, thesisRevisionId: input.revisionId }),
    payload: (input) => ({
      revisionId: input.revisionId,
      submittedByDepartmentId: input.submittedByDepartmentId,
    }),

    async execute(repositories, context, input) {
      const investmentCase = await repositories.cases.get(input.caseId)
      if (!investmentCase) reject('not-found', `Case "${input.caseId}" does not exist`)
      if (investmentCase.stage === 'blocked' || investmentCase.stage === 'withdrawn') {
        reject(
          'illegal-prior-state',
          `Case "${input.caseId}" is ${investmentCase.stage}. A case that is not ` +
            `running has no work to submit.`,
        )
      }
      if (investmentCase.closedAt) {
        reject('illegal-prior-state', `Case "${input.caseId}" is closed`)
      }
      if (!investmentCase.playbookId || !investmentCase.playbookVersion) {
        reject('illegal-prior-state', `Case "${input.caseId}" has no playbook`)
      }

      const revision = await repositories.theses.get(input.revisionId)
      if (!revision) {
        reject('not-found', `Revision "${input.revisionId}" does not exist`)
      }
      if (revision.caseId !== input.caseId) {
        reject('invariant-violated', `Revision "${input.revisionId}" is another case's`)
      }

      /*
       * Superseded is checked before anything else about the revision. Sending
       * a replaced argument to governance would spend three control functions
       * on work the firm has already moved past, and the verdicts would attach
       * to a revision nobody will decide on.
       */
      if (revision.lifecycle === 'superseded') {
        reject(
          'illegal-prior-state',
          `Revision "${input.revisionId}" has been superseded. Submit the ` +
            `revision governance will actually be deciding about.`,
        )
      }
      if (revision.lifecycle === 'withdrawn' || revision.lifecycle === 'rejected') {
        reject(
          'illegal-prior-state',
          `Revision "${input.revisionId}" is ${revision.lifecycle} and is not ` +
            `live work.`,
        )
      }
      if (revision.lifecycle === 'awaiting-verification') {
        reject(
          'illegal-prior-state',
          `Revision "${input.revisionId}" is already in review. Re-submitting ` +
            `would reopen queues the control functions are already working.`,
        )
      }

      /*
       * The check that keeps the two records apart. A revision minted by
       * ProposeThesis or ReviseThesis carries no `aggregationId`; only
       * AggregateManagerConclusion produces one. Without this a specialist
       * could route their own argument straight into governance, bypassing the
       * manager, the disposition map and the accountability that aggregation
       * carries.
       */
      if (!revision.aggregationId) {
        reject(
          'invariant-violated',
          `Revision "${input.revisionId}" was not produced by a manager ` +
            `aggregation. Governance reviews what a manager synthesised and ` +
            `stands behind, not a draft a desk sent forward on its own.`,
        )
      }

      const aggregation = await repositories.aggregations.get(revision.aggregationId)
      if (!aggregation) {
        reject(
          'not-found',
          `Revision "${input.revisionId}" names aggregation ` +
            `"${revision.aggregationId}", which does not exist. The revision and ` +
            `the record of how it was assembled disagree.`,
        )
      }
      if (aggregation.departmentId !== input.submittedByDepartmentId) {
        reject(
          'not-authorised',
          `Revision "${input.revisionId}" was aggregated by ` +
            `"${aggregation.departmentId}", not by "${input.submittedByDepartmentId}". ` +
            `Submitting another department's synthesis is not authority a ` +
            `manager holds over their own.`,
        )
      }

      const playbook = requirePlaybook(
        investmentCase.playbookId,
        investmentCase.playbookVersion,
      )
      const assignments = await repositories.assignments.listForCase(input.caseId)
      const runs = await repositories.runs.listForCase(input.caseId)
      const resolutions = await repositories.requirements.listForCase(input.caseId)

      /*
       * Re-derived rather than trusted. The aggregation checked required work
       * when it ran; a required contribution can fail between aggregation and
       * submission, and a stored "it was complete" would still say yes.
       */
      const unmet = unmetRequiredWork({
        playbook,
        entryKey: GOVERNANCE_ENTRY_KEYS[0],
        revisionId: input.revisionId,
        assignments,
        runs,
        resolutions,
      })
      if (unmet.length > 0) {
        reject(
          'invariant-violated',
          `Required upstream work has not been accepted: ` +
            unmet.map((item) => `${item.playbookEntryKey} (${item.reason})`).join(', ') +
            `. Governance reviews finished work.`,
        )
      }

      /* ------------------------------------------------------- the writes */

      const riskStatus = requirementStatusFor(
        RISK_ENTRY_KEY,
        input.revisionId,
        resolutions,
      )
      const riskApplies = riskStatus.state === 'required'

      const opening = [...GOVERNANCE_ENTRY_KEYS, ...(riskApplies ? [RISK_ENTRY_KEY] : [])]
      const opened: Assignment[] = []

      for (const entryKey of opening) {
        const assignment = assignments.find(
          (candidate) => candidate.playbookEntryKey === entryKey,
        )
        if (!assignment) {
          reject(
            'not-found',
            `The playbook declares "${entryKey}" but the case has no assignment ` +
              `for it. Governance would have no queue to appear in.`,
          )
        }
        // Already active is not an error: a retry re-opens the same queues.
        if (assignment.status === 'active') {
          opened.push(assignment)
          continue
        }
        opened.push(
          await repositories.assignments.save({
            ...assignment,
            status: 'active',
            startedAt: assignment.startedAt ?? context.occurredAt,
          }),
        )
      }

      const submitted = await repositories.theses.save({
        ...revision,
        lifecycle: 'awaiting-verification',
      })

      /*
       * The case moves to `review`, which is the aggregate-level change that
       * justifies the version guard: two managers submitting two competing
       * revisions of one case is a genuine conflict, and the version is what
       * detects it. Already in `review` is not a movement — a second competing
       * revision entering review is normal and does not move the case again.
       *
       * From `research` the path runs through `aggregation`, and both hops are
       * recorded. The case DID pass through aggregation — the revision would
       * have no `aggregationId` otherwise — and `AggregateManagerConclusion`
       * cannot move it there itself because it refuses `expectedVersion`, which
       * is what lets three desks aggregate competing revisions concurrently.
       * Collapsing the two into one `research → review` movement would put a
       * transition in the history that the domain does not permit.
       */
      const path: InvestmentCase['stage'][] =
        investmentCase.stage === 'review'
          ? []
          : investmentCase.stage === 'research'
            ? ['aggregation', 'review']
            : ['review']

      let movedCase = investmentCase
      const movements: Array<{ from: string; to: string }> = []
      for (const stage of path) {
        movements.push({ from: movedCase.stage, to: stage })
        movedCase = transitionCase(movedCase, stage, {
          employeeId: context.actor.employeeId,
          agentPrincipalId: context.actor.agentPrincipalId,
          departmentId: context.actor.departmentId!,
          at: context.occurredAt,
        })
      }
      const savedCase = await repositories.cases.save(movedCase, context.expectedVersion!)

      for (const [ordinal, movement] of movements.entries()) {
        await repositories.events.append(
          buildTransitionEvent({
            eventId: deriveEventId({
              commandId: context.commandId,
              recordType: 'case-moved',
              entityId: movement.to,
              ordinal,
            }),
            caseId: input.caseId,
            subject: 'case',
            fromState: movement.from,
            toState: movement.to,
            occurredAt: context.occurredAt,
            ...actorFieldsOf(context.actor),
            actorDepartmentId: context.actor.departmentId ?? undefined,
            correlationId: context.correlationId,
            aggregateVersion: savedCase.version,
          }),
        )
      }

      /* -------------------------------------------------------- the events */

      await repositories.events.append(
        buildTransitionEvent({
          eventId: deriveEventId({
            commandId: context.commandId,
            recordType: 'revision-submitted-for-review',
            entityId: input.revisionId,
          }),
          caseId: input.caseId,
          subject: 'thesis',
          thesisId: revision.thesisId,
          revisionId: input.revisionId,
          fromState: revision.lifecycle,
          toState: 'awaiting-verification',
          occurredAt: context.occurredAt,
          actorEmployeeId: context.actor.employeeId ?? undefined,
          actorDepartmentId: context.actor.departmentId ?? undefined,
          correlationId: context.correlationId,
          aggregateVersion: savedCase.version,
          ...(context.reason ? { reason: context.reason } : {}),
        }),
      )

      for (const [ordinal, assignment] of opened.entries()) {
        await repositories.events.append(
          buildTransitionEvent({
            eventId: deriveEventId({
              commandId: context.commandId,
              recordType: 'governance-review-opened',
              entityId: assignment.id,
              ordinal,
            }),
            caseId: input.caseId,
            subject: 'assignment',
            assignmentId: assignment.id,
            fromState: 'queued',
            toState: 'active',
            occurredAt: context.occurredAt,
            actorEmployeeId: context.actor.employeeId ?? undefined,
            actorDepartmentId: context.actor.departmentId ?? undefined,
            correlationId: context.correlationId,
            aggregateVersion: savedCase.version,
          }),
        )
      }

      /*
       * The Risk requirement's state is recorded as an event even when it is
       * `not-required`, because "Risk was asked and said no" and "nobody asked"
       * are different institutional facts and the floor has to be able to tell
       * them apart without inferring anything from an empty queue.
       */
      await repositories.events.append(
        buildTransitionEvent({
          eventId: deriveEventId({
            commandId: context.commandId,
            recordType: 'risk-requirement-state',
            entityId: input.revisionId,
          }),
          caseId: input.caseId,
          subject: 'requirement',
          thesisId: revision.thesisId,
          revisionId: input.revisionId,
          fromState: 'pending',
          aggregateVersion: savedCase.version,
          toState: riskStatus.state,
          occurredAt: context.occurredAt,
          actorEmployeeId: context.actor.employeeId ?? undefined,
          actorDepartmentId: context.actor.departmentId ?? undefined,
          correlationId: context.correlationId,
        }),
      )

      return { value: submitted, resultKind: 'revision', resultRef: submitted.revisionId }
    },

    async rehydrate(repositories, resultRef) {
      const found = await repositories.theses.get(resultRef)
      if (!found) {
        throw new Error(
          `Revision "${resultRef}" was submitted by this command but no longer ` +
            `reads back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
