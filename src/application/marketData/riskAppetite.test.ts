/**
 * Cross-Asset Risk Appetite — transformation and composition.
 *
 * The properties that make the measure defensible, rather than the numbers it
 * happens to produce today.
 */

import { describe, expect, it } from 'vitest'
import {
  buildRiskAppetite,
  coherence,
  empiricalPercentile,
  InsufficientHistoryError,
  labelForRiskAppetite,
  RISK_APPETITE_COHERENCE_MS,
  RISK_APPETITE_METHODOLOGY,
  RISK_APPETITE_WINDOW,
  type RiskAppetiteLeg,
} from '~/domain/market'
import {
  alignedDates,
  transformLegs,
  type DailyObservation,
  type RiskAppetiteHistory,
  RISK_APPETITE_CHANGE_HORIZON_DAYS,
} from './riskAppetiteTransform'

const SOURCE = {
  providerId: 'derived',
  providerName: 'Financial OS',
  trust: 'derived' as const,
}
const NOW = Date.parse('2026-08-26T20:01:00.000Z')

/** `n` consecutive weekday-ish dates, ascending. */
const dates = (n: number, skip: (i: number) => boolean = () => false): string[] => {
  const out: string[] = []
  for (let i = 0; out.length < n; i += 1) {
    if (skip(i)) continue
    out.push(new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10))
  }
  return out
}

const series = (ds: string[], value: (i: number) => number): DailyObservation[] =>
  ds.map((date, i) => ({ date, value: value(i) }))

/** Enough aligned history to fill the window, with a controllable last day. */
function history(over: Partial<Record<keyof RiskAppetiteHistory, number>> = {}) {
  /* The change legs consume `horizon` observations to differencing. */
  const ds = dates(RISK_APPETITE_WINDOW + RISK_APPETITE_CHANGE_HORIZON_DAYS)
  const last = ds.length - 1
  const at = (base: (i: number) => number, override?: number) => (i: number) =>
    i === last && override !== undefined ? override : base(i)
  return {
    vix: series(
      ds,
      at((i) => 12 + (i % 20), over.vix),
    ),
    hyg: series(
      ds,
      at((i) => 80 + Math.sin(i / 7), over.hyg),
    ),
    lqd: series(
      ds,
      at((i) => 107 + Math.cos(i / 11), over.lqd),
    ),
    usdjpy: series(
      ds,
      at((i) => 150 + Math.sin(i / 5), over.usdjpy),
    ),
  } satisfies RiskAppetiteHistory
}

const inputs = (asOf = '2026-08-26T20:00:00.000Z') => ({
  vix: { asOf, quality: 'delayed' as const },
  credit: { asOf, quality: 'delayed' as const },
  fx: { asOf, quality: 'delayed' as const },
})

describe('the percentile is a rank, with no thresholds anywhere', () => {
  it('places a value by the share of the sample at or below it', () => {
    const sample = [1, 2, 3, 4, 5]
    expect(empiricalPercentile(sample, 0)).toBe(0)
    expect(empiricalPercentile(sample, 3)).toBe(60)
    expect(empiricalPercentile(sample, 9)).toBe(100)
  })

  it('is invariant under a monotone transform, which is why skew needs no log', () => {
    /*
     * The reason rank beats a z-score here. VIX is strongly right-skewed, and
     * a rank cannot be distorted by that — ranking the level and ranking its
     * logarithm give the identical answer, so no arbitrary transform step is
     * needed and none can be got wrong.
     */
    const raw = [12, 14, 18, 25, 40, 65]
    const logged = raw.map((v) => Math.log(v))
    for (const v of raw) {
      expect(empiricalPercentile(logged, Math.log(v))).toBe(empiricalPercentile(raw, v))
    }
  })

  it('refuses an empty sample rather than returning a number', () => {
    expect(() => empiricalPercentile([], 1)).toThrow(/empty/)
  })
})

describe('coherence is about the same market moment, not about age', () => {
  it('accepts one missed publication interval and rejects a second', () => {
    /* Measured cadence inside the common window is exactly 60 s per leg. */
    const t = Date.parse('2026-08-26T19:59:00.000Z')
    const at = (ms: number) => new Date(t + ms).toISOString()
    expect(coherence([at(0), at(60_000), at(120_000)]).coherent).toBe(true)
    expect(coherence([at(0), at(60_000), at(120_001)]).coherent).toBe(false)
    expect(RISK_APPETITE_COHERENCE_MS).toBe(120_000)
  })

  it('rejects the measured overnight case, where only FX kept trading', () => {
    /*
     * The real failure this exists to stop: at 21:54 UTC the spread across the
     * three legs was 6 879 s because USDJPY kept ticking against frozen US
     * inputs. Individually fresh, jointly meaningless.
     */
    const t = Date.parse('2026-08-25T20:00:00.000Z')
    const at = (ms: number) => new Date(t + ms).toISOString()
    const result = coherence([at(0), at(900_000), at(6_879_000)])
    expect(result.coherent).toBe(false)
    expect(result.spreadMs).toBe(6_879_000)
  })

  it('reports the spread, so a caller can say how far out it was', () => {
    const t = Date.parse('2026-08-26T19:59:00.000Z')
    expect(
      coherence([new Date(t).toISOString(), new Date(t + 45_000).toISOString()]).spreadMs,
    ).toBe(45_000)
  })
})

