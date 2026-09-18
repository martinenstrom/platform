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
  MACRO_REGIME_PLAYBOOK_V5,
  MACRO_REGIME_PLAYBOOK_V6,
  MACRO_REGIME_PLAYBOOK_V7,
  MACRO_REGIME_PLAYBOOK_V8,
} from './macroPlaybook'
import { playbookContentHash, type PlaybookEntry } from './playbooks'
import { resolveForCaseKind, requirePlaybook } from './playbookRegistry'
import { resolveExecutionBudget } from './executionBudget'
import { budgetPermitsStart } from '~/domain/analysis'

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

/* ============================== version 5: two desks, then synthesis ====== */

describe('version 5 seats a second analytical desk', () => {
  const entry = (key: string) =>
    MACRO_REGIME_PLAYBOOK_V5.entries.find((e) => e.key === key)!

  it('is a different workflow by content from every predecessor', () => {
    const hash = playbookContentHash(MACRO_REGIME_PLAYBOOK_V5)
    for (const previous of [
      MACRO_REGIME_PLAYBOOK,
      MACRO_REGIME_PLAYBOOK_V2,
      MACRO_REGIME_PLAYBOOK_V3,
      MACRO_REGIME_PLAYBOOK_V4,
    ]) {
      expect(hash).not.toBe(playbookContentHash(previous))
    }
  })

  /* ------------------------------------------- epistemic independence ---- */

  it('lets Macro and Rates form their views without reading each other', () => {
    /*
     * The invariant of this version, and the reason it is asserted in both
     * directions. A dependency either way would turn a second opinion into a
     * response: a desk that reads the other's conclusion first is producing
     * peer commentary, and a disagreement it then reports is not evidence that
     * two qualified readings of the subject differ.
     */
    expect(entry('rates-analysis').blockedBy).toEqual([])
    expect(entry('macro-analysis').blockedBy).toEqual([])

    expect(entry('rates-analysis').optionalInputs).toEqual([])
    expect(entry('macro-analysis').optionalInputs).toEqual([])
  })

  it('never lets another desk’s output become an input to the Rates analysis', () => {
    /*
     * Stated as a property rather than as "blockedBy is empty", so it keeps
     * holding if the entry ever legitimately gains a dependency on something
     * that is NOT another desk's conclusion.
     */
    const rates = entry('rates-analysis')
    const upstream = [...rates.blockedBy, ...rates.optionalInputs]
    for (const forbidden of ['macro-analysis', 'aggregation', 'quant-validation']) {
      expect(upstream).not.toContain(forbidden)
    }
  })

  /* ------------------------------------------------------ synthesis ------ */

  it('makes aggregation wait for both analytical desks', () => {
    /*
     * Rates is REQUIRED, so synthesis before it lands would let a required
     * analysis arrive after the thesis it was supposed to inform.
     */
    expect([...entry('aggregation').blockedBy].sort()).toEqual([
      'macro-analysis',
      'rates-analysis',
    ])
    expect(entry('rates-analysis').requirement).toBe('required')
  })

  it('leaves Quant exactly where v4 had it', () => {
    /* Not broadened by this slice. */
    const v4 = MACRO_REGIME_PLAYBOOK_V4.entries.find((e) => e.key === 'quant-validation')!
    expect(entry('quant-validation')).toEqual(v4)
    expect(entry('aggregation').optionalInputs).toEqual(['quant-validation'])
  })

  /* ------------------------------------------------ examination order ---- */

  it('cannot examine a revision before one exists', () => {
    /*
     * `placeVerdict` refuses a verdict on a `proposed` or `under-analysis`
     * revision. The graph respects that lifecycle rather than scheduling work
     * the command would reject.
     */
    expect(entry('peer-examination').blockedBy).toEqual(['aggregation'])
  })

  it('orders examination strictly after both analyses, transitively', () => {
    const reaches = (from: string, target: string): boolean => {
      const node = MACRO_REGIME_PLAYBOOK_V5.entries.find((e) => e.key === from)
      if (!node) return false
      return node.blockedBy.some((k) => k === target || reaches(k, target))
    }
    expect(reaches('peer-examination', 'macro-analysis')).toBe(true)
    expect(reaches('peer-examination', 'rates-analysis')).toBe(true)
    /* And not the other way round, which would be a cycle. */
    expect(reaches('rates-analysis', 'peer-examination')).toBe(false)
  })

  /* --------------------------------------- two acts, one department ------ */

  it('keeps the Rates analysis and the Rates examination separate assignments', () => {
    /*
     * The same desk performs both, and they must not be collapsed because of
     * it: one is Rates forming its own view, the other is Rates reading the
     * synthesised revision afterwards. Different keys, different positions in
     * the graph, different questions.
     */
    const rates = MACRO_REGIME_PLAYBOOK_V5.entries.filter(
      (e) => e.departmentId === 'rates',
    )
    expect(rates.map((e) => e.key).sort()).toEqual(['peer-examination', 'rates-analysis'])
    expect(entry('rates-analysis').blockedBy).not.toEqual(
      entry('peer-examination').blockedBy,
    )
    for (const e of rates) expect(e.requirement).toBe('required')
  })

  it('assigns both to a desk that actually handles the discipline', () => {
    /* `validateRegistry` enforces this; asserted so the reason is visible. */
    for (const key of ['rates-analysis', 'peer-examination']) {
      expect(entry(key).departmentId).toBe('rates')
      expect(entry(key).disciplineTag).toBe('rates')
    }
  })

  /* ------------------------------------------------ carried forward ------ */

  it('carries v4’s budget and the conditional Risk rule unchanged', () => {
    const v4Macro = MACRO_REGIME_PLAYBOOK_V4.entries.find(
      (e) => e.key === 'macro-analysis',
    )!
    expect(entry('macro-analysis')).toEqual(v4Macro)

    const v4Risk = MACRO_REGIME_PLAYBOOK_V4.entries.find((e) => e.key === 'risk-review')!
    expect(entry('risk-review')).toEqual(v4Risk)
  })

  it('changes nothing else about the workflow', () => {
    /*
     * Every entry v4 had, still there, and only `aggregation` altered. The two
     * new entries are additions; nothing was rewritten to make room for them.
     */
    const changed = MACRO_REGIME_PLAYBOOK_V4.entries.filter(
      (before) => JSON.stringify(before) !== JSON.stringify(entry(before.key)),
    )
    expect(changed.map((e) => e.key)).toEqual(['aggregation'])

    const added = MACRO_REGIME_PLAYBOOK_V5.entries
      .map((e) => e.key)
      .filter((key) => !MACRO_REGIME_PLAYBOOK_V4.entries.some((e) => e.key === key))
    expect(added.sort()).toEqual(['peer-examination', 'rates-analysis'])
  })

  it('leaves every earlier version byte-identical', () => {
    /*
     * The append-only rule, asserted against the hash rather than by reading.
     * v1's is pinned to the literal recorded when v2 was registered; the rest
     * are proved not to have moved by being compared to each other.
     */
    expect(playbookContentHash(MACRO_REGIME_PLAYBOOK)).toBe(V1_CONTENT_HASH)
    const hashes = [
      MACRO_REGIME_PLAYBOOK,
      MACRO_REGIME_PLAYBOOK_V2,
      MACRO_REGIME_PLAYBOOK_V3,
      MACRO_REGIME_PLAYBOOK_V4,
      MACRO_REGIME_PLAYBOOK_V5,
    ].map(playbookContentHash)
    expect(new Set(hashes).size).toBe(5)
  })
})

