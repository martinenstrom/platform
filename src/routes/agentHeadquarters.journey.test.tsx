/**
 * The journeys, end to end.
 *
 * Two, and they meet in the middle:
 *
 *   Stage B  `/agents` → desk → awaiting run → review → decide
 *   Stage C  `/agents` → desk → commission → live run → review → decide
 *
 * The second one ends where the first one begins, on purpose. That is the loop
 * C2-2 exists to close, and proving it as two separate screens that each render
 * correctly would prove nothing about whether a person can walk from one to the
 * other.
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
 * Each journey's fixtures come from one PostgreSQL database —
 * `agentFloorFixture.pg.test.ts` for the first, `commission.pg.test.ts` for the
 * second — so the run id the desk links to is the run id the review resolves,
 * and the case the commission surface offers is the case the run was actually
 * issued against. Captures from separate databases would have had separate ids,
 * and every connection these tests exist to prove would have had to be faked to
 * make them pass.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

/*
 * The institution's door, replaced wholesale.
 *
 * Every act-scoped function is a `vi.fn()`, so the only one that matters here
 * is observable: `commissionAnalysisFn` is what the commission journey has to
 * prove is called, with exactly the case and evidence set the person selected.
 * Mocking the module rather than spying on it also keeps a PostgreSQL driver
 * out of a jsdom suite.
 */
vi.mock('~/infrastructure/analysis/serverFns', () => ({
  getAgentDirectoryFn: vi.fn(),
  getAgentDeskFn: vi.fn(),
  getRunReviewFn: vi.fn(),
  getOperatorIdentitiesFn: vi.fn(),
  getCommissionBriefFn: vi.fn(),
  commissionAnalysisFn: vi.fn(),
  acceptContributionFn: vi.fn(),
  rejectContributionFn: vi.fn(),
}))

import { AgentFloorPage } from './agents.index'
import { AgentDeskPage } from './agents.$departmentId'
import { RunReviewPage } from './runs.$runId'
import { CommissionPage } from './agents_.$departmentId.commission'
import { commissionAnalysisFn } from '~/infrastructure/analysis/serverFns'
import floorFixture from '~/test/fixtures/agentFloor.mixed.json'
import reviewFixture from '~/test/fixtures/agentFloor.awaitingReview.json'
import operatorFixture from '~/test/fixtures/operatorIdentities.json'
import commissionFloorFixture from '~/test/fixtures/commissionFloor.json'
import commissionBriefFixture from '~/test/fixtures/commissionBrief.json'
import commissionResultFixture from '~/test/fixtures/commissionResult.json'
import commissionReviewFixture from '~/test/fixtures/commissionReview.json'
import type { AgentDesk } from '~/application/analysis/agentDirectory'
import type { CommissionBrief } from '~/application/analysis/commissionAnalysis'
import type { RunReview } from '~/application/analysis/runReview'
import type { OperatorIdentity } from '~/application/analysis/operatorIdentity'
import type { CommissionResponse } from '~/infrastructure/analysis/serverFns'

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
    expect(
      within(row).getByText(new RegExp(`Ärende: ${awaitingRun.caseId}`)),
    ).toBeInTheDocument()
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

/* ==================================================== Stage C — the commission */

/**
 * The other half of the loop: a person gives a desk work, and follows it to the
 * decision it produces.
 *
 * Stage B proved a person can reach work that already existed. This proves they
 * can cause it to exist — starting where a user starts, clicking what a user
 * sees, and arriving at the same review surface Stage B built.
 *
 * ## Every fixture below came out of one database
 *
 * `commission.pg.test.ts` opens a case pinned to `macro-regime` v2 and a case
 * pinned to v1, saves one real ECB observation, commissions the v2 case through
 * `commissionAnalysis`, and captures the floor, the brief, the result and the
 * review from that same runtime. So the run id the commission returns is the
 * run id the review resolves, and the case the brief offers is the case the
 * commission was actually issued against. Fixtures from four databases would
 * have made every connection this test exists to prove a fabrication.
 *
 * ## The one thing that is stood in for
 *
 * `commissionAnalysisFn` — because calling it for real would spend money. What
 * the test asserts about it is therefore the part a render cannot fake: that it
 * was invoked with exactly the case, evidence set, entry and operator the person
 * selected, and nothing the page decided on their behalf.
 */

