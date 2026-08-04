# TD-58 — a self-validating eligibility basis

**Planning gate. No implementation.**

Today a CIO submission stores its eligibility basis as child rows and nothing
else. Delete one and the submission hydrates as a smaller but internally valid
record — the repository cannot tell corruption from a legitimately smaller
basis, and the failure direction is the dangerous one: **less work appears to
have been required, so the submission looks more eligible than it was.**

This gate designs an immutable semantic witness that makes that detectable.

**Nothing else.** No `SubmitForCioDecision`, no decision commands, no LLM, no
Agents UI, no agents of any kind.

---

## 0 · Three findings before any design

### 0.1 `stableHashHex` is FNV-1a and must not be used for this

The project's existing hash helper says so itself:

> FNV-1a, 32-bit: **not cryptographic, and does not need to be.** It needs to be
> fast, stable across processes, and evenly distributed.

That is correct for what it was built for — deterministic log sampling, derived
record ids, content addresses where a collision is a bug rather than an attack.
It is **wrong for a tamper-evidence witness**, because FNV is trivially
collidable by construction: anyone able to delete a child row can craft a
substitute basis hashing to the same value, and the manifest would look
protective while protecting nothing.

**The manifest uses SHA-256.** `createHash('sha256')` is already in the tree
(`catalogHash`), so no new dependency. The algorithm is recorded in the stored
witness so it can be changed later without ambiguity.

### 0.2 What an in-band witness can and cannot detect

Worth stating plainly, because the gate's value depends on it.

**Detects:** an accidental `DELETE`, a partial restore, a migration that dropped
rows, an import tool that did not know about the child tables, a hand edit by
someone who did not also recompute the witness — that is, **corruption by anyone
uninformed about the manifest.** That is the realistic failure and the one TD-58
was opened for.

**Does not detect:** an informed actor with write access to `cio_submissions`
itself, who deletes a child *and* rewrites the manifest column. No witness
stored beside the data can survive that; it needs an out-of-band record —
append-only audit shipping, a signed log, WORM storage — which is a different
capability and not proposed here.

The plan will say this in the code and in the register. **A submission is
"self-validating against uninformed corruption", not "tamper-proof".**

### 0.3 The manifest protects storage, not capture

A manifest is computed from the basis the caller supplied. If the command
assembles a basis that was already wrong — missing work the firm actually
required — the manifest faithfully attests to the wrong thing.

TD-58 closes *"the stored basis is not what was stored"*. It does not close
*"the captured basis was not what was required"*, which is the command's job and
`validateSubmissionReferences`'s. Both matter; conflating them would let this
gate claim more than it delivers.

---

## 1 · Existing rows — none, mechanically

Checked rather than assumed, because it decides the migration strategy.

No database is configured anywhere: `.env` contains no database key, no
connection string appears in source, every PostgreSQL database is created
per-test by `createTestDatabase()` and dropped, and the embedded cluster runs
`persistent: false`.

**There are no retained non-test CIO submissions.** So migration 0022 can
require the witness `NOT NULL` on every row from the start, with an empty-table
guard proving it — the same discipline migration 0020 used. **No backfill, and
no manufacturing of manifests from current state**, which would be inventing a
point-in-time fact from present-day inputs.

If that ever stops being true, the guard fails the migration rather than
silently backfilling.

---

## 2 · The domain model

### 2.1 Where it lives

**On `EligibilityBasis`, as one field.** Not its own aggregate: a manifest with
an independent identity would be a second thing to keep in step with the basis,
and the whole point is that it cannot drift from it.

```ts
export interface BasisManifest {
  /** Which canonical shape produced the digest. Bumped when the shape changes. */
  canonicalizationVersion: string
  algorithm: 'sha256'
  digest: string
}

export interface EligibilityBasis {
  …existing fields…
  manifest: BasisManifest
}
```

### 2.2 The canonical input

Everything the manifest must bind, in a fixed shape. Ordering is defined for
every set-like collection, so the same basis in a different input order produces
the same digest and a materially different basis does not.

| Bound | Why |
| --- | --- |
| submission id · case id · exact revision id | cross-case and cross-revision substitution |
| eligibility policy version | which gate definition applied |
| manager aggregation id | the synthesis the revision came from |
| exact required-work identities — `(playbookEntryKey, runId)` pairs, sorted | the deletion TD-58 exists for |
| Verification review id, sequence, status | the verdict relied upon |
| Devil's Advocate review id, sequence, and its open challenge ids, sorted | which objections were open |
| Risk requirement resolution, review id, rule id, rule version | the three-state gate's answer |
| material disagreement `(claimId, materiality)` pairs, sorted | what was known and weighed |
| evidence set ids, sorted | what it rested on |
| `evaluatedAt` | when the projection ran |
| child-row **counts** per collection | a cheap second signal; a deletion changes both the set and the count |
| canonicalization version | so a shape change is never mistaken for corruption |

