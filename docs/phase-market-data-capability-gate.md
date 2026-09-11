# Market Data Capability Gate — institutional-priority instruments

**Status: ANALYSIS ONLY, CORRECTED. Nothing implemented, no provider added, no fixture constant changed. §3 supersedes the first draft's recommendations: accessibility was mistaken for permission.**

Written after the disclosure layer was frozen. The product is now honest about
serving fixture data; this gate asks what it would take to stop serving it for
the seven instruments that matter most.

Scope: S&P 500, DAX, Nasdaq 100, FTSE 100, Nikkei 225, Brent, Gold.

---

## 0. What the code already decides for us

Three properties of the existing architecture constrain every option below, and
two of them turn out to be unusually well suited to this problem.

**Trust is a tier, and a chain is only as strong as its weakest link.**
`ProviderTrust` runs `issuer | central-bank | official-statistics | exchange`
(tier 1) → `licensed-vendor | broker` (2) → `aggregator` (3) → `derived` (4) →
`synthetic` (5), and `effectiveTrust(route, originator)` returns the _weaker_ of
the two. A vendor republishing an index does not become the index owner. This
means the honest ceiling for most candidates below is tier 2–3, and the model
already expresses that without anyone arguing about it.

**`isProxy` + `proxyNote` exist.** The provenance model already carries "a
different instrument stood in for the requested one, and here is what". That
matters more than it looks: the cheapest legal route to several of these
instruments is a _proxy_, and the disclosure surface built in the last pass
would render it correctly on the day it lands.

**Providers are thin.** They do not retry, cache, or fall back — the pipeline
owns that, and the chain config already supports `['live', 'fixture']`. Adding a
provider is genuinely additive; the fallback truth layer stays exactly where it
is.

**A caveat that is already documented in the code**: daily budgets are counted
per instance, and `config.ts` warns that a multi-instance deployment will exceed
its quota until a shared cache store exists. Any quota figure below is a
single-instance figure.

---

## 1. The constraint that dominates this gate, and it is not technical

**Five of the seven instruments are not data. They are licensed intellectual
property.**

| Index      | Owner                      |
| ---------- | -------------------------- |
| S&P 500    | S&P Dow Jones Indices      |
| Nasdaq 100 | Nasdaq, Inc.               |
| DAX        | ISS STOXX / Deutsche Börse |
| FTSE 100   | FTSE Russell (LSEG)        |
| Nikkei 225 | Nikkei Inc.                |

Redistributing a real-time index **level** — showing it in a product, to
someone who is not the licence holder — requires a licence from the index owner,
usually on top of a vendor agreement. This is why so many cheap APIs either omit
indices entirely, expose them only as delayed or end-of-day values, or quietly
serve an ETF and call it the index.

The practical consequences for this product:

- **Real-time index levels are not cheaply obtainable, at any technical quality
  of implementation.** No amount of provider engineering changes that.
- **Delayed and end-of-day are a different commercial tier** and are usually
  where a small firm can actually operate.
- Nikkei 225 is the strictest of the five by reputation; assume it is the
  hardest and most expensive, and plan for it to stay unsourced longest.

Brent and Gold are different in kind, and the first draft of this gate treated
that difference too generously. The underlying benchmarks are administered and
licensed here too — ICE for Brent futures, IBA/LBMA for the Gold Price — and
the existence of a statistical republication does **not** by itself carry a
right to display it. **§3 corrects this**; read it before acting on anything in
this section.

> Everything in this section is a legal and commercial question, not an
> engineering one. It should be confirmed with the index owners or a vendor's
> licensing desk before any contract is signed. Nothing here is legal advice.

---

## 2. Per-instrument assessment

Freshness classes below map onto the existing `Quality` union: `realtime`,
`near-realtime`, `delayed`, `eod`, `official-daily`, `fixture`.

### 2.1 S&P 500

|                   |                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Candidates        | FRED (`SP500`); commercial vendors (Twelve Data, EODHD, Polygon, Tiingo, Marketstack); institutional feeds (LSEG, ICE, Bloomberg)                            |
| Source class      | FRED = official-statistics **route**, S&P DJI **originator** → effective trust 2–3                                                                           |
| Freshness         | FRED: daily close, published with roughly a one-day lag → `eod` at best, arguably `official-daily`                                                           |
| Licensing         | FRED republishes under agreement with S&P DJI and attaches copyright terms; **read them before redistributing**. Real-time requires an S&P licence           |
| Quota             | FRED: free, API key, historically generous (order of ~120 req/min) — verify                                                                                  |
| Auth              | FRED API key (free registration)                                                                                                                             |
| Cost              | Free at FRED; real-time via vendor materially more                                                                                                           |
| History           | FRED: about a decade of daily closes                                                                                                                         |
| Reliability       | High. Government-operated, stable API, well-documented                                                                                                       |
| Architectural fit | **Excellent.** Same shape as the existing `usTreasury` provider: one observation per business day, no intraday invention, `originator` field carries S&P DJI |

### 2.2 Nasdaq 100

|                     |                                                                               |
| ------------------- | ----------------------------------------------------------------------------- |
| Candidates          | FRED (`NASDAQ100`); Nasdaq Data Link; commercial vendors                      |
| Source class        | Same pattern as S&P 500 — official route, index-owner originator              |
| Freshness           | Daily close with a lag → `eod`                                                |
| Licensing           | Nasdaq owns the index; real-time redistribution licensed. Delayed/EOD cheaper |
| Quota / auth / cost | As FRED above                                                                 |
| History             | Good daily history                                                            |
| Architectural fit   | Excellent, identical to S&P 500                                               |

### 2.3 DAX

|                   |                                                                                                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidates        | Commercial vendors; Deutsche Börse market-data services (the origin); possibly a Bundesbank time series — **unverified, check before relying on it**                                                                                                       |
| Source class      | Deutsche Börse = `exchange`/issuer (tier 1) but commercial; vendors tier 2–3                                                                                                                                                                               |
| Freshness         | Vendor delayed/EOD realistic; real-time requires a licence from the exchange                                                                                                                                                                               |
| Licensing         | ISS STOXX / Deutsche Börse licensing. **DAX is a total-return index by default** — the widely quoted figure is the performance index, and the price index is a different series. Getting the wrong one is a silent correctness defect, not a licensing one |
| Quota / cost      | Vendor-dependent                                                                                                                                                                                                                                           |
| Architectural fit | Good, but the index-variant question must be settled in the provider, and recorded — the codebase already does this for yields via `methodology`                                                                                                           |

### 2.4 FTSE 100

|                   |                                                                                  |
| ----------------- | -------------------------------------------------------------------------------- |
| Candidates        | Commercial vendors; FTSE Russell / LSEG directly                                 |
| Source class      | LSEG = licensed vendor / index owner                                             |
| Freshness         | Delayed or EOD from vendors                                                      |
| Licensing         | FTSE Russell licensing; LSEG's commercial terms are not economical at this scale |
| Architectural fit | Good; same shape as the others                                                   |

### 2.5 Nikkei 225

