# Eligibility-basis canonicalization, version 3

**Status:** normative. **Applies to:** `EligibilityBasisManifest` where
`canonicalizationVersion = 3` and `algorithm = "sha256"`.

This document defines the meaning. `src/domain/analysis/basisCanonical.ts`
implements it. Where the two disagree, **this document is correct and the code
is a defect.**

The test of that claim is concrete: an independent implementation, written from
this document alone by somebody who has never read the TypeScript, must produce
byte-identical canonical output and therefore an identical digest. Section 9
gives vectors to check against.

---

## 1. What the digest is for, and what it is not for

A CIO submission stores its eligibility basis as a root row plus child rows.
Delete one child row and the submission hydrates as a smaller but internally
valid record. Nothing in the schema distinguishes corruption from a legitimately
smaller basis, and the failure runs in the dangerous direction: **less work
appears to have been required, so the submission looks more eligible than it
was.** The manifest is what makes that detectable.

Two limits are part of the definition, not caveats attached to it.

**It is corruption-evident, not tamper-proof.** It catches a writer that changed
the data without recomputing the witness — an accidental `DELETE`, a partial
restore, a broken migration, an import that did not know about the child tables.
It does not survive an informed actor who edits a child row *and* rewrites the
digest. Nothing stored beside the data can. No document may describe this
mechanism as tamper-proof, cryptographically immutable, impossible to alter, or
proof against a privileged database administrator.

**It attests storage, not capture.** The digest is computed over the basis it is
given. If the basis was wrong when captured — missing work the firm actually
required — the manifest faithfully attests the wrong thing. This answers exactly
one question: *is the hydrated basis the exact basis that was persisted?*

---

## 2. The subject

The digest binds a basis to the submission and case it belongs to. Without that,
a basis lifted from one submission and stored under another would verify.

| Name | Type | Source |
| --- | --- | --- |
| `submissionId` | string | the submission's own id |
| `caseId` | string | the case the submission belongs to |

Both are supplied by the caller, not read from the basis. A repository verifying
a hydrated row must pass the ids **from the row it read**, not from the request
that asked for it.

---

## 3. What the manifest attests: the decision

The question was whether the manifest attests the complete stored submission
row, or only the substantive eligibility reasoning. Neither, exactly. The rule
is sharper than both, and it is decidable by inspection rather than by judgement:

> **The manifest attests the complete stored `EligibilityBasis` record, bound to
> its submission and case.**

Every declared member of the `EligibilityBasis` type is bound, except the two
listed in §5. The submission *envelope* — who submitted, when, under which case
version — is not part of the basis type and is not bound.

This line was chosen because it is mechanically checkable. A field added to
`EligibilityBasis` later must be classified as included or excluded, in writing,
or `src/test/basisFieldCoverage.test.ts` fails. A line drawn at "the substantive
reasoning" would be a matter of opinion at every future field, and the first
disagreement would be resolved by whoever was writing the code that day.

### 3.1 `storageProvenanceId` is included

`storageProvenanceId` is a declared member of `EligibilityBasis`
(`src/domain/analysis/decisions.ts`), stored on the submission root row, and
non-null. It is a content address over the adapter id, adapter version, build
id, query-catalogue hash, schema version, schema checksum and domain-contract
version that were in force when the record was written.

It is **metadata about how the basis was stored, not part of the eligibility
reasoning** — and it is bound anyway, because the rule above binds the stored
record rather than a subset of it judged to be substantive.

**Semantic comparison and integrity comparison are distinct operations.** They
answer different questions, use different inputs, and must never be conflated:

| Operation | Question | Input |
| --- | --- | --- |
| semantic comparison | is this the same analytical basis? | the basis fields, compared directly |
| integrity comparison | is this the same stored record? | the manifest digest |

A caller that uses the digest to answer the first question will get "no" for two
records that are analytically identical, and will be right about the wrong
thing.

The consequences are intentional and must be stated wherever they matter:

1. **An identical analytical basis written under different storage provenance
   produces a different digest.** This is intended.
2. **Cross-runtime semantic comparison must compare the basis fields directly.**
   Comparing manifest digests answers "is this the same stored record", never
   "is this the same reasoning". Two runtimes reaching the same conclusion are
   expected to disagree on the digest.
