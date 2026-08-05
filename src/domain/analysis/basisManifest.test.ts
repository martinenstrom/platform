/**
 * The witness notices what it claims to notice, and nothing it does not.
 *
 * Two halves, and both are load-bearing. A semantically identical basis
 * assembled in a different order must produce the *same* digest — otherwise
 * every benign replay becomes a false corruption report. And every material
 * change must produce a *different* one, field by field, because a digest that
 * quietly missed a field would look like protection and be none.
 */

import { describe, expect, it } from 'vitest'
import {
  BASIS_CANONICALIZATION_VERSION,
  buildBasisManifest,
  canonicalBasisInput,
  isSha256Digest,
  verifyBasisManifest,
  type BasisContent,
} from './basisManifest'
import { eligibilityBasis } from './decisionFixtures'
import { sha256Hex } from '../shared/sha256'

const SUBJECT = { submissionId: 'sub-1', caseId: 'case-1' }

const content = (over: Parameters<typeof eligibilityBasis>[0] = {}): BasisContent => {
  const { manifest: _ignored, ...rest } = eligibilityBasis(over)
  return rest
}

const digestOf = (over: Parameters<typeof eligibilityBasis>[0] = {}, subject = SUBJECT) =>
  buildBasisManifest(subject, content(over)).digest

describe('the digest is a well-formed SHA-256 attestation', () => {
  it('is 64 lowercase hex characters', () => {
    expect(isSha256Digest(digestOf())).toBe(true)
  })

  it('records its algorithm and canonicalisation version', () => {
    const manifest = buildBasisManifest(SUBJECT, content())
    expect(manifest.algorithm).toBe('sha256')
    expect(manifest.canonicalizationVersion).toBe(BASIS_CANONICALIZATION_VERSION)
  })

  it('is domain-separated from the bare rendering', () => {
    /*
     * Hashing the canonical rendering on its own must NOT reproduce the
     * manifest digest. Without separation, anything that happened to produce
     * those bytes could be presented as an eligibility attestation.
     */
    const rendering = canonicalBasisInput(SUBJECT, content())
    expect(sha256Hex(rendering)).not.toBe(digestOf())
    expect(rendering).not.toContain('financial-os')
  })

  it('is stable across calls', () => {
    expect(digestOf()).toBe(digestOf())
  })
})

describe('order does not change meaning', () => {
  const reordered = (change: (basis: BasisContent) => BasisContent) => {
    const forwards = content()
    return {
      forwards: buildBasisManifest(SUBJECT, forwards).digest,
      backwards: buildBasisManifest(SUBJECT, change(forwards)).digest,
    }
  }

  it('is unchanged when required work is listed in the other order', () => {
    const { forwards, backwards } = reordered((basis) => ({
      ...basis,
      requiredWork: [...basis.requiredWork].reverse(),
    }))
    expect(backwards).toBe(forwards)
  })

  it('is unchanged when evidence sets are listed in the other order', () => {
    const { forwards, backwards } = reordered((basis) => ({
      ...basis,
      evidenceSetIds: [...basis.evidenceSetIds].reverse(),
    }))
    expect(backwards).toBe(forwards)
  })

  it('is unchanged when open challenges are listed in the other order', () => {
    const { forwards, backwards } = reordered((basis) => ({
      ...basis,
      devilsAdvocate: {
        ...basis.devilsAdvocate!,
        openChallengeIds: [...basis.devilsAdvocate!.openChallengeIds].reverse(),
      },
    }))
    expect(backwards).toBe(forwards)
  })
})

