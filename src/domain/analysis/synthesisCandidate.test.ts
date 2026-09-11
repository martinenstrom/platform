/**
 * The synthesis candidate's content identity.
 *
 * Two properties are being pinned, and they are not the same property:
 *
 *   1. **The encoding is frozen.** Golden vectors, so a refactor that changes
 *      the bytes fails here rather than silently making every stored candidate
 *      unverifiable.
 *   2. **The basis is inside the identity.** Two identical paragraphs produced
 *      against different institutional inputs are different candidates. This is
 *      the property the whole adoption boundary rests on: without it, a stale
 *      candidate and a fresh one could present the same content hash.
 */

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SYNTHESIS_CANONICALIZATION_VERSION,
  SYNTHESIS_DOMAIN_SEPARATION,
  SYNTHESIS_FIELD_DISPOSITION,
  buildProducedSynthesis,
  canonicalSynthesisInput,
  synthesisContentHash,
  synthesisHashMatches,
  type SynthesisArtifact,
  type SynthesisBasis,
} from './synthesisCandidate'

const ARTIFACT: SynthesisArtifact = {
  statement: 'The ECB holds through Q2 and cuts in September.',
  position: 'hold',
  rationale: 'Macro and the office agree on direction; quant disagrees on timing.',
  invalidationCriteria: 'Core inflation prints below 2.0% for two months.',
  implications: ['portfolio-risk'],
  inputRunIds: ['run-macro', 'run-office'],
  dispositions: [
    { claimId: 'claim-b', disposition: 'adopted-supporting' },
    { claimId: 'claim-a', disposition: 'adopted-supporting' },
  ],
  optionalInputs: [
    {
      playbookEntryKey: 'quant-validation',
      availability: 'unavailable-at-aggregation',
      materiallyRelevant: false,
      explanation: 'The quant desk did not contribute for this case.',
    },
  ],
}

const BASIS: SynthesisBasis = {
  caseId: 'case-1',
  sourceRevisionId: 'rev-1',
  playbookId: 'macro-regime',
  playbookVersion: '5',
  observedCompletedRunIds: ['run-office', 'run-macro'],
}

const RUN_ID = 'run-office'

