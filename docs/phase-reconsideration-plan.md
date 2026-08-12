# Planning gate — Reconsideration

**Status:** awaiting approval. Nothing implemented.

**Objective.** Close TD-50. A deferred case can return to the CIO, be decided,
and remain one continuous institutional history.

**The inconsistency being removed.** The firm *refuses* a deferral that names no
condition for ending the wait ([aggregateValidation.ts:401](../src/domain/analysis/aggregateValidation.ts#L401)),
stores those conditions, canonicalises them into the payload — and has no way to
act on them. It records an obligation it cannot fulfil.

**Governing principle for this stage.** A reconsidered case is the
**continuation of the same institutional history, not a new one**. The original
decision, the reasons for deferral, the triggers, and the eventual decision all
belong to one case history, and the timeline stays continuous.

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

## 5. Questions needing a ruling

### 5.1 Trigger lineage on a second deferral (TD-52)

If a reconsidered case is deferred **again**, its new triggers are today
independent records. Options:

- **(a) Restate freely.** Simplest; the second deferral names whatever
  conditions now apply. Continuity of *conditions* is lost, but continuity of
  *decisions* is preserved by supersession.
- **(b) `supersedesTriggerId`.** A new trigger may name the one it continues, so
  "this is the same condition, re-expressed" is distinguishable from "this is a
  new condition". Closes TD-52.

**Recommendation: (b), but as its own stage.** The continuity principle argues
for it, and it is a change to a stored, canonicalised structure — the same class
as the challenge-materiality work, and it deserves the same treatment rather
than being folded into this one. This stage would then be explicit that a second
deferral restates its conditions, and TD-52 stays open with the reason recorded.

### 5.2 Who may reopen

- **The CIO** — symmetrical with deferring; the office that chose to wait ends
  the wait.
- **The desk that owns the thesis** — the trigger fired in their domain and they
  are the ones watching it.

**Recommendation: the CIO (`chief-decision`).** Deferring is a governance act
and so is ending it; a desk that could reopen at will could put work back in
front of the CIO repeatedly. The desk's route stays what it already is — revise
the thesis, which produces a new revision and a normal submission.

### 5.3 Does reconsideration re-assess eligibility?

The original basis was assembled when the case was first submitted. A trigger
fired because the world changed.

- **(a) Re-assemble.** A fresh basis under the policy in force at reopening. The
  CIO decides on current facts.
- **(b) Reuse the stored basis.** The CIO decides on the same material, having
  only learned that a condition fired.

**Recommendation: (a), re-assemble.** Deciding on the original basis would
answer the question as it stood before the trigger fired, which is the question
the deferral already answered. Note the consequence, which is real: the fresh
basis may **fail** the gates, and the honest outcome is that reopening is
refused with the complete gate report — the case stays deferred until the work
is redone. That is the institution behaving correctly, but it should be an
explicit decision rather than a surprise.

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
- [ ] TD-50 closed; TD-52 restated with its reason
- [ ] Both suites green; typecheck clean

## 8. What this stage will not do

- No publication — the next milestone, deliberately after this loop closes
- No reopening of `decided` cases
- No trigger monitoring (TD-53); a human observes the trigger and reopens
- No `supersedesTriggerId` unless §5.1 is ruled otherwise
- No agents, no LLM
