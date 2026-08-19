/**
 * The evidence set.
 *
 * What a department is given to reason over: normalized domain observations,
 * each carrying its provenance, assembled once and frozen. An agent never sees
 * a provider payload and never sees a UI snapshot — the first has no
 * normalized provenance, the second is shaped by whichever panels the Overview
 * happens to have.
 *
 * Three properties do the real work:
 *
 * **Immutable and content-addressed.** The set's id is a hash of its contents,
 * so "which evidence was this claim made against" has an exact answer, and a
 * cached agent result can be keyed on it.
 *
 * **Co-temporality is explicit.** Observations rarely share a timestamp. A
 * Friday equity close sitting beside a Sunday ECB carry-forward is a 48-hour
 * spread, and an agent comparing them must be told rather than left to assume.
 *
 * **Disagreement survives.** Where two sources cover the same subject and say
 * different things, the set keeps both and records the conflict. §53's rule —
 * never average disagreeing sources — depends on the disagreement reaching the
 * reasoner intact.
 */

import { stableHashHex } from '~/domain/shared/hash'
import type { Provenance } from '~/domain/shared/provenance'
import {
  evidenceRef,
  verifyObservationRef,
  type EvidenceRef,
  type ObservationRef,
} from './identity'
import {
  canonicalIdentityInput,
  utf8ByteOrder,
  type CanonicalValue,
} from '~/domain/shared/canonicalValue'

export interface EvidenceItem {
  ref: ObservationRef
  /**
   * The normalized domain value — a MarketQuote, a GovernmentYield, a state.
   *
   * A **canonical value**, not `unknown`. `evidenceSetSemanticKey` compares
   * these payloads to catch two writers disagreeing about one evidence set, so
   * this is an identity input; under `unknown` it accepted the fractional
   * doubles every market quote carries, and those cannot be canonicalized. The
   * builders in `application/analysis/evidenceRefs.ts` convert at the boundary.
   */
  value: CanonicalValue
  provenance: Provenance
}

/**
 * Two DIFFERENT sources describing the same period differently.
 *
 * Grouped on the **reference period**, never on the publication instant. That
 * distinction is the whole of C3's §0.6 amendment, and it was measured before
 * it was changed: grouping on `observedAt` found **zero** disagreements when two
 * authoritative sources published the same reference-period figure sixteen
 * hours apart — which is how macro data actually arrives. The detector was, for
 * macro evidence, near-inert.
 */
export interface EvidenceDisagreement {
  subjectKind: string
  subject: string
  kind: string
  /** What they disagree ABOUT. Absent only for pre-v2 observations. */
  referencePeriod?: string
  /** The conflicting observations. Always two or more. */
  observationIds: readonly string[]
  /** Always two or more DISTINCT sources. One source is never a disagreement. */
  sourceIds: readonly string[]
}

/**
 * One source restating the same period differently — a revised release.
 *
 * Separate from `EvidenceDisagreement` by ruling (§0.6), because overloading one
 * shape made "the ECB revised its own print" indistinguishable from "the ECB and
 * the Bundesbank disagree" — the same source listed twice, the same observation
 * id listed twice, and a reader with no way to tell which had happened.
 *
 * Under v2 these are exactly the items sharing an `ObservationRef.id` with
 * differing content: same subject, same source, same series, same methodology,
 * same reference period, published later.
 */
export interface EvidenceRevision {
  subjectKind: string
  subject: string
  kind: string
  referencePeriod?: string
  /** One source. A revision is a source correcting itself. */
  sourceId: string
  /** One observation identity, restated. */
  observationId: string
  /** Every version present, earliest publication first. */
  versions: readonly { contentHash: string; observedAt: string }[]
}

/**
 * How far apart a set's observations are, on the axis named.
 *
 * `unstated` is a real answer rather than a missing one: a v1 observation
 * declares no reference period, so the firm genuinely does not know what period
 * it described, and reporting a spread of zero would be a fabrication.
 */
export type TemporalSpread =
  | { kind: 'empty' }
  /** Every observation agrees on this coordinate. */
  | { kind: 'aligned'; at: string }
  /** They do not. The spread is stated so a reader can judge it. */
  | { kind: 'mixed'; earliest: string; latest: string; spreadMs: number }
  /** Not every observation states this coordinate. */
  | { kind: 'unstated' }

/**
 * Co-temporality on **both** axes, because for macro evidence they differ and
 * the second is the one that matters.
 *
 * A Friday equity close beside a Q2 GDP print is a six-week REFERENCE gap and
 * possibly a zero-hour publication gap. Reporting only the second would tell an
 * agent the two are contemporaneous when they describe moments six weeks apart —
 * which is precisely the comparison a desk must be warned about rather than left
 * to assume.
 */
