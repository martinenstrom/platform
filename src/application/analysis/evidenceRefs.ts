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
  PolicyLevel,
  PolicyLevelChange,
  RiksbankPolicyState,
} from '~/domain/policy'
import type { Provenance } from '~/domain/shared/provenance'
import { observationRef, type EvidenceItem, type ObservationRef } from '~/domain/analysis'
import {
  asCanonicalValue,
  canonicalDecimalFromNumber,
  canonicalDecimalOrNull,
  type CanonicalValue,
} from '~/domain/shared/canonicalValue'

/* ------------------------------------------------------- the decimal boundary */

/**
 * Where market and policy decimals become canonical strings.
 *
 * This module is the one sanctioned place that imports all three domains, which
 * makes it the right boundary for the conversion — and the conversion happens
 * exactly once, through `canonicalDecimalFromNumber`. No caller below reaches
 * for `String(value)` or `toFixed`: a dozen ad-hoc conversions is a dozen
 * chances to disagree about a value nobody reads directly.
 *
 * **Why these cannot stay numbers.** A content hash decides whether an
 * observation was *revised*. Under the old canonicalization a `NaN` yield, an
 * infinite one and a missing one all hashed as `null`, so a value appearing or
 * disappearing read as unchanged. The canonical value model refuses all three —
 * which means a fractional yield must arrive as a decimal string rather than as
 * a double, since doubles cannot be refused selectively.
 *
 * The conversion loses nothing further: it emits the shortest decimal that
 * round-trips to the same double. Whatever the source published was lost
 * earlier, when its decimal became a double.
 */

/**
 * A stored payload, with every number carried as an exact decimal string.
 *
 * Applied to the whole provider object rather than field by field: a market
 * quote has a dozen numeric fields and gains more, and a conversion that has to
 * be remembered per field is one that eventually is not.
 *
 * **One consequence, stated rather than discovered.** After conversion the
 * number `2` and the string `'2'` are indistinguishable inside a payload. That
 * is acceptable here and only here: a payload records what one provider said,
 * and a provider's field has one type. It would not be acceptable in an
 * identity built from mixed domain values, which is why this projection lives
 * at the provider boundary and not inside the canonical-value model.
 */
function canonicalPayload(value: unknown): CanonicalValue {
  if (value === null) return null
  if (typeof value === 'number') return canonicalDecimalFromNumber(value)
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(canonicalPayload)
  if (typeof value === 'object') {
    const out: Record<string, CanonicalValue> = {}
    for (const [key, inner] of Object.entries(value)) {
      // `undefined` is absence; an absent field is simply not present.
      if (inner !== undefined) out[key] = canonicalPayload(inner)
    }
    return out
  }
  // Functions, symbols and BigInt reach the strict validator and are refused
  // there, with the code and path that says which field was at fault.
  return asCanonicalValue(value)
}

/** A policy level, with every rate carried as an exact decimal string. */
function canonicalPolicyLevel(level: PolicyLevel): CanonicalValue {
  switch (level.kind) {
    case 'target-range':
      return {
        kind: level.kind,
        lowerPercent: canonicalDecimalFromNumber(level.lowerPercent),
        upperPercent: canonicalDecimalFromNumber(level.upperPercent),
      }
    case 'single':
      return {
        kind: level.kind,
        ratePercent: canonicalDecimalFromNumber(level.ratePercent),
      }
    case 'key-rates':
      return {
        kind: level.kind,
        depositFacilityPercent: canonicalDecimalFromNumber(level.depositFacilityPercent),
        mainRefinancingPercent: canonicalDecimalFromNumber(level.mainRefinancingPercent),
        marginalLendingPercent: canonicalDecimalFromNumber(level.marginalLendingPercent),
      }
  }
}

/** A policy change, in basis points, likewise exact. */
function canonicalPolicyChange(change: PolicyLevelChange | null): CanonicalValue {
  if (change === null) return null
  switch (change.kind) {
    case 'target-range':
      return {
        kind: change.kind,
        lowerBasisPoints: canonicalDecimalFromNumber(change.lowerBasisPoints),
        upperBasisPoints: canonicalDecimalFromNumber(change.upperBasisPoints),
      }
    case 'single':
      return {
        kind: change.kind,
        basisPoints: canonicalDecimalFromNumber(change.basisPoints),
      }
    case 'key-rates':
      return {
        kind: change.kind,
        depositFacilityBasisPoints: canonicalDecimalFromNumber(
          change.depositFacilityBasisPoints,
        ),
        mainRefinancingBasisPoints: canonicalDecimalFromNumber(
          change.mainRefinancingBasisPoints,
        ),
        marginalLendingBasisPoints: canonicalDecimalFromNumber(
          change.marginalLendingBasisPoints,
        ),
      }
  }
}

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
      /*
       * A quote describes the instant it was taken, so publication and
       * reference genuinely coincide here. Setting them equal is the claim
       * being made — not a fallback for a field nobody had.
       *
       * `sourceDate` is preferred where the provider states one, because a
       * date-precision source published a DATE and `asOf` is our midnight-UTC
       * rendering of it. Keying on the rendering would make the identity depend
       * on how we chose to widen a date into an instant.
       */
      referencePeriod: quote.provenance.sourceDate ?? quote.provenance.asOf,
      sourceId: quote.provenance.source.providerId,
    },
    {
      value: canonicalDecimalFromNumber(quote.value),
      absoluteChange: canonicalDecimalOrNull(quote.absoluteChange),
      percentageChange: canonicalDecimalOrNull(quote.percentageChange),
      previousClose: canonicalDecimalOrNull(quote.previousClose),
    },
  )
}

