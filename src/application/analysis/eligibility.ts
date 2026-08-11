/**
 * Turning stored state into the inputs the domain decides eligibility from.
 *
 * **This module decides nothing.** It reads, it maps, and it hands the result
 * to `evaluateRevisionEligibility`, which is the only function in the codebase
 * that answers "may this revision reach the CIO". Four fitness rules, each with
 * a planted violation, prove that no handler, no SQL and no presentation module
 * has a second opinion.
 *
 * That boundary is worth being pedantic about. The adapter is where a
 * threshold would be most tempting to put — it already has every input in one
 * place — and a comparison here would be invisible: the domain function would
 * still be called, still return a result, and the result would be wrong in a
 * way that reads as correct.
 *
 * ## Why the answer is not stored
 *
 * It is derived on every read. A stored `eligible` flag is a second source of
 * truth that goes stale the moment a verdict lands, a challenge is filed or a
 * revision is superseded — and nothing in C1C-4 runs continuously enough to
 * notice. `evaluatedAt` below is therefore **projection time**: when this
 * calculation ran, not when the revision became eligible. Nobody knows when it
 * became eligible, and a field that implied otherwise would be the most
 * plausible wrong number in the record.
 */

import {
  RISK_REVIEW_WHEN_IMPLEMENTABLE,
  blockingDisagreements,
  evaluateRevisionEligibility,
  latestApplicable,
  requirementStatusFor,
  type CaseId,
  type CaseReviews,
  type MissingWork,
  type RevisionEligibilityInput,
  type RiskRequirementState,
  type ThesisEligibility,
  type EligibilityPolicy,
} from '~/domain/analysis'
import type { TransactionalAnalysisRepositories } from './repositories'
import { requirePlaybook } from './playbookRegistry'
import { unmetRequiredWork } from './requiredWork'
import { RISK_ENTRY_KEY } from './reviewRecording'

/** Which verdicts a result was computed from, so the answer can be traced. */
export interface ReviewsRead {
  verificationReviewId: string | null
  devilsAdvocateReviewId: string | null
  riskReviewId: string | null
}

export interface RevisionEligibility {
  /** Exactly what the domain returned. Never adjusted here. */
  eligibility: ThesisEligibility
  /** The exact revision this speaks about. */
  revisionId: string
  thesisId: string
  riskRequirement: RiskRequirementState
  /** The rule version behind the Risk requirement, where one resolved it. */
  riskRuleVersion: string | null
  /** The latest applicable verdict of each discipline, by id. */
  reviewsRead: ReviewsRead
  /**
   * When this calculation ran — **not** when the revision became eligible.
   *
   * Nothing observes the transition, so the instant it logically changed is
   * unknown. Naming this field `becameEligibleAt` would be the most plausible
   * wrong number the record could carry.
   */
  evaluatedAt: string
}

/**
 * Eligibility for every revision of a case.
 *
 * `now` is passed rather than read, for the same reason the domain takes a
 * clock: a projection whose timestamp comes from `Date.now()` is one a test
 * cannot pin and a restart cannot reproduce.
 */
