/**
 * Government bond yields and yield curves.
 *
 * Yields are percent per annum; yield *changes* are basis points. Mixing the
 * two is the classic rates bug — "+0,04" is a rounding artefact as a percent
 * and a real move as basis points — so the two units are distinct types here
 * and cannot be assigned to each other.
 */

import type { CanonicalSymbol } from './instruments'
import {
  basisPoints,
  type IsoCurrencyCode,
  yieldPercent,
  type BasisPoints,
  type YieldPercent,
} from './primitives'
import type { Provenance } from './provenance'

/**
 * Canonical maturities. An adapter maps a SERIES ID to one of these; it must
 * never infer a maturity from a display label.
 */
export type Maturity =
  | '1M'
  | '2M'
  | '3M'
  | '4M'
  | '6M'
  | '1Y'
  | '2Y'
  | '3Y'
  | '5Y'
  | '7Y'
  | '10Y'
  | '20Y'
  | '30Y'

export const MATURITY_MONTHS: Record<Maturity, number> = {
  '1M': 1,
  '2M': 2,
  '3M': 3,
  '4M': 4,
  '6M': 6,
  '1Y': 12,
  '2Y': 24,
  '3Y': 36,
  '5Y': 60,
  '7Y': 84,
  '10Y': 120,
  '20Y': 240,
  '30Y': 360,
}

/**
 * How a yield was measured. These are NOT interchangeable, and the type exists
 * to stop them being treated as though they were.
 *
 *  - `par-yield`             US Treasury daily par yield curve: the coupon at
 *                            which a security would price at par.
 *  - `constant-maturity`     FRED/H.15 series interpolated to a fixed tenor
 *                            from the same Treasury curve. Methodologically
 *                            equivalent to `par-yield` because it is derived
 *                            from it — the only such equivalence here.
 *  - `zero-coupon-fitted`    Bundesbank Svensson-fitted spot rate. A different
 *                            measure from a par yield, not a variant of it.
 *  - `benchmark-bond-yield`  A vendor's generic N-year government benchmark.
 *  - `specific-bond-quote`   The yield of one identified security.
 *  - `spot-rate`             A zero-coupon rate from another construction.
 */
export type YieldMethodology =
  | 'par-yield'
  /**
   * The Treasury's Par REAL Yield Curve — TIPS.
   *
   * Deliberately NOT `par-yield`, although the Treasury fits it the same way.
   * A real yield and a nominal yield at the same tenor are different
   * quantities, and `methodologiesAreComparable` is what stops them being
   * drawn as one curve. Their DIFFERENCE is meaningful — that is the
   * breakeven — but that is a derivation with its own identity, never a curve.
   */
  | 'par-real-yield'
  | 'constant-maturity'
  | 'zero-coupon-fitted'
  | 'benchmark-bond-yield'
  | 'specific-bond-quote'
  | 'spot-rate'

/** Methodologies that may legitimately appear in one curve together. */
export function methodologiesAreComparable(
  a: YieldMethodology,
  b: YieldMethodology,
): boolean {
  if (a === b) return true
  // A constant-maturity series IS the par curve, interpolated to a fixed
  // tenor. Nothing else pairs.
  const parFamily: YieldMethodology[] = ['par-yield', 'constant-maturity']
  return parFamily.includes(a) && parFamily.includes(b)
}

export interface GovernmentYield {
  symbol: CanonicalSymbol
  /** ISO 3166-1 alpha-2. */
  countryCode: string
  /** Currency the bond is denominated in. */
  currency: IsoCurrencyCode
  /**
   * Canonical maturity. Required: every producer now maps a SERIES ID to one
   * of these, and none infers a maturity from a display label.
   */
  maturity: Maturity
  /** The source's own identifier for this series. */
  seriesId: string
  methodology: YieldMethodology
  /**
   * The source's own observation date, `YYYY-MM-DD`, kept separate from
   * `provenance.receivedAt` so a revision can be recognised: same
   * observationDate, later receivedAt, different value.
   */
  observationDate: string
  /** 24 = 2Y, 120 = 10Y. */
  tenorMonths: number
  /** Percent per annum: `4.32` means 4.32 %. May be negative. */
  yieldPercent: YieldPercent
  /** Change vs. the prior close, in basis points. `null` when unavailable. */
  changeBasisPoints: BasisPoints | null
  provenance: Provenance
}

