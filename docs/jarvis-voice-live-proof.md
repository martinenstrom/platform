# JARVIS voice — the GPT-Live proof (revised cost ruling, 2026-09-15)

**Status: proof built and committed; blocked at the OpenAI credit boundary;
nothing implemented in the product; no subscription bought.** The revised
ruling accepts SEK 100–400 a month in OpenAI credits and asks whether
GPT-Live-1 gives the Swedish JARVIS experience before any chained
STT/TTS provider is paid for. This document records what was measured on
2026-09-15, exactly what the proof is, and what it will measure the moment
the account has credits.

---

## 0. The boundary, measured

| Step | Result |
| --- | --- |
| Model listing | The account sees `gpt-live-1` (and `gpt-live-transcribe`, `gpt-realtime-2.1`, `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`). |
| Minting a client secret for `gpt-live-1` | `200` — the session config validates (default voice `marin`). Minting is free. |
| Voice names accepted for `gpt-live-1` | **marin, cedar, alloy, ash, ballad, coral, echo, sage, shimmer, verse** (10). `sol` answers _"not available for your organization"_; every other guess is refused with the same list of ten. |
| `POST /v1/live/sessions` (a real session) | **`429 insufficient_quota · credit_balance_exhausted` — "You have no credits remaining."** |
| `POST /v1/responses` (the typed fallback) | the same refusal |

So the API is reachable and the account is entitled to the model, but the
project has **no credits**. The proof server surfaces this exactly: the
page reports _"Sessionen kunde inte skapas (500). Skriv i stället."_, and
typing then fails on the same wall. Everything below the line "what it will
measure" is unmeasured until credits exist.

## 1. Exact model and transport

- **Voice model:** `gpt-live-1`, the full-duplex model (listens while it
  speaks; no turn-based VAD; interruptions handled by the model).
- **Transport:** browser **WebRTC**. The browser holds the microphone and the
  speaker on the negotiated media track and a data channel `oai-events`
  for JSON events. The browser never sees the API key: it posts its SDP
  offer to the proof server, which calls `POST https://api.openai.com/v1/live/sessions`
  with the server-side key and returns the SDP answer. No `session.start`
  on the data channel — the HTTP request starts the session.
- **Sideband:** the server attaches
  `wss://api.openai.com/v1/live/sessions/{id}/attach` with the same key
  (documented for exactly this: a server observing a browser-owned session).
  It receives the same events as the browser and is where every backend
  function call is executed and returned (`response.item.create` with the
  `function_call_output`, then `response.create`). Node 24's built-in
  WebSocket is used with a headers option; that this option carries the
  `Authorization` header is unverified until a session exists.
- **Delegation:** `responses` mode with backend `gpt-5.6-luna` ($0.20 / $0.02
  cached / $1.20 per 1M tokens; `gpt-5.6-terra` is the higher tier at
  $2.00 / $0.20 / $12.00), instructions of its own, three function tools,
  `tool_choice: auto`, `parallel_tool_calls: false`.
- **Store:** not set (no recording kept by OpenAI).

## 2. The session, verbatim

Voice instructions (`session.instructions`):

> Du är JARVIS, en personlig investeringsintelligens i ett institutionellt
> kommandocenter. Du talar svenska som förstaspråk. Språk: svenska in →
> svenska ut. Engelska in → engelska. Blandat → svenska, med engelska namn
> och finanstermer oförändrade och naturligt uttalade: Nvidia, Fed, ECB,
> CPI, Treasury, duration, yield curve, equity risk premium, earnings
> yield, term premium, higher for longer. Karaktär: lugn, intelligent,
> självsäker, varm men återhållsam, mänsklig, närvarande, lite levande.
> Inte teatralisk, inte radioröst, inte kundtjänst, ingen överdriven
> entusiasm, aldrig mångordig. Korta svar på enkla frågor. Svara själv,
> direkt, på enkla frågor, definitioner, uppföljningar och småprat.
> Delegera till backend när frågan kräver djupare resonemang, och ALLTID
> när det är en investeringsbedömning: köpa, sälja, minska, öka, en
> position, ett bolag eller en fond givet makro. Sådant avgörs av
> investeringskommittén i Financial OS, aldrig av dig. Säg "Jag kollar på
> det och återkommer." ENDAST när backend bekräftat att ett ärende faktiskt
> skapats. Påstå aldrig att kommittén är klar eller vad den kom fram till
> förrän ett resultat faktiskt finns. Gick något inte, säg det rakt.
> Fortsätter användaren tala medan ett ärende pågår, till exempel "ta
> hänsyn till dollarn också", ska det läggas till i det pågående ärendet
> via backend; bekräfta kort. Läs aldrig upp tekniska id:n, referenser
> eller verktygsnamn.

Backend instructions (`delegation.responses.instructions`):

> Du är JARVIS resonerande lager bakom rösten. … 1. Investeringsbedömningar
> delegeras ALLTID med delegate_to_financial_os. Ge aldrig en egen slutsats
> om sådant. 2. Följdfrågor eller tillägg om ett pågående ärende:
> add_to_delegation. Frågor om läget: check_delegation. 3. Allmänna
> finansfrågor besvarar du själv, kort och korrekt. 4. Verktygssvar
> innehåller fältet "say": förmedla det, gärna med egna ord, men hitta
> aldrig på ett resultat som verktyget inte gav.