3. **A migration must preserve the original `storageProvenanceId`** and carry the
   original digest forward unchanged. Recomputing a historical manifest under
   the migrating runtime's provenance would produce a witness that attests the
   migration rather than the original write, which is worse than no witness: it
   would verify, and it would be verifying the wrong claim.

   **A historical manifest is never recomputed merely because the record moved
   to another backend.** Moving a row is not rewriting it. A record that arrives
   in a new store carrying provenance naming the old one is correct — that is
   what actually wrote it. A migration that "fixes" the provenance to name
   itself has destroyed the only evidence of where the record came from and
   replaced a fact with an assertion.
4. **If storage provenance is superseded or corrected, the manifest is not
   recomputed.** The provenance row records what wrote the record; a correction
   to that row is a change to a historical fact, and the digest is supposed to
   notice it. A verification failure here is the mechanism working. Resolving it
   is an operational decision requiring a human, not an automatic rewrite.
5. **Semantic replay across storage backends is not available through the
   digest.** It was not available before this decision either:
   `cioSubmissionSemanticKey` (`src/application/analysis/writeOnce.ts`) already
   includes `storageProvenanceId`, so two backends already produced different
   semantic keys for the same reasoning. Idempotent replay across deployments is
   the command ledger's responsibility, keyed on the command, not the
   submission's identity.

**This interpretation is fixed.** The digest must not mean "the stored record"
in one context and "the substantive reasoning" in another.

---

## 4. The canonical input, field by field

The canonical input is a single **list** (§6.6) of exactly **23 elements**, in
the order below. No element is optional; a field with no value is encoded as
`null` (§6.3), never omitted.

Field order is fixed by this table. It is **not** derived by sorting keys, so no
comparator is involved and no locale can affect it.

| # | Element | Encoding | Source |
| --- | --- | --- | --- |
| 1 | canonicalization version | integer `3` | this specification |
| 2 | submission id | string | subject |
| 3 | case id | string | subject |
| 4 | thesis id | string | `basis.thesisId` |
| 5 | revision id | string | `basis.revisionId` |
| 6 | eligibility policy version | string | `basis.eligibilityPolicyVersion` |
| 7 | evaluated at | string | `basis.evaluatedAt` |
| 8 | aggregation id | string or null | `basis.aggregationId` |
| 9 | storage provenance id | string | `basis.storageProvenanceId` |
| 10 | verification | null, or list of 3 | `basis.verification` |
| 11 | devil's advocate | null, or list of 4 | `basis.devilsAdvocate` |
| 12 | peer-examination count | integer | `basis.peerScrutiny.length` |
| 13 | peer scrutiny | list of 6-element lists | `basis.peerScrutiny` |
| 14 | risk requirement | string | `basis.riskRequirement` |
| 15 | risk rule id | string or null | `basis.riskRuleId` |
| 16 | risk rule version | string or null | `basis.riskRuleVersion` |
| 17 | risk | null, or list of 3 | `basis.risk` |
| 18 | required-work count | integer | `basis.requiredWork.length` |
| 19 | required work | list of pairs | `basis.requiredWork` |
| 20 | disagreement count | integer | `basis.materialDisagreements.length` |
| 21 | material disagreements | list of pairs | `basis.materialDisagreements` |
| 22 | evidence-set count | integer | `basis.evidenceSetIds.length` |
| 23 | evidence-set ids | list of strings | `basis.evidenceSetIds` |

### 4.1 Element 1 — the version

The canonicalization version leads the input. A reader can dispatch on it after
consuming the first few bytes, without parsing the rest, which is what allows a
version-2 rendering to remain verifiable after version 3 exists.

It also makes cross-version collision impossible: a v2 rendering and a v3
rendering of the same basis differ in their first element even if every later
byte agrees.

### 4.2 Element 10 — verification

`null` when there is no verification review. Otherwise a list of exactly three
elements, in this order:

1. `reviewId` — string
2. `sequence` — integer
3. `status` — string, one of `verified`, `verified-with-qualifications`,
   `correction-required`, `unresolved-discrepancy`, `insufficient-evidence`,
   `blocked`

The status is encoded as its literal string, not as an ordinal. An ordinal would
silently change meaning if the union were ever reordered.

### 4.3 Element 11 - devil's advocate

`null` when there is no devil's-advocate review. Otherwise a list of exactly
four elements, in this order:

