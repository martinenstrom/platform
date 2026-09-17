# JARVIS voice — the GPT-Live proof (revised cost ruling, 2026-09-15)

**Status: proof built, run against 24 live sessions on 2026-09-15 once
credits existed; measured results in §7; nothing implemented in the
product; no subscription bought.** The revised ruling accepts SEK 100–400
a month in OpenAI credits and asks whether GPT-Live-1 gives the Swedish
JARVIS experience before any chained STT/TTS provider is paid for. §0–§6
record the proof as built (and the credit boundary it first met); §7 is
what it measured; §8–§9 take it into the product; §10 (2026-09-16) measures
how the conversation flows, before and after the person's two acts on an
open case were given real doors; §11 (2026-09-16) draws the line between
what the market is doing and what to do with capital, and measures it by
text and by voice; §12 (2026-09-17) takes the fast path off the model,
benchmarks the backend's reasoning effort and service tier, and measures
every latency class by text and by voice.

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
LIVE_ACK_MODE=strict node scripts/voice-live/server.mjs     # then open http://localhost:4175/ and talk (add ?record=1 to keep JARVIS's audio locally)
node scripts/voice-live/probe-live.mjs                       # the seven conversations, voice marin
PROBE_VOICES=marin,cedar,ash,sage node scripts/voice-live/probe-live.mjs c4-terms
LIVE_TYPED="Vad är term premium?" node scripts/voice-live/probe-live.mjs c5-english
```

## 7. Measured — 24 live sessions, 2026-09-15

Every number below comes from `scripts/voice-live/results/` (git-ignored):
per-session telemetry, per-run transcripts, and JARVIS's own audio captured
in the browser. Transcript times are the session clock in 200 ms buckets.
The person's microphone was headless Chromium playing their own bake-off
recordings, so what GPT-Live heard is the same Swedish voice Scribe heard.

### 7.1 Transport and account facts

- `POST /v1/live/sessions` with the server key returned a session and an SDP
  answer in **0.3–1.5 s**; `session.started` arrived **1.4–2.8 s** after the
  Connect click, negotiation included. Node 24's built-in WebSocket carried
  the `Authorization` header to the sideband: every backend function call
  in the test was executed through it.
- `store: true` is **refused for this project** — _"Stored sessions require
  a project that permits data persistence."_ OpenAI keeps no recording;
  the listening set was captured from the browser's remote track instead,
  opt-in, locally.
- Backend delegation ran on `gpt-5.6-luna`. Input context per delegated
  response was 1–10 k tokens, a third of it cached.

### 7.2 Latency

| What | Measured |
| --- | --- |
| Acknowledgement after the person stops (_"Ett ögonblick."_, _"Mm."_) | **same 200 ms bucket** in 22 of 31 turns; 200–600 ms in 7; 1.0 s once (ballad); 2.2–2.4 s twice, both after the one utterance GPT-Live's own transcript garbled |
| Delegated answer spoken after the question ends (backend reasoning, luna) | **3.6–4.4 s** (c2 8.2 s tool → 9.4 s speech for a 5.8 s question end; c6 9.6 s → 13.8 s) |
| Direct answer (no tool) spoken after the question ends | 3.2–4.2 s |
| Typed text injected into a live session → spoken answer | ≈ 1.5 s |

So the shape the routing addendum asks for is what GPT-Live does by itself:
an immediate human acknowledgement, then the answer when the backend has
it. The acknowledgement is not a canned clip — _"Ett ögonblick."_, _"En
sekund."_, _"Ehm, en sekund."_, _"Hmm. Ja."_, _"Jag lägger till det."_ —
which is the "slightly alive" the previous ruling asked for.

### 7.3 Full duplex and interruption

- **Backchannels while the person is still talking**: during the 15-second
  question (u12) JARVIS said _"Mm."_ at 8.2 s, mid-sentence, and let the
  person finish. Listening and speaking overlap in the transcript feed
  exactly as the docs describe.
- **Interruption, measured once with true overlap** (c7, second run):
  JARVIS was asking a clarifying question from 12.8 s; the person began
  _"Okej, men ska jag faktiskt köpa den nu…"_ at 16.2 s; JARVIS **finished
  his own short sentence (2.8 s more, to 19.0 s) rather than stopping
  mid-word**, then answered the new input (_"Ett ögonblick."_ at 20.4 s,
  then _"Vad syftar du på med 'den'…"_). Nothing was lost on either side.
  Whether a long monologue is cut off sooner was not observed: in every
  other run JARVIS's turn had already ended when the follow-up came,
  because his turns are short. The interactive page is where the person
  can push on this.

### 7.4 Swedish, English, and the finance vocabulary

What GPT-Live heard (its own input transcript), across six voices and
eleven runs of the terminology conversation and the others:

- Right every time: _Fed_, _earnings yield_, _equity risk premium_, _yield
  curve_, _inverterad_, _tvååringen_/_tioåringen_, _term premium_,
  _Treasuries_/_Treasury_, _higher for longer_, _Handelsbanken Hållbar
  Energi_, _Nvidia_, _CPI-siffra_, _tioårsräntan_, _4,5 %_, _fyrtio gånger
  vinsten_, _investeringskommittén_, _tekniksektorn_, _ECB_, _realräntan_.
- Wrong every time: the opening of u02, _"Vad händer med durationen om US
  10-year går upp 50 basispunkter"_, came back as _"Ben de med
  durationen…"_, _"Ben de moderasyonen…"_, _"US tenyar grup 5"_ in all four
  runs — Scribe v2 had it verbatim. **The model still answered the
  duration question correctly in three of the four runs** (price falls by
  roughly duration × the yield change; a duration of eight …) and asked a
  sensible clarifying question in the fourth. The transcript is a
  by-product; understanding held.

What JARVIS said, as text: concise, correct, Swedish with the English
terms left as English — _"Om yielden på US 10-year går upp 50 baspunkter,
faller obligationspriset ungefär med durationen gånger den
förändringen"_; _"Higher for longer betyder att styrräntorna väntas ligga
kvar högre längre, så längre duration, alltså räntekänslighet, blir mer
sårbar"_; _"Realräntan är ungefär nominell ränta minus förväntad
inflation."_ How the terms _sound_ inside the Swedish is on the recordings.

Language rule: Swedish in → Swedish out, every run. Mixed in → Swedish with
the terms intact, every run. English in → English out in one of the two
strict runs (_"One moment." / "I'll look into it and get back to you."_)
and Swedish in the other (the acknowledgement slipped to _"Ett
ögonblick."_ and the Swedish phrase). Typed Swedish into an English
session → a Swedish answer, which is right.

### 7.5 Delegation and the acknowledgement rule

Across the runs, **every investment judgement became a delegation tool
call** — a view on Nvidia after CPI, Hållbar Energi under higher for
longer, _"ska jag köpa den nu eller vänta"_, cutting the tech sector, what
an ECB cut means for Swedish real rates — and **every conceptual question
was answered directly** (duration arithmetic, term premium, higher for
longer). Follow-ups while a case was open (_"Är yield curve fortfarande
inverterad…"_, _"Har term premium … stigit…"_) went to `add_to_delegation`
and the reference collected them: _"Noterat, det tas med i ärendet."_ No
transcript contains an invented result; `check_delegation` was never needed
because nothing ever completed, and JARVIS never claimed it had.

The sentence _"Jag kollar på det och återkommer"_ needed two iterations of
instruction:

| Instruction | Observed |
| --- | --- |
| natural — _"say it only when backend confirms a case"_ | spoken **1.5–2.0 s before** the reference existed (c1: said at 5.2 s, reference at 7.2 s), and often twice |
| strict v1 — _"say at most 'Ett ögonblick', the sentence only after confirmation"_ | after the reference for real delegations, but still spoken for a direct-answer handoff where no reference was ever created (c6) |
| **strict v2 — _"never say it yourself; only backend says it, when a case exists"_** | **13 of 13 sessions**: _"Ett ögonblick."_ on handoff, the sentence 1.0–1.2 s **after** the reference, once, and never on the direct path |

That is the ruling's rule, enforced where it can be enforced: the sentence
lives in the tool result, not in the voice model's licence.

### 7.6 Typed input and degradation

- Session refused (the credit boundary, earlier in the day): the page said
  _"Sessionen kunde inte skapas (500). Skriv i stället."_ and typing went
  to the Responses path.
- Responses path with credits: _"Vad är term premium, kort?"_ → a two-sentence
  definition, no delegation, 1 050 / 63 tokens; _"Borde jag minska Hållbar
  Energi givet långräntorna?"_ → a reference created and _"Jag kollar på det
  och återkommer."_
- Typed into a live session (`session.instructions.append`, since GPT-Live
  has no user-text event): answered aloud about 1.5 s later.

### 7.7 Voices

Six of the ten accepted voices were heard on the terminology conversation
— **marin, cedar, ash, sage, echo, ballad** — with identical behaviour
(the same delegations, the same acknowledgement timing within a bucket).
JARVIS's side of each is in `results/live-<voice>-<session>.webm`, plus
marin on the delegation, direct, English and interruption conversations.
The choice between them is the ear's; this document ranks none of them.
Marin is OpenAI's default and the one heard most here.

### 7.8 Cost, measured

| | Measured over 24 sessions |
| --- | --- |
| Voice time | 14.4 min (sessions 20–47 s each; connect-to-close) |
| Voice cost | $0.72 at $0.05/min billed per second |
| Backend (gpt-5.6-luna) | 90 responses, ≈140 k input tokens (a third cached), ≈7 k output → **$0.04** |
| Tool calls | 40, no charge of their own |
| Total | **≈ $0.76**, of which backend ≈ 5 % |
| All-in per open hour | **$3.15** ($3.00 voice + $0.15 backend) |

| Hours / month | Voice | Backend | Total | ≈ SEK at 10.5 |
| --- | --- | --- | --- | --- |
| 1 | $3.00 | $0.15 | $3.15 | 33 |
| 3 | $9.00 | $0.46 | $9.46 | 99 |
| 5 | $15.00 | $0.77 | $15.77 | 166 |
| 10 | $30.00 | $1.53 | $31.53 | 331 |

Terra instead of luna would multiply the backend line by about ten and
still leave it under a tenth of the voice line. The budget of SEK 100–400 is
roughly 3–12 open hours a month; closing idle sessions is the whole cost
discipline.

## 8. The architecture ruling of 2026-09-15, executed to the stop line

GPT-Live-1 over WebRTC is JARVIS Voice v1's architecture. What the ruling
ordered, and what each order measured.

### 8.1 The six voices, for the ear

```
node scripts/voice-live/listen.mjs          # builds scripts/voice-live/results/listen.html
```

Open that file in a browser (or `http://localhost:4175/listen` while the
proof server runs). One table per conversation; one row per voice with
JARVIS's audio and the words beside it. The recordings are JARVIS's side of
each session, captured in the browser with `?record=1`; nothing is ranked.

