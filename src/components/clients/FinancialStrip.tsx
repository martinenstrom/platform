import type { ReactNode } from 'react'
import type { Client360 } from '~/application/advisory/client360'
import { cn } from '~/lib/cn'
import {
  formatLongDate,
  formatMsek,
  formatPct,
  formatRiskProfile,
} from '~/presentation/advisory/format'
import { LIABILITY_KIND_LABEL, RISK_PROFILE_LABEL } from '~/presentation/advisory/text'

/**
 * The client's financial life in one strip: total wealth first and
 * heaviest, then what the firm holds, net worth, liquidity, debt and the
 * mandate's risk profile — one panel cut by hairlines, never six cards.
 * Beneath each figure the fact that qualifies it: the share the firm holds,
 * the oldest valuation, the loan behind the debt, the name of the risk step.
 * Every figure is the balance sheet's own derivation; the two shares are
 * arithmetic on the figures shown.
 */
export function FinancialStrip({ view }: { view: Client360 }) {
  const { balanceSheet, client, liabilities, portfolio } = view
  const external = balanceSheet.totalAssets - balanceSheet.assetsWithBank
  const bankShare =
    balanceSheet.totalAssets > 0
      ? Math.round((balanceSheet.assetsWithBank / balanceSheet.totalAssets) * 100)
      : 0
  const debtRatio =
    balanceSheet.totalAssets > 0
      ? Math.round((balanceSheet.totalLiabilities / balanceSheet.totalAssets) * 100)
      : 0
  const largestLoan = [...liabilities].sort(
    (a, b) => b.outstandingBalance - a.outstandingBalance,
  )[0]
  const equity =
    portfolio?.allocation.find((slice) => slice.assetClass === 'equities') ?? null

  return (
    <section aria-label="Finansiell översikt" className="ref-panel @container">
      {/* Six across when the strip itself is wide enough — with JARVIS open beside it, three. */}
      <dl className="grid grid-cols-3 divide-line lg:divide-x @4xl:grid-cols-6">
        <Cell label="Total förmögenhet" lead>
          <span className="type-display-figure text-[28px] whitespace-nowrap text-institution">
            {formatMsek(balanceSheet.totalAssets)}
          </span>
          <Context>
            Externt {formatMsek(external)}
            {balanceSheet.oldestValuationAt && (
              <span className="block">
                värderad {formatLongDate(balanceSheet.oldestValuationAt)}
              </span>
            )}
          </Context>
        </Cell>

        <Cell label="Hos Handelsbanken">
          <span className="type-display-figure-sm whitespace-nowrap">
            {formatMsek(balanceSheet.assetsWithBank)}
          </span>
          <div className="mt-2 flex items-center gap-2">
            <ShareRing percent={bankShare} />
            <Context className="mt-0">
              <span className="tabular text-content">{bankShare} %</span> av förmögenheten
              <span className="block">
                {formatPct(balanceSheet.shareOfWalletPercent, 0)} av plånboken
              </span>
            </Context>
          </div>
        </Cell>

        <Cell label="Nettoförmögenhet">
          <span className="type-display-figure-sm whitespace-nowrap">
            {formatMsek(balanceSheet.netWorth)}
          </span>
          <Context>
            {balanceSheet.totalLiabilities > 0 ? `Skuldkvot ${debtRatio} %` : 'Skuldfri'}
          </Context>
        </Cell>

        <Cell label="Likviditet">
          <span className="type-display-figure-sm whitespace-nowrap">
            {formatMsek(balanceSheet.liquidity)}
          </span>
          <Context>
            Årsinkomst{' '}
            {client.annualIncome === null
              ? 'ej angiven'
              : formatMsek(client.annualIncome)}
          </Context>
        </Cell>

        <Cell label="Skulder">
          <span className="type-display-figure-sm whitespace-nowrap">
            {formatMsek(balanceSheet.totalLiabilities)}
          </span>
          <Context>
            {largestLoan
              ? `${liabilities.length > 1 ? `${liabilities.length} lån · ` : ''}${LIABILITY_KIND_LABEL[largestLoan.kind]} ${formatPct(largestLoan.ratePercent, 2)} ${largestLoan.interestType === 'fixed' ? 'bunden' : 'rörlig'}`
              : 'Inga lån'}
          </Context>
        </Cell>

        <Cell label="Riskprofil">
          <span className="type-display-figure-sm whitespace-nowrap">
            {formatRiskProfile(client.riskProfile)}
          </span>
          <div className="mt-2 flex items-center gap-[3px]" aria-hidden="true">
            {Array.from({ length: 7 }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-[5px] w-[11px] rounded-[1px]',
                  i < client.riskProfile ? 'bg-[#d9a441]' : 'bg-white/[0.12]',
                )}
              />
            ))}
          </div>
          <Context>{RISK_PROFILE_LABEL[client.riskProfile]}</Context>
        </Cell>
      </dl>

      {equity && (
        <p className="type-machine flex flex-wrap gap-x-5 gap-y-0.5 border-t border-line px-4 py-1.5">
          <span>
            Strategisk aktieandel{' '}
            <span className="text-content-muted">
              {formatPct(equity.strategicPercent, 0)}
            </span>
          </span>
          <span>
            Aktuell aktieandel{' '}
            <span className="text-content-muted">
              {formatPct(equity.currentPercent, 0)}
            </span>
          </span>
          {portfolio && (
            <span>
              Portfölj värderad{' '}
              <span className="text-content-muted">
                {formatLongDate(portfolio.valuedAt)}
              </span>
            </span>
          )}
        </p>
      )}
    </section>
  )
}

function Cell({
  label,
  lead = false,
  children,
}: {
  label: string
  lead?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn('min-w-0 px-3.5 py-3', lead && '@4xl:pr-4')}>
      {/* Smaller than the panel label: six of these share one row at 1600. */}
      <dt className="type-section text-[9.5px] leading-[0.9rem] tracking-[0.09em] whitespace-nowrap">
        {label}
      </dt>
      <dd className="mt-2">{children}</dd>
    </div>
  )
}

function Context({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('type-machine mt-2 leading-[1.05rem] normal-case', className)}>
      {children}
    </p>
  )
}

/** A small ring: the share the firm holds, drawn once, with the number beside it. */
function ShareRing({ percent }: { percent: number }) {
  const r = 11
  const c = 2 * Math.PI * r
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 30 30"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle
        cx="15"
        cy="15"
        r={r}
        fill="none"
        stroke="rgb(255 255 255 / 0.1)"
        strokeWidth="2.5"
      />
      <circle
        cx="15"
        cy="15"
        r={r}
        fill="none"
        stroke="#d9a441"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${(c * Math.max(0, Math.min(100, percent))) / 100} ${c}`}
        transform="rotate(-90 15 15)"
      />
    </svg>
  )
}