1. `reviewId` - string
2. `sequence` - integer
3. open-challenge count - integer
4. open challenges - list of two-element lists, sorted per §6.8

**This element is unchanged from version 2**, where it was the only element that
differed from version 1. Each open challenge is a nested list of exactly two
strings:

1. `challengeId` - string
2. `materiality` - string, one of `non-material`, `material`,
   `decision-critical`

The count is bound **in addition to** the list, and the same pattern appears at
elements 12/13, 18/19, 20/21 and 22/23. It is deliberate redundancy: a truncated or
extended collection disagrees with its own count, so the two most likely
corruptions of a child table - losing a row, gaining a row - are each detectable
by two independent parts of the input rather than one.

Challenge **status** is not encoded, because the basis does not carry one.
Membership *is* the status. A challenge that closed leaves the list, which
changes both the count and the list.

#### Why materiality is here at all

Whether an open challenge **blocks** is a policy question, answered by
`evaluateEligibilityGates` from `EligibilityPolicy.challengeBlocksAtOrAbove`.
The basis carries the *weight the Devil's Advocate assigned*, which is a fact
about a past review, and never the conclusion drawn from it.

Version 1 carried ids alone. A gate given only ids cannot apply a threshold, so
it treated every open challenge as blocking - silently stricter than the policy
it was handed. The fix is a fact in the record, not a rule in the evaluator.

The same record already resolves this exact problem once, at element 23: a
disagreement carries its materiality and the gate applies
`disagreementBlocksAtOrAbove`. Challenges now match, and so does peer scrutiny
at element 13.

#### Four encoding decisions, stated as decisions

**Ordering is by `challengeId` alone**, per §6.8, exactly as in version 1.
Materiality is *not* part of the sort key. Ids are unique, so the key is already
total; sorting on materiality as well would move the byte order - and the digest
- when a materiality is corrected, which is a change to a fact, not to an order.

**Each challenge is a nested list, not a joined string.** A `challengeId` may
not contain a separator today. A format whose safety depends on that is a format
waiting for the first id that does.

**Materiality is a string, never an ordinal.** The three values are a named
domain. An integer encoding would silently reinterpret every stored digest if
the declaration order of `DISAGREEMENT_MATERIALITIES` were ever edited - a
source change with no visible relationship to any manifest.

**A materiality outside the domain is refused, not encoded.** The column carries
a CHECK and the PostgreSQL mapper rejects an unknown value as a malformed row.
A basis carrying a weight the firm does not define cannot be evaluated against
any threshold, so admitting one would produce a digest over a record no gate
can read.

### 4.4 Elements 12 and 13 — peer scrutiny

**This is the only pair of elements that differs from version 2.**

Element 12 is the number of examinations. Element 13 is the list of them, sorted
by `reviewId` per §6.8. Each examination is a nested list of exactly **six**
elements:

1. `reviewId` — string
2. `sequence` — integer
3. `byDepartmentId` — string, the desk that examined
4. `examinedDepartmentId` — string, the desk whose claims were examined
5. open-challenge count — integer
6. open challenges — list of two-element lists, sorted per §6.8, each
   `challengeId` then `materiality`

The inner challenge encoding is byte-identical to element 11's. It is the same
kind of fact recorded under a different mandate, and two spellings of one thing
would be two things a reader has to keep in agreement.

#### Why this is a list and not a flag

"Was this peer reviewed" is answerable by a boolean and useless. The question
the record has to answer is *which desk read the argument, and whose argument
did it read* — because a second opinion from a desk with no competence in the
subject is not a second opinion.

An **empty list is a fact the digest binds**, not an omission. A witness that
could not distinguish an unexamined revision from an examined one would leave
the most consequential edit of all — inserting an examination that never
happened — undetectable.

#### Why an examination with no objections is still an element

A desk that read the argument and had nothing to contest has examined it. A
revision nobody examined has no element at all. These are different facts about
the firm's process, and `PEER_SCRUTINY_ABSENT` reads exactly that difference.

Collapsing them would let silence satisfy the gate: an argument nobody
competent has read has no objections for the same reason an unopened letter has
no reply.

#### Why both department ids are bound

They are the answer to "who examined whom". A digest that omitted them would let
an examination be reattributed to a desk that never performed it while the
witness still verified — the record would name Rates as having read a macro
conclusion it never saw, and nothing would object.

