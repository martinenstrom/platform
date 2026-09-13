/**
 * GOLDEN BASELINE — Phase 0 gate G1.
 *
 * Captured against the pre-migration Overview. Phase 0 rewires this screen's
 * entire data path (16 mock sources, 9 local builders) and must not change
 * what it renders. This snapshot is the mechanical proof.
 *
 * What it covers: full DOM structure, every rendered value and label, element
 * ordering, class names (so layout and geometry cannot drift), inline styles,
 * sparkline SVG path geometry, recharts series geometry, and news timestamps.
 *
 * Determinism controls — the screen reads the wall clock in three places, so
 * all three are pinned:
 *   - `process.env.TZ` before any import, because the greeting branches on
 *     `getHours()` in local time.
 *   - `vi.setSystemTime`, because `useClock` and the "Data uppdaterad" label
 *     both read `new Date()`.
 *   - a `ResizeObserver` stub reporting a fixed box, because recharts renders
 *     nothing at zero width and the chart series would otherwise be invisible
 *     to the snapshot.
 *
 * Documented exclusion: `LightGlobe` is stubbed. It is a locked, out-of-scope
 * WebGL component that jsdom cannot render, so it contributes no assertable
 * output. Everything around it is covered.
 *
 * THE APPROVED INTENTIONAL CHANGE (D5/D10): after Phase 0, "Data uppdaterad"
 * shows the true data `asOf` instead of render time. That value is asserted
 * separately below rather than absorbed into the snapshot, so the change is
 * explicit and reviewable instead of silent.
 *
 * THE SECOND APPROVED INTENTIONAL CHANGE (JARVIS HQ hygiene, 2026-09-13): the
 * baseline was re-captured after the left column began reading the product's
 * one navigation definition (three destinations and a utility, instead of
 * eight entries including two mock-backed pages and `/settings` twice), after
 * the two handler-less header buttons were removed, and after the greeting and
 * the profile plate stopped naming a literal person. Nothing else on the
 * screen moved; the semantic suite names the new column, and every panel,
 * tile, rate, sector and news label is still asserted below by name.
 */

// Must precede every other import: Intl and Date read TZ at construction.
process.env.TZ = 'Europe/Stockholm'

import { render, screen, waitFor } from '@testing-library/react'
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

// The globe is locked, out of scope, and unrenderable in jsdom.
vi.mock('./LightGlobe', () => ({
  LightGlobe: () => <div data-testid="globe-stub" />,
}))

/** The non-breaking space `Intl.NumberFormat('sv-SE')` uses to group digits. */
const NBSP = ' '

/** Frozen instant for every clock the screen reads. */
const FROZEN_NOW = new Date('2026-07-26T14:32:10+02:00')

class FixedSizeResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [
        {
          target,
          contentRect: {
            width: 800,
            height: 400,
            top: 0,
            left: 0,
            bottom: 400,
            right: 800,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          },
        } as ResizeObserverEntry,
      ],
      this,
    )
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', FixedSizeResizeObserver)
  // Recharts measures the container before its observer fires.
  for (const prop of ['offsetWidth', 'clientWidth'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value: 800 })
  }
  for (const prop of ['offsetHeight', 'clientHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value: 400 })
  }
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(FROZEN_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Minimal memory router. Uses the real `Link` component rather than a stub, so
 * the snapshot records the hrefs and data attributes the app actually emits.
 * The stub routes exist only so every `Link` target resolves.
 */
/**
 * Builds the snapshot exactly as the server function does: fixture provider,
 * real registry, real resolution path. The test exercises the production wiring
 * rather than a hand-made stand-in.
 */
async function buildFixtureSnapshot(dataClock: Date = FROZEN_NOW) {
  const container = createContainer({
    env: {},
    clock: new FakeClock(dataClock),
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
  const snapshot = await buildFixtureSnapshot(dataClock)
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <LightCommandCenter snapshot={snapshot} />,
  })
  const stubRoutes = [
    '/headquarters',
    '/evidence',
    '/watchlist',
    '/reports',
    '/settings',
  ].map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => null }),
  )

  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, ...stubRoutes]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  const view = render(<RouterProvider router={router as never} />)
  await waitFor(() => expect(screen.getByText('Marknadsöversikt')).toBeInTheDocument())
  return view
}

