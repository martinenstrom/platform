/**
 * Policy domain contracts.
 *
 * The step-detection cases are the heart of Phase 6A: every one of them is a
 * way a daily carried-forward series can be misread into a policy claim that
 * was never made.
 */

import { describe, expect, it } from 'vitest'
import {
  changeBetween,
  detectRegime,
  ecbPublicationStatus,
  keyRates,
  levelsEqual,
  newYorkFedPublicationStatus,
  policyRatePercent,
  riksbankPublicationStatus,
  singleRate,
  targetRange,
  type LevelObservation,
} from './index'
import { yieldPercent } from '~/domain/shared/primitives'

/* ------------------------------------------------------------------- brands */

describe('a policy rate is not a yield', () => {
  it('mints a policy rate, including negative ones', () => {
    expect(policyRatePercent(2.25)).toBe(2.25)
    // The ECB's deposit rate was negative for eight years.
    expect(policyRatePercent(-0.5)).toBe(-0.5)
  })

  it('rejects a value that cannot be a rate', () => {
    expect(() => policyRatePercent(Number.NaN)).toThrow()
    expect(() => policyRatePercent(2500)).toThrow()
  })

  it('keeps the two brands distinct at compile time', () => {
    const policy = policyRatePercent(2.25)
    const bond = yieldPercent(2.25)
    // Same runtime number, and that is the point: only the type stops one
    // being passed where the other belongs.
    expect(policy).toBe(bond)
    // @ts-expect-error a yield may not be used as a policy rate
    const wrong: ReturnType<typeof policyRatePercent> = bond
    expect(wrong).toBe(2.25)
  })
})

/* ------------------------------------------------------------------- levels */

describe('levels compare structurally', () => {
  it('treats a moved lower bound as a different range', () => {
    expect(levelsEqual(targetRange(3.5, 3.75), targetRange(3.5, 3.75))).toBe(true)
    expect(levelsEqual(targetRange(3.5, 3.75), targetRange(3.25, 3.75))).toBe(false)
  })

  it('treats any one ECB rate moving as a different structure', () => {
    const base = keyRates(2.25, 2.4, 2.65)
    expect(levelsEqual(base, keyRates(2.25, 2.4, 2.65))).toBe(true)
    // Only the marginal lending rate moves. A comparison on the deposit rate
    // alone — the display rate — would call these equal.
    expect(levelsEqual(base, keyRates(2.25, 2.4, 2.75))).toBe(false)
    expect(levelsEqual(base, keyRates(2.25, 2.5, 2.65))).toBe(false)
  })

  it('refuses to build an inverted range', () => {
    expect(() => targetRange(3.75, 3.5)).toThrow(/below lower/)
  })
})

describe('changes mirror the level structure', () => {
  it('keeps both Fed bounds', () => {
    const change = changeBetween(targetRange(3.75, 4.0), targetRange(3.5, 3.75))
    expect(change).toEqual({
      kind: 'target-range',
      lowerBasisPoints: -25,
      upperBasisPoints: -25,
    })
  })

  it('reports one bound moving without averaging it away', () => {
    const change = changeBetween(targetRange(3.5, 4.0), targetRange(3.5, 3.75))
    expect(change).toEqual({
      kind: 'target-range',
      lowerBasisPoints: 0,
      upperBasisPoints: -25,
    })
  })

  it('keeps all three ECB deltas', () => {
    const change = changeBetween(keyRates(2.0, 2.15, 2.4), keyRates(2.25, 2.4, 2.65))
    expect(change).toEqual({
      kind: 'key-rates',
      depositFacilityBasisPoints: 25,
      mainRefinancingBasisPoints: 25,
      marginalLendingBasisPoints: 25,
    })
  })

  it('reports an ECB corridor narrowing', () => {
    const change = changeBetween(keyRates(2.0, 2.4, 2.9), keyRates(2.0, 2.4, 2.65))
    expect(change).toEqual({
      kind: 'key-rates',
      depositFacilityBasisPoints: 0,
      mainRefinancingBasisPoints: 0,
      marginalLendingBasisPoints: -25,
    })
  })

  it('returns clean basis points despite binary floating point', () => {
    // 2.25 - 2 is 0.25000000000000022 in IEEE-754.
    const change = changeBetween(singleRate(2), singleRate(2.25))
    expect(change).toEqual({ kind: 'single', basisPoints: 25 })
  })

  it('refuses to diff two different shapes', () => {
    expect(() => changeBetween(singleRate(2), targetRange(3.5, 3.75))).toThrow(
      /cannot diff/,
    )
  })
})