The two are also constrained to differ, in the domain, in
`analysis.reviews`, and again in `analysis.submission_peer_examinations`. A desk
examining itself is the thing peer scrutiny exists to be an alternative to.

#### Why materiality travels here too

For the reason it travels at element 11, restated because it is the reason and
not a convention: whether a peer's objection **blocks** is a policy question. The
basis carries the weight the peer assigned, which is a fact about a past review,
and never the conclusion drawn from it.

Under the policies registered when this version shipped, `PEER_SCRUTINY_ABSENT`
passes on the **existence** of an examination and does not read these
materialities at all. They are bound anyway. A later policy that gives a peer's
objection blocking force must be able to be applied to bases already written,
and a record storing only what the current gate happens to read is a record that
has to be migrated the first time the firm changes its mind.

#### Ordering is by `reviewId` alone

Per §6.8, for the reason element 11 sorts by `challengeId` alone: review ids are
unique, so the key is already total. Sorting on the examining desk as well would
move the byte order when a department is renamed, which is a change to a name
and not to an order.

### 4.5 Element 17 — risk

`null` when there is no risk review. Otherwise a list of exactly three elements:

1. `reviewId` — string
2. `sequence` — integer
3. `status` — string, one of `accepted`, `accepted-with-limits`, `rejected`

Element 14, the risk *requirement*, is separate and is never null: it is one of
`unresolved`, `not-required`, `required`. A risk review that is absent because
none was required (`not-required`, element 17 null) is therefore distinguishable
from one absent because the requirement was never resolved (`unresolved`,
element 17 null).

### 4.6 Elements 19, 21, 23 — the collections

Each is a list whose elements are sorted per §6.8 **after** encoding.

- **Required work** (19): each element is a list of two strings —
  `playbookEntryKey`, then `runId`. The run id is the run/contribution identity;
  there is no separate contribution identifier in the basis.
- **Material disagreements** (21): each element is a list of two strings —
  `claimId`, then `materiality`. Materiality is one of `non-material`,
  `material`, `decision-critical`.
- **Evidence-set ids** (23): each element is a string.

---

## 5. What is excluded, and why

### 5.1 Fields of `EligibilityBasis` that are excluded

| Field | Reason |
| --- | --- |
| `manifest` | The witness cannot attest itself. A digest bound over a structure containing that digest has no fixed point. |
| `blockers` | Invariant rather than variable: a valid submission has none, and the repositories refuse one that does. Encoding a field that is always empty would imply it could differ, and would invite a reader to treat its absence as evidence rather than as a rule. |

These two, and only these two, may be absent from the canonical input. The
coverage test enumerates the type's members and fails if any other field is
unaccounted for.

### 5.2 Things named in review that are not in the basis at all

Listed explicitly, because "not encoded" and "does not exist" are different
answers and only one of them is a gap.

| Named | Disposition |
| --- | --- |
| challenge status | **Does not exist.** The basis carries `openChallengeIds`; membership is the status. See §4.3. |
| evidence observation ids | **Does not exist in the basis.** It carries `evidenceSetIds`. An evidence set is a content-addressed identity over its observations, so the stored id already stands for its membership. |
| evidence content hashes | **Does not exist in the basis**, for the same reason. See the caveat in §5.3. |
| actor snapshot fields | **Not part of the basis.** `submittedByDepartmentId`, `submittedByEmployeeId`, `submittedAt` and `caseVersion` are submission-envelope fields. They are covered by `cioSubmissionSemanticKey`, which is a different mechanism with a different job. |
| run / contribution identities | **Included**, as the `runId` half of each required-work pair (§4.5). |
| counts bound beside collections | **Included**, at elements 16, 18, 20 and inside element 11. See §4.3. |

### 5.3 The caveat on evidence-set ids

The manifest binds the evidence-set id **as the stored string**. It does not
re-derive the id from the set's contents, and it therefore does not detect a
change to an evidence set's membership that leaves its stored id unchanged.

That is a real limit of this version, and it is load-bearing for how far the
witness can be trusted: it attests *which sets the basis cited*, not *what those
sets contained*. Extending the witness through evidence-set contents is out of
scope for version 1 and would require the evidence set's own identity to be
reproducible, which TD-61 currently prevents.

---

## 6. The encoding

The canonical input is a byte string. Everything below defines those bytes
exactly.

