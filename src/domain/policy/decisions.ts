/**
 * Decision and meeting contracts.
 *
 * **Defined but never populated in Phase 6A.** They exist so the shape is
 * settled before anything produces them, and so the daily policy-rate
 * observation has somewhere to NOT put a statement URL or a meeting date.
 *
 * Nothing may construct a `CentralBankDecision` from the rate series. A step
 * in a daily time series tells us a level changed; it does not tell us when
 * the committee announced it, what it said, or whether the move was a cut in
 * the sense a reader means. Manufacturing decisions from steps is precisely
 * the failure the observation/effective/decision split exists to prevent —
 * see `policyDecisionsAreNotDerivable`.
 */

import type { Provenance } from '~/domain/shared/provenance'
import type { CentralBankId, PolicyLevelChange } from './levels'

export interface CentralBankDecision {
  centralBank: CentralBankId
  /** When the committee announced it. NOT the date the rate began to apply. */
  decisionDate: string
  /** When the new level took effect. Differs from `decisionDate` by days. */
  effectiveDate: string
  outcome: 'raise' | 'hold' | 'cut'
  change: PolicyLevelChange | null
  statementUrl: string | null
  publishedAt: string
  provenance: Provenance
}

export interface CentralBankMeeting {
  centralBank: CentralBankId
  scheduledDate: string
  /**
   * Whether the institution has confirmed this date, as opposed to it being
   * indicative. There is no machine-readable calendar for any of the three
   * banks in scope, so nothing populates this in Phase 6A.
   */
  isConfirmed: boolean
  kind: 'rate-decision' | 'non-policy' | 'projections'
  provenance: Provenance
}

/**
 * Documentation-as-code: the reason `CentralBankDecision` has no constructor
 * taking a `PolicyRegime`.
 *
 * A regime transition supplies the effective date and the delta. It supplies
 * neither the announcement date nor the communication, and inferring them
 * would put a fabricated timestamp on a real event.
 */
export const policyDecisionsAreNotDerivable = true as const
