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
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostResult } from '~/application/analysis/hostContract'
import { AppLayout } from '~/components/layout/AppLayout'
import {
  financialOsHostFn,
  getCurrentOperatorFn,
} from '~/infrastructure/analysis/serverFns'
import { JarvisPresence } from './JarvisPresence'
import { resetPresence } from './presenceStore'

vi.mock('~/infrastructure/analysis/serverFns', () => ({
  financialOsHostFn: vi.fn(),
  getCurrentOperatorFn: vi.fn(),
}))

const host = vi.mocked(financialOsHostFn)
const operator = vi.mocked(getCurrentOperatorFn)

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
  },
}

const td88: HostResult = {
  ...context,
  state: 'needs-decision',
  decision: { reason: 'institutional-initialization-required' },
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
})

/* -------------------------------------------------------------- at rest */

describe('at rest', () => {
  it('is a narrow strip with a mark, a name and a microphone that says it does not listen', async () => {
    await mountApp()
    const strip = presence()
    expect(
      within(strip).getByRole('button', { name: 'Öppna JARVIS' }),
    ).toBeInTheDocument()
    expect(within(strip).getByText('JARVIS')).toBeInTheDocument()
    expect(
      within(strip).getByRole('img', { name: 'Röst kommer i en senare version' }),
    ).toBeInTheDocument()
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
  it('asks the firm and says what the firm answered, in its own words', async () => {
    host.mockResolvedValue(td88)
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)

    expect(host).toHaveBeenCalledTimes(1)
    const sent = host.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(sent.data).toMatchObject({
      kind: 'ask',
      question: 'Är Nvidia köpvärd?',
      subject: 'Nvidia',
    })
    /* No actor of any name crosses the door. */
    expect(Object.keys(sent.data).sort()).toEqual([
      'kind',
      'question',
      'requestId',
      'subject',
    ])

    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    expect(within(log).getByText('Är Nvidia köpvärd?')).toBeInTheDocument()
    expect(
      within(log).getByText('Jag behöver ditt beslut på en sak.'),
    ).toBeInTheDocument()
    expect(within(log).getByText(/saknar en utgångstes/)).toBeInTheDocument()
  })

  it('binds the conversation to the reference and offers the deeper surfaces', async () => {
    host.mockResolvedValue(td88)
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)

    const active = within(presence()).getByRole('region', { name: 'Aktivt ärende' })
    expect(within(active).getByText('Nvidia')).toBeInTheDocument()
    expect(
      within(active).getByRole('link', { name: /Visa hur ni kom fram till det/ }),
    ).toHaveAttribute('href', '/cases/case-1')
    expect(within(active).getByRole('link', { name: /Visa underlaget/ })).toHaveAttribute(
      'href',
      '/cases/case-1/underlag',
    )
    /* The pointer, in the tab's own memory. Not the thesis. */
    expect(window.sessionStorage.getItem('jarvis:presence')).toContain('"id":"case-1"')
    expect(window.sessionStorage.getItem('jarvis:presence')).not.toContain('thesis')
  })

  it('asks the firm again for a follow-up rather than answering from memory', async () => {
    host.mockResolvedValueOnce(td88).mockResolvedValueOnce({
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

    expect(host).toHaveBeenCalledTimes(2)
    expect((host.mock.calls[1]![0] as { data: unknown }).data).toEqual({
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

    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    const said = within(log)
      .getAllByRole('listitem')
      .filter((item) => item.getAttribute('data-by') === 'jarvis')
      .map((item) => item.querySelector('p')?.textContent)
    expect(said).toEqual([
      'Jag kollar på det.',
      'Analysen kan inte fortsätta just nu.',
      'Jag behöver ditt beslut på en sak.',
    ])
  })

  it('reads the committee’s conclusion from the result, with its dissent', async () => {
    host.mockResolvedValueOnce(td88).mockResolvedValueOnce({
      ...context,
      state: 'answer-ready',
      kind: 'committee-conclusion',
      answer: {
        kind: 'committee-conclusion',
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
    host.mockResolvedValue({
      state: 'failed',
      reason: 'operator-unresolved',
      code: 'NOT_CONFIGURED',
    })
    const user = userEvent.setup()
    await mountApp()
    await askNvidia(user)

    const log = within(presence()).getByRole('list', { name: 'Samtal' })
    expect(within(log).getByText('Något gick inte igenom.')).toBeInTheDocument()
    expect(within(log).getByText(/Ingen operatör är konfigurerad/)).toBeInTheDocument()
    expect(within(presence()).queryByRole('region', { name: 'Aktivt ärende' })).toBeNull()
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
      within(log).getByText('Jag behöver ditt beslut på en sak.'),
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
    for (const [label, href] of [
      ['Huvudkontor', '/headquarters'],
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
      /^~\/application\/analysis\/hostContract$/,
      /^~\/application\/analysis\/domainSystem$/,
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

  it('touches no audio API', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/jarvis/JarvisPresence.tsx'),
      'utf8',
    )
    expect(source).not.toMatch(
      /getUserMedia|SpeechRecognition|speechSynthesis|MediaRecorder|AudioContext/,
    )
  })
})
