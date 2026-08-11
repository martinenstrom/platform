/**
 * Investment cases — the unit of work the whole organization revolves around.
 *
 * This is the aggregate root, and choosing it deliberately is the most
 * consequential decision in the analysis domain. The obvious alternative was to
 * make the agent run central: "an agent ran and produced claims." That models
 * an agent system. It makes a case something you RECONSTRUCT by joining runs,
 * which means the questions the headquarters has to answer — which cases are
 * progressing, which are blocked, which are waiting on evidence, which teams
 * disagree, what has reached the CIO — are all derived rather than stored.
 *
 * So the case is the thing that exists and moves; a run is a CONTRIBUTION to a
 * case. Everything else follows from that.
 *
 * The organization receives a case. The case moves between departments.
 * Departments contribute evidence and claims. Departments review each other.
 * Governance can reject it. Eventually the CIO receives a complete case ready
 * for a decision.
 *
 * Not prompts. Not chats. Not conversations.
 */

import type { DepartmentId, EmployeeId } from './organization'

export type CaseId = string

/**
 * What the case is about.
 *
 * Open-ended on purpose: a subject is a domain identifier plus a kind, so a
 * case can concern an instrument, an asset class, a portfolio, a theme or a
 * macro regime. New department types bring new subject kinds without touching
 * this file.
 */
export interface CaseSubject {
  kind: string
  /** e.g. a canonical symbol, a sector code, a country, a portfolio id. */
  ref: string
  displayName: string
}

/**
 * Where a case is in the firm.
 *
 * A lifecycle, not a pipeline: `returned` and `blocked` are first-class,
 * because in a real firm work comes back and work gets stuck, and a model that
 * can only move forward cannot represent either.
 */
export type CaseStage =
  /** Received, not yet assigned. */
  | 'intake'
  /** Departments are producing evidence and claims. */
  | 'research'
  /** A manager is aggregating and reconciling contributions. */
  | 'aggregation'
  /** Governance departments are reviewing. */
  | 'review'
  /** Sent back for correction. Names who sent it back and why. */
  | 'returned'
  /** Cannot proceed — missing evidence, unresolved disagreement, a hard block. */
  | 'blocked'
  /** With the investment committee / CIO for decision. */
  | 'decision'
  /**
   * The CIO recorded a completed decision — a position taken, or every
   * alternative declined.
   *
   * One structural terminal stage for both, deliberately. Which of the two it
   * was is the live decision's `outcome`, and duplicating that into the stage
   * would give the firm two places to look and two chances to disagree. The
   * headquarters distinguishes them through case health, which reads the
   * outcome.
   */
  | 'decided'
  /**
   * The CIO formally chose to wait.
   *
   * Its own stage rather than a variety of `decision`, because "nobody has
   * looked at this yet" and "the CIO looked and decided to wait" are opposite
   * institutional facts that would otherwise be indistinguishable from the
   * floor.
   */
  | 'deferred'
  /** Decided and published. */
  | 'published'
  /** Closed without publication. */
  | 'withdrawn'

/** Terminal stages. A case in one of these no longer occupies a queue. */
export const TERMINAL_STAGES: readonly CaseStage[] = [
  'decided',
  'published',
  'withdrawn',
] as const

export function isTerminal(stage: CaseStage): boolean {
  return TERMINAL_STAGES.includes(stage)
}

/**
 * Legal stage transitions.
 *
 * Written down rather than left to whoever calls the setter. The two that
 * matter most: nothing reaches `decision` except from `review`, so the CIO
 * cannot receive work that governance has not seen; and `published` is
 * reachable only from a completed decision.
 *
 * **`deferred -> decision` is legal and nothing takes it.** The reconsideration
 * command is TD-50. Declaring it keeps this table a statement of what the firm
 * permits rather than of what happens to be built, and a test asserts that no
 * command performs it — so the gap stays visible instead of being assumed away.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<CaseStage, readonly CaseStage[]>> =
  Object.freeze({
    intake: ['research', 'withdrawn'],
    research: ['aggregation', 'blocked', 'withdrawn'],
    aggregation: ['review', 'returned', 'blocked', 'withdrawn'],
    review: ['decision', 'returned', 'blocked', 'withdrawn'],
    returned: ['research', 'aggregation', 'withdrawn'],
    blocked: ['research', 'aggregation', 'review', 'withdrawn'],
    decision: ['decided', 'deferred', 'returned', 'blocked', 'withdrawn'],
    /*
     * A superseding decision does not move the case: it replaces the live
     * decision while the stage stays `decided`, which is why there is no
     * `decided -> decided`. Reopening a decided case is TD-50.
     */
    decided: ['published', 'withdrawn'],
    /* Taken by nothing in C1D-1 — see the note above. */
    deferred: ['decision', 'withdrawn'],
    published: [],
    withdrawn: [],
  })

/**
 * Every stage, as data.
 *
 * Derived from the transition table rather than written out again, so it cannot
 * fall behind `CaseStage`. Adapters validating a stored stage read this instead
 * of keeping a list of their own -- the PostgreSQL mapper kept one, and it was
 * still refusing `decided` long after the domain had declared it.
 */
