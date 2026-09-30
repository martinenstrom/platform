/**
 * The presence: at rest beside the page, engaged when asked, alive across
 * navigation, and talking to nothing but the host contract.
 *
 * Rendered the way the product mounts it — as a sibling of the routed page
 * under the root — so what survives navigation here is what survives it in
 * the app. The firm is mocked at the one door the presence may use.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostResult } from '~/application/analysis/hostContract'
import type { CaseOverview } from '~/application/analysis/caseOverview'
import { boardroomSeating } from '~/application/analysis/boardroomSeating'
import { boardroomTimeline } from '~/application/analysis/boardroomTimeline'
import { AppLayout } from '~/components/layout/AppLayout'
import {
  financialOsHostFn,
  getCaseOverviewFn,
  getCurrentOperatorFn,
} from '~/infrastructure/analysis/serverFns'
import {
  askJarvisFn,
  closeLiveSessionFn,
  liveSessionStateFn,
  openLiveSessionFn,
  typeIntoLiveSessionFn,
} from '~/infrastructure/jarvis/serverFns'
import type { CaseOverviewResponse } from '~/infrastructure/analysis/serverFns'
import decided from '~/test/fixtures/caseOverview.decided.json'
import { JarvisPresence } from './JarvisPresence'
import { resetPresence } from './presenceStore'

vi.mock('~/infrastructure/analysis/serverFns', () => ({
  financialOsHostFn: vi.fn(),
  getCurrentOperatorFn: vi.fn(),
  getCaseOverviewFn: vi.fn(),
  resumeConveningFn: vi.fn(),
}))

/* The voice door, mocked at the one module the presence may use for it. */
vi.mock('~/infrastructure/jarvis/serverFns', () => ({
  askJarvisFn: vi.fn(),
  openLiveSessionFn: vi.fn(),
  liveSessionStateFn: vi.fn(),
  typeIntoLiveSessionFn: vi.fn(),
  closeLiveSessionFn: vi.fn(),
}))

const host = vi.mocked(financialOsHostFn)
const operator = vi.mocked(getCurrentOperatorFn)
const overview = vi.mocked(getCaseOverviewFn)
/* The typed door: one router for voice and text. A typed question goes here, never straight to the firm. */
const askJarvis = vi.mocked(askJarvisFn)
const openLive = vi.mocked(openLiveSessionFn)
const liveState = vi.mocked(liveSessionStateFn)
const typeLive = vi.mocked(typeIntoLiveSessionFn)
const closeLive = vi.mocked(closeLiveSessionFn)

/*
 * jsdom has no WebRTC and no microphone. These stand-ins hold the shape the
 * voice client needs and let a test speak down the data channel as the
 * provider would. What is proved is the wiring: the presence's button, the
 * door it calls, the conversation the words land in, and what ends a session.
 */
class FakeDataChannel extends EventTarget {
  readyState = 'open'
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = 'closed'
  })
  emit(event: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }))
  }
}
class FakePeerConnection extends EventTarget {
  static last: FakePeerConnection | null = null
  iceGatheringState = 'complete'
  connectionState = 'connected'
  localDescription: { type: string; sdp: string } | null = null
  channel: FakeDataChannel | null = null
  addTrack = vi.fn()
  close = vi.fn()
  setRemoteDescription = vi.fn(async () => {})
  constructor() {
    super()
    FakePeerConnection.last = this
  }
  async createOffer() {
    return { type: 'offer', sdp: 'v=0 offer' }
  }
  async setLocalDescription(description: { type: string; sdp: string }) {
    this.localDescription = description
  }
  createDataChannel() {
    this.channel = new FakeDataChannel()
    return this.channel
  }
}
const track = { kind: 'audio', stop: vi.fn() }
const getUserMedia = vi.fn(async () => ({
  getAudioTracks: () => [track],
  getTracks: () => [track],
}))

beforeAll(() => {
  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    value: FakePeerConnection,
    configurable: true,
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    value: vi.fn(async () => {}),
    configurable: true,
  })
})

const channel = () => FakePeerConnection.last!.channel!
const micButton = () => screen.getByRole('button', { name: /Starta röst|Avsluta röst/ })

/** Presses the microphone and takes the session to `session.started`. */
async function goLive(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
  await user.click(screen.getByRole('button', { name: 'Starta röst' }))
  await screen.findByRole('button', { name: 'Avsluta röst' })
  await act(async () =>
    channel().emit({ type: 'session.started', session: { id: 'live-1' } }),
  )
}

/**
 * The record the surfaces render, as the boundary actually assembles it —
 * a case the institution produced, projected by the same functions the
 * server function calls. The room and the record are asserted in depth by
 * their own route tests; here they only have to be recognisably themselves.
 */
const decidedCase: CaseOverviewResponse = (() => {
  const record = decided as unknown as CaseOverview
  const timeline = boardroomTimeline(record)
  return {
    ok: true,
    overview: record,
    boardroom: { timeline, seats: boardroomSeating(record, timeline) },
  }
})()

const reference = {
  system: 'financial-os',
  kind: 'case',
  id: 'case-1',
  provenanceId: 'prov-1',
} as const

const context = {
  reference,
  question: 'Är Nvidia köpvärd?',
  subject: 'Nvidia',
  surfaces: { boardroom: '/cases/case-1', record: '/cases/case-1/underlag' },
  activity: {
    stage: 'research' as const,
    desks: [{ id: 'rates', name: 'Rates', isGovernance: false }],
    outstanding: [],
    inFlight: 0,
    expired: 0,
    awaitingAdoption: 0,
    failed: 0,
  },
  amendments: { count: 0, latestAt: null, workPredates: false },
}

const td88: HostResult = {
  ...context,
  state: 'needs-decision',
  decision: { reason: 'institutional-initialization-required' },
}

const routerStages = {
  tier: 'router' as const,
  intentMs: 900,
  routed: 'tool' as const,
  toolNames: ['delegate_to_financial_os'],
  dataMs: null,
  composeMs: 800,
  modelPasses: 2,
  contextAttached: false,
  totalMs: 1700,
}

/** What the router answers a typed Nvidia question with: a delegation the firm bound, relayed in words. */
const delegated = {
  ok: true as const,
  say: 'Kommittén är sammankallad men saknar en utgångstes.',
  reference,
  lastAsk: { question: 'Är Nvidia köpvärd?', subject: 'Nvidia' },
  state: 'needs-decision',
  toolCalls: ['delegate_to_financial_os'],
  backendMs: 12,
  spoken: false,
  stages: routerStages,
  marketContext: null,
}

