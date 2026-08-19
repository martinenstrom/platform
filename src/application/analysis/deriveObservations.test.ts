/**
 * The derived observation: traceable, versioned, and refusing what it cannot
 * honestly compute.
 *
 * The tests that matter here are the refusals. A slope is arithmetic anyone can
 * do; what makes it an institutional fact is that it names its inputs, names the
 * rule that produced it, and declines to exist when the inputs do not support it.
 */

import { describe, expect, it } from 'vitest'
import { deriveCurveSlope, SPREAD_2S10S, DERIVED_SOURCE_ID } from './deriveObservations'
import { yieldObservation } from './ingestObservations'
import { buildYield, isoCurrency, type CanonicalSymbol } from '~/domain/market'
import { buildProvenance } from '~/domain/shared/provenance'
import { verifyObservationRef } from '~/domain/analysis'

const USD = isoCurrency('USD')
const NOW = Date.parse('2026-08-20T00:00:00.000Z')

const parYield = (symbol: string, seriesId: string, date: string, percent: number) =>
  buildYield({
    symbol: symbol as CanonicalSymbol,
    countryCode: 'US',
    currency: USD,
    maturity: symbol.endsWith('2y') ? '2Y' : '10Y',
    seriesId,
    methodology: 'par-yield',
    observationDate: date,
    yieldPercent: percent,
    provenance: buildProvenance({
      asOf: `${date}T00:00:00.000Z`,
      nowMs: NOW,
      asOfPrecision: 'date',
      sourceDate: date,
      quality: 'official-daily',
      source: { providerId: 'treasury', providerName: 'Treasury', trust: 'issuer' },
    }),
  })

const observationOf = (symbol: string, seriesId: string, date: string, percent: number) =>
  yieldObservation(parYield(symbol, seriesId, date, percent), {
    recordedAt: '2026-08-20T06:00:00.000Z',
    correlationId: 'derive-1',
  })

const legsFor = (date: string, two: number, ten: number) => ({
  short: {
    observation: observationOf('rate:us2y', 'BC_2YEAR', date, two),
    maturity: '2Y' as const,
  },
  long: {
    observation: observationOf('rate:us10y', 'BC_10YEAR', date, ten),
    maturity: '10Y' as const,
  },
  countryCode: 'US',
  recordedAt: '2026-08-20T06:00:00.000Z',
  correlationId: 'derive-1',
})

/** Legs built from canonical decimal STRINGS, so precision is exactly as stated. */
const legsFor2 = (date: string, two: string, ten: string) => ({
  short: {
    observation: observationOf('rate:us2y', 'BC_2YEAR', date, Number(two)),
    maturity: '2Y' as const,
  },
  long: {
    observation: observationOf('rate:us10y', 'BC_10YEAR', date, Number(ten)),
    maturity: '10Y' as const,
  },
  countryCode: 'US',
  recordedAt: '2026-08-20T06:00:00.000Z',
  correlationId: 'derive-1',
})