### 8.2 Barge-in, measured against a speaking JARVIS

Client mechanism: an energy detector on the microphone in `live.html`; when
the person begins while JARVIS is speaking, the speaker is muted in the same
animation frame and stays muted until JARVIS begins a new turn after the
person's. The model hears everything; only the audible playback is cut.

Two runs, JARVIS mid-sentence when the person began (the model kept its
answers to ~4 s despite an instruction to speak for 20–30 s, so the
interruption landed inside a short explanation, not a monologue):

| Run | Person begins → playback cut | JARVIS's old turn ran on to | Person ends → backend | Person ends → new JARVIS turn |
| --- | --- | --- | --- | --- |
| 1 | 0 ms (same frame) | +1.4 s after onset | +0.8 s | +1.0 s |
| 2 | 0 ms (same frame) | +1.0 s after onset | +0.8 s | +1.0 s |

So: audible interruption is immediate on the client; the model itself
stops within 1.0–1.4 s of the onset (its transcript shows _"och"_, _"…"_
and silence); the new turn begins one second after the person stops. What
the ear will judge is the second of near-silence between the cut and the
new turn.

### 8.3 English in → English out, retested

Instruction tightened to name the acknowledgements (_"One moment."_) and to
switch back only when the person does. Three runs of the all-English
question: **3 of 3** answered in English (_"One moment." / "I'll look into
it and get back to you."_), and the earlier slip did not recur. Backchannel
fillers (_"Ehm"_) did not appear in the runs after the instruction to stay
silent while the person continues; one run is not proof, and the ear on the
listening set is.

### 8.4 The real host boundary, instead of the stub

The product now has its own door for a live session, and every delegation
goes through the host gateway `financialOsHostFn` uses:

```
browser (mic, speaker, WebRTC, data channel)
   → openLiveSessionFn { sdp, voice }            src/infrastructure/jarvis/serverFns.ts
   → POST /v1/live/sessions with the server key  src/infrastructure/jarvis/openaiLive.ts
   → sideband socket, held by the server         src/infrastructure/jarvis/liveSession.ts
   → backend function call
   → interpretToolCall → HostRequest             src/application/jarvis/liveTools.ts
   → productHostGateway()                        src/infrastructure/analysis/runtime.ts (shared with financialOsHostFn)
   → HostResult → toolSpeech                     src/presentation/jarvis/liveSpeech.ts
   → response.item.create + response.create      back on the sideband
```

The browser sends an SDP offer and at most a voice name; `parseLiveOpen`
refuses any other field by name. Measured on the dev server: an open request
carrying `actorEmployeeId` came back `INVALID_REQUEST · actorEmployeeId`.
The operator is the server-resolved one, JARVIS the initiator; the voice
model sees four functions — delegate, check, result, add — and no command,
run, playbook or actor.

Measured on the product's door, the person's own recording as the microphone:

| Dev server | The voice delegated, the firm answered | JARVIS said |
| --- | --- | --- |
| no operator configured | `ask` → `failed · operator-unresolved` | _"Det gick tyvärr inte att genomföra den här bedömningen nu eftersom ingen operatör är konfigurerad."_ — no promise |
| `FINANCIAL_OS_OPERATOR_EMPLOYEE_ID` set to the dev research director | `ask` → a real case opened → `needs-decision` (TD-88) | _"Jag behöver ditt beslut på en sak: kommittén är sammankallad men saknar en utgångstes…"_ — a decision asked for, not work promised |

The case the second run opened is in the dev firm's record with JARVIS as
initiator and the research director as actor, through the same command and
provenance path as a typed ask.

**The temporary boundary, stated:** the execution-depth decision is made
by the two models' instructions (the voice answers the easy, the backend
reasons, only a judgement becomes a tool call) and by the tool boundary
itself; the adaptive router of the addendum is not built, and no second
router was invented inside GPT-Live. `add_to_delegation` has no host
request to become and is refused honestly (TD-94).

### 8.5 Reference before acknowledgement — structural

- The sentence _"Jag kollar på det och återkommer"_ is produced in one place,
  `toolSpeech` in `presentation/jarvis/liveSpeech.ts`, for one product state,
  `working`; `acknowledgeWork` is false for every other state, and
  `liveSpeech.test.ts` proves it for all six.
- The voice model is told never to say it itself; the backend is told the
  flag means what it says.
- The session runtime watches the voice's own transcript and counts every
  promise of work spoken while the firm has never reported `working`
  (`ackWithoutReference`); `liveSession.test.ts` proves the count. Every
  live run in this document since the strict instruction: **0**.
- On the product door there was no `working` case to test the true
  acknowledgement against — the dev firm's asks land in TD-88 — so the
  positive sentence has been exercised through the unit table and the
  proof-server stub, not yet through a live case that is actually running.

### 8.6 Open-session cost protection

The server closes a session after `JARVIS_LIVE_IDLE_SECONDS` (default 90)
without user speech, and no session outlives `JARVIS_LIVE_MAX_SECONDS`
(default 1 200). Measured on the proof server with a 30-second policy: the
session closed itself 30 s after the last word, reason recorded as
`idle 30 s`, final usage read from `session.closed`. Sessions start and stop
only on the person's explicit action; there is no always-on path.
Telemetry per session and in total (`liveTelemetryFn`): voice seconds,
voice cost, backend tokens and cost, tool calls, delegations, typed
injections, invariant violations, close reason. No transcript.

### 8.7 Tests and probes

- `src/application/jarvis/liveTools.test.ts` — the four functions, the
  actor stripped, the note refused.
- `src/presentation/jarvis/liveSpeech.test.ts` — the invariant table.
- `src/infrastructure/jarvis/liveSession.test.ts` — the runtime against a
  fake sideband and a fake firm: delegation, states, reference memory,
  the watcher, cost, idle close, typed text, provider refusal.