const commissionDesks = commissionFloorFixture as unknown as readonly AgentDesk[]
const brief = commissionBriefFixture as unknown as CommissionBrief
const commissionResult = commissionResultFixture as unknown as Extract<
  CommissionResponse,
  { ok: true }
>['result']
const commissionReview = commissionReviewFixture as unknown as RunReview

/** Found rather than named: the case the firm will actually take work against. */
const eligibleCase = brief.cases.find(
  (candidate) => candidate.eligibility.kind === 'eligible',
)!
const refusedCase = brief.cases.find(
  (candidate) => candidate.eligibility.kind === 'refused',
)!
const offeredEvidence = brief.evidence.find(
  (offer) => offer.eligibility.kind === 'eligible',
)!
const macroDesk = commissionDesks.find((desk) => desk.departmentId === 'global-macro')!

async function startAtHeadquartersToCommission() {
  const rootRoute = createRootRoute()

  const floorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/agents',
    component: () => <AgentFloorPage response={{ ok: true, desks: commissionDesks }} />,
  })

  const deskRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/agents/$departmentId',
    component: function Desk() {
      const { departmentId } = deskRoute.useParams()
      const desk = commissionDesks.find(
        (candidate) => candidate.departmentId === departmentId,
      )
      return (
        <AgentDeskPage
          response={desk ? { ok: true, desk } : { ok: false, code: 'NOT_FOUND' }}
        />
      )
    },
  })

  const commissionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/agents/$departmentId/commission',
    component: function Commission() {
      const { departmentId } = commissionRoute.useParams()
      /*
       * Resolved by the parameter in the URL, exactly as the server function
       * does. A component returning the fixture regardless would make "the
       * right desk" untestable.
       */
      return (
        <CommissionPage
          brief={
            departmentId === brief.desk.departmentId
              ? { ok: true, brief }
              : { ok: false, code: 'NOT_FOUND' }
          }
          operators={{ ok: true, identities }}
        />
      )
    },
  })

  const reviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/runs/$runId',
    component: function Review() {
      const { runId } = reviewRoute.useParams()
      return (
        <RunReviewPage
          review={
            runId === commissionReview.run.id
              ? { ok: true, review: commissionReview }
              : { ok: false, code: 'NOT_FOUND' }
          }
          operators={{ ok: true, identities }}
        />
      )
    },
  })

  const caseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/cases/$caseId',
    component: () => null,
  })

  const router = createRouter({
    routeTree: rootRoute.addChildren([
      floorRoute,
      deskRoute,
      commissionRoute,
      reviewRoute,
      caseRoute,
    ]),
    history: createMemoryHistory({ initialEntries: ['/agents'] }),
  })
  await router.load()
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test tree, not the app's */
  render(<RouterProvider router={router as any} />)
  return { router, user: userEvent.setup() }
}

