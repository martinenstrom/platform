import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { GLOBAL_INDICATORS } from '~/data/countryExplorer/globalIndicators'
import { cn } from '~/lib/cn'
import type { MacroIndicator } from '~/types/countryExplorer'

const TREND_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus } as const
const TONE_CLASS: Record<MacroIndicator['tone'], string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-content-muted',
}

export function GlobalIndicatorsCard() {
  return (
    <DashboardCard
      dense
      title="Global Indicators"
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
      <ul className="flex flex-col gap-1">
        {GLOBAL_INDICATORS.map((indicator) => {
          const Icon = TREND_ICON[indicator.trend]
          return (
            <li
              key={indicator.id}
              className="flex items-center justify-between gap-3 rounded-md px-1.5 py-0.5 text-[13px] transition-colors duration-150 hover:bg-surface-2"
            >
              <span className="truncate text-content-muted">{indicator.label}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="tabular font-mono text-content">{indicator.value}</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 font-mono text-xs',
                    TONE_CLASS[indicator.tone],
                  )}
                >
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  {indicator.change}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
    </DashboardCard>
  )
}
