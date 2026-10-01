# JARVIS context — the intelligence layer looks at the same Financial OS

**Status: implemented 2026-09-30 on top of the office layer. Synthetic
record only; no external AI in the advisory tier; no persistence. TD-105
closed for the typed path.**

JARVIS is not a chat window beside Financial OS. When the advisor is on
Anna & Per Dahlqvist's page and asks _"Vad ska jag ta upp på mötet?"_, the
question is about Anna & Per, and nobody types the name. This document is
the contract for how the workspace on screen becomes JARVIS's context, how
a line is answered from the record, and what the answer carries.

## 1. Root cause

The typed line carried `text`, `subject`, a case `reference`, `history`
and `marketContext` — never the route. The server parsed nothing else, so
JARVIS could not know which client, office or meeting was on screen, and
the model answered about "the page". The client doors (`askAboutClientFn`,
`askBeforeMeetingFn`) answered deterministically but outside the presence.

## 2. The context

```
application/jarvis/context.ts    JarvisContext { scope, route, officeId?, clientId?, meetingId?,
                                 currentView?, capabilities }; resolveJarvisContext(route)
```

| Route                             | Scope            | Identifiers           |
| --------------------------------- | ---------------- | --------------------- |
| `/`                               | MARKET           | —                     |
| `/clients`, `/clients?view=alla`  | CLIENT_DIRECTORY | currentView           |
| `/clients/office/:officeId`       | OFFICE           | officeId              |
| `/clients/:clientId`              | CLIENT           | clientId              |
| `/clients/:clientId/meeting-prep` | MEETING          | clientId, meetingId\* |
| `/sentinel`                       | SENTINEL         | —                     |
| `/market-impact`                  | MARKET_IMPACT    | —                     |
| anything else                     | GLOBAL           | —                     |

\* the meeting id is filled on the server once the client's record has
resolved the next booked meeting.

The browser resolves the context for its indicator and quick actions and
sends **only the route** (`context: { route }`, refused unless it is a
route). The server resolves the context again — the way it re-reads a case
reference — so no id of the browser's choosing reaches the record.

## 3. The advisory tier of the one router

```
application/jarvis/advisoryTurn.ts     order: a named instrument's state (market Tier 0) →
                                       advisory scopes → the model router
application/jarvis/advisoryIntent.ts   recognizeAdvisoryIntent(text, context, clients)
application/jarvis/advisoryAnswer.ts   answerAdvisoryLine(context, jarvis, text) → JarvisAnswer
application/jarvis/answer.ts           the typed answer model
infrastructure/jarvis/serverFns.ts     askJarvisFn: advisory tier first, no key needed
```

**Intents (V1, deterministic):** CLIENT_SUMMARY, LAST_INTERACTION,
OPEN_COMMITMENTS, MEETING_PREP, CHANGES_SINCE_LAST_MEETING, WHY_PRIORITY,
MARKET_RELEVANCE, FINANCING, GOALS, OPPORTUNITIES, RISKS, QUESTIONS_TO_ASK,
CLIENT_QUESTIONS, KEY_FIGURES, GENERAL_CLIENT_QUERY (the relationship
memory); OFFICE_PRIORITIES, OFFICE_MEETINGS, OFFICE_OVERDUE,
OFFICE_OPPORTUNITIES; DIRECTORY_CALL_TODAY, DIRECTORY_MEETINGS,
DIRECTORY_OVERDUE, DIRECTORY_EXTERNAL_ASSETS; SENTINEL_TODAY;
MARKET_IMPACT_CLIENTS; and, since the Meeting Pack, MEETING_PACK_FULL,
MEETING_PACK_EXECUTIVE, MEETING_PACK_PPTX, MEETING_PACK_PDF and
MEETING_PACK_UPDATE, which answer with the pack's readiness and contents
and open the preview themselves (`answer.opens`) for the screen's client.
The recogniser's interface is the seam a model may later classify through
without touching the evidence services.

**Evidence services, reused, never re-derived:** `client360`,
`meetingCockpit` (focus, changes, promises, questions, risks, data gaps),
`askAboutClient` (memory), `sentinelBrief`, `officeBook`,
`clientDirectory`, `marketImpactBrief`.

**Named clients.** A line that names exactly one client in the register —
"Henrik", "Dahlqvist", "Anna & Per" — is answered about that client from
any scope; the answer says _Svarar om_ and offers _Öppna klient_; the
route never changes.

**What is not the record's** — a capital question, a market overview, a
line in GLOBAL or MARKET scope with no client named — goes on to the
router unchanged. A client question nothing recognises goes to the
relationship memory; when the memory has nothing, the answer says _Jag
hittar inget dokumenterat om detta i klienthistoriken_ at low confidence.

## 4. The answer

`JarvisAnswer { scope, intent, about, sections, sources, actions, titles,
today, confidence, method }`. A section is a typed key (Huvudfokus, Ta
upp, Sedan sist, Du lovade, Frågor att ställa, Klienten kan fråga, Glöm
inte, Ni diskuterade, Klienten uttryckte, Nästa steg, Siffror, Varför nu,
Underlag …) with typed items; every item carries its **nature** (fact /
assessment / suggestion) and the **record ids** it rests on. The answer's
sources are those records with type, label and date. The presentation
(`presentation/jarvis/advisoryAnswerText.ts`) phrases each item with the
same functions the cockpit, Client 360 and Sentinel use, so the same fact
reads the same everywhere. A figure older than 180 days says so.

## 5. The presence

- **Context indicator.** The strip shows the client's initials or the
  page's stub, named in full for assistive technology; the panel shows
  _Anna & Per Dahlqvist_, _Anna & Per Dahlqvist · Möte 2 okt_,
  _Strandvägen_, _Klienter_, _Sentinel_ … read from the route and the
  data the page already loaded. It changes with the route, without a
  reload.
- **JARVIS vet.** On a client: the next meeting, overdue promises, a loan
  maturity, active concerns — from the page's own view, never a second
  read, never opened as a message.
- **Quick actions** per scope, three to five; none on the market.
- **Answers** render as sections with the nature marked; _Varför säger
  JARVIS detta?_ opens the sources. Never a chain of thought.

## 6. Verification

`context.test.ts`, `advisoryIntent.test.ts` (every intent, ordering, named
clients, what stays the router's), `advisoryAnswer.test.ts` (Anna & Per's
meeting, last conversation, promises, figures, summary, nothing
documented; Henrik's priority; a named other client; the quiet client, no
meeting, no history; office, book, Sentinel, Marknadspåverkan; the typed
door's precedence and the meeting id), `contextText.test.ts`,
`askJarvis.test.ts` (the route field), `JarvisPresence.test.tsx`
(indicator, JARVIS vet, quick actions, rendered answer, switched subject,
route changes). Browser probe: `.probe/jarvis-context-probe.mjs`.

## 7. Limitations

- The voice path is unchanged: a spoken line goes to the backend model,
  which has no advisory tool yet (TD-105, voice).
- Intent recognition is a lexicon; a model may classify later behind the
  same interface.
- The context is a pointer to the synthetic record; nothing persists.
