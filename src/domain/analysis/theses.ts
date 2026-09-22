/**
 * Investment theses, and their revisions.
 *
 * A case is a QUESTION; a thesis is a proposed ANSWER. The organization does
 * not produce a report about Novo Nordisk — it evaluates competing positions
 * and the CIO chooses one. Buy, Hold and Sell are three arguments, each
 * evidenced, verified, risk-assessed and challenged independently.
 *
 * ## Revisions
 *
 * The concrete entity is a **revision**. `thesisId` is the lineage key, shared
 * by every version; `revisionId` identifies one version. So:
 *
 *   competing thesis  -> a different `thesisId`
 *   revised thesis    -> the same `thesisId`, a new `revisionId`
 *
 * A sealed revision is never edited. New evidence arrives, an assumption
 * changes, and revision *n+1* is minted with `supersedesRevisionId` pointing
 * back — leaving *n* permanently auditable with the reviews and claims that
 * were attached to it, exactly as they were.
 *
 * That last point is the reason for the whole design. A review reviewed a
 * specific argument; if the argument can be edited afterwards, the review no
 * longer means anything.
 */

import type { CaseId } from './cases'
import type { ClaimId } from './claims'
import { isSealed, type ThesisLifecycleState } from './lifecycle'
import type { DepartmentId, EmployeeId } from './organization'
import { utf8ByteOrder } from '~/domain/shared/canonicalValue'

export type ThesisId = string
export type RevisionId = string

/**
 * The position argued for.
 *
 * An open string, for the same reason department disciplines are open: equity
 * takes buy / hold / sell, macro takes "the ECB cuts before Q2" against "the
 * ECB holds", credit takes something else. `EQUITY_POSITIONS` is a convenience,
 * not a constraint.
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

/**
 * What a thesis would mean if the firm acted on it.
 *
 * Declared as **structured flags rather than inferred from the statement**, and
 * that choice is the whole point of the type. Whether Risk Review is required
 * turns on this, and a rule that scanned the prose for words like "hedge"
 * would be a rule whose outcome depended on how a sentence happened to be
 * phrased — non-deterministic in practice and impossible to audit years later.
 *
 * The list is closed, so a new kind of implication is a deliberate contract
 * change rather than a new adjective in someone's paragraph.
 */
export type InvestmentImplication =
  /** An explicit recommendation to act. */
  | 'actionable-recommendation'
  /** Changes what the firm should hold, and in what proportion. */
  | 'asset-allocation'
  | 'position-sizing'
  | 'hedging'
  | 'leverage'
  /** Entering or exiting would move the market the firm trades in. */
  | 'liquidity-impact'
  /** Changes the risk profile of the portfolio as a whole. */
  | 'portfolio-risk'
  /** Any other decision that could later lead to implementation. */
  | 'implementation-path'

export const INVESTMENT_IMPLICATIONS: readonly InvestmentImplication[] = [
  'actionable-recommendation',
  'asset-allocation',
  'position-sizing',
  'hedging',
  'leverage',
  'liquidity-impact',
  'portfolio-risk',
  'implementation-path',
] as const

/**
 * Why a revision exists, as a bounded category beside the free-text reason.
 *
 * The prose says what happened; the cause makes "how often does governance
 * send a thesis back" answerable without reading paragraphs.
 * `manager-aggregation` is reserved to `AggregateManagerConclusion`, so no
 * other command can file itself as a managerial synthesis.
 */
export type RevisionCause =
  | 'initial-proposal'
  | 'manager-aggregation'
  | 'new-evidence'
  | 'correction'
  | 'governance-finding'
  | 'changed-assumption'
  | 'resolved-challenge'
  | 'changed-implications'
  | 'revised-invalidation-criteria'

export const REVISION_CAUSES: readonly RevisionCause[] = [
  'initial-proposal',
  'manager-aggregation',
  'new-evidence',
  'correction',
  'governance-finding',
  'changed-assumption',
  'resolved-challenge',
  'changed-implications',
  'revised-invalidation-criteria',
] as const

export interface InvestmentThesis {
  /** Lineage. Stable across every revision of this argument. */
  thesisId: ThesisId
  /** This specific version. */
  revisionId: RevisionId
  /** Monotonic within the lineage, starting at 1. */
  revisionNumber: number
  /** The version this replaced. Absent on revision 1. */
  supersedesRevisionId?: RevisionId
  revisedAt?: string
  /** Why it was revised. Required on any revision after the first. */
  revisionReason?: string
  /** The bounded category beside the reason. Present on every revision. */
  revisionCause: RevisionCause

