# TD61-3C planning gate · observation content projection and fixture consistency

**Status:** approved and implemented. Rulings recorded in section 13.

**Purpose.** Make the observation content hash verifiable from stored data, and
fix the fixture inconsistency that attempting it exposed.

**Origin.** TD61-3B claimed the content projection could not be reconstructed
from the persisted payload and opened TD-64 on that basis. The claim was tested
and is **false** — the projection reconstructs exactly for every production
builder. TD-64 is retracted here, not completed.

---

## 0 · Inventory, measured

Taken from the repository rather than from the earlier report, because the
earlier report was wrong about this area once already.

### 0.1 Observation kinds and their builders

`ObservationKind` declares **eight** values. **Four** have production ref
builders; **four** have none.

| Kind | Ref builder | Evidence builder | Projection needed |
| --- | --- | --- | --- |
| `quote` | `quoteRef` | `quoteEvidence` | **yes** |
| `yield` | `yieldRef` | `yieldEvidence` | **yes** |
| `policy-state` | `policyStateRef` | `policyStateEvidence` | **yes** |
| `yield-curve` | `yieldCurveRef` | **none** | yes — see §0.2 |
| `fx-rate` | none | none | undefined |
| `series` | none | none | undefined |
| `news` | none | none | undefined |
| `sentiment` | none | none | undefined |

### 0.2 `yield-curve` is the odd one

It has a **ref builder but no evidence builder**, so nothing in production turns
one into a stored `EvidenceItem`. Its content is
`{ points: [[maturity, yieldPercent], …] }`.

The plan defines its projection anyway — a ref that exists can be stored by a
future caller, and defining it now costs one case — but records that no
production path currently exercises it.

### 0.3 The four kinds with no builder

An observation of these kinds cannot be minted by any sanctioned builder today.
§3 decides what verification does when one appears; that decision is the one
place this plan could quietly become a hole.

### 0.4 Call-site inventory

**48 `observationRef` call sites across 13 files.** One is the definition; four
are the production builders; the rest are fixtures and tests.

| File | Role |
| --- | --- |
| `application/analysis/evidenceRefs.ts` | the four production builders |
| `domain/analysis/identity.ts` | the definition |
| `domain/analysis/decisionFixtures.ts` | fixture |
| `domain/analysis/analysis.test.ts` | test |
| `domain/analysis/observationIdentity.test.ts` | test |
| `infrastructure/analysis/contributions.test.ts` | test |
| `infrastructure/analysis/immutability.test.ts` | test |
| `infrastructure/analysis/repositoryContract.ts` | shared contract |
| `infrastructure/analysis/postgres/adapter.pg.test.ts` | pg test |
| `infrastructure/analysis/postgres/queryCount.pg.test.ts` | pg test |
| `test/identityCorpus.ts`, `test/identityCorpus.test.ts` | golden corpus |
| `test/determinismProbe.test.ts` | determinism probe |

**`decisionFixtures.ts` and `queryCount.pg.test.ts` were not in the earlier
report.** The list in the instruction was explicitly not to be trusted as
complete; it was not.

### 0.5 The defect, concretely

`repositoryContract.ts` builds:

```ts
observationRef(
  { subjectKind: 'series', subject: 'US10Y', kind: 'yield', … },
  { value },                       // ← quote-shaped content
)
```

Declared kind `yield`; content shaped `{ value }`, which is the *quote*
projection's field. Nothing has ever checked that a declared kind matches its
payload, so this has been internally inconsistent since it was written and no
test could notice.

**This is an integrity defect in the fixtures, not a fixture-style problem.** It
is fixed, not worked around.

---

## 1 · The authoritative projection

One function, used by both the builder and the verifier. **No separate
construction and verification logic** — that duplication is the defect class
that already produced two disagreeing UTF-8 byte counters in this codebase.

```ts
observationContent(kind: ObservationKind, storedPayload: CanonicalValue): CanonicalValue | null
```

**Defined over the stored canonical payload**, not over the typed domain object.
That is the whole point: the payload is `canonicalPayload(x)`, whose numbers are
converted by exactly the rule the projection uses, so selecting fields from it
reproduces the hashed value byte for byte. A projection defined over
`MarketQuote` would be unreachable at hydration, where a row is JSON.

### 1.1 Projected fields, from production code

To be re-verified against the builders at implementation time rather than copied
from here.

