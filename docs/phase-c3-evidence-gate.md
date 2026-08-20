# C3 — The evidence the firm holds

**Status: APPROVED 2026-08-17. GO.** The rulings that govern implementation are
in **§0**, recorded at approval so the work is judged against them rather than
against the conversation that produced them. Where §0 and the analysis below
differ, §0 wins.

C2-2 is closed and manually accepted at `3e022bd`. It is not reopened here.
Its §8 handoff is the authority for what remains open (TD-76, TD-77, TD-78),
for the observed PostgreSQL flakiness, for the pre-existing `vite build`
failure, and for the five properties that must not be weakened. This document
inherits all of it unchanged.

**Why this phase, and why now.** The C2-2 live acceptance recorded the finding
that points here: given one undescribed yield reading, Global Macro produced two
`supported` observations and **five `insufficient-evidence` claims**, explicitly
refusing to characterise the regime, the policy path, a comparison, a rates view
or an FX view. The desk behaved correctly. The constraint on decision quality
moved from agent capability to evidence, and that is what C3 addresses.

**The strategic objective is not ingestion volume.** It is the minimum
institutional evidence architecture required to form a defensible,
continuously updateable Macro Investment View. The test applied to every
proposal below: *does this materially improve investment-decision quality?*

---

## 0. Rulings in force

Approved 2026-08-17 and binding for every stage. Recorded here at approval,
before implementation, so the work is judged against a document rather than
against a chat. Each ruling names the decision it settles; the analysis that
produced it is below and is unchanged.

### 0.1 Observation identity — option (b), and history is not rewritten

The v2 observation identity is introduced correctly domain-tagged and versioned,
carrying `referencePeriod` (§3 Decision 5).

**Existing v1 observations and citations remain valid historical institutional
records and must remain resolvable as v1.** No migration rewrites a v1 id, a v1
content hash, a v1 evidence-set id or a v1 citation. Nothing may present a v1
observation as though it had been created under v2 semantics — an id that
changed meaning without changing generation is exactly the ambiguity versioning
exists to prevent.

The two generations coexist. A v1 evidence set stays citable, stays readable,
and reports itself as v1.

### 0.2 No `Series` aggregate — approved

A time series is a **query over individually identifiable and individually
citable observations**. This holds unless implementation proves the model
insufficient; proving that is a finding to report under §0.9, not a licence to
add the aggregate.

### 0.3 Ingestion and assembly are separate institutional acts — approved

The distinction to preserve: **acquiring an observation** is not **declaring a
body of evidence suitable for institutional analysis**.

`AssembleEvidenceSet` takes a **query**, never a caller-selected list of
observation ids.

**Additional requirement, part of the ruling:** the **assembly query — the
selection rule itself — must be durably recorded and versioned**, so the
institution can later explain *why those observations and not others*
constituted the set. An evidence set whose membership can be seen but whose
selection cannot be reproduced is a set nobody can defend. The recorded rule is
part of the set's institutional record, alongside its members.

**`/smoke/c2-1` is retired when the replacement capability is genuinely in
place**, not before. Removing the only working evidence-write path ahead of a
governed one would leave the firm unable to produce evidence at all.

### 0.3b Evidence ↔ observation linkage — ruled 2026-08-18, Stage B

**Forward only. No backfill.**

`evidence_items.value` and `provenance` become nullable. A set assembled from
the observation store stores **membership plus the `(observation_id,
content_hash)` linkage** and reads the payload through `analysis.observations`,
so there is one institutional truth for what an observation said. Rows that
predate the observation store keep their payload untouched.

**Why not a backfill.** Measured: `evidence_items` has no knowledge-time column
in `0004` or `0030`, so the only time available for a pre-C3 item is its set's
`assembled_at` — an **upper bound** on when the firm learned the figure, not the
fact. Storing a bound as though it were exact is the class of thing this
codebase refuses everywhere else, and it is the same shape as the
`policyStateRef` refusal in §0.6.

**The cost, stated rather than discovered:** two row shapes coexist and
hydration branches on NULL. The branch is bounded — the legacy shape is a closed
set that can never grow, because every new assembly links.

### 0.3c Precision of persisted derived facts — ruled 2026-08-18

**Do not persist or hash binary floating-point artefacts.**

`19.99999999999997` bp is deterministic, but it is not the institutional fact
represented by source values `4.1` and `3.9`. For a **persisted derived
financial observation**, calculation semantics must preserve the **decimal
meaning of the canonical source values**, not the incidental IEEE-754
representation used during computation.

For `spread-2s10s@1` the institutional derivation is:

> `decimal(10Y yield) − decimal(2Y yield)`, expressed in basis points.

so `4.1% − 3.9% = 0.2pp = 20 bp`, and the persisted canonical value **is `20`**.

**Not solved by rounding after the fact.** An arbitrary presentation rounding
applied to a binary result would be a second rule nobody stated, hiding the
first. The fix is exact decimal arithmetic **at the derivation boundary**, over
the canonical decimal source values.

**`curveSlopeBasisPoints` is not globally changed.** Its existing sentiment
consumer keeps its current semantics; altering it to satisfy C3 would change a
behaviour C3 was never asked to touch. Its **financial formula is reused** — long
minus short, times 100 — through the smallest explicit decimal boundary
necessary for the persisted fact.

**The methodology version binds the numeric rule.** `spread-2s10s@1` means this
arithmetic. A later change to calculation or precision semantics is a
**methodology-version decision** — `@2` — and never a silent restatement of
facts already hashed under `@1`.

### 0.4 First vertical slice — sovereign yield curves — approved

Its purpose is to **prove the evidence pipeline against real authoritative
historical data** while exercising observations, series-like querying,
revisions, derivation, provenance, freshness and co-temporality.

**It does not create a complete Macro Investment View, and no stage exit, code
comment, interface string or completion report may claim that it does.**

### 0.5 Derived observations — approved

A derived institutional fact is persisted with its **exact input observation
refs** and a **versioned methodology** — `spread-2s10s@1`.

Important institutional derivations **must not be independently recomputed
inside model prompts or presentation code.**

**One derivation per institutional fact** is preserved.

### 0.6 `referencePeriod`, disagreements and revisions — approved

`referencePeriod` enters the **v2 observation identity semantics**.

A **revision** — same source, same series, same reference period, later
publication, different content — is separated from a genuine **cross-source
disagreement**. `EvidenceDisagreement` **must not be overloaded to represent
both**.

#### Amendment, ruled 2026-08-17 during Stage A

**In the v2 key, `referencePeriod` REPLACES `observedAt`. It does not join it.**

Implementation measured that adding the field while keeping `observedAt` does
not deliver this ruling. A revision changes `observedAt`, which changes the key,
which changes the id — so `isRevisionOf`, which requires *same id, different
content hash*, never fires:

```
Treasury 10Y, reference period 2026-08-14, revised on 08-17
  same referencePeriod   true
  same id                false
  isRevisionOf()         false
```

A claim citing the original would resolve **cleanly** to a figure that had since
moved, and `resolveCitation` would never report `revised` — defeating the Fact
Checker's whole purpose. The module header already describes the behaviour this
amendment restores: *"if the Treasury revises that Friday figure, the `id` is
unchanged and the `contentHash` differs."* Under v1 that held only by accident,
for the one adapter whose `asOf` is derived from its reference date.

So the v2 natural key is:

```
subjectKind · subject · kind · sourceId · seriesId? · methodology? · referencePeriod
```

**`observedAt` remains on the reference and in provenance — it is simply not
identity.** It is when the source *published*; the key is about *what was
described*. Three consequences, stated rather than discovered:

- **`referencePeriod` is required in v2**, not optional. Without it the key has
  no temporal coordinate at all and every observation of one series collapses to
  one identity. Where publication and reference genuinely coincide — an intraday
  quote — the adapter sets it to the instant, and it says so.
- **One evidence set holds one version** per (source, series, reference period);
  the durable observation store retains every version under
  `(observation_id, content_hash)`. A set is a snapshot of what the firm
  believed when it assembled, which is what a set should be.
- **The ECB daily-identity pathology closes.** `asOf` advances every calendar
  day while `effectiveDate` does not, so a standing policy rate currently mints
  a new observation identity daily; `policyStateRef` excludes the observation
  date from the *content* hash to hide it. Under v2 the key carries
  `effectiveDate` and the workaround is no longer load-bearing.

Every existing builder already holds the right field —
`GovernmentYield.observationDate`, `PolicyRegime.effectiveDate`,
`YieldCurve.observationDate` — which is the strongest available evidence that
this coordinate was always the real one.

### 0.7 No `MacroView` aggregate — approved provisionally

Thesis, claims and revisions are reused **where they truthfully carry the
semantics**. Where they do not, that is reported rather than stretched.

**Thesis-level confidence stays explicitly unresolved.** Manufacturing a second
confidence model beside `ClaimConfidence` is forbidden in C3.

### 0.8 Portfolio risk posture — approved with a qualification

C3 introduces **no portfolio-risk-posture aggregate**, and Global Macro **does
not own** the `100/0 → 80/20 → 60/40 → 40/60` decision.

**The qualification is part of the ruling.** C3 must **not** make a permanent
architectural ruling that an approved tactical allocation can never become its
own durable institutional record. The firm will eventually need to measure
decisions and outcomes over time, and whether an approved tactical allocation
requires a durable record for **attribution, after-action review and Performance
Office learning** remains a **future explicit decision**.

So: nothing is built, and nothing is foreclosed. Any code, comment or document
asserting that a tactical allocation is *permanently* an implication of another
record overreaches this ruling and is wrong.

### 0.9 Prompt evidence semantics — a C3 decision-quality objective

The measured `renderUserPrompt` deficiency (§1.8) is **part of C3's objective**,
not a side fix.

Where the institution already knows an observation's subject, kind, unit,
source, as-of, reference period and provenance, **the model must not receive
only an opaque hash and a raw payload and then be expected to reconstruct that
meaning.**

The requirement: **the smallest truthful representation** that gives an agent
the institutional semantics of the evidence it is asked to analyse, while
preserving **citation identity** and **provenance**.

**No parallel evidence schema merely for prompts.** The representation is a
rendering of the institutional record, never a second model of it.

### 0.10 Scope

C3 does **not** become: a complete macro regime engine; an allocation engine; a
generic data lake; TD-76 / TD-77 / TD-78 remediation; the Command Center
redesign; client portfolio implementation.

### 0.11 How implementation proceeds

Work runs to the **first planned clean green boundary** and stops there.

