# Planning gate — C2: the first operational agent

**Status:** approved. Nothing implemented — C2-1 begins in a fresh session,
sized so the domain change, both adapters, contract parity and the
contribution-test migration reach a green boundary in one effort.

This gate lifts two standing constraints, and the four decisions the guard
demanded (§4) are made.

**Chosen capability.** Agent Headquarters together with the first operational
agent. Agent HQ ships **when there is a live agent to show** — a roster of
non-operational agents unlocks nothing a user can do.

> **The standing principle this phase establishes**
>
> **Generated work is operational until a human explicitly accepts it. Accepted
> work becomes institutional. Rejected work remains durable operational history
> and never becomes institutional evidence.**

---

## 1. What this phase crosses

Two guards, both load-bearing, both with planted violations proving they work:

| Guard | What it says today |
|---|---|
| `no-llm-dependency` | *"Nothing in the codebase imports a model client."* Its stated reason: **"C2 is the gate where determinism, cost, caching and provenance for real model execution get decided. A client appearing before it decides them by default and by accident."** |
| `ships no live contribution provider` | Nothing may set `providerKind: 'live'` |

The rules name the four decisions this gate must make. **§4 makes them.** Until
they are ruled, no client is imported — that ordering is the point of the guard,
and this document is the thing it was waiting for.

---

## 2. What is already built, which is most of it

The seam was designed for this moment and says so in its own comments.

| Already exists | State |
|---|---|
| `ProviderKind` | includes `'live'`, annotated *"Not permitted before Phase C2"* |
| `ExecutionIdentity` | `{ kind: 'model'; prompt: PromptRef; model: ModelRef }` |
| `IDENTITIES_BY_PROVIDER` | already declares `live: ['model']` — a live provider may present **only** a model identity |
| `ContributionBudget` | tokens, cost, currency, deadline; `null` means *"not measured, never unlimited"* |
| `ContributionPort` | one interface; recorded and stub implement it; live is the third |
| `startAgentRun` / `recordContribution` / `failAgentRun` | built, registered, executable |
| Claim, evidence, provenance model | content-hashed, canonical, verified |

**The rule that makes this cheap:** *"a recorded contribution goes through
exactly the same validation, lifecycle, review and gating code a live one will."*
The live path is not new machinery — it is a third implementation of an
interface two others already satisfy.

**What is genuinely missing:** a live provider, a model client, the four
rulings, the human-approval step, and Agent Headquarters.

---

## 3. The determinism question, which is less hard than it looks

This codebase content-hashes identity, canonicalises payloads, and requires a
replayed command to return the same result. A language model is
non-deterministic. Those appear incompatible.

They are not, because **determinism is required of the institution, not of the
model**:

- A run executes **once**. Its output is recorded as an immutable artifact with
  its `ExecutionIdentity` — the exact prompt and model that produced it.
- Replaying the command returns the **stored result**; it does not re-execute.
  `runCommand` already does this, proven across restarts.
- Re-running the same analysis later is a **new run**, with its own identity,
  producing a new claim. Two different answers from two runs is not a defect —
  it is two pieces of work, correctly distinguished.

So the institutional guarantee is unchanged: *the record of what the firm did is
immutable and replayable.* What is new is that one input to that record came
from a model, and the record says exactly which.

**Nothing about this requires a deterministic model, and nothing should pretend
the model is one.** Temperature, sampling and model version go into
`ExecutionIdentity` as facts.

---

## 4. The four rulings the guard demands

### 4.1 Determinism

**Ruled by §3**: the model is not deterministic; the institution is. A run
executes once, its artifact is immutable, replay returns the record. Re-running
is a new run producing a new claim, never a silent overwrite.

**Consequence to accept:** two runs of the same brief may disagree. The
institution already handles that — it is what aggregation and the Devil's
Advocate exist for.

### 4.2 Budget — governs execution, not payment

**Ruled: the abstraction is not tied to monetary cost.** A budget governs
execution. A provider may consume a token budget, an execution deadline, a
monetary budget where one applies, or **no monetary cost at all** — local and
simulated providers are first-class, and stub, recorded, local and commercial
providers all execute through one contract.

**Resolution, ruled:**

```
Playbook proposes  ->  Case may constrain  ->  Firm-wide policy is the hard ceiling
```

