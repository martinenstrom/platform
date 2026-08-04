/**
 * A witness that a stored eligibility basis is the one that was stored.
 *
 * A CIO submission keeps its basis as child rows and nothing else. Delete one
 * and the submission hydrates as a smaller but internally valid record — the
 * store cannot tell corruption from a legitimately smaller basis, and the
 * failure runs in the dangerous direction: **less work appears to have been
 * required, so the submission looks more eligible than it was.**
 *
 * The manifest closes that. It is a SHA-256 digest over a canonical rendering
 * of the exact basis, computed when the submission is built and recomputed on
 * every read. A deleted child, an added one, a swapped identity or an edited
 * review reference all change the rendering, and the digests disagree.
 *
 * ## What it does not do — twice
 *
 * **It is corruption-evident, not tamper-proof.** It catches a writer who did
 * not also recompute the witness: an accidental `DELETE`, a partial restore, a
 * broken migration, an import that did not know about the child tables. It
 * cannot survive an informed actor who edits a child row *and* rewrites the
 * digest. Nothing stored beside the data can; that needs out-of-band evidence,
 * which is TD-60. No document may call this tamper-proof, cryptographically
 * immutable, or proof against a privileged administrator.
 *
 * **It attests storage, not capture.** The digest is computed from the basis it
 * is given. If the basis was already wrong when captured — missing work the firm
 * actually required — the manifest faithfully attests the wrong thing. Whether
 * the composition was correct to capture is the command's job. This answers
 * only: *is the hydrated basis still the exact basis that was persisted?*
 */

import { sha256Hex } from '../shared/sha256'
import { canonicalJson } from './identity'
import type { EligibilityBasis } from './decisions'

/**
 * The canonical shape in force.
 *
 * Stored with every digest, so a later change to what is bound or how it is
 * ordered can never be mistaken for corruption: a row whose version this build
 * does not know is refused rather than recomputed under a different shape.
 */
export const BASIS_CANONICALIZATION_VERSION = 1

/**
 * Separates this attestation from every other use of SHA-256 in the system.
 *
 * Without it, the same bytes rendered for some other purpose would produce the
 * same digest and could be presented as an eligibility attestation. The NUL
 * terminator keeps the prefix from running into the payload — a prefix that can
 * be extended by choosing the right first byte of content is not a separator.
 */
const DOMAIN_SEPARATION = `financial-os:eligibility-basis:v${BASIS_CANONICALIZATION_VERSION}\0`

/** Lowercase 64-character hex. Branded, so an arbitrary string is not a digest. */
export type Sha256Digest = string & { readonly __brand: 'Sha256Digest' }

const DIGEST_PATTERN = /^[0-9a-f]{64}$/

export const isSha256Digest = (value: string): value is Sha256Digest =>
  DIGEST_PATTERN.test(value)

export interface EligibilityBasisManifest {
  algorithm: 'sha256'
  canonicalizationVersion: typeof BASIS_CANONICALIZATION_VERSION
  digest: Sha256Digest
}

/** The basis without its own witness — what the witness is computed over. */
export type BasisContent = Omit<EligibilityBasis, 'manifest'>

/** Everything the manifest binds that does not live on the basis itself. */
export interface BasisSubject {
  submissionId: string
  caseId: string
}

/** Byte order, matching `COLLATE "C"` and the in-memory comparator. */
const byteOrder = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0

/**
 * The exact bytes the digest is taken over.
 *
 * Structural and type-aware rather than a dump of the object: every set-like
 * collection is sorted explicitly by a stated key, so the same basis assembled
 * in a different order renders identically, and a materially different one does
 * not. Nothing here depends on insertion order, object-property order or the
 * order a database happened to return rows in.
 *
 * Counts are bound beside the collections deliberately. They are redundant
 * with the sets — a deletion changes both — and that is the point: a bug that
 * silently dropped an element while rendering would have to drop it from the
 * count too.
 */