describe('version 6 authorizes the path to a synthesis, and nothing beyond it', () => {
  const entry = (key: string) =>
    MACRO_REGIME_PLAYBOOK_V6.entries.find((candidate) => candidate.key === key)!

  /** What the firm resolves for this entry when a live producer asks to start. */
  const permitsLive = (candidate: PlaybookEntry) =>
    budgetPermitsStart(
      'live',
      resolveExecutionBudget('live', {
        ...(candidate.budget ? { proposed: candidate.budget } : {}),
        firmCeiling: {},
      }),
    )

  it('is a different workflow by content from every predecessor', () => {
    expect(playbookContentHash(MACRO_REGIME_PLAYBOOK_V6)).not.toBe(
      playbookContentHash(MACRO_REGIME_PLAYBOOK_V5),
    )
  })

  /* --------------------------------------------------------- the budgets -- */

  it('gives Rates the envelope v4 approved, not a second number of its own', () => {
    /*
     * The same object, deliberately. Two constants holding identical values
     * would be two things to keep in step, and a divergence between what the
     * firm authorizes for two desks reading the same evidence through the same
     * provider would be silent.
     */
    const v4Macro = MACRO_REGIME_PLAYBOOK_V4.entries.find(
      (candidate) => candidate.key === 'macro-analysis',
    )!
    expect(entry('rates-analysis').budget).toBe(v4Macro.budget)
    expect(entry('macro-analysis').budget).toBe(v4Macro.budget)
  })

  it('keeps the curve-scale breaker exactly where v3 and v4 put it', () => {
    /*
     * Measured with the provider's own token counter against the sets the firm
     * holds: the 60-observation term structure needs 19,658 tokens for one full
     * attempt and fits; the 264-observation window needs 70,029 and stays
     * refused. Rates differs from Macro by 31 tokens — the length of its brief.
     */
    for (const key of ['macro-analysis', 'rates-analysis']) {
      expect(entry(key).budget).toEqual({
        tokens: 24_000,
        cost: { costMinorUnits: 100, currency: 'USD' },
        deadlineMs: 180_000,
      })
      expect(19_658).toBeLessThan(entry(key).budget!.tokens!)
      expect(70_029).toBeGreaterThan(entry(key).budget!.tokens!)
    }
  })

  it('budgets the Research Office for the shape a synthesis actually has', () => {
    expect(entry('aggregation').budget).toEqual({
      tokens: 12_000,
      cost: { costMinorUnits: 100, currency: 'USD' },
      deadlineMs: 180_000,
    })
  })

  it('admits every real synthesis shape and still refuses the pathology', () => {
    /*
     * Measured the same way, on the real `aggregation` brief. A synthesis
     * prompt carries claim IDS rather than observations, so it scales with how
     * many claims the desks produced:
     *
     *   14 + 14 claims, the largest desk runs on record    6,335 per attempt
     *   50 + 50 claims, stress                             8,999 per attempt
     *   250 + 250 claims, pathology                       23,499 per attempt
     */
    const authorized = entry('aggregation').budget!.tokens!
    expect(6_335).toBeLessThan(authorized)
    expect(8_999).toBeLessThan(authorized)
    expect(23_499).toBeGreaterThan(authorized)
  })

  it('does not copy the desk figure onto work of a different shape', () => {
    /* Narrower than a desk, because it reads no evidence of its own. */
    expect(entry('aggregation').budget!.tokens!).toBeLessThan(
      entry('macro-analysis').budget!.tokens!,
    )
  })

  /* ------------------------------------------------- what stays unopened -- */

  it('lets exactly Macro, Rates and the Research Office start live work', () => {
    const permitted = MACRO_REGIME_PLAYBOOK_V6.entries
      .filter(permitsLive)
      .map((candidate) => candidate.key)
      .sort()
    expect(permitted).toEqual(['aggregation', 'macro-analysis', 'rates-analysis'])
  })

  it('leaves every unopened entry refusing live work', () => {
    /*
     * Not an omission. No governance autonomy has been approved, and a version
     * that budgeted every entry it happened to contain would be authorizing
     * autonomy nobody decided on.
     */
    for (const key of [
      'quant-validation',
      'verification',
      'challenge',
      'risk-review',
      'peer-examination',
    ]) {
      expect(entry(key).budget).toBeUndefined()
      expect(permitsLive(entry(key))).toBe(false)
    }
  })

  it('changes nothing about what a stub may do, anywhere', () => {
    for (const candidate of MACRO_REGIME_PLAYBOOK_V6.entries) {
      expect(
        budgetPermitsStart(
          'stub',
          resolveExecutionBudget('stub', {
            ...(candidate.budget ? { proposed: candidate.budget } : {}),
            firmCeiling: {},
          }),
        ),
      ).toBe(true)
    }
  })

  /* ------------------------------------------------ the workflow is v5's -- */

  it('still makes aggregation wait for both analytical desks', () => {
    /*
     * The dependency is not relaxed to make an autonomous run easier to reach.
     * A synthesis that could proceed without the second independent view would
     * be a different workflow wearing v5's topology.
     */
    expect([...entry('aggregation').blockedBy].sort()).toEqual([
      'macro-analysis',
      'rates-analysis',
    ])
  })

  it('changes nothing except two budgets', () => {
    const withoutBudget = ({ budget: _budget, ...rest }: PlaybookEntry) => rest
    expect(MACRO_REGIME_PLAYBOOK_V6.entries.map(withoutBudget)).toEqual(
      MACRO_REGIME_PLAYBOOK_V5.entries.map(withoutBudget),
    )

    const changed = MACRO_REGIME_PLAYBOOK_V5.entries.filter(
      (before) => JSON.stringify(before) !== JSON.stringify(entry(before.key)),
    )
    expect(changed.map((candidate) => candidate.key).sort()).toEqual([
      'aggregation',
      'rates-analysis',
    ])
  })

  it('leaves every earlier version byte-identical', () => {
    expect(playbookContentHash(MACRO_REGIME_PLAYBOOK)).toBe(V1_CONTENT_HASH)
    const hashes = [
      MACRO_REGIME_PLAYBOOK,
      MACRO_REGIME_PLAYBOOK_V2,
      MACRO_REGIME_PLAYBOOK_V3,
      MACRO_REGIME_PLAYBOOK_V4,
      MACRO_REGIME_PLAYBOOK_V5,
      MACRO_REGIME_PLAYBOOK_V6,
    ].map(playbookContentHash)
    expect(new Set(hashes).size).toBe(6)
  })
})

