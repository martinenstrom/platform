/**
 * Advisory data in the shapes the shared charts draw.
 *
 * Asset classes and wealth buckets keep one colour each across the whole
 * product — the allocation donut, the mandate bars and the wealth
 * composition all read the same hue for the same class — taken from the
 * validated categorical palette in `lib/chartTheme`.
 */

import { CATEGORICAL } from '~/lib/chartTheme'
import type { AllocationSlice, PerformancePoint as LegacyPerformancePoint } from '~/types'
import type {
  AssetClass,
  AssetKind,
  BalanceSheet,
  PerformancePoint,
  Portfolio,
} from '~/domain/advisory'
import { ASSET_CLASS_LABEL, ASSET_KIND_LABEL } from './text'

export const ASSET_CLASS_COLOR: Record<AssetClass, string> = {
  equities: CATEGORICAL[0],
  'fixed-income': CATEGORICAL[2],
  alternatives: CATEGORICAL[3],
  cash: CATEGORICAL[4],
}

export const ASSET_KIND_COLOR: Record<AssetKind, string> = {
  'investment-portfolio': CATEGORICAL[0],
  cash: CATEGORICAL[4],
  property: CATEGORICAL[3],
  'company-ownership': CATEGORICAL[1],
  pension: CATEGORICAL[2],
  'other-financial': '#6b7a90',
  other: '#4b5563',
}

/** The portfolio's current allocation as donut slices. */
export function allocationSlices(portfolio: Portfolio): AllocationSlice[] {
  return portfolio.allocation
    .filter((slice) => slice.currentPercent > 0)
    .map((slice) => ({
      id: slice.assetClass,
      label: ASSET_CLASS_LABEL[slice.assetClass],
      value: Math.round((portfolio.totalValue * slice.currentPercent) / 100),
      percent: slice.currentPercent,
      color: ASSET_CLASS_COLOR[slice.assetClass],
    }))
}

/** The whole balance sheet's assets as donut slices, largest first. */
export function wealthSlices(balanceSheet: BalanceSheet): AllocationSlice[] {
  const total = balanceSheet.totalAssets
  return balanceSheet.buckets
    .filter((bucket) => bucket.value > 0)
    .map((bucket) => ({
      id: bucket.kind,
      label: ASSET_KIND_LABEL[bucket.kind],
      value: bucket.value,
      percent: total === 0 ? 0 : Math.round((bucket.value / total) * 1000) / 10,
      color: ASSET_KIND_COLOR[bucket.kind],
    }))
}

/** The performance series in the shape the shared chart draws. */
export function performancePoints(
  series: readonly PerformancePoint[],
): LegacyPerformancePoint[] {
  return series.map((point) => ({
    t: point.date,
    portfolio: point.portfolio,
    benchmark: point.benchmark,
  }))
}
