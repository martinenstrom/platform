/**
 * What every governance verdict has to satisfy, whichever discipline files it.
 *
 * Three commands record three different judgements about one immutable
 * revision, and the rules they share are exactly the rules that keep a verdict
 * attached to the argument it was formed about. Duplicating them across three
 * handlers would mean three chances for one of them to drift — and the drift
 * would look like a verdict that applies, because that is what a verdict
 * attached to the wrong revision looks like from every angle except this one.
 *
 * Not a command. It runs inside one, in the caller's transaction, like
 * `mintRevision`.
 */

import {
  isRevisionScoped,
  type InvestmentThesis,
  type ReviewAttribution,
  type ReviewOrder,
  type ReviewRecordId,
  type ReviewScope,
} from '~/domain/analysis'
import type { TransactionalAnalysisRepositories } from './repositories'
import type { CommandContext } from './commands/definition'
import { reject } from './commands/envelope'
import { deriveReviewId } from './commands/eventIdentity'

export type ReviewKind = 'verification' | 'devils-advocate' | 'compliance' | 'risk'

/**
 * The playbook entries governance works under.
 *
 * Here rather than in a command module: two handlers need them, and a constant
 * living inside one command would make the other import a command handler.
 */
export const GOVERNANCE_ENTRY_KEYS = ['verification', 'challenge'] as const
export const RISK_ENTRY_KEY = 'risk-review'

/** A stored verdict, as much of it as the shared rules need to see. */
type StoredReview = ReviewScope & ReviewAttribution & ReviewRecordId & ReviewOrder

export interface VerdictTargetInput {
  caseId: string
  revisionId: string
  thesisId: string
  byDepartmentId: string
  kind: ReviewKind
  /** The playbook entry this discipline reviews under. */
  playbookEntryKey: string
  supersedesReviewId?: string
  /** The verdict as a comparable string, for the changed-verdict reason rule. */
  status: string
}

export interface VerdictPlacement {
  revision: InvestmentThesis
  reviewId: string
  sequence: number
  superseded: StoredReview | null
}

/**
 * Checks the target and allocates the verdict's position.
 *
 * Everything here is refused rather than accommodated, because each one is a
 * way a verdict comes to speak about work its author did not see.
 */
export async function placeVerdict(
  repositories: TransactionalAnalysisRepositories,
  context: CommandContext,
  input: VerdictTargetInput,
  existing: readonly StoredReview[],
): Promise<VerdictPlacement> {
  const revision = await repositories.theses.get(input.revisionId)
  if (!revision) {
    reject('not-found', `Revision "${input.revisionId}" does not exist`)
  }
  if (revision.caseId !== input.caseId) {
    reject('invariant-violated', `Revision "${input.revisionId}" is another case's`)
  }
  if (revision.thesisId !== input.thesisId) {
    reject(
      'invariant-violated',
      `Revision "${input.revisionId}" belongs to lineage "${revision.thesisId}", ` +
        `not "${input.thesisId}". A verdict that disagrees with itself about ` +
        `which argument it read is not a verdict.`,
    )
  }

  /*
   * A superseded revision is refused, not merely discouraged. Reviewing a
   * replaced argument spends a control function on work the firm has moved
   * past, and the verdict then sits on a revision nobody will decide about —
   * indistinguishable, later, from one that was never reviewed.
   */
  if (revision.lifecycle === 'superseded') {
    reject(
      'illegal-prior-state',
      `Revision "${input.revisionId}" has been superseded. The verdict would ` +
        `attach to an argument the firm has already replaced.`,
    )
  }
  if (revision.lifecycle === 'proposed' || revision.lifecycle === 'under-analysis') {
    reject(
      'illegal-prior-state',
      `Revision "${input.revisionId}" has not been submitted for review. A ` +
        `verdict on work nobody has finished is a verdict on a draft.`,
    )
  }

  /* ------------------------------------------------------- supersession */

  let superseded: StoredReview | null = null
  if (input.supersedesReviewId) {
    superseded = existing.find((r) => r.reviewId === input.supersedesReviewId) ?? null
    if (!superseded) {
      reject(
        'not-found',
        `Review "${input.supersedesReviewId}" does not exist among this ` +
          `discipline's verdicts on case "${input.caseId}".`,
      )
    }
    /*
     * A re-review speaks about the same argument as the one it replaces.
     * Retargeting is how a verdict formed about revision 1 comes to stand as
     * the current verdict on revision 2, which is the exact failure the
     * revision-scoped review model exists to prevent.
     */
    const target = isRevisionScoped(superseded) ? superseded.revisionId : null
    if (target !== input.revisionId) {
      reject(
        'invariant-violated',
        `Review "${input.supersedesReviewId}" was recorded against ` +
          `"${target ?? 'the whole case'}", not "${input.revisionId}". A ` +
          `re-review replaces a verdict about the same argument.`,
      )
    }
    if (superseded.byDepartmentId !== input.byDepartmentId) {
      reject(
        'not-authorised',
        `Review "${input.supersedesReviewId}" was recorded by ` +
          `"${superseded.byDepartmentId}". One control function does not ` +
          `overturn another's verdict; it records its own.`,
      )
    }
  }

  /* ------------------------------------------------------- the position */

  const sequence = await repositories.reviews.nextSequence({
    caseId: input.caseId,
    revisionId: input.revisionId,
    kind: input.kind,
  })

  return {
    revision,
    reviewId: deriveReviewId(context.commandId, input.revisionId),
    sequence,
    superseded,
  }
}

/**
 * A re-review that changes the institutional verdict must say why.
 *
 * Re-recording the SAME verdict after a re-check does not: requiring prose for
 * it produces prose nobody reads, and devalues the reasons that matter.
 * Reversing one is the case this exists for — a control function that changed
 * its mind and left no account of why is a control function the record cannot
 * explain.
 */
export function requireReasonForChangedVerdict(
  superseded: { status?: string } | null,
  status: string,
  reason: string | undefined,
): void {
  if (!superseded) return
  if (superseded.status === status) return
  if (reason?.trim()) return
  reject(
    'invariant-violated',
    `This verdict changes the institutional answer from ` +
      `"${superseded.status ?? 'none'}" to "${status}" and states no reason. ` +
      `A reversal the record cannot explain is a reversal nobody can review.`,
  )
}

/**
 * The claims a verdict is allowed to speak about.
 *
 * Exactly the claims the manager put in scope. A finding or challenge against
 * something outside it would be governance reviewing work that is not part of
 * the argument — and the CIO would read a blocker pointing at a claim the
 * thesis does not rest on.
 */
export async function claimsInScopeOf(
  repositories: TransactionalAnalysisRepositories,
  revision: InvestmentThesis,
): Promise<Set<string>> {
  if (!revision.aggregationId) return new Set()
  const aggregation = await repositories.aggregations.get(revision.aggregationId)
  if (!aggregation) return new Set()
  return new Set(aggregation.dispositions.map((disposition) => disposition.claimId))
}
