import type { Client360 } from '~/application/advisory/client360'
import { AllocationChart } from '~/components/charts/AllocationChart'
import { Panel } from '~/components/ui/Panel'
import { cn } from '~/lib/cn'
import { wealthSlices } from '~/presentation/advisory/chartData'
import { formatLongDate, formatMsek } from '~/presentation/advisory/format'
import { ASSET_KIND_LABEL, LIABILITY_KIND_LABEL } from '~/presentation/advisory/text'

const SOURCE_LABEL: Record<Client360['assets'][number]['source'], string> = {
  bank: 'Banken',
  'client-stated': 'Enligt klienten',
  'external-register': 'Externt register',
  estimate: 'Uppskattning',
}

/**
 * The whole financial situation, not only the portfolio the firm holds:
 * composition by asset kind on the left, every asset and liability with its
 * source and valuation date on the right, and the three totals the balance
 * sheet derives. An estimate says it is an estimate.
 */
export function WealthStructure({ view }: { view: Client360 }) {
  const { balanceSheet, assets, liabilities } = view
  return (
    <Panel
      title="Förmögenhetsstruktur"
      meta={`Nettoförmögenhet ${formatMsek(balanceSheet.netWorth)}`}
      bodyClassName="p-3"
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <AllocationChart
            data={wealthSlices(balanceSheet)}
            total={balanceSheet.totalAssets}
          />
          <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-2.5">
            <Total label="Tillgångar" value={balanceSheet.totalAssets} />
            <Total label="Skulder" value={balanceSheet.totalLiabilities} negative />
            <Total label="Netto" value={balanceSheet.netWorth} />
          </dl>
        </div>
        <div className="min-w-0">
          <table
            className="w-full border-collapse text-[12px]"
            aria-label="Tillgångar och skulder"
          >
            <thead>
              <tr>
                <th scope="col" className="type-section pb-1.5 text-left font-semibold">
                  Post
                </th>
                <th scope="col" className="type-section pb-1.5 text-left font-semibold">
                  Källa
                </th>
                <th scope="col" className="type-section pb-1.5 text-right font-semibold">
                  Värderad
                </th>
                <th scope="col" className="type-section pb-1.5 text-right font-semibold">
                  Värde
                </th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id} className="border-t border-line">
                  <td className="py-1.5 pr-2">
                    <span className="type-inst block truncate">{asset.title}</span>
                    <span className="type-inst-sub">
                      {ASSET_KIND_LABEL[asset.kind]}
                      {asset.withBank ? ' · hos banken' : ''}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 text-content-muted">
                    {SOURCE_LABEL[asset.source]}
                  </td>
                  <td className="type-machine py-1.5 pr-2 text-right">
                    {formatLongDate(asset.valuedAt)}
                  </td>
                  <td className="tabular py-1.5 text-right text-content">
                    {formatMsek(asset.value)}
                  </td>
                </tr>
              ))}
              {liabilities.map((liability) => (
                <tr key={liability.id} className="border-t border-line">
                  <td className="py-1.5 pr-2">
                    <span className="type-inst block truncate">{liability.title}</span>
                    <span className="type-inst-sub">
                      {LIABILITY_KIND_LABEL[liability.kind]}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 text-content-muted">
                    {liability.withBank ? 'Banken' : 'Extern'}
                  </td>
                  <td className="type-machine py-1.5 pr-2 text-right">
                    {formatLongDate(liability.valuedAt)}
                  </td>
                  <td className="tabular py-1.5 text-right text-negative">
                    {'−'}
                    {formatMsek(liability.outstandingBalance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
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
          'tabular mt-0.5 text-[15px] font-semibold',
          negative && value > 0 ? 'text-negative' : 'text-content',
        )}
      >
        {negative && value > 0 ? '−' : ''}
        {formatMsek(value)}
      </dd>
    </div>
  )
}