describe('the window is aligned dates, not a calendar year', () => {
  it('counts only dates on which every leg has an observation', () => {
    /*
     * The legs keep different calendars — FX trades through US equity
     * holidays. Measured over one calendar year of raw history: 253/251/251/261
     * bars but only 223 aligned dates. A per-leg window would silently rank
     * each leg against a different set of days.
     */
    const ds = dates(10)
    const h: RiskAppetiteHistory = {
      vix: series(ds, (i) => i + 1),
      hyg: series(ds.slice(0, 8), (i) => i + 1),
      lqd: series(ds, (i) => i + 1),
      usdjpy: series(
        ds.filter((_, i) => i !== 3),
        (i) => i + 1,
      ),
    }
    const aligned = alignedDates(h)
    expect(aligned).toHaveLength(7)
    expect(aligned).not.toContain(ds[3])
    expect(aligned).not.toContain(ds[8])
  })

  it('returns insufficient evidence rather than a shorter window', () => {
    /*
     * The rule that protects every stored score: a percentile over 180 days
     * and one over 252 are different statistics, so a short sample must
     * produce no score at all.
     */
    const ds = dates(100)
    const short: RiskAppetiteHistory = {
      vix: series(ds, (i) => 12 + (i % 20)),
      hyg: series(ds, (i) => 80 + i * 0.01),
      lqd: series(ds, (i) => 107 + i * 0.01),
      usdjpy: series(ds, (i) => 150 + i * 0.01),
    }
    expect(() => transformLegs(short, inputs())).toThrow(InsufficientHistoryError)
    expect(() => transformLegs(short, inputs())).toThrow(/252 aligned observations/)
  })

  it('ranks every leg against exactly the full window', () => {
    const legs = transformLegs(history(), inputs())
    for (const leg of legs) {
      expect(leg.sampleSize, leg.id).toBe(RISK_APPETITE_WINDOW)
    }
  })
})

describe('each leg ranks the quantity that is meaningful for it', () => {
  it('ranks the VIX level and inverts it, because expensive protection is risk-off', () => {
    const calm = transformLegs(history({ vix: 1 }), inputs())[0]!
    const stressed = transformLegs(history({ vix: 999 }), inputs())[0]!
    expect(calm.rawKind).toBe('level')
    expect(calm.score).toBeGreaterThan(stressed.score)
    expect(stressed.score).toBeLessThan(5)
  })

  it('does not call a fall from extreme volatility risk-on', () => {
    /*
     * Why the level is ranked rather than the change. A VIX falling from 40 to
     * 35 is improving, but the market is still in a high-volatility state and
     * the leg must keep saying so.
     */
    const stillHigh = transformLegs(history({ vix: 35 }), inputs())[0]!
    expect(stillHigh.score).toBeLessThan(20)
  })

  it('ranks the credit ratio change, and a falling ratio is risk-off', () => {
    const widening = transformLegs(history({ hyg: 60 }), inputs())[1]!
    const tightening = transformLegs(history({ hyg: 100 }), inputs())[1]!
    expect(widening.rawKind).toBe('log-change')
    expect(widening.score).toBeLessThan(tightening.score)
  })

  it('ranks the USDJPY change, and yen strength is risk-off', () => {
    const yenStrong = transformLegs(history({ usdjpy: 120 }), inputs())[2]!
    const yenWeak = transformLegs(history({ usdjpy: 190 }), inputs())[2]!
    expect(yenStrong.score).toBeLessThan(yenWeak.score)
  })

  it('marks the credit leg a proxy and names what contaminates it', () => {
    /*
     * The aggregate must never hide that this leg is two ETFs standing in for
     * credit spreads. The note is inspectable rather than a footnote.
     */
    const [equity, credit, fx] = transformLegs(history(), inputs())
    expect(credit!.isProxy).toBe(true)
    expect(credit!.instruments).toEqual(['HYG', 'LQD'])
    expect(credit!.proxyNote).toMatch(/duration/i)
    expect(equity!.isProxy).toBe(false)
    expect(fx!.isProxy).toBe(false)
  })
})

