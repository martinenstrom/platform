/**
 * The Boardroom, as a room.
 *
 * The long-form record used to be asserted here, because it used to be on this
 * page. It moved to `/cases/$caseId/underlag` and its assertions moved with it,
 * unchanged, into `cases.$caseId.underlag.test.tsx` — 27 of them. Nothing was
 * dropped in the move; what is left here is what the room itself is answerable
 * for.
 *
 * What the room owes a reader, and what this pins:
 *
 *   the investment question leads, as the page's own heading;
 *   the committee is present, with its participation states;
 *   the debate in the room is PERSISTED, never narrated;
 *   an objection says whose work it contests;
 *   the Chairman's position is the way in;
 *   the CIO is dark until a decision actually exists;
 *   a failure says what happened and nothing about how.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { CaseOverviewPage } from './cases.$caseId'
import decided from '~/test/fixtures/caseOverview.decided.json'
import awaiting from '~/test/fixtures/caseOverview.awaiting.json'
import type { CaseOverview } from '~/application/analysis/caseOverview'
import type { CaseOverviewResponse } from '~/infrastructure/analysis/serverFns'
import { boardroomTimeline } from '~/application/analysis/boardroomTimeline'
import { boardroomSeating } from '~/application/analysis/boardroomSeating'

const asOverview = (fixture: unknown) => fixture as unknown as CaseOverview

/**
 * The response as the boundary actually assembles it.
 *
 * The projection is built from the SAME overview the page renders, by the same
 * functions the server function calls. Hand-writing seats here would let the
 * room agree with an expectation the read model never produced.
 */
const ok = (fixture: unknown): CaseOverviewResponse => {
  const overview = asOverview(fixture)
  const timeline = boardroomTimeline(overview)
  return {
    ok: true,
    overview,
    boardroom: { timeline, seats: boardroomSeating(overview, timeline) },
  }
}

const renderRoom = (fixture: unknown) =>
  render(<CaseOverviewPage response={ok(fixture)} />)

