# Canonical values, version 1

**Status:** normative. **Applies to:** every identity-critical canonicalization
in Financial OS — evidence-set identity, observation content hashes,
command-envelope identity, write-once semantic keys, and any cache key intended
as an institutional identity.

This document defines the meaning. `src/domain/shared/canonicalValue.ts`
implements it. Where the two disagree, **this document is correct and the code
is a defect.**

An independent implementation written from this document alone must produce
byte-identical output. §10 gives vectors to check against.

---

## 1 · Why this exists

The previous mechanism was `JSON.stringify` with sorted object keys. Sorted keys
alone do not make a canonical format, and `JSON.stringify` is not one. Measured
against the implementation this replaces:

| Input | Produced | Consequence |
| --- | --- | --- |
| `null`, `NaN`, `Infinity`, `-Infinity`, `undefined` | `null` | a five-way collision |
| `new Date(...)` | `{}` | every date collided with every other |
| `-0` | `0` | collided with zero |
| `9007199254740993` | `9007199254740992` | silent precision loss |
| `1n` | `TypeError` | unhandled crash |
| `{a: undefined}` | `{}` | property dropped |
| `[1, undefined]` | `[1,null]` | the same value became `null` |

An observation whose value went from missing to `NaN` therefore hashed
identically and was reported as unrevised.

The rule that follows from this: **a value the format cannot represent exactly
is refused, never approximated.** An identity that quietly stands for two
different things is worse than an error, because nothing reports it.

---

## 2 · The value model

A canonical value is one of:

| Kind | |
| --- | --- |
| null | the null value |
| boolean | `true` or `false` |
| integer | a JavaScript number that is finite, a safe integer, and not `-0` |
| string | a sequence of Unicode scalar values |
| array | an ordered sequence of canonical values |
| object | an unordered set of string keys mapped to canonical values |

Nothing else is a canonical value.

### 2.1 What is refused

Refused at validation, before any encoding is attempted:

| Refused | Because |
| --- | --- |
| `undefined` | it is absence, and absence is expressed by omitting a key (§6) |
| `NaN`, `Infinity`, `-Infinity` | not representable; they collided with `null` |
| `-0` | it would collide with `0`, and no institutional quantity distinguishes them |
| non-integer numbers | binary floating point cannot preserve an authored decimal (§4) |
| unsafe integers | the value already lost information before arriving |
| `BigInt` | not yet supported; a later version may add it with an explicit tag |
| `Date` | serialized to `{}`, colliding with every other date; pass an ISO-8601 string |
| `Map`, `Set`, typed arrays | not yet supported |
| functions, symbols | not data |
| class instances | see §2.2 |
| sparse arrays | a hole is neither a value nor an absence the format can express |
| cyclic structures | no finite encoding exists |
| strings containing unpaired surrogates | not valid Unicode text (§5.3) |

### 2.2 Objects must be plain

An object's prototype must be `Object.prototype` or `null`.

Every own property must be a **data property** — not a getter or setter — and
must be **enumerable**. A non-enumerable own property would be silently omitted
by any key enumeration, so an object carrying one is refused rather than
partially encoded. Own **symbol** keys are refused for the same reason.

Restricting the prototype also disposes of inherited enumerable data:
`Object.prototype` has no enumerable properties, and a null prototype has none
at all.

**`toJSON` is never consulted.** A value carrying one is refused. A class
instance must not become canonical merely because it implements a convenient
serializer — that is precisely how an object of unknown shape acquires an
identity nobody specified.

### 2.3 Refusal is explicit

An invalid value produces a named error identifying what was wrong and where.
It must never collapse into `null`, `{}`, `0` or any other valid canonical
value.

Validation happens **before** a digest is produced, never after.

---

## 3 · Integers

```
i <decimal digits>
```

Base ten, ASCII digits, shortest form. No leading zeros except that zero is the
single digit `0`. No leading `+`. No exponent, separators or padding. A negative
integer carries a leading `-`; `-0` is refused (§2.1).

The accepted range is the IEEE-754 double safe-integer range,
−(2⁵³ − 1) to 2⁵³ − 1 inclusive. Outside it, distinct mathematical integers
share one double, so the value arriving is already not the value written.

Examples: `0` → `i0`; `-17` → `i-17`; `9007199254740991` → `i9007199254740991`.

---

## 4 · Decimals are strings

There is no decimal encoding. A non-integer quantity is carried as a **canonical
decimal string** and encoded as a string (§5).

This extends a ruling the codebase already made: migration 0019 stores
`expected_amount` as text, because a finding reading "expected 2.5, observed
2.50000000000000004" is a finding about IEEE-754, and a verifier who typed 2.5
must be recorded as having typed 2.5.

### 4.1 Canonical decimal form

Digits alone do not make a string a decimal. A canonical decimal matches:

```
-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?
```

and additionally carries at most **38 significant digits**.

