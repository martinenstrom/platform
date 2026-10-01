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
appears to have been required, so the submission looks _more_ eligible than it
was.

**The resolution.** An eligibility-basis manifest — a SHA-256 digest over a
canonical rendering of the exact basis — written once with the submission
(migration 0022, three columns with CHECKs) and **recomputed on every read**. A
deleted child, an added one, a substituted identity or an edited root field all
change the rendering, and the digests disagree.

| Detected                                             |                              |
| ---------------------------------------------------- | ---------------------------- |
| a required-work row deleted                          | yes                          |
| a row added                                          | yes                          |
| a stored basis field edited                          | yes                          |
| a witness that does not describe its basis, at write | yes — refused before storage |

**The proof it closed is a test that changed category.** The case recorded here
lived under _"N: not detectable, and no test pretends otherwise"_, and its
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

`embedded-postgres` takes a port _number_, not a bound socket, and has no
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

| Locale                       | `Id` vs `id` |
| ---------------------------- | ------------ |
| `en`, `sv`, `lt`, `cs`, `et` | `Id` after   |
| `tr`, `da`                   | `Id` before  |

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
_"live mode > renders the Swedish quotes Avanza supplied"_.

**What was observed, and nothing more:**

|                                   |        |
| --------------------------------- | ------ |
| failed in a full-suite run        | twice  |
| passed when run in isolation      | yes    |
| passed on a repeat full-suite run | yes    |
| TD-61 files touching that path    | none   |
| root cause established            | **no** |

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
kinds — `kind: 'yield'` beside `{ value }`, which is the _quote_ projection's
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

| Property                             | State                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| PostgreSQL repository implementation | complete — submissions, returns, decisions, supersession                                                       |
| shared contract parity               | 69 cases, both adapters, **zero skips**                                                                        |
| restart durability                   | proven, including that hydration is deterministic and write-free                                               |
| malformed-state classification       | four categories, never collapsed: schema-prevented, permission-prevented, refused on hydration, not detectable |
| query budgets                        | fixed and pinned; independent of child volume                                                                  |
| transaction and connection cleanup   | measured against `pg_stat_activity`, not inferred                                                              |
| SQL catalogue provenance             | every production statement registered exactly once and covered by `queryCatalogHash`                           |
| repository completeness              | compile-time, parser-level and runtime                                                                         |
| harness lifecycle                    | dynamic ports, ownership-proven cleanup, named diagnostics                                                     |

**Open against it:** TD-58 (**high** — a hard gate before real CIO submissions)
and TD-59 (low, test infrastructure).

**Not to be reopened** unless a later phase finds a concrete defect.

---

## TD-70 · the disagreement threshold is restated in the validator · open

**Found by** `challenge-threshold-only-in-the-gate`, on the day that rule was
written — while it was being verified for the _challenge_ threshold.

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
today _record_ that this particular question does not warrant the standard
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

**What must not be weakened when it is built.** The run stores the _resolved_
number and never a pointer to the sources, so persisting the case constraint
changes what resolution consumes and nothing about what a historical run reads
back. `runCommands.test.ts` asserts exactly that, by moving all three sources
after the fact and re-reading the run — that test must keep passing unchanged.

## TD-74 · the pgHarness port assertion can fail by chance · open

**Observed 2026-08-16** in a full PostgreSQL run during C2-1: one failure,
`pgHarness.pg.test.ts > the harness allocated a dynamic port > is not the old
fixed 54330`, reporting `expected 54330 not to be 54330`. It passed on a
re-run, and the full suite was clean at 31 files / 781 tests.

**Unlike TD-62, the cause is established rather than unknown**, which is why
this entry can be short and why it is not an invitation to investigate.

The harness asks the OS for an ephemeral port. 54330 is inside the ephemeral
range, so the OS may legitimately assign it, and on this run it did. The
assertion then fires on a correct allocation.

**What the test is actually for.** The fixed port was the original defect: one
run killed without teardown kept it, and the next could not bind. The fix was
to stop hard-coding a port. But the test checks the **outcome of a random
draw** rather than the property — and the property, "the harness hard-codes no
port", is a fact about the code, not about which number came back this time. A
test that fails roughly once in sixteen thousand runs on correct behaviour is
reporting the wrong thing, not reporting something unknown.

**Deliberately not changed as part of C2-1.** Rewriting an assertion in a
harness the whole PostgreSQL suite depends on is its own change with its own
justification, and folding it into a stage about model execution would put an
unrelated edit inside a boundary that is otherwise about one thing.

**When it is fixed**, assert the property rather than the draw: that the port
comes from the harness's dynamic allocation path at all. Do **not** retry the
test, rerun on failure, or mark it flaky-and-skip — the standing rule in TD-62
holds here, and it holds more easily because there is nothing left to discover.

## TD-75 · three confidence signals have no production derivation · open

**Opened by C2-1**, as a stated boundary of the live-model ruling rather than
an oversight.

`composeConfidence` composes confidence mechanically from seven signals, each
able only to LOWER. The live provider must apply every cap the firm can
**objectively derive**, and take the lower of that and the model's proposal.
Measured, only two of the seven have the inputs to be derived at all:

| signal                 | state                                  | what is missing                                                       |
| ---------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| `evidenceCount === 0`  | **derivable**                          | —                                                                     |
| `anyFixtureBacked`     | **derivable**                          | —                                                                     |
| `anyMissingProvenance` | not reachable                          | `EvidenceItem.provenance` is required, so a stored item always has it |
| `weakestEvidence`      | **missing**                            | no production mapping from source trust to a `ConfidenceLevel`        |
| `anyStale`             | **derived, for sovereign yields only** | closed for that one family by C3 Stage C; see below                   |
| `conflictingEvidence`  | **missing**                            | no definition of when two sources conflict about one subject          |
| `methodologyMismatch`  | **missing**                            | no definition of when two measures are comparable                     |

`composeConfidence` itself is called **nowhere else in production**, and
`EvidenceSignals` is constructed only in a test. So the mechanical composer the
domain designed has, until now, never run over real evidence.

**What C2-1 does instead.** `resolveModelConfidence` calls `composeConfidence`
with the two derivable signals real and the rest passed as values that cannot
lower anything, then accepts the result **only** when the cap is one of the two
the firm actually computed. Otherwise it returns the model's proposal with a
basis that says so in words — `'proposed by the model'` and `'the firm has not
independently corroborated this level'` — so an uncapped level can never be
read as firm-derived, and a later capability can count how much of the firm's
confidence is model-asserted.

**Why the missing four were not invented here.** Each needs an institutional
policy decision, not an implementation: how old is stale, what counts as a
conflict, which methodologies are comparable, and how source trust maps to a
level. Guessing any of them would put a number the firm never agreed to behind
a confidence it presents as its own.

**Why the model was not asked for them.** A signal the model supplied and the
firm then treated as firm-derived would be the model grading its own work
through a longer route — the exact inversion the ruling exists to prevent.

**When it is built:** define the policies first, then wire `composeConfidence`
over real signals, and widen `DERIVABLE_CAPS` in `modelConfidence.ts` toward
the full seven as each cap becomes genuinely derived. The long-term direction is
that institutional confidence becomes increasingly firm-derived; the honest
interim is that the firm says which parts it has verified.

### `anyStale`, closed for one family — C3 Stage C, 2026-08-19

The first of the four to acquire a production definition, and it acquires one
**for sovereign yields and nothing else** (gate Decision 5). `judgeStaleness`
in `application/analysis/evidenceStaleness.ts` holds a table keyed by
methodology — `par-yield`, `zero-coupon-fitted`, `benchmark-bond-yield` and the
derived `spread-2s10s@1` — each with a stated horizon of five days and the
publication calendar that justifies it. Anything outside the table reports
itself **unjudged**, which passes `anyStale` as `false`: the value that cannot
lower anything. An undefined policy does not become a finding in either
direction.

Two properties of the definition, recorded because they were decisions rather
than mechanics:

- **Judged against `referencePeriod` and `assembledAt`**, never a clock. A
  confidence resolved against wall-clock time would give the same stored claim
  a different level a month later with nothing in the record saying why.
- **Recency, for this cap, is the freshest cited in-scope observation.** Ruled
  2026-08-19, and ruled narrowly: it governs the C3 sovereign-yield confidence
  cap and is **not** a domain statement that staleness is always the age of the
  freshest evidence. Freshness, historical coverage and completeness may need
  separating for a later family. Within this cap: a claim citing three weeks of
  history including yesterday's print is recent, because an observation cited
  as historical context is context rather than stale evidence; a claim citing
  only the old end of that same window is stale, and is capped.

`weakestEvidence`, `conflictingEvidence` and `methodologyMismatch` are
untouched, and this does not license deriving them by analogy: each still needs
its own institutional policy decision.

## TD-76 · the firm-wide execution ceiling has no durable home · open

**Opened by the C2-2 planning gate**, by measurement rather than by suspicion,
and kept **separate from TD-73 by ruling**. TD-73 is the _case_ constraint —
the middle of the three budget sources. This is the _firm ceiling_, the last
word in the chain, and collapsing the two would hide that the outer bound is
the one nothing holds.

**What was measured.** For a live run commissioned from the product path, all
three sources of `resolveExecutionBudget` are empty:

| source                                                  | state                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| playbook proposal — `PlaybookEntry.budget`              | the field exists and is inside `playbookContentHash`; **no entry of `MACRO_REGIME_PLAYBOOK` defines one**                                                                                                                                        |
| case constraint                                         | no durable home — TD-73                                                                                                                                                                                                                          |
| firm ceiling — `OrchestrationOptions.firmBudgetCeiling` | **the only production caller that has ever supplied one is `smokeFns.SMOKE_BUDGET`**; every other occurrence is the type, the orchestrator's pass-through, or a test constant. No environment variable, no configuration module, no policy table |

So `resolveExecutionBudget('live', { firmCeiling: {} })` yields `not-measured`
tokens and cost, `budgetPermitsStart` returns false, and both `StartAgentRun`
and `buildRunRecord` refuse. **A live run cannot be commissioned from the
product until something supplies the numbers** — which is the budget design
working exactly as intended, and is why this is recorded rather than patched.

**The C2-2 ruling, and its stated limit.** Stage C will carry a budget on a new
registered playbook version. That budget is a **versioned playbook-level
execution proposal for `macro-analysis`** — the first of the three sources —
and it is **not** the firm's hard global ceiling. It must not be renamed,
described, or read as firm-wide policy anywhere in code, comment or interface.