### 6.1 Character encoding

**UTF-8**, throughout. Every length in the encoding counts UTF-8 **bytes**, never
UTF-16 code units and never code points.

### 6.2 Strings

```
s <byteLength> : <the UTF-8 bytes>
```

`<byteLength>` is the decimal count of UTF-8 bytes, per §6.5. The bytes follow
the colon literally, with **no escaping of any kind**.

Escaping is unnecessary and is therefore not performed: the length prefix
already tells a reader exactly where the value ends, so no byte inside a value
can be mistaken for structure. A value containing `s6:case-1`, a colon, a quote,
a newline or a NUL is encoded as those bytes and read back as those bytes.

This is the property that makes the encoding injective, and injectivity is what
a canonical form is for. A delimiter-joined encoding would let an id containing
the delimiter shift a field boundary, so that two different bases could render
identically and one could be substituted for the other under a valid digest.

Examples:

| Value | Encoding |
| --- | --- |
| `rev-1` | `s5:rev-1` |
| `` (empty) | `s0:` |
| `é` (U+00E9) | `s2:é` |
| `𝄞` (U+1D11E) | `s4:𝄞` |
| `a:b` | `s3:a:b` |

### 6.3 Null, and absence

```
null    n
absent  a
```

`null` and *absent* are distinct tokens and must never be interchanged.

Version 1 emits **`n` only**. Every field in §4 is always present, so `a` is
never produced by a conforming v1 encoder. The token is reserved so that a later
version can distinguish "the field exists and holds no value" from "the field
did not exist in the record" without renumbering anything.

`null` is also distinct from the empty string: `n` versus `s0:`. An
`aggregationId` that is null and one that is `""` produce different digests.

### 6.4 Booleans

```
false   b0
true    b1
```

No field in version 1 is a boolean. The encoding is defined so that a later
version cannot invent one ad hoc — and specifically so that nobody encodes a
boolean as `i0`/`i1` and collides with an integer field.

### 6.5 Integers

```
i <decimal digits>
```

Base ten, ASCII digits, shortest form. No leading zeros, except that zero itself
is the single digit `0`. No sign for non-negative values. No exponent, no
separators, no padding.

Negative integers are encoded with a leading `-`. No field in version 1 is ever
negative; sequences and counts are non-negative by construction.

**Only integers are encodable.** A non-integer number is a fault: the encoder
must refuse rather than round or truncate. There is no decimal or floating-point
encoding in version 1, deliberately — no field in the basis is a real number,
and a specification that defined one would be specifying a formatting rule that
nothing exercises and that would be wrong when first used.

### 6.6 Lists

```
l <elementCount> : <encoded elements, concatenated with no separator>
```

`<elementCount>` is the number of elements, per §6.5. Elements follow
immediately, each self-delimiting, with nothing between them.

Nesting is unrestricted; a list may contain lists.

### 6.7 Field ordering

**Positional, fixed by §4.** Fields are emitted in the specified order and are
identified by position, not by name. Field names appear nowhere in the output.

This is the reason there is no key-sorting rule: there are no keys. In
particular the encoding does not depend on JavaScript property insertion order,
on `Object.keys` ordering, on `JSON.stringify` behaviour, or on any comparator.

### 6.8 Ordering within set-like collections

The three collections at elements 17, 19, 21 and the challenge list inside
element 11 are **sets**: their storage order carries no meaning, and two records
differing only in child-row order are the same record.

They are sorted by this rule:

> Encode each element first. Then sort the resulting byte strings in ascending
> **lexicographic order by UTF-16 code unit**, comparing element by element and
> treating a proper prefix as smaller.

Three consequences, all intentional:

1. **The comparison is not locale-sensitive.** It is the ordering produced by
   `<` on JavaScript strings and by `COLLATE "C"` in PostgreSQL. It must never
   be implemented with a locale-aware collation: under a Swedish collation
   U+00E5 sorts after `z`, and elsewhere beside `a`, so a digest computed with
   one would depend on the machine that computed it.
2. **Composite elements sort by their encoded form, which begins with a length
   prefix — so they order by length before content.** The required-work pair for
   `macro-scan` encodes as `l2:s10:…` and the pair for `credit-check` as
   `l2:s12:…`, so `macro-scan` sorts first even though `c` precedes `m`. This is
   surprising, and it is correct: one rule covers every collection with no
   per-type comparator to get wrong. An implementation that sorts the logical
   tuples field-wise instead will produce different bytes and a different
   digest.
