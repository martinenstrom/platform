import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import {
  getMarketStatus,
  MARKET_CENTERS,
  type MarketStatusValue,
} from '~/data/countryExplorer/marketCenters'
import { cn } from '~/lib/cn'
import { formatTime } from '~/lib/format'

/** Status colors mirror the globe's hub markers (violet-blue after-hours). */
const STATUS_TEXT_CLASS: Record<MarketStatusValue, string> = {
  OPEN: 'text-positive',
  'PRE-MARKET': 'text-warning',
  'AFTER-HOURS': 'text-[#8b7bf5]',
  CLOSED: 'text-negative/80',
}

const STATUS_DOT_CLASS: Record<MarketStatusValue, string> = {
  OPEN: 'bg-positive',
  'PRE-MARKET': 'bg-warning',
  'AFTER-HOURS': 'bg-[#8b7bf5]',
  CLOSED: 'bg-negative/70',
}

const MARKET_STATUS_REFRESH_MS = 60_000

/**
 * Floating glass card, upper-right of the map (below Market Overview): a
 * persistent list version of the map's hub hover tooltip. Pure reuse of the
 * real `MARKET_CENTERS`/`getMarketStatus` — no new data or logic. Terminal
 * row format: status dot, city, exchange code, "• STATUS", local time.
 */
export function MarketStatusPanel({ onClose }: { onClose?: () => void }) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), MARKET_STATUS_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="hud-frame w-72 rounded-lg bg-[#12161c]/85 p-3 shadow-pop backdrop-blur-xl transition-shadow duration-200 hover:shadow-[0_0_24px_rgba(76,198,232,0.08)]">
      <div className="flex items-center justify-between gap-2">
        <span className="hud-label text-[10px] text-content-subtle">Market Status</span>
        <span className="flex items-center gap-2">
          <Link
            to="/markets"
            className="hud-label text-[9px] text-accent transition-colors duration-150 hover:text-content"
          >
            View All
          </Link>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Dölj Market Status"
              className="text-content-subtle transition-colors duration-150 hover:text-content"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </span>
      </div>

      <ul className="mt-2.5 flex max-h-56 flex-col gap-0.5 overflow-y-auto pr-1">
        {MARKET_CENTERS.map((center) => {
          const status = now ? getMarketStatus(center, now) : 'CLOSED'
          const localTime = now
            ? new Intl.DateTimeFormat('sv-SE', {
                timeZone: center.timeZone,
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
              }).format(now)
            : '--:--'
          return (
            <li
              key={center.id}
              className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs transition-colors duration-150 hover:bg-surface"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    STATUS_DOT_CLASS[status],
                  )}
                />
                <span className="truncate text-content">{center.name}</span>
                <span className="hud-label shrink-0 text-[8px] text-content-subtle">
                  {center.exchange}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    'hud-label text-[9px]',
                    STATUS_TEXT_CLASS[status],
                  )}
                >
                  • {status}
                </span>
                <span className="tabular w-10 text-right text-content-subtle">
                  {localTime}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
      <p className="hud-label mt-2 text-[8px] text-content-subtle">
        Alla tider lokal marknadstid · uppdaterad {now ? formatTime(now) : '--:--'}
      </p>
    </div>
  )
}
