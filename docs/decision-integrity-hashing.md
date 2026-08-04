# Where SHA-256 lives

**Status:** decided, with stated conditions for revisiting.
**Decision:** retain the pure TypeScript implementation in
`src/domain/shared/sha256.ts` (option 5), under the safeguards in §5.
**Runner-up:** an audited zero-dependency library behind a domain-declared
synchronous port (options 3 + 2 combined). §6 names the conditions that make it
the right answer instead — one of them is already foreseeable.

The question was whether Financial OS should maintain hand-written
cryptographic code. It should not, as a default. The rest of this document is
the argument for why this specific case is an exception, and what would end it.

---

## 1. The facts the decision rests on

Verified in the tree rather than assumed, because two of them contradict what
was believed when the question was raised.

**1.1 The domain may not import Node builtins.** Enforced by
`src/test/importGraph.test.ts`, which fails any `src/domain` module importing a
specifier matching `/^node:/`. This is a real, tested rule, not a convention.

**1.2 Manifest verification is called from synchronous domain code.**
`verifyBasisManifest` is invoked by `validateCioSubmission`
(`src/domain/analysis/aggregateValidation.ts:145`), a synchronous validator
returning `AggregateProblem[]`. `buildBasisManifest` is invoked by
`decisionMapping.ts:323`, a synchronous mapping function. Both sit under
`assertCioSubmissionWellFormed`, which the write-once path and all 69 shared
contract cases depend on.

**1.3 Web Crypto has no synchronous digest.** `crypto.subtle.digest` returns a
Promise, and there is no sync equivalent in the browser. Adopting it makes
`buildBasisManifest` async, therefore `verifyBasisManifest` async, therefore
`validateCioSubmission` async — a validator whose whole job is to be a cheap
total function over a value in hand.

**1.4 `sha256.ts` is not currently browser-reachable.** No client component
imports `~/domain/analysis` or `~/domain/shared/sha256`. Client code reaches
`~/domain/market`, which re-exports `~/domain/shared/primitives` and
`~/domain/shared/provenance` only.

> An earlier note in this work claimed `domain/shared` was browser-reachable via
> `AppHeader.tsx` and `LightCommandCenter.tsx`. That was wrong: those import
> `~/domain/market`. The only component-level imports of `~/domain/shared/*` are
> in test files. The browser argument below is therefore about a rule the
> architecture enforces, not about a hazard currently live in a bundle.

**1.5 The risk class here is narrower than "cryptography".** The classic reasons
not to hand-write crypto are key management, side channels, mode and protocol
errors, and randomness. None are present: this is an unkeyed digest over
non-secret data, compared for equality against a value stored in the same
database. What remains is ordinary correctness, and ordinary correctness in a
hash is **fully detectable by differential testing** against a reference
implementation — unlike a timing leak, which testing does not reveal.

---

## 2. The options, against the criteria

`+` favourable, `~` mixed, `−` unfavourable.

| Criterion | 1. App-layer service | 2. Injected port | 3. Audited dependency | 4. Platform exception in domain | 5. Pure (current) |
| --- | --- | --- | --- | --- | --- |
| Domain purity | `+` | `+` | `+` | `−` breaks the tested rule | `+` |
| Portability | `+` | `+` | `+` | `−` server-only | `+` |
| Auditability | `~` two-step protocol | `~` seam is auditable, impl is elsewhere | `+` audited upstream | `+` standard | `~` ours to audit, ~120 lines |
| Maintenance risk | `~` | `~` threading | `+` upstream | `+` | `~` ours forever |
| Cryptographic implementation risk | `+` none | `+` none in domain | `+` none | `+` none | `−` ours |
| Browser/server compatibility | `~` depends on impl | `~` depends on impl | `+` | `−` | `+` |
| Deterministic testing | `+` | `~` a wrong hasher is injectable | `+` | `+` | `+` |
| Import-boundary discipline | `+` | `+` | `+` | `−` needs an exemption | `+` |
| Future algorithm migration | `+` | `+` easiest | `+` | `~` | `−` hardest |