  caseId: CaseId
  statement: string
  position: ThesisPosition
  proposedByDepartmentId: DepartmentId
  /**
   * The accountable principal that proposed it.
   *
   * Exactly one of these two, enforced by the database since migration 0040. A
   * revision an autonomous desk proposed is that desk's act, and naming a human
   * here would attribute a position to somebody who never read it.
   */
  proposedByEmployeeId?: EmployeeId
  /** The institutional agent that proposed it, where one did. */
  proposedByAgentPrincipalId?: string
  proposedAt: string

  supportingClaimIds: readonly ClaimId[]
  /**
   * Claims arguing against it, held ON the thesis rather than filed elsewhere.
   *
   * A thesis listing only supporting evidence is a pitch. Keeping the opposing
   * claims attached lets the CIO judge the strength of a position rather than
   * the enthusiasm of the desk proposing it.
   */
  opposingClaimIds: readonly ClaimId[]
  /** Anything citing this exact revision. Contributes to sealing. */
  citedByClaimIds: readonly ClaimId[]

  /**
   * The managerial synthesis that produced this revision, where one did.
   *
   * A reference rather than the record: the revision is the firm's position and
   * has to read as one. How the manager got there — which contributions were in
   * scope, what happened to every claim, what was missing — is one hop away in
   * `ManagerAggregation`, so the conclusion stays distinguishable from its
   * construction history.
   */
  aggregationId?: string

  lifecycle: ThesisLifecycleState
  /**
   * What would have to happen for this thesis to be wrong.
   *
   * Required. A thesis that cannot be falsified is a preference.
   */
  invalidationCriteria: string
  horizon?: string
  /**
   * What acting on this thesis would imply.
   *
   * **Required, and empty is a declaration rather than a default.** Purely
   * descriptive analysis — "the ECB holds through Q2" with nothing the firm is
   * asked to do about it — carries an empty list, and that empty list is what
   * a conditional Risk Review resolves `not-required` against. An optional
   * field would let the absence of thought look identical to the presence of a
   * decision, which is exactly the ambiguity Risk exists to catch.
   */
  implications: readonly InvestmentImplication[]
}

export function buildThesis(thesis: InvestmentThesis): InvestmentThesis {
  if (!thesis.invalidationCriteria.trim()) {
    throw new Error(
      `Thesis "${thesis.thesisId}" states no invalidation criteria. A thesis ` +
        `that cannot be wrong is a preference, not an investment case.`,
    )
  }
  if (thesis.revisionNumber < 1) {
    throw new Error(`Revision numbers start at 1, got ${thesis.revisionNumber}`)
  }
  /*
   * Exactly one accountable principal, mirroring
   * `thesis_revisions_one_accountable_principal` from migration 0040 so a
   * revision the database would refuse does not reach it.
   */
  const proposers = [
    thesis.proposedByEmployeeId,
    thesis.proposedByAgentPrincipalId,
  ].filter((principal) => principal !== undefined).length
  if (proposers !== 1) {
    throw new Error(
      `Revision "${thesis.revisionId}" names ${proposers} accountable ` +
        `principals. A position the firm holds is proposed by exactly one.`,
    )
  }
  if (thesis.revisionNumber > 1 && !thesis.supersedesRevisionId) {
    throw new Error(
      `Revision ${thesis.revisionNumber} of "${thesis.thesisId}" does not say ` +
        `what it supersedes — a lineage with a hole cannot be audited`,
    )
  }
  if (thesis.revisionNumber > 1 && !thesis.revisionReason?.trim()) {
    throw new Error(
      `Revision ${thesis.revisionNumber} of "${thesis.thesisId}" gives no reason`,
    )
  }
  if (thesis.revisionNumber === 1 && thesis.supersedesRevisionId) {
    throw new Error(`Revision 1 of "${thesis.thesisId}" cannot supersede anything`)
  }
  if (thesis.lifecycle === 'verified' && thesis.supportingClaimIds.length === 0) {
    throw new Error(
      `Thesis revision "${thesis.revisionId}" cannot be verified with no ` +
        `supporting claims`,
    )
  }
  if (!REVISION_CAUSES.includes(thesis.revisionCause)) {
    throw new Error(
      `Revision "${thesis.revisionId}" declares cause "${thesis.revisionCause}", ` +
        `which is not one the firm recognises. The list is closed so that "why ` +
        `did this change" stays countable rather than readable.`,
    )
  }
  if ((thesis.revisionCause === 'initial-proposal') !== (thesis.revisionNumber === 1)) {
    throw new Error(
      `Revision ${thesis.revisionNumber} of "${thesis.thesisId}" declares cause ` +
        `"${thesis.revisionCause}". Only revision 1 is an initial proposal, and ` +
        `revision 1 is nothing else.`,
    )
  }

  const unknown = thesis.implications.filter(
    (implication) => !INVESTMENT_IMPLICATIONS.includes(implication),
  )
  if (unknown.length > 0) {
    throw new Error(
      `Thesis revision "${thesis.revisionId}" declares unknown implications ` +
        `${unknown.join(', ')}. The list is closed so that the conditional ` +
        `Risk rule reads a fixed vocabulary.`,
    )
  }

  return Object.freeze({
    ...thesis,
    supportingClaimIds: Object.freeze([...thesis.supportingClaimIds]),
    opposingClaimIds: Object.freeze([...thesis.opposingClaimIds]),
    citedByClaimIds: Object.freeze([...thesis.citedByClaimIds]),
    // Sorted and de-duplicated, so two identical declarations hash identically
    // and a resolution recorded against one applies to the other.
    implications: Object.freeze([...new Set(thesis.implications)].sort(utf8ByteOrder)),
  })
}