- `src/test/fitness` — the network rule now names the live-voice provider
  as the second boundary and checks it honours the network-disabled guard
  and a timeout; a planted `fetch` in another jarvis file failed the rule
  before the allowance was trusted.
- `scripts/probe-jarvis-live.mjs` — the product door, live, both operator
  states above.
- `scripts/voice-live/probe-live.mjs` — the proof server: barge-in,
  English, idle.

### 8.8 Still open before "production-complete"

- The person's choice of voice.
- Wiring the presence's microphone button to `openLiveSessionFn` — the UI
  is deliberately untouched; the door exists, the button does not.
- A live `working` case on the product door, once the dev firm has one.
- Barge-in judged by ear on the second of near-silence.
- TD-93 (one process holds the sideband) before a second server instance.

## 9. The HQ microphone — wired and measured, 2026-09-15

The last gap the ruling named: the microphone on screen in the real
presence did nothing. Now it does the one thing — presses to a live
session through the product's door, presses again to end it.

### 9.1 What changed in the presence

- `src/components/jarvis/voiceSession.ts` — the browser's side of a
  session: microphone, speaker, WebRTC track, data channel, the offer to
  `openLiveSessionFn` with the conversation's case pointer and nothing
  else; transcript fragments to the presence; the state word; barge-in
  mute in the same frame; `pagehide` closes the peer connection; failures
  become Swedish sentences.
- `JarvisPresence.tsx` — `InertMicrophone` (_"Röst kommer"_) is gone.
  `MicrophoneButton` stands in both the resting strip and the panel, with
  `aria-pressed`, the label _Starta röst_ / _Avsluta röst_, and the state
  word Röst · Ansluter… · Lyssnar · Tänker · Talar · Röst otillgänglig.
  Pressing it from the strip opens the panel and starts the session.
  Fragments become turns in the one conversation, marked _röst_; a spoken
  delegation's case becomes the one reference (`Aktivt ärende`, the same
  follow-ups and doors); the compose sends a typed line into the live
  session while one runs (_Skicka in i samtalet_) and asks the firm when
  none does; collapsing, forgetting and unmounting end the session; a
  notice line and a cost line (_Röst · 0:43 · $0.038_) sit under the
  compose.
- `presenceStore.ts` — a turn may carry `via: 'voice'`. Nothing else in
  the store changed: one history, one reference, one open flag.
- The door grew one field: `openLiveSessionFn` accepts the case
  `reference` the conversation is already bound to (parsed field by field
  in `application/jarvis/liveOpen.ts`, still refusing anything else by
  name), and `liveSessionStateFn` reports `lastAsk` so the presence can
  name the case the way the typed path does.

Voice is configuration: `JARVIS_LIVE_VOICE` on the server, `marin` until
the person chooses from the listening page; the browser never names one.

### 9.2 Measured on the real HQ, the person's recording as the microphone

`scripts/probe-jarvis-hq-voice.mjs` opens `/`, presses the microphone the
presence shows, and reads the presence — not a proof page. Two runs, dev
server with the dev research director configured:

| Step | Observed |
| --- | --- |
| The strip | mic _Röst_, `aria-pressed=false`, no _Röst kommer_ anywhere |
| Press | panel opens, _Ansluter…_ → _Lyssnar_ after 3.2 s and 5.0 s |
| Spoken question | in the conversation, marked _röst_, within a second of being said |
| Investment question (Nvidia after CPI) | _Ett ögonblick._ → the firm opened a real case → _"Jag behöver ditt beslut på en sak. Kommittén är sammankallad men saknar en utgångstes…"_ → the presence shows the case as _Aktivt ärende_ with its follow-ups and both doors |
| Conceptual question (ECB and Swedish real rates) | answered directly, aloud, in Swedish |
| Promise of work | none spoken in either run; invariant counter 0 |
| Cost line | _Röst · 0:15 · $0.013_ and _Röst · 0:43 · $0.038_ |
| Typed while live (_"Men vad är största risken?"_) | in the conversation as typed, answered aloud (_"Det beror på sammanhanget. Vad handlar det om?"_ — continuity of the channel, if not a sharp answer) |
| Press again | mic back to _Röst_; the server's telemetry closed the session (reason `connection_lost`, the peer connection going down ahead of the close request) |
| Reload | mic off, the conversation still there (4 and 9 turns), no session open on the server |
| Browser errors | none |

Screenshots in `.probe/hq-voice-*.png`.

### 9.3 The manual acceptance test, for the person

Start the dev server with an operator and open HQ:

```
FINANCIAL_OS_OPERATOR_EMPLOYEE_ID=<a seeded employee id> npm run dev
```

Then, in the browser: press the microphone in the strip; allow the
microphone; wait for _Lyssnar_; ask something simple in Swedish; hear the
answer and see both lines in the conversation; ask a mixed Swedish/English
finance question; ask an investment judgement and hear the firm's real
state; interrupt while JARVIS speaks and hear the speaker cut; type a
follow-up and hear it answered; speak a follow-up; press the microphone
again and see _Röst_; collapse, reload, and see the conversation kept and
typed JARVIS working. Steps 1–7, 9–10 and 12–15 are what the probe above
measured; 8 (mixed terminology, heard) and 11 (the cut, heard) are the
ear's.

### 9.4 Tests

Nine presence tests drive the wiring with a stand-in WebRTC and microphone:
the offer and nothing else, the states, the one conversation, typed while
live and after, opening bound to a typed case, binding to a spoken case,
ending on press / collapse / forget, a blocked microphone, a refused door,
an idle close. The import scan admits `~/infrastructure/jarvis/serverFns`;
the audio-API guard now names `voiceSession.ts` as the one place the
microphone may be opened and forbids recognition, synthesis and recording
in the browser. `liveOpen.test.ts` covers the reference field.

### 9.5 Still not production-complete

- The voice: the person's choice from the listening page.
- A live `working` case heard through HQ, once the dev firm has one.
- Barge-in and mixed-term pronunciation judged by ear.
- TD-93 before a second server instance. (TD-94, spoken additions, was
  closed on 2026-09-16 — §10.)

### 7.9 What this proof did not settle

- How the voices _sound_ in Swedish — the recordings are there; the ear is
  not.
- Whether a long JARVIS monologue is cut off promptly on interruption; the
  one overlap observed was a short sentence, finished.
- The English-in → English-out rule holds most but not all of the time;
  one instruction pass on it is likely enough, and it was not done here.
- The delegation stub is not `financialOsHostFn`; wiring it is a small,
  deliberate, ruled step.

## 10. The conversation, measured for fluidity — before and after, 2026-09-16

The HQ microphone worked; the question that followed was how the
conversation _felt_. `scripts/probe-jarvis-flow.mjs` drives six
representative flows through the real presence in one live session — the
person's recordings as the microphone for the spoken ones, the presence's
own compose for the typed ones — and reads the presence and the server's
per-turn timeline (`LiveTelemetry.turns`: when the person stopped, when the
model handed off, the backend's span, the host call, and where each spoken
reply began; milliseconds only, no words).

| Flow | What the person does |
| --- | --- |
| A | a conceptual question, spoken (u02, duration arithmetic) |
| B | an investment question that enters the firm, spoken (u01, Nvidia after CPI) |
| C | an immediate spoken follow-up (u09, "ska jag köpa den nu eller vänta") |
| D | a typed addition to the open case: _"Ta hänsyn till dollarn också."_ |
| E | a typed request to close it: _"Stäng ner det pågående ärendet."_ |
| F | a typed follow-up: _"Varför stängde vi det?"_ |

### 10.1 Before (2026-09-15 21:06 UTC, `.probe/flow-before.json`)

| Flow | Via | Backend span | Host | Tool | What JARVIS said |
| --- | --- | --- | --- | --- | --- |
| A | spoken | 2.8 s | – | delegated | _"Ett ögonblick."_ · then the (correct) duration answer |
| B | spoken | 3.1 s | 647 ms | `delegate_to_financial_os` | _"Ett ögonblick."_ · _"Jag behöver ditt beslut först…"_ |
| C | spoken | 3.5 s | 187 ms | `delegate_to_financial_os` | _"Ett ögonblick."_ · _"Jag behöver fortfarande din utgångstes…"_ |
| D | typed | – | – | none | _"Uppfattat, då tar jag in dollarns nivå och rörelse i helhetsbilden också."_ |
| E | typed | – | – | none | _"Okej, jag stänger det pågående ärendet nu."_ |
| F | typed | – | – | none | _"Du bad mig att stänga det pågående ärendet, så jag gjorde det."_ |