|                   |                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Candidates        | Nikkei Inc. directly; a small number of licensed vendors                                                   |
| Source class      | Nikkei Inc. = issuer                                                                                       |
| Freshness         | Vendor-dependent                                                                                           |
| Licensing         | **The most restrictive of the five.** Nikkei licenses the index tightly, including for derivative products |
| Cost              | Expect it to be the worst value of the seven                                                               |
| Architectural fit | Fine technically; the obstacle is entirely commercial                                                      |
| Recommendation    | **Leave fixture-backed longest.** Sourcing it is a procurement project, not a sprint                       |

### 2.6 Brent

|                   |                                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidates        | **EIA API** (Europe Brent Spot Price FOB) — free, official; FRED (`DCOILBRENTEU`, sourced from EIA); ICE for the futures benchmark                                               |
| Source class      | **EIA = `official-statistics`, tier 1** — the strongest realistic option in this whole gate                                                                                      |
| Freshness         | Daily spot, published with a lag of days → `official-daily`. **Not** the front-month futures price a trader would quote                                                          |
| Licensing         | US government data, public domain. No redistribution obstacle                                                                                                                    |
| Quota             | Free API key, generous                                                                                                                                                           |
| Auth              | EIA API key (free)                                                                                                                                                               |
| Cost              | Zero                                                                                                                                                                             |
| History           | Decades                                                                                                                                                                          |
| Reliability       | High                                                                                                                                                                             |
| Architectural fit | **Excellent — the best fit here.** Directly analogous to `usTreasury`: a government agency publishing an official daily series, no key cost, no licensing risk                   |
| Caveat            | The spot series is _not_ the ICE Brent front-month contract. Presenting one as the other would be exactly the substitution the `methodology`/`proxyNote` fields exist to prevent |

### 2.7 Gold

|                   |                                                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidates        | LBMA / ICE Benchmark Administration (the auction benchmark); FRED historical LBMA series — **note some LBMA series on FRED were discontinued, verify current availability**; FX-style spot XAU/USD from a metals or FX vendor |
| Source class      | LBMA/IBA = administrator (tier 1–2); vendors tier 2–3                                                                                                                                                                         |
| Freshness         | LBMA price is an auction fixed **twice daily** (AM/PM London) → `official-daily`, not a spot tick                                                                                                                             |
| Licensing         | LBMA data has licensing terms for commercial redistribution; historical access has been freer than real-time                                                                                                                  |
| Architectural fit | Good, with the same honesty requirement as Brent: an auction fix is not a spot quote, and the two must not be interchangeable in the model                                                                                    |

---

## 3. Correction — accessibility was mistaken for permission

**The first version of §3 recommended implementing FRED `SP500` and
`NASDAQ100`, and described LBMA gold alongside EIA Brent as free official
data. Both recommendations were wrong, and wrong in the same way.**

They inferred a right to display from the existence of an endpoint. An API that
returns a number tells you the number is _obtainable_. It tells you nothing
about whether this product may show it to a reader.

The distinction that has to hold from here:

```
transport / provider      how the number reaches us          FRED, EIA, a vendor
originator                who computed the observation       S&P DJI, Reuters, IBA
benchmark / IP owner      who owns the thing being quoted    S&P DJI, LBMA, Nikkei
display right             may Financial OS render it         a separate question
redistribution right      may Financial OS serve it onward   a further separate question
```

Those five are independent. A public-domain transport can carry a copyrighted
originator's series; an official statistical agency can republish a commercial
vendor's price. **Neither launders the underlying right.**

The corrected position on the two specific claims:

- **FRED `SP500` and `NASDAQ100` carry an explicit copyright notice from the
  index owner** stating that reproduction requires prior written permission.
  FRED is the transport; S&P DJI and Nasdaq remain the IP owners. Whether this
  product may display those series is **REQUIRES CONFIRMATION**, and the
  default assumption must be _no_ until it is confirmed in writing.
- **The LBMA Gold Price is not free official data.** IBA administers the
  auction, LBMA owns the intellectual property, and licensing applies to
  redistribution and to valuation/pricing use. Notably, FRED's LBMA gold series
  were **discontinued rather than maintained** — which is evidence about the
  licensing position, not an accident of housekeeping.

---

## 4. Rights-aware source matrix

Split into identity and rights because the second table is the one that decides
anything. `REQUIRES CONFIRMATION` is used wherever a right is not explicitly
established; it is never used to mean "probably fine".

### 4.1 Source identity

| Displayed instrument    | Exact series                                                                                                                       | Transport / API     | Underlying originator                                                                        | Benchmark / IP owner                                                    | Frequency            | Delay                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------- | -------------------------- |
| S&P 500                 | FRED `SP500` (index close)                                                                                                         | FRED API            | S&P Dow Jones Indices                                                                        | S&P Dow Jones Indices                                                   | Daily, business days | ~1 day · **CONFIRM**       |
| Nasdaq 100              | FRED `NASDAQ100`                                                                                                                   | FRED API            | Nasdaq, Inc.                                                                                 | Nasdaq, Inc.                                                            | Daily, business days | ~1 day · **CONFIRM**       |
| DAX                     | No free route identified                                                                                                           | —                   | Deutsche Börse                                                                               | ISS STOXX / Deutsche Börse                                              | —                    | —                          |
| FTSE 100                | No free route identified                                                                                                           | —                   | FTSE Russell                                                                                 | FTSE Russell (LSEG)                                                     | —                    | —                          |
| Nikkei 225              | No free route identified                                                                                                           | —                   | Nikkei Inc.                                                                                  | Nikkei Inc.                                                             | —                    | —                          |
| Brent (spot)            | EIA _Europe Brent Spot Price FOB_, daily (legacy id `PET.RBRTE.D`; API v2 under petroleum spot prices — **CONFIRM exact v2 path**) | EIA API v2          | **EIA republishing a commercial compiler — historically Thomson Reuters/Refinitiv. CONFIRM** | ICE owns the _futures_ benchmark; the spot assessment is the compiler's | Daily, business days | Several days · **CONFIRM** |
| Gold (benchmark)        | LBMA Gold Price AM/PM                                                                                                              | IBA / LBMA          | IBA (administrator)                                                                          | **LBMA**                                                                | Twice daily auction  | Same day                   |
| Gold (statistical alt.) | World Bank _Pink Sheet_ / IMF Primary Commodity Prices — gold                                                                      | World Bank / IMF    | World Bank / IMF compilation                                                                 | —                                                                       | **Monthly average**  | Weeks                      |
| Gold (commercial)       | Spot XAU/USD                                                                                                                       | Metals or FX vendor | Vendor aggregation                                                                           | —                                                                       | Intraday             | Vendor-dependent           |

### 4.2 Rights

