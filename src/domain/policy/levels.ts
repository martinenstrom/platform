/**
 * Policy-rate levels, changes, and regime detection.
 *
 * ## Why the level is a union rather than a scalar
 *
 * The three institutions in scope do not have the same shape of policy rate,
 * and flattening them would force a fabrication:
 *
 *   Fed        a target RANGE. There is no official midpoint. Storing 3.625 %
 *              would invent a number the FOMC has never published.
 *   ECB        THREE official rates that can move independently. The deposit
 *              facility is the stance indicator, but it is not the whole story.
 *   Riksbank   one policy rate. Its corridor rates are defined by rule at
 *              ±0.75pp and are not separate observations, so this module gives
 *              them nowhere to live — enforced by the type, not by convention.
 *
 * ## Why changes mirror the level
 *
 * One scalar `changeBasisPoints` cannot describe "the Fed moved the lower
 * bound but not the upper", or "the ECB narrowed the corridor". The change
 * type is a union parallel to the level type, so a delta always has exactly
 * as many components as the level it describes.
 */

import { basisPoints, type BasisPoints } from '~/domain/shared/primitives'
import { policyRatePercent, type PolicyRatePercent } from './primitives'

export type CentralBankId = 'federal-reserve' | 'ecb' | 'riksbank'

export type PolicyRateType =
  'target-range' | 'deposit-facility' | 'policy-rate' | 'key-rates'

/* -------------------------------------------------------------------- level */

export type PolicyLevel =
  /** FOMC target range. Both bounds, no midpoint, ever. */
  | {
      kind: 'target-range'
      lowerPercent: PolicyRatePercent
      upperPercent: PolicyRatePercent
    }
  /** A single official rate. The Riksbank's policy rate. */
  | { kind: 'single'; ratePercent: PolicyRatePercent }
  /** The ECB's three key rates, each independently set. */
  | {
      kind: 'key-rates'
      depositFacilityPercent: PolicyRatePercent
      mainRefinancingPercent: PolicyRatePercent
      marginalLendingPercent: PolicyRatePercent
    }

export function targetRange(lower: number, upper: number): PolicyLevel {
  if (upper < lower) {
    throw new Error(`target range upper ${upper} is below lower ${lower}`)
  }
  return {
    kind: 'target-range',
    lowerPercent: policyRatePercent(lower),
    upperPercent: policyRatePercent(upper),
  }
}

export function singleRate(rate: number): PolicyLevel {
  return { kind: 'single', ratePercent: policyRatePercent(rate) }
}

export function keyRates(
  depositFacility: number,
  mainRefinancing: number,
  marginalLending: number,
): PolicyLevel {
  return {
    kind: 'key-rates',
    depositFacilityPercent: policyRatePercent(depositFacility),
    mainRefinancingPercent: policyRatePercent(mainRefinancing),
    marginalLendingPercent: policyRatePercent(marginalLending),
  }
}

/**
 * Structural equality across the WHOLE level.
 *
 * Comparing only a primary display rate would miss a Fed move that shifted one
 * bound, or an ECB decision that changed the marginal lending rate alone. For
 * the ECB in particular, a change in any one of the three official rates is a
 * change of policy structure.
 */
export function levelsEqual(a: PolicyLevel, b: PolicyLevel): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'target-range':
      return (
        a.lowerPercent === (b as typeof a).lowerPercent &&
        a.upperPercent === (b as typeof a).upperPercent
      )
    case 'single':
      return a.ratePercent === (b as typeof a).ratePercent
    case 'key-rates':
      return (
        a.depositFacilityPercent === (b as typeof a).depositFacilityPercent &&
        a.mainRefinancingPercent === (b as typeof a).mainRefinancingPercent &&
        a.marginalLendingPercent === (b as typeof a).marginalLendingPercent
      )
  }
}

/* ------------------------------------------------------------------- change */

export type PolicyLevelChange =
  | {
      kind: 'target-range'
      lowerBasisPoints: BasisPoints
      upperBasisPoints: BasisPoints
    }
  | { kind: 'single'; basisPoints: BasisPoints }
  | {
      kind: 'key-rates'
      depositFacilityBasisPoints: BasisPoints
      mainRefinancingBasisPoints: BasisPoints
      marginalLendingBasisPoints: BasisPoints
    }

/**
 * Percentage-point difference in basis points.
 *
 * Rounded to 0.01 bp purely to remove binary floating-point noise: 2.25 - 2.00
 * is 0.25000000000000022 in IEEE-754, and a policy delta should read 25 bp.
 */
function deltaBp(current: number, previous: number): BasisPoints {
  return basisPoints(Math.round((current - previous) * 10_000) / 100)
}

