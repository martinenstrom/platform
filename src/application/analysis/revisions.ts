/**
 * The one operation that mints a thesis revision.
 *
 * Three commands produce revisions — `ProposeThesis`, `AggregateManagerConclusion`
 * and `ReviseThesis` — and every rule about lineage, numbering, supersession and
 * inheritance lives here rather than three times over. Two of those rules are
 * the kind that fail silently when duplicated: a revision that supersedes the
 * wrong predecessor, and a revision that inherits a review it was never given.
 *
 * ## Not a command
 *
 * Deliberately an operation rather than a fourth command. A command may not
 * call another command — one handler is one transaction, and composing them
 * would put two ledger entries where the caller believes there is one. A shared
 * operation runs INSIDE the caller's transaction and writes no ledger entry of
 * its own, so the three commands stay three institutional acts and the minting
 * stays one implementation.
 *
 * ## What a new revision does not inherit
 *
 * Nothing, and by construction rather than by clearing. Reviews are scoped to
 * an exact `revisionId` (storage stage 1.5) and conditional requirement
 * resolutions are too (C1B), so a new revision id simply has none — no code
 * path exists that could carry one forward. Eligibility is computed from those
 * two plus contribution state, so it starts empty for the same reason.
 */

import {
  buildThesis,
  thesisEvent,
  thesisLineage,
  type InvestmentThesis,
  type RevisionCause,
  type ThesisLifecycleState,
  type ThesisRevisionInput,
} from '~/domain/analysis'

export type { RevisionCause }
import { deriveEventId, deriveRevisionId } from './commands/eventIdentity'
import { reject } from './commands/envelope'
import type { CommandContext } from './commands/definition'
import type { TransactionalAnalysisRepositories } from './repositories'

export interface MintRevisionInput {
  caseId: string
  thesisId: string
  /**
   * The revision being replaced, or `null` for the first of a lineage.
   *
   * Not a separate code path: revision 1 is the case where there is nothing to
   * supersede, and `buildThesis` already refuses a revision 1 that claims to
   * supersede something.
   */
  prior: InvestmentThesis | null
  changes: ThesisRevisionInput & {
    statement?: string
    invalidationCriteria?: string
  }
  cause: RevisionCause
  /** Required whenever `prior` is present. */
  reason?: string
  proposedByDepartmentId: string
  lifecycle: Extract<ThesisLifecycleState, 'proposed' | 'under-analysis'>
  /** Set by `AggregateManagerConclusion`; absent everywhere else. */
  aggregationId?: string
}

/**
 * Mints the next revision of a lineage, or the first one.
 *
 * Runs inside the caller's transaction and writes both revisions plus the
 * events. Rejects — rather than throwing — so a caller's `runCommand` records
 * the refusal as a domain rejection with a bounded code.
 */