### 2.1 Option 1 — hashing in an application/shared integrity service

Canonicalization stays in the domain; the application hashes and compares.

The cost is not mechanical, it is semantic. "A submission carrying a manifest
that does not describe its own basis is malformed" is currently a **domain**
invariant, checked by the same validator that checks every other structural
property, and the write-once read-back-and-compare contract relies on domain
validation being complete. Splitting the check moves one invariant out of the
aggregate and into a caller that can forget to perform it. The remaining
validator would report a well-formed submission whose attestation is wrong.

It also does not settle the sync question: an application-layer service using
Web Crypto is still async, and `validateCioSubmission` still cannot call it.

### 2.2 Option 2 — an injected `IntegrityHasher` port

Ports exist here for **non-determinism**: `Clock` and `Random` are injected
because their results are not a function of their inputs. SHA-256 is total,
deterministic and pure — the properties a port exists to tame are all absent.

Two concrete costs. Threading: the hasher must reach `validateCioSubmission`,
`decisionMapping`, every fixture and all 69 contract cases, changing signatures
that currently take a value and return a verdict. And a security seam that does
not exist today: an injectable hasher is a hasher that can be injected wrongly,
and a test double returning a constant would make every manifest verify.

Most importantly, **option 2 does not by itself remove the hand-written code.**
The port must be synchronous (§1.2, §1.3), so its implementation is still either
`node:crypto` — server-only, reintroducing §1.4's rule breach one layer out — or
a library (option 3) or the pure implementation (option 5). It relocates the
question rather than answering it. It is valuable as *structure* once option 3
is chosen, which is why §6 pairs them.

### 2.3 Option 3 — a narrowly scoped audited dependency

The serious alternative. A zero-dependency audited hash library is synchronous,
browser-safe, platform-neutral and maintained by people who do this full time.
It is strictly better than the pure implementation on maintenance and on future
algorithm migration.

The argument against is narrower than "we avoid dependencies": adding a
third-party package **into the integrity path** puts the mechanism that detects
silent modification downstream of a supply chain that can itself be silently
modified. A compromised release of a hashing library is among the highest-value
targets that exists, and the compromise would be invisible in exactly the place
this mechanism is supposed to provide visibility. A ~120-line implementation
pinned in the repository, reviewed once, and checked against NIST vectors on
every run has a smaller and more legible attack surface than a package whose
next patch release arrives automatically.

That argument holds for **one unkeyed hash**. It stops holding the moment a
second primitive is needed (§6).

### 2.4 Option 4 — an audited exception for a platform implementation

Cheapest to write, worst to live with. It makes `domain/analysis` server-only by
suspending the rule that keeps the domain platform-neutral, and it does so with
an exemption in the very test that exists to prevent exemptions. The next
exception cites this one. Rejected.

### 2.5 Option 5 — retain the pure implementation

Synchronous, dependency-free, platform-neutral, no import-boundary breach, no
threading, no injectable seam. Its single real weakness is that a correctness
bug would be ours, and that weakness is directly addressed by the testing in §4:
published vectors prove it implements the standard, and differential comparison
against `node:crypto` proves it agrees with the implementation the rest of the
world uses.

---

## 3. Decision, and the honest case against it

**Retain the pure implementation.**

The reasoning in one line: the constraint that actually binds is
*synchronous + platform-neutral + inside a domain invariant*, and of the five
options only 3 and 5 satisfy it; between those two, a hand-written unkeyed hash
carries a risk that testing eliminates, while a dependency in the integrity path
carries one that testing does not.

The case against, stated plainly rather than dismissed: this codebase now owns
cryptographic code that nobody outside it has reviewed, and "we tested it
thoroughly" is what every incorrect implementation has said. The mitigation is
not the claim of thoroughness — it is that a hash has a *reference*, and the
tests compare against it exhaustively over the input space that matters (§4).
If that comparison were ever removed or weakened, this decision would no longer
be justified and should be revisited immediately.

