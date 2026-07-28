/**
 * Proposing revision 1 of a thesis.
 *
 * A case is a question; a thesis is a proposed answer, and a case can carry
 * several competing ones. This command mints the first revision of one lineage
 * and does nothing else.
 *
 * ## What it deliberately does not do
 *
 * It does not move the case, imply verification, imply a challenge, resolve
 * Risk, or make the revision eligible for a decision. A proposed argument is
 * an argument somebody made; every gate it must pass is a separate recorded
 * act by a separate accountable department. A command that quietly advanced
 * the case would be a command that let a desk grade its own work.
 *
 * In the Macro workflow the thesis is normally proposed by the Research Office
 * as the output of aggregation, which is C1C. This command is what that will
 * issue.
 */

import {
  buildThesis,
  thesisEvent,
  type InvestmentThesis,
  type InvestmentImplication,
  type Organization,
  type ThesisPosition,
} from '~/domain/analysis'
import { deriveEventId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'

export interface ProposeThesisInput {
  caseId: string
  /** Lineage key, stable across every future revision of this argument. */
  thesisId: string
  /** This specific version. */
  revisionId: string
  statement: string
  position: ThesisPosition
  /** Required. A thesis that cannot be wrong is a preference. */
  invalidationCriteria: string
  horizon?: string
  /**
   * What acting on this thesis would imply.
   *
   * Empty is a declaration, not a default: it says the analysis is descriptive
   * and nothing is being recommended, which is what a conditional Risk Review
   * resolves against. Declared here rather than inferred from the statement so
   * that no contributor can make a governance gate disappear by rephrasing.
   */
  implications: readonly InvestmentImplication[]
  proposedByDepartmentId: string
}

export function proposeThesis(
  organization: Organization,
): CommandDefinition<ProposeThesisInput, InvestmentThesis> {
  return {
    type: 'ProposeThesis',
    /* A thesis does not move case-level state. */
    versionPolicy: 'refuses-expected-version',
    /*
     * Optional on revision 1: the reason a thesis exists is the case it
     * answers. `ReviseThesis` requires one, because changing a position after
     * governance has reviewed it is exactly the act that owes an explanation.
     */
    reasonPolicy: 'optional',
    category: 'analysis',
    mandate: (input) => ({
      kind: 'department-contribution',
      departmentId: input.proposedByDepartmentId,
    }),
    scope: (input) => ({ caseId: input.caseId, thesisRevisionId: input.revisionId }),
    payload: (input) => ({
      thesisId: input.thesisId,
      statement: input.statement,
      position: input.position,
      invalidationCriteria: input.invalidationCriteria,
      horizon: input.horizon ?? null,
      implications: [...input.implications].sort(),
      proposedByDepartmentId: input.proposedByDepartmentId,
    }),

    async execute(repositories, context, input) {
      const investmentCase = await repositories.cases.get(input.caseId)
      if (!investmentCase) {
        reject('not-found', `Case "${input.caseId}" does not exist`)
      }

      if (investmentCase.stage === 'published' || investmentCase.stage === 'withdrawn') {
        reject(
          'illegal-prior-state',
          `Case "${input.caseId}" is ${investmentCase.stage}. A closed case does ` +
            `not accept new arguments; reopen it first.`,
        )
      }

      if (!organization.departments.some((d) => d.id === input.proposedByDepartmentId)) {
        reject('not-found', `Department "${input.proposedByDepartmentId}" does not exist`)
      }

      /*
       * A revision id identifies one argument. If it already exists carrying a
       * different lineage, this is not a replay — it is two arguments wearing
       * one identity, and the store's write-once rule would surface it as a
       * conflict anyway. Catching it here names it precisely.
       */
      const existing = await repositories.theses.get(input.revisionId)
      if (existing && existing.thesisId !== input.thesisId) {
        reject(
          'invariant-violated',
          `Revision "${input.revisionId}" already belongs to lineage ` +
            `"${existing.thesisId}".`,
        )
      }

      let revision: InvestmentThesis
      try {
        revision = buildThesis({
          thesisId: input.thesisId,
          revisionId: input.revisionId,
          revisionNumber: 1,
          caseId: input.caseId,
          statement: input.statement,
          position: input.position,
          proposedByDepartmentId: input.proposedByDepartmentId,
          proposedByEmployeeId: context.actor.employeeId!,
          proposedAt: context.occurredAt,
          supportingClaimIds: [],
          opposingClaimIds: [],
          citedByClaimIds: [],
          /*
           * `proposed`, not `under-analysis`. Nobody has reviewed it, nothing
           * cites it, and no gate has been passed.
           */
          lifecycle: 'proposed',
          invalidationCriteria: input.invalidationCriteria,
          ...(input.horizon ? { horizon: input.horizon } : {}),
          implications: input.implications,
        })
      } catch (error) {
        // `buildThesis` refuses a thesis with no invalidation criteria.
        reject(
          'invariant-violated',
          error instanceof Error ? error.message : String(error),
        )
      }

      const saved = await repositories.theses.save(revision)

      await repositories.events.append(
        thesisEvent({
          eventId: deriveEventId({
            commandId: context.commandId,
            recordType: 'thesis-proposed',
            entityId: input.revisionId,
          }),
          caseId: input.caseId,
          thesisId: input.thesisId,
          revisionId: input.revisionId,
          from: null,
          to: 'proposed',
          actorEmployeeId: context.actor.employeeId ?? undefined,
          actorDepartmentId: input.proposedByDepartmentId,
          occurredAt: context.occurredAt,
          correlationId: context.correlationId,
          aggregateVersion: investmentCase.version,
        }),
      )

      return { value: saved, resultKind: 'revision', resultRef: saved.revisionId }
    },

    async rehydrate(repositories, resultRef) {
      const found = await repositories.theses.get(resultRef)
      if (!found) {
        throw new Error(
          `Revision "${resultRef}" was committed by this command but no longer ` +
            `reads back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