/** A market answer: no case, no reference, words from fresh data, and the brief's time to hand back. */
const marketAnswer = {
  ok: true as const,
  say: 'S&P 500 är upp 0,4 procent och Nasdaq 100 0,7. Tech leder; tioåringen ligger kring 4,1 procent.',
  reference: null,
  lastAsk: null,
  state: 'market-snapshot',
  toolCalls: ['get_market_snapshot'],
  backendMs: 9,
  spoken: false,
  stages: { ...routerStages, toolNames: ['get_market_snapshot'], dataMs: 40 },
  /* A time inside the presence's ten-minute memory of a brief, whenever the test runs. */
  marketContext: { at: new Date().toISOString(), scope: 'us' as const },
}

async function mountApp(initial = '/') {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <AppLayout>
          <Outlet />
        </AppLayout>
        <JarvisPresence />
      </>
    ),
  })
  const children = [
    '/',
    '/evidence',
    '/headquarters',
    '/settings',
    '/cases/$caseId',
    '/cases/$caseId/underlag',
  ].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <p>{path}</p>,
    }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren(children),
    history: createMemoryHistory({ initialEntries: [initial] }),
  })
  await router.load()
  render(<RouterProvider router={router as never} />)
  return router
}

const presence = () => screen.getByRole('complementary', { name: 'JARVIS' })

async function askNvidia(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
  await user.type(screen.getByLabelText('Fråga'), 'Är Nvidia köpvärd?')
  await user.type(screen.getByLabelText('Om'), 'Nvidia')
  await user.click(screen.getByRole('button', { name: 'Ställ frågan' }))
}

beforeEach(() => {
  resetPresence()
  host.mockReset()
  operator.mockReset()
  operator.mockResolvedValue({ ok: false, code: 'NOT_CONFIGURED' })
  overview.mockReset()
  overview.mockResolvedValue(decidedCase)
  askJarvis.mockReset()
  askJarvis.mockResolvedValue(delegated)
  openLive.mockReset()
  openLive.mockResolvedValue({ ok: true, sessionId: 'live-1', sdp: 'v=0 answer' })
  liveState.mockReset()
  liveState.mockResolvedValue({ ok: false, code: 'NOT_FOUND' })
  typeLive.mockReset()
  typeLive.mockResolvedValue({ ...marketAnswer, spoken: true })
  closeLive.mockReset()
  closeLive.mockResolvedValue({ ok: false, code: 'NOT_FOUND' })
  getUserMedia.mockClear()
  getUserMedia.mockResolvedValue({
    getAudioTracks: () => [track],
    getTracks: () => [track],
  })
  track.stop.mockClear()
  FakePeerConnection.last = null
})

/* -------------------------------------------------------------- at rest */

describe('at rest', () => {
  it('is a narrow strip with a mark, a name and a microphone that is off until pressed', async () => {
    await mountApp()
    const strip = presence()
    expect(
      within(strip).getByRole('button', { name: 'Öppna JARVIS' }),
    ).toBeInTheDocument()
    expect(within(strip).getByText('JARVIS')).toBeInTheDocument()
    const mic = within(strip).getByRole('button', { name: 'Starta röst' })
    expect(mic).toHaveAttribute('aria-pressed', 'false')
    expect(mic).toHaveTextContent('Röst')
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(within(strip).queryByLabelText('Fråga')).toBeNull()
  })

  it('is not another menu', async () => {
    await mountApp()
    /* The landing page owns its shell; nothing named Huvudnavigation appears there. */
    expect(screen.queryByRole('navigation', { name: 'Huvudnavigation' })).toBeNull()
    expect(within(presence()).queryByRole('navigation')).toBeNull()
  })
})

/* ------------------------------------------------------------- engaged */

