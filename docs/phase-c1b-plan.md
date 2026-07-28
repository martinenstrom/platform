# Phase C1B — case and playbook commands

Planning gate. No implementation until approved.

Preceded by §0, the evaluation of the seven institutional-model additions, since
two of them land in C1B and the rest need a recorded home.

---

## 0. The seven additions — where each belongs

The rule applied throughout is the one this project has used since blockers:
**derive what can be derived, store only what cannot be recomputed.** A stored
judgement is a judgement that drifts from the rule that produced it, and a
stored projection is a second source of truth.

### 1. Case Timeline — application projection, **C1D**

Nothing new in the domain. The material already exists in three ordered
streams: `transition_events` (append-only, `occurredAt` then `eventId`),
`run_events`, and now `analysis.commands`.

The command ledger makes the timeline **better than it was**, because the two
streams answer different questions: commands say what was **asked** and by
whom; events say what **happened**. A timeline showing only events cannot
explain a refusal — a rejected command has no event, because nothing happened —
and refusals are exactly what a reader wants explained.

So: one projection merging three streams, in `application/analysis/timeline.ts`,
built in C1D beside the headquarters read model. **Not stored**, because it is
entirely recomputable and storing it would create a fourth stream that can
disagree with the three.

One domain-adjacent gap worth naming: significance (§5) is what makes a timeline
readable, and that is a rule, not data.

### 2. Command Reason — **domain and ledger, now, in C1B**

The one addition that must not wait. It is a column on an immutable table, so
adding it later means a migration plus a permanent population of commands with
no reason — the audit question "why was this issued" would then have a hole
shaped exactly like the period before someone thought of it.

The ledger is **empty in every environment**, so it costs one migration now and
nothing else.

Design, following the language the domain already uses — `transitionCase`
requires a reason for `returned` and `blocked`, `reviseThesis` requires one
always:

- `CommandEnvelope.reason?: string`, stored on `analysis.commands`
- a per-command `reasonPolicy: 'required' | 'optional'` declaration, enforced
  by `runCommand` in both directions exactly as `versionPolicy` is
- **required** for anything that reverses, blocks, refuses, overrides or
  supersedes; **optional** for ordinary forward motion

A reason is an institutional record like a decision's rationale, so it may be
stored. It must never reach a log line or a metric label, and the existing
discipline covers that.

### 3. Headquarters Metrics — **existing tables plus two domain rules**, C1D

Where each comes from, precisely:

| Metric                             | Source                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| active cases                       | `cases WHERE stage NOT IN ('published','withdrawn')` — the partial index exists |
| blocked cases                      | **two different things** — see below                                            |
| waiting for Verification           | `assignments` joined to governance departments, open statuses                   |
| waiting for CIO                    | **domain**: `evaluateRevisionEligibility`, never SQL                            |
| queue sizes                        | `assignments GROUP BY department_id, status` — read 5 of the snapshot           |
| average department processing time | aggregate over `assignments.created_at → completed_at` and `run_events`         |

Two things to be careful about.

**"Blocked" is ambiguous and must not be collapsed.** `cases.stage = 'blocked'`
is a recorded stage a person moved the case into. A revision blocked by
governance is _derived_ from reviews at evaluation time and may be true while
the case sits in `review`. Reporting one number called "blocked" would merge a
fact with a judgement. The snapshot should expose both, named differently.

**Average processing time is an operational metric, not an institutional one.**
It aggregates over all history, which is the one read in this list that grows
without bound. It belongs in a **separate, cacheable read** rather than in the
snapshot the floor renders on every load — otherwise the cheapest page acquires
the most expensive query.

Nothing new in the domain.

### 4. Command Categories — **declared, and cross-checked**, C1B

Worth having, with one guard.

Most of it is already implied by the mandate: `governance-verdict` ⇒ Governance,
`chief-decision` ⇒ Decision, `system-operation` ⇒ System. Only Analysis versus
Workflow is a genuine judgement, and both use `department-contribution`.

The risk of a second taxonomy is that it drifts from the first — a command
categorised Governance whose mandate is `any-employee` would be a lie in the
ledger. So:

- `CommandDefinition.category` is **required**, from a closed set of five
- a test asserts consistency: where the mandate implies a category, the
  declaration must match it
- stored on `analysis.commands`, in the same migration as the reason