Deliberately **excluded**: `storageProvenanceId` and `blockers`. Provenance
describes the runtime that produced the projection, not the basis; blockers are
empty by invariant and carry no information.

`canonicalJson` (`domain/analysis/identity.ts`) already produces deterministic
key ordering and is reused; sorting of the set-like collections is explicit
rather than incidental.

### 2.3 Who builds it

**The domain.** `buildBasisManifest(basis)` is pure, and
`assertCioSubmissionWellFormed` gains a rule that a submission's manifest equals
the manifest of its own basis. **The repository never invents one** — it stores
what it is given and verifies what it reads, which is exactly the split
`validateSubmissionReferences` already uses.

---

## 3 · The schema — migration 0022

**Columns on `cio_submissions`**, not a table:

```
manifest_algorithm       text NOT NULL
manifest_canon_version   text NOT NULL
manifest_digest          text NOT NULL
```

Three columns rather than one JSON blob, for the reason C1D-1A removed the last
blob: a field inside a document is a field nothing can constrain. `CHECK`s pin
the algorithm to a known set and the digest to its expected length.

**Not stored:** the manifest input. Storing it would duplicate the child rows and
create a third thing to keep in step. The input is *reconstructed* from the
hydrated basis, which is what makes an added row detectable.

**Grants:** `SELECT, INSERT` only — the manifest is part of the write-once
record. No `UPDATE`, which means the runtime cannot rewrite a witness even if
the code tried.

**Database backstop:** none is possible. The database cannot recompute a domain
canonicalisation, and a trigger that tried would be a second implementation of
the rule. Recorded honestly, in the same terms as R6.

Clean and upgrade coverage, fingerprint inclusion, grant equivalence, no edits
to prior migrations — the C1D-1A.1 discipline, unchanged.

---

## 4 · Write and read

**Write:** validate eligibility and empty blockers → assemble the basis → build
the manifest → validate that the manifest matches the basis → persist root and
children **atomically** → return. Identical replay returns the original; the same
id with a changed basis *or* a changed witness raises `ConflictingRecordError`,
because `cioSubmissionSemanticKey` gains the digest.

**Read:** hydrate the complete basis → reconstruct the canonical input → recompute
→ compare with the stored digest → **`MalformedRowError`** on mismatch. Nothing
is normalised into agreement; a mismatch is a refusal, and the row is left
exactly as found.

A stored `canonicalizationVersion` this build does not know is a refusal too —
never a best-effort recomputation under a different shape.

**Query budget: unchanged.** The columns ride on the root read already issued and
the recomputation is CPU-only. `submissions.get` stays at 6, `save` at 7. If that
turns out false in measurement it is reported as an architecture change.

---

## 5 · Corruption matrix

Extending the approved four-way classification. Every **H** case creates the
malformed state first.

| Corruption | Category | Expected |
| --- | --- | --- |
| a required-work row deleted | **H** — *closes TD-58* | `MalformedRowError` |
| a disagreement, evidence or open-challenge row deleted | H | `MalformedRowError` |
| an extra required-work row inserted | H | `MalformedRowError` |
| a child row's identity changed | H | `MalformedRowError` |
| a review id changed on the root | H | `MalformedRowError` |
| policy version changed | H | `MalformedRowError` |
| `evaluatedAt` changed | H | `MalformedRowError` |
| digest rewritten to match tampered children | **not detectable** | §0.2 — recorded, not tested as a refusal |
| unknown canonicalization version | H | `MalformedRowError` |
| unknown algorithm | S | CHECK refuses |
| runtime attempts to update the digest | P | `StoragePermissionError` |

**Canonicalisation tests:** reordered children produce the *same* digest; a
missing child, an added child, a changed review id, a changed content hash, a
changed policy version, a changed revision, a changed case and a changed
canonicalisation version each produce a *different* one.

**Restart:** the witness survives exactly, verification runs on the reloaded
state, and a corruption introduced *between* runs is caught by the second
runtime.

---

## 6 · Contract versions and provenance

**Domain contract 8 → 9.** `EligibilityBasis` gains a required field; that is a
stored-shape change.

**Command contract stays at 2** — no envelope, category or mandate changes.