The **effective** budget is resolved before execution and **recorded with the
run**, so "what was this allowed to spend" is answerable from the record rather
than reconstructed from three sources that may since have changed. The same
shape as every policy decision here: resolved by the caller, recorded with the
act, never looked up again afterwards.

#### A gap this ruling exposes

`ContributionBudget` today is four nullable numbers, with `null` documented as
**"not measured, never unlimited"**, and the rule that a live runtime must
refuse to begin when a required authorization is absent.

**There is no way to say "this provider incurs no monetary cost, by
construction".** A local provider setting `costMinorUnits: null` is
indistinguishable from an unbudgeted one, and would be refused. That is the
same distinction the eligibility gates already draw between `not-applicable`
and `passed`, for the same reason: a limit that does not apply and a limit
nobody measured are different facts.

**Proposal** — each dimension becomes a small union rather than a nullable
number:

| Shape | Meaning |
|---|---|
| `{ kind: 'limit', amount }` | Bounded. Exceeding it fails the run |
| `{ kind: 'not-applicable' }` | The provider cannot consume this. A local model has no monetary cost |
| `{ kind: 'not-measured' }` | Unknown, and therefore **refuses to start** a live run |

`not-measured` keeps its present meaning exactly — the refusal the original
comment was written to make possible — while `not-applicable` stops local
providers being blocked by a limit that was never relevant to them.

#### The run records limits, not their sources

**Ruled: the budget recorded on a run is the effective execution limit, not the
policy sources that produced it.** A historical run must remain self-describing
even after playbooks, case policy or firm-wide policy change.

So the run stores "this was allowed 40,000 tokens and 90 seconds", never
"playbook X proposed, case Y constrained, policy Z capped". Storing the sources
would make an old run's limits re-derivable only from documents that have since
moved — and a run whose limits could not be read without reconstructing three
policies would not be a record of what the firm permitted, it would be a
reference to it.

The same rule the eligibility basis already follows: the record carries what was
in force, not a pointer to wherever it currently lives.

### 4.3 Caching

**Proposed: no response cache for institutional work.** A cache would make two
identical briefs produce one piece of work while the record claims two, and
"the firm analysed this twice" would become false without anything being
written down. The artifact *is* the cache: a recorded run replays for free.

Cost control belongs to §4.2, not to a cache that quietly deduplicates
institutional acts.

### 4.4 Provenance

Already modelled and enforced: a live provider may present **only** a `model`
identity, carrying `PromptRef` and `ModelRef`. The union exists so that
**"nothing may carry a model reference unless a model produced it"**, and the
inverse holds too — live work cannot hide behind a scenario id.

**Proposed addition:** the prompt is content-addressed like everything else, so
"which exact instruction produced this claim" is answerable years later.

---

## 5. The human/agent boundary, applied

Ruled: *humans own authority, agents own analysis; agents may recommend, humans
approve institutional acts; every act stays attributable to a human actor.*

Applied to what exists:

| Act | Who | Why |
|---|---|---|
| Producing a contribution | **agent may** | Analysis is what agents own |
| **Recording it as institutional work** | **human** | Ruled in §5.1. The agent produces; a person accepts |
| `AggregateManagerConclusion` | **human** | A manager deciding what the work means |
| Verification / Devil's Advocate / Risk verdicts | **human** | Governance |
| `SubmitForCioDecision` | **human** | Asking the firm to commit |
| CIO decision, return, reopen | **human** | Explicitly excluded by the ruling |

### 5.1 Ruled: attribution is not sufficient

**An agent contribution does not enter the institutional record automatically.**
It may be generated automatically and displayed automatically, but **recording
it as institutional work requires an explicit human acceptance.**

Once there is operational experience, the firm may deliberately decide that some
classes of agent record autonomously. **Relaxing that boundary later is safe;
tightening it after the institution has begun relying on autonomous records is
not.**

This ruling forces a design change, and §5.2 is that change.

---

### 5.2 Where unaccepted work lives — CORRECTED

