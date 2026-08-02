# Technical Debt & Future Improvements

The register of everything intentionally deferred. Nothing is silently
postponed: if a phase chose not to do something, it is written here with the
reason and the preferred resolution.

Ordered by the phase that incurred the debt. Items are removed only when
resolved, never when they become inconvenient.

---

## TD-1 · MCP child-process warm-up

**Incurred:** Watchlist migration. **Severity:** medium. **Blocks:** nothing.

The snapshot deadline was raised from 3s to 6s. That is an **operational
workaround, not the desired architecture**, and it is recorded here so it does
not quietly become the new normal.

Measured on the Watchlist route:

|                                                         |         |
| ------------------------------------------------------- | ------- |
| cold — `uvx` spawn + 7 MCP round trips at concurrency 4 | 3271 ms |
| warm — cache hit                                        | 1 ms    |

The cost is dominated by spawning a Python child process, not by Avanza. A 3s
budget therefore failed the first request after every restart and passed every
one after — the worst possible profile.

**Preferred resolution:**

1. pre-warm the `avanza-mcp` child process at container construction
2. keep the connection alive between requests, with health checking and
   restart-on-death
3. re-measure, and return `DEFAULT_SNAPSHOT_BUDGET_MS` to ~3s

**Rule:** deadlines do not ratchet upward. Any future increase requires a
measurement and an entry here, and the standing intent is to bring this one
back down.

---

## TD-2 · Real intraday and historical series

**Incurred:** Phase 0, deepened at Phase 5 and Watchlist. **Severity:** medium.
**Blocks:** sparklines and the intraday chart showing anything in live mode.

The `series` capability has no live provider. Sparklines and the "Utveckling
idag" chart are fixture-only, so in live mode they render empty — correctly,
but emptily. Three call sites still reach past the port interface with
`provider as unknown as FixtureProvider`, documented at each site.

**Preferred resolution:** a real `SeriesProvider`, at which point the three
casts become ordinary port calls and the Watchlist's unified demo gate lets
real history through unconditionally.

---

## TD-3 · International index coverage (decision D1)

**Incurred:** Phase 0. **Severity:** medium — now **visible in the product**.
**Blocks:** S&P 500 and Nasdaq 100 showing a number in live mode.

`equity-index-intl` is fixture-only. No approved source exists for the five
international indices, and the two candidate approaches — a licensed vendor
such as Twelve Data, or index ETFs as proxies — were deferred pending D1.

Proxies additionally oblige the presentation layer to disclose the
substitution; `isProxy` and `proxyNote` exist in `Provenance` for exactly this
and are currently unused.

Since the Markets migration this is no longer invisible: both rows render
`Ej tillgänglig` in live mode. They were deliberately kept rather than removed,
so the gap is visible to a reader and the rows remain the landing place for
whatever D1 approves. Substituting an ETF proxy requires explicit approval.

---

## TD-4 · TradingView as a visualization layer

**Incurred:** Phase 4 investigation. **Severity:** low. **Blocks:** nothing.

Recorded precisely, because the framing matters: **TradingView is not a market
data source.** Their Charting Library documentation states the integrator
connects their own data, and the Datafeed API is an interface _we_ would
implement. There is nothing to adapt as a provider, which is why no
`TradingViewProvider` exists and why the import graph asserts none appears.

What remains genuinely open is TradingView as a **charting front end fed by our
own provenance-carrying data**. That is a presentation decision, evaluated on
its merits against the current recharts implementation, and it would not change
where a single number comes from.

Constraints from the original investigation still stand: no scraping, no
browser automation, no private or undocumented endpoints, no community
wrappers, no redistribution of TradingView-sourced data.

---

## TD-5 · Operational endpoints are built but unexposed

**Incurred:** Phase 3.5. **Severity:** high. **Blocks:** production launch.

`renderPrometheus` and the aggregate health check exist, are tested, and are
reachable only through POST server functions guarded by a shared operator
token. No `/metrics` or `/health` route exists, so a deployment would be blind
to breaker state, budget consumption and provider degradation — with the data
already being collected.

**Preferred resolution:** expose both behind the operator token; roughly half a
day. The token itself is a temporary measure and should move behind real
authentication (TD-8).

---

## TD-6 · Shared cache store for multi-instance deployment

**Incurred:** Phase 1, hardened during the consolidation phase.
**Severity:** high. **Blocks:** any multi-instance production deployment.

The container is a module singleton over `MemoryCacheStore`, so budgets,
breakers and rate limits are per process. Live mode now _refuses to start_ with
`instanceCount > 1` and a non-shared store — correct, and it also means the
system cannot scale horizontally at all.

**Preferred resolution:** implement the KV `CacheStore`. The interface exists
and is unused.

---

## TD-7 · The legacy stack (C1)

**Incurred:** pre-Phase-0. **Severity:** critical. **Blocks:** production
launch.

~6,700 LOC across `services/`, `data/` and `types/` with almost no tests, and a
second data model. Frozen by a fitness rule that pins the consumer list; the
count is the migration metric.

| Milestone              | Freeze list |
| ---------------------- | ----------- |
| Freeze                 | 13          |
| AppHeader migrated     | 13 → 13\*   |
| **Watchlist migrated** | **13 → 12** |
| **Markets migrated**   | **12 → 11** |
| Agents                 | 11 → 10     |
| Reports                | 10 → 9      |
| Portfolio              | 9 → 8       |

\* AppHeader was removed from the list in the same commit that created it.

The residue after all five routes — `services/investmentLetter`,
`avanzaMcpAdapter`, `mockFixtures`, `types/` — retires with the AI and
portfolio phases, not with the route migrations.

---

## TD-8 · Authentication

**Incurred:** never built. **Severity:** high. **Blocks:** portfolio modes 2
and 3, per-user agents, personal watchlists, production launch with any private
data.

