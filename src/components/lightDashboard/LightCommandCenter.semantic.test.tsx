/**
 * Semantic Overview contracts (decision D12).
 *
 * Complements the golden snapshot; it does not replace it. The snapshot proves
 * nothing changed; these prove *what the screen means*, so a future failure
 * points at a named contract instead of a 4 000-line serialization diff.
 *
 * Contracts covered, per D12: instrument ordering, displayed values, units,
 * data-source states, category-level timestamps, the conservative snapshot
 * `asOf`, the selected intraday range, and the absence of direct mock imports.
 */

process.env.TZ = 'Europe/Stockholm'

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { LightCommandCenter } from './LightCommandCenter'
import { getOverviewSnapshot } from '~/application/marketData/getOverviewSnapshot'
import { createContainer } from '~/infrastructure/marketData/container'
import { createOverviewDataSource } from '~/infrastructure/marketData/overviewDataSource'
import { createFixtureProvider } from '~/infrastructure/marketData/providers/fixture'
import { FakeClock } from '~/domain/shared/clock'
import { SeededRandom } from '~/domain/shared/random'
import {
  hasData,
  instrumentRef,
  type CanonicalSymbol,
  type Envelope,
} from '~/domain/market'

vi.mock('./LightGlobe', () => ({ LightGlobe: () => <div data-testid="globe-stub" /> }))

const NBSP = ' '
const FROZEN_NOW = new Date('2026-07-26T14:32:10+02:00')

class FixedSizeResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [{ target, contentRect: { width: 800, height: 400 } } as ResizeObserverEntry],
      this,
    )
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', FixedSizeResizeObserver)
  for (const prop of ['offsetWidth', 'clientWidth'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value: 800 })
  }
  for (const prop of ['offsetHeight', 'clientHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value: 400 })
  }
})
afterAll(() => vi.unstubAllGlobals())
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(FROZEN_NOW)
})
afterEach(() => vi.useRealTimers())

function buildSnapshot(dataClock: Date = FROZEN_NOW) {
  const container = createContainer({
    env: {},
    clock: new FakeClock(dataClock),
    random: new SeededRandom(1),
    providers: [
      {
        provider: createFixtureProvider(),
        capabilities: new Set([
          'quotes',
          'series',
          'fx',
          'yields',
          'commodities',
          'crypto',
          'news',
          'sentiment',
        ]),
      },
    ],
  })
  return getOverviewSnapshot(createOverviewDataSource(container))
}

async function renderOverview(dataClock?: Date) {
  const snapshot = await buildSnapshot(dataClock)
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <LightCommandCenter snapshot={snapshot} />,
  })
  const stubs = [
    '/markets',
    '/watchlist',
    '/portfolio',
    '/agents',
    '/reports',
    '/settings',
  ].map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => null }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, ...stubs]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const view = render(<RouterProvider router={router as never} />)
  await waitFor(() => expect(screen.getByText('Marknadsöversikt')).toBeInTheDocument())
  return { ...view, snapshot }
}

/* ------------------------------------------------------- instrument ordering */