| Instrument              | Display right                                                                            | Redistribution right                       | Commercial use            | Attribution required                                       | Confidence                                          | Recommended action                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------- | ---------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S&P 500 (FRED)          | **REQUIRES CONFIRMATION** — copyright notice states permission needed                    | **REQUIRES CONFIRMATION**, assume no       | **REQUIRES CONFIRMATION** | Yes — S&P DJI                                              | HIGH that a notice applies; UNKNOWN what it permits | **Do not implement.** Obtain written position from S&P DJI or a licensed vendor first                                                                               |
| Nasdaq 100 (FRED)       | **REQUIRES CONFIRMATION**                                                                | **REQUIRES CONFIRMATION**, assume no       | **REQUIRES CONFIRMATION** | Yes — Nasdaq                                               | MEDIUM–HIGH                                         | **Do not implement.** Same path as S&P 500                                                                                                                          |
| DAX                     | Licence required                                                                         | Licence required                           | Licensed only             | Yes                                                        | HIGH                                                | Procurement question; stays fixture-backed                                                                                                                          |
| FTSE 100                | Licence required                                                                         | Licence required                           | Licensed only             | Yes                                                        | HIGH                                                | Procurement question; stays fixture-backed                                                                                                                          |
| Nikkei 225              | Licence required, most restrictive of the five                                           | Licence required                           | Licensed only             | Yes                                                        | HIGH                                                | Stays fixture-backed longest                                                                                                                                        |
| Brent — EIA spot        | Likely permitted (US federal work) **but see originator**                                | Likely permitted **for EIA's own content** | Likely permitted          | EIA attribution expected; **compiler attribution UNKNOWN** | MEDIUM — the compiler question is unresolved        | **Strongest candidate, but confirm the originator before implementing.** If the series is compiled by a commercial vendor, that vendor's terms — not EIA's — govern |
| Gold — LBMA benchmark   | **Licence required**                                                                     | **Licence required**                       | Licensed                  | Yes — LBMA/IBA                                             | HIGH                                                | **Do not implement as "free official data".** Reclassified from the previous draft                                                                                  |
| Gold — World Bank / IMF | Open licence (World Bank commodity data is CC BY 4.0 — **CONFIRM the specific dataset**) | Likely permitted with attribution          | Permitted                 | Yes                                                        | MEDIUM                                              | Usable, **but it is a monthly average — a different instrument from a daily fix and not a substitute for one**                                                      |
| Gold — commercial spot  | Per vendor contract                                                                      | Per vendor contract                        | Per vendor contract       | Per contract                                               | UNKNOWN until a vendor is chosen                    | Viable if a vendor is engaged                                                                                                                                       |

### 4.3 What changed from the first draft

| Instrument | Was                                        | Now                                                                                                                                              |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| S&P 500    | "Tier 2 — do it, free, one key"            | **Do not implement** pending written rights position                                                                                             |
| Nasdaq 100 | "Tier 2 — do it"                           | **Do not implement** pending written rights position                                                                                             |
| Gold       | "Tier 1 — free official, `official-daily`" | **Licensed benchmark.** Only a monthly statistical series is openly reusable, and it is a different instrument                                   |
| Brent      | "Tier 1 — the best fit, zero risk"         | **Still the strongest candidate**, but downgraded to _confirm the originator first_: EIA appears to republish a commercially compiled assessment |

---

## 5. Revised recommendation

**Nothing in the institutional-priority set is currently clear to implement.**

That is the honest output of this gate, and it is not a failure: the product is
already honest about being fixture-backed, so the cost of waiting is zero, while
the cost of shipping an unlicensed index is a legal exposure that no disclosure
marker cures.

Ordered by how close each is to being actionable:

1. **Brent (EIA)** — one unresolved question: who actually compiles the spot
   assessment. If EIA's own, implement; if a commercial compiler, that
   compiler's terms govern and the route needs re-evaluating. **Answer this
   first — it is the cheapest question in the gate and unlocks the best
   candidate.**
2. **Gold** — decide _which gold_ the firm means. A monthly World Bank average
   is openly reusable and honest; it is not a daily benchmark and must never be
   labelled as one. A daily benchmark requires an LBMA/IBA licence.
3. **S&P 500 / Nasdaq 100** — obtain a written position from the index owner or
   buy through a vendor whose licence covers display in a product like this.
   The FRED route is a transport convenience, not a rights answer.
4. **DAX, FTSE 100, Nikkei 225** — procurement only.

---

## 6. Where licensing metadata belongs — analysis, no fields added

The instinct is to add `licensingStatus` to `Provenance`. **Recommend against
it**, for a reason the existing model makes clear.

`Provenance` describes _one observation_: when it was seen, by whom, how good
it is. Licensing is not a property of an observation — every observation in a
series shares it, and it changes when a contract is signed, not when a price
moves. Putting it there would transmit a constant on every row and imply a
variability that does not exist.

The three candidate homes, assessed:

| Home                       | Fits?      | Why                                                                                                                                     |
| -------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime `Provenance`       | **No**     | Not an observation property; constant per series; would imply per-observation variability                                               |
| Provider registry metadata | **Partly** | Right granularity — licence attaches to a (provider, series) pair — but the registry is code, and rights are not a property of the code |
| Deployment configuration   | **Yes**    | Rights are a property of _this deployment's agreements_. Two deployments of identical code can hold different licences                  |

**Recommended shape, when the time comes:** a _licence gate in the provider
chain_, expressed in configuration alongside the existing
`MARKETDATA_CHAIN_*` variables. A series the deployment is not licensed for
simply does not resolve — the chain falls through to fixture, and the
disclosure layer already renders that correctly as `EJ MARKNADSDATA`.

That has three properties worth having:

- it reuses the fallback truth layer instead of inventing a second one
- an unlicensed series **cannot** be displayed by accident, because it never
  reaches the presentation layer at all
- the licence question is answered where it actually lives — in the
  deployment's configuration — rather than baked into a build

Attribution is the one licensing-adjacent thing that _does_ belong near the
observation, and it already has a home: `DataSourceMetadata.providerName` and
`originator` are exactly the fields an attribution line would render from.

**No fields are added by this gate.** This section records the analysis so the
decision is not re-argued when implementation starts.

---

## 7. Acquisition plan — from fixture-backed to covered

**Objective changed by ruling.** Documenting why data cannot be shown is not the
end state. `EJ MARKNADSDATA` is a fail-safe for a source that fails or has not
been cleared; it is not an acceptable steady state for a core instrument. This
section is an acquisition plan, not an audit.

### 7.1 The intended use case, stated explicitly

**Private/internal display inside a single-operator Financial OS instance.** Not
public redistribution, not resale, not a commercial data product.

This is recorded because it changes which products are appropriate: several
vendors price and licence personal/internal use separately from commercial
redistribution, and the cheaper tier is the correct one to evaluate — provided
nothing later turns the instance into a public surface without revisiting it.

Neither inference is made here: internal use is not assumed to be automatically
permitted, and redistribution restrictions are not assumed to prohibit private
display.

### 7.2 What already works — preserve

Seven of the fourteen core instruments already resolve from real sources. No
correctness problem is known in any of them.

| Instrument       | Provider          | Trust        | Quality        |
| ---------------- | ----------------- | ------------ | -------------- |
| OMXS30           | Avanza            | broker       | delayed        |
| USD/SEK, EUR/USD | Frankfurter (ECB) | central-bank | eod            |
| US 10Y           | US Treasury       | issuer       | official-daily |
| German 10Y       | Bundesbank        | central-bank | official-daily |
| Swedish 10Y      | Riksbank          | central-bank | official-daily |
| Bitcoin          | CoinGecko         | aggregator   | near-realtime  |

### 7.3 The gap — seven instruments

S&P 500, Nasdaq 100, DAX, FTSE 100, Nikkei 225, Brent, Gold.

### 7.4 Candidates evaluated

