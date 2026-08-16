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

**Incurred:** C1C-4. **Severity:** medium.
**Blocks:** nothing before C1D. Required for the Agents headquarters to claim
the workflow is operationally complete; not required for an internal CIO
decision, which reads eligibility directly.

`Escalation` exists in `domain/analysis/review.ts` and nothing produces one. A
blocked revision sits blocked; nothing routes it to a manager or the CIO, and
the only way to notice is to ask for eligibility and read the blockers. C1D's
headquarters floor is the first place an escalation would be visible, which is
where it belongs.

---

## TD-42 · Compliance is defined and unreachable

**Incurred:** AI Phase A, surfaced by C1C-4. **Severity:** low while the
workflow ends at an internal CIO decision.
**Hard gate before publication or any client-facing output.** A report leaving
the firm without a compliance verdict is the failure the department exists to
prevent, and the contract being present but unreachable makes that easy to
miss — it looks implemented from every angle except the command registry.

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

**Incurred:** C1C-4. **Severity:** medium.
**Must be solved before C2, and before the Agents headquarters presents the
workflow as operationally complete.** Not before C1D.

A `correction-required` verdict leaves the case truthfully blocked and
operationally stranded: the record is correct, the blocker names the claim, and
no desk has been given the work. A human reading the floor can act on it; an
autonomous runtime in C2 cannot, and a headquarters that showed the case as
"in progress" with nobody progressing it would be the first thing this system
says that is not true.

`correction-required` blocks the revision and the finding names what must
change, but nothing opens an assignment for the desk that must change it. A
manager reads the finding and issues the next command by hand. `ReturnWork`
sits on `REASON_REQUIRED_COMMANDS` and is unimplemented.

---

## TD-44 · Eligibility is recomputed on every read

**Incurred:** C1C-4, deliberately. **Severity:** low.
**Do not persist eligibility to avoid recomputation.** Measure first: the cost
is unmeasured, the scale is one case and tens of reviews, and a stored flag
would be a second source of truth bought to solve a problem nobody has
demonstrated.

`revisionEligibility` reads revisions, assignments, runs, resolutions,
aggregations and every review of the case, then evaluates. At C1C's scale — one
case, tens of reviews — that is cheap, and it is the reason there is no stored
flag to go stale.

C1D's read model is where it gets materialised, together with TD-36 and the
transition observer that can emit `revision-became-eligible` honestly:
comparing two projected states and recording `observedAt`, which is when the
change was noticed rather than when it logically happened.

---

## TD-45 · The Macro flow was not PostgreSQL-backed — CLOSED in C1C-4.1

**Incurred:** C1C-4. **Closed:** C1C-4.1.

`macroFlow.pg.test.ts` runs the whole workflow against PostgreSQL through the
durable composition root — open, instantiate, propose, contribute, aggregate,
resolve Risk, submit, verify, challenge, review, derive eligibility — then
destroys the runtime and rebuilds it. Six scenario branches, an optional input
that failed, and resumability after the restart.

**The restart is proved, not asserted.** `restart` closes the pool and then
requires a read through the dead runtime to FAIL: had any repository state
survived in process memory, the read would be served from it and succeed, so
success there would mean the restart never happened. A registry fitness rule —
with a planted violation, including the dynamic-import form — forbids any
PostgreSQL-backed test from reading institutional state through the memory
adapter.

**What is compared is a canonical institutional projection**, never row counts:
case identity, stage, version and transitions; thesis lineage and exact revision
identity; aggregation identity, inputs, claim dispositions and optional-input
snapshots; assignment and run states with execution provenance; claims with
their evidence refs; requirement resolutions with rule id, version and input
hash; every review with its sequence, supersession, findings and challenges; the
ordered event log; ledger entries with payload hashes and outcomes; structured
eligibility blockers; and storage provenance. `evaluatedAt`, `provenanceId` and
`buildId` are excluded **by name**, because a heuristic that dropped anything
timestamp-shaped would also drop `occurredAt` — which is exactly what a restart
has to preserve.

**Two defects it found, both now fixed.** The review insert used
`ON CONFLICT DO NOTHING` with no target, which swallowed
`reviews_sequence_unique` along with the primary and natural keys: two genuinely
different verdicts racing for one position would have had one silently
discarded, and the record would have shown a review that was never filed. And
`transition_events` had no way to name the verdict or the challenge an event
recorded, so a governance timeline could not be followed to its findings.

