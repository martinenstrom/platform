# JARVIS Public Research — contract v1 (2026-10-03)

JARVIS has two intelligence worlds. The private one — clients, households,
meetings, commitments, loans, portfolios, goals, Client Memory, Sentinel,
Market-to-Client, the Meeting Cockpit — never leaves Financial OS. The public
one — markets, indices, rates, FX, commodities, companies, earnings, releases,
central banks, market news, expectations, the economic calendar — JARVIS may
research through approved public sources. This document is the contract
between them.

## 1. Where research stands in the one router

Per line, in order: the relationship record where the workspace makes the
line the record's → the market tier (a level, a period, a ranking) → **the
research tier** → the model router. Research is primary for research
questions, never a fallback after an internal failure: "Varför går börsen
ner just nu?", "Vad sa Powell idag?", "Vad rapporterade Nvidia?", "Vad
väntar marknaden sig av CPI?", "Vad händer nästa vecka?", "Vilka stora bolag
rapporterar idag?", "Vad drev Nasdaq igår?", "Hur ser pre-market ut?", "Vad
driver marknaden?", "Vad säger analytiker om nästa vecka?", "Vad ska jag
hålla koll på?" are recognised deterministically in
`application/jarvis/research/researchQuery.ts` and routed here before any
model. A judgement question — borde, köpa, vikt, exponering — is refused
here as everywhere and goes to the firm.

One router, different tools: "Vad står S&P i?" is market data; "Varför går
S&P upp?" is market data plus research; "Vad händer nästa vecka?" is
calendars plus research; "Vad tycker marknaden om nästa Fed-möte?" is
market pricing plus research.

## 2. The port

`PublicSearchPort` (`application/jarvis/research/publicSearch.ts`):
`search`, `searchNews`, `searchOfficial`, `retrieve`. Every request carries
a freshness horizon and, where the plan asks for one, a domain allowlist.
The application layer never learns what stands behind the port.
`infrastructure/research/publicSearchPort.ts` binds it for this environment:

| Call | Bound to |
|---|---|
| `searchOfficial` with a feed prefix (`fed-monetary:`, `ecb-press:`, `riksbank-press:`, `bls-cpi:`, `edgar-filings:`) | the official feed read directly (`officialFeeds.ts`) |
| `searchOfficial` otherwise, `searchNews`, `search` | OpenAI web search (`openAiSearch.ts`), `web_search` tool with `filters.allowed_domains`, `tool_choice: required`, `store: false` |
| `retrieve` | the page fetched and reduced to readable text (`retrieve.ts`); official and issuer addresses only |

Environment: `PUBLIC_RESEARCH_PROVIDER` (`openai` when `OPENAI_API_KEY` is
set, else `none`), `PUBLIC_RESEARCH_MODEL` (default the backend model),
`PUBLIC_RESEARCH_DISABLED=1` (no port at all), `PUBLIC_RESEARCH_CONTACT`
(appended to the User-Agent the SEC requires). Any future provider — an
enterprise search, a licensed news feed, another engine — stands behind the
same port.

## 3. The firewall

V1 rule: PRIVATE CLIENT DATA NEVER LEAVES THE INTERNAL ADVISORY LAYER.
`firewall.ts`:

- A public request is built from typed slots — instruments, region, period,
  company, institution, release — which name only public things.
