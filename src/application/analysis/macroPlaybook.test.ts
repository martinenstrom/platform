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
  MACRO_REGIME_PLAYBOOK_V3,
  MACRO_REGIME_PLAYBOOK_V4,
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
    const macro = MACRO_REGIME_PLAYBOOK_V2.entries.find(
      (e) => e.key === 'macro-analysis',
    )!
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

describe('version 3 recalibrates the breaker for curve-scale evidence', () => {
  it('is a different workflow by content from both of its predecessors', () => {
    expect(playbookContentHash(MACRO_REGIME_PLAYBOOK_V3)).not.toBe(V1_CONTENT_HASH)
    expect(playbookContentHash(MACRO_REGIME_PLAYBOOK_V3)).not.toBe(
      playbookContentHash(MACRO_REGIME_PLAYBOOK_V2),
    )
  })

  it('doubles the token authorization and moves nothing else', () => {
    const macro = MACRO_REGIME_PLAYBOOK_V3.entries.find(
      (e) => e.key === 'macro-analysis',
    )!
    expect(macro.budget).toEqual({
      tokens: 24_000,
      cost: { costMinorUnits: 100, currency: 'USD' },
      deadlineMs: 90_000,
    })

    /*
     * The refused run's provider call completed in 66.156 s inside a 90 s
     * authorization, so there is no measured basis to move the deadline, and it
     * did not move.
     */
    const v2Macro = MACRO_REGIME_PLAYBOOK_V2.entries.find(
      (e) => e.key === 'macro-analysis',
    )!
    expect(macro.budget!.deadlineMs).toBe(v2Macro.budget!.deadlineMs)
    expect(macro.budget!.cost).toEqual(v2Macro.budget!.cost)
  })

  it('still refuses the shape it exists to catch', () => {
    /*
     * A breaker that admitted everything the firm can render would authorize
     * the pathology instead of catching it. The 264-item full-serialization
     * shape measured ≈28,350 input tokens BEFORE output, and stays refused.
     */
    const macro = MACRO_REGIME_PLAYBOOK_V3.entries.find(
      (e) => e.key === 'macro-analysis',
    )!
    expect(macro.budget!.tokens).toBeLessThan(28_350)
  })

  it('authorizes exactly one desk, like its predecessors', () => {
    for (const entry of MACRO_REGIME_PLAYBOOK_V3.entries) {
      if (entry.key === 'macro-analysis') continue
      expect(entry.budget).toBeUndefined()
    }
  })

  it('leaves v1 and v2 untouched', () => {
    /*
     * Append-only is the whole reason v3 exists rather than an edit. The two
     * failed C3 Stage C runs were judged against v2's 12,000 and must stay
     * readable against it.
     */
    expect(playbookContentHash(MACRO_REGIME_PLAYBOOK)).toBe(V1_CONTENT_HASH)
    const v2Macro = MACRO_REGIME_PLAYBOOK_V2.entries.find(
      (e) => e.key === 'macro-analysis',
    )!
    expect(v2Macro.budget!.tokens).toBe(12_000)
  })

  it('changes nothing else about the workflow', () => {
    expect(MACRO_REGIME_PLAYBOOK_V3.entries.map((e) => e.key)).toEqual(
      MACRO_REGIME_PLAYBOOK.entries.map((e) => e.key),
    )
    for (const v3 of MACRO_REGIME_PLAYBOOK_V3.entries) {
      const v1 = MACRO_REGIME_PLAYBOOK.entries.find((e) => e.key === v3.key)!
      expect({ ...v3, budget: undefined }).toEqual({ ...v1, budget: undefined })
    }
  })
})

describe('version 4 widens the run envelope, and only that', () => {
  const v3Macro = MACRO_REGIME_PLAYBOOK_V3.entries.find(
    (e) => e.key === 'macro-analysis',
  )!
  const v4Macro = MACRO_REGIME_PLAYBOOK_V4.entries.find(
    (e) => e.key === 'macro-analysis',
  )!

  it('raises the deadline to hold one normal attempt plus one full retry', () => {
    expect(v4Macro.budget).toEqual({
      tokens: 24_000,
      cost: { costMinorUnits: 100, currency: 'USD' },
      deadlineMs: 180_000,
    })
  })

  it('holds the envelope above the measured two-attempt requirement', () => {
    /*
     * Measured, not assumed: one successful attempt of the byte-identical
     * 60-item request took 66.156 s, and the backoff before a retry is at most
     * 500 ms. Two attempts therefore need 132.9 s, and 150,000 ms was rejected
     * for sitting too close to it.
     */
    const twoAttemptsMs = 66_156 * 2 + 500
    expect(v4Macro.budget!.deadlineMs).toBeGreaterThan(twoAttemptsMs)
    expect(twoAttemptsMs).toBeGreaterThan(150_000 - 20_000)
  })

  it('does not stretch to guarantee three full attempts', () => {
    /*
     * `maxAttempts: 3` bounds how many times the pipeline may try inside the
     * envelope; it is not a promise the envelope holds three full calls. The
     * per-run deadline stays the superior circuit breaker.
     */
    expect(v4Macro.budget!.deadlineMs).toBeLessThan(66_156 * 3)
  })

  it('moves nothing except the deadline', () => {
    expect(v4Macro.budget!.tokens).toBe(v3Macro.budget!.tokens)
    expect(v4Macro.budget!.cost).toEqual(v3Macro.budget!.cost)
    expect(v4Macro.budget!.deadlineMs).not.toBe(v3Macro.budget!.deadlineMs)
  })

  it('authorizes exactly one desk, and leaves its predecessors alone', () => {
    for (const entry of MACRO_REGIME_PLAYBOOK_V4.entries) {
      if (entry.key === 'macro-analysis') continue
      expect(entry.budget).toBeUndefined()
    }
    /* All three failed Stage C runs stay readable against what judged them. */
    expect(playbookContentHash(MACRO_REGIME_PLAYBOOK)).toBe(V1_CONTENT_HASH)
    expect(v3Macro.budget!.deadlineMs).toBe(90_000)
    expect(
      MACRO_REGIME_PLAYBOOK_V2.entries.find((e) => e.key === 'macro-analysis')!.budget!
        .tokens,
    ).toBe(12_000)
  })

  it('changes nothing else about the workflow', () => {
    expect(MACRO_REGIME_PLAYBOOK_V4.entries.map((e) => e.key)).toEqual(
      MACRO_REGIME_PLAYBOOK.entries.map((e) => e.key),
    )
    for (const v4 of MACRO_REGIME_PLAYBOOK_V4.entries) {
      const v1 = MACRO_REGIME_PLAYBOOK.entries.find((e) => e.key === v4.key)!
      expect({ ...v4, budget: undefined }).toEqual({ ...v1, budget: undefined })
    }
  })
})

describe('the registry ships all four, and defaults new cases to the newest', () => {
  it('registers exactly four versions of one playbook', () => {
    expect(COMPILED_PLAYBOOKS.map((p) => `${p.id}@${p.version}`)).toEqual([
      'macro-regime@1',
      'macro-regime@2',
      'macro-regime@3',
      'macro-regime@4',
    ])
  })

  it('resolves a new macro case to v4', () => {
    expect(resolveForCaseKind(MACRO_REGIME_CASE_KIND)).toEqual({
      playbookId: 'macro-regime',
      version: '4',
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
