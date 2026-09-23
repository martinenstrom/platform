/**
 * ReturnForCorrection — the office that owns a revision sends defective work
 * back to whoever produced it, on Verification's verdict (TD-99, ruled
 * 2026-09-22).
 *
 * ## What it is
 *
 * Verification filed `correction-required` on revision N. The findings are
 * immutable and the revision is not edited: this act marks the assignments
 * whose accepted claims the findings are about as `returned`, each with the
 * findings as its reason, and returns the office's own synthesis assignment
 * so that a successor revision N+1 is synthesised onto the corrected work.
 *
 * ## Ownership follows provenance
 *
 * The command computes owners from the record (`correctionsOwed`): a finding
 * names a claim, the claim was produced by one accepted run, the run belongs
 * to a desk. The caller supplies no owners and cannot choose them. A finding
 * on a claim no accepted run produced refuses the whole act — the record does
 * not send work back to nobody, and it does not send back part of a verdict.
 *
 * ## Who performs it
 *
 * The department that proposed the revision — the Research Office, through
 * its manager or its institutional principal. Verification does not return
 * work (it examines it), and no host or orchestrator does; those initiate,
 * they do not act. Only a verdict of `correction-required` returns work: an
 * `insufficient-evidence` verdict is an analytical outcome the firm stands
 * behind, not a defect to be fixed.
 *
 * ## What it does not decide
 *
 * How many rounds the firm takes on its own is the standing's rule
 * (`automaticCorrectionPermitted`); this act records a return whoever asked
 * for it, and the ledger shows who did.
 */