/* --------------------------------------------------------------- revising */

/** What a revision is allowed to change. Identity and lineage are not. */
export interface ThesisRevisionInput {
  statement?: string
  position?: ThesisPosition
  invalidationCriteria?: string
  horizon?: string
  supportingClaimIds?: readonly ClaimId[]
  opposingClaimIds?: readonly ClaimId[]
  /**
   * Changing these changes whether Risk Review is required, so a revision that
   * alters them reopens the conditional gate rather than inheriting the
   * previous revision's resolution — see `requirements.ts`.
   */
  implications?: readonly InvestmentImplication[]
}

/**
 * Mints the next revision, leaving the current one untouched.
 *
 * Returns both, because superseding is a two-sided fact: the caller must
 * persist the old revision's new lifecycle as well as the new revision, or the
 * lineage would show two live versions.
 */
export function reviseThesis(
  current: InvestmentThesis,
  changes: ThesisRevisionInput,
  meta: { revisionId: RevisionId; reason: string; at: string; cause: RevisionCause },
): { superseded: InvestmentThesis; revision: InvestmentThesis } {
  if (!meta.reason.trim()) {
    throw new Error(`Revising "${current.thesisId}" requires a reason`)
  }
  if (current.lifecycle === 'superseded') {
    throw new Error(
      `Revision "${current.revisionId}" is already superseded. Revise the ` +
        `current revision of "${current.thesisId}", not a historical one.`,
    )
  }

  const revision = buildThesis({
    ...current,
    ...changes,
    revisionId: meta.revisionId,
    revisionNumber: current.revisionNumber + 1,
    supersedesRevisionId: current.revisionId,
    revisedAt: meta.at,
    revisionReason: meta.reason,
    revisionCause: meta.cause,
    // A new argument has been reviewed by nobody and cited by nothing.
    lifecycle: 'under-analysis',
    citedByClaimIds: [],
  })

  return {
    superseded: Object.freeze({ ...current, lifecycle: 'superseded' as const }),
    revision,
  }
}

/** Whether this revision may still be edited in place. */
export function thesisIsSealed(thesis: InvestmentThesis): boolean {
  return isSealed({
    lifecycle: thesis.lifecycle,
    citedByClaimIds: thesis.citedByClaimIds,
  })
}

/* ---------------------------------------------------------------- lineage */

/**
 * Orders one lineage and validates it.
 *
 * Checks the three properties a revision history must have: monotonic numbering
 * with no gaps or duplicates, a `supersedes` chain that actually links up, and
 * no cycles. A lineage failing any of these cannot be audited, which is the
 * only reason to keep history at all.
 */
export function thesisLineage(
  revisions: readonly InvestmentThesis[],
  thesisId: ThesisId,
): InvestmentThesis[] {
  const mine = revisions
    .filter((r) => r.thesisId === thesisId)
    .sort((a, b) => a.revisionNumber - b.revisionNumber)
  if (mine.length === 0) return []

  const numbers = mine.map((r) => r.revisionNumber)
  if (new Set(numbers).size !== numbers.length) {
    throw new Error(`Lineage "${thesisId}" has duplicate revision numbers`)
  }
  for (let i = 0; i < mine.length; i++) {
    if (mine[i]!.revisionNumber !== i + 1) {
      throw new Error(`Lineage "${thesisId}" has a gap at revision ${i + 1}`)
    }
  }

  const seen = new Set<RevisionId>()
  for (const revision of mine) {
    if (seen.has(revision.revisionId)) {
      throw new Error(`Lineage "${thesisId}" revisits revision ${revision.revisionId}`)
    }
    seen.add(revision.revisionId)
    const expected = mine[revision.revisionNumber - 2]?.revisionId
    if (revision.revisionNumber > 1 && revision.supersedesRevisionId !== expected) {
      throw new Error(
        `Revision ${revision.revisionNumber} of "${thesisId}" supersedes ` +
          `"${revision.supersedesRevisionId}", expected "${expected}"`,
      )
    }
  }
  return mine
}

