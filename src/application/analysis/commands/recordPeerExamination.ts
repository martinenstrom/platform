/**
 * One analytical desk's examination of another's argument.
 *
 * The firm already had four ways to attack a conclusion, and all four were
 * control functions. This is the fifth and it is different in kind: a peer
 * examination is a desk that knows the subject reading another desk's persisted
 * claims and saying, on the record, whether it agrees.
 *
 * ## What separates it from the Devil's Advocate
 *
 * The Devil's Advocate has a standing obligation to object — `recordDevils-
 * AdvocateReview` refuses an empty submission, because a control function whose
 * mandate is to attack the argument and that filed nothing has not discharged
 * it. **A peer has an obligation to look, not to object.** So this command
 * permits zero challenges, and the review row is written anyway.
 *
 * That row is the whole point. "A qualified desk read this and had nothing to
 * contest" and "nobody qualified ever read it" are different institutional
 * facts, and only the first is evidence of scrutiny. Without a persisted
 * examination the eligibility gate could not tell them apart, and
 * PEER_SCRUTINY_ABSENT would be satisfied by silence.
 *
 * ## What a zero-challenge examination is NOT
 *
 * It is not agreement, not a confidence increase, not the Devil's Advocate
 * satisfied, and not CIO eligibility by itself. It records that scrutiny
 * happened. `composeConfidence` can only ever lower, so nothing here can raise
 * a claim's confidence, and the other gates are untouched.
 *
 * ## TD-84: a successor revision needs its own examination
 *
 * An examination is scoped to the revision it actually read, and it stays
 * there. When a challenge is answered by minting a SUCCESSOR revision rather
 * than by settling in place, there is currently no mechanism to request or
 * re-establish peer scrutiny on that successor — and the gap is deliberate
 * rather than unnoticed.
 *
 * The fix must never be inheritance. A successor may carry materially
 * different claims, so carrying the old verdict forward would report that a
 * desk examined an argument it never saw — the exact failure revision-scoped
 * review exists to prevent. The answer is an explicit new examination act
 * against the successor, which is a capability, not a default.
 *
 * ## Authority
 *
 * `department-contribution`, not `governance-verdict`. That is not a
 * convenience: `governance-verdict` requires `departmentIsGovernance`, and
 * Rates — the first peer — is deliberately not a control function. Routing a
 * peer examination through the governance mandate would either fail for every
 * analytical desk or force Rates to be mislabelled as governance, which is the
 * exact distinction migration 0035 exists to preserve.
 */

