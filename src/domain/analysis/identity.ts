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
 * ## Two generations of the key, permanently
 *
 * The paragraph above describes what **v2** does. Under **v1** it held only by
 * accident, for the one adapter whose publication time was derived from its
 * reference date — because v1 put `observedAt` in the key, so a revised release
 * published a day later minted a *different* id and read as an unrelated
 * observation. Measured, with the Treasury revising a Friday figure the
 * following Monday: same reference period, different id, `isRevisionOf` false.
 *
 * v2 therefore **replaces `observedAt` in the key with `referencePeriod`** —
 * what the observation describes, rather than when it was published — and adds
 * the domain tag `docs/canonical-value-v1.md` §9 requires and v1 lacked.
 *
 * **v1 references remain valid historical institutional records.** They stay
 * resolvable, stay citable, and report themselves as v1. Nothing rewrites one:
 * an id whose meaning changed without its generation changing is the exact
 * ambiguity versioning exists to prevent. See `phase-c3-evidence-gate.md` §0.1
 * and the §0.6 amendment.
 *
 * **`correlationId` is deliberately not part of identity.** It identifies a
 * resolution run — the same observation fetched twice has two correlation ids
 * and is one observation. It belongs on the `EvidenceSet`.
 *
 * **`observedAt` is not part of the v2 identity either, and for a related
 * reason.** It says when a source published, which is provenance; the key says
 * what was described. Both are kept on the reference, and only one is hashed.
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

/**
 * Which generation of the key rule minted a reference.
 *
 * Carried on the reference rather than inferred from its shape. Inference would
 * have to read `referencePeriod`, and a record whose generation is guessed from
 * a field is a record that verifies against the wrong rule the first time the
 * guess is wrong.
 */
export type ObservationKeyGeneration = 1 | 2

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
   * A curve slope the firm computed from two yield observations.
   *
   * Its own kind rather than borrowing `yield`, because it is not one: a 2s10s
   * spread has no `yieldPercent`, and forcing it into the yield projection
   * would mean inventing a field to satisfy a shape. The projection below
   * covers its inputs, so a derived fact whose inputs changed cannot keep the
   * same content hash.
   */
  | 'derived-spread'
  /**
   * Market-implied inflation compensation — a nominal yield minus the real
   * yield at the same tenor and reference date.
   *
   * **Separate from `derived-spread` for the same reason `derived-spread` is
   * separate from `yield`.** A breakeven is not a slope: `slopeBasisPoints`
   * would be the wrong name for it, and renaming that field to something
   * neutral is not available — it sits inside the content hash of every 2s10s
   * observation already stored, so changing it would restate history rather
   * than extend it.
   *
   * **It is a price, not a forecast.** What it measures is what the market
   * charges to hold a nominal Treasury rather than an inflation-linked one,
   * which bundles expected inflation with an inflation-risk premium and with
   * the relative liquidity of the two securities. Nothing in this kind, its
   * subject or its projection may call it "expected inflation".
   */
  | 'derived-breakeven'
  /**
   * The settled closing price of a listed security for one trading session.
   *
   * **Not a `quote`.** A quote is what a security is worth at an instant and it
   * moves between two reads of the same second; a close is a final fact about a
   * named day, which is what makes it citable. A desk that cited a quote would
   * be citing something that no longer exists.
   *
   * **Named for what it holds, not for what a price series usually holds.** It
   * is a close, not a bar: the governed source projects a closing value per
   * session and nothing else, so `open`, `high`, `low` and `volume` are absent
   * rather than present-and-null. A desk cannot cite a session range from this,
   * which is correct — the firm does not hold one. Admitting those fields is a
   * later decision requiring a source that actually publishes them.
   *
   * The reference period is the SESSION DATE, so one close per security per
   * trading day has one identity, and a venue restating a session — a corrected
   * close, a late print — revises that observation rather than adding a second.
   *
   * The subject is a `SecurityId`, never a ticker: identity has to survive the
   * symbol changing.
   */
  | 'price-close'

/**
 * The parts that make an observation the observation it is, plus the one part
 * that used to and no longer does.
 *
 * Shared by both generations, because a v1 record still has to be describable.
 * Which fields are HASHED differs per generation and is decided by
 * `serializeKeyV1` / `serializeKeyV2` — never by what a caller happens to set.
 */
