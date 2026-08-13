# Planning gate — C2: the first operational agent

**Status:** for review. Nothing implemented. This gate lifts two standing
constraints, so it should not be approved casually.

**Chosen capability.** Agent Headquarters together with the first operational
agent. Agent HQ ships **when there is a live agent to show** — a roster of
non-operational agents unlocks nothing a user can do.

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

### 4.2 Cost

`ContributionBudget` already models tokens, cost, currency and deadline, and
already states that `null` means *not measured*, never unlimited, so that **"a
live runtime must refuse to begin work when a required authorization is
absent."**

**Proposed:** a live run **refuses to start** without a budget. Not a default,
not unlimited — the same shape as every policy decision in this codebase. The
budget is recorded on the run, and exceeding it fails the run through
`failAgentRun`, which already exists and already refuses to record a claim.

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

### 5.2 Where unaccepted work lives — the design the ruling forces

Measured, not assumed: **`RecordContribution` today does two things in one
act.** It saves the claims into `repositories.claims` *and* transitions the run
to `completed`, and that coupling is deliberate — its own header says a
"completed run with half its claims" is the worst outcome available.

So the agent's output needs somewhere to live between *produced* and *accepted*.
It cannot live in the operator's browser: the firm paid for that work, and a
page refresh would lose it.

**Proposal — one new run state, `awaiting-acceptance`:**

```
running ──► awaiting-acceptance ──► completed   (a human accepted)
                    │
                    ├──────────────► rejected   (a human declined, with a reason)
                    │
                    └──────────────► failed | cancelled
```

**`rejected` is its own terminal state, not a kind of `failed`.** A failed run
produced nothing; a rejected run produced work the firm declined. Collapsing
them would make "how often does this agent fail" and "how often is its work not
good enough" the same number, and they are the two different questions worth
asking about an employee.

- The provider finishes; the run holds its claims and enters
  `awaiting-acceptance`. `AgentRunRecord.claims` **already exists**, so the
  work is durably stored and visible.
- Nothing is in `repositories.claims` yet, so nothing is verifiable, gateable,
  aggregatable or citable. It is not institutional work.
- A human accepts. That act commits the claims and completes the run —
  `RecordContribution` unchanged, still atomic, now invoked by a person.

**Why not a separate "proposed contribution" record:** the run already *is* the
record of work produced. A second store for the same claims would be two places
answering "what did this run produce".

**All provider kinds go through acceptance, including recorded and stub.** The
port's own rule is that "a recorded contribution goes through exactly the same
validation, lifecycle, review and gating code a live one will" — an acceptance
step that only live work traversed would be untested by every existing test.

**The cost, stated plainly:** every existing test that records a contribution
gains an acceptance step, and the run state table, its transitions and both
adapters change. This is real domain work, not presentation. It is in scope
because it was ruled, and it is the kind of change that is far cheaper now than
after the institution depends on autonomous records.

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
| `below-quality-bar` | Right shape, not good enough |
| `out-of-scope` | Correct, and not this department's work |

Plus a required prose `detail`, because a code alone cannot teach anyone
anything, and a rejection nobody can learn from is the discarded history this
ruling exists to prevent.

The codes are **stable vocabulary**, like `RejectionCode` and `BlockerKind`
before them, so a later capability can count them without parsing anything.

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
2. **Model client and provider** — which, and does the choice belong in this
   gate or to whoever implements it?
3. **Budget authority.** Who sets a run's budget: the playbook entry, the case,
   or firm-wide configuration?
4. **Failure visibility.** A failed run costs money and produces nothing.
   Should it appear in Headquarters as an institutional act, or as operational
   noise? *My view: an act. The firm spent money and learned nothing, and that
   is a fact worth seeing.*

---

## 10. Exit criteria

- [ ] A live agent produces a real claim for a real case, end to end
- [ ] **Nothing enters `repositories.claims` without an explicit human act** —
      asserted by driving a run to `awaiting-acceptance` and confirming the case
      has no claim, no eligibility change and nothing to verify
- [ ] Recorded and stub runs traverse the same acceptance path
- [ ] A rejected run records a bounded reason code **and** prose
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