describe('engaged', () => {
  it('routes a typed question through JARVIS, never straight to the firm, and shows what came back', async () => {
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)

    expect(askJarvis).toHaveBeenCalledTimes(1)
    expect(host).not.toHaveBeenCalled()
    const sent = askJarvis.mock.calls[0]![0] as { data: Record<string, unknown> }
    /* The line, the hint, and where the advisor is — the route, never an id of the browser's choosing. */
    expect(sent.data).toEqual({
      text: 'Är Nvidia köpvärd?',
      subject: 'Nvidia',
      context: { route: '/' },
    })
    /* No actor of any name crosses the door. */
    expect(Object.keys(sent.data).sort()).toEqual(['context', 'subject', 'text'])

    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    expect(within(log).getByText('Är Nvidia köpvärd?')).toBeInTheDocument()
    expect(
      within(log).getByText('Kommittén är sammankallad men saknar en utgångstes.'),
    ).toBeInTheDocument()
  })

  it('answers a market question with fresh words and opens no case', async () => {
    askJarvis.mockResolvedValue(marketAnswer)
    const user = userEvent.setup()
    await mountApp()
    await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
    /* No subject is needed for a question about the market. */
    await user.type(screen.getByLabelText('Fråga'), 'Hur ser amerikanska börsen ut idag?')
    await user.click(screen.getByRole('button', { name: 'Ställ frågan' }))

    expect(askJarvis).toHaveBeenCalledTimes(1)
    expect((askJarvis.mock.calls[0]![0] as { data: unknown }).data).toEqual({
      text: 'Hur ser amerikanska börsen ut idag?',
      context: { route: '/' },
    })
    expect(host).not.toHaveBeenCalled()
    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    expect(within(log).getByText(/S&P 500 är upp 0,4 procent/)).toBeInTheDocument()
    expect(
      within(presence()).queryByRole('region', { name: 'Aktivt ärende' }),
    ).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem('jarvis:presence')).not.toContain(
      '"id":"case-1"',
    )
  })

  it('sends the conversation so far with a follow-up, so "varför?" is about something', async () => {
    askJarvis
      .mockResolvedValueOnce(marketAnswer)
      .mockResolvedValueOnce({ ...marketAnswer, say: 'För att räntan steg.' })
    const user = userEvent.setup()
    await mountApp()
    await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
    await user.type(screen.getByLabelText('Fråga'), 'Hur ser amerikanska börsen ut idag?')
    await user.click(screen.getByRole('button', { name: 'Ställ frågan' }))
    await user.type(screen.getByLabelText('Fråga'), 'Varför?')
    await user.click(screen.getByRole('button', { name: 'Ställ frågan' }))

    expect(askJarvis).toHaveBeenCalledTimes(2)
    const first = (askJarvis.mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(first).toEqual({
      text: 'Hur ser amerikanska börsen ut idag?',
      context: { route: '/' },
    })
    const second = (askJarvis.mock.calls[1]![0] as { data: Record<string, unknown> }).data
    expect(second).toEqual({
      text: 'Varför?',
      history: [
        { by: 'user', text: 'Hur ser amerikanska börsen ut idag?' },
        { by: 'jarvis', text: marketAnswer.say },
      ],
      /* The brief's time goes back with the follow-up, so it is answered over the same numbers. */
      marketContext: { at: marketAnswer.marketContext.at },
      context: { route: '/' },
    })
    expect(window.sessionStorage.getItem('jarvis:presence')).toContain(
      `"marketContextAt":"${marketAnswer.marketContext.at}"`,
    )
    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    expect(within(log).getByText('För att räntan steg.')).toBeInTheDocument()
  })

  it('says so, in a sentence, when JARVIS cannot answer', async () => {
    askJarvis.mockResolvedValue({ ok: false, code: 'NOT_CONFIGURED' })
    const user = userEvent.setup()
    await mountApp()
    await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
    await user.type(screen.getByLabelText('Fråga'), 'Hur går börsen?')
    await user.click(screen.getByRole('button', { name: 'Ställ frågan' }))
    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    expect(within(log).getByText('JARVIS kunde inte svara just nu.')).toBeInTheDocument()
  })

  it('says beside any state what the person added, and whether the work already done saw it', async () => {
    host.mockResolvedValueOnce({
      ...td88,
      amendments: { count: 1, latestAt: '2026-09-16T08:00:00.000Z', workPredates: true },
    })
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)
    await user.click(screen.getByRole('button', { name: 'Var står det?' }))

    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    expect(
      within(log).getByText(
        /Ett tillägg sedan ärendet öppnades; det arbete som redan gjorts tar inte hänsyn till det senaste\./,
      ),
    ).toBeInTheDocument()
    expect(within(log).getByText('En sak innan de sätter igång.')).toBeInTheDocument()
  })

  it('says a closed case is closed, and how, when asked where it stands', async () => {
    host.mockResolvedValueOnce({
      ...context,
      state: 'closed',
      closure: {
        kind: 'cancelled',
        reason: 'Behövs inte längre.',
        at: '2026-09-16T08:00:00.000Z',
        byDesk: { id: 'research-office', name: 'Research Office', isGovernance: false },
      },
    })
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)
    await user.click(screen.getByRole('button', { name: 'Var står det?' }))

    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    expect(within(log).getByText('Ärendet är stängt.')).toBeInTheDocument()
    expect(
      within(log).getByText(/Pågående arbete avbröts — Behövs inte längre\./),
    ).toBeInTheDocument()
    expect(within(log).queryByText(/återkommer/)).not.toBeInTheDocument()
  })

  it('binds the conversation to the reference and offers the deeper surfaces', async () => {
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)

    const active = within(presence()).getByRole('region', { name: 'Aktivt ärende' })
    expect(within(active).getByText('Nvidia')).toBeInTheDocument()
    expect(
      within(active).getByRole('button', { name: /Visa hur ni kom fram till det/ }),
    ).toBeInTheDocument()
    expect(
      within(active).getByRole('button', { name: /Visa underlaget/ }),
    ).toBeInTheDocument()
    /* The pointer, in the tab's own memory. Not the thesis. */
    expect(window.sessionStorage.getItem('jarvis:presence')).toContain('"id":"case-1"')
    expect(window.sessionStorage.getItem('jarvis:presence')).not.toContain('thesis')
  })

  it('asks the firm again for a follow-up rather than answering from memory', async () => {
    host.mockResolvedValueOnce({
      ...context,
      state: 'blocked',
      block: {
        reason: 'verification-required',
        owner: { id: 'verification', name: 'Verification', isGovernance: true },
      },
    })
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)
    await user.click(screen.getByRole('button', { name: 'Var står det?' }))

    expect(host).toHaveBeenCalledTimes(1)
    expect((host.mock.calls[0]![0] as { data: unknown }).data).toEqual({
      kind: 'status',
      reference,
    })
    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    expect(
      within(log).getByText('Analysen kan inte fortsätta just nu.'),
    ).toBeInTheDocument()
    expect(within(log).getByText(/Faktagranskningen/)).toBeInTheDocument()
  })

  it('says three different things for work, no way forward, and a decision', async () => {
    host
      .mockResolvedValueOnce({ ...context, state: 'working' })
      .mockResolvedValueOnce({
        ...context,
        state: 'blocked',
        block: { reason: 'synthesis-required', owner: null },
      })
      .mockResolvedValueOnce(td88)
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)
    await user.click(screen.getByRole('button', { name: 'Var står det?' }))
    await user.click(screen.getByRole('button', { name: 'Var står det?' }))
    await user.click(screen.getByRole('button', { name: 'Var står det?' }))

    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    const said = within(log)
      .getAllByRole('listitem')
      .filter((item) => item.getAttribute('data-by') === 'jarvis')
      .map((item) => item.querySelector('p')?.textContent)
    expect(said).toEqual([
      'Kommittén är sammankallad men saknar en utgångstes.',
      'Jag kollar på det.',
      'Analysen kan inte fortsätta just nu.',
      'En sak innan de sätter igång.',
    ])
  })

  it('reads the committee’s conclusion from the result, with its dissent', async () => {
    host.mockResolvedValueOnce({
      ...context,
      state: 'answer-ready',
      kind: 'committee-conclusion',
      answer: {
        kind: 'committee-conclusion',
        inquiry: 'judgement',
        thesis: {
          revisionId: 'rev-2',
          statement: 'Kurvan prisar in en mjuklandning.',
          position: 'hold',
          invalidationCriteria: 'Realräntorna stiger över 2,5 %.',
          implications: [],
          proposedByDepartmentId: 'research-office',
        },
        synthesisedBy: null,
        scrutiny: {
          verification: 'verified',
          risk: null,
          peerExaminations: 0,
          devilsAdvocateReviews: 1,
        },
        dissent: [],
        materialDissentCount: 0,
        priorDissent: [],
      },
    })
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)
    await user.click(screen.getByRole('button', { name: 'Vad kom ni fram till?' }))

    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    expect(within(log).getByText('Jag är klar.')).toBeInTheDocument()
    expect(within(log).getByText(/Kommitténs slutsats är hold/)).toBeInTheDocument()
    expect(
      within(log).getByText(/Ingen materiell invändning kvarstår/),
    ).toBeInTheDocument()
  })

  it('tells the truth when no operator is configured, and binds to nothing', async () => {
    /* The firm refused the delegation; the router relays that, and nothing was opened. */
    askJarvis.mockResolvedValue({
      ok: true,
      say: 'Det gick inte igenom: ingen operatör är konfigurerad (NOT_CONFIGURED).',
      reference: null,
      lastAsk: null,
      state: 'failed',
      toolCalls: ['delegate_to_financial_os'],
      backendMs: 7,
      spoken: false,
      stages: routerStages,
      marketContext: null,
    })
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)

    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    expect(within(log).getByText(/ingen operatör är konfigurerad/)).toBeInTheDocument()
    expect(within(presence()).queryByRole('region', { name: 'Aktivt ärende' })).toBeNull()
    expect(window.sessionStorage.getItem('jarvis:presence')).not.toContain(
      '"id":"case-1"',
    )
  })

  it('collapses on Escape inside the panel, and only inside it', async () => {
    const user = userEvent.setup()
    await mountApp()
    await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
    expect(screen.getByLabelText('Fråga')).toBeInTheDocument()

    /* Escape elsewhere on the page — the HQ's own — does not touch the presence. */
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(screen.getByLabelText('Fråga')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Fråga'))
    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('Fråga')).toBeNull()
    expect(screen.getByRole('button', { name: 'Öppna JARVIS' })).toBeInTheDocument()
  })
})