**If implementation exposes a genuinely new institutional choice, stop and
report it rather than designing around it.** A choice the firm has not made is
not a detail to be settled by whoever is holding the keyboard.

---

## 1. Measured current state

Read out of the repository at `3e022bd`. Mechanical measurements are marked
**probed**; structural ones are marked **read**. Nothing here is recalled.

### 1.1 Three of eight observation kinds can enter evidence — **probed**

`ObservationKind` declares eight kinds. `PROJECTED_FIELDS` in
`domain/analysis/identity.ts` defines a verifiable content projection for three,
and `UNVERIFIABLE_KINDS` is **empty by deliberate ruling**. A kind absent from
both fails closed.

| kind | storable |
|---|---|
| `quote`, `yield`, `policy-state` | **yes** |
| `yield-curve`, `fx-rate`, `series`, `news`, `sentiment` | **no** |

Executed against `buildEvidenceSet`:

```
series  → "not admissible: unsupported-unverifiable-kind"
fx-rate → "not admissible: unsupported-unverifiable-kind"
```

So a term structure, an FX rate, a time series and a sentiment reading cannot be
institutional evidence today. This is a correct fail-closed design, not a bug —
but it is the ceiling on what a desk can be given.

### 1.2 There is no observation store — **read**

`analysis.evidence_items` is keyed `PRIMARY KEY (evidence_set_id, observation_id)`.
**No table is keyed by `observation_id` alone.** An observation exists only as a
member of a set; the same ECB print used by two sets is stored twice, under two
set ids.

The consequence for C3: *a time series has nowhere to live.* The relational
columns for one are already there — `subject_kind`, `subject`, `kind`,
`observed_at`, `source_id`, `series_id`, `methodology` — with the stated purpose
*"the Fact Checker queries it: what else did we hold about this subject at this
moment."* Nothing queries it, and any such query would be scoped to one set.

### 1.3 The market → evidence bridge is built and unwired — **read**

`application/analysis/evidenceRefs.ts` is described as the one sanctioned module
importing market, policy and analysis together. It exports `quoteRef`,
`quoteEvidence`, `yieldRef`, `yieldEvidence`, `yieldCurveRef`, `policyStateRef`,
`policyStateEvidence`.

**Production callers: zero.** The only references anywhere are one test fixture
and two comments noting the absence. The typed bridge from real market data into
institutional evidence exists in full and nothing crosses it.

### 1.4 One production path manufactures institutional evidence — **read**

Every non-test caller of `repositories.evidence.save`:

| caller | what it is |
|---|---|
| `infrastructure/analysis/smokeFns.ts` | the C2-1 smoke proof, reachable at route `/smoke/c2-1`, gated on `C2_1_SMOKE=yes` |
| `decisionSeed.ts`, `aggregationHarness.ts`, `macroFlowHarness.ts` | test harnesses |

`smokeFns` hand-writes one hard-coded German 10y reading and calls
`repositories.evidence.save(evidence)` directly. There is **no actor, no
mandate, no command, no ledger entry, no event and no storage provenance**. The
`guard(scope, 'evidence.save')` in the in-memory adapter checks transaction
liveness, not authority.

Against that: `productionCommands()` registers **19 institutional acts**, every
one of which carries actor, mandate, envelope, ledger entry and events. Evidence
assembly is not among them.

`scripts/open-case.ts` only *lists* evidence. The evidence set used in the C2-2
manual live acceptance — `abb549c1…`, one ECB observation — came from
`/smoke/c2-1` and could have come from nowhere else.

### 1.5 Disagreement detection is near-inert for macro data — **probed**

`findDisagreements` groups on `subjectKind|subject|kind|observedAt`. Executed:

| scenario | disagreements reported |
|---|---|
| two sources, **same** `observedAt`, different value | **1** ✓ |
| two sources, **same reference date**, `observedAt` 16h apart, different value | **0** ✗ |

Macro observations essentially never share a publication instant across sources.
Two authoritative sources publishing the same figure for the same reference
period are, today, silently not in disagreement.

The module's own doc comment states that *"`observedAt` is excluded from the
grouping deliberately."* The code includes it. Comment and code disagree, and
the code is what runs.

### 1.6 A revision is reported as a disagreement — **probed**

Same source, same `observedAt`, revised value, both items in one set:

```
same observation id?  true
same contentHash?     false
disagreements: 1 → observationIds: ["46e2f56…","46e2f56…"], sourceIds: ["ecb","ecb"]
```

The id/contentHash split correctly *detects* the revision — that mechanism
works. What is missing is the **vocabulary**: `EvidenceDisagreement` is the only
way the set can say it, so "the ECB revised its own print" is recorded in the
same shape as "the ECB and the Bundesbank disagree", with one source listed
twice and one observation id listed twice.

**And such a set cannot be persisted.** `evidence_items` is keyed
`(evidence_set_id, observation_id)`; `EVIDENCE_SQL.saveItems` unnests the items
with no de-duplication. The in-memory adapter accepts the set. *(Read from the
DDL and the insert path — not executed against a database.)* This is the TD-78
class: the two adapters disagree, and the decision comes before the fix.

### 1.7 The observation id carries no domain tag — **read**

```ts
id:          stableHashHex(serializeKey(key))                                  // no tag
contentHash: stableHashHex(canonicalIdentityInput(OBSERVATION_CONTENT_DOMAIN, value))
```

`docs/canonical-value-v1.md` §9 requires a domain tag on every identity input.
The content hash has one; the id does not — it hashes a bare `|`-joined string.
This matters for §4.5 below, because it is also the natural versioning seam.

Observation ids are **pinned as literals** in `src/test/identityCorpus.ts`,
whose header states: *"If one of these fails, the encoding changed. That is a
version decision, not a test to update."*

### 1.8 The desk is shown an undescribed number — **read**

`renderUserPrompt` in `providers/live.ts`:

```ts
const observations = evidence.items.map(
  (item) => `- id: ${item.ref.id}\n  value: ${JSON.stringify(item.value)}`,
)
```

The model receives a hash and a raw payload. It is never told the **subject**,
the **kind**, the **unit**, the **source**, the **trust**, the **as-of** or the
**reference period** — every one of which is present on `item.ref` and
`item.provenance` and none of which is sent.

This is the measured cause of the C2-2 run's five `insufficient-evidence`
claims. The desk could not know that `{"yieldPercent":"2.41"}` was a German
10-year government bond yield published by the ECB for 15 August. It is the
cheapest available improvement to decision quality in the entire system.

### 1.9 What market-data infrastructure already exists — **read**

Nine real provider adapters, all keyless or free, all authoritative:

| adapter | serves | trust |
|---|---|---|
| `usTreasury` | US par yield curve, full history by month | issuer |
| `bundesbank` | DE yields | central-bank |
| `ecb` | three key policy rates | central-bank |
| `newYorkFed` | EFFR | central-bank |
| `riksbank`, `riksbankPolicy` | SE yields, SE policy | central-bank |
| `frankfurter` | FX (ECB reference rates) | aggregator → central-bank originator |
| `coinGecko` | crypto | aggregator |
| `avanza` | SE equities, OMXS30 | broker |

With them: TTL policy per category, `FallbackPolicy`, tiered cache,
single-flight, token bucket, circuit breaker, retry, timeout, daily budget,
Prometheus metrics, recorded fixtures and contract tests.

`FRED`, `Marketaux` and `TwelveData` have config entries and **no adapters**.
Only the fixture provider implements `fetchSeries` — there is no production
historical-series path anywhere.

**Nothing is persisted.** Migrations `0001`–`0029` are entirely the analysis
schema. Market data lives in a cache with a TTL and dies on eviction.

### 1.10 The ECB adapter already collapses a series into a point — **read**

Probed 2026-07-26 and recorded in its header: 400 consecutive daily
observations contained exactly two value changes. The adapter fetches the whole
history and scans it for the last actual change, because reading the observation
date as the effective date *"would have manufactured a policy decision every
single day, including weekends."*

So the firm already has a case where a time series is fetched, a derivation is
performed over it, and only the point result escapes — with the derivation
living inside an adapter and nothing recording it.

### 1.11 What the Macro View would need, and what already exists — **read**

| required expressiveness | exists | where |
|---|---|---|
| current regime | ✓ | `InvestmentThesis.position` (open string by design) |
| direction of change | ✓ | a supporting claim of type `trend` |
| confidence | ~ | per-claim `ClaimConfidence`; **no thesis-level confidence** |
| supporting evidence | ✓ | `supportingClaimIds` → claims → `evidenceRefs` |
| contradictory evidence | ✓ | `opposingClaimIds`, `contradictingEvidenceRefs` |
| market pricing vs firm view | ✓ shape, ✗ data | two claims (`observation` + `comparison`); no market-implied evidence exists |
| principal risks | ✓ | `DevilsAdvocateReview.challenges`, `RiskReview.findings` |
| invalidation conditions | ✓ | `invalidationCriteria` — **required by construction** |
| horizon | ✓ | `InvestmentThesis.horizon` |
| reproducible from the record | ✓ | revision lineage, `ManagerAggregation`, `BasisManifest` |

`InvestmentImplication` is a **closed vocabulary declared structurally rather
than inferred from prose**, and it already contains `asset-allocation` and
`portfolio-risk`. `RISK_REVIEW_WHEN_IMPLEMENTABLE` already makes Risk Review
conditional on it. The `portfolio-strategy` department is seeded, manager
`portfolio-manager`, responsibility `portfolio-impact`: *"Portfolio impact,
exposure, correlation and sizing implications of a thesis."*

### 1.12 The derivation shape already exists, unwired — **read**

`Quality: 'derived'`, `ProviderTrust: 'derived'` (trust tier 4),
`effectiveTrust` taking the weaker of route and originator, and `methodology` as
part of the observation **natural key** — *"a par yield and a fitted zero rate
for the same bond on the same day are two different observations."*

`MarketSentiment` carries `formulaVersion` and `SentimentComponent[]` with
`inputValue`, `inputAsOf` and `inputQuality`, and the derivation rule *"a
derived score is never fresher than its stalest input."* Nothing constructs one.

### 1.13 Inherited, unchanged

TD-76, TD-77, TD-78 open by ruling. TD-75: four of seven confidence signals have
no production derivation — `weakestEvidence`, `anyStale`, `conflictingEvidence`,
`methodologyMismatch` — and `composeConfidence` has never run over real evidence
outside `resolveModelConfidence`'s narrow path. TD-25: evidence payload
integrity is checked on write, not on read. TD-37: stored results are reusable
only within one case. `npx vite build` fails, pre-existing (§8.3).