**What the absence therefore costs.** With no ceiling, nothing caps a later
playbook proposing more. The resolution chain still holds — `min` across every
source that spoke — but the outer bound is missing rather than generous, and a
proposal is the only thing bounding spend.

**What building it needs:** somewhere durable for firm policy to live, a
command authorised to set it (a spending ceiling is policy a person sets, so it
needs an actor, a mandate and a reason like every other institutional act), and
the resolver reading it rather than taking it from the caller.

**Deliberately not built inside C2-2**, by ruling. It is institutional policy
machinery, and folding it into the stage that makes an agent usable would put
two decisions of different kinds inside one boundary.

**What must not be weakened when it is built.** The run stores the _resolved_
number and never a pointer to the sources, so persisting the ceiling changes
what resolution consumes and nothing about what a historical run reads back.
`runCommands.test.ts` asserts exactly that by moving all three sources after the
fact and re-reading the run — that test must keep passing unchanged.

## TD-77 · retry attempts spend outside the recorded usage · open

**Opened by the C2-2 budget gate**, from a measurement rather than a suspicion.

`budgetOverruns` compares the authorized budget against the usage of the
contribution that **succeeded** — `settled.value.usage`, one attempt. A failed
attempt returns no usage at all: `executeWithinRun` classifies it and moves on,
and the tokens or money it consumed are never represented anywhere.

**So actual execution spend can exceed what the institutional run record appears
to account for.** The record is not wrong about what it states — it states what
the successful call reported — but a reader taking `usage` as the run's total
cost would be reading a number that excludes every attempt before the last.

**The measurement.** Of the eighteen live runs in the development database,
six were recorded with `failure_attempt = 3`: the full retry policy ran, three
provider calls were made, and each of those runs recorded no usage whatever.
Twelve more failed non-retryably on the first attempt, also recording nothing.
Only two runs report usage at all.

**Why the gap is structural rather than a bug.** `ContributionResult` carries
usage, and a failed attempt produces no result to carry it on — the provider
throws a `ContributionFailure`, which is a bounded category and nothing else.
There is no channel through which a failed attempt's usage could reach the run
today, which is why this is debt rather than an oversight.

**What building it needs:** a way for a failed attempt to report what it spent
(the provider knows; the failure path discards it), somewhere on the run to
accumulate it across attempts, and a decision about which number the budget is
enforced against — the successful call, or the run's total. The third is the
institutional question, and it is the one to answer first: enforcing against the
total would fail runs whose useful work was affordable but whose retries were
not, and enforcing against the successful call is what happens today.

**Not in scope for C2-2 Stage C**, by ruling. It does not block commissioning:
the budget still bounds the call that produces the work, and the run still
refuses to start without one. It is expanded only if implementation exposes a
correctness dependency that genuinely prevents commissioning.

**What must not be weakened when it is built.** The run records the _effective_
limit and never its sources, and `budgetOverruns` reads measured usage only —
a provider that reported nothing must not be treated as having overrun, which
would fail runs for a provider's reticence rather than for their spend.

## TD-78 · a registered playbook does not read back with its budget · open

**Opened by C2-2 Stage C, by measurement rather than by suspicion**, while
confirming the handoff facts against the development database rather than
assuming them.

`analysis.playbook_entries` has no budget columns. `PLAYBOOK_SQL.insertEntry`
writes ten fields and `budget` is not among them, so a playbook registered
through the PostgreSQL adapter reads back with `budget: undefined` on every
entry. The in-memory adapter stores the object it was given and returns it
intact, so **the two adapters disagree about what a registered playbook is** —
and only one of them is durable.

**The measurement.** In the development database, `playbooks.get('macro-regime',
'2')` returns six entries, every one with no budget, while the compiled
`MACRO_REGIME_PLAYBOOK_V2` carries 12,000 tokens / $1.00 / 90,000 ms on
`macro-analysis`.

**Why nothing is currently wrong because of it.** Two properties hold it
harmless today, and both are load-bearing rather than lucky:

- **The registry is the authority for a definition.** Every production path that
  needs a playbook resolves it through `requirePlaybook`, which returns the
  immutable definition this build ships. `StartAgentRun` does it, and so does
  `commissionAnalysis`. Nothing reads a budget out of the store.
- **`content_hash` is computed from the in-memory playbook before insertion**,
  so registration idempotence and the conflict check are unaffected: a v2
  registered with a different budget would still be refused as a conflicting
  record.

**What it costs.** The store cannot answer _"what did the firm authorize for
this workflow version"_ without the build that registered it. Audit is not
impaired — the run records the **resolved** budget, which TD-76 already
establishes as the durable authority for what any particular run was permitted —
but the version-level authorization exists only in code.

**Why it is debt rather than a defect.** A parity finding is a shared contract
case, not a one-store fix: the port's documentation does not currently say
whether `playbooks.get` must round-trip the budget, and the two adapters answer
differently because nobody decided. **The decision comes first.** If the answer
is that it must, the work is a migration, four columns, the mapping both ways,
and a case in `repositoryContract.ts` so both stores are held to it. If the
answer is that a stored playbook is a _record of registration_ rather than a
definition, the port should say so and the in-memory adapter should stop
returning something PostgreSQL cannot.

**What must not be weakened when it is settled.** `playbookContentHash` treats
an absent budget as absent rather than as `budget: null` — deliberately, so
every playbook written before budgets existed keeps the hash it already has.
Whichever way this is decided, that must not change: rehashing the registry
would make every case's pin refer to a version that no longer content-addresses
the same way.

## TD-79 · a run can be dispatched whose input alone exceeds its authorised budget · open

**Opened by the C3 Stage C exit attempt, 2026-08-19, by measurement.** The run
that exposed it is preserved as institutional history:
`run-90240a4400e6da472d20b94a3d87a9f7`, state `timed-out`, category
`provider-timeout`, two attempts, no usage reported, no claims written.

**What was measured.** The firm authorised 12,000 tokens for that run. The
rendered request it dispatched was 139,734 characters — **≈ 28,350 input
tokens**, before a single token of output. The ratio is calibrated on the
accepted C2-2 run, whose 2,341-character prompt was measured by the provider at
475 input tokens; the C3 prompt is denser in hex ids and JSON, which tokenise
worse, so the estimate errs low.

|                | evidence items | prompt chars | input tokens        |
| -------------- | -------------- | ------------ | ------------------- |
| C2-2, accepted | 1              | 2,341        | 475, **measured**   |
| C3, timed out  | 264            | 139,734      | ≈ 28,350, estimated |

**The gap.** `budgetPermitsStart` checks only that every budget dimension is
_decided_ — "not measured is not unlimited". Nothing anywhere estimates the size
of the request about to be sent and compares it against the tokens the firm
authorised. `budgetOverruns` is the only token enforcement and it runs
**afterwards**, on measured usage, settling the run as `budget-exhausted` and
writing no claims.

So the failure mode is: the firm authorises 12,000 tokens, dispatches a request
whose input is 2.4× that, pays for it if the provider answers, and then refuses
the answer. In this instance the 90-second deadline fired first, which is why
the recorded category is `provider-timeout` rather than `budget-exhausted` —
**but raising the deadline would not have produced a passing run.** Both bounds
were exceeded; only one of them was reached first.

**What it costs.** Spend the firm did not authorise, with nothing to show for
it. Worse, it is spend the record cannot see: an aborted attempt reports no
usage, so a provider that received and processed the request before the client
hung up may well have billed for it and the firm holds no evidence either way.
That is the same blind spot TD-77 records for retries, reached by a second
route.

**What was fixed, and what it does not fix.** The second Stage C exit attempt
exposed a distinct defect on the refusal side: a run refused for overspending
recorded no usage, so the firm could not say by how much. That is fixed —
`FailAgentRun` now accepts measured usage and the overrun path passes it — and
it is what will make this debt _answerable_ when it is taken up: the next
budget-refused run states exactly what it consumed. **It does not close this
item.** Measuring after the money is spent is not the same as declining to spend
it.

**Why it is not solved in C3, by ruling (2026-08-19).** A pre-dispatch
feasibility check is a **new institutional refusal** — the firm declining to
start work it can see it cannot afford — plus a dependency on estimating tokens
before a provider counts them. Both are decisions, not implementations: what
estimator is trustworthy enough to refuse on, whether an estimate may block an
act at all, and whether the refusal belongs to the run, the assembly or the
commission. Building it inside the stage that was proving the evidence pipeline
would settle three institutional questions at a keyboard.

**What C3 does instead, and what it must not be read as.** The Stage C exit is
re-run against a **five-business-day window** that fits the authorised budget
with headroom. That is a choice of window for one run. It is **not** a finding
that Global Macro may only reason over five days of history, it is **not** a
limitation of the evidence architecture, and no code, comment, interface string
or report may state it as one.

**Related, and deliberately also not solved in C3.** The longer-term
architecture may need a way to expose historical institutional evidence to an
agent **without serialising every full observation into the model context** —
264 observations rendered in full is what produced the 139,734 characters. That
is a later measured design problem. `evidenceBriefing` is **not** to be
optimised or compacted in C3: it renders the institutional record faithfully
(gate §0.9), and compacting it under time pressure is how a rendering quietly
becomes a second, lossier model of the evidence.

## TD-80 · the attempt count on a budget-refused run is a default, not a measurement · open

**Opened by the C3 Stage C diagnosis, 2026-08-19**, while establishing how many
provider calls the two failed exit runs actually made.

`failAgentRun` defaults `attempt` to 1. The orchestrator's budget-overrun path
calls `settle(...)` without passing `settled.attempts`, which
`executeWithinRun` had already computed and returned. So
`run-132054669959f3ce20268241aa4b90fe` records `failure_attempt = 1` — and that
1 is the default firing, not a count anybody measured. Whether earlier retryable
attempts occurred inside its 66 seconds is not answerable from the record.

The pipeline's own failure paths **do** thread the real number; this is one call
site that does not.

**Why it matters more than it looks.** It is the same class of blindness TD-77
records for retry spend and TD-79 for pre-dispatch size: a number in the
institutional record that reads as measured and is not. A reader cannot tell
`attempt: 1` meaning _one call was made_ from `attempt: 1` meaning _nobody
passed a value_, and the two are different facts. The related loss on the same
path — measured usage discarded on a budget refusal — was fixed in C3; this one
was left, deliberately.

**Why it was not fixed in C3, by ruling (2026-08-19).** The usage fix was scoped
narrowly and on purpose. Threading the attempt count is a second change to the
same settlement, and bundling it would have widened a fix that was ruled narrow
precisely so it could be verified against one planted defect.

