# Planning gate — challenge materiality in the eligibility basis

**Status:** awaiting approval. Nothing in this plan is implemented.

**Objective.** `evaluateEligibilityGates` must apply the firm's challenge
threshold rather than restate it. It currently fails on any open challenge,
which silently raised the bar above what `challengeBlocks` and
`EligibilityPolicy.challengeBlocksAtOrAbove` declare.

**Ruling being implemented.** `challengeBlocks` owns the policy. The gate
consumes it. The basis carries the fact — each open challenge's materiality —
and never a filtered subset, because a subset is a policy conclusion and the
basis stores facts.

---

## 1. Why the field must change

The gate receives the policy already. `EligibilityPolicy` has carried
`challengeBlocksAtOrAbove: 'material'` since v1. What it cannot do is apply it:

```
basis.devilsAdvocate.openChallengeIds: readonly string[]
```

Ids only. No materiality, and therefore nothing to compare a threshold against.

The correct shape is one field away in the same record. `materialDisagreements`
already carries `{ claimId, materiality }` and the gate already applies
`disagreementBlocksAtOrAbove` to it. Challenges get the identical treatment, so
the basis has one way of expressing "a concern of this weight is open" rather
than two.

**Rejected alternative — filter during assembly.** `assembleEligibilityBasis`
could store only the blocking challenges. This is refused on two grounds: it
puts policy in the collector, which the separation of responsibilities forbids;
and it discards the non-material open challenges, which `challengeBlocks` says
"do not disappear and are read by the CIO alongside the thesis". A basis that
dropped them would make the CIO's own record less complete than the firm's rule
requires.

---

## 2. Canonicalization changes

