import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '~/lib/cn'
import {
  globalRail,
  inJarvisWorkspace,
  jarvisGateway,
  utilityNav,
  type NavItem,
} from '~/lib/navigation'

/**
 * The Financial OS global rail: the product's spine, standing in the strip at
 * the left edge of every page. Five destinations, one icon each, the name
 * beside the icon on hover and on keyboard focus, and the shell's gold for
 * where the reader is. It is navigation and nothing else — no counts, no
 * notices, no previews; Sentinel and the relationship book own those.
 *
 * Klienter is here as a shortcut: the relationship book belongs to the JARVIS
 * workspace, and an advisor must still reach it from the market in one click.
 * JARVIS beside it is the intelligence system, opening on its own front; the
 * two are never the same destination and never current at once.
 */
export function GlobalRail({ className }: { className?: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return (
    <nav aria-label="Financial OS" className={cn('w-full', className)}>
      <ul className="flex flex-col gap-0.5 px-2">
        {globalRail.map((item) => (
          <li key={item.label}>
            <RailLink item={item} current={railItemCurrent(item, pathname)} />
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** The utilities at the rail's foot — Inställningar — in the same material. */
export function GlobalRailUtilities({ className }: { className?: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return (
    <ul className={cn('flex w-full flex-col gap-0.5 px-2', className)}>
      {utilityNav.map((item) => (
        <li key={item.label}>
          <RailLink item={item} current={railItemCurrent(item, pathname)} />
        </li>
      ))}
    </ul>
  )
}

const under = (to: string, pathname: string) =>
  to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)

/**
 * Which rail item is current for a pathname. One at most: Klienter owns the
 * relationship book, so inside it JARVIS stands down; JARVIS is current on
 * the workspace's other doors, which have no rail item of their own.
 */
export function railItemCurrent(item: NavItem, pathname: string): boolean {
  if (item === jarvisGateway) {
    return (
      inJarvisWorkspace(pathname) &&
      !globalRail.some((other) => other !== item && under(other.to, pathname))
    )
  }
  return under(item.to, pathname)
}

function RailLink({ item, current }: { item: NavItem; current: boolean }) {
  const Icon = item.icon
  return (
    <Link
      to={item.to}
      aria-current={current ? 'page' : undefined}
      title={item.label}
      className="rail-link"
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" strokeWidth={1.5} />
      {/* The name under the icon at wide widths; the same name beside the rail on hover and focus. */}
      <span aria-hidden="true" className="rail-link-caption type-machine">
        {item.label}
      </span>
      <span className="rail-link-label">{item.label}</span>
    </Link>
  )
}