**What building it needs:** pass `settled.attempts` at the overrun call site,
and check every other `settle` caller for the same omission rather than fixing
the one that was noticed. Worth a look at whether `attempt` should be required
rather than defaulted, so the next call site cannot quietly under-report — that
is a small institutional question about what an unstated attempt count means,
and it should be answered before the field is threaded, not after.

## TD-81 · no durable per-attempt category or timing on a run · open

**Opened by the C3 Stage C exit attempts, 2026-08-19/20**, after the same
question went unanswerable three times.

A run records the **final** failure category and — on the pipeline path — a
measured attempt count. It records nothing about the individual attempts:
neither what each one failed with, nor when each began or ended.
`run_events` carries `running` and the terminal state, and nothing between.

**What that cost, concretely.** Two of the three failed exit runs made two
attempts and ended `provider-timeout` at the shared deadline. In both, the
first attempt failed with something retryable and non-deadline — necessarily
`provider-unavailable` or `malformed-output`, because a deadline hit on attempt
one would have ended the run at `attempts: 1` — and **which one is not
recoverable**. Neither is how long it took.

That second absence is the expensive one. The deadline is shared across
attempts, so a first attempt that runs long leaves the second less time than a
normal call needs. For `run-85158581ec24392d9a02b1283d030a9d` the arithmetic is
fully determined except for the one unmeasured term:

```
T1 + backoff(<=0.5s) + T2 = 90.07 s      and a normal attempt measures 66.156 s
```

so if `T1` exceeded ~23.8 s the second attempt was doomed before it began — a
complete explanation requiring no change in provider latency, and one the record
cannot confirm or exclude. **The difference between the run that succeeded at
66.156 s and the run that timed out therefore has to be reported as partially
unexplained**, which is not a statement about the provider so much as about the
firm's own instrumentation.

**Distinct from TD-80**, which is about the attempt _count_ being a default on
the budget-overrun path. This is about per-attempt _facts_ not existing on any
path.

**Why it was not built in C3, by ruling (2026-08-20).** It improves diagnosis;
it is not required to prove the Stage C evidence capability, and C3 is not the
stage that decides what the firm records about execution.

**What building it needs:** an attempt-level event on the existing `run_events`
shape is the obvious form, and the question to answer first is what an attempt
event IS institutionally — a fact about the provider, or a fact about the run.
It also touches the boundary `failAgentRun` states deliberately: **no provider
response body, prompt, evidence excerpt or raw error text.** A per-attempt
record must carry the bounded category and timing and nothing else, or it
becomes the free-text failure field that rule exists to prevent.

## TD-82 · the run envelope is calibrated on single samples, and provider latency is unmodelled · open

**Opened by the C3 Stage C live proof, 2026-08-20**, by the accepted run
disagreeing with the reasoning that authorized it.

The v4 deadline of 180,000 ms was calibrated from **one** measured sample: a
byte-identical 60-item request that completed in 66.156 s. The arithmetic was
one normal attempt plus one full retry — 66.2 + 0.5 + 66.2 = 132.9 s — with
~47 s of headroom.

**The accepted run's provider phase took 131.331 s.** The envelope held, with
~49 s to spare rather than the ~114 s a single-attempt reading implied, and a
further retry would not have fitted inside it.

**What that does and does not establish.** It does not establish that provider
latency doubled: the record does not say how many attempts the 131.331 s covered
(**TD-81**), so a single slow call and a retry behind a fast failure are
indistinguishable. What it does establish is that **the firm sized an
authorization from one observation of a distribution it has never characterised,
and the next observation was twice the first.** The number was sufficient. The
model behind the number was not confirmed, and must not be described as
validated by this run.

**Why this matters beyond one deadline.** Every execution authorization the firm
issues — deadline, tokens, and whatever a later stage adds — is currently set
from a handful of samples with no notion of spread, tail or trend. The token
figure happened to land well (19,228 measured against a 24,000 breaker set from
reasoning). The deadline landed with less room than intended. Neither outcome
was predictable in advance, because nothing measures the distribution.

**What building it needs:** a durable record of per-run and per-attempt
execution timing (**TD-81** is the prerequisite), then a stated institutional
policy on what an envelope is calibrated _against_ — a median, a tail
percentile, a worst observed case — because those are different institutional
promises and the firm has never chosen between them. Sizing against a tail is a
different act from sizing against a mean, and a circuit breaker that is really a
budget is the confusion TD-79 already records from the other side.

**Deliberately not solved in C3.** C3 proved the evidence capability. How the
firm calibrates execution envelopes is execution-envelope architecture, and it
belongs with TD-79 and TD-81 rather than inside the stage that happened to
expose it.

## TD-83 · the organisation seed checksum does not cover `department_handles` · open

**Opened by Half B, 2026-08-28**, when a migration moved a handle and the
checksum did not move with it.

`analysis.organization_seed_versions` holds a SHA-256 over the organisation as
it stands. Its payload, fixed by the algorithm installed in migration 0011, is
**departments, employees and roles** — `id|name|is_governance`,
`id|role_id|department_id|reports_to`, `id|function|can_block_publication`.
`department_handles` is not in it.

Migration 0035 does two things: it creates the Rates department with its role
and employee, and it **moves** the `rates` discipline handle from `global-macro`
to `rates`. Only the first is checksummed. The version-2 bump is carried
entirely by the new department, role and employee rows, and the handle move —
half of what version 2 _means_ — is invisible to the hash.

**The consequence is not confined to drift detection.**
`organizationReader` caches the whole seeded organisation and invalidates on
checksum equality alone (`organizationReader.ts:74`), while the organisation it
caches **does** carry handles (`ORGANIZATION_SQL.handles`, materialised at
`:177`). A future migration that moved a handle and changed nothing else would
therefore write a new version row under an unchanged checksum, and every reader
process would keep serving the pre-move organisation — the wrong desk answering
for a discipline — until it restarted.

**Why Half B did not fix it, by ruling.** Widening the payload changes the
canonical representation of _every version ever computed_, including the
historical v1 that `reviewScope.pg.test.ts` pins by literal. That is a
canonicalisation-version change, and it does not belong inside a stage whose
subject is peer scrutiny.

**What it costs today: nothing measurable**, stated as a measurement rather than
as reassurance. One handle move has ever happened, and it was accompanied by
department, role and employee rows that did move the checksum.
`reviewScope.pg.test.ts` guards the semantic fact directly — the `rates` handle
is held by exactly one desk and that desk is Rates; Global Macro keeps `fx`,
`macro`, `policy` and loses only `rates`. Those tests cover what the checksum
provably does not. They do not repair it, and they would not catch a handle move
in a migration nobody thought to extend them for.

**What fixing it needs:** a new canonicalisation version for the seed payload
that takes handles in explicitly, applied forward only, with historical
checksums preserved under their original versions so a reader holding a
historical snapshot can still resolve exactly what it acted under. The cache
key is a separate question and the cheaper one: invalidating on
`(version, checksum)` rather than `checksum` alone closes the stale-read path
without touching any canonical representation.

## TD-84 · no way to re-establish peer scrutiny on a successor revision · open

**Opened by Half B, 2026-08-28**, deliberately, alongside the peer-examination
capability it belongs to.

A peer examination is scoped to the revision it actually read, and it stays
there. `PEER_SCRUTINY_ABSENT` asks whether a qualified peer examined **this**
revision — which is the whole point of revision-scoped review.

When a challenge is answered by settling in place, the examination still
applies. When it is answered by minting a **successor revision**, it does not,
and there is no act that requests or re-establishes scrutiny on the successor.
A case can therefore arrive in front of the CIO carrying an argument no peer has
examined, with nothing in the system asking for one.

**The fix must never be inheritance.** A successor may carry materially
different claims, so carrying the old verdict forward would record that a desk
examined an argument it never saw — precisely the failure revision-scoped review
exists to prevent. The same principle already governs reconsideration: history
is inherited, judgement is not.

**What fixing it needs:** an explicit new examination act against the successor
— a capability, not a default. The open institutional question is what the
_absence_ of one on a successor should be: a blocking gate, or an outstanding
obligation surfaced through `CaseStanding.nextAct`. Those are different promises
about what the firm refuses to do versus what it admits it still owes, and the
firm has not chosen between them. `CaseStanding` is the semantic authority for
obligation and is where the answer belongs once it is ruled — not in a second
derivation inside the gate.

## TD-85 · the newest organisation version is selected by lexical ordering · open

**Opened 2026-08-30**, found while writing TD-83 and confirmed by reading the
catalogue and the schema rather than by inference.

`analysis.organization_seed_versions.version` is **`text`**
(`0001_organization.sql:192`, `version text PRIMARY KEY`). The reader resolves
which organisation is current with

```sql
SELECT version, checksum FROM analysis.organization_seed_versions
ORDER BY version DESC LIMIT 1
```

(`ORGANIZATION_SQL.seed`). **The ordering is therefore lexical, not numeric.**

Versions `'1'` and `'2'` are the only ones that have ever existed, and both are
safe: lexical and numeric ordering agree across a single digit. They stop
agreeing at two digits. With versions `'9'` and `'10'` present, `'9'` sorts
last descending, so the query returns version 9 as current and the firm serves
a **superseded organisational structure** — the roster, the reporting lines and
the governance flags as they stood before the most recent change.

**The failure mode is the dangerous kind: it is silent.** There is no error, no
missing row and no constraint to violate. A superseded organisation is a
perfectly well-formed organisation, and every downstream answer built on it —
who is a control function, who manages which desk, who may block publication —
would be internally consistent and institutionally wrong. It fires on the ninth
organisational change, with nothing before that to hint at it.

**Distinct from TD-83, and the distinction matters for the fix.** TD-83 is about
the seed _canonicalisation_: what the checksum covers, and the cache-key problem
that follows for a handle-only change. TD-85 is about _which persisted version
is newest_. They can interact operationally — both are reached through the same
seed row, and TD-83's proposed `(version, checksum)` cache key reads the very
value TD-85 shows can be the wrong one — but they are separate defects with
separate fixes, and neither resolves the other.

**Deferred by ruling, 2026-08-30.** It is real, it is not a blocker, and it is
not Boardroom v1's subject. Recorded rather than fixed.

**What fixing it needs:** an authoritative ordering mechanism for organisation
versions. The remediation must establish that ordering properly rather than
special-casing the comparison at the query, because the same textual version is
read in more than one place and a fix that lives in one `ORDER BY` leaves the
others free to disagree. The design is deliberately not attempted here.

