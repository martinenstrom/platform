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
async function renderOverview() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: LightCommandCenter,
  })
  const stubRoutes = [
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
   * Pulled out of the snapshot deliberately. Phase 0 changes this ONE value
   * from render time to the snapshot's true `asOf`; keeping it separate makes
   * that the only assertion that has to change, and makes any other drift a
   * snapshot failure rather than a silent edit.
   */
  it('shows "Data uppdaterad" from render time (pre-Phase-0 behaviour, D5)', async () => {
    await renderOverview()
    const label = screen.getByText(/Data uppdaterad/)
    // 14:32 local — i.e. `new Date()` at render, not any data timestamp.
    expect(label.textContent).toBe('Data uppdaterad 14:32')
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
      'Sentiment',
    ]) {
      expect(text).toContain(label)
    }
  })

  it('renders the pre-migration values that Phase 0 must reproduce', async () => {
    const { container } = await renderOverview()
    // Spot-checks across four different mock sources, so a regression in any
    // one of them fails by name rather than as an anonymous snapshot blob.
    const text = container.textContent ?? ''
    const present = (value: string) => expect(text).toContain(value)
    present('2' + NBSP + '612,48') // mockData marketIndices, via formatNumber
    present('19 840') // GERMANY_DATA localized string, re-parsed (D2)
    present('8 363,95') // inline literal in buildMarketCards
    present('71 386,25') // bitcoin/btc fallback literal (D1)
    present('4.32%') // GLOBAL_MARKET_OVERVIEW mock string
    present('2,48%') // inline literal in buildRates
  })

  /**
   * Records the formatting inconsistency this baseline exposed, so the Phase 0
   * delta is a documented expectation rather than a surprise in a diff.
   *
   * Values that flow through `formatNumber` get a NON-BREAKING SPACE group
   * separator (correct for sv-SE). Values that are hand-written string
   * literals in the mock layer get an ASCII space, and one yield string uses a
   * DOT decimal separator. All three render near-identically but are different
   * characters.
   *
   * Phase 0 makes every value numeric until the presentation boundary, so they
   * will all format through one path and converge on the `formatNumber`
   * output. This test pins the pre-migration state; the Phase 0 counterpart
   * pins the converged state. Neither is silent about the difference.
   */
  it('documents the pre-migration formatting inconsistency (Phase 0 delta)', async () => {
    const { container } = await renderOverview()
    const text = container.textContent ?? ''

    // Formatted through formatNumber → NBSP group separator.
    expect(text).toContain('2' + NBSP + '612,48') // OMXS30
    expect(text).toContain('5' + NBSP + '843,12') // S&P 500
    expect(text).toContain('20' + NBSP + '418,65') // Nasdaq 100

    // Hand-written literals → ASCII space. These converge to NBSP in Phase 0.
    expect(text).toContain('19 840') // DAX
    expect(text).toContain('40 850') // Nikkei 225
    expect(text).toContain('8 363,95') // FTSE 100
    expect(text).toContain('2 385,40') // Gold
    expect(text).toContain('71 386,25') // Bitcoin

    // Mock string → DOT decimal. Converges to a comma in Phase 0.
    expect(text).toContain('4.32%') // 10Y U.S. Yield
  })
})
