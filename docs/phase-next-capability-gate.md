# Planning gate — choosing the next capability

**Status:** for decision. Nothing implemented, nothing recommended by default.

---

## 0. The measurement that reframes the question

Before listing candidates, one fact, measured rather than assumed:

> **Financial OS has 17 registered commands. A human can invoke none of them.**

Every analysis server function is a loader. There is no write path from a person
to the institution — `getCaseOverviewFn` and `getCaseListFn` read; nothing
writes. Every case visible in Headquarters got there through a test.

So the institution is **complete and entirely unoperable**. It can open cases,
assign work, record contributions, aggregate, review, challenge, assess risk,
submit, decide, return, defer and reconsider — and a portfolio manager sitting
in front of it can do exactly one thing: look.

That reframes the list below. Most candidates are not independent features; they
are slices of one missing capability, and the choice is mainly *which slice
first* and *how wide*.

Three further facts that bear on the choice:

| | |
|---|---|
| **TD-8 — no authentication** | No session, no user, no authorization anywhere. Every command needs an actor. This is a hard dependency of every write capability, and §11 makes it a decision rather than an obstacle. |
| **Eight declared commands are unbuilt** | `BlockCase`, `CloseCase`, `WithdrawThesis`, `SupersedeThesisRevision`, `ReturnWork`, `ReopenCase`, `OverrideGovernanceBlock`, `ResolveException` |
| **Three routes are still mock** | `agents`, `portfolio`, `reports` render `~/data/mockData` |

---

## 1. Issue the first institutional act from Headquarters

**What a user can do afterwards.** Open an investment case — state the question,
name the owner, name the participating departments — and watch it appear in the
queue. Today no human can create a case at all.

**Why now rather than later.** Every other capability on this list is downstream
of a write path. Until one exists, Financial OS is a viewer for records only a
test suite can produce. This is also the smallest honest slice that proves the
whole path: a form, a mutation boundary, a command, a refusal surfaced to a
person, and a queue that updates.

**Dependencies that already exist.** All 17 commands registered and executable;
`runCommand` with its ledger, replay and rejection codes proven; the server-fn
boundary published and guarded; Headquarters to show the result. What is missing
is one mutation server function and an actor (§11).

**Scope.** Small-to-medium. One mutation boundary, one form, refusal rendering,
one route. No migration, no domain change.

**Strategic value.** Very high. It converts the institution from observable to
operable, and it establishes the pattern every later act reuses — including how
a refusal reaches a human, which is where a governance system earns or loses
trust.

**Institution or product.** **Product**, decisively. The institution already
exists; this makes it usable.

---

## 2. Operate the analysis workflow

**What a user can do afterwards.** Take a case from intake to decision-ready:
instantiate the playbook, propose a thesis, record contributions, aggregate a
manager's conclusion, submit for verification.

**Why now rather than later.** It is the bulk of what the institution does, and
without it §1 produces cases that immediately stall. But it is also five
commands with rich inputs, and doing it as one stage would be a large
infrastructure-shaped push with a single delivery at the end.

**Dependencies that already exist.** Every command, the playbook registry, the
requirement model, the claim and evidence model, the aggregation model.

**Scope.** **Large.** Realistically three or four stages. Each can end usable if
sliced by act rather than by layer.

**Strategic value.** High, and unavoidable eventually — but it is the middle of
the institution, and the middle is where a human operator adds least. This is
also precisely the work the agent roster in `services/investmentLetter/` is
specified to do.

**Institution or product.** Product, but with a real question attached: **how
much of this should a human ever do by hand?**

---

## 3. Decide from the CIO's desk

**What a user can do afterwards.** Open a case awaiting decision and act on it:
select, decline, defer with conditions, or return it with concerns. The most
senior act in the firm, performed by the person whose job it is.

**Why now rather than later.** Headquarters already shows a case sitting in
`decision` with "Fatta beslut eller återsänd" as its next act — and offers no
way to do it. That gap is visible on screen today. It is also the act where the
institution's guarantees are most valuable: mandate, dissent, acknowledgement,
supersession, and the reasons that survive.

