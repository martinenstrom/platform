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

/** Two sources covering the same subject with different content. */
export interface EvidenceDisagreement {
  subjectKind: string
  subject: string
  kind: string
  /** The conflicting observations. Always two or more. */
  observationIds: readonly string[]
  sourceIds: readonly string[]
}

export type CoTemporality =
  /** Every observation shares an `observedAt`. */
  | { kind: 'co-temporal'; observedAt: string }
  /** They do not. The spread is stated so a reader can judge it. */
  | { kind: 'mixed'; earliest: string; latest: string; spreadMs: number }
  | { kind: 'empty' }

export interface EvidenceSet {
  /** Content hash of the whole set. */
  id: string
  items: readonly EvidenceItem[]
  coTemporality: CoTemporality
  disagreements: readonly EvidenceDisagreement[]
  /** When the set was assembled — not when anything was observed. */
  assembledAt: string
  /** The resolution run that produced it. Traceability, never identity. */
  correlationId: string
}

function computeCoTemporality(items: readonly EvidenceItem[]): CoTemporality {
  if (items.length === 0) return { kind: 'empty' }
  /*
   * Not an identity input -- co-temporality is derived for reading, and the set
   * id hashes membership only. The ordering is named anyway: this is an identity
   * module, and a reader should not have to work out which sorts matter.
   */
  const times = items.map((i) => i.ref.observedAt).sort(utf8ByteOrder)
  const earliest = times[0]!
  const latest = times[times.length - 1]!
  if (earliest === latest) return { kind: 'co-temporal', observedAt: earliest }
  return {
    kind: 'mixed',
    earliest,
    latest,
    spreadMs: Math.max(0, Date.parse(latest) - Date.parse(earliest)),
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
    const key = `${item.ref.subjectKind}|${item.ref.subject}|${item.ref.kind}|${item.ref.observedAt}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  const disagreements: EvidenceDisagreement[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const contents = new Set(group.map((i) => i.ref.contentHash))
    if (contents.size < 2) continue
    const first = group[0]!.ref
    disagreements.push({
      subjectKind: first.subjectKind,
      subject: first.subject,
      kind: first.kind,
      observationIds: Object.freeze(group.map((i) => i.ref.id)),
      sourceIds: Object.freeze(group.map((i) => i.ref.sourceId)),
    })
  }
  return disagreements
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
   * Every item's REFERENCE is checked against its own natural key before it can
   * join the set. An unverified item must not contribute to the id, or the set
   * would attest a membership it never checked.
   *
   * The content hash is deliberately NOT rechecked here, and cannot be: it
   * covers a curated projection of the observation -- for a quote, the value and
   * the change figures a claim would cite -- while `item.value` is the whole
   * provider payload. That asymmetry is correct and load-bearing, because
   * hashing the whole payload would make every refetch look like a revision the
   * moment `receivedAt` moved. See `docs/identity-architecture.md` section 5.
   */
  for (const item of args.items) {
    const mismatch = verifyObservationRef(item.ref)
    if (mismatch !== null) {
      throw new Error(
        `evidence item "${item.ref.id}" does not match its own natural key (${mismatch})`,
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