Cheap, mechanically kept honest, and it makes "show me every governance action
on this case" one predicate instead of a list of command types that grows.

### 5. Activity Priority — **derived, never stored**, C1D

The domain rule is that events carry no prose and no judgement; the presentation
layer generates wording from structured facts. Priority is a judgement.

Storing it would freeze today's opinion of importance into history: change the
scheme and every past event is retroactively re-ranked, or worse, is not.

So: a pure function in the domain — `activitySignificance(event)` — over
`(subject, fromState, toState)` plus whether the event is a governance verdict
or a decision. One definition, used by the feed and by any future alerting, so
the two cannot disagree. **Nothing persisted.**

This is the same call as blockers, for the same reason.

### 6. Agent Presence — **partly now, partly never invented**, C1D and C2

The one with a real trap in it.

Coarse presence **is derivable** from state that already exists: an employee
with a run in `running` is busy; one whose assignment is `waiting` is waiting;
`blocked` is blocked; a governance employee with an open review assignment is
reviewing. `AgentRunRecord` carries `employeeId`, so the join exists.

Fine-grained presence — **Reading, Writing** — is not derivable from anything
stored, because nothing records sub-run progress. Deriving it would mean
inventing it, which is precisely the failure the living-organization vision
names: _the organization must feel alive, and no activity may appear that is not
backed by real state._

Recommendation: derive the coarse states in C1D as a domain projection. Treat
Reading and Writing as requiring the contribution provider to emit **real**
sub-states, which only a live provider can do — a C2 concern, and only if the
provider actually reports progress. If it does not, the headquarters shows four
honest states rather than six invented ones.

### 7. Case Health — **domain projection**, C1D

Belongs in the domain because it composes domain rules — `evaluateRevisionEligibility`,
`isOpen`, `blockingReason` — and putting it in presentation would put governance
logic in the UI. Derived, not stored, for the same reason as blockers.

The six states map onto existing facts, with one that needs defining:

| State         | Rule                                                          |
| ------------- | ------------------------------------------------------------- |
| Ready for CIO | at least one revision eligible for decision                   |
| Needs Review  | work submitted, governance assignments open                   |
| Waiting       | open assignments in `waiting`, with a `waitingOn`             |
| Blocked       | `stage = 'blocked'`, or every live revision blocked by a gate |
| **Critical**  | **needs a definition, or it becomes a colour**                |
| Healthy       | none of the above, and the case is progressing                |

Recommendation for Critical: **a governance function has actively refused** —
risk rejected, or verification `blocked` / `unresolved-discrepancy`. That is the
only state where the institution is saying _do not proceed_, as distinct from
_not yet_. Anything looser (overdue, stale, slow) is an operational signal and
belongs beside the processing-time metrics, not in institutional health.

### Summary

| #   | Addition               | Home                             | When     |
| --- | ---------------------- | -------------------------------- | -------- |
| 1   | Case Timeline          | application projection           | C1D      |
| 2   | **Command Reason**     | **envelope + ledger**            | **C1B**  |
| 3   | Headquarters Metrics   | existing tables + 2 domain rules | C1D      |
| 4   | **Command Categories** | **command definition + ledger**  | **C1B**  |
| 5   | Activity Priority      | domain function, derived         | C1D      |
| 6   | Agent Presence         | domain projection (coarse)       | C1D / C2 |
| 7   | Case Health            | domain projection                | C1D      |

Two land now because they are ledger columns. Five are projections and would be
premature before there is anything to project.

---

## 1. C1B scope

Three commands, plus the two ledger additions above.

| Command               | What it does                                                    |
| --------------------- | --------------------------------------------------------------- |
| `OpenInvestmentCase`  | Creates the case and its creation event                         |
| `InstantiatePlaybook` | Pins the version, creates every assignment, moves to `research` |
| `ProposeThesis`       | Revision 1 of a lineage                                         |

`ProposeThesis` is included because you listed it. Worth noting that in the
macro workflow the thesis is proposed by **Research Office aggregation**, which
is C1C — so C1B exercises it directly rather than through the flow it will
normally arrive by.

### On "opening the workflow is atomic"

Each command is atomic. The **two-command sequence is not**, and should not be:
`intake` is a legal resting state — the domain defines it as "received, not yet
assigned" — so a case created without its playbook is a case waiting to be
assigned, not a half-written one. The sequence is **resumable**, and
`InstantiatePlaybook` is idempotent on `(caseId, playbookEntryKey)`, so a retry
after a crash completes it rather than duplicating it.