import {
  actorFieldsOf,
  buildTransitionEvent,
  correctionsOwed,
  latestApplicable,
  type Assignment,
  type Organization,
} from '~/domain/analysis'
import { requirePlaybook } from '../playbookRegistry'
import { deriveEventId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'

export interface ReturnForCorrectionInput {
  caseId: string
  /** The revision Verification examined. Must be the lineage's current, before the control functions. */
  revisionId: string
  /** The verdict that demands the corrections. Must be the one standing for the revision. */
  verificationReviewId: string
  /** The department that owns the revision and performs the return. */
  returnedByDepartmentId: string
}

export interface CorrectionReturn {
  caseId: string
  revisionId: string
  reviewId: string
  /** Each desk whose accepted claims a blocking finding is about, with the claims. */
  returned: readonly {
    departmentId: string
    assignmentId: string
    runId: string
    claimIds: readonly string[]
  }[]
  /** The office's synthesis assignment, returned so the successor revision is synthesised. */
  synthesisAssignmentId: string
}

export function returnForCorrection(
  _organization: Organization,
): CommandDefinition<ReturnForCorrectionInput, CorrectionReturn> {
  return {
    type: 'ReturnForCorrection',
    /* Assignments move; the case aggregate does not. */
    versionPolicy: 'refuses-expected-version',
    reasonPolicy: 'optional',
    category: 'workflow',
    /* The same mandate as submitting the revision: the office acts on its own work. */
    mandate: (input) => ({
      kind: 'department-manager',
      departmentId: input.returnedByDepartmentId,
    }),
    scope: (input) => ({ caseId: input.caseId, thesisRevisionId: input.revisionId }),
    payload: (input) => ({
      revisionId: input.revisionId,
      verificationReviewId: input.verificationReviewId,
      returnedByDepartmentId: input.returnedByDepartmentId,
    }),

    async execute(repositories, context, input) {
      /* --------------------------------------------------------- the case */

      const investmentCase = await repositories.cases.get(input.caseId)
      if (!investmentCase) reject('not-found', `Case "${input.caseId}" does not exist`)
      if (
        investmentCase.stage === 'blocked' ||
        investmentCase.stage === 'withdrawn' ||
        investmentCase.stage === 'published'
      ) {
        reject(
          'illegal-prior-state',
          `Case "${input.caseId}" is ${investmentCase.stage}. A case that is not ` +
            `running has no work to return.`,
        )
      }
      if (investmentCase.closedAt) {
        reject('illegal-prior-state', `Case "${input.caseId}" is closed`)
      }
      if (!investmentCase.playbookId || !investmentCase.playbookVersion) {
        reject('illegal-prior-state', `Case "${input.caseId}" has no playbook`)
      }

      /* ----------------------------------------------------- the revision */

      const revision = await repositories.theses.get(input.revisionId)
      if (!revision) reject('not-found', `Revision "${input.revisionId}" does not exist`)
      if (revision.caseId !== input.caseId) {
        reject('invariant-violated', `Revision "${input.revisionId}" is another case's`)
      }
      if (revision.lifecycle !== 'awaiting-verification') {
        reject(
          'illegal-prior-state',
          `Revision "${input.revisionId}" is ${revision.lifecycle}. Only a revision ` +
            `before the control functions is returned for correction; a superseded ` +
            `one has already been replaced, and an unsubmitted one has no verdict.`,
        )
      }
      if (revision.proposedByDepartmentId !== input.returnedByDepartmentId) {
        reject(
          'not-authorised',
          `Revision "${input.revisionId}" is "${revision.proposedByDepartmentId}"'s, ` +
            `not "${input.returnedByDepartmentId}"'s. The office that owns a revision ` +
            `returns its work; nobody returns another desk's.`,
        )
      }

      /* ------------------------------------------------------ the verdict */

      const verifications = await repositories.reviews.verificationsForCase(input.caseId)
      const review = verifications.find((candidate) => candidate.reviewId === input.verificationReviewId)
      if (!review) reject('not-found', `No verification "${input.verificationReviewId}" on case "${input.caseId}"`)
      const standing = latestApplicable(verifications, input.caseId, input.revisionId)
      if (!standing || standing.reviewId !== review.reviewId) {
        reject(
          'illegal-prior-state',
          `Verification "${input.verificationReviewId}" is not the verdict standing for revision ` +
            `"${input.revisionId}"` +
            (standing ? ` — "${standing.reviewId}" is` : ` — none stands`) +
            `. Work is returned on the verdict that stands, not on a superseded one.`,
        )
      }
      if (review.status !== 'correction-required') {
        reject(
          'invariant-violated',
          `Verification "${input.verificationReviewId}" is ${review.status}, not correction-required. ` +
            `Only a verdict that demands corrections returns work; a verdict of ` +
            `insufficient evidence is the firm's conclusion, not a defect to fix.`,
        )
      }

      /* ---------------------------------------------------- the ownership */

      const runs = await repositories.runs.listForCase(input.caseId)
      const ownership = correctionsOwed(review, runs)
      if (ownership.unattributed.length > 0) {
        reject(
          'invariant-violated',
          `Verification "${input.verificationReviewId}" finds against claims no accepted run ` +
            `produced (${ownership.unattributed.map((finding) => finding.claimId).join(', ')}). ` +
            `The record does not send work back to nobody.`,
        )
      }
      if (ownership.owed.length === 0) {
        reject(
          'invariant-violated',
          `Verification "${input.verificationReviewId}" demands corrections but has no blocking ` +
            `finding. There is nothing to return.`,
        )
      }

      const playbook = requirePlaybook(investmentCase.playbookId, investmentCase.playbookVersion)
      const synthesisEntry = playbook.entries.find(
        (entry) => entry.departmentId === revision.proposedByDepartmentId,
      )
      if (!synthesisEntry) {
        reject(
          'invariant-violated',
          `Playbook "${playbook.id}@${playbook.version}" gives "${revision.proposedByDepartmentId}" ` +
            `no entry, so there is no synthesis to return.`,
        )
      }
      const assignments = await repositories.assignments.listForCase(input.caseId)
      const synthesisAssignment = assignments.find(
        (candidate) => candidate.playbookEntryKey === synthesisEntry.key,
      )
      if (!synthesisAssignment) {
        reject(
          'not-found',
          `The case has no assignment for "${synthesisEntry.key}". A successor could ` +
            `not be synthesised.`,
        )
      }

      /* -------------------------------------------------------- the writes */

      const reasons = new Map<string, string[]>()
      const noteFor = (assignmentId: string, line: string) =>
        reasons.set(assignmentId, [...(reasons.get(assignmentId) ?? []), line])

      for (const owed of ownership.owed) {
        noteFor(
          owed.assignmentId,
          `Verification ${review.reviewId} demands corrections on revision ` +
            `${revision.revisionNumber}: ` +
            owed.findings
              .map((finding) => `${finding.claimId} (${finding.kind}): ${finding.correctionRequired}`)
              .join('; '),
        )
      }
      noteFor(
        synthesisAssignment.id,
        `Revision ${revision.revisionNumber} was returned for correction on Verification ` +
          `${review.reviewId}; synthesise the successor onto the corrected work.`,
      )

      const returned: Assignment[] = []
      for (const [assignmentId, lines] of reasons) {
        const assignment = assignments.find((candidate) => candidate.id === assignmentId)
        if (!assignment) reject('not-found', `Assignment "${assignmentId}" does not exist`)
        if (assignment.status !== 'completed') {
          reject(
            'illegal-prior-state',
            `Assignment "${assignmentId}" (${assignment.departmentId}) is ` +
              `${assignment.status}. Only adopted work is returned for correction.`,
          )
        }
        returned.push(
          await repositories.assignments.save({
            ...assignment,
            status: 'returned',
            returnedReason: lines.join(' '),
          }),
        )
      }

      for (const [ordinal, assignment] of returned.entries()) {
        await repositories.events.append(
          buildTransitionEvent({
            eventId: deriveEventId({
              commandId: context.commandId,
              recordType: 'returned-for-correction',
              entityId: assignment.id,
              ordinal,
            }),
            caseId: input.caseId,
            subject: 'assignment',
            assignmentId: assignment.id,
            revisionId: input.revisionId,
            fromState: 'completed',
            toState: 'returned',
            occurredAt: context.occurredAt,
            ...actorFieldsOf(context.actor),
            actorDepartmentId: context.actor.departmentId ?? undefined,
            correlationId: context.correlationId,
            aggregateVersion: investmentCase.version,
            reason: assignment.returnedReason!,
          }),
        )
      }

      const value: CorrectionReturn = {
        caseId: input.caseId,
        revisionId: input.revisionId,
        reviewId: review.reviewId,
        returned: ownership.owed.map((owed) => ({
          departmentId: owed.departmentId,
          assignmentId: owed.assignmentId,
          runId: owed.runId,
          claimIds: owed.findings.map((finding) => finding.claimId),
        })),
        synthesisAssignmentId: synthesisAssignment.id,
      }
      return {
        value,
        resultKind: 'correction-return',
        resultRef: `${input.caseId}|${input.revisionId}|${review.reviewId}`,
      }
    },

    /*
     * A replay reads the same return off the record: the verdict and the
     * accepted runs are immutable, so the ownership derives identically.
     */
    async rehydrate(repositories, resultRef) {
      const [caseId, revisionId, reviewId] = resultRef.split('|')
      const investmentCase = await repositories.cases.get(caseId!)
      const revision = await repositories.theses.get(revisionId!)
      const review = (await repositories.reviews.verificationsForCase(caseId!)).find(
        (candidate) => candidate.reviewId === reviewId,
      )
      if (!investmentCase || !revision || !review || !investmentCase.playbookId || !investmentCase.playbookVersion) {
        throw new Error(
          `Return for correction "${resultRef}" was recorded by this command but no ` +
            `longer reads back. The ledger and the store disagree.`,
        )
      }
      const ownership = correctionsOwed(review, await repositories.runs.listForCase(caseId!))
      const playbook = requirePlaybook(investmentCase.playbookId, investmentCase.playbookVersion)
      const synthesisEntry = playbook.entries.find(
        (entry) => entry.departmentId === revision.proposedByDepartmentId,
      )
      const synthesisAssignment = (await repositories.assignments.listForCase(caseId!)).find(
        (candidate) => candidate.playbookEntryKey === synthesisEntry?.key,
      )
      if (!synthesisAssignment) {
        throw new Error(`Return for correction "${resultRef}": the synthesis assignment no longer reads back.`)
      }
      return {
        caseId: caseId!,
        revisionId: revisionId!,
        reviewId: review.reviewId,
        returned: ownership.owed.map((owed) => ({
          departmentId: owed.departmentId,
          assignmentId: owed.assignmentId,
          runId: owed.runId,
          claimIds: owed.findings.map((finding) => finding.claimId),
        })),
        synthesisAssignmentId: synthesisAssignment.id,
      }
    },
  }
}
