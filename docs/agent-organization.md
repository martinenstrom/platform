# The investment organization — roster mapping

How the eleven-agent prototype in `services/investmentLetter` maps onto the
institutional organization defined in `domain/analysis`.

**Documentation only.** No code changes, no storage, no LLM, no route or UI
change, and the legacy pipeline keeps running untouched.

The mapping is deliberately **not** eleven agents becoming eleven agents. The
prototype was a sequential chain with no managers, no verification and no
separation between compliance and risk. The organization it maps onto is a
firm.

---

## 1. What the prototype actually contains

Eleven roles, chained `News → Flow → Macro → Equity → Valuation → Portfolio →
Quant → Devil's Advocate → CIO → Editorial → Compliance`, each awaiting the
previous and threading one accumulating context.

Three gaps matter more than anything the mapping moves around:

**There is no Verification / Fact Checker.** The role that the new architecture
makes mandatory — nothing reaches the CIO before it approves — does not exist
in the prototype at all. It is new, not migrated.

**Compliance and Risk are one role.** `compliance-risk-officer` produces
`ComplianceReviewOutput { checklist, approved, disclaimer, notes }` — pure
publication compliance. The "Risk" half was never implemented. The Chief Risk
Officer is therefore also new, and the split is not a reorganisation of
existing work but the creation of work that was never done.

**There is no middle management.** All eleven sit in one flat chain. Every
manager role below is new.

Two smaller notes: `QuantOutput` is literally `{ charts: ChartSpec[] }`, so the
Quant role is a name with almost nothing behind it; and there is no Behavioural
Finance role, with `FlowIntelligenceOutput` covering positioning and risk
regime but not crowd psychology.

---

## 2. Departments

Fourteen departments. Specialist units are departments so a playbook entry can
target them; the hierarchy comes from `reportsTo` between employees, which is
how `domain/analysis/organization.ts` was designed to express it.

| Department                   | Manager role               | Governance | Handles                               |
| ---------------------------- | -------------------------- | ---------- | ------------------------------------- |
| `executive`                  | Chief Investment Officer   | —          | (none — decides, does not contribute) |
| `research-office`            | Research Director          | —          | `aggregation`                         |
| `global-macro`               | Head of Macro              | —          | `macro`, `rates`, `fx`, `policy`      |
| `equity-research`            | Head of Equity Research    | —          | `equity`, `valuation`, `fundamentals` |
| `quant-technical`            | Head of Quant & Technical  | —          | `quant`, `technical`, `statistics`    |
| `market-intelligence-office` | Market Intelligence Mgr    | —          | `synthesis`, `regime`                 |
| `news-intelligence`          | Head of News Intelligence  | —          | `news`, `filings`, `events`           |
| `flow-positioning`           | Head of Flow & Positioning | —          | `flows`, `positioning`, `liquidity`   |
| `behavioural-finance`        | Head of Behavioural Fin.   | —          | `sentiment`, `psychology`             |
| `portfolio-strategy`         | Portfolio Strategy Manager | —          | `portfolio`, `allocation`, `sizing`   |
| `risk`                       | Chief Risk Officer         | **yes**    | `risk`, `stress`, `tail-risk`         |
| `devils-advocate`            | Head of Devil's Advocate   | **yes**    | `challenge`                           |
| `verification`               | Head of Verification       | **yes**    | `verification`                        |
| `compliance`                 | Head of Compliance         | **yes**    | `compliance`, `disclosure`            |
| `editorial`                  | Editorial Director         | —          | `editorial`, `publication`            |

## 3. Reporting lines

```
CIO (executive)
├── Research Director .............. Global Macro, Equity Research, Quant & Technical
├── Market Intelligence Manager .... News Intelligence, Flow & Positioning, Behavioural Finance
├── Portfolio Strategy Manager ..... Portfolio Management
├── Editorial Director ............. Editorial
└── governance, independent:
    ├── Chief Risk Officer
    ├── Head of Devil's Advocate
    ├── Head of Verification
    └── Head of Compliance
```