| Kind | Projected fields | Source |
| --- | --- | --- |
| `quote` | `value`, `absoluteChange`, `percentageChange`, `previousClose` | `quoteRef` |
| `yield` | `yieldPercent`, `changeBasisPoints`, `observationDate` | `yieldRef` |
| `policy-state` | `level`, `effectiveDate`, `effectiveDateConfidence`, `change`, and `effectiveFedFundsRate` when present — nested under `regime` except the last | `policyStateRef` |
| `yield-curve` | `points`, as `[maturity, yieldPercent]` pairs | `yieldCurveRef` |

**Deliberately excluded, and the exclusion is load-bearing:** `receivedAt`,
`ageMs`, and every other transport or freshness field. `isRevisionOf` compares
content hashes, so widening the projection to the whole payload would report a
revision on every refetch. §6 tests that this does not regress.

### 1.2 Present keys, not defaulted keys

The projection selects fields that are **present**. An absent field is absent
from the projection rather than defaulted to `null`, because `null` and absent
are different canonical values and inventing one would make the projection
disagree with the value the hash was taken over.

This does not weaken detection: deleting a stored field changes the projection,
so it changes the hash, so it is refused.

---

## 2 · Verification

For every `EvidenceItem`, **before** it can contribute to an evidence-set id:

1. validate the stored payload as a `CanonicalValue`;
2. derive the expected projection from the declared kind and that payload;
3. recompute the observation id from the natural key;
4. recompute the content hash from the projection;
5. compare both against the stored `ObservationRef`;
6. refuse any mismatch;
7. only then admit the item to set construction.

Ordering is the point. An unverified item must not shape an id the set then
attests, and **no partially trusted `EvidenceSet` is ever returned**.

### 2.1 Two boundaries, two errors

| Boundary | Condition | Error |
| --- | --- | --- |
| construction, before persistence | a caller built an inconsistent item | a bounded **domain** error |
| hydration, from storage | a stored row is inconsistent | `MalformedRowError` |

`mapping.ts`'s `build()` already converts a thrown domain error into
`MalformedRowError`, so one throw site yields both — but the plan states them
separately because they mean different things and a reader should not have to
derive that from a wrapper.

### 2.2 Reason codes

Machine-readable, bounded, and carrying **no provider payload**. The error
identifies the observation kind, the projection rule that failed, and bounded
field or path information only.

Proposed: `observation-id-mismatch`, `observation-content-hash-mismatch`,
`observation-payload-not-canonical`, `observation-kind-payload-incompatible`,
`observation-projection-undefined`.

---

## 3 · Kinds with no defined projection — the decision to make

The one genuine hole this plan could leave. Four declared kinds have no builder
and therefore no projection, and some fixtures store payloads that are not
objects at all.

| Option | Behaviour | Cost |
| --- | --- | --- |
| **A — refuse** | an item whose kind has no projection is rejected | strictest; breaks any legitimate use of the four unbuilt kinds and several fixtures |
| **B — report unverifiable, admit** | verification returns a distinct code; the item is admitted | permissive; a kind added without a projection is silently unverified |
| **C — refuse, with an explicit allow-list** | the four unbuilt kinds are listed as knowingly unverifiable; anything else is refused | the decision is written down and a new kind fails closed |

**Recommendation: C.** B fails open, which is how this class of gap appears in
the first place; A refuses data the system legitimately models. C makes the
unverifiable set explicit and finite, and a kind added later must be added to a
list or be refused — which is the behaviour the fitness-rule work has repeatedly
chosen elsewhere.

**This needs ratifying at the gate**, because it decides whether TD61-3C closes
the gap or narrows it.

---

## 4 · Fixture migration

Mechanical, and **not** by updating expected hashes until tests pass. Every
fixture keeps its intended observation kind and gains a kind-consistent payload.

Search targets beyond §0.4: `EvidenceItem` literals, direct `ObservationRef`
literals, recorded contribution fixtures, PostgreSQL seed fixtures, and the
golden identity corpus.

Where practical the reference is derived through the approved builder rather
than paired by hand with an unrelated payload.

### 4.1 Fixture architecture

Typed helpers per kind, constructing payload, natural key, id, content hash and
`EvidenceItem` **together**:

`buildQuoteEvidenceFixture`, `buildYieldEvidenceFixture`,
`buildPolicyStateEvidenceFixture` — names to be settled in implementation.

