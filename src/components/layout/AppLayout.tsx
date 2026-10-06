import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { cn } from '~/lib/cn'
import { usePresence } from '~/components/jarvis/presenceStore'
import { SystemNotice } from '~/components/platform/SystemNotice'
import { AppTopBar } from './AppTopBar'
import { SideNavigation } from './SideNavigation'

/** The pages that stand before the workspace exists — no column, no bar: nothing to navigate to yet. */
const PLATFORM_PAGES = ['/setup', '/recovery']

/**
 * Application shell: one environment, one left column, one workspace bar,
 * and the work.
 *
 * ## The room, the column and the bar
 *
 * The environment — the Financial-District photograph under a navy
 * atmosphere — is mounted here, beside the routed page and never inside it,
 * so Klienter, Client 360, Sentinel, Marknadspåverkan and the Meeting
 * Cockpit stand in the same room the home page stands in and the room does
 * not remount when the page changes. The left column stands on it: the
 * firm's identity, the destinations, the JARVIS doors. The bar above the
 * work says where the reader is, finds a client, and names who is at the
 * desk. The page padding is tight: an investment workstation is dense by
 * design, and generous margins are what make a dashboard read as a settings
 * screen.
 *
 * ## One navigation language per screen
 *
 * The market landing page brings its own shell — its own market-session
 * state, clock and the photograph at full height — so that page is given the
 * bare canvas and keeps its own. Huvudkontoret carries the firm's identity
 * AND its destinations in its own institutional rail, and its floor is its
 * own environment, so the column, the bar and the room stand down there too.
 *
 * The test is not which shell is better. It is that a screen must never
 * offer two — of a navigation, of an identity, or of an environment.
 */
export function AppLayout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const platformPage = PLATFORM_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  const ownsItsShell = pathname === '/' || platformPage
  const railCarriesNavigation = pathname === '/headquarters'
  const sharedShell = !ownsItsShell && !railCarriesNavigation

  /*
   * The presence stands at the left edge of every page, mounted from the
   * root. Shell routes reserve its resting width so nothing sits under it,
   * and its engaged width while it is open, so the page moves inward rather
   * than disappearing under the conversation — measured on Huvudkontoret,
   * where the engaged panel otherwise covered half the convene form. The
   * market landing page reserves the whole former rail column itself.
   */
  const { open } = usePresence()
  return (
    <div
      className={cn(
        'relative flex min-h-screen flex-col bg-canvas transition-[padding] duration-200',
        !ownsItsShell && (open ? 'pl-[306px]' : 'pl-16'),
      )}
    >
      {sharedShell && <Environment />}
      {sharedShell ? (
        <div className="app-shell relative z-10 flex flex-1">
          <SideNavigation />
          <div className="flex min-w-0 flex-1 flex-col">
            <AppTopBar />
            <SystemNotice />
            <main className="relative min-h-0 flex-1 p-2 lg:p-2.5">
              <RouteStage pathname={pathname}>{children}</RouteStage>
            </main>
          </div>
        </div>
      ) : (
        <main
          className={cn(
            'relative z-10 min-h-0 flex-1',
            ownsItsShell ? 'p-0' : 'p-2 lg:p-2.5',
          )}
        >
          <RouteStage pathname={pathname}>{children}</RouteStage>
        </main>
      )}
    </div>
  )
}

/**
 * One scene, twice: the waterfront at evening in focus at the left edge,
 * where the column stands, and the same scene out of focus across the whole
 * viewport — its sky, its lamps and its water, none of its detail — so the
 * work stands in the same room as the column rather than beside it. The
 * focused photograph fades through a mask into its own blurred self, which
 * is aligned under it, so there is no edge where one becomes the other. A
 * veil over the room is lighter beside the column and darker under the
 * work, with a band for the bar and one at the foot, set by measurement so
 * white text keeps its contrast everywhere the room shows. Fixed to the
 * viewport: the page scrolls over the room, the room does not scroll with
 * the page. Decorative, hidden from assistive technology, and drifting the
 * same 6 px over 80 s as the home page's, which reduced motion stops.
 */
const ENVIRONMENT_SCENE = '/data/environment/waterfront-scene.jpg'

function Environment() {
  return (
    <div
      aria-hidden="true"
      data-environment
      className="app-environment pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* The room: the one scene, edge to edge, covering the viewport from its top-left corner. */}
      <div className="app-environment-room absolute inset-0 overflow-hidden">
        <div
          className="hero-photo-drift app-environment-photo absolute -inset-y-[8px] right-0 left-0 bg-cover bg-no-repeat"
          style={{ backgroundImage: `url(${ENVIRONMENT_SCENE})` }}
        />
      </div>
      {/* A band for the bar, and a little depth at the foot; nothing over the hero. */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#060910]/30 via-transparent via-[8%] to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent via-[62%] to-[#060910]/28" />
    </div>
  )
}

/**
 * Where the routed page stands.
 *
 * The stage carries the view-transition name the stylesheet animates — the
 * old page fades out, the new page rises 6 px into place — while the column,
 * the bar, the environment and the presence around it are not part of the
 * change and do not move. Where the browser has no View Transitions API, the
 * stage plays the same rise itself, once per navigation, by restarting a CSS
 * animation on the element it already has: nothing remounts for it. Reduced
 * motion switches both off in the stylesheet.
 */
function RouteStage({ pathname, children }: { pathname: string; children: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null)
  const last = useRef(pathname)
  useLayoutEffect(() => {
    if (last.current === pathname) return
    last.current = pathname
    const el = stage.current
    if (!el || typeof document.startViewTransition === 'function') return
    el.classList.remove('route-stage-enter')
    void el.offsetWidth
    el.classList.add('route-stage-enter')
  }, [pathname])
  return (
    <div ref={stage} className="route-stage min-h-full">
      {children}
    </div>
  )
}
