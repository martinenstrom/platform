import {
  Building2,
  Home,
  Landmark,
  Layers,
  PiggyBank,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { Client360 } from '~/application/advisory/client360'
import type { AssetKind } from '~/domain/advisory'
import { ASSET_KIND_COLOR } from '~/presentation/advisory/chartData'
import { formatLongDate, formatMsek } from '~/presentation/advisory/format'
import { ASSET_KIND_LABEL } from '~/presentation/advisory/text'
import { Module } from './dossier/Module'

const SOURCE_LABEL: Record<Client360['assets'][number]['source'], string> = {
  bank: 'Handelsbanken',
  'client-stated': 'Enligt klienten',
  'external-register': 'Externt register',
  estimate: 'Uppskattning',
}

const KIND_ICON: Record<AssetKind, LucideIcon> = {
  property: Home,
  'investment-portfolio': TrendingUp,
  pension: PiggyBank,
  cash: Wallet,
  'company-ownership': Building2,
  'other-financial': Landmark,
  other: Layers,
}

const SHOWN = 7

/**
 * The largest assets, one row each: what it is, where the figure comes
 * from and when it was struck, the value and its share of the whole. An
 * estimate says it is an estimate; the valuation date stands beside it,
 * so a stale figure cannot pass as a fresh one.
 */
export function LargestHoldings({
  view,
  className,
}: {
  view: Client360
  className?: string
}) {
  const { assets, balanceSheet } = view
  const rows = [...assets].sort((a, b) => b.value - a.value).slice(0, SHOWN)
  const total = balanceSheet.totalAssets
  return (
    <Module
      title="Största tillgångar"
      icon={Landmark}
      meta={
        assets.length > SHOWN
          ? `${SHOWN} av ${assets.length} poster`
          : `${assets.length} poster`
      }
      className={className}
      bodyClassName="px-5 pb-3"
    >
      {/* Fixed columns, so a long title truncates instead of widening the module. */}
      <table
        className="w-full table-fixed border-collapse text-[12.5px]"
        aria-label="Största tillgångar"
      >
        <thead>
          <tr>
            <th scope="col" className="type-section pb-1.5 text-left font-semibold">
              Tillgång
            </th>
            <th
              scope="col"
              className="type-section w-[88px] pb-1.5 text-right font-semibold"
            >
              Värde
            </th>
            <th
              scope="col"
              className="type-section w-[50px] pb-1.5 text-right font-semibold"
            >
              Andel
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((asset) => {
            const Icon = KIND_ICON[asset.kind]
            const share = total > 0 ? Math.round((asset.value / total) * 100) : 0
            return (
              <tr key={asset.id} className="border-t border-hairline">
                <td className="py-2.5 pr-3">
                  <span className="flex items-center gap-2.5">
                    <Icon
                      className="h-[15px] w-[15px] shrink-0"
                      aria-hidden="true"
                      strokeWidth={1.5}
                      style={{ color: ASSET_KIND_COLOR[asset.kind] }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-content">
                        {asset.title}
                      </span>
                      <span className="type-inst-sub block truncate text-[11.5px]">
                        {SOURCE_LABEL[asset.source]} · {ASSET_KIND_LABEL[asset.kind]} ·{' '}
                        {formatLongDate(asset.valuedAt)}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="tabular py-2.5 pr-3 text-right font-semibold whitespace-nowrap text-content">
                  {formatMsek(asset.value)}
                </td>
                <td className="tabular py-2.5 text-right whitespace-nowrap text-content-muted">
                  {share} %
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Module>
  )
}
