import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Bell, Mail, Search } from 'lucide-react'
import { cn } from '~/lib/cn'
import { primaryNav } from '~/lib/navigation'

/**
 * The institutional top rail.
 *
 * Matched to the reference's geometry: a shallow full-width band, the firm's
 * wordmark in bronze at the upper left, compact uppercase sections in the
 * middle, and a right cluster of state and utilities. Nothing about it scrolls
 * and nothing about it is a page — it is the edge of the environment.
 *
 * **Huvudkontoret does not render this at all.** That page carries the firm's
 * identity and its destinations in its own institutional rail, and a
 * horizontal band of sections above it made the investment floor read as a web
 * application with a navbar. The shell decides; see `AppLayout`.
 *
 * **What it does not carry, and why.** The reference has a market-session pill
 * and a "● LIVE" indicator. This rail shows the clock, which is the browser's
 * and says which zone it is in, and no status light at all: the firm holds no
 * session state, and a dot that is always green is the smallest possible
 * fabrication. The mail and bell icons are utilities, not counts — they carry
 * no badge, because there is nothing to count.
 */
export function AppTopBar() {
  return (
    <header className="sticky top-0 z-30 h-12 border-b border-line bg-[#070c14]/95 backdrop-blur-md">
      <div className="flex h-full items-center gap-5 pl-4 pr-3">
        <Link
          to="/"
          className="shrink-0 text-[17px] font-semibold leading-none tracking-[-0.015em] text-institution"
          aria-label="Financial OS — till kommandocentralen"
        >
          Financial<span className="font-normal text-content"> OS</span>
        </Link>

        <nav aria-label="Huvudnavigation" className="min-w-0 flex-1">
          <ul className="flex items-center gap-0.5 overflow-x-auto">
            {primaryNav.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    'type-section block whitespace-nowrap rounded-[4px] px-3 py-1.5',
                    'transition-colors hover:text-content',
                  )}
                  activeProps={{
                    /*
                     * The active section is the one place the rail carries
                     * bronze: a filled ground and a lit underline, exactly the
                     * emphasis the reference gives its current tab.
                     */
                    className:
                      'bg-institution-soft text-institution shadow-[inset_0_-2px_0_0_var(--color-institution)]',
                  }}
                  activeOptions={{ exact: item.to === '/' }}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-0.5">
          <Clock />
          <RailButton label="Sök">
            <Search className="h-[15px] w-[15px]" aria-hidden="true" />
          </RailButton>
          <RailButton label="Aviseringar">
            <Bell className="h-[15px] w-[15px]" aria-hidden="true" />
          </RailButton>
          <RailButton label="Meddelanden">
            <Mail className="h-[15px] w-[15px]" aria-hidden="true" />
          </RailButton>
        </div>
      </div>
    </header>
  )
}

function RailButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-content-subtle transition-colors hover:bg-surface-2 hover:text-content"
    >
      {children}
    </button>
  )
}

/**
 * The wall clock.
 *
 * Client-only: `null` until mounted, so a server-rendered time cannot disagree
 * with the browser's and cause a hydration mismatch. It names its zone, because
 * a time on a trading floor that does not say which one is a number nobody can
 * act on.
 */
function Clock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <span className="type-machine mr-2 hidden text-content-muted sm:inline">
      {now
        ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${localZone()}`
        : ''}
    </span>
  )
}

/** The browser's own zone abbreviation, never a hardcoded market's. */
function localZone(): string {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZoneName: 'short' }).formatToParts(
    new Date(),
  )
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
}