## TD-86 · the approved playbook for a case kind is chosen by lexical version ordering · open

**Opened 2026-09-01**, found while measuring whether the playbook architecture
could carry a second institutional family.

`resolveForCaseKind` picks the approved workflow for a case kind by sorting the
candidates and taking the last:

```ts
const latest = [...candidates]
  .sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0))
  .at(-1)!
```

`CasePlaybook.version` is a **string**, so the comparison is lexical. Versions
`'1'` through `'9'` sort correctly because they are one digit. `'10'` does not:
it sorts before `'9'`, so a playbook that had reached ten versions would resolve
its **ninth** as the approved default.

**The consequence is silent and institutional.** Nothing errors. Every new case
of that kind would be opened, pinned and run against a superseded workflow —
possibly one with a desk missing, a governance step removed or a different
aggregation dependency — and the case would look entirely well-formed. Existing
cases are unaffected, because a case carries its own pin; the damage is confined
to cases opened after the tenth version and is invisible in all of them.

**Harmless today.** `macro-regime` is at v6, and `equity-assessment` starts at
v1, so no case kind is within three versions of the boundary.

**Equity v1 does not make it reachable.** It adds a new playbook _id_ at version
1, not a tenth version of an existing playbook, so the failure remains
unreachable through this work.

**Distinct from TD-85.** That defect is about which **organisation seed version**
is newest; this one is about which **playbook version** is approved. Same failure
mode, two different registries, two separate fixes — and neither resolves the
other.

**What fixing it needs:** an ordering that is not lexical. The version is a
string in the domain type, in the database and inside every case's pin, so the
fix is a comparison rule rather than a type change — and it belongs next to the
registry rather than at the one `sort` call, because the same textual version is
read elsewhere and a repair confined to this line leaves those free to disagree.

## TD-87 · a decision cannot faithfully reference a multidisciplinary evidence basis · open

**Opened 2026-09-01**, measured while establishing whether one case can carry
evidence from several domains.

It can, everywhere except the last step. Traced through the persisted
relationships:

| layer              | multi-set                                                        |
| ------------------ | ---------------------------------------------------------------- |
| evidence sets      | not case-scoped at all                                           |
| run                | one set per run — each desk carries its own                      |
| claim citation     | `EvidenceRef {setId, observationId, contentHash}` — set-explicit |
| verification       | claim-level, by content hash — set-agnostic                      |
| aggregation        | operates on claims; evidence refs stay on the claims             |
| `EligibilityBasis` | **`evidenceSetIds`, plural**                                     |
| `CaseDecision`     | **`evidenceSetId`, singular**                                    |

So an Equity case may legitimately reach CIO eligibility citing an equity price
set, a Treasury curve set and a macro set — and the decision that follows has
room to name one of them.

**Naming one would misdescribe the record.** There is no defensible way to
choose: the rates evidence is not "the" evidence for a valuation dispute the
rates desk challenged, and neither is the equity evidence. A decision that named
either would report a narrower basis than the firm actually decided on, in the
one record whose purpose is to say what the decision rested on.

**Not reachable today, and deliberately so.** No decision has ever been
persisted — `case_decisions` holds zero rows — and `recordCaseDecision` is not
exposed through any server function. The narrowing cannot currently be hit.

**Do not fix it in the Equity slice.** The decision contract already has two
other open questions against it — what `authorizationBasis` may legitimately be,
and how `unresolvedDissent` is accountably populated rather than auto-copied
from open challenges. Opening the contract three times for three reasons would
be three migrations and three chances to disagree with itself.

**Remediation belongs to `CIO Decision Authority & Decision Recording`**, where
`evidenceSetId → evidenceSetIds` is folded in with the other two, and the
contract is opened once, coherently.

## TD-88 · a newly opened case has no production path to its first thesis — CLOSED 2026-09-17

**Opened 2026-09-07**, measured while assembling the starting state the P4.5b
live proof requires.

The product can open a case and instantiate the approved workflow on it. It
cannot get that case to aggregation, because `AggregateManagerConclusion` mints
onto an existing lineage and every path to a _first_ revision runs through
`ProposeThesis` — which is exposed by no server function and no interface. The
only caller in the repository is `scripts/propose-thesis.ts`, a bootstrap
script a person types.

| act                      | production path                             |
| ------------------------ | ------------------------------------------- |
| open a case              | `caseIntake` server function                |
| instantiate the playbook | `InstantiatePlaybook`, through intake       |
| **propose revision 1**   | **none — `scripts/propose-thesis.ts` only** |
| aggregate onto it        | `AggregateManagerConclusion`, live          |

So `Fråga → Financial OS arbetar → svar` currently has a human-shaped hole in
its first step: a question can be asked, and the firm cannot begin arguing
about it without someone at a terminal stating an opening position.

**The seam is authority, not plumbing.** Adding a server function that proposes
a thesis would settle by default the question nobody has ruled: _who or what is
authorised to establish a committee's initial analytical thesis, and if a model
produces it, what candidate/adoption semantics apply?_ The synthesis path
already answers the analogous question one way — a model produces a
**candidate**, and an accountable actor **adopts** it — and an initial thesis
minted directly by a runner would be the same act with the adoption boundary
removed.

**What must not happen while this is open:** a future Playbook Runner
manufacturing an opening thesis so that a case can proceed. That would book an
institutional act to nobody, and it is the precise failure the candidate
boundary exists to prevent.

**Deliberately not solved inside P4.5b**, by ruling. P4.5b proves autonomous
synthesis against a valid starting state; establishing that state was performed
as declared manual human setup, and the manual setup is not part of what the
stage claims to have automated.

**Closed 2026-09-17.** The authority question was ruled, and it was ruled
by a conversation: the person said, five different ways, that the committee
could start on why gold was up, and was asked five times for a thesis, a
scope and a formal approval — every confirmation filed as an amendment
(`analysis.case_amendments`, case `case-2d82f55b…`, 18:31–18:33), the
case never leaving `needs-decision`, no work possible because this door
did not exist. The ruling: **the person who put the question establishes
the opening, in their own words, translated by JARVIS and confirmed by
them**; it is booked to the operator with the host as initiator, exactly
as the question was. A model drafts the shape, never the words, and the
person's instruction or confirmation is the adopting act.

- **Host contract v4 `begin`** (`hostContract.ts` §11 of the contract
  document): `{ reference, requestId, opening }` where the opening is an
  **explanation** with the focus the person named, or a **position** with
  the person's view and the position word read off it, or `null` to
  examine openly. The parser refuses a statement, implications, an
  invalidation criterion, a department or an actor beside it by name: the
  host says what the person meant and never writes the firm's record.
- **`FinancialOsSystem.begin`** (`domainSystem.ts`) → `ProposeThesis`
  revision 1 from `openingProposal()` (`application/analysis/opening.ts`):
  the statement is the question or the view, the position `explain`,
  `open` or the person's word, the invalidation criterion stated for the
  shape, implications `[]` for an explanation and `position-sizing` for a
  position — declared by the firm's own application, never by the host, so
  Risk is not waived by phrasing. Idempotent on the command id; a case that
  already argues about a revision proposes nothing new.
- **The firm advanced as far as policy permits, on the person's word.**
  The workflow's standing evidence basis (`STANDING_EVIDENCE`: macro-regime
  → the US par curve, seven days, as the firm knew it at the act — thirty
  days was measured to exhaust the desks' 24,000-token budget) is
  assembled by the operator's convenor mandate, and every entry of the
  pinned workflow is commissioned under **the desk's own institutional
  agent** through `commissionAnalysis` — the P4 path, with its mandate,
  readiness and budget checks untouched. `begin` waits only until a run is
  on the record; the live run continues in the process and its end is
  logged (`[begin] … ran awaiting-acceptance`). What started and what was
  withheld — `no-evidence-basis`, `no-observations`, `no-provider`,
  `no-authorized-budget`, `dependencies-not-met`, `not-assignable`,
  `no-principal`, `declined` — is reported in the host's words and said to
  the person once, plainly. The gateway now reads a case with an opening
  and no desk work as `blocked / analysis-required` naming the desk,
  rather than `synthesis-required` for work nobody has produced.
- **JARVIS translates** (`application/jarvis/opening.ts`): the question's
  own words decide explanation or position; the focus is read off what the
  person said, or the standing default; "kör", "de kan börja", "ja",
  "precis" count as confirmation; "pröva den öppet" is leave to examine
  without a view; a focus alone is a focus. The runtime opens an
  explanation the moment the firm asks for an opening — no question back
  — and takes words added to a case that still awaits its opening as the
  opening, so the loop cannot recur whatever the model does with them. A
  capital question keeps its one human question, asked once.

What stays open: the standing evidence basis is a policy for one workflow,
and choosing evidence by subject is the evidence architecture's next
question; a process that dies mid-run leaves what TD-92 describes. The
adoption boundary was ruled the same evening (second ruling of
2026-09-17): a finished run is adopted by its desk's own institutional
agent on the next advance, never by the person and never by the host —
see the contract document §11, "Adoption and the passes after `begin`".

## TD-89 · `scripts/` is not typechecked, and the bootstrap tooling has rotted · open

**Opened 2026-09-11**, by `scripts/prove-agent-desk.ts` throwing
`Cannot read properties of undefined (reading 'id')` in the middle of the P4.5b
live proof — after the provider had been called and paid, and after
`RecordContribution` had committed, but before `AcceptContribution` ran.

The script read `result.run.id`. `commissionAnalysis` returns `runId`; it has
since the synthesis work reshaped `CommissionResult`. Nothing caught the
change, because `tsconfig.json` says:

```json
"include": ["src", "vite.config.ts"]
```

`npm run typecheck` therefore does not see `scripts/` **at all**. Every
bootstrap script is unchecked TypeScript that is only ever exercised by a person
typing it, which is the worst combination available: it fails at the moment it
is used, and it is used at the moments that cost money.

**Measured blast radius**, by compiling `scripts/` against the project config:

| script             | failure                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| all of them        | `TS5097` — `.ts` import extensions, needs `allowImportingTsExtensions`           |
| `ingest-prices.ts` | `string` is not `CorrelationId`; `DataSourceMetadata.kind` does not exist        |
| `ingest-yields.ts` | `provider.fetchYieldHistory` possibly undefined; `string` is not `CorrelationId` |

So this is **not** a one-line config fix. The extension errors are a compiler
setting, and behind them sit real type errors in the ingestion scripts against
interfaces that have moved. Including `scripts/` without fixing those would
make `npm run typecheck` red, and a red gate that everyone learns to ignore is
worse than an absent one.

