import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    /*
     * Every navigation commits inside `document.startViewTransition` where
     * the browser has it, so the stylesheet can fade the routed stage and
     * carry a client's name from the directory into Client 360. Where the
     * browser has not, the router navigates as before and the shell plays
     * its own fallback; see `AppLayout`.
     */
    defaultViewTransition: true,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
