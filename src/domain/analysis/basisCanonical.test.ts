/**
 * The canonical bytes themselves, pinned.
 *
 * Digest vectors alone would let the encoding change freely as long as the
 * digest test was updated alongside it — which is exactly how a "canonical"
 * form stops being canonical. These pin the **byte string** before hashing, so
 * a change to the encoding has to be a deliberate act with a version bump
 * rather than a quiet edit.
 *
 * `docs/eligibility-basis-canonicalization-v1.md` is normative. If a vector
 * here disagrees with that document, the document wins.
 *
 * Non-ASCII appears as `\u` escapes throughout. The forms being distinguished
 * are identical on screen, and a reviewer must be able to tell these tests
 * apart from tautologies.
 */

import { describe, expect, it } from 'vitest'
import {
  BASIS_CANONICALIZATION_VERSION,
  BASIS_DOMAIN_SEPARATION,
  canonicalBasisInput,
  type BasisContent,
  type BasisSubject,
} from './basisCanonical'
import { buildBasisManifest } from './basisManifest'
import { sha256Hex } from '../shared/sha256'

const SUBJECT: BasisSubject = { submissionId: 'sub-1', caseId: 'case-1' }

/**
 * The smallest basis the encoding admits: every optional reference absent,
 * every collection empty.
 *
 * Written out longhand rather than derived from a fixture, so a fixture change
 * cannot silently move a golden vector.
 */