---

## TD-46 · Same-kind review races reallocate rather than reject

**Incurred:** C1C-4.1, deliberately. **Severity:** low. **Blocks:** nothing.

The designed behaviour when two genuinely new reviews of one
`(case, revision, kind)` race for the next position: **the loser reallocates
inside a savepoint and both immutable verdicts commit**, ordered by whatever
the database decided and total afterwards.

The alternative — rejecting the loser with a bounded conflict — was not taken.
A rejection is recorded in the ledger against the losing command id, so the
caller cannot retry that command; it would have to issue a new one, and a
control function whose verdict was refused for a reason that has nothing to do
with its judgement is a worse outcome than an order nobody specified.

The three unique constraints are distinguished by name rather than collapsed:
the primary key means the same command wrote twice (a replay, correctly a
no-op), the natural key means the same reviewer recorded the same verdict at the
same instant (the same act, also a no-op), and only the sequence means two real
verdicts collided. Reallocation is bounded to five attempts, after which a
`ConcurrencyConflictError` surfaces — exhausting it means something other than
contention.

**Left open:** the reallocation loop is not exercised under real concurrent load,
only under two connections racing in one test. If a future phase files verdicts
from many processes, measure whether five attempts is still generous.

---

## TD-58 · RESOLVED — a CIO submission validates its own basis

**Incurred:** C1D-1B B2C-2B, on discovery. **Resolved:** TD58-1 / TD58-2 /
TD58-3. **Was:** HIGH.

**The defect.** Deleting a `submission_required_work`, `submission_disagreements`,
`submission_evidence` or `submission_open_challenges` row produced **another
apparently valid submission**. Hydration could not tell the difference, and the
failure ran in the dangerous direction: fewer required-work rows means less work
appears to have been required, so the submission looks *more* eligible than it
was.

**The resolution.** An eligibility-basis manifest — a SHA-256 digest over a
canonical rendering of the exact basis — written once with the submission
(migration 0022, three columns with CHECKs) and **recomputed on every read**. A
deleted child, an added one, a substituted identity or an edited root field all
change the rendering, and the digests disagree.

| Detected | |
| --- | --- |
| a required-work row deleted | yes |
| a row added | yes |
| a stored basis field edited | yes |
| a witness that does not describe its basis, at write | yes — refused before storage |

**The proof it closed is a test that changed category.** The case recorded here
lived under *"N: not detectable, and no test pretends otherwise"*, and its
comment stated the exit condition: it FAILS if the representation ever gains the
witness that would close TD-58, at which point it moves to category H and is
replaced by a real refusal. It failed. It is now four refusals and a control
under category H in `c1d1Malformed.pg.test.ts`.

**Query budgets unchanged**, measured rather than assumed: `submissions.save`
stays at 7 statements, `submissions.get` at 6, at one child row and at
twenty-five.

### What this does NOT claim

**Corruption-evident, never tamper-proof.** It catches a writer that changed the
data without recomputing the witness — an accidental `DELETE`, a partial
restore, a broken migration, an import that did not know about the child tables.
It cannot survive an actor who edits a child row **and** rewrites the digest.
Nothing stored beside the data can; that is **TD-60**, still open.

**It attests storage, not capture.** If the basis was wrong when captured —
missing work the firm actually required — the manifest faithfully attests the
wrong thing. Whether the composition was correct to capture is the command's
job.

**No database backstop exists**, and none is possible: PostgreSQL cannot
recompute a domain canonicalisation, and a trigger that tried would be a second
implementation free to disagree with the first.

**The manifest binds an evidence-set id as a reference.** It does not hydrate
the sets a basis cites, so verifying a submission does not transitively verify
the evidence behind it — those verify when loaded. See
`docs/identity-architecture.md` §5.

Documents may now describe a CIO eligibility submission as **self-validating
against uninformed row deletion**. They may not describe it as tamper-proof,
cryptographically immutable, or proof against a privileged administrator.


---

## TD-59 · The test harness cannot reserve a port atomically

**Incurred:** C1D-1B B2C-3, deliberately. **Severity:** low — test
infrastructure only. **Blocks:** nothing.

