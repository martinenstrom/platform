# TD-61 planning gate · deterministic canonical values

**Status:** decisions ratified. TD61-1 authorised; TD61-2 and TD61-3 await their
own approval.

**The debt as filed.** `canonicalJson` (`src/domain/analysis/identity.ts:106`)
orders object keys with `localeCompare` and no locale argument, so the ordering
is a property of the host rather than of the value.

**The debt as measured.** Locale sensitivity is real but currently inert. The
material defect is that `canonicalJson` accepts values whose JavaScript
serialization is lossy, ambiguous or invalid for institutional identity. It is
not a cryptographic weakness; it is a determinism and value-model weakness.

---

## 0 · What measurement established

Four things measured rather than assumed. They are why the scope below is the
value model rather than the comparator.

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

### 0.3 Nothing durable pins a derived identity

One hard-coded hex string exists in the tree (`observability.test.ts:48`, an
unrelated correlation id). No golden value, migration seed, fixture or document
pins a `canonicalJson`-derived id. With no retained production database, **the
identity migration cost is currently zero.**

### 0.4 The real defects are in value handling

| Input | Canonicalizes to | Consequence |
| --- | --- | --- |
| `null` | `null` | — |
| `NaN` | `null` | **collides with null** |
| `Infinity` / `-Infinity` | `null` | **collides with null** |
| `undefined` (top level) | `null` | **collides with null** |
| `-0` | `0` | collides with `0` |
| `new Date(...)` | `{}` | **every Date collides with every other** |
| `1n` (BigInt) | throws `TypeError` | unhandled crash path |
| `9007199254740993` | `9007199254740992` | silent precision loss |
| `1e21` | `1e+21` | format switches at a magnitude threshold |
| `{a: undefined, b: 1}` | `{"b":1}` | dropped |
| `[1, undefined, 2]` | `[1,null,2]` | **the same `undefined` becomes null** |

`observationRef(key, value: unknown)` hashes an arbitrary value into
`contentHash`, and `isRevisionOf` compares those hashes to decide whether an
observation was revised. So an observation whose value went from missing to
`NaN` reads as **unrevised**. All four production callers pass literals of
numbers and strings today; the signature permits all of the above.

**Recorded accurately, per the ruling:** current measured migration impact is
**zero**; the locale issue is **not** currently changing ids; the future
determinism risk is **real**.

---

## 1 · Number policy — ratified

Canonical values may represent a JavaScript number only when it is **finite, a
safe integer, and not negative zero**.

Refused: `NaN`, `Infinity`, `-Infinity`, `-0`, unsafe integers, fractional
numbers.

The reason is not formatting. A JavaScript number outside the safe-integer range
has **already lost information before canonicalization**, and binary
floating-point cannot preserve the exact institutional statement a person or
source supplied. The canonical layer must not pretend to recover precision that
was lost upstream.

Non-integer decimal quantities are represented as **canonical decimal strings**
before entering the canonical-value model. Monetary amounts, percentages, rates
and market prices with decimals use their approved decimal-string
representation.

- `2` may be a number
- `-17` may be a number
- `2.5` is the string `"2.5"`
- `9007199254740993` must not enter as a number

This extends a ruling the codebase already made. Migration 0019 stores
`expected_amount` as **text**, reasoning that a finding reading "expected 2.5,
observed 2.50000000000000004" is a finding about IEEE-754, and a verifier who
typed 2.5 must be recorded as having typed 2.5.

### 1.1 Canonical decimal contract — ratified

A decimal string is accepted only in canonical form. Digits alone do not make a
string a decimal.

| Rule | |
| --- | --- |
| leading minus | optional |
| leading plus | refused |
| exponent notation | refused |
| unnecessary leading zeroes | refused — `007`, `01` invalid; `0`, `0.5` valid |
| unnecessary trailing fractional zeroes | refused — `2.50` invalid, `2.5` valid |
| trailing decimal point | refused — `2.` invalid |
| zero | exactly `0` |
| negative zero | **refused**, not silently normalized |
| maximum significant digits | **38** |

`2.500` and `2.5` must not create two institutional identities for one approved
value, so the canonical form is normalized and the non-canonical spelling is
refused at the boundary rather than accepted and rewritten. **Where the exact
authored representation matters, it is stored separately from the canonical
numeric value** — the two are different facts.

38 significant digits is the widest commonly-portable fixed-precision decimal
(the `DECIMAL(38, n)` limit shared by several engines). It exceeds any financial
quantity this system represents while keeping the encoding bounded.

**No arbitrary-precision arithmetic is designed in TD-61.** This phase defines a
precise accepted *representation*, not operations on it.

## 2 · One strict format — ratified

One strict canonical-value format for every identity-critical use. **No weaker
variant for write-once semantic keys.** Two meanings of "canonical" would make
future call sites choose between them, and choose wrongly.