3. **Sorting is by UTF-16 code unit, not by code point.** For strings containing
   astral characters these differ, because a surrogate pair (U+D800–U+DFFF)
   sorts below U+E000–U+FFFF as code units but above them as code points. Code
   units are specified because that is what `<` gives on the platform and what
   `COLLATE "C"` gives on byte-identical UTF-8 for the BMP; an implementation
   sorting by code point must reproduce code-unit order explicitly.

### 6.9 Duplicates

Duplicates are **preserved, not collapsed**. A collection containing the same id
twice encodes as a count of 2 and two identical elements.

The encoder does not deduplicate, because deduplicating would hide exactly the
corruption the witness exists to detect: a duplicated child row is a defect, and
a canonical form that silently normalised it away would verify against the
corrupted record.

Sorting places equal elements adjacently; their relative order is immaterial
because they are byte-identical.

### 6.10 Unicode normalisation

**None is applied.** Strings are encoded as the exact code units stored.

Composed `é` (U+00E9, two bytes) and decomposed `é` (U+0065 U+0301, three bytes)
are different values, produce different bytes, and produce different digests.

This is deliberate. Normalising would make two distinct stored strings render
identically, and the witness would stop noticing an edit that replaced one with
the other. A canonical form for an integrity witness must preserve distinctions
the store preserves, even distinctions that look like the same text.

### 6.11 Astral characters

A code point above U+FFFF is stored as a UTF-16 surrogate pair and encoded as
**one code point in four UTF-8 bytes**, never as two three-byte sequences for
the surrogate halves (which would be CESU-8, not UTF-8).

A lone surrogate — a high surrogate not followed by a low one, or a low
surrogate alone — is encoded as a single three-byte sequence for that code unit.
Such a string is not valid Unicode text and cannot arrive from PostgreSQL, which
rejects it at the protocol level; the rule exists so that the encoder is total
and two implementations agree even on input that should not occur.

### 6.12 Timestamps

`evaluatedAt` is encoded as a **string** (§6.2), byte for byte as stored. It is
not parsed, not re-serialised, and not normalised.

The value is an ISO-8601 instant in UTC with millisecond precision, as produced
by `Date.prototype.toISOString` — for example `2026-07-28T08:59:00.000Z`. That
form is a property of what the domain writes, enforced where the value is
created, and this specification does not re-derive it. Two representations of
the same instant that differ as text — a `+00:00` offset instead of `Z`, a
different fractional precision — are different bases here.

Treating the timestamp as an opaque string is what keeps this specification free
of date arithmetic. A canonicalizer that parsed and reformatted would introduce
a second implementation of timestamp handling whose disagreement with the first
would surface as a corruption report.

### 6.13 Line endings

The encoding contains no line separators. It is a single unbroken byte string
and never depends on platform line endings.

---

## 7. Domain separation

The bytes that are hashed are:

```
BASIS_DOMAIN_SEPARATION  ||  <canonical input>
```

where the prefix is the ASCII string:

```
financial-os:eligibility-basis:v3|
```

— thirty-four bytes, ending in a vertical bar. The version in the prefix is the
canonicalization version and moves with it.

Without a prefix, any other part of the system that happened to produce the same
bytes would produce the same digest, and the result could be presented as an
eligibility attestation. The prefix confines this digest to this purpose.

### 7.1 Why the terminator is `|` and not ` `

A NUL terminator is the usual convention, and this specification deliberately
does not follow it.

Domain separation needs an unambiguous boundary only when the tag can vary in
length; a fixed-length constant tag cannot be confused with what follows it, and
this tag is a compile-time constant. The canonicalization version is *also* the
first element of the canonical input, so cross-version collision is prevented
twice over. The NUL was therefore carrying no security weight.

It was carrying a real cost. It was written into the source as a **literal
control character** rather than an escape — twice, invisible in the editor,
invisible in the diff, and rendered as a space by every tool that read the file
back. A byte that a reviewer cannot see has no place in the definition of a
mechanism whose entire purpose is to let a reviewer detect an unseen change.

**If this prefix ever becomes variable** — a tenant id, a deployment tag — it
must be length-prefixed like every other string in the encoding. A bare
separator between two variable-length fields is exactly the ambiguity §6.2
exists to prevent.

