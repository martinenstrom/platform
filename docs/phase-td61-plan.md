# TD-61 planning gate · deterministic canonical JSON

**Status:** plan only. Nothing implemented. Approval required before any code
changes.

**The debt.** `canonicalJson` (`src/domain/analysis/identity.ts:106`) orders
object keys with `localeCompare` and no locale argument, so the ordering is a
property of the host rather than of the value. Every derived identity that flows
through it — evidence-set ids, observation content hashes, command envelope
identity, event identity, playbook content hashes, requirement input hashes and
every write-once semantic key — inherits that host dependence.

**It is not a cryptographic weakness.** It is a determinism and cross-environment
identity weakness. The hash is fine; the bytes fed to it are not reproducible by
specification.

---

## 0 · What measurement already established

The plan below is shaped by four things I measured rather than assumed. They
change what the work is: the comparator is the smallest part of it.

### 0.1 The comparator swap breaks nothing today

Replacing `localeCompare` with code-unit comparison and running the full suite:
**1691 passed, 0 failed.** No test depends on locale ordering.

### 0.2 No current key set diverges

Static extraction of every object literal reaching `canonicalJson` — 19 call
sites, 16 with two or more keys, 93 distinct key names:

| Measure | Result |
| --- | --- |
| key sets where locales disagree with each other | **0** |
| key sets where locale order differs from code-unit order | **0** |
| key names that are not plain lowerCamelCase ASCII | **0** |

The remaining 11 call sites pass runtime values rather than literals; their keys
come from domain types whose members are also lowerCamelCase ASCII.

### 0.3 Nothing durable pins a derived identity

One hard-coded hex string exists in the tree
(`observability.test.ts:48`, an unrelated correlation-id fixture). No golden
value, migration seed, fixture or document pins a `canonicalJson`-derived id.
Combined with there being no retained production database, **the identity
migration cost is currently zero.** It will not stay zero.

### 0.4 The real defects are in value handling, not key ordering

This is the finding that should reframe the work. Measured against the current
implementation:

| Input | Canonicalizes to | Consequence |
| --- | --- | --- |
| `null` | `null` | — |
| `NaN` | `null` | **collides with null** |
| `Infinity` | `null` | **collides with null** |
| `-Infinity` | `null` | **collides with null** |
| `undefined` (top level) | `null` | **collides with null** |
| `-0` | `0` | collides with `0` |
| `new Date(...)` | `{}` | **every Date collides with every other Date** |
| `1n` (BigInt) | throws `TypeError` | unhandled crash path |
| `9007199254740993` | `9007199254740992` | silent precision loss |
| `1e21` | `1e+21` | format switches at a magnitude threshold |
| `{a: undefined, b: 1}` | `{"b":1}` | absent |
| `[1, undefined, 2]` | `[1,null,2]` | **the same `undefined` becomes null** |

`observationRef(key, value: unknown)` hashes an arbitrary value into
`contentHash`, and `isRevisionOf` reports "this observation was revised" by
comparing those hashes. So for market data:

> **An observation whose value went from missing to `NaN`, or from `NaN` to
> `Infinity`, is reported as unrevised.** A Date-valued field would make every
> observation's content hash identical.

All four production callers currently pass object literals of numbers and
strings, so none of this is live. The signature permits all of it.

**Conclusion for scoping:** fixing only the comparator would repay the debt as
written and leave the larger problem — that "canonical JSON" here is
`JSON.stringify` with sorted keys, and `JSON.stringify` is not a canonical
format — untouched. The user's instruction not to assume sorted keys alone make
a canonical format is exactly right, and §0.4 is the evidence.

---

## 1 · Usage inventory

Every production use, with what it derives and what property it actually needs.

| # | Site | Derives | Needs |
| --- | --- | --- | --- |
| 1 | `identity.ts:118` `observationRef` | observation `contentHash` | semantic canonicalization + hashing |
| 2 | `identity.ts:107` | recursion inside `canonicalJson` | — |
| 3 | `evidence.ts:126` `buildEvidenceSet` | evidence-set `id` | stable byte ordering + hashing |
| 4 | `requirements.ts:281` `requirementInputHash` | requirement input hash | semantic canonicalization + hashing |
| 5 | `playbooks.ts:115` `playbookContentHash` | playbook content hash | semantic canonicalization + hashing |
| 6 | `commands/envelope.ts:169` `commandPayloadHash` | command payload hash | semantic canonicalization + hashing |
| 7 | `commands/eventIdentity.ts:56` | event identity | semantic canonicalization + hashing |
| 8 | `writeOnce.ts` × 22 | write-once semantic keys | deterministic formatting only |

### 1.1 The classification matters

The plan's first substantive question is that last column, because the sites do
not all need the same thing:

- **Sites 1, 4, 5, 6, 7** feed a hash that becomes a stored identity. They need
  a fully specified canonical format — the §0.4 collisions are defects here.
