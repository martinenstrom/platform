import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { CHART_SURFACE } from '~/lib/chartTheme'
import { formatCurrency, formatNumber } from '~/lib/format'
import type { AllocationSlice } from '~/types'
import { ChartTooltip } from './ChartTooltip'

interface AllocationChartProps {
  data: AllocationSlice[]
  /** Total shown in the donut hole. */
  total: number
  currency?: string
}

/**
 * Donut + direct-labelled legend. The legend carries name, percent and amount,
 * so identity never depends on colour alone.
 */
export function AllocationChart({ data, total, currency = 'SEK' }: AllocationChartProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <figure className="relative m-0 h-44 w-44 shrink-0 self-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="66%"
              outerRadius="100%"
              paddingAngle={2}
              stroke={CHART_SURFACE}
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((slice) => (
                <Cell key={slice.id} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip content={<AllocationTooltip currency={currency} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] text-content-subtle">Totalt</span>
          <span className="tabular text-sm font-semibold text-content">
            {formatCurrency(total, currency, {
              notation: 'compact',
              maximumFractionDigits: 1,
            })}
          </span>
        </div>
        <figcaption className="sr-only">
          Fördelning av portföljens värde per tillgångsslag. Exempeldata.
        </figcaption>
      </figure>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((slice) => (
          <li key={slice.id} className="flex items-center gap-2.5 text-sm">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-xs"
              style={{ backgroundColor: slice.color }}
            />
            <span className="min-w-0 flex-1 truncate text-content-muted">
              {slice.label}
            </span>
            <span className="tabular w-12 text-right font-medium text-content">
              {formatNumber(slice.percent, 1)} %
            </span>
            <span className="tabular hidden w-24 text-right text-xs text-content-subtle sm:block">
              {formatCurrency(slice.value, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface PiePayloadEntry {
  payload?: AllocationSlice
}

function AllocationTooltip({
  active,
  payload,
  currency = 'SEK',
}: {
  active?: boolean
  payload?: PiePayloadEntry[]
  currency?: string
}) {
  const slice = payload?.[0]?.payload
  if (!active || !slice) return null

  return (
    <ChartTooltip
      title={slice.label}
      rows={[
        {
          label: 'Andel',
          value: `${formatNumber(slice.percent, 1)} %`,
          color: slice.color,
        },
        { label: 'Värde', value: formatCurrency(slice.value, currency) },
      ]}
    />
  )
}