The manifest digest is **not** `queryCatalogHash` and the plan says so where both
appear: the catalogue hash describes what SQL a build can issue, the manifest
describes one captured institutional basis. Storage provenance, domain contract
version, canonicalisation version and algorithm are all preserved alongside.

---

## 7 · Staging

| Stage | Contents |
| --- | --- |
| **TD-58-A** | domain: `BasisManifest`, `buildBasisManifest`, canonicalisation, validator rule, fixtures, canonicalisation tests. No schema. |
| **TD-58-B** | migration 0022, mapping, write path, read verification, replay/conflict, clean and upgrade coverage |
| **TD-58-C** | corruption matrix, restart, parity, budgets, register closure |

Each committed and reported separately.

## 8 · Risks

**R26 — a witness that looks stronger than it is.** §0.2. *Mitigation:* the limit
is written in the code, the plan and the register, and no document will say
"tamper-proof".

**R27 — canonicalisation drift.** A refactor that reorders the canonical input
silently invalidates every stored digest. *Mitigation:* the version is stored and
checked; changing the shape without bumping it fails the tests, and a bumped
version refuses old rows rather than misreading them — which, with no retained
rows today, costs nothing.

**R28 — verification cost on every read.** One SHA-256 over a small object.
*Mitigation:* measured; the budget is statements, and this adds none.

## 9 · Technical debt

**Closes:** TD-58, at TD-58-C — against uninformed corruption, which is the
scope it was opened for.

**Opens:** possibly **TD-60** — out-of-band tamper evidence for the informed-actor
case (§0.2), if you want that gap tracked rather than merely documented.

**Unchanged:** TD-59, TD-57, TD-55, TD-52, R6 and the rest.

---

## 10 · Approved rulings, and two findings they surfaced

All four questions answered: SHA-256 confirmed, the honest limit confirmed,
TD-60 opened, domain contract 8 → 9, three stages.

**FNV identifies conveniently. SHA-256 attests content integrity.** Existing FNV
uses are reviewed per threat model, not replaced wholesale.

### 10.1 The domain may not import `node:crypto`

`importGraph.test.ts` forbids node builtins in `src/domain`, and
`hash.ts` says why in its own words: *"the domain layer must not depend on a
platform module, and this runs identically in Node and jsdom."*

So `createHash` cannot be reused there, and the ruling's suggested helper cannot
live where the manifest is built. Three options were considered:

1. put the helper in `application/` — but the ruling says the **domain** builds
   the manifest, so the canonicalisation would be split from its hash
2. inject a hasher as a port, like `Clock` and `Random` — the established
   pattern, but those are injected because they are *non-deterministic*; SHA-256
   is not, so injection buys no testability and costs plumbing at every call site
3. **a pure TypeScript SHA-256 in the domain** — no platform dependency, and the
   layering rule stands unweakened

**Taken: (3).** Verified against published NIST test vectors *and* cross-checked
against `node:crypto` in a test — the test layer may use builtins, so the
hand-written implementation is proven to agree with the platform's on every
input the suite generates. That cross-check is stronger evidence than either
alone.

### 10.2 `DOMAIN_CONTRACT_VERSION` had already drifted

The constant is **`'6'`**. The C1C-3 plan bumped it to 6; C1D-1A's plan said
"domain contract 7 → 8" and `eligibilityPolicy.ts` hard-codes `'8'` — but the
constant itself was never changed. Nothing caught it: the only assertion is that
memory and PostgreSQL report the *same* value as each other, which they did,
because both read the same drifted constant.

So provenance rows written during C1D-1A and C1D-1B recorded a domain contract
version that was wrong about the build. **No retained row is affected** — no
durable database exists (§1) — but the coordinate was untrue while it existed.

**TD58-1 sets it to `'9'` and documents the missing 7 and 8 entries.** The policy
registry's `'8'` is left alone: it records which contract version policy v1 was
authored under, which is a point-in-time fact and not something to re-derive.

---

## 11 · What was decided before TD-58-A

1. **SHA-256 rather than `stableHashHex`** (§0.1). It means two hash families in
   the codebase — FNV for identity and sampling, SHA-256 for evidence. I think
   that distinction is correct and worth the inconsistency; confirm.
2. **The honest limit** (§0.2) — an in-band witness cannot survive an informed
   actor. Confirm that TD-58 closes against *uninformed* corruption, and say
   whether you want TD-60 opened for the rest.
3. **Domain contract 8 → 9.** `EligibilityBasis` gains a required field.
4. **Three stages**, or fewer.

Everything else I am prepared to build as written.
