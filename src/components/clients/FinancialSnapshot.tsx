import type { Client360 } from '~/application/advisory/client360'
import { Panel } from '~/components/ui/Panel'
import { cn } from '~/lib/cn'
import {
  formatLongDate,
  formatMsek,
  formatPct,
  formatRiskProfile,
} from '~/presentation/advisory/format'

/**
 * The client's financial life in one row: total wealth, what the firm
 * holds, liquidity, liabilities, net worth and the mandate's risk profile —
 * with share of wallet, income and the equity position beneath. Every
 * figure is the balance sheet's own derivation; the oldest valuation date
 * is stated so a stale figure cannot pass as a fresh one.
 */
export function FinancialSnapshot({ view }: { view: Client360 }) {
  const { balanceSheet, client, portfolio } = view
  const equity =
    portfolio?.allocation.find((slice) => slice.assetClass === 'equities') ?? null
  const external = balanceSheet.totalAssets - balanceSheet.assetsWithBank

  const figures: { label: string; value: string; tone?: 'positive' | 'negative' }[] = [
    { label: 'Total förmögenhet', value: formatMsek(balanceSheet.totalAssets) },
    { label: 'AUM hos banken', value: formatMsek(balanceSheet.assetsWithBank) },
    { label: 'Likviditet', value: formatMsek(balanceSheet.liquidity) },
    {
      label: 'Skulder',
      value: formatMsek(balanceSheet.totalLiabilities),
      tone: balanceSheet.totalLiabilities > 0 ? 'negative' : undefined,
    },
    { label: 'Nettoförmögenhet', value: formatMsek(balanceSheet.netWorth) },
    { label: 'Riskprofil', value: formatRiskProfile(client.riskProfile) },
  ]

  const details: { label: string; value: string }[] = [
    {
      label: 'Årsinkomst',
      value:
        client.annualIncome === null ? 'Ej angiven' : formatMsek(client.annualIncome),
    },
    { label: 'Externa tillgångar', value: formatMsek(external) },
    {
      label: 'Andel av plånboken',
      value: formatPct(balanceSheet.shareOfWalletPercent, 0),
    },
    {
      label: 'Strategisk aktieandel',
      value: equity ? formatPct(equity.strategicPercent, 0) : 'Inget mandat',
    },
    {
      label: 'Aktuell aktieandel',
      value: equity ? formatPct(equity.currentPercent, 0) : 'Inget mandat',
    },
  ]

  return (
    <Panel
      title="Finansiell ögonblicksbild"
      meta={
        balanceSheet.oldestValuationAt
          ? `Äldsta värdering ${formatLongDate(balanceSheet.oldestValuationAt)}`
          : undefined
      }
      bodyClassName="p-3"
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
        {figures.map((figure) => (
          <div key={figure.label} className="min-w-0">
            <dt className="type-section">{figure.label}</dt>
            <dd
              className={cn(
                'type-figure mt-1 truncate',
                figure.tone === 'negative' && 'text-content',
              )}
            >
              {figure.value}
            </dd>
          </div>
        ))}
      </dl>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-2.5">
        {details.map((detail) => (
          <div key={detail.label} className="flex items-baseline gap-2">
            <dt className="type-inst-sub">{detail.label}</dt>
            <dd className="type-inst tabular">{detail.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}