There is no session, no user and no authorization anywhere. Health and metrics
sit behind a shared operator token that the code itself describes as "a
narrowly scoped temporary measure, not an authorization model".

---

## TD-9 · Authenticated personal watchlists

**Incurred:** Watchlist migration (D44). **Severity:** low. **Depends on:**
TD-8.

The curated six-instrument list is product state, not user state, and the page
now says so. A real watchlist needs identity, owned persistence, add/remove,
canonical instrument selection, synchronization and conflict handling. The
"Egen bevakningslista – kommer senare" control is the placeholder, deliberately
non-interactive.

---

## TD-10 · Portfolio modes

**Incurred:** documented in `data-architecture.md` Part X. **Severity:** medium.
**Depends on:** TD-8 for modes 2 and 3.

`avanza-mcp` wraps a public unauthenticated API, so no source can make the
current portfolio real. Three modes are documented — demo, manually managed,
connected — and only mode 1 is in scope for the C1 migration. Mode 1 still owes
portfolio values real provenance so "this is synthetic" travels with the
numbers rather than sitting beside them in prose.

---

## TD-11 · AI agent platform

**Incurred:** pre-Phase-0 prototype, reviewed in the AI architecture review.
**Severity:** high for the product, zero for current correctness.

The eleven-agent pipeline in `services/investmentLetter` is a **product
specification and prototype**, not the runtime architecture. Its prose-in /
prose-out contracts would destroy provenance at the first agent boundary.

Preserved for their value: agent roles, responsibilities, output concepts,
compliance rules, editorial flow. Explicitly _not_ preserved: the accumulating
mutable context and the prose-only contracts.

Sequenced as AI Phase A (contracts and evidence identity), Phase B (evidence
read model and runtime), Phase C (one real agent end to end, Macro first).

The future organization is institutional rather than a flat collection of
agents: specialists report to managers, managers aggregate, the CIO receives
summarized reports. Two governance agents are mandatory, independent, and
authorized to block publication — the **Devil's Advocate** (challenges
assumptions, seeks alternative explanations, identifies bias) and the
**Verification Agent** (validates facts, calculations, units, currencies, basis
points, DCF models, and that summarization lost nothing).

---

## TD-14 · Market Intelligence

**Incurred:** Markets migration. **Severity:** medium. **Blocks:** the
Marknadsklimat card showing anything.

The card's four fabricated statistics were removed — a breadth percentage, an
MA50 streak, an implied-volatility comparison and a volume assessment. All four
read as measurements and none was computable. The card survives as the landing
place for a genuine **Market Intelligence panel**, whose purpose is to
synthesize a view of the current market regime rather than list disconnected
indicators.

Each input is its own missing capability:

| Input                                               | Missing                                         |
| --------------------------------------------------- | ----------------------------------------------- |
| Market breadth, % rising or falling                 | OMXS30 constituent data                         |
| % above moving averages, new highs/lows             | constituents plus real historical series (TD-2) |
| Volatility and term structure                       | options data                                    |
| Options positioning                                 | positioning data                                |
| Liquidity, volume breadth                           | volume history                                  |
| Capital and fund flows, positioning                 | flow data                                       |
| Sentiment                                           | a sentiment source, or a derived model (D7)     |
| Macro regime, policy, yield curves                  | **already built** — Phase 4B and 6A             |
| Quant models, technical analysis, relative strength | the Quant & Technical Analysis Agent (TD-11)    |
| Risk regime, cross-asset confirmation               | composition across the above                    |

The destination is **not** an anonymous calculation function. Specialist agents
— Quant & Technical Analysis, Global Macro, Market Sentiment, Flow and
Positioning, Volatility and Options, Liquidity — should provide structured
claims and evidence to a **Market Intelligence Manager**, which aggregates,
compares and reconciles before reporting upward to the CIO/CEO layer. See
TD-11 for the organization and its two independent governance agents.

Note the asymmetry worth exploiting later: macro regime, central-bank policy
and yield curves are the one input group already built to institutional
standard. A first Market Intelligence increment could be genuine on those
alone, rather than waiting for all ten.

---

## TD-15 · Bitcoin in SEK, as a derived observation

**Incurred:** Markets migration (D46). **Severity:** low. **Blocks:** nothing.

Bitcoin renders as `Bitcoin (USD)`. The legacy mock showed a SEK figure, and
reproducing it needs BTC/USD × USD/SEK — the product's **first derived market
observation**. That requires aligned timestamps between two providers, a
documented calculation methodology, derived provenance carrying the weaker of
the two trust levels and qualities, and a display policy.

Deliberately not introduced to preserve a mock's currency choice. If a SEK view
is wanted, it should be designed on its own terms.

---

## TD-16 · Agents route migration

**Incurred:** AI Phase A. **Severity:** medium. **Depends on:** AI Phase B.

Deferred deliberately so the route migrates **once**, onto the real contracts,
rather than getting a fixture-backed model now that Phase A/B would replace.
The route stays on `data/mockData` until then and remains on the freeze list.

Phase A proved the contracts can carry every field the future page needs —
identity, role, department, manager, reporting line, assignment, run status,
timestamps, evidence-set ref, prompt and model version, claim count,
confidence, verification / Devil's Advocate / compliance status, escalation,
latest approved report and blocking reason.

**Permanent product requirement, now pinned by a fitness rule:** `Agenter`
stays a first-class sidebar destination at `/agents`. It is the digital
headquarters of Financial OS — one shared organization, expand-in-place, never
a modal, a settings page or a subsection of Reports.

---

## TD-17 · Agents page interim honesty

**Incurred:** pre-Phase-0, surfaced during AI Phase A. **Severity:** medium.

Two things, both waiting for the Agents migration rather than an interim
redesign (an explicit decision — migrate once, not twice):

