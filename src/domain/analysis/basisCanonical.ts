/**
 * Canonicalization version 1 for the eligibility-basis manifest.
 *
 * The normative specification is `docs/eligibility-basis-canonicalization-v1.md`.
 * **That document defines the meaning; this file implements it.** If they ever
 * disagree, the document is right and this is a bug — which is the point of
 * writing it down separately: an independent implementation must be able to
 * reproduce a digest without reading this code.
 *
 * ## Why not the general canonical format
 *
 * This encoder predates canonical value v1 and is deliberately kept separate
 * from it. It was written because `canonicalJson` — the mechanism it would
 * otherwise have reused — sorted object keys with `localeCompare`, whose
 * ordering depends on the host's collation. TD-61 has since replaced that
 * mechanism entirely.
 *
 * The two remain distinct formats. **This one sorts by UTF-16 code unit;
 * canonical value v1 sorts by UTF-8 byte order.** They agree except on astral
 * characters, and `canonicalFormats.test.ts` proves the divergence is
 * deliberate so a later refactor cannot unify them by accident. Merging them
 * would change every digest derived under one of the two.
 *
 * ## The encoding
 *
 * Length-prefixed and self-describing, so no separator can be forged by content
 * and no field order has to be sorted at runtime:
 *
 *   string   `s` <utf8ByteLength> `:` <utf8 bytes>
 *   null     `n`
 *   absent   `a`          — distinct from null, deliberately
 *   integer  `i` <decimal, no sign for zero, no exponent, no leading zeros>
 *   boolean  `b0` / `b1`
 *   list     `l` <count> `:` <encoded elements, concatenated>
 *
 * Fields appear in the fixed order the specification lists. Nothing is sorted
 * by key at all, so there is no comparator to disagree about. Set-like
 * collections are sorted by **UTF-16 code unit** (`<`, not `localeCompare`),
 * which is the same order `COLLATE "C"` and the in-memory comparator use.
 */

import { utf8ByteLength } from '../shared/sha256'
import type { EligibilityBasis } from './decisions'

export const BASIS_CANONICALIZATION_VERSION = 1

/**
 * Separates this attestation from every other digest in the system.
 *
 * Without it, the same bytes produced for some other purpose would hash
 * identically and could be presented as an eligibility attestation.
 *
 * The terminator is a visible `|` rather than the conventional NUL. Domain
 * separation needs an unambiguous boundary only when the tag can vary in
 * length; this one is a compile-time constant, and the version is *also* the
 * first element of the canonical form, so a cross-version collision is
 * impossible twice over. That left the NUL with no security weight and a real
 * review cost — it was written into this file as a literal control character
 * twice, invisible both times in the editor and the diff.
 *
 * If this prefix ever becomes variable, it must be length-prefixed like every
 * other string in the encoding. Do not reintroduce a bare separator.
 */
export const BASIS_DOMAIN_SEPARATION = `financial-os:eligibility-basis:v${BASIS_CANONICALIZATION_VERSION}|`

/** The basis without its own witness — what the witness is computed over. */
export type BasisContent = Omit<EligibilityBasis, 'manifest'>

export interface BasisSubject {
  submissionId: string
  caseId: string
}

/* --------------------------------------------------------- field coverage */

/**
 * Where every member of `EligibilityBasis` goes, and why.
 *
 * The specification lists these fields in prose. Prose cannot notice a field
 * added to `EligibilityBasis` next year, and a field the digest does not bind
 * is a field an editor can change without the witness objecting — silently, in
 * the direction that makes a submission look more eligible than it was.
 *
 * `src/test/basisFieldCoverage.test.ts` reads the members of `EligibilityBasis`
 * out of the type and requires each one to appear here exactly once. A new
 * field therefore fails the build until somebody decides, in writing, whether
 * the witness covers it.
 */
