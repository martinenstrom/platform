import type { Client360 } from '~/application/advisory/client360'
import { Panel } from '~/components/ui/Panel'
import { cn } from '~/lib/cn'
import { formatLongDate, formatMsek, formatPct } from '~/presentation/advisory/format'
import { LIABILITY_KIND_LABEL } from '~/presentation/advisory/text'

/**
 * The lending relationship: every loan with its balance, rate structure,
 * maturity or refinancing date, collateral, loan-to-value and next review.
 * A summary, not underwriting.
 */
export function FinancingPanel({ view }: { view: Client360 }) {
  const { liabilities, assets, today } = view
  const assetTitle = new Map(assets.map((a) => [a.id, a.title]))
  const total = liabilities.reduce((sum, l) => sum + l.outstandingBalance, 0)
  return (
    <Panel
      title="Finansiering"
      meta={
        liabilities.length > 0
          ? `${liabilities.length} lån · ${formatMsek(total)}`
          : 'Inga lån'
      }
      bodyClassName="p-3"
    >
      {liabilities.length === 0 ? (
        <p className="type-inst-sub">Ingen utlåning i relationen.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[640px] border-collapse text-[12px]">
            <thead>
              <tr>
                <th scope="col" className="type-section pb-1.5 text-left font-semibold">
                  Lån
                </th>
                <th scope="col" className="type-section pb-1.5 text-right font-semibold">
                  Saldo
                </th>
                <th scope="col" className="type-section pb-1.5 text-left font-semibold">
                  Ränta
                </th>
                <th scope="col" className="type-section pb-1.5 text-left font-semibold">
                  Förfall / omsättning
                </th>
                <th scope="col" className="type-section pb-1.5 text-left font-semibold">
                  Säkerhet
                </th>
                <th scope="col" className="type-section pb-1.5 text-right font-semibold">
                  Belåningsgrad
                </th>
                <th scope="col" className="type-section pb-1.5 text-left font-semibold">
                  Nästa översyn
                </th>
              </tr>
            </thead>
            <tbody>
              {liabilities.map((loan) => {
                const soon =
                  loan.maturityDate !== null &&
                  loan.maturityDate >= today &&
                  loan.maturityDate <= addDaysIso(today, 60)
                return (
                  <tr key={loan.id} className="border-t border-line">
                    <td className="py-1.5 pr-2">
                      <span className="type-inst block">{loan.title}</span>
                      <span className="type-inst-sub">
                        {LIABILITY_KIND_LABEL[loan.kind]}
                      </span>
                    </td>
                    <td className="tabular py-1.5 pr-2 text-right text-content">
                      {formatMsek(loan.outstandingBalance)}
                    </td>
                    <td className="py-1.5 pr-2 text-content-muted">
                      {formatPct(loan.ratePercent, 2)}{' '}
                      {loan.interestType === 'fixed' ? 'bunden' : 'rörlig'}
                    </td>
                    <td
                      className={cn(
                        'py-1.5 pr-2',
                        soon ? 'text-warning' : 'text-content-muted',
                      )}
                    >
                      {loan.maturityDate ? formatLongDate(loan.maturityDate) : 'Löpande'}
                    </td>
                    <td className="py-1.5 pr-2 text-content-muted">
                      {loan.collateralAssetId
                        ? (assetTitle.get(loan.collateralAssetId) ??
                          loan.collateralAssetId)
                        : '—'}
                    </td>
                    <td className="tabular py-1.5 pr-2 text-right text-content-muted">
                      {loan.loanToValuePercent !== undefined
                        ? formatPct(loan.loanToValuePercent, 0)
                        : '—'}
                    </td>
                    <td className="py-1.5 text-content-muted">
                      {loan.nextReviewDate ? formatLongDate(loan.nextReviewDate) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/** ISO date `days` after `iso`, for the sixty-day highlight only. */
function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
