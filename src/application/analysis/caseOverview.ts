/**
 * One case, as the institution holding it.
 *
 * The Headquarters read model. It answers where the case stands *before* it
 * answers what the case contains, because somebody opening a case needs to know
 * whose desk it is on and what happens next before they need a claim.
 *
 * ## The eligibility rule, which is the whole reason this is not a projection
 *
 * A case decided in March was judged under March's policy. This shows **the
 * basis as stored, under the policy version the basis names** — never today's.
 * Re-judging an old decision under a new rule would put a verdict on the screen
 * that the firm never reached.
 *
 * "What would we conclude now?" is a legitimate and different question. It is
 * not answered here, and must never be rendered beside this one as though the
 * two were the same number.
 *
 * A case with no submission has **no recorded eligibility**, and says so.
 * Falling back to evaluating current facts under some default would be a
 * default policy arriving by the back door.
 *
 * ## Assembled, never stored
 *
 * No summary row, no cache. Standing and eligibility are readings of records
 * that already exist, and a stored copy would be a second answer free to
 * disagree with them.
 */

import {
  evaluateEligibilityGates,
  eligibilityPolicy,
  UnknownEligibilityPolicyError,
  type AgentClaim,
  type AgentRunRecord,
  type Assignment,
  type CaseDecision,
  type CaseStanding,
  type CaseReconsideration,
  type CioReturn,
  type CioSubmission,
  type DevilsAdvocateReview,
  type PeerExaminationReview,
  type EligibilityGateReport,
  type EvidenceSet,
  type InvestmentCase,
  type InvestmentThesis,
  type ManagerAggregation,
  type Organization,
  type RiskReview,
  type TransitionEvent,
  type VerificationReview,
} from '~/domain/analysis'
import type { AnalysisRepositories } from './repositories'
import { standingFrom } from './caseStandingFor'

/**
 * What the firm concluded at submission, and under which policy.
 *
 * A union rather than a nullable report: "no submission yet" and "submitted and
 * every gate passed" are opposite institutional facts, and a null would render
 * as the same blank in both cases.
 */
export type RecordedEligibility =
  | { kind: 'not-submitted' }
  | {
      kind: 'recorded'
      /** The version named by the basis, resolved from it. Never the current one. */
      policyVersion: string
      report: EligibilityGateReport
    }
  /**
   * The basis names a policy version this build cannot resolve.
   *
   * Reported rather than substituted. Showing the case under some other policy
   * would be a fabricated verdict, and showing nothing would hide that the
   * record refers to a rule the system has lost.
   */
  | { kind: 'policy-unresolvable'; policyVersion: string }