Session 103 s, $0.088, invariant counter 0. What the before run showed:

- **Every spoken turn opened with _"Ett ögonblick."_** — including A, a
  conceptual question the voice model could have answered itself and
  instead delegated. Three acknowledgement-only bubbles in three turns.
- **D, E and F never reached the firm.** No tool was called. The addition
  was acknowledged as if taken in; the closure was announced as done; the
  reason for a closure that never happened was given with confidence. The
  case was still open, unchanged, on the server.
- The first-cut timing columns (first speech, first answer, handoff) were
  not trustworthy — the runtime stamped the reply at the moment the person
  stopped — and are not repeated here. The backend spans and host durations
  were.

### 10.2 What changed

- The two acts the person performs on their open case exist now — `amend`
  and `close`, contract v3, `docs/jarvis-host-contract.md` §10; TD-94
  closed — and the voice's `add_to_delegation` and the new `close_case`
  become them, on the bound case only. The spoken confirmation is produced
  from the case read back after the act.
- The voice instructions no longer ask for an acknowledgement by habit:
  silence on handoff, a short varied word only if the wait is noticeable;
  conceptual questions, definitions and follow-ups are answered by the
  voice model itself; nothing is claimed done that the backend did not
  confirm. The backend answers in one to three sentences without an
  opener.
- The presence shows one bubble per reply: an acknowledgement, a pause and
  an answer are one response, not three messages.
- The runtime keeps a per-turn timeline (`turns`) on the session clock, so
  first speech and first answer are measured where they begin; the backend
  `service_tier` and `reasoning.effort` are configuration
  (`JARVIS_LIVE_SERVICE_TIER`, `JARVIS_LIVE_REASONING`), unset by default.

### 10.3 After (2026-09-16, `.probe/flow-after.json`)

Three runs of the same script. The first lost its live session before the
typed flows for a reason the probe then did not capture — the diagnostics
(mic state, the presence's notice, the server's close reason) were added
after it. The second reproduced all six flows with the session live
throughout and crashed while reporting. The third is below. Paired to the
server's own turns; the person's first utterance showed as two bubbles
because of a pause inside it, and the probe now groups such bubbles as the
one exchange they are.

| Flow | Via | First speech | First answer | Handoff | Backend span | Host | Replies | What JARVIS said |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | spoken | 0 ms (_"Hmm."_) | one continuous reply | −200 ms | 3.5 s | – | 1 | _"Hmm. Ja... [suck] Jag kollar hur det slår igenom. Menar du att yielden på US 10-year går upp fem baspunkter, eller att durationen förändras? …"_ |
| B | spoken | +0.6 s (_"Hm."_) | +5.0 s | +200 ms | 4.1 s | 495 ms | 2 | _"Hm. Kommittén behöver din utgångstes innan de kan bedöma Nvidia. Vill du att vi utgår från att du redan äger aktien, eller att du överväger ett nytt köp?"_ |
| C | spoken | 0 ms (_"Hmm. Okej, jag ser på det."_) | +6.2 s | −200 ms | 5.9 s | 173 ms | 2 | _"… Kommittén behöver din utgångstes för att kunna väga köp nu mot att vänta. Är din grundsyn att Nvidia långsiktigt ska upp, eller vill du främst undvika nedsidan kring rapporten?"_ |
| D | typed | – | – | – | – | – | 0 | nothing, in 14 s |
| E | typed | – | – | – | – | – | 0 | nothing, in 14 s |
| F | typed | – | – | – | – | – | 0 | nothing, in 14 s |

Session 102 s, $0.087; tools `delegate_to_financial_os` × 2; invariant
counter 0; the session open throughout; no browser errors. "First speech"
and "first answer" are measured from the moment the person stopped, on the
session clock; "handoff" is when the model created its delegation (negative
= before the person had finished).

### 10.4 What the after run says

- **_"Ett ögonblick"_ is gone; _"Hm."_ arrived.** Every spoken reply still
  opens with a hum, and A with a sigh the transcript wrote as _"[suck]"_ and
  a filler — _"Jag kollar hur det slår igenom"_ — spoken while the backend
  worked. The instruction to stay silent on handoff changed the word, not
  the habit. Prompt-level control over the acknowledgement is weak; the
  structural invariant (no promise of work without a reference) held at 0.
- **A was still handed off.** The voice model did not answer the conceptual
  question itself; the backend answered with a clarifying question. Fair,
  because the person's recording of u02 came through the transcript as
  _"Ben de medelrationen av US 10 year"_ (§7.4 saw the same), but not what
  the instruction asked for.
- **The institutional answer arrives 5–6 s after the person stops**, of
  which the firm's door is 0.2–0.5 s and the backend model 4.1–5.9 s (3.5 s
  when it called no tool). Before: 2.8–3.5 s backend spans, n = 3 each. The
  after backend carries a longer instruction and five tools. The backend's
  service tier and reasoning effort are configuration now and were unset
  here; that is the knob to measure next, not the door.
- **B and C relayed `needs-decision` faithfully**, in the voice's own words,
  each with a real follow-up question, no promise and no false claim.
- **The typed flows got silence.** Not because the acts refused — nothing
  was asked of them. See 10.5.

### 10.5 The typed path into a live session has never reached the firm (TD-95)

`scripts/probe-jarvis-typed-live.mjs`, a silent microphone and four typed
lines, `.probe/typed-typed-1.json`:

| Typed | Reply | Handoff | Tool |
| --- | --- | --- | --- |
| _"Hur ser du på Nvidia efter senaste CPI-siffran?"_ | none in 16 s | none | none |
| _"Ta hänsyn till dollarn också."_ | 2.7 s: _"Absolut, jag väger in dollarn. Om dollarn stärks kan det pressa riskaptiten …"_ | none | none |
| _"Stäng ner det pågående ärendet."_ | a fragment | none | none |
| _"Varför stängde vi det?"_ | 5.3 s: _"För att vi avslutade det på din begäran, troligen för att du ville avsluta ärendet …"_ | none | none |

Events: `session.instructions.appended` 4, `session.delegation.created` 0.
The product's typed-while-live path is `session.instructions.append`
(GPT-Live has no user-text event, §3). That is an instruction to the voice
model, not a turn of the person's, and the voice model does not hand off
from it: every typed line is answered by the voice model itself, or
ignored. The before run's confident typed answers (§10.1) were the same
mechanism. So the open-case acts are reachable by speaking and not by
typing while the microphone is on — and typing without a session is still
"every text → ask" (transitional, slice C), which would open a new case on
_"ta hänsyn till dollarn också"_. There is no correct typed path for an
addition today. Recorded as TD-95; the invariant watcher cannot see it,
because the voice model claims acts rather than work.

**Ruled and done the same day (§11, TD-95 closed):** typed-while-live goes
from the server to the backend directly — the Responses model with the same
instructions, the same tools and the same host execution, the proof's
`/text` path (§7.6) moved into the product — with its `say` spoken by the
voice and shown by the presence. The same router for voice and text; never
a third one. Re-measured with the same probe: four typed lines reached the
firm as `ask`, `amend`, `close` and `status`, each answered in 2.2–4.8 s
and confirmed from the record.

## 11. Routing by consequence — the market without a committee, 2026-09-16

**The finding, in the real HQ.** The person asked _"Hur ser amerikanska
börsen ut idag?"_ and JARVIS sent it to the firm: a case was opened and
the reply asked whether they wanted a positive, neutral or negative
scenario. Then _"S&P 500"_, typed only because JARVIS had failed to infer
an ordinary market proxy. The ruling that followed: a question about what
is happening is an observation, answered by JARVIS from fresh data; only a
question about what to do with capital goes to the firm.

### 11.1 The doctrine, as the instructions now state it

| The person asks… | Depth | Who answers |
| --- | --- | --- |
| what is happening — _"hur går USA idag?", "vad gör tioåringen?", "hur är VIX?"_ | FAST | JARVIS, from `get_market_snapshot` |
| why — _"varför faller Nasdaq?"_ | mostly FAST | JARVIS, in the same market context |
| what it means in general — _"vad betyder högre tioårsränta för tech?"_ | REASONING | JARVIS |
| what to do with capital — _"borde jag minska USA?", "ska jag sälja Nvidia?"_ | INSTITUTIONAL | the firm, through `delegate_to_financial_os` |