**Dependencies that already exist.** `RecordCaseDecision`, `ReturnFromCioReview`
and `ReopenForReconsideration` are all built, registered and end-to-end verified.
The decision history renders. The eligibility basis is assembled and shown.

**Scope.** Medium. Three acts, each with a form; dissent and triggers are the
only complex inputs.

**Strategic value.** Very high. It closes the loop between what Headquarters
*shows* and what it *permits*, on the acts that matter most.

**Institution or product.** **Product.** No new institutional concept.

---

## 4. Publication — conclusions leave the building

**What a user can do afterwards.** Publish a decided case, moving it
`decided → published`.

**Why now rather than later.** Honestly: **it may not belong now.** It is the
last declared transition and completes the lifecycle table, which is an
architectural tidiness argument rather than a user-value one. Nothing consumes a
publication — there is no recipient, no document, no distribution. Publishing
into a system nobody reads is a state change, not a capability.

It becomes valuable the moment §5 exists, and would then be one stage with it.

**Dependencies that already exist.** The stage table declares it; decisions are
stored with rationale and dissent; the timeline renders acts.

**Scope.** Small on its own.

**Strategic value.** Low alone; **high combined with §5**.

**Institution or product.** Institution alone; product combined.

---

## 5. The decision memo — the artefact the firm produces

**What a user can do afterwards.** Generate the document a real firm sends: the
question, the thesis, the evidence, what governance found, what the CIO decided,
who dissented and how it was answered — as something a person can read outside
the application.

**Why now rather than later.** This is the first capability on this list whose
value is *external*. Everything else improves what happens inside Financial OS;
this is the thing the institution exists to produce. It is also the point where
the record's quality becomes visible: the memo is only as good as the reasons the
firm actually recorded, and it will expose any place where the institution has
been recording ceremony instead of substance.

`services/investmentLetter/` already contains a full product specification for
this — an 11-stage pipeline with a named roster — as a prototype.

**Dependencies that already exist.** The complete record: basis, verdicts,
challenges with materiality, decision, dissent with acknowledgement, triggers,
timeline. The read model assembles all of it already.

**Scope.** Medium. Rendering and export; no new domain concepts. **Deliberately
without agents** — the memo assembles what the institution recorded.

**Strategic value.** **Highest on this list, long-term.** It converts an
institutional record into a deliverable, and it makes publication mean something.

**Institution or product.** **Product.**

---

## 6. Identity — who is acting

**What a user can do afterwards.** Act as a named member of the firm, with
commands attributed to them and mandates enforced against their actual role.

**Why now rather than later.** Every write capability needs an actor, so this is
either solved properly or bypassed deliberately (§11). The mandate system is
already real — `chief-decision`, `thesis-owner`, `governance-verdict` — and
enforced against the seeded organization. It is currently enforced against an
actor the caller asserts.

**Dependencies that already exist.** `ActorSnapshot`, the organization model,
mandate checking, and the deliberate `authentication: 'system-asserted'` marker
that refuses to claim a check the runtime never made.

**Scope.** Small if it is operator identity selection; **large** if it is real
authentication with sessions and credentials.

**Strategic value.** High as an enabler, low as a visible capability. Under the
"usable when complete" principle it should ride along with §1 rather than being
its own stage.

**Institution or product.** Neither — it is a precondition, and should be scoped
as the smallest honest version of itself.

---

## 7. Portfolio as the consequence of decisions

**What a user can do afterwards.** See the firm's actual positions as the
consequence of its decisions — a selected thesis showing up as a held position,
with the case that justified it one click away.

**Why now rather than later.** `portfolio.tsx` renders mock data. Today the
firm's decisions and the firm's portfolio are two unrelated screens, which is a
strange thing for an investment institution. Connecting them makes a decision
consequential rather than archival.

**Dependencies that already exist.** Decisions with `selected` outcomes naming
exact revisions and implications; the market-data infrastructure with real
providers; the portfolio UI.

**Scope.** Large, and it needs a domain concept that does not exist: a
**position**, and the relationship between a decision and a holding. That is
genuinely new institutional modelling, not presentation.

**Strategic value.** High, but it opens a new domain rather than completing one.