---

## 2. The gap, stated once

The firm has a **complete governance architecture over evidence it cannot
produce**, and a **complete data architecture producing values it cannot make
institutional**.

| the institution has | the market layer has |
|---|---|
| content-addressed observation identity | nine authoritative adapters |
| revision detection that works | resilience, cache, budgets, metrics |
| citation resolution that refuses hallucination | a typed bridge into evidence |
| confidence composition over evidence properties | provenance with trust, quality, as-of |
| an acceptance boundary a person controls | recorded fixtures and contract tests |

Between them: **one hard-coded observation written by a smoke route.**

Three things close the gap, and only three:

1. **A durable observation record**, so a series is a query and a revision has
   somewhere to be the second version of something.
2. **A reference period in the natural key**, so disagreement and revision stop
   being the same thing and so co-temporality means something for macro data.
3. **Assembly as an institutional act**, so the choice of what a desk may
   conclude has a name on it.

Everything else C3 could do is additive to those and can wait.

---

## 3. Decisions requiring approval

### Decision 1 — Observation vs time series

> **RULING SOUGHT: no `Series` aggregate. A series is a query over observations
> sharing a natural-key prefix. What is missing is a durable observation record,
> not a new domain type.**

Tested against each requirement:

| requirement | current model | verdict |
|---|---|---|
| point observation | `ObservationRef` + payload | **sufficient** |
| historical time series | N observations sharing (subject, kind, sourceId, seriesId), differing in `observedAt` | **sufficient as a model, has no store** |
| revisions to published macro data | same `id`, different `contentHash` — **probed working** | **sufficient across sets; broken within one** (§1.6) |
| market levels | `quote` | **sufficient** |
| changes over multiple horizons | one `ChangePeriod` per quote; five horizons would collide on identity | **insufficient — belongs to Decision 4** |
| curves / spreads | `yield-curve` not storable, `yieldCurveRef` has zero callers | **insufficient — belongs to Decision 4** |
| expectations / market-implied | no representation, no source | **insufficient — deferred, no source exists** |

The one-observation-per-point representation was tested against the alternative
and wins on the property that matters: **citation precision**. A series stored as
one observation whose value is an array of 250 points means a revision to the
March print changes the content hash of the whole series, so *"the March figure
was revised"* becomes indistinguishable from *"something moved"*, and a claim
citing the series cites all 250 points at once. `resolveCitation`'s `revised`
verdict — the Fact Checker's primitive — degrades to noise.

**So the gap is a store, not a type.** A `DurableObservation` record keyed by
`observation_id`, holding the natural key relationally, independent of any
evidence set. An evidence set then references observations rather than
containing them, which also removes the duplication in §1.2 and gives the
Fact Checker the cross-set query its schema comment already promises.

### Decision 2 — Evidence assembly as an institutional act

> **RULING SOUGHT: ingestion and assembly are two different acts, with two
> different identity requirements. `/smoke/c2-1` is retired.**

Does assembly change what the firm can cite? **Decisively yes.** `citeFrom`
refuses any observation not in the set. `composeConfidence` bounds confidence by
the set's properties. The C2-2 run produced five refusals *because of what was
in the set*. Whoever assembles determines the ceiling on every claim the firm
can make from it — a more consequential act than several of the nineteen that
are already governed.

| | ingestion | assembly |
|---|---|---|
| what it is | record what a source said | choose what a desk may reason over |
| judgement | none | **all of it** |
| actor | **none** — system provenance | **required** |
| mandate | none | **required** |
| command identity | none — idempotency key on the natural key | **required** |
| ledger / event | storage provenance only | **required** |
| validation | schema + content hash | reference resolution + policy |

Ingestion deliberately does **not** take a human actor. §8.4 of the C2-2 gate
rules that *"the operator is the actor"*; a scheduled ingest issuing commands
under a person's name would put an auditable identity on an act nobody
performed, and would make the mandate decorative. Ingestion is machine work that
makes no claim, and it gets a storage-provenance record, not a mandate.

Assembly is the opposite and takes the full envelope — a new command,
`AssembleEvidenceSet`, taking **a query rather than a list of observation ids**.
That constraint is load-bearing: an assembler who names individual observations
can drop the inconvenient source, and the disagreement machinery would never
see it. An assembler who names a subject, a family and a window gets whatever
the firm holds, disagreements included.

**The query itself is durably recorded and versioned (§0.3).** Membership
answers *what the firm reasoned over*; only the recorded selection rule answers
*why those observations and not others*. Without it the set is auditable and
still indefensible — a reviewer can see what was included and cannot tell
whether anything was left out. The rule travels with the set as part of its
institutional record.

**`/smoke/c2-1` is retired once the replacement capability is genuinely in
place (§0.3)** — Stage B, not Stage A. Leaving a privileged unauthenticated
evidence-manufacturing door open beside a governed one is the contradiction this
decision exists to remove; removing it before a governed path exists would leave
the firm unable to produce evidence at all.

### Decision 3 — Decision-driven evidence requirements

> **RULING SOUGHT: the requirement map below is the standing institutional
> requirement. C3 builds exactly one family of it, end to end.**

Working backwards from the seven professional questions:

| family | question it serves | minimum measure | free authoritative source | built |
|---|---|---|---|---|
| central-bank policy | what is the stance | level, change, effective date | ECB, NY Fed, Riksbank | **yes** |
| sovereign yield curves | what is priced | level per tenor, curve shape | US Treasury, Bundesbank, Riksbank | **adapters yes, evidence no** |
| market-implied policy expectations | priced vs stance | implied path, change in it | none free | no |
| real rates / breakevens | priced inflation | nominal − real | US Treasury real curve | no |
| inflation | what is changing | level, YoY, MoM, surprise | BLS, Eurostat, SCB | no |
| growth | what is changing | IP, GDP, PMI | official agencies; PMI not free | no |
| labour market | what is changing | payrolls, unemployment, claims | BLS, Eurostat | no |
| credit conditions | is stress building | IG / HY OAS and its change | FRED (key required) | no |
| financial conditions | is stress building | NFCI or equivalent | FRED (key required) | no |
| FX | what is priced | level, change | Frankfurter | **adapter yes, evidence no** |
| commodities / energy | inflation impulse | Brent, gas level and change | none free | no |
| volatility | complacency | VIX, MOVE | none free | no |
| equity breadth / internals | is the move narrow | % above 200dma, adv/dec | none free | no |

Each family is read at six altitudes — **level, trend, momentum, surprise,
market pricing, historical context** — and the last three are what make a
regime read defensible rather than descriptive. None is available without a
durable observation store, because all three are functions of history.

**C3 builds sovereign yield curves and nothing else.** The reasons are
specific, not arbitrary:

- It is the only family with a **working authoritative adapter that already
  returns a full term structure with history** — `usTreasury`, keyless, public
  domain, monthly XML.
- It exercises every hard problem simultaneously: a real time series, revisions,
  a derived observation (2s10s) that must trace to two underlying observations,
  and a genuine co-temporality question.
- It directly serves *"what is already priced by markets"* — the professional
  question the firm currently cannot begin to answer.
- It costs nothing and needs no key, so the vertical slice is not gated on a
  procurement decision.

The other twelve families are recorded as requirement, not built. That is the
scope discipline the gate asks for: **establish the information requirement,
then build one column of it.**

### Decision 4 — Derived evidence

> **RULING SOUGHT: a derived observation is an `ObservationRef` like any other,
> with `sourceId: 'derived'`, the transformation id and version carried in
> `methodology`, and its input references in the payload. Derivation happens at
> assembly time and is stored. Nothing recomputes it — not a read model, not a
> component, not a prompt.**

Nearly all of this already exists (§1.12). `ProviderTrust: 'derived'` sits at
trust tier 4, `effectiveTrust` already takes the weaker of two links, and
`methodology` is already part of the natural key precisely so that two
methodologies are two observations. What is new is one thing: **the payload
carries the observation ids and content hashes it was computed from.**

That single addition delivers everything the gate asks for:

- traceable to its underlying observations — the input refs resolve
- traceable to transformation and version — `spread-2s10s@1` and `@2` are two
  different observations, not a silent recompute
- **one derivation per institutional fact** — the transformation runs once, at
  write time; every reader reads the same stored value

**Derivation must be a write, not a read.** Deriving 2s10s inside `runReview` or
`caseOverview` would mean a claim cites a value that is recomputed on every
read; the cited content hash would drift and `resolveCitation` would report
`revised` for a value that never changed. Content addressing forces the
decision, and it forces it correctly.

**A model must never compute one in a prompt.** That is the failure mode this
decision exists to prevent: a 2s10s the desk arithmetic'd out of two numbers is
unauditable, uncitable and unrepeatable, and the firm would hold a fact whose
only witness is a sampled generation.

Assignment of the listed calculations:

| calculation | home |
|---|---|
| 2s10s, real yield, breakeven, credit-spread change | **derived observation** — a fact about the world, citable |
| change in policy expectations, moving average, z-score, breadth | **derived observation** — same, once its inputs exist |
| regime indicator | **not an observation.** A regime read is a *claim* with confidence and invalidation, produced by a desk over evidence. Storing it as an observation would let the firm cite its own conclusion as evidence for itself |

That last row is the boundary that keeps the layering honest.

### Decision 5 — Disagreement and co-temporality

> **RULING SOUGHT — the substantive domain change in C3: add `referencePeriod`
> to `ObservationNaturalKey`; group disagreements on it rather than on
> `observedAt`; split revision from disagreement in the evidence vocabulary.**

The firm has discovered the publication/reference distinction three times and
recorded it three times without generalising it:

- `GovernmentYield.observationDate` — the reference date, in the **payload**
- `PolicyRegime.effectiveDate` versus `provenance.asOf` — the entire reason the
  ECB adapter's carry-forward machinery exists
- `Provenance.sourceDate`, `asOf`, `estimatedPublicationAt` — three time fields,
  **none of which is in the natural key**

The natural key knows only `observedAt`, and §1.5 is the price. With
`referencePeriod` in the key, the five required representations become
expressible and each is distinct:

| situation | representation |
|---|---|
| two authoritative sources disagreeing | same `referencePeriod`, different `sourceId`, different `contentHash` → **`EvidenceDisagreement`** |
| a revised release | same `referencePeriod`, same `sourceId`, later `observedAt`, different `contentHash` → **`EvidenceRevision`** (new) |
| macro series published on different dates | different `observedAt`, same or different `referencePeriod` — both stated |
| stale versus fresh | judged against `referencePeriod`, per family |
| market data now versus macro describing an earlier period | **reference spread**, reported beside the publication spread |

