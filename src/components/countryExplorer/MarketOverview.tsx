import { TrendChart } from '~/components/charts/TrendChart'
import {
  parseLeadingNumber,
  buildChartSeries,
  seedFromString,
  RELATIVE_QUARTER_LABELS,
} from '~/data/countryExplorer/trendSeries'
import { DataNotAvailable } from './DataSourceBadge'
import type { MarketOverviewData } from '~/types/countryExplorer'

function MetricRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-content-subtle">{label}</span>
      <span className="font-mono text-xs text-content">{value ?? '—'}</span>
    </div>
  )
}

export function MarketOverview({ markets }: { markets: MarketOverviewData | null }) {
  const ytd = markets ? parseLeadingNumber(markets.indexChangeYtd) : null
  const currencyChange = markets ? parseLeadingNumber(markets.currencyPerformance) : null

  return (
    <section aria-labelledby="market-overview-heading" className="flex flex-col gap-4">
      <h3 id="market-overview-heading" className="hud-label text-xs text-content-muted">
        Marknadsöversikt
      </h3>

      {!markets ? (
        <div className="hud-frame flex items-center justify-center rounded-xl bg-surface p-8">
          <DataNotAvailable />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="hud-frame rounded-lg bg-surface p-4">
              <p className="hud-label mb-1 text-[9px] text-content-subtle">
                {markets.primaryIndexName}
              </p>
              <p className="font-mono text-2xl text-content">
                {markets.primaryIndexValue}
              </p>
              <div className="mt-3 divide-y divide-line">
                <MetricRow label="I dag" value={markets.indexChangeToday} />
                <MetricRow label="1 månad" value={markets.indexChange1M} />
                <MetricRow label="I år (YTD)" value={markets.indexChangeYtd} />
                <MetricRow label="12 månader" value={markets.indexChange12M} />
              </div>
            </div>

            <div className="hud-frame rounded-lg bg-surface p-4">
              <p className="hud-label mb-1 text-[9px] text-content-subtle">
                Värdering &amp; likviditet
              </p>
              <div className="mt-2 divide-y divide-line">
                <MetricRow label="P/E" value={markets.peRatio} />
                <MetricRow label="Forward P/E" value={markets.forwardPeRatio} />
                <MetricRow label="Direktavkastning" value={markets.dividendYield} />
                <MetricRow label="Börsvärde" value={markets.marketCap} />
                <MetricRow
                  label="Genomsnittlig daglig volym"
                  value={markets.avgDailyVolume}
                />
                <MetricRow label="Utländskt ägande" value={markets.foreignOwnership} />
                <MetricRow label="Volatilitet" value={markets.volatility} />
                <MetricRow label="Valutautveckling" value={markets.currencyPerformance} />
                <MetricRow label="Kreditspread" value={markets.creditSpread} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {ytd !== null && (
              <div className="hud-frame rounded-lg bg-surface p-4">
                <TrendChart
                  data={buildChartSeries(
                    ytd,
                    seedFromString(markets.primaryIndexName),
                    RELATIVE_QUARTER_LABELS,
                  )}
                  title={`${markets.primaryIndexName} — indexutveckling`}
                  trendUp={ytd >= 0}
                  unit="%"
                />
              </div>
            )}
            {currencyChange !== null && (
              <div className="hud-frame rounded-lg bg-surface p-4">
                <TrendChart
                  data={buildChartSeries(
                    currencyChange,
                    seedFromString(markets.currencyPerformance),
                    RELATIVE_QUARTER_LABELS,
                  )}
                  title="Valutautveckling"
                  trendUp={currencyChange >= 0}
                  unit="%"
                />
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
