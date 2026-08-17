/**
 * The journey, end to end: `/agents` → desk → awaiting run → review → decide.
 *
 * **This test exists because Stage B shipped unreachable.** Every piece worked
 * and was proved in isolation — the floor rendered real desks, the review
 * rendered real produced work, the commands accepted and rejected — and the
 * actual path a person walks did not arrive anywhere useful. Clicking a run on
 * a desk landed on the case overview, which describes a decision rather than
 * offering one, and the review surface was reachable only by someone who
 * already knew its URL.
 *
 * A per-page render test cannot catch that. Each page was correct; the route
 * between them was the defect. So this navigates rather than renders: it starts
 * where a user starts, clicks what a user sees, and asserts where they land.
 *
 * ## It follows links, it does not construct them
 *
 * Nothing here builds a URL. The test clicks the anchors the pages actually
 * render, which is the only way to prove the pages render anchors that work —
 * a test that navigated to `/runs/${id}` itself would pass just as happily
 * against a desk with no link on it at all.
 *
 * ## Against real institutional state
 *
 * Both fixtures come from one PostgreSQL database in
 * `agentFloorFixture.pg.test.ts`, so the run id the desk links to is the run id
 * the review resolves. Two captures from two databases would have had two
 * different ids, and the connection this test exists to prove would have had to
 * be faked to make it pass.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { AgentFloorPage } from './agents.index'
import { AgentDeskPage } from './agents.$departmentId'
import { RunReviewPage } from './runs.$runId'
import floorFixture from '~/test/fixtures/agentFloor.mixed.json'
import reviewFixture from '~/test/fixtures/agentFloor.awaitingReview.json'
import operatorFixture from '~/test/fixtures/operatorIdentities.json'
import type { AgentDesk } from '~/application/analysis/agentDirectory'
import type { RunReview } from '~/application/analysis/runReview'
import type { OperatorIdentity } from '~/application/analysis/operatorIdentity'

const desks = floorFixture as unknown as readonly AgentDesk[]
const review = reviewFixture as unknown as RunReview
const identities = operatorFixture as unknown as readonly OperatorIdentity[]

/** The desk holding work that is waiting on a person, found rather than named. */
const deskWithAwaitingWork = desks.find((desk) =>
  desk.runs.some((run) => run.state === 'awaiting-acceptance'),
)!
const awaitingRun = deskWithAwaitingWork.runs.find(
  (run) => run.state === 'awaiting-acceptance',
)!

/**
 * The real pages, wired to the real routes, served from captured state.
 *
 * The loaders stand in for the server functions and nothing else: each page
 * receives exactly the shape its own server function returns, so what is being
 * exercised is the routing and the components, not a simplified stand-in for
 * either.
 */
async function startAtHeadquarters() {
  const rootRoute = createRootRoute()

  const floorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/agents',
    component: () => <AgentFloorPage response={{ ok: true, desks }} />,
  })

  const deskRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/agents/$departmentId',
    component: function Desk() {
      const { departmentId } = deskRoute.useParams()
      const desk = desks.find((candidate) => candidate.departmentId === departmentId)
      return (
        <AgentDeskPage
          response={desk ? { ok: true, desk } : { ok: false, code: 'NOT_FOUND' }}
        />
      )
    },
  })

  const reviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/runs/$runId',
    component: function Review() {
      const { runId } = reviewRoute.useParams()
      /*
       * Resolved by the id in the URL, exactly as the server function does. A
       * component that returned the fixture regardless of the parameter would
       * make "the right run" untestable — and "the current awaiting run,
       * inferred from case state" is precisely the shortcut this journey must
       * not take.
       */
      return (
        <RunReviewPage
          review={
            runId === review.run.id
              ? { ok: true, review }
              : { ok: false, code: 'NOT_FOUND' }
          }
          operators={{ ok: true, identities }}
        />
      )
    },
  })

  /* The case surface is context, not a destination this journey tests. */
  const caseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/cases/$caseId',
    component: () => null,
  })

  const router = createRouter({
    routeTree: rootRoute.addChildren([floorRoute, deskRoute, reviewRoute, caseRoute]),
    history: createMemoryHistory({ initialEntries: ['/agents'] }),
  })
  await router.load()
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test tree, not the app's */
  render(<RouterProvider router={router as any} />)
  return { router, user: userEvent.setup() }
}