1. **The page implies live work.** "Dina agenter, vad de gör just nu" over
   fixtures with `status: 'running'`, `progress: 64` and `lastRunAt`
   timestamps. Nothing marks it as a prototype, which the interim rule
   requires.
2. **The same destination has two names.** `lib/navigation.ts` says `Agenter`;
   the Overview's own nav column (`LightCommandCenter.tsx`) labels `/agents`
   as `Analys`. A one-line fix in a locked file, scheduled rather than taken.

---

## TD-18 · AI Phases B and C

**Incurred:** AI Phase A. **Severity:** high for the product.

Phase A shipped contracts and nothing that runs. Still to come:

**Phase B — evidence read model and runtime.** EvidenceSet builders,
domain-to-evidence mapping, dependency-graph orchestration, stage isolation and
deadlines, partial-run semantics, deterministic run records, immutable
content-addressed result storage keyed by `runCacheKey`, cost and token
budgets, cancellation, retry, recorded-output testing, mechanical citation
verification.

**Phase C — the first real agent.** Macro first, because its evidence already
exists at institutional quality: government yields, curves, central-bank policy
state and FX. One agent end to end — versioned prompt, pinned model, structured
claims, citations, confidence propagation, compliance validation, cost and
latency tracking, content-addressed caching, a recorded golden run and
deterministic replay. Not eleven agents at once.

Also deferred: LLM-provider integration, model-cost controls, agent
persistence, real run history, manager orchestration, report approval flows,
notifications, persistent memory with provenance, and MCP **server** exposure
(gated on authentication, TD-8).

---

## TD-19 · Durable storage for the analysis runtime

**Incurred:** AI Phase B. **Severity:** critical. **Blocks:** AI Phase C, and
any real agent-generated analysis.

Phase B ships repository **ports** with a single **in-memory** adapter. It is
process-local: a restart loses every case, thesis revision, evidence set,
assignment, run, review, challenge, decision and transition event.

That is acceptable for a deterministic runtime prototype with no live agents.
It is not acceptable for real analysis, user-owned work or production.

**This is a hard gate before Phase C.** Durable storage must exist for at
least: InvestmentCases, thesis revisions, EvidenceSets, Assignments,
AgentRunRecords, reviews and challenges, CaseDecisions, activity transitions,
and immutable agent results.

It does **not** depend on authentication. A system-level durable repository can
exist before users do; authentication later adds ownership, access, tenancy and
permissions on top. The storage technology is its own planning gate.

The ports were shaped with a durable adapter in mind — optimistic concurrency
on `save`, idempotent creates, append-only events, write-once results — so the
swap should be an adapter, not a redesign.

**Migration progress** (plan: `docs/durable-storage-plan.md` §14):

| Stage                                     | State        |
| ----------------------------------------- | ------------ |
| 0 · transaction-capable ports             | done         |
| 1 · schema and migrations                 | done         |
| 1.5 · revision-scoped governance reviews  | done         |
| 2 · PostgreSQL adapter                    | done         |
| 2.1 · review corrections                  | done         |
| 3 · dual write                            | **deferred** |
| 4 · read verification                     | **deferred** |
| 5 · read switch                           | **deferred** |
| 6 · in-memory out of the composition root | superseded   |

Stage 6 is superseded rather than pending: in-memory was never wired into the
composition root, so there is nothing to remove. It stays as the unit-test
reference adapter and the parity oracle, which was always its post-cutover
role.

Stage 0 closed the two gaps the plan opened with: the ports had no transaction
boundary, and no list method defined an ordering. Both are now on the port and
enforced by the in-memory adapter, which becomes the reference implementation
PostgreSQL is verified against in stage 4.

Stage 1 built the schema, the migration runner and the seeded organization,
verified by integration tests against real PostgreSQL 18.4. Stage 2 built the
adapter; stage 2.1 corrected ten defects an architecture review found, five of
them confirmed divergences between the two stores.

**Stages 3–5 are deferred, not skipped.** Dual write, shadow read verification
and a gradual read switch migrate an _active stateful runtime_; nothing writes
to any store today, the in-memory state is empty after every restart, and there
is no accumulated history, traffic or rollback exposure. The design is retained
in `docs/dual-write-plan.md` for a future migration. The revised sequence makes
PostgreSQL authoritative from the first real command — see `docs/phase-c-plan.md`.

This item stays open until that wiring exists.

---

## TD-21 · Reviews attached to a thesis lineage, not to a revision — RESOLVED

**Incurred:** storage stage 1. **Resolved:** storage stage 1.5.
**Was:** a correctness blocker on stage 2.

The four review types carried `thesisId` — the **lineage** — and no
`revisionId`. Once revision 2 existed, "verification approved thesis-1" did not
say which argument was approved, and the schema's guarantee that a sealed
revision cannot be edited bought nothing if the review never named the revision
it read. A consumer could reasonably have treated a lineage-level approval as
approval of the current revision, which is the failure the whole revision model
exists to prevent.

Resolved by modelling scope explicitly rather than by adding an optional field.
A review is now exactly one of two shapes — case-wide, or attached to one exact
immutable revision — and the illegal combinations do not typecheck and do not
insert. Migration `0011` carries the constraints; `docs/durable-storage-plan.md`
§3 is superseded on this point by the shape the code now uses.

One thing found while proving it, worth remembering: TypeScript's
excess-property check accepts a property present on **any** arm of a target
union, so omitting `revisionId` from the case-wide arm was not enough to stop a
case-wide literal carrying one. The arm declares `revisionId?: never`
explicitly, and a test holds that in place.

---

## TD-24 · Storage provenance is exposed but not recorded

**Incurred:** storage stage 2. **Severity:** medium. **Blocks:** nothing today;
wanted before Phase C produces analysis worth auditing.

`AnalysisRepositories.provenance()` reports four coordinates — adapter and
version, query-catalogue hash, schema version and checksum, domain contract
version. Nothing **stores** them alongside a result, so a stored analysis is
still not traceable to the code that wrote it.