**Not fixed inside P4.5b**, deliberately. The stage's own script was repaired
where it broke and is now resumable (`--adopt`), which stops this defect
costing a _paid run_ again. Correcting the ingestion scripts is a change to
code the stage did not otherwise touch, and it would be verified by running
market-data ingestion rather than by anything P4.5b proves.

**What must not happen while this is open:** trusting a bootstrap script
because it is written in TypeScript. It is checked by nothing.

## TD-90 · a commission that never started reports a rule nobody broke · open

**Opened 2026-09-11**, measured while the first autonomous synthesis was being
diagnosed.

`commissionAnalysis` ends with:

```ts
if (!created) {
  return { outcome: 'declined', code: stage.rejection ?? 'illegal-prior-state' }
}
```

When the orchestration produced no run and rejected nothing — the entry was
reported `waiting-for-dependencies`, or was never attempted — the caller is told
`illegal-prior-state`, which the product renders as _"Uppdraget är inte i ett
läge där det kan påbörjas."_ That is a statement about a rule the institution
enforces, and no rule was consulted.

It cost real time. The synthesis decline read as a mandate or lifecycle refusal
and sent the investigation to `StartAgentRun`'s guards, every one of which was
satisfied; the actual cause was the orchestrator's readiness set, two layers
away. The underlying readiness defect is fixed — see `satisfiedEntries` — but
**the dishonest fallback is still there** for every other way an entry can fail
to appear.

**The fix is a distinguishable outcome**, not a better default code. `declined`
means the institution answered; "nothing ran and nobody refused" is a third
thing and should say so, so that a caller can tell a refusal from a
no-op.

**Why it is not fixed here:** `CommissionResult` is consumed by the Agent
Headquarters surface and by `commissionText.ts`, which maps every code to
Swedish operator prose. Adding a variant is a change to the surface's exhaustive
handling and its text, and P4.5b closed without needing it once the readiness
defect was corrected. It belongs with the next piece of work that opens that
surface.

## TD-91 · a fresh case reports the wrong owning desk · open

**Opened 2026-09-13**, measured while giving Financial OS a host-facing port.

`ownershipFor` in `domain/analysis/caseStanding.ts` answers "whose desk is
this on" for a case in `research` with:

```ts
departmentId: investmentCase.participatingDepartmentIds[0] ?? null,
employeeId: investmentCase.ownerEmployeeId,
```

and `InstantiatePlaybook` grows participation to every department the
playbook engages, then **sorts it by UTF-8 byte order**. In the seeded firm and
in the test organisation alike, the first participant after convening is
therefore `devils-advocate` — so every freshly convened case reports the
Devil's Advocate as its owning desk while naming the Research Director as its
owner. The person is right; the department beside them is whichever desk sorts
first.

It has not been noticed because the surfaces that render ownership either use
the employee or were never opened on a fresh case. A host presenting "your
question is with the Devil's Advocate" would be presenting it.

**The fix is small and belongs in the domain:** derive the department from the
owner employee through the organisation, or from the intake's accountable
department, never from participation order. It is deliberately not made here —
`ownership` sits inside captured `caseOverview` fixtures and inside the
standing every list and page reads, so it is a domain-rule change with its own
verification, not a side effect of the integration seam.

**Until then:** read `ownership.employeeId`, never `ownership.departmentId`,
for a case in `research`. The port's test says so at the assertion.

## TD-92 · an abandoned run stays `running`; nothing owns its recovery · open

**Opened 2026-09-14**, measured by the first live browser probe of the host
gateway (`scripts/probe-host-gateway.mjs`).

`analysis.runs` held `run-dc77ede8f344ab2792482e0732aaacf7` — provider
`probe`, kind `stub`, started **2026-09-06T20:18:44Z** — in state `running`
eight days later. The process that wrote the row died; the row did not. The
first cut of the host gateway read it as work in progress, and a host would
have told the person "jag återkommer" about a run nobody was running.

The sequence is general, not a probe artefact:

```
process starts run  →  process dies  →  run stays `running`
                    →  no lease, heartbeat or recovery owns the abandoned work
```

**Mitigation in force, and what it is not.** The gateway
(`application/analysis/hostGateway.ts`) reports `working` only for a run
inside its **active execution window** — `running`, with a measured deadline
the clock has not passed. Every live run records that deadline, because the
firm refuses to start one without (`commissionAnalysis`, `orchestrator`). A
run outside any window is `expired` and the case is `blocked` on
`execution-recovery-required`. This stops a host from promising indefinite
work. It repairs nothing: the row is still `running`, the assignment is still
occupied, and `runs.save` will refuse a second live run on it.

**The debt.** The deterministic runner/orchestration work the roadmap defers
must measure and rule on: an execution lease; a heartbeat or equivalent
ownership signal; deadline expiry as an institutional event rather than a
reading; abandoned-run recovery (who may mark it `timed-out`/`failed`, under
what authority, with what ledger entry); safe retry and resume; and
exactly-once / idempotent continuation. Until then the gateway's behaviour is
an accepted mitigation, not orchestration semantics — and the orphan above is
left in the dev firm as the specimen.

## TD-93 · a live voice session's sideband lives in one process · open

**Opened 2026-09-15**, with the JARVIS live-voice integration
(`infrastructure/jarvis/liveSession.ts`).

A GPT-Live session is created by the server process that received the
browser's SDP offer, and that process attaches the sideband socket through
which every delegation call is executed and every usage event is read. The
session registry is in-memory in that process. A deployment with more than
one server instance would route `liveSessionStateFn`, `typeIntoLiveSessionFn`
and `closeLiveSessionFn` to whichever instance answered, which may not be the
one holding the sideband — and a restart drops every open session's
telemetry with it.

**Until then:** one server instance, which is the dev and current shape. The
debt is to decide, when a second instance exists, whether sessions are pinned
to an instance, the sideband is held by a dedicated process, or the registry
is externalised; none of it changes the host boundary.

## TD-94 · a spoken addition to an open case has no door in the host contract — CLOSED 2026-09-16

**Opened 2026-09-15**, measured in the GPT-Live proof
(`docs/jarvis-voice-live-proof.md` §7.5): the person continues talking while a
case is open — _"ta hänsyn till dollarn också"_ — and the voice model calls
`add_to_delegation`.

The host contract (`application/analysis/hostContract.ts`) carries
`ask`, `resume`, `status`, `result` and `inspect`. Nothing attaches context to
a case after it is opened, and the institution has no act for it: an addition
to a question is either a new question, or evidence, or a revision of the
thesis, and which of those it is would be a decision the voice layer is not
allowed to make. `interpretToolCall` therefore refuses the tool as
`context-not-supported` and JARVIS says so — the remark stays in the session's
own conversation, which is conversational data and not the institutional
record.

**The debt.** Rule on what a spoken addition is institutionally, give it an
act with provenance if it deserves one, and only then a host request. Not
before: a "note" that silently entered a case would be authority inferred
from a transcript the ruling of 2026-09-15 explicitly denies that standing.
**Closed 2026-09-16.** The ruling: a spoken addition is the asker's own words
on the asker's own case — neither a new question, nor evidence, nor a revision
of the thesis, and none of those may be inferred from a transcript. It became
an institutional act of its own, and the mirror act came with it, because
the same measurement (`scripts/probe-jarvis-flow.mjs`, the "before" run)
found the voice saying _"Okej, jag stänger det pågående ärendet nu"_ with no
act behind the sentence.

- **`AmendCase`** (`application/analysis/commands/amendCase.ts`) — appends the
  person's words beside the question in `analysis.case_amendments`
  (migration 0050: `finos_app` may SELECT and INSERT, never UPDATE or
  DELETE; the question column stays the one the application may not
  touch), with who, when and **the case version at the time**, so a reader
  can tell which work predates the addition. Convenor mandate on the owning
  desk, checked against the case's actual owner; no reason (the words are
  the reason) and no expected version (nothing on the aggregate moves). It
  moves no stage and starts no work — whether the desks must look again is
  a later act with its own mandate, still unwritten.
- **`CloseCase`** (`closeCase.ts`) — the stage `withdrawn` had always
  existed without an act. Convenor mandate, reason required (it is how
  _"varför stängde vi det?"_ is answered), version-guarded, one movement
  event. Whether the closure reads as **cancelled** (work had started) or
  **abandoned** (nothing had) is derived at read time by `closureOf`, never
  stored. A run inside its window is not killed (TD-92); it is reported as
  work the firm will not adopt. There is no reopening: `ReopenCase` stays
  on the guarded list, unwritten.
- **Host contract v3** — `amend` and `close` requests; `closed` result state
  with `HostClosure`; every positive result carries `amendments` (count,
  latest, `workPredates`), never the words; `failed / case-settled` for an
  act on a settled or closed case. `closed` precedes every other product
  state, including `working`.
- **The voice** — `add_to_delegation` → `amend`, the new `close_case` →
  `close`; both act only on the case the conversation is bound to, and the
  model never names a target. The spoken confirmation is produced from the
  case read back after the act, so JARVIS cannot say "tillagt" or "stängt"
  about something the firm did not record.

What stays open: nothing here re-runs a desk because of an addition, and a
case closed on instruction stays closed until the firm writes `ReopenCase`.

## TD-96 · the firm pays the provider before it discovers a budget violation · open

