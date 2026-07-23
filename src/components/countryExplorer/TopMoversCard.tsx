import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { DashboardCard } from '~/components/ui/DashboardCard'
import {
  GLOBAL_TOP_ACTIVE,
  GLOBAL_TOP_GAINERS,
  GLOBAL_TOP_LOSERS,
} from '~/data/countryExplorer/globalTopMovers'
import { cn } from '~/lib/cn'
import { formatPercent } from '~/lib/format'
import type { WatchlistItem } from '~/types'

type Tab = 'gainers' | 'losers' | 'active'

const TABS: Array<{ id: Tab; label: string; items: WatchlistItem[] }> = [
  { id: 'gainers', label: 'Gainers', items: GLOBAL_TOP_GAINERS },
  { id: 'losers', label: 'Losers', items: GLOBAL_TOP_LOSERS },
  { id: 'active', label: 'Active', items: GLOBAL_TOP_ACTIVE },
]

/**
 * Reference-format movers list: uppercase company, exchange ticker, signed
 * change — three terminal columns, no chart. Full quotes live on /markets
 * (the "View All" action).
 */
export function TopMoversCard() {
  const [tab, setTab] = useState<Tab>('gainers')
  const active = TABS.find((t) => t.id === tab)!

  return (
    <DashboardCard
      dense
      title="Top Movers (Global)"
      action={
        <Link
          to="/markets"
          className="hud-label text-[9px] text-accent transition-colors duration-150 hover:text-content"
        >
          View All
        </Link>
      }
      className="h-[400px] transition-shadow duration-200 hover:shadow-[0_0_28px_rgba(77,232,245,0.12)]"
      bodyClassName="min-h-0 overflow-y-auto"
    >
      <div
        role="tablist"
        aria-label="Top movers, kategori"
        className="mb-2 inline-flex gap-0.5 rounded-md bg-surface-3 p-0.5"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase transition-colors duration-150',
              tab === t.id
                ? 'bg-accent-soft text-accent'
                : 'text-content-subtle hover:text-content',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="hud-label mb-1 px-1.5 text-[9px] text-content-subtle">Bolag</p>
      <ul>
        {active.items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-3 border-t border-line px-1.5 py-2 transition-colors duration-150 hover:bg-surface-2"
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[13px] font-medium text-content uppercase">
                {item.name}
              </span>
              <span className="hud-label shrink-0 text-[9px] text-content-subtle">
                {item.ticker}
              </span>
            </span>
            <span
              className={cn(
                'tabular shrink-0 font-mono text-[13px]',
                item.changePercent >= 0 ? 'text-positive' : 'text-negative',
              )}
            >
              {formatPercent(item.changePercent)}
            </span>
          </li>
        ))}
      </ul>
    </DashboardCard>
  )
}
