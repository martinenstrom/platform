/**
 * Cross-Asset Risk Appetite.
 *
 * The question this answers: **how risk-on or risk-off is the current
 * cross-asset configuration relative to the recent regime?**
 *
 * Not "market sentiment". It makes no claim about investor psychology, and it
 * is not a macro or valuation signal. It reads what three liquid markets are
 * currently charging for risk, ranked against the trailing trading year.
 *
 * ## Three legs, three different economically meaningful quantities
 *
 *   equity volatility  `^VIX`         percentile of the LEVEL
 *   credit             `HYG` / `LQD`  percentile of the adjusted log CHANGE
 *   fx / safe haven    `USDJPY=X`     percentile of the log CHANGE
 *
 * The transformations differ on purpose, and forcing one onto all three for
 * symmetry would be wrong:
 *
 *  - **VIX is already normalised.** It is annualised volatility in percent, so
 *    its level is comparable across time and carries the state. Reducing it to
 *    a daily change would say a fall from 40 to 35 is risk-on while the market
 *    is still in a high-volatility state.
 *  - **The HYG/LQD level is not stationary.** Measured over 2025-08 to
 *    2026-08, distributions moved the unadjusted ratio by −1,31 % over the
 *    year. Small, but one-directional and cumulative, so the level encodes
 *    coupon history as well as credit appetite. The change does not.
 *  - **The USDJPY level is trend-dominated**, reflecting years of accumulated
 *    rate differential. Only the move carries risk information.
 *
 * ## Adjusted prices are mandatory for the credit leg
 *
 * HYG and LQD distribute on the **same twelve dates** each year, so the ratio
 * cancels most of the ex-dividend drop. What survives was measured at −0,052 %
 * to −0,147 % per ex-dividend day — comparable to a p25 move in a distribution
 * whose p25 is −0,132 %, **always negative**, on 12 of ~250 days.
 *
 * That is not a tail event; it is a systematic one-directional bias on ~5 % of
 * observations. Unadjusted prices would put one day in twenty spuriously
 * toward risk-off, which is ex-dividend mechanics masquerading as credit
 * deterioration. `adjclose` is used for this leg and nothing else will do.
 *
 * ## Orientation
 *
 * Every leg is expressed on one scale where **0 is strongest risk-off and 100
 * strongest risk-on**, so the signs are applied once, here, rather than
 * remembered at each call site:
 *
 *   VIX          high percentile -> risk-OFF, so the percentile is INVERTED
 *   HYG/LQD      falling ratio   -> risk-OFF, percentile used as-is
 *   USDJPY       falling (yen strength) -> risk-OFF, percentile used as-is
 *
 * ## Score and agreement are different questions
 *
 * The composite answers *what state*; dispersion answers *how much the three
 * markets agree about it*. A score of 45 from legs 43/45/47 and a score of 45
 * from 5/45/85 are not the same statement, and encoding both into one 0-100
 * number would destroy the distinction. So dispersion is reported beside the
 * score and **never modifies it**.
 *
 * Equal weights are deliberate. The trailing year is nowhere near enough to
 * estimate stable optimal weights, and the measured near-independence of the
 * legs is partly an artefact of ranking a level against two changes. Equal
 * weighting is the least assumption-heavy start, and its dilution is a
 * feature: one extreme leg should move the composite materially without
 * driving it to an extreme, because an extreme cross-asset reading ought to
 * require cross-asset agreement.
 */

import type { Provenance, Quality } from './provenance'
import type { SessionState } from './observations'

/**
 * Pins every methodological choice together.
 *
 * Changing the instruments, transformations, window, tolerance, weights,
 * orientation or session semantics requires a NEW version rather than an edit,
 * so a stored score stays interpretable against the rules that produced it.
 *
 * ## What this version pins
 *
 *   VIX      252-observation percentile of the LEVEL
 *   credit   252-observation percentile of the 3-day adjusted HYG/LQD log change
 *   fx       252-observation percentile of the 3-day USDJPY log change
 *   weights  1/3 each
 *   window   252 ALIGNED observations
 *   coherence 120 s intraday / same trading session for a close-based score
 *
 * ## The asymmetry is accepted, not resolved
 *
 * One leg ranks a level and two rank multi-session changes, so the legs do not
 * carry the same character of information. Measured lag-1 autocorrelation at
 * the one-day horizon was 0.849 for equity volatility against -0.056 and
 * -0.043 for credit and FX; three-day changes narrow that gap but do not close
 * it, and they do not turn a change signal into a state signal.
 *
 * This is documented rather than disguised. It is why dispersion is a
 * first-class diagnostic and why the composite must never be read alone when
 * the legs disagree. A stationary-level treatment of credit and FX is deferred
 * to a possible v2 and is deliberately not attempted here.
 */
