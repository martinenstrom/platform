/**
 * The Macro Regime playbook — the firm's first standard workflow.
 *
 * A compiled-in constant rather than a seeded row, because it is code the
 * build ships: registering it is append-only, so the version a case pinned can
 * never be edited out from under it, and a changed workflow is a new version
 * registered beside the old one.
 *
 * ## The dependency order, and the one judgement in it
 *
 * Governance reviews depend on **aggregation**, not on the specialist
 * contributions that fed it. That is the substantive modelling decision here.
 * Specialists produce evidence and claims; the Research Office manager turns
 * them into an argument; Verification, the Devil's Advocate and — when it
 * applies — Risk review **that exact argument**. Pointing governance at the raw
 * contributions instead would have them reviewing something nobody had yet
 * claimed was the firm's position.
 *
 * Quant is an **optional input** to aggregation rather than a blocking one.
 * There are macro questions a technical desk has nothing useful to say about,
 * and blocking on a contribution that may legitimately never arrive is how a
 * case waits forever. Its absence is not silence: `missingOptionalInputs`
 * reports it, and the manager's aggregation is expected to record that the
 * perspective was unavailable rather than imply full coverage.
 */

import { RISK_REVIEW_WHEN_IMPLEMENTABLE } from '~/domain/analysis'
import type { CasePlaybook, PlaybookEntry } from './playbooks'

export const MACRO_REGIME_CASE_KIND = 'macro-regime'

/** Annotated so each `requirement` keeps its literal type rather than widening. */
const MACRO_REGIME_ENTRIES: readonly PlaybookEntry[] = Object.freeze([
  {
    key: 'macro-analysis',
    departmentId: 'global-macro',
    brief:
      'Assess the prevailing macro regime for the subject: growth, inflation, ' +
      'policy path and the rates and currency implications. State what would ' +
      'change your view.',
    // Nothing precedes the primary analysis.
    blockedBy: Object.freeze([]),
    optionalInputs: Object.freeze([]),
    requirement: 'required',
    priority: 100,
    disciplineTag: 'macro',
  },
  {
    key: 'quant-validation',
    departmentId: 'quant-technical',
    brief:
      'Test the macro view against the data: regime indicators, historical ' +
      'analogues, and whether the claimed relationships hold statistically.',
    /*
     * Not blocked on the macro analysis. Quant can run its own regime tests
     * independently, and making it wait would serialise two desks that have
     * no reason to be serial.
     */
    blockedBy: Object.freeze([]),
    optionalInputs: Object.freeze(['macro-analysis']),
    requirement: 'optional',
    priority: 80,
    disciplineTag: 'quant',
  },
  {
    key: 'aggregation',
    departmentId: 'research-office',
    brief:
      'Reconcile the contributions into a single thesis revision. State the ' +
      'position, the invalidation criteria, and which implementation ' +
      'implications the thesis carries. Record any perspective that was ' +
      'unavailable.',
    blockedBy: Object.freeze(['macro-analysis']),
    optionalInputs: Object.freeze(['quant-validation']),
    requirement: 'required',
    priority: 90,
    disciplineTag: 'aggregation',
  },
  {
    key: 'verification',
    departmentId: 'verification',
    brief:
      'Check every factual claim the thesis rests on against its cited ' +
      'evidence. Record discrepancies rather than correcting them.',
    blockedBy: Object.freeze(['aggregation']),
    optionalInputs: Object.freeze([]),
    requirement: 'required',
    priority: 70,
    disciplineTag: 'verification',
  },
  {
    key: 'challenge',
    departmentId: 'devils-advocate',
    brief:
      'Argue the opposite case as strongly as the evidence permits. Identify ' +
      'the assumption the thesis cannot survive being wrong about.',
    blockedBy: Object.freeze(['aggregation']),
    optionalInputs: Object.freeze([]),
    requirement: 'required',
    priority: 70,
    disciplineTag: 'challenge',
  },
  {
    key: 'risk-review',
    departmentId: 'risk',
    brief:
      'Assess the exposure acting on this thesis would create: sizing, ' +
      'concentration, liquidity and tail risk.',
    blockedBy: Object.freeze(['aggregation']),
    optionalInputs: Object.freeze([]),
    /*
     * Conditional, decided per revision. A descriptive regime assessment
     * gives Risk nothing to size; one that recommends a position does.
     */
    requirement: 'conditional',
    conditionalRule: Object.freeze({
      ruleId: RISK_REVIEW_WHEN_IMPLEMENTABLE.ruleId,
      ruleVersion: RISK_REVIEW_WHEN_IMPLEMENTABLE.ruleVersion,
    }),
    priority: 70,
    disciplineTag: 'risk',
  },
])

