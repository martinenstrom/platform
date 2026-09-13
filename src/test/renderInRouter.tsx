import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'

/**
 * Render a prop-driven surface inside a memory router.
 *
 * The surfaces that used to reach other pages through raw anchors now do so
 * through router `Link`s, and a `Link` needs a router to resolve against. The
 * stub routes exist only so every target resolves; none of them renders. The
 * surface itself is rendered as the root, exactly as `headquarters.test.tsx`
 * has always done it, so what the test sees is the real `Link` with the real
 * `href` the product emits.
 */
export async function renderInRouter(
  ui: ReactNode,
  stubs: readonly string[] = DEFAULT_STUBS,
) {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> })
  const children = stubs.map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => null }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren(children),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(<RouterProvider router={router as never} />)
}

/** Every route a case surface links to. */
const DEFAULT_STUBS = [
  '/cases/$caseId',
  '/cases/$caseId/underlag',
  '/agents/$departmentId',
  '/runs/$runId',
  '/evidence',
  '/headquarters',
] as const