`CoTemporality` gains a second dimension. Today it reports the spread in
publication instants; for macro evidence the spread that matters is in
**reference periods** — a Friday equity close beside a Q2 GDP print is a
six-week reference gap, and that is the fact a desk must be told. Both are
computed, both are reported, neither replaces the other.

**Never hide disagreement.** Two mechanisms, not a rule in a comment: assembly
takes a query rather than a list (Decision 2), so the assembler cannot drop a
source; and disagreements are computed by the set, not supplied to it, so
nothing upstream can suppress one.

**Staleness gets defined for one family and no more.** TD-75 is open because
`anyStale`, `weakestEvidence`, `conflictingEvidence` and `methodologyMismatch`
have no production definition, and the recorded reason is that each needs an
institutional policy decision rather than an implementation. C3 defines
staleness **for sovereign yields only** — a policy the firm can state honestly,
matching the per-category shape `FallbackPolicy.maxStaleMs` already has — and
narrows `DERIVABLE_CAPS` by exactly one. Guessing the other three would repeat
the mistake TD-75 exists to record.

**The cost, stated plainly.** Adding a field to the natural key changes every
observation id. `identityCorpus.ts` pins them as literals and declares this *"a
version decision, not a test to update."* The one existing dev evidence set
(`abb549c1…`) is cited by the seven claims from the accepted C2-2 run. Three
options, and §5 asks for a ruling:

| | approach | cost |
|---|---|---|
| **(a)** | append the segment only when present, so an observation without a reference period hashes exactly as today | backward compatible; makes the hash input variable-length, which needs a stated separator-collision argument |
| **(b)** | give the observation id a domain tag (§1.7, which it should have anyway per canonical-value-v1 §9) and version it to `:v2` | clean, explicit, self-documenting; **every existing id changes**, so the C2-2 evidence set becomes a v1 historical record |
| **(c)** | leave the key alone; carry `referencePeriod` in the payload and group disagreements on it | no migration at all; a reference period outside the key means two observations differing only in what period they describe collide on identity — **this is the defect, not a workaround for it** |

**Recommendation: (b).** It fixes the missing domain tag in the same change, it
makes the generation boundary explicit rather than implicit, and it is honest
about the fact that the identity model changed. The C2-2 run's evidence remains
readable and remains cited; it is simply v1 evidence, which is what it is.

### Decision 6 — The Macro Investment View

> **RULING SOUGHT: no new aggregate. A Macro Investment View is an
> `InvestmentThesis` revision on a `macro-regime` case, produced by
> `AggregateManagerConclusion`. C3 adds nothing to it.**

§1.11 is the test, and existing concepts carry nine of ten requirements. The
thesis already has what a durable view most needs and what is hardest to add
later: **invalidation criteria required by construction** — *"a thesis that
cannot be wrong is a preference"* — plus revision lineage with `new-evidence` as
a declared cause, opposing claims held on the thesis rather than filed
elsewhere, and reproducibility through `ManagerAggregation` and `BasisManifest`.

That last property is exactly the gate's requirement that the view be
*"reproducible from the institutional record rather than merely the latest prose
generated by a model."* It already holds, and it holds because prose is rendered
from claims and claims are never extracted from prose.

Two things are genuinely absent, and the ruling on each is *not now*:

**Market pricing versus firm view** is expressible with no change — an
`observation` claim citing a market-implied observation, and a `comparison`
claim contrasting it with the firm's read. Both claim types exist. What does not
exist is the market-implied evidence family, which C3 does not build. So the
shape is ready and unpopulated, and that should be said rather than papered over.

**Thesis-level confidence** is absent, and should be **derived** from the
supporting claims rather than stored — one derivation per fact. But the
derivation rule is an institutional policy nobody has decided: is a thesis as
confident as its weakest supporting claim, its median, or something weighted by
materiality? Inventing that here would put a number the firm never agreed to
behind a confidence it presents as its own — the precise failure TD-75 records.
**Reported as an open question. Not resolved in C3.**

### Decision 7 — The portfolio-risk posture boundary

> **RULING SOUGHT: `100/0`, `80/20`, `60/40`, `40/60` are an implication of an
> existing record — never a durable institutional record of their own, and never
> a policy output. Nothing is built in C3.**

The five layers already map onto seeded institutional structures:

| layer | where it lives | owner | exists |
|---|---|---|---|
| **Macro View** | `InvestmentThesis` revision on a `macro-regime` case, `implications: ['portfolio-risk']` | Global Macro → Research Office aggregation | ✓ |
| **Tactical asset-allocation implication** | a separate contribution on the same case, citing the macro thesis | Portfolio Strategy | department and responsibility seeded; **no playbook entry** |
| **Portfolio recommendation** | a thesis revision with `implications: ['asset-allocation']`, which makes Risk Review required | Portfolio Strategy + Risk | ✓ structurally |
| **Client-specific implementation** | outside the analysis bounded context entirely | — | ✗, correctly |
| **CIO decision** | `recordCaseDecision` | CIO | ✓ |

**Why the numbers are not a durable record *in C3*.** A reference posture is
meaningful only relative to a mandate, a client and a moment. Storing *"the firm
is at 80/20"* as an institutional fact today creates a value a later policy
change makes wrong — the standing rule about storing facts rather than policy
conclusions. What is durable now is the **decision that moved it** and the
**thesis that argued for it**; the current posture is the fold of the decision
history, and `DecisionRepository.historyForCase` is already the shape that
gives it.

**This is a scope ruling, not a permanent architectural one — see §0.8.** The
firm will eventually need to measure decisions against outcomes, and an approved
tactical allocation may well need its own durable record for **attribution,
after-action review and Performance Office learning**. That remains a future
explicit decision. C3 neither builds it nor forecloses it, and nothing produced
by C3 may assert that it is permanently foreclosed.

**Global Macro alone cannot own this, and that boundary already holds
mechanically** — not by convention. The `macro-analysis` playbook entry belongs
to `global-macro`; a run's produced claims are department-scoped; only
`AggregateManagerConclusion` by `research-office` mints a thesis revision; and
an allocation implication requires a Portfolio Strategy contribution the macro
desk has no mandate to issue. The separation the gate asks to preserve is
enforced by the mandate system today, and C3 must not weaken it.

### Data sources — the rule, and the one family

`sourceId` is already a domain concept in the natural key (`treasury`, `ecb`,
`derived`), `DataSourceMetadata.originator` already separates access route from
originator, and `effectiveTrust` already takes the weaker of the two. **No
vendor identity is baked into domain semantics today.** The rule for C3 is to
keep it that way: the *adapter* declares that `treasury` is `issuer`-trust; the
domain only knows there is a source and how much it is worth.

For sovereign yields, separated as the gate asks:

| | US Treasury | Bundesbank | FRED (not built) |
|---|---|---|---|
| source authority | **issuer** — publishes its own par curve | central bank, republished series | aggregator |
| licensing | US public domain | free, attribution | free, key required, redistribution terms |
| freshness | daily, ~15:30 ET | daily | follows source |
| revision behaviour | par yields revised rarely — **must be modelled as revisable regardless** | — | inherits |
| historical depth | full, by month | full | full |
| availability | keyless, stable, already adapted | keyless, already adapted | keyed, rate-limited |
| cost | free | free | free |

C3 uses **US Treasury** and nothing else. Bundesbank is the second column
whenever a second is wanted, and the adapter already exists — which is the point
of doing the architecture once.

---

## 4. Alternatives considered and rejected

| alternative | why rejected |
|---|---|
| **A `Series` aggregate** because financial data arrives as series | Destroys citation precision: a revision to one point rehashes the whole series, and `resolveCitation`'s `revised` verdict — the Fact Checker's primitive — degrades to noise. The existing observation model was tested and is sufficient (Decision 1) |
| **Keep assembly as a repository write** | It determines the ceiling on every claim the firm can make, with no name on it. More consequential than several of the nineteen governed acts |
| **Make ingestion a command too** | A scheduled ingest issuing commands under a person's name violates §8.4's *"the operator is the actor"* and makes the mandate decorative |
| **Auto-assemble a set per case from a standing query** | Makes the evidence basis a function of ingestion timing: re-running a case a day later silently changes what it could conclude, with no record of who chose |
| **Derive 2s10s at read time** | The cited content hash drifts, so `resolveCitation` reports `revised` for a value that never changed. Content addressing forbids it |
| **Let the model compute spreads in the prompt** | Unauditable, uncitable, unrepeatable — the exact failure the gate names |
| **Carry `referencePeriod` in the payload instead of the key** (option (c)) | Two observations differing only in the period they describe would collide on identity. That is the defect, not a workaround for it |
| **Build a generic market-data lake / all thirteen families** | Out of scope by the gate. Volume is not the objective, and twelve families of unread observations improve no decision |
| **A new `MacroView` aggregate** | Nine of ten requirements are already carried by thesis + claims + revisions, including the hardest one to retrofit — invalidation by construction |
| **Store a firm-level `currentPosture: '80/20'`** | A policy conclusion masquerading as a fact; a later mandate change makes it wrong. It is the fold of the decision history |
| **Define all four missing TD-75 confidence signals now** | Each needs an institutional policy decision. Guessing puts a number the firm never agreed to behind a confidence it presents as its own |
| **Fix the `vite build` failure here** | Pre-existing (§8.3). Broadening a capability phase to repair an unrelated bundling defect is how two decisions of different kinds end up inside one boundary |

---

## 5. Proposed smallest C3 capability

> From Agent Headquarters, a person assembles an institutional evidence set for
> a subject and a window — drawn from observations the firm ingested itself from
> the US Treasury, including a derived 2s10s spread traceable to the two yield
> observations it was computed from — and commissions Global Macro against it,
> producing claims that cite a real term structure instead of one undescribed
> number.

That is the user's chain — *riktig källa → automatisk ingestion → tidsserie →
provenance → derived observations → EvidenceSet → Global Macro → Macro View* —
at its narrowest honest width. Once it holds, adding a family is adapter work
against a proven architecture, not another architecture.

### Stages

**Stage A — the observation store, and the honest series.**
A durable observation record keyed by observation identity, **independent of any
evidence set**, holding both generations: v1 rows readable as v1 (§0.1), v2 rows
carrying `referencePeriod` under the domain-tagged versioned identity.
Ingestion from `usTreasury` with storage provenance and an idempotency key on
the natural key. A series is a query over that store. **No new UI.**

