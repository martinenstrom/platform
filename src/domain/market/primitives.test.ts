import { describe, expect, it } from 'vitest'
import {
  addMoney,
  basisPoints,
  basisPointsToPercent,
  changePercent,
  InvalidValueError,
  isoCurrency,
  money,
  percent,
  percentToBasisPoints,
  price,
  yieldPercent,
} from './primitives'

describe('financial primitives', () => {
  it('rejects non-finite values in every constructor', () => {
    for (const make of [percent, basisPoints, price, yieldPercent]) {
      expect(() => make(Number.NaN)).toThrow(InvalidValueError)
      expect(() => make(Number.POSITIVE_INFINITY)).toThrow(InvalidValueError)
    }
  })

  it('rejects negative prices but allows negative yields', () => {
    expect(() => price(-1)).toThrow(InvalidValueError)
    // Bunds traded below zero for years — a negative yield is real data.
    expect(yieldPercent(-0.42)).toBe(-0.42)
  })

  it('rejects malformed ISO 4217 codes', () => {
    expect(() => isoCurrency('sek')).toThrow(InvalidValueError)
    expect(() => isoCurrency('SEKK')).toThrow(InvalidValueError)
    expect(isoCurrency('SEK')).toBe('SEK')
  })

  it('serializes as plain numbers across a JSON boundary', () => {
    // The whole reason for branding over wrapper classes: no revive step.
    const revived = JSON.parse(JSON.stringify({ p: percent(0.32), b: basisPoints(4) }))
    expect(revived).toEqual({ p: 0.32, b: 4 })
  })
})

describe('money', () => {
  it('refuses to add across currencies', () => {
    const sek = money(100, isoCurrency('SEK'))
    const usd = money(100, isoCurrency('USD'))
    expect(() => addMoney(sek, usd)).toThrow(/different currencies/)
    expect(addMoney(sek, sek).amount).toBe(200)
  })
})

describe('unit conversion', () => {
  it('converts percentage points to basis points and back', () => {
    expect(percentToBasisPoints(percent(0.04))).toBe(4)
    expect(basisPointsToPercent(basisPoints(4))).toBeCloseTo(0.04, 10)
  })
})

describe('changePercent', () => {
  it('computes a percentage change', () => {
    expect(changePercent(101, 100)).toBeCloseTo(1, 10)
    expect(changePercent(99, 100)).toBeCloseTo(-1, 10)
  })

  it('returns null instead of Infinity or NaN when it cannot be derived', () => {
    // An honest "unavailable" the Envelope can carry, not a number that
    // renders as garbage in a tile.
    expect(changePercent(100, 0)).toBeNull()
    expect(changePercent(100, null)).toBeNull()
    expect(changePercent(Number.NaN, 100)).toBeNull()
  })
})
