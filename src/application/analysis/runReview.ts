/**
 * One run, assembled for the person who has to judge it.
 *
 * The read model behind the review surface — `caseOverview`'s shape applied to
 * a single contribution, and the first read path in the system that reaches
 * **produced** work at all. Until this existed, claims an agent had made and
 * nobody had accepted were durable, paid for, and unreadable outside a command.
 *
 * ## Produced work, not institutional work
 *
 * The claims here come from `repositories.producedClaims`, never from
 * `repositories.claims`. That is the whole distinction the acceptance boundary
 * exists to hold: the institutional table is what every citation in the firm
 * resolves against, and work awaiting a decision is deliberately not in it.
 *
 * The store keeps produced claims for as long as the run lives, so this reads
 * work in every state — awaiting a decision, accepted, and declined. A person
 * asking "what did I accept last week" and a person asking "what did we turn
 * down" are asking the same question of the same record.
 *
 * ## Citations are resolved, never re-derived
 *
 * Each claim cites observations by `EvidenceRef`. Resolving one against the
 * evidence set is `resolveCitation` — a domain function — and its three
 * outcomes are institutional findings rather than rendering details:
 *
 *   `resolved`    the observation is there and says what it said
 *   `revised`     it is there and the value MOVED after the claim cited it
 *   `unresolved`  the claim cites something the set does not contain
 *
 * A reviewer must see the last two. "The number changed under this claim" is
 * precisely the thing a person accepting work needs to know and cannot be
 * expected to notice, and it is exactly what the Fact Checker's primitive was
 * built to detect. Recomputing that comparison in a component would be a second
 * implementation of the revision rule.
 *
 * **Neither failure is reachable today, and resolving anyway is deliberate.**
 * `validateContribution` refuses an unresolved citation at recording, and an
 * evidence set is content-addressed and write-once, so a stored claim cannot
 * currently cite something missing or something that has since moved. What that
 * argues for is checking, not assuming: the cost is one comparison per
 * citation, and the alternative is a review surface whose correctness depends
 * on every future write path continuing to hold a property none of them state.
 *
 * ## It decides nothing
 *
 * Whether the work may still be judged is read from the run's own state machine
 * via `canTransitionRun`, not inferred from a status string here or in the UI.
 * Nothing in this module composes confidence, evaluates a gate, or decides
 * whether a claim is citable — those have one home each, and none of them is
 * this file.
 */

import {
  canTransitionRun,
  CONTRIBUTION_REJECTION_CODES,
  resolveCitation,
  type AgentClaim,
  type AgentRunRecord,
  type Assignment,
  type CitationResolution,
  type ContributionRejectionCode,
  type Department,
  type EvidenceSet,
  type InvestmentCase,
  type Organization,
  type RunState,
} from '~/domain/analysis'
import type { AnalysisRepositories } from './repositories'

/**
 * One citation, resolved against the evidence the run was given.
 *
 * `CitationResolution` plus the id that was cited — the domain type answers
 * *what happened*, and an unresolved citation has no item to name itself with,
 * so the reviewer would otherwise be told something is missing without being
 * told what.
 */
export type ReviewedCitation = CitationResolution & { observationId: string }

export interface ReviewedClaim {
  claim: AgentClaim
  /** The evidence the claim rests on, in the order it cited it. */
  supporting: readonly ReviewedCitation[]
  /** Evidence that cuts against it, which a claim may carry and rarely does. */
  contradicting: readonly ReviewedCitation[]
}

/**
 * Whether this work is still open to a decision.
 *
 * A union rather than a boolean, because "waiting for you" and "already
 * settled, here is what was decided" are different things to put in front of a
 * person, and a boolean would render both as an absent button.
 */
export type ReviewDecision =
  /** Awaiting a person. Accept and reject are both available. */
  | { kind: 'open' }
  /** The run has moved on. Nothing further is owed. */
  | { kind: 'settled'; state: RunState }

export interface RunReview {
  run: AgentRunRecord
  /** The desk that owes the work, and therefore the desk that may judge it. */
  department: Pick<Department, 'id' | 'name' | 'managerEmployeeId'>
  /** What the firm was asking. A claim is only judgeable against the question. */
  investmentCase: InvestmentCase
  /** What this desk specifically was asked for. Absent for ad-hoc work. */
  assignment: Assignment | null
  /** What it was given to reason over. */
  evidenceSet: EvidenceSet | null
  /** What it produced. Empty for a run that failed before producing anything. */
  produced: readonly ReviewedClaim[]
  decision: ReviewDecision
  /**
   * The reasons the firm accepts for declining work.
   *
   * Carried to the surface rather than imported by it. The vocabulary is
   * institutional — it is counted over years to ask which agents are declined,
   * why, and whether they improve — so the interface renders the codes the firm
   * defines instead of holding a second copy that could drift from them.
   */
  rejectionCodes: readonly ContributionRejectionCode[]
}

/**
 * Reads one run in full. `null` when there is no such run.
 *
 * Takes the read-side repositories and issues no command: judging the work is a
 * separate act, through the existing command path, initiated by a person.
 */
export async function runReview(input: {
  repositories: AnalysisRepositories
  organization: Organization
  runId: string
}): Promise<RunReview | null> {
  const { repositories, organization, runId } = input

  const run = await repositories.runs.get(runId)
  if (!run) return null

  const investmentCase = await repositories.cases.get(run.caseId)
  /*
   * A run whose case has gone is not a review a person can act on — the
   * accept and reject commands both refuse a missing case, so offering the
   * decision would be offering something the institution would decline.
   */
  if (!investmentCase) return null

  const department = organization.departments.find(
    (candidate) => candidate.id === run.departmentId,
  )
  if (!department) return null

  const [assignment, evidenceSet, produced] = await Promise.all([
    repositories.assignments.get(run.assignmentId),
    run.evidenceSetId ? repositories.evidence.get(run.evidenceSetId) : Promise.resolve(null),
    repositories.producedClaims.listForRun(run.id),
  ])

  return {
    run,
    department: {
      id: department.id,
      name: department.name,
      managerEmployeeId: department.managerEmployeeId,
    },
    investmentCase,
    assignment,
    evidenceSet,
    produced: produced.map((claim) => reviewClaim(claim, evidenceSet)),
    /*
     * Read from the state machine rather than compared against a literal. The
     * question "can this still be judged" has one answer, and it is the same
     * one `AcceptContribution` will apply when the command runs.
     */
    decision: canTransitionRun(run.state, 'completed')
      ? { kind: 'open' }
      : { kind: 'settled', state: run.state },
    rejectionCodes: CONTRIBUTION_REJECTION_CODES,
  }
}

/* --------------------------------------------------------------- assembly */

function reviewClaim(claim: AgentClaim, evidenceSet: EvidenceSet | null): ReviewedClaim {
  const resolve = (refs: AgentClaim['evidenceRefs']): ReviewedCitation[] =>
    refs.map((ref) => {
      /*
       * No evidence set to resolve against. Reported as unresolved rather than
       * skipped: a claim citing evidence nobody can produce is a finding, and
       * dropping the citation would present the claim as though it cited
       * nothing — which is a different and more flattering thing to be.
       */
      if (!evidenceSet) {
        return {
          status: 'unresolved' as const,
          reason: 'not-in-set' as const,
          observationId: ref.observationId,
        }
      }
      return { ...resolveCitation(evidenceSet, ref), observationId: ref.observationId }
    })

  return {
    claim,
    supporting: resolve(claim.evidenceRefs),
    contradicting: resolve(claim.contradictingEvidenceRefs),
  }
}
