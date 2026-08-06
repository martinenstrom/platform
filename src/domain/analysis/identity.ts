/**
 * Observation identity.
 *
 * An `ObservationRef` locates and verifies the exact evidence a claim rests on.
 * It has to satisfy two requirements that pull in opposite directions:
 *
 *   STABLE      re-retrieving the same observation must produce the same ref,
 *               so a claim made last week still points at something.
 *   REVISABLE   a revised observation must be distinguishable, so the Fact
 *               Checker can detect that evidence moved under a claim.
 *
 * Both are satisfied by splitting the identity in two:
 *
 *   `id`          hash of the natural key — what the observation IS
 *   `contentHash` hash of the value      — what it SAID
 *
 * Re-fetching Friday's Treasury 10Y gives an identical `id` and an identical
 * `contentHash`. If the Treasury revises that Friday figure, the `id` is
 * unchanged and the `contentHash` differs. That divergence is precisely the
 * revision signal, and nothing else in the system can produce it.
 *
 * **`correlationId` is deliberately not part of identity.** It identifies a
 * resolution run — the same observation fetched twice has two correlation ids
 * and is one observation. It belongs on the `EvidenceSet`.
 *
 * ## Why `subject` is a plain string
 *
 * Typing it as `CanonicalSymbol` would force `domain/analysis` to import
 * `domain/market`, coupling three bounded contexts that are deliberately
 * independent. The typed builders live in `application/analysis/evidenceRefs`,
 * where importing all three is legitimate. The trade is a little type safety
 * inside this module for domains that stay genuinely separate — and the
 * builders are the only sanctioned way to mint a ref, so the safety is
 * recovered at the boundary where the typed values actually exist.
 */

import { stableHashHex } from '~/domain/shared/hash'
import {
  canonicalIdentityInput,
  type CanonicalValue,
} from '~/domain/shared/canonicalValue'

/** What an observation is ABOUT, without naming another domain's types. */
export type SubjectKind =
  'instrument' | 'central-bank' | 'series' | 'index' | 'currency-pair'

/** What KIND of observation it is. */
export type ObservationKind =
  | 'quote'
  | 'yield'
  | 'yield-curve'
  | 'policy-state'
  | 'fx-rate'
  | 'series'
  | 'news'
  | 'sentiment'

/**
 * The parts that make an observation the observation it is.
 *
 * `observedAt` is the SOURCE's observation time, never our retrieval time —
 * the same distinction Phase 6A drew between an observation date and an
 * effective date, applied to identity.
 */
export interface ObservationNaturalKey {
  subjectKind: SubjectKind
  subject: string
  kind: ObservationKind
  observedAt: string
  /** Provider id, e.g. `treasury`, `ecb`, `avanza`. */
  sourceId: string
  /** The provider's own series identifier, where one exists. */
  seriesId?: string
  /** e.g. `par-yield`, `zero-coupon-fitted`. Two methodologies, two things. */
  methodology?: string
}

export interface ObservationRef extends ObservationNaturalKey {
  /** Hash of the natural key. Stable across re-retrieval, forever. */
  id: string
  /** Hash of the normalized value. Differs iff the observation was revised. */
  contentHash: string
}

/** Canonical serialization: field order is fixed so the hash is reproducible. */
function serializeKey(key: ObservationNaturalKey): string {
  return [
    key.subjectKind,
    key.subject,
    key.kind,
    key.observedAt,
    key.sourceId,
    key.seriesId ?? '',
    key.methodology ?? '',
  ].join('|')
}

/** Domain tag for observation content, per `docs/canonical-value-v1.md` §9. */
const OBSERVATION_CONTENT_DOMAIN = 'financial-os:observation-content:v1'

