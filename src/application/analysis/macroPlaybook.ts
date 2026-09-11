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
 * Version 3 — the same workflow again, with the breaker recalibrated for
 * curve-scale evidence.
 *
 * **Why a third version rather than an edit.** The same rule that produced v2:
 * registration is append-only and a budget is inside `playbookContentHash`.
 * Editing v2 in place would give two cases different authorizations under one
 * name, and only the order they started in would say which. **v1 and v2 are
 * unchanged**, and every case pinned to either keeps exactly what it pinned —
 * including the two failed C3 Stage C runs, which stay readable against the
 * 12,000 they were actually judged against.
 *
 * **Why 24,000, and why that is not an estimate of expected spend.** The C3
 * Stage C exit measured what v2's figure was calibrated on and what it was not:
 *
 *   the two runs that set it   1,562 and 1,459 tokens, against ONE observation
 *   a 60-item term structure   refused at 12,000; input alone > 7,904
 *   the 264-item full window   ≈ 28,350 input tokens before any output
 *
 * v2's 12,000 was ~8× headroom over one-observation runs, decided before any
 * curve existed. Curve-scale evidence is not pathology — it is the capability
 * C3 was built to deliver — so the breaker was firing on normal operation,
 * which is precisely the failure the note above warns about: *a limit set near
 * expected usage destroys work the firm already paid for.*
 *
 * So 24,000 is **2× the pre-curve breaker**, chosen for material headroom over
 * the normal shape rather than fitted just above it. It is deliberately NOT
 * derived from the exact consumption of the refused run — that measurement was
 * discarded by the defect this stage fixed, and fitting a limit to a number the
 * firm could not read would be inventing precision.
 *
 * **It is still a circuit breaker, and it still breaks.** The 264-item
 * full-serialization shape needs ≈ 28,350 input tokens before output, so it
 * remains refused at 24,000. A limit that admitted every shape the firm can
 * render would authorize the pathology instead of catching it.
 *
 * **Deadline and money are unchanged, and the reason is measured.** The refused
 * run's provider call completed in 66.156 s inside a 90 s authorization, so
 * there is no basis to move the deadline. The monetary figure remains an
 * authorization rather than a control, for the reason stated above: the
 * Messages API reports no price, so nothing can verify compliance with it.
 */
const MACRO_ANALYSIS_BUDGET_V3 = Object.freeze({
  tokens: 24_000,
  cost: Object.freeze({ costMinorUnits: 100, currency: 'USD' }),
  deadlineMs: 90_000,
})

const MACRO_REGIME_V3_ENTRIES: readonly PlaybookEntry[] = Object.freeze(
  MACRO_REGIME_ENTRIES.map((entry) =>
    entry.key === 'macro-analysis'
      ? Object.freeze({ ...entry, budget: MACRO_ANALYSIS_BUDGET_V3 })
      : entry,
  ),
)

export const MACRO_REGIME_PLAYBOOK_V3: CasePlaybook = Object.freeze({
  id: 'macro-regime',
  version: '3',
  caseKind: MACRO_REGIME_CASE_KIND,
  name: 'Macro regime assessment',
  entries: MACRO_REGIME_V3_ENTRIES,
})

