/**
 * Revising a thesis for a stated cause.
 *
 * Distinct from `AggregateManagerConclusion`, and deliberately so. Aggregation
 * is a manager synthesising designated specialist contributions according to
 * the playbook; this is an existing argument changing because something about
 * the world, the evidence or the firm's reading of it changed. Both mint an
 * immutable revision through the same operation; neither edits a prior one.
 *
 * `cause: 'manager-aggregation'` is refused here. Without that refusal a
 * specialist could file a revision that reads as a managerial synthesis and
 * bypass the required-work gate, the disposition map and the accountability
 * that aggregation carries.
 *
 * ## Who may revise
 *
 * The department that proposed the revision being revised — `thesis-owner`. A
 * manager who wants to change a lineage they do not own performs an
 * aggregation, which is what a manager's change of a thesis IS, and which
 * carries the record aggregation carries. Giving one act two authorities would
 * make "who changed this argument" answer "somebody allowed to".
 */

import type {
  InvestmentImplication,
  InvestmentThesis,
  Organization,
  ThesisPosition,
} from '~/domain/analysis'
import { mintRevision, type RevisionCause } from '../revisions'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'
import { utf8ByteOrder } from '~/domain/shared/canonicalValue'

/** Causes a revision may declare. `manager-aggregation` is not among them. */
const PERMITTED_CAUSES: readonly RevisionCause[] = [
  'new-evidence',
  'correction',
  'governance-finding',
  'changed-assumption',
  'resolved-challenge',
  'changed-implications',
  'revised-invalidation-criteria',
] as const

export interface ReviseThesisInput {
  caseId: string
  /** The revision being replaced. Must be the lineage's current one. */
  revisionId: string
  /** Declared for the mandate; verified against the revision's own department. */
  proposedByDepartmentId: string
  cause: RevisionCause

  statement?: string
  position?: ThesisPosition
  invalidationCriteria?: string
  horizon?: string
  implications?: readonly InvestmentImplication[]
  supportingClaimIds?: readonly string[]
  opposingClaimIds?: readonly string[]
}

export function reviseThesis(
  _organization: Organization,
): CommandDefinition<ReviseThesisInput, InvestmentThesis> {
  return {
    type: 'ReviseThesis',
    versionPolicy: 'refuses-expected-version',
    /*
     * Required, and already on `REASON_REQUIRED_COMMANDS`. Changing a position
     * after desks have contributed to it — and possibly after governance has
     * looked at it — is exactly the act that owes an explanation.
     */
    reasonPolicy: 'required',
    category: 'analysis',
    mandate: (input) => ({
      kind: 'thesis-owner',
      proposedByDepartmentId: input.proposedByDepartmentId,
    }),
    scope: (input) => ({ caseId: input.caseId, thesisRevisionId: input.revisionId }),
    payload: (input) => ({
      revisionId: input.revisionId,
      proposedByDepartmentId: input.proposedByDepartmentId,
      cause: input.cause,
      statement: input.statement ?? null,
      position: input.position ?? null,
      invalidationCriteria: input.invalidationCriteria ?? null,
      horizon: input.horizon ?? null,
      implications: input.implications
        ? [...input.implications].sort(utf8ByteOrder)
        : null,
      supportingClaimIds: input.supportingClaimIds
        ? [...input.supportingClaimIds].sort(utf8ByteOrder)
        : null,
      opposingClaimIds: input.opposingClaimIds
        ? [...input.opposingClaimIds].sort(utf8ByteOrder)
        : null,
    }),

    async execute(repositories, context, input) {
      if (!PERMITTED_CAUSES.includes(input.cause)) {
        reject(
          'invariant-violated',
          `"${input.cause}" is not a cause this command may declare. A managerial ` +
            `synthesis is AggregateManagerConclusion, which carries the input ` +
            `scope, the claim dispositions and the manager accountable for them.`,
        )
      }

      const current = await repositories.theses.get(input.revisionId)
      if (!current) {
        reject('not-found', `Revision "${input.revisionId}" does not exist`)
      }
      if (current.caseId !== input.caseId) {
        reject('invariant-violated', `Revision "${input.revisionId}" is another case's`)
      }
      /*
       * The mandate is checked against the department the caller DECLARED;
       * this checks the declaration against the revision itself, the same
       * shape `StartAgentRun` uses. A desk naming its own department on
       * somebody else's thesis is refused.
       */
      if (current.proposedByDepartmentId !== input.proposedByDepartmentId) {
        reject(
          'not-authorised',
          `Revision "${input.revisionId}" was proposed by ` +
            `"${current.proposedByDepartmentId}", not by ` +
            `"${input.proposedByDepartmentId}". Revising another department's ` +
            `argument is not authority a desk holds over its own work.`,
        )
      }

      const revision = await mintRevision(repositories, context, {
        caseId: input.caseId,
        thesisId: current.thesisId,
        prior: current,
        changes: {
          ...(input.statement !== undefined ? { statement: input.statement } : {}),
          ...(input.position !== undefined ? { position: input.position } : {}),
          ...(input.invalidationCriteria !== undefined
            ? { invalidationCriteria: input.invalidationCriteria }
            : {}),
          ...(input.horizon !== undefined ? { horizon: input.horizon } : {}),
          ...(input.implications !== undefined
            ? { implications: input.implications }
            : {}),
          ...(input.supportingClaimIds !== undefined
            ? { supportingClaimIds: input.supportingClaimIds }
            : {}),
          ...(input.opposingClaimIds !== undefined
            ? { opposingClaimIds: input.opposingClaimIds }
            : {}),
        },
        cause: input.cause,
        reason: context.reason,
        proposedByDepartmentId: input.proposedByDepartmentId,
        lifecycle: 'under-analysis',
      })

      return { value: revision, resultKind: 'revision', resultRef: revision.revisionId }
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