The structural half was done now because it is the expensive half later: the
catalogue hash is computable only while every statement is enumerable, so the
SQL lives in frozen per-repository catalogues and a fitness rule keeps it there.
Retrofitting that once statements were inlined at forty call sites would have
been a refactor of the whole adapter.

The recording half was deferred because it needs columns on `runs` and
`agent_results` that nothing would populate until a real agent writes a real
result — and the schema principles rule out columns added speculatively.

**Preferred resolution, designed and fixed:** a `storage_provenance` table keyed
on the hash of the four coordinates, with `runs` and `agent_results` carrying a
foreign key to it. That keeps the repeated coordinates out of every result row
while making the join exact.

**One honest limitation.** `adapterVersion` is a hand-maintained constant, so it
is only as good as the discipline of bumping it when the mapping code changes.
`queryCatalogHash` covers the SQL automatically; nothing covers the mapping. A
fitness test tying the constant to any change in the adapter directory would be
noise, so this is recorded as an obligation instead.

---

## TD-25 · Evidence payload integrity is checked on write, not on read

**Incurred:** storage stage 2. **Partly resolved:** stage 2.1.
**Severity:** low.

**Incurred:** storage stage 2. **Severity:** low.

Reading an evidence set recomputes its content hash and refuses a mismatch, so
an item added, removed, or repointed at different content is caught. The hash
covers `[observationId, contentHash]` per item — the **composition** — and not
the payloads.

So a `value` edited without its `contentHash` being updated to match is not
detected. Verifying each item's hash against its value on every read would
catch it; that was not done because a legitimate value could hash differently
after a jsonb round trip and break reads that are fine.

Stage 2.1 closed the **write** path: `evidenceSetSemanticKey` compares the
stored payloads against the incoming ones, so two sets sharing an id and
holding different values now raise `ConflictingRecordError` in both adapters
rather than one silently winning.

What remains open is the **read** path. A payload edited directly in the
database, with its `content_hash` left alone, is still not detected on read.

**Preferred resolution:** verify item hashes during stage 4 read verification,
where a divergence is investigated rather than thrown, and promote it to a read
check only if it proves stable against jsonb round-tripping.

---

## TD-26 · Actor identity is asserted, not authenticated

**Incurred:** Phase C1A. **Severity:** high. **Blocks:** any user-triggered
command.

Every command records an actor, and the actor is **asserted by the caller**. The
model is as tight as it can be without authentication — the caller supplies only
an employee id, role and department are resolved from the seeded organization,
an unknown id is refused, and the authentication state is recorded as
`system-asserted` and never as anything else — but nothing verifies that the
caller is who it says.

A fitness rule asserts no code in the analysis layers ever writes
`authentication: 'authenticated'`, so the honest label cannot drift into a
dishonest one by accident.

**Before user-triggered commands exist, authentication and authorization must
replace asserted identity** (TD-8). The command ledger is already shaped for it:
`actor_authentication` is a column, not an assumption.

---

## TD-27 · The command ledger has no archival story

**Incurred:** Phase C1A. **Severity:** low.

Migration 0013 removed the last `DELETE` grant, so the schema now has no
deletable table. That is right for institutional records and leaves the command
ledger growing with every command ever issued — including rejections and
failures, which are the high-volume kind.

At the workload the storage plan describes this is thousands of rows a year and
not a problem. It becomes one at a different order of magnitude.

**Preferred resolution:** partition `commands` and `command_outcomes` by month
and detach old partitions to cold storage, rather than deleting. If operational
deduplication ever needs a short-lived index, add one beside the ledger — never
by deleting from it.

---

## TD-28 · Execution provenance is not yet recorded — CLOSED in C1C-1

**Incurred:** Phase C1A. **Closed:** Phase C1C-1, migration 0015.

`analysis.runs` now carries `playbook_id`, `playbook_version`,
`playbook_entry_key`, `provider_id`, `provider_version`, `provenance_id` and —
the one that matters — `provider_kind`, NOT NULL with a CHECK over
`recorded | stub | live`. A run cannot exist without saying what produced it,
so recorded fixtures and deterministic stubs stay distinguishable from live
institutional work everywhere downstream.

The employee, department and role snapshot is deliberately NOT duplicated onto
the run: the command that started it already carries the full actor snapshot,
and a second copy is a second organizational history that can disagree.

The original entry follows, for the record.

---

**Severity:** medium. **Blocks:** nothing until C1C.

Runtime provenance — adapter, derived version, build id, query-catalogue hash,
schema version, domain-contract version, command-contract version — is recorded
in `analysis.storage_provenance` and referenced by every command.

**Execution provenance is not**: the playbook id and version a command ran
under, and the contribution provider that produced a result. Both are per-run
rather than per-runtime, so they belong on `runs`, and there are no runs until
C1C.

**Preferred resolution:** add `playbook_id`, `playbook_version` and
`contribution_provider_id` to `runs` in the migration that lands the run
commands. The ledger schema already carries what references them.

---

## TD-29 · Conditional requirements have no command that resolves them — CLOSED in C1C-3

**Incurred:** Phase C1B. **Closed:** Phase C1C-3.

`RequirementResolution` existed and nothing could write one, so every
conditional gate was permanently unresolved and the distinction between "Risk
was skipped" and "Risk was forgotten" was unreachable in practice.

`ResolveConditionalRequirement` closes it, and takes **no outcome**. The result
comes from `evaluateRequirement()` over the revision's declared implications —
the only producer of a resolution — so a caller cannot supply an answer at all,
which is stronger than accepting one and rejecting a disagreement. Only a
department that HANDLES the entry's discipline may be accountable; an
orchestrator may initiate and never author.