export const MACRO_REGIME_PLAYBOOK: CasePlaybook = Object.freeze({
  id: 'macro-regime',
  version: '1',
  caseKind: MACRO_REGIME_CASE_KIND,
  name: 'Macro regime assessment',
  entries: MACRO_REGIME_ENTRIES,
})

/**
 * What the firm authorizes `macro-analysis` to spend, as a **proposal**.
 *
 * The first of the three budget sources — a playbook-level execution proposal
 * for one entry. **It is not the firm's hard global ceiling**, and must not be
 * renamed, described or read as firm-wide policy: the absence of a durable
 * firm-wide ceiling is TD-76, and this does not close it. A case may still
 * constrain below this, and a firm ceiling would still cap it, because
 * resolution is a minimum across every source that speaks.
 *
 * Approved 2026-08-17 from measured evidence, not inherited from the C2-1
 * smoke constant:
 *
 * | dimension | value | what it protects against |
 * |---|---|---|
 * | tokens | 12,000 | an evidence set far larger than anyone intended; the only way one call can breach it, since provider output is capped at 4,096 |
 * | cost | $1.00 | nothing enforceable — see below |
 * | deadline | 90,000 ms | a hung provider holding a synchronous request open |
 *
 * The two successful live runs measured 1,562 and 1,459 tokens against
 * one-observation evidence, and one completed its whole cycle in about 13
 * seconds against a 60-second authorization. The headroom is deliberate rather
 * than fitted: **breaching the token limit fails the run and discards the
 * claims**, so a limit set near expected usage destroys work the firm already
 * paid for. It is a circuit breaker for pathology, not a budgeting instrument.
 *
 * **The monetary figure is an authorization, not a control.** The Messages API
 * reports token counts and no price, so `RunUsage` carries
 * `cost: not-reported` and `budgetOverruns` — which reads measured cost only —
 * can never evaluate it. It is named because `budgetPermitsStart` refuses a
 * live run with an unmeasured dimension, and it says the firm authorizes this
 * class of work up to a dollar. Nothing in Financial OS may present it as
 * verified compliance with a spending ceiling, because nothing verified it.
 *
 * A per-token price is deliberately not derived here. `toRunUsage` refuses the
 * same thing for the same reason: a computed number in a field the domain
 * treats as a measurement is indistinguishable downstream from a real one.
 */
const MACRO_ANALYSIS_BUDGET = Object.freeze({
  tokens: 12_000,
  cost: Object.freeze({ costMinorUnits: 100, currency: 'USD' }),
  deadlineMs: 90_000,
})

/**
 * Version 2 — the same workflow, with `macro-analysis` authorized to run live.
 *
 * A new version rather than an edit, because registration is append-only and a
 * budget is inside `playbookContentHash`: editing v1 in place would give two
 * cases different workflows under one name, and only the order they started in
 * would say which. **Cases pinned to v1 keep v1**, and therefore keep an entry
 * with no budget — which is the correct consequence rather than a gap. A live
 * run under a workflow that authorized no spend refuses to start, and that
 * refusal is the budget design working.
 *
 * Only `macro-analysis` carries a budget. The other five entries are unchanged
 * and remain unauthorized for live execution, because only that one desk has
 * been measured and approved.
 */
const MACRO_REGIME_V2_ENTRIES: readonly PlaybookEntry[] = Object.freeze(
  MACRO_REGIME_ENTRIES.map((entry) =>
    entry.key === 'macro-analysis'
      ? Object.freeze({ ...entry, budget: MACRO_ANALYSIS_BUDGET })
      : entry,
  ),
)

export const MACRO_REGIME_PLAYBOOK_V2: CasePlaybook = Object.freeze({
  id: 'macro-regime',
  version: '2',
  caseKind: MACRO_REGIME_CASE_KIND,
  name: 'Macro regime assessment',
  entries: MACRO_REGIME_V2_ENTRIES,
})

/**
 * Every playbook this build can register.
 *
 * A list rather than a lookup by id alone, because registration is keyed on
 * `(id, version)` and two versions of one playbook coexist by design. The
 * highest version is the default for NEW cases; existing cases are unaffected.
 */
export const COMPILED_PLAYBOOKS: readonly CasePlaybook[] = Object.freeze([
  MACRO_REGIME_PLAYBOOK,
  MACRO_REGIME_PLAYBOOK_V2,
])