> **The first version of this section was wrong, and implementation found it.**
> It claimed `AgentRunRecord.claims` was durable storage the run could hold work
> in. It is not: in **both** adapters `claims` is a *projection of the claims
> table filtered by `run_id`* — in-memory `hydrateRun` builds it from
> `store.claims` ("Claims live in their own repository"), and PostgreSQL
> groups `CLAIM_SQL.forRuns` by run.
>
> So "hold the claims on the run" and "put the claims in the institutional
> record" were the same operation, and there was nowhere for produced work to
> live. Recorded here rather than quietly fixed, because the plan was approved
> on a false premise and the correction changes scope.

**Ruled: produced-but-unaccepted claims get their own durable operational
store**, separate from the institutional claims repository.

Two designs were rejected, each for a stated reason:

- **An `accepted` flag on the institutional claims table.** Cheapest, and it
  turns non-citability from a database property into a filter every consumer
  must remember. The whole point of the FK boundary is that nobody has to
  remember it.
- **Denormalising claims onto `AgentRunRecord`.** Breaks the existing claim
  identity and repository model, which stays intact.

### 5.2.1 The lifecycle

```
provider produces claims
        │
        ▼
operational produced-claim store        ← durable, readable, NOT citable
        │
        ▼
run = awaiting-acceptance
        │
        ├── human accepts ──► atomically:
        │                       create institutional claims
        │                     + complete the run
        │                     + populate the reusable result store
        │
        └── human rejects ──► produced claims stay durable in operational
                              history; run = rejected with one primary code and
                              mandatory prose; NOTHING is copied into the
                              institutional claims repository, and the result
                              store is NOT populated
```

**A rejected result must never become reusable merely because the model
produced it successfully.** The result store is for work the firm stands behind.

### 5.2.2 Claim identity is preserved, not re-derived

Moving a claim from operational to institutional storage **must not create a
second canonicalisation or a second content-hash implementation.** The identity
and content semantics are the ones that already exist; the claim crosses a
storage boundary, it is not rebuilt on the other side.

A second hasher would mean the same claim could hash differently depending on
which side of acceptance it was read from — and content-addressed identity that
depends on where you look is not content-addressed.

### 5.2.3 What this adds to the stage

| | |
|---|---|
| **Migration** | A produced-claims table, with a foreign key to the run and none to anything institutional |
| **Both adapters** | In-memory and PostgreSQL implementations of the produced-claim store |
| **Contract parity** | Shared cases for produce → accept and produce → reject, so neither adapter defines its own acceptance semantics |
| **The FK boundary** | Citations continue to reference the institutional claims table only. Nothing changes there, which is the point: a produced claim is not in it, so citing one cannot resolve |

**All provider kinds traverse acceptance, including recorded and stub.** An
acceptance path only live work went through would be untested by every existing
test.

**The cost, restated:** a table, a migration, both adapters, contract parity,
two commands, the run state table, and every existing contribution test gaining
an acceptance step. Larger than the approved plan, because the approved plan was
wrong about where work could live.

### 5.3 Rejection is institutional knowledge

**Ruled: a rejected agent contribution must record a reason**, and rejection
becomes institutional knowledge rather than discarded history. The purpose is
auditability *and* continuous improvement — the firm should be able to ask which
agents are rejected most, why, whether rejections cluster by capability, prompt,
task or market regime, and whether an agent improves.

**That makes the reason a code, not a sentence.** None of those questions can be
answered over prose. This codebase already paid for that lesson once: `Blocker`
carried `detail: string`, prose became a data channel, the category was
recovered by matching sentence prefixes, and renaming a message silently
reclassified a blocker.

**Proposal — a bounded `RejectionReason`, prose alongside rather than instead:**

| Code | What it means |
|---|---|
| `unsupported-by-evidence` | The claim outruns what the evidence shows |
| `misread-the-brief` | Answered a different question |
| `internally-inconsistent` | The reasoning contradicts itself |
| `duplicates-existing-work` | Already known; adds nothing |
| `insufficient-analysis` | The work did not go far enough |
| `out-of-scope` | Correct, and not this department's work |

`insufficient-analysis` replaces an earlier `below-quality-bar`, ruled: the
vocabulary exists to be **measured over years**, not merely read, and "below the
bar" describes a verdict rather than a deficiency. A code naming *what was
wrong* can be improved against; one naming *how it scored* cannot.

