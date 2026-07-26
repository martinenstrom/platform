import { useId } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CHART_AXIS_TEXT, CHART_GRID, CHART_SURFACE, STATUS } from '~/lib/chartTheme'
import { formatNumber } from '~/lib/format'
import type { ChartPoint } from '~/data/countryExplorer/trendSeries'
import { ChartTooltip } from './ChartTooltip'

interface TrendChartProps {
  data: ChartPoint[]
  title: string
  trendUp: boolean
  unit?: string
}

/**
 * Small single-series area chart for the Country Explorer's Macro/Markets
 * tabs (GDP trend, equity index, currency performance). Same Recharts +
 * `chartTheme.ts` setup as `PerformanceChart.tsx`, scaled down to one series.
 */
export function TrendChart({ data, title, trendUp, unit = '' }: TrendChartProps) {
  const gradientId = useId().replace(/:/g, '')
  const color = trendUp ? STATUS.positive : STATUS.negative

  return (
    <figure className="m-0">
      <p className="hud-label text-[10px] text-content-subtle">{title}</p>
      <div className="mt-2 h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke={CHART_GRID}
              strokeOpacity={0.55}
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="t"
              tick={{ fill: CHART_AXIS_TEXT, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              domain={['dataMin', 'dataMax']}
              tick={{ fill: CHART_AXIS_TEXT, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={36}
              tickFormatter={(value: number) => formatNumber(value, 1)}
            />
            <Tooltip
              cursor={{ stroke: CHART_GRID, strokeWidth: 1 }}
              content={<TrendTooltip unit={unit} />}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 2, stroke: CHART_SURFACE }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        {title}, illustrativ trendserie, exempeldata.
      </figcaption>
    </figure>
  )
}

interface TooltipPayloadEntry {
  value?: number
}

function TrendTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: string
  unit: string
}) {
  if (!active || !payload?.length) return null
  const value = payload[0]?.value ?? 0

  return (
    <ChartTooltip
      title={String(label ?? '')}
      rows={[{ label: 'Värde', value: `${formatNumber(value, 1)}${unit}` }]}
    />
  )
}