**On the independence of governance.** `validateOrganization` requires every
employee to report up to the chief, so the four governance heads report to the
CIO structurally. That is not subordination in the sense that matters: none of
them sits under Research, Portfolio Strategy or any team rewarded for upside,
and each holds `canBlockPublication: true`, which `buildRole` permits only for
`governance` roles. The Chief Risk Officer in particular reports past the desks
whose work it reviews — which is the independence the requirement asks for.

---

## 4. The mapping

| Legacy role               | Department                   | Team            | Role type  | Reports to              | Disposition               |
| ------------------------- | ---------------------------- | --------------- | ---------- | ----------------------- | ------------------------- |
| News Intelligence Analyst | `news-intelligence`          | —               | specialist | Market Intelligence Mgr | **retained**              |
| Flow Intelligence Analyst | `flow-positioning`           | —               | specialist | Market Intelligence Mgr | **split**                 |
| — (new)                   | `behavioural-finance`        | —               | specialist | Market Intelligence Mgr | **new** (split from Flow) |
| Global Macro Strategist   | `global-macro`               | —               | specialist | Research Director       | **retained**              |
| Equity Strategist         | `equity-research`            | Market & sector | specialist | Research Director       | **merged**                |
| Valuation Specialist      | `equity-research`            | Valuation       | specialist | Research Director       | **merged**                |
| Quant & Data Scientist    | `quant-technical`            | —               | specialist | Research Director       | **renamed + expanded**    |
| Portfolio Strategist      | `portfolio-strategy`         | —               | specialist | Portfolio Strategy Mgr  | **retained**              |
| Devil's Advocate          | `devils-advocate`            | —               | governance | CIO                     | **retained, elevated**    |
| — (new)                   | `verification`               | —               | governance | CIO                     | **new**                   |
| Compliance & Risk Officer | `compliance`                 | —               | governance | CIO                     | **split**                 |
| — (from the above split)  | `risk`                       | —               | governance | CIO                     | **split → new work**      |
| Chief Investment Officer  | `executive`                  | —               | executive  | —                       | **retained, narrowed**    |
| Editorial Director        | `editorial`                  | —               | editorial  | CIO                     | **retained**              |
| — (new)                   | `research-office`            | —               | manager    | CIO                     | **new**                   |
| — (new)                   | `market-intelligence-office` | —               | manager    | CIO                     | **new**                   |
| — (new)                   | `portfolio-strategy`         | —               | manager    | CIO                     | **new**                   |

### Inputs, work products and dependencies

| Department                   | Required inputs                              | Work product                                  | Upstream              | Downstream               |
| ---------------------------- | -------------------------------------------- | --------------------------------------------- | --------------------- | ------------------------ |
| `news-intelligence`          | news evidence, filings, official releases    | claims: material events, signal vs noise      | —                     | macro, equity, MI office |
| `flow-positioning`           | flow, positioning, liquidity evidence        | claims: regime, crowding, confirmation        | news                  | MI office, risk          |
| `behavioural-finance`        | sentiment evidence, positioning              | claims: sentiment as evidence, not thesis     | flow                  | MI office                |
| `global-macro`               | yields, curves, policy state, FX             | claims: regime, policy vs market pricing      | news                  | equity, quant, MI office |
| `equity-research`            | fundamentals, filings, macro claims          | claims + a **thesis proposal**                | macro                 | portfolio, quant         |
| `quant-technical`            | series, breadth, volatility, macro claims    | claims: statistical & technical evidence      | macro                 | equity, portfolio, risk  |
| `portfolio-strategy`         | theses, exposure, correlation                | claims: portfolio impact, sizing              | equity, quant         | risk, CIO                |
| `market-intelligence-office` | claims from the three MI desks               | **aggregated** regime view                    | MI desks              | CIO                      |
| `research-office`            | claims from the three research desks         | **aggregated** research view, reconciliation  | research desks        | governance, CIO          |
| `risk`                       | theses, portfolio claims                     | `RiskReview` — downside, limits, tail risk    | portfolio             | CIO (may block)          |
| `devils-advocate`            | theses and their claims                      | `Challenge[]` + optionally a competing thesis | aggregation           | CIO (may block)          |
| `verification`               | every material claim and its evidence        | `VerificationReview` + findings               | aggregation           | CIO (may block)          |
| `compliance`                 | the draft                                    | `ComplianceReview`                            | editorial             | publication (may block)  |
| `editorial`                  | the CIO decision                             | published material, no new conclusions        | CIO                   | compliance               |
| `executive`                  | verified, challenged, aggregated conclusions | `CaseDecision`                                | governance + managers | editorial                |