export function quoteEvidence(quote: MarketQuote): EvidenceItem {
  return {
    ref: quoteRef(quote),
    value: canonicalPayload(quote),
    provenance: quote.provenance,
  }
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
      /*
       * The source's own observation date — the field `GovernmentYield` already
       * documented as *"kept separate from `provenance.receivedAt` so a revision
       * can be recognised."* It was always the right coordinate; until v2 the
       * key could not carry it.
       */
      referencePeriod: governmentYield.observationDate,
      sourceId: governmentYield.provenance.source.providerId,
      seriesId: governmentYield.seriesId,
      methodology: governmentYield.methodology,
    },
    {
      yieldPercent: canonicalDecimalFromNumber(governmentYield.yieldPercent),
      changeBasisPoints: canonicalDecimalOrNull(governmentYield.changeBasisPoints),
      observationDate: governmentYield.observationDate,
    },
  )
}

export function yieldEvidence(governmentYield: GovernmentYield): EvidenceItem {
  return {
    ref: yieldRef(governmentYield),
    value: canonicalPayload(governmentYield),
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
      /* The one observation date `buildYieldCurve` proved every point shares. */
      referencePeriod: curve.observationDate,
      sourceId: provenance.source.providerId,
      methodology: curve.methodology,
    },
    {
      points: curve.points.map((p) => [
        p.maturity,
        canonicalDecimalFromNumber(p.yieldPercent),
      ]),
    },
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
  // Read once: it was called twice, and the second call is what a later
  // refactor turns into a different value from the one the guard tested.
  const effectiveRate = effectiveRateOf(state)
  /*
   * A regime whose transition is not inside the history we hold has NO known
   * reference period, and it is refused rather than given one.
   *
   * The tempting fallback is `observationDate`. It is exactly wrong, and wrong
   * in the worst case: `unknown` means the level has stood unchanged for longer
   * than the lookback, so keying on the confirmation date would mint a fresh
   * observation identity every calendar day for the most stable rate the firm
   * holds — the v1 pathology, reinstated silently.
   *
   * `effectiveDateEarliestPossible` is not a substitute either. It is `null`
   * whenever confidence is not `bounded`, and it is a lower bound rather than a
   * date, so hashing it would key an identity on a value the source never
   * published.
   */
  if (state.regime.effectiveDate === null) {
    throw new Error(
      `policyStateRef: ${state.centralBank} reports no effective date for the ` +
        `level in force (confidence "${state.regime.effectiveDateConfidence}"), so ` +
        `the firm does not know what period this observation describes. It is ` +
        `refused rather than keyed on the confirmation date, which would mint a ` +
        `new identity every day the rate does not move.`,
    )
  }
  return observationRef(
    {
      subjectKind: 'central-bank',
      subject: state.centralBank,
      kind: 'policy-state',
      observedAt: state.provenance.asOf,
      /*
       * The date the level took effect — not the date the bank last confirmed
       * it. This is what closes the pathology Phase 6A worked around: the ECB
       * republishes a standing rate every calendar day, so under v1 the key's
       * `observedAt` minted a NEW observation identity daily for a rate that
       * had not moved in thirty-nine days, and the content hash had to exclude
       * the observation date to stop every one of them reading as a revision.
       *
       * Under v2 one policy state is one observation for as long as it stands,
       * and a genuine change is a new reference period. The content-hash
       * exclusion below is now belt-and-braces rather than load-bearing.
       */
      referencePeriod: state.regime.effectiveDate,
      sourceId: state.provenance.source.providerId,
      seriesId: state.seriesId,
      methodology: state.rateType,
    },
    {
      level: canonicalPolicyLevel(state.regime.level),
      effectiveDate: state.regime.effectiveDate,
      effectiveDateConfidence: state.regime.effectiveDateConfidence,
      change: canonicalPolicyChange(state.regime.change),
      ...(effectiveRate !== null
        ? { effectiveFedFundsRate: canonicalDecimalFromNumber(effectiveRate) }
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
  return {
    ref: policyStateRef(state),
    value: canonicalPayload(state),
    provenance: state.provenance,
  }
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

/**
 * A governed daily close, as an observation reference.
 *
 * The sanctioned bridge from a price source into observation identity, and the
 * only one: an adapter that minted its own ref could put a ticker in `subject`,
 * and the join that proves two providers describe one security would be gone.
 *
 * `subject` is the `SecurityId` — never the symbol, never the provider's
 * ticker. `sourceId` and `seriesId` still record who said it and under what
 * name, so the record shows both the institutional identity and the provider's
 * own, without either standing in for the other.
 */
export function priceCloseRef(input: {
  securityId: string
  /** The venue's session date, e.g. `2026-08-29`. The reference period. */
  sessionDate: string
  close: number
  providerSymbol: string
  provenance: Provenance
}): ObservationRef {
  return observationRef(
    {
      subjectKind: 'instrument',
      subject: input.securityId,
      kind: 'price-close',
      observedAt: input.provenance.asOf,
      /*
       * The session, not the retrieval. Re-fetching yesterday's history must
       * reproduce yesterday's identities exactly, or every ingest would mint a
       * parallel set of observations for days the firm already holds.
       */
      referencePeriod: input.sessionDate,
      sourceId: input.provenance.source.providerId,
      seriesId: input.providerSymbol,
    },
    {
      close: canonicalDecimalFromNumber(input.close),
      sessionDate: input.sessionDate,
    },
  )
}