export function buildYield(args: {
  symbol: CanonicalSymbol
  countryCode: string
  currency: IsoCurrencyCode
  /** `tenorMonths` is derived from it; the two cannot disagree. */
  maturity: Maturity
  seriesId: string
  methodology: YieldMethodology
  observationDate: string
  yieldPercent: number
  previousYieldPercent?: number | null
  provenance: Provenance
}): GovernmentYield {
  const tenorMonths = MATURITY_MONTHS[args.maturity]
  if (tenorMonths === undefined) {
    throw new Error(`buildYield(${args.symbol}): unknown maturity ${args.maturity}`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.observationDate)) {
    throw new Error(
      `buildYield: observationDate must be YYYY-MM-DD, got "${args.observationDate}"`,
    )
  }
  const current = yieldPercent(args.yieldPercent)
  const previous =
    args.previousYieldPercent === null || args.previousYieldPercent === undefined
      ? null
      : yieldPercent(args.previousYieldPercent)

  return {
    symbol: args.symbol,
    countryCode: args.countryCode,
    currency: args.currency,
    maturity: args.maturity,
    seriesId: args.seriesId,
    methodology: args.methodology,
    observationDate: args.observationDate,
    tenorMonths,
    yieldPercent: current,
    // A yield move is a difference of percentages, so it is percentage POINTS
    // times 100 — not a percentage change of the yield.
    changeBasisPoints: previous === null ? null : basisPoints((current - previous) * 100),
    provenance: args.provenance,
  }
}

/**
 * A term structure for one issuer at one moment. Replaces the PRNG sparkline
 * the Overview renders today (defect D6): a curve is a set of tenors, not a
 * random walk.
 */
export interface YieldCurve {
  countryCode: string
  /**
   * The single methodology every point shares.
   *
   * A curve mixing a par yield, a fitted zero rate and a vendor benchmark is
   * not a curve — it is three unrelated numbers on one axis.
   */
  methodology: YieldMethodology
  /** The single observation date every point shares. */
  observationDate: string
  /** Ascending by `tenorMonths`. Enforced by `buildYieldCurve`. */
  points: GovernmentYield[]
  provenance: Provenance
}

/**
 * Builds a curve, refusing anything that would make its points
 * incomparable.
 *
 * Missing maturities are simply absent — never interpolated. Interpolating
 * would invent a point the source did not publish, and would do it silently.
 */
export function buildYieldCurve(args: {
  countryCode: string
  points: GovernmentYield[]
  provenance: Provenance
}): YieldCurve {
  const first = args.points[0]
  if (!first) throw new Error('buildYieldCurve: a curve needs at least one point')

  const foreign = args.points.find((point) => point.countryCode !== args.countryCode)
  if (foreign) {
    throw new Error(
      `buildYieldCurve: ${args.countryCode} curve contains a ${foreign.countryCode} point`,
    )
  }

  const mismatch = args.points.find(
    (point) => !methodologiesAreComparable(point.methodology, first.methodology),
  )
  if (mismatch) {
    throw new Error(
      `buildYieldCurve: cannot mix ${first.methodology} with ${mismatch.methodology} ` +
        `in one curve — they measure different things`,
    )
  }

  const otherDate = args.points.find(
    (point) => point.observationDate !== first.observationDate,
  )
  if (otherDate) {
    throw new Error(
      `buildYieldCurve: curve points must share one observation date; got ` +
        `${first.observationDate} and ${otherDate.observationDate}`,
    )
  }

  return {
    countryCode: args.countryCode,
    methodology: first.methodology,
    observationDate: first.observationDate,
    points: [...args.points].sort((a, b) => a.tenorMonths - b.tenorMonths),
    provenance: args.provenance,
  }
}

/**
 * 10Y minus 2Y in basis points — the standard slope measure, and an input to
 * derived sentiment. `null` when either tenor is missing rather than guessing
 * from adjacent points.
 */
export function curveSlopeBasisPoints(curve: YieldCurve): BasisPoints | null {
  const short = curve.points.find((point) => point.tenorMonths === 24)
  const long = curve.points.find((point) => point.tenorMonths === 120)
  if (!short || !long) return null
  return basisPoints((long.yieldPercent - short.yieldPercent) * 100)
}