| Rule | Valid | Invalid |
| --- | --- | --- |
| optional leading minus | `-2.5` | |
| no leading plus | | `+2.5` |
| no exponent | | `2.5e3`, `2E-1` |
| no unnecessary leading zeroes | `0`, `0.5`, `10` | `00`, `01`, `007` |
| no unnecessary trailing fractional zeroes | `2.5` | `2.50`, `2.500` |
| no trailing decimal point | `2` | `2.` |
| zero is exactly `0` | `0` | `0.0`, `-0`, `-0.0` |

`-0` is **refused, not normalized**. Silently rewriting a caller's value is how a
boundary stops being a boundary.

38 significant digits is the widest commonly-portable fixed-precision decimal.
It exceeds any quantity this system represents and keeps the encoding bounded.

### 4.2 One value, one identity

`2.500` and `2.5` are the same approved decimal value and must not produce two
institutional identities. Only the canonical spelling is accepted; the
non-canonical one is **refused at the boundary** rather than accepted and
rewritten, so a caller learns its value was not in canonical form.

**Where the exact authored representation matters it is stored separately** from
the canonical numeric value. They are two different facts: what the value is,
and how someone wrote it.

### 4.3 The approved conversion

A JavaScript number becomes a canonical decimal through exactly one function,
`canonicalDecimalFromNumber`. No caller may use `String(value)`, `toFixed` or a
template literal at the point of use: a dozen ad-hoc conversions is a dozen
chances to disagree, silently, about a value nobody reads directly.

It emits the shortest decimal that round-trips to the same double, so it **loses
nothing about the number it is given**. Whatever precision the source published
was lost earlier, when its decimal became a double — which is an argument for
carrying such quantities as strings from the source onward, and is out of scope
here.

Exponent notation is expanded, since canonical form has none: `1e21` becomes
`1000000000000000000000` and `1e-7` becomes `0.0000001`.

A magnitude requiring more than 38 digits is refused as `decimal-out-of-range`.
A double carries at most 17 significant digits, so only sheer magnitude can
breach the bound — `1.5e300` expands to 301 digits — and the refusal names
magnitude rather than blaming the fractional part.

### 4.4 What this is not

This is a representation, not an arithmetic system. Version 1 defines no
addition, comparison, rounding or scale coercion. A caller needing those brings
its own and converts to canonical form at the boundary.

---

## 5 · Strings

```
s <utf8ByteLength> : <utf8 bytes>
```

`<utf8ByteLength>` is the decimal count of UTF-8 bytes, formatted per §3. The
bytes follow the colon literally, with **no escaping of any kind**.

Escaping is unnecessary and therefore not performed: the length prefix states
exactly where the value ends, so no byte inside a value can be read as
structure. A value containing `:`, `s5:`, a quote, a newline or a NUL is encoded
as those bytes and read back as those bytes. This is what makes the encoding
injective, and injectivity is what a canonical form is for.

| Value | Encoding |
| --- | --- |
| `rev-1` | `s5:rev-1` |
| `` (empty) | `s0:` |
| `é` (U+00E9) | `s2:é` |
| `𝄞` (U+1D11E) | `s4:𝄞` |

### 5.1 No normalization

Strings are encoded as the exact scalar values supplied. **No Unicode
normalization is applied.**

Composed `é` (U+00E9, two bytes) and decomposed `é` (U+0065 U+0301, three bytes)
are different values with different identities.

This is deliberate. Normalizing alters authored content, and it would make two
distinct stored strings share an identity — so a change from one to the other
would go unnoticed. A canonical form for identity must preserve the distinctions
the store preserves, including ones that look the same on screen.

### 5.2 Astral characters

A scalar value above U+FFFF encodes as **one code point in four UTF-8 bytes**,
never as two three-byte sequences for its surrogate halves (which would be
CESU-8, not UTF-8).

### 5.3 Unpaired surrogates

A string containing a high surrogate not followed by a low one, or a low
surrogate not preceded by a high one, is **refused**.

Such a string is not valid Unicode text, has no valid UTF-8 encoding, and
PostgreSQL rejects it at the protocol level — so a value that reached an
identity would be one that could never be stored beside it.

### 5.4 Other characters carry no special meaning

Zero-width and bidirectional characters are ordinary data. They are preserved
exactly and affect the identity as any other character does.

This is a statement about **runtime data**. Invisible characters in **source**
remain forbidden by the `no-invisible-characters-in-source` fitness rule, which
is a separate concern with a separate rationale.

---

## 6 · Null, absent, and booleans

```
null     n
false    b0
true     b1
```

`null` is a value. **Absence is not.** A key that is absent from an object is
absent from the encoding; there is no token for it, and no object may contain a
key whose value is `undefined` (§2.1).

So `{}` and `{"a": null}` are different objects with different encodings, and
`{"a": undefined}` is not an object this format accepts — it is refused, not
silently reduced to `{}`.

Booleans use dedicated tags rather than `i0`/`i1`, so a boolean and an integer
can never share an encoding.

---

## 7 · Arrays

```
l <elementCount> : <encoded elements, concatenated>
```

