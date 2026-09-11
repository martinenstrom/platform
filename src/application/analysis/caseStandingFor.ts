/**
 * One answer to "where does this case stand", for every reader.
 *
 * The Headquarters list and the case page both have to say where a case is,
 * whose desk it is on, and what happens next. If they derived that separately
 * they would eventually disagree — a queue showing a case with Risk while the
 * case itself shows it with the CIO is not a display bug, it is the firm
 * holding two beliefs about its own work.
 *
 * So this is the single derivation. `caseOverview` uses it; `caseListing` uses
 * it; anything that later needs standing uses it rather than assembling a
 * cheaper approximation.
 *
 * ## Why it is not cheaper for the list
 *
 * A lighter version for the list is exactly how the two answers would part
 * company: the shortcuts would be invisible until a case sat in a state the
 * shortcut got wrong. The cost is real and is recorded as TD-71 rather than
 * paid for with a second definition.
 *
 * The rule that governs any future optimisation here:
 *
 *   **Performance improvements may change how institutional state is OBTAINED,
 *   but never how institutional state is DERIVED.**
 *
 * Batch the reads, cache them, run them in parallel, index them — all of that
 * changes how the facts arrive and is welcome. A second derivation for a
 * particular caller is not, at any speed.
 */

import {
  applicablePeerExaminations,
  caseStanding,
  eligibilityPolicy,
  UnknownEligibilityPolicyError,
  type Assignment,
  type CaseStanding,
  type CioSubmission,
  type InvestmentCase,
  type InvestmentThesis,
  type ManagerAggregation,
  type Organization,
  type PeerExaminationReview,
  type PeerScrutinyStanding,
} from '~/domain/analysis'
import type { AnalysisRepositories } from './repositories'
import { revisionEligibility } from './eligibility'

export interface StandingFacts {
  investmentCase: InvestmentCase
  revisions: readonly InvestmentThesis[]
  submissions: readonly CioSubmission[]
  hasAggregation: boolean
  hasVerification: boolean
  hasDevilsAdvocate: boolean
  hasRisk: boolean
  hasDecision: boolean
  /**
   * The work the case was actually assigned, and the examinations it received.
   *
   * Both are needed because they answer different halves of one question:
   * whether this case OWES a peer examination, and whether it has HAD one.
   */
  assignments: readonly Assignment[]
  peerExaminations: readonly PeerExaminationReview[]
  /** Every aggregation the case holds. The current revision's names the owner. */
  aggregations: readonly ManagerAggregation[]
}

/**
 * Whether the case owes peer scrutiny, and whether it has received it.
 *
 * **Applicability comes from the instantiated workflow, not from a policy.**
 * A case running a playbook that assigned a peer examination owes one; a case
 * running one that did not, does not. Reading an eligibility policy here would
 * be standing answering eligibility's question — and for an unsubmitted case
 * no policy has been chosen yet, so any answer would be a guess dressed as a
 * fact.
 *
 * **Completeness uses the domain's own reading** of which examinations stand
 * for the current revision. Not "some peer review exists somewhere": an
 * examination of a superseded revision is not scrutiny of this one.
 */
function peerScrutinyFor(
  facts: StandingFacts,
  currentRevisionId: string | null,
): PeerScrutinyStanding {
  const assigned = facts.assignments.some(
    (assignment) => assignment.playbookEntryKey === PEER_EXAMINATION_ENTRY,
  )
  if (!assigned) return { applicability: 'not-applicable' }
  if (!currentRevisionId) return { applicability: 'required', complete: false }

  const standing = applicablePeerExaminations(
    facts.peerExaminations,
    facts.investmentCase.id,
    currentRevisionId,
  )
  /*
   * Complete once a qualifying examination exists — whatever it found. An
   * examination that raised a material objection has still been performed, and
   * whether that objection blocks is the challenge gate's answer.
   */
  return { applicability: 'required', complete: standing.length > 0 }
}

/** The playbook entry a peer examination is performed under. */
const PEER_EXAMINATION_ENTRY = 'peer-examination'

/**
 * Derives standing from facts already read.
 *
 * Takes the records rather than fetching them, so a caller that has already
 * loaded a case in full does not load it twice.
 */