export interface ObservationNaturalKey {
  subjectKind: SubjectKind
  subject: string
  kind: ObservationKind
  /**
   * When the SOURCE published, never our retrieval time.
   *
   * **v1: part of the key. v2: provenance only.** Kept on every reference in
   * both generations — a reader needs to know when a figure was published, and
   * co-temporality is computed from it — but under v2 it is not hashed, which
   * is what lets a revised release of the same period keep the same id.
   */
  observedAt: string
  /** Provider id, e.g. `treasury`, `ecb`, `avanza`. */
  sourceId: string
  /** The provider's own series identifier, where one exists. */
  seriesId?: string
  /** e.g. `par-yield`, `zero-coupon-fitted`. Two methodologies, two things. */
  methodology?: string
  /**
   * The period the observation DESCRIBES, as the source states it —
   * `2026-08-14` for a daily figure, `2026-Q2` for a quarterly one.
   *
   * **Required under v2, absent under v1.** It is the v2 key's only temporal
   * coordinate, so an observation without one would collapse a whole series
   * into a single identity.
   *
   * Where publication and reference genuinely coincide — an intraday quote —
   * the builder sets this to the instant and thereby states that they coincide.
   * That is a claim the builder is making, not a default it is falling back to.
   *
   * Every producer already held the right field before this existed:
   * `GovernmentYield.observationDate`, `PolicyRegime.effectiveDate`,
   * `YieldCurve.observationDate`.
   */
  referencePeriod?: string
}

export interface ObservationRef extends ObservationNaturalKey {
  /** Which key rule minted this. Read by verification; never guessed. */
  keyGeneration: ObservationKeyGeneration
  /** Hash of the natural key. Stable across re-retrieval, forever. */
  id: string
  /** Hash of the normalized value. Differs iff the observation was revised. */
  contentHash: string
}

/**
 * The v1 key encoding: a bare `|`-joined string, with no domain tag.
 *
 * **Frozen. Never edited again.** Its only job is to reproduce the ids of
 * observations the firm already holds, so a v1 citation still resolves and a
 * stored v1 row still verifies. Changing it would not migrate history — it
 * would make history unreadable.
 *
 * Its two defects are the reason v2 exists: no domain tag (against
 * `docs/canonical-value-v1.md` §9), and `observedAt` where the reference period
 * belonged.
 */