describe('Overview — golden baseline (Phase 0 gate G1)', () => {
  it('renders the full Overview identically to the committed baseline', async () => {
    const { container } = await renderOverview()
    expect(container).toMatchSnapshot()
  })

  /**
   * Kept out of the snapshot deliberately: this is the one approved
   * intentional change in Phase 0, so it is the only assertion that moved.
   */
  it('shows "Data uppdaterad" from the data asOf, not render time (D5/D10)', async () => {
    await renderOverview()
    expect(screen.getByText(/Data uppdaterad/).textContent).toBe('Data uppdaterad 14:32')
  })

  /**
   * The proof that D5 is genuinely fixed rather than coincidentally equal.
   * The data clock is set 87 minutes behind the render clock; the label must
   * follow the data. Before Phase 0 it read the render clock regardless.
   */
  it('follows the data clock when it differs from the render clock', async () => {
    await renderOverview(new Date('2026-07-26T13:05:00+02:00'))
    expect(screen.getByText(/Data uppdaterad/).textContent).toBe('Data uppdaterad 13:05')
  })

  it('renders every panel, market tile, rate, sector and news label', async () => {
    const { container } = await renderOverview()
    // Belt-and-braces on the snapshot: if a whole panel silently disappeared,
    // a snapshot diff is easy to approve by accident. This is not. Matched
    // against raw container text because several labels legitimately appear
    // more than once (panel + ticker rail, or nav + section heading).
    const text = container.textContent ?? ''
    for (const label of [
      'OMXS30',
      'S&P 500',
      'DAX',
      'FTSE 100',
      'Nikkei 225',
      'Nasdaq 100',
      '10Y U.S. Yield',
      '10Y Germany Yield',
      '2Y U.S. Yield',
      'Sweden 10Y Yield',
      'USD/SEK',
      'EUR/USD',
      'Brent Olja',
      'Guld (USD/oz)',
      'Bitcoin (USD)',
      'Sektorer (S&P 500)',
      'Senaste nytt',
      'Bevakning',
      'Utveckling idag',
      'Räntemarknaden',
      'Aktuella marknader',
      'Marknadsöversikt',
      'Cross-Asset Risk Appetite',
    ]) {
      expect(text).toContain(label)
    }
  })

  it('reproduces the pre-migration values through the application service', async () => {
    const { container } = await renderOverview()
    // Spot-checks across four different mock sources, so a regression in any
    // one of them fails by name rather than as an anonymous snapshot blob.
    const text = container.textContent ?? ''
    const present = (value: string) => expect(text).toContain(value)
    present('2' + NBSP + '612,48') // was mockData marketIndices
    present('19' + NBSP + '840') // was a localized string, now numeric (D2)
    present('8' + NBSP + '363,95') // was an inline literal
    present('71' + NBSP + '386,25') // BTC via one canonical symbol (D1)
    present('4,32%') // was the '4.32%' mock string
    present('2,48%') // was an inline literal
  })

  /**
   * The complete, exhaustive list of what Phase 0 changed on screen.
   *
   * Before the migration this screen formatted numbers three different ways:
   * values passed through `formatNumber` used a non-breaking space to group
   * digits, hand-written mock literals used an ASCII space, and one yield
   * string used a dot decimal separator with a "pp" unit. Making every value
   * numeric until the presentation boundary converges all of them onto one
   * formatter.
   *
   * If any assertion here fails, the delta list has grown and needs approval.
   */
  it('converged all formatting onto one path (the approved Phase 0 delta)', async () => {
    const { container } = await renderOverview()
    const text = container.textContent ?? ''

    // Already NBSP before the migration - unchanged.
    expect(text).toContain('2' + NBSP + '612,48') // OMXS30
    expect(text).toContain('5' + NBSP + '843,12') // S&P 500
    expect(text).toContain('20' + NBSP + '418,65') // Nasdaq 100

    // Were ASCII-space literals; now NBSP. Visually identical.
    expect(text).toContain('19' + NBSP + '840') // DAX
    expect(text).toContain('40' + NBSP + '850') // Nikkei 225
    expect(text).toContain('8' + NBSP + '363,95') // FTSE 100
    expect(text).toContain('2' + NBSP + '385,40') // Gold
    expect(text).toContain('71' + NBSP + '386,25') // Bitcoin

    // Was '4.32%' with a dot; now a comma, matching every other figure.
    expect(text).toContain('4,32%')
    expect(text).not.toContain('4.32%')

    // Was '+0.00 pp'; now basis points like the rest of the column.
    expect(text).toContain('+0,00 bp')
    expect(text).not.toContain('+0.00 pp')
  })

  it('no longer renders any ASCII-space grouped number', async () => {
    const { container } = await renderOverview()
    // One formatter means one separator. A digit-space-digit sequence would
    // mean a hand-written literal had crept back in.
    const digitSpaceDigit = new RegExp('[0-9] [0-9]')
    expect(digitSpaceDigit.test(container.textContent ?? '')).toBe(false)
  })
})
