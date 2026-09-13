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
  buildRunRecord,
  candidateStaleness,
  isRevisionScoped,
  type AgentRunRecord,
  type Challenge,
  type ChallengeStatus,
  type GovernanceCandidateBasis,
  type InvestmentThesis,
  type ReviewAttribution,
  type ReviewOrder,
  type ReviewRecordId,
  type ReviewScope,
} from '~/domain/analysis'
import type { StorageProvenance, TransactionalAnalysisRepositories } from './repositories'
import type { CommandContext } from './commands/definition'
import { reject } from './commands/envelope'
import { deriveReviewId } from './commands/eventIdentity'

/**
 * The five kinds of review the firm records.
 *
 * Four are control functions. `peer-examination` is not: it is an analytical
 * desk reading another desk's persisted claims and saying on the record whether
 * it agrees, under a mandate that overlaps the subject rather than a standing
 * obligation to object.
 */
export type ReviewKind =
  'verification' | 'devils-advocate' | 'compliance' | 'risk' | 'peer-examination'

/**
 * The playbook entries governance works under.
 *
 * Here rather than in a command module: two handlers need them, and a constant
 * living inside one command would make the other import a command handler.
 */
export const GOVERNANCE_ENTRY_KEYS = ['verification', 'challenge'] as const
export const RISK_ENTRY_KEY = 'risk-review'

/**
 * What a caller supplies when filing an objection. Not the whole challenge.
 *
 * `challengerKind` and `byDepartmentId` are **omitted deliberately**: each
 * command already establishes which mandate it discharges — the Devil's
 * Advocate refuses any department but its own, and a peer examination refuses
 * every control function — so the mandate is a property of the act being
 * performed rather than something the caller announces. Letting a submission
 * state its own mandate would let it contradict the check that authorised it,
 * and the two would then have to be kept in agreement forever.
 *
 * It lives here rather than in either command because both need it and no
 * command handler may import another. That rule exists so two ledger entries
 * cannot hide inside what the caller believes is one transaction, and a shared
 * TYPE is not a reason to weaken it.
 */
export type ChallengeSubmission = Omit<
  Challenge,
  'id' | 'challengerKind' | 'byDepartmentId'
> & {
  /** How the organization answered it, where it has. */
  outcome?: ChallengeStatus
}

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

/* ------------------------------------------------------------- adoption */

/**
 * Exactly one accountable principal, taken from whoever acted.
 *
 * Returns the field that applies rather than both, so the object spreads into a
 * review with no null beside it — and so the database's
 * `reviews_one_accountable_principal` has nothing to object to.
 *
 * A system actor is refused: a verdict booked to the orchestrator is a verdict
 * booked to nobody, and the whole point of the control functions is that
 * somebody answers for what they filed.
 */
export function accountablePrincipal(context: {
  actor: { employeeId?: string | null; agentPrincipalId?: string | null }
}): { byEmployeeId: string } | { byAgentPrincipalId: string } {
  if (context.actor.employeeId) return { byEmployeeId: context.actor.employeeId }
  if (context.actor.agentPrincipalId) {
    return { byAgentPrincipalId: context.actor.agentPrincipalId }
  }
  throw new Error(
    'A governance verdict names no accountable principal. The orchestrator ' +
      'dispatches control work; it does not perform it.',
  )
}

/** What a filing command learned by loading the candidate it is adopting. */
export interface CandidateAdoption {
  runId: string
  basis: GovernanceCandidateBasis
  run: AgentRunRecord
}

/**
 * Checks that a candidate may still be filed, and hands back what filing needs.
 *
 * One definition for all three control functions, so they cannot disagree about
 * what makes a draft filable. Every check is against durable state — never
 * against a clock, because prose produced an hour ago against unchanged work is
 * fine and prose produced a second ago against changed work is not.
 */
