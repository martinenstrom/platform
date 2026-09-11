/**
 * Turning raw daily history into the three Cross-Asset Risk Appetite legs.
 *
 * The domain owns what a leg *means* and how the composite is assembled; this
 * owns the step before that — aligning calendars, ranking the right quantity
 * per leg, and refusing to produce anything at all when the evidence is short.
 *
 * ## Alignment is not an implementation detail
 *
 * The three legs keep different calendars. Measured over 2025-08 to 2026-08:
 * `^VIX` 253 bars, `HYG`/`LQD` 251, `USDJPY=X` 261 — FX trades through US
 * equity holidays and Cboe runs its own schedule. The intersection is **223
 * dates**, not 252.
 *
 * A window built per-leg would silently compare each leg against a different
 * set of days. So the window is the intersection: a date counts only when
 * every leg has a valid observation on it, which is also what makes the
 * cross-leg dispersion meaningful.
 *
 * The practical consequence is that ~14 months of raw history are needed to
 * obtain 252 aligned dates, and asking for one calendar year would quietly
 * yield ~223.
 */

import {
  empiricalPercentile,
  InsufficientHistoryError,
  RISK_APPETITE_WINDOW,
  type RiskAppetiteLeg,
} from '~/domain/market'
import type { Quality } from '~/domain/market'

/** One daily observation. `date` is an ISO calendar date, `value` its close. */
export interface DailyObservation {
  date: string
  /** Adjusted close where the leg requires it — see the credit leg. */
  value: number
}

export interface RiskAppetiteHistory {
  /** `^VIX` closes. Adjustment is irrelevant: an index pays nothing. */
  vix: readonly DailyObservation[]
  /** `HYG` **adjusted** closes. Unadjusted is not acceptable here. */
  hyg: readonly DailyObservation[]
  /** `LQD` **adjusted** closes. */
  lqd: readonly DailyObservation[]
  /** `USDJPY=X` closes. Adjustment is irrelevant: FX pays nothing. */
  usdjpy: readonly DailyObservation[]
}

/**
 * The dates on which every leg has an observation, chronologically.
 *
 * Intersection rather than union: a missing leg on a date makes that date
 * unusable for a cross-asset comparison, and filling it would be inventing an
 * observation.
 */
export function alignedDates(history: RiskAppetiteHistory): string[] {
  const sets = [history.vix, history.hyg, history.lqd, history.usdjpy].map(
    (series) => new Set(series.map((observation) => observation.date)),
  )
  const [first, ...rest] = sets
  if (!first) return []
  return [...first]
    .filter((date) => rest.every((set) => set.has(date)))
    .sort((a, b) => a.localeCompare(b))
}

const byDate = (series: readonly DailyObservation[]): Map<string, number> =>
  new Map(series.map((observation) => [observation.date, observation.value]))

/**
 * Log change over `horizon` aligned observations.
 *
 * The horizon is a parameter because it is **under experiment, not settled**.
 * A one-day change makes the credit and FX legs near-white noise (measured
 * lag-1 autocorrelation of -0.056 and -0.043) while the VIX level leg is a
 * persistent state variable at 0.849 — so the composite currently mixes one
 * state signal with two shock signals. A multi-day change is the lever that
 * could put all three on the same footing, and the horizon that does so
 * without turning a tactical measure into a slow regime indicator has still
 * to be ruled.
 *
 * Overlapping windows: consecutive multi-day changes share observations, which
 * induces autocorrelation by construction. That is worth remembering when
 * reading the measured persistence of a long horizon — some of it is the
 * overlap, not the market.
 */
function logChanges(values: readonly number[], horizon: number): number[] {
  const out: number[] = []
  for (let i = horizon; i < values.length; i += 1) {
    const previous = values[i - horizon]!
    const current = values[i]!
    if (previous > 0 && current > 0) out.push(Math.log(current / previous))
  }
  return out
}

/**
 * Aligned observations spanned by the credit and FX log change.
 *
 * **Three trading days, and the reason is economic rather than statistical.**
 *
 * A one-day change is a single session's move: near-white noise, measured at
 * lag-1 autocorrelation -0.056 (credit) and -0.043 (FX), carrying no state at
 * all. Three days spans a multi-session repricing — about half a trading week —
 * without straddling two distinct news cycles. It roughly halves the daily
 * churn (mean daily change in leg score 31.0 -> 18.6 for credit, 26.4 -> 15.2
 * for FX) while preserving both the measure's full range and its reaction
 * speed.
 *
 * Longer horizons were measured and rejected on evidence: at ten days the
 * composite never once exceeded 80 in two years, understated known stress days
 * (2026-02-10 read 49.5 where the one-day measure read 19.7), and was still
 * reading risk-on as the November 2025 stress transition began.
 *
 * ## The autocorrelation gain is arithmetic, and is NOT the reason
 *
 * Overlapping h-day changes share h-1 observations, so for a random walk the
 * lag-1 autocorrelation is approximately **(h-1)/h** before any market
 * behaviour enters. Measured against that benchmark:
 *
 *   3d   expected 0.667   measured 0.556 (credit) / 0.609 (fx)
 *   5d   expected 0.800   measured 0.723 / 0.728
 *   10d  expected 0.900   measured 0.845 / 0.827
 *
 * Every value sits BELOW its benchmark, so no horizon discovers persistence
 * that the differencing did not create. Selecting on that column would be
 * mechanical smoothing dressed as a finding.
 *
 * ## What three days does not do
 *
 * It does **not** turn credit or FX into state variables. They remain
 * multi-session CHANGE signals combined with a VIX LEVEL signal, and the
 * methodology is asymmetric by construction. That asymmetry is accepted and
 * deliberately left visible rather than hidden behind weights; it is why
 * dispersion stays high at every horizon and why dispersion is mandatory.
 */