**A generic helper taking `kind` + arbitrary payload + arbitrary ref is not
provided**, except deliberately for negative tests, where it is named to say so
(`buildInconsistentEvidenceFixture` or similar) and isolated to the corruption
suite. The goal is that an inconsistent combination is hard to express by
accident and obvious when written on purpose.

---

## 5 · Version impact — recommendation

| Coordinate | Recommendation |
| --- | --- |
| stored schema | **no migration.** Nothing new is persisted; the projection is reconstructed from what is already stored. |
| `PAYLOAD_CANONICALIZATION_VERSION` | **unchanged at `2`.** The encoding does not change. |
| `CANONICAL_VALUE_VERSION` | **unchanged at `1`.** Same reason. |
| `DOMAIN_CONTRACT_VERSION` | **unchanged at `10`** — see below. |

**The domain contract should not advance, and the argument is worth stating
because it could plausibly go the other way.**

The criterion is whether a change alters *what a stored record means*. TD61-3C
adds a refusal: kind/payload combinations that were accepted become rejected. It
does **not** change the identity of any consistent record — every production
builder was already consistent, so **no production identity moves**. A record
that was wrong before is still wrong; it is merely now detected.

The contrary view is that the set of valid domain values narrows, and that is a
contract change. If the reviewer takes that view, the answer is `10 → 11` with a
history entry. **No ceremonial bump either way** — this needs a ruling, not a
default.

**Fixture identities will change**, because fixture payloads change. That is
test data, not stored institutional data, and is reported rather than versioned.

---

## 6 · Corruption matrix

| Case | Expected |
| --- | --- |
| correct kind, unchanged payload | accepted |
| correct kind, reordered object keys | accepted |
| projected value changed, hash unchanged | **refused** |
| content hash changed, payload unchanged | **refused** |
| observation id changed | **refused** |
| declared kind changed, payload unchanged | **refused** |
| quote payload under `yield` kind | **refused** |
| yield payload under `quote` kind | **refused** |
| missing projected field | **refused** |
| extra non-projected field only | **accepted** — stated explicitly, see below |
| `receivedAt` / `ageMs` changed, projected content unchanged | **accepted, and no revision reported** |
| natural-key field changed | **refused**, id mismatch |
| non-canonical decimal representation | **refused** at the decimal boundary |
| malformed hydrated `CanonicalValue` | **refused** |

**"Extra non-projected field only → accepted"** is deliberate and is the same
property as the `receivedAt` row: the payload is wider than the projection by
design. Adding a field the projection ignores must not invent a revision.

The refetch-metadata case is the regression guard for §1.1. If someone widens
the content hash back to the whole payload, that row fails — which is the point
of writing it down.

Run against both adapters where the shared contract reaches, and with privileged
SQL corruption for the hydration cases.

---

## 7 · Identity semantics, documented

| Concept | Covers |
| --- | --- |
| observation **id** | the natural key — what the observation *is* |
| **content hash** | the curated, claim-relevant projection — what it *said* |
| stored **payload** | the complete canonical payload, from which the projection is reconstructible |

Verification proves that the payload **contains** the projection and that the
stored reference **matches** it. It does **not** redefine `contentHash` to cover
every payload field, and no document may say it does.

### 7.1 The corrected chain

```
stored CanonicalValue payload
  → kind-specific observation content projection
  → recomputed observation contentHash
  → verified ObservationRef
  → verified EvidenceItem
  → sorted [observationId, contentHash]
  → recomputed EvidenceSet id
```

Fields that intentionally do not affect the content hash are listed alongside
it. This replaces the incorrect §5.1 statement in
`docs/identity-architecture.md`.

---

## 8 · TD-64 retraction

**Retracted, not completed.** The record states:

- **original premise** — the projection was not reconstructible from storage;
- **evidence** — a mechanical test reconstructed it from the stored payload for
  `quoteEvidence`, `yieldEvidence` and `policyStateEvidence`, matching the
  stored content hash in all three;
- **conclusion** — the debt item rested on a false premise;
- **replacement** — TD61-3C.

**Historical documents are not rewritten as though the mistake was never made.**
A correction note is added where the wrong claim appears. The TD61-3B commit
message stands as written — it is history — and the durable documentation and
debt register carry the correction instead.

---

## 9 · Documentation corrections

