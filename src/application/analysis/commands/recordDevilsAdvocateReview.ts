/**
 * The objections, against one exact revision.
 *
 * The Devil's Advocate exists to attack the argument the firm is about to act
 * on. That only works if an objection is a finding rather than a mood, so
 * `buildChallenge` refuses one with neither counter-evidence nor a statement of
 * what would settle it — and this command refuses one aimed at a claim the
 * manager did not put in scope.
 *
 * ## Materiality, and a lower bar than the manager's
 *
 * A challenge carries `DisagreementMateriality`, the same scale the aggregation
 * uses, and blocks at `material` where an aggregation disagreement blocks only
 * at `decision-critical`. Deliberate: a formal objection from the desk whose
 * whole mandate is to disagree is a stronger institutional signal than a
 * manager recording that two desks did not agree. A non-material challenge is
 * stored, visible, and read by the CIO — it just does not stop the revision.
 *
 * Challenge ids derive from the command, like claim ids in C1C-2. A caller does
 * not name them, so two submissions of one review cannot collide and a retry
 * addresses the same objections.
 */

import {
  buildChallenge,
  buildTransitionEvent,
  type Challenge,
  type ChallengeStatus,
  type DevilsAdvocateReview,
  type Organization,
} from '~/domain/analysis'
import { claimsInScopeOf, placeVerdict } from '../reviewRecording'
import { deriveChallengeId, deriveEventId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'

/** A challenge as the caller states it: no id, because the command mints it. */
export type ChallengeSubmission = Omit<Challenge, 'id'> & {
  /** How the organization answered it, where it has. */
  outcome?: ChallengeStatus
}

export interface RecordDevilsAdvocateReviewInput {
  caseId: string
  thesisId: string
  revisionId: string
  byDepartmentId: string
  challenges: readonly ChallengeSubmission[]
  supersedesReviewId?: string
}

export function recordDevilsAdvocateReview(
  _organization: Organization,
): CommandDefinition<RecordDevilsAdvocateReviewInput, DevilsAdvocateReview> {
  return {
    type: 'RecordDevilsAdvocateReview',
    versionPolicy: 'refuses-expected-version',
    reasonPolicy: 'optional',
    category: 'governance',
    /*
     * The DISCIPLINE the department handles, which is 'challenge' — the
     * department is 'devils-advocate'. Naming the department here would ask
     * the organization whether a department handles itself.
     */
    mandate: () => ({ kind: 'governance-verdict', discipline: 'challenge' }),
    scope: (input) => ({ caseId: input.caseId, thesisRevisionId: input.revisionId }),
    payload: (input) => ({
      revisionId: input.revisionId,
      thesisId: input.thesisId,
      byDepartmentId: input.byDepartmentId,
      challenges: input.challenges.map((challenge) => ({
        contests: challenge.contests,
        kind: challenge.kind,
        argument: challenge.argument,
        materiality: challenge.materiality,
        outcome: challenge.outcome ?? 'open',
      })),
      supersedesReviewId: input.supersedesReviewId ?? null,
    }),

    async execute(repositories, context, input) {
      if (input.byDepartmentId !== 'devils-advocate') {
        reject(
          'not-authorised',
          `"${input.byDepartmentId}" is not the Devil's Advocate. Only that ` +
            `control function files its objections.`,
        )
      }
      if (input.challenges.length === 0) {
        reject(
          'invariant-violated',
          `A Devil's Advocate verdict with no challenges records nothing. If the ` +
            `argument survived scrutiny, that is a challenge kind with an ` +
            `outcome, not an empty submission.`,
        )
      }

      const existing = await repositories.reviews.challengesForCase(input.caseId)
      const placement = await placeVerdict(
        repositories,
        context,
        {
          caseId: input.caseId,
          revisionId: input.revisionId,
          thesisId: input.thesisId,
          byDepartmentId: input.byDepartmentId,
          kind: 'devils-advocate',
          playbookEntryKey: 'challenge',
          status: 'filed',
          ...(input.supersedesReviewId
            ? { supersedesReviewId: input.supersedesReviewId }
            : {}),
        },
        existing,
      )

      /* ---------------------------------------------------- the challenges */

      const inScope = await claimsInScopeOf(repositories, placement.revision)
      const challenges: Challenge[] = []
      const outcomes: Record<string, ChallengeStatus> = {}

      for (const [ordinal, submission] of input.challenges.entries()) {
        if (inScope.size > 0 && !inScope.has(submission.contests)) {
          reject(
            'invariant-violated',
            `Challenge against claim "${submission.contests}" names a claim the ` +
              `manager did not put in this revision's scope. An objection to work ` +
              `outside the argument does not block the argument.`,
          )
        }
        const outcome = submission.outcome ?? 'open'
        if (outcome !== 'open' && !submission.resolvedBy?.trim()) {
          reject(
            'invariant-violated',
            `Challenge against "${submission.contests}" is recorded as "${outcome}" ` +
              `and names nobody who settled it. A resolution with no author is a ` +
              `resolution nobody is accountable for.`,
          )
        }

        const id = deriveChallengeId(context.commandId, ordinal)
        try {
          challenges.push(buildChallenge({ ...submission, id }))
        } catch (error) {
          reject(
            'invariant-violated',
            error instanceof Error ? error.message : String(error),
          )
        }
        outcomes[id] = outcome
      }

      /* -------------------------------------------------------- the write */

      const review: DevilsAdvocateReview = {
        scope: 'thesis-revision',
        caseId: input.caseId,
        thesisId: input.thesisId,
        revisionId: input.revisionId,
        reviewId: placement.reviewId,
        sequence: placement.sequence,
        byEmployeeId: context.actor.employeeId!,
        byDepartmentId: input.byDepartmentId,
        at: context.occurredAt,
        challenges,
        outcomes,
        ...(input.supersedesReviewId
          ? { supersedesReviewId: input.supersedesReviewId }
          : {}),
        ...(context.reason ? { reason: context.reason } : {}),
      }
      await repositories.reviews.saveDevilsAdvocate(review)

      /*
       * The case version the verdict was recorded AGAINST, not one it moved.
       * A governance verdict does not advance case workflow — which is what
       * refusing an expectedVersion says — and stamping a bumped version would
       * read as a movement nobody made.
       */
      const caseVersion = (await repositories.cases.get(input.caseId))?.version ?? 0

      /* ------------------------------------------------------- the events */

      for (const [ordinal, challenge] of challenges.entries()) {
        const settled = outcomes[challenge.id] !== 'open'
        await repositories.events.append(
          buildTransitionEvent({
            eventId: deriveEventId({
              commandId: context.commandId,
              recordType: settled ? 'challenge-resolved' : 'challenge-opened',
              entityId: challenge.id,
              ordinal,
            }),
            caseId: input.caseId,
            subject: 'review',
            thesisId: input.thesisId,
            revisionId: input.revisionId,
            reviewId: challenge.id,
            fromState: settled ? 'open' : null,
            toState: outcomes[challenge.id]!,
            occurredAt: context.occurredAt,
            actorEmployeeId: context.actor.employeeId ?? undefined,
            actorDepartmentId: context.actor.departmentId ?? undefined,
            correlationId: context.correlationId,
            aggregateVersion: caseVersion,
          }),
        )
      }

      if (placement.superseded) {
        await repositories.events.append(
          buildTransitionEvent({
            eventId: deriveEventId({
              commandId: context.commandId,
              recordType: 'governance-verdict-superseded',
              entityId: placement.superseded.reviewId,
            }),
            caseId: input.caseId,
            subject: 'review',
            thesisId: input.thesisId,
            revisionId: input.revisionId,
            reviewId: placement.superseded.reviewId,
            fromState: 'current',
            toState: 'superseded',
            occurredAt: context.occurredAt,
            actorEmployeeId: context.actor.employeeId ?? undefined,
            actorDepartmentId: context.actor.departmentId ?? undefined,
            correlationId: context.correlationId,
            aggregateVersion: caseVersion,
          }),
        )
      }

      return { value: review, resultKind: 'review', resultRef: placement.reviewId }
    },

    async rehydrate(repositories, resultRef) {
      const found = (await repositories.reviews.get(resultRef)) as DevilsAdvocateReview
      if (!found) {
        throw new Error(
          `Devil's Advocate review "${resultRef}" was committed by this command ` +
            `but no longer reads back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
