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
  yieldPercent,
  type BasisPoints,
  type YieldPercent,
} from './primitives'
import type { Provenance } from './provenance'

export interface GovernmentYield {
  symbol: CanonicalSymbol
  /** ISO 3166-1 alpha-2. */
  countryCode: string
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
  tenorMonths: number
  yieldPercent: number
  previousYieldPercent?: number | null
  provenance: Provenance
}): GovernmentYield {
  if (args.tenorMonths <= 0 || !Number.isInteger(args.tenorMonths)) {
    throw new Error(
      `buildYield: tenorMonths must be a positive integer, got ${args.tenorMonths}`,
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
    tenorMonths: args.tenorMonths,
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
  /** Ascending by `tenorMonths`. Enforced by `buildYieldCurve`. */
  points: GovernmentYield[]
  provenance: Provenance
}

export function buildYieldCurve(args: {
  countryCode: string
  points: GovernmentYield[]
  provenance: Provenance
}): YieldCurve {
  const foreign = args.points.find((point) => point.countryCode !== args.countryCode)
  if (foreign) {
    throw new Error(
      `buildYieldCurve: ${args.countryCode} curve contains a ${foreign.countryCode} point`,
    )
  }
  return {
    countryCode: args.countryCode,
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
