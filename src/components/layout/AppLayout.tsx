import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { cn } from '~/lib/cn'
import { usePresence } from '~/components/jarvis/presenceStore'
import { AppTopBar } from './AppTopBar'
import { SideNavigation } from './SideNavigation'

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
  const ownsItsShell = pathname === '/'
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
        <div className="relative z-10 flex flex-1">
          <SideNavigation />
          <div className="flex min-w-0 flex-1 flex-col">
            <AppTopBar />
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
 * The same photograph the home page stands in front of, in the same crop —
 * anchored at the left, where the column stands on it, and dissolved into
 * the canvas under the work. Fixed to the viewport: the page scrolls over
 * the room, the room does not scroll with the page. Decorative, hidden from
 * assistive technology, and drifting the same 6 px over 80 s as the home
 * page's, which reduced motion stops.
 */
const ENVIRONMENT_PHOTO = '/data/wall-street.jpg'

function Environment() {
  return (
    <div
      aria-hidden="true"
      data-environment
      className="app-environment pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div className="absolute inset-y-0 left-0 w-[52vw] max-w-[860px] overflow-hidden">
        <div
          className="hero-photo-drift absolute -inset-y-[8px] right-0 left-0 bg-[length:auto_100%] bg-[position:-46px_center] bg-no-repeat"
          style={{ backgroundImage: `url(${ENVIRONMENT_PHOTO})` }}
        />
        {/* Lit where the column stands, and gone under the work. */}
        <div className="absolute inset-0 bg-[#060910]/15" />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent from-[22%] via-[rgba(6,9,16,0.8)] via-[56%] to-[#060910]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent via-[45%] to-[#060910]" />
      </div>
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(90% 60% at 50% -10%, rgb(217 164 65 / 0.05) 0%, transparent 60%), radial-gradient(80% 50% at 50% 110%, rgb(77 232 245 / 0.04) 0%, transparent 60%)',
        }}
      />
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