`embedded-postgres` takes a port *number*, not a bound socket, and has no
port-0 path. So the harness binds an ephemeral socket to discover a free port,
**releases it**, and then starts PostgreSQL on that number. Between the release
and PostgreSQL's bind, another process can claim it.

The window is microseconds on loopback. The harness handles a loss by selecting
a **new** port and retrying, up to five attempts, and then fails with a
diagnostic naming every port it tried. It never reuses a port that just failed,
and it never terminates a process to take one.

**Bounded retry does not eliminate the race.** It bounds the consequences.

**Close it only when** the harness can hold the socket through PostgreSQL
startup, use a supported port-0 mechanism, or receive an owned process handle
and a bound endpoint atomically from the library. Any of those would make the
retry loop unnecessary rather than merely rarer.

### The related limitation this does not cover

A `SIGKILL` of the test runner between `start()` and the marker write leaves a
cluster the next run cannot prove is its own. It **refuses and asks a human**
rather than terminating anything under the harness's temp prefix. That is the
deliberate trade — an occasional manual cleanup against never killing an
unrelated database — and it is a property of the ownership policy rather than
debt to be repaid.


---

## TD-61 · `canonicalJson` orders keys with a host-configured collation

**Incurred:** before TD58-1; **found** while writing the canonicalization
specification. **Severity: medium.** **Blocks:** specifying any digest or
derived identity that flows through `canonicalJson`.

`canonicalJson` (`src/domain/analysis/identity.ts:106`) sorts object keys with:

```ts
.sort(([a], [b]) => a.localeCompare(b))
```

`localeCompare` with no locale argument uses **the host's default locale**. The
ordering is therefore a property of the machine, not of the value.

**Locales genuinely disagree**, measured rather than assumed — comparing `Id`
against `id` under Node's ICU:

| Locale | `Id` vs `id` |
| --- | --- |
| `en`, `sv`, `lt`, `cs`, `et` | `Id` after |
| `tr`, `da` | `Id` before |

So two hosts can canonicalize the same value into different bytes.

**Why it matters here.** `canonicalJson` derives evidence-set ids and content
hashes (`evidence.ts`, `identity.ts`), command-envelope and event identity
(`commands/envelope.ts`, `commands/eventIdentity.ts`), playbook identity, and
the write-once semantic keys that decide whether a replay is the same record or
a conflicting one. A derived identity must be reproducible by definition; one
produced by a host-configured collation cannot be specified, and two deployments
with different locale settings could derive different ids for identical content
— surfacing as spurious conflicts or duplicate records rather than as an error.

**Not currently known to misbehave.** Every key observed in these objects is
lowerCamelCase ASCII, and the divergence above needs two keys differing by case
at the deciding position. The defect is that the property is **unspecifiable**,
not that a failure has been seen.

**Contained, not fixed.** The eligibility-basis manifest deliberately does not
use `canonicalJson`. `src/domain/analysis/basisCanonical.ts` sorts with `<` on
UTF-16 code units and uses no key sorting at all, and
`docs/eligibility-basis-canonicalization-v1.md` §6.8 states the rule normatively.
That is why this is medium rather than high: the one mechanism whose whole
purpose is reproducibility is already outside the blast radius.

**Close it by** replacing `localeCompare` with code-unit comparison. The change
is one line and mechanically safe, but it **changes every id and hash
`canonicalJson` has ever derived**, so it is not a drive-by edit: it needs a
decision about stored values, and possibly a migration. Do not fold it into an
unrelated commit.

**The related limit this does not cover.** §5.3 of the canonicalization
specification: the manifest binds evidence-set ids as stored strings and does
not re-derive them, so it does not detect a change to a set's membership that
leaves its id unchanged. Extending the witness through evidence-set contents
requires this debt to be repaid first.


---

## TD-62 · The LightCommandCenter semantic test fails intermittently

**Incurred:** observed during TD61-1. **Severity: low** — test reliability only.
**Blocks:** nothing. **Does not block TD61-2** unless the failure rate prevents
reliable verification.

`src/components/lightDashboard/LightCommandCenter.semantic.test.tsx` →
*"live mode > renders the Swedish quotes Avanza supplied"*.

**What was observed, and nothing more:**

