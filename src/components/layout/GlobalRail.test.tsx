import { describe, expect, it } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import {
  globalRail,
  jarvisGateway,
  jarvisNav,
  primaryNav,
  utilityNav,
} from '~/lib/navigation'
import { GlobalRail, GlobalRailUtilities, railItemCurrent } from './GlobalRail'

/**
 * The Financial OS rail: the product's spine, and the one place an advisor
 * reaches the relationship book from the market in a click. What must hold
 * is the set of destinations, their order, and that exactly one of them is
 * current wherever the reader stands — never JARVIS and Klienter together.
 */
async function mount(initial: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <GlobalRail />
        <GlobalRailUtilities />
        <Outlet />
      </>
    ),
  })
  const children = [
    '/',
    '/clients',
    '/clients/office/$officeId',
    '/clients/$clientId',
    '/sentinel',
    '/market-impact',
    '/headquarters',
    '/evidence',
    '/settings',
  ].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <p data-page>{path}</p>,
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

const rail = () => screen.getByRole('navigation', { name: 'Financial OS' })
const current = () =>
  within(rail())
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.getAttribute('title'))

describe('the Financial OS rail', () => {
  it('offers the five destinations in order, Klienter one click from the market', async () => {
    await mount('/')
    const links = within(rail()).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('title'))).toEqual([
      'Marknad',
      'Klienter',
      'JARVIS',
      'Huvudkontor',
      'Underlag',
    ])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/clients',
      '/sentinel',
      '/headquarters',
      '/evidence',
    ])
    /* Every link is named for assistive technology by its label, and titled for the pointer. */
    for (const label of ['Marknad', 'Klienter', 'JARVIS', 'Huvudkontor', 'Underlag']) {
      expect(within(rail()).getByRole('link', { name: label })).toHaveAttribute(
        'title',
        label,
      )
    }
    expect(screen.getByRole('link', { name: 'Inställningar' })).toHaveAttribute(
      'href',
      '/settings',
    )
  })

  it('is the same destinations the product defines once, under the advisor’s names', () => {
    const known = [...primaryNav, ...jarvisNav, ...utilityNav].map((item) => item.to)
    for (const item of globalRail) expect(known).toContain(item.to)
    /* JARVIS and Klienter are two destinations, with two icons. */
    expect(jarvisGateway.to).toBe('/sentinel')
    const [, klienter, jarvis] = globalRail
    expect(klienter!.to).not.toBe(jarvis!.to)
    expect(klienter!.icon).not.toBe(jarvis!.icon)
  })

  it('marks the market current at home, and neither JARVIS nor Klienter', async () => {
    await mount('/')
    expect(current()).toEqual(['Marknad'])
  })

  it('marks Klienter, not JARVIS, anywhere in the relationship book', async () => {
    await mount('/clients')
    expect(current()).toEqual(['Klienter'])
    for (const path of ['/clients/office/of-strandvagen', '/clients/c-1']) {
      expect(
        globalRail.filter((item) => railItemCurrent(item, path)).map((i) => i.label),
      ).toEqual(['Klienter'])
    }
  })

  it('marks JARVIS on the workspace doors that have no rail entry of their own', async () => {
    await mount('/sentinel')
    expect(current()).toEqual(['JARVIS'])
    expect(
      globalRail
        .filter((item) => railItemCurrent(item, '/market-impact'))
        .map((i) => i.label),
    ).toEqual(['JARVIS'])
  })

  it('marks Huvudkontor and Underlag on their own pages, and nothing on Inställningar', () => {
    const names = (path: string) =>
      globalRail.filter((item) => railItemCurrent(item, path)).map((i) => i.label)
    expect(names('/headquarters')).toEqual(['Huvudkontor'])
    expect(names('/evidence')).toEqual(['Underlag'])
    expect(names('/settings')).toEqual([])
  })

  it('takes the advisor from the market to the clients in one click, and back', async () => {
    const user = userEvent.setup()
    const router = await mount('/')
    await act(async () => {
      await user.click(within(rail()).getByRole('link', { name: 'Klienter' }))
    })
    expect(router.state.location.pathname).toBe('/clients')
    expect(current()).toEqual(['Klienter'])
    await act(async () => {
      await user.click(within(rail()).getByRole('link', { name: 'Marknad' }))
    })
    expect(router.state.location.pathname).toBe('/')
    expect(current()).toEqual(['Marknad'])
    await act(async () => {
      await user.click(within(rail()).getByRole('link', { name: 'JARVIS' }))
    })
    expect(router.state.location.pathname).toBe('/sentinel')
    expect(current()).toEqual(['JARVIS'])
  })
})