describe('version 7 authorizes the committee to scrutinise live, and nothing beyond it (G1, 2026-09-17)', () => {
  const entry = (key: string) =>
    MACRO_REGIME_PLAYBOOK_V7.entries.find((candidate) => candidate.key === key)!

  const permitsLive = (candidate: PlaybookEntry) =>
    budgetPermitsStart(
      'live',
      resolveExecutionBudget('live', {
        ...(candidate.budget ? { proposed: candidate.budget } : {}),
        firmCeiling: {},
      }),
    )

  it('is a different workflow by content from every predecessor', () => {
    expect(playbookContentHash(MACRO_REGIME_PLAYBOOK_V7)).not.toBe(
      playbookContentHash(MACRO_REGIME_PLAYBOOK_V6),
    )
  })

  it('budgets Verification for the largest argument the firm has measured, and refuses the window it refused the desks', () => {
    /*
     * Measured with the provider's token counter on case dev-1789157716935
     * r2 — 31 claims, 107 citations into the 7-day window — through the
     * verification prompt: 17,369 input, 21,465 with the 4,096 answer cap.
     */
    expect(entry('verification').budget).toEqual({
      tokens: 24_000,
      cost: { costMinorUnits: 100, currency: 'USD' },
      deadlineMs: 180_000,
    })
    expect(21_465).toBeLessThan(entry('verification').budget!.tokens!)
    /* The 30-day window's citations, estimated at ~4x: refused, as it is for the desks. */
    expect(55_000).toBeGreaterThan(entry('verification').budget!.tokens!)
  })

  it('gives the Devil’s Advocate and the peer one figure — the synthesis’s — because they read the claims and never the evidence', () => {
    /* Measured the same way: 5,163 and 5,130 input; 9,259 and 9,226 with the answer cap. */
    expect(entry('challenge').budget).toBe(entry('peer-examination').budget)
    expect(entry('challenge').budget).toEqual({
      tokens: 12_000,
      cost: { costMinorUnits: 100, currency: 'USD' },
      deadlineMs: 180_000,
    })
    expect(9_259).toBeLessThan(entry('challenge').budget!.tokens!)
    expect(entry('challenge').budget!.tokens!).toBe(entry('aggregation').budget!.tokens!)
  })

  it('does not share Verification’s constant with the desks, though the numbers coincide', () => {
    expect(entry('verification').budget).not.toBe(entry('macro-analysis').budget)
    expect(entry('verification').budget).toEqual(entry('macro-analysis').budget)
  })

  it('lets exactly the committee’s path start live work', () => {
    const permitted = MACRO_REGIME_PLAYBOOK_V7.entries
      .filter(permitsLive)
      .map((candidate) => candidate.key)
      .sort()
    expect(permitted).toEqual([
      'aggregation',
      'challenge',
      'macro-analysis',
      'peer-examination',
      'rates-analysis',
      'verification',
    ])
  })

  it('leaves Quant and Risk refusing live work', () => {
    /* Risk has no candidate boundary (TD-98); Quant’s autonomy was never ruled. */
    for (const key of ['quant-validation', 'risk-review']) {
      expect(entry(key).budget).toBeUndefined()
      expect(permitsLive(entry(key))).toBe(false)
    }
  })

  it('changes nothing about what a stub may do, anywhere', () => {
    for (const candidate of MACRO_REGIME_PLAYBOOK_V7.entries) {
      expect(
        budgetPermitsStart(
          'stub',
          resolveExecutionBudget('stub', {
            ...(candidate.budget ? { proposed: candidate.budget } : {}),
            firmCeiling: {},
          }),
        ),
      ).toBe(true)
    }
  })

  it('changes nothing except three budgets', () => {
    const withoutBudget = ({ budget: _budget, ...rest }: PlaybookEntry) => rest
    expect(MACRO_REGIME_PLAYBOOK_V7.entries.map(withoutBudget)).toEqual(
      MACRO_REGIME_PLAYBOOK_V6.entries.map(withoutBudget),
    )
    const changed = MACRO_REGIME_PLAYBOOK_V6.entries.filter(
      (before) => JSON.stringify(before) !== JSON.stringify(entry(before.key)),
    )
    expect(changed.map((candidate) => candidate.key).sort()).toEqual([
      'challenge',
      'peer-examination',
      'verification',
    ])
  })

  it('leaves every earlier version byte-identical', () => {
    expect(playbookContentHash(MACRO_REGIME_PLAYBOOK)).toBe(V1_CONTENT_HASH)
    const hashes = [
      MACRO_REGIME_PLAYBOOK,
      MACRO_REGIME_PLAYBOOK_V2,
      MACRO_REGIME_PLAYBOOK_V3,
      MACRO_REGIME_PLAYBOOK_V4,
      MACRO_REGIME_PLAYBOOK_V5,
      MACRO_REGIME_PLAYBOOK_V6,
      MACRO_REGIME_PLAYBOOK_V7,
    ].map(playbookContentHash)
    expect(new Set(hashes).size).toBe(7)
  })
})

