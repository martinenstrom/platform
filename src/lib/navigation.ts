import {
  Landmark,
  LayoutDashboard,
  Library,
  Radar,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

/**
 * Primary navigation — three destinations, and each answers a different
 * question.
 *
 *   Kommandocentral   `/`              what is happening in the world
 *   Huvudkontor       `/headquarters`  what the firm is, and what it owes
 *   Underlag          `/evidence`      what the firm holds to reason from
 *
 * **This is the product's one definition of its destinations.** The market
 * landing page's own column, the institutional top rail and Huvudkontoret's
 * doors all read it. The landing page used to carry a list of its own — eight
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
  /*
   * Klienter `/clients` — whom the firm serves, and what each relationship
   * needs. A fourth question beside the three above: not the world, not the
   * firm, not its evidence, but the people the advisor answers to. Added
   * with Client Intelligence Phase 1 (`docs/client-intelligence.md`).
   */
  { to: '/clients', label: 'Klienter', icon: Users },
  /*
   * Sentinel `/sentinel` — who needs the advisor today, why, and what to
   * prepare: the cross-client work queue over the same relationships.
   */
  { to: '/sentinel', label: 'Sentinel', icon: Radar },
  { to: '/evidence', label: 'Underlag', icon: Library },
]

/**
 * Utilities — reachable from every rail that carries one, never a peer of the
 * three destinations. Listed here for the same reason as above: one place.
 */
export const utilityNav: NavItem[] = [
  { to: '/settings', label: 'Inställningar', icon: Settings },
]