/** Throws on mismatched kinds: two different shapes have no common delta. */
export function changeBetween(
  previous: PolicyLevel,
  current: PolicyLevel,
): PolicyLevelChange {
  if (previous.kind !== current.kind) {
    throw new Error(
      `cannot diff a ${previous.kind} level against a ${current.kind} level`,
    )
  }
  switch (current.kind) {
    case 'target-range': {
      const before = previous as typeof current
      return {
        kind: 'target-range',
        lowerBasisPoints: deltaBp(current.lowerPercent, before.lowerPercent),
        upperBasisPoints: deltaBp(current.upperPercent, before.upperPercent),
      }
    }
    case 'single': {
      const before = previous as typeof current
      return {
        kind: 'single',
        basisPoints: deltaBp(current.ratePercent, before.ratePercent),
      }
    }
    case 'key-rates': {
      const before = previous as typeof current
      return {
        kind: 'key-rates',
        depositFacilityBasisPoints: deltaBp(
          current.depositFacilityPercent,
          before.depositFacilityPercent,
        ),
        mainRefinancingBasisPoints: deltaBp(
          current.mainRefinancingPercent,
          before.mainRefinancingPercent,
        ),
        marginalLendingBasisPoints: deltaBp(
          current.marginalLendingPercent,
          before.marginalLendingPercent,
        ),
      }
    }
  }
}

/* -------------------------------------------------------- regime detection */

export interface LevelObservation {
  /** ISO date, `YYYY-MM-DD`, as the source published it. */
  date: string
  level: PolicyLevel
}

export interface PolicyRegime {
  /** The level in force at the latest observation. */
  level: PolicyLevel
  /** When the source last confirmed it. NOT when it became effective. */
  observationDate: string
  /**
   * First observation date carrying the current level.
   *
   * `null` when no transition exists inside the supplied history — the honest
   * answer, since the alternative is reporting the edge of our lookback window
   * as though it were a policy action.
   */
  effectiveDate: string | null
  previousLevel: PolicyLevel | null
  change: PolicyLevelChange | null
  /**
   * Observations are missing immediately before `effectiveDate`, so the
   * transition may have happened earlier than the date we can see. The date is
   * an upper bound, not a fact.
   */
  effectiveDateBounded: boolean
  /** No transition was found; the regime began before the history we hold. */
  effectiveDateOutsideLookback: boolean
  /** The latest observation merely repeats a standing level. */
  isCarryForward: boolean
  /** The latest observation is itself the first one at this level. */
  stateChangedOnObservation: boolean
}

const DAY_MS = 86_400_000

function daysBetween(earlier: string, later: string): number {
  return Math.round((Date.parse(later) - Date.parse(earlier)) / DAY_MS)
}

/**
 * Finds where the current policy regime began.
 *
 * Walks backwards from the newest observation while the level is unchanged.
 * The first differing observation ends the search: the one after it is the
 * regime start, and the differing one is the previous level.
 *
 * `maxExpectedGapDays` is how far apart two consecutive observations may be
 * before the series is considered to have a hole. It is source-specific — the
 * ECB publishes every calendar day, the Riksbank and the New York Fed only on
 * business days — and it exists so a transition seen across a gap is reported
 * as bounded rather than as a precise date we cannot support.
 */
export function detectRegime(
  observations: readonly LevelObservation[],
  maxExpectedGapDays: number,
): PolicyRegime {
  if (observations.length === 0) {
    throw new Error('detectRegime requires at least one observation')
  }
  const sorted = [...observations].sort((a, b) => a.date.localeCompare(b.date))
  const latest = sorted[sorted.length - 1]!
  const level = latest.level

  let startIndex = sorted.length - 1
  while (startIndex > 0 && levelsEqual(sorted[startIndex - 1]!.level, level)) {
    startIndex -= 1
  }

  const regimeStart = sorted[startIndex]!
  const foundTransition = startIndex > 0
  const previous = foundTransition ? sorted[startIndex - 1]! : null

  const bounded =
    previous !== null && daysBetween(previous.date, regimeStart.date) > maxExpectedGapDays

  return {
    level,
    observationDate: latest.date,
    effectiveDate: foundTransition ? regimeStart.date : null,
    previousLevel: previous?.level ?? null,
    // No previous level means no change to report. Never a fabricated zero.
    change: previous ? changeBetween(previous.level, level) : null,
    effectiveDateBounded: bounded,
    effectiveDateOutsideLookback: !foundTransition,
    isCarryForward: latest.date !== regimeStart.date,
    stateChangedOnObservation: foundTransition && latest.date === regimeStart.date,
  }
}
