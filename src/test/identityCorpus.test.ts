/**
 * The migration accounting proof.
 *
 * Every production identity surface, with its canonical bytes and its identity
 * **pinned as literals**. The runner executes the corpus; it never derives the
 * expectations. A test that computes what it then asserts proves only that the
 * code agrees with itself — which is precisely the failure this corpus exists to
 * prevent.
 *
 * **This is not backward hash compatibility.** TD-61 changed the encoding
 * deliberately, so every identity below except the observation *id* differs from
 * what the same input produced before. What is proven is that each old valid
 * input has an explicit new representation, that no caller was dropped, and that
 * the values are reviewed rather than regenerated.
 *
 * If one of these fails, the encoding changed. That is a version decision, not a
 * test to update.
 */

import { describe, expect, it } from 'vitest'
import { stableHashHex } from '~/domain/shared/hash'
import {
  NotCanonicalError,
  canonicalIdentityInput,
  canonicalValueString,
} from '~/domain/shared/canonicalValue'
import { observationRef, requirementInputHash } from '~/domain/analysis'
import { commandPayloadHash } from '~/application/analysis/commands/envelope'
import { deriveEventId } from '~/application/analysis/commands/eventIdentity'
import { playbookContentHash } from '~/application/analysis/playbooks'
import { MACRO_REGIME_PLAYBOOK } from '~/application/analysis/macroPlaybook'
import type { CanonicalValue } from '~/domain/shared/canonicalValue'
import {
  MARKET_QUOTE_CONTENT,
  POLICY_STATE_CONTENT,
  YIELD_CONTENT,
  buildCorpusEvidenceSet,
  type CorpusEntry,
} from './identityCorpus'

const OBSERVATION_KEY = {
  subjectKind: 'instrument' as const,
  subject: 'US10Y',
  kind: 'yield' as const,
  observedAt: '2026-07-28T00:00:00.000Z',
  sourceId: 'treasury',
}

const OBSERVATION_DOMAIN = 'financial-os:observation-content:v1'

const observation = (content: CanonicalValue) => () => ({
  canonical: canonicalIdentityInput(OBSERVATION_DOMAIN, content),
  hash: observationRef(OBSERVATION_KEY, content).contentHash,
})