**One primary code per rejection, plus mandatory prose.** Multi-code tagging is
deliberately not built. If operational evidence later shows one code is
insufficient, it is extended deliberately.

> *My reading of that ruling, stated so it can be corrected: the vocabulary is
> these six and a rejection carries exactly one of them — not that v1 ships a
> single code with no vocabulary. The five kept plus the replacement only make
> sense as a set to count over.*

The prose is **required**, not optional: a code alone teaches nobody anything,
and a rejection nobody can learn from is the discarded history this ruling
exists to prevent. The codes are stable vocabulary like `RejectionCode` and
`BlockerKind` before them, so a later capability counts them without parsing.

### 5.4 Rejected work is never citable

**Ruled: rejected work must never become citable institutional evidence.** It
remains part of the operational history of the run; only accepted work enters
the institutional record.

**This is already structural, and the phase must keep it so.** A rejected run's
claims live on `AgentRunRecord.claims` and never reach `repositories.claims`.
Every citation in the institution — `contests`, `evidenceRefs`, an aggregation
disposition, a challenge subject — references a claim id in that table, and
PostgreSQL holds those as foreign keys. **A citation of rejected work fails at
the database**, not at a rule somebody remembered to write.

Two things must therefore be true and asserted:

- acceptance is the **only** path into `repositories.claims`
- a rejected run's claims remain readable on the run, so the firm can study what
  it declined and why

---

## 6. Which agent first

**Proposal: one department analyst producing a contribution for a case** —
concretely, Macro Analysis, the role the existing flow already exercises.

Why that one:

- It plugs into `startAgentRun` → `recordContribution` with **no new
  institutional concept**
- Its output is a claim, which the whole institution already knows how to
  verify, challenge, aggregate and gate
- It is squarely inside "agents own analysis" — no authority is delegated
- It is the role with the most existing test coverage to compare against

**Explicitly not first:** anything in governance, and anything producing the
decision memo. The 11-agent letter roster in `services/investmentLetter/` is a
different pipeline and a later phase.

---

## 7. Agent Headquarters

Ships **with** the live agent, not before.

**Shows:** who the agent is, what it is responsible for, what it has actually
produced — real runs, real claims, real cost, real failures — and where each
claim ended up in the institution. It is the staff view of the institution
Headquarters already shows case-by-case.

**Renders acts, not documents**, consistent with the existing Headquarters
ruling: a run started, a claim produced, a run failed are acts on a timeline.

**Does not** show the 11 specified-but-unbuilt roles as though they were staff.
An institution that lists employees it has not hired is describing a plan.

The existing mock `agents.tsx` is replaced or removed in this phase — it is the
one surface still presenting fiction as capability.

---

## 8. Scope and sequencing

Deliberately sequenced so each stage ends **usable**, per the standing principle:

| Stage | Ends with |
|---|---|
| **C2-1** | A live provider behind the existing port, with budget refusal, model identity and failure handling — driven end to end against a real case in the PostgreSQL suite. **Usable**: the firm can commission real analysis. |
| **C2-2** | Agent Headquarters: the agent, its runs, its claims, its costs, its failures. **Visible**: a person can see what the institution's first employee did. |

**C2-1 is not infrastructure-only**: it delivers real analysis into a real case.
C2-2 makes it observable.

**Not in this phase:** more agents, the letter pipeline, delegated authority,
agent-run governance, TD-8 authentication.

---

## 9. Questions needing a ruling

1. **Rejection is ruled (§5.3, §5.4).** Remaining question: are the six
   rejection codes the right six? They are a first vocabulary, not a
   discovery — and unlike most vocabularies here, this one is meant to be
   *counted*, so getting the categories wrong is expensive to correct later.
2. **The client decision is a measured step, not a preference** — see 9A. It
   runs before implementation, and if it exposes another architectural choice
   this gate returns for review rather than proceeding.
3. **Budget shape (4.2).** Ruled in principle; the three-state proposal changes
   an existing type and both adapters, so the shape itself needs approval.
4. **Failure visibility.** A failed run costs money and produces nothing.
   Should it appear in Headquarters as an institutional act, or as operational
   noise? *My view: an act. The firm spent money and learned nothing, and that
   is a fact worth seeing.*

---

## 9A. The client decision, measured

