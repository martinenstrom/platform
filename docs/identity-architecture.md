# Identity architecture

How Financial OS derives durable identities, which version coordinate describes
what, and which production callers participate.

Companion to the two normative format specifications:
`docs/canonical-value-v1.md` and
`docs/eligibility-basis-canonicalization-v1.md`.

---

## 1 · The version coordinates

Three coordinates, three responsibilities. They are recorded together in storage
provenance and are read together by an audit, which is exactly why they must not
overlap.

| Coordinate | Answers | Advances when |
| --- | --- | --- |
| `DOMAIN_CONTRACT_VERSION` | which **domain identity semantics** were active | a contract in `domain/analysis` changes what a stored record *means*, including how its identity is derived |
| `PAYLOAD_CANONICALIZATION_VERSION` | how a **command payload** was encoded | the payload encoding changes |
| `COMMAND_CONTRACT_VERSION` | what a **command envelope and workflow** meant | the envelope, the outcome vocabulary or the `expectedVersion` policy changes |

**One semantic responsibility, one coordinate.** A change must not bump two.

TD-61 is the worked example. It changed the payload encoding and changed nothing
about the envelope, the outcome vocabulary or `expectedVersion` — so
`PAYLOAD_CANONICALIZATION_VERSION` advanced `1 → 2` and `COMMAND_CONTRACT_VERSION`
stayed at `2`. The command-contract documentation previously listed payload
canonicalization among its own triggers; that claim was removed, because it would
have produced exactly the double bump the rule forbids.

`DOMAIN_CONTRACT_VERSION` advanced `9 → 10` in TD61-2 rather than TD61-1, because
TD61-1 added a capability no production path used. A version advances when
**externally meaningful behaviour** changes, not when an unused capability
appears — otherwise one coordinate would describe two identity regimes.

### 1.1 Current values

| | |
| --- | --- |
| `DOMAIN_CONTRACT_VERSION` | `10` |
| `PAYLOAD_CANONICALIZATION_VERSION` | `2` |
| `COMMAND_CONTRACT_VERSION` | `2` |

Advancing the domain contract takes **three deliberate acts** — a
`DOMAIN_CONTRACT_HISTORY` entry, the constant, and the literal pinned in
`domainContractVersion.test.ts` — plus a fourth, the independent pin in
`repositoryContract.ts` that proves both adapters *report* the advanced value.
That fourth exists because parity alone cannot: the constant sat at `'6'` for two
phases while both adapters agreed on it.

---

## 2 · Production identity callers

Every production site deriving a durable identity, as migrated in TD61-2. All
use canonical value v1 unless stated.

| # | Site | Identity produced | Domain tag |
| --- | --- | --- | --- |
| 1 | `identity.ts` · `observationRef` | observation `contentHash` | `financial-os:observation-content:v1` |
| 2 | `evidence.ts` · `buildEvidenceSet` | evidence-set `id` | `financial-os:evidence-set:v1` |
| 3 | `requirements.ts` · `requirementInputHash` | requirement input hash | `financial-os:requirement-input:v1` |
| 4 | `playbooks.ts` · `playbookContentHash` | playbook content hash | `financial-os:playbook-content:v1` |
| 5 | `commands/envelope.ts` · `commandPayloadHash` | command payload hash | `financial-os:command-payload:v1` |
| 6 | `commands/eventIdentity.ts` · `derive` | derived record identity | `financial-os:derived-record-identity:v1` |
| 7 | `writeOnce.ts` (×24) | write-once semantic keys | none — compared, never hashed |
| 8 | `identity.ts` · `serializeKey` | observation `id` | **not** canonical value; a fixed-field-order serializer, unchanged by TD-61 |

### 2.1 What each caller receives

| # | Old input type | New input type | Fractional numbers possible | External data reaches it | Identity changed |
| --- | --- | --- | --- | --- | --- |
| 1 | `unknown` | `CanonicalValue` | **yes** — converted at the boundary | **yes** — providers, hydration, casts | yes |
| 2 | `EvidenceItem[]` with `value: unknown` | `value: CanonicalValue` | **yes** — via `item.value` | **yes** — hydration | yes |
| 3 | `RequirementRuleInput` | unchanged | no | no | yes |
| 4 | `CasePlaybook` | unchanged | no | no | yes |
| 5 | `payload: unknown` | `payload: CanonicalValue` | no | via caller payloads | yes |
| 6 | `DerivedIdentity` | unchanged | no | no | yes |
| 7 | typed domain records | unchanged | via `EvidenceItem.value` | via hydration | n/a — not stored |
| 8 | `ObservationNaturalKey` | unchanged | no | no | **no** |

Every identity except #8 changed, because the encoding changed. That was
expected and is not a compatibility failure — see the migration accounting in
the TD61-3 plan.

### 2.2 Boundaries where validation happens

- **`evidenceRefs.ts`** — the one module importing all three domains, and
  therefore where market and policy decimals become canonical decimal strings
  through `canonicalDecimalFromNumber`. No caller stringifies ad hoc.
