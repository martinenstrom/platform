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

/**
 * Canonical serialization of a value.
 *
 * Object keys are sorted, so two structurally identical values hash the same
 * regardless of construction order. Without this a revision would be reported
 * every time a provider happened to emit fields in a different sequence.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
  return `{${entries.join(',')}}`
}

export function observationRef(
  key: ObservationNaturalKey,
  value: unknown,
): ObservationRef {
  return Object.freeze({
    ...key,
    id: stableHashHex(serializeKey(key)),
    contentHash: stableHashHex(canonicalJson(value)),
  })
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
