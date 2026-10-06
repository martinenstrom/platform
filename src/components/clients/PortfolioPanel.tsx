import { BriefcaseBusiness, ShieldCheck, TrendingUp } from 'lucide-react'
import type { Client360 } from '~/application/advisory/client360'
import { PerformanceChart } from '~/components/charts/PerformanceChart'
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
import { Empty, Foot, Module } from './dossier/Module'
import { JarvisMark } from './JarvisBlock'

/**
 * The portfolio, as three modules of the financial picture.
 *
 * `AllocationCard`: the portfolio against the mandate — every asset class
 * with its actual weight, its target and the deviation in points on a thin
 * bar with the target marked — and JARVIS's reading of it beneath, which is
 * the allocation-drift rule and nothing else: a deviation of five points or
 * more is a signal, a smaller one is within mandate. `PerformanceCard`: the
 * indexed 52-week performance against the benchmark. `PortfolioHoldingsCard`:
 * the holdings with their strategic role, and the exposures. The deviation
 * is arithmetic on facts — no allocation is recommended here.
 */
export function AllocationCard({
  view,
  className,
}: {
  view: Client360
  className?: string
}) {
  const { portfolio, deviations } = view
  if (!portfolio) {
    return (
      <Module
        id="portfolj"
        title="Portfölj mot strategi"
        icon={ShieldCheck}
        className={className}
      >
        <Empty>Ingen portfölj hos banken.</Empty>
      </Module>
    )
  }
  const largest = [...deviations].sort(
    (a, b) => Math.abs(b.deviationPoints) - Math.abs(a.deviationPoints),
  )[0]
  const drift = view.signals.find((signal) => signal.kind === 'allocation-drift')

  return (
    <Module
      id="portfolj"
      title="Portfölj mot strategi"
      icon={ShieldCheck}
      meta={formatMsek(portfolio.totalValue)}
      className={className}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_46px_42px_56px] items-baseline gap-x-3">
        <span className="type-section">Tillgångsslag</span>
        <span className="type-section text-right">Faktisk</span>
        <span className="type-section text-right">Mål</span>
        <span className="type-section text-right">Avvikelse</span>
      </div>
      <ul className="mt-2.5 space-y-3" aria-label="Allokering mot strategi">
        {deviations.map((d) => (
          <li
            key={d.assetClass}
            className="grid grid-cols-[minmax(0,1fr)_46px_42px_56px] items-center gap-x-3"
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
                className="relative mt-1.5 block h-[3px] w-full rounded-[1px] bg-hairline-strong"
                aria-hidden="true"
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-[1px]"
                  style={{
                    width: `${Math.min(100, d.currentPercent)}%`,
                    backgroundColor: ASSET_CLASS_COLOR[d.assetClass],
                  }}
                />
                <span
                  className="absolute -inset-y-[3px] w-px bg-content"
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

      {/* JARVIS's reading: the drift rule, spoken once, as one line under a hairline. */}
      <div className="mt-4 border-t border-hairline pt-3" aria-label="JARVIS insikt">
        <JarvisMark kind="insight" className="text-[#e6c987]" />
        {largest ? (
          <>
            <p className="mt-1.5 font-display text-[17px] leading-snug text-content">
              {formatPoints(largest.deviationPoints)}{' '}
              {ASSET_CLASS_LABEL[largest.assetClass].toLowerCase()}
              {largest.deviationPoints >= 0 ? 'övervikt' : 'undervikt'}
            </p>
            <p className="type-inst-sub mt-1 leading-[1.05rem]">
              {drift
                ? `${signalText(drift).why} ${signalText(drift).action}`
                : 'Inom mandat. Ingen ombalansering krävs just nu.'}
            </p>
          </>
        ) : (
          <p className="type-inst-sub mt-1.5">
            Ingen allokering att jämföra mot strategin.
          </p>
        )}
      </div>
      <Foot>
        {drift ? 'avvikelse ≥ 5 pp · signal' : 'avvikelse < 5 pp'} · rule-based-v1 ·
        värderad {formatLongDate(portfolio.valuedAt)}
        {portfolio.source === 'synthetic' && ' · syntetisk'}
      </Foot>
    </Module>
  )
}

export function PerformanceCard({
  view,
  className,
}: {
  view: Client360
  className?: string
}) {
  const { portfolio } = view
  if (!portfolio) return null
  return (
    <Module
      title="Utveckling 52 veckor"
      icon={TrendingUp}
      meta={
        <span className="flex items-baseline gap-1.5">
          <span
            className={cn(
              'tabular text-[14px] font-semibold',
              portfolio.performanceYtdPercent >= 0 ? 'text-positive' : 'text-negative',
            )}
          >
            {formatSignedPct(portfolio.performanceYtdPercent)}
          </span>
          <span>i år</span>
        </span>
      }
      className={className}
    >
      <PerformanceChart data={performancePoints(portfolio.performance)} range="1Y" />
      <Foot>
        mot {portfolio.benchmarkName} · värderad {formatLongDate(portfolio.valuedAt)}
      </Foot>
    </Module>
  )
}

export function PortfolioHoldingsCard({
  view,
  className,
}: {
  view: Client360
  className?: string
}) {
  const { portfolio } = view
  if (!portfolio) return null
  const holdings = [...portfolio.holdings].sort((a, b) => b.marketValue - a.marketValue)
  return (
    <Module
      title="Större innehav i portföljen"
      icon={BriefcaseBusiness}
      meta={`${holdings.length} innehav`}
      className={className}
      bodyClassName="px-5 pb-3"
    >
      <table className="w-full border-collapse text-[12px]" aria-label="Större innehav">
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
          {holdings.map((holding) => (
            <tr key={holding.id} className="border-t border-hairline">
              <td className="py-2 pr-2">
                <span className="block truncate text-[13px] text-content">
                  {holding.name}
                </span>
                <span className="type-inst-sub flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: ASSET_CLASS_COLOR[holding.assetClass] }}
                  />
                  {ASSET_CLASS_LABEL[holding.assetClass]} · {holding.currency}
                </span>
              </td>
              <td className="py-2 pr-2 text-content-muted">
                {STRATEGIC_ROLE_LABEL[holding.role]}
              </td>
              <td className="tabular py-2 pr-2 text-right text-content">
                {formatMsek(holding.marketValue)}
              </td>
              <td className="tabular py-2 pr-2 text-right text-content-muted">
                {formatPct(holding.weightPercent, 0)}
              </td>
              <td
                className={cn(
                  'tabular py-2 text-right',
                  holding.performanceYtdPercent >= 0 ? 'text-positive' : 'text-negative',
                )}
              >
                {formatSignedPct(holding.performanceYtdPercent)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(view.currencyExposure.length > 0 || view.sectorExposure.length > 0) && (
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 border-t border-hairline pt-2.5">
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
    </Module>
  )
}