export function canonicalBasisInput(
  subject: BasisSubject,
  basis: BasisContent,
): string {
  return canonicalJson({
    v: BASIS_CANONICALIZATION_VERSION,

    submissionId: subject.submissionId,
    caseId: subject.caseId,
    revisionId: basis.revisionId,
    thesisId: basis.thesisId,

    eligibilityPolicyVersion: basis.eligibilityPolicyVersion,
    aggregationId: basis.aggregationId,
    evaluatedAt: basis.evaluatedAt,

    /*
     * Bound, though the plan first proposed excluding it. It is a stored fact
     * about which runtime produced this projection, and an edit to it would
     * otherwise be undetectable. The manifest's job is noticing alteration of
     * stored facts, whatever they describe.
     */
    storageProvenanceId: basis.storageProvenanceId,

    verification:
      basis.verification === null
        ? null
        : {
            reviewId: basis.verification.reviewId,
            sequence: basis.verification.sequence,
            status: basis.verification.status,
          },

    devilsAdvocate:
      basis.devilsAdvocate === null
        ? null
        : {
            reviewId: basis.devilsAdvocate.reviewId,
            sequence: basis.devilsAdvocate.sequence,
            openChallengeIds: [...basis.devilsAdvocate.openChallengeIds].sort(byteOrder),
            openChallengeCount: basis.devilsAdvocate.openChallengeIds.length,
          },

    risk:
      basis.risk === null
        ? null
        : {
            reviewId: basis.risk.reviewId,
            sequence: basis.risk.sequence,
            status: basis.risk.status,
          },
    riskRequirement: basis.riskRequirement,
    riskRuleId: basis.riskRuleId,
    riskRuleVersion: basis.riskRuleVersion,

    /*
     * NUL-separated, written as an escape rather than typed literally. A plain
     * space would be ambiguous -- two ids could be split differently and render
     * identically -- and an invisible control character in source is the defect
     * the migration-character rule exists to catch.
     */
    requiredWork: [...basis.requiredWork]
      .map((work) => `${work.playbookEntryKey}\u0000${work.runId}`)
      .sort(byteOrder),
    requiredWorkCount: basis.requiredWork.length,

    materialDisagreements: [...basis.materialDisagreements]
      .map((entry) => `${entry.claimId}\u0000${entry.materiality}`)
      .sort(byteOrder),
    materialDisagreementCount: basis.materialDisagreements.length,

    evidenceSetIds: [...basis.evidenceSetIds].sort(byteOrder),
    evidenceSetCount: basis.evidenceSetIds.length,

    /*
     * `blockers` is not bound: a valid submission has none, by an invariant the
     * repositories refuse to store past. There is nothing for the digest to
     * distinguish, and binding a field that is always empty would imply it
     * could vary.
     */
  })
}

/**
 * The witness for a basis.
 *
 * One function, used by the domain builder and by both repositories, so there
 * is exactly one semantic implementation of what the digest means. A repository
 * that computed it differently would produce a witness that disagreed with the
 * domain's for the same basis, which is worse than no witness at all.
 */
export function buildBasisManifest(
  subject: BasisSubject,
  basis: BasisContent,
): EligibilityBasisManifest {
  return Object.freeze({
    algorithm: 'sha256' as const,
    canonicalizationVersion: BASIS_CANONICALIZATION_VERSION,
    digest: sha256Hex(DOMAIN_SEPARATION + canonicalBasisInput(subject, basis)) as Sha256Digest,
  })
}

/** Why a stored manifest was not accepted. Bounded; never carries basis content. */
export type ManifestMismatch =
  | 'manifest-algorithm-unsupported'
  | 'manifest-canonicalization-unsupported'
  | 'manifest-digest-malformed'
  | 'manifest-digest-mismatch'

/**
 * Whether a stored manifest still describes the basis it arrived with.
 *
 * Returns the reason rather than throwing, so the caller decides whether a
 * mismatch is a caller error (`InvariantViolationError`) or a corrupt row
 * (`MalformedRowError`) — the same distinction the reference validators draw.
 */
export function verifyBasisManifest(
  subject: BasisSubject,
  basis: BasisContent,
  manifest: EligibilityBasisManifest,
): ManifestMismatch | null {
  if (manifest.algorithm !== 'sha256') return 'manifest-algorithm-unsupported'
  if (manifest.canonicalizationVersion !== BASIS_CANONICALIZATION_VERSION) {
    return 'manifest-canonicalization-unsupported'
  }
  if (!isSha256Digest(manifest.digest)) return 'manifest-digest-malformed'

  const expected = buildBasisManifest(subject, basis)
  return expected.digest === manifest.digest ? null : 'manifest-digest-mismatch'
}