A finance question is not automatically a case. A thesis or scenario is
asked for only when a case the firm actually opened requires it. Levels
from memory are forbidden; a missing number is said to be missing.

### 11.2 The market brief

`application/jarvis/marketBrief.ts` composes the answer's raw material
from the same envelopes the Overview renders — indices, US sectors, the
2- and 10-year with the curve slope, EUR/USD and USD/SEK, Brent and gold,
VIX from the sentiment composite, four headlines — each number with its
observation time, source, quality, freshness (the observation's, by the
instrument's horizon) and delivery (the cache's). Fetched with the
Overview's own symbol lists, so the resolver's cache is shared and a
question inside the page's TTL costs no provider call; none of these
categories is quota-metered. A fixture is never quoted; what a source did
not serve is listed under `unavailable`; what the platform cannot serve
at all — Dow, Russell, DXY, breadth, intraday series — under `notServed`.

`get_market_snapshot(scope)` is the backend's sixth tool, interpreted as
its own kind — never a host request — and executed on the same tool
boundary as the firm's tools; a missing scope is the widest view, never a
question back. The typed path (§10.5, TD-95) now goes through the same
backend and the same tools, with nothing stored at the provider; while a
session is live the routed answer is handed to the voice to say.

### 11.3 Measured by text (`scripts/probe-jarvis-routing.mjs`)

Six lines typed into the presence with no voice session, the firm's case
count read from the dev database before and after each. Run 4,
`.probe/routing-text-4.json`: 10 backend responses, $0.0025; tools
`get_market_snapshot` × 3, `delegate_to_financial_os` × 1.

| Line | Answer after | Cases | What JARVIS answered |
| --- | --- | --- | --- |
| _"Hur ser amerikanska börsen ut idag?"_ | 5.1 s | +0 | _"Den amerikanska börsen stängde svagt ned idag: S&P 500 föll 0,45 procent till 7 551,81. Tekniksektorn steg marginellt, medan energi föll 2,97 procent och finans 1,62 procent; Nasdaq 100 saknas i datan. Räntorna steg, med USA:s tioåring på 5,01 procent och tvååringen på 4,74 procent. Plattformens riskaptitindex ligger på 66, vilket fortfarande signalerar risk-on."_ |
| _"Varför?"_ | 13.1 s | +0 | _"Främst på grund av stigande räntor, som pressar värderingar och finansieringskostnader. Nedgången i energi och finans vägde tungt på S&P 500, medan tech höll emot bättre. Det pekar på en sektorrotation snarare än bred panik …"_ |
| _"Hur går tech?"_ | 4.7 s | +0 | _"Tech höll emot och Information Technology steg 0,10 procent till 6 867,57, medan S&P 500 föll 0,45 procent. … Data är fördröjd och avser den stängda handeln, observerad 16 september kl. 20:20 från Yahoo Finance; Nasdaq 100 saknas."_ |
| _"Vad gör tioåringen?"_ | 3.8 s | +0 | _"USA:s tioårsränta ligger på 5,01 procent, upp 1 baspunkt. Tvååringen stiger mer, 7 baspunkter till 4,74 procent, så hela räntekurvan rör sig uppåt. Observationen är dagens officiella nivå från U.S. Department of the Treasury …"_ |
| _"Vad betyder högre tioårsränta för tech?"_ | 3.4 s | +0 | _"En högre tioårsränta höjer den diskonteringsränta som används för framtida vinster. Det pressar särskilt högt värderade techbolag …"_ — no tool, reasoning |
| _"Borde jag minska min USA-exponering?"_ | 4.6 s | **+1**, bound | _"Kommittén behöver en utgångstes innan den kan bedöma saken. Vill du minska USA-exponeringen främst på grund av höga värderingar, stigande räntor, svagare dollar eller någon annan risk?"_ |

Before the ruling, the first line went to the firm and came back asking
for a positive, neutral or negative scenario. Two earlier runs the same
evening (runs 1–2) passed the same six on routing; their answers said
_"S&P 500 saknas i datan"_ and quoted a _"VIX"_ — both wrong, both fixed
before this record (§11.5). Run 3 was interrupted after its first line by
a page reload that a document edit during the run set off; nothing in it
contradicts run 4.

### 11.4 Measured by voice (`scripts/probe-jarvis-routing-voice.mjs`)

The six lines synthesized with Azure Speech (`sv-SE-SofieNeural`,
`scripts/voice-live/synth-utterances.mjs`) as the fake microphone, 22 s
apart. A synthetic voice is a fair stand-in for a routing test; it is not
the ear's test.

Run 3, `.probe/routing-voice-voice-3.json`: session 148 s, $0.126; tools
`get_market_snapshot` × 1, `delegate_to_financial_os` × 1; invariant
counter 0; the firm's cases 36 → 37, the one opened by the sixth line.
Times from the moment the person stopped, on the session clock; "market"
and "host" are the calls' own durations.

| Line | First speech | Handoff | Market | Host | Backend span | Cases | What JARVIS said |
| --- | --- | --- | --- | --- | --- | --- | --- |
| _"Hur ser amerikanska börsen ut idag?"_ | 0 ms | −200 ms | 170 ms | – | 3.9 s | +0 | _"Mm. Jag kollar på det. Amerikanska börsen stängde svagt ned idag med S&P 500 ner ungefär en halv procent. Teknologi höll emot lite, men energi och finans var klart svagare. Tioårsräntan steg marginellt och ligger strax över fem procent. För Nasdaq 100 har vi tyvärr inte dagens siffra."_ |
| _"Varför?"_ | +200 ms | none | – | – | – | +0 | _"Mycket handlar om räntorna. När en USA:s tioårsränta tickar upp, pressas bolag med högre värderingar, samtidigt som energi och finans kan tyngas … en liten avvaktande stämning …"_ — answered by the voice model from the exchange before |
| _"Hur går tech?"_ | +200 ms | 0 ms | – | – | 6.4 s | +0 | _"Ja, jag kikar på det. Tech höll emot bra och var marginellt upp idag, runt en tiondels procent, alltså bättre än marknaden som helhet …"_ |
| _"Vad gör tioåringen?"_ | 0 ms | none | – | – | – | +0 | _"Den steg lite idag och ligger strax över fem procent."_ — from context |
| _"Vad betyder högre tioårsränta för tech?"_ | −200 ms | none | – | – | – | +0 | _"Ofta innebär det högre diskonteringsränta på framtida vinster, så värderingarna pressas lättare … starka bolag med robusta kassaflöden stå emot bättre."_ — reasoning, by the voice model |
| _"Borde jag minska min USA-exponering?"_ | 0 ms | −200 ms | – | 678 ms | 13.9 s | **+1** | _"Ja, jag tar med det. Kommittén behöver en utgångstes från dig först. Vad är ditt huvudskäl till att överväga en minskning — till exempel högre räntor, värderingar eller koncentrationsrisk?"_ |

An earlier run the same evening (run 2, before the brief's fixture rule was
made per value) handed off three of the five market lines and read the
market in 81–220 ms each time; the routing was the same, the answers named
a "VIX" that was the risk-appetite score, which is what the fix removed.


### 11.5 What this measured, and what it did not

- **The acceptance holds on both channels.** By text and by voice the first
  five lines opened no case and bound the conversation to nothing; the
  sixth opened one and asked for the thesis — where the workflow actually
  requires it, and nowhere else. No _"menar du S&P 500?"_; no scenario
  question around a market question.