describe('every material change moves the digest', () => {
  const baseline = digestOf()
  const base = content()

  const changes: Array<[string, BasisContent]> = [
    [
      'a required-work row deleted',
      { ...base, requiredWork: base.requiredWork.slice(1) },
    ],
    [
      'a required-work row added',
      {
        ...base,
        requiredWork: [
          ...base.requiredWork,
          { playbookEntryKey: 'extra', runId: 'run-extra' },
        ],
      },
    ],
    [
      'a required-work run swapped for another',
      {
        ...base,
        requiredWork: base.requiredWork.map((work, index) =>
          index === 0 ? { ...work, runId: 'run-substituted' } : work,
        ),
      },
    ],
    [
      'an evidence set removed',
      { ...base, evidenceSetIds: base.evidenceSetIds.slice(1) },
    ],
    ['a disagreement removed', { ...base, materialDisagreements: [] }],
    [
      "a disagreement's materiality changed",
      {
        ...base,
        materialDisagreements: base.materialDisagreements.map((entry) => ({
          ...entry,
          materiality: 'non-material' as const,
        })),
      },
    ],
    [
      'the verification review id changed',
      { ...base, verification: { ...base.verification!, reviewId: 'review-elsewhere' } },
    ],
    [
      'the verification status changed',
      {
        ...base,
        verification: {
          ...base.verification!,
          status: 'verified-with-qualifications' as const,
        },
      },
    ],
    [
      'an open challenge removed',
      { ...base, devilsAdvocate: { ...base.devilsAdvocate!, openChallengeIds: [] } },
    ],
    ['the Risk requirement changed', { ...base, riskRequirement: 'not-required' }],
    ['the policy version changed', { ...base, eligibilityPolicyVersion: '2' }],
    ['the revision changed', { ...base, revisionId: 'rev-elsewhere' }],
    ['the aggregation changed', { ...base, aggregationId: 'agg-elsewhere' }],
    ['evaluatedAt changed', { ...base, evaluatedAt: '2020-01-01T00:00:00.000Z' }],
    [
      'the storage provenance changed',
      { ...base, storageProvenanceId: 'prov-elsewhere' },
    ],
  ]

  for (const [name, changed] of changes) {
    it(`changes when ${name}`, () => {
      expect(buildBasisManifest(SUBJECT, changed).digest).not.toBe(baseline)
    })
  }

  it('changes when the case changes', () => {
    expect(digestOf({}, { ...SUBJECT, caseId: 'case-elsewhere' })).not.toBe(baseline)
  })

  it('changes when the submission changes', () => {
    expect(digestOf({}, { ...SUBJECT, submissionId: 'sub-elsewhere' })).not.toBe(baseline)
  })

  it('gives each of them a distinct digest', () => {
    /*
     * Not merely "different from the baseline": no two alterations may collide,
     * or one form of corruption would be readable as another.
     */
    const digests = changes.map(
      ([, changed]) => buildBasisManifest(SUBJECT, changed).digest,
    )
    expect(new Set(digests).size).toBe(digests.length)
  })
})

describe('verification', () => {
  it('accepts a manifest that describes its own basis', () => {
    expect(
      verifyBasisManifest(SUBJECT, content(), buildBasisManifest(SUBJECT, content())),
    ).toBeNull()
  })

  it('rejects a digest computed for a different basis', () => {
    const foreign = buildBasisManifest(SUBJECT, { ...content(), requiredWork: [] })
    expect(verifyBasisManifest(SUBJECT, content(), foreign)).toBe(
      'manifest-digest-mismatch',
    )
  })

  it('rejects a malformed digest rather than comparing it', () => {
    const manifest = {
      ...buildBasisManifest(SUBJECT, content()),
      digest: 'nope' as never,
    }
    expect(verifyBasisManifest(SUBJECT, content(), manifest)).toBe(
      'manifest-digest-malformed',
    )
  })

  it('rejects an algorithm this build does not implement', () => {
    const manifest = {
      ...buildBasisManifest(SUBJECT, content()),
      algorithm: 'md5' as never,
    }
    expect(verifyBasisManifest(SUBJECT, content(), manifest)).toBe(
      'manifest-algorithm-unsupported',
    )
  })

  it('refuses an unknown canonicalisation version rather than recomputing under this one', () => {
    /*
     * A future shape must not be re-rendered under today's rules and then
     * reported as corrupt. The row is not wrong; this build is old, and saying
     * so is the difference between a useful error and a misleading one.
     */
    const manifest = {
      ...buildBasisManifest(SUBJECT, content()),
      canonicalizationVersion: 99 as never,
    }
    expect(verifyBasisManifest(SUBJECT, content(), manifest)).toBe(
      'manifest-canonicalization-unsupported',
    )
  })

  it('carries no basis content in its reason', () => {
    // The reason is a bounded code, so a log line never reproduces a rationale
    // or an evidence reference.
    const foreign = buildBasisManifest(SUBJECT, { ...content(), requiredWork: [] })
    const reason = verifyBasisManifest(SUBJECT, content(), foreign)
    expect(reason).toMatch(/^manifest-[a-z-]+$/)
  })
})
