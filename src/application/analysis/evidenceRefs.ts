/**
 * Typed bridges from the market and policy domains into evidence.
 *
 * The single sanctioned place that imports all three domains. `domain/analysis`
 * keeps `subject` as a plain string so it never has to know what a
 * `CanonicalSymbol` is; these builders take the typed values and produce the
 * refs, so the type safety is recovered exactly where the typed values exist.
 *
 * Every builder answers the same three questions for its observation type:
 * what is it about, when did the SOURCE observe it, and what did it say. The
 * third is what `contentHash` covers, and picking its inputs carefully matters
 * — include too much and every refetch looks like a revision, too little and a
 * real revision goes unnoticed.
 */

import type { GovernmentYield, MarketQuote, YieldCurve } from '~/domain/market'
import type {
  CentralBankPolicyState,
  EcbPolicyState,
  FederalReservePolicyState,
  RiksbankPolicyState,
} from '~/domain/policy'
import type { Provenance } from '~/domain/shared/provenance'
import { observationRef, type EvidenceItem, type ObservationRef } from '~/domain/analysis'

/* -------------------------------------------------------------------- quotes */

/**
 * A market quote.
 *
 * `contentHash` covers the value and both change figures — the numbers a claim
 * would actually cite. Deliberately excluded: `receivedAt` and `ageMs`, which
 * change on every fetch and would make an unchanged quote look revised.
 */
export function quoteRef(quote: MarketQuote): ObservationRef {
  return observationRef(
    {
      subjectKind: 'instrument',
      subject: quote.symbol,
      kind: 'quote',
      observedAt: quote.provenance.asOf,
      sourceId: quote.provenance.source.providerId,
    },
    {
      value: quote.value,
      absoluteChange: quote.absoluteChange,
      percentageChange: quote.percentageChange,
      previousClose: quote.previousClose,
    },
  )
}

export function quoteEvidence(quote: MarketQuote): EvidenceItem {
  return { ref: quoteRef(quote), value: quote, provenance: quote.provenance }
}

/* -------------------------------------------------------------------- yields */

/**
 * A government yield.
 *
 * `methodology` is part of the natural KEY, not just the content: a par yield
 * and a fitted zero rate for the same bond on the same day are two different
 * observations, and collapsing them into one identity is precisely the
 * confusion Phase 4B built the methodology type to prevent.
 */
export function yieldRef(governmentYield: GovernmentYield): ObservationRef {
  return observationRef(
    {
      subjectKind: 'instrument',
      subject: governmentYield.symbol,
      kind: 'yield',
      observedAt: governmentYield.provenance.asOf,
      sourceId: governmentYield.provenance.source.providerId,
      seriesId: governmentYield.seriesId,
      methodology: governmentYield.methodology,
    },
    {
      yieldPercent: governmentYield.yieldPercent,
      changeBasisPoints: governmentYield.changeBasisPoints,
      observationDate: governmentYield.observationDate,
    },
  )
}

export function yieldEvidence(governmentYield: GovernmentYield): EvidenceItem {
  return {
    ref: yieldRef(governmentYield),
    value: governmentYield,
    provenance: governmentYield.provenance,
  }
}

export function yieldCurveRef(curve: YieldCurve, provenance: Provenance): ObservationRef {
  return observationRef(
    {
      subjectKind: 'series',
      subject: `curve:${curve.countryCode}`,
      kind: 'yield-curve',
      observedAt: provenance.asOf,
      sourceId: provenance.source.providerId,
      methodology: curve.methodology,
    },
    { points: curve.points.map((p) => [p.maturity, p.yieldPercent]) },
  )
}

/* ------------------------------------------------------------- policy states */

/**
 * A central-bank policy state.
 *
 * The content covers the LEVEL and the effective date, not the observation
 * date. That is the point of Phase 6A's carry-forward work: the ECB republishes
 * the same rate every calendar day, and if the observation date were part of
 * the content every one of those days would register as a revision.
 */
export function policyStateRef(state: CentralBankPolicyState): ObservationRef {
  return observationRef(
    {
      subjectKind: 'central-bank',
      subject: state.centralBank,
      kind: 'policy-state',
      observedAt: state.provenance.asOf,
      sourceId: state.provenance.source.providerId,
      seriesId: state.seriesId,
      methodology: state.rateType,
    },
    {
      level: state.regime.level,
      effectiveDate: state.regime.effectiveDate,
      effectiveDateConfidence: state.regime.effectiveDateConfidence,
      change: state.regime.change,
      ...(effectiveRateOf(state) !== null
        ? { effectiveFedFundsRate: effectiveRateOf(state) }
        : {}),
    },
  )
}

/**
 * The Fed's effective rate, when the state is the Fed's.
 *
 * Included in the content hash because it moves independently of the target
 * range and a claim may cite it — but never as part of the key, because it is
 * a different measure from the policy decision and must not be mistaken for it.
 */
function effectiveRateOf(state: CentralBankPolicyState): number | null {
  return state.centralBank === 'federal-reserve'
    ? ((state as FederalReservePolicyState).effectiveFedFundsRate?.ratePercent ?? null)
    : null
}

export function policyStateEvidence(state: CentralBankPolicyState): EvidenceItem {
  return { ref: policyStateRef(state), value: state, provenance: state.provenance }
}

/** Narrowing helpers, so a caller can hold the concrete state type. */
export function isFedState(
  state: CentralBankPolicyState,
): state is FederalReservePolicyState {
  return state.centralBank === 'federal-reserve'
}
export function isEcbState(state: CentralBankPolicyState): state is EcbPolicyState {
  return state.centralBank === 'ecb'
}
export function isRiksbankState(
  state: CentralBankPolicyState,
): state is RiksbankPolicyState {
  return state.centralBank === 'riksbank'
}
