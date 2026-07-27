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

| Stage                                     | State |
| ----------------------------------------- | ----- |
| 0 · transaction-capable ports             | done  |
| 1 · schema and migrations                 | done  |
| 1.5 · revision-scoped governance reviews  | done  |
| 2 · PostgreSQL adapter                    | open  |
| 3 · dual write                            | open  |
| 4 · read verification                     | open  |
| 5 · read switch                           | open  |
| 6 · in-memory out of the composition root | open  |

Stage 0 closed the two gaps the plan opened with: the ports had no transaction
boundary, and no list method defined an ordering. Both are now on the port and
enforced by the in-memory adapter, which becomes the reference implementation
PostgreSQL is verified against in stage 4.

Stage 1 built the schema, the migration runner and the seeded organization,
verified by 110 integration tests against real PostgreSQL 18.4. **No adapter
exists yet and nothing in the runtime connects to a database** — the in-memory
adapter is still the only one, which is why this item stays open.

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
