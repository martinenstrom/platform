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
import { signalText } from '~/presentation/advisory/intelligenceText'
import { ASSET_CLASS_LABEL, STRATEGIC_ROLE_LABEL } from '~/presentation/advisory/text'
import { JarvisMark } from './JarvisBlock'

/**
 * Portfölj & strategi: the portfolio against the mandate — every asset
 * class with its actual weight, its target and the deviation in points on
 * a thin bar with the target marked — and JARVIS's reading of it beside
 * them, which is the allocation-drift rule and nothing else: a deviation
 * of five points or more is a signal, a smaller one is within mandate.
 * Then the holdings with their strategic role and the indexed performance
 * against the benchmark. The deviation is arithmetic on facts — no
 * allocation is recommended here.
 */
export function PortfolioPanel({ view }: { view: Client360 }) {
  const { portfolio, deviations } = view
  if (!portfolio) {
    return (
      <Panel title="Portfölj & strategi" bodyClassName="p-3">
        <p className="type-inst-sub">Ingen portfölj hos banken.</p>
      </Panel>
    )
  }
  const largest = [...deviations].sort(
    (a, b) => Math.abs(b.deviationPoints) - Math.abs(a.deviationPoints),
  )[0]
  const drift = view.signals.find((signal) => signal.kind === 'allocation-drift')

  return (
    <Panel
      title="Portfölj & strategi"
      meta={
        <span className="flex flex-wrap items-center gap-x-2">
          <span>{formatMsek(portfolio.totalValue)}</span>
          <span aria-hidden="true">|</span>
          <span>{portfolio.benchmarkName}</span>
          <span aria-hidden="true">|</span>
          <span>Värderad {formatLongDate(portfolio.valuedAt)}</span>
          {portfolio.source === 'synthetic' && (
            <>
              <span aria-hidden="true">|</span>
              <span>syntetisk</span>
            </>
          )}
        </span>
      }
      bodyClassName="p-4"
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,36%)]">
        <section aria-label="Allokering mot strategi" className="min-w-0">
          <div className="grid grid-cols-[minmax(0,1fr)_52px_52px_60px] items-baseline gap-x-3">
            <span className="type-section">Tillgångsslag</span>
            <span className="type-section text-right">Faktisk</span>
            <span className="type-section text-right">Mål</span>
            <span className="type-section text-right">Avvikelse</span>
          </div>
          <ul className="mt-2 space-y-2.5">
            {deviations.map((d) => (
              <li
                key={d.assetClass}
                className="grid grid-cols-[minmax(0,1fr)_52px_52px_60px] items-center gap-x-3"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[12.5px] text-content">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: ASSET_CLASS_COLOR[d.assetClass] }}
                    />
                    <span className="truncate">{ASSET_CLASS_LABEL[d.assetClass]}</span>
                  </span>
                  <span
                    className="relative mt-1.5 block h-[3px] w-full rounded-full bg-white/[0.08]"
                    aria-hidden="true"
                  >
                    <span
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${Math.min(100, d.currentPercent)}%`,
                        backgroundColor: ASSET_CLASS_COLOR[d.assetClass],
                      }}
                    />
                    <span
                      className="absolute -inset-y-[3px] w-px bg-[#e9e1cf]"
                      style={{ left: `${Math.min(100, d.strategicPercent)}%` }}
                      title={`Strategisk vikt ${d.strategicPercent} %`}
                    />
                  </span>
                </span>
                <span className="tabular text-right text-[13px] font-semibold text-content">
                  {formatPct(d.currentPercent, 0)}
                </span>
                <span className="tabular text-right text-[12px] text-content-subtle">
                  {formatPct(d.strategicPercent, 0)}
                </span>
                <span
                  className={cn(
                    'tabular text-right text-[12px]',
                    Math.abs(d.deviationPoints) >= 5
                      ? 'text-warning'
                      : Math.abs(d.deviationPoints) >= 3
                        ? 'text-content-muted'
                        : 'text-content-subtle',
                  )}
                >
                  {formatPoints(d.deviationPoints)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* JARVIS's reading: the drift rule, spoken once, in the gold material at low volume. */}
        <section aria-label="JARVIS insikt" className="jarvis-gold-soft px-4 py-3.5">
          <JarvisMark kind="insight" className="text-[#e6c987]" />
          {largest ? (
            <>
              <p className="type-display-statement mt-2 text-[19px]">
                {formatPoints(largest.deviationPoints)}{' '}
                {ASSET_CLASS_LABEL[largest.assetClass].toLowerCase()}
                {largest.deviationPoints >= 0 ? 'övervikt' : 'undervikt'}
              </p>
              <p className="mt-1.5 text-[12.5px] leading-snug text-content-muted">
                {drift
                  ? `${signalText(drift).why} ${signalText(drift).action}`
                  : 'Inom mandat. Ingen ombalansering krävs just nu.'}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[12.5px] text-content-muted">
              Ingen allokering att jämföra mot strategin.
            </p>
          )}
          <p className="type-machine mt-3">
            {drift ? 'avvikelse ≥ 5 pp · signal' : 'avvikelse < 5 pp'} · rule-based-v1
          </p>
        </section>
      </div>

      <div className="mt-4 grid gap-4 border-t border-line pt-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section aria-label="Utveckling">
          <div className="flex items-baseline justify-between">
            <h3 className="type-section">Utveckling, 52 veckor</h3>
            <span className="flex items-baseline gap-1.5">
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
            </span>
          </div>
          <div className="mt-1">
            <PerformanceChart
              data={performancePoints(portfolio.performance)}
              range="1Y"
            />
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
                  <tr key={holding.id} className="border-t border-white/[0.06]">
                    <td className="py-1.5 pr-2">
                      <span className="type-inst block truncate">{holding.name}</span>
                      <span className="type-inst-sub flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full"
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
