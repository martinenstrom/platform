import { Coins, CreditCard, Droplets, Gauge, HeartPulse, Landmark } from 'lucide-react'
import type { Client360 } from '~/application/advisory/client360'
import type { RelationshipHealth } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import {
  formatDaysFromToday,
  formatLongDate,
  formatMsek,
  formatPct,
  formatRiskProfile,
} from '~/presentation/advisory/format'
import {
  HEALTH_BAND_LABEL,
  LIABILITY_KIND_LABEL,
  riskProfileLabel,
} from '~/presentation/advisory/text'
import { Bar, MetricCard, Ring, Scale, type VisualTone } from './dossier/MetricCard'

const BAND_TEXT: Record<RelationshipHealth['band'], string> = {
  strong: 'text-positive',
  stable: 'text-content',
  watch: 'text-warning',
  'at-risk': 'text-negative',
}

const BAND_BAR: Record<RelationshipHealth['band'], VisualTone> = {
  strong: 'positive',
  stable: 'gold',
  watch: 'warning',
  'at-risk': 'negative',
}

/**
 * The client's financial life as six metric cards in one row: total wealth
 * first and heaviest, then what the firm holds, liquidity, debt, the
 * mandate's risk profile and the relationship's health — each the figure
 * first and one or two qualifying lines beneath, with one small visual.
 * Every figure is the balance sheet's or the read model's own; the shares
 * are arithmetic on the figures shown.
 */
export function FinancialStrip({ view }: { view: Client360 }) {
  const { balanceSheet, client, liabilities, health } = view
  const external = balanceSheet.totalAssets - balanceSheet.assetsWithBank
  const share = (part: number) =>
    balanceSheet.totalAssets > 0 ? (part / balanceSheet.totalAssets) * 100 : 0
  const bankShare = Math.round(share(balanceSheet.assetsWithBank))
  const debtRatio = Math.round(share(balanceSheet.totalLiabilities))
  const liquidityShare = share(balanceSheet.liquidity)
  const largestLoan = [...liabilities].sort(
    (a, b) => b.outstandingBalance - a.outstandingBalance,
  )[0]
  const contact =
    view.daysSinceContact === null
      ? 'Ingen kontakt registrerad'
      : view.daysSinceContact > 30
        ? `Ingen kontakt på ${view.daysSinceContact} dagar`
        : `Kontakt ${formatDaysFromToday(-view.daysSinceContact)}`

  return (
    <section aria-label="Finansiell översikt">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-[minmax(0,1.25fr)_repeat(5,minmax(0,1fr))]">
        <MetricCard
          icon={Coins}
          label="Total förmögenhet"
          lead
          value={formatMsek(balanceSheet.totalAssets)}
          support={
            <>
              Externt {formatMsek(external)}
              {balanceSheet.oldestValuationAt && (
                <span className="block">
                  värderad {formatLongDate(balanceSheet.oldestValuationAt)}
                </span>
              )}
            </>
          }
        />

        <MetricCard
          icon={Landmark}
          label="Hos banken"
          value={formatMsek(balanceSheet.assetsWithBank)}
          support={
            <>
              <span className="tabular text-content">{bankShare} %</span> av förmögenheten
              <span className="block">
                {formatPct(balanceSheet.shareOfWalletPercent, 0)} av plånboken
              </span>
            </>
          }
          visual={<Bar percent={bankShare} />}
        />

        <MetricCard
          icon={Droplets}
          label="Likviditet"
          value={formatMsek(balanceSheet.liquidity)}
          support={
            <>
              Årsinkomst{' '}
              {client.annualIncome === null
                ? 'ej angiven'
                : formatMsek(client.annualIncome)}
            </>
          }
          visual={
            <Ring
              percent={liquidityShare}
              label={`${formatPct(liquidityShare, 1)} av tillgångarna`}
            />
          }
        />

        <MetricCard
          icon={CreditCard}
          label="Skulder"
          value={formatMsek(balanceSheet.totalLiabilities)}
          support={
            largestLoan
              ? `${liabilities.length > 1 ? `${liabilities.length} lån · ` : ''}${LIABILITY_KIND_LABEL[largestLoan.kind]} ${formatPct(largestLoan.ratePercent, 2)} ${largestLoan.interestType === 'fixed' ? 'bunden' : 'rörlig'}`
              : 'Inga lån i relationen'
          }
          visual={
            balanceSheet.totalLiabilities > 0 ? (
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="h-2 w-2 rounded-[1px] bg-negative" />
                <span className="type-inst-sub">Skuldkvot {debtRatio} %</span>
              </span>
            ) : (
              <span className="type-inst-sub">Skuldfri</span>
            )
          }
        />

        <MetricCard
          icon={Gauge}
          label="Riskprofil"
          value={
            client.riskProfile === null ? '—' : formatRiskProfile(client.riskProfile)
          }
          support={
            client.riskProfile === null
              ? 'Data saknas'
              : riskProfileLabel(client.riskProfile)
          }
          visual={
            client.riskProfile === null ? undefined : (
              <Scale value={client.riskProfile} steps={7} />
            )
          }
        />

        <MetricCard
          icon={HeartPulse}
          label="Relationshälsa"
          value={
            <span className={cn(BAND_TEXT[health.band])}>
              {health.score}
              <span className="text-[0.58em] text-content-subtle">/100</span>
            </span>
          }
          support={
            <>
              {HEALTH_BAND_LABEL[health.band]}
              <span className="block">{contact}</span>
            </>
          }
          visual={<Bar percent={health.score} tone={BAND_BAR[health.band]} />}
        />
      </dl>
    </section>
  )
}
