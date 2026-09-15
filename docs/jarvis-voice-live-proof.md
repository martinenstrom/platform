# JARVIS voice — the GPT-Live proof (revised cost ruling, 2026-09-15)

**Status: proof built, run against 24 live sessions on 2026-09-15 once
credits existed; measured results in §7; nothing implemented in the
product; no subscription bought.** The revised ruling accepts SEK 100–400
a month in OpenAI credits and asks whether GPT-Live-1 gives the Swedish
JARVIS experience before any chained STT/TTS provider is paid for. §0–§6
record the proof as built (and the credit boundary it first met); §7 is
what it measured.

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

### 7.9 What this proof did not settle

- How the voices _sound_ in Swedish — the recordings are there; the ear is
  not.
- Whether a long JARVIS monologue is cut off promptly on interruption; the
  one overlap observed was a short sentence, finished.
- The English-in → English-out rule holds most but not all of the time;
  one instruction pass on it is likely enough, and it was not done here.
- The delegation stub is not `financialOsHostFn`; wiring it is a small,
  deliberate, ruled step.