**Ruled: do not choose a client by preference.** Before implementation, evaluate
candidates against what the provider contract actually requires, and record the
comparison rather than only the conclusion.

The requirements are already knowable from the port and the record it must fill:

| Requirement | Why the provider needs it |
|---|---|
| **Usage reporting** | `RunUsage` is required — "we did not record this" is a state, not an absence |
| **Timeout and cancellation** | `ContributionRequest.signal` is an `AbortSignal`; a deadline must be enforceable |
| **Retry semantics** | A retry must be distinguishable from a second run, or the record double-counts work |
| **Model identity** | `ExecutionIdentity` needs the exact model that **answered**, not the one requested |
| **Request provenance** | The prompt must be content-addressable |
| **Error taxonomy** | `RunFailure` and `failAgentRun` need bounded categories, not driver strings |
| **Streaming** | Only if it changes cancellation or usage accounting; otherwise irrelevant |

**The SDK stays confined to the live provider implementation.** Nothing in
domain, application or presentation may import it — enforced by the narrowed
rule rather than by convention.

**Return before implementing** if the evaluation exposes an architectural choice
this gate has not made.

---

## 10. Exit criteria

- [ ] A live agent produces a real claim for a real case, end to end
- [ ] **Nothing enters `repositories.claims` without an explicit human act** —
      asserted by driving a run to `awaiting-acceptance` and confirming the case
      has no claim, no eligibility change and nothing to verify
- [ ] **Before acceptance, citing a produced claim fails structurally** — not by
      a filter, by the citation resolving against a table the claim is not in
- [ ] **After acceptance, the newly institutional claim is citable** through the
      existing foreign-key model, unchanged
- [ ] **After rejection, the produced claim stays readable from the run and
      remains structurally non-citable**
- [ ] A rejected run populates neither the institutional claims repository nor
      the reusable result store
- [ ] Claim identity and content hashing are the existing implementation on both
      sides of the boundary — no second canonicalisation exists
- [ ] Recorded and stub runs traverse the same acceptance path
- [ ] A rejected run records one bounded reason code **and** mandatory prose
- [ ] A budget dimension that does not apply is distinguishable from one nobody
      measured; a local provider is not refused for having no monetary cost
- [ ] The **effective** budget is recorded with the run, not reconstructed
- [ ] A historical run reads back its own limits unchanged after the playbook,
      case policy and firm-wide policy that produced them have all been altered
- [ ] `rejected` is distinguishable from `failed` in every read path
- [ ] **A rejected run's claims are readable on the run and absent from
      `repositories.claims`** — and a citation of one is refused by the
      database, not by application code
- [ ] The claim is verified, challenged, aggregated and gated by the existing
      workflow, unchanged
- [ ] The run records its exact model and prompt; a live run cannot present any
      other identity
- [ ] A run with no budget refuses to start
- [ ] A run exceeding its budget fails, and records no claim
- [ ] Replay returns the recorded artifact and does not re-invoke the model
- [ ] Recorded and stub providers still pass every existing test unchanged
- [ ] `no-llm-dependency` is replaced by a narrower rule — the client is
      reachable only through the provider, never from domain, application or
      presentation
- [ ] Agent Headquarters shows the agent's real runs, claims, costs and failures
- [ ] The mock `agents.tsx` no longer presents fiction as capability
- [ ] Both suites green; typecheck clean

---

## 11. What I am explicitly flagging

**The acceptance ruling is the most consequential decision in this gate**, and
it is deliberately the conservative direction. It costs a run state, a command
signature, both adapters and every existing contribution test. It buys the
property that the institution never contains work no human agreed to, at the
moment before anything starts depending on the opposite.

**This gate lifts a guard that has held all phase.** `no-llm-dependency` should
not be deleted — it should be **narrowed** to "nothing outside the provider
imports a model client", keeping the property that matters: an LLM cannot leak
into the domain, the application layer, or a component. The replacement rule
needs its own planted violation and near-miss, like every other.

**The institution is about to start spending money and producing work nobody
wrote.** Every guarantee this phase relies on — attribution, provenance,
immutability, budget refusal, the human/agent boundary — already exists. That is
why this is the right moment. But it is the first phase where a defect costs
real money and produces a real claim the firm might act on, and the exit
criteria are written accordingly.
