import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { cn } from '~/lib/cn'
import { Sparkline } from '~/components/charts/Sparkline'
import { TrendChart } from '~/components/charts/TrendChart'
import {
  buildChartSeries,
  parseLeadingNumber,
  RELATIVE_QUARTER_LABELS,
  seedFromString,
} from '~/data/countryExplorer/trendSeries'
import { DataSourceBadge, DataNotAvailable } from './DataSourceBadge'
import type { MacroIndicator } from '~/types/countryExplorer'

const TREND_ICON = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
} as const

const TONE_CLASS: Record<MacroIndicator['tone'], string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-content-muted',
}

export function MacroOverview({ indicators }: { indicators: MacroIndicator[] }) {
  if (indicators.length === 0) {
    return (
      <section aria-labelledby="macro-overview-heading">
        <h3 id="macro-overview-heading" className="hud-label text-xs text-content-muted">
          Makroöversikt
        </h3>
        <div className="hud-frame mt-3 flex items-center justify-center rounded-xl bg-surface p-8">
          <DataNotAvailable />
        </div>
      </section>
    )
  }

  const gdpGrowth = indicators.find((indicator) => indicator.id === 'gdp-growth')
  const gdpValue = gdpGrowth ? parseLeadingNumber(gdpGrowth.value) : null

  return (
    <section aria-labelledby="macro-overview-heading" className="flex flex-col gap-4">
      <h3 id="macro-overview-heading" className="hud-label text-xs text-content-muted">
        Makroöversikt
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {indicators.map((indicator) => {
          const Icon = TREND_ICON[indicator.trend]
          return (
            <div
              key={indicator.id}
              className="hud-frame flex flex-col gap-1.5 rounded-lg bg-surface p-4"
            >
              <span className="hud-label text-[9px] text-content-subtle">
                {indicator.label}
              </span>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xl text-content">
                    {indicator.value}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 font-mono text-xs',
                      TONE_CLASS[indicator.tone],
                    )}
                  >
                    <Icon className="h-3 w-3" aria-hidden="true" />
                    {indicator.change}
                  </span>
                </div>
                {indicator.sparkline && indicator.sparkline.length > 1 && (
                  <Sparkline
                    data={indicator.sparkline}
                    trendUp={indicator.tone !== 'negative'}
                  />
                )}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-[10px] text-content-subtle">
                  {indicator.period}
                </span>
                <DataSourceBadge source={indicator.source} />
              </div>
            </div>
          )
        })}
      </div>

      {gdpGrowth && gdpValue !== null && (
        <div className="hud-frame rounded-lg bg-surface p-4 lg:w-1/2">
          <TrendChart
            data={buildChartSeries(
              gdpValue,
              seedFromString(gdpGrowth.id),
              RELATIVE_QUARTER_LABELS,
            )}
            title="Real BNP-tillväxt, trend"
            trendUp={gdpGrowth.trend === 'up'}
            unit=" pp"
          />
        </div>
      )}
    </section>
  )
}
