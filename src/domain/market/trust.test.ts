/**
 * Provider trust and yield-curve integrity (Phase 4A).
 *
 * These are the contracts that stop three different measures of "the 10-year
 * yield" being treated as one thing, and stop an access route being mistaken
 * for the party that actually produced the data.
 */

import { describe, expect, it } from 'vitest'
import { FakeClock } from '~/domain/shared/clock'
import { canonicalSymbol } from './instruments'
import { isoCurrency } from './primitives'
import {
  buildProvenance,
  effectiveTrust,
  TRUST_TIER,
  type ProviderTrust,
} from './provenance'
import {
  buildYield,
  buildYieldCurve,
  MATURITY_MONTHS,
  methodologiesAreComparable,
  type Maturity,
  type YieldMethodology,
} from './rates'

const clock = new FakeClock('2026-07-26T12:00:00.000Z')
const US10Y = canonicalSymbol('rate:us10y')
const US2Y = canonicalSymbol('rate:us2y')

function provenance() {
  return buildProvenance({
    asOf: '2026-07-24T00:00:00.000Z',
    nowMs: clock.epochMs(),
    source: { providerId: 'test', providerName: 'Test' },
    quality: 'official-daily',
    asOfPrecision: 'date',
  })
}

function yieldAt(options: {
  maturity: Maturity
  methodology: YieldMethodology
  observationDate?: string
  countryCode?: string
}) {
  return buildYield({
    symbol: options.maturity === '2Y' ? US2Y : US10Y,
    countryCode: options.countryCode ?? 'US',
    currency: isoCurrency('USD'),
    maturity: options.maturity,
    seriesId: `BC_${options.maturity}`,
    methodology: options.methodology,
    observationDate: options.observationDate ?? '2026-07-24',
    yieldPercent: 4.5,
    provenance: provenance(),
  })
}

describe('provider trust', () => {
  it('ranks primary sources above vendors, aggregators and fixtures', () => {
    expect(TRUST_TIER.issuer).toBeLessThan(TRUST_TIER['licensed-vendor'])
    expect(TRUST_TIER['central-bank']).toBeLessThan(TRUST_TIER.aggregator)
    expect(TRUST_TIER.aggregator).toBeLessThan(TRUST_TIER.derived)
    expect(TRUST_TIER.synthetic).toBe(5)
  })

  it('treats a route with no separate originator as its own trust', () => {
    expect(effectiveTrust('issuer')).toBe('issuer')
  })

  it('takes the WEAKER of route and originator', () => {
    // The Riksbank is a central bank, but its yield series come from
    // Refinitiv. Republishing does not upgrade a vendor series.
    expect(effectiveTrust('central-bank', 'licensed-vendor')).toBe('licensed-vendor')
    // Frankfurter is an aggregator, but the ECB produces the rates — the
    // aggregation does not downgrade them below aggregator either.
    expect(effectiveTrust('aggregator', 'central-bank')).toBe('aggregator')
  })

  it('never returns something stronger than the route', () => {
    const all: ProviderTrust[] = [
      'issuer',
      'central-bank',
      'official-statistics',
      'exchange',
      'licensed-vendor',
      'aggregator',
      'derived',
      'synthetic',
    ]
    for (const route of all) {
      for (const origin of all) {
        expect(TRUST_TIER[effectiveTrust(route, origin)]).toBeGreaterThanOrEqual(
          TRUST_TIER[route],
        )
      }
    }
  })
})