- **Site 3** hashes an array of `[id, contentHash]` pairs. It has no object keys
  at all; it needs stable ordering of the array, which the caller controls.
- **Site 8** produces a comparison string that is never stored, only compared
  within one process during read-back. It needs determinism, not
  canonicalization — but it is compared against a value produced by *the same
  build*, so its requirements are weakest.

**Proposal:** do not give all three the same mechanism. A single
`canonicalJson` doing duty as both an identity format and a debug-comparable
string is part of how this drifted. See §5.

---

## 2 · Identity impact

Every derived identity that changes when the format changes. Because the format
change is larger than the comparator change (§0.4), this list is the same either
way: **all of them**, if any value in the input is affected.

| Identity | Where stored | Changes? |
| --- | --- | --- |
| observation `contentHash` | in-memory only today | yes, if values contain affected types |
| observation `id` | derived by `serializeKey`, **not** `canonicalJson` | **no** |
| evidence-set `id` | `analysis.evidence_sets` | yes |
| requirement input hash | `analysis.requirement_resolutions` | yes |
| playbook content hash | `analysis.case_playbooks` | yes |
| command payload hash | command ledger | yes |
| event identity | command ledger | yes |
| write-once semantic keys | not stored; computed and compared | not applicable |

**Note the exception.** `observationRef.id` comes from `serializeKey`, a
hand-written fixed-field-order serializer, not from `canonicalJson`. It is
already specified in the way this plan proposes for everything else — which is
both reassuring and a precedent to follow.

**Fixtures, goldens and seeds to inspect** — measured in §0.3 as currently
empty, to be re-checked at implementation time rather than trusted from this
plan: recorded fixtures, golden snapshots, migration seeds, command fixtures,
evidence-set fixtures, cached-result test vectors, documentation examples.

---

## 3 · The comparator

Replace `localeCompare` with an explicitly specified ordering.

**Proposal: UTF-16 code-unit order**, `a < b`, matching what
`basisCanonical.ts` already uses and what `COLLATE "C"` gives.

The alternative — code-point order — differs only for astral characters and
would need explicit implementation, since `<` gives code units. Object keys here
are identifiers; the case is theoretical. **But the decision must be stated
either way**, because "sorted" without saying by what is how this debt started.

Must not depend on: host locale, ICU version, process environment, browser
language, or database collation.

**Proof obligation.** A test asserting identical output under at least `en`,
`sv`, `da`, `tr` — the four named, `da` and `tr` being the two measured to
invert case comparisons — plus `lt`, `cs`, `et`. The test must set the locale
explicitly rather than trusting the runner's default, and must include a key
pair known to diverge (`Id` / `id`) so it cannot pass vacuously.

---

## 4 · The normative canonical format

To be written as a document in the manner of
`docs/eligibility-basis-canonicalization-v1.md`: **the specification defines the
meaning, the implementation conforms to it.** Versioned from 1.

Every question below must be answered explicitly. Where the answer is "this
value type is not supported", that is an answer, and it must be *enforced*
rather than documented.

| Question | Recommendation to be ratified |
| --- | --- |
| object-key ordering | UTF-16 code unit, ascending |
| array ordering | **positional, never sorted**; a caller wanting set semantics sorts before calling and says so |
| Unicode normalization | **none**, matching canonicalization v1 §6.10 — normalizing would erase a distinction the store preserves |
| escaping | to be specified exactly, or removed by length-prefixing |
| negative zero | **rejected**, or normalized to `0` with the collision stated |
| `NaN`, `±Infinity` | **rejected** — currently collide with `null` |
| integer formatting | shortest decimal, no exponent, no leading zeros |
| decimal formatting | **decimals not supported**; see §4.1 |
| `null` | distinct token |
| absent properties | distinct from `null`, and consistent between objects and arrays — today they are not |
| booleans | distinct tokens, never `0`/`1` |
| timestamps | strings, byte-for-byte as stored; never parsed or reformatted |
| unsupported types | `Date`, `BigInt`, `Map`, `Set`, `RegExp`, functions, symbols, class instances — **rejected at the boundary** |
| duplicate keys after normalization | not applicable while normalization is absent; must be stated so a future normalization cannot introduce it silently |

### 4.1 The number question is the hard one

Recommending "decimals not supported" needs justification, because
`observationRef` currently hashes yields and quote values, which are decimals.

Three options, to be decided at the gate:

1. **Reject non-integers.** Forces callers to carry money and rates as strings.
   Precedent exists and was deliberate: migration 0019 stores
   `expected_amount` as **text**, with the reasoning that a finding reading
   "expected 2.5, observed 2.50000000000000004" is a finding about IEEE-754, and
   a verifier who typed 2.5 must be recorded as having typed 2.5.
2. **Specify a canonical decimal form** — shortest round-trip representation,
   fixed exponent rules. Precise, and a substantial specification to write and
   test.