export async function candidateReadyToFile(
  repositories: TransactionalAnalysisRepositories,
  args: {
    caseId: string
    byDepartmentId: string
    runId: string
    basis: GovernanceCandidateBasis
    hashMatches: boolean
    knownCanonicalization: boolean
    refuse: (
      code: 'not-found' | 'illegal-prior-state' | 'not-authorised',
      why: string,
    ) => never
  },
): Promise<CandidateAdoption> {
  const run = await repositories.runs.get(args.runId)
  if (!run) args.refuse('not-found', `Run "${args.runId}" does not exist`)
  if (run.caseId !== args.caseId) {
    args.refuse(
      'illegal-prior-state',
      `Run "${args.runId}" belongs to case "${run.caseId}".`,
    )
  }
  if (run.departmentId !== args.byDepartmentId) {
    args.refuse(
      'not-authorised',
      `The candidate was produced by "${run.departmentId}", and ` +
        `"${args.byDepartmentId}" is filing it. A control function files its ` +
        `own work.`,
    )
  }
  /*
   * Filing a candidate twice would institutionalise one draft as two verdicts.
   * The run leaves `awaiting-acceptance` exactly once, and that is the guard.
   */
  if (run.state !== 'awaiting-acceptance') {
    args.refuse(
      'illegal-prior-state',
      `Run "${args.runId}" is ${run.state}, not awaiting acceptance. A ` +
        `candidate is filed once.`,
    )
  }

  const revisions = await repositories.theses.listForCase(args.caseId)
  const current = revisions.find((revision) => revision.lifecycle !== 'superseded')
  const claims = await claimsInScopeOf(
    repositories,
    revisions.find((revision) => revision.revisionId === args.basis.sourceRevisionId) ??
      current!,
  )

  const stale = candidateStaleness({
    basis: args.basis,
    hashMatches: args.hashMatches,
    knownCanonicalization: args.knownCanonicalization,
    currentRevisionId: current?.revisionId ?? '',
    currentClaimIds: [...claims],
  })
  if (stale.length > 0) {
    args.refuse(
      'illegal-prior-state',
      `The candidate cannot be filed against the firm's current state: ` +
        `${stale.join(', ')}. Scrutiny is filed against the argument it ` +
        `examined, and that argument has moved.`,
    )
  }

  return { runId: args.runId, basis: args.basis, run }
}

/**
 * Completes the run that produced a filed candidate, and the work it discharged.
 *
 * The other half of adoption. Producing a candidate completes nothing; filing
 * it completes both, in the same transaction as the institutional verdict — so
 * "the review exists and the run still awaits acceptance" is not a state the
 * store can be left in.
 */
export async function completeProducingWork(
  repositories: TransactionalAnalysisRepositories,
  context: { occurredAt: string; provenance: StorageProvenance },
  adoption: CandidateAdoption,
): Promise<void> {
  await repositories.runs.save(
    buildRunRecord({
      ...adoption.run,
      state: 'completed',
      completedAt: context.occurredAt,
      events: [
        ...adoption.run.events,
        { runId: adoption.run.id, at: context.occurredAt, state: 'completed' },
      ],
    }),
    context.provenance,
  )

  const assignment = await repositories.assignments.get(adoption.run.assignmentId)
  if (assignment && assignment.status !== 'completed') {
    await repositories.assignments.save({
      ...assignment,
      status: 'completed',
      completedAt: context.occurredAt,
    })
  }
}

/**
 * The playbook entry a peer examination is performed under.
 *
 * Registered since playbook v5 and carried unchanged into v6, where the entry
 * is owned by the Rates desk and blocks on `aggregation`. Named once so the
 * placement, the playbook and the command that produces a peer candidate cannot
 * disagree about what the entry is called.
 *
 * It lives here rather than on `RecordPeerExamination` because two commands
 * need it — the one that files an examination and the one that records the
 * candidate for it — and a command handler may not import another command
 * handler. `importGraph.test.ts` enforces that, and caught this exact reach.
 */
export const PEER_EXAMINATION_ENTRY_KEY = 'peer-examination'

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