/**
 * Version 4 — the same authorization again, with the run envelope widened to
 * the latency curve-scale evidence actually has.
 *
 * **Why a fourth version.** Same rule as v2 and v3: registration is
 * append-only and the budget is inside `playbookContentHash`. **v1, v2 and v3
 * are unchanged**, and all three failed C3 Stage C runs stay readable against
 * the envelopes they were actually judged against.
 *
 * **Only the deadline moves.** Tokens stay at the 24,000 breaker v3 set and
 * money stays at $1.00 — neither was implicated. The third exit attempt never
 * reached a usage measurement at all, so nothing about the token limit was
 * tested, let alone found wanting.
 *
 * **Why 180,000 ms, as an envelope calibration rather than an expected
 * duration.** The measured facts, from two runs of a byte-identical 60-item
 * request:
 *
 *   one successful attempt        66.156 s
 *   backoff before a retry        <= 500 ms (floor(random x 500) at attempt 1)
 *   a run that retried once       terminated by the shared 90 s deadline
 *
 * The deadline is shared across attempts, so a first attempt that fails after
 * a normal-length call leaves the second one less time than the first needed.
 * At 90,000 ms one attempt already consumed 73.5% of the envelope, which made
 * the retry policy unusable in practice: a second attempt could essentially
 * never fit behind a first.
 *
 * So the envelope is sized to hold **one normal attempt plus one full retry**:
 * 66.2 + 0.5 + 66.2 = 132.9 s, and 180,000 ms leaves ~47 s of headroom above
 * that. 150,000 ms was considered and rejected as sitting too close to the
 * measured two-attempt requirement.
 *
 * **It is deliberately NOT sized to guarantee three full attempts.**
 * `maxAttempts: 3` is a ceiling on how many times the pipeline may try inside
 * the authorized envelope — not a promise that the envelope will hold three
 * full-length calls. The per-run deadline remains the superior circuit
 * breaker, and widening it to ~210s+ to guarantee three would weaken it for
 * the sake of a count that was never the control.
 *
 * **This is not an expected-duration target.** A run that takes 180 s is not
 * behaving as designed; it is being caught. The expected shape is one attempt
 * at roughly 66 s.
 *
 * **The synchronous path was checked before this was raised, not after.**
 * `stageDeadlineMs` is read off the resolved budget rather than fixed in code,
 * `vite.config.ts` configures no server timeout, neither Vite nor TanStack
 * Start overrides Node's, and Node's own `requestTimeout` is 300,000 ms with
 * the socket timeout disabled. A 185 s request was held open end to end on
 * this runtime and completed. Commissioning stays synchronous, by ruling.
 */
const MACRO_ANALYSIS_BUDGET_V4 = Object.freeze({
  tokens: 24_000,
  cost: Object.freeze({ costMinorUnits: 100, currency: 'USD' }),
  deadlineMs: 180_000,
})

const MACRO_REGIME_V4_ENTRIES: readonly PlaybookEntry[] = Object.freeze(
  MACRO_REGIME_ENTRIES.map((entry) =>
    entry.key === 'macro-analysis'
      ? Object.freeze({ ...entry, budget: MACRO_ANALYSIS_BUDGET_V4 })
      : entry,
  ),
)

export const MACRO_REGIME_PLAYBOOK_V4: CasePlaybook = Object.freeze({
  id: 'macro-regime',
  version: '4',
  caseKind: MACRO_REGIME_CASE_KIND,
  name: 'Macro regime assessment',
  entries: MACRO_REGIME_V4_ENTRIES,
})

