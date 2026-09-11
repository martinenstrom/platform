/**
 * Huvudkontoret, rendered against captured institutional state.
 *
 * **The assertions about what is ABSENT are the load-bearing ones.** The north-star concept image contains a
 * CIO message, a firm view, portfolio exposure, recommendations and alerts. The
 * firm holds none of those: zero theses, zero aggregations, zero governance
 * reviews, zero decisions. A page that rendered them would be fabricating the
 * one thing this product exists not to fabricate.
 *
 * So the rule here is the same one the floor and the queue are held to, pointed
 * at a different failure: **nothing may appear that the record does not
 * contain** — and where the record contains nothing, the page must say so in
 * words rather than leave a handsome empty panel implying otherwise.
 */

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { HeadquartersPage } from './headquarters'
import { commandCenterView } from '~/application/analysis/commandCenter'
import type { CaseListing } from '~/application/analysis/caseListing'
import type { AgentDesk } from '~/application/analysis/agentDirectory'
import type { CommandCenterResponse } from '~/infrastructure/analysis/serverFns'
import { ACT_LABEL } from '~/presentation/analysis/caseStandingText'
import mixed from '~/test/fixtures/caseList.mixed.json'
import floor from '~/test/fixtures/agentFloor.mixed.json'

const cases = mixed as unknown as readonly CaseListing[]
const desks = floor as unknown as readonly AgentDesk[]

const view = (over: Partial<Parameters<typeof commandCenterView>[0]> = {}) =>
  commandCenterView({
    cases,
    desks,
    activity: [],
    evidenceSetCount: 3,
    latestAssemblyAt: '2026-08-19T22:21:48.761Z',
    ...over,
  })

async function withRouter(ui: ReactNode) {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> })
  const children = ['/cases/$caseId', '/agents/$departmentId', '/evidence'].map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => null }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren(children),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test tree, not the app's */
  return render(<RouterProvider router={router as any} />)
}

/**
 * The workstation is rendered from Huvudkontoret and from nowhere else, so the
 * suite renders it the way the product does: the whole page, with the case
 * queue the firm's work actually arrives in.
 */
const renderCenter = (response?: CommandCenterResponse) =>
  withRouter(
    <HeadquartersPage
      center={response ?? { ok: true, view: view() }}
      cases={{ ok: true, cases }}
    />,
  )

const card = (heading: RegExp) =>
  screen.getByRole('heading', { name: heading }).closest('section')!

describe('the firm opens with what it owes', () => {
  it('leads with attention, then the floor, then activity', async () => {
    await renderCenter()
    const headings = screen
      .getAllByRole('heading')
      .map((node) => node.textContent ?? '')
      .filter((text) =>
        /uppmärksamhet|^Investment Floor|Institutionell aktivitet/.test(text),
      )

    /*
     * Order is the argument the composition makes, and it survives the
     * reference-matching pass: what the firm owes reads before the floor, and
     * the floor before the feed.
     */
    expect(headings[0]).toMatch(/uppmärksamhet/)
    expect(headings[1]).toMatch(/Investment Floor/)
    expect(headings[2]).toMatch(/Institutionell aktivitet/)
  })

  it('shows the act the domain says is owed, in the domain’s words', async () => {
    await renderCenter()
    const owed = card(/uppmärksamhet/)
    const outstanding = cases.filter((entry) => !entry.standing.settled)

    /* The act leads each row: what is owed reads before which case owes it. */
    for (const entry of outstanding) {
      expect(
        within(owed).getAllByText(ACT_LABEL[entry.standing.nextAct.act]).length,
      ).toBeGreaterThan(0)
    }
  })

  it('says an act has no surface rather than hiding the obligation', async () => {
    /*
     * The measured twenty-acts-versus-four-screens gap, made visible. An
     * obligation dropped because the product cannot act on it would be the
     * product deciding what the firm owes.
     */
    await renderCenter()
    const owed = card(/uppmärksamhet/)
    expect(within(owed).getAllByText(/ingen yta ännu/).length).toBeGreaterThan(0)
  })

  it('links every obligation to the case it belongs to', async () => {
    await renderCenter()
    const owed = card(/uppmärksamhet/)
    const outstanding = cases.filter((entry) => !entry.standing.settled)

    /*
     * Asserted on hrefs rather than by accessible name: two cases in the
     * fixture ask the same question, which is a real thing a firm does, and a
     * lookup by text would fail for a reason that has nothing to do with links.
     */
    const hrefs = within(owed)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
    for (const entry of outstanding) {
      expect(hrefs).toContain(`/cases/${entry.investmentCase.id}`)
    }
  })
})

describe('the floor keeps the firm’s own structure', () => {
  it('separates control functions from the desks they review', async () => {
    await renderCenter()
    const floorCard = card(/^Investment Floor/)
    /*
     * Two tiers on one floor: specialists above, independent control functions
     * below their own bronze rule, converging on the CIO seat. The separation
     * is what must hold, and it is now carried by the organisation's shape
     * rather than by a badge repeated on each module.
     */
    expect(
      within(floorCard).getByText('Oberoende kontrollfunktioner'),
    ).toBeInTheDocument()
    expect(within(floorCard).getByText('Specialistdeskar')).toBeInTheDocument()
    expect(within(floorCard).getByText('CIO-syntes')).toBeInTheDocument()
  })

  it('links a desk to its workspace rather than opening an application', async () => {
    await renderCenter()
    const floorCard = card(/^Investment Floor/)
    const desk = desks[0]!
    expect(
      within(floorCard).getByRole('link', { name: new RegExp(desk.name) }),
    ).toHaveAttribute('href', `/agents/${desk.departmentId}`)
  })
})

