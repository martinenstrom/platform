/**
 * Policy-rate primitives.
 *
 * `PolicyRatePercent` is deliberately a DIFFERENT brand from `YieldPercent`,
 * over the same runtime `number`. The two are the central distinction this
 * module exists to protect:
 *
 *   a government yield is what the bond market is charging
 *   a policy rate is what the monetary authority has decided
 *
 * They are quoted in the same unit and they are not interchangeable. Two
 * brands cost nothing at runtime and turn "don't confuse these" from a review
 * comment into a compile error, in both directions.
 */

import { InvalidValueError } from '~/domain/shared/primitives'

declare const policyRatePercentBrand: unique symbol

/**
 * An official policy rate, percent per annum: `2.25` means 2.25 %.
 *
 * May be negative — the ECB's deposit facility rate was below zero from 2014
 * to 2022, and the Riksbank's repo rate from 2015 to 2019.
 */
export type PolicyRatePercent = number & {
  readonly [policyRatePercentBrand]: true
}

export function policyRatePercent(value: number): PolicyRatePercent {
  if (!Number.isFinite(value)) {
    throw new InvalidValueError('PolicyRatePercent', value, 'must be finite')
  }
  // A generous bound that still catches a misplaced decimal or a percentage
  // supplied as a fraction of one.
  if (value < -25 || value > 100) {
    throw new InvalidValueError(
      'PolicyRatePercent',
      value,
      'must be between -25 and 100 percent',
    )
  }
  return value as PolicyRatePercent
}