/**
 * Version 5 — a second analytical desk, and synthesis that waits for both.
 *
 * Every earlier version had ONE desk capable of speaking about rates. A firm
 * with one such desk cannot disagree with itself: it could record objections
 * from its control functions, and never a substantive disagreement between two
 * people who both know the subject. Migration 0035 seated Rates; this is the
 * workflow that puts it to work.
 *
 * ## The dependency that carries the meaning
 *
 *     macro-analysis ──┐
 *                      ├──> aggregation ──> peer-examination
 *     rates-analysis ──┘
 *
 * **`rates-analysis` is blocked by nothing, and that is an invariant of this
 * version rather than a scheduling convenience.** Macro and Rates form their
 * initial views independently. A desk that reads Macro's conclusion first and
 * then responds to it produces peer commentary; a desk that reached its own
 * view and *then* finds it differs has produced a disagreement worth having.
 * The point is epistemic independence before synthesis, not parallelism — so
 * no Macro output, no aggregation output and no other desk's conclusion may
 * ever become an input dependency of this entry.
 *
 * **`aggregation` waits for both.** Rates is required, so the Research Office
 * must not synthesise before the Rates view exists — otherwise a required
 * analysis could land after the thesis it was supposed to inform. This is a
 * deliberate change to the institutional workflow: two independent analytical
 * desks, then synthesis, then examination.
 *
 * Quant keeps exactly the relationship v4 gave it. It is an optional input to
 * aggregation and is not redesigned here.
 *
 * **`peer-examination` waits for `aggregation`**, because it examines a
 * revision and a revision does not exist until the manager has made one.
 * `placeVerdict` already refuses a verdict on a `proposed` or `under-analysis`
 * revision — a verdict on work nobody has finished is a verdict on a draft —
 * and the graph respects that lifecycle rather than scheduling work the
 * command would reject.
 *
 * ## Rates performs two DIFFERENT acts, and they are not collapsed
 *
 * `rates-analysis` is Rates forming its own view. `peer-examination` is Rates
 * reading the synthesised revision afterwards and saying whether it agrees.
 * The same department, two entries, because they answer different questions at
 * different points in the argument.
 *
 * The second act never rewrites the first. If Rates disagreed initially and
 * the aggregation reconciled that disagreement persuasively, Rates may examine
 * the revision and raise nothing — and **zero challenges is a real finding**,
 * not manufactured consensus and not a reason for anyone's confidence to rise.
 * If the revision still rests on a claim Rates considers materially
 * unsupported, it challenges that exact `ClaimId`.
 *
 * ## Everything else is carried forward untouched
 *
 * v4's run budget on `macro-analysis`, the conditional Risk rule, and every
 * existing assignment are byte-identical. v1 through v4 are unchanged and stay
 * readable against the workflows their cases actually pinned.
 */
const RATES_ANALYSIS: PlaybookEntry = Object.freeze({
  key: 'rates-analysis',
  departmentId: 'rates',
  brief:
    'Form an independent view of the rates market for the subject: the ' +
    'policy path priced, nominal and real curve structure, inflation ' +
    'compensation, and what the curve is attributing the move to. Do not ' +
    'reconcile with another desk; state your own view and what would change it.',
  /*
   * Nothing. See the note above: this is epistemic independence, and adding a
   * dependency here would quietly convert a second opinion into a response.
   */
  blockedBy: Object.freeze([]),
  optionalInputs: Object.freeze([]),
  requirement: 'required',
  /* The same standing as `macro-analysis`: a primary analysis, not a check. */
  priority: 100,
  disciplineTag: 'rates',
})

const PEER_EXAMINATION: PlaybookEntry = Object.freeze({
  key: 'peer-examination',
  departmentId: 'rates',
  brief:
    'Read the synthesised revision as a qualified peer. Say on the record ' +
    'whether you agree. Challenge any claim you consider materially ' +
    'unsupported, naming the claim; if the argument survives your reading, ' +
    'record that you examined it and raised nothing.',
  /* A revision has to exist to be examined. See `placeVerdict`. */
  blockedBy: Object.freeze(['aggregation']),
  optionalInputs: Object.freeze([]),
  requirement: 'required',
  /* Alongside the other reviews of a completed revision. */
  priority: 70,
  disciplineTag: 'rates',
})

const MACRO_REGIME_V5_ENTRIES: readonly PlaybookEntry[] = Object.freeze([
  ...MACRO_REGIME_V4_ENTRIES.map((entry) =>
    entry.key === 'aggregation'
      ? Object.freeze({
          ...entry,
          /* Both analytical desks, because both are required. */
          blockedBy: Object.freeze(['macro-analysis', 'rates-analysis']),
        })
      : entry,
  ),
  RATES_ANALYSIS,
  PEER_EXAMINATION,
])

export const MACRO_REGIME_PLAYBOOK_V5: CasePlaybook = Object.freeze({
  id: 'macro-regime',
  version: '5',
  caseKind: MACRO_REGIME_CASE_KIND,
  name: 'Macro regime assessment',
  entries: MACRO_REGIME_V5_ENTRIES,
})