describe('what the page must never contain', () => {
  it('renders no CIO message, firm view, recommendation or exposure', async () => {
    /*
     * Each of these exists in the concept image and in none of the firm's
     * records. They are absent by measurement, not by oversight.
     */
    await renderCenter()
    /*
     * Asserted on REGION HEADINGS, not on any occurrence of a word. The Risk
     * desk's real accountability — "downside, adverse scenarios, tail risk" —
     * is institutional state read from the organisation, and a test that
     * banned the word would be banning the firm from describing what Risk
     * does. What must not exist is the panel.
     */
    const headings = screen.getAllByRole('heading').map((node) => node.textContent ?? '')
    for (const forbidden of [
      /CIO-meddelande/i,
      /Firmans uppfattning/i,
      /Rekommendation/i,
      /Exponering/i,
      /Portfölj/i,
      /Scenario/i,
      /Sentiment/i,
      /AUM/i,
    ]) {
      expect(headings.filter((heading) => forbidden.test(heading))).toEqual([])
    }
  })

  it('has no progress indicator anywhere', async () => {
    await renderCenter()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('states what the firm cannot answer instead of leaving an empty panel', async () => {
    /*
     * A firm that has completed no step at all — which is the firm's actual
     * state for six of the seven steps at the time of writing. The mixed
     * fixture deliberately contains a decided case, so it is the wrong witness
     * for an absence.
     */
    const untouched = cases.map((entry) => ({
      ...entry,
      standing: {
        ...entry.standing,
        steps: entry.standing.steps.map((step) => ({
          ...step,
          status: 'outstanding' as const,
        })),
      },
    }))
    await renderCenter({ ok: true, view: view({ cases: untouched }) })

    const gap = card(/Vad firman kan svara på/)
    /*
     * The coverage module marks every step the workflow defines and which the
     * firm has never reached. `saknas` is the absence, stated — not "coming
     * soon", which would promise something nobody has decided to build.
     */
    /* Eight since playbook v5 added the peer-examination step. */
    expect(within(gap).getAllByText('saknas')).toHaveLength(8)
    expect(within(gap).getByText('Tes formulerad')).toBeInTheDocument()
    expect(within(gap).getByText('CIO-beslut')).toBeInTheDocument()
  })

  it('does not mark a step some case has completed as missing', async () => {
    /* The mixed fixture holds a decided case, so the module must not overstate. */
    await renderCenter()
    const gap = card(/Vad firman kan svara på/)
    /*
     * `queryAll`, not `getAll`: this fixture's firm has reached every step, so
     * the honest expectation is none marked missing — and `getAllByText` would
     * throw on the empty case rather than assert it.
     */
    expect(within(gap).queryAllByText('saknas').length).toBeLessThan(7)
    expect(within(gap).getByText('Tes formulerad')).toBeInTheDocument()
  })

  it('marks the CIO seat inactive when no decision has ever been taken', async () => {
    /*
     * The reference's CIO Decision Panel says the chief "weighs analyses and
     * decides". Against a firm that has never recorded a decision the seat is
     * still drawn — it is part of the organisation — and it states the absence
     * instead of implying an act.
     */
    const untouchedFirm = cases.map((entry) => ({
      ...entry,
      standing: {
        ...entry.standing,
        steps: entry.standing.steps.map((step) => ({
          ...step,
          status: 'outstanding' as const,
        })),
      },
    }))
    await renderCenter({ ok: true, view: view({ cases: untouchedFirm }) })

    const floorCard = card(/^Investment Floor/)
    expect(within(floorCard).getByText('CIO-syntes')).toBeInTheDocument()
    expect(within(floorCard).getByText(/Inget CIO-beslut är fattat/)).toBeInTheDocument()
    expect(
      within(floorCard).queryByText(/fattar beslut|sammanväger analyser/i),
    ).not.toBeInTheDocument()
  })
})

describe('activity is the record, or it is nothing', () => {
  it('says there is no activity rather than filling the space', async () => {
    await renderCenter()
    expect(screen.getByText('Ingen aktivitet')).toBeInTheDocument()
  })

  it('renders a real event as a sentence built from its states', async () => {
    const activity = [
      {
        at: '2026-08-20T17:09:04.466Z',
        departmentId: desks[0]!.departmentId,
        subject: 'run' as const,
        fromState: 'running',
        toState: 'completed',
        caseId: 'case-1',
      },
    ]
    await renderCenter({ ok: true, view: view({ activity }) })

    const feed = card(/Institutionell aktivitet/)
    expect(within(feed).getByText(desks[0]!.name)).toBeInTheDocument()
    expect(within(feed).getByText('lämnade in sitt underlag')).toBeInTheDocument()
  })
})

describe('the failed state', () => {
  it('renders a failure as a sentence, never as its code', async () => {
    await renderCenter({ ok: false, code: 'SERVICE_UNAVAILABLE' })
    expect(screen.getByText('Analysmiljön svarar inte just nu.')).toBeInTheDocument()
    expect(screen.queryByText(/SERVICE_UNAVAILABLE|postgres/)).not.toBeInTheDocument()
  })

  it('distinguishes a missing configuration from an unreachable database', async () => {
    await renderCenter({ ok: false, code: 'NOT_CONFIGURED' })
    expect(
      screen.getByText('Analysmiljön saknar databaskonfiguration.'),
    ).toBeInTheDocument()
  })
})
