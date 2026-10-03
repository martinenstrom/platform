# JARVIS voice context — one brain, two modalities

**Status: implemented 2026-10-01 on top of the JARVIS context layer
(`jarvis-context.md`) and Meeting Pack V1 (`meeting-pack.md`). Synthetic
record only; the browser sends the route and nothing else; no new external
transmission of client data; TD-105 closed for the voice path. Proven in
the simulated voice mode end to end; the live GPT-Live model's compliance
with the new routing rule is not yet measured (TD-121).**

JARVIS has one brain. Voice and text are input and output modalities of the
same turn: the same context from the same route, the same router, the same
evidence, the same `JarvisAnswer` — rendered as a card on screen and as one
to four sentences in the ear. Nothing in this slice implements advisory
logic a second time.

## 1. Root cause

The typed line became context-aware on 2026-09-30; the spoken line did not.
A spoken question reached GPT-Live, which delegated to the backend model
with tools for the firm (`delegate_to_financial_os` …) and the market
(`get_market_snapshot`), and nothing for the relationship record. The live
session knew no route. So _"Vad har de i totalförmögenhet?"_ on Anna & Per's
page had no "they": the model answered about "the page", or said it could
not see it, or had no operator — while the record had the answer and the
typed path would have given it.

## 2. The unified architecture

```
TEXT ──┐                                                  ┌─ screen  JarvisAnswerView (sections, nature, sources)
       ├─ route ─► JarvisContext ─► advisory tier ─► JarvisAnswer ─┤
VOICE ─┘  (the session's)        (one router, Tier 0)             └─ voice   spokenAnswerOf → say (1–4 sentences)
```