Making them one command would hide the legal intermediate state and force the
playbook choice at intake, which a manager may legitimately defer.

---

## 2. Command contracts

Common: `commandId`, `correlationId`, `actor`, `initiator`, `occurredAt`, and
now `reason` where the policy requires it.

### OpenInvestmentCase

|                    |                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------- |
| **Input**          | `caseId`, `subject`, `question`, `ownerEmployeeId`, `participatingDepartmentIds`             |
| **Category**       | Workflow                                                                                     |
| **Mandate**        | `any-employee`                                                                               |
| **Version policy** | refuses                                                                                      |
| **Reason policy**  | optional                                                                                     |
| **Idempotency**    | `caseId`; `cases.create` is idempotent on it                                                 |
| **Transaction**    | case + participants + creation event                                                         |
| **Events**         | `subject=case, from=null, to=intake` — no actor required, since a creation is not a movement |
| **Prior state**    | the case does not exist                                                                      |
| **Rejects**        | unknown owner or department → `not-found`; owner not an employee → `not-found`               |
| **Retry**          | safe; returns the existing case                                                              |

### InstantiatePlaybook

|                    |                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Input**          | `caseId`, `playbookId`, `playbookVersion`, `expectedVersion`                                                                                                   |
| **Category**       | Workflow                                                                                                                                                       |
| **Mandate**        | `department-manager` of the case owner's department                                                                                                            |
| **Version policy** | **requires**                                                                                                                                                   |
| **Reason policy**  | optional                                                                                                                                                       |
| **Idempotency**    | `(caseId, playbookEntryKey)` per assignment; the case move is version-guarded                                                                                  |
| **Transaction**    | register playbook version, N assignments, participants, `intake → research`, one case event, one assignment event per entry                                    |
| **Prior state**    | `intake`, and no assignments for this playbook                                                                                                                 |
| **Rejects**        | `validatePlaybook` failure → `invariant-violated`; unknown department → `not-found`; wrong stage → `illegal-prior-state`; stale version → `aggregate-conflict` |
| **Retry**          | safe; existing assignments unchanged, version conflict on the second stage move                                                                                |

### ProposeThesis

|                    |                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| **Input**          | `caseId`, `thesisId`, `revisionId`, statement, position, invalidation criteria, horizon         |
| **Category**       | Analysis                                                                                        |
| **Mandate**        | `department-contribution` of the proposing department                                           |
| **Version policy** | refuses — a thesis does not move the case                                                       |
| **Reason policy**  | optional on revision 1 (required on `ReviseThesis`, C1C)                                        |
| **Idempotency**    | `revisionId`                                                                                    |
| **Transaction**    | revision + thesis event                                                                         |
| **Prior state**    | the revision does not exist; the case is not terminal                                           |
| **Rejects**        | no invalidation criteria → `invariant-violated` (a thesis that cannot be wrong is a preference) |

---

## 3. Required, optional and conditional

`PlaybookEntry.required` is a boolean today, and the approved macro workflow has
three levels: Risk Review is **conditionally required**.

**Decision D-C1B-1: replace the boolean with `requirement: 'required' |
'optional' | 'conditional'`.** A boolean cannot express three states, and
encoding the third as a second flag invites the two disagreeing.

The condition itself is **not evaluated at instantiation** — it depends on the
thesis position, which does not exist yet. So:

- a conditional entry **creates its assignment**, so the department sees it and
  the floor shows it
- the requirement level is **read from the playbook entry**, joined via
  `assignments.playbook_entry_key`, which Stage 2.1 made reachable
- **no new column on `assignments`.** Duplicating the level onto the assignment
  would let the two disagree after a playbook version change, and the entry key
  already identifies the entry exactly

At the gate (C1D), a conditional entry either produces a verdict or is recorded
as `not-required` — never omitted, so "risk did not review this" stays a fact
rather than a gap.

`validatePlaybook` gains one rule: **a required entry may not depend on an
optional or conditional one**, extending the check that already exists for
optional. An entry that may legitimately never complete cannot be a
prerequisite for one that must.

---

## 4. The macro playbook, as data

`macro-regime@1`, defined as a compiled-in constant in
`application/analysis/playbooks/macroRegime.ts` and **registered on first use**
by `InstantiatePlaybook`.