export const RISK_APPETITE_METHODOLOGY = 'cross-asset-risk-appetite-v1'

/**
 * Aligned observations in the rolling window.
 *
 * **252 aligned observations, not one calendar year.** The distinction is
 * measured, not pedantic: the legs keep different calendars — FX trades on US
 * equity holidays, Cboe runs its own schedule — and one calendar year of raw
 * history yields only ~223 dates on which all three legs have a valid
 * observation. Roughly 14 months of raw history is needed to obtain 252.
 *
 * 252 is the conventional trading-year sample size.
 */
export const RISK_APPETITE_WINDOW = 252

/**
 * Maximum permitted spread between constituent observation timestamps.
 *
 * Measured cadence inside the common window is **exactly 60 s for every leg**,
 * with zero gaps observed over a full session. 120 s therefore admits one
 * missed publication interval and rejects a second — the same "one missed
 * interval" principle used for the commodity freshness horizon.
 *
 * **Coherence is not freshness.** Freshness asks how old the result is now;
 * coherence asks whether the constituents describe the same market moment.
 * Three individually fresh observations spread over two hours are individually
 * fresh and jointly meaningless.
 */
export const RISK_APPETITE_COHERENCE_MS = 120_000

export type RiskAppetiteLegId = 'equity-volatility' | 'credit' | 'fx-safe-haven'

export interface RiskAppetiteLeg {
  id: RiskAppetiteLegId
  label: string
  /** The quantity that was ranked — a level for VIX, a log change otherwise. */
  rawValue: number
  /** What `rawValue` is, so a reader never has to infer it. */
  rawKind: 'level' | 'log-change'
  /** 0 = strongest risk-off, 100 = strongest risk-on. */
  score: number
  /** Observations the percentile was computed against. Always the full window. */
  sampleSize: number
  /** The instrument(s) behind this leg, for inspection. */
  instruments: readonly string[]
  /**
   * True where the leg is measured through something other than the thing it
   * describes. The credit leg is the case: two ETFs standing in for credit
   * spreads.
   */
  isProxy: boolean
  /** Why it is a proxy and what that contaminates. Empty when it is not one. */
  proxyNote: string
  inputAsOf: string
  inputQuality: Quality
}

export type RiskAppetiteLabel = 'risk-off' | 'neutral' | 'risk-on'

export interface CrossAssetRiskAppetite {
  /** 0..100, equal-weighted mean of the leg scores. State, not confidence. */
  score: number
  label: RiskAppetiteLabel
  /**
   * `max(leg) - min(leg)`. Describes how consistently the three markets
   * support the score. **Never alters the score** — see the module note.
   */
  dispersion: number
  legs: readonly RiskAppetiteLeg[]
  /** Always `RISK_APPETITE_METHODOLOGY` for a score this module produced. */
  methodology: string
  /**
   * The composite's OWN session, derived from the common window of its legs —
   * never inherited from any single constituent. `closed` means this is the
   * last complete reading of the most recent common session, retained rather
   * than recomputed.
   */
  session: SessionState
  provenance: Provenance
}

/** Neutral band. Outside it the composite is named. */
export const RISK_APPETITE_RISK_ON = 60
export const RISK_APPETITE_RISK_OFF = 40

export function labelForRiskAppetite(score: number): RiskAppetiteLabel {
  if (score >= RISK_APPETITE_RISK_ON) return 'risk-on'
  if (score <= RISK_APPETITE_RISK_OFF) return 'risk-off'
  return 'neutral'
}

/**
 * Empirical percentile: the share of the sample at or below `value`, 0..100.
 *
 * Rank-based rather than a z-score, for reasons that are not stylistic:
 *
 *  - it introduces **no threshold table**, so there is no VIX band nobody can
 *    justify;
 *  - it is invariant under any monotone transform, so VIX's strong right skew
 *    needs no log step and cannot distort the result;
 *  - it puts three different raw units on one comparable scale.
 *
 * The limitation belongs next to the definition: this measures unusualness
 * **relative to the sample**, which is one trading year. It adapts to the
 * prevailing regime — correct for a tactical measure, wrong if mistaken for a
 * structural or historical one.
 *
 * `sample` must be sorted ascending. Callers sort once and reuse.
 */
export function empiricalPercentile(
  sortedSample: readonly number[],
  value: number,
): number {
  if (sortedSample.length === 0) {
    throw new Error('empiricalPercentile: sample is empty')
  }
  let lo = 0
  let hi = sortedSample.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sortedSample[mid]! <= value) lo = mid + 1
    else hi = mid
  }
  return (100 * lo) / sortedSample.length
}