import {
  buildChallenge,
  buildTransitionEvent,
  type Challenge,
  type ChallengeStatus,
  type Organization,
  type PeerExaminationReview,
} from '~/domain/analysis'
import {
  claimsInScopeOf,
  placeVerdict,
  type ChallengeSubmission,
} from '../reviewRecording'
import { deriveChallengeId, deriveEventId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'

/**
 * The playbook entry a peer examination is performed under.
 *
 * Named here and not yet registered in a playbook: the entry arrives with
 * playbook v5. Until then this is the key the placement carries, so the two
 * cannot disagree about what it is called when v5 lands.
 */
export const PEER_EXAMINATION_ENTRY_KEY = 'peer-examination'

export interface RecordPeerExaminationInput {
  caseId: string
  thesisId: string
  revisionId: string
  /** The desk doing the examining. */
  byDepartmentId: string
  /** The desk whose claims are being examined. */
  examinedDepartmentId: string
  /**
   * May be empty. See the note above: an examination that raised no objection
   * is a finding, not a missing submission.
   */
  challenges: readonly ChallengeSubmission[]
  supersedesReviewId?: string
}

export function recordPeerExamination(
  organization: Organization,
): CommandDefinition<RecordPeerExaminationInput, PeerExaminationReview> {
  return {
    type: 'RecordPeerExamination',
    versionPolicy: 'refuses-expected-version',
    reasonPolicy: 'optional',
    /*
     * `analysis`, NOT `governance`, and `categoryMatchesMandate` enforces it:
     * only a `governance-verdict` mandate may file an act as governance. That
     * check refused this command the first time it declared otherwise, which is
     * the taxonomy doing its job — a peer examination is a desk applying its
     * expertise to another desk's argument, which is analytical work. Filing it
     * as governance would put a fifth control-function verdict in the ledger
     * and let peer scrutiny be counted as a control the firm does not have.
     */
    category: 'analysis',
    /* See the header. A peer is not a control function. */
    mandate: (input) => ({
      kind: 'department-contribution',
      departmentId: input.byDepartmentId,
    }),
    scope: (input) => ({ caseId: input.caseId, thesisRevisionId: input.revisionId }),
    payload: (input) => ({
      revisionId: input.revisionId,
      thesisId: input.thesisId,
      byDepartmentId: input.byDepartmentId,
      examinedDepartmentId: input.examinedDepartmentId,
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
      /* ------------------------------------------------ who may examine */

      if (input.byDepartmentId === 'devils-advocate') {
        reject(
          'not-authorised',
          `The Devil's Advocate does not file peer examinations. Its objections ` +
            `are recorded as a Devil's Advocate review, and recording them here ` +
            `would let a control function's standing obligation to object be ` +
            `read as a qualified peer independently agreeing.`,
        )
      }

      /*
       * The general form of the same rule. Verification, Compliance and Risk
       * are control functions too, and a peer examination filed by one of them
       * would be scrutiny of the argument counted twice — once as the control
       * verdict it is, and once as the independent second opinion it is not.
       */
      const examiner = organization.departments.find(
        (department) => department.id === input.byDepartmentId,
      )
      if (!examiner) {
        reject('not-found', `There is no department "${input.byDepartmentId}".`)
      }
      if (examiner.isGovernance) {
        reject(
          'not-authorised',
          `"${input.byDepartmentId}" is a control function, not an analytical ` +
            `desk. A peer examination is a second qualified opinion on the ` +
            `subject; a control function already has its own review kind.`,
        )
      }

      const examined = organization.departments.find(
        (department) => department.id === input.examinedDepartmentId,
      )
      if (!examined) {
        reject('not-found', `There is no department "${input.examinedDepartmentId}".`)
      }

      /*
       * A desk reviewing its own conclusion is the thing peer scrutiny exists
       * to be an alternative to. Also enforced by
       * `reviews_peer_examines_another_department`; refused here so the caller
       * gets an institutional reason rather than a constraint violation.
       */
      if (input.byDepartmentId === input.examinedDepartmentId) {
        reject(
          'invariant-violated',
          `"${input.byDepartmentId}" cannot peer-examine itself. A desk ` +
            `re-reading its own argument is not independent scrutiny of it.`,
        )
      }

      /* -------------------------------------------------- the placement */

      const existing = await repositories.reviews.peerExaminationsForCase(input.caseId)
      const placement = await placeVerdict(
        repositories,
        context,
        {
          caseId: input.caseId,
          revisionId: input.revisionId,
          thesisId: input.thesisId,
          byDepartmentId: input.byDepartmentId,
          kind: 'peer-examination',
          playbookEntryKey: PEER_EXAMINATION_ENTRY_KEY,
          status: 'examined',
          ...(input.supersedesReviewId
            ? { supersedesReviewId: input.supersedesReviewId }
            : {}),
        },
        existing,
      )

      /* -------------------------------------------------- the objections */

      /*
       * Identical to the Devil's Advocate's rules, and deliberately so. Half A
       * established what makes an objection an institutional act — it names a
       * claim the manager put in scope, it carries counter-evidence or a
       * statement of what would settle it, and a resolution names who settled
       * it. None of that is weaker because a peer raised it rather than the
       * control function. Only the obligation to raise ANY differs.
       */
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
          challenges.push(
            buildChallenge({
              ...submission,
              id,
              /* The mandate this command discharges, and the desk it verified
               * is an analytical peer rather than a control function. */
              challengerKind: 'peer',
              byDepartmentId: input.byDepartmentId,
            }),
          )
        } catch (error) {
          reject(
            'invariant-violated',
            error instanceof Error ? error.message : String(error),
          )
        }
        outcomes[id] = outcome
      }

      /* -------------------------------------------------------- the write */

      const review: PeerExaminationReview = {
        scope: 'thesis-revision',
        caseId: input.caseId,
        thesisId: input.thesisId,
        revisionId: input.revisionId,
        reviewId: placement.reviewId,
        sequence: placement.sequence,
        byEmployeeId: context.actor.employeeId!,
        byDepartmentId: input.byDepartmentId,
        examinedDepartmentId: input.examinedDepartmentId,
        at: context.occurredAt,
        challenges,
        outcomes,
        ...(input.supersedesReviewId
          ? { supersedesReviewId: input.supersedesReviewId }
          : {}),
        ...(context.reason ? { reason: context.reason } : {}),
      }
      await repositories.reviews.savePeerExamination(review)

      /* Recorded against, not moved. Same reason as the other verdicts. */
      const caseVersion = (await repositories.cases.get(input.caseId))?.version ?? 0

      /* ------------------------------------------------------- the events */

      /*
       * The examination itself is an event, emitted whether or not anything was
       * contested. A ledger that only showed challenge-opened would show
       * nothing at all for the examination that raised none — and "no events"
       * is what never happening looks like.
       */
      await repositories.events.append(
        buildTransitionEvent({
          eventId: deriveEventId({
            commandId: context.commandId,
            recordType: 'peer-examination-recorded',
            entityId: placement.reviewId,
          }),
          caseId: input.caseId,
          subject: 'review',
          thesisId: input.thesisId,
          revisionId: input.revisionId,
          reviewId: placement.reviewId,
          fromState: null,
          toState: challenges.length === 0 ? 'examined-no-objection' : 'examined',
          occurredAt: context.occurredAt,
          actorEmployeeId: context.actor.employeeId ?? undefined,
          actorDepartmentId: context.actor.departmentId ?? undefined,
          correlationId: context.correlationId,
          aggregateVersion: caseVersion,
        }),
      )

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
            reviewId: placement.reviewId,
            challengeId: challenge.id,
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
      const found = (await repositories.reviews.get(resultRef)) as PeerExaminationReview
      if (!found) {
        throw new Error(
          `Peer examination "${resultRef}" was committed by this command but no ` +
            `longer reads back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
