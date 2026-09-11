/**
 * The specification and the encoder must agree, mechanically.
 *
 * `docs/eligibility-basis-canonicalization-v2.md` §9 prints the canonical bytes
 * of two golden vectors so an independent implementation can be checked against
 * them. That is only worth anything if the printed bytes are the bytes this
 * codebase actually produces.
 *
 * Two documents that "should" agree are two documents that will disagree. This
 * makes the digest constant and the written specification a single fact with
 * two renderings, and fails the moment one moves without the other.
 *
 * Deliberately not a duplicate of the golden-vector test. That one pins the
 * ENCODER against literals in the test file; this one pins the DOCUMENT against
 * the encoder. Changing the encoding requires touching both, which is the
 * point — a canonicalization version is a published contract, not a constant.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BASIS_CANONICALIZATION_VERSION,
  BASIS_DOMAIN_SEPARATION,
  canonicalBasisInput,
} from '~/domain/analysis/basisCanonical'
import type { BasisContent } from '~/domain/analysis/basisManifest'

const SPEC = `docs/eligibility-basis-canonicalization-v${BASIS_CANONICALIZATION_VERSION}.md`
const spec = readFileSync(SPEC, 'utf8')

const SUBJECT = { submissionId: 'sub-1', caseId: 'case-1' }

/** §9.2 — every optional reference null, every collection empty. */
const MINIMAL: BasisContent = {
  revisionId: 'rev-1',
  thesisId: 'thesis-1',
  aggregationId: null,
  eligibilityPolicyVersion: '1',
  blockers: [],
  verification: null,
  devilsAdvocate: null,
  /* Nobody examined. The empty list is the fact, and the digest binds it. */
  peerScrutiny: [],
  risk: null,
  riskRequirement: 'not-required',
  riskRuleId: null,
  riskRuleVersion: null,
  requiredWork: [],
  materialDisagreements: [],
  evidenceSetIds: [],
  storageProvenanceId: 'prov-1',
  evaluatedAt: '2026-07-28T08:59:00.000Z',
}

/** §9.3 — and the two challenges carry DIFFERENT weights, as §4.3 requires. */
const POPULATED: BasisContent = {
  ...MINIMAL,
  aggregationId: 'agg-1',
  /* §4.4 — one desk examined another, and one objection is still open. */
  peerScrutiny: [
    {
      reviewId: 'review-p',
      sequence: 1,
      byDepartmentId: 'rates',
      examinedDepartmentId: 'global-macro',
      openChallenges: [
        { challengeId: 'challenge-c', materiality: 'decision-critical' },
      ],
    },
  ],
  verification: { reviewId: 'review-v', sequence: 1, status: 'verified' },
  devilsAdvocate: {
    reviewId: 'review-d',
    sequence: 2,
    openChallenges: [
      { challengeId: 'challenge-b', materiality: 'material' },
      { challengeId: 'challenge-a', materiality: 'non-material' },
    ],
  },
  risk: { reviewId: 'review-r', sequence: 3, status: 'accepted' },
  riskRequirement: 'required',
  riskRuleId: 'rule-1',
  riskRuleVersion: '1',
  requiredWork: [
    { playbookEntryKey: 'macro-scan', runId: 'run-1' },
    { playbookEntryKey: 'credit-check', runId: 'run-2' },
  ],
  materialDisagreements: [{ claimId: 'claim-1', materiality: 'material' }],
  evidenceSetIds: ['set-2', 'set-1'],
}

/**
 * §9.2's block is one unbroken line; §9.3's is split for reading.
 *
 * The whitespace in §9.3 is presentational and the document says so, which is
 * why it is stripped here rather than encoded — a specification that could only
 * be read by a parser would be a poor specification.
 */
function fencedBlocks(): string[] {
  return [...spec.matchAll(/```\n([\s\S]*?)```/g)]
    .map((match) => match[1]!.replace(/[\s\n]/g, ''))
    /*
     * The SHAPE of a canonical input, not a literal prefix.
     *
     * This read `startsWith('l21:')`, which pinned the element count of one
     * version into a test that is supposed to survive version changes: at v3
     * the filter matched nothing, the comparison ran against an empty list,
     * and it would have gone on passing had the length assertion below not
     * been there.
     */
    .filter((block) => /^l\d+:i\d/.test(block))
}

describe(`the published specification matches the encoder`, () => {
  it('names itself after the version the code is on', () => {
    /*
     * If the constant moves and no document is written for it, this fails at
     * `readFileSync` above rather than passing quietly against a stale spec.
     */
    expect(spec).toContain(
      `# Eligibility-basis canonicalization, version ${BASIS_CANONICALIZATION_VERSION}`,
    )
  })

  it('publishes the domain separator the encoder actually uses', () => {
    expect(spec).toContain(BASIS_DOMAIN_SEPARATION)
  })

  it('prints exactly the bytes the encoder produces for both vectors', () => {
    const published = fencedBlocks()
    expect(published).toHaveLength(2)
    expect(published).toContain(canonicalBasisInput(SUBJECT, MINIMAL))
    expect(published).toContain(canonicalBasisInput(SUBJECT, POPULATED))
  })

  it('documents the element that changed, with both materialities visible', () => {
    /*
     * The populated vector must exercise the distinction the version exists
     * for. A vector where every challenge weighed the same would pin the new
     * format while proving nothing about materiality, and would still pass the
     * byte comparison above.
     */
    const populated = canonicalBasisInput(SUBJECT, POPULATED)
    expect(populated).toContain('s12:non-material')
    expect(populated).toContain('s11:challenge-as12:non-material')
    expect(populated).toContain('s11:challenge-bs8:material')
  })

  it('documents who examined whom, and binds the peer objection', () => {
    /*
     * §4.4. The vector must show both department ids and a peer challenge
     * carrying a materiality no registered policy reads — the point being that
     * the digest binds it anyway, so a later policy can be applied to bases
     * already written.
     */
    const populated = canonicalBasisInput(SUBJECT, POPULATED)
    expect(populated).toContain('s5:ratess12:global-macro')
    expect(populated).toContain('s11:challenge-cs17:decision-critical')
  })

  it('keeps the retired version preserved and marked as historical', () => {
    /*
     * §10.1: a cutover with no legacy reader is permitted only where absence of
     * legacy records was proven. The v1 document has to SAY that, or a reader
     * finds a specification that describes a format nothing verifies and no
     * indication that this is deliberate.
     */
    const v1 = readFileSync('docs/eligibility-basis-canonicalization-v1.md', 'utf8')
    expect(v1).toContain('# Eligibility-basis canonicalization, version 1')
    expect(v1).toContain('Legacy verification must remain supported')
    expect(v1).toContain('0025_challenge_materiality.sql')
    expect(v1).toContain('historical')
  })
})