export const CORPUS: readonly CorpusEntry[] = [
  {
    name: 'a government yield, decimals as canonical strings',
    caller: 'identity.ts · observationRef',
    previously: 'yieldPercent and changeBasisPoints were fractional doubles',
    reason:
      'the encoding changed, and fractional doubles are now refused — the value ' +
      'arrives as an exact decimal string from the evidenceRefs boundary',
    governedBy: 'DOMAIN_CONTRACT_VERSION',
    expectedCanonical:
      'financial-os:observation-content:v1|d3:s17:changeBasisPointss2:-2s15:observationDates10:2026-07-28s12:yieldPercents4:4.69',
    expectedHash: '3a2e7a3efb3aca5f126e060a262f81ef',
    run: observation(YIELD_CONTENT),
  },
  {
    name: 'a market quote with four decimal fields',
    caller: 'identity.ts · observationRef',
    previously: 'value, absoluteChange, percentageChange and previousClose were doubles',
    reason: 'the encoding changed; every decimal is now an exact string',
    governedBy: 'DOMAIN_CONTRACT_VERSION',
    expectedCanonical:
      'financial-os:observation-content:v1|d4:s14:absoluteChanges5:-0.75s16:percentageChanges5:-0.71s13:previousCloses3:105s5:values6:104.25',
    expectedHash: '502be687939c787741c42e7d8061bf67',
    run: observation(MARKET_QUOTE_CONTENT),
  },
  {
    name: 'a nested policy state with a target range',
    caller: 'identity.ts · observationRef',
    previously:
      'PolicyLevel carried PolicyRatePercent doubles; the corpus payload also ' +
      'omitted the `regime` wrapper the stored payload has, which TD61-3C refuses',
    reason:
      'the encoding changed; nested rates convert through canonicalPolicyLevel at ' +
      'the boundary rather than field by field at each caller',
    governedBy: 'DOMAIN_CONTRACT_VERSION',
    expectedCanonical:
      'financial-os:observation-content:v1|d1:s6:regimed4:s6:changens13:effectiveDates10:2026-06-15s23:effectiveDateConfidences5:exacts5:leveld3:s4:kinds12:target-ranges12:lowerPercents4:5.25s12:upperPercents3:5.5',
    expectedHash: '533bcfcfc2e7251342ef01b8de8681c3',
    run: observation(POLICY_STATE_CONTENT),
  },
  {
    name: 'an evidence set over two observations',
    caller: 'evidence.ts · buildEvidenceSet',
    previously:
      'items sorted with localeCompare; pairs encoded by canonicalJson; and the ' +
      'second observation carried a quote payload under a yield kind',
    reason:
      'both changed — the sort is now UTF-8 byte order and the pairs are canonical ' +
      'value v1. The id binds membership, not payloads.',
    governedBy: 'DOMAIN_CONTRACT_VERSION',
    expectedCanonical:
      'financial-os:evidence-set:v1|l2:l2:s32:d4b7dc2534df61472726910297e33b77s32:3a2e7a3efb3aca5f126e060a262f81efl2:s32:d5239e2562d5074fe3dfe2dff286a6bfs32:502be687939c787741c42e7d8061bf67',
    expectedHash: 'f08a40eb003007ce1c3edd38932326be',
    run: () => {
      const set = buildCorpusEvidenceSet()
      return {
        canonical: canonicalIdentityInput(
          'financial-os:evidence-set:v1',
          [...set.items].map((item) => [item.ref.id, item.ref.contentHash]),
        ),
        hash: set.id,
      }
    },
  },
  {
    name: 'a requirement input',
    caller: 'requirements.ts · requirementInputHash',
    previously: 'implications sorted with localeCompare inside canonicalJson',
    reason: 'the encoding and the sort both changed',
    governedBy: 'DOMAIN_CONTRACT_VERSION',
    expectedCanonical:
      'financial-os:requirement-input:v1|d1:s12:implicationsl1:s13:implementable',
    expectedHash: 'd22c5b43266f7f94543ab9ae9f5de384',
    run: () => {
      const input = { implications: ['implementable'] } as never
      return {
        canonical: canonicalIdentityInput('financial-os:requirement-input:v1', {
          implications: ['implementable'],
        }),
        hash: requirementInputHash(input),
      }
    },
  },
  {
    name: 'a command payload under canonicalization version 2',
    caller: 'commands/envelope.ts · commandPayloadHash',
    previously: 'canonicalization version 1, encoded by canonicalJson',
    reason:
      'the payload encoding changed. The version is bound inside the hashed input, ' +
      'so a version-1 hash and a version-2 hash cannot be interchanged.',
    governedBy: 'PAYLOAD_CANONICALIZATION_VERSION',
    expectedCanonical:
      'financial-os:command-payload:v1|d9:s11:accountables5:emp-1s16:canonicalizations1:2s6:caseIds6:case-1s8:contracts1:2s15:expectedVersionns7:payloadd2:s15:ownerEmployeeIds5:emp-1s8:questions23:Is the curve mispriced?s6:reasonns16:thesisRevisionIdns4:types20:open-investment-case',
    expectedHash: '48f5b46bd9546f0553ae9cbf4b32baf5',
    run: () => {
      const payload = { question: 'Is the curve mispriced?', ownerEmployeeId: 'emp-1' }
      return {
        canonical: canonicalIdentityInput('financial-os:command-payload:v1', {
          canonicalization: '2',
          contract: '2',
          type: 'open-investment-case',
          caseId: 'case-1',
          thesisRevisionId: null,
          expectedVersion: null,
          accountable: 'emp-1',
          reason: null,
          payload,
        }),
        hash: commandPayloadHash({
          commandType: 'open-investment-case',
          caseId: 'case-1',
          accountableEmployeeId: 'emp-1',
          payload,
        }),
      }
    },
  },
  {
    name: 'a derived event identity',
    caller: 'commands/eventIdentity.ts · deriveEventId',
    previously: 'encoded by canonicalJson',
    reason: 'the encoding changed; the field set did not',
    governedBy: 'DOMAIN_CONTRACT_VERSION',
    expectedCanonical:
      'financial-os:derived-record-identity:v1|d4:s9:commandIds5:cmd-1s8:entityIds6:case-1s7:ordinali0s10:recordTypes10:transition',
    expectedHash: 'evt-2e39ce19533de02ef493b295a4b6ff5e',
    run: () => ({
      canonical: canonicalIdentityInput('financial-os:derived-record-identity:v1', {
        commandId: 'cmd-1',
        recordType: 'transition',
        entityId: 'case-1',
        ordinal: 0,
      }),
      hash: deriveEventId({
        commandId: 'cmd-1',
        recordType: 'transition',
        entityId: 'case-1',
      }),
    }),
  },
  {
    name: 'a write-once semantic key shape',
    caller: 'writeOnce.ts · every semantic-key family',
    previously: 'canonicalJson, with locale-sorted keys',
    reason:
      'the encoding changed. Semantic keys are compared within one process and ' +
      'never stored, so no durable value moved — but they are identity-critical ' +
      'and use the same strict format, deliberately.',
    governedBy: 'DOMAIN_CONTRACT_VERSION',
    expectedCanonical: 'd3:s1:as1:1s1:bns1:cl2:i1i2',
    expectedHash: 'ef1c0fe23b70ca64adae5b9db63452d4',
    run: () => {
      const value: CanonicalValue = { a: '1', b: null, c: [1, 2] }
      return {
        canonical: canonicalValueString(value),
        hash: stableHashHex(canonicalValueString(value)),
      }
    },
  },
]