Tools (`delegation.responses.tools`), executed only on the server:

| Tool | Creates / reads | Returns |
| --- | --- | --- |
| `delegate_to_financial_os(question, subject)` | a real reference `ref-…` with a timestamp, state `working` | `say: "Jag kollar på det och återkommer."` and the rule that nothing may be claimed about the result |
| `add_to_delegation(note, reference_id?)` | appends the note to the open reference | `say: "Noterat, det tas med i ärendet."` or, with no open reference, a refusal |
| `check_delegation(reference_id?)` | reads the reference | `state: working`, seconds elapsed, `say: "Kommittén arbetar fortfarande med det…"` — **never completes** |

That is the routing boundary the ruling asks for, made concrete: the voice
model answers the easy things itself (fast path); the backend model reasons
(reasoning path); an investment judgement can only become a tool call that
creates a reference (institutional path), and the acknowledgement is tied
to the reference's existence. No second router lives inside GPT-Live; the
same tools serve the typed path, so voice and text share the semantics.

The stub is a stand-in for `financialOsHostFn`. Wiring the real gateway is
one function call away and deliberately not done: the proof is about the
conversation, and the ruling forbids production voice.

## 3. What the proof measures, and how

`scripts/voice-live/live.html` (the interactive page) shows the transcript
as GPT-Live heard and said it with session times, the turn latency
(assistant transcript start − user transcript end), interruptions detected
(user speech beginning while assistant speech is still in flight), the
delegations the stub holds, and the running cost. Typing is always
available: with a live session the text is injected as a trusted
instruction (`session.instructions.append` — GPT-Live has no user-text
event; whether this yields a spoken answer is one of the things to
measure); without a session it goes to the same backend and tools through
the Responses API.

`scripts/voice-live/make-wav.mjs` turned the person's twelve bake-off
recordings into 24 kHz WAVs (decoded in headless Chromium; no ffmpeg here)
and composed five conversations for a fake microphone:

| Conversation | Content | Tests |
| --- | --- | --- |
| c1-nvidia-cpi | u01 _"Jarvis, hur ser du på Nvidia efter senaste CPI-siffran?"_ | Swedish, company name, acronym, direct answer or delegation, latency |
| c2-delegation | u03 _"Hur påverkar higher for longer Handelsbanken Hållbar Energi?"_ then, 12 s later, u09 _"Okej men ska jag faktiskt köpa den nu…"_ | delegation created, acknowledgement only after it, conversation continues while it is open |
| c3-interrupt | u12 (the 15-second question), then u04 2.5 s into the answer | interruption while JARVIS speaks |
| c4-terms | u04, u06, u08 | Fed, earnings yield, equity risk premium, yield curve, inverterad, term premium, Treasuries |
| c5-english | u10, all English | the answer-language rule |

`scripts/voice-live/probe-live.mjs` plays each into headless Chromium
(`--use-file-for-fake-audio-capture`), connects through the page, waits
the conversation out, and writes transcripts, latencies, interruptions,
delegations, tool calls, voice seconds and cost to `results/`, plus
`results/probe-report.md`. Voices are a parameter, so the same
conversation can be heard from several.

Telemetry (`results/telemetry-<session>.json`, and `/telemetry`): voice
seconds from `session.usage.updated` / `session.closed`, voice cost at
$0.05 per minute billed per second, backend tokens from every nested
`response.completed`, backend cost at the model's list price, tool calls by
name, delegations, event counts, typed injections, projected cost per hour.
Counts and money only — no transcript text is stored on the server.

## 4. Cost, projected from list prices (not yet measured)

Voice: $0.05/min = **$3.00 per hour** of open session, silence included.
Backend: gpt-5.6-luna is cheap enough that, at one delegation every couple
of minutes with a few thousand tokens of context each, it adds cents per
hour (terra would add tens of cents). Measured ratios replace this
assumption after the first sessions.

| Hours / month | Voice (USD) | Voice + backend estimate (USD) | ≈ SEK at 10.5 |
| --- | --- | --- | --- |
| 1 | 3.00 | ≈ 3.05 | ≈ 32 |
| 3 | 9.00 | ≈ 9.15 | ≈ 96 |
| 5 | 15.00 | ≈ 15.25 | ≈ 160 |
| 10 | 30.00 | ≈ 30.50 | ≈ 320 |

The SEK 100–400 budget therefore buys roughly **3 to 12 hours of open
session a month**. Session time, not backend reasoning, is the cost; the
product should close idle sessions rather than hold them open.

## 5. What this proof did not measure

Everything that needs a session: first-response and turn latency,
interruption behaviour, Swedish and finance-term rendering by each voice,
delegation and continuation in practice, transcript fidelity, whether typed
injection produces speech, actual backend token use. The harness is ready
for all of it.

## 6. To run it

```
node scripts/voice-live/server.mjs           # then open http://localhost:4175/ and talk
node scripts/voice-live/probe-live.mjs       # the five conversations, voice marin
PROBE_VOICES=marin,cedar,ash,sage node scripts/voice-live/probe-live.mjs c1-nvidia-cpi
```

Needed first: OpenAI credits on the project the key belongs to.