A resolution now carries `inputHash`, a hash of the normalized rule input, so
"was this computed from the revision it names" is checkable years later without
re-running a rule version that may since have been superseded.

---

## TD-30 · Event ids supplied by the caller — CLOSED in C1C-1

**Incurred:** Phase C1B. **Closed:** Phase C1C-1.

`deriveEventId`, `deriveAssignmentId` and `deriveRunId` in
`application/analysis/commands/eventIdentity.ts` derive every record identity
from the command id, which the ledger already guarantees is stable across a
retry and unique across commands. `creationEventId`, `eventIdPrefix` and
`assignmentIdPrefix` are gone from every command input, and two fitness rules
keep them gone: no command may accept one, and no handler may build an id by
hand.

The original entry follows, for the record.

---

**Severity:** medium. **Blocks:** nothing today; blocks a public API.

`OpenInvestmentCase` takes `creationEventId`, and `InstantiatePlaybook` takes
`assignmentIdPrefix` and `eventIdPrefix`. Generating them inside the handler
would make a retry write a second set of events, so the caller must supply
stable ones — that part is right.

**What is not right is that nothing constrains them.** A caller can pass a
prefix that collides with another case's, and the only protection is the
uniqueness of the ids themselves. Inside the orchestrator this is fine, because
one code path derives them. It stops being fine the moment a command is issued
from a route.

**Preferred resolution:** derive the prefixes from the command id, which is
already required to be stable across retries and unique across commands. That
makes collision impossible rather than merely unlikely, and removes three
fields from the input. Worth doing when the first command becomes reachable
from outside the runtime.

---

## TD-31 · The playbook is chosen by the caller — CLOSED in C1C-1

**Incurred:** Phase C1B. **Closed:** Phase C1C-1.

`application/analysis/playbookRegistry.ts` owns resolution.
`InstantiatePlaybook` now takes `(playbookId, playbookVersion)` and resolves the
immutable definition this build ships; an arbitrary workflow object can no
longer be expressed as input. `resolveForCaseKind` answers which workflow is
approved for a kind of case, so a second playbook is a second entry in
`COMPILED_PLAYBOOKS` rather than a conditional in a handler.

The original entry follows, for the record.

---

**Severity:** low. **Blocks:** nothing.

`InstantiatePlaybook` receives a whole `CasePlaybook` object and validates that
its `caseKind` matches the case. The intended long-run shape is the opposite:
the case's subject kind selects the playbook, the way a discipline selects a
department, so that a new kind of case is data rather than a decision at the
call site.

`COMPILED_PLAYBOOKS` exists and holds exactly one entry, which is why this has
not bitten yet.

**Preferred resolution:** replace the input with `(playbookId, version)` and
resolve against `COMPILED_PLAYBOOKS`, once there is a second playbook to
choose between. Passing the object through is a one-playbook convenience that
would become a routing decision scattered across call sites.

---

## TD-32 · A stub or recorded run still declares a prompt and a model — CLOSED in C1C-2

**Incurred:** Phase C1C-1. **Closed:** Phase C1C-2, migration 0017.

`runs.prompt_*` and `runs.model_*` were NOT NULL, from a design in which every
run came from a model. A deterministic stub has neither, so it filled them with
placeholders — and a placeholder in a column named `model_provider` IS a real
model identity to every reader downstream, however honest the intent was.

**What landed.** A run states its execution identity as one of three shapes,
and the provider kind decides which are legal:

| identity      | carries                                     | permitted for      |
| ------------- | ------------------------------------------- | ------------------ |
| `model`       | prompt ref and model ref, both complete     | `live`, `recorded` |
| `unavailable` | `not-captured-by-recording` and a recording | `recorded`         |
| `scenario`    | scenario id and stub build version          | `stub`             |

Enforced three times over: the union gives a stub nowhere to put a model at
compile time, `buildRunRecord` refuses an identity its provider kind cannot
present, and `runs_identity_matches_provider` plus the three completeness
constraints refuse the same rows in the database. The mapper refuses to read a
row whose columns and `identity_kind` disagree, so a hand-edited row fails
rather than entering the domain as a run claiming a model nobody can name.

**Recorded work deliberately keeps a real model where it has one.** A recording
replays a contribution a real model produced; that model is the true one, and
overwriting it with a placeholder would destroy the provenance the recording
exists to preserve. `provider_kind = 'recorded'` is what keeps the replay
distinguishable from live work, and it is NOT NULL.

**What remains, and it is not this debt:** a future producer with no model at
all — a human contribution, a deterministic calculator — would need a fourth
shape. Adding one is a small union member and a CHECK; it is not worth
speculating about the shape before such a producer exists.

---

## TD-33 · Run cost and token fields are still unmeasured — REPRESENTATION CLOSED in C1C-2, ENFORCEMENT OPEN

**Incurred:** Phase A. **Severity:** low. **Blocks:** live budget enforcement.

`input_tokens`, `output_tokens`, `cost_minor_units` and `currency` were
nullable, and null had to carry three different meanings: nothing to measure,
nothing reported, or nobody looked. The ambiguity fell on the expensive side —
null reads as free.

**What landed.** A run reports its usage as one of three states:

| state            | means                                        | permitted for      |
| ---------------- | -------------------------------------------- | ------------------ |
| `not-applicable` | there was nothing to spend                   | `recorded`, `stub` |
| `not-reported`   | real work whose provider did not say         | `live`             |
| `measured`       | a measurement, **and zero is a measurement** | `live`, `recorded` |

`measured` requires every part of the measurement, in both directions: amounts
without the state would be invisible, and the state without amounts would be a
measurement nobody took. A recorded run may keep a measurement its artifact
captured; a stub may not, because there was never anything to measure; a live
call may not report `not-applicable`, because it always consumed something.
Enforced by `usagePermitted` in the domain and by
`runs_usage_matches_provider` and `runs_usage_measurement_complete` in the
database, and the mapper refuses a half-written measurement on the way out.

