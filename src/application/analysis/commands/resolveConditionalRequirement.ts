/**
 * Deciding whether a conditional governance gate applies — TD-29.
 *
 * A playbook can declare a stage conditionally required: Risk Review is needed
 * when the thesis implies the firm might act, and not needed for purely
 * descriptive analysis. Whether the condition actually held for one exact
 * argument is an institutional judgement with an accountable evaluator, and
 * this command is where it is made.
 *
 * ## It takes no outcome
 *
 * There is no `required` field on the input, and that is stronger than
 * validating one. The result comes from `evaluateRequirement()` over the
 * revision's DECLARED implications — the same function that is already the only
 * producer of a resolution — so a caller cannot supply an answer at all, let
 * alone one that disagrees. Nothing here reads the thesis statement: a rule
 * that scanned prose would produce an outcome that depended on how a sentence
 * was phrased, and Risk could be made to disappear by rewording.
 *
 * ## Risk decides Risk
 *
 * The mandate is a governance verdict in the `risk` discipline, which
 * `authorize` grants only to a governance department that HANDLES risk.
 * Verification is governance and handles verification, so it cannot waive Risk
 * — pinned by tests since C1C-1. An orchestrator may initiate; only an employee
 * of the Risk function can be accountable, which `buildRequirementResolution`
 * enforces by refusing a non-employee evaluator.
 *
 * ## Write-once, and a new revision reopens the gate
 *
 * Stored on `(caseId, playbookEntryKey, revisionId)`. A deterministic rule
 * cannot legitimately produce two answers for one triple, so a second write
 * with different content is a real disagreement and fails. A later revision has
 * no row and is therefore unresolved — which is how aggregation reopens the
 * gate without anyone having to remember to.
 */

import {
  evaluateRequirement,
  requirementRule,
  UnknownRequirementRuleError,
  type Organization,
  type RequirementResolution,
} from '~/domain/analysis'
import { requirePlaybook } from '../playbookRegistry'
import { deriveEventId } from './eventIdentity'
import { reject } from './envelope'
import { buildTransitionEvent } from '~/domain/analysis'
import type { CommandDefinition } from './definition'

export interface ResolveConditionalRequirementInput {
  caseId: string
  /** The conditional entry being decided. */
  playbookEntryKey: string
  /** The exact revision it is decided against. */
  revisionId: string
  /** The control function answering. Verified against the entry inside execute. */
  departmentId: string
  /**
   * The discipline the verdict falls under.
   *
   * Declared so the mandate can be decided before the playbook is read, and
   * verified against the entry's own `disciplineTag` inside `execute` — the
   * same shape `StartAgentRun` uses for its department. A caller naming a
   * discipline it holds, on an entry belonging to another, is refused.
   */
  discipline: string
  /*
   * Deliberately no `required`, `outcome` or `state`. See the header: the
   * result is computed, and there is nothing for a caller to disagree with.
   */
}