export interface CaseOverview {
  /** The six answers, first because they are what a reader needs first. */
  standing: CaseStanding
  investmentCase: InvestmentCase
  revisions: readonly InvestmentThesis[]
  aggregations: readonly ManagerAggregation[]
  claims: readonly AgentClaim[]
  runs: readonly AgentRunRecord[]
  evidenceSets: readonly EvidenceSet[]
  verification: readonly VerificationReview[]
  devilsAdvocate: readonly DevilsAdvocateReview[]
  /**
   * Peer examinations, whole and unsummarised.
   *
   * Kept apart from `devilsAdvocate` for the reason the repository keeps them
   * apart: one is a control function's standing obligation to object, the
   * other a qualified desk's second reading of the subject, and a reader who
   * cannot tell them apart cannot tell whether the firm was disagreed with.
   *
   * The REVIEWS, not a Boardroom-shaped summary of them. A projection that
   * received only what a screen currently draws would lose the provenance the
   * next screen needs, and the reader would have no way back to the act.
   */
  peerExaminations: readonly PeerExaminationReview[]
  /**
   * The desks this case involves, named as the organisation names them.
   *
   * A surface showing who said what has to be able to write "Rates" rather
   * than `rates`. Taken from the seeded organisation rather than a lookup
   * table in the presentation layer, which would be a second place a desk's
   * name is decided and would drift the first time one was renamed.
   *
   * Only the departments the case actually involves — a roster of the whole
   * firm would describe the org chart rather than this case.
   */
  departments: readonly { id: string; name: string; isGovernance: boolean }[]
  /**
   * Every desk the firm has, whether or not this case involved it.
   *
   * ORGANISATIONAL data only. The Boardroom seats the firm around a table, and
   * a seat is a position the organisation holds — never evidence that its
   * occupant did anything here. What a desk actually did comes from
   * `departments` above and from the persisted acts, and nothing may infer
   * participation from membership of this list.
   */
  roster: readonly {
    id: string
    name: string
    isGovernance: boolean
    /**
     * The title of the employee who heads the desk, as the organisation names
     * them — never a label written here.
     *
     * Carried because a department name is not always how the firm refers to a
     * position: the executive desk is "Executive" on the org chart and the
     * Chief Investment Officer in every sentence anyone speaks. `null` when the
     * organisation names no manager for it.
     */
    managerTitle: string | null
  }[]
  /**
   * The work this case allocated, as the playbook instantiated it.
   *
   * Distinct from what was DONE. A desk with an assignment and no act is a desk
   * the firm asked and has not heard from — which the room must be able to show
   * without implying it contributed.
   */
  assignments: readonly Assignment[]
  risk: readonly RiskReview[]
  submissions: readonly CioSubmission[]
  returns: readonly CioReturn[]
  /** The live decision — the one not superseded. */
  decision: CaseDecision | null
  /** Every decision, oldest first: a correction never erases its predecessor. */
  decisionHistory: readonly CaseDecision[]
  /**
   * Every reopening, oldest first.
   *
   * Beside the decisions rather than folded into them: a reopening is an act in
   * its own right, and the reader has to be able to see the deferral, the thing
   * that ended it, and the decision that followed as three separate moments in
   * one history.
   */
  reconsiderations: readonly CaseReconsideration[]
  timeline: readonly TransitionEvent[]
  eligibility: RecordedEligibility
}

/**
 * Reads one case in full. `null` when there is no such case.
 *
 * Takes the read-side repositories: this issues no command, writes nothing, and
 * must stay that way — Headquarters is where the firm is inspected, not
 * operated.
 */