/**
 * What the firm authorizes the Research Office to spend on one synthesis, as a
 * **proposal**.
 *
 * The first of the three budget sources again, for a second kind of work. **Not
 * the firm's hard global ceiling** — TD-76 is still open and this does not
 * close it — and not a per-case constraint either: a case may still constrain
 * below this, because resolution is a minimum across every source that speaks.
 *
 * Approved 2026-09-07 from measurement rather than from the desk figure it
 * would have been convenient to copy. A synthesis prompt is not an evidence
 * briefing: `synthesisContext` gives the model the question, the argument on
 * the table and the claim IDS of each accepted contribution, and never the
 * observations. So its input scales with how many claims the desks produced,
 * not with how much evidence they read. Counted with the provider's own token
 * counter, against the real `aggregation` brief:
 *
 * | shape | input | + 4,096 output cap |
 * |---|---|---|
 * | 1 + 1 claims | 1,277 | 5,373 |
 * | 7 + 7 claims — the median desk run on record | 1,721 | 5,817 |
 * | 14 + 14 claims — the largest desk run on record | 2,239 | 6,335 |
 * | 50 + 50 claims — stress | 4,903 | 8,999 |
 * | 250 + 250 claims — pathology | 19,403 | 23,499 |
 *
 * **12,000 is deliberately not fitted just above the measurement.** It is
 * ~1.9x the largest shape any real pair of desk runs has produced, and it still
 * refuses the pathology — which is what a circuit breaker is for. A limit set
 * near expected usage destroys work the firm has already paid for, which is the
 * rule the `macro-analysis` note above states and the defect C3 Stage C
 * measured.
 *
 * **The `+ 4,096` column above is superseded, and the 12,000 is not.** The
 * table was computed against the desk answer cap, which the first live
 * synthesis proved too small for this kind of work: a synthesis must account
 * for every claim it is given, so its ANSWER grows with the argument, and
 * 4,096 truncated it mid-string three times. The cap is now
 * `LIVE_SYNTHESIS_MAX_OUTPUT_TOKENS` (8,192), measured on that run, and the
 * arithmetic to read this table with is `input + 8,192`.
 *
 * The authorization does not move, because it does not need to: the real run
 * spent 1,989 + 5,512 = **7,501**, and the cap's worst case for the median and
 * largest recorded shapes stays inside 12,000. What the larger cap does narrow
 * is how big an argument this budget admits — the 50 + 50 stress shape now
 * reaches 4,903 + 8,192 = 13,095 and would overrun. That is a **measured
 * consequence recorded rather than papered over**: no pair of desks has
 * produced 100 claims, and if one ever does, the answer is a new version whose
 * budget was computed against the real cap, not a number widened here in
 * anticipation.
 *
 * **The deadline is v4's envelope, reused rather than invented.** Same model,
 * same shared-deadline retry arithmetic, so the calibration v4 recorded — one
 * normal attempt at 66.156 s plus one full retry — transfers without a new
 * number. Since measured: the first successful live synthesis of 31 claims
 * returned inside the envelope, and the failing 4,096-cap attempt took 144.752 s
 * across three attempts without exhausting it. TD-82 still applies — this is
 * single-sample calibration, which is what the firm is living with.
 *
 * **The monetary figure is an authorization, not a control**, for the reason
 * `MACRO_ANALYSIS_BUDGET` states: the Messages API reports token counts and no
 * price, so `budgetOverruns` can never evaluate it. It is named because
 * `budgetPermitsStart` refuses a live run with an unmeasured dimension.
 */
const RESEARCH_OFFICE_SYNTHESIS_BUDGET = Object.freeze({
  tokens: 12_000,
  cost: Object.freeze({ costMinorUnits: 100, currency: 'USD' }),
  deadlineMs: 180_000,
})