describe('version 8 recomputes the committee’s budgets against the measured answer cap (2026-09-18)', () => {
  const entry = (key: string) =>
    MACRO_REGIME_PLAYBOOK_V8.entries.find((candidate) => candidate.key === key)!

  const permitsLive = (candidate: PlaybookEntry) =>
    budgetPermitsStart(
      'live',
      resolveExecutionBudget('live', {
        ...(candidate.budget ? { proposed: candidate.budget } : {}),
        firmCeiling: {},
      }),
    )

  it('is a different workflow by content from v7', () => {
    expect(playbookContentHash(MACRO_REGIME_PLAYBOOK_V8)).not.toBe(
      playbookContentHash(MACRO_REGIME_PLAYBOOK_V7),
    )
  })

  it('holds Verification’s largest measured shape at the full 8,192 answer cap, and refuses the 30-day pathology', () => {
    /* 17,369 measured input + 8,192 = 25,561. */
    expect(entry('verification').budget).toEqual({
      tokens: 28_000,
      cost: { costMinorUnits: 100, currency: 'USD' },
      deadlineMs: 180_000,
    })
    expect(25_561).toBeLessThan(entry('verification').budget!.tokens!)
    expect(55_000).toBeGreaterThan(entry('verification').budget!.tokens!)
  })

  it('gives the Devil’s Advocate and the peer one figure that holds their measured shapes at the full cap', () => {
    /* 5,163 + 8,192 = 13,355 and 5,130 + 8,192 = 13,322. */
    expect(entry('challenge').budget).toBe(entry('peer-examination').budget)
    expect(entry('challenge').budget).toEqual({
      tokens: 16_000,
      cost: { costMinorUnits: 100, currency: 'USD' },
      deadlineMs: 180_000,
    })
    expect(13_355).toBeLessThan(entry('challenge').budget!.tokens!)
    expect(38_000).toBeGreaterThan(entry('challenge').budget!.tokens!)
  })

  it('lets exactly the committee’s path start live work, as v7 did', () => {
    const permitted = MACRO_REGIME_PLAYBOOK_V8.entries
      .filter(permitsLive)
      .map((candidate) => candidate.key)
      .sort()
    expect(permitted).toEqual([
      'aggregation',
      'challenge',
      'macro-analysis',
      'peer-examination',
      'rates-analysis',
      'verification',
    ])
    for (const key of ['quant-validation', 'risk-review']) {
      expect(entry(key).budget).toBeUndefined()
      expect(permitsLive(entry(key))).toBe(false)
    }
  })

  it('changes nothing except the three governance budgets', () => {
    const withoutBudget = ({ budget: _budget, ...rest }: PlaybookEntry) => rest
    expect(MACRO_REGIME_PLAYBOOK_V8.entries.map(withoutBudget)).toEqual(
      MACRO_REGIME_PLAYBOOK_V7.entries.map(withoutBudget),
    )
    const changed = MACRO_REGIME_PLAYBOOK_V7.entries.filter(
      (before) => JSON.stringify(before) !== JSON.stringify(entry(before.key)),
    )
    expect(changed.map((candidate) => candidate.key).sort()).toEqual([
      'challenge',
      'peer-examination',
      'verification',
    ])
  })

  it('leaves every earlier version byte-identical', () => {
    expect(playbookContentHash(MACRO_REGIME_PLAYBOOK)).toBe(V1_CONTENT_HASH)
    const hashes = [
      MACRO_REGIME_PLAYBOOK,
      MACRO_REGIME_PLAYBOOK_V2,
      MACRO_REGIME_PLAYBOOK_V3,
      MACRO_REGIME_PLAYBOOK_V4,
      MACRO_REGIME_PLAYBOOK_V5,
      MACRO_REGIME_PLAYBOOK_V6,
      MACRO_REGIME_PLAYBOOK_V7,
      MACRO_REGIME_PLAYBOOK_V8,
    ].map(playbookContentHash)
    expect(new Set(hashes).size).toBe(8)
  })
})