/** The live version of a lineage. `null` when every revision is closed out. */
export function currentRevision(
  revisions: readonly InvestmentThesis[],
  thesisId: ThesisId,
): InvestmentThesis | null {
  const lineage = thesisLineage(revisions, thesisId)
  const live = lineage.filter((r) => r.lifecycle !== 'superseded')
  return live[live.length - 1] ?? null
}

/**
 * Whether a contribution aimed at this revision may still be applied.
 *
 * The late-result rule: work that started against revision 1 and finished
 * after revision 2 exists must NOT be silently attached to revision 2 — it
 * reasoned over different assumptions. It is retained against revision 1 with
 * an obsolete result state, or rejected.
 */
/* ------------------------------------------------------------ the inquiry */

/**
 * What the person asked the firm for — read off the record, never off prose.
 *
 * The opening revision is the record of the question's kind: an explanatory
 * opening carries `EXPLANATORY_POSITION`; anything else asked for a judgement.
 * Ruled 2026-09-18: explanation governance and decision governance are
 * different, and the kind must not drift through model-generated prose.
 */
export type InquiryKind = 'explanation' | 'judgement'

/** The position word an explanatory opening carries. The class is read from it. */
export const EXPLANATORY_POSITION = 'explain'

export function inquiryKindOf(
  revisions: readonly InvestmentThesis[],
  thesisId?: ThesisId,
): InquiryKind {
  const lineage = thesisId
    ? thesisLineage(revisions, thesisId)
    : [...revisions].sort((a, b) => a.revisionNumber - b.revisionNumber)
  return lineage[0]?.position === EXPLANATORY_POSITION ? 'explanation' : 'judgement'
}

/**
 * Whether a synthesis is permitted for the kind of question asked.
 *
 * An explanation may interpret the market, weigh drivers, state uncertainty
 * and caveats — in its prose. It may not become a position, and it may not
 * declare implementation implications: every value of `InvestmentImplication`
 * is a portfolio or capital consequence nobody asked the firm to judge. A
 * judgement is free to declare any of them.
 */
export function synthesisPermittedFor(
  inquiry: InquiryKind,
  position: string,
  implications: readonly InvestmentImplication[],
): { permitted: true } | { permitted: false; reason: string } {
  if (inquiry === 'judgement') return { permitted: true }
  if (position !== EXPLANATORY_POSITION) {
    return {
      permitted: false,
      reason:
        `The question asked for an explanation and the synthesis takes the position ` +
        `"${position}". An explanation stays "${EXPLANATORY_POSITION}": the person did ` +
        `not ask the firm what to do.`,
    }
  }
  if (implications.length > 0) {
    return {
      permitted: false,
      reason:
        `The question asked for an explanation and the synthesis declares ` +
        `implementation implications (${implications.join(', ')}). An explanation ` +
        `carries none: a portfolio judgement nobody asked for is refused, not ` +
        `routed to Risk.`,
    }
  }
  return { permitted: true }
}

export function acceptsContributions(thesis: InvestmentThesis): boolean {
  return thesis.lifecycle === 'proposed' || thesis.lifecycle === 'under-analysis'
}

export function clearedRevisions(
  revisions: readonly InvestmentThesis[],
): InvestmentThesis[] {
  return revisions.filter((r) => r.lifecycle === 'verified')
}

/**
 * True when a case holds genuinely competing positions.
 *
 * Counts distinct positions across live lineages, so three revisions of one
 * Buy thesis are not mistaken for disagreement.
 */
export function hasCompetingTheses(revisions: readonly InvestmentThesis[]): boolean {
  const live = revisions.filter(
    (r) =>
      r.lifecycle !== 'superseded' &&
      r.lifecycle !== 'rejected' &&
      r.lifecycle !== 'withdrawn' &&
      r.lifecycle !== 'not-selected',
  )
  return new Set(live.map((r) => r.position)).size > 1
}
