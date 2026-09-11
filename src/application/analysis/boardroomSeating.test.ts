/**
 * A seat is a position the firm holds. It is not evidence of work.
 *
 * The failure this file exists to prevent is the whole reason the Boardroom is
 * allowed to draw a room at all: a chair with a department's name on it must
 * never read as that department having analysed, reviewed or agreed to
 * anything. Every state below is traced to a persisted fact, and the state a
 * desk gets when the case never asked for it is its own, distinguishable from
 * "asked and silent".
 */

import { describe, expect, it } from 'vitest'
import { boardroomSeating } from './boardroomSeating'
import type { BoardroomTimeline } from './boardroomTimeline'
import type { CaseOverview } from './caseOverview'

const ROSTER = [
  { id: 'global-macro', name: 'Global Macro', isGovernance: false, managerTitle: 'Head of Macro' },
  { id: 'rates', name: 'Rates', isGovernance: false, managerTitle: 'Head of Rates' },
  {
    id: 'equity-research',
    name: 'Equity Research',
    isGovernance: false,
    managerTitle: 'Head of Equity Research',
  },
  {
    id: 'verification',
    name: 'Verification',
    isGovernance: true,
    managerTitle: 'Head of Verification',
  },
  {
    id: 'executive',
    name: 'Executive',
    isGovernance: false,
    managerTitle: 'Chief Investment Officer',
  },
]

const overviewOf = (over: Partial<CaseOverview> = {}): CaseOverview =>
  ({
    roster: ROSTER,
    assignments: [],
    submissions: [],
    decision: null,
    ...over,
  }) as unknown as CaseOverview

const submission = (over: Record<string, unknown> = {}) =>
  ({ id: 'sub-1', submittedAt: '2026-03-01T09:00:00.000Z', state: 'pending', ...over }) as never

const timelineOf = (
  entries: { id: string; byDepartmentId: string; kind?: string }[],
): BoardroomTimeline =>
  ({
    entries: entries.map((entry) => ({ kind: 'analysis-recorded', ...entry })),
    moments: [],
  }) as unknown as BoardroomTimeline

const seatFor = (seats: readonly ReturnType<typeof boardroomSeating>[number][], id: string) =>
  seats.find((seat) => seat.departmentId === id)!

/* ============================================ participation, three states = */

describe('a seat says what the record says, and no more', () => {
  it('marks a desk that performed an act as having acted', () => {
    const seats = boardroomSeating(
      overviewOf({ assignments: [{ departmentId: 'global-macro' }] as never }),
      timelineOf([{ id: 'run-1', byDepartmentId: 'global-macro' }]),
    )
    expect(seatFor(seats, 'global-macro')).toMatchObject({
      participation: 'acted',
      actIds: ['run-1'],
    })
  })

  it('separates "asked and silent" from "never asked"', () => {
    /*
     * THE distinction. A desk the case allocated work to and heard nothing
     * from is not the same as a desk this case never involved, and a room that
     * drew them alike would either accuse the first of nothing or credit the
     * second with presence.
     */
    const seats = boardroomSeating(
      overviewOf({ assignments: [{ departmentId: 'rates' }] as never }),
      timelineOf([]),
    )
    expect(seatFor(seats, 'rates').participation).toBe('assigned-not-acted')
    expect(seatFor(seats, 'equity-research').participation).toBe('not-in-case')
  })

  it('gives a desk with no act an empty act list, never a borrowed one', () => {
    const seats = boardroomSeating(
      overviewOf(),
      timelineOf([{ id: 'run-1', byDepartmentId: 'global-macro' }]),
    )
    expect(seatFor(seats, 'rates').actIds).toEqual([])
    expect(seatFor(seats, 'equity-research').actIds).toEqual([])
  })

  it('never infers participation from roster membership', () => {
    /* An empty case: every seat exists, none of them acted. */
    const seats = boardroomSeating(overviewOf(), timelineOf([]))
    expect(seats).toHaveLength(ROSTER.length)
    expect(seats.every((seat) => seat.participation === 'not-in-case')).toBe(true)
    expect(seats.every((seat) => seat.actIds.length === 0)).toBe(true)
  })
})

/* ==================================================== classification ====== */

describe('the three kinds of seat', () => {
  it('separates control functions from analytical desks', () => {
    const seats = boardroomSeating(overviewOf(), timelineOf([]))
    expect(seatFor(seats, 'verification').kind).toBe('governance')
    expect(seatFor(seats, 'global-macro').kind).toBe('analysis')
  })

  it('gives the executive its own kind, not governance', () => {
    /*
     * The control functions check the work; the chief decides on it. A room
     * that drew them alike would place the decision inside the review.
     */
    expect(seatFor(boardroomSeating(overviewOf(), timelineOf([])), 'executive').kind).toBe(
      'chief',
    )
  })

  it('lights the chief only for a decision, never for a submission', () => {
    /*
     * A submission is performed BY the desk that submitted it. Attributing it
     * to the CIO would show the chief acting on a case they have not yet seen.
     */
    const submitted = boardroomSeating(
      overviewOf(),
      timelineOf([
        { id: 'sub-1', byDepartmentId: 'research-office', kind: 'cio-submission' },
      ]),
    )
    expect(seatFor(submitted, 'executive').participation).toBe('not-in-case')

    const decided = boardroomSeating(
      overviewOf(),
      timelineOf([{ id: 'dec-1', byDepartmentId: 'executive', kind: 'cio-decision' }]),
    )
    expect(seatFor(decided, 'executive')).toMatchObject({
      participation: 'acted',
      actIds: ['dec-1'],
    })
  })
})

