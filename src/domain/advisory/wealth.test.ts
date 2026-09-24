/**
 * The balance sheet is the one derivation of totals. Asserted on a hand-
 * checked case so the arithmetic — and the definition of share of wallet —
 * cannot drift without this failing.
 */

import { describe, expect, it } from 'vitest'
import { balanceSheetOf, type Asset, type Liability } from './wealth'

const assets: Asset[] = [
  {
    id: 'a1',
    clientId: 'c',
    kind: 'investment-portfolio',
    title: 'Portfölj',
    value: 14_200_000,
    valuedAt: '2026-09-22',
    source: 'bank',
    withBank: true,
  },
  {
    id: 'a2',
    clientId: 'c',
    kind: 'cash',
    title: 'Kassa',
    value: 6_800_000,
    valuedAt: '2026-09-22',
    source: 'bank',
    withBank: true,
  },
  {
    id: 'a3',
    clientId: 'c',
    kind: 'property',
    title: 'Villa',
    value: 18_500_000,
    valuedAt: '2026-05-26',
    source: 'estimate',
    withBank: false,
  },
  {
    id: 'a4',
    clientId: 'c',
    kind: 'pension',
    title: 'Pension',
    value: 3_100_000,
    valuedAt: '2026-08-24',
    source: 'external-register',
    withBank: false,
  },
]

const liabilities: Liability[] = [
  {
    id: 'l1',
    clientId: 'c',
    kind: 'mortgage',
    title: 'Bolån',
    outstandingBalance: 6_500_000,
    interestType: 'fixed',
    ratePercent: 3.45,
    maturityDate: '2026-11-15',
    nextReviewDate: null,
    withBank: true,
    valuedAt: '2026-09-22',
  },
]

describe('balanceSheetOf', () => {
  const sheet = balanceSheetOf(assets, liabilities)

  it('totals assets, liabilities and net worth', () => {
    expect(sheet.totalAssets).toBe(42_600_000)
    expect(sheet.totalLiabilities).toBe(6_500_000)
    expect(sheet.netWorth).toBe(36_100_000)
  })

  it('counts only what the firm holds as AUM', () => {
    expect(sheet.assetsWithBank).toBe(21_000_000)
  })

  it('measures share of wallet over financial assets only — property is not a wallet', () => {
    /* 21.0 of 24.1 financial (portfolio, cash, pension) */
    expect(sheet.shareOfWalletPercent).toBe(87)
  })

  it('reads liquidity as cash and buckets largest first', () => {
    expect(sheet.liquidity).toBe(6_800_000)
    expect(sheet.buckets.map((b) => b.kind)).toEqual([
      'property',
      'investment-portfolio',
      'cash',
      'pension',
    ])
  })

  it('names the oldest valuation so staleness is visible', () => {
    expect(sheet.oldestValuationAt).toBe('2026-05-26')
  })

  it('is zero, not NaN, for an empty record', () => {
    expect(balanceSheetOf([], [])).toMatchObject({
      totalAssets: 0,
      shareOfWalletPercent: 0,
      liquidity: 0,
      oldestValuationAt: null,
    })
  })
})
