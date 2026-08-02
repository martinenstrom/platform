/**
 * The institutional decision record.
 *
 * What the organization chose, what it rejected, why, and what remained
 * unresolved when it decided. The losing arguments are part of the record —
 * an institution that forgets which theses it rejected cannot later discover
 * that a rejected one was right.
 *
 * This is an **analytical** record. It states a position; it does not place a
 * trade, size a position or instruct execution.
 */

import type { CaseId } from './cases'
import type { RevisionId } from './theses'
import type { EmployeeId } from './organization'
import type { ComplianceStatus, DevilsAdvocateReview, VerificationStatus } from './review'

/** Governance state as it stood at the moment of decision. */
export interface DecisionGovernanceSnapshot {
  verification: VerificationStatus
  /** Open challenges at decision time. Zero is a fact worth recording too. */
  unresolvedChallengeCount: number
  compliance: ComplianceStatus | 'not-required'
  risk: 'accepted' | 'accepted-with-limits' | 'rejected' | 'not-required'
}

export interface CaseDecision {
  caseId: CaseId
  /** The case version this was decided against. Pins the decision in time. */
  aggregateVersion: number
  decidedAt: string
  decidedByEmployeeId: EmployeeId

  /**
   * The exact revision selected — never a bare `thesisId`.
   *
   * With several revisions in a lineage, "we chose the Buy thesis" is
   * ambiguous: revision 1 and revision 3 may rest on different assumptions.
   * `null` when the CIO declined to take a position.
   */
  selectedRevisionId: RevisionId | null
  /** Eligible alternatives that reached the CIO and were not chosen. */
  notSelectedRevisionIds: readonly RevisionId[]
  /** Revisions a gate stopped before they could be considered. */
  rejectedRevisionIds: readonly RevisionId[]

  /** The evidence the decision was made against. */
  evidenceSetId: string
  governance: DecisionGovernanceSnapshot
  rationale: string
  /** Objections acknowledged and decided against. Never dropped. */
  unresolvedDissent: readonly string[]
  /**
   * What would cause the firm to look at this again.
   *
   * The field that makes the record useful months later, when someone asks
   * whether the conditions that would have changed the answer have occurred.
   */
  reconsiderationTriggers: readonly string[]
}

/** Everything a decision needs to be checked against. */
export interface DecisionContext {
  /** Eligibility for every revision that was in play. */
  eligibility: ReadonlyArray<{
    revisionId: RevisionId
    lifecycle: string
    eligibleForDecision: boolean
    /**
     * Structurally typed on `kind` alone, so this stays readable against
     * `ThesisEligibility` without importing the whole blocker union. A
     * decision refusal names the kinds; how they read is presentation's
     * problem, which is why there is no longer a `detail` sentence to quote.
     */
    blockedBy: ReadonlyArray<{ kind: string }>
  }>
  devilsAdvocate?: DevilsAdvocateReview
}

/**
 * Builds a decision, refusing every case the amendment named.
 *
 * The refusals are the point. A decision record whose selected thesis was
 * superseded, unverified or blocked is worse than no record, because it looks
 * like due process was followed.
 */
export function buildDecision(
  decision: CaseDecision,
  context: DecisionContext,
): CaseDecision {
  if (!decision.rationale.trim()) {
    throw new Error(`Decision on "${decision.caseId}" records no rationale`)
  }
  if (!decision.evidenceSetId) {
    throw new Error(
      `Decision on "${decision.caseId}" cites no evidence set — a decision ` +
        `whose evidence cannot be located cannot be reviewed`,
    )
  }

  if (decision.selectedRevisionId) {
    const selected = context.eligibility.find(
      (e) => e.revisionId === decision.selectedRevisionId,
    )
    if (!selected) {
      throw new Error(
        `Decision on "${decision.caseId}" selects a revision that was not in play`,
      )
    }
    if (selected.lifecycle === 'superseded') {
      throw new Error(
        `Revision "${selected.revisionId}" was superseded and cannot be selected. ` +
          `Select the current revision of that thesis.`,
      )
    }
    if (!selected.eligibleForDecision) {
      const reasons = selected.blockedBy.map((b) => b.kind).join(', ')
      throw new Error(
        `Revision "${selected.revisionId}" is not eligible for decision` +
          (reasons ? `: ${reasons}` : ' — it has not been verified'),
      )
    }
  }

  return Object.freeze({
    ...decision,
    notSelectedRevisionIds: Object.freeze([...decision.notSelectedRevisionIds]),
    rejectedRevisionIds: Object.freeze([...decision.rejectedRevisionIds]),
    unresolvedDissent: Object.freeze([...decision.unresolvedDissent]),
    reconsiderationTriggers: Object.freeze([...decision.reconsiderationTriggers]),
  })
}