The same value model underpins evidence-set identity, observation content
hashes, command-envelope identity, write-once semantic keys, cache keys intended
as institutional identities, and every other production use in the inventory.

Domains may have their own typed builders before canonicalization; the final
value subset and byte encoding are one normative format. **A use that does not
need institutional-grade canonicalization must not call the identity helper for
convenience.**

## 3 · The canonical value type — ratified

A closed recursive type replaces `unknown` at identity-critical boundaries.

```ts
type CanonicalScalar = null | boolean | string | SafeCanonicalInteger
type CanonicalValue =
  | CanonicalScalar
  | readonly CanonicalValue[]
  | Readonly<Record<string, CanonicalValue>>
```

Refused, at runtime as well as in the type: `undefined`, `Date`, `BigInt`,
functions, symbols, class instances, `Map`, `Set`, typed arrays, non-finite
numbers, unsafe integers, fractional numbers, negative zero, sparse arrays,
inherited enumerable data, cyclic structures.

**Plain objects only.** A prototype must be `Object.prototype` or `null`.

**`toJSON` is never consulted.** A class instance must not become canonical
merely because it implements a convenient serializer.

## 4 · Comparator — ratified

**UTF-8 byte ordering**, applied to object keys. Independent of locale, ICU
version, host environment, browser language and database collation.

Chosen over UTF-16 code-unit ordering because the encoding is defined in UTF-8
bytes, so ordering by those same bytes means **the encoder sorts the very bytes
it emits**. It also equals Unicode code-point order and matches PostgreSQL
`COLLATE "C"` on UTF-8.

> **Divergence to record.** `basisCanonical.ts` (canonicalization v1, approved
> and frozen) sorts by **UTF-16 code unit**. The two agree on everything except
> astral characters, where code-unit order places surrogate pairs below
> U+E000–U+FFFF and byte order does not. Both are specified; neither is a
> default. A future basis canonicalization v2 should align, and until then no
> document may describe "the" sort order of this system as though there were one.

Locale tests under `en`, `sv`, `da`, `tr`, plus `lt`, `cs`, `et`. Today's 93 keys
are lowerCamelCase ASCII and produce no identity migration; the format must be
correct for future keys.

## 5 · Unicode policy — ratified

Strings are preserved exactly as supplied, encoded as UTF-8, with **no implicit
normalization** in version 1.

Visually identical NFC and NFD strings therefore have different identities. That
is acceptable only because it is documented and tested. Normalizing would alter
authored content and raise collision questions at validation boundaries.

**Unpaired surrogates are refused.** A string containing one is not valid
Unicode text, cannot round-trip through UTF-8 storage, and PostgreSQL rejects it
at the protocol level. Refusing is consistent with §3: an invalid value fails
rather than collapsing into a valid one.

Tested: ASCII, accented Latin, NFC versus NFD, astral characters, unpaired
surrogates, zero-width and bidirectional characters.

Invisible characters in **source** remain forbidden by the existing fitness
rule. Runtime **data** strings follow this policy, which is a separate matter.

## 6 · Null, absent and arrays — ratified

| Rule | |
| --- | --- |
| explicit `null` | a valid canonical value |
| absent object property | **not** the same as a property holding `null` |
| `undefined` | invalid everywhere |
| array order | significant |
| sparse arrays | invalid |
| array element `null` | valid |
| duplicate array values | preserved, never deduplicated |

An object property holding `undefined` is **refused, not dropped**. An array
containing `undefined` is **refused, not rewritten to `null`**. Both are places
the current implementation silently produces a valid-looking result.

## 7 · The normative specification — ratified

Written independently of the implementation, in the manner of
`docs/eligibility-basis-canonicalization-v1.md`: the specification defines the
meaning and the implementation conforms to it.

It defines: accepted value subset, object-key ordering, scalar tags, UTF-8
encoding, safe-integer formatting, string length binding, array length binding,
object member-count binding, null representation, boolean representation, the
absent/null distinction, duplicate behaviour, unsupported-value failure, cycle
detection, Unicode policy, and domain separation where hashes are produced.

**Raw `JSON.stringify` ceases to be the normative representation.**

### 7.1 Naming

The new encoder is `canonicalValueString`, in a new module. `canonicalJson`
keeps its name and behaviour until TD61-2 migrates its call sites, at which
point it is removed or narrowed to a stated non-identity role. **No mechanical
rename**; all 19 sites are reviewed individually.

## 8 · Contract versions — ratified, with one concern

**Domain contract advances 9 → 10 in TD61-2, not TD61-1.**

The governing rule, ratified:

> A contract version advances when externally meaningful domain behaviour
> changes, **not** when an unused implementation capability is added.

TD61-1 introduces the capability; TD61-2 activates the behaviour. Between them,
a TD58-1 build, a TD61-1 build and a TD61-2 build would otherwise all record
`'10'` while only the last produces different identities — one coordinate
describing two identity semantics, which is precisely the failure the
version-governance work exists to prevent.