/**
 * Version 6 — the analytical path to a synthesis, authorized to run live.
 *
 * **Why a sixth version.** The rule that produced v2, v3, v4 and v5:
 * registration is append-only and a budget is inside `playbookContentHash`.
 * Editing v5 in place would give two cases different authorizations under one
 * pin, and only the order they started in would say which. **v1 through v5 are
 * unchanged**, and every case pinned to one of them keeps exactly what it
 * pinned — including the authorizations that must keep refusing live work.
 *
 * **The workflow itself does not move.** Same case kind, same desks, same
 * requirement classes, same `blockedBy`, same optional inputs, same conditional
 * Risk rule, same Rates peer examination, same governance and the same CIO
 * boundary. Aggregation still waits for BOTH analytical desks — `macro-analysis`
 * AND `rates-analysis` — and that dependency is not relaxed to make an
 * autonomous run easier to reach. Two entries change, and each changes only by
 * acquiring a budget.
 *
 * **`rates-analysis` reuses the desk envelope v4 approved, rather than a second
 * number.** Measured 2026-09-07 with the provider's own token counter, against
 * every evidence set the firm actually holds:
 *
 * | set | observations | macro input | rates input | rates + output cap |
 * |---|---|---|---|---|
 * | `7b454f28` | 60 | 15,531 | 15,562 | 19,658 |
 * | `968b4c1c` | 24 | 5,282 | 5,313 | 9,409 |
 * | `11aaa8c3` | 1 | 892 | 923 | 5,019 |
 * | `c0d6bcba` | 264 | 65,902 | 65,933 | 70,029 |
 *
 * The two desks read the same sets through the same provider, the same system
 * prompt and the same evidence briefing; the entire difference between them is
 * the length of their briefs — **31 tokens**. So `MACRO_ANALYSIS_BUDGET_V4`
 * covers the Rates desk unaltered, and it is **reused rather than copied under
 * a desk-specific name**: two constants holding identical values would be two
 * things to keep in step, and a divergence between them would be silent.
 *
 * **The breaker still breaks.** The 264-observation full window needs 70,029
 * tokens for one attempt and stays refused at 24,000, for both desks. That
 * measurement also corrects the estimate in v3's note — it recorded ≈28,350
 * input tokens for that shape; counted rather than estimated, it is 65,902.
 *
 * **What v6 deliberately does NOT authorize.** `quant-validation`,
 * `verification`, `challenge`, `risk-review` and `peer-examination` carry no
 * budget and therefore still refuse to start live. Those autonomy boundaries
 * have not been opened by anyone, and a version that budgeted every entry it
 * happened to contain would be authorizing autonomy nobody approved. What this
 * version authorizes is exactly one path: **Macro and Rates form independent
 * views, and the Research Office synthesises them.**
 */
const MACRO_REGIME_V6_ENTRIES: readonly PlaybookEntry[] = Object.freeze(
  MACRO_REGIME_V5_ENTRIES.map((entry) => {
    if (entry.key === 'rates-analysis') {
      return Object.freeze({ ...entry, budget: MACRO_ANALYSIS_BUDGET_V4 })
    }
    if (entry.key === 'aggregation') {
      return Object.freeze({ ...entry, budget: RESEARCH_OFFICE_SYNTHESIS_BUDGET })
    }
    return entry
  }),
)

export const MACRO_REGIME_PLAYBOOK_V6: CasePlaybook = Object.freeze({
  id: 'macro-regime',
  version: '6',
  caseKind: MACRO_REGIME_CASE_KIND,
  name: 'Macro regime assessment',
  entries: MACRO_REGIME_V6_ENTRIES,
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
  MACRO_REGIME_PLAYBOOK_V3,
  MACRO_REGIME_PLAYBOOK_V4,
  MACRO_REGIME_PLAYBOOK_V5,
  MACRO_REGIME_PLAYBOOK_V6,
])