| | |
| --- | --- |
| failed in a full-suite run | twice |
| passed when run in isolation | yes |
| passed on a repeat full-suite run | yes |
| TD-61 files touching that path | none |
| root cause established | **no** |

**It is not fixed.** No change was made to it, and none should be made that
merely hides it: **do not add retries, do not rerun on failure, and do not mark
it flaky-and-skip.** A test that fails sometimes is reporting something, and the
something is unknown.

**Candidates for a focused investigation**, none of them confirmed: shared
mutable fixture state; a clock or timezone dependency; test ordering;
asynchronous rendering not awaited; a market-status assumption that depends on
the date the suite runs; global environment leakage between workers.

**Close it only when** the cause is identified and removed — not when the test
stops failing on its own, which is the same evidence that produced this entry.


---

## TD-63 · Cross-platform deterministic identity CI

**Incurred:** TD61-3A, deliberately. **Severity:** medium — operational
coverage. **Blocks:** describing cross-OS identity determinism as measured.

Identity determinism is proven across **spawned processes, timezones and
repeated executions** on the development machine. Two things are not proven,
and both are measurements rather than arguments:

**1. The process-default locale cannot be varied on this host.** Measured: on
Windows, Node resolves the default ICU locale from the operating system and
ignores `LANG` and `LC_ALL` entirely — `new Intl.Collator().resolvedOptions()`
reports the system locale whatever the environment says. The determinism suite
detects this through its own negative control and records it rather than
claiming a coverage it does not have. `TZ` **is** honoured, so the timezone
dimension is genuinely exercised.

**2. There is no CI.** The repository has no `.github/workflows`, so "supported
operating systems" currently means one.

### The claim that is actually supported

> Cross-OS determinism is **expected by construction, not yet measured across an
> operating-system matrix.**

The construction argument is that no platform-dependent input reaches an
identity: no `localeCompare`, no `Intl.Collator`, no platform line endings, no
host timezone formatting, no native object serialization, no database collation,
no platform-specific cryptographic output, and no filesystem-dependent ordering.
Rule 16 (`no-locale-sensitive-identity-ordering`) enforces the first two
structurally.

**That is an argument, and it is labelled as one.** No document may describe
cross-OS identity behaviour as empirically verified until this is closed.

### What would close it

A CI matrix running the checked-in identity corpus
(`src/test/identityCorpus.ts`) on **Linux, Windows and macOS**, comparing the
pinned canonical bytes and hashes. Linux additionally gives what this host
cannot: a platform where `LANG` and `LC_ALL` do change the default locale, which
turns the locale dimension from asserted into measured.

**Does not block TD61-3** while no CI exists and the limitation is stated.


---

## TD-64 · RETRACTED — based on a false premise

**Opened:** TD61-3B. **Retracted:** TD61-3C. **Not completed — withdrawn.**

**Original premise.** That an `EvidenceItem`'s content hash could not be
recomputed at hydration, because it covers a curated projection of the
observation while the stored `value` holds the whole provider payload — so the
projection was said to be unreachable from storage, and closing the gap was said
to need a new column and a migration.

**Mechanical finding.** The premise is false. The stored payload is
`canonicalPayload(x)`, whose numbers are converted by exactly the rule the
projection uses, so **selecting the projected fields out of the stored payload
reproduces the hashed value byte for byte**. Tested for all three production
evidence builders — `quoteEvidence`, `yieldEvidence`, `policyStateEvidence` —
each reconstructing its stored content hash exactly. That test is kept as
`src/domain/analysis/observationContent.test.ts`.

**Conclusion.** The debt item rested on reasoning from type signatures rather
than on a measurement. No schema change was ever required.

**Replacement defect.** The real gap was that **verification was absent**, and
that fixtures paired declared observation kinds with payloads belonging to other
kinds — `kind: 'yield'` beside `{ value }`, which is the *quote* projection's
field. Nothing verified the relationship, so nothing noticed. 71 fixtures were
inconsistent.

**Replacement work.** TD61-3C: one authoritative projection per storable kind,
`ObservationRef` verification of both the id and the content hash from persisted
values, fixture migration, and the corruption matrix.

> The mistaken analysis is left in the TD61-3B commit message, which is history.
> The correction lives here and in `docs/identity-architecture.md`.


---

## C1D-1B / B2C · complete