- **`mapping.ts` · `toEvidenceSet`** — validates each stored `item.value` on the
  way out of the database. A stored payload is external data by the time it
  returns.
- **`asCanonicalValue`** — the named, validating narrowing used where a static
  type cannot express what a value already is. TypeScript will not accept an
  interface where an index signature is required, and the answer to that is a
  checked conversion, never a widened boundary.

---

## 3 · Ordering

Two approved orderings exist. **Neither is "the" sort order of this system**, and
no document may describe one as though it were. Name the format.

| Format | Ordering | Specified in |
| --- | --- | --- |
| Canonical value v1 | UTF-8 byte order | `docs/canonical-value-v1.md` §8.1 |
| EligibilityBasis canonicalization v1 | UTF-16 code unit | `docs/eligibility-basis-canonicalization-v1.md` §6.8 |

They agree except on astral characters. `canonicalFormats.test.ts` proves the
divergence is deliberate, so a refactor cannot unify them by accident — doing so
would silently change every identity derived under one of them.

No generic `canonicalSort` exists, and none may be added: a comparator whose
semantics depend on the caller's assumption is the defect, not the fix.

`localeCompare` is absent from every identity-critical path. It remains
appropriate for user-facing text, and nothing here restricts that.

---

## 4 · Decimal audit

Every fractional value that becomes part of an identity, and how it gets there.

**All conversions live in one module.** `application/analysis/evidenceRefs.ts`
holds every call to `canonicalDecimalFromNumber` and `canonicalDecimalOrNull`;
no other production file converts a decimal, and no `String(number)` remains in
an identity path.

| Caller | Source type | Unit | Already a rounded double | Raw source kept separately |
| --- | --- | --- | --- | --- |
| `quoteRef` · `value` | `Price` | instrument unit | yes | no |
| `quoteRef` · `absoluteChange` | `number \| null` | instrument unit | yes | no |
| `quoteRef` · `percentageChange` | `Percent \| null` | percent | yes | no |
| `quoteRef` · `previousClose` | `Price \| null` | instrument unit | yes | no |
| `yieldRef` · `yieldPercent` | `YieldPercent` | percent p.a. | yes | no |
| `yieldRef` · `changeBasisPoints` | `BasisPoints \| null` | basis points | yes | no |
| `yieldCurveRef` · point yields | `YieldPercent` | percent p.a. | yes | no |
| `policyStateRef` · target range | `PolicyRatePercent` ×2 | percent | yes | no |
| `policyStateRef` · single rate | `PolicyRatePercent` | percent | yes | no |
| `policyStateRef` · key rates | `PolicyRatePercent` ×3 | percent | yes | no |
| `policyStateRef` · change | `BasisPoints` ×1–3 | basis points | yes | no |
| `policyStateRef` · effective fed funds | `number \| null` | percent | yes | no |
| evidence payloads | whole provider object | mixed | yes | no |

### 4.1 The conclusion, recorded explicitly

**Every current fractional value uses numeric meaning, not authored
representation.** None of them needs `2.50` to be distinguishable from `2.5`;
all are quantities a claim would cite, and two spellings of one quantity must
not produce two identities.

**This is not generalized to every future financial domain.** A domain where
scale is meaningful — an accounting entry, a contractual rate, a filing figure —
may deliberately choose authored-representation semantics. When one does, it
models **scale explicitly** rather than relying on string spelling, and preserves
the authored form in a separate field (`rawValue`, `sourceText`,
`providerRepresentation`) alongside the canonical numeric value. The raw field
is evidence in its own right; it never replaces the identity.

### 4.2 The honest limit

Every source in the table above arrives as a **JavaScript number that has
already been rounded**. `canonicalDecimalFromNumber` emits the shortest decimal
that round-trips to that double, so it loses nothing further — but it **does not
recover the precision the source published**. That was lost when the provider's
decimal became a double, upstream of anything this layer can see.

`parseCanonicalDecimal` exists for the case where that loss has not yet
happened: it takes the source *text* and normalizes it, so a provider publishing
`0.3` yields `0.3` rather than the `0.30000000000000004` a double round-trip
would produce. Where a provider's exact precision matters, the value should be
carried as text from the source onward and parsed here. **No current caller does
that**, and no document may describe the number path as recovering original
precision.

### 4.3 The two entry points

| | Accepts | Refuses | Used by |
| --- | --- | --- | --- |
| `parseCanonicalDecimal` | broad source syntax — `2.50`, `02.5`, `+2.5`, `2.5e0` | anything not a decimal; **negative zero** | external and provider text |
| `canonicalDecimalFromNumber` | a finite JavaScript number | non-finite; negative zero; magnitudes beyond 38 digits | values already reduced to a double |
| `isCanonicalDecimal` | the canonical spelling only | every other spelling | internal constructors and assertions |

The parser normalizes; the constructor does not. External text is normalized
once at the edge, and everything inward carries a `CanonicalDecimal`. `-0` is
**refused by both** rather than normalized to `0`: numeric identity has no
negative zero, and quietly agreeing with a source that sent one is how a
boundary stops being a boundary.
