/**
 * Who sits at the table, and what — if anything — they did in this case.
 *
 * The room seats the ORGANISATION. Participation is a separate fact, and the
 * distance between those two is the whole reason this module exists: a chair
 * belonging to a desk must never read as evidence that the desk worked on the
 * case in front of it.
 *
 * ## Three participation states, each from a different persisted fact
 *
 *   acted              the case holds an institutional act by this desk
 *   assigned-not-acted the workflow allocated it work; nothing is recorded yet
 *   not-in-case        the firm holds the seat; this case never asked for it
 *
 * Nothing here infers. `acted` comes from the projection of persisted acts,
 * `assigned-not-acted` from the case's own assignments, and the remainder is
 * the roster minus the two. A desk that ran and was refused acceptance has no
 * act — correctly, because unaccepted work is not institutional — and appears
 * as assigned rather than acted.
 *
 * ## What a seat may never carry
 *
 * A verdict, a confidence, a challenge or an opinion. Those belong to the acts,
 * which the debate surface renders from the timeline. A seat carries identity,
 * classification and whether the desk appears in this case at all.
 */

import type { CioSubmission } from '~/domain/analysis'
import type { BoardroomTimeline } from './boardroomTimeline'
import type { CaseOverview } from './caseOverview'

export type SeatParticipation = 'acted' | 'assigned-not-acted' | 'not-in-case'

/**
 * Which kind of seat this is.
 *
 * `chief` is the executive department — the CIO's seat. It is separated from
 * `governance` because the control functions check the work and the chief
 * decides on it, and a room that drew them alike would put the decision inside
 * the review.
 */
export type SeatKind = 'analysis' | 'governance' | 'chief'

/**
 * Where the case stands with the office that decides it.
 *
 * The chief's seat is the destination of the work, not an ordinary allocation
 * of it, and `SeatParticipation` cannot say that: a submitted case with no
 * decision leaves the executive department with no act and no assignment, so
 * the generic answer is "never asked for" — technically true and, at the head
 * of the table, badly wrong.
 *
 * This is that missing fact, kept separate rather than folded into
 * participation, so the ordinary three states keep meaning exactly what they
 * meant before.
 *
 * Each arm is READ, never inferred. A submission carries its own `state`, and
 * the live decision is a stored record; nothing here concludes that the CIO has
 * looked at, considered or accepted anything. `awaiting-decision` is a
 * statement about where the case is, not about what the CIO has done with it.
 */
export type ExecutiveStanding =
  /** The case has never been put to the CIO. */
  | { kind: 'not-submitted' }
  /** Submitted, and no decision stands. The office holds it. */
  | { kind: 'awaiting-decision' }
  /**
   * The CIO acted and did NOT decide — the case went back to the desks. Kept
   * distinct from waiting, because a returned case has had an answer.
   */
  | { kind: 'returned' }
  /** A decision stands, carrying the outcome the firm recorded. */
  | { kind: 'decided'; outcome: string }

export interface BoardroomSeat {
  departmentId: string
  /** As the organisation names it. Never invented. */
  name: string
  /**
   * How the firm refers to whoever heads the desk, when it names one.
   *
   * Identity, not state. The room uses it where a department name would read
   * as bureaucracy rather than as a person's office — the executive seat is
   * the Chief Investment Officer, and labelling the head of the table
   * "Executive" describes an org-chart box instead of the authority the case
   * is travelling towards.
   */
  roleTitle: string | null
  kind: SeatKind
  participation: SeatParticipation
  /** The acts this desk performed in THIS case, by durable id. */
  actIds: readonly string[]
  /**
   * Set on the chief's seat and null on every other, because only one seat in
   * the room is the destination of a decision.
   */
  executive: ExecutiveStanding | null
}

/**
 * Where the case stands with the CIO, from the records that say so.
 *
 * The live decision answers first: it is the standing outcome, and a superseded
 * one is history rather than the current position. Failing that, the newest
 * submission reports its OWN state — the domain already tracks whether it is
 * pending, returned or decided, and re-deriving that from timestamps here would
 * be a second opinion about a fact the firm has written down.
 */