export async function standingFrom(input: {
  repositories: AnalysisRepositories
  organization: Organization
  facts: StandingFacts
  /** Domain time, from the Clock. Never the database's. */
  now: string
}): Promise<CaseStanding> {
  const { repositories, organization, facts, now } = input
  const current = facts.revisions[facts.revisions.length - 1] ?? null

  /*
   * Blockers and the risk requirement come from the existing evaluator, never
   * re-derived here. A second reading of "what is stopping this" would be a
   * second answer, free to disagree with the one the workflow acts on.
   *
   * The policy is the one the pending submission names. Where nothing is
   * submitted the standing is about work still to do rather than about a
   * verdict, and v1 is used only to read the risk requirement and blockers —
   * not to judge eligibility, which `caseOverview` reports separately and
   * strictly from the stored basis.
   */
  const pending = facts.submissions.find((entry) => entry.state === 'pending')
  const policyVersion = pending?.basis.eligibilityPolicyVersion ?? '1'

  let evaluated: Awaited<ReturnType<typeof revisionEligibility>> = []
  try {
    evaluated = await revisionEligibility(
      repositories,
      facts.investmentCase.id,
      now,
      eligibilityPolicy(policyVersion),
    )
  } catch (error) {
    /*
     * A basis naming a policy this build cannot resolve must not take the
     * whole page down. The standing is reported without blockers and the
     * eligibility panel says the policy is unreadable, which is the honest
     * pair of statements.
     */
    if (!(error instanceof UnknownEligibilityPolicyError)) throw error
  }

  const forCurrent = current
    ? evaluated.find((entry) => entry.revisionId === current.revisionId)
    : undefined

  return caseStanding({
    investmentCase: facts.investmentCase,
    organization,
    hasThesis: facts.revisions.length > 0,
    hasAggregation: facts.hasAggregation,
    hasVerification: facts.hasVerification,
    hasDevilsAdvocate: facts.hasDevilsAdvocate,
    hasRisk: facts.hasRisk,
    riskRequirement: forCurrent?.riskRequirement ?? 'unresolved',
    peerScrutiny: peerScrutinyFor(facts, current?.revisionId ?? null),
    /*
     * The desk that produced the current revision. `submitForCioDecision` is
     * called with the department that synthesised the work, so the standing
     * names the same actor the command expects rather than an array position.
     */
    submittingDepartmentId:
      facts.aggregations.find(
        (aggregation) => aggregation.producedRevisionId === current?.revisionId,
      )?.departmentId ?? null,
    hasSubmission: facts.submissions.length > 0,
    hasDecision: facts.hasDecision,
    blockers: forCurrent?.eligibility.blockedBy ?? [],
  })
}

/** Reads what standing needs for one case, then derives it. */
export async function standingForCase(input: {
  repositories: AnalysisRepositories
  organization: Organization
  investmentCase: InvestmentCase
  now: string
}): Promise<CaseStanding> {
  const { repositories, organization, investmentCase, now } = input
  const caseId = investmentCase.id

  const [
    revisions,
    verification,
    devilsAdvocate,
    peerExaminations,
    risk,
    decision,
    assignments,
  ] = await Promise.all([
    repositories.theses.listForCase(caseId),
    repositories.reviews.verificationsForCase(caseId),
    repositories.reviews.challengesForCase(caseId),
    repositories.reviews.peerExaminationsForCase(caseId),
    repositories.reviews.riskForCase(caseId),
    repositories.decisions.getForCase(caseId),
    repositories.assignments.listForCase(caseId),
  ])

  /* The aggregation that produced each revision names the desk that owns it. */
  const aggregations: ManagerAggregation[] = []
  for (const revision of revisions) {
    if (!revision.aggregationId) continue
    const found = await repositories.aggregations.get(revision.aggregationId)
    if (found) aggregations.push(found)
  }

  const submissions: CioSubmission[] = []
  for (const revision of revisions) {
    submissions.push(
      ...(await repositories.submissions.applicableForRevision(revision.revisionId)),
    )
  }

  return standingFrom({
    repositories,
    organization,
    now,
    facts: {
      investmentCase,
      revisions,
      submissions,
      hasAggregation: revisions.some((revision) => revision.aggregationId),
      hasVerification: verification.length > 0,
      hasDevilsAdvocate: devilsAdvocate.length > 0,
      hasRisk: risk.length > 0,
      hasDecision: decision !== null,
      assignments,
      peerExaminations,
      aggregations,
    },
  })
}
