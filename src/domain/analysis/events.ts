/**
 * Append-only transition events.
 *
 * Every state change in the organization is recorded as a fact. Current state
 * on an entity is a convenience; **the events are the record**, and the
 * headquarters activity feed is a projection of them.
 *
 * Two consequences are deliberate:
 *
 * **History is never rewritten.** A mistake is corrected by appending a
 * correcting event, not by editing or deleting the original. A log that can be
 * tidied is not an audit trail, and the whole point of recording who moved what
 * and when is that it cannot be adjusted afterwards to look cleaner.
 *
 * **Events carry no prose.** They store what happened structurally — event
 * type, department, case, states, timestamp. Human-readable text is generated
 * in the presentation layer. If activity text were a domain field, anything
 * could write "Macro Team is studying the Fed" with no work behind it, and the
 * one rule the living-organization vision must not break is that visible
 * activity is backed by real state.
 */

import type { CaseId, CaseStage } from './cases'
import type { DepartmentId, EmployeeId } from './organization'
import type { RevisionId, ThesisId, ThesisLifecycleState } from './index'

export type EventId = string

/** What kind of thing moved. */
export type TransitionSubject = 'case' | 'thesis' | 'assignment' | 'run' | 'review'

/**
 * One recorded state change.
 *
 * `causationId` and `correlationId` are separate on purpose: correlation groups
 * everything belonging to one inbound request, causation names the single event
 * that directly triggered this one. Together they let a chain be replayed —
 * "the CIO decision at 16:02 was caused by the verification at 15:58, both part
 * of request abc" — which a flat timestamp ordering cannot express.
 */
export interface TransitionEvent {
  eventId: EventId
  subject: TransitionSubject
  caseId: CaseId
  /** Present when the event concerns a specific thesis revision. */
  thesisId?: ThesisId
  revisionId?: RevisionId
  /** Present for assignment and run events. */
  assignmentId?: string
  runId?: string

  /** `null` on creation events, where there was no previous state. */
  fromState: string | null
  toState: string
  /** Who or what is responsible. A department acts through an employee. */
  actorEmployeeId?: EmployeeId
  actorDepartmentId?: DepartmentId
  /** Required for anything that blocks, returns or rejects. */
  reason?: string

  occurredAt: string
  correlationId: string
  /** The event that directly caused this one. */
  causationId?: EventId
  /** The case aggregate version this event advanced the case to. */
  aggregateVersion: number
  /**
   * True when this event corrects an earlier one.
   *
   * The only sanctioned way to fix the record: append, never rewrite.
   */
  corrects?: EventId
}

export function buildTransitionEvent(event: TransitionEvent): TransitionEvent {
  const stallingStates = ['blocked', 'returned', 'rejected', 'failed', 'cancelled']
  if (stallingStates.includes(event.toState) && !event.reason?.trim()) {
    throw new Error(
      `Event "${event.eventId}" moves to ${event.toState} without a reason — ` +
        `work does not stall anonymously`,
    )
  }
  if (event.aggregateVersion < 0) {
    throw new Error(`Event "${event.eventId}" has a negative aggregate version`)
  }
  return Object.freeze({ ...event })
}

/** Convenience constructors, so call sites cannot forget the subject tag. */
export function caseEvent(
  args: Omit<TransitionEvent, 'subject' | 'fromState' | 'toState'> & {
    from: CaseStage | null
    to: CaseStage
  },
): TransitionEvent {
  const { from, to, ...rest } = args
  return buildTransitionEvent({ ...rest, subject: 'case', fromState: from, toState: to })
}

export function thesisEvent(
  args: Omit<TransitionEvent, 'subject' | 'fromState' | 'toState'> & {
    from: ThesisLifecycleState | null
    to: ThesisLifecycleState
  },
): TransitionEvent {
  const { from, to, ...rest } = args
  return buildTransitionEvent({
    ...rest,
    subject: 'thesis',
    fromState: from,
    toState: to,
  })
}

/* ------------------------------------------------------------------- log */

/**
 * An append-only log for one case.
 *
 * Deliberately offers no update or delete. The type is the guarantee: there is
 * no method through which history could be rewritten.
 */
export interface TransitionLog {
  caseId: CaseId
  events: readonly TransitionEvent[]
}

export function appendEvent(log: TransitionLog, event: TransitionEvent): TransitionLog {
  if (event.caseId !== log.caseId) {
    throw new Error(`Event "${event.eventId}" does not belong to case "${log.caseId}"`)
  }
  if (log.events.some((e) => e.eventId === event.eventId)) {
    // Idempotency at the log level: replaying a command must not double-write.
    return log
  }
  return Object.freeze({
    caseId: log.caseId,
    events: Object.freeze([...log.events, event]),
  })
}

/** Events in occurrence order, oldest first. */
export function orderedEvents(log: TransitionLog): TransitionEvent[] {
  return [...log.events].sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) || a.aggregateVersion - b.aggregateVersion,
  )
}

/**
 * Events that have not been superseded by a correction.
 *
 * Corrections append rather than replace, so the raw log holds both the
 * mistake and the fix. A reader wanting the corrected picture filters here; a
 * reader auditing what actually happened reads the raw log.
 */
export function effectiveEvents(log: TransitionLog): TransitionEvent[] {
  const corrected = new Set(
    log.events.map((e) => e.corrects).filter((id): id is EventId => Boolean(id)),
  )
  return orderedEvents(log).filter((e) => !corrected.has(e.eventId))
}