Registration is append-only — the runtime holds `SELECT, INSERT` and no
`UPDATE`, so a version a case has pinned can never change. Editing the playbook
means a new version, and cases in flight keep the one they started on.

| Entry              | Department        | Requirement | Depends on       |
| ------------------ | ----------------- | ----------- | ---------------- |
| `macro-analysis`   | `global-macro`    | required    | —                |
| `quant-validation` | `quant-technical` | optional    | `macro-analysis` |
| `aggregation`      | `research-office` | required    | `macro-analysis` |
| `verification`     | `verification`    | required    | `aggregation`    |
| `challenge`        | `devils-advocate` | required    | `aggregation`    |
| `risk-review`      | `risk`            | conditional | `aggregation`    |

Governance reviews depend on **aggregation**, not on the specialist
contributions — the dependency order you specified. Specialists produce evidence
and claims; Research Office produces the thesis revision; Verification and the
Devil's Advocate review **that exact revision**. Anything else would have
governance reviewing an argument the manager had not yet made.

---

## 5. Work-queue state

Already modelled: `workQueueFor` and `workloadFor` project a department's queue
from assignments, and `waitingChains` answers who is waiting on whom. C1B adds
nothing to the domain — it gives those projections something real to project.

One check C1B adds: after `InstantiatePlaybook`, every department named by the
playbook has a non-empty queue, and `waitingChains` is empty because nothing is
waiting yet.

---

## 6. Events

| Command             | Events                                                                          |
| ------------------- | ------------------------------------------------------------------------------- |
| OpenInvestmentCase  | case `null → intake`                                                            |
| InstantiatePlaybook | case `intake → research` (actor required); assignment `null → queued` per entry |
| ProposeThesis       | thesis `null → proposed`                                                        |

Every case **movement** carries an actor; a creation does not, because it is not
a movement — enforced by `buildTransitionEvent` and by migration 0012.
`causationId` links each assignment event to the case movement that created it,
so the timeline can show one command producing seven facts.

---

## 7. Migration 0014

Small: `reason text`, `category text` with a CHECK over the five values, on
`analysis.commands`. Both nullable-by-shape but enforced by the command layer,
because "required for this command type" is a command-contract rule and not a
column-level one.

The ledger is empty everywhere, so there is nothing to backfill — and the
migration says so rather than assuming it.

`COMMAND_CONTRACT_VERSION` goes to `2`: the envelope gained a field and the
declaration gained a policy, both of which change what a stored command means.

---

## 8. Tests

Per command: happy path, every rejection, retry, and the failure path. Plus:

- opening a case is atomic — a failure leaves no case and no participants
- instantiating is idempotent — a replay creates no second assignment
- the sequence is **resumable**: crash after `OpenInvestmentCase`, restart,
  instantiate, and the workflow is complete
- a conditional entry creates its assignment and is readable as conditional
- a required entry may not depend on an optional or conditional one
- a playbook version, once registered, cannot be changed
- the manager mandate: a specialist cannot instantiate a playbook
- the proposing department mandate on `ProposeThesis`
- reason required where declared, refused where not
- category consistent with mandate, where the mandate implies one
- restart durability across all three commands
- work queues and workloads reflect the created assignments

---

## 9. Decisions requiring approval

| #       | Decision                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------- |
| D-C1B-1 | `PlaybookEntry.required: boolean` → `requirement: 'required' \| 'optional' \| 'conditional'`        |
| D-C1B-2 | Requirement level read from the playbook entry, never copied onto the assignment                    |
| D-C1B-3 | Command reason: envelope field + per-command `reasonPolicy`, enforced both ways                     |
| D-C1B-4 | Command category: required declaration, cross-checked against the mandate                           |
| D-C1B-5 | `COMMAND_CONTRACT_VERSION` → `2`                                                                    |
| D-C1B-6 | The macro playbook is a compiled-in constant, registered append-only on first use                   |
| D-C1B-7 | `OpenInvestmentCase` and `InstantiatePlaybook` stay two commands; `intake` is a legal resting state |
| D-C1B-8 | A required entry may not depend on an optional or conditional one                                   |

---

## 10. Out of scope

No contribution, run, review, decision or revision command; no orchestrator
wiring; no headquarters read model; no UI; no LLM.