**Institution.** New institutional modelling.

---

## 8. Evidence from real market data

**What a user can do afterwards.** Have claims cite real observations — a rate,
a print, a price — with provenance, rather than text typed by whoever recorded
the contribution.

**Why now rather than later.** The market-data layer is real, versioned, cached
and provider-backed. The evidence model already carries `observationRef` with
content hashing and canonical values. The two have never been connected.

**Dependencies that already exist.** Both sides, fully built and separately
verified.

**Scope.** Medium.

**Strategic value.** High for the *quality* of the institution's record —
verification means more when the observation can be re-fetched and compared.
Invisible to a user who is not already recording contributions, so it depends on
§2.

**Institution.**

---

## 9. Agents occupying the roles

**What a user can do afterwards.** Watch specialised agents do the work the
institution defines — the direction stated from the beginning: *build the
institution first, hire the staff afterwards.*

**Why now rather than later.** The institution is now proven, which was the
stated precondition. But every agent needs a human-operable path to exist first,
or there is no way to supervise, correct or override one. An agent that can act
where a human cannot is the wrong order.

**Dependencies that already exist.** `AgentRunRecord`, `startAgentRun`,
`failAgentRun`, the contribution provider boundary with its allow-list, the
11-agent roster specification, and the fitness rules that keep providers stubbed.

**Scope.** Very large, and gated by the standing constraint against LLM
integration.

**Strategic value.** Highest of all eventually. **Not next.**

**Institution and product both.**

---

## 10. What I would not do next, and why

- **Case filtering and search.** The firm holds a handful of cases. Real when
  there are hundreds.
- **TD-71 (queue query cost), TD-70 (validator threshold), TD-52, TD-53.**
  Recorded, reasoned, and correctly deferred. None blocks a user capability.
- **The remaining eight declared commands** (`BlockCase`, `WithdrawThesis`, …)
  as a batch. They are real institutional acts, but building them because the
  table lists them is exactly the "next in the transition table" reasoning to
  avoid. Each should arrive when a user needs it.

---

## 11. The decision this phase turns on

**Every write capability needs an actor, and there is no user.** Three options,
and this is a ruling rather than a recommendation:

| | What it means | Cost | Honesty |
|---|---|---|---|
| **(a) Operator identity** | One configured operator, acting as a named employee from the seeded organization; `authentication` stays `system-asserted` | Small | Honest if the record never claims otherwise — which the existing marker already ensures |
| **(b) Act-as selection** | The operator chooses which employee they are acting as, per act | Small | Honest, and exercises the mandate system properly — a desk cannot record a CIO decision |
| **(c) Real authentication** | Sessions, credentials, per-user authorization (TD-8) | Large | Required before any real deployment with private data |

**(c) is required eventually and should not be built now** — it is
infrastructure-only and would deliver no user capability. **(b) is the smallest
honest version**: it makes the mandate system genuinely load-bearing rather than
decorative, costs little, and does not pretend to be authentication.

---

## 12. Recommendation

Judged on long-term product value rather than convenience:

**First: §1 + §3 together, with §11(b) — "operate the CIO's desk".**

One stage, ending with a capability that is reachable, executable and visible:
open a case, and act on one awaiting decision. It is the smallest slice that
makes Financial OS an instrument rather than a display, it exercises the mandate
system, and it closes the gap Headquarters already shows on screen between what
the firm is waiting for and what a person can do about it.

**Second: §5 + §4 — "the decision memo, and publication".**

The firm produces its first external artefact, and publication acquires meaning
in the same stage rather than being a state change nobody consumes.

**Then §2, sliced by act** — and only as far as a human should reasonably go
by hand, because §9 is specified to do this work and the boundary between them
is a product decision worth making explicitly rather than by default.

**I would not choose publication alone**, despite it being next in the
transition table. It completes a diagram; it does not let anyone do anything.

---

## 13. What I need from you

1. **Which capability** — §1+§3, §5+§4, or something else entirely.
2. **The identity ruling** — §11 (a), (b) or (c).
3. **How far a human should operate the workflow by hand** (§2 vs §9), if you
   want that boundary set now rather than discovered.