**Sequencing note.** The gate's first draft placed *"an evidence set references
observations rather than containing them"* in Stage A. It belongs in **Stage
B**: ingestion happens before any set exists, so Stage A needs the store and
nothing about sets, and the linkage question is first answerable when a set is
first assembled from ingested observations. Institutional content is unchanged —
observations are durable and independent of sets either way. `evidence_items`
is untouched in Stage A, which is also what §0.1 asks for.

#### Stage A progress — the identity foundation, delivered 2026-08-17

**Delivered and green. This is a boundary inside Stage A, not Stage A's exit.**

Verified: unit **2224 pass / 8 skipped, 93 files**; PostgreSQL **793 pass, 34
files** (file count checked per §8.2, two consecutive green runs);
`tsc --noEmit` clean.

| | |
|---|---|
| v2 identity | domain-tagged `financial-os:observation-key:v2`; `referencePeriod` replaces `observedAt`; `keyGeneration` carried on every reference |
| v1 retained | `observationRefV1` reproduces `d4b7dc25…` — **bit-for-bit the id already embedded in the evidence-set bytes this corpus pinned before v2 existed** |
| verification | recomputes under the record's **own** generation, so neither generation reads as tampering |
| builders | all four supply a reference period from a field they already held |
| storage | migration `0030` adds `key_generation`, `reference_period`, a shape constraint binding them, and the series index Stage A's query will need |
| corpus | pins the v1 id, the v2 id, content-hash invariance across the migration, and both refusals |

**The migration's blast radius, measured rather than asserted.** Across the
eleven regenerated PostgreSQL fixtures the only changed fields are `id`,
`observationId`, `evidenceSetId`, `setId`, the two new columns, and each
fixture's own digest. **Not one `contentHash` moved** — what every observation
*said* is byte-identical either side of v2, which is what bounds the change to
the key rule and means no stored payload needs re-verifying.

**One sub-decision was taken inside the approved ruling, and is recorded rather
than buried:** `policyStateRef` now **refuses** a regime whose `effectiveDate`
is `null` (`effectiveDateConfidence: 'unknown'`). The tempting fallback is the
confirmation date, and it is wrong in the worst case — `unknown` means the level
has stood longer than the lookback, so keying on confirmation would mint a fresh
identity every calendar day for the most stable rate the firm holds, reinstating
the v1 pathology silently. Fail-closed matches `UNVERIFIABLE_KINDS` being empty.

**Still owed by Stage A at that point:** the durable observation record,
Treasury ingestion, and the series query. All three are delivered below.

#### Stage A complete — 2026-08-18

Verified: unit **2246 pass / 8 skipped, 94 files**; PostgreSQL **802 pass, 34
files** (file count checked per §8.2, two consecutive green runs);
`tsc --noEmit` clean.

**`analysis.observations`** (migration `0031`) — keyed
`(observation_id, content_hash)`, independent of every evidence set. A revision
is a second row, enforced twice: the primary key cannot be reached by a
differing value, and the migration grants **only SELECT and INSERT**, so no
statement the application can issue is able to overwrite or delete a published
figure. Three times are stored and none is the others — `reference_period` (what
is described, identity), `observed_at` (when the source published, provenance),
`recorded_at` (when the firm learned it, knowledge time).

**Ingestion** — `ingestYields` records what a source published and reports what
was new. It takes **no actor and no mandate** by ruling, and carries storage
provenance instead. Idempotency is the natural key plus the content hash; there
is no token, cursor or watermark, because a second mechanism would be a second
answer to a question identity already settles. `usTreasury.fetchYieldHistory`
returns every published observation in a range rather than the latest, which is
the capability a series is made of.

**The series query** — `observations.series` returns individually citable
observations, one per reference period, resolved bitemporally: latest known by
default, or *as the firm knew it* at a given instant. No stored aggregate and no
array representation, per §0.2.

**Two real defects were found by the parity suite, which is what it is for:**
`analysis.observations` was missing from the contract harness's truncate list,
so records leaked between PostgreSQL tests; and `DISTINCT ON (reference_period)`
did not match its `ORDER BY reference_period COLLATE "C"`, which PostgreSQL
rejects (`42P10`) and the in-memory adapter could not have caught.

**The Stage A/B boundary is enforced by a test, not by a comment.** Ingestion
that quietly produced an evidence set would have decided what a desk may
conclude, with no actor, no mandate and no recorded selection rule — so
`ingestObservations.test.ts` asserts that after ingestion the firm holds zero
evidence sets.

*Exit:* the firm holds real US par-curve observations across the term structure;
the same figure ingested twice is one record; a revised figure is a second
content hash on the same id, retained beside the first; a series is a query,
proven against PostgreSQL; v1 identities are unchanged and still resolve. Both
suites green, `tsc --noEmit` clean, PostgreSQL file count checked (§8.2).

**Stage B — the derivation, and the assembly act.**
2s10s as a derived observation carrying its input refs and
`methodology: 'spread-2s10s@1'` (§0.5). `AssembleEvidenceSet` as a command with
actor, mandate, ledger and event, taking a **query** whose **selection rule is
durably recorded and versioned** (§0.3). `EvidenceRevision` split from
`EvidenceDisagreement` (§0.6); disagreements grouped on `referencePeriod`; the
publication/reference co-temporality pair. **`/smoke/c2-1` retired here**, once
the governed path replaces it.

*Exit:* an evidence set the firm can name the author of **and reproduce the
selection of**, holding a derived observation whose inputs resolve; a planted
cross-source disagreement at differing publication instants that the set
**reports**, with the near-miss being a revision, which it reports as a
revision.

#### Stage B progress — property 3 delivered, 2026-08-18

**Revisions and disagreements are now separate institutional facts**, and the
measured `observedAt` pathology is closed. Verified: unit **2249 pass / 8
skipped, 94 files**; PostgreSQL **802 pass, 34 files**; `tsc --noEmit` clean.

| | |
|---|---|
| `EvidenceDisagreement` | grouped on **reference period**, and now requires **two distinct sources**. One source is never a disagreement |
| `EvidenceRevision` | new, grouped on observation id — one source restating one period, versions ordered earliest publication first |
| `CoTemporality` | now **two axes**: `publication` and `reference`. `unstated` is a real answer for a v1 item that declares no period, rather than a fabricated spread of zero |

The exit criterion is met for the disagreement half: the planted violation is
two sources publishing the same reference-period figure sixteen hours apart —
which reported **zero** before — and the near-miss is one source correcting
itself, which reports as a revision and not a disagreement.

**Historical sets keep reporting what they reported.** A v1 item states no
reference period, so it is still grouped on `observedAt`; §0.1 requires that the
migration not change what the firm previously said about its own evidence.

#### Stage B progress — properties 2 and 4 delivered, 2026-08-18

Verified: unit **2258 pass / 8 skipped, 95 files**; PostgreSQL **806 pass, 34
files**; `tsc --noEmit` clean.

**Property 2 — forward-only linkage (migration `0032`).** An evidence item whose
observation the firm holds stores membership and the link, with
`value`/`provenance` NULL; the payload is read through `analysis.observations`.
A pre-C3 item keeps its own payload. `links_observation` states which shape a
row is rather than leaving a reader to infer it from a NULL, because "the
payload lives elsewhere" and "the payload went missing" need different
responses. Whether to link is decided **from the store**, not declared by the
caller: whether the institution holds a fact is a property of the institution.
A linked row whose observation has gone is refused by name — a set that
returned fewer facts than it was assembled from would let a claim's basis shrink
silently.

**Property 4 — `spread-2s10s@1`.** `curveSlopeBasisPoints` is reused, not
reimplemented, so there is one definition of what the slope is. The derived
observation carries its **exact input refs inside the payload**, and therefore
inside the content hash — a revised 10Y mints a new content hash on the same
observation id. A new `ObservationKind: 'derived-spread'` with its own
projection, because a spread is not a yield and forcing it into that shape would
mean inventing a `yieldPercent`. Refuses a slope across two reference periods.

**Precision — ruled and closed, see §0.3c.** The persisted value is computed by
exact decimal subtraction over the canonical source strings, so
`4.1 − 3.9` is **`20`**. `curveSlopeBasisPoints` still decides whether the pair
*is* a 2s10s slope — it is the one definition of the measure and its sentiment
consumer is untouched — but its number is not what gets stored. The `OPEN:` test
is replaced by six permanent contract tests: exact subtraction, negative slope,
zero slope (never `-0`), mixed source precision, no trailing zeros, and
determinism of value, content hash and id.

#### §8.2 PostgreSQL flakiness — third occurrence, recorded as observed

**2026-08-18.** One full PostgreSQL run failed a single test:
`reconsideration.pg.test.ts > what reconsideration refuses > refuses a case
that is not deferred`. File count was **34**, so no worker-startup skip. It did
**not** reproduce on the next run, which was fully green at 34 files.

Consistent with the two occurrences C2-2 §8.2 records — a single red test, in a
different file each time, not reproducing. **No common cause is inferred, and
none is claimed.** Three occurrences in three files is three observations, not a
pattern with an explanation; asserting a shared cause because the count has
reached three would be exactly the reasoning §8.2 was written to avoid. The
standing guidance is unchanged: treat a single red PostgreSQL test as suspect
until reproduced, and check the file count regardless.

**Deliberately still open in Stage B:** properties 1 (governed assembly), 5
(agent evidence semantics) and 6 (retiring `/smoke/c2-1`). The derivation is
built and tested but **not yet wired to assembly**, because assembly is where
gate §0.5 says it runs.

#### Stage B complete — properties 1, 5 and 6 delivered, 2026-08-19

Verified: unit **2309 pass / 8 skipped, 96 files**; PostgreSQL **818 pass, 35
files** (file count checked per §8.2, two consecutive green runs);
`tsc --noEmit` clean.

**Property 1 — `AssembleEvidenceSet`, the twentieth institutional act
(migration `0033`).** Until now the only production path that could write an
`EvidenceSet` was a smoke route with no actor, no mandate, no command, no ledger
entry and no recorded selection, while nineteen lesser acts all carried the full
envelope. Assembly sets the ceiling on every claim a desk can make from the set —
`citeFrom` refuses anything outside it and `composeConfidence` is bounded by its
properties — so it now carries an actor, a mandate, a ledger entry and a
**durably recorded, versioned selection rule**.

It takes a **query, never a list of observation ids** (§0.3). `SELECTION_RULES`
holds one entry, `sovereign-yield-curve@1`, and the id binds three things at
once: which series the family expands to, how the store is queried, and which
derivations run over the result. Changing any of them is `@2`, so a set
assembled under `@1` stays explicable by reading `@1`.