describe('a person can reach work awaiting their decision', () => {
  it('walks Headquarters → desk → awaiting run → review, by clicking', async () => {
    const { router, user } = await startAtHeadquarters()

    /* 1. The floor. */
    expect(screen.getByRole('heading', { name: 'Agenter' })).toBeInTheDocument()

    /* 2. Into the desk that owes a decision. */
    await user.click(screen.getByRole('link', { name: deskWithAwaitingWork.name }))
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: deskWithAwaitingWork.name }),
      ).toBeInTheDocument(),
    )

    /*
     * 3. The desk says a decision is owed. Counted off the records — a desk
     *    that held work nobody had judged and did not say so would leave the
     *    decision to whoever happened to scroll.
     */
    expect(screen.getByText(/väntar på ditt beslut/)).toBeInTheDocument()

    /* 4. Into the review, through the call to action the row renders. */
    await user.click(screen.getByRole('link', { name: 'Granska och besluta' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/runs/${awaitingRun.id}`),
    )

    /* 5. And it is THIS run's work, not the case's summary. */
    expect(
      screen.getByRole('heading', { name: review.investmentCase.question }),
    ).toBeInTheDocument()
    expect(screen.getByText(review.produced[0]!.claim.statement)).toBeInTheDocument()
  })

  it('lands on the review with everything needed to judge the work', async () => {
    const { user } = await startAtHeadquarters()

    await user.click(screen.getByRole('link', { name: deskWithAwaitingWork.name }))
    await waitFor(() => screen.getByRole('heading', { name: deskWithAwaitingWork.name }))
    await user.click(screen.getByRole('link', { name: 'Granska och besluta' }))
    await waitFor(() => screen.getByRole('heading', { name: 'Ditt beslut' }))

    /* The produced claim, its evidence with provenance, and its confidence. */
    expect(screen.getByText(review.produced[0]!.claim.statement)).toBeInTheDocument()
    expect(screen.getByText('ECB')).toBeInTheDocument()
    expect(screen.getByText('Officiell dagsnotering')).toBeInTheDocument()
    for (const line of review.produced[0]!.claim.confidence.basis) {
      expect(screen.getByText(line)).toBeInTheDocument()
    }

    /* Acting-as, labelled as operator identity, with both acts present. */
    expect(screen.getByLabelText('Du agerar som')).toBeInTheDocument()
    expect(screen.getByText('Operatörsidentitet — inte inloggning')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Godkänn arbetet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avvisa arbetet' })).toBeInTheDocument()
  })
})

describe('the run row leads to the work, and the case stays context', () => {
  it('does not make the case overview the primary destination', async () => {
    const { user } = await startAtHeadquarters()
    await user.click(screen.getByRole('link', { name: deskWithAwaitingWork.name }))
    await waitFor(() => screen.getByRole('heading', { name: deskWithAwaitingWork.name }))

    const runs = screen.getByRole('heading', { name: /^Körningar/ }).closest('section')!
    const row = within(runs)
      .getAllByRole('listitem')
      .find((item) => within(item).queryByText('Granska och besluta'))!

    /*
     * Both destinations are present and only one is the point. The case link is
     * labelled as context rather than rendered as a bare identifier, which is
     * what made it the obvious target and sent the first manual walkthrough to
     * a page that cannot judge anything.
     */
    const hrefs = within(row)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
    expect(hrefs.filter((href) => href === `/runs/${awaitingRun.id}`)).toHaveLength(2)
    expect(within(row).getByText(new RegExp(`Ärende: ${awaitingRun.caseId}`)))
      .toBeInTheDocument()
  })

  it('offers no decision shortcut on work that is already settled', async () => {
    const { user } = await startAtHeadquarters()
    await user.click(screen.getByRole('link', { name: deskWithAwaitingWork.name }))
    await waitFor(() => screen.getByRole('heading', { name: deskWithAwaitingWork.name }))

    const runs = screen.getByRole('heading', { name: /^Körningar/ }).closest('section')!
    const settled = deskWithAwaitingWork.runs.filter(
      (run) => run.state !== 'awaiting-acceptance',
    )
    /*
     * One call to action, on the one run that owes a decision. A button on
     * settled work would invite a click the institution would refuse.
     */
    expect(within(runs).getAllByText('Granska och besluta')).toHaveLength(1)
    expect(settled.length).toBeGreaterThan(0)
  })
})