**Twelve Data** — free Basic (800 req/day, 8/min; real-time US equities/ETFs,
FX, crypto), Grow **$29/mo** (55 credits/min, unlimited daily, adds commodities
and end-of-day global equities/ETFs, 20+ markets), Pro $99, Ultra $329. Its
plan terms state access is for **"personal, internal, and non-commercial
purposes"** — language that matches this use case directly. Indices coverage
confirmed on their indices page for DAX, FTSE 100 and Nikkei 225 (N225);
**SPX/NDX symbol coverage should be confirmed on the free tier before paying**.

**EODHD** — free tier 20 calls/day; **EOD All World $19.99/mo** (100k calls/day,
1000/min); EOD+Intraday $29.99; All-in-one $99.99. Personal plans carry the
notice _"For commercial use, choose Startups & Enterprise Data Solution Plan"_,
which is an explicit personal-vs-commercial split. Index and commodity coverage
per tier is **not mapped on the pricing page and must be confirmed**.

**EIA** — free, API key, US federal. Terms permit use and distribution of EIA
data with attribution (_"Source: U.S. Energy Information Administration"_), with
exceptions for third-party protected material. Covers Brent spot only.

**Others considered and not recommended as primary**: Alpha Vantage (free tier
too small for a live dashboard), Stooq (free EOD, no clear licence — unsuitable
even for internal use as a primary), Yahoo endpoints (terms prohibit this),
Polygon/Databento/LSEG/Bloomberg (correct at institutional scale, wrong at this
one).

### 7.5 Recommended plan

**Step 1 — free, implement first: Brent via EIA.** One provider, free key,
public-domain terms with attribution, and structurally identical to the existing
`usTreasury` provider. Resolves one of the seven at zero cost.

**Step 2 — one subscription closes the remaining six.** Recommend **Twelve Data
Grow at $29/month**, on the strength of its written internal-use permission
rather than on price. EODHD at $19.99 is cheaper and allows far more calls, and
is the right choice **if** its index coverage checks out and its personal-plan
terms are confirmed to cover this use.

Both should be trialled on their free tiers first, against the actual symbols:
SPX, NDX, GDAXI, FTSE, N225, gold. **Do not subscribe before the symbols are
verified** — index coverage is exactly where cheap vendors are thin.

**Step 3 — proxies, only on an explicit ruling.** If SPX/NDX turn out to be
absent or licensed separately, the free Twelve Data tier already carries
real-time US ETFs, which means SPY and QQQ are available at no cost. That is a
_proxy_, it is materially not the index, and the architecture would render it
as one via `isProxy`/`proxyNote`. **Requires approval before use.**

**Step 4 — nothing stays fixture-backed by default.** After steps 1–2 the only
core instruments still on fixture would be any the chosen vendor does not carry.
Sectors, sentiment and intraday series remain fixture-backed; they are not in
the core set.

### 7.6 Provider chain shape

Per the ruling, the chain degrades through honesty levels rather than stopping
at fixture:

```
cleared real-time  →  delayed / official EOD  →  approved proxy  →  fixture
```

Each level is already representable: `Quality` distinguishes the first two,
`isProxy`/`proxyNote` the third, and the disclosure layer renders all four. No
new domain field is needed to express this, and a source failure still cannot
produce a number that looks live — the fail-closed behaviour is what the last
pass built.

### 7.7 Cost summary

| Category                    | Instruments                                          | Cost                         |
| --------------------------- | ---------------------------------------------------- | ---------------------------- |
| Already covered             | 7 of 14                                              | £0                           |
| Implement immediately, free | Brent (EIA)                                          | $0 + free key                |
| One subscription            | S&P 500, Nasdaq 100, DAX, FTSE 100, Nikkei 225, Gold | **$19.99–$29/month**         |
| Requires procurement        | real-time index licensing                            | not needed for this use case |

**Total to full core coverage: roughly $20–30 per month.** That is the headline
finding of this section, and it is a better answer than the previous draft's.

---

## 8. Free-source acquisition plan — superseding section 7

**Ruling: zero-cost sources only.** Section 7's recommendation of a paid
subscription is withdrawn. The objective is the best institutional stack
obtainable for $0 while staying honest about freshness, provenance and proxies.

A mixture of real-time, delayed, EOD and official-daily is accepted and is the
expected shape of the result.

### 8.1 Findings that decide the plan

**FRED cannot carry S&P 500 or Nasdaq 100 into this product as-is.** The
`SP500` series page carries a notice, quoted verbatim:

> Copyright (c) 2016, S&P Dow Jones Indices LLC. **Reproduction of S&P 500 in
> any form is prohibited except with the prior written permission of S&P Dow
> Jones Indices LLC ("S&P").**

It also names the route to permission: `index_services@spdji.com`. **Asking
costs nothing**, which makes this a zero-cost action rather than a dead end —
but it is a request, not an entitlement, and nothing should be built on the
series until an answer arrives.

**Stooq is the most promising free route to all five indices, and its terms
could not be verified.** It serves daily CSV for the major index symbols over a
plain URL interface. As of early 2026 it requires a key obtained via CAPTCHA and
enforces a daily hit limit. Its terms page returned no readable content when
fetched, so its permitted-use position is **UNKNOWN**. It must be read by a
human before use.

**EIA remains confirmed for Brent.** EIA's reuse page states U.S. government
publications are in the public domain and permits use and distribution of its
data, requesting attribution in the form "Source: U.S. Energy Information
Administration", with exceptions for third-party protected material such as
photographs and logos.

**Alpha Vantage's free tier is 25 requests/day.** Sufficient for once-daily EOD
polling of a handful of instruments, but its index coverage is not established
and the free tier is oriented to equities and ETFs.

**Twelve Data's free tier is genuinely usable — for ETFs.** 800 requests/day,
8/minute, covering real-time US equities and ETFs, FX and crypto, with plan
terms permitting "personal, internal, and non-commercial purposes". Indices are
not part of the free tier's markets. That makes it the cleanest **proxy** route,
not an index route.

**Avanza is already in the codebase and already trusted for OMXS30.** Its symbol
map is hand-curated with verified ISINs and refuses to guess. Whether Avanza's
instrument universe exposes international index order books, and whether a
broker's client API may serve them to a customer's private application, are both
**unverified**. It is the one candidate that would cost nothing new
operationally.

### 8.2 Category A — covered for $0 with the actual instrument

| Instrument       | Source                          | Series / symbol              | Freshness                        | Free limit         | Provenance                                          | Rights confidence                | Status                                         |
| ---------------- | ------------------------------- | ---------------------------- | -------------------------------- | ------------------ | --------------------------------------------------- | -------------------------------- | ---------------------------------------------- |
| OMXS30           | Avanza                          | order book id, ISIN-verified | delayed                          | broker API         | broker                                              | Precedent in use                 | **Working**                                    |
| USD/SEK, EUR/USD | Frankfurter (ECB)               | ECB reference rates          | eod                              | free, no key       | central-bank                                        | HIGH                             | **Working**                                    |
| US 10Y           | US Treasury                     | Daily Par Yield Curve        | official-daily                   | free, no key       | issuer                                              | HIGH                             | **Working**                                    |
| German 10Y       | Bundesbank                      | fitted zero rate             | official-daily                   | free               | central-bank                                        | HIGH                             | **Working**                                    |
| Swedish 10Y      | Riksbank                        | benchmark series             | official-daily                   | free               | central-bank                                        | HIGH                             | **Working**                                    |
| Bitcoin          | CoinGecko                       | bitcoin / USD                | near-realtime                    | keyless tier       | aggregator                                          | MEDIUM                           | **Working**                                    |
| **Brent**        | **EIA API v2**                  | Europe Brent Spot FOB, daily | official-daily, several days lag | free key, generous | official-statistics; compiler originator unresolved | **HIGH on terms**                | **Implement — the one clear win**              |
| Gold (monthly)   | World Bank Pink Sheet / IMF PCP | gold, monthly average        | monthly                          | free, open licence | official-statistics                                 | MEDIUM — confirm dataset licence | Real, but a monthly average is not a daily fix |

