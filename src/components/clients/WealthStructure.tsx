import { ChartPie } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import type { Client360 } from '~/application/advisory/client360'
import { cn } from '~/lib/cn'
import { wealthSlices } from '~/presentation/advisory/chartData'
import { formatLongDate, formatMsek, formatPct } from '~/presentation/advisory/format'
import { Module } from './dossier/Module'

/**
 * The wealth snapshot: the whole financial situation by kind — property,
 * portfolio, pension, company, cash — as a donut with the total in its
 * centre, the legend beside it with the share and the amount, and the
 * three totals the balance sheet derives beneath. The assets themselves
 * stand in the holdings module.
 */
export function WealthStructure({
  view,
  className,
}: {
  view: Client360
  className?: string
}) {
  const { balanceSheet } = view
  const slices = wealthSlices(balanceSheet)
  /* "34,2" and "MSEK": the amount in the centre, the unit beneath it. */
  const [amount, unit] = formatMsek(balanceSheet.totalAssets).split(' ')
  return (
    <Module
      id="formogenhet"
      title="Förmögenhetens sammansättning"
      icon={ChartPie}
      meta={
        balanceSheet.oldestValuationAt
          ? `Uppdaterad ${formatLongDate(balanceSheet.oldestValuationAt)}`
          : undefined
      }
      className={className}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <figure className="relative m-0 h-[150px] w-[150px] shrink-0 self-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="label"
                innerRadius="74%"
                outerRadius="100%"
                paddingAngle={1.5}
                stroke="#0b111c"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {slices.map((slice) => (
                  <Cell key={slice.id} fill={slice.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="type-display-figure-sm text-[26px]">{amount}</span>
            <span className="type-section mt-1">{unit}</span>
          </div>
          {/* The caption describes the figure; which record it reads from is the shell's to say, never a figure's. */}
          <figcaption className="sr-only">Fördelning av tillgångarna per slag.</figcaption>
        </figure>

        <ul className="min-w-0 flex-1" aria-label="Tillgångar per slag">
          {slices.map((slice) => (
            <li
              key={slice.id}
              className="dossier-row flex items-center gap-2.5 py-1.5 text-[12.5px]"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-[1px]"
                style={{ backgroundColor: slice.color }}
              />
              <span
                className="min-w-0 flex-1 truncate text-content-muted"
                title={slice.label}
              >
                {slice.label}
              </span>
              <span className="tabular w-[76px] shrink-0 text-right text-content">
                {formatMsek(slice.value)}
              </span>
              <span className="tabular w-11 shrink-0 text-right font-semibold text-content">
                {formatPct(slice.percent, 0)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-hairline pt-3">
        <Total label="Tillgångar" value={balanceSheet.totalAssets} />
        <Total label="Skulder" value={balanceSheet.totalLiabilities} negative />
        <Total label="Netto" value={balanceSheet.netWorth} />
      </dl>
    </Module>
  )
}

function Total({
  label,
  value,
  negative = false,
}: {
  label: string
  value: number
  negative?: boolean
}) {
  return (
    <div>
      <dt className="type-section">{label}</dt>
      <dd
        className={cn(
          'type-display-figure-sm mt-1 text-[19px]',
          negative && value > 0 ? 'text-negative' : 'text-content',
        )}
      >
        {negative && value > 0 ? '−' : ''}
        {formatMsek(value)}
      </dd>
    </div>
  )
}
