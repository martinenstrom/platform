import {
  Activity,
  Globe,
  Landmark,
  LayoutDashboard,
  Library,
  Radar,
  Settings,
  Sparkles,
  Sunrise,
  UsersRound,
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
 * The relationship book is defined once — `WORKSPACE_ENTRY` — and is the
 * first door, the global rail's Klienter shortcut and the presence's first
 * shortcut, so every surface agrees on where the clients are.
 */
const WORKSPACE_ENTRY: NavItem = { to: '/clients', label: 'Klienter', icon: Users }

export const jarvisNav: NavItem[] = [
  WORKSPACE_ENTRY,
  { to: '/sentinel', label: 'Sentinel', icon: Radar },
  { to: '/market-impact', label: 'Marknadspåverkan', icon: Activity },
]

/**
 * The gateway: JARVIS, opening on Sentinel — JARVIS's own reading of who
 * needs the advisor today. It opened on the relationship book while that
 * was the only way in; since the global rail carries Klienter as a shortcut
 * of its own, JARVIS and Klienter are two destinations, and the gateway
 * opens on the door that is JARVIS's. The second door of `jarvisNav` is
 * that one; `navigation.test` holds it to `/sentinel`.
 */
export const jarvisGateway: NavItem = {
  ...jarvisNav[1]!,
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
 *   JARVIS            `/sentinel`      whom the firm serves — the workspace above
 *   Underlag          `/evidence`      what the firm holds to reason from
 *
 * **This is the product's one definition of its destinations.** The
 * institutional top rail, the presence's shortcuts, Huvudkontoret's doors and
 * the global rail all read it. The landing page used to carry a list of its
 * own — eight entries, two of them pages this file had already removed as
 * fabricated — which is how one product came to describe itself three
 * different ways on three screens. Each path is written once here, as a
 * named destination, and every list is built from those.
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
const MARKET: NavItem = { to: '/', label: 'Kommandocentral', icon: LayoutDashboard }
/**
 * Idag — Daily Command: whom the advisor should act on today, why, and the
 * best use of a window of time. A first-class workspace beside the market:
 * the advisor's morning begins here, and the start page stays the market.
 */
const TODAY: NavItem = { to: '/today', label: 'Idag', icon: Sunrise }
const HEADQUARTERS: NavItem = {
  to: '/headquarters',
  label: 'Huvudkontor',
  icon: Landmark,
}
const EVIDENCE: NavItem = { to: '/evidence', label: 'Underlag', icon: Library }

export const primaryNav: NavItem[] = [MARKET, TODAY, HEADQUARTERS, jarvisGateway, EVIDENCE]

/**
 * Utilities — reachable from every rail that carries one, never a peer of the
 * destinations. Listed here for the same reason as above: one place.
 */
export const utilityNav: NavItem[] = [
  { to: '/settings', label: 'Inställningar', icon: Settings },
]

/**
 * The global rail — Financial OS's spine, in the strip at the left edge of
 * every page. The same destinations as the primary navigation, named for
 * the advisor at a glance, with the relationship book beside the market as
 * a shortcut: an advisor goes from the market to the clients in one click,
 * and the product hierarchy does not change for it — Klienter is still the
 * first door of the JARVIS workspace.
 *
 *   Marknad      `/`              the market command centre
 *   Idag         `/today`         Daily Command — who needs the advisor today
 *   Klienter     `/clients`       the relationship book — a shortcut into the workspace
 *   JARVIS       `/sentinel`      the intelligence system, on its own front
 *   Huvudkontor  `/headquarters`  the firm
 *   Underlag     `/evidence`      what the firm holds
 *
 * The rail is navigation and nothing else: no counts, no notices, no
 * previews. Sentinel and the relationship book own those signals.
 */
export const globalRail: NavItem[] = [
  { ...MARKET, label: 'Marknad', icon: Globe },
  TODAY,
  { ...WORKSPACE_ENTRY, icon: UsersRound },
  jarvisGateway,
  HEADQUARTERS,
  EVIDENCE,
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