---

## 8. The digest

`SHA-256`, per FIPS 180-4, over the bytes of §7.

The output is written as **64 lowercase hexadecimal characters**, most
significant byte first. Uppercase hex is not valid; a manifest carrying it is
rejected as malformed rather than compared.

A stored manifest carries three fields, and all three are checked before any
comparison:

| Field | Rejected as |
| --- | --- |
| `algorithm` other than `sha256` | `manifest-algorithm-unsupported` |
| `canonicalizationVersion` other than `1` | `manifest-canonicalization-unsupported` |
| `digest` not matching `^[0-9a-f]{64}$` | `manifest-digest-malformed` |
| digest well-formed but unequal | `manifest-digest-mismatch` |

An unknown canonicalization version is refused, **never recomputed under the
rules of this version**. A record written under a future shape is not corrupt;
the reader is old, and reporting the first as the second would send somebody to
investigate a data-integrity incident that did not happen.

Comparison is by string equality. Constant-time comparison is not required and
is not performed: both values are already stored in the same database, the
threat model (§1) does not include an attacker who learns anything from timing a
verification, and claiming a timing-resistance property this mechanism does not
have would be worse than not claiming it.

---

## 9. Golden vectors

Reproduced from `src/domain/analysis/basisCanonical.test.ts`, which pins them.
An independent implementation should reproduce these exactly.

### 9.1 Subject

```
submissionId = "sub-1"
caseId       = "case-1"
```

### 9.2 Minimal basis

Every optional reference null, every collection empty:

```
thesisId                 = "thesis-1"
revisionId               = "rev-1"
eligibilityPolicyVersion = "1"
evaluatedAt              = "2026-07-28T08:59:00.000Z"
aggregationId            = null
storageProvenanceId      = "prov-1"
verification             = null
devilsAdvocate           = null
peerScrutiny             = []
riskRequirement          = "not-required"
riskRuleId               = null
riskRuleVersion          = null
risk                     = null
requiredWork             = []
materialDisagreements    = []
evidenceSetIds           = []
```

Canonical input:

```
l23:i3s5:sub-1s6:case-1s8:thesis-1s5:rev-1s1:1s24:2026-07-28T08:59:00.000Zns6:prov-1nni0l0:s12:not-requirednnni0l0:i0l0:i0l0:
```

### 9.3 Populated basis

As above, but:

```
aggregationId         = "agg-1"
verification          = { reviewId: "review-v", sequence: 1, status: "verified" }
devilsAdvocate        = { reviewId: "review-d", sequence: 2,
                          openChallenges: [
                            { challengeId: "challenge-b", materiality: "material" },
                            { challengeId: "challenge-a", materiality: "non-material" },
                          ] }
peerScrutiny          = [ { reviewId: "review-p", sequence: 1,
                            byDepartmentId: "rates",
                            examinedDepartmentId: "global-macro",
                            openChallenges: [
                              { challengeId: "challenge-c",
                                materiality: "decision-critical" },
                            ] } ]
risk                  = { reviewId: "review-r", sequence: 3, status: "accepted" }
riskRequirement       = "required"
riskRuleId            = "rule-1"
riskRuleVersion       = "1"
requiredWork          = [ { playbookEntryKey: "macro-scan",   runId: "run-1" },
                          { playbookEntryKey: "credit-check", runId: "run-2" } ]
materialDisagreements = [ { claimId: "claim-1", materiality: "material" } ]
evidenceSetIds        = ["set-2", "set-1"]
```

Canonical input, split by element for reading only — the real value has no line
breaks:

```
l23:
i3
s5:sub-1 s6:case-1 s8:thesis-1 s5:rev-1
s1:1 s24:2026-07-28T08:59:00.000Z s5:agg-1 s6:prov-1
l3:s8:review-vi1s8:verified
l4:s8:review-di2i2l2:l2:s11:challenge-as12:non-materiall2:s11:challenge-bs8:material
i1 l1:l6:s8:review-pi1s5:ratess12:global-macroi1l1:l2:s11:challenge-cs17:decision-critical
s8:required s6:rule-1 s1:1
l3:s8:review-ri3s8:accepted
i2 l2:l2:s10:macro-scans5:run-1l2:s12:credit-checks5:run-2
i1 l1:l2:s7:claim-1s8:material
i2 l2:s5:set-1s5:set-2
```

