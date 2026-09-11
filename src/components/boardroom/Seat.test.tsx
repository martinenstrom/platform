/**
 * The plate at the head of the table, and why it is worded differently.
 *
 * `SeatParticipation` answers one question — did this desk work on the case —
 * and it answers it correctly for fifteen of the sixteen seats. The sixteenth is
 * the CIO, where the case does not arrive as work to be done but as a decision
 * to be taken. A submitted case leaves the executive department with no act and
 * no assignment, so the generic answer is "utan uppdrag här": the head of the
 * table labelled as having nothing to do with a case sitting on its desk.
 *
 * What follows fixes the four executive states in place, in words AND in light.
 * The dangerous confusion is between them:
 *
 *   submitted to the CIO   a request was made         (never lit)
 *   returned by the CIO    the office answered        (never lit)
 *   decided by the CIO     the office committed       (lit)
 *
 * Light on this plate means a decision exists. If a submission ever produced it,
 * the room would report a ruling nobody made.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Seat } from './Seat'
import type {
  BoardroomSeat,
  ExecutiveStanding,
} from '~/application/analysis/boardroomSeating'

/** The lit state. One class, so the assertions name the mechanism exactly. */
const LIT = 'brd-plate-acted'

const chief = (
  executive: ExecutiveStanding,
  over: Partial<BoardroomSeat> = {},
): BoardroomSeat => ({
  departmentId: 'executive',
  name: 'Executive',
  roleTitle: 'Chief Investment Officer',
  kind: 'chief',
  participation: 'not-in-case',
  actIds: [],
  executive,
  ...over,
})

const plateFor = (seat: BoardroomSeat) => {
  render(<Seat seat={seat} />)
  return screen.getByRole('listitem')
}

describe('the CIO plate reports where the case stands', () => {
  it('says the case is with the office, and does not light the seat', () => {
    /*
     * THE regression this file exists for. The wording must place the CASE,
     * never describe the CIO as having read or weighed anything, and the plate
     * must stay dark: submission is a request, not an outcome.
     */
    const plate = plateFor(chief({ kind: 'awaiting-decision' }))

    expect(plate).toHaveTextContent('Ärendet inlämnat · beslut väntar')
    expect(plate).not.toHaveTextContent('Utan uppdrag här')
    expect(plate.className).not.toContain(LIT)
    expect(plate.className).toContain('brd-plate-awaiting')
  })

  it('shows the recorded outcome once a decision stands, and lights the seat', () => {
    /*
     * The one state where this plate carries light, and the outcome is the
     * stored `outcome.kind` rendered through the single shared mapping — not a
     * sentence written here about what the decision meant.
     */
    const plate = plateFor(
      chief({ kind: 'decided', outcome: 'selected' }, { participation: 'acted' }),
    )

    expect(plate).toHaveTextContent('Position tagen')
    expect(plate.className).toContain(LIT)
  })

  it('keeps a returned case distinct from one still waiting', () => {
    /*
     * The CIO answered by sending it back. Wording that as "beslut väntar"
     * would describe the office as silent when it has spoken — and it still
     * did not decide, so the seat stays dark.
     */
    const plate = plateFor(chief({ kind: 'returned' }))

    expect(plate).toHaveTextContent('Återsänt av CIO')
    expect(plate).not.toHaveTextContent('beslut väntar')
    expect(plate.className).not.toContain(LIT)
  })

  it('says a case was never put to the CIO when none was', () => {
    const plate = plateFor(chief({ kind: 'not-submitted' }))

    expect(plate).toHaveTextContent('Inte inlämnat')
    expect(plate.className).not.toContain(LIT)
  })

  it('carries the state in text, not in light alone', () => {
    /*
     * A reader who cannot tell a bronze edge from a dark one must still be able
     * to tell a decided case from a waiting one, and the accessible name has to
     * carry the same fact the plate shows.
     */
    render(<Seat seat={chief({ kind: 'awaiting-decision' })} />)
    expect(
      screen.getByLabelText('Chief Investment Officer — Ärendet inlämnat · beslut väntar'),
    ).toBeInTheDocument()
  })

  it('names the office the way the organisation names it', () => {
    /*
     * "Executive" is the org-chart box. The authority the case is travelling
     * towards is the Chief Investment Officer, and that title is the
     * organisation's own — resolved from the department's manager, never a
     * label written in the presentation layer.
     */
    const plate = plateFor(chief({ kind: 'awaiting-decision' }))
    expect(plate).toHaveTextContent('Chief Investment Officer')
    expect(plate).not.toHaveTextContent('Executive')
  })

  it('falls back to the department name when the firm names no head', () => {
    /*
     * Nothing is invented to fill the gap. A desk the organisation gives no
     * manager keeps the name the org chart does hold.
     */
    expect(
      plateFor(chief({ kind: 'awaiting-decision' }, { roleTitle: null })),
    ).toHaveTextContent('Executive')
  })

  it('never engraves the destination away, even holding no act', () => {
    /*
     * A desk outside the case recedes to lettering on the stone. The head of
     * the table must not: the case is going there, and a room that dissolved
     * the destination would hide where the work is headed.
     */
    const plate = plateFor(chief({ kind: 'awaiting-decision' }))
    expect(plate.className).toContain('brd-plate')
    expect(plate.className).not.toContain('brd-engraved')
  })
})

