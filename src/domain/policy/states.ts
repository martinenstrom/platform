/**
 * Per-institution policy state.
 *
 * Three concrete types rather than one generic `CentralBankPolicyRate`,
 * because the institutions genuinely differ and a shared shape would either
 * carry fields that are meaningless for two of them or force the Fed's range
 * into a scalar. Each type can hold exactly what its source publishes and
 * nothing more — the Riksbank type has no corridor fields at all, so
 * rule-derived rates cannot be stored as observations even by mistake.
 */

import type { IsoCurrencyCode } from '~/domain/shared/primitives'
import type { Provenance } from '~/domain/shared/provenance'
import type { PolicyRatePercent } from './primitives'
import type { CentralBankId, PolicyRateType, PolicyRegime } from './levels'

/**
 * Whether the source published when we expected it to.
 *
 * Separate from `Envelope` state, which describes RETRIEVAL. This describes
 * PUBLICATION: we may hold a perfectly fresh copy of an observation the source
 * should have replaced yesterday and did not.
 */
export type PublicationStatus =
  /** The latest observation is the one we expected to see. */
  | 'current'
  /** A publication opportunity passed with no new observation. */
  | 'expected-observation-missing'
  /**
   * We cannot tell. The cadence helper was unavailable, or the source has no
   * calendar we can consult. Deliberately not optimistic: an unknown cadence
   * must never be reported as `current`, and must never invent a missed day.
   */
  | 'cadence-unknown'

interface PolicyStateBase {
  centralBank: CentralBankId
  jurisdiction: string
  currency: IsoCurrencyCode
  rateType: PolicyRateType
  /** The official series this was read from. */
  seriesId: string
  /** Level, observation date, effective date, carry-forward status, delta. */
  regime: PolicyRegime
  publication: PublicationStatus
  provenance: Provenance
}

/**
 * The Effective Federal Funds Rate.
 *
 * Where the market actually traded inside the target range — a different
 * measure entirely, published by the New York Fed in the same payload. It is
 * kept as its own observation precisely so it can never be read as, or
 * compared against, the target the FOMC set.
 */
export interface EffectiveRateObservation {
  ratePercent: PolicyRatePercent
  observationDate: string
}

export interface FederalReservePolicyState extends PolicyStateBase {
  centralBank: 'federal-reserve'
  rateType: 'target-range'
  /** Never used as the current or previous target level. */
  effectiveFedFundsRate: EffectiveRateObservation | null
}

export interface EcbPolicyState extends PolicyStateBase {
  centralBank: 'ecb'
  rateType: 'key-rates'
  /**
   * Which of the three is the stance indicator for later presentation.
   * Recorded rather than assumed, and it does not privilege the rate in the
   * domain — all three are retained independently in `regime.level`.
   */
  primaryRate: 'deposit-facility'
}

export interface RiksbankPolicyState extends PolicyStateBase {
  centralBank: 'riksbank'
  rateType: 'policy-rate'
  /*
   * No corridor fields, by design. The deposit and lending rates are defined
   * as policy ± 0.75pp rather than separately observed, and the Riksbank's own
   * forecast rate path is a projection, not an observation. Neither has a home
   * here, which is the enforcement.
   */
}

export type CentralBankPolicyState =
  FederalReservePolicyState | EcbPolicyState | RiksbankPolicyState