/* -------------------------------------------------------- regime detection */

const daily = (from: string, count: number, level: LevelObservation['level']) =>
  Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10),
    level,
  }))

describe('regime detection', () => {
  it('finds the real effective date behind weeks of carry-forward', () => {
    // The live ECB shape: one change, then 39 days of identical observations.
    const series = [
      ...daily('2026-05-18', 30, keyRates(2.0, 2.15, 2.4)),
      ...daily('2026-06-17', 40, keyRates(2.25, 2.4, 2.65)),
    ]
    const regime = detectRegime(series, 1)

    expect(regime.effectiveDate).toBe('2026-06-17')
    expect(regime.observationDate).toBe('2026-07-26')
    // The two must never be conflated: 39 days apart.
    expect(regime.observationDate).not.toBe(regime.effectiveDate)
    expect(regime.observationRelation).toBe('repeated-confirmation')
    expect(regime.observationRelation).not.toBe('transition')
    expect(regime.change).toEqual({
      kind: 'key-rates',
      depositFacilityBasisPoints: 25,
      mainRefinancingBasisPoints: 25,
      marginalLendingBasisPoints: 25,
    })
  })

  it('creates no decision from repeated identical observations', () => {
    const series = daily('2026-07-01', 26, singleRate(1.75))
    const regime = detectRegime(series, 1)
    // Twenty-six identical days are one standing level, not 26 policy actions.
    expect(regime.effectiveDate).toBeNull()
    expect(regime.previousLevel).toBeNull()
    expect(regime.change).toBeNull()
    expect(regime.effectiveDateConfidence).toBe('unknown')
    expect(regime.observationRelation).not.toBe('transition')
  })

  it('leaves the effective date null when the regime predates the window', () => {
    const regime = detectRegime(daily('2026-01-01', 200, singleRate(1.75)), 1)
    expect(regime.effectiveDate).toBeNull()
    expect(regime.effectiveDateConfidence).toBe('unknown')
    // The window edge is NOT reported as the start of the regime.
    expect(regime.effectiveDate).not.toBe('2026-01-01')
  })

  it('marks the transition on the day it is first seen', () => {
    const series = [
      ...daily('2026-07-01', 5, singleRate(2.0)),
      ...daily('2026-07-06', 1, singleRate(1.75)),
    ]
    const regime = detectRegime(series, 1)
    expect(regime.effectiveDate).toBe('2026-07-06')
    expect(regime.observationRelation).toBe('transition')
    expect(regime.observationRelation).not.toBe('repeated-confirmation')
  })

  it('bounds the effective date when observations are missing at the boundary', () => {
    // A business-day series with a hole: the last old value is Monday, the
    // first new value is the following Monday. The change could have taken
    // effect any time in between.
    const series = [
      { date: '2026-07-06', level: singleRate(2.0) },
      { date: '2026-07-13', level: singleRate(1.75) },
      { date: '2026-07-14', level: singleRate(1.75) },
    ]
    const regime = detectRegime(series, 1)
    expect(regime.effectiveDate).toBe('2026-07-13')
    expect(regime.effectiveDateConfidence).toBe('bounded')
  })

  it('does not bound a transition across an expected gap', () => {
    // Friday to Monday in a business-day series is not a hole.
    const series = [
      { date: '2026-07-10', level: singleRate(2.0) },
      { date: '2026-07-13', level: singleRate(1.75) },
    ]
    expect(detectRegime(series, 3).effectiveDateConfidence).toBe('confirmed')
  })

  it('detects a Fed move on one bound only', () => {
    const series = [
      ...daily('2026-07-01', 5, targetRange(3.5, 4.0)),
      ...daily('2026-07-06', 5, targetRange(3.5, 3.75)),
    ]
    const regime = detectRegime(series, 1)
    expect(regime.effectiveDate).toBe('2026-07-06')
    expect(regime.change).toEqual({
      kind: 'target-range',
      lowerBasisPoints: 0,
      upperBasisPoints: -25,
    })
  })

  it('sorts an out-of-order series before scanning', () => {
    const series = [
      { date: '2026-07-13', level: singleRate(1.75) },
      { date: '2026-07-06', level: singleRate(2.0) },
      { date: '2026-07-14', level: singleRate(1.75) },
    ]
    expect(detectRegime(series, 10).effectiveDate).toBe('2026-07-13')
  })

  it('gives a bounded date a lower bound as well as an upper one', () => {
    const series = [
      { date: '2026-07-06', level: singleRate(2.0) },
      { date: '2026-07-13', level: singleRate(1.75) },
    ]
    const regime = detectRegime(series, 1)
    expect(regime.effectiveDateConfidence).toBe('bounded')
    // Not "we are not sure" but "after the 6th and by the 13th".
    expect(regime.effectiveDateEarliestPossible).toBe('2026-07-06')
    expect(regime.effectiveDate).toBe('2026-07-13')
  })

  it('offers no range when the date is exact or absent', () => {
    const confirmed = detectRegime(
      [
        { date: '2026-07-06', level: singleRate(2.0) },
        { date: '2026-07-07', level: singleRate(1.75) },
      ],
      1,
    )
    expect(confirmed.effectiveDateConfidence).toBe('confirmed')
    expect(confirmed.effectiveDateEarliestPossible).toBeNull()

    const unknown = detectRegime(daily('2026-07-01', 10, singleRate(1.75)), 1)
    expect(unknown.effectiveDateConfidence).toBe('unknown')
    expect(unknown.effectiveDateEarliestPossible).toBeNull()
  })

  it('names the single-observation case instead of leaving it unsaid', () => {
    // The state a pair of booleans could not express: one observation, so
    // there is nothing to compare and no claim to make either way.
    const regime = detectRegime([{ date: '2026-07-06', level: singleRate(1.75) }], 1)
    expect(regime.observationRelation).toBe('single-observation')
    expect(regime.effectiveDateConfidence).toBe('unknown')
    expect(regime.change).toBeNull()
  })

  it('has no representable state that means nothing', () => {
    // Every combination the type allows is reachable and named.
    const relations = new Set(
      [
        detectRegime([{ date: '2026-07-06', level: singleRate(1.75) }], 1),
        detectRegime(
          [
            { date: '2026-07-06', level: singleRate(2) },
            { date: '2026-07-07', level: singleRate(1.75) },
          ],
          1,
        ),
        detectRegime(daily('2026-07-01', 5, singleRate(1.75)), 1),
      ].map((r) => r.observationRelation),
    )
    expect(relations).toEqual(
      new Set(['single-observation', 'transition', 'repeated-confirmation']),
    )
  })

  it('refuses an empty series rather than inventing a level', () => {
    expect(() => detectRegime([], 1)).toThrow(/at least one observation/)
  })
})

