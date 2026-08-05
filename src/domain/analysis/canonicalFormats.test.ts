/**
 * The two canonical formats differ on purpose, and must keep differing.
 *
 * Financial OS has two approved canonical formats, each specified, versioned
 * and pinned by golden vectors:
 *
 *   - **EligibilityBasis canonicalization v1** — `basisCanonical.ts`,
 *     `docs/eligibility-basis-canonicalization-v1.md`. Sorts by **UTF-16 code
 *     unit**.
 *   - **Canonical value v1** — `canonicalValue.ts`, `docs/canonical-value-v1.md`.
 *     Sorts by **UTF-8 byte order**.
 *
 * They agree everywhere except on astral characters, where a surrogate pair
 * sorts below U+E000–U+FFFF by code unit and above it by byte. That is a small
 * difference and an easy one to "clean up" — which is exactly why this file
 * exists. A refactor that unified the two comparators would silently change
 * every identity derived under one of them.
 *
 * **Neither is the sort order of this system.** There is no such thing, and no
 * document may describe one as though there were. Name the format.
 */

import { describe, expect, it } from 'vitest'
import { utf8ByteOrder } from '~/domain/shared/canonicalValue'
import { canonicalBasisInput } from './basisCanonical'
import type { BasisContent, BasisSubject } from './basisCanonical'

/** A surrogate pair (U+1D11E) and a BMP character above it in code-unit order. */
const ASTRAL = '\u{1d11e}'
const BMP_HIGH = '�'

const SUBJECT: BasisSubject = { submissionId: 'sub-1', caseId: 'case-1' }

const BASIS: BasisContent = {
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
  evidenceSetIds: [ASTRAL, BMP_HIGH],
  storageProvenanceId: 'prov-1',
  evaluatedAt: '2026-07-28T08:59:00.000Z',
}

describe('the two orderings disagree on astral characters', () => {
  it('sorts them oppositely, and that is the whole difference', () => {
    // UTF-16 code unit: the surrogate pair (0xD834…) is below U+FFFD.
    const byCodeUnit = ASTRAL < BMP_HIGH ? -1 : 1
    // UTF-8 byte / code point: U+1D11E is above U+FFFD.
    const byByte = utf8ByteOrder(ASTRAL, BMP_HIGH)

    expect(byCodeUnit).toBe(-1)
    expect(byByte).toBe(1)
    expect(byCodeUnit).not.toBe(byByte)
  })

  it('agrees on everything below the astral plane', () => {
    /*
     * The reason the divergence is easy to miss, and the reason a test is worth
     * more than a comment: for every realistic identifier the two orders are
     * identical, so nothing fails when someone unifies them — until an astral
     * character appears in a stored id.
     */
    const pairs: Array<[string, string]> = [
      ['a', 'b'],
      ['Id', 'id'],
      ['set-1', 'set-2'],
      ['å', 'z'],
      ['é', 'e'],
      ['日', '本'],
      ['a', 'ab'],
    ]
    for (const [left, right] of pairs) {
      const codeUnit = left < right ? -1 : left > right ? 1 : 0
      expect(utf8ByteOrder(left, right), `${left} vs ${right}`).toBe(codeUnit)
    }
  })
})

describe('the basis format keeps its own ordering', () => {
  it('sorts evidence-set ids by UTF-16 code unit, not by byte', () => {
    /*
     * If someone replaced the basis comparator with `utf8ByteOrder`, this
     * assertion fails — which is the point. Canonicalization v1 is approved,
     * frozen and pinned by golden vectors; changing its order is a v2, not a
     * tidy-up.
     */
    const encoded = canonicalBasisInput(SUBJECT, BASIS)
    const astralAt = encoded.indexOf(ASTRAL)
    const bmpAt = encoded.indexOf(BMP_HIGH)

    expect(astralAt).toBeGreaterThan(-1)
    expect(bmpAt).toBeGreaterThan(-1)
    expect(astralAt, 'the basis format must still sort by UTF-16 code unit').toBeLessThan(
      bmpAt,
    )
  })

  it('would order them the other way under canonical value v1', () => {
    // Stated explicitly so the divergence is visible in one place rather than
    // inferred from two files.
    const sorted = [ASTRAL, BMP_HIGH].sort(utf8ByteOrder)
    expect(sorted[0]).toBe(BMP_HIGH)
    expect(sorted[1]).toBe(ASTRAL)
  })
})

describe('no helper spans both formats', () => {
  it('exposes no generically named sort', async () => {
    /*
     * A `canonicalSort` that could be called from either format would be a
     * comparator whose semantics depend on the caller's assumption. Each format
     * names its own ordering, and the names say which one they implement.
     */
    const canonicalValue = await import('~/domain/shared/canonicalValue')
    const basis = await import('./basisCanonical')

    for (const name of Object.keys(canonicalValue)) {
      expect(name, 'a generically named comparator invites cross-format use').not.toBe(
        'canonicalSort',
      )
    }
    expect(Object.keys(canonicalValue)).toContain('utf8ByteOrder')
    expect(Object.keys(basis)).not.toContain('canonicalSort')
  })
})