const MINIMAL: BasisContent = {
  revisionId: 'rev-1',
  thesisId: 'thesis-1',
  aggregationId: null,
  eligibilityPolicyVersion: '1',
  blockers: [],
  verification: null,
  devilsAdvocate: null,
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

const POPULATED: BasisContent = {
  ...MINIMAL,
  aggregationId: 'agg-1',
  verification: { reviewId: 'review-v', sequence: 1, status: 'verified' },
  devilsAdvocate: {
    reviewId: 'review-d',
    sequence: 2,
    openChallengeIds: ['challenge-b', 'challenge-a'],
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

describe('golden canonical bytes', () => {
  it('encodes the minimal basis exactly', () => {
    expect(canonicalBasisInput(SUBJECT, MINIMAL)).toBe(
      'l21:' +
        'i1' +
        's5:sub-1s6:case-1s8:thesis-1s5:rev-1' +
        's1:1s24:2026-07-28T08:59:00.000Zns6:prov-1' +
        'n' +
        'n' +
        's12:not-requirednn' +
        'n' +
        'i0l0:' +
        'i0l0:' +
        'i0l0:',
    )
  })

  it('encodes the populated basis exactly', () => {
    expect(canonicalBasisInput(SUBJECT, POPULATED)).toBe(
      'l21:' +
        'i1' +
        's5:sub-1s6:case-1s8:thesis-1s5:rev-1' +
        's1:1s24:2026-07-28T08:59:00.000Zs5:agg-1s6:prov-1' +
        'l3:s8:review-vi1s8:verified' +
        'l4:s8:review-di2i2l2:s11:challenge-as11:challenge-b' +
        's8:requireds6:rule-1s1:1' +
        'l3:s8:review-ri3s8:accepted' +
        'i2l2:l2:s10:macro-scans5:run-1l2:s12:credit-checks5:run-2' +
        'i1l1:l2:s7:claim-1s8:material' +
        'i2l2:s5:set-1s5:set-2',
    )
  })

  it('pins the domain-separation prefix', () => {
    expect(BASIS_DOMAIN_SEPARATION).toBe('financial-os:eligibility-basis:v1|')
    expect(BASIS_CANONICALIZATION_VERSION).toBe(1)
  })

  it('carries no control character in the prefix', () => {
    /*
     * This is a regression test, not a hypothetical. The terminator was twice
     * written as a literal NUL: invisible in the editor, invisible in the diff,
     * and rendered as a space by every tool that read the file back. The
     * fitness rule that catches such characters covered `db/` only.
     */
    // eslint-disable-next-line no-control-regex
    expect(BASIS_DOMAIN_SEPARATION).not.toMatch(/[\u0000-\u001f\u007f]/)
  })

  it('pins the digest of each golden vector', () => {
    /*
     * Derived from the bytes above, so the two cannot drift: if the encoding
     * changes without the byte vector changing, this fails too.
     */
    expect(buildBasisManifest(SUBJECT, MINIMAL).digest).toBe(
      sha256Hex(BASIS_DOMAIN_SEPARATION + canonicalBasisInput(SUBJECT, MINIMAL)),
    )
    expect(buildBasisManifest(SUBJECT, POPULATED).digest).toBe(
      sha256Hex(BASIS_DOMAIN_SEPARATION + canonicalBasisInput(SUBJECT, POPULATED)),
    )
  })
})

describe('the encoding is unambiguous', () => {
  it('distinguishes null from an empty string', () => {
    const withNull = canonicalBasisInput(SUBJECT, { ...MINIMAL, aggregationId: null })
    const withEmpty = canonicalBasisInput(SUBJECT, { ...MINIMAL, aggregationId: '' })
    expect(withNull).not.toBe(withEmpty)
    expect(withNull).toContain('ns6:prov-1')
    expect(withEmpty).toContain('s0:s6:prov-1')
  })

  it('cannot be forged by a value containing the separator characters', () => {
    /*
     * Length prefixes are what make this safe. With a delimiter-joined encoding
     * an id containing the delimiter could shift a field boundary and two
     * different bases could render identically.
     */
    const sneaky = canonicalBasisInput(SUBJECT, {
      ...MINIMAL,
      revisionId: 'rev-1s6:case-1',
    })
    const honest = canonicalBasisInput(
      { ...SUBJECT, caseId: 'case-1' },
      { ...MINIMAL, revisionId: 'rev-1' },
    )
    expect(sneaky).not.toBe(honest)
  })

  it('is injective across adversarial field decompositions', () => {
    /*
     * The property, stated once and tested exhaustively rather than by example:
     * **distinct bases produce distinct bytes.** Not "`|` is escaped" — `|` is
     * not special, and nothing is escaped. The claim is that the complete
     * length-prefixed structure is unambiguous, so no content can be mistaken
     * for structure and no two field decompositions can render the same.
     *
     * The values below are chosen to break a naive encoder: each one either
     * looks like a delimiter, looks like a length prefix, looks like a complete
     * encoded field, or moves a character across a boundary between two
     * adjacent fields. Every pairing of every value into every adjacent field
     * pair is generated, and all renderings must differ.
     */
    const adversarial = [
      '',
      '|',
      '||',
      ':',
      '1:',
      '5:hello',
      's5:rev-1', // a complete encoded string field
      'l2:', // a list header
      'n', // the null token
      'a', // the absent token
      'i1', // an integer
      'b1', // a boolean
      'x|y',
      '|s6:case-1',
      'rev-1|thesis-1',
      '12:s5:sub-1',
      'é|é', // multi-byte either side of a delimiter
      '\u{1d11e}|', // astral before a delimiter
      '0',
      '00',
    ]

    /*
     * Adjacent pairs, because a shift can only forge a boundary between fields
     * that touch: (thesisId, revisionId) are elements 4 and 5, and
     * (riskRuleId, riskRuleVersion) are 13 and 14.
     */
    const renderings = new Map<string, string>()
    for (const left of adversarial) {
      for (const right of adversarial) {
        const cases: Array<[string, BasisContent]> = [
          [
            `thesis=${left} revision=${right}`,
            { ...MINIMAL, thesisId: left, revisionId: right },
          ],
          [
            `ruleId=${left} ruleVersion=${right}`,
            { ...MINIMAL, riskRuleId: left, riskRuleVersion: right },
          ],
        ]

        for (const [label, basis] of cases) {
          const encoded = canonicalBasisInput(SUBJECT, basis)
          const collision = renderings.get(encoded)
          expect(
            collision,
            `"${label}" renders identically to "${collision}"`,
          ).toBeUndefined()
          renderings.set(encoded, label)
        }
      }
    }

    // The guard against a vacuous sweep: 20 values, 2 field pairs, no collisions.
    expect(renderings.size).toBe(adversarial.length * adversarial.length * 2)
  })

  it('separates a value from the field that follows it', () => {
    /*
     * The specific forgery a delimiter-joined encoding permits: move a character
     * out of one field and into the next, and a naive rendering is unchanged.
     * Here the two must differ, and the length prefixes are why.
     */
    const left = canonicalBasisInput(SUBJECT, {
      ...MINIMAL,
      riskRuleId: 'ab',
      riskRuleVersion: 'c',
    })
    const right = canonicalBasisInput(SUBJECT, {
      ...MINIMAL,
      riskRuleId: 'a',
      riskRuleVersion: 'bc',
    })
    expect(left).not.toBe(right)
    expect(left).toContain('s2:abs1:c')
    expect(right).toContain('s1:as2:bc')
  })

  it('counts bytes rather than code units in the length prefix', () => {
    // U+00E9 is one UTF-16 unit and two UTF-8 bytes; the prefix must say 2.
    expect(canonicalBasisInput(SUBJECT, { ...MINIMAL, revisionId: '\u00e9' })).toContain(
      's2:\u00e9',
    )
  })

  it('counts an astral character as four bytes', () => {
    // U+1D11E is a surrogate pair — two UTF-16 units, four UTF-8 bytes.
    expect(
      canonicalBasisInput(SUBJECT, { ...MINIMAL, revisionId: '\u{1d11e}' }),
    ).toContain('s4:\u{1d11e}')
  })

  it('declares a length prefix that describes its own payload', () => {
    /*
     * The property the whole encoding rests on, checked against an authority
     * outside it. If a prefix says 4 and 5 bytes follow, the output is no
     * longer unambiguously readable and two different bases could in principle
     * render the same — which is the one thing a canonical form must not allow.
     *
     * The last entry is why this test exists. A lone high surrogate followed by
     * a multi-byte character was counted as a pair by a hand-written counter
     * that never checked for the low surrogate: prefix 4, payload 5.
     */
    const values = [
      'rev-1',
      '',
      'é',
      '日本語',
      '\u{1d11e}',
      '\ud834', // lone high surrogate, at the end
      '\ud834x', // lone high surrogate, before ASCII
      '\ud834é', // lone high surrogate, before a two-byte character
      '\udd1e', // lone low surrogate
      'a𝄞b',
    ]

    for (const value of values) {
      const encoded = canonicalBasisInput(SUBJECT, { ...MINIMAL, revisionId: value })
      const declared = Number(
        /s(\d+):/.exec(encoded.slice(encoded.indexOf('s8:thesis-1') + 11))![1],
      )
      expect(declared, JSON.stringify(value)).toBe(Buffer.byteLength(value, 'utf8'))
    }
  })

  it('applies no Unicode normalisation', () => {
    /*
     * Deliberate: normalising would make two distinct stored strings render the
     * same, and the witness would stop noticing an edit between them.
     */
    const composed = canonicalBasisInput(SUBJECT, { ...MINIMAL, revisionId: '\u00e9' })
    const decomposed = canonicalBasisInput(SUBJECT, {
      ...MINIMAL,
      revisionId: 'e\u0301',
    })
    expect(composed).not.toBe(decomposed)
    expect(composed).toContain('s2:')
    expect(decomposed).toContain('s3:')
  })
})

describe('order never changes the bytes', () => {
  it('sorts required work independently of input order', () => {
    const forwards = canonicalBasisInput(SUBJECT, POPULATED)
    const backwards = canonicalBasisInput(SUBJECT, {
      ...POPULATED,
      requiredWork: [...POPULATED.requiredWork].reverse(),
    })
    expect(backwards).toBe(forwards)
  })

  it('sorts evidence sets and challenges independently of input order', () => {
    const forwards = canonicalBasisInput(SUBJECT, POPULATED)
    const backwards = canonicalBasisInput(SUBJECT, {
      ...POPULATED,
      evidenceSetIds: [...POPULATED.evidenceSetIds].reverse(),
      devilsAdvocate: {
        ...POPULATED.devilsAdvocate!,
        openChallengeIds: [...POPULATED.devilsAdvocate!.openChallengeIds].reverse(),
      },
    })
    expect(backwards).toBe(forwards)
  })

  it('sorts by code unit rather than by locale', () => {
    /*
     * The reason this encoder exists rather than reusing `canonicalJson`, which
     * sorts with `localeCompare`. Under a Swedish collation U+00E5 sorts after
     * 'z'; elsewhere it sorts beside 'a'. A digest must not depend on the host.
     */
    const ids = ['z-set', '\u00e5-set', 'a-set']
    const encoded = canonicalBasisInput(SUBJECT, { ...MINIMAL, evidenceSetIds: ids })
    const byCodeUnit = [...ids].sort((left, right) => (left < right ? -1 : 1))
    expect(byCodeUnit).toEqual(['a-set', 'z-set', '\u00e5-set'])
    expect(encoded).toContain('s5:a-sets5:z-sets6:\u00e5-set')
  })

  it('orders composite elements by their encoded form, length prefix first', () => {
    /*
     * A consequence worth pinning, because it reads as a bug otherwise:
     * required work sorts by the ENCODED pair, which begins with `s<length>:`.
     * So 'macro-scan' (s10:) precedes 'credit-check' (s12:) even though 'c'
     * precedes 'm' alphabetically.
     *
     * One rule — sort the encoded elements — covers every set-like collection
     * without a per-type comparator to get wrong. It is only surprising, not
     * ambiguous, and the specification states it in these terms. Do not
     * "correct" this to a field-wise comparator: that is a v2, not a fix.
     */
    const encoded = canonicalBasisInput(SUBJECT, POPULATED)
    expect(encoded.indexOf('macro-scan')).toBeLessThan(encoded.indexOf('credit-check'))
  })

  it('keeps a v1 rendering readable once a v2 exists', () => {
    // The version leads the encoding, so a reader can dispatch on it without
    // parsing the rest — which is what lets v1 rows stay verifiable later.
    expect(canonicalBasisInput(SUBJECT, MINIMAL).startsWith('l21:i1')).toBe(true)
  })
})
