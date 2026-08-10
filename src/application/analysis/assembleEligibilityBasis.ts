/**
 * Gathers the facts a CIO submission attests, and asks the domain what they mean.
 *
 * This is the collector and coordinator, and **nothing else**. It reads stored
 * facts, resolves nothing on its own authority, calls the approved domain
 * evaluators, and returns what they said.
 *
 * ## What it must never become
 *
 * A second owner of eligibility logic. It holds **no threshold**, makes no
 * judgement about whether a disagreement blocks, and does not decide which
 * policy applies — the caller supplies the policy in force, because the caller
 * is the one performing the institutional act.
 *
 *     repositories
 *         ↓
 *     assembleEligibilityBasis        (facts in)
 *         ↓
 *     versioned EligibilityPolicy     (supplied, never chosen here)
 *         ↓
 *     domain gate evaluators          (the judgement)
 *         ↓
 *     EligibilityBasis + GateReport
 *
 * ## Why the basis and the report come back together
 *
 * The report explains a verdict about *this* basis. Returning them separately
 * would let a caller pair a report with a basis it did not describe, and the
 * pairing is the only thing that makes the explanation trustworthy.
 */

import {
  buildBasisManifest,
  evaluateEligibilityGates,
  type EligibilityBasis,
  type EligibilityGateReport,
  unresolvedChallenges,
  type EligibilityPolicy,
} from '~/domain/analysis'
import type { AnalysisRepositories } from './repositories'
import { revisionEligibility } from './eligibility'

export interface AssembledBasis {
  basis: EligibilityBasis
  /** Every gate, passed and failed, under the policy supplied. */
  gates: EligibilityGateReport
}

/**
 * The facts behind one revision, plus the domain's verdict on them.
 *
 * Returns `null` when the revision is not one this case holds — an absent
 * revision is a caller error to report, not an empty basis to assemble.
 */
export async function assembleEligibilityBasis(input: {
  repositories: AnalysisRepositories
  caseId: string
  revisionId: string
  /**
   * The policy in force for THIS submission, selected by the caller.
   *
   * Required. No default, no fallback to v1, no "current policy" lookup: a
   * default here would be a second place the firm's line is drawn, and every
   * caller would inherit it without noticing.
   */
  policy: EligibilityPolicy
  /** Domain time, from the Clock. Never the database's. */
  now: string
}): Promise<AssembledBasis | null> {
  const { repositories, caseId, revisionId, policy, now } = input

  /*
   * Reuses the existing gatherer rather than re-reading the same six
   * repositories. A second traversal would be a second interpretation of what
   * "the reviews that apply to this revision" means.
   */
  const evaluated = await revisionEligibility(repositories, caseId, now, policy)
  const forRevision = evaluated.find((entry) => entry.revisionId === revisionId)
  if (!forRevision) return null

  const revision = await repositories.theses.get(revisionId)
  if (!revision) return null

  const [verifications, challenges, risks, runs, provenance] = await Promise.all([
    repositories.reviews.verificationsForCase(caseId),
    repositories.reviews.challengesForCase(caseId),
    repositories.reviews.riskForCase(caseId),
    repositories.runs.listForCase(caseId),
    repositories.provenance(),
  ])

  const { verificationReviewId, devilsAdvocateReviewId, riskReviewId } =
    forRevision.reviewsRead

  const verification =
    verifications.find((r) => r.reviewId === verificationReviewId) ?? null
  const devilsAdvocate =
    challenges.find((r) => r.reviewId === devilsAdvocateReviewId) ?? null
  const risk = risks.find((r) => r.reviewId === riskReviewId) ?? null

  const aggregation = revision.aggregationId
    ? await repositories.aggregations.get(revision.aggregationId)
    : null

  /*
   * The runs that satisfied required work, and the evidence they rested on.
   * Only runs belonging to this revision count: a run against an earlier
   * revision is not work done for this one.
   */
  const revisionRuns = runs.filter((run) => run.revisionId === revisionId)

  const basisContent = {
    revisionId,
    thesisId: forRevision.thesisId,
    aggregationId: revision.aggregationId ?? null,
    eligibilityPolicyVersion: policy.version,
    /*
     * Empty, always. A submission carrying a blocker is refused before it is
     * built, so a non-empty list here would mean the caller ignored the gate
     * report it was handed.
     */
    blockers: [],
    verification: verification
      ? {
          reviewId: verification.reviewId,
          sequence: verification.sequence,
          status: verification.status,
        }
      : null,
    devilsAdvocate: devilsAdvocate
      ? {
          reviewId: devilsAdvocate.reviewId,
          sequence: devilsAdvocate.sequence,
          /*
           * `unresolvedChallenges` is the domain's own answer to what remains
           * open. Filtering the list here would be a second definition of
           * "open", free to drift from the one the gate report consults.
           */
          openChallengeIds: unresolvedChallenges(devilsAdvocate).map(
            (challenge) => challenge.id,
          ),
        }
      : null,
    risk: risk
      ? { reviewId: risk.reviewId, sequence: risk.sequence, status: risk.status }
      : null,
    riskRequirement: forRevision.riskRequirement,
    riskRuleId: forRevision.riskRuleVersion === null ? null : RISK_RULE_ID,
    riskRuleVersion: forRevision.riskRuleVersion,
    requiredWork: revisionRuns.map((run) => ({
      playbookEntryKey: run.execution.playbookEntryKey,
      runId: run.id,
    })),
    /*
     * Materiality only. Whether any of these BLOCKS is the gate report's
     * answer, made under the policy above -- never a value carried here.
     */
    materialDisagreements: (aggregation?.dispositions ?? [])
      .filter((record) => record.materiality !== undefined)
      .map((record) => ({ claimId: record.claimId, materiality: record.materiality! })),
    evidenceSetIds: [
      ...new Set(revisionRuns.map((run) => run.evidenceSetId).filter(Boolean)),
    ],
    storageProvenanceId: provenance.provenanceId,
    evaluatedAt: forRevision.evaluatedAt,
  } satisfies Omit<EligibilityBasis, 'manifest'>

  return {
    basis: {
      ...basisContent,
      manifest: buildBasisManifest({ submissionId: revisionId, caseId }, basisContent),
    },
    gates: evaluateEligibilityGates(basisContent, policy),
  }
}

/** The conditional rule behind the Risk requirement. */
const RISK_RULE_ID = 'risk-review-when-implementable'