describe('the encoding is frozen', () => {
  /*
   * A golden vector, written out in full. If this line has to change, the
   * canonicalization version has to change with it — every digest ever produced
   * under v1 was taken over these bytes.
   */
  it('renders the canonical input exactly', () => {
    expect(canonicalSynthesisInput(RUN_ID, ARTIFACT, BASIS)).toBe(
      'i1' +
        's10:run-office' +
        's6:case-1' +
        's5:rev-1' +
        's12:macro-regime' +
        's1:5' +
        'l2:s9:run-macros10:run-office' +
        's47:The ECB holds through Q2 and cuts in September.' +
        's4:hold' +
        's67:Macro and the office agree on direction; quant disagrees on timing.' +
        's48:Core inflation prints below 2.0% for two months.' +
        'a' +
        'l1:s14:portfolio-risk' +
        'l2:s9:run-macros10:run-office' +
        'l2:' +
        'l5:s7:claim-as18:adopted-supportingaaa' +
        'l5:s7:claim-bs18:adopted-supportingaaa' +
        'l1:' +
        'l5:s16:quant-validations26:unavailable-at-aggregationab0s48:The quant desk did not contribute for this case.',
    )
  })

  it('pins the digest', () => {
    expect(synthesisContentHash(RUN_ID, ARTIFACT, BASIS)).toBe(
      buildProducedSynthesis({
        runId: RUN_ID,
        artifact: ARTIFACT,
        basis: BASIS,
        producedAt: '2026-09-07T09:00:00.000Z',
      }).contentHash,
    )
    /* Lowercase hex, which is what the CHECK on the column requires. */
    expect(synthesisContentHash(RUN_ID, ARTIFACT, BASIS)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('separates itself from every other digest in the system', () => {
    expect(SYNTHESIS_DOMAIN_SEPARATION).toBe('financial-os:synthesis-candidate:v1|')
    expect(SYNTHESIS_CANONICALIZATION_VERSION).toBe(1)
  })
})

describe('ordering is not identity', () => {
  it('hashes the same synthesis identically however the producer ordered it', () => {
    const reordered: SynthesisArtifact = {
      ...ARTIFACT,
      inputRunIds: ['run-office', 'run-macro'],
      dispositions: [...ARTIFACT.dispositions].reverse(),
    }
    expect(synthesisContentHash(RUN_ID, reordered, BASIS)).toBe(
      synthesisContentHash(RUN_ID, ARTIFACT, BASIS),
    )
  })

  it('hashes the same basis identically however it was collected', () => {
    const reordered: SynthesisBasis = {
      ...BASIS,
      observedCompletedRunIds: ['run-macro', 'run-office'],
    }
    expect(synthesisContentHash(RUN_ID, ARTIFACT, reordered)).toBe(
      synthesisContentHash(RUN_ID, ARTIFACT, BASIS),
    )
  })
})

describe('the institutional basis is part of the identity', () => {
  /*
   * The discriminating test. Same prose, different inputs — and the candidates
   * must be distinguishable, because one of them was produced against a state
   * the firm has moved past.
   */
  it('distinguishes identical prose produced against different accepted work', () => {
    const later: SynthesisBasis = {
      ...BASIS,
      observedCompletedRunIds: [...BASIS.observedCompletedRunIds, 'run-quant'],
    }
    expect(synthesisContentHash(RUN_ID, ARTIFACT, later)).not.toBe(
      synthesisContentHash(RUN_ID, ARTIFACT, BASIS),
    )
  })

  it('distinguishes identical prose produced from a different revision', () => {
    expect(
      synthesisContentHash(RUN_ID, ARTIFACT, { ...BASIS, sourceRevisionId: 'rev-2' }),
    ).not.toBe(synthesisContentHash(RUN_ID, ARTIFACT, BASIS))
  })

  it('distinguishes identical prose produced under a different playbook version', () => {
    expect(
      synthesisContentHash(RUN_ID, ARTIFACT, { ...BASIS, playbookVersion: '6' }),
    ).not.toBe(synthesisContentHash(RUN_ID, ARTIFACT, BASIS))
  })

  it('distinguishes candidates produced by different runs', () => {
    expect(synthesisContentHash('run-other', ARTIFACT, BASIS)).not.toBe(
      synthesisContentHash(RUN_ID, ARTIFACT, BASIS),
    )
  })
})

describe('absence is absence', () => {
  it('encodes an absent horizon differently from an empty one', () => {
    const stated: SynthesisArtifact = { ...ARTIFACT, horizon: '' }
    expect(canonicalSynthesisInput(RUN_ID, stated, BASIS)).not.toBe(
      canonicalSynthesisInput(RUN_ID, ARTIFACT, BASIS),
    )
  })

  it('refuses to build a candidate carrying an empty horizon', () => {
    expect(() =>
      buildProducedSynthesis({
        runId: RUN_ID,
        artifact: { ...ARTIFACT, horizon: '   ' },
        basis: BASIS,
        producedAt: '2026-09-07T09:00:00.000Z',
      }),
    ).toThrow(/stated horizon is stated/)
  })

  for (const field of [
    'statement',
    'position',
    'rationale',
    'invalidationCriteria',
  ] as const) {
    it(`refuses a candidate that states no ${field}`, () => {
      expect(() =>
        buildProducedSynthesis({
          runId: RUN_ID,
          artifact: { ...ARTIFACT, [field]: '  ' },
          basis: BASIS,
          producedAt: '2026-09-07T09:00:00.000Z',
        }),
      ).toThrow(new RegExp(`states no ${field}`))
    })
  }
})

describe('the digest attests the candidate it is stored with', () => {
  const candidate = buildProducedSynthesis({
    runId: RUN_ID,
    artifact: ARTIFACT,
    basis: BASIS,
    producedAt: '2026-09-07T09:00:00.000Z',
  })

  it('accepts an untouched candidate', () => {
    expect(synthesisHashMatches(candidate)).toBe(true)
  })

  it('notices an edited statement', () => {
    expect(
      synthesisHashMatches({
        ...candidate,
        artifact: { ...candidate.artifact, statement: 'Something else entirely.' },
      }),
    ).toBe(false)
  })

  it('notices an edited basis, with the prose untouched', () => {
    expect(
      synthesisHashMatches({
        ...candidate,
        basis: { ...candidate.basis, observedCompletedRunIds: [] },
      }),
    ).toBe(false)
  })

  it('refuses a candidate claiming a canonicalization this build does not know', () => {
    expect(
      synthesisHashMatches({ ...candidate, canonicalizationVersion: '2' }),
    ).toBe(false)
  })
})

describe('production time is deliberately not part of the identity', () => {
  it('gives the same candidate the same hash whenever it was produced', () => {
    const early = buildProducedSynthesis({
      runId: RUN_ID,
      artifact: ARTIFACT,
      basis: BASIS,
      producedAt: '2026-09-07T09:00:00.000Z',
    })
    const late = buildProducedSynthesis({
      runId: RUN_ID,
      artifact: ARTIFACT,
      basis: BASIS,
      producedAt: '2026-09-08T17:30:00.000Z',
    })
    expect(late.contentHash).toBe(early.contentHash)
  })
})

/* ------------------------------------------------------- field coverage */

/**
 * Every member of the candidate types is either bound by the digest or has a
 * written reason it is not.
 *
 * Prose cannot notice a field added next year, and a field the digest does not
 * bind is a field an editor can change without the digest objecting — silently,
 * and in the direction that makes a stale candidate look adoptable.
 */
describe('no field escapes the decision', () => {
  const source = ts.createSourceFile(
    'synthesisCandidate.ts',
    readFileSync(
      join(process.cwd(), 'src/domain/analysis/synthesisCandidate.ts'),
      'utf8',
    ),
    ts.ScriptTarget.Latest,
    true,
  )

  const membersOf = (interfaceName: string): string[] => {
    let found: ts.InterfaceDeclaration | null = null
    source.forEachChild((node) => {
      if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
        found = node
      }
    })
    if (found === null) throw new Error(`${interfaceName} not found`)
    return (found as ts.InterfaceDeclaration).members
      .flatMap((member) =>
        ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)
          ? [member.name.text]
          : [],
      )
      .sort()
  }

  const cases = [
    ['SynthesisArtifact', SYNTHESIS_FIELD_DISPOSITION.artifact],
    ['SynthesisBasis', SYNTHESIS_FIELD_DISPOSITION.basis],
    ['ProducedSynthesis', SYNTHESIS_FIELD_DISPOSITION.record],
  ] as const

  for (const [interfaceName, disposition] of cases) {
    it(`${interfaceName} — every member is included or excluded, exactly once`, () => {
      const accounted = [
        ...disposition.included,
        ...Object.keys(disposition.excluded),
      ].sort()
      expect(accounted).toEqual(membersOf(interfaceName))
      expect(new Set(accounted).size).toBe(accounted.length)
    })
  }

  it('checks something rather than an empty surface', () => {
    expect(membersOf('SynthesisArtifact').length).toBeGreaterThan(5)
  })
})