Recorded so a later phase does not have to reconstruct what was proven.

| Property | State |
| --- | --- |
| PostgreSQL repository implementation | complete — submissions, returns, decisions, supersession |
| shared contract parity | 69 cases, both adapters, **zero skips** |
| restart durability | proven, including that hydration is deterministic and write-free |
| malformed-state classification | four categories, never collapsed: schema-prevented, permission-prevented, refused on hydration, not detectable |
| query budgets | fixed and pinned; independent of child volume |
| transaction and connection cleanup | measured against `pg_stat_activity`, not inferred |
| SQL catalogue provenance | every production statement registered exactly once and covered by `queryCatalogHash` |
| repository completeness | compile-time, parser-level and runtime |
| harness lifecycle | dynamic ports, ownership-proven cleanup, named diagnostics |

**Open against it:** TD-58 (**high** — a hard gate before real CIO submissions)
and TD-59 (low, test infrastructure).

**Not to be reopened** unless a later phase finds a concrete defect.


---

## TD-70 · the disagreement threshold is restated in the validator · open

**Found by** `challenge-threshold-only-in-the-gate`, on the day that rule was
written — while it was being verified for the *challenge* threshold.

`domain/analysis/aggregateValidation.ts` hardcodes:

```ts
if (disagreement.materiality === 'decision-critical') { … blocks eligibility … }
```

That is the **disagreement** threshold, which `EligibilityPolicy` already owns
as `disagreementBlocksAtOrAbove` and which `disagreementBlocksEligibility`
already applies. So the firm's line on aggregation disagreement is drawn in two
places, and the validator's copy is the one nobody would think to change.

Exactly the defect the challenge-materiality stage was authorised to fix, in the
sibling field. It is recorded rather than fixed because closing it needs an
`EligibilityPolicy` threaded into a validator that receives none — the caller
must select it, per the standing rule that no evaluator resolves its own policy
— and that is a design change beyond the ruling that authorised this stage.

**Why it is not urgent.** The two values agree today: policy v1 sets
`disagreementBlocksAtOrAbove: 'decision-critical'`, which is what the literal
says. The debt is that they agree by coincidence rather than by construction,
and a second policy version would separate them silently.

**Closing it.** Thread the policy into `assertCioSubmissionWellFormed`, replace
the literal with `disagreementBlocksEligibility`, and delete the
`aggregateValidation.ts` exclusion from `challengeThresholdOnlyInTheGate` in
`src/test/fitness/rules.ts` — the rule already detects it and is being held off
that one file deliberately.

> The exclusion is written into the rule with this reference beside it, so the
> debt is visible where someone would otherwise wonder why the file is exempt.


---

## TD-71 · the Headquarters queue reads each case separately · open

`caseListing` derives standing per case by calling `standingForCase`, which
runs several queries — theses, three review kinds, the live decision, a
submission lookup per revision, and `revisionEligibility` on top. Cases are
processed **sequentially**, so a queue of N cases costs roughly N × that.

**This was chosen, not overlooked.** The alternative was a cheaper derivation
for the list, and that is precisely how a queue starts disagreeing with the case
it links to: the shortcut stays invisible until a case sits in a state the
shortcut gets wrong, and then the firm holds two beliefs about where its own
work is. `caseListing.pg.test.ts` asserts list and case page produce identical
standing for every case, which is only true because both call one derivation.

Sequential rather than parallel is also deliberate: firing every case's queries
at once would take the connection pool from the request path, so the page would
degrade fastest under the load that makes it matter.

**Why it is not urgent.** The firm holds a handful of cases. The cost is linear
and predictable, and the page is read by people rather than by a poller.

**What would make it urgent.** A case count in the hundreds, or the queue being
polled. Either changes this from "linear and small" to "linear and constantly
paid".

**Closing it without reintroducing the divergence.** Not by writing a second,
lighter standing. Either batch the underlying reads — one query per record kind
across all cases, then derive standing per case from the batched results, which
keeps the single derivation — or introduce a read-through cache keyed on the
case aggregate version, so a case that has not moved is not re-derived.

> The single-derivation property is the thing to preserve. Any fix that ends
> with two ways to compute standing has traded a performance problem for a
> correctness one.

**The governing principle, ruled 2026-08-13:**