Recorded and stub providers still measure nothing, so every run in C1C reports
`not-applicable`. That is now the honest state rather than an ambiguous null.

**What remains — the reason this stays open:** the refusal path in C2. A
runtime that cannot measure spend cannot refuse work it cannot afford, and the
representation is only half of that. The half that landed is the half the
enforcement will read: it can now tell "this cost nothing" from "nobody
measured this", which a nullable column could not.

---

## TD-35 · No exceptional-aggregation override

**Incurred:** Phase C1C-3. **Severity:** low. **Blocks:** nothing today.

`AggregateManagerConclusion` refuses an incomplete required workflow, so a case
whose required desk cannot deliver stalls until a person acts — and the only act
available is outside the system.

That is the correct failure. Minting a manager's conclusion from work that never
arrived and labelling it blocked afterwards would put a conclusion in the record
that nobody drew.

**Preferred resolution:** an explicit governance or manager command with its own
mandate, a required reason and its own ledger entry — never a flag on
aggregation. Deliberately deferred until a real case needs it, because an
override built before anyone has been stopped by the rule is an override
designed against an imagined obstacle.

---

## TD-36 · The aggregation record has no read model

**Incurred:** Phase C1C-3. **Severity:** medium. **Blocks:** nothing yet.

`ManagerAggregation` stores which contributions were considered, what happened
to every claim, which perspectives were missing and which disagreements were
escalated. Nothing renders any of it.

That is exactly what the CIO needs before selecting a thesis: which material
claims were not adopted, and why. Every field is a queryable column rather than
a document precisely so the projection is a join and not a parse.

**Preferred resolution:** C1D projects it beside the revision it produced.

---

## TD-37 · Stored results are reusable only within one case

**Incurred:** Phase C1C-2, surfaced by C1C-3. **Severity:** low.
**Blocks:** cross-case reuse of expensive analysis.

`ResultKeyInputs` gained `caseId`, so a stored result is reusable only by the
case that produced it. The reason is C1C-2's: a stored result carries CLAIM
RECORDS, and a claim id derives from the command that stored it. Two cases
reasoning over one evidence set would otherwise collide under a single key with
different claim ids, and the write-once store would report a conflict that is
not one — which is exactly what happened while building C1C-3's fixtures.

The cost is real: the point of the store is that expensive analysis is not
repeated, and a live provider re-running an identical macro read for a second
case is spend the firm did not need.

**Preferred resolution:** store the claims WITHOUT identities and re-mint them
for the borrowing case on reuse, so the result is content rather than records.
That is a larger change than a cache key and it belongs with C2, where the
saving is money rather than milliseconds.

---

## TD-38 · The fitness suite was reasoning about a partial import graph — CLOSED

**Incurred:** Phase 0, discovered in the C1C-3 fitness-integrity follow-up.
**Severity:** was high. **Blocked:** every conclusion drawn from an import rule.

Three defects in the scanner, none of which could report itself.

**Eleven regexes contained a literal backspace byte** where `\b` was meant. A
backspace is a valid regex atom matching a byte no source file contains, so
each of those rules matched nothing and passed. It renders as nothing in an
editor and survives review and diff. Six predate this session; the C1C-3 report
described all eleven as repaired, and nine were still there — the repair had
been reported without being verified, which is the same failure one level up.
Two more were in `markets.test.ts` and a dashboard test. Among the disabled:
_performs no outbound fetch outside the market-data layer_, _stores no prose
activity in the domain_, _mints revisions in exactly one place_, and _offers no
way to supply a conditional outcome_.

**The import pattern forbade a newline** between `import` and `from`
(`[^'"\n]*?`), so every multi-line import was invisible — **203 of 1583
specifiers, across 143 of 344 files**. Prettier wraps long import lists, so the
blind spot covered the codebase's dominant style. Every import-based rule was
therefore reasoning about 87% of the graph, and "nothing imports X" meant
"nothing imports X on one line".

**`codeOnly` stripped strings with a regex** that could not tell a comment's
apostrophe from an opening quote. A comment containing "the manager's" swallowed
everything to the next quote, real code included, leaving later rules in that
file looking satisfied.

**Resolution.** `src/test/fitness/sources.ts` parses every file once with
TypeScript's own parser: imports from the AST with their bound names, comment
and literal blanking from the parser's own trivia, offsets preserved so failures
still name a line. The six load-bearing rules the C1C-3 review named are objects
in `fitness/rules.ts`, and `fitness/ruleIntegrity.test.ts` requires each to fail
on a planted violation and to pass a benign near-miss — a rule cannot enter the
registry without both. A guard scans every source for literal control characters
and proves itself against one. The `states`/`because` fields are required to be
non-trivial: a rule nobody can explain is a rule nobody can correctly relax.

**What the live rules found immediately:** a generated sentence in
`waitingChains` (below), a NUL byte in `provenance.ts` whose comment claimed it
had been spelled out, and `container.ts` constructing the PostgreSQL adapter
against a rule written when nothing wired it.

---

## TD-39 · Fitness rules outside the registry are still unproved

**Incurred:** the C1C-3 follow-up. **Severity:** medium. **Blocks:** nothing.

Nine rules are now proved to fail on a planted violation and to pass a benign
near-miss. The roughly sixty phase gates left in `importGraph.test.ts` are not:
pinned provider lists, frozen inventories, and single-file assertions. They no
longer share the two scanning defects above — they read the same parsed model —
but nothing demonstrates that any individual one still detects what it was
written to detect.

**Not a single cleanup phase.** Converting sixty rules at once would be a large
change nobody could review carefully, in the one part of the codebase whose
whole value is that somebody read it. They move into the registry as the phase
that owns them is touched, and a new load-bearing rule goes in with fixtures
from the start.

