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
import { CHART_AXIS_TEXT, CHART_GRID, CHART_SURFACE, SERIES } from '~/lib/chartTheme'
import { formatNumber } from '~/lib/format'
import type { PerformancePoint, TimeRange } from '~/types'
import { ChartTooltip } from './ChartTooltip'

const SERIES_LABEL = {
  portfolio: 'Portfölj',
  benchmark: 'Jämförelseindex',
} as const

interface PerformanceChartProps {
  data: PerformancePoint[]
  range: TimeRange
}

/** Indexed portfolio vs benchmark. Both series share one y-axis by design. */
export function PerformanceChart({ data, range }: PerformanceChartProps) {
  const gradientId = useId().replace(/:/g, '')

  const first = data[0]
  const last = data[data.length - 1]
  const totalReturn = first && last ? last.portfolio - first.portfolio : 0

  return (
    <figure className="m-0">
      <SeriesLegend />
      {/* Height must be explicit for ResponsiveContainer to measure. */}
      <div className="mt-3 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id={`${gradientId}-portfolio`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES.portfolio} stopOpacity={0.28} />
                <stop offset="100%" stopColor={SERIES.portfolio} stopOpacity={0} />
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
              tickFormatter={(value: string) => formatAxisLabel(value, range)}
              tick={{ fill: CHART_AXIS_TEXT, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
            />
            <YAxis
              domain={['dataMin - 1', 'dataMax + 1']}
              tick={{ fill: CHART_AXIS_TEXT, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(value: number) => formatNumber(value, 0)}
            />
            <Tooltip
              cursor={{ stroke: CHART_GRID, strokeWidth: 1 }}
              content={<PerformanceTooltip range={range} />}
              isAnimationActive={false}
            />
            {/* Benchmark is the reference line — dashed and lighter so the
                portfolio (solid, filled) stays the primary read. */}
            <Area
              type="monotone"
              dataKey="benchmark"
              stroke={SERIES.benchmark}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              fill="none"
              dot={false}
              activeDot={{ r: 3.5, strokeWidth: 2, stroke: CHART_SURFACE }}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="portfolio"
              stroke={SERIES.portfolio}
              strokeWidth={2}
              fill={`url(#${gradientId}-portfolio)`}
              dot={false}
              activeDot={{ r: 3.5, strokeWidth: 2, stroke: CHART_SURFACE }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        Portföljens utveckling jämfört med jämförelseindex, indexerat till 100 vid
        periodens start. Portföljen slutar på {formatNumber(last?.portfolio ?? 100)} och
        index på {formatNumber(last?.benchmark ?? 100)}, en skillnad på{' '}
        {formatNumber(totalReturn)} indexenheter. Exempeldata.
      </figcaption>
    </figure>
  )
}

function SeriesLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-4">
      <LegendItem color={SERIES.portfolio} label={SERIES_LABEL.portfolio} />
      <LegendItem color={SERIES.benchmark} label={SERIES_LABEL.benchmark} dashed />
    </ul>
  )
}

function LegendItem({
  color,
  label,
  dashed = false,
}: {
  color: string
  label: string
  dashed?: boolean
}) {
  return (
    <li className="flex items-center gap-2 text-xs text-content-muted">
      <span
        aria-hidden="true"
        className="h-0.5 w-5 rounded-full"
        style={
          dashed
            ? {
                backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 5px, transparent 5px 9px)`,
              }
            : { backgroundColor: color }
        }
      />
      {label}
    </li>
  )
}

interface TooltipPayloadEntry {
  dataKey?: string | number
  value?: number
  color?: string
}

/** Recharts injects `active`, `payload` and `label` when cloning this element. */
function PerformanceTooltip({
  active,
  payload,
  label,
  range,
}: {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: string
  range: TimeRange
}) {
  if (!active || !payload?.length) return null

  return (
    <ChartTooltip
      title={formatAxisLabel(String(label ?? ''), range, true)}
      rows={payload.map((entry) => ({
        label:
          SERIES_LABEL[entry.dataKey as keyof typeof SERIES_LABEL] ??
          String(entry.dataKey),
        value: formatNumber(entry.value ?? 0),
        color: entry.color,
      }))}
      footer="Index = 100 vid periodens start"
    />
  )
}

function formatAxisLabel(value: string, range: TimeRange, long = false): string {
  if (range === '1D') return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  if (long) {
    return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date)
  }
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'short',
    ...(range === 'ALL' || range === '1Y' ? { year: '2-digit' } : {}),
  }).format(date)
}