### Notable dispositions

**Flow Intelligence splits.** The legacy role carried `capitalInflows`,
`positioningOverheated` _and_ `riskRegime` — measurable flow data and a
psychological read in one output. Flow & Positioning keeps the measurable part;
Behavioural Finance takes sentiment and crowd psychology, with the standing
rule that sentiment is evidence and never a standalone thesis.

**Equity Strategist and Valuation Specialist merge** into `equity-research`
with two teams. In the prototype they were sequential stages passing prose; in
a firm they are one desk, and their outputs feed the same thesis.

**Quant & Data Scientist is renamed and expanded** to Quant & Technical
Analysis — one combined team, per the permanent requirement. Its legacy output
was one chart array; its mandate now covers factor and volatility analysis,
regime detection, breadth, backtesting, and the full technical stack. Elliott
Wave and Fibonacci are representable only as `Responsibility.interpretive =
true`, never as objective measurement.

**The CIO narrows.** `CIOOutput` had the CIO producing `marketRegime`,
`mainScenario`, `alternativeScenarios`, `topRisks` and `topOpportunities` — the
CIO was doing analysis. In the new organization the CIO consumes verified and
challenged conclusions and produces a `CaseDecision`. The analysis moves down
to the desks and the aggregation to the managers.

**The Devil's Advocate is elevated.** Legacy output was four prose arrays. It
now produces structured `Challenge` records with counter-evidence, may propose
a competing thesis, and can block.

---

## 5. Phase C playbook — the Macro case

The minimum viable **institutional** workflow. Not one agent, and not eleven.

The point of Phase C is to prove the whole chain end to end, which means it must
contain at least one specialist, a manager aggregation, both mandatory
governance functions, and a CIO decision. Dropping any of those would leave the
most distinctive part of the architecture untested.

**Playbook `macro-regime-review`, version `1.0.0`, caseKind `macro`**

| key                | department        | required | dependsOn        | brief                                             |
| ------------------ | ----------------- | -------- | ---------------- | ------------------------------------------------- |
| `macro-analysis`   | `global-macro`    | **yes**  | —                | Regime read: policy stance against market pricing |
| `quant-validation` | `quant-technical` | no       | `macro-analysis` | Statistical corroboration of the regime claim     |
| `aggregation`      | `research-office` | **yes**  | `macro-analysis` | Reconcile, prioritise, propose the thesis         |
| `verification`     | `verification`    | **yes**  | `aggregation`    | Verify every number, unit, citation and date      |
| `challenge`        | `devils-advocate` | **yes**  | `aggregation`    | Contest the thesis with counter-evidence          |
| `risk-review`      | `risk`            | no       | `aggregation`    | Downside and adverse scenarios                    |

**The CIO decision is not a playbook entry.** The CIO does not contribute; it
decides. The decision is taken when `evaluateThesisEligibility` reports the
revision eligible, and produces a `CaseDecision` — outside the orchestration
graph by design.

**Compliance and Editorial are deliberately absent from Phase C.** They gate
_publication_, and Phase C's exit is the institutional decision, not a
published letter. Adding them would expand the phase without testing anything
the other four governance interactions do not already cover.