/* ------------------------------------------------ the deeper surfaces */

describe('the deeper surfaces, opened beside the conversation', () => {
  const surface = (name: 'Styrelserummet' | 'Underlaget') =>
    screen.getByRole('region', { name })

  it('opens the Boardroom over the page, asks the firm for the case, and keeps the HQ beneath', async () => {
    host.mockResolvedValue(td88)
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)
    await user.click(
      screen.getByRole('button', { name: /Visa hur ni kom fram till det/ }),
    )

    /* The canonical room: the fixture's investment question is its heading. */
    const room = surface('Styrelserummet')
    expect(
      await within(room).findByRole('heading', { name: /Does the ECB cut before Q2\?/ }),
    ).toBeInTheDocument()
    expect(overview).toHaveBeenCalledWith({ data: 'case-1' })
    /* Its own door out to the page as a page. */
    expect(within(room).getByRole('link', { name: /Öppna som sida/ })).toHaveAttribute(
      'href',
      '/cases/case-1',
    )
    /* The page beneath is still there, and so is the conversation. */
    expect(screen.getByText('/')).toBeInTheDocument()
    expect(within(presence()).getByRole('list', { name: 'Samtal' })).toBeInTheDocument()
    expect(window.sessionStorage.getItem('jarvis:presence')).toContain(
      '"surface":"boardroom"',
    )
  })

  it('opens the record the same way', async () => {
    host.mockResolvedValue(td88)
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)
    await user.click(screen.getByRole('button', { name: /Visa underlaget/ }))

    const record = surface('Underlaget')
    expect(
      await within(record).findByRole('heading', { name: 'Underlag' }),
    ).toBeInTheDocument()
    expect(
      within(record).getByRole('heading', { name: /Händelseförlopp/ }),
    ).toBeInTheDocument()
    expect(within(record).getByRole('link', { name: /Öppna som sida/ })).toHaveAttribute(
      'href',
      '/cases/case-1/underlag',
    )
  })

  it('closes on its own Escape and on its close button, leaving the conversation and the panel', async () => {
    host.mockResolvedValue(td88)
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)
    await user.click(
      screen.getByRole('button', { name: /Visa hur ni kom fram till det/ }),
    )
    await within(surface('Styrelserummet')).findByRole('heading', {
      name: /Does the ECB cut before Q2\?/,
    })

    /* The close button took focus on opening, so Escape lands in the surface. */
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Styrelserummet' })).toBeNull()
    expect(screen.getByLabelText('Fråga')).toBeInTheDocument()
    expect(
      within(presence()).getByText('Kommittén är sammankallad men saknar en utgångstes.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Visa underlaget/ }))
    await within(surface('Underlaget')).findByRole('heading', { name: 'Underlag' })
    await user.click(screen.getByRole('button', { name: 'Stäng underlaget' }))
    expect(screen.queryByRole('region', { name: 'Underlaget' })).toBeNull()
    expect(window.sessionStorage.getItem('jarvis:presence')).toContain('"surface":null')
  })

  it('goes with the panel when the panel collapses', async () => {
    host.mockResolvedValue(td88)
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)
    await user.click(
      screen.getByRole('button', { name: /Visa hur ni kom fram till det/ }),
    )
    await within(surface('Styrelserummet')).findByRole('heading', {
      name: /Does the ECB cut before Q2\?/,
    })
    await user.click(screen.getByRole('button', { name: 'Fäll ihop JARVIS' }))
    expect(screen.queryByRole('region', { name: 'Styrelserummet' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Öppna JARVIS' })).toBeInTheDocument()
  })

  it('says what the route would say when the case cannot be read', async () => {
    host.mockResolvedValue(td88)
    overview.mockResolvedValue({ ok: false, code: 'NOT_FOUND' })
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)
    await user.click(
      screen.getByRole('button', { name: /Visa hur ni kom fram till det/ }),
    )
    expect(
      await within(surface('Styrelserummet')).findByText('Ärendet finns inte.'),
    ).toBeInTheDocument()
  })

  it('survives a navigation beneath it', async () => {
    host.mockResolvedValue(td88)
    const user = userEvent.setup()
    const router = await mountApp()
    await askNvidia(user)
    await user.click(screen.getByRole('button', { name: /Visa underlaget/ }))
    await within(surface('Underlaget')).findByRole('heading', { name: 'Underlag' })
    await act(async () => {
      await router.navigate({ to: '/evidence' })
    })
    expect(screen.getByRole('region', { name: 'Underlaget' })).toBeInTheDocument()
    expect(screen.getByText('/evidence')).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------- voice */

describe('the microphone', () => {
  it('starts a real session through the door — an offer and nothing else — and shows its states', async () => {
    const user = userEvent.setup()
    await mountApp()
    await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
    await user.click(screen.getByRole('button', { name: 'Starta röst' }))

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    const mic = await screen.findByRole('button', { name: 'Avsluta röst' })
    expect(mic).toHaveAttribute('aria-pressed', 'true')
    expect(openLive).toHaveBeenCalledTimes(1)
    const sent = (openLive.mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(Object.keys(sent)).toEqual(['sdp'])
    expect(sent.sdp).toBe('v=0 offer')
    expect(FakePeerConnection.last!.setRemoteDescription).toHaveBeenCalledWith({
      type: 'answer',
      sdp: 'v=0 answer',
    })
    expect(mic).toHaveTextContent('Ansluter…')

    await act(async () =>
      channel().emit({ type: 'session.started', session: { id: 'live-1' } }),
    )
    expect(micButton()).toHaveTextContent('Lyssnar')
    await act(async () =>
      channel().emit({
        type: 'session.output_transcript.delta',
        delta: 'Ett ögonblick.',
        start_ms: 3000,
        end_ms: 3600,
      }),
    )
    expect(micButton()).toHaveTextContent('Talar')
  })

  it('puts what is said, by either side, into the one conversation', async () => {
    const user = userEvent.setup()
    await mountApp()
    await goLive(user)
    await act(async () => {
      channel().emit({
        type: 'session.input_transcript.delta',
        delta: ' Jarvis, hur ser du',
        start_ms: 1000,
        end_ms: 1600,
      })
      channel().emit({
        type: 'session.input_transcript.delta',
        delta: ' på Nvidia?',
        start_ms: 1600,
        end_ms: 2400,
      })
      channel().emit({
        type: 'session.output_transcript.delta',
        delta: 'Ett ögonblick.',
        start_ms: 2400,
        end_ms: 3000,
      })
    })
    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    const items = within(log)
      .getAllByRole('listitem')
      .filter((item) => item.getAttribute('data-by'))
    expect(items.map((item) => item.getAttribute('data-by'))).toEqual(['user', 'jarvis'])
    expect(items[0]).toHaveTextContent('Jarvis, hur ser du på Nvidia?')
    expect(items[1]).toHaveTextContent('Ett ögonblick.')
    expect(within(items[0]!).getByLabelText('sagt')).toBeInTheDocument()
    /* And it is the same memory the typed path uses. */
    expect(window.sessionStorage.getItem('jarvis:presence')).toContain('Ett ögonblick.')
  })

  it('keeps everything JARVIS says until the person speaks again in one bubble', async () => {
    const user = userEvent.setup()
    await mountApp()
    await goLive(user)
    await act(async () => {
      channel().emit({
        type: 'session.input_transcript.delta',
        delta: ' Hur ser du på Nvidia?',
        start_ms: 1000,
        end_ms: 2400,
      })
      /* An acknowledgement, a pause of seconds, then the answer: one reply. */
      channel().emit({
        type: 'session.output_transcript.delta',
        delta: 'Ett ögonblick.',
        start_ms: 2400,
        end_ms: 3000,
      })
      channel().emit({
        type: 'session.output_transcript.delta',
        delta: 'Jag behöver ditt beslut först.',
        start_ms: 6500,
        end_ms: 8000,
      })
      /* The person speaks again: what follows is a new reply. */
      channel().emit({
        type: 'session.input_transcript.delta',
        delta: ' Okej.',
        start_ms: 9000,
        end_ms: 9400,
      })
      channel().emit({
        type: 'session.output_transcript.delta',
        delta: 'Bra.',
        start_ms: 9600,
        end_ms: 9900,
      })
    })
    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    const items = within(log)
      .getAllByRole('listitem')
      .filter((item) => item.getAttribute('data-by'))
    expect(items.map((item) => item.getAttribute('data-by'))).toEqual([
      'user',
      'jarvis',
      'user',
      'jarvis',
    ])
    expect(items[1]).toHaveTextContent('Ett ögonblick. Jag behöver ditt beslut först.')
    expect(items[3]).toHaveTextContent('Bra.')
    expect(items[3]).not.toHaveTextContent('Ett ögonblick.')
  })

  it('sends a typed line into the live session, shows the routed answer once, and routes again as text once the session ends', async () => {
    const user = userEvent.setup()
    await mountApp()
    await goLive(user)
    await user.type(screen.getByLabelText('Fråga'), 'Hur går börsen?')
    await user.click(screen.getByRole('button', { name: 'Skicka in i samtalet' }))
    expect(typeLive).toHaveBeenCalledWith({
      data: { sessionId: 'live-1', text: 'Hur går börsen?' },
    })
    /* And the brief's time the reply carried is remembered for the next line. */
    expect(window.sessionStorage.getItem('jarvis:presence')).toContain(
      `"marketContextAt":"${marketAnswer.marketContext.at}"`,
    )
    expect(host).not.toHaveBeenCalled()
    expect(askJarvis).not.toHaveBeenCalled()
    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    expect(within(log).getByText('Hur går börsen?')).toBeInTheDocument()
    /* The routed answer, as text, at once. */
    expect(within(log).getByText(/S&P 500 är upp 0,4 procent/)).toBeInTheDocument()
    /* The voice then says the same answer; its transcript is not a second bubble. */
    await act(async () => {
      channel().emit({
        type: 'session.output_transcript.delta',
        delta: 'S&P 500 är upp',
        start_ms: 5000,
        end_ms: 5600,
      })
      channel().emit({
        type: 'session.output_transcript.delta',
        delta: ' 0,4 procent.',
        start_ms: 5600,
        end_ms: 6200,
      })
    })
    const jarvisBubbles = () =>
      within(log)
        .getAllByRole('listitem')
        .filter((item) => item.getAttribute('data-by') === 'jarvis')
    expect(jarvisBubbles()).toHaveLength(1)
    /* The person speaking again ends the echo: the next reply is shown. */
    await act(async () => {
      channel().emit({
        type: 'session.input_transcript.delta',
        delta: ' Och tech?',
        start_ms: 9000,
        end_ms: 9500,
      })
      channel().emit({
        type: 'session.output_transcript.delta',
        delta: 'Tech leder.',
        start_ms: 9700,
        end_ms: 10200,
      })
    })
    expect(jarvisBubbles()).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Avsluta röst' }))
    await screen.findByRole('button', { name: 'Starta röst' })
    await user.type(screen.getByLabelText('Fråga'), 'Är Nvidia köpvärd?')
    await user.type(screen.getByLabelText('Om'), 'Nvidia')
    await user.click(screen.getByRole('button', { name: 'Ställ frågan' }))
    expect(askJarvis).toHaveBeenCalledTimes(1)
    expect(host).not.toHaveBeenCalled()
    expect(within(log).getByText('Hur går börsen?')).toBeInTheDocument()
  })

  it('opens bound to the case a typed question already gave the conversation', async () => {
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)
    await user.click(screen.getByRole('button', { name: 'Starta röst' }))
    await screen.findByRole('button', { name: 'Avsluta röst' })
    const sent = (openLive.mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(Object.keys(sent).sort()).toEqual(['reference', 'sdp'])
    expect(sent.reference).toEqual(reference)
  })

  it('binds the conversation to the case a spoken delegation opened', async () => {
    liveState.mockResolvedValue({
      ok: true,
      closed: false,
      reference,
      lastAsk: { question: 'Hur ser du på Nvidia?', subject: 'Nvidia' },
      telemetry: {
        voiceSeconds: 12,
        voiceCostUsd: 0.01,
        backend: { costUsd: 0.001 },
        reason: null,
      } as never,
    })
    const user = userEvent.setup()
    await mountApp()
    await goLive(user)
    await act(async () =>
      channel().emit({
        type: 'session.delegation.created',
        delegation: { id: 'd1', target: 'responses' },
      }),
    )
    const active = await within(presence()).findByRole('region', {
      name: 'Aktivt ärende',
    })
    expect(within(active).getByText('Nvidia')).toBeInTheDocument()
    expect(window.sessionStorage.getItem('jarvis:presence')).toContain('"id":"case-1"')
  })

  it('ends the paid session when pressed again, when the presence collapses, and when the conversation is forgotten', async () => {
    const user = userEvent.setup()
    await mountApp()
    await goLive(user)
    await user.click(screen.getByRole('button', { name: 'Avsluta röst' }))
    expect(closeLive).toHaveBeenCalledWith({ data: { sessionId: 'live-1' } })
    expect(track.stop).toHaveBeenCalled()
    expect(FakePeerConnection.last!.close).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Starta röst' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    closeLive.mockClear()
    await user.click(screen.getByRole('button', { name: 'Starta röst' }))
    await screen.findByRole('button', { name: 'Avsluta röst' })
    await user.click(screen.getByRole('button', { name: 'Fäll ihop JARVIS' }))
    expect(closeLive).toHaveBeenCalledWith({ data: { sessionId: 'live-1' } })

    closeLive.mockClear()
    await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
    await user.click(screen.getByRole('button', { name: 'Starta röst' }))
    await screen.findByRole('button', { name: 'Avsluta röst' })
    await user.click(screen.getByRole('button', { name: 'Glöm samtalet' }))
    expect(closeLive).toHaveBeenCalledWith({ data: { sessionId: 'live-1' } })
  })

  it('leaves JARVIS usable when the microphone is blocked', async () => {
    getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    )
    const user = userEvent.setup()
    await mountApp()
    await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
    await user.click(screen.getByRole('button', { name: 'Starta röst' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Mikrofonen är blockerad i webbläsaren. Skriv i stället.',
    )
    expect(openLive).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Starta röst' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Fråga'), 'Är Nvidia köpvärd?')
    await user.type(screen.getByLabelText('Om'), 'Nvidia')
    await user.click(screen.getByRole('button', { name: 'Ställ frågan' }))
    expect(askJarvis).toHaveBeenCalledTimes(1)
  })

  it('says so, in a sentence, when the door refuses, and lets the microphone go', async () => {
    openLive.mockResolvedValueOnce({ ok: false, code: 'PROVIDER_REFUSED' })
    const user = userEvent.setup()
    await mountApp()
    await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
    await user.click(screen.getByRole('button', { name: 'Starta röst' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Rösttjänsten avböjde just nu. Skriv i stället.',
    )
    expect(track.stop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Starta röst' })).toBeInTheDocument()
    expect(within(presence()).getByRole('list', { name: 'Samtal' })).toBeInTheDocument()
  })

  it('reports the server closing an idle session, and is ready to start again', async () => {
    const user = userEvent.setup()
    await mountApp()
    await goLive(user)
    await act(async () =>
      channel().emit({
        type: 'session.closed',
        reason: 'idle 90 s',
        usage: { seconds: 95 },
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Röstsessionen stängdes efter tystnad.',
    )
    expect(screen.getByRole('button', { name: 'Starta röst' })).toBeInTheDocument()
    expect(track.stop).toHaveBeenCalled()
  })
})

/* --------------------------------------------------- across navigation */

describe('across navigation', () => {
  it('keeps the conversation while the page beneath it changes', async () => {
    host.mockResolvedValue(td88)
    const user = userEvent.setup()
    const router = await mountApp()
    await askNvidia(user)

    await act(async () => {
      await router.navigate({ to: '/evidence' })
    })
    /* The shell route brought its own navigation; the presence is still open, still holding the turn. */
    expect(
      screen.getByRole('navigation', { name: 'Huvudnavigation' }),
    ).toBeInTheDocument()
    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    expect(
      within(log).getByText('Kommittén är sammankallad men saknar en utgångstes.'),
    ).toBeInTheDocument()
    expect(
      within(presence()).getByRole('region', { name: 'Aktivt ärende' }),
    ).toBeInTheDocument()

    await act(async () => {
      await router.navigate({ to: '/' })
    })
    expect(within(presence()).getByRole('list', { name: 'Samtal' })).toBeInTheDocument()
  })

  it('makes room on a shell route while engaged, and gives it back', async () => {
    /*
     * The landing page reserves the former rail column itself. A shell route
     * reserves the resting strip, and the engaged width while the panel is
     * open — measured on Huvudkontoret, where the panel otherwise covered
     * half the convene form.
     */
    const user = userEvent.setup()
    await mountApp('/evidence')
    const shell = () =>
      screen
        .getByRole('navigation', { name: 'Huvudnavigation' })
        .closest('.min-h-screen')!
    expect(shell().className).toContain('pl-16')
    await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
    expect(shell().className).toContain('pl-[306px]')
    await user.click(screen.getByRole('button', { name: 'Fäll ihop JARVIS' }))
    expect(shell().className).toContain('pl-16')
  })

  it('offers the doors the rail used to, as shortcuts and not as a menu', async () => {
    const user = userEvent.setup()
    await mountApp()
    await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
    const doors = within(presence()).getByRole('navigation', { name: 'Genvägar' })
    /* The JARVIS gateway is unfolded here: the presence is JARVIS, and offers its doors, not itself. */
    expect(within(doors).queryByRole('link', { name: 'JARVIS' })).toBeNull()
    for (const [label, href] of [
      ['Huvudkontor', '/headquarters'],
      ['Klienter', '/clients'],
      ['Sentinel', '/sentinel'],
      ['Marknadspåverkan', '/market-impact'],
      ['Underlag', '/evidence'],
      ['Inställningar', '/settings'],
    ]) {
      expect(within(doors).getByRole('link', { name: label })).toHaveAttribute(
        'href',
        href,
      )
    }
  })
})

/* ------------------------------------------------------- context awareness */

describe('it looks at the same Financial OS the advisor does', () => {
  /** A client page's loaded view, as the route would hand it to the shell. */
  const view = (displayName: string, clientId: string) => ({
    ok: true,
    view: {
      client: { id: clientId, displayName },
      today: '2026-09-23',
      nextMeeting:
        clientId === 'cl-dahlqvist' ? { occursOn: '2026-10-02', daysAhead: 9 } : null,
      openCommitments: clientId === 'cl-dahlqvist' ? [{ overdue: true }] : [],
      liabilities: [],
      contextFacts: [{ category: 'concern', status: 'active' }],
    },
  })
  const advisoryAnswer = {
    scope: 'CLIENT',
    intent: 'OPEN_COMMITMENTS',
    about: {
      kind: 'client',
      id: 'cl-dahlqvist',
      label: 'Anna & Per Dahlqvist',
      href: '/clients/cl-dahlqvist',
      switched: false,
    },
    sections: [
      {
        key: 'promises',
        items: [
          {
            kind: 'commitment',
            nature: 'fact',
            sourceIds: ['co-1'],
            overdue: true,
            daysToDue: -6,
            commitment: {
              id: 'co-1',
              clientId: 'cl-dahlqvist',
              title: 'Skicka samlat finansieringsförslag',
              createdAt: '2026-09-02',
              dueDate: '2026-09-17',
              status: 'open',
              priority: 'high',
              ownerAdvisorId: 'adv-sofia',
              completedAt: null,
              provenance: {
                origin: 'seed',
                sourceInteractionId: null,
                sourceText: null,
                sourceDate: '2026-09-02',
                createdAt: '2026-09-02T09:00:00.000Z',
                createdBy: 'adv-sofia',
                confidence: 'high',
                confirmedByAdvisor: true,
                confirmedAt: '2026-09-02T09:00:00.000Z',
              },
            },
          },
        ],
      },
    ],
    sources: [
      {
        id: 'co-1',
        type: 'commitment',
        label: 'Skicka samlat finansieringsförslag',
        date: '2026-09-17',
      },
    ],
    actions: [],
    titles: { 'co-1': 'Skicka samlat finansieringsförslag' },
    today: '2026-09-23',
    confidence: 'high',
    method: 'advisory-rules-v1',
    askedAt: '2026-09-23T10:00:00.000Z',
  } as const

  async function mountClients(initial: string) {
    const rootRoute = createRootRoute({
      component: () => (
        <>
          <AppLayout>
            <Outlet />
          </AppLayout>
          <JarvisPresence />
        </>
      ),
    })
    const clients = createRoute({
      getParentRoute: () => rootRoute,
      path: '/clients/$clientId',
      loader: ({ params }) =>
        Promise.resolve(
          params.clientId === 'cl-dahlqvist'
            ? view('Anna & Per Dahlqvist', 'cl-dahlqvist')
            : view('Henrik Alvarsson', 'cl-alvarsson'),
        ),
      component: () => <p>klient</p>,
    })
    const office = createRoute({
      getParentRoute: () => rootRoute,
      path: '/clients/office/$officeId',
      loader: () =>
        Promise.resolve({
          ok: true,
          book: { office: { id: 'of-strandvagen', displayName: 'Strandvägen' } },
        }),
      component: () => <p>kontor</p>,
    })
    const plain = ['/', '/clients', '/sentinel'].map((path) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path,
        component: () => <p>{path}</p>,
      }),
    )
    const router = createRouter({
      routeTree: rootRoute.addChildren([clients, office, ...plain]),
      history: createMemoryHistory({ initialEntries: [initial] }),
    })
    await router.load()
    render(<RouterProvider router={router as never} />)
    return router
  }

  it('names the client on screen, knows the few things the page loaded, and offers the client’s questions', async () => {
    const user = userEvent.setup()
    await mountClients('/clients/cl-dahlqvist')
    /* At rest: the client's initials, named in full for assistive technology. */
    expect(screen.getByLabelText('Kontext: Anna & Per Dahlqvist')).toHaveTextContent('AD')
    await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
    expect(within(presence()).getByLabelText('Kontext')).toHaveTextContent(
      'Anna & Per Dahlqvist',
    )
    const knows = within(presence()).getByRole('region', { name: 'JARVIS vet' })
    expect(knows).toHaveTextContent('Möte om 9 dagar')
    expect(knows).toHaveTextContent('1 försenat åtagande')
    expect(knows).toHaveTextContent('1 aktiv oro')
    const quick = within(presence()).getByRole('navigation', { name: 'Snabbfrågor' })
    expect(
      within(quick).getByRole('button', { name: 'Vad har jag lovat?' }),
    ).toBeInTheDocument()
    expect(within(quick).queryByRole('button', { name: /börsen/ })).toBeNull()
  })

  it('asks about the client on screen without the name, and renders the record’s answer as its sections', async () => {
    askJarvis.mockResolvedValue({
      ok: true,
      advisory: advisoryAnswer,
      context: {
        scope: 'CLIENT',
        route: '/clients/cl-dahlqvist',
        clientId: 'cl-dahlqvist',
        capabilities: [],
      },
    } as never)
    const user = userEvent.setup()
    await mountClients('/clients/cl-dahlqvist')
    await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
    await user.click(screen.getByRole('button', { name: 'Vad har jag lovat?' }))
    expect(askJarvis).toHaveBeenCalledTimes(1)
    expect(
      (askJarvis.mock.calls[0]![0] as { data: Record<string, unknown> }).data,
    ).toEqual({
      text: 'Vad har jag lovat?',
      context: { route: '/clients/cl-dahlqvist' },
    })
    expect(host).not.toHaveBeenCalled()
    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    /* The headline, and the section of the same name beneath it. */
    expect(await within(log).findAllByText('Du lovade')).toHaveLength(2)
    const section = within(log).getByRole('region', { name: 'Du lovade' })
    expect(section).toHaveTextContent('Skicka samlat finansieringsförslag')
    expect(section).toHaveTextContent(/försenat 6 dagar/)
    /* The evidence, on request — never a chain of thought. */
    expect(
      within(log).getByText(/Varför säger JARVIS detta\? · 1 underlag/),
    ).toBeInTheDocument()
    expect(
      within(log).getByText(/Åtagande · Skicka samlat finansieringsförslag/),
    ).toBeInTheDocument()
  })

  it('says when it answers about another client than the one on screen, and offers the door', async () => {
    askJarvis.mockResolvedValue({
      ok: true,
      advisory: {
        ...advisoryAnswer,
        intent: 'CLIENT_SUMMARY',
        about: {
          kind: 'client',
          id: 'cl-alvarsson',
          label: 'Henrik Alvarsson',
          href: '/clients/cl-alvarsson',
          switched: true,
        },
        actions: [{ kind: 'open-client', href: '/clients/cl-alvarsson' }],
      },
      context: {
        scope: 'CLIENT',
        route: '/clients/cl-dahlqvist',
        clientId: 'cl-dahlqvist',
        capabilities: [],
      },
    } as never)
    const user = userEvent.setup()
    const router = await mountClients('/clients/cl-dahlqvist')
    await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
    await user.type(screen.getByLabelText('Fråga'), 'Vad är viktigast med Henrik?')
    await user.click(screen.getByRole('button', { name: 'Ställ frågan' }))
    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    expect(await within(log).findByText(/Svarar om:/)).toHaveTextContent(
      'Henrik Alvarsson',
    )
    expect(within(log).getByRole('link', { name: /Öppna klient/ })).toHaveAttribute(
      'href',
      '/clients/cl-alvarsson',
    )
    /* The screen did not move. */
    expect(router.state.location.pathname).toBe('/clients/cl-dahlqvist')
    expect(within(presence()).getByLabelText('Kontext')).toHaveTextContent(
      'Anna & Per Dahlqvist',
    )
  })

  it('changes context with the route, without a reload: another client, an office, the book', async () => {
    const user = userEvent.setup()
    const router = await mountClients('/clients/cl-dahlqvist')
    await user.click(screen.getByRole('button', { name: 'Öppna JARVIS' }))
    expect(within(presence()).getByLabelText('Kontext')).toHaveTextContent(
      'Anna & Per Dahlqvist',
    )

    await act(async () => {
      await router.navigate({
        to: '/clients/$clientId',
        params: { clientId: 'cl-alvarsson' },
      })
    })
    expect(within(presence()).getByLabelText('Kontext')).toHaveTextContent(
      'Henrik Alvarsson',
    )

    await act(async () => {
      await router.navigate({
        to: '/clients/office/$officeId',
        params: { officeId: 'of-strandvagen' },
      })
    })
    expect(within(presence()).getByLabelText('Kontext')).toHaveTextContent('Strandvägen')
    const quick = within(presence()).getByRole('navigation', { name: 'Snabbfrågor' })
    expect(
      within(quick).getByRole('button', { name: 'Vilka kunder här behöver mig?' }),
    ).toBeInTheDocument()
    expect(within(presence()).queryByRole('region', { name: 'JARVIS vet' })).toBeNull()

    await act(async () => {
      await router.navigate({ to: '/clients' })
    })
    expect(within(presence()).getByLabelText('Kontext')).toHaveTextContent('Klienter')
    expect(
      within(quick).getByRole('button', { name: 'Vem borde jag ringa idag?' }),
    ).toBeInTheDocument()

    await act(async () => {
      await router.navigate({ to: '/' })
    })
    expect(within(presence()).getByLabelText('Kontext')).toHaveTextContent('Marknaden')
    expect(
      within(presence()).queryByRole('navigation', { name: 'Snabbfrågor' }),
    ).toBeNull()
  })
})

/* ---------------------------------------------------------- the boundary */

describe('it talks to one thing', () => {
  it('imports nothing below the host contract', () => {
    /*
     * The ruling: the shell sees six states and typed projections, nothing
     * lower. Every import in this directory is checked against the short list
     * of what "nothing lower" allows.
     */
    const dir = resolve(process.cwd(), 'src/components/jarvis')
    const allowed = [
      /^react$/,
      /^@tanstack\/react-router$/,
      /^lucide-react$/,
      /^~\/lib\//,
      /^~\/types$/,
      /^~\/presentation\/jarvis\//,
      /^~\/infrastructure\/analysis\/serverFns$/,
      /* The voice door: the same kind of boundary, for the live session. */
      /^~\/infrastructure\/jarvis\/serverFns$/,
      /^~\/application\/analysis\/hostContract$/,
      /^~\/application\/analysis\/domainSystem$/,
      /*
       * Context awareness: the typed context the route resolves to, and the
       * typed answer the record returns — projections, like the host
       * contract's, never the record itself.
       */
      /^~\/application\/jarvis\/context$/,
      /^~\/application\/jarvis\/answer$/,
      /*
       * Slice F: the two canonical pages, and only those, so the contextual
       * surfaces are the Boardroom and the record rather than a rendering of
       * their parts. Nothing beneath a page — no DebateFloor, no card, no
       * presentation text — is reachable from here.
       */
      /^~\/components\/boardroom\/CaseOverviewPage$/,
      /^~\/components\/headquarters\/CaseRecord$/,
      /^\.\//,
    ]
    const offenders: string[] = []
    for (const file of readdirSync(dir).filter(
      (name) => /\.tsx?$/.test(name) && !/\.test\./.test(name),
    )) {
      const source = readFileSync(resolve(dir, file), 'utf8')
      for (const match of source.matchAll(/from '([^']+)'/g)) {
        const specifier = match[1]!
        if (!allowed.some((rule) => rule.test(specifier)))
          offenders.push(`${file} imports ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the audio APIs in the voice client, and never recognises, synthesises or records in the browser', () => {
    /*
     * The microphone and the speaker are the browser's; the ears and the
     * voice are the server's. `voiceSession.ts` may open the microphone and
     * read its energy for barge-in. Nothing in this directory may transcribe,
     * speak, or record — those would be a second voice stack, or a recording
     * nobody asked for.
     */
    const read = (file: string) =>
      readFileSync(resolve(process.cwd(), 'src/components/jarvis', file), 'utf8')
    expect(read('JarvisPresence.tsx')).not.toMatch(
      /getUserMedia|SpeechRecognition|speechSynthesis|MediaRecorder|AudioContext/,
    )
    const client = read('voiceSession.ts')
    expect(client).toMatch(/getUserMedia/)
    expect(client).not.toMatch(/SpeechRecognition|speechSynthesis|MediaRecorder/)
  })

  it('opens the one Boardroom and the one record the routes render', () => {
    /*
     * The ruling for slice F: no second Boardroom, no second Underlag. The
     * page components live in one module each; the route files re-export
     * them, and the surface imports the same modules. A `function
     * CaseOverviewPage` appearing anywhere else is a second implementation.
     */
    const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
    const room = read('src/routes/cases.$caseId.tsx')
    const record = read('src/routes/cases.$caseId_.underlag.tsx')
    const surface = read('src/components/jarvis/ContextualSurface.tsx')
    expect(room).toContain("from '~/components/boardroom/CaseOverviewPage'")
    expect(room).not.toMatch(/function CaseOverviewPage/)
    expect(record).toContain("from '~/components/headquarters/CaseRecord'")
    expect(record).not.toMatch(/function CaseRecord\b/)
    expect(surface).toContain("from '~/components/boardroom/CaseOverviewPage'")
    expect(surface).toContain("from '~/components/headquarters/CaseRecord'")
  })
})