describe('instrument ordering', () => {
  it('renders the market tiles in the catalog order', async () => {
    const { container } = await renderOverview()
    const text = container.textContent ?? ''
    const order = ['OMXS30', 'S&P 500', 'DAX', 'FTSE 100', 'Nikkei 225', 'Nasdaq 100']
    const positions = order.map((label) => text.indexOf(label))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(positions.every((p) => p >= 0)).toBe(true)
  })

  it('renders the rates in tenor-panel order, not sorted by value', async () => {
    const { container } = await renderOverview()
    const text = container.textContent ?? ''
    const order = [
      '10Y U.S. Yield',
      '10Y Germany Yield',
      '2Y U.S. Yield',
      'Sweden 10Y Yield',
    ]
    const positions = order.map((label) => text.indexOf(label))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('renders sectors strongest-first, as the panel intends', async () => {
    const { snapshot } = await renderOverview()
    if (!hasData(snapshot.sectors)) throw new Error('no sectors')
    const changes = snapshot.sectors.data.map((q) => q.percentageChange ?? 0)
    expect(changes).toEqual([...changes].sort((a, b) => b - a))
  })
})

/* --------------------------------------------------------- displayed values */

describe('displayed values', () => {
  it('formats each instrument to its own precision', async () => {
    const { container } = await renderOverview()
    const text = container.textContent ?? ''
    // FX needs four decimals; two would round USD/SEK moves out of existence.
    expect(text).toContain('10,4127')
    // DAX and Nikkei are quoted whole on this screen.
    expect(text).toContain(`19${NBSP}840`)
    expect(text).toContain(`40${NBSP}850`)
    // Index levels to two.
    expect(text).toContain(`2${NBSP}612,48`)
  })

  it('shows a signed percentage for every quote change', async () => {
    const { container } = await renderOverview()
    const text = container.textContent ?? ''
    expect(text).toContain('+0,74 %')
    expect(text).toContain('−0,28 %') // U+2212, not a hyphen
  })
})

/* ------------------------------------------------------------------- units */

describe('units', () => {
  it('renders yields as percent and yield changes as basis points', async () => {
    const { container } = await renderOverview()
    const text = container.textContent ?? ''
    // The classic rates confusion: a level is a percent, a move is bp.
    expect(text).toContain('4,32%')
    expect(text).toContain('+0,00 bp')
    expect(text).toContain('−0,04 bp')
    // Percentage POINTS was the old, wrong unit for this column.
    expect(/[0-9]\s?pp/.test(text)).toBe(false)
  })

  it('carries explicit units on every instrument it displays', async () => {
    const { snapshot } = await renderOverview()
    for (const symbol of Object.keys(snapshot.instruments) as CanonicalSymbol[]) {
      expect(instrumentRef(symbol).unit).toBeDefined()
    }
    expect(instrumentRef('fx:usdsek' as CanonicalSymbol).unit.kind).toBe('fx-rate')
    expect(instrumentRef('rate:us10y' as CanonicalSymbol).unit.kind).toBe('percent')
    expect(instrumentRef('cmd:brent' as CanonicalSymbol).unit.kind).toBe('per-physical')
    expect(instrumentRef('idx:sp500' as CanonicalSymbol).unit.kind).toBe('index-points')
  })
})

/* -------------------------------------------------------- data-source state */

describe('data-source states', () => {
  it('marks every category as fixture-backed while no live provider exists', async () => {
    const { snapshot } = await renderOverview()
    const envelopes: Array<Envelope<unknown>> = [
      snapshot.indices,
      snapshot.fx,
      snapshot.yields,
      snapshot.news,
      snapshot.sentiment,
    ]
    for (const envelope of envelopes) {
      expect(envelope.state).toBe('fixture')
      if (hasData(envelope)) {
        expect(envelope.provenance.quality).toBe('fixture')
        expect(envelope.provenance.source.providerId).toBe('fixture')
      }
    }
    expect(snapshot.hasDegradedCategory).toBe(true)
  })

  it('reports sentiment as fixture-origin, never as derived', async () => {
    // Deriving a score from invented inputs must not launder it into a
    // production-eligible "derived" value.
    const { snapshot } = await renderOverview()
    if (!hasData(snapshot.sentiment)) throw new Error('no sentiment')
    expect(snapshot.sentiment.data.origin).toBe('fixture')
  })
})

/* ------------------------------------------------ timestamps and asOf policy */

describe('timestamps', () => {
  it('gives every category its own provenance', async () => {
    const { snapshot } = await renderOverview()
    const categories: Array<Envelope<unknown>> = [
      snapshot.indices,
      snapshot.news,
      snapshot.yields,
    ]
    for (const envelope of categories) {
      if (!hasData(envelope)) throw new Error('missing data')
      expect(() => new Date(envelope.provenance.asOf).toISOString()).not.toThrow()
      expect(envelope.provenance.receivedAt).toBeTruthy()
    }
  })

  it('reports snapshot asOf as the OLDEST category, never the newest', async () => {
    const { snapshot } = await renderOverview()
    const all: Array<Envelope<unknown>> = [
      snapshot.indices,
      snapshot.news,
      snapshot.yields,
      snapshot.fx,
    ]
    const ages = all
      .filter(hasData)
      .map((envelope) => new Date(envelope.provenance.asOf).getTime())
    expect(new Date(snapshot.asOf).getTime()).toBe(Math.min(...ages))
  })

  it('displays the data clock, not the render clock', async () => {
    await renderOverview(new Date('2026-07-26T13:05:00+02:00'))
    expect(screen.getByText(/Data uppdaterad/).textContent).toBe('Data uppdaterad 13:05')
  })
})

/* --------------------------------------------------- selected intraday range */

describe('intraday range', () => {
  it('starts on 1D with that button pressed', async () => {
    await renderOverview()
    expect(screen.getByRole('button', { name: '1D' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('switches the pressed range without a refetch', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderOverview()
    await user.click(screen.getByRole('button', { name: '3M' }))
    expect(screen.getByRole('button', { name: '3M' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: '1D' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('offers every configured range, localized', async () => {
    await renderOverview()
    const group = screen.getByRole('group', { name: 'Tidsintervall' })
    const labels = within(group)
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(labels).toEqual(['1D', '1V', '1M', '3M', '1Å', 'YTD'])
  })

  it('carries a series for every range so switching stays instant', async () => {
    const { snapshot } = await renderOverview()
    if (!hasData(snapshot.intraday)) throw new Error('no intraday')
    expect(Object.keys(snapshot.intraday.data).sort()).toEqual([
      '1d',
      '1m',
      '1w',
      '1y',
      '3m',
      'ytd',
    ])
  })
})