**Why quant and risk are optional.** Neither blocks the chain, so a Phase C
that ships with only the macro desk wired still completes — but their absence
is visible in the decision record, and a later review may judge it material.
Optional is not irrelevant.

The evidence for this playbook already exists at institutional quality: US,
German and Swedish government yields, the US par curve, Fed / ECB / Riksbank
policy state, and FX. That is why Macro is the right first agent.

---

## 6. Workload estimates

For the durable-storage decision. Phase C is **one live agent** on the macro
playbook above.

### Per case

| Artifact                | Conservative | Normal | Upper bound |
| ----------------------- | ------------ | ------ | ----------- |
| Thesis revisions        | 1            | 2      | 5           |
| Assignments             | 6            | 6      | 6           |
| Contribution runs       | 6            | 8      | 15          |
| EvidenceSets            | 1            | 2      | 4           |
| Claims per contribution | 4            | 8      | 25          |
| Claims per case         | ~25          | ~65    | ~375        |
| Review records          | 2            | 3      | 6           |
| Activity events         | ~35          | ~55    | ~140        |
| CaseDecisions           | 1            | 1      | 1           |
| Immutable results       | 6            | 8      | 15          |

Activity events are the largest count: roughly four run-state transitions per
run, plus case and thesis transitions.

### Case volume

|              | Cases                | Basis                                              |
| ------------ | -------------------- | -------------------------------------------------- |
| Conservative | 1 / week             | a weekly macro review, nothing else                |
| Normal       | 4 / week             | weekday cadence plus ad-hoc                        |
| Upper bound  | 20 / day (~5,000/yr) | a case per instrument, daily — well beyond Phase C |

### Annual totals

| Artifact          | Conservative | Normal  | Upper bound |
| ----------------- | ------------ | ------- | ----------- |
| Cases             | 52           | 208     | 5,000       |
| Thesis revisions  | 52           | 416     | 25,000      |
| Runs              | 312          | 1,664   | 75,000      |
| EvidenceSets      | 52           | 416     | 20,000      |
| Claims            | ~1,300       | ~13,500 | ~1,875,000  |
| Review records    | 104          | 624     | 30,000      |
| Activity events   | ~1,800       | ~11,400 | ~700,000    |
| Immutable results | 312          | 1,664   | 75,000      |

### Size

EvidenceSets dominate: each holds full normalized domain objects with
provenance. A macro set — yields, curve, three policy states, FX — is roughly
20–50 KB.

|              | EvidenceSet data | Everything else | Total / year |
| ------------ | ---------------- | --------------- | ------------ |
| Conservative | ~2 MB            | ~2 MB           | **~4 MB**    |
| Normal       | ~20 MB           | ~15 MB          | **~35 MB**   |
| Upper bound  | ~1 GB            | ~600 MB         | **~1.6 GB**  |

### What this means for storage

**The dataset is small.** Even the upper-bound scenario — well beyond anything
Phase C will produce — is under two million rows in the largest table and under
two gigabytes on disk, per year.

That rules a great deal out. There is no scale argument for a distributed
store, a document database chosen for write throughput, or anything exotic. The
selection should turn entirely on **shape**: relational reporting lines,
case/thesis/review joins, append-only events, transactional consistency across
an aggregate, and the headquarters read-model queries — not on volume.

Retention is worth noting the other way round: at these sizes there is no
pressure to delete anything, which suits a record whose whole purpose is to
remain auditable years later.

---

## 7. What is preserved from the prototype, and what is not

**Preserved:** the eleven roles and their responsibilities, the output concepts
worth keeping, the compliance checklist rules, and the editorial flow.

**Not preserved:** the sequential eleven-await implementation, the accumulating
mutable context, the prose-only output contracts, the implicit dependencies,
and the absence of failure isolation.

`services/investmentLetter` is not modified. It is replaced by the Agents route
migration (TD-16), not by this mapping.