export const RISK_APPETITE_CHANGE_HORIZON_DAYS = 3

export interface LegInputs {
  /** Observation time of the live value that is being ranked. */
  asOf: string
  quality: Quality
}

/**
 * The three transformed legs, each oriented so 0 is risk-off and 100 risk-on.
 *
 * Throws `InsufficientHistoryError` rather than ranking against a shorter
 * sample. A percentile computed over 180 days and one computed over 252 are
 * different statistics, and quietly substituting one would change what every
 * stored score meant.
 *
 * ## Why one extra aligned date is required
 *
 * Two legs rank a CHANGE, and a change consumes an observation: 253 aligned
 * dates yield 252 changes. The VIX leg ranks a level and needs only 252. The
 * window is therefore filled from the last 253 aligned dates so that all three
 * legs are ranked against exactly `RISK_APPETITE_WINDOW` observations — which
 * `buildRiskAppetite` then verifies leg by leg.
 */
export function transformLegs(
  history: RiskAppetiteHistory,
  inputs: { vix: LegInputs; credit: LegInputs; fx: LegInputs },
  /** Aligned observations spanned by the credit and FX change. */
  changeHorizonDays = RISK_APPETITE_CHANGE_HORIZON_DAYS,
): RiskAppetiteLeg[] {
  const dates = alignedDates(history)
  /* The change legs lose `horizon` observations to differencing. */
  const required = RISK_APPETITE_WINDOW + changeHorizonDays
  if (dates.length < required) {
    throw new InsufficientHistoryError(Math.max(0, dates.length - changeHorizonDays))
  }

  const window = dates.slice(-required)
  const vixBy = byDate(history.vix)
  const hygBy = byDate(history.hyg)
  const lqdBy = byDate(history.lqd)
  const jpyBy = byDate(history.usdjpy)

  /* --- equity volatility: rank the LEVEL, then invert ---------------------- */
  const vixLevels = window.slice(changeHorizonDays).map((date) => vixBy.get(date)!)
  const vixSorted = [...vixLevels].sort((a, b) => a - b)
  const vixNow = vixLevels[vixLevels.length - 1]!
  /* High VIX is expensive protection, which is risk-OFF, so invert. */
  const vixScore = 100 - empiricalPercentile(vixSorted, vixNow)

  /* --- credit: rank the log change of the ADJUSTED ratio ------------------- */
  const ratios = window.map((date) => hygBy.get(date)! / lqdBy.get(date)!)
  const creditChanges = logChanges(ratios, changeHorizonDays)
  const creditSorted = [...creditChanges].sort((a, b) => a - b)
  const creditNow = creditChanges[creditChanges.length - 1]!
  /* A falling HYG/LQD ratio is high yield underperforming: risk-OFF. */
  const creditScore = empiricalPercentile(creditSorted, creditNow)

  /* --- fx: rank the log change -------------------------------------------- */
  const jpyLevels = window.map((date) => jpyBy.get(date)!)
  const fxChanges = logChanges(jpyLevels, changeHorizonDays)
  const fxSorted = [...fxChanges].sort((a, b) => a - b)
  const fxNow = fxChanges[fxChanges.length - 1]!
  /* Falling USDJPY is yen strength, the classic carry unwind: risk-OFF. */
  const fxScore = empiricalPercentile(fxSorted, fxNow)

  return [
    {
      id: 'equity-volatility',
      label: 'Aktievolatilitet',
      rawValue: vixNow,
      rawKind: 'level',
      score: vixScore,
      sampleSize: vixSorted.length,
      instruments: ['idx:vix'],
      isProxy: false,
      proxyNote: '',
      inputAsOf: inputs.vix.asOf,
      inputQuality: inputs.vix.quality,
    },
    {
      id: 'credit',
      label: 'Kreditaptit',
      rawValue: creditNow,
      rawKind: 'log-change',
      score: creditScore,
      sampleSize: creditSorted.length,
      instruments: ['HYG', 'LQD'],
      isProxy: true,
      /*
       * Named contamination, not a disclaimer. Whoever reads this leg should
       * know what else moves it.
       */
      proxyNote:
        'Två börshandlade fonder som ställföreträdare för kreditspreadar. ' +
        'LQD har väsentligt längre duration än HYG, så kvoten behåller en ' +
        'räntekomponent och rör sig vid en ren räntechock utan att ' +
        'kreditaptiten ändrats. Fondstruktur (premie/rabatt mot NAV) och en ' +
        'stängningstid som obligationsmarknaden inte delar tillkommer.',
      inputAsOf: inputs.credit.asOf,
      inputQuality: inputs.credit.quality,
    },
    {
      id: 'fx-safe-haven',
      label: 'Valuta',
      rawValue: fxNow,
      rawKind: 'log-change',
      score: fxScore,
      sampleSize: fxSorted.length,
      instruments: ['USDJPY=X'],
      isProxy: false,
      proxyNote: '',
      inputAsOf: inputs.fx.asOf,
      inputQuality: inputs.fx.quality,
    },
  ]
}