**Opened 2026-09-17**, measured in the first `begin` runs of the gold case
(`docs/jarvis-voice-live-proof.md` §13.3): two live desk runs read a
thirty-day curve window — 252 observations, 63,010 input tokens each on
`claude-opus-5` — and the firm failed both `budget-exhausted` against the
24,000 tokens the pinned workflow authorises. The calls had already been
made and paid for; the token budget is enforced on the answer, not on the
prompt. The v6 playbook note assumed the breaker refuses ahead ("stays
refused at 24,000"); measured, it pays first. The two calls spent the
remaining provider credit, which is what stopped the end-to-end proof.

**The immediate correction, ruled 2026-09-17:** the standing evidence
window is seven days (`STANDING_EVIDENCE`, 60 observations, 15,531 tokens
by the workflow's own measurement), which fits the envelope for both
desks. That is a policy fitting the budget, not budget control.

**The debt.** Enforcement before dispatch: estimate or bound the expected
invocation cost from the evidence set and the brief — the provider's own
token counter, or a measured bytes-to-tokens ratio with headroom —
compare it with the run's authorised budget, and **refuse or reduce the
context before the call** where policy requires, so that

```
estimate / bound expected cost → refuse or reduce before dispatch → provider call
```

replaces

```
oversized provider call → pay → discover the budget violation
```

Ruled 2026-09-17 as technical debt to track, not to solve inside the
acceptance run that found it, unless the seven-day gold flow needs it to
complete. The refusal must remain the institution's (`StartAgentRun` and
the orchestrator's budget resolution), never a second rule in a caller.

**Measured again 2026-09-18** (`docs/jarvis-voice-live-proof.md` §14): the
first live governance runs paid for two answers truncated at the 4,096 cap
and one Verification call that ran past its 180 s deadline, none with a usage
record. Still open; the governance budgets (v7, v8) were written from
measured contexts first, which bounds the input but not the answer.

## TD-95 · a typed line into a live session never reaches the firm — CLOSED 2026-09-16

**Opened 2026-09-16**, measured by `scripts/probe-jarvis-typed-live.mjs`
(`docs/jarvis-voice-live-proof.md` §10.5) after the flow probe found three
typed lines answered by silence.

While a voice session is live, the presence sends a typed line to
`typeIntoLiveSessionFn`, and the runtime forwards it as
`session.instructions.append` — GPT-Live has no user-text event. Four typed
lines in one session, a silent microphone: `session.instructions.appended`
4, `session.delegation.created` 0, tool calls none. The voice model
answered two of them itself — _"Absolut, jag väger in dollarn …"_ and
_"För att vi avslutade det på din begäran …"_ — claiming an addition and
a closure the firm never recorded, and ignored the other two, an
investment question among them. The run before the open-case acts existed
showed the same: its confident typed answers were the voice model's own.

The sequence is structural, not a prompt's:

```
typed line while live  →  instructions.append  →  voice model  →  answers itself, or not
                                                 ↛  delegation  ↛  backend  ↛  tools  ↛  firm
```

**Not mitigated.** The invariant watcher counts a promise of work without a
reference; it cannot see an act claimed without a reference. Typing without
a session is still "every text → ask" (slice C, transitional), which would
open a new case on _"ta hänsyn till dollarn också"_, so there is no correct
typed path for an addition or a closure today. The acts themselves are
proven by voice (§10.3, B and C) and at every layer below the contract.

**The debt.** A ruling on the typed-while-live path. The candidate that
keeps one router: the server sends a typed line to the backend directly —
the Responses model with the same instructions, the same five tools and the
same host execution, the proof's `/text` path (§7.6) moved into the product
— and hands its `say` to the voice to speak and to the presence to show.
Never a third router; never the voice model answering an investment
judgement or claiming an act.

**Closed 2026-09-16, the same day**, by the routing ruling: a typed line —
with or without a live session — now goes from the server to the backend
model directly (`LiveRuntime.respond`: the Responses API with the same
instructions, the same tools and the same tool execution the voice
delegates to; `store: false`, the conversation and every tool result
carried in the request). While a session is live the routed answer is
handed to the voice to say, with the instruction never to answer the
question itself; the voice model no longer sees a typed line on its own.
The presence shows the answer as text at once and does not show the spoken
echo as a second bubble. The last turns travel with the line as context,
bounded, so _"varför?"_ is about something.

Measured (`scripts/probe-jarvis-typed-live.mjs`, run 2, `.probe/typed-typed-2.json`):
four typed lines into a live session — the Nvidia question, the addition,
the closure, the why — reached the firm as `ask`, `amend`, `close` and
`status`, each answered as text in 2.2–4.8 s and spoken, and each
confirmation read off the record: _"Dollarn är tillagd i ärendet"_,
_"Ärendet är stängt och lades ner innan något arbete hade gjorts"_,
_"Det lades ner på din begäran"_. Before: four lines, zero delegations,
two fabricated confirmations.

## TD-97 · the control functions run on the desks' model · open

**Opened 2026-09-17**, by ruling, at G1. Verification, the Devil's Advocate
and the peer examination each run under their own principal, prompt, context
and run identity — and all three on `claude-opus-5`, the model the desks and
the Research Office run on. A control function that shares the model of the
work it checks shares that model's blind spots; independence of principal and
prompt is real, independence of judgement is not yet.

**What is in place for it.** Every run records its provider identity — model
id, prompt id and content hash, parameters hash — so a policy that requires a
control function to run on a different model from the desks it scrutinises
can be enforced at `StartAgentRun` without touching the workflow.

**Deliberately not implemented in G1** (ruled: record, do not build). The
resolution is a policy rule over provider identities per role function, and
a second configured model, decided when the firm decides what diversity it
wants to pay for.

## TD-98 · Risk Review has no candidate boundary · open

**Opened 2026-09-17** at G1. The Risk desk's own principal now resolves
whether its review applies to a revision (`ResolveConditionalRequirement`,
by `risk-agent`, proven live 2026-09-18), but the review itself — sizing,
concentration, liquidity, tail risk — has no provider, no candidate artifact
and no filing path: `RecordRiskReview` is a person's act. Where the
requirement resolves to `required`, the submission opens Risk's queue and the
advance pass reports `risk: no-provider`; the case then stops at
`risk-review-required` after the other control functions have filed.

**Measured consequence.** In every live gold run of 2026-09-18 that reached
a synthesis (`docs/jarvis-voice-live-proof.md` §14), the Research Office's
revision 2 declared `portfolio-risk`, so Risk applied and the committee's
conclusion was unreachable by the firm on its own. See TD-100 for the other
half of that fact.

**The resolution** is a Risk candidate boundary on the pattern the three
other control functions now use: a context of what Risk reads, a JSON
contract validated by a domain builder, `RecordGovernanceCandidate` for a
fourth kind, and the Risk principal filing it. Not in G1 by ruling.

## TD-99 · no examination round after a material objection · open

**Opened 2026-09-17** at G1, by ruling. A material objection from the Devil's
Advocate stops the firm at `objections-unresolved`, visibly, with the
objector and the argument said to the person (`liveSpeech.objectionLines`,
proven in memory). Nothing then answers the objection: no re-examination by
the desks, no rebuttal, no withdrawal — the round that would let the firm
resolve or sustain the objection on the record does not exist, and the ruling
forbade building an automatic objection/rebuttal loop in G1.

**The resolution** is a bounded round — one re-examination by the desk whose
claim is contested, one ruling on the objection by the office or the CIO —
with a hard stop, designed when the firm has seen real material objections.

**Built 2026-09-22 as a bounded correction round, by ruling** (the
material-objection round this entry opened on is a separate question and
stays open — see below). What the record now does: Verification files
`correction-required` on revision N; the standing names `return-for-correction`
as the institution's next act, owned by the office that synthesised; the
office performs `ReturnForCorrection`, whose owners are derived from
provenance (`correctionsOwed`: finding → claim → the one accepted run that
produced it → its desk) and never chosen — a defect in a specialist's claim
goes to that desk, a defect the synthesis introduced goes to the Research
Office, a citation defect to whoever made the claim, and a finding on a claim
no accepted run produced refuses the act; each owner's assignment is
`returned` with the findings as its reason and the office's own synthesis
assignment with it; the returned desks are commissioned again with a
corrections brief (`ContributionRequest.corrections`, rendered into the live
desk prompt) scoped to revision N, the untouched desks' work is reused, and a
corrected contribution marks the one it replaces `obsolete` on adoption; the
office re-synthesises with the verdict in its context and mints revision N+1
with cause `correction` and a reason naming the verdict, N superseded and not
edited; the successor is submitted, which reopens Verification, the Devil's
Advocate AND the peer examination; every control function examines N+1 under
its own principal; Risk resolves again and stays `not-required` for an
explanation; the verdict on N stands on the record as history and stands for
nothing on N+1 (`reviewStandsForCurrent`); the conclusion's `dissent` is
N+1's and the objections to N are kept beside it as `priorDissent`, each
saying whether the same function renewed it. The firm takes one such round
on its own (`MAX_AUTOMATIC_CORRECTION_ROUNDS`, counted off the lineage);
after it, a verdict that still demands corrections is the visible stop — the
host says how many findings, whose, and that the round is spent — and the
act remains a person's. Neither JARVIS nor Verification corrects anything.
Proven deterministically (`corrections.test.ts`, `correctionRound.test.ts`,
`hostGovernanceLoop.test.ts`: the correction path to the explanation, the
stop after one round, and the no-correction path).

**Live, 2026-09-23** (`docs/jarvis-voice-live-proof.md` §16): the round ran on
the firm's own initiative through the return, the targeted corrections, the
successor with explicit lineage, Risk again, the successor's submission and
fresh examinations starting (run 18), each earlier run stopping on one defect
the record named and a planted test now holds; the conclusion after
correction is proven in memory, not yet live.

**Still open in this entry:** the round that answers a RETAINED OBJECTION —
a material Devil's Advocate objection on a judgement, which stops the firm at
`objections-unresolved`. Nothing re-examines or rebuts it yet; the correction
round is Verification's, not the Devil's Advocate's, and building the
objection round is a separate ruling.

## TD-100 · an explanatory opening ends at Risk's queue — CLOSED 2026-09-22

**Opened 2026-09-18**, measured on the live gold runs of that day
(`docs/jarvis-voice-live-proof.md` §14). The person asked the committee why
gold is up today; the opening was proposed as `explain` with no
implications. In all three runs that reached a synthesis the Research
Office's live provider minted revision 2 as position `hold` declaring
`portfolio-risk` (cases `case-d9e563c9e766a45e31a628af`,
`case-9f6a83a345baa705070ab4d2`, `case-399f655e8f049896171285e8`), the
pinned rule read that as "Risk applies", the submission opened Risk's
queue, and — Risk having no provider (TD-98) — the case can never reach the
committee's conclusion on its own, whatever Verification says.

**Why it matters.** The ruling of 2026-09-17 said a market explanation is not
a full committee by default. The synthesis contract does not know the kind of
opening it is reconciling, so an explanation is free to become a position with
implementation implications, and then the firm's own policy — correctly —
demands a risk review nobody can perform.

**The resolution is a ruling**, then a small change: either the synthesis
contract carries the opening's kind and an explanatory revision declares no
implementation implications unless the desks' evidence supports acting, or the
requirement rule reads the opening's kind. Not decided here; the record is.

**CLOSED 2026-09-22, by semantic constraint (ruled 2026-09-18).** The
resolution is a ruling and one derivation: the kind of question is read off
the opening revision (`inquiryKindOf`; an explanatory opening carries the
position word `explain`), and an explanation may not become a position or
declare an implementation implication (`synthesisPermittedFor`) — refused by
`AggregateManagerConclusion` whether a person stated it or a candidate
carried it, and refused as malformed by the live synthesis contract, which
now states the rule. With no implications, the pinned Risk rule resolves
`not-required` on its own. The kind travels into every control function's
context, and `challengeBlocks` retains analytical dissent on an explanation
instead of stopping the firm on it; only a factual contradiction at the
policy's materiality still does. TD-98 stays open and was not used as the
fix. Proven in memory (`inquiry.test.ts`, `explanationSemantics.test.ts`,
`hostGovernanceLoop.test.ts`) and live on 2026-09-22 (`docs/jarvis-voice-live-proof.md` §15: the live gold case `case-fd3e3f4dcd597ba9a0aeea3e` reached revision 2 as `explain` with no implications, Risk resolved `not-required` and its queue never opened, all three control functions filed, and the Devil's Advocate's five material and decision-critical objections stood on the record as retained dissent — the case's only blockers were Verification's own `correction-required` findings, the hard block the ruling kept).

## TD-101 · Verification's live envelope · open

**Opened 2026-09-18**, measured on the fifth live gold run
(`docs/jarvis-voice-live-proof.md` §14.6). With the answer cap at 8,192 and
a revision of 32 accepted claims and their citations (17,000–18,000 input
tokens), the live Verification call did not finish inside the 180,000 ms
deadline the v8 workflow reuses from the desks; the run settled `timed-out /
provider-timeout` at exactly 180 s. The Devil's Advocate and the peer, on the
same revision with a claims-only context, answered in 45–120 s.

**Measured directly** (`npm run dev:measure-governance -- --case <id> --call
verification`): see §14.6 of the proof for the one call timed outside the
loop, its tokens, and whether its candidate passed the domain's builders.

**The resolution** is a Verification deadline of its own, computed from that
measurement — one attempt plus one retry, as v4 did for the desks — in a
new workflow version, since a deadline is inside `playbookContentHash`.

## TD-102 · a run stayed `running` for 59 minutes past its 180 s deadline — CLOSED 2026-09-22

**Opened 2026-09-22**, measured on run 11 of the gold case
(`docs/jarvis-voice-live-proof.md` §15.3, `case-aeba56c703b682ae6d785699`).
The Research Office's synthesis run started 17:42:22Z and its
`timed-out / budget-exhausted` event is stamped 18:41:08Z: the provider's
answer arrived at the cap an hour later, and the run's deadline — 180,000 ms,
armed by `executionPipeline` through `withTimeout` and an `AbortController`
whose signal every provider forwards to `fetch` — did not abort the call.
The same pipeline aborted Verification at exactly 180 s in run 5 (§14). For
that hour the case read `working` to the host, truthfully by the record and
falsely by the world, and the probe waited with it.

**Not diagnosed.** Candidates: the dev server's event loop stalled (the
probe's own hard cap of 25 minutes did not hold either, which points at the
server rather than the timer); Node's fetch not honouring the abort once the
response had begun; a timer that never armed for this attempt. One
occurrence; the timestamps are the evidence.

**The resolution** is a measurement first — the pipeline's timer and the
fetch's abort observed under a deliberately stalled provider in a test that
plants the stall — then whichever fix the measurement names. Until then TD-92
(an abandoned run stays `running`) is the recovery path.

**CLOSED 2026-09-22, from measurement.** The root cause is on the machine's
own power log: the workstation entered modern standby at 19:42:48 local
(Kernel-Power 506), 26 seconds after the synthesis run started, and left it at
20:41:07; the run's `timed-out` event is stamped one second later. A frozen
process fires no timer and writes no record — the 59 minutes were the
machine's, not the pipeline's. Two defects the stall exposed in
`executionPipeline` were real and are fixed: an attempt that settled AFTER the
run's deadline was accepted if it settled `ok` (a late answer could have
resurrected an expired run), and one that settled with a failure was labelled
`budget-exhausted / not retryable` — the label run 11 carries — when the
window had in fact ended because the provider did not answer inside it.

