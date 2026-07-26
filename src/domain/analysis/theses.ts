/**
 * Investment theses.
 *
 * A case is a QUESTION; a thesis is a proposed ANSWER. The organization does
 * not produce a report about Novo Nordisk — it evaluates competing positions on
 * Novo Nordisk and the CIO chooses one.
 *
 * That distinction is why theses are entities rather than a field. Buy, Hold
 * and Sell are not three variants of one conclusion, they are three arguments
 * that must each be evidenced, verified, risk-assessed and challenged
 * independently. Departments may support different theses; the Devil's
 * Advocate may propose one deliberately to contest the leading view; and the
 * CIO receives them side by side rather than receiving a single view whose
 * alternatives were discarded upstream.
 *
 * The alternative — one recommendation per case, with dissent recorded as
 * commentary — loses the thing that makes the process institutional: the
 * losing arguments and their evidence survive the decision.
 */

import type { CaseId } from './cases'
import type { ClaimId } from './claims'
import type { DepartmentId, EmployeeId } from './organization'

export type ThesisId = string

/**
 * The position argued for.
 *
 * An open string, not an enum, for the same reason department disciplines are:
 * an equity case takes buy / hold / sell, but a macro case takes "the ECB cuts
 * before Q2" against "the ECB holds through the year", and a credit case takes
 * something else again. `EQUITY_POSITIONS` is a convenience for the common
 * case, not a constraint on the model.
 */
export type ThesisPosition = string

export const EQUITY_POSITIONS = [
  'buy',
  'accumulate',
  'hold',
  'reduce',
  'sell',
  'avoid',
] as const

export type ThesisStatus =
  /** Put forward, not yet examined. */
  | 'proposed'
  | 'under-review'
  /** A governance department has open objections against it. */
  | 'challenged'
  /** Cleared governance. Eligible to reach the CIO. */
  | 'cleared'
  /** Failed governance, or abandoned by the department that proposed it. */
  | 'rejected'
  /** The CIO chose it. At most one per case. */
  | 'selected'
  /** Reached the CIO and was not chosen. Retained with its evidence. */
  | 'not-selected'

export interface InvestmentThesis {
  id: ThesisId
  caseId: CaseId
  /** The argument, in one sentence. */
  statement: string
  position: ThesisPosition
  proposedByDepartmentId: DepartmentId
  proposedByEmployeeId: EmployeeId
  proposedAt: string

  /** Claims arguing for it. */
  supportingClaimIds: readonly ClaimId[]
  /**
   * Claims arguing against it, held ON the thesis rather than filed elsewhere.
   *
   * A thesis that lists only its supporting evidence is a pitch. Keeping the
   * opposing claims attached is what lets the CIO see the strength of a
   * position rather than the enthusiasm of the desk that proposed it.
   */
  opposingClaimIds: readonly ClaimId[]

  status: ThesisStatus
  /**
   * What would have to happen for this thesis to be wrong.
   *
   * Required. The behavioural specification asks every material conclusion to
   * answer "what could invalidate it?", and a thesis that cannot be falsified
   * is not a thesis — it is a preference.
   */
  invalidationCriteria: string
  /** Required for a directional position: over what period it is expected to play out. */
  horizon?: string
}

export function buildThesis(thesis: InvestmentThesis): InvestmentThesis {
  if (!thesis.invalidationCriteria.trim()) {
    throw new Error(
      `Thesis "${thesis.id}" states no invalidation criteria. A thesis that ` +
        `cannot be wrong is a preference, not an investment case.`,
    )
  }
  if (thesis.status === 'cleared' && thesis.supportingClaimIds.length === 0) {
    throw new Error(
      `Thesis "${thesis.id}" cannot clear governance with no supporting claims`,
    )
  }
  return Object.freeze({
    ...thesis,
    supportingClaimIds: Object.freeze([...thesis.supportingClaimIds]),
    opposingClaimIds: Object.freeze([...thesis.opposingClaimIds]),
  })
}

/** Theses eligible to reach the CIO. */
export function clearedTheses(theses: readonly InvestmentThesis[]): InvestmentThesis[] {
  return theses.filter((t) => t.status === 'cleared')
}

/**
 * True when a case holds genuinely competing positions.
 *
 * Worth surfacing on the headquarters floor: a case where the desks disagree is
 * more interesting than one where they do not, and it is what the Devil's
 * Advocate exists to produce.
 */
export function hasCompetingTheses(theses: readonly InvestmentThesis[]): boolean {
  const live = theses.filter(
    (t) => t.status !== 'rejected' && t.status !== 'not-selected',
  )
  return new Set(live.map((t) => t.position)).size > 1
}

/* ------------------------------------------------------------------ decision */

/**
 * The CIO's decision on a case.
 *
 * Records what was chosen, what was not, and why — including the theses that
 * lost. The dissent is part of the record: an institution that forgets which
 * arguments it rejected cannot learn when they turn out to have been right.
 */
export interface CaseDecision {
  caseId: CaseId
  decidedAt: string
  decidedByEmployeeId: EmployeeId
  /** The institutional position. `null` when the CIO declined to take one. */
  selectedThesisId: ThesisId | null
  /** Every thesis that reached the CIO and was not chosen. */
  notSelectedThesisIds: readonly ThesisId[]
  rationale: string
  /** Objections the CIO acknowledged but decided against. Never dropped. */
  acknowledgedDissent: readonly string[]
  /** Conditions attached — position limits, review triggers, staged entry. */
  conditions?: readonly string[]
}

export function buildDecision(
  decision: CaseDecision,
  theses: readonly InvestmentThesis[],
): CaseDecision {
  const byId = new Map(theses.map((t) => [t.id, t]))

  if (decision.selectedThesisId) {
    const selected = byId.get(decision.selectedThesisId)
    if (!selected) {
      throw new Error(`Decision on "${decision.caseId}" selects an unknown thesis`)
    }
    if (selected.status !== 'cleared' && selected.status !== 'selected') {
      throw new Error(
        `Thesis "${selected.id}" has not cleared governance and cannot be selected`,
      )
    }
  }
  if (!decision.rationale.trim()) {
    throw new Error(`Decision on "${decision.caseId}" records no rationale`)
  }
  return Object.freeze({
    ...decision,
    notSelectedThesisIds: Object.freeze([...decision.notSelectedThesisIds]),
    acknowledgedDissent: Object.freeze([...decision.acknowledgedDissent]),
  })
}