export async function caseOverview(input: {
  repositories: AnalysisRepositories
  organization: Organization
  caseId: string
  /** Domain time, from the Clock. Never the database's. */
  now: string
}): Promise<CaseOverview | null> {
  const { repositories, organization, caseId, now } = input

  const investmentCase = await repositories.cases.get(caseId)
  if (!investmentCase) return null

  const [
    revisions,
    claims,
    runs,
    verification,
    devilsAdvocate,
    peerExaminations,
    risk,
    assignments,
    timeline,
    returns,
    reconsiderations,
  ] = await Promise.all([
    repositories.theses.listForCase(caseId),
    repositories.claims.listForCase(caseId),
    repositories.runs.listForCase(caseId),
    repositories.reviews.verificationsForCase(caseId),
    repositories.reviews.challengesForCase(caseId),
    repositories.reviews.peerExaminationsForCase(caseId),
    repositories.reviews.riskForCase(caseId),
    /* Standing needs the work the case was ASSIGNED, to know what it owes. */
    repositories.assignments.listForCase(caseId),
    repositories.events.listForCase(caseId),
    repositories.submissions.returnsForCase(caseId),
    repositories.submissions.reconsiderationsForCase(caseId),
  ])

  const aggregations: ManagerAggregation[] = []
  for (const revision of revisions) {
    if (!revision.aggregationId) continue
    const found = await repositories.aggregations.get(revision.aggregationId)
    if (found) aggregations.push(found)
  }

  const evidenceSets: EvidenceSet[] = []
  for (const setId of new Set(runs.map((run) => run.evidenceSetId).filter(Boolean))) {
    const found = await repositories.evidence.get(setId)
    if (found) evidenceSets.push(found)
  }

  /*
   * Submissions are per revision, so the case's are gathered from its
   * revisions rather than from a case-wide query that does not exist.
   */
  const submissions: CioSubmission[] = []
  for (const revision of revisions) {
    submissions.push(
      ...(await repositories.submissions.applicableForRevision(revision.revisionId)),
    )
  }

  /** Named once, from the organisation, for every desk the case touched. */
  const involvedDepartments = () => {
    const involved = new Set<string>([
      ...runs.map((run) => run.departmentId),
      ...aggregations.map((aggregation) => aggregation.departmentId),
      ...verification.map((review) => review.byDepartmentId),
      ...devilsAdvocate.map((review) => review.byDepartmentId),
      ...peerExaminations.flatMap((review) => [
        review.byDepartmentId,
        review.examinedDepartmentId,
      ]),
      ...risk.map((review) => review.byDepartmentId),
    ])
    return organization.departments
      .filter((department) => involved.has(department.id))
      .map((department) => ({
        id: department.id,
        name: department.name,
        isGovernance: department.isGovernance,
      }))
  }

  const [decision, decisionHistory] = await Promise.all([
    repositories.decisions.getForCase(caseId),
    repositories.decisions.historyForCase(caseId),
  ])

  /*
   * The current revision is the one governance and the CIO are reading. Where
   * several exist, the latest is the live argument -- the same rule the gate
   * applies when it selects reviews.
   */
  const current = revisions[revisions.length - 1] ?? null

  return {
    /*
     * The SAME derivation the Headquarters list uses, given the records this
     * function has already read so nothing is fetched twice. Two paths to
     * standing would be two answers to where the case is.
     */
    standing: await standingFrom({
      repositories,
      organization,
      now,
      facts: {
        investmentCase,
        revisions,
        submissions,
        hasAggregation: aggregations.length > 0,
        hasVerification: verification.length > 0,
        hasDevilsAdvocate: devilsAdvocate.length > 0,
        hasRisk: risk.length > 0,
        hasDecision: decision !== null,
        assignments,
        peerExaminations,
        aggregations,
      },
    }),
    investmentCase,
    revisions,
    aggregations,
    claims,
    runs,
    evidenceSets,
    verification,
    devilsAdvocate,
    peerExaminations,
    departments: involvedDepartments(),
    assignments,
    roster: organization.departments.map((department) => ({
      id: department.id,
      name: department.name,
      isGovernance: department.isGovernance,
      /*
       * Resolved the same way the agent directory resolves it. `null` rather
       * than a substitute when the organisation names nobody: a desk shown
       * with an invented head would be exactly the fiction this replaces.
       */
      managerTitle:
        organization.employees.find(
          (employee) => employee.id === department.managerEmployeeId,
        )?.displayName ?? null,
    })),
    risk,
    submissions,
    returns,
    decision,
    decisionHistory,
    reconsiderations,
    timeline,
    eligibility: recordedEligibility(submissions, current),
  }
}

/**
 * The verdict the firm recorded, under the policy it recorded it against.
 *
 * The pending submission where one exists, otherwise the most recent — a
 * decided case still has to explain what it was decided on.
 */
function recordedEligibility(
  submissions: readonly CioSubmission[],
  current: InvestmentThesis | null,
): RecordedEligibility {
  const forCurrent = current
    ? submissions.filter((entry) => entry.revisionId === current.revisionId)
    : submissions
  const subject =
    forCurrent.find((entry) => entry.state === 'pending') ??
    [...forCurrent].sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))[0]

  if (!subject) return { kind: 'not-submitted' }

  const version = subject.basis.eligibilityPolicyVersion
  try {
    /*
     * Resolved FROM THE BASIS. Not the current policy, not a default: this
     * decision was made under a named rule and is read back under the same one.
     */
    const policy = eligibilityPolicy(version)
    return {
      kind: 'recorded',
      policyVersion: version,
      report: evaluateEligibilityGates(subject.basis, policy),
    }
  } catch (error) {
    if (error instanceof UnknownEligibilityPolicyError) {
      return { kind: 'policy-unresolvable', policyVersion: version }
    }
    throw error
  }
}
