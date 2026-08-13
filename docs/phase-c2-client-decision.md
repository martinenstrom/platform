# C2 — the measured client decision

**Status:** complete and approved. Every question here is ruled — §5 was the
one architectural choice this evaluation surfaced, and §6 rules it. Nothing in
this document is awaiting a decision.

**Method.** Evaluate candidates against what the provider contract actually
requires (§9A of the C2 gate), measuring the codebase first rather than
comparing SDK feature lists.

---

## 1. The measurement that decides most of it

**This codebase already calls commercial external providers, and has solved
every operational concern a model client needs — with one owner each.**

`src/infrastructure/marketData/` calls Avanza, CoinGecko, Bundesbank and
Frankfurter. **Not one of them uses an SDK.** The pattern is:

| Module | Owns |
|---|---|
| `providers/httpClient.ts` | The call itself. Propagates the caller's `AbortSignal`, enforces a network-disabled guard, parses safely, and **maps transport failures onto a bounded domain error vocabulary** |
| `attempt.ts` | `breaker → budget → limiter → timeout → call`, retries inside |
| the adapter | Mapping, validation, normalization |

Two things it says about itself are directly on point:

> `httpClient` has **no timeout and no retry of its own**. Adding either would
> create a second policy competing with the resilience pipeline, and **two
> owners for one concern is how retry storms are born.**

> Retries live inside `attempt` and re-enter budget and limiter on every
> attempt, because **a retry is a request and the provider counts it as one.**

That second sentence is §9A's retry criterion — *"a retry must be
distinguishable from a second run, or the record double-counts work"* — already
solved, and solved correctly.

---

## 2. The criteria, scored

| Requirement | Existing pattern | An official SDK |
|---|---|---|
| **Usage reporting** | Read from the response body. Trivial | Typed. Marginally easier |
| **Timeout / cancellation** | `AbortSignal` propagated; `withTimeout` owns the clock | Brings its own timeout — **a second owner** |
| **Retry semantics** | Owned by `attempt`, re-enters budget, counted as a request | Brings its own retry — **a second owner, and the one the codebase warns about by name** |
| **Model identity of what answered** | Read from the response. Exact | Read from the response. Exact |
| **Request provenance** | We construct the request, so we can hash exactly what was sent | Constructed inside the SDK; hashing *what was actually sent* is harder |
| **Error taxonomy** | `classify(status)` → bounded `ErrorCode`, proven | SDK error classes — **driver-native types at the port**, the exact defect contract parity caught in R1 |
| **Streaming** | Not needed. A run produces a complete contribution, not a chat | Supported, and irrelevant here |
| **Structured output / tool protocol** | **The real cost.** Hand-rolled | **The real benefit.** Handled |

**Six of eight favour the existing pattern.** Two of those — retry and timeout —
are not preferences but direct conflicts with a stated architectural rule.

---

## 3. The one genuine argument for an SDK

**Structured output.** An agent must produce claims matching
`outputSchemaVersion`, and tool-use/structured-output protocols are more work to
hand-roll than a plain completion.

**Weighed honestly, it does not carry the decision:**

- The codebase **already validates contributions independently**
  (`contributionValidation.ts`, `outputSchemaVersion`). Whatever the model
  returns is validated before it becomes a claim, whether an SDK shaped the
  request or not. The trust boundary is unchanged.
- The surface actually used is one endpoint. The protocol is JSON over HTTPS.
- An SDK that produces well-shaped output but brings a second retry policy has
  traded a problem the codebase has already solved for one it has not.

**If protocol handling turns out to be substantial**, that is a reason to
revisit — and §5 is the place it would surface.

---

## 4. Recommendation

**No SDK. A narrow model client in the live provider, following the established
`httpClient` pattern**, with the resilience pipeline owning what it already
owns.

Concretely:

- one module performing the call, propagating the caller's `AbortSignal`,
  mapping failures onto a bounded error vocabulary
- no timeout and no retry of its own
- usage and model identity read from the response and recorded on the run
- the exact request bytes hashed for `PromptRef`
- **`no-llm-dependency` narrows to: nothing outside the provider may import a
  model client** — and with no SDK, there is no package to leak, which makes the
  rule easier to hold rather than harder

This is not a preference for hand-rolling. It is that **this codebase has
already built the thing an SDK would bring, with one owner per concern, and
adding an SDK would create second owners for two of them.**

---

## 5. The architectural choice this exposes

**The resilience pipeline lives in `src/infrastructure/marketData/`.** The
analysis provider needs the same guarantees. Three options, and this is the
choice the gate did not make:

| | | |
|---|---|---|
| **(a) Generalise** | Move `attempt`, `retry`, `timeout`, `tokenBucket`, `circuitBreaker`, `budget` to a shared infrastructure location, used by both | Refactor of a working, tested subsystem. Highest long-term value, real risk to a system that currently works |
| **(b) Duplicate** | A second copy for analysis | Cheap now. Two implementations of one concern — precisely what "one derivation per institutional fact" forbids, applied to operational policy instead |
| **(c) Own, simpler** | The analysis provider gets its own minimal timeout and budget enforcement, without breaker or rate limiter | Smallest, honest if the *needs* genuinely differ — and they may: market data is high-frequency and rate-limited per provider, while an agent run is infrequent and budget-bound per run |

**My reading:** (c) is defensible and (a) is better, but the choice turns on a
question I should not answer alone — **is a model provider operationally like a
market-data provider?** They differ in shape: market data is many small
frequently-repeated calls where rate limits and breakers earn their place; an
agent run is one long expensive call where a per-run budget and a deadline
matter and a circuit breaker may be premature.

If they are genuinely different, (c) is right and (a) would be generalising two
things that only look alike. If they are the same, (b) is the trap and (a) is
the work.

**(b) is wrong in every reading**, and is listed only to be excluded explicitly.

---

## 6. RULED: an analysis-specific pipeline

Ruled: **do not generalise the market-data pipeline simply because both are
called providers.** Build an analysis-specific execution pipeline, and reuse or
extract an existing primitive only where measurement shows the semantics are
genuinely identical.

> **Generalize shared semantics, not shared vocabulary.**

### 6.1 The measurement, primitive by primitive

| Primitive | Market-data semantics | Analysis semantics | Verdict |
|---|---|---|---|
| `withTimeout` | Wall-clock deadline on an in-flight call | Wall-clock deadline on an in-flight call | **Identical — extract** |
| `backoffDelayMs` | Exponential backoff, full jitter, injected `Random` so a seeded test reproduces the sequence | The same maths, and the same need for reproducibility | **Identical — extract** |
| `isRetryable` | Keyed on market-data's `ErrorCode` | A different error vocabulary entirely | **Different — own it** |
| Deadline *policy* | Per attempt | Per **run**, with attempts inside it | **Different — own it** |
| `DailyBudget` | A **daily request quota** for a provider, shared across instances, counted per attempt | A **per-run allowance** across tokens, deadline and possibly money, resolved from three policy sources and recorded on the run | **Different — do not reuse** |
| `TokenBucket` | Many small calls against a published rate limit | One long infrequent call per run | **Not needed** |
| `CircuitBreaker` | High frequency; a bad minute must not hammer a provider | Infrequent runs; see §6.2 | **Not needed — and its analogue is not operational** |

**`DailyBudget` is the clearest case of the rule.** It shares the word "budget"
with the execution budget and shares almost nothing else: one is a global daily
counter of requests, the other a per-run multi-dimensional allowance that must
be recorded with the run and stay self-describing. Reusing it because both are
called "budget" is exactly the trap.

### 6.2 The finding worth stating

**The analysis analogue of a circuit breaker is not operational — it is
institutional.**

A market-data provider failing repeatedly is an operational fact, and tripping a
breaker on it is right: stop calling, recover, resume.

An agent whose work is repeatedly *rejected* has not failed operationally at
all. Every call succeeded. What is wrong is the quality of the work, and that is
an institutional judgement the firm has just built a record for — one primary
rejection code plus mandatory prose, counted over years.

So the right response to "this agent keeps producing work we decline" is **for a
person to see it in Agent Headquarters and decide**, not for a breaker to
silently stop invoking it. A breaker here would hide the very signal the
rejection vocabulary exists to surface.

That is the same distinction as `failed` versus `rejected`, one layer down.

### 6.3 What this means for implementation

- **Extract two pure primitives** — `withTimeout` and `backoffDelayMs` — to a
  shared location, used by both pipelines unchanged. Pure functions with
  injected time and randomness; nothing to diverge.
- **Build an analysis execution pipeline** owning: run deadline, attempts within
  it, retryability against the analysis error vocabulary, and enforcement of the
  effective execution budget.
- **Build no rate limiter and no breaker.** If concurrent agent load later needs
  one, that is a measured decision then, not speculative infrastructure now.
- **Retries stay attempts within one run.** A retry must never become a second
  institutional run — the market-data layer states the same rule for the same
  reason, and it is the one piece of accounting both pipelines genuinely share.

---

## 7. What I need

Both original questions are ruled: **no SDK**, and **an analysis-specific
pipeline** rather than a generalisation.

The remaining item is capacity, not architecture. §6.3 is the implementation
plan, and it starts no refactor of the market-data pipeline — only the
extraction of two pure functions that both callers use unchanged.