export const BASIS_FIELD_DISPOSITION = {
  /** Bound by the digest, in the order `canonicalBasisInput` emits them. */
  included: [
    'thesisId',
    'revisionId',
    'eligibilityPolicyVersion',
    'evaluatedAt',
    'aggregationId',
    'storageProvenanceId',
    'verification',
    'devilsAdvocate',
    'riskRequirement',
    'riskRuleId',
    'riskRuleVersion',
    'risk',
    'requiredWork',
    'materialDisagreements',
    'evidenceSetIds',
  ],
  /** Deliberately unbound. Each reason is normative, not descriptive. */
  excluded: {
    manifest:
      'The witness cannot attest itself. Binding a digest over a structure ' +
      'containing that digest has no fixed point.',
    blockers:
      'Invariant, not variable: a valid submission has none and the ' +
      'repositories refuse one that does. Encoding a field that is always ' +
      'empty would imply it could differ, and would invite a reader to treat ' +
      'its absence as evidence rather than as a rule.',
  },
} as const

/* ------------------------------------------------------------- primitives */

/**
 * The prefix counts UTF-8 bytes, and it is counted by the encoder that produces
 * them. There was a second implementation here; see `utf8ByteLength`.
 */
const str = (value: string) => `s${utf8ByteLength(value)}:${value}`
const int = (value: number) => {
  if (!Number.isInteger(value)) {
    throw new Error('canonicalization v1 encodes integers only')
  }
  return `i${value}`
}
const NUL = 'n'
const ABSENT = 'a'
const list = (values: readonly string[]) => `l${values.length}:${values.join('')}`

/** A string, or `null` — the two are distinguishable in the output. */
const strOrNull = (value: string | null) => (value === null ? NUL : str(value))

/** UTF-16 code unit order. Never `localeCompare`. */
const codeUnitOrder = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0

/* -------------------------------------------------------------- the shape */

/**
 * The exact bytes the digest is taken over, before the domain prefix.
 *
 * Field order is fixed by the specification and duplicated here in the same
 * order, so a reader can check one against the other line by line.
 */
export function canonicalBasisInput(subject: BasisSubject, basis: BasisContent): string {
  const parts: string[] = [
    // 1 — the shape itself, so a v2 rendering can never collide with a v1 one
    int(BASIS_CANONICALIZATION_VERSION),

    // 2 — identity
    str(subject.submissionId),
    str(subject.caseId),
    str(basis.thesisId),
    str(basis.revisionId),

    // 3 — the gate that applied, and when it was evaluated
    str(basis.eligibilityPolicyVersion),
    str(basis.evaluatedAt),
    strOrNull(basis.aggregationId),
    str(basis.storageProvenanceId),

    // 4 — Verification
    basis.verification === null
      ? NUL
      : list([
          str(basis.verification.reviewId),
          int(basis.verification.sequence),
          str(basis.verification.status),
        ]),

    // 5 — the Devil's Advocate, and what remained open
    basis.devilsAdvocate === null
      ? NUL
      : list([
          str(basis.devilsAdvocate.reviewId),
          int(basis.devilsAdvocate.sequence),
          int(basis.devilsAdvocate.openChallengeIds.length),
          list([...basis.devilsAdvocate.openChallengeIds].sort(codeUnitOrder).map(str)),
        ]),

    // 6 — Risk: the three-state resolution, its rule, and the review if required
    str(basis.riskRequirement),
    strOrNull(basis.riskRuleId),
    strOrNull(basis.riskRuleVersion),
    basis.risk === null
      ? NUL
      : list([
          str(basis.risk.reviewId),
          int(basis.risk.sequence),
          str(basis.risk.status),
        ]),

    // 7 — required work: the deletion this witness exists for
    int(basis.requiredWork.length),
    list(
      [...basis.requiredWork]
        .map((work) => list([str(work.playbookEntryKey), str(work.runId)]))
        .sort(codeUnitOrder),
    ),

    // 8 — disagreements known and weighed
    int(basis.materialDisagreements.length),
    list(
      [...basis.materialDisagreements]
        .map((entry) => list([str(entry.claimId), str(entry.materiality)]))
        .sort(codeUnitOrder),
    ),

    // 9 — what it rested on
    int(basis.evidenceSetIds.length),
    list([...basis.evidenceSetIds].sort(codeUnitOrder).map(str)),
  ]

  /*
   * `blockers` is deliberately absent rather than encoded as an empty list. A
   * valid submission has none — the repositories refuse to store one that does
   * — so there is nothing for the digest to distinguish, and encoding a field
   * that is always empty would imply it could vary.
   */
  void ABSENT

  return list(parts)
}
