/**
 * The home page is the market, and holds none of the firm.
 *
 * **This is a placement rule, and placement is exactly what regressed once.**
 * The Command Center v1 gate put the institution on `/`; the ruling that
 * followed moved it to `/headquarters` and returned the market overview to the
 * home page. In between, the floor, the personas and the CIO seat rendered on
 * both destinations at once — the product describing the same firm twice.
 *
 * So this reads the route source rather than rendering it. What must hold is
 * not a pixel but a dependency: the home page may not reach for institutional
 * state at all, and no assertion about what it renders would catch a panel
 * added back tomorrow as reliably as the import that would have to come with
 * it.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { AppLayout } from '~/components/layout/AppLayout'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('/ is the market landing page', () => {
  it('renders the market overview it was given back', () => {
    const route = read('src/routes/index.tsx')
    expect(route).toMatch(/LightCommandCenter/)
    expect(route).toMatch(/getOverviewSnapshotFn/)
  })

  it('reaches for no institutional state', () => {
    const route = read('src/routes/index.tsx')
    /*
     * Each of these is the firm's own state, and each has one home. A home page
     * importing any of them is the duplication this rule exists to prevent —
     * caught at the import, before it can become a panel.
     */
    for (const forbidden of [
      'commandCenter/CommandCenter',
      'commandCenter/AgentNetwork',
      'commandCenter/PersonaPlate',
      'getCommandCenterFn',
      'getCaseListFn',
      'agentDirectory',
      'caseListing',
    ]) {
      expect(route).not.toContain(forbidden)
    }
  })
})

describe('the three-part mental model', () => {
  it('offers each destination once, and the market only as the home page', () => {
    const navigation = read('src/lib/navigation.ts')
    expect(navigation).toMatch(/to:\s*'\/'/)
    expect(navigation).toMatch(/to:\s*'\/headquarters'/)
    expect(navigation).toMatch(/to:\s*'\/evidence'/)
    /*
     * `Marknader` pointed at the same overview the home page now renders. A
     * second entry for one screen is how a navigation starts describing routes
     * instead of the product.
     */
    expect(navigation).not.toMatch(/to:\s*'\/markets'/)
  })

  it('keeps the old market address working', () => {
    const markets = read('src/routes/markets.tsx')
    expect(markets).toMatch(/redirect/)
    expect(markets).toMatch(/to:\s*'\/'/)
    /*
     * Redirecting, not rendering: two copies of one dashboard is the failure.
     * Asserted on the imports — the file explains in prose which component it
     * no longer renders, and a plain text search would read that explanation
     * as the thing it forbids.
     */
    expect(markets).not.toMatch(/^import .*LightCommandCenter/m)
  })
})

describe('one navigation language per screen', () => {
  /**
   * The market landing page brings its own vertical rail, its own market-session
   * state and its own clock. The application's horizontal rail above it made two
   * navigation systems on one screen — so the shell stands down there, and only
   * there.
   *
   * Rendered rather than read, because the rule is about what a reader sees and
   * the shell decides it at runtime.
   */
  async function shellAt(pathname: string) {
    const rootRoute = createRootRoute({
      component: () => (
        <AppLayout>
          <p>innehåll</p>
        </AppLayout>
      ),
    })
    const children = ['/headquarters', '/evidence', '/clients', '/sentinel'].map((path) =>
      createRoute({ getParentRoute: () => rootRoute, path, component: () => null }),
    )
    const router = createRouter({
      routeTree: rootRoute.addChildren(children),
      history: createMemoryHistory({ initialEntries: [pathname] }),
    })
    await router.load()
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test tree, not the app's */
    return render(<RouterProvider router={router as any} />)
  }

  it('gives the market landing page the bare canvas', async () => {
    const view = await shellAt('/')
    expect(screen.queryByRole('navigation', { name: 'Huvudnavigation' })).toBeNull()
    view.unmount()
  })

  it('gives Huvudkontoret the bare canvas too, because its rail navigates', async () => {
    /*
     * Huvudkontoret carries the firm's wordmark and its destinations in its own
     * institutional rail, so the horizontal band would be the second navigation
     * on that screen — the same fault, in the other direction.
     */
    const view = await shellAt('/headquarters')
    expect(screen.queryByRole('navigation', { name: 'Huvudnavigation' })).toBeNull()
    view.unmount()
  })

  it('keeps the institutional rail on surfaces that have no rail of their own', async () => {
    const view = await shellAt('/evidence')
    expect(
      screen.getByRole('navigation', { name: 'Huvudnavigation' }),
    ).toBeInTheDocument()
    /* Outside the JARVIS workspace the rail is one band: no doors, no menu. */
    expect(screen.queryByRole('navigation', { name: 'JARVIS' })).toBeNull()
    /* The gateway opens on JARVIS's own front, Sentinel; Klienter has an entry of its own in the global rail. */
    expect(screen.getByRole('link', { name: 'JARVIS' })).toHaveAttribute(
      'href',
      '/sentinel',
    )
    view.unmount()
  })

  it('unfolds the JARVIS doors only inside the workspace, and marks the gateway current there', async () => {
    const view = await shellAt('/sentinel')
    const doors = screen.getByRole('navigation', { name: 'JARVIS' })
    for (const [label, href] of [
      ['Klienter', '/clients'],
      ['Sentinel', '/sentinel'],
      ['Marknadspåverkan', '/market-impact'],
    ]) {
      expect(within(doors).getByRole('link', { name: label })).toHaveAttribute(
        'href',
        href,
      )
    }
    const rail = screen.getByRole('navigation', { name: 'Huvudnavigation' })
    expect(within(rail).getByRole('link', { name: 'JARVIS' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      within(rail).getByRole('link', { name: 'Kommandocentral' }),
    ).not.toHaveAttribute('aria-current')
    view.unmount()
  })

  it('mounts the environment once, in the shell, and not on the market landing page', async () => {
    /*
     * The photograph behind Klienter, Client 360, Sentinel and the cockpit is
     * the shell's: one element beside the routed page, never inside it. The
     * market landing page paints its own hero and gets none from the shell.
     */
    const shell = await shellAt('/clients')
    expect(document.querySelectorAll('[data-environment]')).toHaveLength(1)
    shell.unmount()
    const home = await shellAt('/')
    expect(document.querySelectorAll('[data-environment]')).toHaveLength(0)
    home.unmount()
  })
})
