/**
 * The client's whole financial life — not only the portfolio the firm holds.
 *
 * Assets and liabilities are records with a valuation date and a source, so a
 * balance sheet can say how old each figure is. Totals are DERIVED, never
 * stored: `balanceSheetOf` is the one derivation.
 */

import type { ClientId } from './client'

export type AssetKind =
  | 'investment-portfolio'
  | 'cash'
  | 'property'
  | 'company-ownership'
  | 'pension'
  | 'other-financial'
  | 'other'

export type ValuationSource = 'bank' | 'client-stated' | 'external-register' | 'estimate'

export interface Asset {
  id: string
  clientId: ClientId
  kind: AssetKind
  title: string
  value: number
  /** ISO date the value was observed or stated. */
  valuedAt: string
  source: ValuationSource
  /** True where the firm holds or manages the asset. */
  withBank: boolean
  /** Where the asset is a portfolio the firm manages. */
  portfolioId?: string
}

export type LiabilityKind =
  | 'mortgage'
  | 'investment-loan'
  | 'company-debt'
  | 'bridge-financing'
  | 'property-financing'
  | 'other-loan'

export type InterestType = 'fixed' | 'variable'

export interface Liability {
  id: string
  clientId: ClientId
  kind: LiabilityKind
  title: string
  outstandingBalance: number
  interestType: InterestType
  /** Annual rate in percent, e.g. 3.85. */
  ratePercent: number
  /** ISO date the fixed term ends or the loan matures; refinancing is due then. */
  maturityDate: string | null
  /** The asset the loan is secured on, where one is. */
  collateralAssetId?: string
  /** Loan-to-value in percent, where the collateral is valued. */
  loanToValuePercent?: number
  /** ISO date of the next review the firm has planned. */
  nextReviewDate: string | null
  withBank: boolean
  valuedAt: string
}

export interface WealthBucket {
  kind: AssetKind
  value: number
}

export interface BalanceSheet {
  totalAssets: number
  totalLiabilities: number
  netWorth: number
  /** Assets the firm holds or manages. */
  assetsWithBank: number
  /** The firm's share of the client's financial assets, in percent. */
  shareOfWalletPercent: number
  liquidity: number
  buckets: readonly WealthBucket[]
  /** The oldest valuation among the figures, ISO date. */
  oldestValuationAt: string | null
}

const FINANCIAL_ASSET_KINDS: readonly AssetKind[] = [
  'investment-portfolio',
  'cash',
  'pension',
  'other-financial',
]

export function balanceSheetOf(
  assets: readonly Asset[],
  liabilities: readonly Liability[],
): BalanceSheet {
  const totalAssets = assets.reduce((sum, asset) => sum + asset.value, 0)
  const totalLiabilities = liabilities.reduce(
    (sum, item) => sum + item.outstandingBalance,
    0,
  )
  const assetsWithBank = assets
    .filter((asset) => asset.withBank)
    .reduce((sum, asset) => sum + asset.value, 0)
  const financial = assets.filter((asset) => FINANCIAL_ASSET_KINDS.includes(asset.kind))
  const financialTotal = financial.reduce((sum, asset) => sum + asset.value, 0)
  const financialWithBank = financial
    .filter((asset) => asset.withBank)
    .reduce((sum, asset) => sum + asset.value, 0)
  const buckets = new Map<AssetKind, number>()
  for (const asset of assets)
    buckets.set(asset.kind, (buckets.get(asset.kind) ?? 0) + asset.value)
  const dates = [
    ...assets.map((a) => a.valuedAt),
    ...liabilities.map((l) => l.valuedAt),
  ].sort()
  return {
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    assetsWithBank,
    shareOfWalletPercent:
      financialTotal === 0 ? 0 : Math.round((financialWithBank / financialTotal) * 100),
    liquidity: buckets.get('cash') ?? 0,
    buckets: [...buckets.entries()]
      .map(([kind, value]) => ({ kind, value }))
      .sort(
        (a, b) => b.value - a.value || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
      ),
    oldestValuationAt: dates[0] ?? null,
  }
}
