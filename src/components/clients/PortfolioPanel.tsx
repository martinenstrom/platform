import type { Client360 } from '~/application/advisory/client360'
import { PerformanceChart } from '~/components/charts/PerformanceChart'
import { Panel } from '~/components/ui/Panel'
import { cn } from '~/lib/cn'
import { ASSET_CLASS_COLOR, performancePoints } from '~/presentation/advisory/chartData'
import {
  formatLongDate,
  formatMsek,
  formatPct,
  formatPoints,
  formatSignedPct,
} from '~/presentation/advisory/format'
import { ASSET_CLASS_LABEL, STRATEGIC_ROLE_LABEL } from '~/presentation/advisory/text'

/**
 * The portfolio against the mandate: every asset class with its strategic
 * weight, its current weight and the deviation in points; the holdings
 * with their strategic role; the indexed performance against the benchmark.
 * The deviation is arithmetic on facts — no allocation is recommended here.
 */
export function PortfolioPanel({ view }: { view: Client360 }) {
  const { portfolio, deviations } = view
  if (!portfolio) {
    return (
      <Panel title="Portfölj" bodyClassName="p-3">
        <p className="type-inst-sub">Ingen portfölj hos banken.</p>
      </Panel>
    )
  }
  const worst = deviations.reduce(
    (max, d) => Math.max(max, Math.abs(d.deviationPoints)),
    0,
  )
  return (
    <Panel
      title="Portfölj"
      meta={`${formatMsek(portfolio.totalValue)} · ${portfolio.benchmarkName} · värderad ${formatLongDate(portfolio.valuedAt)}${portfolio.source === 'synthetic' ? ' · syntetisk' : ''}`}
      bodyClassName="p-3"
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section aria-label="Allokering mot strategi">
          <div className="flex items-baseline justify-between">
            <h3 className="type-section">Allokering mot strategi</h3>
            <span className={cn('type-machine', worst >= 5 ? 'text-warning' : undefined)}>
              största avvikelse {formatPoints(worst)}
            </span>
          </div>
          <ul className="mt-2 space-y-2">
            {deviations.map((d) => (
              <li key={d.assetClass}>
                <div className="flex items-baseline justify-between text-[12px]">
                  <span className="flex items-center gap-2 text-content">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-xs"
                      style={{ backgroundColor: ASSET_CLASS_COLOR[d.assetClass] }}
                    />
                    {ASSET_CLASS_LABEL[d.assetClass]}
                  </span>
                  <span className="tabular flex items-baseline gap-3">
                    <span className="text-content-subtle">
                      mål {formatPct(d.strategicPercent, 0)}
                    </span>
                    <span className="text-content">{formatPct(d.currentPercent, 0)}</span>
                    <span
                      className={cn(
                        'w-14 text-right',
                        Math.abs(d.deviationPoints) >= 5
                          ? 'text-warning'
                          : Math.abs(d.deviationPoints) >= 3
                            ? 'text-content-muted'
                            : 'text-content-subtle',
                      )}
                    >
                      {formatPoints(d.deviationPoints)}
                    </span>
                  </span>
                </div>
                <div
                  className="relative mt-1 h-1.5 w-full rounded-full bg-surface-3"
                  aria-hidden="true"
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${d.currentPercent}%`,
                      backgroundColor: ASSET_CLASS_COLOR[d.assetClass],
                    }}
                  />
                  <div
                    className="absolute -inset-y-0.5 w-px bg-content"
                    style={{ left: `${d.strategicPercent}%` }}
                    title={`Strategisk vikt ${d.strategicPercent} %`}
                  />
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <h3 className="type-section">Utveckling, 52 veckor</h3>
            <div className="mt-1 flex items-baseline gap-3">
              <span
                className={cn(
                  'tabular text-[15px] font-semibold',
                  portfolio.performanceYtdPercent >= 0
                    ? 'text-positive'
                    : 'text-negative',
                )}
              >
                {formatSignedPct(portfolio.performanceYtdPercent)}
              </span>
              <span className="type-inst-sub">i år</span>
            </div>
            <div className="mt-1">
              <PerformanceChart
                data={performancePoints(portfolio.performance)}
                range="1Y"
              />
            </div>
          </div>
        </section>

        <section aria-label="Större innehav" className="min-w-0">
          <h3 className="type-section">Större innehav</h3>
          <table className="mt-2 w-full border-collapse text-[12px]">
            <thead>
              <tr>
                <th scope="col" className="type-section pb-1.5 text-left font-semibold">
                  Innehav
                </th>
                <th scope="col" className="type-section pb-1.5 text-left font-semibold">
                  Roll
                </th>
                <th scope="col" className="type-section pb-1.5 text-right font-semibold">
                  Värde
                </th>
                <th scope="col" className="type-section pb-1.5 text-right font-semibold">
                  Vikt
                </th>
                <th scope="col" className="type-section pb-1.5 text-right font-semibold">
                  I år
                </th>
              </tr>
            </thead>
            <tbody>
              {[...portfolio.holdings]
                .sort((a, b) => b.marketValue - a.marketValue)
                .map((holding) => (
                  <tr key={holding.id} className="border-t border-line">
                    <td className="py-1.5 pr-2">
                      <span className="type-inst block truncate">{holding.name}</span>
                      <span className="type-inst-sub flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-xs"
                          style={{
                            backgroundColor: ASSET_CLASS_COLOR[holding.assetClass],
                          }}
                        />
                        {ASSET_CLASS_LABEL[holding.assetClass]} · {holding.currency}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-content-muted">
                      {STRATEGIC_ROLE_LABEL[holding.role]}
                    </td>
                    <td className="tabular py-1.5 pr-2 text-right text-content">
                      {formatMsek(holding.marketValue)}
                    </td>
                    <td className="tabular py-1.5 pr-2 text-right text-content-muted">
                      {formatPct(holding.weightPercent, 0)}
                    </td>
                    <td
                      className={cn(
                        'tabular py-1.5 text-right',
                        holding.performanceYtdPercent >= 0
                          ? 'text-positive'
                          : 'text-negative',
                      )}
                    >
                      {formatSignedPct(holding.performanceYtdPercent)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {(view.currencyExposure.length > 0 || view.sectorExposure.length > 0) && (
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-2">
              <div className="flex items-baseline gap-2">
                <dt className="type-inst-sub">Valuta</dt>
                <dd className="type-machine text-content-muted">
                  {view.currencyExposure
                    .map((c) => `${c.currency} ${c.percent} %`)
                    .join(' · ')}
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="type-inst-sub">Största sektorer</dt>
                <dd className="type-machine text-content-muted">
                  {view.sectorExposure
                    .filter((s) => s.sector !== 'multi')
                    .slice(0, 3)
                    .map((s) => `${s.sector} ${s.percent} %`)
                    .join(' · ') || '—'}
                </dd>
              </div>
            </dl>
          )}
        </section>
      </div>
    </Panel>
  )
}