/** Fixture text is prose; a question mark in it must not become a quantifier. */
function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('a person can commission a real analysis and follow it to a decision', () => {
  beforeEach(() => {
    vi.mocked(commissionAnalysisFn).mockReset()
    /* Nobody has chosen an operator. The journey has to do it, like a person. */
    window.sessionStorage.clear()
  })

  it('walks Headquarters → desk → commission → live run → review, by clicking', async () => {
    vi.mocked(commissionAnalysisFn).mockResolvedValue({
      ok: true,
      result: commissionResult,
    } as never)

    const { router, user } = await startAtHeadquartersToCommission()

    /* 1. The floor. */
    expect(screen.getByRole('heading', { name: 'Agenter' })).toBeInTheDocument()

    /* 2. Into the desk that can be commissioned. */
    await user.click(screen.getByRole('link', { name: macroDesk.name }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: macroDesk.name })).toBeInTheDocument(),
    )

    /* 3. Into the commission surface, through the link the desk renders. */
    await user.click(screen.getByRole('link', { name: 'Beställ analys' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/agents/${macroDesk.departmentId}/commission`,
      ),
    )

    /*
     * 4. The page says what is being ordered and that it costs money, before
     *    anything can be clicked.
     */
    expect(screen.getByText('Live · kostar riktiga pengar')).toBeInTheDocument()
    expect(screen.getByText(brief.currentBrief)).toBeInTheDocument()

    /* 5. An explicit existing case. Nothing is preselected. */
    const caseChoice = screen.getByRole('radio', {
      name: new RegExp(escapeForRegExp(eligibleCase.investmentCase.question)),
    })
    expect((caseChoice as HTMLInputElement).checked).toBe(false)
    await user.click(caseChoice)

    /*
     * 6. And the case the firm will not take this work against is visible and
     *    unselectable rather than quietly absent.
     */
    expect(
      screen.getByRole('radio', {
        name: new RegExp(escapeForRegExp(refusedCase.investmentCase.question)),
      }),
    ).toBeDisabled()

    /* 7. An explicit eligible evidence set. */
    await user.click(
      screen.getByRole('radio', {
        name: new RegExp(escapeForRegExp(offeredEvidence.evidenceSetId.slice(0, 12))),
      }),
    )

    /* 8. A named operator, who the act is booked to. */
    await user.selectOptions(screen.getByLabelText('Du agerar som'), 'macro-head')

    /*
     * 9. The authorization appears once the case is chosen — the number this
     *    run would actually record, not one the page invented.
     */
    expect(screen.getByText(/12[\s ]?000 tokens/)).toBeInTheDocument()

    /* 10. Commission. This is the live-run command boundary. */
    await user.click(screen.getByRole('button', { name: 'Beställ analys' }))

    await waitFor(() => expect(commissionAnalysisFn).toHaveBeenCalledTimes(1))
    /*
     * Exactly what the person selected, and nothing chosen for them. A page
     * that defaulted the case or the evidence set would still have rendered
     * correctly and commissioned the wrong work.
     */
    expect(commissionAnalysisFn).toHaveBeenCalledWith({
      data: {
        caseId: eligibleCase.investmentCase.id,
        departmentId: brief.desk.departmentId,
        entryKey: brief.entryKey,
        evidenceSetId: offeredEvidence.evidenceSetId,
        actingEmployeeId: 'macro-head',
      },
    })

    /* 11. The persisted result, reported as the firm recorded it. */
    await waitFor(() =>
      expect(screen.getByText('Körningen är bokförd.')).toBeInTheDocument(),
    )
    expect(screen.getByText('Väntar på godkännande')).toBeInTheDocument()

    /* 12. And straight on into the existing review, by clicking. */
    await user.click(screen.getByRole('link', { name: 'Granska och besluta' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/runs/${commissionReview.run.id}`),
    )

    /* 13. Which is this run's produced work, waiting on a decision. */
    expect(
      screen.getByRole('heading', { name: commissionReview.investmentCase.question }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(commissionReview.produced[0]!.claim.statement),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ditt beslut' })).toBeInTheDocument()
  })

  it('will not commission until all three choices have been made', async () => {
    const { user } = await startAtHeadquartersToCommission()

    await user.click(screen.getByRole('link', { name: macroDesk.name }))
    await waitFor(() => screen.getByRole('heading', { name: macroDesk.name }))
    await user.click(screen.getByRole('link', { name: 'Beställ analys' }))
    await waitFor(() => screen.getByRole('button', { name: 'Beställ analys' }))

    /*
     * Nothing selected: the control is inert and the page says which choice is
     * missing. A button that spends money must not be pressable before the
     * person has said what it should spend it on.
     */
    const commission = screen.getByRole('button', { name: 'Beställ analys' })
    expect(commission).toBeDisabled()
    expect(screen.getByText('Välj ett ärende.')).toBeInTheDocument()

    await user.click(
      screen.getByRole('radio', {
        name: new RegExp(escapeForRegExp(eligibleCase.investmentCase.question)),
      }),
    )
    expect(
      screen.getByText('Välj vilket underlag avdelningen ska få.'),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('radio', {
        name: new RegExp(escapeForRegExp(offeredEvidence.evidenceSetId.slice(0, 12))),
      }),
    )
    expect(screen.getByText('Välj vem du agerar som.')).toBeInTheDocument()
    expect(commission).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Du agerar som'), 'macro-head')
    expect(commission).toBeEnabled()
    expect(commissionAnalysisFn).not.toHaveBeenCalled()
  })
})