describe('the migration corpus', () => {
  for (const entry of CORPUS) {
    describe(entry.name, () => {
      it('produces the pinned canonical bytes', () => {
        expect(entry.run().canonical).toBe(entry.expectedCanonical)
      })

      it('produces the pinned identity', () => {
        expect(entry.run().hash).toBe(entry.expectedHash)
      })
    })
  }

  it('covers every production identity surface', () => {
    /*
     * The structural guard. A surface added later without a corpus entry means
     * an identity nobody pinned, which is how an encoding change ships unnoticed.
     */
    const callers = new Set(CORPUS.map((entry) => entry.caller))
    expect([...callers].sort()).toEqual([
      'commands/envelope.ts · commandPayloadHash',
      'commands/eventIdentity.ts · deriveEventId',
      'evidence.ts · buildEvidenceSet',
      'identity.ts · observationRef',
      'requirements.ts · requirementInputHash',
      'writeOnce.ts · every semantic-key family',
    ])
  })

  it('pins the playbook content hash', () => {
    // The seventh surface, kept separate because its input is a whole playbook
    // rather than a value the corpus can state inline.
    expect(playbookContentHash(MACRO_REGIME_PLAYBOOK)).toBe(
      '670b2744c081c87c99213c34aadd27ec',
    )
  })

  it('states a reason and a governing version for every entry', () => {
    for (const entry of CORPUS) {
      expect(entry.reason.length, entry.name).toBeGreaterThan(20)
      expect(entry.previously.length, entry.name).toBeGreaterThan(10)
      expect(entry.governedBy, entry.name).toBeTruthy()
    }
  })

  it('leaves the observation id unchanged, alone among the surfaces', () => {
    /*
     * `serializeKey` is a fixed-field-order serializer and never went through
     * canonicalJson, so the observation *id* is the one identity TD-61 did not
     * move. Recorded because "everything changed" would be inaccurate.
     */
    expect(observationRef(OBSERVATION_KEY, YIELD_CONTENT).id).toBe(
      'd4b7dc2534df61472726910297e33b77',
    )
  })
})

describe('the rejected corpus', () => {
  class Instance {
    a = 1
  }
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  const withGetter = {}
  Object.defineProperty(withGetter, 'a', { get: () => 1, enumerable: true })

  const REJECTED: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['negative zero', -0],
    ['a fractional number', 2.5],
    ['an unsafe integer', 9007199254740993],
    ['a Date', new Date('2026-01-01')],
    ['a BigInt', 1n],
    ['a sparse array', [1, , 3]],
    ['a cyclic object', cyclic],
    ['a class instance', new Instance()],
    ['an object with toJSON', { toJSON: () => 1 }],
    ['an accessor property', withGetter],
    ['an unpaired surrogate', '\ud834'],
  ]

  for (const [name, value] of REJECTED) {
    it(`emits no identity for ${name}`, () => {
      /*
       * Not merely "throws": no identity may exist for any of these. Each was a
       * value the previous encoding accepted and silently collided.
       */
      let identity: string | null = null
      try {
        identity = observationRef(OBSERVATION_KEY, value as CanonicalValue).contentHash
      } catch (error) {
        expect(error).toBeInstanceOf(NotCanonicalError)
        identity = null
      }
      expect(identity, `${name} acquired an identity`).toBeNull()
    })
  }

  it('covers every value the previous encoding silently accepted', () => {
    const names = REJECTED.map(([name]) => name)
    for (const required of [
      'undefined',
      'NaN',
      'Infinity',
      '-Infinity',
      'negative zero',
      'a fractional number',
      'an unsafe integer',
      'a Date',
      'a BigInt',
      'a sparse array',
      'a cyclic object',
      'a class instance',
      'an object with toJSON',
      'an accessor property',
      'an unpaired surrogate',
    ]) {
      expect(names, `${required} is missing from the rejected corpus`).toContain(required)
    }
  })
})