`canonicalBasisInput` element 11 (devil's advocate) currently emits:

```
list([ str(reviewId), int(sequence), int(count), list(sorted ids .map(str)) ])
```

It becomes:

```
list([ str(reviewId), int(sequence), int(count),
       list(sorted-by-challengeId .map(c => list([ str(c.challengeId),
                                                   str(c.materiality) ]))) ])
```

Decisions inside this encoding, stated so they are reviewable rather than
discovered later:

- **Ordering stays by `challengeId` alone**, UTF-16 code unit, unchanged from
  v1. Materiality is not part of the sort key: two challenges cannot share an
  id, so the key is already total, and sorting on a policy-relevant field would
  make the byte order shift when a materiality is corrected.
- **Each element is a nested list**, not a joined string. A `challengeId` may
  not contain the separator today, but a format whose safety depends on that
  is a format waiting for the first id that does.
- **Materiality is emitted as a string**, not an ordinal. The three values are
  a named domain, and an integer encoding would silently reinterpret every
  stored digest if the order of `DISAGREEMENT_MATERIALITIES` were ever edited.
- **The count stays.** It is redundant with the list length and was deliberate
  in v1 — a length-prefix that disagrees with its payload is detectable.

No other element changes. Elements 1–10 and 12–21 are byte-identical to v1.

---

## 3. Version changes

| Constant | From | To |
|---|---|---|
| `BASIS_CANONICALIZATION_VERSION` | `1` | `2` |
| `BASIS_DOMAIN_SEPARATION` | `financial-os:eligibility-basis:v1\|` | `…v2\|` |
| `manifest_canon_version` CHECK | `IN ('1')` | `IN ('2')` |

`DOMAIN_CONTRACT_VERSION`, `PAYLOAD_CANONICALIZATION_VERSION` and
`COMMAND_CONTRACT_VERSION` are **unchanged**. This is the basis format only; no
command payload, no ledger entry and no domain contract is affected.

### 3.1 The deviation from the specification's own change policy

§10 of `eligibility-basis-canonicalization-v1.md` requires that a new version
ship "a reader that continues to accept version 1 records and verify them under
the version-1 rules".

**This plan does not do that**, under an explicit ruling: no v1 record exists,
the table is empty, and permanent version dispatch would be legacy complexity
carried indefinitely for a format that never reached production.

This is a deliberate override of a written rule, so it is recorded as one
rather than quietly skipped. Two consequences follow, and both are in scope:

1. **§10 must be amended**, not left contradicting the code. A specification
   saying readers must accept v1 while the reader refuses it is worse than
   either policy alone.
2. **The empty-table guard is what makes the override true.** It is not
   defensive decoration — it is the evidence for the premise. If a v1 row
   exists, the premise is false and the migration must fail loudly rather than
   strand an unverifiable record.

---

## 4. Migration (0025)

Two changes to `analysis.submission_open_challenges`, plus the manifest CHECK.

```
-- 1. the guard that makes the version transition honest
--    Any existing row is a v1 basis whose digest this migration invalidates.
DO $$ … RAISE EXCEPTION IF EXISTS (SELECT 1 FROM analysis.cio_submissions) … $$;

-- 2. materiality becomes part of the stored fact
ALTER TABLE analysis.submission_open_challenges
    ADD COLUMN materiality text NOT NULL;
ALTER TABLE analysis.submission_open_challenges
    ADD CONSTRAINT submission_open_challenges_materiality_known
        CHECK (materiality IN ('non-material', 'material', 'decision-critical'));

-- 3. the manifest version the schema will accept
ALTER TABLE analysis.cio_submissions
    DROP CONSTRAINT cio_submissions_manifest_canon_version_known;
ALTER TABLE analysis.cio_submissions
    ADD CONSTRAINT cio_submissions_manifest_canon_version_known
        CHECK (manifest_canon_version IN ('2'));
```

`NOT NULL` with no default and no backfill: the guard has already established
the table is empty, so there is nothing to default and a default would be a
manufactured fact about a challenge nobody assessed.

Grants are unchanged — the column is added to a table `finos_app` already
holds `SELECT, INSERT` on.

Forward-only. 0020 and 0022 are not edited.

---

## 5. Specification updates

- **New document** `docs/eligibility-basis-canonicalization-v2.md`, the full
  specification. Not a diff against v1: a reader verifying a v2 digest must not
  have to reconstruct the format from two documents.
- **v1 preserved unchanged** as the definition of version 1, per its own §10.
- **v1 §10 amended** with the override above and a pointer to v2 — the single
  edit made to the v1 document, and made because leaving it would state a rule
  the codebase no longer follows.
- **§4.3 (element 11)** rewritten for the new encoding, with the four decisions
  from §2 above stated as decisions.
- **§9 golden vectors** regenerated (see below).
- `docs/technical-debt.md` — no new entry expected; this closes a divergence
  rather than deferring one.

---

## 6. Golden-vector regeneration

Two vectors are pinned by digest: `MINIMAL` and `POPULATED`
(`basisCanonical.test.ts`). Both change.

**Method — construction, not transcription.** Consistent with TD-61-3: the new
digests are produced by running the new canonicalizer over the corpus and
pinning the result, then verified by a second, independent path:

1. `POPULATED` gains at least one **non-material** and one **material** open
   challenge, so the vector exercises the distinction the version exists for.
   A vector whose challenges are all one materiality would pin the new format
   without pinning the change.
2. The pinned digest is checked against a hand-computed canonical byte string
   written out in the spec, so the constant and the specification are two
   independent statements that must agree.
3. `BASIS_DOMAIN_SEPARATION` is asserted to be exactly
   `financial-os:eligibility-basis:v2|` — the existing test at
   `basisCanonical.test.ts:112` pins v1 today and must fail until updated.

**A v1 digest is not carried forward as a regression fixture.** Under the
empty-table ruling there is no v1 record to protect, and a fixture asserting a
digest no reader will ever verify is a test that pins nothing real.

---

## 7. Implementation surface

| File | Change |
|---|---|
| `domain/analysis/decisions.ts` | `openChallengeIds` → `openChallenges` |
| `domain/analysis/basisCanonical.ts` | element 11; version constant |
| `domain/analysis/eligibilityGates.ts` | **apply `policy.challengeBlocksAtOrAbove`** |
| `domain/analysis/aggregateValidation.ts` | validate materiality per challenge |
| `domain/analysis/decisionFixtures.ts` | fixture shape |
| `application/analysis/assembleEligibilityBasis.ts` | carry materiality from `unresolvedChallenges` |
| `application/analysis/writeOnce.ts` | in-memory canonical string |
| `infrastructure/…/postgres/decisionMapping.ts` | read/write the new column |
| `infrastructure/…/decisionRepositoryContract.ts` | shared contract cases |
| `db/migrations/0025_…sql` | as above |
| 3 test files + spec docs | as above |

The one line that is the point of the stage:

```ts
// eligibilityGates.ts — was: openChallengeIds.length > 0
const blocking = basis.devilsAdvocate.openChallenges.filter((c) =>
  challengeBlocks(c.materiality, policy.challengeBlocksAtOrAbove),
)
```

`challengeBlocks` currently takes one argument and hardcodes `!== 'non-material'`.
It gains the threshold parameter, mirroring
`disagreementBlocksEligibility(materiality, threshold)`. **Its behaviour under
the v1 policy is unchanged**, and a test will assert that explicitly — this
stage must not move the firm's threshold while claiming to stop moving it.

---

## 8. Verification strategy

1. **The divergence, closed.** A non-material open challenge is eligible under
   both `challengeBlocks` and `evaluateEligibilityGates`. This is the assertion
   that could not be written before the stage and is its exit condition.
2. **The threshold is consumed, not restated.** A policy with
   `challengeBlocksAtOrAbove: 'decision-critical'` lets a *material* open
   challenge pass; a policy at `'material'` blocks it. Same basis, two policies,
   two verdicts — proving the gate reads the policy rather than agreeing with it
   by coincidence.
3. **`challengeBlocks` is unchanged under v1.** Every existing materiality maps
   to the same answer it gave before the parameter existed.
4. **Scenario D2 still passes untouched.** It is the scenario that exposed the
   divergence; if it needs editing, the fix is wrong.
5. **The end-to-end flow moves onto the disputed ground.** `cioDecision.pg.test.ts`
   currently uses a *resolved* challenge to avoid the contested case. It changes
   to a **non-material open** challenge, which is the state the whole stage is
   about, and reaches a decision.
6. **Round-trip through PostgreSQL** with deliberately distinguishable
   materialities — not all three the same value, so a column mix-up cannot pass.
7. **Migration tests**: clean apply, the empty-table guard firing on a planted
   row, the CHECK rejecting an unknown materiality, grants unchanged.
8. **Fitness rule**: nothing may reconstruct "blocking" from
   `openChallenges` outside the gate — verified by planting a violation and a
   near-miss that is selected, per the standing rule.

Both suites green, typecheck clean, at every commit boundary.

---

## 9. Exit criteria

- [ ] A non-material open challenge reaches the CIO; a material one does not
- [ ] The same basis under two policies produces two verdicts
- [ ] `challengeBlocks` gives identical answers under policy v1 as before
- [ ] Scenario D2 passes unedited
- [ ] The end-to-end flow decides with a non-material open challenge recorded
- [ ] `BASIS_CANONICALIZATION_VERSION === 2`; separator asserted; v1 golden
      digests gone, v2 pinned and independently derived
- [ ] Migration 0025 applies clean; guard fires on a planted row; CHECK holds
- [ ] v2 spec complete; v1 preserved; v1 §10 records the override
- [ ] Unit and PostgreSQL suites green; `manifest_canon_version` pinned to `'2'`
      in the schema-version tests

## 10. What this stage will not do

- No permanent v1 verification path (ruled)
- No change to any other version coordinate
- No agents, no LLM, no UI
- No new process controls without a concrete failure exposing the need