- `docs/identity-architecture.md` §5.1 — the incorrect impossibility claim;
- `docs/identity-architecture.md` §5 — the chain, per §7.1;
- the TD61-3B phase record;
- the technical-debt register — TD-64;
- code comments in `identity.ts` and `evidence.ts` asserting the projection
  cannot be recovered from storage.

Corrected wording states: the curated projection **is** reconstructible from the
canonical stored payload; verification was previously absent; fixtures revealed
undeclared kind/payload inconsistencies; and the projection remains narrower
than the full payload **by design**.

---

## 10 · Staging

| Stage | Contents |
| --- | --- |
| **TD61-3C-1** | the normative projection specification; `observationContent`; `verifyObservationRef`; domain verification tests; the corruption matrix; the §5 version ruling applied |
| **TD61-3C-2** | full fixture migration; repository and PostgreSQL contract restoration; identity corpus updates; documentation corrections; TD-64 retraction; full-suite verification |

Split because the fixture migration touches 13 files and both suites, and
TD61-3C-1 alone will leave fixtures failing.

**Consequence to accept before starting:** the tree is red between 3C-1 and
3C-2. The instruction says not to leave it red between stages, so the two must
land as **one commit** unless the reviewer prefers otherwise. My recommendation
is **one commit**, developed in the two phases above but committed once, green.

---

## 11 · Exit criteria

Every production observation kind has one authoritative projection; the
projection is reconstructible from the stored canonical payload; observation id
and content hash are both recomputed and verified; kind/payload mismatches are
refused; all fixtures are internally consistent; metadata-only refetch changes
produce no false revision; the full evidence-set chain passes; TD-64 is
retracted; incorrect documentation is corrected; unit and PostgreSQL suites
pass; typecheck passes; the working tree is clean; migration 0022 and TD58-2
have not begun.

---

## 12 · Questions for the gate

1. **§3** — kinds with no projection: refuse, report-unverifiable, or refuse
   with an explicit allow-list? Recommendation: allow-list.
2. **§5** — does adding a refusal for previously-accepted kind/payload
   combinations warrant `DOMAIN_CONTRACT_VERSION` `10 → 11`? Recommendation: no.
3. **§10** — one commit, or two with a red tree between? Recommendation: one.
4. **§0.2** — define a `yield-curve` projection now, given no production path
   stores one? Recommendation: yes, it is one case and a ref that exists can be
   stored.

---

## 13 · Rulings, and what implementation found

| Ruling | Outcome |
| --- | --- |
| unverifiable kinds: explicit allow-list | **the allow-list is empty.** Nothing declares `fx-rate`, `series`, `news` or `sentiment` as an observation, and no caller persists a `yield-curve`. An allow-list is for required current exceptions; none were required |
| unknown kinds fail closed | yes — a kind absent from the projection table is refused, whatever the union says |
| `yield-curve` classification | **option B**: the ref builder stays; stored evidence of that kind is refused. `yieldCurveRef` has zero callers, so nothing breaks and no half-capability is implied |
| visible trust state for unverifiable evidence | **not needed.** With an empty allow-list no unverifiable reference can enter a set, so there is no partly verified set to represent. Revisit the moment an entry is added |
| version bumps | **none.** No production identity moved; every production builder was already consistent |

### 13.1 Fixture migration, measured

**71 inconsistent fixtures across 13 files** — including `decisionFixtures.ts`
and `queryCount.pg.test.ts`, neither of which appeared in the original report.

The dominant shape was `kind: 'yield'` paired with `{ value }` — the quote
projection's field — or with `{ yieldPercent }` alone, a yield projection missing
two of its three fields. One fixture stored a bare string as its payload.
`identityCorpus.ts` itself carried a quote payload under a yield kind, and a
policy-state payload without its `regime` wrapper.

Typed fixture builders now exist per verifiable kind
(`src/test/evidenceFixtures.ts`), constructing payload, key, reference and item
together so the mismatch is not expressible. A deliberately inconsistent helper
remains for negative tests, named to say so.

Two corpus entries were re-pinned. The values were read from a failing run,
reviewed, and written back as literals — the corpus rule holds: **no test derives
the expectation it asserts.**

### 13.2 No legitimate production record was refused

The stated condition for reopening the version decision was a legitimate
production record accepted before and refused now. **None was found.** Every
refusal was a fixture that had never been internally consistent — the production
builders always produced matching kind/payload pairs, which is why no production
identity moved.