**Deadline semantics after the fix.** The deadline is the run's, measured on
the wall clock from the start of `executeWithinRun`. While the process runs,
`withTimeout` aborts the call at the deadline and the run settles
`timed-out / provider-timeout` within milliseconds (run 5 of §14 measured
exactly 180 s). If the process is not running — suspended, as here — no code
runs and no record moves; the host's reader already says so, since a
`running` row whose window has passed is `execution-recovery-required`, never
`working`. At the first moment the process runs again the deadline is
enforced whichever way the attempt settled: the timer firing, a failure or an
answer arriving all end in `timed-out / provider-timeout`, retryable, and
whatever the attempt produced is discarded — a late provider response never
resurrects an expired run. Remote cancellation stays a transport limitation
and is not what the institution relies on.

**Proven** with planted providers: an attempt that settles `ok` after the
deadline is refused and not retried; one that settles with a failure after the
deadline is a timeout, not spent budget; one that settles inside the window is
accepted (`executionPipeline.test.ts`); and at the institutional level a desk
whose answer arrives an hour late leaves its run `timed-out`, stores no
claim, and puts the work back on the queue (`orchestration.test.ts`). A
process that never resumes leaves what TD-92 describes; that is the one
remaining recovery path, and it is TD-92's.

## TD-103 · the office's correction synthesis has no envelope of its own · open

**Opened 2026-09-23**, measured on live run 13 of the gold case
(`docs/jarvis-voice-live-proof.md` §16.3, `case-377285ab3f561b4cf3924092`).
The Research Office's re-synthesis after a correction round — the same
synthesis prompt plus the verdict's findings and two corrected
contributions, answered at the 8,192-token cap — settled `timed-out /
provider-timeout` at exactly 180.1 s, the deadline the v8 workflow reuses
from the desks for the aggregation entry. The plain synthesis on the same
window took 55.8 s (run 12) and 63.9 s (run 13); the re-synthesis took
89.4 s in run 12 and did not finish in run 13. One sample over the deadline,
one under: the envelope is not known yet.

**What the firm did with it.** The deadline held (TD-102): the run left
`running` at 180 s, retryable, with the label the record now keeps; the
office's assignment went back to its queue with its returned reason intact;
the desks' corrections stood (marked their predecessors obsolete); the case
read `blocked · verification-correction-required · Research Office` with
`activity.failed = 1`, and JARVIS said the fact-check demands corrections and
that a desk could not complete its work. The round did not finish on the
firm's own initiative: a timed-out run is re-commissioned on the next pass,
and no pass follows a timeout unless the person speaks again — the same rule
the desks have had since G1. The person's word resumes the office alone
(`hostGovernanceLoop.test.ts`, planted timeout).

**Measured 2026-09-23, outside the loop** (`npm run dev:measure-governance --
--case case-4395e70f9a52d09516112791 --call synthesis`, added for this). The
re-synthesis on the run-15 record answered in 107.5 s — and was REFUSED as
malformed. The two "timeouts" were a refused first attempt whose retry the
180 s deadline cut at the second attempt, not a slow answer. The cause was
the office's correction prompt: it listed the findings by the ids of the
claims Verification had examined — claims the desks had since replaced —
under a contract that says every claim id given gets a disposition; the
office obeyed and disposed of ids no longer in scope. The prompt now quotes
the earlier claims' statements and says only the accepted contributions'
claims are to be disposed of; re-measured directly, the same record answered
in 99.5 s (3,580 in / 5,607 out), parsed, `explain`, 23 dispositions.