### 8.3 Category B — covered for $0 only through an explicit proxy

Requires approval. `isProxy: true` and a `proxyNote` naming the substitution.

| Displayed  | Proxy instrument      | Source           | Freshness | Free limit     | Rights confidence                            |
| ---------- | --------------------- | ---------------- | --------- | -------------- | -------------------------------------------- |
| S&P 500    | **SPY** ETF           | Twelve Data free | real-time | 800/day, 8/min | Terms permit personal/internal — MEDIUM-HIGH |
| Nasdaq 100 | **QQQ** ETF           | Twelve Data free | real-time | same           | same                                         |
| DAX        | US-listed Germany ETF | Twelve Data free | real-time | same           | same                                         |
| FTSE 100   | US-listed UK ETF      | Twelve Data free | real-time | same           | same                                         |
| Nikkei 225 | US-listed Japan ETF   | Twelve Data free | real-time | same           | same                                         |

**What a proxy actually costs in accuracy**: an ETF carries tracking difference,
management fees, its own currency, its own trading hours, and a premium or
discount to net asset value. A USD-denominated fund holding Japanese equities
moves with the Nikkei **plus** USD/JPY. That is not a detail; it is a different
number, and the `proxyNote` must say so.

### 8.4 Category C — not acceptably sourceable for $0 today

| Instrument                | Why                                                         | Fallback                                               |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| S&P 500 (actual index)    | FRED route explicitly prohibited without written permission | fixture, until permission or Stooq clears              |
| Nasdaq 100 (actual index) | Same                                                        | fixture                                                |
| DAX (actual index)        | No verified free route                                      | fixture                                                |
| FTSE 100 (actual index)   | No verified free route                                      | fixture                                                |
| Nikkei 225 (actual index) | No verified free route; strictest licensor                  | fixture                                                |
| Gold (daily benchmark)    | LBMA Gold Price is licensed                                 | fixture, or the monthly statistical series if accepted |

Per ruling, **no paid subscription is recommended for these**. Fixture remains
the fallback and the disclosure layer keeps saying so.

### 8.5 The two free actions that could move instruments out of category C

Both cost nothing but time:

1. **Read Stooq's terms.** If they permit private automated use, five indices
   move from category C to category A at once, with their _actual_ index levels
   at EOD. This is the single highest-value unresolved question in the plan.
2. **Email `index_services@spdji.com`.** Ask in writing whether a private
   single-operator application may display the FRED `SP500` series. A written
   yes moves S&P 500 to category A; a no closes the question permanently instead
   of leaving it ambiguous.

### 8.6 Quota design — staying inside free tiers honestly

The pipeline already has most of this; what changes is the cadence policy per
category.

- **Official-daily series** (Treasury, Bundesbank, Riksbank, EIA) publish once
  per business day. Poll **once per publication cycle**, not per render.
- **EOD index data** fetched **once after the relevant market closes**. Five
  indices on three continents is five requests per day.
- **Market-hours-aware refresh already exists** — `marketOpen()` in
  `overviewDataSource` drives TTL selection. Extend it rather than replace it.
- **Stale-while-revalidate is already implemented** and is what should serve a
  quota-exhausted category: the last valid observation, disclosed as
  `INAKTUELL`, never a number that looks live.
- **Never** rotate keys, parallelise across identities or scrape around a limit.
  A provider that says 25/day gets 25/day.

Rough daily budget under this design: **well under 50 requests/day in total**,
against free tiers of 800 and unmetered government APIs. Quota is not the
binding constraint. **Rights are.**

### 8.7 What this changes about the normal state of the product

With category A implemented and either question in 8.5 answered favourably, the
Command Center's normal state becomes:

| Category          | Freshness                                                  |
| ----------------- | ---------------------------------------------------------- |
| Bitcoin           | near-realtime                                              |
| FX                | official EOD                                               |
| Government yields | official daily                                             |
| Brent             | official daily                                             |
| Indices           | delayed/EOD — actual index if cleared, else approved proxy |
| Gold              | best legitimate free observation                           |

`EJ MARKNADSDATA` returns to being what it was designed as: the final fail-safe,
not the resting state.

## 9. Freshness and disclosure semantics - FROZEN 2026-08-25

> **Amended and re-frozen the same day.** One narrow unfreeze added a
> commodity-specific horizon and made every boundary half-open. The final
> accepted numbers are in section 10; where the two sections differ,
> section 10 governs.

Sections 1-8 concern *which* sources Financial OS may use. This section records
what the product may *say* about an observation once it has one. It was ruled
after the Yahoo bindings went live and is **frozen**: the behaviour below is not
to be refined further without a new ruling.

### 9.1 Three clocks that are not the same clock

The defect that prompted this: an S&P 500 observation seven seconds old, in an
open session, rendered `INAKTUELL`. Nothing about the market had changed - only
our cache had. Three distinct facts had been collapsed into one:

| Fact | Where it lives | What it answers |
| --- | --- | --- |
| **Observation freshness** | `application/marketData/freshness.ts` | How old is the number the reader is looking at? |
| **Delivery / cache state** | `Envelope.state`, `staleReason` | How did we obtain it? |
| **Source / feed quality** | `Provenance.quality`, `isDelayed` | What kind of feed produced it? |

`Envelope.state === 'stale'` is a **delivery** fact. Under
stale-while-revalidate it means the cache passed its TTL and a refresh is
running behind the response - a statement about our request pacing. It no
longer produces a market-facing marker. It is preserved on
`Disclosure.delivery` (`fresh | revalidating | degraded`) for inspection and
telemetry.

### 9.2 The frozen precedence

```
fixture       -> EJ MARKNADSDATA   (not market evidence; no source, no time)
unavailable   -> OTILLGANGLIG      (nothing resolved)
stale-by-age  -> INAKTUELL         (the observation is too old for its session)
delayed       -> FORDROJD          (real and current, no realtime guarantee)
current       -> no marker
```

**Age outranks delay, deliberately.** Every Yahoo observation carries
`isDelayed`. If delay won the precedence, a Yahoo row could never be reported
stale at any age, and INAKTUELL would be dead vocabulary for the S&P 500 and
the FTSE 100. The two words answer different questions and both must stay
reachable:

- FORDROJD - a real observation, current enough for this session, from a
  source that guarantees no realtime.
- INAKTUELL - the observation itself is now too old for this session.

A stale-while-revalidate or otherwise degraded delivery **never on its own**
creates a stale market claim.

### 9.3 The 15-minute threshold is our policy, not a claim about a provider

The open-session horizon for an equity index is **15 minutes**. It must be read
and described as exactly one thing:

> A Financial OS **disclosure policy** - the point at which a reader should be
> told that a level may no longer represent the market.