`known_at` is **resolved and stored even when the caller names none**, because
"latest known" is only reproducible if the moment that phrase referred to was
written down. `selected_subjects` records what the family expanded to as it ran,
which is what separates a tenor the firm held nothing for from a tenor the rule
never asked for.

**One sub-decision, recorded rather than buried: the table is keyed by the act,
not by the set.** An evidence set id is a content hash of its membership, so two
selections that happen to select the same observations are one artifact reached
by two acts — possibly by two people, possibly under two rules. Keying on
`evidence_set_id` would force one act to overwrite the other or be silently
dropped, and neither is what happened. A pre-C3 set is reached by no row at all,
which is the honest answer for a set nobody assembled through this act; nothing
is backfilled, for the reason migration `0032` states about knowledge time.
`GRANT SELECT, INSERT` only — a record of a judgement that can be edited
afterwards is not a record of a judgement.

**The derivation is wired where the gate put it.** `spread-2s10s@1` runs at
assembly, as a write, and joins the set as a member like any other observation.
Nothing downstream — no read model, no component, no prompt — recomputes a
spread.

**Property 5 — the desk is told what the firm already knows (§0.9).** The C2-2
live run recorded the defect precisely: given `value: {"yieldPercent":"2.41"}`
and an id, Global Macro produced five `insufficient-evidence` claims. That it
was a German ten-year government bond yield published by the ECB for 15 August
at central-bank trust was sitting on `item.ref` and `item.provenance`, and none
of it was sent. `evidenceBriefing` renders subject, kind, unit, source,
originator trust, quality, publication time and reference period **read from the
record** — no display-name table, no derived figure, no second schema. The
canonical observation id is carried unshortened, so `citeFrom` still bounds
exactly what may be cited, and a v1 item is stated as declaring no reference
period rather than being given a fabricated one.

**Property 6 — `/smoke/c2-1` is retired, and the door is held shut by a rule.**
`smokeFns.ts` and the route are deleted. Fitness rule 18,
`evidence-assembled-only-by-the-governed-act`, structurally refuses any call
ending in `.evidence.save` outside `AssembleEvidenceSet` — adapters that
implement the port and the named fixture harnesses excluded. Verified the way
every load-bearing rule is: the planted violations are the retired smoke route
and a read model writing a set on the way past, and the near-misses — reading a
set, and saving something that is not one — pass.

**The screen.** `/evidence` — *Underlag firman håller* — shows what the firm
holds per tenor, offers the rule and the window, and records the assembly with a
name on it. The holdings a person sees are counted by `runSelection`, the same
query the command runs, so the count before the button is the count the act
selects. The commission screen now states a set's recorded selection — rule,
family, window, knowledge time, assembler — and states its **absence** for a
pre-C3 set rather than filling one in.

**Two stale assertions were found by the suite and fixed:** three tests pinned
the head schema version at `0032` and migration `0033` moved it. Mechanical, and
exactly what pinning the version is for.

*Exit met:* an evidence set the firm can name the author **and reproduce the
selection** of; a derived 2s10s whose inputs resolve to the two observations it
was computed from; a planted cross-source disagreement the set reports, with the
near-miss — one source correcting itself — reported as a revision.

**What this leaves Stage C.** §0.9's rendering was listed under Stage C and is
delivered here, because the assembled set is the thing worth describing and
describing it after commissioning would have been describing it twice. Stage C's
remaining scope is therefore: staleness defined for sovereign yields,
`DERIVABLE_CAPS` narrowed by one, and **the exit that actually proves it** — a
real live run commissioned from the product by a person, whose claims cite a
term structure and a derived spread, judged by a person.

#### Stage C rulings — the staleness cap, ruled 2026-08-19

Four sub-decisions surfaced while implementing *staleness defined for sovereign
yields* and were **taken to the CIO before the exit run rather than settled at
the keyboard** (§0.11). All four approved; D2 approved with a qualification that
narrows it, and the narrowed form is what binds.

**D1 — `DERIVABLE_CAPS` is `['no-evidence', 'fixture-evidence',
'stale-evidence']`.** §5's *"narrows `DERIVABLE_CAPS` by exactly one"* refers to
the **unresolved TD-75 gap** shrinking from four undefined production signals to
three, not to the set of caps the firm applies. **A cap the firm can already
derive is never removed.** Measured, the literal reading would break a
downstream rule: `contributionValidation` raises `uncapped-fixture-evidence`
whenever a fixture-backed claim stays publishable, so dropping
`fixture-evidence` would turn every fixture-backed claim into a validation
defect.

**D2 — recency, for this cap, is the freshest cited in-scope observation.**
Ruled in these words:

> For the C3 sovereign-yield confidence cap, evidence recency is determined by
> the freshest cited in-scope observation.

Observations deliberately cited as historical context must not make a trend
claim stale merely by being old. **The ruling is deliberately not generalised:
it is not a domain statement that staleness is always the age of the freshest
evidence.** Future evidence families may require *freshness*, *historical
coverage* and *completeness* as separate concepts — a quarterly series with one
recent print and an eighteen-month hole is recent and badly incomplete, and this
rule says nothing about the second. What is settled is one cap over one family.

**D3 — freshness is judged against `assembledAt`, never wall-clock time.**
Historical confidence must remain reproducible from the institutional record.
Whether an old analysis is still *actionable today* is a separate future
judgement, and it must never retroactively change the confidence that analysis
had when it was produced.

**D4 — the scope is `par-yield`, `zero-coupon-fitted`, `benchmark-bond-yield`
and `spread-2s10s@1`.** The existing five-day sovereign-yield judgement is
preserved — `CATEGORY_POLICY` already records it for `yields-us`, `yields-de`
and `yields-se` — and with it the rule that **a derivation cannot escape a
staleness judgement its underlying evidence would receive.** Anything outside
the table reports itself *unjudged*, which passes the signal as the value that
cannot lower anything: an undefined policy becomes a finding in neither
direction.

**The basis rewrite is a mechanical consequence, not a fifth ruling.**
`composeConfidence` writes *"bounded by the weakest evidence (…)"* into the
basis from the neutral value the application passes it, before it applies a late
cap — a sentence the firm has not earned, because it never mapped evidence trust
to a level. So for `stale-evidence` the **level and the cap come from the
domain** and the basis is written by the application, from the domain's own
words for the rule that bit plus the facts the application derived. It stands
provided the recorded basis remains deterministic, reproducible and a truthful
account of the facts that produced the cap. **If it ever requires competing
semantic ownership of the rule, or changes what an already-recorded basis meant,
that is a stop-and-report** (§0.11), not something to design around.

#### §8.2 — one red run in Stage C, unidentified, and the control it earned

**2026-08-19, during Stage C.** A full PostgreSQL run reported `1 failed | 817
passed` at **35 files**, so again no worker-startup skip. The run before it and
the two after it were fully green at 818 / 35.

**Which test failed is not recorded, because the log was destroyed.** The run
was piped through `tail -6`, so the summary survived and the `FAIL` block did
not — and the suite exits 0 either way, which is the exact trap §8.2 already
warns about. That the shape matches the previous three is **not** evidence it
was the same defect; an unidentified failure is an unidentified failure, and
counting it as a fourth instance of a known shape would be inferring the thing
§8.2 refuses to infer. It is recorded as an occurrence, not as a recurrence.

**The control this earned, stated because it cost a run to learn:** never pipe
the PostgreSQL suite into `head` or `tail`. Redirect the whole log to a file and
read the summary out of it. Exit 0 plus a truncated log means a red test can
disappear leaving nothing to diagnose, and re-running only proves the next run
was green.

#### Stage C exit, first attempt — timed out, and what it measured

**2026-08-19.** The product journey ran end to end and the exit did **not**
pass. A person assembled `c0d6bcbaf06f88c6c324eaa70e5b4536` — 242 real Treasury
observations plus 22 derived `spread-2s10s@1`, 264 items, rule
`sovereign-yield-curve@1`, window 2026-07-20..2026-08-19 — and commissioned
Global Macro against it. The run ended `timed-out` at 90.045 s against a 90,000
ms authorised deadline, `provider-timeout`, two of three attempts, no usage
reported, **no claims written**.

**The run is preserved as institutional history** and is not obsoleted, retried
in place or tidied away. A run that failed is a fact about what the firm
attempted.

**What the diagnosis measured, and what it did not.** Every mechanism behaved as
designed: per-run deadline shared across attempts, abort, bounded category, the
refusal to record an aborted attempt's partial value, the run kept as history.
Two things are **not** recoverable from the record and are recorded as gaps
rather than guesses — the first attempt's failure category (only the final
attempt's is persisted), and whether the provider billed for a request it
received before the client hung up.

**The finding that mattered was not the deadline.** The rendered request was
139,734 characters, ≈ 28,350 input tokens against a 12,000-token authorised
budget — so `budgetOverruns` would have settled the run as `budget-exhausted`
and written no claims even had it answered in time. Both bounds were exceeded;
the deadline was simply reached first. **Raising the deadline would not have
produced a passing run**, and it was not raised. Recorded as **TD-79**, and
ruled out of C3.

**The smallest defensible next action, approved 2026-08-19:** re-assemble over a
**five-business-day window** — 2026-08-12 through 2026-08-18, 60 items,
≈ 6,750 input tokens — and re-commission. No execution-budget policy is changed,
no code is changed, and the 12,000-token and 90-second authorisations stand
exactly as approved.

**What that window is not.** It is a window chosen for one run so it fits a
budget the firm already authorised. It is **not** a ruling that Global Macro may
reason over only five days of history, and it must never be recorded, rendered
or reported as a limitation of the evidence architecture. A five-day window
still carries the full eleven-tenor term structure across five reference periods
and five derived spreads, which is what the exit asks for.

#### Stage C exit, second attempt — and the defect it exposed, fixed 2026-08-19

**The run.** `run-132054669959f3ce20268241aa4b90fe`, evidence set
`7b454f28d93f03971365edfe19164b27` — 60 items, the five-business-day window,
2026-08-12..2026-08-19. It failed `budget-exhausted` after **66.156 s**, well
inside the 90 s deadline. The provider answered, the JSON parsed, every citation
resolved, claims were built — and then refused, because measured usage exceeded
the 12,000-token authorization. **Zero produced claims**, by design.

**Preserved.** Both failed runs and the accepted C2-2 run are `obsolete = false`
and unchanged.