/**
 * The identity of an observation, and of what it said.
 *
 * `value` is a **canonical value**, not `unknown`. The narrowing is the point:
 * `contentHash` is what `isRevisionOf` compares to decide whether an
 * observation was revised, and under the previous `unknown` signature a value
 * that went from missing to `NaN` produced the same hash and read as unrevised.
 * `NaN`, the infinities, `undefined` and every `Date` all canonicalized to
 * `null`.
 *
 * The compile-time narrowing protects TypeScript callers. `canonicalValueString`
 * validates again at runtime, which is what protects parsed JSON, external
 * provider data, unsafe casts and database hydration — **the type system is not
 * a runtime trust boundary.** An invalid value throws before a hash exists,
 * rather than becoming a hash that stands for two different things.
 *
 * Fractional quantities do not arrive here as numbers. They are converted at the
 * domain boundary in `application/analysis/evidenceRefs.ts` through
 * `canonicalDecimalFromNumber`, the one approved conversion.
 */
export function observationRef(
  key: ObservationNaturalKey,
  value: CanonicalValue,
): ObservationRef {
  return Object.freeze({
    ...key,
    id: stableHashHex(serializeKey(key)),
    contentHash: stableHashHex(canonicalIdentityInput(OBSERVATION_CONTENT_DOMAIN, value)),
  })
}

/** Why a stored observation reference does not match its own natural key. */
export type ObservationRefMismatch = 'observation-id-mismatch'

/**
 * Whether a reference's id still matches the natural key stored beside it.
 *
 * The item-level half of evidence integrity, and **narrower than it first
 * appears** — worth stating precisely, because the obvious stronger claim is
 * not available.
 *
 * The id derives from the natural key, and the whole key is stored, so this
 * recomputes it and catches an observation id substituted for another.
 *
 * **The content hash is not recomputed, and cannot be from what is stored.** It
 * covers a curated projection of the observation — for a market quote, the value
 * and the change figures a claim would actually cite — while `EvidenceItem.value`
 * holds the whole provider payload. Hashing the whole payload instead would make
 * every refetch look like a revision as soon as `receivedAt` moved, which is the
 * defect the projection exists to avoid. Verifying it at hydration would require
 * the projection itself to be stored, which is a schema change.
 *
 * Returns the reason rather than throwing, so a caller decides whether a
 * mismatch is a caller error or a corrupt row.
 */
export function verifyObservationRef(ref: ObservationRef): ObservationRefMismatch | null {
  const recomputed = stableHashHex(
    serializeKey({
      subjectKind: ref.subjectKind,
      subject: ref.subject,
      kind: ref.kind,
      observedAt: ref.observedAt,
      sourceId: ref.sourceId,
      ...(ref.seriesId === undefined ? {} : { seriesId: ref.seriesId }),
      ...(ref.methodology === undefined ? {} : { methodology: ref.methodology }),
    }),
  )
  return recomputed === ref.id ? null : 'observation-id-mismatch'
}

/** True when both refs describe the same observation, revised or not. */
export function sameObservation(a: ObservationRef, b: ObservationRef): boolean {
  return a.id === b.id
}

/**
 * True when the same observation now says something different.
 *
 * The Fact Checker's revision detector: same identity, different content.
 */
export function isRevisionOf(
  candidate: ObservationRef,
  original: ObservationRef,
): boolean {
  return candidate.id === original.id && candidate.contentHash !== original.contentHash
}

/* ------------------------------------------------------------- evidence refs */

/**
 * A citation INTO a specific evidence set.
 *
 * Distinct from `ObservationRef` on purpose. An `ObservationRef` says which
 * observation in the world; an `EvidenceRef` says which observation in THIS
 * set. Only the second makes an unresolved citation detectable — a claim
 * pointing at something the set never contained.
 */
export interface EvidenceRef {
  setId: string
  observationId: string
  /** Carried so a claim can be checked against later revisions of its source. */
  contentHash: string
}

export function evidenceRef(setId: string, ref: ObservationRef): EvidenceRef {
  return Object.freeze({
    setId,
    observationId: ref.id,
    contentHash: ref.contentHash,
  })
}