> Performance improvements may change how institutional state is **obtained**,
> but never how institutional state is **derived**.

Batching, caching, parallelisation and indexing all change how the facts are
fetched, and are permitted. A second derivation for a particular caller is not,
at any speed. The queue and the case page must always answer the same question
in exactly the same way.


---

## TD-72 · checkpointed orchestration resume after acceptance · open

**Opened by C2-1**, as a deliberate consequence rather than an oversight.

Only **accepted** institutional claims satisfy a playbook dependency. Produced
work is operational: it may be inspected, accepted or rejected, and it does not
unlock downstream institutional work, because an agent chain must not build on a
premise no human has agreed belongs in the record.

So a multi-step playbook now stops at each human checkpoint. `runPlaybook`
executes every currently eligible entry, reports the rest as
`waiting-for-dependencies` with `awaitingAcceptanceOf` naming the upstream work
a person must accept, and ends. Re-invoking it replays rather than resumes:
it is a single pass over the graph by design.

**This is accepted for the first live-agent phase and is NOT a permanent
removal of multi-step agent workflows.**

**The capability this defers:**

```
orchestrator executes all currently eligible entries
        → produced work enters awaiting-acceptance
        → a human accepts
        → those accepted claims satisfy dependencies
        → orchestration RESUMES from the newly eligible entries,
          without replaying completed work
```

That is checkpointed, resumable orchestration. It needs its own design: what
identifies a resumption, how already-completed entries are skipped without
re-deriving their identity, and how a partially advanced graph is represented so
a reader can see where it stopped and why.

**Why it is not in C2-1.** Smuggling resumability into the first live-agent
stage would mean designing the mechanism that lets agents advance a workflow at
the same moment as the boundary that stops them — two decisions of opposite
intent in one change. The boundary is the point of C2-1; resuming across it is a
later capability, chosen deliberately.

**What must not be weakened when it is built:** accepted claims satisfy
dependencies, awaiting-acceptance claims do not, and rejected claims never will.

**Coverage this defers, stated so it is not rediscovered as a gap.** Because a
single pass cannot reach a dependent entry, `orchestration.test.ts` can no
longer exercise a downstream desk receiving exactly its declared edges
end-to-end — aggregation never starts. The rule is still enforced in
`runEntry`, which builds `inputs` only from `blockedBy` and `optionalInputs`,
and `missingOptionalInputs` remains covered by `runCommands.test.ts` and
`caseCommands.test.ts`. What is missing is the end-to-end path, and it returns
with this capability. The tests that used to cover it now assert the boundary
that replaced it: no unaccepted work reaches any desk, and entries waiting on a
person leave nothing in the ledger.

## TD-73 · a case-level budget constraint has no durable home · open

**Opened by C2-1**, as a stated scope boundary rather than an oversight.

The effective execution budget resolves from three sources — a playbook entry
proposes, a case may constrain, firm-wide policy is the hard ceiling — and
`resolveExecutionBudget` takes all three today. Two of them have durable homes:
the proposal lives on `PlaybookEntry.budget` and is inside the playbook content
hash, and the ceiling is firm policy supplied by the caller.

**The middle one does not.** A case constraint reaches the resolver through
`OrchestrationOptions.caseBudgetConstraint`, from whoever invoked the
orchestrator, rather than from a column on `analysis.cases`. So a case cannot
today *record* that this particular question does not warrant the standard
allowance; it can only be told so at the moment work is run.

**What building it needs:** a column group on `analysis.cases` with the same
CHECK vocabulary migration 0028 uses for runs, its create and save statements,
the row type, the mapping, a field on `InvestmentCase`, and a command
authorised to revise it — a case's spending constraint is policy a person sets,
so it needs an actor, a mandate and a reason like every other institutional act.

**Why the column was not added in 0028 anyway.** A column nothing reads is
worse than an honest absence: one that is always NULL reads as a policy the
firm declined to set rather than one it cannot yet record, and that is a
distinction this phase spent its whole budget design defending.

**What must not be weakened when it is built.** The run stores the *resolved*
number and never a pointer to the sources, so persisting the case constraint
changes what resolution consumes and nothing about what a historical run reads
back. `runCommands.test.ts` asserts exactly that, by moving all three sources
after the fact and re-reading the run — that test must keep passing unchanged.