It is **not** an assertion that Yahoo publishes on a fifteen-minute delay, nor
that Avanza does. **Neither provider states a delay figure anywhere in its
payload**, `delayMinutes` is `null` for both, and inventing a number to pace
against would be precisely the fabrication the rest of this gate exists to
prevent. Anyone reusing this threshold as evidence of a provider's latency is
misreading it.

Horizons are instrument- and session-aware rather than one universal wall-clock
number: intraday instruments get 15 minutes open / 5 days closed, published
daily series 5 days regardless of session, and crypto 30 minutes because a
market that never closes has no session to be generous about. Quality is
consulted first, so an `official-daily` par yield is never judged against an
intraday horizon.

### 9.4 Closed sessions keep their close

The latest legitimate close remains the correct observation for the whole
closure. Wall-clock hours passing after London shuts does not make the FTSE 100
close wrong, and the closed allowance (5 days) is sized against the longest
scheduled exchange closure - an Easter or Christmas run - rather than a round
figure. It is generous, not unbounded: a feed that has silently stopped is still
reported.

Session state comes from the **provider's own** payload - Avanza's
`marketPlace.currentStatus`, Yahoo's `currentTradingPeriod` - and is `unknown`
when a provider does not say. A weekday and an hour are never treated as
evidence a venue is trading. `unknown` takes the **open** horizon: we cannot
prove a venue is shut, and granting a multi-day allowance on that assumption is
how a dead feed goes unreported.

### 9.5 Retention is not freshness

`equity-index-intl` `maxStaleMs` was raised 4 h -> 5 days to match the other two
index families. The two numbers are set independently and mean different things:

- **Freshness horizon** - when the reader is told (INAKTUELL after 15 minutes
  in an open session).
- **Retention ceiling** - how long the resolver may keep serving the last real
  observation when no provider answers (5 days).

An observation can be disclosed INAKTUELL while the resolver is still perfectly
entitled to retain it. The 4-hour default was harmless while the category had no
live provider and became wrong the moment Yahoo gave it one: London closes at
16:30 UTC, and the FTSE 100 close was being discarded around 20:30 in favour of
a fixture constant while it was still the correct observation.

### 9.6 Modelling gap - extended-hours observations

`SessionState` declares `pre-market` and `after-hours`, but:

- **no currently bound provider emits either state**, and
- **nothing on `MarketQuote` records which session an observation belongs to** -
  only which session is currently running.

Neither Avanza nor Yahoo publishes an identified extended-hours index
observation. Both branches therefore **intentionally take the closed-session
allowance**: during extended hours the provider is serving the last regular
close, and judging it as an intraday observation would age out a perfectly valid
close fifteen minutes after the bell.

The distinction was **not invented in presentation**. If a provider is ever
bound that supplies identified extended-hours observations, the observation
model needs a field separating *session-of-observation* from *current market
session* before this branch may change.

### 9.7 Evidence - live reading, 2026-08-25 19:59 UTC

All six index rows resolving from real providers:

| Row | Value | Session | Quality | Age | Marker |
| --- | --- | --- | --- | --- | --- |
| S&P 500 (Yahoo) | 7 677,84 | open | delayed | 1 s | FORDROJD |
| FTSE 100 (Yahoo) | 10 886,16 | closed | delayed | 4 h 24 m | FORDROJD |
| Nikkei 225 (Avanza) | 65 856,43 | closed | delayed | 13 h 29 m | FORDROJD |
| OMXS30 (Avanza) | 3 318,26 | closed | delayed | 4 h 29 m | FORDROJD |
| DAX (Avanza) | 26 266,14 | closed | near-realtime | 4 h 24 m | *(none)* |
| Nasdaq 100 (Avanza) | 29 172,70 | open | near-realtime | 15 m 01 s | INAKTUELL |

Nasdaq 100 is the unplanned confirmation: an open session with an observation
one second past the horizon, correctly reported INAKTUELL while closed-session
rows of similar and greater age are not. The boundary fired on live data in the
direction the ruling specifies.

During the same verification the Avanza MCP calls timed out at ~15 s and all
four Avanza indices fell to fixture, rendering EJ MARKNADSDATA with fixture
values. That is the fail-safe working as designed - the chain degraded, the
disclosure said so, and no fixture was presented as market data. It recovered on
retry.

### 9.8 Remaining gap after this pass

Indices are covered by real sources. **Brent and Gold remain the open
instruments** - see sections 8.3 and 8.4. Yahoo offers only dated futures
contracts for both (`GC=F` is "Gold Dec 26", `BZ=F` is a Last Day Financial
future), which are a different instrument from a spot benchmark and are
deliberately unbound. That is the next market-data work, and it must not disturb
the index stack this section freezes.

## 10. Final freshness boundaries - RE-FROZEN 2026-08-25

Section 9 established the architecture. This records the numbers it settled on
after commodities went live, and the empirical reason one of them is not 15
minutes. **The policy is frozen again at this point.**

### 10.1 The three words, and what separates them

| Marker | Meaning |
| --- | --- |
| **FORDROJD** | A valid observation from a source known not to be realtime, still **within** the Financial OS freshness horizon. |
| **INAKTUELL** | The observation itself has **exceeded** the freshness horizon for its instrument class. |
| **EJ MARKNADSDATA** | No genuine market observation is behind the displayed value. |
| **OTILLGANGLIG** | Nothing resolved at all. |

These describe the **observation**. They must stay separate from cache age,
stale-while-revalidate, and provider delivery state, all of which live on
`Disclosure.delivery` and produce no marker of their own.

### 10.2 Horizons are half-open intervals

Stated once and applied to every class:

    age <  limit   ->  within the freshness horizon
    age >= limit   ->  stale

| Instrument class | Session | Horizon |
| --- | --- | --- |
| Equity index, share, sector | open / unknown | **15 min** |
| Equity index, share, sector | closed | 5 days |
| **Commodity (Gold, Brent)** | **unknown** (by ruling) | **30 min** |
| Commodity | closed | 5 days |
| Crypto | any (never closes) | 30 min |
| FX, yields, policy rates | any | 5 days, governed by `official-daily` / `eod` quality |

Reaching a limit exactly means the observation has spent its whole allowance,
so **15m00s.000 on an equity index and 30m00s.000 on a commodity are both
stale**. This is intentional and was accepted explicitly - it is not a rounding
artefact of a comparator.

### 10.3 Why commodities get 30 minutes

**Measured, not assumed.** Avanza's gold quote was read directly through the
MCP tool on 2026-08-25:

    timeOfLast 20:04:49
    timeOfLast 20:42:40   against a wall clock of 20:58:05

**The feed publishes roughly every fifteen minutes.**

A 15-minute horizon on a 15-minute cadence sits exactly on top of the source's
normal behaviour. A perfectly healthy feed reaches the threshold immediately
before each publication, so the row oscillates between FORDROJD and INAKTUELL
indefinitely. Every individual reading is defensible; the aggregate is useless,
because a marker that fires during normal operation stops carrying information
and the reader learns to ignore it.

Thirty minutes allows **exactly one missed publication interval**. One skipped
update is normal. Two consecutive misses is a feed that has stopped, and that
is the event worth telling a reader about.

### 10.4 Thirty minutes is our threshold, NOT an Avanza delay