export interface CoTemporality {
  /** Spread in publication instants — when the sources put the figures out. */
  publication: TemporalSpread
  /** Spread in reference periods — what the figures actually describe. */
  reference: TemporalSpread
}

export interface EvidenceSet {
  /** Content hash of the whole set. */
  id: string
  items: readonly EvidenceItem[]
  coTemporality: CoTemporality
  disagreements: readonly EvidenceDisagreement[]
  /** One source restating a period. Never folded into `disagreements`. */
  revisions: readonly EvidenceRevision[]
  /** When the set was assembled — not when anything was observed. */
  assembledAt: string
  /** The resolution run that produced it. Traceability, never identity. */
  correlationId: string
}

/**
 * The spread of one coordinate across a set.
 *
 * `spreadMs` is computed only where both ends parse as instants. A reference
 * period may legitimately be a quarter — `2026-Q2` — and subtracting two of
 * those yields `NaN`, so the pair is reported as mixed with a spread of zero
 * rather than as a number that means nothing. The ends are always stated, and
 * they are what a reader judges.
 */
function spreadOf(values: readonly (string | undefined)[]): TemporalSpread {
  if (values.length === 0) return { kind: 'empty' }
  if (values.some((value) => value === undefined)) return { kind: 'unstated' }

  const sorted = [...(values as string[])].sort(utf8ByteOrder)
  const earliest = sorted[0]!
  const latest = sorted[sorted.length - 1]!
  if (earliest === latest) return { kind: 'aligned', at: earliest }

  const difference = Date.parse(latest) - Date.parse(earliest)
  return {
    kind: 'mixed',
    earliest,
    latest,
    spreadMs: Number.isFinite(difference) ? Math.max(0, difference) : 0,
  }
}

/*
 * Not an identity input -- co-temporality is derived for reading, and the set
 * id hashes membership only. The ordering is named anyway: this is an identity
 * module, and a reader should not have to work out which sorts matter.
 */
function computeCoTemporality(items: readonly EvidenceItem[]): CoTemporality {
  return {
    publication: spreadOf(items.map((item) => item.ref.observedAt)),
    reference: spreadOf(items.map((item) => item.ref.referencePeriod)),
  }
}

/**
 * Finds observations of the same thing that say different things.
 *
 * Grouped on subject and kind but NOT on source: two sources agreeing is one
 * group with one content hash, two sources disagreeing is one group with two.
 * `observedAt` is excluded from the grouping deliberately — a Friday figure
 * from one source and a Friday figure from another are the same claim about
 * the world even when retrieved at different moments.
 */
