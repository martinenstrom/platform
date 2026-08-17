/**
 * Two versions of one workflow, and the line between them.
 *
 * Registration is append-only and keyed on `(id, version)`: the store accepts a
 * version it already holds only when the content matches, and throws
 * `ConflictingRecordError` otherwise. That makes **v1's content hash a fact
 * about every case pinned to it**, not an implementation detail — a case opened
 * before v2 existed still runs v1, and if v1's content ever moved, that case's
 * recorded workflow would have changed underneath it with nothing to say so.
 *
 * So v1's hash is pinned to a literal here. An edit to v1 fails this test
 * loudly rather than failing a deployment quietly, and the fix is always the
 * same: add a version, never change one.
 */

import { describe, expect, it } from 'vitest'
import {
  COMPILED_PLAYBOOKS,
  MACRO_REGIME_CASE_KIND,
  MACRO_REGIME_PLAYBOOK,
  MACRO_REGIME_PLAYBOOK_V2,
} from './macroPlaybook'
import { playbookContentHash } from './playbooks'
import { resolveForCaseKind, requirePlaybook } from './playbookRegistry'

/** Recorded when v2 was registered. Only ever changes if v1 was edited. */
const V1_CONTENT_HASH = '670b2744c081c87c99213c34aadd27ec'

describe('version 1 is frozen, because cases are pinned to it', () => {
  it('still hashes to exactly what it hashed to before v2 existed', () => {
    expect(playbookContentHash(MACRO_REGIME_PLAYBOOK)).toBe(V1_CONTENT_HASH)
  })

  it('authorizes no budget, so a live run under it refuses to start', () => {
    /*
     * Not an omission. v1 predates any approved spend, and a live run whose
     * workflow authorized nothing must refuse — which is the budget design
     * working rather than a gap to fill in place.
     */
    for (const entry of MACRO_REGIME_PLAYBOOK.entries) {
      expect(entry.budget).toBeUndefined()
    }
  })
})

describe('version 2 authorizes exactly one desk to run live', () => {
  it('is a different workflow by content, not a relabelled one', () => {
    expect(playbookContentHash(MACRO_REGIME_PLAYBOOK_V2)).not.toBe(V1_CONTENT_HASH)
  })

  it('carries the approved budget on macro-analysis, and nowhere else', () => {
    const macro = MACRO_REGIME_PLAYBOOK_V2.entries.find((e) => e.key === 'macro-analysis')!
    expect(macro.budget).toEqual({
      tokens: 12_000,
      cost: { costMinorUnits: 100, currency: 'USD' },
      deadlineMs: 90_000,
    })

    /*
     * Only the desk that was measured and approved. Authorizing the others
     * would be extending an approval nobody gave to work nobody measured.
     */
    for (const entry of MACRO_REGIME_PLAYBOOK_V2.entries) {
      if (entry.key === 'macro-analysis') continue
      expect(entry.budget).toBeUndefined()
    }
  })

  it('changes nothing else about the workflow', () => {
    /* Same entries, same order, same dependencies — only the budget differs. */
    expect(MACRO_REGIME_PLAYBOOK_V2.entries.map((e) => e.key)).toEqual(
      MACRO_REGIME_PLAYBOOK.entries.map((e) => e.key),
    )
    for (const v2 of MACRO_REGIME_PLAYBOOK_V2.entries) {
      const v1 = MACRO_REGIME_PLAYBOOK.entries.find((e) => e.key === v2.key)!
      expect({ ...v2, budget: undefined }).toEqual({ ...v1, budget: undefined })
    }
  })
})

describe('the registry ships both, and defaults new cases to the newer', () => {
  it('registers exactly two versions of one playbook', () => {
    expect(COMPILED_PLAYBOOKS.map((p) => `${p.id}@${p.version}`)).toEqual([
      'macro-regime@1',
      'macro-regime@2',
    ])
  })

  it('resolves a new macro case to v2', () => {
    expect(resolveForCaseKind(MACRO_REGIME_CASE_KIND)).toEqual({
      playbookId: 'macro-regime',
      version: '2',
    })
  })

  it('still resolves v1 by identity, for the cases that pinned it', () => {
    /*
     * The whole point of the pin: a case opened last month keeps the workflow
     * it started under, and the registry has to keep answering for it.
     */
    expect(requirePlaybook('macro-regime', '1')).toBe(MACRO_REGIME_PLAYBOOK)
  })
})
