import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '~/lib/cn'
import {
  inJarvisWorkspace,
  jarvisGateway,
  jarvisNav,
  primaryNav,
  utilityNav,
} from '~/lib/navigation'

/**
 * The shell's left column: the firm's identity at the head, the destinations
 * beneath it, the JARVIS doors unfolded while the reader is behind the
 * gateway, the utilities at the foot. It stands on the environment — the
 * photograph is behind it, not behind the work — so the column is where the
 * room is seen.
 *
 * Below `xl` it narrows to its icons; every link keeps its name for
 * assistive technology and as a tooltip.
 */
export function SideNavigation() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const workspace = inJarvisWorkspace(pathname)
  const isActive = (to: string) =>
    to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)

  return (
    <div className="app-side-nav sticky top-0 flex h-screen w-14 shrink-0 flex-col border-r border-white/[0.06] bg-gradient-to-r from-[#060910]/55 to-[#060910]/25 xl:w-[200px]">
      <Link
        to="/"
        aria-label="Financial OS — till kommandocentralen"
        className="block px-3 pt-4 pb-5 xl:px-4"
      >
        <span className="type-display-statement block text-[19px] leading-none text-institution xl:text-[21px]">
          <span className="xl:hidden">F</span>
          <span className="hidden xl:inline">
            Financial<span className="text-content"> OS</span>
          </span>
        </span>
        <span className="mt-1.5 hidden font-display text-[15px] leading-none text-[#e9e1cf] xl:block">
          Handelsbanken
        </span>
      </Link>

      <nav aria-label="Huvudnavigation" className="min-h-0 flex-1 overflow-y-auto px-2">
        <ul className="flex flex-col gap-0.5">
          {primaryNav.map((item) => {
            const gateway = item === jarvisGateway
            const active = gateway ? workspace : isActive(item.to)
            const Icon = item.icon
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  title={item.label}
                  className={cn('side-nav-link', gateway && 'mt-1')}
                >
                  <Icon
                    className="h-[15px] w-[15px] shrink-0"
                    aria-hidden="true"
                    strokeWidth={1.6}
                  />
                  <span
                    className={cn(
                      'sr-only truncate xl:not-sr-only',
                      gateway && 'type-section text-[11px] tracking-[0.16em]',
                      gateway && active && 'text-institution',
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
                {/* The doors behind the gateway, only while the reader is behind it. */}
                {gateway && workspace && (
                  <nav aria-label="JARVIS" className="mt-0.5 mb-1">
                    <ul className="flex flex-col">
                      {jarvisNav.map((door) => {
                        const DoorIcon = door.icon
                        return (
                          <li key={door.to}>
                            <Link
                              to={door.to}
                              aria-current={isActive(door.to) ? 'page' : undefined}
                              title={door.label}
                              className="side-nav-sublink"
                            >
                              <span
                                className="side-nav-dot hidden xl:block"
                                aria-hidden="true"
                              />
                              <DoorIcon
                                className="h-3.5 w-3.5 shrink-0 xl:hidden"
                                aria-hidden="true"
                                strokeWidth={1.6}
                              />
                              <span className="sr-only truncate xl:not-sr-only">
                                {door.label}
                              </span>
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  </nav>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="border-t border-white/[0.06] px-2 py-2">
        {utilityNav.map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={isActive(item.to) ? 'page' : undefined}
              title={item.label}
              className="side-nav-link"
            >
              <Icon
                className="h-[15px] w-[15px] shrink-0"
                aria-hidden="true"
                strokeWidth={1.6}
              />
              <span className="sr-only truncate xl:not-sr-only">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
