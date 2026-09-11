import { Landmark, LayoutDashboard, Library, type LucideIcon } from 'lucide-react'

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
 * the firm's own obligations.
 *
 * Paths must match the file routes in `src/routes`.
 */
export const primaryNav: NavItem[] = [
  { to: '/', label: 'Kommandocentral', icon: LayoutDashboard },
  { to: '/headquarters', label: 'Huvudkontor', icon: Landmark },
  { to: '/evidence', label: 'Underlag', icon: Library },
]