export const CASE_STAGES: readonly CaseStage[] = Object.freeze(
  Object.keys(ALLOWED_TRANSITIONS) as CaseStage[],
)

export function canTransition(from: CaseStage, to: CaseStage): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/**
 * A recorded movement of a case.
 *
 * The audit trail AND the source of the live activity feed. The headquarters
 * shows a department "reviewing earnings numbers at 09:07" only because a
 * transition was recorded at 09:07 — the feed is a projection of these, never
 * an independent stream of invented activity.
 */
export interface CaseTransition {
  caseId: CaseId
  from: CaseStage
  to: CaseStage
  at: string
  /** Who moved it. A department acts through an employee. */
  byEmployeeId: EmployeeId
  byDepartmentId: DepartmentId
  /** Required for `returned` and `blocked`: work does not stall anonymously. */
  reason?: string
}

export interface InvestmentCase {
  id: CaseId
  /**
   * Monotonic aggregate version, for optimistic concurrency.
   *
   * Departments finish concurrently even inside one process, so a command
   * computed against version 12 must not silently overwrite work committed as
   * version 13. The repository compares this on write and rejects a stale one;
   * the caller re-reads and retries. Deliberately not a global lock, which
   * would serialise the whole organization to protect one case.
   */
  version: number
  subject: CaseSubject
  /** Why the firm is looking at this — a mandate, not a prompt. */
  question: string
  stage: CaseStage
  openedAt: string
  /** The manager accountable for the case as a whole. */
  ownerEmployeeId: EmployeeId
  /** Departments asked to contribute. Grows as the case moves. */
  participatingDepartmentIds: readonly DepartmentId[]
  /** Full movement history, oldest first. */
  transitions: readonly CaseTransition[]
  /** Set when the case reaches a terminal stage. */
  closedAt?: string
  /**
   * The exact playbook version that created this case's workflow.
   *
   * Absent while the case sits in `intake`: a case may be received before
   * anyone has decided how to work it. Set once, by `pinPlaybook`, and never
   * changed — a case runs to completion under the version it started on, even
   * after a better version exists.
   */
  playbookId?: string
  playbookVersion?: string
}

/**
 * Binds a case to the workflow version that will produce its assignments.
 *
 * Refuses a second pin rather than accepting the latest one. Re-pinning would
 * rewrite which workflow the case's existing assignments came from, and the
 * assignments themselves carry entry keys that only mean something relative to
 * a version. The database enforces the same rule in migration 0014, so this is
 * a fast, legible failure rather than the only one.
 */
export function pinPlaybook(
  investmentCase: InvestmentCase,
  playbookId: string,
  playbookVersion: string,
): InvestmentCase {
  if (investmentCase.playbookId) {
    if (
      investmentCase.playbookId === playbookId &&
      investmentCase.playbookVersion === playbookVersion
    ) {
      // The same pin. A retry, not a change.
      return investmentCase
    }
    throw new Error(
      `Case "${investmentCase.id}" already runs under ` +
        `${investmentCase.playbookId}@${investmentCase.playbookVersion}. A case ` +
        `runs to completion on the version it was instantiated from.`,
    )
  }
  return Object.freeze({ ...investmentCase, playbookId, playbookVersion })
}

/* -------------------------------------------------------------- transitions */

/**
 * Moves a case, refusing anything the lifecycle does not permit.
 *
 * Returns a new case rather than mutating: a case's history is evidence, and
 * an aggregate whose past can be rewritten in place cannot be audited.
 */
export function transitionCase(
  investmentCase: InvestmentCase,
  to: CaseStage,
  by: { employeeId: EmployeeId; departmentId: DepartmentId; at: string; reason?: string },
): InvestmentCase {
  if (!canTransition(investmentCase.stage, to)) {
    throw new Error(
      `Case "${investmentCase.id}" cannot move from ${investmentCase.stage} to ${to}`,
    )
  }
  if ((to === 'returned' || to === 'blocked') && !by.reason) {
    throw new Error(
      `Moving case "${investmentCase.id}" to ${to} requires a reason — ` +
        `work does not stall anonymously`,
    )
  }

  const transition: CaseTransition = {
    caseId: investmentCase.id,
    from: investmentCase.stage,
    to,
    at: by.at,
    byEmployeeId: by.employeeId,
    byDepartmentId: by.departmentId,
    ...(by.reason ? { reason: by.reason } : {}),
  }

  return Object.freeze({
    ...investmentCase,
    stage: to,
    version: investmentCase.version + 1,
    transitions: Object.freeze([...investmentCase.transitions, transition]),
    ...(isTerminal(to) ? { closedAt: by.at } : {}),
  })
}

/** The reason a case is currently stalled, from its most recent transition. */
export function blockingReason(investmentCase: InvestmentCase): string | null {
  if (investmentCase.stage !== 'blocked' && investmentCase.stage !== 'returned') {
    return null
  }
  return investmentCase.transitions[investmentCase.transitions.length - 1]?.reason ?? null
}
