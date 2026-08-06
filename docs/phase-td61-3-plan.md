# TD61-3 planning gate · compatibility, determinism and boundary hardening

**Status:** plan only. Nothing implemented. Approval required before any code
changes.

**Purpose.** Close TD-61 by proving that what TD61-2 built actually holds:
every production caller accounted for, decimals validated rather than merely
converted, identity output independent of the host, invalid input never
producing an identity, and the locale defect structurally prevented from
returning.

---

## 0 · One finding that reshapes §12

I checked the residual evidence-membership question before writing this plan,
because the answer determines whether §12 opens a debt item or documents a
chain. It does both, and more precisely than the question assumed.

**PostgreSQL hydration already recomputes the evidence-set id and refuses a
mismatch.** `toEvidenceSet` (`mapping.ts`) rebuilds the set through
`buildEvidenceSet` and throws `MalformedRowError` when `rebuilt.id !== row.id`.

But the id covers `[observationId, contentHash]` pairs — **membership**, not
payloads. So today:

| Alteration | Detected on hydration? |
| --- | --- |
| an evidence item removed, added or substituted | **yes** — id mismatch |
| a stored `content_hash` edited | **yes** — id mismatch |
| a stored `value` edited, `content_hash` left alone | **no** |

The residual gap is therefore **narrower than TD-58 states** — membership *is*
verified, on the read path, when the set is hydrated — and it is **newly
closable**, because TD61-2 made `contentHash` deterministically derivable from
`value` for the first time. Before canonical value v1, recomputing it would not
have been reliable.

§12 turns that into work rather than a caveat.

---

## 1 · Migration accounting proof

Not "backward identity compatibility" — the format changed deliberately, so
identities changed. **Migration accounting** is the accurate name and the one
this plan uses.

A frozen corpus of every valid production value shape that existed before
TD61-2, recorded once and thereafter immutable. For each entry:

| Field | |
| --- | --- |
| production caller | one of the eight in `docs/identity-architecture.md` §2 |
| old valid input | as constructed before TD61-2 |
| old canonical encoding and hash | computed by a pinned reimplementation of `canonicalJson`, kept in the test tree only |
| new canonical encoding and hash | computed by the live code |
| identity changed | expected `yes` for callers 1–7, `no` for caller 8 |
| why | the encoding changed / the value model refused the old input / unchanged |

**What the proof must establish**, stated as the four claims and not as a table
of hashes:

1. every old **valid** production input has an explicit new representation —
   nothing that used to work has become inexpressible;
2. no caller was accidentally dropped from the migration;
3. no caller relies on an implicit conversion — every decimal passes through
   the approved constructor, checked structurally, not by inspection;
4. every old **invalid** input — the values that used to collide — is now
   refused with a named code.

The old-encoding reimplementation exists **only** to prove separation. It is
test-only, clearly named as historical, and no production path may import it.

**Open question for the gate:** whether the corpus lives as a checked-in JSON
fixture or as constructed values in a test file. A fixture is easier to diff and
harder to accidentally rewrite; constructed values keep the types honest.
Recommendation: constructed values, with the *hashes* pinned as literals, so a
change to either side fails.

## 2 · Complete caller inventory verification

`docs/identity-architecture.md` §2 lists eight sites. TD61-3 verifies that list
is still complete rather than trusting it, by structural search rather than by
reading:

- every call to `canonicalValueString`, `canonicalIdentityInput` and
  `asCanonicalValue` in production code;
- every call to `stableHashHex` — the identity hash — with its input traced to a
  canonical encoding or explicitly classified as non-identity;
- confirmation that `canonicalJson` is absent from the tree, and that nothing
  reintroduces `JSON.stringify` in an identity path.

A caller found that is not on the list is either added or explained.

## 3 · Decimal-string boundary

The correction this stage owes. TD61-2 *converted* decimals; it did not
*validate* that a string arriving as a decimal is canonical.

**The layering rule, ratified in advance:** the canonical-value layer stays
unaware of which ordinary strings are decimals. A decimal is a string to it. The
**typed domain boundary** owns the distinction, which is where `CanonicalDecimal`
and `isCanonicalDecimal` already live.

### 3.1 Meaning, decided per value

For every fractional domain value, one of two meanings applies, and it must be
recorded rather than assumed:

1. **the exact authored representation is institutionally significant** — what a
   person or source wrote, `2.50` distinct from `2.5`;
2. **the exact numeric value is institutionally significant** — `2.50` and `2.5`
   are one value and must not produce two identities.

Where meaning 2 applies, the value is normalized and validated at the domain
boundary. Where meaning 1 applies, the authored form is stored **separately**
from the canonical numeric value; they are two facts.

### 3.2 The audit

Every production decimal converted to a string, with:

| Column | |
| --- | --- |
| source type | `Price`, `YieldPercent`, `Percent`, `BasisPoints`, `PolicyRatePercent` |
| unit | percent, basis points, currency |
| accepted canonical format | §4.1 of the canonical-value spec |
| where validation occurs | which boundary function |
| trailing zeros meaningful | yes/no — decides meaning 1 vs 2 |
| negative zero possible | from the source model |
| scientific notation accepted | expected: no, everywhere |
| original source representation preserved separately | yes/no, and where |