export async function revisionEligibility(
  repositories: TransactionalAnalysisRepositories,
  caseId: CaseId,
  now: string,
  /**
   * The policy in force, supplied by the caller.
   *
   * **Required, and never defaulted.** This service does not choose a policy,
   * fall back to v1, or look up "the current one": a default would be a second
   * place the firm's line is drawn, and callers would inherit it without
   * noticing. That is exactly how the stored `blocksEligibility` came to
   * disagree with the policy registry.
   *
   * The whole policy rather than a bare threshold, so that whatever consumes
   * the result can name WHICH policy produced it -- one answer to "which policy
   * applied, what did it contain, what did it decide".
   */
  policy: EligibilityPolicy,
): Promise<RevisionEligibility[]> {
  const investmentCase = await repositories.cases.get(caseId)
  if (!investmentCase) return []

  const revisions = await repositories.theses.listForCase(caseId)
  if (revisions.length === 0) return []

  const [assignments, runs, resolutions, verifications, challenges, risks] =
    await Promise.all([
      repositories.assignments.listForCase(caseId),
      repositories.runs.listForCase(caseId),
      repositories.requirements.listForCase(caseId),
      repositories.reviews.verificationsForCase(caseId),
      repositories.reviews.challengesForCase(caseId),
      repositories.reviews.riskForCase(caseId),
    ])

  const reviews: CaseReviews = {
    verification: verifications,
    devilsAdvocate: challenges,
    risk: risks,
  }

  const playbook =
    investmentCase.playbookId && investmentCase.playbookVersion
      ? requirePlaybook(investmentCase.playbookId, investmentCase.playbookVersion)
      : null

  /* ------------------------------------------------------ the mapping */

  const inputs: RevisionEligibilityInput[] = []
  const riskStates: RiskRequirementState[] = []
  const riskVersions: (string | null)[] = []

  for (const revision of revisions) {
    /*
     * Unresolved is the DEFAULT, not a fallback. Neither direction may be
     * inferred: not `required` because a Risk review happens to exist, and not
     * `not-required` because none does. Both are conclusions drawn from an
     * absence, and both are how a governance gate gets skipped by accident.
     */
    const status = requirementStatusFor(RISK_ENTRY_KEY, revision.revisionId, resolutions)
    const riskRequirement: RiskRequirementState =
      status.state === 'required'
        ? 'required'
        : status.state === 'not-required'
          ? 'not-required'
          : 'unresolved'
    riskStates.push(riskRequirement)
    riskVersions.push(
      status.state === 'unresolved'
        ? null
        : (status.ruleVersion ?? RISK_REVIEW_WHEN_IMPLEMENTABLE.ruleVersion),
    )

    /*
     * Required work is re-derived rather than read from a stored blocker. A
     * stored one is a second source of truth about work, and the two disagree
     * the first time a late contribution lands.
     */
    const missing: MissingWork[] = playbook
      ? unmetRequiredWork({
          playbook,
          entryKey: 'verification',
          revisionId: revision.revisionId,
          assignments,
          runs,
          resolutions,
        }).map((unmet) => ({
          playbookEntryKey: unmet.playbookEntryKey,
          departmentId: unmet.departmentId,
          failed: unmet.reason === 'run-failed',
        }))
      : []

    /*
     * The manager's own record of what could not be settled. Supplied like
     * contribution state: the aggregation records what it found, and the
     * domain decides what that means.
     */
    const aggregation = revision.aggregationId
      ? await repositories.aggregations.get(revision.aggregationId)
      : null

    inputs.push({
      thesisId: revision.thesisId,
      revisionId: revision.revisionId,
      lifecycle: revision.lifecycle,
      riskRequirement,
      riskEntryKey: RISK_ENTRY_KEY,
      missingRequiredContributions: missing,
      blockingDisagreements: aggregation
        ? blockingDisagreements(aggregation, policy.disagreementBlocksAtOrAbove).map(
            (d) => d.claimId,
          )
        : [],
    })
  }

  /* ----------------------------------------------------- the decision */

  const decided = evaluateRevisionEligibility(
    inputs,
    caseId,
    reviews,
    policy.challengeBlocksAtOrAbove,
  )

  return decided.map((eligibility, index) => {
    const revision = revisions[index]!
    return {
      eligibility,
      revisionId: revision.revisionId,
      thesisId: revision.thesisId,
      riskRequirement: riskStates[index]!,
      riskRuleVersion: riskVersions[index]!,
      reviewsRead: {
        verificationReviewId:
          latestApplicable(verifications, caseId, revision.revisionId)?.reviewId ?? null,
        devilsAdvocateReviewId:
          latestApplicable(challenges, caseId, revision.revisionId)?.reviewId ?? null,
        riskReviewId:
          latestApplicable(risks, caseId, revision.revisionId)?.reviewId ?? null,
      },
      evaluatedAt: now,
    }
  })
}