### Priority, by what goes wrong if the rule is silently dead

**Tier 1 — done.** All nine are in the registry with both fixtures.

| Rule                                                 | In registry as                            |
| ---------------------------------------------------- | ----------------------------------------- |
| no network outside approved infrastructure           | `no-outbound-network-outside-http-client` |
| no fabricated prose activity in the domain           | `no-prose-activity-in-domain`             |
| no direct repository writes from the orchestrator    | `orchestrator-writes-nothing-directly`    |
| no LLM dependency                                    | `no-llm-dependency`                       |
| no UI import of infrastructure or concrete providers | `no-ui-import-of-infrastructure`          |
| no caller-supplied or invented identity              | `no-caller-supplied-or-invented-identity` |
| no eligibility logic outside the domain              | `eligibility-decided-only-in-the-domain`  |
| no second eligibility answer                         | `no-second-eligibility-answer`            |
| no eligibility logic in SQL                          | `no-eligibility-in-sql`                   |

**Tier 2 — next, and each with the phase that will touch it.**

| Rule                                                | Why it is load-bearing                                                      | Moves with |
| --------------------------------------------------- | --------------------------------------------------------------------------- | ---------- |
| no memory fallback in the durable runtime           | a system that "works" while storing nothing is found later, by someone else | C1D        |
| no governance mandate bypass                        | a verdict recorded by a department that does not hold the discipline        | C1D        |
| no transaction opened inside a command handler      | splits the ledger entry from its effect                                     | C1D        |
| no command handler imports another                  | two ledger entries where the caller believes there is one                   | C1D        |
| revisions minted in exactly one place               | a revision superseding the wrong predecessor reads like a correct one       | C1D        |
| no stored requirement resolution recomputed on read | historical eligibility would drift as the rule changes                      | C1D        |

**Tier 3 — leave as assertions.** Pinned provider lists, frozen mock-consumer
inventories, the approved-command list, the schema-version pin. These fail
loudly when the list changes and cannot pass vacuously: the assertion IS the
data. Converting them would add ceremony without adding coverage.

---

## TD-40 · The domain composed one activity sentence — CLOSED

**Incurred:** AI Phase A. **Severity:** medium. **Blocked:** the activity feed's
integrity claim.

`waitingChains` in `domain/analysis/work.ts` returned `description: string`,
built as `` `waiting on ${departmentId}` `` — English, composed in the domain,
on its way to being rendered as headquarters activity. The rule forbidding
exactly this had been checking two files with two expressions, both disabled by
a backspace byte, and neither covered `work.ts`.

It returns a `WaitBasis` union now: `assignment`, `missing-assignment` or
`evidence`. The presentation layer phrases these. The authored field on
`waitingOn` was renamed `description` → `evidenceSought`, so the one string left
is what a person wrote rather than what the system composed; the column keeps
its name, so no migration was needed.

---

## TD-34 · An abandoned run has no recovery path

**Incurred:** Phase C1C-2. **Severity:** medium.
**Blocks:** running the orchestrator anywhere it can be interrupted.

The external-work boundary is three durable acts: `StartAgentRun` commits, the
provider runs outside any transaction, and `RecordContribution` or
`FailAgentRun` commits. The middle step is deliberately not covered by a
transaction — that is the point of the design — which means a process that dies
during it leaves a run `running` and an assignment `active` with nothing left
to settle them.

**What is already handled, and is not this debt.** A provider that hangs while
the orchestrator is alive is bounded: `withDeadline` ends the wait and the
orchestrator issues `FailAgentRun` with `provider-timeout`, retryable, which
returns the assignment to its queue. That path is tested. A provider that
returns nothing to say — the stub's `silent` outcome — is not abandonment
either: it answered, with no claims, and `RecordContribution` refuses it as
`malformed-output`. Both are settled runs.

**The gap** is narrower and real: nothing detects a run left `running` by a
process that is no longer there. There is no lease, no heartbeat and no
sweeper, so after a restart the run stays `running` forever, the assignment
stays `active`, and the one-active-run index means the desk cannot be given the
work again.

**Preferred resolution.** A run carries a lease — `started_at` plus a bounded
`deadline_at` written by `StartAgentRun` — and a recovery worker settles every
run whose lease expired as `failed` with `internal-error`, retryable, so the
assignment returns to its queue. The lease belongs on the row rather than in
the orchestrator, because the whole point is that the orchestrator may be gone.

**Why deferred rather than built now.** The recovery worker is a scheduled
process, and nothing schedules anything in this runtime yet — C1C has no
process model, no leader election and no place for a periodic job to live. C1D
puts the headquarters on a server that runs continuously, which is the first
context where a sweeper is a component rather than a script. Until then the
orchestrator is invoked in-process and a crash loses a development run, not
institutional work.

---

## TD-22 · The organization is not temporally versioned

**Incurred:** storage stage 1. **Severity:** low. **Blocks:** nothing known.

Departments, roles and employees have one current row each. There is no
`valid_from` / `valid_to`, so the graph answers "how does the firm look now"
and not "how did it look in March".

What is preserved without versioning: every work record stores the department
and employee involved, so an assignment's owner and a review's author are
historical facts on the record itself, and `case_decisions.governance` pins the
governance state at decision time. What is not preserved: names, reporting
lines and governance classification as they stood.

Three things hold the line meanwhile — the seed is insert-only, the runtime
role has no UPDATE or DELETE on any organization table, and a structural change
is therefore a new migration that states what it changes.

**Preferred resolution, if it becomes necessary:** surrogate keys with validity
ranges on `departments` and `employees`, with work records referencing the
surrogate rather than the natural id. That is a wide change and was not worth
making speculatively.

---

## TD-23 · `embedded-postgres` as the integration-test server

**Incurred:** storage stage 1. **Severity:** low. **Blocks:** nothing.