| Stage | State | Contract |
| --- | --- | --- |
| TD61-1 | model, specification and tests exist; no production identity path uses them | **9** |
| TD61-2 | production identity paths migrate; `observationRef` narrows; invalid values are refused in production | **10** |

TD61-1 briefly advanced it to `'10'` and was corrected in a following scoped
commit rather than by rewriting history.

**Command contract stays at `'2'`. `PAYLOAD_CANONICALIZATION_VERSION` advances
`'1'` → `'2'` in TD61-2**, when `commandPayloadHash` actually changes format.

The evidence: `PAYLOAD_CANONICALIZATION_VERSION` exists precisely for this
("if canonicalization changes, two identical payloads could hash differently and
a replay would look like a conflict") and is **the first field inside the hash
input**, so a reader can already tell which canonicalization produced a given
hash. `COMMAND_CONTRACT_VERSION` covers the envelope, outcome vocabulary and
`expectedVersion` policy — none of which change.

Its doc comment currently also claims payload canonicalization as a trigger,
which double-counts what the finer constant owns and would have produced exactly
the ceremonial bump the ruling forbids. **That comment is corrected in TD61-2.**

## 9 · Usage inventory

| # | Site | Derives |
| --- | --- | --- |
| 1 | `identity.ts:118` `observationRef` | observation `contentHash` |
| 2 | `identity.ts:107` | recursion inside `canonicalJson` |
| 3 | `evidence.ts:126` `buildEvidenceSet` | evidence-set `id` |
| 4 | `requirements.ts:281` `requirementInputHash` | requirement input hash |
| 5 | `playbooks.ts:115` `playbookContentHash` | playbook content hash |
| 6 | `commands/envelope.ts:169` `commandPayloadHash` | command payload hash |
| 7 | `commands/eventIdentity.ts:56` | event identity |
| 8 | `writeOnce.ts` × 22 | write-once semantic keys |

`observationRef.id` comes from `serializeKey`, a fixed-field-order serializer —
**not** `canonicalJson` — and does not change.

TD61-2 records for each site: input type, current runtime values, whether numbers
can be fractional, whether external or untrusted values reach it, the derived
identity affected, whether a typed conversion is needed, and the expected
identity change. **Value shapes are inspected, not only key names** — in
particular market-data and policy-data values currently passed as fractional
numbers. Those callers convert through **a single approved conversion at the
domain boundary**, never by ad-hoc stringification at each caller.

## 10 · Identity migration

Measured migration cost for retained production data is **zero** (§0.3). Test
and fixture changes are still reported explicitly.

Inspected at TD61-2: evidence-set fixtures, command fixtures, recorded provider
fixtures, semantic-key test vectors, cache-key vectors, documentation examples,
golden snapshots. **If no values change, that is proven with before/after tests
over the current valid production subset**, not asserted.

Negative vectors prove the formerly ambiguous or lossy values are now refused:
`undefined`, `NaN`, `Infinity`, `-Infinity`, `-0`, fractional number, unsafe
integer, `Date`, `BigInt`, object with `toJSON`, sparse array, cyclic object.

## 11 · Relationship to basisCanonical.ts

**Kept separate.** It is approved, independently specified, versioned, protected
by golden byte vectors and tailored to `EligibilityBasis` semantics. It is not
folded into this format, and the two do not share a version number.

After TD-61: verify every evidence-set id bound into the manifest is generated
deterministically under the corrected rules. **Do not claim the manifest
recomputes evidence-set membership.** It does not.

The residual gap stays separate and is recorded as its own debt item — the
manifest binds stored evidence-set ids but does not prove their stored
membership still matches those ids. **TD-58 does not absorb it.**

## 12 · Stages

| Stage | Contents |
| --- | --- |
| **TD61-1** | canonical value type; deterministic comparator; normative encoding specification; runtime validator; golden vectors; locale tests; invalid-value tests. **Domain contract stays at 9.** No caller migration beyond what compilation requires. |
| **TD61-2** | all production call-site conversions; `observationRef.value` narrowing; exact decimal-string handling; evidence-set identity updates; semantic-key updates; command-identity assessment and `PAYLOAD_CANONICALIZATION_VERSION` 1 -> 2; **domain contract 9 -> 10**; fixture and golden updates with explanations. |
| **TD61-3** | before/after valid-subset identity proof; cross-locale tests; cross-runtime tests; malformed-input boundaries; provenance and version behaviour; documentation; TD-61 closure; residual evidence-membership debt recorded. |

Reported separately. Not combined into one commit.

## 13 · Out of scope

No migration 0022, no TD58-2, no `SubmitForCioDecision`, no LLM integration, no
Agents UI, no historical-data agents, no signal agents. No change to
`stableHashHex` — the hash is not the problem. No change to `serializeKey`.