function executiveStandingFor(overview: CaseOverview): ExecutiveStanding {
  if (overview.decision) {
    return { kind: 'decided', outcome: overview.decision.outcome.kind }
  }

  const newest = overview.submissions.reduce<CioSubmission | null>(
    (latest, submission) =>
      !latest || submission.submittedAt > latest.submittedAt ? submission : latest,
    null,
  )
  if (!newest) return { kind: 'not-submitted' }
  if (newest.state === 'returned') return { kind: 'returned' }
  /*
   * `decided` with no live decision means the decision it refers to was
   * superseded — a reopening put the case back in front of the CIO. Waiting is
   * then the honest reading of two stored facts, not a guess about the office.
   */
  return { kind: 'awaiting-decision' }
}

/** The executive department: the CIO's seat, and never an analytical one. */
const CHIEF_DEPARTMENT = 'executive'

/**
 * Seats, ordered so the case focuses the room.
 *
 * Desks that acted come first, then desks the workflow asked for, then the rest
 * of the firm. Ordering by PARTICIPATION rather than by a hand-written list of
 * important departments keeps the room honest: the case decides who is
 * prominent, not a preference nobody recorded. Within a band, governance
 * follows analysis and names sort alphabetically, so the arrangement is stable
 * between renders.
 */
const PARTICIPATION_ORDER: readonly SeatParticipation[] = [
  'acted',
  'assigned-not-acted',
  'not-in-case',
]
const KIND_ORDER: readonly SeatKind[] = ['analysis', 'governance', 'chief']

/**
 * The room, as one deliverable.
 *
 * The two projections travel together because they are read together and must
 * describe the SAME moment: seating is derived from the timeline, and a surface
 * given a fresh timeline with stale seats would light a desk for an act the
 * record no longer shows beside it.
 */
export interface BoardroomProjection {
  timeline: BoardroomTimeline
  seats: readonly BoardroomSeat[]
}

export function boardroomSeating(
  overview: CaseOverview,
  timeline: BoardroomTimeline,
): readonly BoardroomSeat[] {
  /*
   * Acts, by the desk that performed them. The CIO submission is performed by
   * the desk that submitted — research-office — so it lands on that seat and
   * not on the chief's. The chief's seat lights only for a decision, which is
   * the one act the CIO actually performs.
   */
  const actsByDepartment = new Map<string, string[]>()
  for (const entry of timeline.entries) {
    const department = entry.kind === 'cio-decision' ? CHIEF_DEPARTMENT : entry.byDepartmentId
    const existing = actsByDepartment.get(department)
    if (existing) existing.push(entry.id)
    else actsByDepartment.set(department, [entry.id])
  }

  /* Work the case allocated, whether or not anything came of it. */
  const assigned = new Set(
    overview.assignments.map((assignment) => assignment.departmentId),
  )

  const executive = executiveStandingFor(overview)

  const seats: BoardroomSeat[] = overview.roster.map((department) => {
    const acts = actsByDepartment.get(department.id) ?? []
    const isChief = department.id === CHIEF_DEPARTMENT
    return {
      departmentId: department.id,
      name: department.name,
      roleTitle: department.managerTitle,
      kind: isChief ? 'chief' : department.isGovernance ? 'governance' : 'analysis',
      participation:
        acts.length > 0
          ? 'acted'
          : assigned.has(department.id)
            ? 'assigned-not-acted'
            : 'not-in-case',
      actIds: Object.freeze(acts),
      executive: isChief ? executive : null,
    }
  })

  return Object.freeze(
    seats.sort(
      (left, right) =>
        PARTICIPATION_ORDER.indexOf(left.participation) -
          PARTICIPATION_ORDER.indexOf(right.participation) ||
        KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind) ||
        (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    ),
  )
}
