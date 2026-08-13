# C2 — the measured client decision

**Status:** for review. **One architectural choice surfaced (§5)** — per the
standing instruction, this returns before implementation rather than proceeding.

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

## 6. What I need

1. **The §5 choice** — (a), (b) or (c).
2. **Confirmation that no SDK is acceptable**, given it is a departure from the
   default expectation even though it matches this codebase's own precedent.

If (c) — the smallest, and the one that starts no refactor — implementation can
begin immediately, as agreed.
