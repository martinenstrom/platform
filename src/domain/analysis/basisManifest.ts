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
import {
  BASIS_CANONICALIZATION_VERSION,
  BASIS_DOMAIN_SEPARATION,
  canonicalBasisInput,
  type BasisContent,
  type BasisSubject,
} from './basisCanonical'

/**
 * The canonical shape in force.
 *
 * Stored with every digest, so a later change to what is bound or how it is
 * ordered can never be mistaken for corruption: a row whose version this build
 * does not know is refused rather than recomputed under a different shape.
 */
export {
  BASIS_CANONICALIZATION_VERSION,
  BASIS_DOMAIN_SEPARATION,
  canonicalBasisInput,
  type BasisContent,
  type BasisSubject,
} from './basisCanonical'

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
    digest: sha256Hex(
      BASIS_DOMAIN_SEPARATION + canonicalBasisInput(subject, basis),
    ) as Sha256Digest,
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
