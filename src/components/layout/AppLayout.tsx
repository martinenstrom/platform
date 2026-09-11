import type { ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { cn } from '~/lib/cn'
import { AppTopBar } from './AppTopBar'

/**
 * Application shell: one top rail, and the full width beneath it.
 *
 * **The sidebar is gone, deliberately.** It spent the widest dimension of the
 * screen on navigation and left the work in a narrower column — which is why
 * every page read as a document with a menu beside it rather than as an
 * operating environment. The rail is now horizontal, and the floor gets the
 * whole width.
 *
 * The page padding is tight for the same reason: an investment workstation is
 * dense by design, and generous margins are what make a dashboard read as a
 * settings screen.
 *
 * ## One navigation language per screen
 *
 * The market landing page brings its own shell — a vertical rail carrying the
 * same destinations, its own market-session state, clock and profile. Rendering
 * this rail above it put two navigation systems on one screen, one horizontal
 * and one vertical, disagreeing about where the reader is. So that page is
 * given the bare canvas and keeps its own rail; every institutional surface
 * uses this one.
 *
 * The test is not which rail is better. It is that a screen must never offer
 * two — of a navigation, or of an identity.
 */
export function AppLayout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const ownsItsShell = pathname === '/'
  /*
   * Huvudkontoret carries the firm's identity AND its destinations in its own
   * institutional rail — the wordmark at its head, the surfaces in
   * `Institutionella ytor`. A horizontal band of sections above that made the
   * firm's floor read as a web application with a navbar, so the band stands
   * down entirely there. It keeps the page padding, unlike the market landing
   * page, because its workstation is inset rather than full-bleed.
   */
  const railCarriesNavigation = pathname === '/headquarters'

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      {!ownsItsShell && !railCarriesNavigation && <AppTopBar />}
      {/* Tight, and the same on every edge: the workstation owns the canvas. */}
      <main className={cn('min-h-0 flex-1', ownsItsShell ? 'p-0' : 'p-2 lg:p-2.5')}>
        {children}
      </main>
    </div>
  )
}