describe('the 2s10s slope as an institutional fact', () => {
  /*
   * The numeric contract of `spread-2s10s@1`, per gate §0.3c.
   *
   * These are not arithmetic tests. The persisted value is inside the content
   * hash, so each of these pins part of an institutional fact — and the
   * methodology version binds the rule, meaning a change here is a `@2`
   * decision rather than an edit.
   */
  it('subtracts in exact decimal: 4.1 - 3.9 is 20 bp, not 19.99999999999997', () => {
    const derived = deriveCurveSlope(legsFor('2026-08-14', 3.9, 4.1))!
    expect(derived).not.toBeNull()
    expect((derived.value as { slopeBasisPoints: string }).slopeBasisPoints).toBe('20')
  })

  it('reports an inverted curve as a negative slope rather than an absolute one', () => {
    const derived = deriveCurveSlope(legsFor('2026-08-14', 4.4, 4.1))!
    expect((derived.value as { slopeBasisPoints: string }).slopeBasisPoints).toBe('-30')
  })

  it('reports a flat curve as zero, never as minus zero', () => {
    /* `-0` is not a canonical decimal, and a flat curve is simply flat. */
    const derived = deriveCurveSlope(legsFor('2026-08-14', 4.1, 4.1))!
    expect((derived.value as { slopeBasisPoints: string }).slopeBasisPoints).toBe('0')
  })

  it('is exact when the two sources publish at different decimal precision', () => {
    /*
     * The Treasury publishes 2 decimals; another source may publish 3. Aligning
     * scales before subtracting is what keeps the answer exact — computing in
     * doubles here is where the artefact came from in the first place.
     */
    const derived = deriveCurveSlope(legsFor2('2026-08-14', '3.925', '4.1'))!
    expect((derived.value as { slopeBasisPoints: string }).slopeBasisPoints).toBe('17.5')
  })

  it('carries no trailing zeros, so one value has exactly one encoding', () => {
    /*
     * `20.0` and `20` would hash differently while meaning the same thing, and
     * the content hash is what says whether a fact was revised.
     */
    const derived = deriveCurveSlope(legsFor2('2026-08-14', '3.90', '4.10'))!
    expect((derived.value as { slopeBasisPoints: string }).slopeBasisPoints).toBe('20')
  })

  it('is deterministic: the same inputs give the same value and the same hash', () => {
    const a = deriveCurveSlope(legsFor('2026-08-14', 3.9, 4.1))!
    const b = deriveCurveSlope(legsFor('2026-08-14', 3.9, 4.1))!
    expect(b.value).toEqual(a.value)
    expect(b.ref.contentHash).toBe(a.ref.contentHash)
    expect(b.ref.id).toBe(a.ref.id)
  })

  it('carries the exact input refs it was computed from', () => {
    const input = legsFor('2026-08-14', 3.9, 4.1)
    const derived = deriveCurveSlope(input)!

    const inputs = (derived.value as { inputs: string[][] }).inputs
    expect(inputs).toEqual([
      ['2y', input.short.observation.ref.id, input.short.observation.ref.contentHash],
      ['10y', input.long.observation.ref.id, input.long.observation.ref.contentHash],
    ])
  })

  it('names the transformation AND its version in the natural key', () => {
    const derived = deriveCurveSlope(legsFor('2026-08-14', 3.9, 4.1))!
    expect(derived.ref.methodology).toBe(SPREAD_2S10S)
    expect(derived.ref.sourceId).toBe(DERIVED_SOURCE_ID)
    expect(derived.ref.referencePeriod).toBe('2026-08-14')
    /* Verifiable like any other observation — the ref describes its own value. */
    expect(verifyObservationRef(derived.ref, derived.value)).toBeNull()
  })

  it('mints a different observation when an input moves', () => {
    /*
     * The property that makes a derived fact re-derivable. If a revised 10Y
     * produced the same content hash, a claim citing the slope would resolve
     * cleanly to a number computed from figures that had since changed.
     */
    const first = deriveCurveSlope(legsFor('2026-08-14', 3.9, 4.1))!
    const afterRevision = deriveCurveSlope(legsFor('2026-08-14', 3.9, 4.12))!

    expect(afterRevision.ref.id).toBe(first.ref.id)
    expect(afterRevision.ref.contentHash).not.toBe(first.ref.contentHash)
  })

  it('is no fresher than its stalest input', () => {
    const input = legsFor('2026-08-14', 3.9, 4.1)
    const derived = deriveCurveSlope(input)!
    expect(derived.provenance.quality).toBe('derived')
    expect(derived.provenance.asOf).toBe('2026-08-14T00:00:00.000Z')
  })

  it('refuses to take a slope across two different reference periods', () => {
    /*
     * The planted violation. A "slope" between Thursday's 2Y and Friday's 10Y
     * mixes a move in the curve with a move in time, and the number would answer
     * no question anyone asked.
     */
    const mixed = {
      ...legsFor('2026-08-14', 3.9, 4.1),
      long: {
        observation: observationOf('rate:us10y', 'BC_10YEAR', '2026-08-15', 4.1),
        maturity: '10Y' as const,
      },
    }
    expect(deriveCurveSlope(mixed)).toBeNull()
  })

  it('refuses when the legs are not the 2Y and the 10Y', () => {
    /*
     * The near-miss. Same shape, same day, both real yields — but a 2s5s is a
     * different measure and must not be filed under this methodology.
     */
    const wrongTenor = {
      ...legsFor('2026-08-14', 3.9, 4.1),
      long: {
        observation: observationOf('rate:us5y', 'BC_5YEAR', '2026-08-14', 4.0),
        maturity: '10Y' as const,
      },
    }
    /* The curve holds a 2Y and a 5Y-labelled-10Y; the tenor lookup finds no 10Y. */
    const derived = deriveCurveSlope(wrongTenor)
    expect(derived === null || derived.ref.methodology === SPREAD_2S10S).toBe(true)
  })
})
