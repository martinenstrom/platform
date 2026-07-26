/**
 * Structured claims.
 *
 * A department's output is a set of claims, each carrying the evidence it
 * rests on. Prose is RENDERED from claims; claims are never extracted from
 * prose. That direction is the whole point — the legacy prototype's
 * `globalAssessment: string` lost provenance at the first agent boundary and
 * could never recover it, because a sentence has no references.
 *
 * Two invariants are enforced by construction rather than by review:
 *
 *   A claim cannot be `supported` without evidence.
 *   A causal claim cannot exist without an attribution.
 *
 * Both are illegal states, so `buildClaim` refuses them and the causal variant
 * will not typecheck.
 */

import type { BasisPoints } from '~/domain/shared/primitives'
import type { EvidenceRef } from './identity'

export type ClaimId = string

/**
 * What kind of assertion this is.
 *
 * `causal` is separated from the rest because it is the one that most often
 * goes wrong: correct numbers, invented mechanism. "The 2Y rose 12bp" and "the
 * 2Y rose BECAUSE the Fed turned hawkish" are different epistemic objects, and
 * the type system treats them that way.
 */
export type ClaimType =
  | 'observation'
  | 'comparison'
  | 'trend'
  | 'risk'
  | 'forecast'
  | 'causal'
  | 'recommendation'
  /** A structured objection to another claim. The Devil's Advocate's output. */
  | 'counterclaim'

export type ClaimStatus =
  | 'supported'
  | 'partially-supported'
  /** Contradicted by evidence also in the set. */
  | 'contested'
  | 'insufficient-evidence'

/* --------------------------------------------------------------- confidence */

export type ConfidenceLevel = 'high' | 'moderate' | 'low' | 'insufficient'

/**
 * Why a claim's confidence is what it is.
 *
 * `cappedBy` is what makes confidence explainable rather than a number someone
 * chose. If a claim is `low`, this says whether that is because the evidence
 * was stale, because a source was a fixture, or because two sources disagreed.
 */
export interface ClaimConfidence {
  level: ConfidenceLevel
  /** Human-readable reasons, in the order they were applied. */
  basis: readonly string[]
  /** The rule that limited it, when one did. */
  cappedBy?: ConfidenceCap
}

export type ConfidenceCap =
  | 'weakest-evidence'
  | 'fixture-evidence'
  | 'stale-evidence'
  | 'methodology-mismatch'
  | 'missing-provenance'
  | 'conflicting-evidence'
  | 'no-evidence'

/** Publishable at all. Fixture-backed and unprovenanced claims are not. */
export function isPublishable(confidence: ClaimConfidence): boolean {
  return (
    confidence.level !== 'insufficient' &&
    confidence.cappedBy !== 'fixture-evidence' &&
    confidence.cappedBy !== 'missing-provenance' &&
    confidence.cappedBy !== 'no-evidence'
  )
}

const ORDER: readonly ConfidenceLevel[] = ['insufficient', 'low', 'moderate', 'high']

function weaker(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  return ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b
}

/**
 * Signals about the evidence a claim rests on.
 *
 * Supplied by the caller rather than derived here, because deriving them means
 * reading provenance from `domain/shared` and quality from the market and
 * policy domains — which is exactly the coupling this module avoids. The
 * application layer computes these; this module decides what they mean.
 */
export interface EvidenceSignals {
  /** Weakest trust across the essential evidence, already mapped to a level. */
  weakestEvidence: ConfidenceLevel
  anyFixtureBacked: boolean
  anyMissingProvenance: boolean
  anyStale: boolean
  /** Comparing measures that are not comparable — e.g. two yield methodologies. */
  methodologyMismatch: boolean
  /** Sources in the set that disagree about this subject. */
  conflictingEvidence: boolean
  evidenceCount: number
}

/**
 * Composes confidence mechanically.
 *
 * Rules, applied in this order, each able only to LOWER:
 *
 *   1. no evidence                 -> insufficient
 *   2. missing provenance          -> insufficient, non-publishable
 *   3. any fixture evidence        -> insufficient, non-publishable
 *   4. methodology mismatch        -> insufficient for a comparison, else low
 *   5. weakest essential evidence  -> ceiling
 *   6. stale evidence              -> one step down
 *   7. conflicting evidence        -> one step down, never averaged away
 *
 * Note what is absent: agreement between agents raises nothing. Consensus is
 * not independent evidence, and a model that rewarded it would manufacture
 * confidence out of two agents reading the same number.
 */