describe('the composite keeps state and agreement separate', () => {
  const leg = (
    id: RiskAppetiteLeg['id'],
    score: number,
    over: Partial<RiskAppetiteLeg> = {},
  ): RiskAppetiteLeg => ({
    id,
    label: id,
    rawValue: 1,
    rawKind: 'level',
    score,
    sampleSize: RISK_APPETITE_WINDOW,
    instruments: [],
    isProxy: false,
    proxyNote: '',
    inputAsOf: '2026-08-26T20:00:00.000Z',
    inputQuality: 'delayed',
    ...over,
  })

  const build = (a: number, b: number, c: number) =>
    buildRiskAppetite({
      legs: [leg('equity-volatility', a), leg('credit', b), leg('fx-safe-haven', c)],
      session: 'open',
      nowMs: NOW,
      source: SOURCE,
    })

  it('gives the same score to agreement and to disagreement, and separates them', () => {
    /*
     * The distinction the ruling turns on. 43/45/47 and 5/45/85 both average
     * to 45 and mean entirely different things; only dispersion tells them
     * apart, and it must not be folded into the score.
     */
    const agreed = build(43, 45, 47)
    const split = build(5, 45, 85)
    expect(agreed.score).toBeCloseTo(45, 6)
    expect(split.score).toBeCloseTo(45, 6)
    expect(agreed.dispersion).toBe(4)
    expect(split.dispersion).toBe(80)
  })

  it('requires cross-asset agreement to reach an extreme', () => {
    /*
     * Equal weighting's dilution, as intended. One extreme leg moves the
     * composite materially without driving it to an extreme.
     */
    expect(build(0, 50, 50).score).toBeCloseTo(33.3, 1)
    expect(build(0, 0, 0).score).toBe(0)
    expect(build(100, 100, 100).score).toBe(100)
  })

  it('weights the three legs equally', () => {
    expect(build(0, 0, 90).score).toBeCloseTo(30, 6)
    expect(build(90, 0, 0).score).toBeCloseTo(30, 6)
    expect(build(0, 90, 0).score).toBeCloseTo(30, 6)
  })

  it('names the state only outside the neutral band', () => {
    expect(labelForRiskAppetite(build(20, 20, 20).score)).toBe('risk-off')
    expect(labelForRiskAppetite(build(50, 50, 50).score)).toBe('neutral')
    expect(labelForRiskAppetite(build(80, 80, 80).score)).toBe('risk-on')
  })
})

describe('governance survives composition', () => {
  const withQuality = (q: 'delayed' | 'fixture') =>
    transformLegs(history(), {
      vix: { asOf: '2026-08-26T20:00:00.000Z', quality: q },
      credit: { asOf: '2026-08-26T19:59:00.000Z', quality: 'delayed' },
      fx: { asOf: '2026-08-26T20:00:30.000Z', quality: 'delayed' },
    })

  it('is derived, never a market quality', () => {
    const composite = buildRiskAppetite({
      legs: withQuality('delayed'),
      session: 'open',
      nowMs: NOW,
      source: SOURCE,
    })
    expect(composite.provenance.quality).toBe('derived')
    expect(composite.provenance.isProxy).toBe(false)
    expect(composite.methodology).toBe(RISK_APPETITE_METHODOLOGY)
  })

  it('degrades to fixture if any input was one, so derived cannot launder', () => {
    const composite = buildRiskAppetite({
      legs: withQuality('fixture'),
      session: 'open',
      nowMs: NOW,
      source: SOURCE,
    })
    expect(composite.provenance.quality).toBe('fixture')
  })

  it('is never fresher than its stalest input', () => {
    const composite = buildRiskAppetite({
      legs: withQuality('delayed'),
      session: 'open',
      nowMs: NOW,
      source: SOURCE,
    })
    expect(composite.provenance.asOf).toBe('2026-08-26T19:59:00.000Z')
  })

  it("carries its own session rather than any constituent's", () => {
    /*
     * The composite is a US-session measure. `closed` means this is the last
     * complete reading of the most recent common session, retained rather than
     * recomputed — which is what stops overnight FX mutating it.
     */
    const frozen = buildRiskAppetite({
      legs: withQuality('delayed'),
      session: 'closed',
      nowMs: NOW,
      source: SOURCE,
    })
    expect(frozen.session).toBe('closed')
  })

  it('refuses a composite with a missing asset class', () => {
    const [equity, credit] = withQuality('delayed')
    expect(() =>
      buildRiskAppetite({
        legs: [equity!, credit!],
        session: 'open',
        nowMs: NOW,
        source: SOURCE,
      }),
    ).toThrow(/expected 3 legs/)
  })

  it('refuses legs that were ranked against a short sample', () => {
    const legs = withQuality('delayed').map((l) => ({ ...l, sampleSize: 180 }))
    expect(() =>
      buildRiskAppetite({ legs, session: 'open', nowMs: NOW, source: SOURCE }),
    ).toThrow(InsufficientHistoryError)
  })
})