/**
 * Whether the constituent observations describe the same market moment.
 *
 * Returns the spread so a caller can report how far out it was rather than
 * only that it failed.
 */
export function coherence(
  asOfs: readonly string[],
  toleranceMs: number = RISK_APPETITE_COHERENCE_MS,
): { coherent: boolean; spreadMs: number } {
  if (asOfs.length === 0) throw new Error('coherence: no observations')
  const times = asOfs.map((iso) => {
    const at = new Date(iso).getTime()
    if (Number.isNaN(at)) throw new Error(`coherence: invalid timestamp "${iso}"`)
    return at
  })
  const spreadMs = Math.max(...times) - Math.min(...times)
  return { coherent: spreadMs <= toleranceMs, spreadMs }
}

/** Raised when the window cannot be filled. Never silently shortened. */
export class InsufficientHistoryError extends Error {
  constructor(
    readonly available: number,
    readonly required: number = RISK_APPETITE_WINDOW,
  ) {
    super(
      `Cross-Asset Risk Appetite needs ${required} aligned observations across ` +
        `every leg; ${available} are available. Returning no score rather than ` +
        `a shorter undocumented window.`,
    )
    this.name = 'InsufficientHistoryError'
  }
}

/**
 * Assembles the composite from three already-transformed legs.
 *
 * Invariants enforced here rather than trusted to callers:
 *
 *  1. all three legs must be present — a two-leg score is a different measure
 *  2. `provenance.asOf` is the OLDEST constituent timestamp: a composite is
 *     never fresher than its stalest input
 *  3. `quality` is `derived`, degraded to `fixture` if any input was one, so
 *     "derived" cannot launder invented inputs into apparent market data
 *  4. every leg must have been ranked against the full window
 */
export function buildRiskAppetite(args: {
  legs: readonly RiskAppetiteLeg[]
  session: SessionState
  nowMs: number
  source: Provenance['source']
  /**
   * How precisely the constituents pinned their observation.
   *
   * `'date'` for a composite built from session closes: the trading date is
   * real, the time of day is not, and the domain's convention is midnight UTC
   * of that date — which over-states age by up to a day, in the safe
   * direction. Claiming `'second'` there would assert a precision the inputs
   * never carried.
   */
  asOfPrecision?: Provenance['asOfPrecision']
}): CrossAssetRiskAppetite {
  const { legs } = args
  if (legs.length !== 3) {
    throw new Error(
      `buildRiskAppetite: expected 3 legs, received ${legs.length}. A composite ` +
        `with a missing asset class is a different measure and must not be ` +
        `presented as this one.`,
    )
  }
  for (const leg of legs) {
    if (leg.sampleSize !== RISK_APPETITE_WINDOW) {
      throw new InsufficientHistoryError(leg.sampleSize)
    }
  }

  const scores = legs.map((leg) => leg.score)
  /* Equal weights, stated as arithmetic rather than a weight vector. */
  const score = scores.reduce((sum, value) => sum + value, 0) / scores.length
  const dispersion = Math.max(...scores) - Math.min(...scores)

  const oldestAsOf = legs.reduce((oldest, leg) => {
    const at = new Date(leg.inputAsOf).getTime()
    if (Number.isNaN(at)) {
      throw new Error(`buildRiskAppetite: invalid inputAsOf on leg ${leg.id}`)
    }
    return at < new Date(oldest).getTime() ? leg.inputAsOf : oldest
  }, legs[0]!.inputAsOf)

  const fromFixture = legs.some((leg) => leg.inputQuality === 'fixture')
  const asOfMs = new Date(oldestAsOf).getTime()

  return {
    score,
    label: labelForRiskAppetite(score),
    dispersion,
    legs,
    methodology: RISK_APPETITE_METHODOLOGY,
    session: args.session,
    provenance: {
      asOf: oldestAsOf,
      asOfPrecision: args.asOfPrecision ?? 'second',
      receivedAt: new Date(args.nowMs).toISOString(),
      ageMs: Math.max(0, args.nowMs - asOfMs),
      source: args.source,
      quality: fromFixture ? 'fixture' : 'derived',
      isDelayed: false,
      delayMinutes: null,
      /*
       * The COMPOSITE is not a proxy — it is exactly what it claims to be. The
       * credit LEG is, and says so on `RiskAppetiteLeg.isProxy`, which is
       * where a reader can act on it.
       */
      isProxy: false,
    },
  }
}