**What this decision is not.** It is not a general licence for hand-written
cryptography, not precedent for a second primitive, and not a judgement that
audited libraries are untrustworthy. It is a narrow finding about one unkeyed
digest under a hard synchronicity constraint.

### 3.1 What the evidence from this work actually showed

Two defects were found while writing the specification, and neither was in the
SHA-256 core:

- the **canonicalization** counted UTF-8 bytes with a second, subtly different
  encoder that mishandled a lone surrogate, so a length prefix could disagree
  with its own payload;
- the domain-separation constant contained a **literal NUL byte** in source,
  written twice, invisible in every diff.

The hand-written hash was correct; the code around it was not. That is
information about where this system's integrity risk actually lives, and it
argues for spending review effort on the encoding and its enforcement rather
than on re-litigating the primitive.

---

## 4. The testing this decision depends on

Removing or weakening any of these invalidates the decision.

| Test | What it establishes |
| --- | --- |
| NIST vectors — empty, `abc`, the 448-bit vector, one million `a`s | It implements FIPS 180-4 |
| Differential vs `node:crypto`, every length 0–130 | Padding is right at and around every boundary |
| Differential at byte-boundaries reached by 2- and 4-byte characters | Length is computed in bytes, not code units |
| Differential over canonical renderings with the real domain prefix, lengths 0–140 | The production input shape crosses the boundaries correctly |
| Differential on multi-byte, astral and flag sequences | Surrogate pairs encode as one code point |
| Export surface pinned to `sha256Hex`, `utf8ByteLength` | The mandate in §5 is enforced, not merely stated |
| Source scanned (comments stripped) for keyed/signing/key-handling terms | A second primitive cannot be added quietly |

All are in `src/domain/shared/sha256.test.ts`.

---

## 5. Safeguards, in force

These are conditions of the decision, not aspirations.

1. **Used only for SHA-256 digest calculation.** No other caller, no other
   purpose.
2. **No generalized cryptographic API.** The module exports `sha256Hex` and
   `utf8ByteLength`. The export list is pinned by a test; adding to it fails.
3. **No signing, MAC, encryption, key derivation or key handling.** Enforced by
   the source scan. Any of these must be a library, never hand-written here.
4. **NIST vectors remain pinned.**
5. **Differential tests against a trusted platform implementation remain
   mandatory.** They are the reason this decision is defensible.
6. **Modification requires focused review.** A change to this file is a change
   to an integrity primitive and may not ride along in an unrelated commit.
7. **Treated as security-sensitive code**, alongside `basisCanonical.ts`, which
   is equally load-bearing and — on the evidence of §3.1 — more likely to be the
   one that is wrong.

`utf8ByteLength` is exported deliberately and is not a widening of the mandate:
it exists so the canonical encoder's length prefixes are produced by the same
code that produces the bytes they describe. Two implementations of that rule is
precisely the defect it was introduced to remove.

---

## 6. What would change this decision

Any one of these should trigger a switch to option 3, structured through the
option 2 port. They are listed roughly in order of likelihood.

1. **A keyed construction is required.** HMAC, a signature, or anything where a
   correct-looking output can still leak. Differential testing does not cover
   that risk class. **This is foreseeable:** TD-60 (out-of-band integrity
   evidence, the answer to the threat model this manifest explicitly does not
   cover) will very likely need exactly this. When TD-60 is taken up, this
   decision should be reopened as a matter of course rather than defended.
2. **A second hash algorithm is needed** — SHA-512, BLAKE3, or an algorithm
   migration. One hand-written primitive is a considered exception; two is a
   habit.
3. **The synchronicity constraint is lifted.** If manifest verification moves to
   an async boundary, Web Crypto becomes available on both platforms and is
   preferable to anything hand-written.
4. **The differential tests become impractical** — for example if the test layer
   loses access to a trusted reference implementation. Without §4 the argument
   in §3 does not hold.
5. **The digest is computed at volume in the browser**, where a tuned library
   would materially outperform this implementation.

Absent one of these, this file should be left alone.