- The advisor's own line travels as a query only from the market dashboard or
  from nowhere in particular (`GLOBAL`), and only once the guard has found no
  client, household or member name (the register's own resolver), no record id
  (`cl-…`, `hh-…`, `off-…`, `evt-…`), no amount, and none of the record's
  vocabulary (lån, bolån, förmögenhet, portfölj, möte, löfte, klient, …).
- In a record scope — client, meeting, office, book, Sentinel,
  Marknadspåverkan — the line never travels, however clean it is.
- A hybrid line ("Vad betyder dagens ränteuppgång för Henrik?") is
  decomposed: the client reference is named for the private layer, the
  public part is the typed market event, and the answer says it reads the
  client from the record and points at Marknadspåverkan. A first name two
  clients share names nobody and still withholds the line.

Tested with planted names, ids, amounts and vocabulary against a recording
port, in every scope (`researchAnswer.test.ts`, `firewall.test.ts`).

## 4. Source hierarchy and tool selection

`sourceAuthority.ts` ranks a source by its address, from a reviewed table:
official (1), issuer (2; EDGAR or an investor-relations host), government
(3), reputable financial news (4), aggregator (5), other (6). An unknown
address is `other`, however confident it sounds.

`researchPlan.ts` chooses the evidence in authority order:

| Question | Steps |
|---|---|
| central-bank decision | the bank's feed (opened), then news for context |
| macro release | the statistics agency (BLS feed for US CPI; SCB, BEA, Census, ISM by release and country), then news |
| company | EDGAR by ticker where the company files there, else a filing-domain search; then news |
| why the market moved | the platform's numbers (market tier) + news; deep adds the open web |
| market drivers, pre-market | the platform's numbers + day-fresh news |
| week ahead | official calendar domains, then news |
| expectations | news, then the scheduled source |
| analyst view | news |
| general current question | search |

Generic search never stands where a structured source exists. QUICK takes
one official source and up to three reports; DEEP ("ta reda på", "gör en
ordentlig analys", "research this") opens the official release and reads up
to six.

## 5. Evidence, claims, conflicts, confidence

`evidence.ts`: `ResearchEvidence` (publisher, url, publishedAt, retrievedAt,
sourceType, authority, snippet, claims, relevantTo, freshness) and
`PublicResearchResult` (queries that left, evidence, conflicts, missing
information, asOf, confidence, unavailable reason, steps run/failed).

A claim is a sentence the source carries: `retrieved` from the document,
`snippet` from the publisher's own excerpt or the span a provider cites, or
`market-data`. A sentence the provider did not cite is nowhere.

`reconcile.ts`: figures for the same key from different sources that differ
beyond rounding are a named conflict, and the most authoritative source is
preferred — "Källorna skiljer sig något; den officiella publiceringen (BLS)
anger 3,4 procent." Confidence is a class, never a percentage:
STRONG_EVIDENCE (a fact read from an official or issuer document, or two
independent reputable reports), SUPPORTED (one reputable source), MIXED
(unsettled disagreement, or only unranked sites), INSUFFICIENT (no claim).
Weak support is said: "Jag ser rörelsen, men hittar ingen tydligt
verifierad katalysator ännu."

## 6. Follow-ups and freshness

`ResearchContext` (topic, region, period, instruments, companies,
institution, release, evidence ids, asOf) lives on the live session and
travels in the browser's market pointer as typed slots only
(`parseResearchContext` in `askJarvis.ts` refuses anything else). "Hur gick
USA förra veckan?" → "Varför?" → "Vad säger analytiker om nästa vecka?" →
"What could reverse it?" never restate the subject. A bare "varför?" right
after the record answered stays the record's continuation.

Freshness words — idag, nu, precis, senaste, i morse, pre-market, den här
veckan, nästa vecka — make a question freshness-critical: the search horizon
is a day, and no cache entry older than fifteen minutes serves it.
`researchCache.ts` holds entries by source class: official and calendars
six hours, filings a day, news fifteen minutes, search ten.

## 7. The answer

`researchText.ts` composes Swedish from the typed answer: the platform's own
numbers first where the question is about a move, then the cited claims in
authority order (Swedish ones first), the disagreement if any, the honest
sentence where support is weak or the web could not be reached ("Jag kan
läsa den interna marknadsdatan, men extern research är inte tillgänglig
just nu."). No list of links. The strip (`researchCard.ts`,
`ResearchCard.tsx`) shows JARVIS RESEARCH · N källor · Data / nyheter t.o.m.
[time] · the support class, and "Visa källor" opens the sources with
publisher, kind, time and link.

## 8. Verification

Unit: the recogniser against the brief's examples, the plan per kind,
reconciliation with a planted conflict, the firewall with planted private
data, web failure, caching, the adapters against recorded feeds
(`infrastructure/research/__fixtures__`, read live 2026-10-03), the runtime
(`liveSession.research.test.ts`). Live: `.probe/research-live-probe.ts`
through the real port; the browser probe `.probe/research-browser-probe.mjs`.
