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

/* ------------------------------------------------- observation projections */

/**
 * Why a stored observation reference does not describe what is stored with it.
 *
 * Bounded and machine-readable. None of these carries provider payload: an
 * error about evidence must not become a way to read evidence.
 */
export type ObservationRefMismatch =
  | 'observation-id-mismatch'
  | 'observation-content-hash-mismatch'
  | 'observation-payload-not-canonical'
  | 'kind-payload-mismatch'
  | 'missing-projected-field'
  | 'unsupported-unverifiable-kind'

/**
 * Kinds whose stored payload yields a verifiable content projection.
 *
 * Exhaustive and pinned. A kind absent from here **fails closed** — it is not
 * admitted as evidence, whatever the `ObservationKind` union says. Adding a
 * value to that union is not a decision to store it; adding a projection here
 * is.
 */
const PROJECTED_FIELDS: Partial<Record<ObservationKind, readonly string[]>> = {
  quote: ['value', 'absoluteChange', 'percentageChange', 'previousClose'],
  yield: ['yieldPercent', 'changeBasisPoints', 'observationDate'],
  // `policy-state` is nested and conditional; see `observationContent`.
  'policy-state': [],
}

/**
 * Kinds deliberately admitted without verification.
 *
 * **Empty, and that is the finding.** No observation anywhere in the repository
 * declares `fx-rate`, `series`, `news` or `sentiment`, and no caller persists a
 * `yield-curve` — `yieldCurveRef` has none at all. An allow-list is for required
 * current exceptions, not for future capability that nothing uses, so admitting
 * them would grant an exemption no code has asked for.
 *
 * Because it is empty, no unverifiable reference can enter an `EvidenceSet`, and
 * the question of how a partially verified set would represent its trust does
 * not arise. It would arise the moment an entry is added here, and that is the
 * point at which the model needs revisiting rather than now.
 */
const UNVERIFIABLE_KINDS: readonly ObservationKind[] = []

/** Whether a kind may be stored as evidence at all. */
export const isStorableObservationKind = (kind: ObservationKind): boolean =>
  kind in PROJECTED_FIELDS || UNVERIFIABLE_KINDS.includes(kind)

/**
 * The exact content a kind's hash is taken over, read out of its stored payload.
 *
 * **One projection, two callers.** The typed builders in
 * `application/analysis/evidenceRefs.ts` hash what this returns, and
 * verification recomputes it from a hydrated row. Two implementations of one
 * projection is the defect class that already produced two disagreeing UTF-8
 * byte counters here.
 *
 * Defined over the **stored canonical payload** rather than the typed domain
 * object, which is what makes it reachable at hydration: a hydrated row is JSON,
 * and `canonicalPayload` converts its numbers by exactly the rule the projection
 * uses, so selecting fields reproduces the hashed value byte for byte.
 *
 * The projection is **narrower than the payload on purpose**. A quote is stored
 * whole, including `receivedAt` and `ageMs`, and those move on every fetch —
 * hashing them would report a revision each time the data was re-read. Extra
 * fields outside the projection are therefore accepted and ignored.
 *
 * Returns a mismatch code rather than a value when the payload does not satisfy
 * the kind. A missing projected field is **invalid, not unverifiable**: the
 * allow-list is for kinds with no projection, never for malformed payloads of
 * kinds that have one.
 */
export function observationContent(
  kind: ObservationKind,
  payload: CanonicalValue,
): CanonicalValue | ObservationRefMismatch {
  if (!(kind in PROJECTED_FIELDS)) return 'unsupported-unverifiable-kind'

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'kind-payload-mismatch'
  }
  const fields = payload as { readonly [key: string]: CanonicalValue }

  if (kind === 'policy-state') {
    const regime = fields.regime
    if (
      regime === null ||
      regime === undefined ||
      typeof regime !== 'object' ||
      Array.isArray(regime)
    ) {
      return 'kind-payload-mismatch'
    }
    const state = regime as { readonly [key: string]: CanonicalValue }
    for (const field of ['level', 'effectiveDate', 'effectiveDateConfidence', 'change']) {
      if (!(field in state)) return 'missing-projected-field'
    }

    /*
     * Present only for the Federal Reserve, and content rather than key: it
     * moves independently of the target range and a claim may cite it.
     * `canonicalPayload` drops an absent optional, so it is missing here exactly
     * when it was missing at build time.
     */
    const fed = fields.effectiveFedFundsRate
    const rate =
      fed !== null && fed !== undefined && typeof fed === 'object' && !Array.isArray(fed)
        ? ((fed as { readonly [key: string]: CanonicalValue }).ratePercent ?? null)
        : null

    return {
      level: state.level!,
      effectiveDate: state.effectiveDate!,
      effectiveDateConfidence: state.effectiveDateConfidence!,
      change: state.change!,
      ...(rate !== null ? { effectiveFedFundsRate: rate } : {}),
    }
  }

  const projected = PROJECTED_FIELDS[kind]!
  const out: Record<string, CanonicalValue> = {}
  for (const field of projected) {
    if (!(field in fields)) return 'missing-projected-field'
    out[field] = fields[field]!
  }
  return out
}

/**
 * Whether a reference still describes the natural key and payload stored with it.
 *
 * Both coordinates are recomputed from what is actually persisted: the id from
 * the natural key, the content hash from the projection. Together they close the
 * gap an evidence-set id leaves open — the set id binds
 * `[observationId, contentHash]` pairs, so it catches an item added, removed or
 * substituted and a stored hash edited, but never a stored **value** edited while
 * its hash is left alone.
 */
/** A projection result that is a reason code rather than a value. */
const isMismatch = (
  result: CanonicalValue | ObservationRefMismatch,
): result is ObservationRefMismatch =>
  typeof result === 'string' && (MISMATCH_CODES as readonly string[]).includes(result)

const MISMATCH_CODES = [
  'observation-id-mismatch',
  'observation-content-hash-mismatch',
  'observation-payload-not-canonical',
  'kind-payload-mismatch',
  'missing-projected-field',
  'unsupported-unverifiable-kind',
] as const satisfies readonly ObservationRefMismatch[]

export function verifyObservationRef(
  ref: ObservationRef,
  value: CanonicalValue,
): ObservationRefMismatch | null {
  const recomputedId = stableHashHex(
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
  if (recomputedId !== ref.id) return 'observation-id-mismatch'

  const content = observationContent(ref.kind, value)
  if (isMismatch(content)) return content

  const recomputedHash = stableHashHex(
    canonicalIdentityInput(OBSERVATION_CONTENT_DOMAIN, content),
  )
  return recomputedHash === ref.contentHash ? null : 'observation-content-hash-mismatch'
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