**What stays open.** A valid re-synthesis fits the 180 s the aggregation
entry has (89–107 s measured), but a refused first attempt leaves no room
for a second inside it. A deadline of the office's own — a workflow version,
since the deadline is inside `playbookContentHash` — and whether a timed-out
run in the middle of an autonomous round earns one automatic retry (today it
does not; the person's next word resumes it) are the ruling's to decide, from
these numbers.

## TD-104 · the relationship record lives in one server process · open

Opened 2026-09-23 with Client Intelligence Phase 1 (`docs/client-intelligence.md`).

**What.** `infrastructure/advisory/container.ts` composes the advisory
context over in-memory repositories seeded from `syntheticClients(today)`.
A confirmed client update, a completed promise and every candidate live in
that process's maps: they survive page loads and vanish when the server
restarts or the dev server re-evaluates the module.

**Why it is debt and not a design.** The ports (`application/advisory/ports.ts`)
are the seam a PostgreSQL adapter fills, tenant-scoped, behind the same
container; the surfaces and use cases do not change. It is not built because
no real client data may enter before the privacy posture is ruled
(`advisor-os-architecture.md` §6), and a durable store of synthetic
relationships would only be a store to migrate.

**What closes it.** PostgreSQL repositories for the advisory ports, migrated
through the runner, with the contract tests the analysis adapter already
has (in-memory and PostgreSQL judged by one contract), and a ruling on the
privacy posture before the first non-synthetic client.

## TD-105 · _Fråga JARVIS om klienten_ is a door of its own, not a JARVIS intent · closed 2026-09-30 (typed path)

Opened 2026-09-23.

**What.** The client page answers questions about the relationship through
`askAboutClientFn` → `searchClientMemory`, deterministic, from structured
memory. The presence's router (`application/jarvis`) knows no advisory
intent: asking JARVIS in the presence _"Vad lovade vi Henrik?"_ does not
reach the record.

**Why.** The Advisor OS design (`advisor-os-architecture.md` §1, §4.2) says
advisory intents become tools of the one router, Tier 0, with the fast-path
rule extended to the new recogniser — never a second assistant. Building
the client-scoped door first proves the memory and its answer shape; wiring
it into the router is the next slice, and it is a router change with its own
routing acceptance and `fast-path-meets-no-model` coverage, not a client
page change.

**What closes it.** An advisory Tier-0 recogniser and formatter in the
router (`client_context`, `list_commitments`, `next_meeting`…), the fitness
rule extended to them, and the six-line routing acceptance re-run with
advisory lines planted.

**Closed 2026-09-30, for the typed path** (`docs/jarvis-context.md`). The
presence sends the route with every line; the server resolves a
`JarvisContext` from it and the advisory tier (`application/jarvis/
advisoryTurn.ts`) answers in Tier 0 — a deterministic recogniser
(`advisoryIntent.ts`) over the existing evidence services, a typed
`JarvisAnswer` with sources — before any model, and without one. The
client and cockpit doors remain as pages' own panels; the presence is now
the one router for them too. **Still open for the voice path:** a spoken
line goes to the backend model, which has no advisory tool yet.

## TD-106 · the advisor recording a note is the client's primary advisor · open

Opened 2026-09-23.

**What.** `recordClientUpdate` attributes a note, and every record confirmed
from it, to `client.primaryAdvisorId`. There is no session, so nothing else
is honest; but Sofia recording a note on Martin's client would be recorded
as Martin.

**Why.** The configured operator (`FINANCIAL_OS_OPERATOR_EMPLOYEE_ID`) is an
employee of the seeded investment organisation, not an advisor in the
advisory record, and inventing a mapping between the two would be the
simulated identity the 2026-08-13 ruling forbids. TD-8 (no authentication)
is the root.

**What closes it.** An advisor identity resolved server-side — the operator
extended to advisory roles, or an authenticated session under TD-8 — and
`createdBy` read from it rather than from the client.

## TD-107 · `vite build` failed: the MCP stdio client reached the browser bundle — CLOSED 2026-09-24

Opened and closed in the Client Intelligence review. The C2-2 gate (§8.3)
recorded the failure as pre-existing since `988a327` and left it without a
cause; this entry records the cause and the cut.

**Cause, measured.** `infrastructure/marketData/serverFns.ts` exported
`getContainer`, a plain async function whose body dynamically imported the
providers and `~/services/avanzaMcp/client` →
`@modelcontextprotocol/sdk/dist/esm/client/stdio.js` → `node:stream`.
Every route imports `serverFns`. TanStack Start strips `createServerFn`
handler bodies from the client build and nothing else, so rollup loaded
that dynamic-import chain for the browser and failed linking `PassThrough`.
Neutralising that one function's body made the build pass; restoring it
made it fail.

**The cut.** The factory now lives in
`infrastructure/marketData/containerInstance.ts`, imported statically by
nothing. Handlers in `marketData/serverFns.ts`, `marketData/healthFns.ts`
and `jarvis/serverFns.ts` reach it with `await import('./containerInstance')`
inside their own bodies; the JARVIS door hands the getter into its runtime
so no module-level code names the module. A module-level helper wrapping
the same dynamic import re-introduces the failure — measured — which is why
the import is repeated at each call site rather than shared. The two
fitness pins (`COMPOSITION_ROOTS`, "registers only approved providers")
moved with the factory.

**What did not change.** One container per process, memoised; the same
providers registered under the same modes; the health token gate; the live
JARVIS runtime's use of the market brief.

---

## TD-108 · Market-to-Client coverage is the overview's coverage · open

Opened 2026-09-24 with Market-to-Client V1 (`docs/market-to-client.md` §8).

The engine judges clients against the series the overview snapshot carries:
four government yields, six indices, the nine S&P 500 sectors, USD/SEK and
EUR/USD, Brent and Gold, and the cross-asset score. Three gaps follow. A
Swedish energy or bank holding is judged against the US sector, because no
Swedish sector series exists. FX carries a currency tag only for pairs
quoted in SEK, so EUR/USD opens events that reach nobody, and a EUR holding
is reachable only once EUR/SEK is served. Gold reaches nobody by design (no
holding is tagged as a metal theme). None of this is wrong; it is narrower
than the product claims once a Nordic sector feed or EUR/SEK arrives.

**Resolution.** Add the series to the overview under the existing provider
discipline, then extend `SECTOR_OF` / `FX_CURRENCY` in
`application/advisory/marketImpact.ts` — the domain pathways need no change.

---

## TD-109 · Materiality thresholds are fixed constants · open

Opened 2026-09-24.

`MATERIALITY` states one enter/exit/major line per category (10/6/20 bp for
rates, 1.5/1.0/3 % for indices, and so on). They are documented and tested,
but not scaled to realised volatility: a 12 bp day is _notable_ whether the
curve has moved 2 bp a day for a month or 15. V1 chose stated constants
over a volatility model deliberately — a threshold the advisor can quote
beats one that moves — but a calm-regime / stressed-regime pair, or a
z-score against a trailing window, is the natural next version.

**Resolution.** Version the rule (`method: 'market-to-client-v2'`), keep the
constants as the floor, and measure on recorded history before widening
anything (`[[measured-need-earns-budget]]`).

---

## TD-110 · the market-event ledger is per process · open

Opened 2026-09-24. A consequence of TD-104, recorded separately because its
failure mode differs.

`repositories.marketEvents` holds the open events between reads so
hysteresis, expiry and first-seen times hold across requests, and — since
the 2026-09-29 hardening pass — the closed episodes as history (180 days,
at peak, with close reason), which the meeting briefing and Client 360 read
for "what happened since the last meeting". It lives in the synthetic
repository with everything else, so a server restart forgets every open
episode and every closed one: the next read re-opens events on the enter
line with a fresh `firstSeenAt`, a dismissal bound to an event that was
mid-fade (below enter, above exit) lapses because the event does not
re-open, and the briefing's market window is empty until new moves open.
Derived state, harmless in a demonstration, wrong for an advisor who
dismissed something at 09:00 and sees it back at 09:05 after a deploy, or
who prepares a meeting the morning after a deploy.

**Resolution.** Persist the ledger beside the dispositions when TD-104 is
resolved; the port is already the seam.

---

## TD-111 · meeting baselines are per process · open

Opened 2026-09-29 with Meeting Cockpit 2.0 (`docs/meeting-cockpit.md`).

`repositories.meetingSnapshots` holds the structured baseline captured when
a meeting is confirmed, so the next preparation compares against what was
known then. It lives in the synthetic record with everything else: a
restart returns every client to the seeded baseline, and a meeting recorded
before the restart is compared against the wrong past. The port is the
seam; the snapshot is already structured domain data with no UI state, so
persisting it is a storage decision, not a modelling one.

---

## TD-112 · the cockpit composes with rules, not a model · open

Opened 2026-09-29.

The focus sentence, the possible client questions, the questions to ask,
the agenda and the objectives are composed from typed items by fixed
Swedish templates. That is deliberate for V1 — every sentence is
traceable and nothing is invented — but a reader will feel the seams
between templates. The read model (`MeetingCockpit`) is the boundary an AI
summarisation layer can sit behind: it would read the same typed items and
the same source ids, and it must not add facts. Not before a production
LLM posture is ruled.

---

## TD-113 · the relationship book's selection is process-local, not in the URL · open

Opened 2026-09-29 with the navigation pass.

The search, the filter and the sort of `/clients` live in a module store
(`components/clients/directoryState.ts`) so that opening a client and
pressing back finds the book as it was left. Deliberate: a keystroke is not
a navigation, and every navigation now runs inside a view transition. The
cost is that a filtered book cannot be shared as a link and a reload
forgets the selection. If a deep link to a filtered view is wanted, the
filter and the sort (not the search text) belong in the URL, navigated
with `replace: true` and `viewTransition: false`.

---

## TD-114 · an interrupted view transition is reported as a page error · open

Opened 2026-09-29 with the navigation pass.

Every navigation commits inside `document.startViewTransition`. When the
next navigation begins before the previous 220 ms transition has finished
— two quick presses of the browser's back button — Chromium abandons the
first one and reports `AbortError: Transition was skipped` as an unhandled
promise rejection. Nothing visible goes wrong: the newer navigation wins.
The router discards the transition handle, so nothing of ours can attach a
handler. Observed once in the browser probe on the cockpit → Client 360 →
Klienter double back; not reproduced deterministically. Leave it unless it
grows into something a user can see.

---

## TD-115 · dashboard client components with no surface · open

Opened 2026-09-29 with the navigation pass.

`SentinelBriefList`, `SentinelGreeting` (`components/sentinel/SentinelBrief.tsx`)
and `MarketImpactList` (`components/marketImpact/MarketImpactModule.tsx`)
rendered the two client modules the home page carried for one stage. The
modules are gone; the components and their tests remain, unrendered, so
that the ruling can be reversed without rebuilding them. If the ruling
stands through the next stage, delete them and their tests rather than
carry dead surfaces.

---

## TD-116 · the dossier's display serif is fetched from Google Fonts · open

Opened 2026-09-29 with the Client 360 dossier pass.

Playfair Display is linked from the document head (`routes/__root.tsx`)
and `--font-display` falls back to Georgia where it does not arrive. A
runtime dependency on a third-party CDN is acceptable for a demonstration
and not for a bank: before any deployment, self-host the two weights under
`public/fonts` and drop the preconnects. The fallback means nothing breaks
offline; the dossier only loses its face.

---

## TD-117 · client portraits are a presentation map, and it is empty · open

Opened 2026-09-29 with the Client 360 dossier pass.

`presentation/advisory/portraits.ts` maps a client id to a portrait URL and
maps nothing: every synthetic client opens on the monogram. Deliberate —
a photograph of a real client is governed data and Client 360 must work
without one — but a deployment that may show approved portraits needs a
governed source for that map, not a constant in the presentation layer.

---

## TD-118 · the PDF briefing book sets standard fonts, not the product's typeface · open

Opened 2026-09-30 with the Meeting Pack engine.

`infrastructure/documents/pdf.ts` renders with pdfkit's standard fonts
(Times for display, Helvetica for body) because no typeface file is in the
repository (TD-116 fetches the dossier's serif from a CDN at runtime). The
book is printable and consistent, but it does not carry Playfair Display
or Inter, and every string is written through WinAnsi — the minus sign and
the arrow are mapped before they reach the page. Self-hosting the two
faces (TD-116) and registering them with pdfmake closes this; the
PowerPoint names Georgia and Calibri and lets Office substitute.

---

## TD-119 · generated pack versions are process-local · open

Opened 2026-09-30 with the Meeting Pack engine.

`infrastructure/documents/meetingPackStore.ts` keeps every generated
version — metadata and bytes — in the server process, and writes each file
under `.generated/meeting-packs` so it can be opened. A restart forgets the
list; the version counter then continues from the files on disk with the
same base name, so a number is never reused for different content, but the
preview's list starts empty. Persistence of pack versions belongs with the
rest of the record (TD-104), governed, and with retention.

---

## TD-120 · the pack's readiness and outline are rules, the notes are composed · open

Opened 2026-09-30 with the Meeting Pack engine.

The readiness gate, the slide outline, the executive summary and the top
priorities are deterministic selections over cockpit items; the speaker
notes are the cockpit's own sentences arranged per slide. Nothing is
summarised by a model. The seam is `MeetingPack` → `composePackDocument`:
a later summarisation layer would write into the same typed document and
be subject to the same tests (no id, no arrow, no invented figure). The
same holds for the JARVIS pack commands, which are a lexicon (TD-105 for
the voice path remains).