The plan assumed "real PostgreSQL in a container". The development machine has
no container runtime, so the integration suite uses `embedded-postgres`, which
downloads real PostgreSQL binaries (18.4) and runs them directly. The tests
exercise a genuine server — roles, column-level grants, deferred constraint
triggers, `NULLS NOT DISTINCT` and transactional DDL are all real.

It is a devDependency of about 200 MB of binaries, which is a real cost for a
project that keeps its dependency list short.

**Preferred resolution:** CI runs a PostgreSQL service container and sets
`TEST_DATABASE_URL`, which the harness already prefers over the embedded
cluster. `embedded-postgres` then stays as the local-development convenience
and can be dropped entirely once every contributor has a container runtime.

---

## TD-20 · Runtime capabilities deferred within Phase B

**Incurred:** AI Phase B. **Severity:** medium. **Blocks:** nothing yet.

Built as contracts and left unimplemented, deliberately:

| Item                          | State                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Cost and token budgets        | contracts defined; `null` means **not measured**, never unlimited                                                                  |
| Live budget enforcement       | a live runtime must refuse to start work without authorization                                                                     |
| Case service / command bus    | orchestration and repositories exist; the command layer that ties them together, with idempotency keys, lands with Phase C's needs |
| Headquarters snapshot         | the read model is specified; assembling it is deferred until the Agents route migration needs it                                   |
| Manager review and escalation | contracts exist in `review.ts`; no workflow drives them yet                                                                        |
| Evidence builders             | `application/analysis/evidenceRefs` maps domain objects to refs; the case-level assembler is Phase C                               |
| Legacy roster mapping         | documented mapping from the eleven prototype agents to departments and playbook entries is still to be written                     |

---

## TD-12 · Deferred architecture cleanups

**Severity:** low to medium. **Blocks:** nothing.

| Item                                  | Note                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `presentation/viewModels.ts` untested | 299 LOC at the numeric→string boundary, covered only transitively          |
| Speculative infrastructure            | ~1,500 LOC: metrics consumers, `ProviderCapabilityMetadata`, domain events |
| `marketCenters` layer violation       | The one sanctioned `data/` import; belongs in `domain/market/sessions.ts`  |
| `config.ts` at 517 LOC                | Five responsibilities in one file                                          |
| Fixture provider god object           | 465 LOC implementing ten ports                                             |
| `domain/shared` residue               | `Unit`, `Money`, `addMoney` are market-specific                            |
| Category count                        | 19 categories; revisit the descriptor shape at ~25                         |
| Data licensing                        | `requiresAttribution: true` on five sources, and no attribution rendered   |

---

## TD-13 · Provider evaluations not yet made

**Severity:** low. **Blocks:** nothing.

Deferred deliberately, each needing its own gate: FRED (keyed, deferred to keep
Phase 4B keyless), Twelve Data (D1), sector data (D5), news providers, sentiment
formula weights (D7), and market-implied policy probabilities — the last gated
on the seven documentation requirements in `data-architecture.md` §59.

---

## TD-41 · No governance escalation path

**Incurred:** C1C-4. **Severity:** medium. **Blocks:** nothing yet.

`Escalation` exists in `domain/analysis/review.ts` and nothing produces one. A
blocked revision sits blocked; nothing routes it to a manager or the CIO, and
the only way to notice is to ask for eligibility and read the blockers. C1D's
headquarters floor is the first place an escalation would be visible, which is
where it belongs.

---

## TD-42 · Compliance is defined and unreachable

**Incurred:** AI Phase A, surfaced by C1C-4. **Severity:** low.

`ComplianceReview`, `complianceBlocks` and the `compliance` review kind all
exist; no command records one. Two consequences, both deliberate for now:

`reviews.detail` survives as a jsonb column for compliance findings alone,
pinned there by a CHECK. Moving them relational would be schema for a shape
nothing writes.

A compliance block is filed as `blocks-decision`, which preserves the behaviour
that existed before C1C-4 and is arguably wrong — compliance answers "may we
publish this", which is `eligibleForPublication`. Changing the severity now
would be a silent governance change with no test that could observe it. The
publication phase is the first one that can decide it with evidence.

---

## TD-43 · A required correction does not create the work it requires

**Incurred:** C1C-4. **Severity:** medium. **Blocks:** nothing.

`correction-required` blocks the revision and the finding names what must
change, but nothing opens an assignment for the desk that must change it. A
manager reads the finding and issues the next command by hand. `ReturnWork`
sits on `REASON_REQUIRED_COMMANDS` and is unimplemented.

---

## TD-44 · Eligibility is recomputed on every read

**Incurred:** C1C-4, deliberately. **Severity:** low.

`revisionEligibility` reads revisions, assignments, runs, resolutions,
aggregations and every review of the case, then evaluates. At C1C's scale — one
case, tens of reviews — that is cheap, and it is the reason there is no stored
flag to go stale.

C1D's read model is where it gets materialised, together with TD-36 and the
transition observer that can emit `revision-became-eligible` honestly:
comparing two projected states and recording `observedAt`, which is when the
change was noticed rather than when it logically happened.

---

## TD-45 · The end-to-end Macro flow is not yet PostgreSQL-backed

**Incurred:** C1C-4. **Severity:** medium. **Blocks:** the C1C-4 exit criteria.

The governance branches are covered against the in-memory adapter — Risk in all
three states, verification correction, material and non-material challenges,
re-review ordering, concurrent verdicts, and a new revision reopening every
gate. The PostgreSQL-backed run of the same flow, including the restart that
proves eligibility, reviews, events and provenance reload identically, is not
written.

The schema, both adapters and the repository contract are exercised by the
PostgreSQL suite, so the storage half is covered; what is missing is the two
halves together. It is the last item of C1C-4 rather than a design gap, and it
is named here rather than left implied because an exit report that omitted it
would be the failure this project has already paid for once.