Four things to check an implementation against, all visible above:

- the challenge ids appear as `challenge-a`, `challenge-b` — sorted, though they
  were supplied in the other order;
- the evidence sets appear as `set-1`, `set-2` — likewise;
- the required-work pairs appear as `macro-scan`, then `credit-check` — sorted
  by encoded form, so the shorter length prefix wins (§6.8, consequence 2);
- the peer examination binds **both** department ids and its own open challenge,
  and the challenge's materiality (`decision-critical`) appears even though no
  registered policy reads it — see §4.4.

---

## 10. Changing this specification

Any change to §4 or §6 changes the digest of every basis, and therefore is a new
**canonicalization version**, never an edit to version 3.

A new version requires: a new integer constant; element 1 emitting it; this
document preserved as the definition of version 3; and a reader that continues
to accept version 3 records — subject to §10.1.

Records already written under version 3 are **never** re-canonicalized and their
digests are never recomputed. A stored manifest is a statement about a past
write, and rewriting it would replace a fact with an assertion.

### 10.1 Legacy verification

**Legacy verification must remain supported whenever legacy records may exist.**

A clean cutover without a legacy reader is permitted **only** when the absence
of legacy records is *mechanically proven before the migration runs*, and the
migration **fails loudly** if that premise is false. Proof means a guard inside
the migration, not a belief about the environment: "the table should be empty"
is an assumption; `SELECT count(*)` refusing at one row is a proof.

Absent that proof, a new version ships a reader that verifies its predecessor
under that predecessor's rules. There is no third option in which stored records
quietly stop being verifiable.

### 10.3 How version 3 came to exist

Every objection an eligibility basis could carry came from the Devil's Advocate.
The gate could therefore answer "were the objections settled" and could not
answer "did anyone qualified look" — and a revision nobody read passes the first
question trivially, for the same reason an unopened letter has no reply.

The firm had no second analytical desk to ask. `global-macro` held the `rates`
routing handle, so the only desk competent to contest a rates attribution was
the desk that made it. Migration `0035_rates_department.sql` seated Rates with a
deliberately overlapping mandate, `0036_peer_examination_review.sql` gave the
examination a review kind of its own, and this version puts the result in the
record the CIO gate reads.

The distinction that forced a new element rather than a reused one: a peer
examination is **not** a control-function verdict. `recordPeerExamination` runs
under `department-contribution` and files as `analysis`, not under
`governance-verdict` as `governance`, because Rates is not a control function.
Recording peer objections in element 11 would have made the ledger show a fifth
control the firm does not have.

As at version 2, the correction is a **fact in the record**, not a rule in the
evaluator. `PEER_SCRUTINY_ABSENT` reads whether an examination exists; it does
not infer scrutiny from an absence of objections.

Version 2 shipped no forward-compatibility reader here, under §10.1. Migration
`0037_peer_scrutiny_basis.sql` proves `analysis.cio_submissions` empty before the
cutover and refuses to apply if it is not. One version-2 submission and that
migration fails, and no cutover occurs until a compatibility strategy is
designed.

`docs/eligibility-basis-canonicalization-v2.md` is preserved as historical
documentation of a format the running code no longer verifies.

### 10.2 How version 2 came to exist

Version 1 encoded open challenges as ids alone. The gate could not apply the
firm's threshold to a list with no materiality in it, so it blocked on every
open challenge — stricter than `challengeBlocks` and
`EligibilityPolicy.challengeBlocksAtOrAbove` declare, and stricter than the
scenario suite already asserted elsewhere. Two parts of one system disagreed
about the same question, and only one of them was written down as policy.

The correction had to be a **fact in the record**, not a rule in the evaluator:
a gate that reaches its own conclusion about weight is a second place the firm's
line is drawn.

Version 1 shipped no forward-compatibility reader here, under §10.1. Migration
`0025_challenge_materiality.sql` proved `analysis.cio_submissions` empty before
the cutover and refuses to apply if it is not. One version-1 submission and that
migration fails, and no cutover occurs until a compatibility strategy is
designed.

`docs/eligibility-basis-canonicalization-v1.md` is preserved as historical
documentation of a format the running code no longer verifies, and says so in
its own §10.1.

Version 2 is now in the same position; see §10.3.
