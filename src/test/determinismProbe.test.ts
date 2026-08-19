/**
 * The child half of the determinism proof.
 *
 * Computes every identity in the corpus and writes them to the path named by
 * `DETERMINISM_OUT`. `determinism.test.ts` spawns this file in separate
 * processes under explicit `LANG`, `LC_ALL` and `TZ`, then compares the files
 * byte for byte.
 *
 * It is a test file rather than a script because the project has no TypeScript
 * runner other than vitest — no `tsx`, no `vite-node` — and inventing one for
 * this would be a bigger change than the thing it supports.
 *
 * **Skipped unless `DETERMINISM_OUT` is set**, so an ordinary suite run does not
 * execute it and the parent cannot recurse into itself.
 */

import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { stableHashHex } from '~/domain/shared/hash'
import {
  canonicalIdentityInput,
  canonicalValueString,
} from '~/domain/shared/canonicalValue'
import { observationRef, requirementInputHash } from '~/domain/analysis'
import { commandPayloadHash } from '~/application/analysis/commands/envelope'
import {
  MARKET_QUOTE_CONTENT,
  POLICY_STATE_CONTENT,
  YIELD_CONTENT,
  buildCorpusEvidenceSet,
} from './identityCorpus'

const OUT = process.env.DETERMINISM_OUT

const KEY = {
  subjectKind: 'instrument' as const,
  subject: 'US10Y',
  kind: 'yield' as const,
  observedAt: '2026-07-28T00:00:00.000Z',
  /* v2's key coordinate. Cross-platform determinism now covers it too. */
  referencePeriod: '2026-07-28',
  sourceId: 'treasury',
}

/**
 * Keys chosen because locales genuinely disagree about them.
 *
 * `Id` against `id` is the measured pair: `tr` and `da` order it opposite to
 * `en`, `sv`, `lt`, `cs` and `et`. If anything in the encoder consulted the host
 * locale, these would swap between environments.
 */
const LOCALE_SENSITIVE_KEYS = {
  Id: '1',
  id: '2',
  Angstrom: 'a',
  angstrom: 'b',
  Ärlig: 'c',
  ärlig: 'd',
  zebra: 'e',
}

describe.skipIf(!OUT)('determinism probe', () => {
  it('emits every identity for this environment', () => {
    const set = buildCorpusEvidenceSet()
    const payload = { question: 'Is the curve mispriced?', ownerEmployeeId: 'emp-1' }

    const output = {
      observationYield: observationRef(KEY, YIELD_CONTENT).contentHash,
      observationQuote: observationRef(KEY, MARKET_QUOTE_CONTENT).contentHash,
      observationPolicy: observationRef(KEY, POLICY_STATE_CONTENT).contentHash,
      observationId: observationRef(KEY, YIELD_CONTENT).id,
      evidenceSetId: set.id,
      requirementInput: requirementInputHash({
        implications: ['implementable'],
      } as never),
      commandPayload: commandPayloadHash({
        commandType: 'open-investment-case',
        caseId: 'case-1',
        accountableEmployeeId: 'emp-1',
        payload,
      }),
      semanticKeyBytes: canonicalValueString({ a: '1', b: null, c: [1, 2] }),
      localeSensitiveBytes: canonicalValueString(LOCALE_SENSITIVE_KEYS),
      /*
       * Timestamps are carried verbatim and never parsed, so the host timezone
       * should be irrelevant. That is a claim; including one is what tests it.
       */
      timestampBytes: canonicalValueString({
        evaluatedAt: '2026-07-28T08:59:00.000Z',
        observationDate: '2026-07-28',
      }),
      canonicalBytes: canonicalIdentityInput(
        'financial-os:observation-content:v1',
        YIELD_CONTENT,
      ),

      /*
       * Two negative controls, one per dimension, computed in the same process
       * under the same environment. A control that does not vary proves the
       * dimension was not exercised — which is a finding, not a failure, and the
       * parent reports it that way rather than passing silently.
       */
      localeSensitiveControl: stableHashHex(
        Object.keys(LOCALE_SENSITIVE_KEYS)
          .sort((left, right) => left.localeCompare(right))
          .join('|'),
      ),
      timezoneSensitiveControl: stableHashHex(
        new Date(0).toString() + new Date('2026-07-28T00:00:00Z').toString(),
      ),

      environment: {
        LANG: process.env.LANG ?? null,
        LC_ALL: process.env.LC_ALL ?? null,
        TZ: process.env.TZ ?? null,
        resolvedLocale: new Intl.Collator().resolvedOptions().locale,
        resolvedTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    }

    writeFileSync(OUT!, JSON.stringify(output), 'utf8')
  })
})