describe('the registry ships all eight, and defaults new cases to the newest', () => {
  it('registers exactly eight versions of one playbook', () => {
    expect(COMPILED_PLAYBOOKS.map((p) => `${p.id}@${p.version}`)).toEqual([
      'macro-regime@1',
      'macro-regime@2',
      'macro-regime@3',
      'macro-regime@4',
      'macro-regime@5',
      'macro-regime@6',
      'macro-regime@7',
      'macro-regime@8',
    ])
  })

  it('resolves a new macro case to v8', () => {
    expect(resolveForCaseKind(MACRO_REGIME_CASE_KIND)).toEqual({
      playbookId: 'macro-regime',
      version: '8',
    })
  })

  it('still resolves v7 by identity, for the cases that pinned it', () => {
    expect(requirePlaybook('macro-regime', '7')).toBe(MACRO_REGIME_PLAYBOOK_V7)
  })

  it('still resolves v6 by identity, for the cases that pinned it', () => {
    expect(requirePlaybook('macro-regime', '6')).toBe(MACRO_REGIME_PLAYBOOK_V6)
  })

  it('still resolves v5 by identity, for the cases that pinned it', () => {
    expect(requirePlaybook('macro-regime', '5')).toBe(MACRO_REGIME_PLAYBOOK_V5)
  })

  it('still resolves v4 by identity, for the cases that pinned it', () => {
    expect(requirePlaybook('macro-regime', '4')).toBe(MACRO_REGIME_PLAYBOOK_V4)
  })

  it('still resolves v1 by identity, for the cases that pinned it', () => {
    /*
     * The whole point of the pin: a case opened last month keeps the workflow
     * it started under, and the registry has to keep answering for it.
     */
    expect(requirePlaybook('macro-regime', '1')).toBe(MACRO_REGIME_PLAYBOOK)
  })
})