/* ========================================================= the ordering === */

describe('the case focuses the room', () => {
  it('puts the desks that acted first and the uninvolved last', () => {
    const seats = boardroomSeating(
      overviewOf({ assignments: [{ departmentId: 'rates' }] as never }),
      timelineOf([{ id: 'run-1', byDepartmentId: 'global-macro' }]),
    )
    expect(seats.map((seat) => seat.participation)).toEqual([
      'acted',
      'assigned-not-acted',
      'not-in-case',
      'not-in-case',
      'not-in-case',
    ])
  })

  it('is stable between renders', () => {
    /* Two identical inputs must seat the firm identically, or the room would
     * rearrange itself under a reader for no institutional reason. */
    const build = () =>
      boardroomSeating(overviewOf(), timelineOf([])).map((seat) => seat.departmentId)
    expect(build()).toEqual(build())
  })
})

/* ================================== the seat that decides, and does not act = */

/**
 * The head of the table is where the case GOES, not a desk the case employs.
 *
 * Participation cannot express that. A submitted case leaves the executive
 * department with no act and no assignment, so the generic answer is "this case
 * never asked for it" — which at the head of the table reads as the CIO having
 * nothing to do with a case that is sitting on their desk. The standing below is
 * the missing fact, and it is read rather than reasoned about.
 */
describe('the executive seat reports where the case stands, not what the CIO thinks', () => {
  const chiefOf = (over: Partial<CaseOverview> = {}, entries: never[] = []) =>
    seatFor(boardroomSeating(overviewOf(over), timelineOf(entries)), 'executive')

  it('says the case was never put to the CIO when no submission exists', () => {
    expect(chiefOf().executive).toEqual({ kind: 'not-submitted' })
  })

  it('says the office is holding the case once it is submitted and undecided', () => {
    expect(chiefOf({ submissions: [submission()] as never })).toMatchObject({
      executive: { kind: 'awaiting-decision' },
    })
  })

  it('does NOT treat a submission as an act by the CIO', () => {
    /*
     * THE regression. Submission is a request; a decision is an outcome. If a
     * submission ever lit this seat, the room would report that the CIO had
     * ruled on a case nobody has ruled on — the single most damaging thing
     * this surface could say.
     */
    const chief = chiefOf({ submissions: [submission()] as never })
    expect(chief.participation).toBe('not-in-case')
    expect(chief.actIds).toEqual([])
  })

  it('separates a case the CIO sent back from one the CIO is still holding', () => {
    /*
     * A returned case has had an answer. Wording it as "beslut väntar" would
     * describe the office as silent when it has actually spoken.
     */
    expect(
      chiefOf({ submissions: [submission({ state: 'returned' })] as never }).executive,
    ).toEqual({ kind: 'returned' })
  })

  it('reads the newest submission, so a resubmission supersedes a return', () => {
    expect(
      chiefOf({
        submissions: [
          submission({ id: 'sub-1', state: 'returned' }),
          submission({ id: 'sub-2', submittedAt: '2026-03-04T09:00:00.000Z' }),
        ] as never,
      }).executive,
    ).toEqual({ kind: 'awaiting-decision' })
  })

  it('carries the recorded outcome once a decision stands, and lights the seat', () => {
    const chief = chiefOf(
      {
        submissions: [submission({ state: 'decided' })] as never,
        decision: { decisionId: 'dec-1', outcome: { kind: 'selected' } } as never,
      },
      [{ id: 'dec-1', byDepartmentId: 'executive', kind: 'cio-decision' }] as never,
    )
    expect(chief.executive).toEqual({ kind: 'decided', outcome: 'selected' })
    /* The decision IS the act, so this is the one state where the seat lights. */
    expect(chief.participation).toBe('acted')
  })

  it('prefers the live decision to a submission still marked decided', () => {
    /*
     * A reopening supersedes the decision and leaves the submission's own state
     * behind. The case is back with the office, and the seat must not keep
     * announcing an outcome the firm has replaced.
     */
    expect(
      chiefOf({ submissions: [submission({ state: 'decided' })] as never }).executive,
    ).toEqual({ kind: 'awaiting-decision' })
  })

  it('gives no other seat an executive standing', () => {
    /*
     * One destination. If an analytical desk carried this, its plate would be
     * worded from the decision boundary instead of from its own work.
     */
    const seats = boardroomSeating(
      overviewOf({ submissions: [submission()] as never }),
      timelineOf([]),
    )
    expect(
      seats.filter((seat) => seat.executive !== null).map((seat) => seat.departmentId),
    ).toEqual(['executive'])
  })
})