- **Where the time goes.** The market itself is milliseconds (33–220 ms
  on a warm cache; the categories are the Overview's). The backend model is
  the cost: 3–4 s per handoff by voice, 4–7.5 s per typed line, 14 s on the
  one delegation whose backend span ran long. The voice's first word comes
  0–0.6 s after the person stops. The ruling's "very fast" is not met by
  the backend at default settings; `JARVIS_LIVE_REASONING` and
  `JARVIS_LIVE_SERVICE_TIER` are the knobs, measured next, not the door.
- **Fresh, and honest about what is not.** The answers carry levels with
  their date and source, say _"Nasdaq 100 saknas i datan"_ while Avanza's
  circuit is open, and say there are no headlines in the dev source (the
  news category is fixture without a Marketaux key, and a fixture is never
  quoted). Two fabrications were caught by the measurement itself and
  removed before this record: a `fixture` index envelope that hid a real
  S&P 500, and a risk-appetite percentile read out as a VIX level.
- **Follow-ups keep their context.** Typed lines now travel with the last
  turns, so _"Varför?"_ was answered about the market just described; by
  voice the model answered _"Varför?"_, _"Vad gör tioåringen?"_ and the
  reasoning question itself from the exchange before, without a fetch,
  and correctly.
- **The bridging word is still there.** _"Mm. Jag kollar på det."_,
  _"Ja, jag kikar på det."_, _"Ja, jag tar med det."_ opened four of six
  voice replies. The instruction permits a short, true, varied word when
  the wait is noticeable; the wait is the backend's, and the word is
  filler by another name until the backend is faster.
- **Not measured here:** the person's own voice on these lines (the
  microphone was Sofie, synthesized); how the answers sound; a market
  question while a case is open, and _"och Europa?"_ / _"hur ser
  värderingen ut?"_ from the ruling's follow-up list.

## 12. Fast-path performance — the latency classes, measured, 2026-09-16/17

The routing of §11 was accepted with one objection: 5 s for the market
overview and 13 s for _"Varför?"_ by text is a sequence of backend jobs,
not a colleague beside you. The ruling set explicit classes and a target
for the simplest of them.

| Tier | What | Target | Path after this slice |
| --- | --- | --- | --- |
| 0 | a named instrument's current move — _"Hur gick S&P 500 idag?"_, _"Vad gör tioåringen?"_ | ≈ 1 s typed; 1–2 s to the first useful spoken word | recogniser → platform cache → formatter; no model |
| 1 | light interpretation — _"Varför?"_, _"Vad driver marknaden?"_ | ≈ 1–3 s | one router pass over the attached brief |
| 2 | JARVIS reasoning — _"Vad betyder högre långräntor för tech?"_ | ≈ 2–5 s | one router pass |
| 3 | institutional — _"Borde jag minska USA?"_ | no latency target; process wins | router → the firm |

### 12.1 What changed

- **Instrumentation.** Every typed turn records its stages — routing
  decision, data, composition, model passes, whether a brief was attached
  — as milliseconds in the typed telemetry (`TypedTurnStages`); every voice
  turn now also records the first *useful* spoken word, measured past the
  bridging syllables (`BRIDGING_PATTERN`: _"Mm."_, _"Hm."_, _"Jag kollar."_,
  _"Låt mig se."_) and kept only as a millisecond.