3. **Accept JavaScript's default number formatting and specify it as such.**
   Honest, but the specification then says "whatever this runtime prints", which
   fails the independent-reimplementation test that makes a canonical format
   worth having.

**Recommendation: option 1**, extending the ruling migration 0019 already made,
with option 2 available if a caller genuinely needs numeric values in a hashed
payload. Option 3 should be rejected — it is the current behaviour, and §0.4 is
what it produces.

### 4.2 The supported subset must be enforced, not described

Whatever subset is chosen, the encoder must **refuse** a value outside it rather
than silently produce something. Today `Date` produces `{}` and `BigInt` throws
an unhandled `TypeError`; both are the format having no opinion.

Enforcement should be a type-level restriction where possible and a runtime
refusal where not, matching how `basisCanonical.ts` refuses a non-integer.

---

## 5 · Implementation location and shape

Three questions for the gate.

**5.1 One mechanism or two?** §1.1 argues the write-once semantic keys need
something weaker than the identity format. Options: use the strict format
everywhere (simplest to reason about, most churn), or introduce a separate
comparison-string helper and stop calling the identity format for that purpose.
**Recommendation: one strict format**, because two formats is how a caller ends
up using the wrong one, and the churn is currently free (§0.3).

**5.2 Where does it live?** `identity.ts` is in `src/domain/analysis`, but
`canonicalJson` is used by `src/application` too. `basisCanonical.ts` sets a
precedent for a dedicated, fully specified encoder module.
**Recommendation:** a dedicated module beside it, so the specification, the
implementation and the golden vectors sit together.

**5.3 Does `basisCanonical.ts` fold into it?** **Recommendation: no.**
Canonicalization v1 is approved, specified, pinned by golden vectors and
deliberately independent of `canonicalJson`. Merging them would put the one
mechanism that is already correct at risk of a change made for another. They may
share primitives; they must not share a version number.

---

## 6 · Contract-version consequences

Changing derived identities changes what a stored record's id *means*, which is
the criterion `DOMAIN_CONTRACT_VERSION` exists for.

**Recommendation:** advance to `'10'` with a `DOMAIN_CONTRACT_HISTORY` entry, in
the same commit as the format change. To be ratified at the gate; the newly
added `domainContractVersion.test.ts` will require the decision to be made
explicitly rather than by omission.

---

## 7 · Staged implementation plan

Proposed. Each stage ends with a working tree, tests passing, and its own exit
report. No stage begins before the previous is approved.

| Stage | Contents |
| --- | --- |
| **TD61-1** | The normative specification document. No code. Ratifies §3, §4, §4.1, §5. |
| **TD61-2** | The encoder, its golden byte vectors, the locale-invariance proof across `en`/`sv`/`da`/`tr`/`lt`/`cs`/`et`, and the subset-enforcement refusals. Not yet wired to any caller. |
| **TD61-3** | Migrate call sites 1, 3–7 (the identity-bearing ones). Report every identity that changes, with a test that states why it changed rather than a silently updated golden. Contract version decision from §6. |
| **TD61-4** | Migrate the write-once semantic keys (site 8), or ratify leaving them, per §5.1. Remove `canonicalJson` or narrow it to a stated non-identity role. |

**Open questions for the gate**, which I should not decide alone:

1. §4.1 — the number question. This is the one with real consequences for
   market-data callers.
2. §5.1 — one mechanism or two.
3. §6 — contract version 10, or deferred to when a durable database exists.
4. Whether `observationRef`'s `value: unknown` should be narrowed to the
   supported subset at the signature, which is a breaking change to four
   callers, or validated at runtime.

---

## 8 · Relationship to TD-58

TD-58 resumes after TD-61 is resolved.

- **Canonicalization v1 is retained unchanged** unless TD-61 reveals a direct
  conflict. It does not use `canonicalJson` and is unaffected by any decision
  here.
- On resuming TD58-2, **verify that evidence-set identifiers bound into the
  manifest are themselves deterministically reproducible.** That is precisely
  what TD-61 makes true, and it is the reason for this ordering.
- **The honest statement stands either way:** the manifest binds stored
  evidence-set ids and does not independently recompute their membership. TD-61
  makes those ids reproducible; it does not make the manifest verify what a set
  contained.
- **If evidence-set membership integrity remains a gap after TD-61 — it will —
  it must be recorded as a distinct debt item.** TD-58 does not close it, and no
  document may imply otherwise.

---

## 9 · What this plan does not propose

- No change to `stableHashHex` / FNV-1a. The hash is not the problem.
- No change to `serializeKey`, which is already fixed-field-order and
  specification-shaped.
- No compatibility machinery for existing identities. §0.3 measured the cost as
  zero today, and the instruction is one clean correction now rather than
  machinery for identities nobody relies on.
- No migration 0022, no TD58-2, no `SubmitForCioDecision`, no LLM integration,
  no UI work, no agents.