function findDisagreements(items: readonly EvidenceItem[]): EvidenceDisagreement[] {
  const groups = new Map<string, EvidenceItem[]>()
  for (const item of items) {
    /*
     * Grouped on the period DESCRIBED, and deliberately not on the publication
     * instant. `sourceId` is excluded so two sources can meet in one group at
     * all — that is what a disagreement is.
     *
     * A v1 item states no reference period, so its only temporal coordinate is
     * `observedAt` and it is grouped on that. Historical sets therefore keep
     * reporting exactly what they reported, which §0.1 requires: the migration
     * does not change what the firm previously said about its own evidence.
     */
    const period = item.ref.referencePeriod ?? `observed:${item.ref.observedAt}`
    const key = `${item.ref.subjectKind}|${item.ref.subject}|${item.ref.kind}|${period}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  const disagreements: EvidenceDisagreement[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    /*
     * Two DISTINCT sources, and two distinct contents. One source restating
     * itself is a revision and is reported as one — overloading this shape to
     * carry both is what §0.6 forbids.
     */
    if (new Set(group.map((i) => i.ref.sourceId)).size < 2) continue
    if (new Set(group.map((i) => i.ref.contentHash)).size < 2) continue

    const first = group[0]!.ref
    disagreements.push({
      subjectKind: first.subjectKind,
      subject: first.subject,
      kind: first.kind,
      ...(first.referencePeriod === undefined
        ? {}
        : { referencePeriod: first.referencePeriod }),
      observationIds: Object.freeze(group.map((i) => i.ref.id)),
      sourceIds: Object.freeze(group.map((i) => i.ref.sourceId)),
    })
  }
  return disagreements
}

/**
 * Finds one source restating the same period differently.
 *
 * Grouped on the observation **id**, which under v2 already means *same
 * subject, same source, same series, same methodology, same reference period* —
 * so items sharing an id and differing in content are, by construction, a
 * revised release and nothing else.
 *
 * Under v1 this can never fire: `observedAt` was in the key, so a revision
 * published later minted a different id. That is the defect v2 exists to fix,
 * and the silence here on a historical set is accurate rather than a gap.
 */
function findRevisions(items: readonly EvidenceItem[]): EvidenceRevision[] {
  const groups = new Map<string, EvidenceItem[]>()
  for (const item of items) {
    groups.set(item.ref.id, [...(groups.get(item.ref.id) ?? []), item])
  }

  const revisions: EvidenceRevision[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    if (new Set(group.map((i) => i.ref.contentHash)).size < 2) continue

    const first = group[0]!.ref
    revisions.push({
      subjectKind: first.subjectKind,
      subject: first.subject,
      kind: first.kind,
      ...(first.referencePeriod === undefined
        ? {}
        : { referencePeriod: first.referencePeriod }),
      sourceId: first.sourceId,
      observationId: first.id,
      versions: Object.freeze(
        [...group]
          .sort((a, b) => utf8ByteOrder(a.ref.observedAt, b.ref.observedAt))
          .map((i) =>
            Object.freeze({
              contentHash: i.ref.contentHash,
              observedAt: i.ref.observedAt,
            }),
          ),
      ),
    })
  }
  return revisions
}

/** Domain tag for evidence-set identity, per `docs/canonical-value-v1.md` §9. */
const EVIDENCE_SET_DOMAIN = 'financial-os:evidence-set:v1'

export function buildEvidenceSet(args: {
  items: readonly EvidenceItem[]
  assembledAt: string
  correlationId: string
}): EvidenceSet {
  /*
   * Sorted so two sets holding the same evidence hash identically regardless of
   * the order the categories happened to resolve in — by canonical-value v1
   * ordering, not by locale. The ids are hex, so every locale agrees today; the
   * ordering is stated anyway, because an identity that depends on the host's
   * collation is not an identity.
   */
  /*
   * Every item is verified against what is stored with it before it can join
   * the set: the id against its natural key, the content hash against the
   * payload through the one authoritative projection.
   *
   * This has to happen first. An unverified item must not contribute to the set
   * id, or the set would attest a membership it never checked. Nor is a
   * partially trusted set ever returned -- one bad item refuses the whole set.
   *
   * A caller supplying a mismatching hash is refused rather than silently
   * corrected: replacing it would let a wrong hash become right by being
   * stored, which is the opposite of what a content address is for.
   */
  for (const item of args.items) {
    const mismatch = verifyObservationRef(item.ref, item.value)
    if (mismatch !== null) {
      throw new Error(
        `evidence item "${item.ref.id}" of kind "${item.ref.kind}" is not ` +
          `admissible: ${mismatch}`,
      )
    }
  }

  const items = [...args.items].sort((a, b) => utf8ByteOrder(a.ref.id, b.ref.id))
  const id = stableHashHex(
    canonicalIdentityInput(
      EVIDENCE_SET_DOMAIN,
      items.map((i) => [i.ref.id, i.ref.contentHash]),
    ),
  )

  return Object.freeze({
    id,
    items: Object.freeze(items.map((i) => Object.freeze(i))),
    coTemporality: computeCoTemporality(items),
    disagreements: Object.freeze(findDisagreements(items)),
    revisions: Object.freeze(findRevisions(items)),
    assembledAt: args.assembledAt,
    correlationId: args.correlationId,
  })
}

/* ------------------------------------------------------------- lookups */

export function findItem(set: EvidenceSet, observationId: string): EvidenceItem | null {
  return set.items.find((i) => i.ref.id === observationId) ?? null
}

/** Mints a citation into this set. Throws if the observation is not in it. */
export function citeFrom(set: EvidenceSet, ref: ObservationRef): EvidenceRef {
  if (!findItem(set, ref.id)) {
    throw new Error(
      `Observation "${ref.id}" is not in evidence set "${set.id}" — ` +
        `a citation must point at evidence the reasoner was actually given`,
    )
  }
  return evidenceRef(set.id, ref)
}

/* -------------------------------------------------------------- resolution */

export type CitationResolution =
  | { status: 'resolved'; item: EvidenceItem }
  /** The set does not contain it. A dangling citation. */
  | { status: 'unresolved'; reason: 'not-in-set' }
  /** Present, but the evidence has been revised since it was cited. */
  | { status: 'revised'; item: EvidenceItem; citedContentHash: string }
  /** The citation belongs to a different evidence set entirely. */
  | { status: 'unresolved'; reason: 'wrong-set' }

/**
 * Resolves a citation against a set.
 *
 * The Fact Checker's primitive. Every outcome other than `resolved` is a
 * finding: a dangling reference, a claim carried across evidence sets, or a
 * number that moved after someone quoted it.
 */
export function resolveCitation(set: EvidenceSet, ref: EvidenceRef): CitationResolution {
  if (ref.setId !== set.id) return { status: 'unresolved', reason: 'wrong-set' }
  const item = findItem(set, ref.observationId)
  if (!item) return { status: 'unresolved', reason: 'not-in-set' }
  if (item.ref.contentHash !== ref.contentHash) {
    return { status: 'revised', item, citedContentHash: ref.contentHash }
  }
  return { status: 'resolved', item }
}