**The defect the diagnosis found.** The run record said `usage_state:
'not-reported'`, `input_tokens: null`, `output_tokens: null` — for a run refused
*because of its usage*. That is not the provider's silence: `budgetOverruns`
opens with `measuredCost(usage)` and returns nothing unless the state is
`measured`, so reaching the refusal proves the firm was holding the numbers.
`settle` → `failAgentRun` then dropped them, because the command had no usage
input at all.

So the record could say **that** a run exceeded its budget and never **by how
much** — the one measurement needed to decide what the limit should be. The firm
could not answer *what would have been enough* without spending the same call
again. All that remained derivable was a bound: total > 12,000, output ≤ 4,096
(`max_tokens`), therefore **input > 7,904** against a pre-run estimate of 6,747.

**The fix, scoped to exactly that.** `FailAgentRunInput` gains an optional
`usage`, **measured only**; the orchestrator's overrun path passes
`settled.value.usage`. Nothing else changed: no request estimation, no
pre-dispatch refusal, no prompt compaction, no historical summarisation. Claims
are still not written and nothing is offered for acceptance — **recording spend
is not accepting it.**

**No institutional or schema decision was required, which was checked before
building rather than assumed.** `usage` is already required on every
`AgentRunRecord`; `usagePermitted` keys on provider kind alone and has no
coupling to run state, so a failed live run carrying `measured` usage was
already a legal record. The `runs` table already holds the columns and 0029's
CHECK ties them to `usage_state` independently of state. The gap was entirely in
the command's input surface.

**One sub-decision, recorded rather than buried:** a non-measured usage on the
failure path is **refused**, not ignored. A run that measured nothing already
carries `not-reported` from the moment it started, so passing it would be a
no-op dressed as a decision — and worse, it would let a settlement overwrite a
real measurement with silence.

**Payload compatibility.** `usage` is omitted from the command payload when
absent, so every failure recorded before this field existed produces a
byte-identical payload and no stored command's identity moves.

**Verified.** The PG test plants the defect and catches it with the production
symptom — *expected `{ state: 'not-reported' }` to deeply equal
`{ state: 'measured' }`* — and passes with the fix. Unit **2337 pass / 8
skipped, 98 files**; PostgreSQL **819 pass, 35 files**, two consecutive fully
captured green runs; `tsc --noEmit` clean.

**Still open, and deliberately not fixed here:** the overrun path records
`attempt: 1` as `failAgentRun`'s default rather than threading
`settled.attempts`, so the recorded attempt count on a budget-refused run is not
a measurement. Outside the ruled scope of this fix.

#### `macro-regime` v3 — the breaker recalibrated, ruled 2026-08-19

**A third version rather than an edit**, for the reason v2 was a second one:
registration is append-only and a budget is inside `playbookContentHash`.
**v1 and v2 are unchanged**, and both failed Stage C runs stay readable against
the 12,000 they were actually judged against.

| | v2 | v3 |
|---|---|---|
| tokens | 12,000 | **24,000** |
| cost | \$1.00 | \$1.00 — unchanged |
| deadline | 90,000 ms | 90,000 ms — unchanged |

**24,000 is a circuit-breaker calibration, not an expected-spend estimate**, and
the distinction is the whole ruling. v2's 12,000 was ~8× headroom over two runs
that consumed 1,562 and 1,459 tokens against **one observation**, decided before
any curve existed. Curve-scale evidence is not pathology — it is the capability
C3 was built to deliver — so the breaker was firing on normal operation, which
is exactly what `MACRO_ANALYSIS_BUDGET`'s own note warns against: *a limit set
near expected usage destroys work the firm already paid for.*

So the new figure is **2× the pre-curve breaker**, chosen for material headroom
over the normal shape rather than fitted just above it. It is deliberately not
derived from the refused run's actual consumption — that measurement was
destroyed by the defect this stage fixed, and fitting a limit to a number the
firm could not read would be inventing precision.

**It still breaks.** The 264-item full-serialization shape needs ≈ 28,350 input
tokens before output and stays refused at 24,000. A limit admitting every shape
the firm can render would authorize the pathology instead of catching it. A test
holds that property rather than a comment.

**Deadline unchanged on measured grounds:** the refused run's provider call
completed in **66.156 s** inside a 90 s authorization, so nothing measured
justifies moving it.

**Consequences, taken rather than worked around.** `resolveForCaseKind` returns
the highest version, so new cases pin v3 and three tests that pinned v2 as the
default were updated — mechanical, and exactly what pinning a version is for.
Cases on v1 and v2 keep them.

**Recorded as debt, not fixed: TD-80.** The attempt count on a budget-refused
run is `failAgentRun`'s default rather than `settled.attempts`, so it reads as
measured and is not.

#### Stage C exit, third attempt — and `macro-regime` v4, ruled 2026-08-20

**The run.** `run-85158581ec24392d9a02b1283d030a9d`, v3, the same 60-item set,
24,000 tokens. `timed-out` at **90.072 s**, `provider-timeout`, **two attempts —
measured, not defaulted**, because the pipeline path threads `settled.attempts`.
No usage, no parse, no claims. **The 24,000-token authorization played no part**:
`budgetOverruns` is evaluated only when the pipeline returns `ok`, and it never
did. The v3 breaker remains untested against this shape.

**The comparison, and its limit.** Runs 2 and 3 sent **byte-identical requests** —
same evidence set, same prompt content hash, same model, parameters, provider
version and contract version, 78 minutes apart on one server process. One
completed in **66.156 s**; the other retried and hit the wall. The mechanism is
recorded and the magnitude is not: the deadline is shared across attempts and the
backoff is at most 500 ms, so `T1 + T2 = 90.07 s`, and if the first attempt took
more than ~23.8 s the second could never fit behind it. **Reported as partially
unexplained** rather than attributed to provider latency nobody measured.
Recorded as **TD-81**.

**The structural finding.** At 90,000 ms a single normal attempt consumed
**73.5%** of the envelope, so `maxAttempts: 3` authorized a retry policy the
deadline could not afford.

**v4 — the envelope widened, and only that.** Tokens stay at 24,000, money at
\$1.00; neither was implicated. **180,000 ms** is sized to hold one normal
attempt plus one full retry — 66.2 + 0.5 + 66.2 = 132.9 s — with ~47 s of
headroom. 150,000 ms was rejected as too close to that requirement. It is
deliberately **not** stretched to guarantee three full attempts: `maxAttempts`
bounds how often the pipeline may try inside the envelope, not how much
wall clock the firm authorizes, and the per-run deadline stays the superior
circuit breaker. **It is an envelope calibration, not an expected duration** — a
run that takes 180 s is being caught, not behaving as designed.

**The synchronous path was checked before the deadline was raised, not after,**
as the ruling required. `stageDeadlineMs` is read off the resolved budget rather
than fixed in code; `vite.config.ts` sets no server timeout; neither Vite nor
TanStack Start overrides Node's; Node v24 defaults are `requestTimeout` 300,000
ms, socket timeout disabled, `headersTimeout` 60,000 ms against request headers
rather than the response, `keepAliveTimeout` 5,000 ms between requests. A 185 s
request was held open end to end on this runtime and completed, and the product
itself already held a synchronous commission open for 90 s. **No bound below
180 s exists.** Commissioning stays synchronous, by ruling.

**v1, v2 and v3 unchanged; all three failed runs preserved** and still readable
against the envelopes that judged them.

#### Stage C complete — the live proof, accepted 2026-08-20

**Stage Outcome.** A person commissioned Global Macro from the product against
an evidence set the firm assembled from observations it ingested itself, and
accepted the result. The desk read a **term structure** and a **derived spread it
did not compute**, and every claim it made resolves to that set. C3's chain —
*riktig källa → automatisk ingestion → tidsserie → provenance → derived
observations → EvidenceSet → Global Macro → Macro View* — is proven end to end
against real data. **The pipe is true.** It is not complete, and §7's limits
stand unchanged.

**The accepted run, read out of PostgreSQL rather than off a screen.**

| | |
|---|---|
| run | `run-4016977fa8d71f147d52d54def06e364` · **`completed`** · `obsolete = false` |
| case · workflow | `dev-1787181229708` · `macro-regime` **v4** |
| evidence | `7b454f28d93f03971365edfe19164b27` — the governed 60-item set, **not reassembled** |
| provider phase | `16:59:26.485Z` → `17:01:37.816Z` = **131.331 s** |
| accepted by a person | `17:09:04.466Z`, assignment `completed` |
| usage | **measured** — 15,531 in + 3,697 out = **19,228 tokens** |
| authorized | 24,000 tokens · \$1.00 · 180,000 ms |

**What the desk produced.** **14 institutional claims** in `analysis.claims`,
citable: 8 `supported`, 3 `partially-supported`, 3 `insufficient-evidence`.
**50 citations across 27 distinct observations**, every one resolving into the
governed set with a matching content hash — **zero unresolvable, zero hash
drift**. Nine tenors of the curve were cited, and `curve:us:2s10s` sixteen
times.

**The derivation held, which is the property §0.5 exists for.** All five derived
spreads the set contains were cited, and each resolves to the two par yields it
was computed from, both members of the same set:

```
2026-08-12  48bp   2y 4.2%   10y 4.68%
2026-08-13  48bp   2y 4.15%  10y 4.63%
2026-08-14  51bp   2y 4.17%  10y 4.68%
2026-08-17  53bp   2y 4.19%  10y 4.72%
2026-08-18  52bp   2y 4.19%  10y 4.71%
```

Exact decimal throughout, per §0.3c — no `19.99999999999997`. **Nothing
downstream recomputed a spread.**

**Measured against the finding that opened C3.** The C2-2 run, given one
undescribed number, produced two supported observations and five
`insufficient-evidence` claims. This run, given a described term structure,
produced fourteen claims of which eight are supported. The three that remain
`insufficient-evidence` are capped `no-evidence` — the desk asserting something
and citing nothing for it, which is the cap working rather than the evidence
failing.

**The staleness cap did not fire, and that is correct.** The freshest cited
observation describes 2026-08-18, one day behind assembly, inside the
five-day sovereign-yield horizon.

#### What the live proof cost, recorded rather than tidied away

Three attempts failed before this one, and all three runs are preserved,
`obsolete = false`. **None of the three failed on the evidence architecture.**

| run | envelope | outcome |
|---|---|---|
| `run-90240a44…` | v2, 264 items | `provider-timeout` at 90.072 s, 2 attempts |
| `run-13205466…` | v2, 60 items | `budget-exhausted` — complete valid answer at 66.156 s, refused, **usage discarded** |
| `run-85158581…` | v3, 60 items | `provider-timeout` at 90.072 s, 2 attempts |