/* ------------------------------------------------- publication opportunity */

describe('missed-publication detection is source-specific', () => {
  it('ECB: a weekend gap is still a missed publication', () => {
    // The ECB series carries forward on calendar days, weekends included.
    expect(ecbPublicationStatus('2026-07-26', '2026-07-26')).toBe('current')
    expect(ecbPublicationStatus('2026-07-25', '2026-07-26')).toBe('current')
    expect(ecbPublicationStatus('2026-07-20', '2026-07-26')).toBe(
      'expected-observation-missing',
    )
  })

  it('Fed: a weekend is not a missed publication', () => {
    // Friday observation read on Monday.
    expect(newYorkFedPublicationStatus('2026-07-24', '2026-07-27')).toBe('current')
  })

  it('Fed: a plausible holiday run is tolerated rather than cried wolf over', () => {
    // Thursday observation read the following Tuesday: Friday and Monday were
    // owed, which a Thanksgiving-style closure would explain. Tolerated rather
    // than reported, and deliberately an under-report — the safe direction.
    expect(newYorkFedPublicationStatus('2026-07-23', '2026-07-28')).toBe('current')
  })

  it('Fed: a gap no holiday explains is reported', () => {
    expect(newYorkFedPublicationStatus('2026-07-13', '2026-07-27')).toBe(
      'expected-observation-missing',
    )
  })

  it('Riksbank: a bank holiday between observations is not a miss', () => {
    // Midsummer Eve and Midsummer Day are not bank days, so no publication was
    // owed and the state must not degrade.
    expect(riksbankPublicationStatus('2026-06-18', '2026-06-22', [])).toBe('current')
  })

  it('Riksbank: a skipped bank day is reported', () => {
    expect(riksbankPublicationStatus('2026-07-22', '2026-07-24', ['2026-07-23'])).toBe(
      'expected-observation-missing',
    )
  })

  it('Riksbank: a failed calendar never fabricates an expectation', () => {
    // Neither optimistic nor alarmist. We simply do not know.
    expect(riksbankPublicationStatus('2026-07-01', '2026-07-26', null)).toBe(
      'cadence-unknown',
    )
  })
})