function serializeKeyV1(key: ObservationNaturalKey): string {
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

/** Domain tag for the v2 observation key, per `docs/canonical-value-v1.md` §9. */
const OBSERVATION_KEY_DOMAIN_V2 = 'financial-os:observation-key:v2'

/**
 * The v2 key encoding: canonical, domain-tagged, length-prefixed.
 *
 * `observedAt` is deliberately absent. `referencePeriod` is deliberately
 * present and mandatory — see the module header.
 *
 * Optional fields are **omitted when absent** rather than written as empty
 * strings. The canonical encoder length-prefixes every member, so an omitted
 * field and a field holding `''` stay distinguishable — which the v1 `|`-join
 * could not manage, and which is what makes an optional coordinate safe at all.
 */
function serializeKeyV2(
  key: ObservationNaturalKey & { referencePeriod: string },
): string {
  return canonicalIdentityInput(OBSERVATION_KEY_DOMAIN_V2, {
    subjectKind: key.subjectKind,
    subject: key.subject,
    kind: key.kind,
    sourceId: key.sourceId,
    referencePeriod: key.referencePeriod,
    ...(key.seriesId === undefined ? {} : { seriesId: key.seriesId }),
    ...(key.methodology === undefined ? {} : { methodology: key.methodology }),
  })
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
  if (key.referencePeriod === undefined) {
    throw new Error(
      `observationRef: a v2 observation must state the period it describes. ` +
        `"${key.subject}" (${key.kind}, ${key.sourceId}) states none, and the v2 ` +
        `key has no other temporal coordinate — every observation of this ` +
        `series would collapse into one identity. Where publication and ` +
        `reference coincide, say so by passing the instant.`,
    )
  }
  const withPeriod = { ...key, referencePeriod: key.referencePeriod }
  return Object.freeze({
    ...key,
    keyGeneration: 2 as const,
    id: stableHashHex(serializeKeyV2(withPeriod)),
    contentHash: stableHashHex(canonicalIdentityInput(OBSERVATION_CONTENT_DOMAIN, value)),
  })
}

/**
 * Mints a **v1** reference, for observations the firm already holds.
 *
 * Not deprecated and not a fallback. It is how a stored v1 row is rehydrated so
 * `verifyObservationRef` can check it against the rule it was actually minted
 * under. New observations are v2; historical ones stay v1 forever, and both
 * must verify.
 *
 * **Refuses a key carrying `referencePeriod`.** v1 has no such coordinate, so
 * accepting one would silently drop it and return an id that does not describe
 * the key it was handed — a wrong identity produced quietly, which is worse
 * than a refusal. A caller holding a reference period wants `observationRef`.
 */
export function observationRefV1(
  key: ObservationNaturalKey,
  value: CanonicalValue,
): ObservationRef {
  if (key.referencePeriod !== undefined) {
    throw new Error(
      `observationRefV1: the v1 key has no reference period, so ` +
        `"${key.referencePeriod}" would be dropped from the id without trace. ` +
        `An observation that states the period it describes is a v2 observation.`,
    )
  }
  return Object.freeze({
    ...key,
    keyGeneration: 1 as const,
    id: stableHashHex(serializeKeyV1(key)),
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
  /*
   * `inputs` is INSIDE the projection deliberately. A derived value whose
   * inputs could change without its content hash changing would be a fact
   * nobody could re-derive, and `resolveCitation` would report it as unrevised
   * while it rested on different numbers.
   */
  'derived-spread': ['slopeBasisPoints', 'observationDate', 'inputs'],
  /* Same discipline, its own honest field name. See `derived-breakeven`. */
  'derived-breakeven': ['breakevenBasisPoints', 'observationDate', 'inputs'],
  /*
   * Both fields, because both are the fact. The session date is inside the
   * projection rather than only in the key so a restated close for a named day
   * cannot keep its content hash — the same discipline `yield` applies with
   * `observationDate`.
   */
  'price-close': ['close', 'sessionDate'],
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
  /*
   * Recomputed under the reference's OWN generation, never under the current
   * one. A v1 row checked against the v2 rule would fail every time and read as
   * tampering; a v2 row checked against v1 would ignore its reference period
   * and hash a coordinate v2 deliberately dropped. The generation is a property
   * of the record, so it is what the check reads.
   */
  const base = {
    subjectKind: ref.subjectKind,
    subject: ref.subject,
    kind: ref.kind,
    observedAt: ref.observedAt,
    sourceId: ref.sourceId,
    ...(ref.seriesId === undefined ? {} : { seriesId: ref.seriesId }),
    ...(ref.methodology === undefined ? {} : { methodology: ref.methodology }),
  }
  /*
   * A v2 reference with no reference period cannot be reconstructed at all: the
   * key it claims to hash does not exist. Reported as an id mismatch rather
   * than thrown, because verification's whole contract is to return a code.
   */
  if (ref.keyGeneration === 2 && ref.referencePeriod === undefined) {
    return 'observation-id-mismatch'
  }
  const recomputedId = stableHashHex(
    ref.keyGeneration === 1
      ? serializeKeyV1(base)
      : serializeKeyV2({ ...base, referencePeriod: ref.referencePeriod! }),
  )
  if (recomputedId !== ref.id) return 'observation-id-mismatch'

  const content = observationContent(ref.kind, value)
  if (isMismatch(content)) return content

  const recomputedHash = stableHashHex(
    canonicalIdentityInput(OBSERVATION_CONTENT_DOMAIN, content),
  )
  return recomputedHash === ref.contentHash ? null : 'observation-content-hash-mismatch'
}

/**
 * True when both refs describe the same observation, revised or not.
 *
 * **Never true across generations.** A v1 and a v2 reference to what a reader
 * would call the same figure have different ids, because they were minted under
 * different rules — and saying they are the same observation would claim the
 * firm had identified it twice under one identity, which is precisely what it
 * did not do. Two generations, two records, both honest about which they are.
 */
export function sameObservation(a: ObservationRef, b: ObservationRef): boolean {
  return a.id === b.id
}

/**
 * True when the same observation now says something different.
 *
 * The Fact Checker's revision detector: same identity, different content.
 *
 * **This works under v2 and effectively did not under v1.** A revised release
 * carries a later `observedAt`, which v1 hashed into the key — so the revision
 * minted a fresh id and read as an unrelated observation, and the number could
 * move under a claim without anything noticing. v2 keys on the reference period
 * instead, so a revision is exactly what this function has always described.
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
