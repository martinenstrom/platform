# Planning gate — Reconsideration

**Status:** approved, with all open questions ruled. See §5.

**Objective.** Close TD-50. A deferred case can return to the CIO, be decided,
and remain one continuous institutional history.

**The inconsistency being removed.** The firm *refuses* a deferral that names no
condition for ending the wait ([aggregateValidation.ts:401](../src/domain/analysis/aggregateValidation.ts#L401)),
stores those conditions, canonicalises them into the payload — and has no way to
act on them. It records an obligation it cannot fulfil.

## Governing principles (ruled)

**1. A reconsidered case is the continuation of the same institutional history,
not a new one.** The original decision, the reasons for deferral, the triggers,
and the eventual decision all belong to one case history, and the timeline stays
continuous.

**2. Reconsideration inherits institutional history, but never institutional
judgement.** Facts may be reused. **Every governance conclusion must be produced
again from a newly assembled basis under the governing policy.** The previous
decision remains part of the record and contributes no implicit approval to the
new one.

The second principle is what makes reconsideration safe. A case that came back
carrying its old verdict would be a case the firm approved once and never
re-examined — and the trigger fired precisely because the world stopped matching
the assumptions that verdict rested on.

---

## 1. Two findings from measuring first

### 1.1 A defect the reconsideration path will hit

`recordCaseDecision.ts:205`:

```ts
const moves = !input.supersedesDecisionId && investmentCase.stage !== terminalStage
```

A superseding decision **never** moves the case. That is right for correcting a
`decided` case — the stage table has no `decided → decided`. It is **wrong for
reconsideration**: a case reopened to `decision`, decided with a decision that
supersedes the deferral, would stay in `decision` forever and never reach
`decided`.

The rule was written for the only supersession that existed. It should be the
honest predicate:

```ts
const moves = canTransition(investmentCase.stage, terminalStage)
```

which gives the same answer in the old case (`decided → decided` is not
permitted, so no move) and the right answer in the new one (`decision → decided`
is permitted). **This is in scope**: reconsideration cannot work without it, and
it is a correction rather than a new design.

### 1.2 The continuity principle promotes TD-52

TD-52 records that *"a superseding decision restates its conditions with new
ids… needs `supersedesTriggerId` if continuity is ever required."*

Continuity is now required, by ruling. It bites in exactly one case:
**defer → reconsider → defer again**. The second deferral needs its own
triggers, and the firm must be able to say whether they are the same conditions
continued or new ones. See §5.1 — this needs a ruling, not a default.

---

## 2. Shape: reopen, then decide

Two acts, not one, mirroring the pair the institution already proved:

```
deferred ──ReopenForReconsideration──► decision ──RecordCaseDecision──► decided
                                                                     └► deferred
```

**Why not a single `ReconsiderCase` command.** Asking for a decision and making
one are different authorities, and the firm has already drawn that line once
(`SubmitForCioDecision` versus `RecordCaseDecision`). Collapsing them here would
create a second shape for the same institutional pair and a path where a
decision is recorded by whoever asked for it.

`RecordCaseDecision` is then **reused unchanged** except for §1.1. The
reconsideration decision names the deferral as `supersedesDecisionId`, so:

- the deferral is marked superseded, not deleted
- `historyForCase` returns both, oldest first
- exactly one live decision exists at all times

**Only `deferred` may be reopened.** The stage table permits
`deferred → decision` and does not permit `decided → decision`. Reopening a
committed decision is a different act with different consequences, and this
stage does not build it.

---

## 3. What `ReopenForReconsideration` records

| Field | Why |
|---|---|
| `caseId` | the case returning |
| `deferredDecisionId` | the decision being reconsidered, named explicitly |
| `triggerIds` | **which conditions fired**, from that decision |
| `observedBasis` | what was observed, per trigger — free text with the trigger it answers |
| `authorizationBasis` | the mandate the actor acted under |

**Refusals**: the case is not `deferred`; the named decision is not the live one;
the named decision is not a deferral; a trigger id does not belong to it; no
trigger named; an unattributed actor.

**Naming the triggers is the point.** A reopening that cited nothing would be
"the CIO changed their mind", which is a legitimate act but a different one —
and would make the stored conditions decorative for a second time.

---

## 4. Continuity, concretely

Six things must hold, and each is an exit criterion:

1. **One case, one id.** No new case is created. Nothing is copied forward.
2. **The timeline is continuous.** `deferred → decision` and
   `decision → decided` append to the same event stream, so the whole
   history reads in one sequence.
3. **The deferral survives.** `historyForCase` returns the deferral *and* the
   later decision, in order, with the deferral marked superseded.
4. **The reasons survive.** The deferral's rationale and its triggers are still
   readable after reconsideration — nothing is rewritten.
5. **The reopening names its cause.** The triggers that fired are stored on the
   reopening, so "why did this come back" is answerable from the record.
6. **Headquarters shows one story.** The case page renders deferral,
   reopening and final decision as one history; the queue moves the case from
   settled back to outstanding without any new plumbing.

---

## 5. Rulings

All three questions from the first draft are settled. They are kept here with
their reasoning rather than deleted, so a later reader sees what was decided and
why rather than only what was built.

**5.0 Fresh basis, always.** Reconsideration assembles a new `EligibilityBasis`
and re-evaluates eligibility under the governing policy. If the new basis fails
the gates, **reopening is refused with the complete gate report and the case
stays deferred** until the work is redone. That is the institution behaving
correctly rather than trying to honour an earlier expectation.

**5.1 Trigger lineage stays TD-52.** Valuable, but a refinement of continuity
rather than a prerequisite for reconsideration. A second deferral restates its
conditions; TD-52 remains open with its reason recorded.

**5.2 Only the CIO may reopen** — `chief-decision`. Deferral and the decision to
end a deferral are both governance acts and stay under one authority.

### 5.3 What "re-run the governance process" means — stated, not assumed

The ruling says facts may be reused and every governance **conclusion** must be
produced again from a newly assembled basis. Two readings exist and they differ
enormously in cost, so this plan states which one it implements:

**Implemented reading.** The recorded governance *verdicts* — Verification,
Devil's Advocate, Risk — are **facts about a revision** and are reused. What is
produced again is the **conclusion drawn from them**: the basis is assembled
fresh, and eligibility is evaluated again under the governing policy, which may
be a different policy version with different thresholds than the one the
deferral was judged under.

**The alternative, not implemented.** Requiring *new* governance reviews before
a case may be reconsidered — Verification verifying again, and so on.

**Why the first.** Reviews are already scoped to an exact revision, and the
domain is explicit that an objection raised against revision 1 stays attached to
revision 1 and is never carried silently to revision 2. So a review is a
statement about a specific argument, and that statement has not stopped being
true. Where the *argument* needs to change, the desk revises the thesis — which
mints a new revision, reopens every gate, and requires new reviews through the
ordinary path. Reconsideration of the same revision reuses its reviews; revision
of the argument does not.

**The consequence to be aware of.** A revision reconsidered a year later is
decided on year-old governance verdicts, re-judged under today's policy. If that
is not what the firm intends, the rule to add is a staleness bound on reviews —
which is its own stage and is not assumed here.

---

## 5A. Questions already answered above

### 5.1 Trigger lineage on a second deferral (TD-52)

If a reconsidered case is deferred **again**, its new triggers are today
independent records. Options:

- **(a) Restate freely.** Simplest; the second deferral names whatever
  conditions now apply. Continuity of *conditions* is lost, but continuity of
  *decisions* is preserved by supersession.
- **(b) `supersedesTriggerId`.** A new trigger may name the one it continues, so
  "this is the same condition, re-expressed" is distinguishable from "this is a
  new condition". Closes TD-52.

**Ruled: (a) for this stage; (b) stays TD-52.** Trigger lineage is a refinement
of continuity rather than a prerequisite for reconsideration. It is also a
change to a stored, canonicalised structure — the same class as the
challenge-materiality work — and deserves that treatment rather than being
folded in here.

### 5.2 Who may reopen

- **The CIO** — symmetrical with deferring; the office that chose to wait ends
  the wait.
- **The desk that owns the thesis** — the trigger fired in their domain and they
  are the ones watching it.

**Ruled: the CIO (`chief-decision`).** Deferral and the decision to end a
deferral are both governance acts and stay under one authority. A desk that
could reopen at will could put work back in front of the CIO repeatedly. The
desk's route stays what it already is — revise the thesis, which produces a new
revision and a normal submission.

### 5.3 Does reconsideration re-assess eligibility?

The original basis was assembled when the case was first submitted. A trigger
fired because the world changed.

- **(a) Re-assemble.** A fresh basis under the policy in force at reopening. The
  CIO decides on current facts.
- **(b) Reuse the stored basis.** The CIO decides on the same material, having
  only learned that a condition fired.

**Ruled: (a), re-assemble, always.** Deciding on the original basis would answer
the question as it stood before the trigger fired — the question the deferral
already answered. The fresh basis may **fail** the gates, and the honest outcome
is that reopening is refused with the complete gate report and the case stays
deferred until the work is redone.

---

## 6. Verification strategy

1. **The whole loop, end to end, against PostgreSQL**: open → … → defer →
   trigger fires → reopen → decide → `decided`, in one case, across a restart.
2. **The supersession defect** (§1.1) has a test that fails on the current rule:
   a reconsideration decision that supersedes must still move the case.
3. **History is continuous**: `historyForCase` returns deferral then decision;
   the deferral is superseded, not absent; its rationale and triggers still read
   back unchanged.
4. **The timeline is one sequence**, with every case movement naming its actor.
5. **Refusals**: reopening a case that is not deferred; naming a decision that
   is not live; naming a trigger from a different decision; naming no trigger;
   an unattributed actor.
6. **`decided` cannot be reopened** — asserted, because it is the boundary this
   stage deliberately does not cross.
7. **Headquarters**: the queue moves the case out of settled; the case page
   renders deferral, reopening and decision as one history. Render tests against
   a fixture generated from a real reconsidered case.
8. **The existing gap test** asserting nothing performs `deferred → decision`
   must be *inverted*, not deleted — it becomes the assertion that exactly one
   command does.

## 7. Exit criteria

- [ ] A deferred case returns to the CIO and reaches `decided`
- [ ] The reopening names the triggers that fired
- [ ] The deferral survives, superseded, with its rationale and triggers intact
- [ ] One case, one id, one continuous timeline
- [ ] `moves` uses `canTransition`; a superseding decision still moves when the
      stage table permits it
- [ ] A `decided` case cannot be reopened
- [ ] Reopening is refused, with the gate report, when the fresh basis fails
- [ ] Headquarters shows the case as outstanding again, and the history as one
- [ ] The reopened case's basis is newly assembled, and its
      `eligibilityPolicyVersion` is the policy in force at reopening
- [ ] No gate verdict is carried over from the deferral
- [ ] TD-50 closed; TD-52 restated with its reason
- [ ] Both suites green; typecheck clean

## 8. What this stage will not do

- No publication — the next milestone, deliberately after this loop closes
- No reopening of `decided` cases
- No trigger monitoring (TD-53); a human observes the trigger and reopens
- No `supersedesTriggerId` — TD-52, ruled separate
- No staleness bound on reviews (§5.3) — its own stage if wanted
- No agents, no LLM