- **Tier 0 without a model.** `application/jarvis/marketIntent.ts` recognises
  a named instrument's state question with a Swedish lexicon and plain
  state cues, and refuses any line carrying a judgement, why, meaning,
  valuation or case cue (planted violations fail it: _"Ska jag köpa
  guld?"_, _"Tror du dollarn stärks framöver?"_). `presentation/jarvis/
  marketSpeech.ts` speaks the value with its session, time and source —
  _"S&P 500 stängde på 7 552, ned 0,45 procent idag (fördröjd data från
  Yahoo, kl. 20:20)"_ — and says what is missing. The runtime answers such
  a line from the platform's cache with no model pass.
- **The brief as context.** A market question that is not Tier 0, or any
  follow-up in a conversation that carried a brief, gets the fresh brief
  attached to the router's instructions (`MARKNADSLÄGE hämtat HH:MM …`),
  every number with its own time and source, within an explicit window
  (`JARVIS_LIVE_MARKET_CONTEXT_SECONDS`, 180 s). The router answers over
  the numbers and calls the tool only for a scope it lacks (Europe,
  Sweden). No headlines → the context says the driver is not verified.
- **The voice gets the same numbers — under the provider's limit.** A live
  session is handed the brief at open, again after every market read, and
  again when the window passes while the person is talking, so the voice
  answers a simple state question itself, first word first, and hands off
  what is not there. The first voice run of this slice found the handoff
  silently broken: GPT-Live refuses a `session.instructions.append` above
  500 tokens (_"Context append text must not exceed 500 tokens"_), and the
  full brief was refused six times in one session while the person heard
  nothing of it — every Tier-0 line went to the backend. The voice now
  gets its own rendering of the brief (`marketVoiceContext`): the same
  numbers with their sessions, times and sources in fewer words, held
  under `LIVE_APPEND_MAX_CHARS` (1 000 characters; 2.2–2.4 characters a
  token measured with o200k_base on the brief itself, so ≤ 450 tokens) by
  dropping the least useful lines first — the never-served list, the
  middle of the sector table, headlines beyond the first, the missing
  list — and never an index or a rate. A refused append is now counted by
  name in the session's telemetry (`error.market_context`).
- **Bridging words.** The voice is told to begin with the content; the
  ruler for the first useful word strips a whole bridging sentence
  (_"Jag kollar den senaste nivån."_), not only its first words — the
  first voice run's 400 ms "first useful word" was that ruler stopping
  after _"Jag kollar"_, and is not reported.

### 12.2 Reasoning effort and service tier, benchmarked by text

`scripts/bench-jarvis-fastpath.mjs` restarts the dev server per
configuration and runs the text probe's full set: the seven follow-up
lines (F1–F7), the three Tier-0 lines five times each (T1–T3 × 5, _"Hur
gick S&P 500 idag?"_, _"Vad gör tioåringen?"_, _"Hur går Nasdaq?"_), the
capital control (C1, _"Borde jag minska min USA-exponering?"_) and the
market question asked again with the control's case open (I1) — 24 lines
per configuration, every number in every answer verified against the
platform's snapshot, the firm's case count read from the database around
every line. Configurations: `JARVIS_LIVE_REASONING` unset (the model's
default), `none`, `low`, `high`; `JARVIS_LIVE_SERVICE_TIER=priority`
alone and with `none`. `minimal` is refused by `gpt-5.6-luna` (HTTP 400)
and is not in the table: an earlier run with it recorded every line as
_"JARVIS kunde inte svara"_, which is how the configuration guard learned
the values the model accepts (`none`, `low`, `medium`, `high`, `xhigh`,
`max`). Aggregate `.probe/bench-fastpath.md`; runs
`.probe/routing-bench-<config>.json`.

| Config | Follow-up median / p95 | Tier 0 median / p95 | Control | Isolation | Numbers | Passes/turn | Responses | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| default | 3104 / 4587 ms | 421 / 620 ms | case, PASS | PASS | 35/35 | 1.14 | 8 | $0.0029 |
| none | 2118 / 3725 ms | 385 / 621 ms | case, PASS | PASS | 36/36 | 1.14 | 8 | $0.0023 |
| low | 2571 / 2945 ms | 395 / 613 ms | case, PASS | PASS | 34/34 | 1.14 | 8 | $0.0030 |
| high | 3848 / 4700 ms | 365 / 623 ms | case, PASS | PASS | 38/38 | 1.14 | 8 | $0.0037 |
| priority | 2830 / 5946 ms | 394 / 523 ms | case, PASS | PASS | 35/35 | 1.14 | 8 | $0.0033 |
| none + priority | 1910 / 2562 ms | 396 / 559 ms | case, PASS | PASS | 36/36 | 1.14 | 8 | $0.0028 |

"Numbers" is verified numbers over numbers said; "Passes/turn" is model
passes per model turn (Tier 0 meets no model; the control's delegate-and-
relay is two); "Responses" is Responses API calls in the run; cost is the
backend tokens for the 24 lines, Tier 0 costing nothing. Every
configuration routed every line correctly: the control opened exactly one
case, the other 23 lines none.

Per line, visible latency in ms (the server's part in parentheses):

| Line | default | none | low | high | priority | none + priority |
| --- | --- | --- | --- | --- | --- | --- |
| F1 _Hur ser amerikanska börsen ut idag?_ | 4587 (4260) | 3725 (3331) | 2945 (2619) | 4700 (4378) | 3234 (2792) | 2562 (2128) |
| F2 _Varför?_ | 3104 (2738) | 2440 (2124) | 2571 (2250) | 3848 (3461) | 3135 (2768) | 2095 (1773) |
| F3 _Hur går tech?_ (Tier 0) | 423 (159) | 368 (114) | 520 (120) | 423 (141) | 493 (158) | 542 (173) |
| F4 _Vad gör tioåringen?_ (Tier 0) | 422 (65) | 365 (85) | 381 (72) | 292 (82) | 504 (118) | 378 (99) |
| F5 _Vad betyder högre tioårsränta för tech?_ | 4125 (3937) | 2332 (2072) | 2370 (2084) | 4064 (3705) | 2830 (2489) | 2282 (1964) |
| F6 _Och Europa?_ | 3170 (2799) | 1859 (1522) | 2798 (2507) | 3624 (3339) | 5946 (5416) | 1710 (1257) |
| F7 _Hur ser värderingen ut?_ | 2962 (2637) | 2118 (1670) | 2892 (2556) | 4400 (4058) | 2157 (1885) | 1910 (1661) |
| T1 × 5 _Hur gick S&P 500 idag?_ | 377–576 (70–127) | 264–426 (63–83) | 262–464 (75–92) | 331–623 (62–95) | 278–474 (74–95) | 307–559 (72–93) |
| T2 × 5 _Vad gör tioåringen?_ | 334–620 (83–135) | 340–621 (63–91) | 252–613 (69–132) | 223–423 (65–117) | 299–523 (71–102) | 390–506 (78–164) |
| T3 × 5 _Hur går Nasdaq?_ | 371–468 (83–97) | 339–504 (59–77) | 304–513 (78–89) | 314–451 (77–86) | 361–492 (59–119) | 219–431 (51–84) |
| C1 _Borde jag minska min USA-exponering?_ | 5785 (5482) | 3661 (3294) | 4062 (3808) | 4084 (3723) | 5593 (5358) | 6727 (6328) |
| I1 _Hur ser amerikanska börsen ut idag?_ (case open) | 3781 (3570) | 2411 (2000) | 3141 (2832) | 4467 (4002) | 2285 (1838) | 1995 (1610) |

### 12.3 The chosen configuration

**Reasoning effort `none` by default; service tier unset.** Set in
`liveConfig()` (`JARVIS_LIVE_REASONING`, overridable; the guard admits the
values the model accepts: `none`, `low`, `medium`, `high`, `xhigh`, `max`).
The evidence: on the final bench every configuration routed every line
correctly and verified every number; `none` was the fastest effort on
five of seven follow-up lines and on the capital question, its answers
read the same as `high`'s on the lines a person can compare, and it costs
the least. `low` had the tightest p95 (2.9 s) on its one run and is the
fallback if `none` ever shows a routing error in use; `high` and unset are
slower for nothing measured here. Per execution class, what the bench
supports: Tier 0 needs no model; Tiers 1 and 2 are served by one pass at
`none`; Tier 3 routes correctly at every effort and pays its second pass
by design. A per-class effort would be a further knob and is not needed
by the numbers.

### 12.4 Measured by text — the follow-up set, Tier 0 with repeats, the control, the isolation line

`scripts/probe-jarvis-routing.mjs`, sets `followup,tier0,control,isolation`,
five repeats of the Tier-0 lines, the firm's case count read from the
database before and after every line, every number in every answer checked
against the platform's snapshot. Under the chosen default (`none`,
`.probe/routing-bench-none.json`):

| Line | Visible | Server | Stages | Cases |
| --- | --- | --- | --- | --- |
| Hur ser amerikanska börsen ut idag? | 3.7 s | 3.3 s | router, one pass, brief attached | +0 |
| Varför? | 2.4 s | 2.1 s | router, one pass, brief attached, no fetch | +0 |
| Hur går tech? | 0.37 s | 114 ms | Tier 0 | +0 |
| Vad gör tioåringen? | 0.37 s | 85 ms | Tier 0 | +0 |
| Vad betyder högre tioårsränta för tech? | 2.3 s | 2.1 s | router, one pass | +0 |
| Och Europa? | 1.9 s | 1.5 s | router, one pass, brief attached (Europe is in it) | +0 |
| Hur ser värderingen ut? | 2.1 s | 1.7 s | router, one pass, no case | +0 |
| Hur gick S&P 500 idag? ×5 | 264–426 ms | 63–83 ms | Tier 0 | +0 |
| Vad gör tioåringen? ×5 | 340–621 ms | 63–91 ms | Tier 0 | +0 |
| Hur går Nasdaq? ×5 | 339–504 ms | 59–77 ms | Tier 0, honestly "saknas" while Avanza's circuit is open | +0 |
| Borde jag minska min USA-exponering? (control) | 3.7 s | 3.3 s | router, two passes: delegate, relay | **+1** |
| Hur ser amerikanska börsen ut idag? (case now bound) | 2.4 s | 2.0 s | router, one pass, brief attached, no case tool | +0 |

Tier 0 across the six configurations, 15 samples each: median 365–421 ms,
p95 523–623 ms visible; the server's part 51–174 ms. Follow-up set by
configuration, median / p95: unset 3.1 / 4.6 s · `none` 2.1 / 3.7 s ·
`low` 2.6 / 2.9 s · `high` 3.8 / 4.7 s · `priority` 2.8 / 5.9 s ·
`none` + `priority` 1.9 / 2.6 s. Before this slice, the same lines by text
were 5.1, 13.1, 4.7, 3.8 and 3.4 s (§11.3).

### 12.5 Measured by voice — Tier 0 and the follow-up set

Two conversations synthesized with Azure Speech (`sv-SE-SofieNeural`) as
the fake microphone: the three Tier-0 lines twice over, 10 s apart
(`c11-tier0`), and the ruling's follow-up set with the control and the
isolation line (`c12-followups`). The probe pairs what was heard with the
line it was by content, since a pause inside an utterance can split it
into two exchanges. Times from the moment the person stopped, on the
session clock; a negative figure is the voice starting before the
transcript's end-of-speech mark. "First useful" is measured past a whole
bridging sentence.

**Tier 0 (`.probe/routing-voice-tier0-2.json`):** session 88 s, $0.075;
both market-context appends accepted (`session.instructions.appended` 2:
at open and after the one read); tools `get_market_snapshot` × 1; the
firm's cases 48 → 48.

| Line | First sound | First useful | Handoff | Backend span | Cases | What JARVIS said |
| --- | --- | --- | --- | --- | --- | --- |
| _"Hur gick S&P 500 idag?"_ — heard as _"Nasdaq P 500 idag"_ | 800 ms | 800 ms | 400 ms | 3.1 s | +0 | _"Jag kollar. S&P 500 stängde på 7 551,81, ned 0,45 procent."_ |
| _"Vad gör tioåringen?"_ | 0 ms | 0 ms | none | – | +0 | _"Den amerikanska tioårsräntan är 5,01 procent, upp 1 baspunkt."_ — from the brief |
| _"Hur går Nasdaq?"_ | −200 ms | −200 ms | none | – | +0 | _"Jag kan tyvärr inte säga hur Nasdaq rörde sig i dag – men tekniksektorn var upp 0,10 procent."_ — from the brief |
| _"Hur gick S&P 500 idag?"_ | 200 ms | 200 ms | none | – | +0 | _"Den var ned 0,45 procent."_ — from the brief |
| _"Vad gör tioåringen?"_ | 0 ms | 0 ms | none | – | +0 | _"Den amerikanska tioårsräntan är 5,01 procent, upp 1 baspunkt."_ |
| _"Hur går Nasdaq?"_ | 0 ms | 0 ms | none | – | +0 | _"Jag kan tyvärr inte säga hur Nasdaq rörde sig i dag – men tekniksektorn var upp 0,10 procent."_ |

First useful word, n = 6: median 0 ms, p95 800 ms. Five of six lines were
answered by the voice itself from the injected brief, without a handoff,
with the number first; the one handoff was the line the transcript
garbled. The run before the fix (`.probe/routing-voice-tier0-1.json`, the
full brief refused six times) handed every line it understood to the
backend — five of six, backend spans 2.2–2.9 s — and opened each with
_"Jag kollar den senaste nivån."_, _"Jag tar fram senaste rörelsen."_ or
the like; its reported "first useful word median 400 ms" was the old
ruler stopping after _"Jag kollar"_.

**The follow-up set (`.probe/routing-voice-followups-2.json`):** session
177 s, $0.151; four market-context appends accepted (at open and after
three reads); tools `get_market_snapshot` × 3, `delegate_to_financial_os`
× 1; the firm's cases 48 → 49, the one opened by the control.

| Line | First sound | First useful | Handoff | Backend span | Cases | What JARVIS said |
| --- | --- | --- | --- | --- | --- | --- |
| _"Hur ser amerikanska börsen ut idag?"_ | −200 ms | 0 ms | none | – | +0 | _"S&P 500 är ned 0,45 procent, minus 0,45. Nasdaq 100 finns inte med i det senaste läget, så jag har inte en bekräftad siffra där."_ — from the brief |
| _"Varför?"_ | 0 ms | 0 ms | none | – | +0 | _"Drivkraften är inte verifierad i det senaste läget, så jag kan inte säga vad som ligger bakom just nu. Generellt kan en nedgång på den nivån hänga ihop med enskilda bolagsrörelser eller bredare riskaptit, men jag har ingen bekräftad orsak här."_ — from the brief |
| _"Hur går tech?"_ | 400 ms | 400 ms | −200 ms | 3.2 s | +0 | _"Jag kollar. Mm, Tech sticker ut lite positivt"_ — from the brief — then the backend's _"Information Technology-sektorn steg 0,10 procent till 6 867,57"_ |
| _"Vad gör tioåringen?"_ | 200 ms | 200 ms | −200 ms | 3.6 s | +0 | _"Jag kollar. Tioåringen ligger på 5,01 procent, upp 1 baspunkt. Tvååringen är på 4,74 procent, upp 7 punkter."_ — the brief's number first, and a handoff the voice did not need |
| _"Vad betyder högre tioårsränta för tech?"_ | −200 ms | −200 ms | none | – | +0 | _"Högre tioårsränta brukar pressa tech, eftersom framtida vinster diskonteras hårdare och bolag med hög värdering blir känsligare. Det syns ofta direkt i kursreaktioner, men effekten beror på hur ihållande ränteuppgången är."_ — reasoning, by the voice |
| _"Och Europa?"_ | 800 ms | 5.2 s † | 400 ms | 5.4 s | +0 | _"Jag kollar. sep., FTSE 100 steg 0,28 procent till 10 688,47 vid senaste stängningen. DAX och OMXS30 saknas, så jag har inga bekräftade siffror."_ |
| _"Hur ser värderingen ut?"_ | 600 ms | 600 ms | 200 ms | 1.7 s | +0 | _"Jag kollar. Det finns inget verifierat värderingsmått just nu, så jag kan inte säga om marknaden är dyr eller billig. Generellt blir värderingar mer känsliga när långräntor ligger högt, särskilt för framtidsvinster i tech."_ |
| _"Borde jag minska min USA-exponering?"_ | 0 ms | 0 ms | −400 ms | 3.1 s (host 560 ms) | **+1** | _"Jag tar med det. Kommittén behöver en utgångstes. Vill du att prövningen utgår från att du överväger att minska USA-exponeringen på grund av högre långräntor och känsliga techvärderingar?"_ |
| _"Hur ser amerikanska börsen ut idag?"_ — the case now open | 0 ms | 200 ms | none | – | +0 | _"S&P 500 är ned 0,45 procent. Nasdaqs siffra finns inte med i det senaste läget, så jag har ingen verifierad uppgift där."_ — from the brief, no case tool |

† The run's ruler marked 800 ms: the first fragment after _"Jag
kollar."_ was _"sep.,"_ — a syllable of the brief's date, three letters,
which that ruler counted as content. The first useful word, FTSE 100's
move, came with the second fragment at +5.2 s (the fragment starts are in
the record); the figure is corrected here by hand, and the ruler now
requires two words.

First useful word, n = 9: by the run's ruler median 200 ms, p95 800 ms;
with the Europe line corrected, median 200 ms, p95 5.2 s. Four of the nine
lines were answered from the brief with no handoff at all, including
_"Varför?"_ and the isolation line; the control opened the one case and
asked for the thesis; no other line opened one.

### 12.6 Reading

- **Tier 0 is a sub-second interaction.** Typed, a named instrument's move
  is visible in a median of ~0.4 s and a p95 of ~0.6 s across 15 repeats
  per configuration (the server's own part 56–174 ms, of which the
  platform's cache read is most). No model is involved, and every number
  said was verified against the platform's snapshot. "Nasdaq 100 saknas i
  datan just nu — källan svarar inte" is the honest Tier-0 answer while
  Avanza's circuit is open; it is not counted as a failure, it is the
  truth in 0.3 s.
- **Where the router's time goes.** With the brief attached and the
  snapshot tool withheld, every non-institutional line is one model pass,
  and the pass IS the latency: the routing decision and the answer are
  the same tokens. Data is 60–730 ms (a cold category read), composition
  is zero. The two-pass shape survives only where it must — the capital
  question, which delegates and then relays the firm's answer.
- **Reasoning effort is the lever, and the model names its own values.**
  `gpt-5.6-luna` accepts `none`, `low`, `medium`, `high`, `xhigh`, `max`;
  `minimal` is refused with a 400, which a first bench recorded as every
  line answered _"JARVIS kunde inte svara"_ — the configuration guard now
  admits only the accepted values. Follow-up median / p95 by text: default
  3.1 / 4.6 s, low 2.6 / 2.9 s, none 2.1 / 3.7 s, high 3.8 / 4.7 s. Every
  configuration routed every line correctly on the final bench and
  verified every number; the answers under `none` are as honest and as
  well-formed as under `high` — _"det är en möjlig faktor – inte en
  bekräftad förklaring"_ — on the lines a reader can compare.
- **What went wrong on the way, and was fixed by measurement.** Offered the
  snapshot tool beside an attached brief, the router still called it on a
  third of market lines (a second pass for numbers it already had); the
  tool is now withheld when the global brief is attached. Under `low`,
  _"Hur ser värderingen ut?"_ was delegated to the firm once — a routing
  error — and the instructions now say valuation is reasoning unless the
  person asks what to do; the line has answered directly in every run
  since, under every effort.
- **"Varför?" is 2–3 s now, not 13.** The follow-up carries the brief's time,
  the server re-reads the numbers from the platform's cache and attaches
  them, and the answer reasons over them without a fetch.
- **Cost** is not a factor at this scale: 24 lines cost $0.002–0.004 in
  backend tokens under any effort; Tier 0 costs nothing.
- **Service tier.** `priority` on its own changed nothing worth the price
  (2.8 / 5.9 s follow-up median / p95, one 5.9 s outlier on the Europe
  line); with `none` it took the median from 2.1 s to 1.9 s and the p95
  from 3.7 s to 2.6 s. That is a real but modest gain on top of the effort
  choice, at the priority tier's premium per token, and the ruling asked
  not to buy speed by default. It stays off: `JARVIS_LIVE_SERVICE_TIER=
  priority` turns it on for whoever rules that the p95 is worth it.
- **Voice.** With the brief accepted, the voice answers Tier 0 itself:
  five of six Tier-0 lines and four of nine follow-up lines came from the
  injected numbers with no handoff, the first useful word 0–400 ms after
  the person stopped — inside the ruling's 1–2 s, and with the number
  first. The handoffs that remain are the one the doctrine wants (the
  capital question, to the firm) and four the voice chose although the
  brief held most of the answer — tech, the ten-year, Europe, valuation.
  On tech and the ten-year it spoke the brief's number first and let the
  backend confirm, so the person heard the answer in 200–400 ms and the
  backend's pass was cost, not wait. Europe is the slow line: 5.2 s to the
  first useful word, one backend pass of 5.4 s over a 22 ms market read —
  the set's p95, and a reminder that a single model pass at `none` is
  still 2–5 s by voice as by text. _"Varför?"_ by voice is now honest by
  construction: the brief says there are no headlines, and the voice says
  the driver is not verified and invents nothing. Bridging: _"Jag kollar."_
  still opens the handoff replies and _"Mm,"_ one of them; the instruction
  asks for silence on a handoff and content first, and the voice model does
  not obey it reliably — when it answers from the brief it begins with the
  number. The two runs before the fix were wrong twice, and both errors
  were found by reading the record, not the summary: a 400 ms "first useful
  word" that was the ruler stopping after _"Jag kollar"_, and six refused
  appends visible only as `"error": 6` in the event counts. The microphone
  was Sofie, synthesized; the person's own voice is still untested.
- **Not measured here:** the person's own voice on these lines; the answer's
  first token by text (the typed path is not streamed — the next lever if
  Tier 1 needs to feel faster than a single 2 s pass allows); market hours
  with every source live (Avanza's circuit was open all evening, so Nasdaq
  100, DAX, OMXS30 and Nikkei were honestly missing throughout).