The same warning as section 9.3, restated because this number is easier to
misread:

> 30 minutes is a **Financial OS stale-observation threshold**, calibrated from
> an observed publication cadence.

It is **not** an assertion that Avanza publishes on a thirty-minute delay.
Avanza states no delay figure anywhere in its payload; `delayMinutes` is `null`
for every Avanza observation and always has been. A threshold derived from
watching how often a feed updates and a delay figure published by a provider
are different kinds of statement, and conflating them would put a number in a
provider's mouth that it never said.

The same applies to the 15-minute equity horizon and to Yahoo. Neither number
describes a provider.

### 10.5 The distinction lives in policy, never in the UI

Gold and Brent are not special-cased anywhere in the presentation layer.
`discloseObservation` receives a symbol and a session and never asks what the
instrument is; the horizon is selected in `application/marketData/freshness.ts`
by namespace. A test pins this by showing one identical call shape producing
FORDROJD for a 20-minute-old commodity and INAKTUELL for a 20-minute-old equity
index.

### 10.6 Evidence - live reading, 2026-08-25 21:14 UTC

| Row | Value | Session | Quality | Age | Marker |
| --- | --- | --- | --- | --- | --- |
| Gold (Avanza) | 4 660,12 USD/oz | unknown | delayed | 15 m 05 s | FORDROJD |
| Brent (Avanza) | 85,70 USD/bbl | unknown | delayed | 15 m 01 s | FORDROJD |

The same ~15-minute-old observations read INAKTUELL before the horizon was
recalibrated. Both remain genuine delayed Avanza observations, neither is a
proxy, and neither is represented as current or realtime.

## 11. Cross-Asset Risk Appetite v1 - FROZEN 2026-08-26

The first Financial OS observation that is computed rather than obtained.
`sentiment` had served a placeholder gauge since it was written, because the
`derived` provider its chain named had never been implemented.

### 11.1 What the measure answers

> How risk-on or risk-off is the current cross-asset configuration relative to
> the recent regime?

Not investor psychology, and not a macro or valuation signal. It reads what
three liquid markets currently charge for risk, ranked against the trailing
trading year.

### 11.2 Frozen definition - `cross-asset-risk-appetite-v1`

| Leg | Instrument | Transformation | Sign |
| --- | --- | --- | --- |
| Equity volatility | `^VIX` | 252-observation percentile of the **level** | high -> risk-off |
| Credit | `HYG` / `LQD` **adjusted** | 252-observation percentile of the **3-day log change** | falling -> risk-off |
| FX / safe haven | `USDJPY=X` | 252-observation percentile of the **3-day log change** | falling -> risk-off |

- **Weights:** 1/3 each. Equal, and not inferred from measured correlations.
- **Window:** 252 **aligned** observations - dates on which every leg has a
  valid observation. One calendar year of raw history yields only ~223, so ~14
  months are required; the implementation requests 2y.
- **Coherence:** 120 s maximum constituent spread for intraday recomputation;
  same-trading-session identity for the close-based score v1 produces.
- **Session:** a US-session measure. `closed` outside the common window, which
  earns the closed-session freshness allowance and retains the last complete
  reading overnight and across weekends.
- **Dispersion:** `max(leg) - min(leg)`, reported beside the score and **never**
  folded into it.
- **Proxy:** the credit leg is explicitly a proxy and carries its contamination
  note (duration mismatch, ETF structure, closing time) to the surface.

Any change to inputs, horizons, transformations, weights or session rules
requires a **new methodology version**.

### 11.3 Why three days, and why not because of autocorrelation

Overlapping h-day changes share h-1 observations, so for a random walk the
lag-1 autocorrelation is approximately **(h-1)/h** before any market behaviour
enters. Measured against that benchmark:

| Horizon | Benchmark | Credit | FX |
| --- | --- | --- | --- |
| 3d | 0.667 | 0.556 | 0.609 |
| 5d | 0.800 | 0.723 | 0.728 |
| 10d | 0.900 | 0.845 | 0.827 |

Every measured value sits **below** its benchmark, so no horizon discovers
persistence the differencing did not create. Selecting on that column would be
mechanical smoothing dressed as a finding.

**3d was chosen on economic grounds:** it spans a multi-session repricing -
about half a trading week - roughly halves the daily churn (credit 31.0 -> 18.6,
FX 26.4 -> 15.2 mean daily change in leg score), and preserves both the full
range and the reaction speed. Ten days was rejected on evidence: it never once
exceeded 80 in two years, read 49.5 on 2026-02-10 where the one-day measure read
19.7, and was still risk-on as the November 2025 stress transition began.

### 11.4 The asymmetry is accepted, not resolved

One leg ranks a **level**, two rank multi-session **changes**. They do not carry
the same character of information: measured lag-1 autocorrelation at the
one-day horizon was 0.849 for equity volatility against -0.056 and -0.043 for
credit and FX. Three-day changes narrow the gap; they do not close it, and they
do **not** turn a change signal into a state signal.

This is documented rather than disguised with weights. It is why dispersion is
a first-class diagnostic and why the composite must never be read alone when
the legs disagree. A stationary-level treatment of credit and FX is deferred to
a possible **v2** and was deliberately not attempted.

### 11.5 Fail-closed behaviour

| Condition | Result |
| --- | --- |
| Fewer than 252 aligned observations | `InsufficientHistoryError`, no score |
| Constituents from different sessions | no new composite, previous retained |
| Adjusted close requested but absent | hard failure, never substitutes unadjusted |
| Any fixture input | composite degrades to `quality: 'fixture'` |
| Provider or history failure | normal chain fallback, disclosure says so |

### 11.6 Evidence - live reading, 2026-08-26

score **69.31** / Risk-on / dispersion **39.68** / `origin: derived` /
`quality: derived` / `asOfPrecision: date` / `session: closed` / envelope `ok`.

Legs: equity volatility 85.32 (+11.77), credit 45.63 (-1.46, **proxy**), FX
76.98 (+8.99). The contributions plus the baseline reconstruct the headline
exactly.

Two defects were found and fixed during live verification:

1. The composite's session did not reach the disclosure layer, so a valid
   overnight reading rendered INAKTUELL under the generic 15-minute
   unknown-session horizon. `MarketSentiment` now carries `session`.
2. `asOfPrecision` claimed `second` for a daily close. It is now `date`, using
   the domain's midnight-UTC convention, which over-states age in the safe
   direction.

### 11.7 TECHNICAL DEBT - derived historical inputs are not governed history

**Recorded deliberately, not to be "solved" by convenience.**

History for `^VIX`, `HYG`, `LQD` and `USDJPY=X` is fetched through the Yahoo
adapter's `fetchDailyHistory` on the shared `HttpClient`. It is therefore
governed by the same transport, the same provider adapter and the same
fail-closed rules as every other Yahoo call - but it **bypasses the normal
series resolution chain**.

What those four series consequently do **not** get:

- their own resolution entry, and so no per-series cache policy
- capability and readiness telemetry
- circuit-breaker and budget accounting of their own
- canonical Financial OS instrument identity

The cause is that `fetchSeries` requires a `CanonicalSymbol`, and HYG, LQD and
USDJPY are not Financial OS instruments.

**Do not fix this by adding them to the visible instrument universe for
plumbing convenience.** They would then appear in search and the tracked
catalog as though the firm followed them, which is a product claim nobody made.