Two produced institutional improvements that are now permanent: the second
exposed the **usage-loss defect on the budget-refused settlement path**, fixed
in this stage; the first and third exposed **TD-79**, **TD-80** and **TD-81**,
recorded and deliberately not solved.

**The v3 breaker is now measured, not argued.** 19,228 tokens: above the 12,000
that refused run 2, below the 24,000 ruled at v3. The ruling was right, and it
is now right *on evidence* rather than on reasoning.

**The v4 envelope held, and its rationale did not — stated plainly rather than
claimed as validation.** 180,000 ms was calibrated on the assumption of a
~66.2 s attempt plus one full retry. The accepted run's provider phase took
**131.331 s**, and the record does not say across how many attempts (**TD-81**).
So the envelope's real headroom over what actually happened was **~49 s, not the
~114 s a single-attempt reading implied**, and a further retry would not have
fitted. The number was sufficient; the model behind it was not confirmed.
Recorded as **TD-82**.

**Stage C — the desk reads a curve.**
The evidence representation the model receives carries the institutional
semantics the firm already holds — subject, kind, unit, source, trust, as-of,
reference period — as a **rendering of the record, not a second schema** (§0.9).
Commission Global Macro against the assembled set. Staleness defined for
sovereign yields only; `DERIVABLE_CAPS` narrowed by one.

*Exit:* **a real live run, commissioned from the product by a person, whose
claims cite a term structure and a derived spread, judged by a person** — the
same bar C2-2 was accepted at, and the only bar that proves this.

### The exact first user-visible capability

Stage A has no interface. The first thing a person can do that they cannot do
today arrives with **Stage B**:

> **"Sammanställ underlag"** — the user selects a subject and a window, sees
> every observation the firm holds for it including where two sources disagree
> and where a source revised itself, and records the assembly as an
> institutional act with their name on it.

Stage C is what makes it worth having: the commission screen then offers *"US
Treasury par curve, 2026-08-14 · 7 observations, 1 derived (2s10s), 1 source"*
where today it offers *"1 obs, ECB"*.

---

## 6. Deliberately out of scope

TD-76, TD-77, TD-78 — inherited open by ruling, none folded in. TD-75 beyond one
family. TD-25, TD-37. Thesis-level confidence. A `MacroView` aggregate. An
allocation engine, and any durable record of `80/20`. Client portfolio
implementation. Twelve of the thirteen evidence families. Market-implied policy
expectations. Any paid or keyed provider. A generic data lake. A backtesting
platform. Chat, multi-agent collaboration UX, the Command Center redesign. TD-8.
The `vite build` failure.

**The Command Center visual remains the north star. C3 is about making what it
would display true before making it beautiful.**

---

## 7. Expected impact on investment-decision quality

**What it changes.** The C2-2 run's five refusals had a measured cause: one
undescribed number. Stage C fixes both halves of that — more observations, and
observations the desk can identify. A term structure with a derived spread lets
Global Macro answer *"what is already priced"* at the front end of the curve for
the first time, and lets it say so with citations that resolve.

**What it does not change, stated plainly.** C3 does **not** make the firm able
to answer *"what macro regime are we in."* That needs growth, inflation and
labour, and C3 builds none of them. It also does not produce a risk-posture
recommendation, and must not appear to.

**What it makes possible.** Once one family is proven end to end, each further
family is an adapter and a requirement row against an architecture that already
holds — and the six-altitude read (level, trend, momentum, surprise, market
pricing, historical context) becomes available for every one of them, because
all six are functions of a history the firm will finally hold.

**The honest summary: C3 makes the pipe true. It does not make the view
complete, and the completion report must not claim it does.**

---

## 8. Stop / go — settled

**GO, approved 2026-08-17.** All rulings are recorded in §0.

**The blocking decision is settled: option (b)** — the domain tag the
observation id should already carry per canonical-value-v1 §9, versioned to
`:v2`, carrying `referencePeriod`. Per §0.1, **v1 remains valid, resolvable and
cited as v1**; no migration rewrites history and nothing presents v1 evidence as
having been created under v2 semantics.

**Reported, not resolved:** thesis-level confidence (§0.7). Whether an approved
tactical allocation needs its own durable record for attribution and Performance
Office learning (§0.8) — a future explicit decision, deliberately not
foreclosed. The eligibility-basis question carried forward from C2-1 remains
undecided and is untouched here.

**What must not be weakened.** Everything in C2-2 §8.4 stands unchanged, and C3
adds four of its own:

- **Ingestion records; assembly judges.** The moment ingestion gains a human
  actor, or assembly loses one, the boundary is gone.
- **Assembly takes a query, never a list of ids.** A list is how an assembler
  drops the inconvenient source without the disagreement machinery ever seeing it.
- **A derived observation carries its inputs and its transformation version.**
  Without both, it is a number with a provenance story rather than a traceable one.
- **A regime read is a claim, never an observation.** Storing one as evidence
  would let the firm cite its own conclusion as support for itself.

---

## 9. C3 closed — 2026-08-20

**Status: CLOSED. Manually accepted by the CIO.** Every stage exit in §5 is met
and the live proof in Stage C was judged by a person, which is the only bar that
proves it.

### What the firm can do that it could not

> A person assembles an institutional evidence set for a subject and a window —
> drawn from observations the firm ingested itself from the US Treasury,
> including a derived 2s10s traceable to the two yield observations it was
> computed from — and commissions Global Macro against it, producing claims that
> cite a real term structure instead of one undescribed number.

That is §5's proposed capability, and it is now a thing that happened:
`run-4016977fa8d71f147d52d54def06e364`, 14 institutional claims, 50 citations
across 27 observations, every one resolving.

### Impact on Financial OS

The firm now holds **its own evidence**. Before C3, one production path could
manufacture an evidence set and it was a smoke route with no actor, no mandate,
no ledger entry and no recorded selection; the only institutional evidence in
existence was one hand-written ECB reading. Now observations are ingested from
an authoritative source under storage provenance, a **time series is a query
over individually citable facts**, an evidence set is written by the **twentieth
institutional act** with an actor, a mandate and a durably recorded, versioned
selection rule, and the derivation the desk reasons over is a stored fact with
its inputs inside its content hash.

The property that matters most is not any one of those. It is that **a claim
made in August resolves, byte for byte, to the evidence it was made from** — and
that this was verified against the database rather than asserted.

### Impact on future agents

Every desk the firm staffs next inherits this without building it. The evidence
briefing means an agent is told what a number *is* — subject, kind, unit,
source, trust, publication instant, reference period — instead of being handed a
hash and asked to infer. That change alone moved a desk from five refusals to
eight supported claims, measured across two live runs. The next family is an
adapter and a selection rule against an architecture that already holds, not
another architecture.

The boundaries hold for them too: an agent still cannot cite what it was not
given, still cannot compute a spread the firm did not derive, and still cannot
raise its own confidence.

### Business impact

The firm can now form a defensible view on **what the front end of the US curve
is pricing**, with citations a reviewer can follow to a published Treasury
figure and a derivation they can re-check by hand. That is the first
investment-relevant question Financial OS can answer from its own records.

It remains **one family and one question**. C3 does not answer *what macro regime
are we in* — that needs growth, inflation and labour, and C3 builds none of them.
No allocation, no risk posture, no client recommendation follows from this, and
nothing in the product may suggest otherwise.

### Financial OS maturity

The institution crossed from *recording decisions* to **holding the evidence
those decisions rest on**. Four capabilities now compose end to end: acquire,
assemble, analyse, accept. The gap that remains is not in that chain — it is
around it, in the **execution envelope**: how much a run may spend, how long it
may take, and what the firm records about the attempts. Three of the four live
exit attempts failed there, none in the evidence architecture, and that is the
honest reading of where the immaturity now sits.

### Next milestone

**Investment Command Center v1 / UX architecture**, separately gated. C3's own
§6 named the north star and its condition: *the Command Center visual remains the
north star. C3 is about making what it would display true before making it
beautiful.* What it would display is now true for one family.

### Strategic value

The firm can be **held to account for a number**. An institution that produces
investment views without traceable evidence is producing opinions; one that can
show which observation, from which source, describing which period, under which
selection rule, judged fit by which person, is producing analysis. C3 bought
that property for one evidence family and proved it with a real run — and the
cost of the second family is now adapter work rather than architecture.

### One verification-infrastructure failure at close, recorded as observed

**2026-08-20.** During the closing boundary a PostgreSQL run reported **35 files
failed, "no tests"** — `TypeError: Cannot read properties of undefined (reading
'config')` on the first file and *"Vitest failed to find the current suite"* on
the other 34. The embedded cluster started normally; **the suite never
executed**, so this produced no information about the code either way.

**A different class from the §8.2 flake**, which is a single red test in one
file. This is a total runner-initialisation failure, and it is recorded as its
own observation rather than folded into that count.

**The one difference from every green run:** it was chained directly onto a
preceding full suite inside a single shell command, so a second cluster began
initialising as the first was tearing down. That is a **plausible mechanism, not
a diagnosis** — it was not reproduced, and nothing was changed to make it go
away. Runs before and after it, invoked alone, were green at 819 / 35.

**The operational consequence, which is the part worth keeping:** run the
PostgreSQL suite **one invocation at a time**, never two chained in one command
and never two concurrently. The same session had already had to discard a
concurrent third run for the same reason.

### Open at close, and not to be read as delivered

Inherited and untouched: **TD-25, TD-37, TD-73, TD-74, TD-75** (three signals
remain underived), **TD-76, TD-77, TD-78**. The eligibility-basis question from
C2-1 remains undecided. Thesis-level confidence (§0.7) and the durable record of
an approved tactical allocation (§0.8) remain reported, not resolved.

Opened by C3 and deliberately unsolved — all four are **execution envelope**,
none is evidence architecture:

- **TD-79** — a run can be dispatched whose input alone exceeds its authorized budget
- **TD-80** — the attempt count on a budget-refused run is a default, not a measurement
- **TD-81** — no durable per-attempt category or timing on a run
- **TD-82** — the envelope is calibrated on single samples; provider latency is unmodelled

**None of these is C3 capability, and no report may present them as delivered.**
Also explicitly not delivered: prompt compaction, historical summarisation, any
more efficient representation of historical evidence to an agent, twelve of the
thirteen evidence families, and the `vite build` failure.

**The honest summary stands as §7 wrote it before any of this was built: C3
makes the pipe true. It does not make the view complete.**