export async function mintRevision(
  repositories: TransactionalAnalysisRepositories,
  context: CommandContext,
  input: MintRevisionInput,
): Promise<InvestmentThesis> {
  const revisionId = deriveRevisionId(context.commandId, input.thesisId)

  const investmentCase = await repositories.cases.get(input.caseId)
  if (!investmentCase) reject('not-found', `Case "${input.caseId}" does not exist`)

  /* ------------------------------------------------------------ lineage */

  const existing = await repositories.theses.listForCase(input.caseId)
  const lineage = existing.filter((revision) => revision.thesisId === input.thesisId)

  if (input.prior) {
    if (input.prior.caseId !== input.caseId) {
      reject(
        'invariant-violated',
        `Revision "${input.prior.revisionId}" belongs to case ` +
          `"${input.prior.caseId}", not to "${input.caseId}".`,
      )
    }
    if (input.prior.thesisId !== input.thesisId) {
      reject(
        'invariant-violated',
        `Revision "${input.prior.revisionId}" belongs to lineage ` +
          `"${input.prior.thesisId}", not to "${input.thesisId}".`,
      )
    }
    if (input.prior.lifecycle === 'superseded') {
      reject(
        'illegal-prior-state',
        `Revision "${input.prior.revisionId}" is already superseded. Revise the ` +
          `lineage's current revision, not a historical one — two revisions ` +
          `superseding the same predecessor is a fork nothing can audit.`,
      )
    }
    if (!input.reason?.trim()) {
      reject(
        'invariant-violated',
        `Revision ${input.prior.revisionNumber + 1} of "${input.thesisId}" gives ` +
          `no reason. A change to the firm's position owes an explanation.`,
      )
    }
  } else if (lineage.length > 0) {
    reject(
      'illegal-prior-state',
      `Lineage "${input.thesisId}" already has ${lineage.length} revision(s). A ` +
        `first revision cannot be minted twice.`,
    )
  }

  /*
   * The id is derived from the command, so a replay addresses the same row. A
   * DIFFERENT command reaching an id that already exists means two arguments
   * are wearing one identity.
   */
  const collision = await repositories.theses.get(revisionId)
  if (collision && collision.thesisId !== input.thesisId) {
    reject(
      'invariant-violated',
      `Revision "${revisionId}" already belongs to lineage "${collision.thesisId}".`,
    )
  }

  /* ------------------------------------------------------------- minting */

  let revision: InvestmentThesis
  try {
    revision = buildThesis({
      ...(input.prior ?? {
        thesisId: input.thesisId,
        caseId: input.caseId,
        statement: '',
        position: '',
        proposedByDepartmentId: input.proposedByDepartmentId,
        proposedByEmployeeId: context.actor.employeeId!,
        proposedAt: context.occurredAt,
        supportingClaimIds: [],
        opposingClaimIds: [],
        invalidationCriteria: '',
        implications: [],
      }),
      ...input.changes,
      revisionId,
      revisionNumber: (input.prior?.revisionNumber ?? 0) + 1,
      ...(input.prior ? { supersedesRevisionId: input.prior.revisionId } : {}),
      ...(input.prior
        ? { revisedAt: context.occurredAt, revisionReason: input.reason }
        : {}),
      ...(input.aggregationId ? { aggregationId: input.aggregationId } : {}),
      revisionCause: input.cause,
      /*
       * A new argument has been reviewed by nobody and cited by nothing. Both
       * are stated rather than copied: `...prior` would carry the predecessor's
       * citations forward, which would seal a revision nothing has cited.
       */
      lifecycle: input.lifecycle,
      citedByClaimIds: [],
    })
  } catch (error) {
    // The domain builders refuse a thesis with no invalidation criteria, an
    // unknown implication, or a revision that supersedes nothing.
    reject('invariant-violated', error instanceof Error ? error.message : String(error))
  }

  const saved = await repositories.theses.save(revision)

  if (input.prior) {
    await repositories.theses.save({ ...input.prior, lifecycle: 'superseded' })
  }

  /*
   * Re-validated after the write, inside the transaction: numbering with no
   * gaps, a supersedes chain that links up, and no cycles. A lineage that
   * cannot be walked cannot be audited, and rolling back here is free.
   */
  try {
    thesisLineage(
      [
        ...lineage.filter((r) => r.revisionId !== input.prior?.revisionId),
        ...(input.prior ? [{ ...input.prior, lifecycle: 'superseded' as const }] : []),
        saved,
      ],
      input.thesisId,
    )
  } catch (error) {
    reject('invariant-violated', error instanceof Error ? error.message : String(error))
  }

  /* -------------------------------------------------------------- events */

  const mintedEventId = deriveEventId({
    commandId: context.commandId,
    recordType: `thesis-${input.lifecycle}`,
    entityId: revisionId,
  })

  await repositories.events.append(
    thesisEvent({
      eventId: mintedEventId,
      caseId: input.caseId,
      thesisId: input.thesisId,
      revisionId,
      from: null,
      to: input.lifecycle,
      actorEmployeeId: context.actor.employeeId ?? undefined,
      actorDepartmentId: input.proposedByDepartmentId,
      occurredAt: context.occurredAt,
      correlationId: context.correlationId,
      aggregateVersion: investmentCase.version,
    }),
  )

  if (input.prior) {
    await repositories.events.append(
      thesisEvent({
        eventId: deriveEventId({
          commandId: context.commandId,
          recordType: 'thesis-superseded',
          entityId: input.prior.revisionId,
        }),
        caseId: input.caseId,
        thesisId: input.thesisId,
        revisionId: input.prior.revisionId,
        from: input.prior.lifecycle,
        to: 'superseded',
        actorEmployeeId: context.actor.employeeId ?? undefined,
        actorDepartmentId: input.proposedByDepartmentId,
        reason: input.reason,
        occurredAt: context.occurredAt,
        correlationId: context.correlationId,
        causationId: mintedEventId,
        aggregateVersion: investmentCase.version,
      }),
    )
  }

  return saved
}