The eventual architecture should consider either **internal, non-visible
canonical instruments**, or a **governed historical-input abstraction** kept
separate from the user-facing instrument catalog. That choice is deferred and
was deliberately not made in this pass.

### 11.8 Remaining market-data gaps

Sectors, intraday series and news. News is a known capability gap - an unset
`MARKETAUX_API_KEY` - rather than a correctness defect.

## 12. Sector performance and the quote-basis correction - 2026-08-26

Two rulings implemented together, because the second was found while probing
the first and turned out to affect instruments already in production.

### 12.1 Frozen semantic contract

> **Sector performance = current regular-market level versus immediately
> preceding regular-session close, for the nine actual S&P 500 GICS sector
> indices.**

Deliberately NOT sector index levels, NOT relative performance against the S&P
500, and NOT a multi-day return. Those are separate future methodology and UI
decisions, and none of them is what the panel is built to show: the view model
carries only `change`, and the bar it draws saturates at +/-0.9 %, a scale that
only makes sense for a single session.

### 12.2 The nine approved bindings

| Sector | Yahoo symbol | Type |
| --- | --- | --- |
| Information Technology | `^SP500-45` | INDEX |
| Communication Services | `^SP500-50` | INDEX |
| Industrials | `^SP500-20` | INDEX |
| Financials | `^SP500-40` | INDEX |
| Consumer Discretionary | `^SP500-25` | INDEX |
| Health Care | `^SP500-35` | INDEX |
| Real Estate | `^SP500-60` | INDEX |
| **Energy** | **`^GSPE`** | INDEX |
| Consumer Staples | `^SP500-30` | INDEX |

All nine are **actual sector indices**. The SPDR sector ETFs (`XLK`, `XLC`,
`XLI`, `XLF`, `XLY`, `XLV`, `XLRE`, `XLE`, `XLP`) resolve homogeneously too and
are deliberately **not** used: on the day of the probe they diverged from their
indices by up to two percentage points, so they are not interchangeable and
would have to be disclosed as proxies. A test asserts none of them is bound.

### 12.3 The Energy trap - `^SP500-1010`

Eight sectors follow `^SP500-{GICS code}`. **Energy does not.**

    ^SP500-10     does not exist
    ^SP500-1010   resolves, INDEX, "S&P 500 Energy (Industry Group)"
    ^GSPE         resolves, INDEX, "S&P 500 Energy (Sector)"

An **industry group** sits one level below a sector in the GICS hierarchy. The
wrong symbol returns a well-formed payload, the correct `instrumentType`, and a
plausible level around 950 - within a rounding error of the sector index - and
would sit in a sector ranking quietly misreporting the sector. Only the name
distinguishes them.

Three guards, in `yahooSectors.test.ts`:

1. the Energy binding asserts `^GSPE` and explicitly not `^SP500-1010` / `^SP500-10`;
2. `expectedName` must be `S&P 500 Energy (Sector)` and must not match `/Industry/`;
3. a **generic** rule rejects any `^SP500-\d{4}` symbol or any `Industry Group`
   name across all nine, because the same trap exists for every sector.

### 12.4 Set-level comparability

The panel is a **ranking**, so correctness applies to the set and not only to
each row. Nine changes measured on different bases would produce an ordering
that looks authoritative and is not.

- one provider family (Yahoo), one instrument type (INDEX)
- one return definition (see 12.5), one venue and timezone
- **all-or-nothing acquisition**: `fetchQuotes` resolves through `Promise.all`,
  so one sector failing rejects the whole category and the chain falls to
  fixture rather than rendering a partial ranking
- category-level caching keyed on the full nine-symbol set, so a re-render
  cannot fan out into nine provider calls
- chain `sectors: ['yahoo', 'fixture']`, TTL unchanged at 5 min open

No batching is available: `v7/finance/quote` remains HTTP 401 (crumb-gated) and
`v8/finance/chart` is one symbol per request, so the set costs nine requests per
refresh. The TTL was deliberately **not** lengthened to reduce that; if Yahoo
begins rate-limiting, measure it and propose a new TTL then.

### 12.5 The `range=1d` quote-basis correction - A SHIPPED DEFECT

**`meta.chartPreviousClose` is the close preceding the REQUESTED WINDOW, not
the previous session.** The quote path requested `range=5d` and mapped that
field to `previousClose`, so every Yahoo-sourced percentage change was a
**five-day move labelled as an intraday one**.

Measured 2026-08-26, same instant, both request shapes:

| Symbol | Price | prev (1d) | change | prev (5d) | change |
| --- | --- | --- | --- | --- | --- |
| `^GSPC` | 7 688.59 | 7 677.28 | **+0.15 %** | 7 707.98 | **-0.25 %** |
| `^FTSE` | 10 878.12 | 10 886.16 | **-0.07 %** | 10 743.40 | **+1.25 %** |
| `^VIX` | 15.35 | 15.45 | **-0.65 %** | 16.01 | **-4.12 %** |

Not a rounding difference: **the sign was wrong on all three**.

**Scope of the invalidity.** Percentage changes previously reported for the
Yahoo-sourced S&P 500 and FTSE 100 - including the FTSE figure of **+1.47 %**
recorded earlier in this gate - **were invalid as daily changes**. **Price
levels and observation timestamps were unaffected**, as was every
Avanza-sourced instrument, which takes `changePercent` from the provider rather
than deriving it.

The fix is `range=1d` on the **quote path only**. The historical-series path
keeps its own range and is unaffected: it reads the bar series, not this field.
Because all Yahoo quote consumers share `toIndexQuote`, the correction reaches
the S&P 500, the FTSE 100, VIX and the nine sectors at once.

Tests pin the failure class, including one asserting that the five-day basis
yields the **opposite sign** from the one-day basis, so a reverted request shape
fails loudly.

### 12.6 Live evidence, 2026-08-26 ~19:36 UTC

| Sector | Change | Observed (UTC) |
| --- | --- | --- |
| Industrials | +1.20 % | 19:36:04 |
| Information Technology | +0.55 % | 19:36:04 |
| Energy | +0.26 % | 19:36:03 |
| Financials | +0.06 % | 19:36:02 |
| Consumer Staples | -0.19 % | 19:36:04 |
| Real Estate | -0.44 % | 19:35:54 |
| Consumer Discretionary | -0.55 % | 19:36:04 |
| Communication Services | -0.65 % | 19:36:02 |
| Health Care | -0.99 % | 19:36:02 |

All nine `session: open`, `quality: delayed`, `providerId: yahoo`.

Corrected headline indices at the same load: S&P 500 **7 685.48**, previous
close 7 677.28, **+0.11 %**. FTSE 100 **10 878.12**, previous close 10 886.16,
**-0.07 %**.

### 12.7 The 10-second snapshot span

The nine observations span **19:35:54 to 19:36:04 - a measured 10-second
snapshot span**. The timestamps are **not identical**, and must not be described
as such: the nine requests are sequential because the transport offers no
batching.

**No additional coherence mechanism or tolerance was introduced for this
spread.** It is recorded as a measured property of the acquisition, ruled
acceptable for a same-day ranking, and left alone. The 120-second coherence
tolerance defined for Cross-Asset Risk Appetite governs that composite only and
was not extended here.