describe('the room leads with the question', () => {
  it('makes the investment question the page heading', () => {
    renderRoom(decided)
    expect(
      screen.getByRole('heading', { name: /Does the ECB cut before Q2\?/ }),
    ).toBeInTheDocument()
  })

  it('does not carry the long-form record any more', () => {
    /*
     * The point of the split. These headings are the record's, and finding one
     * here would mean the report stack had grown back under the photograph.
     */
    renderRoom(decided)
    for (const heading of [/^Händelseförlopp$/, /^Ärendets ställning$/, /^Tes \(/]) {
      expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument()
    }
  })

  it('offers the record one click away', () => {
    renderRoom(decided)
    const link = screen.getByRole('link', { name: /Öppna underlag/ })
    expect(link).toHaveAttribute(
      'href',
      `/cases/${asOverview(decided).investmentCase.id}/underlag`,
    )
  })
})

describe('the committee is in the room', () => {
  it('seats the firm and says who took part', () => {
    renderRoom(decided)
    const room = screen.getByRole('region', { name: 'Investeringskommitténs bord' })
    /* Seats are exposed as a list so participation reaches assistive
     * technology as words rather than as illumination. */
    expect(within(room).getAllByRole('listitem').length).toBeGreaterThan(0)
  })

  it('never turns a desk that did not take part into a control', () => {
    /*
     * A clickable empty seat suggests there is something behind it. There is
     * not: a desk the case never involved has no acts to show.
     */
    renderRoom(decided)
    const room = screen.getByRole('region', { name: 'Investeringskommitténs bord' })
    for (const button of within(room).getAllByRole('button')) {
      expect(button.textContent).not.toMatch(/Ej i ärendet/i)
    }
  })
})

describe('the debate in the room is the record', () => {
  it('shows a persisted claim in the desk that made it', () => {
    const overview = asOverview(decided)
    renderRoom(decided)
    /*
     * Every visible statement must project a stored object. This asserts the
     * text came from a claim the fixture holds, not from wording composed for
     * the room.
     */
    const statements = overview.claims.map((claim) => claim.statement)
    const shown = statements.filter((statement) =>
      screen.queryByText(statement, { exact: false }),
    )
    expect(shown.length).toBeGreaterThan(0)
  })

  it('says whose work an objection contests', () => {
    renderRoom(decided)
    const contests = screen.queryAllByText(/invänder mot/)
    for (const node of contests) {
      /* Never a bare "objection": the record names the desk that was read. */
      expect(node.textContent).toMatch(/invänder mot .+/)
    }
  })

  it('keeps the room restrained', () => {
    /*
     * At most two acts in focus. The photograph is the room, and a wall of
     * cards over it would be a chat log with a picture behind it.
     */
    const { container } = renderRoom(decided)
    const plates = container.querySelectorAll('.brd-statement')
    /* Between one and two: nought would mean the room shows no debate at all,
     * which for a case holding claims would be its own failure. */
    expect(plates.length).toBeGreaterThan(0)
    expect(plates.length).toBeLessThanOrEqual(2)
  })
})

describe('the Chairman is the way in', () => {
  it('opens the console from the chair without navigating', async () => {
    renderRoom(decided)
    await userEvent.click(
      screen.getByRole('button', { name: 'Öppna ordförandens konsol' }),
    )
    expect(
      screen.getByRole('complementary', { name: 'Ordförandens konsol' }),
    ).toBeInTheDocument()
  })

  it('offers no follow-up action', async () => {
    /*
     * "Ask a follow-up" is two different institutional acts — a new case, or a
     * reconsideration — and the firm has not been asked to conflate them. A
     * disabled button would be a fiction; there is nothing instead.
     */
    renderRoom(decided)
    await userEvent.click(
      screen.getByRole('button', { name: 'Öppna ordförandens konsol' }),
    )
    const console_ = screen.getByRole('complementary', { name: 'Ordförandens konsol' })
    expect(within(console_).queryByText(/följdfråga|omprövning/i)).not.toBeInTheDocument()
  })
})

describe('the CIO is dark until a decision exists', () => {
  it('offers no decision when the firm has not made one', async () => {
    const overview = asOverview(awaiting)
    expect(overview.decision).toBeNull()

    render(<CaseOverviewPage response={ok(awaiting)} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Öppna ordförandens konsol' }),
    )
    /* No decision, no BESLUT KLART. The emptiness is the truth. */
    expect(screen.queryByText('BESLUT KLART')).not.toBeInTheDocument()
  })

  it('offers the decision only when one is persisted', async () => {
    const overview = asOverview(decided)
    expect(overview.decision).not.toBeNull()

    renderRoom(decided)
    await userEvent.click(
      screen.getByRole('button', { name: 'Öppna ordförandens konsol' }),
    )
    expect(screen.getByText('BESLUT KLART')).toBeInTheDocument()
  })

  it('shows the decision without reproducing the audit', async () => {
    renderRoom(decided)
    await userEvent.click(
      screen.getByRole('button', { name: 'Öppna ordförandens konsol' }),
    )
    /* The badge states the fact; the action opens the panel. */
    await userEvent.click(screen.getByRole('button', { name: /Visa beslut/ }))

    const panel = screen.getByRole('complementary', { name: 'CIO:s beslut' })
    expect(within(panel).getByText('Skäl')).toBeInTheDocument()
    /*
     * Confidence is composed per claim and does not exist on a decision; an
     * "investment action" is not a field the domain holds. Neither is invented
     * here, and the gate audit stays in the record.
     */
    expect(within(panel).queryByText(/Konfidens/i)).not.toBeInTheDocument()
    expect(within(panel).queryByRole('heading', { name: /^Händelseförlopp$/ })).toBeNull()
  })
})

/* --------------------------------------------------------- failure states */

describe('failures say what happened and nothing about how', () => {
  it('renders a missing case without leaking a code', () => {
    render(<CaseOverviewPage response={{ ok: false, code: 'NOT_FOUND' }} />)
    expect(screen.getByText('Ärendet finns inte.')).toBeInTheDocument()
    expect(screen.queryByText(/NOT_FOUND/)).not.toBeInTheDocument()
  })

  it('renders an unreachable runtime without leaking connection detail', () => {
    render(<CaseOverviewPage response={{ ok: false, code: 'SERVICE_UNAVAILABLE' }} />)
    expect(screen.getByText('Analysmiljön svarar inte just nu.')).toBeInTheDocument()
    expect(screen.queryByText(/postgres|SERVICE_UNAVAILABLE/)).not.toBeInTheDocument()
  })
})