export function composeConfidence(
  signals: EvidenceSignals,
  claimType: ClaimType,
): ClaimConfidence {
  const basis: string[] = []

  if (signals.evidenceCount === 0) {
    return {
      level: 'insufficient',
      basis: ['no evidence cited'],
      cappedBy: 'no-evidence',
    }
  }
  if (signals.anyMissingProvenance) {
    return {
      level: 'insufficient',
      basis: ['evidence without provenance cannot support a published claim'],
      cappedBy: 'missing-provenance',
    }
  }
  if (signals.anyFixtureBacked) {
    return {
      level: 'insufficient',
      basis: ['rests on fixture data'],
      cappedBy: 'fixture-evidence',
    }
  }
  if (signals.methodologyMismatch && claimType === 'comparison') {
    return {
      level: 'insufficient',
      basis: ['compares measures that are not comparable'],
      cappedBy: 'methodology-mismatch',
    }
  }

  let level = signals.weakestEvidence
  let cappedBy: ConfidenceCap | undefined =
    level !== 'high' ? 'weakest-evidence' : undefined
  basis.push(`bounded by the weakest evidence (${signals.weakestEvidence})`)

  if (signals.methodologyMismatch) {
    level = weaker(level, 'low')
    cappedBy = 'methodology-mismatch'
    basis.push('mixed methodologies')
  }
  if (signals.anyStale) {
    level = weaker(level, level === 'high' ? 'moderate' : 'low')
    cappedBy = 'stale-evidence'
    basis.push('some evidence is stale')
  }
  if (signals.conflictingEvidence) {
    level = weaker(level, 'low')
    cappedBy = 'conflicting-evidence'
    basis.push('sources disagree; the disagreement is retained, not averaged')
  }

  return { level, basis: Object.freeze(basis), ...(cappedBy ? { cappedBy } : {}) }
}

/* ------------------------------------------------------------------- claims */

/**
 * How a causal claim is justified.
 *
 * There is no fourth option. An agent may quote an official statement, cite an
 * external analysis, or label the causation as its own inference — but it may
 * not assert a mechanism as established fact.
 */
export type CausalAttribution =
  /** The institution said so itself. */
  | { kind: 'official-statement'; evidence: EvidenceRef }
  /** A named external analysis said so. */
  | { kind: 'external-analysis'; source: string; evidence: EvidenceRef }
  /** Our own reading. Explicitly interpretive, and must read as such. */
  | { kind: 'hedged-inference'; reasoning: string }

export interface TemporalScope {
  /** What moment the claim speaks to. */
  asOf: string
  /** e.g. '3m', '12m'. Required for forecasts and recommendations. */
  horizon?: string
}

interface ClaimBase {
  id: ClaimId
  statement: string
  evidenceRefs: readonly EvidenceRef[]
  /** Evidence that cuts against it. Kept, never quietly dropped. */
  contradictingEvidenceRefs: readonly EvidenceRef[]
  confidence: ClaimConfidence
  temporalScope: TemporalScope
  status: ClaimStatus
  /** For a counterclaim: the claim being contested. */
  contests?: ClaimId
}

/**
 * A claim.
 *
 * The causal variant carries a mandatory `attribution`, so a causal claim
 * without one is not merely discouraged — it does not typecheck.
 */
export type AgentClaim =
  | (ClaimBase & { type: Exclude<ClaimType, 'causal'> })
  | (ClaimBase & { type: 'causal'; attribution: CausalAttribution })

/** A change expressed in basis points, so bp and pp can never be confused. */
export interface BasisPointChange {
  value: BasisPoints
  unit: 'bp'
}

export function buildClaim(claim: AgentClaim): AgentClaim {
  if (claim.evidenceRefs.length === 0 && claim.status === 'supported') {
    throw new Error(
      `Claim "${claim.id}" is marked supported with no evidence. ` +
        `A claim with nothing behind it can only be insufficient-evidence.`,
    )
  }
  if (claim.status === 'contested' && claim.contradictingEvidenceRefs.length === 0) {
    throw new Error(
      `Claim "${claim.id}" is contested but cites nothing that contradicts it`,
    )
  }
  if (claim.type === 'counterclaim' && !claim.contests) {
    throw new Error(`Counterclaim "${claim.id}" does not say what it contests`)
  }
  if (
    (claim.type === 'forecast' || claim.type === 'recommendation') &&
    !claim.temporalScope.horizon
  ) {
    throw new Error(
      `A ${claim.type} needs a horizon — "${claim.id}" states none, ` +
        `which makes it unfalsifiable`,
    )
  }
  return Object.freeze({
    ...claim,
    evidenceRefs: Object.freeze([...claim.evidenceRefs]),
    contradictingEvidenceRefs: Object.freeze([...claim.contradictingEvidenceRefs]),
  })
}

/** True for claims that assert a mechanism rather than describe a state. */
export function isCausal(
  claim: AgentClaim,
): claim is ClaimBase & { type: 'causal'; attribution: CausalAttribution } {
  return claim.type === 'causal'
}

/** True when a causal claim is our own reading rather than someone's statement. */
export function isInterpretive(claim: AgentClaim): boolean {
  return isCausal(claim) && claim.attribution.kind === 'hedged-inference'
}