`<elementCount>` is formatted per §3. Elements follow immediately, each
self-delimiting, with no separator.

- **Order is significant.** Arrays are sequences, not sets. A caller wanting set
  semantics sorts before calling and says so at the call site.
- **Duplicates are preserved.** Never deduplicated: a duplicate is either
  meaningful or a defect, and a format that removed it would hide the defect.
- **Elements may be `null`.**
- **Sparse arrays are refused.** A hole is neither a value nor an expressible
  absence.

---

## 8 · Objects

```
d <memberCount> : <encoded members, concatenated>
```

Each member is its key encoded as a string (§5) immediately followed by its
value. `<memberCount>` is the number of members, formatted per §3.

Binding the count as well as the members means a member lost or gained
disagrees with the object's own header — the two most likely corruptions are
each detectable twice.

### 8.1 Key ordering

Members are emitted in ascending **UTF-8 byte order** of their keys: compare the
UTF-8 encodings byte by byte as unsigned values, and treat a proper prefix as
smaller.

Equivalently, this is Unicode code-point order, and it is what PostgreSQL
`COLLATE "C"` gives on UTF-8 text.

**It must never be implemented with a locale-aware comparison.** The mechanism
this replaces used `String.prototype.localeCompare` with no locale argument,
which reads the host's default locale. Measured under Node's ICU, comparing the
keys `Id` and `id`:

| Locale | Result |
| --- | --- |
| `en`, `sv`, `lt`, `cs`, `et` | `Id` sorts after `id` |
| `tr`, `da` | `Id` sorts before `id` |

Two hosts would canonicalize the same value into different bytes.

> **Divergence to note.** `docs/eligibility-basis-canonicalization-v1.md` §6.8
> sorts by **UTF-16 code unit**. The two orders agree except where astral
> characters are involved. Both are specified and frozen; neither is a default.
> Nothing in this system may refer to "the" sort order as though one existed.

Duplicate keys cannot occur: object keys are unique by construction, and no
normalization is applied that could map two distinct keys onto one. A future
version introducing normalization must state its collision rule here.

---

## 8.2 Values a static type cannot prove

TypeScript will not accept an `interface` where an index signature is required:
`{ a: string }` declared as an interface is not assignable to
`Record<string, CanonicalValue>`, by a deliberate rule about declaration
merging. A domain record therefore cannot simply be passed to an identity
function even when every field it holds is canonical.

The wrong resolution is widening the boundary back to `unknown`. The right one
is `asCanonicalValue`, which **validates and throws**, then returns the narrowed
type. The boundary stays narrow; the conversion is named, visible and checked.

It is also the runtime trust boundary for everything the type system never saw:
parsed JSON, provider payloads, JavaScript callers, unsafe casts and rows
hydrated from the database. **The type system is not a runtime trust boundary**,
and a stored value is external data by the time it comes back.

## 9 · Hashing and domain separation

This document defines an **encoding**, not a digest. A caller producing a hash
from a canonical value must domain-separate it:

```
<domain tag> "|" <canonical encoding>
```

The domain tag identifies the purpose — evidence-set identity, command payload,
observation content — and includes the format version. Without it, two different
kinds of value that happen to encode identically produce one identity, and a
value computed for one purpose could be presented as another.

The tag must be a compile-time constant. **If it ever becomes variable it must
be length-prefixed like every other string**, because a bare separator between
two variable-length fields is exactly the ambiguity §5 exists to prevent.

The choice of hash is the caller's and is out of scope here. FNV-1a
(`stableHashHex`) identifies conveniently; SHA-256 attests content integrity.

---

## 10 · Golden vectors

Pinned by `src/domain/shared/canonicalValue.test.ts`.

| Value | Encoding |
| --- | --- |
| `null` | `n` |
| `true` | `b1` |
| `false` | `b0` |
| `0` | `i0` |
| `-17` | `i-17` |
| `""` | `s0:` |
| `"rev-1"` | `s5:rev-1` |
| `[]` | `l0:` |
| `[1, null, "a"]` | `l3:i1ns1:a` |
| `{}` | `d0:` |
| `{"a": null}` | `d1:s1:an` |
| `{"b": 1, "a": 2}` | `d2:s1:ai2s1:bi1` |
| `{"Id": 1, "id": 2}` | `d2:s2:Idi1s2:idi2` |
| `{"a": {"b": [true]}}` | `d1:s1:ad1:s1:bl1:b1` |

The `{"Id","id"}` vector is the locale test: `Id` precedes `id` because `I`
(0x49) precedes `i` (0x69) as a byte, under every locale and none.

---

## 11 · Changing this specification

Any change to §2 through §8 changes the encoding of existing values and is
therefore a **new version**, never an edit to version 1.

A new version requires: a new version constant; a reader that continues to
encode version-1 values under the version-1 rules in this document; and this
document preserved unchanged as the definition of version 1.

Identities already derived under version 1 are never recomputed. A stored
identity is a statement about a past derivation, and rewriting it would replace
a fact with an assertion.
