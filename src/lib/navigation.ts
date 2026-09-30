import {
  Activity,
  Landmark,
  LayoutDashboard,
  Library,
  Radar,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

/**
 * The JARVIS workspace — the client side of the product, entered through one
 * gateway and arranged as three doors behind it.
 *
 *   Klienter          `/clients`        whom the firm serves, and what each relationship needs
 *   Sentinel          `/sentinel`       who needs the advisor today, and why
 *   Marknadspåverkan  `/market-impact`  which clients the market's moves touch
 *
 * They were three peers of the market screen in the primary rail once, and
 * the market screen carried two of them as modules of its own. That made the
 * home page a client page with a globe on it. The home page is the market
 * command centre again; everything about clients is here, one level in.
 *
 * The entry is defined once — `WORKSPACE_ENTRY` — and the gateway opens on
 * it, so the rail, the presence's shortcuts and Huvudkontoret's doors agree
 * on where JARVIS begins.
 */
const WORKSPACE_ENTRY: NavItem = { to: '/clients', label: 'Klienter', icon: Users }

export const jarvisNav: NavItem[] = [
  WORKSPACE_ENTRY,
  { to: '/sentinel', label: 'Sentinel', icon: Radar },
  { to: '/market-impact', label: 'Marknadspåverkan', icon: Activity },
]

/** The gateway in the primary rail: JARVIS, opening on the client directory. */
export const jarvisGateway: NavItem = {
  ...WORKSPACE_ENTRY,
  label: 'JARVIS',
  icon: Sparkles,
}

/** Whether a pathname is inside the JARVIS workspace — the rail shows the doors there. */
export function inJarvisWorkspace(pathname: string): boolean {
  return jarvisNav.some(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  )
}

/**
 * Primary navigation — four destinations, and each answers a different
 * question.
 *
 *   Kommandocentral   `/`              what is happening in the world
 *   Huvudkontor       `/headquarters`  what the firm is, and what it owes
 *   JARVIS            `/clients`       whom the firm serves — the workspace above
 *   Underlag          `/evidence`      what the firm holds to reason from
 *
 * **This is the product's one definition of its destinations.** The
 * institutional top rail, the presence's shortcuts and Huvudkontoret's doors
 * all read it. The landing page used to carry a list of its own — eight
 * entries, two of them pages this file had already removed as fabricated —
 * which is how one product came to describe itself three different ways on
 * three screens.
 *
 * **Marknader is gone, and that is not a removal of anything.** It pointed at
 * the same market overview the home page now renders, so leaving it in the
 * navigation would have offered one screen twice under two names — the exact
 * duplication that made the institution appear on two destinations at once.
 * `/markets` redirects to `/`.
 *
 * **What was removed earlier, and why it is not a regression.** `Portfölj` and
 * `Rapporter` are backed entirely by `~/data/mockData`, and a fabricated
 * destination one click from the home page is the plainest contradiction of
 * the rule that the product shows institutional truth. The routes remain
 * reachable; they return to the navigation when a real read model backs them,
 * and not by being given a cosmetic placeholder in the meantime.
 *
 * `Bevakning` left for a different reason: it is real, but it is market data,
 * and it is a drill-down from the market landing page rather than a peer of
 * the firm's own obligations. The landing page links to it from the panel
 * that shows it.
 *
 * Paths must match the file routes in `src/routes`.
 */
export const primaryNav: NavItem[] = [
  { to: '/', label: 'Kommandocentral', icon: LayoutDashboard },
  { to: '/headquarters', label: 'Huvudkontor', icon: Landmark },
  jarvisGateway,
  { to: '/evidence', label: 'Underlag', icon: Library },
]

/**
 * Utilities — reachable from every rail that carries one, never a peer of the
 * destinations. Listed here for the same reason as above: one place.
 */
export const utilityNav: NavItem[] = [
  { to: '/settings', label: 'Inställningar', icon: Settings },
]

/**
 * Every door the presence offers as a shortcut: the primary destinations with
 * the JARVIS gateway unfolded into its three doors — JARVIS does not offer a
 * shortcut to itself — and the utilities after them.
 */
export const shortcutNav: NavItem[] = [
  ...primaryNav.flatMap((item) => (item === jarvisGateway ? jarvisNav : [item])),
  ...utilityNav,
]