export function resolveConditionalRequirement(
  _organization: Organization,
): CommandDefinition<ResolveConditionalRequirementInput, RequirementResolution> {
  return {
    type: 'ResolveConditionalRequirement',
    versionPolicy: 'refuses-expected-version',
    /* Already on REASON_REQUIRED_COMMANDS: a gate opened or skipped says why. */
    reasonPolicy: 'required',
    category: 'governance',
    mandate: (input) => ({ kind: 'governance-verdict', discipline: input.discipline }),
    scope: (input) => ({ caseId: input.caseId, thesisRevisionId: input.revisionId }),
    payload: (input) => ({
      playbookEntryKey: input.playbookEntryKey,
      revisionId: input.revisionId,
      departmentId: input.departmentId,
      discipline: input.discipline,
    }),

    async execute(repositories, context, input) {
      const investmentCase = await repositories.cases.get(input.caseId)
      if (!investmentCase) reject('not-found', `Case "${input.caseId}" does not exist`)
      if (!investmentCase.playbookId || !investmentCase.playbookVersion) {
        reject('illegal-prior-state', `Case "${input.caseId}" has no playbook`)
      }

      const playbook = requirePlaybook(
        investmentCase.playbookId,
        investmentCase.playbookVersion,
      )
      const entry = playbook.entries.find(
        (candidate) => candidate.key === input.playbookEntryKey,
      )
      if (!entry) {
        reject(
          'not-found',
          `Playbook "${playbook.id}@${playbook.version}" has no entry ` +
            `"${input.playbookEntryKey}".`,
        )
      }
      if (entry.requirement !== 'conditional') {
        reject(
          'invariant-violated',
          `Entry "${input.playbookEntryKey}" is ${entry.requirement}, not ` +
            `conditional. Only a conditional entry has a condition to resolve.`,
        )
      }
      if (!entry.conditionalRule) {
        reject(
          'invariant-violated',
          `Entry "${input.playbookEntryKey}" is conditional and names no rule.`,
        )
      }

      /*
       * The department must own the entry AND hold the discipline. `authorize`
       * checked the second; this checks that Risk is resolving Risk's own step
       * rather than another control function's.
       */
      if (entry.departmentId !== input.departmentId) {
        reject(
          'not-authorised',
          `Entry "${input.playbookEntryKey}" belongs to "${entry.departmentId}", ` +
            `not to "${input.departmentId}".`,
        )
      }
      if (entry.disciplineTag && entry.disciplineTag !== input.discipline) {
        reject(
          'not-authorised',
          `Entry "${input.playbookEntryKey}" is a "${entry.disciplineTag}" ` +
            `verdict, and this command was authorized as "${input.discipline}". ` +
            `Holding one discipline is not authority over another.`,
        )
      }

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
          `Revision "${input.revisionId}" has been superseded. Resolve the gate ` +
            `against the revision governance will actually review.`,
        )
      }

      let rule
      try {
        rule = requirementRule(entry.conditionalRule)
      } catch (error) {
        if (error instanceof UnknownRequirementRuleError) {
          reject('not-found', error.message)
        }
        throw error
      }

      /*
       * Computed, never accepted. The rule reads the revision's declared
       * implications and nothing else, and `evaluateRequirement` records the
       * rule id, version, reason and input hash that actually ran.
       */
      const resolution = evaluateRequirement(rule, {
        caseId: input.caseId,
        playbookEntryKey: input.playbookEntryKey,
        revisionId: input.revisionId,
        implications: revision.implications,
        evaluatedAt: context.occurredAt,
        evaluatedBy: context.actor,
      })

      const saved = await repositories.requirements.save(resolution, context.provenance)

      await repositories.events.append(
        buildTransitionEvent({
          eventId: deriveEventId({
            commandId: context.commandId,
            recordType: `requirement-${saved.state}`,
            entityId: `${input.playbookEntryKey}|${input.revisionId}`,
          }),
          subject: 'requirement',
          caseId: input.caseId,
          thesisId: revision.thesisId,
          revisionId: input.revisionId,
          fromState: null,
          toState: saved.state,
          actorEmployeeId: context.actor.employeeId ?? undefined,
          actorDepartmentId: input.departmentId,
          reason: context.reason,
          occurredAt: context.occurredAt,
          correlationId: context.correlationId,
          aggregateVersion: investmentCase.version,
        }),
      )

      return {
        value: saved,
        resultKind: 'requirement-resolution',
        resultRef: `${input.caseId}|${input.playbookEntryKey}|${input.revisionId}`,
      }
    },

    async rehydrate(repositories, resultRef) {
      const [caseId, playbookEntryKey, revisionId] = resultRef.split('|')
      const found = (await repositories.requirements.listForCase(caseId!)).find(
        (resolution) =>
          resolution.playbookEntryKey === playbookEntryKey &&
          resolution.revisionId === revisionId,
      )
      if (!found) {
        throw new Error(
          `Resolution "${resultRef}" was committed by this command but no longer ` +
            `reads back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
