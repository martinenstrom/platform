import { TrendingDown, TrendingUp, Minus, X } from 'lucide-react'
import { useState } from 'react'
import { Sparkline } from '~/components/charts/Sparkline'
import {
  GLOBAL_MARKET_OVERVIEW,
  GLOBAL_RISK_SENTIMENT,
} from '~/data/countryExplorer/globalMarketOverview'
import { cn } from '~/lib/cn'
import type { MacroIndicator } from '~/types/countryExplorer'

const TREND_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus } as const
const TONE_CLASS: Record<MacroIndicator['tone'], string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-content-muted',
}

const SENTIMENT_LABEL = {
  'risk-on': 'RISK-ON',
  neutral: 'NEUTRAL',
  'risk-off': 'RISK-OFF',
} as const
const SENTIMENT_CLASS = {
  'risk-on': 'text-positive',
  neutral: 'text-warning',
  'risk-off': 'text-negative',
} as const

/** Floating glass card, upper-right of the map: global index-level context, always visible regardless of country selection. */
export function MarketOverviewPanel({ onClose }: { onClose?: () => void }) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="hud-frame w-72 rounded-lg bg-[#12161c]/85 p-3 shadow-pop backdrop-blur-xl transition-shadow duration-200 hover:shadow-[0_0_24px_rgba(76,198,232,0.08)]">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="hud-label text-[10px] text-content-subtle transition-colors duration-150 hover:text-content"
        >
          Market Overview
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Dölj Market Overview"
            className="text-content-subtle transition-colors duration-150 hover:text-content"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {GLOBAL_MARKET_OVERVIEW.map((indicator) => {
              const Icon = TREND_ICON[indicator.trend]
              return (
                <div
                  key={indicator.id}
                  className="rounded-md border border-line bg-canvas/60 p-2.5 transition-colors duration-150"
                >
                  <p className="hud-label truncate text-[8px] text-content-subtle">
                    {indicator.label}
                  </p>
                  <p className="mt-1 font-mono text-base text-content">
                    {indicator.value}
                  </p>
                  <span
                    className={cn(
                      'mt-0.5 inline-flex items-center gap-0.5 font-mono text-[10px]',
                      TONE_CLASS[indicator.tone],
                    )}
                  >
                    <Icon className="h-2.5 w-2.5" aria-hidden="true" />
                    {indicator.change}
                  </span>
                  {indicator.sparkline && (
                    <div className="mt-1">
                      <Sparkline
                        data={indicator.sparkline}
                        trendUp={indicator.tone !== 'negative'}
                        width={104}
                        height={22}
                        area
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-3 border-t border-line pt-2.5">
            <div className="flex items-center justify-between">
              <span className="hud-label text-[9px] text-content-subtle">
                Risk Sentiment
              </span>
              <span
                className={cn(
                  'hud-label text-[10px]',
                  SENTIMENT_CLASS[GLOBAL_RISK_SENTIMENT.sentiment],
                )}
              >
                {SENTIMENT_LABEL[GLOBAL_RISK_SENTIMENT.sentiment]}
              </span>
            </div>
            {/* Segmented gauge: red → amber → green blocks with a position marker. */}
            <div className="relative mt-1.5 flex h-1.5 w-full gap-0.5">
              {[
                'bg-negative',
                'bg-negative',
                'bg-negative/80',
                'bg-warning',
                'bg-warning',
                'bg-warning/80',
                'bg-positive/80',
                'bg-positive',
                'bg-positive',
                'bg-positive',
              ].map((segment, index) => (
                <span
                  key={index}
                  aria-hidden="true"
                  className={cn('h-full flex-1 rounded-[1px]', segment)}
                />
              ))}
              <span
                aria-hidden="true"
                className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-content shadow-[0_0_6px_rgba(232,237,247,0.8)]"
                style={{ left: `${GLOBAL_RISK_SENTIMENT.position}%` }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