Known entries from TD61-2, to be completed and verified:
`quote.value`, `absoluteChange`, `percentageChange`, `previousClose`,
`yieldPercent`, `changeBasisPoints`, yield-curve points, and the nested
`PolicyLevel` / `PolicyLevelChange` rates.

### 3.3 Forms requiring a stated policy

`2.5` · `2.50` · `02.5` · `+2.5` · `2.5e0` · `-0` · `0.0`

Current behaviour is that only `2.5` is accepted and the rest are refused,
`-0` explicitly rather than normalized. TD61-3 confirms that is right for each
domain value rather than assuming it, and adds the tests.

**No caller chooses its own conversion.** One approved constructor. It refuses
non-canonical forms rather than silently normalizing, unless a specific domain
value is shown to require normalization — in which case that requirement is
written down where the value is defined.

**Honesty constraint:** where conversion begins from an already-rounded
JavaScript number, the documentation must say precision was already bounded by
the source model. It must not describe the string as recovering original
precision. It does not.

## 4 · Cross-locale and cross-runtime determinism

### 4.1 Locale

Identical canonical input must produce identical bytes and hashes under **`en`,
`sv`, `da`, `tr`**, plus `lt`, `cs`, `et`.

TD61-2's locale test sets the locale *inside* one process, which proves the
comparator ignores an explicitly passed locale — it does not prove the code
ignores the process default. TD61-3 must do better: spawn Node with
`LANG`/`LC_ALL` and `--icu-data-dir` variations where the platform allows, and
compare emitted bytes across processes.

**Non-vacuity guard, retained:** the test first asserts the chosen locales still
disagree with each other on a known pair (`Id` vs `id`), and fails with a message
saying so if a future ICU makes them agree.

### 4.2 Timezone

Timestamps enter payloads as strings and are never parsed, so timezone should be
irrelevant. That is a claim, and TD61-3 tests it: identical input under at least
`UTC`, `Europe/Stockholm` and `Pacific/Kiritimati` (UTC+14, which crosses the
date line relative to most fixtures).

### 4.3 Runtime and OS

**There is no CI configuration in this repository** — no `.github/workflows`.
So "supported operating-system environments available in CI" currently means
one: the developer machine.

Two honest options for the gate:

1. prove determinism across Node **processes** and locale/timezone settings on
   the available platform, and state plainly that cross-OS determinism is
   **asserted by construction, not measured**;
2. add a minimal CI matrix as part of TD61-3.

**Recommendation: option 1**, with the limit stated in the exit report and
recorded as debt if the reviewer wants it measured. Adding CI is real work with
its own decisions, and smuggling it into a determinism stage would be scope
creep. The construction argument is strong — no platform API is consulted — but
it is an argument, not a measurement, and must be labelled as one.

## 5 · Invalid external and hydrated input

Every boundary where a value not written by this build can arrive:

| Boundary | Behaviour required |
| --- | --- |
| `observationRef` | refuse before a `contentHash` exists |
| `commandPayloadHash` | refuse before a ledger entry exists |
| `toEvidenceSet` hydration | refuse as a **bounded** `MalformedRowError` |
| `asCanonicalValue` anywhere | named code and path, no value content |

A stored malformed payload must **fail during hydration as a bounded error**. It
must not produce a semantic key, collapse to another canonical value, be
silently converted to a string, or reach evidence comparison as though valid.

## 6 · Evidence values, with real market shapes

Tests using market-style values rather than synthetic ones:

decimal price string · percentage string · safe integer · nested structured
value · malformed fractional number · unsafe integer · `NaN` · a Date-like
object · an object carrying `toJSON`.

Both protections retained and both tested: compile-time `CanonicalValue` typing,
and runtime validation at the provider, hydration and unsafe-cast boundaries.

## 7 · Observation revision semantics

`isRevisionOf` proven for: identical valid values; missing → explicit `null`;
missing → invalid; a decimal change; reordered object keys (no revision);
reordered arrays where order is significant (revision); a nested change; and a
policy or methodology metadata change where that metadata is part of the content.

**Invalid values must fail before any "unchanged" or "revised" verdict is
produced** — the verdict is the thing that was wrong before, and a verdict
derived from a refused value would be the same defect wearing a different error.

## 8 · Evidence-set and semantic-key behaviour

Proven: same semantic evidence in different key order has the same identity;
array order remains significant where defined; `EvidenceItem.value` round-trips
without conversion drift; write-once replay succeeds for semantically identical
canonical values; materially changed values conflict; invalid hydrated values
fail before semantic comparison.

## 9 · Command payload version 2

Proven: version 2 is bound **inside** the hashed input; a version-1 hash cannot
replay as version 2; identical version-2 payloads replay; key-order differences
do not change the hash; invalid values are refused **before** command logging;
`COMMAND_CONTRACT_VERSION` remains `2`.