describe('every other seat keeps the ordinary participation wording', () => {
  const desk = (over: Partial<BoardroomSeat> = {}): BoardroomSeat => ({
    departmentId: 'global-macro',
    name: 'Global Macro',
    roleTitle: 'Head of Macro',
    kind: 'analysis',
    participation: 'not-in-case',
    actIds: [],
    executive: null,
    ...over,
  })

  it('still says a desk outside the case has no mandate in it', () => {
    /*
     * The near miss. The executive wording must not leak: for an ordinary desk
     * "utan uppdrag här" is exactly right, and the correction above was allowed
     * to change the head of the table and nothing else.
     */
    expect(plateFor(desk())).toHaveTextContent('Utan uppdrag här')
  })

  it('recedes a desk outside the case to lettering, not to a dimmer plate', () => {
    /*
     * Presence follows participation. A reader entering the case should see who
     * worked on it without first ruling out who did not — so a desk the case
     * never involved keeps its name and its position and gives up its object.
     *
     * The state stays written. Quiet is not the same as hidden.
     */
    const plate = plateFor(desk())
    expect(plate.className).toContain('brd-engraved')
    expect(plate.className).not.toContain('brd-plate ')
    expect(screen.getByLabelText('Global Macro — Utan uppdrag här')).toBeInTheDocument()
  })

  it('keeps a plate for a desk the case actually asked', () => {
    /*
     * The boundary of the rule above. Asked-and-silent is IN the case, so it
     * keeps its object and only loses its light.
     */
    const plate = plateFor(desk({ participation: 'assigned-not-acted' }))
    expect(plate.className).toContain('brd-plate-waiting')
    expect(plate.className).not.toContain('brd-engraved')
  })

  it('uses the department name for an ordinary desk, never its head', () => {
    /*
     * The role title belongs to the head of the table alone. An analytical desk
     * labelled with its manager would put a person where the record names an
     * institution — the desk contributed, not the individual.
     */
    expect(plateFor(desk({ participation: 'acted' }))).not.toHaveTextContent(
      'Head of Macro',
    )
  })

  it('still distinguishes asked-and-silent from never-asked', () => {
    expect(plateFor(desk({ participation: 'assigned-not-acted' }))).toHaveTextContent(
      'Tilldelad · inget registrerat',
    )
  })

  it('still lights a desk that contributed', () => {
    const plate = plateFor(desk({ participation: 'acted', actIds: ['run-1'] }))
    expect(plate).toHaveTextContent('Bidrog i ärendet')
    expect(plate.className).toContain(LIT)
  })
})
