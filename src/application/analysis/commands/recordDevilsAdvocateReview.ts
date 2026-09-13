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
  DEVILS_ADVOCATE_CANDIDATE_CANONICALIZATION_VERSION,
  devilsAdvocateCandidateHashMatches,
  type AgentRunRecord,
  type Challenge,
  type ChallengeStatus,
  type DevilsAdvocateReview,
  type GovernanceCandidateBasis,
  type Organization,
} from '~/domain/analysis'
import {
  accountablePrincipal,
  candidateReadyToFile,
  claimsInScopeOf,
  completeProducingWork,
  placeVerdict,
  type ChallengeSubmission,
} from '../reviewRecording'
import type { TransactionalAnalysisRepositories } from '../repositories'
import type { CanonicalValue } from '~/domain/shared/canonicalValue'
import { deriveChallengeId, deriveEventId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'

/**
 * Objections a human Devil's Advocate files in this act.
 *
 * Unchanged, deliberately. A person can read the argument and state an
 * objection they stand behind in one act; requiring them to produce a candidate
 * first and file it second would be ceremony.
 */
export interface DirectDevilsAdvocateInput {
  caseId: string
  thesisId: string
  revisionId: string
  byDepartmentId: string
  challenges: readonly ChallengeSubmission[]
  supersedesReviewId?: string
  /** Absent: nothing is being filed, because these objections are being written. */
  candidateFromRunId?: undefined
}

/**
 * Objections the Devil's Advocate files, having produced them as a candidate.
 *
 * The reference is the whole substantive input, and every other field is
 * `never`: no argument, no materiality, no challenged subject, no statement of
 * what would resolve it. A caller cannot name candidate A and file objections
 * B, so a candidate cannot survive as decorative provenance beside a filing it
 * does not match.
 */
export interface FiledDevilsAdvocateInput {
  caseId: string
  byDepartmentId: string
  /** The run whose produced objections this act files. */
  candidateFromRunId: string
  supersedesReviewId?: string

  thesisId?: undefined
  revisionId?: undefined
  challenges?: undefined
}

export type RecordDevilsAdvocateReviewInput =
  DirectDevilsAdvocateInput | FiledDevilsAdvocateInput

/**
 * The semantic payload, in one of two shapes because there are two acts.
 *
 * The direct one is byte-for-byte what it always was, so every historical
 * filing keeps the identity it was recorded under. The filed one is the
 * candidate reference and nothing else, which is content-bound: the candidate's
 * hash covers the objections and the institutional basis together.
 */
function devilsAdvocatePayload(
  input: RecordDevilsAdvocateReviewInput,
): Record<string, CanonicalValue> {
  if (input.candidateFromRunId !== undefined) {
    return {
      byDepartmentId: input.byDepartmentId,
      candidateFromRunId: input.candidateFromRunId,
      supersedesReviewId: input.supersedesReviewId ?? null,
    }
  }
  return {
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
  }
}

/**
 * Loads the candidate this act files, and refuses it if it cannot still be.
 *
 * The objections come from here and from nowhere else. The Devil's Advocate's
 * standing requirement — that it must object — is enforced at the candidate
 * builder, so a zero-objection draft cannot exist to be filed; this reads what
 * was stored and re-checks that it may still be institutionalised.
 */
async function loadDevilsAdvocateCandidate(
  repositories: TransactionalAnalysisRepositories,
  caseId: string,
  byDepartmentId: string,
  candidateFromRunId: string,
): Promise<{
  runId: string
  run: AgentRunRecord
  basis: GovernanceCandidateBasis
  thesisId: string
  revisionId: string
  challenges: readonly ChallengeSubmission[]
}> {
  const candidate = await repositories.producedChallenges.get(candidateFromRunId)
  if (!candidate) {
    reject(
      'not-found',
      `Run "${candidateFromRunId}" produced no Devil's Advocate candidate. ` +
        `There is nothing to file.`,
    )
  }

  const adoption = await candidateReadyToFile(repositories, {
    caseId,
    byDepartmentId,
    runId: candidateFromRunId,
    basis: candidate.basis,
    hashMatches: devilsAdvocateCandidateHashMatches(candidate),
    knownCanonicalization:
      candidate.canonicalizationVersion ===
      String(DEVILS_ADVOCATE_CANDIDATE_CANONICALIZATION_VERSION),
    refuse: reject,
  })

  return {
    runId: adoption.runId,
    run: adoption.run,
    basis: adoption.basis,
    thesisId: candidate.basis.thesisId,
    revisionId: candidate.basis.sourceRevisionId,
    /*
     * A produced objection is filed OPEN. The producer proposed the argument
     * and its materiality; it did not settle anything, and `resolvedBy` is not
     * on the proposal at all.
     */
    challenges: candidate.artifact.challenges.map((challenge) => ({ ...challenge })),
  }
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
    /* See `RecordVerificationReview`: the filed path's revision is the candidate's. */
    scope: (input) => ({
      caseId: input.caseId,
      ...(input.revisionId ? { thesisRevisionId: input.revisionId } : {}),
    }),
    payload: devilsAdvocatePayload,

    async execute(repositories, context, input) {
      if (input.byDepartmentId !== 'devils-advocate') {
        reject(
          'not-authorised',
          `"${input.byDepartmentId}" is not the Devil's Advocate. Only that ` +
            `control function files its objections.`,
        )
      }
      /*
       * On the filed path the objections come from the immutable candidate.
       * `adoption` is null for a person filing directly, which keeps that path
       * exactly as it was.
       */
      const adoption = input.candidateFromRunId
        ? await loadDevilsAdvocateCandidate(
            repositories,
            input.caseId,
            input.byDepartmentId,
            input.candidateFromRunId,
          )
        : null

      const filing = adoption ?? {
        thesisId: input.thesisId!,
        revisionId: input.revisionId!,
        challenges: input.challenges!,
      }

      /*
       * The Devil's Advocate must object — the standing requirement, applied to
       * both paths. The candidate builder already refuses an empty draft, so on
       * the filed path this is unreachable and kept anyway: the rule belongs to
       * the institutional act, not to whichever producer happened to draft it.
       */
      if (filing.challenges.length === 0) {
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
          revisionId: filing.revisionId,
          thesisId: filing.thesisId,
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

      for (const [ordinal, submission] of filing.challenges.entries()) {
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
              /* The mandate this command exists to discharge, and the desk it
               * already verified is the Devil's Advocate. */
              challengerKind: 'devils-advocate',
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

      const review: DevilsAdvocateReview = {
        scope: 'thesis-revision',
        caseId: input.caseId,
        thesisId: filing.thesisId,
        revisionId: filing.revisionId,
        reviewId: placement.reviewId,
        sequence: placement.sequence,
        ...accountablePrincipal(context),
        byDepartmentId: input.byDepartmentId,
        at: context.occurredAt,
        challenges,
        outcomes,
        ...(adoption ? { filedFromCandidateRunId: adoption.runId } : {}),
        ...(input.supersedesReviewId
          ? { supersedesReviewId: input.supersedesReviewId }
          : {}),
        ...(context.reason ? { reason: context.reason } : {}),
      }
      await repositories.reviews.saveDevilsAdvocate(review)

      /*
       * Filing completes the producing run and the assignment it discharged —
       * the other half of adoption, in the same transaction as the objections.
       * See `RecordVerificationReview`.
       */
      if (adoption) {
        await completeProducingWork(repositories, context, adoption)
      }

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
            thesisId: filing.thesisId,
            revisionId: filing.revisionId,
            reviewId: placement.reviewId,
            challengeId: challenge.id,
            fromState: settled ? 'open' : null,
            toState: outcomes[challenge.id]!,
            occurredAt: context.occurredAt,
            actorEmployeeId: context.actor.employeeId ?? undefined,
            actorAgentPrincipalId: context.actor.agentPrincipalId ?? undefined,
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
            thesisId: filing.thesisId,
            revisionId: filing.revisionId,
            reviewId: placement.superseded.reviewId,
            fromState: 'current',
            toState: 'superseded',
            occurredAt: context.occurredAt,
            actorEmployeeId: context.actor.employeeId ?? undefined,
            actorAgentPrincipalId: context.actor.agentPrincipalId ?? undefined,
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