| Layer          | File                                           | What it adds                                                                                                                                                             |
| -------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| application    | `jarvis/liveTools.ts`                          | the backend tool `answer_from_workspace(question)` — the question only; the target is never the model's                                                                  |
|                | `jarvis/liveOpen.ts`                           | the open request carries `context: { route }`; any other key is refused                                                                                                  |
|                | `jarvis/advisoryIntent.ts`                     | `NEXT_MEETING`, the figure asked for first (`emphasis`), the continuations (`FOLLOW_UP_MORE / _ITEM / _EVIDENCE`), `CLARIFY_CLIENT`, "brief me", "vem ska jag börja med" |
|                | `jarvis/followUp.ts`                           | "ta resten också", "utveckla punkt två", "vad bygger du det på" — answered from the previous answer, never recomputed                                                    |
|                | `jarvis/advisoryAnswer.ts`                     | `answerAdvisoryLine(context, jarvis, text, previous)`; a route change refuses another subject's continuation                                                             |
|                | `jarvis/askJarvis.ts`                          | the typed request may carry `previous` (the last `JarvisAnswer`, shape-checked, ≤120 k chars)                                                                            |
| infrastructure | `jarvis/workspaceTurn.ts`                      | the advisory tier for a line with a route: `{ answer, spoken, context }` or `null` for the market's fast path and the model's lines; `workspaceLabel(route)`             |
|                | `jarvis/liveSession.ts`                        | the session's `route`; `setContext`, `speak`, `hear`; the workspace tool run with the session's route and last answer; the advisory ring (30) the browser polls          |
|                | `jarvis/simulatedLive.ts`                      | `JARVIS_LIVE_SIMULATE=1`: a provider with no audio and no network, so every server-side part of the path runs for real                                                   |
|                | `jarvis/serverFns.ts`                          | `updateLiveSessionContextFn`, `hearInLiveSessionFn` (simulated only), `liveVoiceModeFn`; `typeIntoLiveSessionFn` speaks the record's answer                              |
| presentation   | `jarvis/spokenAnswer.ts`                       | `spokenAnswerOf(answer): JarvisSpokenAnswer` — the voice's rendering of the one answer                                                                                   |
|                | `jarvis/liveSpeech.ts`                         | `LIVE_WORKSPACE_CONTEXT` (what the voice is told about the workspace, and how to relay the record's words), backend rule 8                                               |
| components     | `jarvis/voiceSession.ts`, `JarvisPresence.tsx` | the route at open and on every change; the simulated microphone; the record's spoken answers rendered once, with their evidence; the door an answer opens                |

**The live path.** Voice → GPT-Live → backend model → `answer_from_workspace`
→ `runTool` hands the session's route and last answer to `workspaceTurn` →
`answerAdvisoryLine` → `JarvisAnswer` → `spokenAnswerOf` → tool output
`{ state: 'workspace-answer', say }` → the model relays `say` verbatim →
the voice speaks it. The same entry `{ seq, text, answer, say, opens }`
lands in the session's advisory ring; the browser polls the session state,
renders the structured answer with its evidence as the reply bubble, and
opens the door the answer names.

**The typed line while live.** `typeIntoLiveSessionFn` answers through the
same advisory tier as before, renders the card, and tells the voice to say
the spoken rendering (`speak`), so the person hears what they read.

**The simulated voice.** With `JARVIS_LIVE_SIMULATE=1` the presence says
_"Rösten är simulerad: skriv det du skulle ha sagt."_ and the compose field
is the microphone. `hear` runs the three paths in the one order: the record
(workspace), the market's Tier 0, then the model's path — which, simulated,
says so. No OpenAI key is needed.

## 3. Context behaviour

| Precedence | Source                     | Mechanism                                                                                                            |
| ---------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1          | a person named in the line | `resolveNamedClients` against the register; two matches ask which (`CLARIFY_CLIENT`); the screen never moves         |
| 2          | the current route          | the session's `route`, set at open and on every route change by `updateLiveSessionContextFn`; the server re-resolves |
| 3          | the conversation           | only the continuations, and only from the previous answer about the route's own subject                              |
| 4          | the generic fallback       | the backend model, with the workspace named in its instructions                                                      |

- `setContext(sessionId, route)` resets the session's last answer, so a
  continuation never crosses a route change: _"Ta resten också"_ on Henrik's
  page after Anna & Per's briefing is _"Det finns inget mer att ta från det
  senaste svaret."_
- The voice is told the workspace (`ARBETSYTAN: …`) at open and on every
  change, so it never asks which client is meant.
- The indicator beside the ear reads `JARVIS lyssnar · Anna & Per Dahlqvist`,
  `… · Anna & Per Dahlqvist · Möte 4 okt`, `… · Strandvägen`, `… · Marknaden`
  — the same `contextName` the typed presence shows.

## 4. The spoken renderer

`spokenAnswerOf(answer)` returns `{ say, sentences, covered, remaining }`.
Rules: the figure asked for first; facts before the assessment; one to four
sentences; numbers as a person says them (`42 miljoner`, `22,5 miljoner`,
`750 tusen`), dates as `den 2 oktober`, `&` as _och_; never a section name,
never an id; more than three items is _"Jag ser fem saker. De tre
viktigaste …"_ with the rest offered. The screen keeps every section and
_Varför säger JARVIS detta?_.

| Line                                | Spoken                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vad har de i totalförmögenhet?      | 42 miljoner i total förmögenhet. Nettoförmögenheten är 22,5 miljoner och vi har 4,9 miljoner hos oss.                                                                                                   |
| Och hur mycket har vi hos oss?      | 4,9 miljoner hos oss, av 42 miljoner i total förmögenhet.                                                                                                                                               |
| När ses vi?                         | Ni har ett möte den 4 oktober, om 3 dagar: genomgång av finansieringsförslag.                                                                                                                           |
| Vad har jag lovat dem?              | Du har ett öppet åtagande: skicka samlat finansieringsförslag, försenat 6 dagar.                                                                                                                        |
| Brief me. (cockpit)                 | Skicka samlat finansieringsförslag är fortfarande öppet och försenat. Brygglånet Åre förfaller den 15 november. De har uttryckt oro: … Därför tycker jag att finansieringen bör vara mötets huvudpunkt. |
| Vad sa de om konst?                 | Jag hittar ingen dokumenterad uppgift om det för Anna och Per Dahlqvist.                                                                                                                                |
| Vad är viktigast för Henrik? (twin) | Menar du Henrik Alvarsson eller Henrik Lindqvist?                                                                                                                                                       |

The assessment is a sentence of the answer, derived per turn from the
cockpit's focus rule; it is never written to the client record.

## 5. Meeting Pack voice commands

_"Prepare full pack."_, _"Skapa mötesunderlaget."_, _"Skapa PowerPointen."_,
_"Skapa PDF."_, _"Ge mig executive brief."_ and _"Uppdatera
mötesunderlaget."_ are the same `MEETING_PACK_*` intents the typed line has,
answered by the same services (`buildMeetingPack`, `assessReadiness`,
`composePackDocument`). The voice says the readiness and what it opens —
_"Absolut. Fullt mötesunderlag är redo: 11 kärnbilder och 7 bilagor. Jag
öppnar förhandsgranskningen."_ / _"… kan genereras, men 1 datapunkt bör
verifieras innan mötet. …"_ — and the presence navigates to the preview
through the answer's `opens`. Nothing is generated by the voice: the
readiness warning is said, and the generation stays the preview's explicit
act (GRANSKA UNDERLAG / GENERERA ÄNDÅ), as `meeting-pack.md` rules.

## 6. Scopes

Client (figures, next meeting, promises, missing fact, a named other
client), meeting (brief, don't forget, three questions, their questions,
figures, since last, the pack), office (_"Vilka kunder här behöver mig?"_,
_"Vem ska jag börja med?"_, meetings this week, overdue), directory (whom to
call, meetings next week, overdue), market (unchanged: _"Vad gör
amerikanska tioåringen?"_ goes the market's Tier 0, never the record), and
the model's lines (what nobody above owns).

## 7. Security

- The browser sends `{ route }` at open and on change, and the question
  text. No client id, office id or meeting id crosses the wire; the parser
  refuses them (`parseRouteContext`), and the tool interpretation drops
  anything the model puts beside `question`.
- The server resolves the context from the route and the synthetic record;
  the session's route is the only route the workspace tool ever sees.
- No new external transmission: the record's answer is produced locally and
  only its spoken sentence is handed to the voice model to relay, as the
  typed-while-live path already did. The simulated mode transmits nothing.
- Nothing persists: the advisory ring lives in the session, in the process.

## 8. Verification

`liveSession.test.ts` (the workspace tool with the session's route, the
route change, the empty line, the model's line, the pack's door, `speak`,
the simulated `hear` through all three paths), `liveOpen.context.test.ts`,
`liveTools.test.ts`, `advisoryIntent.voice.test.ts`,
`spokenAnswer.test.ts` (formatting, Anna & Per's answers, the cockpit's
commands, the missing fact, the pack's readiness, the continuations, the
route change, the ambiguous first name), `JarvisPresence.test.tsx` (the
context line, the route with every line, the spoken answer rendered once
with its evidence, the typed line while live). Browser:
`.probe/voice-sim-probe.mjs` against the dev server with
`JARVIS_LIVE_SIMULATE=1` — screenshots and the transcript in
`.probe/voice-sim/`.

## 9. Limitations

- The live model is _instructed_ to call `answer_from_workspace` first
  (backend rule 8); it is not structurally prevented from answering itself.
  The simulated mode proves everything behind the tool; the live model's
  compliance needs a live run (TD-121).
- The real voice has not been heard in this slice; the user's ear remains
  the validation of the spoken rendering's naturalness.
- An ambiguous first name is proven in tests with a synthetic twin; the dev
  record has none.
- The advisory ring and the session are process-local, like the record.

## 10. The market path — one family of questions, one recogniser (2026-10-03)

**Root cause of the screenshot.** The deterministic market path only
recognised a named instrument's current state. A region ("amerikanska
börsen"), a period ("i veckan"), a comparison or a bare follow-up went to
the general model; in the simulated voice that model is a stub, and its one
sentence was the implementation line the advisor saw. There was also no
application service for historical series, and market follow-ups carried
only a timestamp between turns.

**The path now.** `application/jarvis/marketQuery.ts` recognises the market
family for typed and spoken lines alike — `MARKET_INDEX_PERFORMANCE`,
`MARKET_REGION_PERFORMANCE`, `MARKET_COMPARE`, `MARKET_BEST`,
`MARKET_RATES`, `MARKET_OVERVIEW`, sectors, risk, VIX and not-served — with
a closed alias lexicon (S&P / S&P 500 / SP500 / SPX / "amerikanska
storbolag"; Nasdaq / Nasdaq 100 / NDX; Dow and Russell as not served;
"amerikanska börsen" / "USA-börsen" / "börsen i USA" as the US region) and a
Swedish period resolver (idag, i veckan, senaste 5 handelsdagarna, den här
månaden, i år, sedan årsskiftet, kvartalet, senaste året, a named month;
"igår" as unsupported). `marketHistory.ts` turns a daily series into a
period move with provenance checks; `marketAnswer.ts` composes the
structured `MarketAnswer`; `presentation/jarvis/marketAnswerText.ts`
renders it twice — the full text for the screen, the short sentence for the
voice. The Tier-0 wording for a single instrument today is unchanged.

**Where it runs.** `respond` in `liveSession.ts` runs the market query
before anything else, for a typed line and for a simulated spoken line
(`hear`). For the real voice, `answer_from_workspace` answers a market line
through the same path before the record, so the voice model relays and
never answers the market itself. `advisoryTurn` and `workspaceTurn` yield to
any market query, so a clearly named instrument wins on Client 360.

**Context.** The session, and for the typed path the browser's
`marketContext` pointer, carry `{ symbols, region, period }` of the last
market answer. "Och Nasdaq?" keeps the period; "Och i veckan?" keeps the
subject; "Jämför med S&P." adds S&P over the same period; "Vilken gick
bäst?" ranks the set; explicit terms always override; a full question with
no period means today. Generic lines ("Vad händer idag?", "Vad sticker
ut?") are the market's only on the market dashboard.

**Honesty.** A period the platform cannot serve is named as missing with
its reason, and today's figure travels separately as today's: "Jag har
dagens S&P 500-data, men inte en komplett veckoserie i den här
datakällan." The daily change is never reused as a period change (TD-123).
The simulated stub's sentence no longer names the model or the register.

**Verification.** `marketQuery.test.ts`, `marketHistory.test.ts`,
`marketAnswer.test.ts`, `marketAnswerText.test.ts` (the screenshot
regression), the live-session tests for the simulated hear sequence and the
real-voice tool path, `askJarvis.test.ts` for the pointer, and the browser
probe `.probe/market-voice-probe.mjs` (screenshots in `.probe/market-voice/`).