describe('canonical maturity', () => {
  it('maps every maturity to months', () => {
    expect(MATURITY_MONTHS['2Y']).toBe(24)
    expect(MATURITY_MONTHS['10Y']).toBe(120)
    expect(MATURITY_MONTHS['30Y']).toBe(360)
  })

  it('derives tenorMonths from the maturity', () => {
    expect(yieldAt({ maturity: '10Y', methodology: 'par-yield' }).tenorMonths).toBe(120)
  })

  it('records the observation date separately from receipt', () => {
    const entry = yieldAt({ maturity: '10Y', methodology: 'par-yield' })
    // A revision is "same observationDate, later receivedAt, different value",
    // which is only detectable because the two are distinct fields.
    expect(entry.observationDate).toBe('2026-07-24')
    expect(entry.provenance.receivedAt).not.toBe(entry.observationDate)
  })

  it('rejects an observation date that is not YYYY-MM-DD', () => {
    expect(() =>
      yieldAt({
        maturity: '10Y',
        methodology: 'par-yield',
        observationDate: 'Friday',
      }),
    ).toThrow(/YYYY-MM-DD/)
  })
})

describe('yield methodology', () => {
  it('treats constant-maturity as comparable to par-yield, and nothing else', () => {
    // FRED's DGS series IS the Treasury par curve interpolated to a fixed
    // tenor, so those two pair. No other combination does.
    expect(methodologiesAreComparable('par-yield', 'constant-maturity')).toBe(true)
    expect(methodologiesAreComparable('par-yield', 'zero-coupon-fitted')).toBe(false)
    expect(methodologiesAreComparable('benchmark-bond-yield', 'par-yield')).toBe(false)
    expect(methodologiesAreComparable('spot-rate', 'zero-coupon-fitted')).toBe(false)
  })

  it('is reflexive', () => {
    const all: YieldMethodology[] = [
      'par-yield',
      'constant-maturity',
      'zero-coupon-fitted',
      'benchmark-bond-yield',
      'specific-bond-quote',
      'spot-rate',
    ]
    for (const methodology of all) {
      expect(methodologiesAreComparable(methodology, methodology)).toBe(true)
    }
  })
})

describe('yield curve integrity', () => {
  const curve = (points: ReturnType<typeof yieldAt>[]) =>
    buildYieldCurve({ countryCode: 'US', points, provenance: provenance() })

  it('accepts a homogeneous curve and sorts it by tenor', () => {
    const built = curve([
      yieldAt({ maturity: '10Y', methodology: 'par-yield' }),
      yieldAt({ maturity: '2Y', methodology: 'par-yield' }),
    ])
    expect(built.points.map((point) => point.maturity)).toEqual(['2Y', '10Y'])
    expect(built.methodology).toBe('par-yield')
    expect(built.observationDate).toBe('2026-07-24')
  })

  it('refuses to mix methodologies', () => {
    // A par yield and a fitted zero rate measure different things. Plotting
    // them on one axis produces a shape that means nothing.
    expect(() =>
      curve([
        yieldAt({ maturity: '2Y', methodology: 'par-yield' }),
        yieldAt({ maturity: '10Y', methodology: 'zero-coupon-fitted' }),
      ]),
    ).toThrow(/cannot mix par-yield with zero-coupon-fitted/)
  })

  it('refuses to mix observation dates', () => {
    expect(() =>
      curve([
        yieldAt({ maturity: '2Y', methodology: 'par-yield' }),
        yieldAt({
          maturity: '10Y',
          methodology: 'par-yield',
          observationDate: '2026-07-23',
        }),
      ]),
    ).toThrow(/must share one observation date/)
  })

  it('still refuses to mix issuers', () => {
    expect(() =>
      curve([
        yieldAt({ maturity: '2Y', methodology: 'par-yield' }),
        yieldAt({ maturity: '10Y', methodology: 'par-yield', countryCode: 'DE' }),
      ]),
    ).toThrow(/contains a DE point/)
  })

  it('refuses an empty curve', () => {
    expect(() => curve([])).toThrow(/at least one point/)
  })

  it('permits the par family together, since one is derived from the other', () => {
    expect(() =>
      curve([
        yieldAt({ maturity: '2Y', methodology: 'par-yield' }),
        yieldAt({ maturity: '10Y', methodology: 'constant-maturity' }),
      ]),
    ).not.toThrow()
  })
})