TD61-2 already covers most of this. TD61-3 adds the one it does not: refusal
happening before a ledger entry is written, which is a property of `runCommand`
rather than of the hash function.

Version-1 fixtures are retained **only** to prove separation. No new version-1
payload identities are generated.

## 10 · Provenance and contract-version behaviour

Proven: both adapters report `DOMAIN_CONTRACT_VERSION = '10'`; the three
coordinates are independent; advancing one does not move another. Documented in
`docs/identity-architecture.md` §1, which TD61-3 verifies against the code.

## 11 · Structural rule — no locale-sensitive identity sorting

A load-bearing fitness rule, parser-based, in the existing registry.

**States:** no locale-sensitive comparison appears in identity-critical
canonicalization or identity-payload construction.

**Selects** the approved identity surfaces only: `canonicalValue`, observation
identity, evidence-set identity, command payload identity, requirement hashes,
playbook hashes, event identity, write-once semantic keys.

**Detects** `localeCompare`, `Intl.Collator`, and `.sort()` with no comparator
where the sorted values feed an identity — the last because the default sort is
UTF-16 code-unit order, a *different* rule from canonical value v1's, and
agreeing with it only below the astral plane.

**Fixtures**, both required by the meta-test:

- *planted violation*: an identity payload sorting with `localeCompare`;
- *benign near-miss*: a presentation component sorting user-facing text with
  `localeCompare` — which must **pass**, because locale-aware ordering is correct
  there and a rule that banned it would be turned off.

The near-miss must be **selected** by the rule and found compliant, not merely
unselected — the meta-test already enforces that distinction.

## 12 · Residual evidence-set membership integrity

Per §0, the honest statement is now three statements:

1. **Membership tampering IS detectable** when a set is hydrated from
   PostgreSQL: `toEvidenceSet` recomputes the id from `[observationId,
   contentHash]` pairs and refuses a mismatch. This chain is documented
   precisely, including that it holds **only when the set is hydrated** — the
   manifest binds an id, and nothing checks an id nobody reads.
2. **Payload tampering is NOT detectable** on the read path: `item.value` is
   validated as canonical but never checked against its stored `contentHash`.
3. **It is now closable.** `contentHash` became deterministically derivable from
   `value` in TD61-2. Hydration could recompute and compare it.

**Proposal for the gate:** close it here rather than recording it, since the
work is a recomputation in a function that already recomputes the set id, and
the alternative is a high-priority debt item filed against code that already has
the pieces. To be ratified — it is a scope decision, not mine to take.

If it is **not** closed here, it is recorded as a **separate high-priority debt
item**, and no document may claim TD-58 detects evidence membership alteration
through the stored id alone.

**Kept separate from TD-60.** TD-60 is an informed actor rewriting data *and*
witnesses — an out-of-band evidence problem. This is in-band self-validation:
whether a record proves its own consistency. Different threat, different answer.

## 13 · Fixture and documentation audit

Inspected: evidence-set fixtures, command fixtures, recorded provider fixtures,
semantic-key vectors, cache-key vectors, result-store keys, documentation
examples, golden snapshots.

TD61-2 changed fixtures at their **typed value boundaries** — a fixture now
supplies `'4.1'` because production supplies a canonical decimal string — and
regenerated **no** expected hash. TD61-3 verifies that claim rather than
repeating it, by confirming no test asserts a literal identity value that was
edited during TD61-2.

## 14 · Out of scope

- **The five pre-existing prettier warnings** in `src/test/` — `pgOwnership.ts`,
  `pgOwnership.test.ts`, `pgGlobalSetup.ts`, `repositoryCapabilities.test.ts`,
  `sqlCatalogues.test.ts`. TD61-3 does not modify those files, so it does not
  reformat them. Recorded here as existing formatting drift; if the project
  wants zero formatter warnings as an exit criterion, that is its own change.
- **TD-62** stays open. Reruns are not a fix. It does not block TD61-3 unless it
  prevents a reliable green verification run.
- No migration 0022, no TD58-2, no `SubmitForCioDecision`, no LLM integration,
  no Agents UI, no agents.

## 15 · Staging

One stage, or two if §12 is closed here.

| | |
| --- | --- |
| **TD61-3a** | migration accounting, caller verification, decimal audit and boundary validation, determinism, revision and replay semantics, the structural rule |
| **TD61-3b** | evidence payload self-validation (§12), only if ratified |

Reported separately if split.

## 16 · Questions for the gate

1. **§12** — close the payload-integrity gap here, or record it as separate
   high-priority debt?
2. **§4.3** — accept "determinism by construction, not measured" for cross-OS,
   or add a CI matrix?
3. **§1** — corpus as checked-in fixture or constructed values with pinned
   hashes?
4. **§3.1** — is there any fractional domain value whose *authored*
   representation is institutionally significant? If none, meaning 2 applies
   everywhere and the boundary is simpler than this plan allows for.
