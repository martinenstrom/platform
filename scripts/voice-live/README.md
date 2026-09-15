# GPT-Live proof — talking to JARVIS through gpt-live-1

The smallest local, interactive proof of the revised architecture:

```
user ⇄ gpt-live-1 (audio: listening, speaking, turn-taking, interruption)
            ⇅ Responses delegation
       backend model (deeper JARVIS reasoning; gpt-5.6-luna by default)
            ⇅ function tools, executed on the proof server
       JARVIS delegation stub → a real reference, never a fake result
```

GPT-Live owns conversational audio and nothing else. The backend model is
the reasoning layer. The tools are the institutional boundary: an
investment judgement becomes a delegation reference on the server, and the
voice may say _"Jag kollar på det och återkommer"_ only once that reference
exists. Nothing here is Financial OS; nothing here decides anything
institutional; the stub never completes work by itself.

## Run

```
node scripts/voice-live/server.mjs          # http://localhost:4175/  (OPENAI_API_KEY from .env, server-side only)
```

Open the page, pick a voice, press **Anslut**, talk Swedish. The page shows
the transcript as GPT-Live heard and said it (with session times), the
delegations the stub holds, and the running cost. **Avsluta** closes the
session and prints the final usage. Typing works too: with a live session
the text is injected as a trusted instruction; without one it goes to the
same backend and tools over the Responses API.

## Measure without a person

```
node scripts/voice-live/make-wav.mjs                        # recordings → WAV + seven composed conversations
node scripts/voice-live/probe-live.mjs                      # every conversation, voice marin
node scripts/voice-live/probe-live.mjs c3-interrupt cedar   # one conversation, one voice
PROBE_VOICES=marin,cedar,ash node scripts/voice-live/probe-live.mjs c4-terms
LIVE_RECORD=1 node scripts/voice-live/probe-live.mjs c4-terms          # keep JARVIS's audio (results/live-<voice>-<id>.webm)
LIVE_TYPED="Vad är term premium?" node scripts/voice-live/probe-live.mjs c5-english   # then type into the live session
```

Server options: `LIVE_ACK_MODE=strict` (recommended; measured to keep
"Jag kollar på det och återkommer" after the reference exists — see the
proof document), `LIVE_BACKEND_MODEL`, `LIVE_VOICE`, `LIVE_PRICE_PER_MINUTE`,
`LIVE_STORE=1` (refused by projects without data persistence — this one).
The probe labels its result files with `LIVE_ACK_MODE` so runs under
different instructions sit side by side in `results/probe-report.md`.

`make-wav.mjs` decodes the bake-off recordings (the person's own voice) in
headless Chromium and composes conversations — utterance, silence,
utterance — including one that interrupts JARVIS two and a half seconds
into a long answer. `probe-live.mjs` plays each as the fake microphone of a
headless Chromium, and writes what came back to `results/`: transcripts,
turn latency (assistant transcript start minus user transcript end, on the
session clock), interruptions detected, delegations created, tool calls,
voice seconds, backend tokens and cost.

## What the server does, and does not

- `POST /session` — the browser's SDP offer in, `POST /v1/live/sessions`
  with the server key, the answer out. The key never reaches the browser.
- Sideband — the server attaches `wss://api.openai.com/v1/live/sessions/{id}/attach`
  with the same key, executes every backend function call there
  (`response.item.create` + `response.create`), reads `session.usage.updated`
  and `session.closed`, and counts events. It never stores transcript text.
- `POST /session/{id}/text` — typed text while live, injected with
  `session.instructions.append` (GPT-Live has no user-text event).
- `POST /text` — the degraded path: the same backend, instructions and tools
  with no voice, through `/v1/responses`.
- `GET /session/{id}/state`, `POST /session/{id}/close`, `GET /telemetry`.
- Telemetry per session → `results/telemetry-<id>.json`: seconds, voice
  cost at `LIVE_PRICE_PER_MINUTE`, backend tokens and cost at the model's
  list price, tool calls by name, delegations, event counts, projected cost
  per hour. Counts and money only; no conversation content.

Voices the API accepts for gpt-live-1 (measured 2026-09-15): marin, cedar,
alloy, ash, ballad, coral, echo, sage, shimmer, verse. `sol` exists but is
gated for this organisation.

## Boundary

The server refuses to start without `OPENAI_API_KEY`. With a key but no
credits, `POST /session` fails with the API's `insufficient_quota` and the
page falls back to typing — which needs credits too. Nothing in this
directory is production code; the production path is decided by the ruling
that follows the proof.
