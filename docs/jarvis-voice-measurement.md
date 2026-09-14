# JARVIS voice — measurement before any provider is chosen (slice E)

**Status: measured; no provider selected; no SDK, dependency, capture or
synthesis added.** Written 2026-09-14 under the Slice E ruling and its
Swedish-first amendment. Two kinds of fact below: **measured** (read from
the repository, or reported by the browser through a probe) and **published**
(from the providers' own pages and third-party benchmarks as of this date,
with sources at the end). Where a claim would need a listening test with a
real account, it says so — that test is the ruling's to authorise.

The question: how does JARVIS hear a Swedish-speaking person who says _"Jarvis,
hur ser du på Nvidia efter senaste CPI-siffran och vad säger US 10-year?"_ as
one utterance, and answer in natural Swedish that pronounces _Nvidia_, _CPI_
and _US 10-year_ the way a Swedish finance professional does — quickly,
portably, and with every secret on the server?

---

## 0. The hard criterion, and what it rules out

JARVIS is **Swedish-first**. Swedish in → Swedish out; English in → English
where appropriate; mixed in → Swedish out, with English names and finance
terms preserved and pronounced naturally. Language preference lives in the
JARVIS conversational layer; Financial OS never sees it.

That criterion decides more than any latency number:

- **STT must transcribe code-switched speech inside one utterance** without
  a language mode. A model that transcribes Swedish well but only in a
  Swedish-only mode will turn _yield curve_ into Swedish-looking noise.
- **TTS must render English terms inside Swedish prose** without either
  anglicising the Swedish or swedifying _Nvidia_. That needs either a
  multilingual voice that handles code-switched text natively, or explicit
  per-span language control (SSML `<lang>`), and in both cases a listening
  test in Swedish — no benchmark measures Swedish prosody.
- **A speech-to-speech model that is excellent in English is not a
  candidate on that strength** — it must be judged on Swedish, and it also
  collides with the router doctrine (§7).

## 1. What the browser offers — measured

`scripts/probe-voice-capabilities.mjs` loaded HQ in the probe's HeadlessChrome
149 and asked the page, touching no microphone:

| Capability                                                     | Result                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `SpeechRecognition` (unprefixed), continuous/interim           | present                                                                           |
| `speechSynthesis`                                              | present, **0 voices** in headless (OS voices only)                                |
| `getUserMedia`, `MediaRecorder`                                | present; `audio/webm;codecs=opus` and `audio/mp4` yes, `audio/ogg;codecs=opus` no |
| `AudioWorklet`                                                 | present (client-side VAD / PCM capture possible)                                  |
| Permissions API, microphone                                    | present, state `prompt`                                                           |
| WebSocket, WebRTC, streaming `fetch` body, EventSource         | all present                                                                       |
| Playback: `<audio>`, `AudioContext`, `MediaSource` (opus, mp3) | all present                                                                       |

Two consequences. The browser can own everything the ruling asks it to —
permission, capture, endpointing, playback, interruption — with no library.
And `speechSynthesis` is not a product voice: its voices are whatever the
operating system installed, none in a headless build, and Swedish quality
varies by machine.

**Browser `SpeechRecognition` is not portable** (published): Chrome/Edge
full; Safari 14.1+ behind the `webkit` prefix (on-device on recent versions);
Firefox behind a flag, off by default. On Chrome the audio goes to Google's
service under one `lang` — no code-switching. Prototype or fallback, never
the core.

## 2. What the server and transport offer — measured

- **Credentials.** The one model credential the product has,
  `ANTHROPIC_API_KEY`, is read server-side in `serverFns.ts:644` and used by
  a raw `fetch` in `providers/modelClient.ts` (`https://api.anthropic.com/v1/messages`,
  `x-api-key`). No SDK. Voice providers can follow exactly this pattern:
  `process.env` on the server, raw HTTP, nothing in the client bundle.
- **Upload.** The server-function client (`serverFnFetcher.js`) sends
  `FormData` bodies as-is (`type === 'formData'`). An utterance blob can go
  up through an ordinary server function.
- **Streamed response.** A server function may return a raw `Response`
  (`x-tss-raw: true`) whose body is a `ReadableStream`, and the client hands
  it back untouched. Synthesised audio can stream down through an ordinary
  server function and into `MediaSource`.
- **Bidirectional channel.** TanStack Start (`@tanstack/react-start` 1.168)
  exposes **no WebSocket route**; its only WebSocket mention is the RSC
  dev-HMR listener (`rsbuild/virtual-modules.js:79`). Its server runtime is
  `h3` v2 (`h3-v2@2.0.1-rc.20`), which **does** ship
  `defineWebSocketHandler` (crossws), so a socket is possible below the
  framework — through a custom server entry and, in dev, a Vite plugin —
  but nothing in the product does that today, and it would be a new server
  surface with its own lifecycle.
- **Production.** `node .output/server/index.mjs` (srvx + h3). A WebSocket
  in production needs the crossws Node adapter on that entry.

**Consequence:** a request/response voice loop fits the transport that
exists; a streaming loop needs either a new socket surface on the server or
a browser-to-provider channel with a server-minted short-lived token.

## 3. Speech-to-text candidates — published, against the Swedish-first criterion

| Candidate                                 | Swedish                                                                            | Code-switching in one utterance                                                                                        | Streaming / partials                    | Endpointing                                         | Vocabulary hints                                              | Price (streaming)                        | Notes                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **AssemblyAI Universal-3.5 Pro Realtime** | yes, incl. Finland Swedish                                                         | **native, Swedish in the 18-language set**; publishes a code-switch benchmark (7.69 % avg normalised WER, own figures) | yes; ~0.4 s to first final              | end-of-turn detection; three latency/accuracy modes | conversation context injected at start and per turn; keyterms | **$0.45/h** ($0.0075/min); batch $0.21/h | Only candidate found that names Swedish inside a code-switching claim. Temporary tokens for browser streaming. |
| **ElevenLabs Scribe v2 Realtime**         | "excellent" ≤ 5 % WER (own table; Scribe v1: 3.1 % FLEURS / 5.5 % Common Voice sv) | automatic language detection and code-switching within one audio, no config                                            | yes; ~150 ms partials                   | committed segments on speech end                    | not established for realtime                                  | **$0.39/h** ($0.0065/min)                | Strong Swedish figures; code-switching claim is generic, Swedish/English pair unmeasured.                      |
| **OpenAI gpt-live-transcribe** (Jul 2026) | in the 99+ languages                                                               | multiple language hints + keyword hints (suggests mixed support; unmeasured)                                           | yes; tunable latency                    | via Realtime session VAD                            | keyword hints, unstructured context                           | $0.017/min ($1.02/h)                     | No timestamps/diarisation at launch. Realtime WebSocket/WebRTC session.                                        |
| **OpenAI gpt-4o-transcribe / -mini**      | yes                                                                                | Whisper-family tolerance for mixed speech; proper nouns strong; unmeasured for sv/en                                   | batch per utterance (SSE result stream) | client-side                                         | `prompt` text                                                 | ~$0.006 / ~$0.003 per min                | Best fit for an **utterance** (request/response) v1.                                                           |
| Deepgram Nova-3                           | yes, **monolingual only**                                                          | **Swedish is not in the 10-language code-switching mode**                                                              | yes; 200–300 ms                         | yes                                                 | keyterm prompting (100 terms)                                 | $0.0058–0.0077/min                       | Fails the hard criterion unless a test shows sv-mode survives English terms.                                   |
| Speechmatics                              | yes                                                                                | bilingual packs for some pairs; sv/en unverified                                                                       | yes                                     | yes                                                 | custom dictionary                                             | $0.0067/min                              | On-prem option; accent-robust.                                                                                 |
| Azure AI Speech                           | sv-SE                                                                              | continuous LID **does not switch within a sentence**                                                                   | yes                                     | yes                                                 | phrase lists                                                  | $1/h                                     | Weak for the mixed utterance; strong as TTS (§4).                                                              |
| Google STT v2 (Chirp 3)                   | in 24 GA + 77 preview; sv status unverified                                        | alternate language codes; not in-utterance                                                                             | gRPC streaming (proxy needed)           | yes                                                 | adaptation                                                    | $0.016/min                               | Heaviest transport for a browser.                                                                              |
| KB-Whisper (KBLab, self-hosted)           | **Swedish-specialised**: 47 % lower WER than whisper-large-v3 on FLEURS/CV/NST     | unknown; Swedish fine-tuning may weaken English terms                                                                  | batch                                   | client-side                                         | prompt                                                        | GPU hosting                              | Data never leaves your infrastructure. Not a v1; a sovereignty option.                                         |
| Browser `SpeechRecognition`               | sv-SE on Chrome                                                                    | none (one `lang`)                                                                                                      | interim results                         | built in                                            | none                                                          | free                                     | Not portable; prototype/fallback only.                                                                         |

**Reading.** Two providers meet the hard criterion on paper — AssemblyAI
(explicitly, with Swedish in its code-switching set) and ElevenLabs Scribe
v2 (generically). OpenAI's live model is plausible but unevidenced for
Swedish/English mixing. Deepgram and Azure fail it as documented. Nothing
here replaces a listening test on Swedish finance speech.

## 4. Text-to-speech candidates — published, against the Swedish-first criterion

| Candidate                                                                                  | Swedish voices                                                            | English terms inside Swedish                                                                           | Streaming / first audio                          | Interrupt        | Price                          | Notes                                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ---------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| **Azure Neural sv-SE** (Sofie, Mattias) and **Dragon HD Omni** (multilingual, sv-SE added) | mature dedicated Swedish voices; HD voices GA (Mar 2025), Omni in preview | **explicit**: SSML `<lang xml:lang="en-US">` per span, `<phoneme>`; Omni auto-detects language in text | streaming (SDK/REST chunked); latency unmeasured | client-side stop | $16/1M chars neural, $22/1M HD | Strongest explicit control of the mixed sentence.                                |
| **ElevenLabs** Flash v2.5 / Eleven v3                                                      | Swedish in all (32 / 70+ languages)                                       | v3 handles code-switched text natively; Flash needs alias rules (IPA/CMU only for English or v3)       | streaming, ~75 ms (Flash) / higher (v3)          | client-side stop | $50/1M (Flash), $100/1M (v3)   | Best English naturalness; Swedish prosody of a multilingual voice must be heard. |
| Google Chirp 3 HD                                                                          | **sv-SE GA**                                                              | limited SSML on Chirp 3 HD (verify)                                                                    | streaming                                        | client-side stop | $30/1M                         | Candidate; less span-level control than Azure.                                   |
| OpenAI gpt-4o-mini-tts                                                                     | multilingual                                                              | instructable ("pronounce English names naturally"); docs: quality **not uniform** across languages     | streaming                                        | client-side stop | ~$0.015/min                    | Risk for Swedish-first by its own documentation.                                 |
| Browser `speechSynthesis`                                                                  | OS-dependent                                                              | none                                                                                                   | n/a                                              | `cancel()`       | free                           | Offline fallback only.                                                           |

**Reading.** Azure's dedicated Swedish voices plus per-span `<lang>` is the
most controllable answer to _"Nvidia efter senaste CPI-siffran"_; ElevenLabs
v3 is the most natural on English and the least proven on Swedish prosody.
Both need the same listening test (§9).

## 5. Full conversational architectures — and why not, for the core

| Option                                             | What it is                                                                            | Verdict                                                                                                                                                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenAI Realtime (gpt-realtime-2) speech-to-speech  | one model hears, thinks and speaks; WebRTC/WS/SIP; barge-in built in; ~$0.05–0.15/min | **Not the core.** It fuses hearing, routing and speaking into one vendor's model, which the router doctrine forbids (§7); Swedish quality is the least documented part of it. Its transcription-only sessions are the `gpt-live-transcribe` row above. |
| ElevenLabs Agents / LiveKit / Pipecat agent stacks | STT + LLM + TTS pipelines with WebRTC transport                                       | Same objection as a whole; LiveKit as a **transport only** is a plausible v2 if a socket below the framework proves worse.                                                                                                                             |

## 6. Recommended architecture

### v1 — utterance mode, on the transport that exists

```
browser                                   server                         provider
──────────────────────────────────────    ────────────────────────────   ────────────────
mic permission → capture (MediaRecorder,
webm/opus) → local endpointing (energy
VAD + silence timeout, or explicit stop)
        │ FormData
        ▼
                                          transcribeUtteranceFn ──────▶  STT (batch, sv+en hints,
                                            ← Transcript {text, lang}    finance vocabulary)
        ▼
transcript → the SAME consult() path
typed text uses → product state →
phrasing (Swedish by default)
        │ text
        ▼
                                          speakFn ────────────────────▶  TTS (streaming)
        ◀ raw streamed Response (opus/mp3)
playback via MediaSource; local VAD
stops playback when the person speaks
(barge-in v1, no provider dependency)
```

- **Acknowledgement inside two seconds.** The shell already has the phrase
  the moment the firm answers; spoken, it is STT finalisation (provider-quoted
  0.4–1.5 s for a short utterance) plus first TTS audio (provider-quoted
  75–500 ms). "Jag kollar på det." can be in the person's ear before the
  firm has done anything — truthfully, because it is what the product state
  says.
- **Nothing new on the server's surface.** Two server functions in a
  `serverFns` module (the fitness rule's one permitted import), FormData up,
  streamed audio down.
- **Voice never routes.** The transcript enters `consult()` exactly where
  typed text does. When the JARVIS router arrives above it, voice and text
  hit it at the same point.
- **Degrades to text by construction.** Permission denied, upload failed,
  provider down, TTS failed — each leaves the compose usable and is
  reported as a voice state, not as JARVIS being unavailable.

### v2 — streaming mode, when live captions and provider endpointing are wanted

Browser-to-provider WebSocket (or WebRTC) with a **server-minted short-lived
token** (`issueListenerTokenFn`): audio streams to the provider directly,
partial transcripts stream back, the committed transcript enters `consult()`
as in v1. Credentials stay server-side; the framework needs no socket. The
cost is that the browser speaks one provider's streaming protocol — kept
behind a browser-side `Listener` port so it is one module to swap. A socket
below the framework (h3 `defineWebSocketHandler`) is the alternative if the
provider's browser token model proves unsuitable.

### Barge-in

v1: local. Playback stops the moment the microphone detects speech (energy
VAD in an `AudioWorklet`), then listening begins; no provider is involved,
so it works with any TTS. v2: provider endpointing tightens the hand-off.
Neither path makes barge-in prohibitive later, which was the ruling's test.

## 7. What is not in Financial OS, and never will be

Language preference, the router, vocabulary hints, voices, provider choice,
telemetry of the voice path. Financial OS keeps answering in the six typed
states; JARVIS speaks them. Nothing in `application/analysis` or
`domain/analysis` changes for voice.

## 8. Exact new ports and services — proposed, not built

**Application (JARVIS layer, new) — `src/application/jarvis/voice/`**

```ts
interface Transcriber {
  transcribe(utterance: {
    audio: ReadableStream<Uint8Array> | Uint8Array
    mimeType: string
    languageHints: readonly ('sv' | 'en')[]
    vocabulary: readonly string[]
  }): Promise<Transcript> // { text, language, confidence?, durationMs, provider, latencyMs }
}
interface Synthesizer {
  speak(request: {
    text: string
    language: 'sv' | 'en'
    terms: readonly string[]
    voice?: string
  }): Promise<AudioStream> // { mimeType, chunks: ReadableStream<Uint8Array>, provider, firstAudioMs? }
}
interface ListenerTokenIssuer {
  // v2 only
  issue(request: {
    languageHints: readonly ('sv' | 'en')[]
  }): Promise<{ token; endpoint; expiresAt }>
}
```

Plus `conversationLanguage.ts` (utterance language → answer language: sv by
default, en for English, sv for mixed) and `financeVocabulary.ts` (CPI,
duration, yield curve, Nvidia, Fed, ECB, P/E, US 10-year, …) supplied to STT
as hints and to TTS as language-tagged spans / aliases.

**Infrastructure (new) — `src/infrastructure/jarvis/voice/`**: one adapter
per chosen provider, raw `fetch` like `modelClient.ts`, keys from
`process.env` (`JARVIS_STT_API_KEY`, `JARVIS_TTS_API_KEY`), never in a
client bundle. **`src/infrastructure/jarvis/serverFns.ts`**:
`transcribeUtteranceFn` (FormData in), `speakFn` (raw streamed `Response`),
later `issueListenerTokenFn`.

**Browser (new) — `src/components/jarvis/voice/`**: `useMicrophone`
(permission, capture, endpointing), `usePlayback` (MediaSource, stop on
barge-in), `VoiceSession` (dormant → listening → transcribing → thinking →
speaking → attention), replacing the inert microphone in `JarvisPresence`.
The presence store gains nothing but the transcript turns it already holds.

**What swaps without touching the UI:** any provider (behind `Transcriber` /
`Synthesizer`), the v1→v2 transport (behind `useMicrophone` and the token
port), voices and vocabularies (configuration).

## 9. What must be tested before a provider is chosen — the listening test

No published figure measures Swedish prosody or the pronunciation of
_Nvidia_ inside a Swedish sentence. The choice needs, with real accounts the
ruling authorises:

**STT** — a set of ~12 Swedish finance utterances recorded by the person,
including _"Jarvis, hur ser du på Nvidia efter senaste CPI-siffran och vad
säger US 10-year?"_, _"Vad hände med yield curve-lutningen efter Fed?"_,
_"Är P/E:n för hög givet ECB:s bana?"_, _"Duration på tioåringen?"_, one
all-English, one all-Swedish. Run through AssemblyAI Universal-3.5 Pro and
ElevenLabs Scribe v2 (both batch), optionally gpt-4o-transcribe. Score: WER
overall, and **term error rate on the finance vocabulary** — the number that
decides.

**TTS** — the phrasing module's own sentences plus three committee-style
answers with English terms, through Azure sv-SE (Sofie/Mattias, and Dragon HD
Omni) and ElevenLabs v3 (and Flash v2.5 with aliases). Score by ear: Swedish
prosody, English-term pronunciation, first-audio latency measured with a
timer.

Estimated effort: one afternoon; cost under a euro.

### 9.1 The harness — built to the credential boundary, 2026-09-14

The listening test the ruling authorised lives in
[`scripts/voice-bakeoff/`](../scripts/voice-bakeoff/README.md), outside the
product, with no SDK and no dependency added. What is measured about it:

- **Recorder** (`record.html` + `record-server.mjs`): a localhost page that
  lists the twelve fixed utterances and saves each as webm/opus into a
  git-ignored `recordings/`. Proven by `probe-recorder.mjs` — headless
  Chromium with a fake microphone records utterance 01 for two seconds and
  the server writes a file with a WebM header (PASS; the fake file is
  removed afterwards).
- **Test sets**: `utterances.json` (12 utterances, each with the finance
  terms that must survive and their accepted spellings; the ruling's
  examples included; one all-English) and `answers.json` (8 JARVIS
  sentences plus two long paragraphs, each with its English spans).
- **STT** (`stt.mjs`, providers in `stt-providers.mjs`): AssemblyAI
  Universal-3.5 Pro via upload → transcript → poll, with
  `language_detection` + `code_switching` + `keyterms_prompt`; ElevenLabs
  Scribe v2 via multipart with `keyterms` and no language code; OpenAI
  `gpt-transcribe` optional baseline with `languages[]` and a vocabulary
  prompt. Same hints for all. Output: transcript beside reference, detected
  language, term hits, WER, latency to final transcript, and a markdown
  report. The scorer has its own check (`lib.test.mjs`, 4 passing).
- **TTS** (`tts.mjs`): every Swedish-capable Azure voice the region lists
  (HD included, narrowable by `AZURE_TTS_VOICES`), synthesised twice per
  answer — English spans wrapped in `<lang xml:lang="en-US">` and untagged —
  and ElevenLabs v3 on named voice ids; first-audio and total latency from
  the streamed response; `--roundtrip` sends each mp3 back through the STT
  finalists as a proxy for English-term clarity.
- **Boundary behaviour, measured**: with no keys configured `stt.mjs` and
  `tts.mjs` name each missing variable, send nothing, and exit 3 before
  creating any output; `recordings/`, `results/` and `.env` are confirmed
  ignored by `git check-ignore`.

The harness stops there. Credentials needed to run it, kept in `.env` or the
shell and never in the repository: `ASSEMBLYAI_API_KEY`, `ELEVENLABS_API_KEY`
(+ `ELEVENLABS_VOICE_IDS`), `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION`, and
optionally `OPENAI_API_KEY`. Plus the person's own twelve recordings.

## 10. Data and retention

- **Raw audio is never persisted by JARVIS.** It exists as a stream from
  microphone to server to provider and is gone. No archive is created
  because voice exists.
- **Only the transcript enters conversation state** — the same
  `presenceStore` turns typed text produces — and, later, the Brain as
  episodes. Institutional records are untouched.
- **Telemetry** per voice turn: provider, STT latency, TTS first-audio
  latency, utterance duration, detected language, outcome, whether the
  person interrupted. No audio, no transcript content.
- **Provider retention** is a contract question to settle at selection:
  AssemblyAI and ElevenLabs offer zero-/no-retention modes on business
  terms; OpenAI offers Zero Data Retention to eligible accounts; Azure
  Speech does not store audio for real-time STT/TTS by default. KB-Whisper
  self-hosted has no third party at all.

## 11. Cost model (an ordinary month: 10 voice minutes a day, 22 days, ~60 spoken answers a day)

| Item                        | Basis                         | Monthly                                                 |
| --------------------------- | ----------------------------- | ------------------------------------------------------- |
| STT, utterance mode         | ~220 min at $0.003–0.0075/min | $0.7 – $1.7                                             |
| STT, streaming mode         | ~220 min at $0.0065–0.017/min | $1.4 – $3.7                                             |
| TTS                         | ~400k characters              | Azure $6–9 · Google $12 · ElevenLabs Flash $20 · v3 $40 |
| Speech-to-speech (excluded) | ~220 min at $0.05–0.15/min    | $11 – $33                                               |

Voice is not a cost decision; every viable option is a rounding error beside
model spend. It is a Swedish-quality decision.

## 12. What should remain browser-only vs server-side

| Browser only                                                                                                                 | Server only                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| microphone permission and capture; endpointing / VAD; playback and interruption; voice UI states; the transient conversation | every credential; provider calls; token minting (v2); vocabulary and language policy application; telemetry |

---

## Summary for ruling

1. **Portable core = server-brokered providers**, not browser
   `SpeechRecognition`; the browser owns capture, endpointing, playback,
   interruption (all measured present).
2. **v1 = utterance mode over the existing server functions** (FormData up,
   streamed audio down — both measured); **v2 = provider streaming with a
   server-minted token**, or a socket below the framework.
3. **STT shortlist for the Swedish-first test:** AssemblyAI Universal-3.5
   Pro (Swedish inside its code-switching set) and ElevenLabs Scribe v2
   (best published Swedish WER); gpt-4o-transcribe as the utterance-mode
   baseline. Deepgram and Azure fail the mixed-utterance criterion as
   documented.
4. **TTS shortlist:** Azure sv-SE / Dragon HD Omni (explicit `<lang>`
   control) versus ElevenLabs v3 (native code-switched text). Decided by
   ear.
5. **Excluded as core:** speech-to-speech models and agent stacks — they
   fuse hearing, routing and speaking, and the router stays above.
6. **Voice never routes; failure degrades to text; audio is never kept.**

Sources: [Deepgram Nova-3 pricing](https://convertaudiototext.com/blog/deepgram-nova-3-explained) · [Deepgram code-switching](https://developers.deepgram.com/docs/multilingual-code-switching) · [Deepgram Swedish support](https://deepgram.com/learn/deepgram-expands-nova-3-with-german-dutch-swedish-and-danish-support) · [OpenAI gpt-4o-mini-transcribe](https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe) · [OpenAI gpt-live-transcribe](https://developers.openai.com/api/docs/models/gpt-live-transcribe) · [OpenAI pricing](https://developers.openai.com/api/docs/pricing) · [OpenAI Realtime pricing analysis](https://hackernoon.com/openai-realtime-api-pricing-in-2026-real-world-data-from-4000-measured-sessions) · [ElevenLabs Scribe v2 Realtime](https://elevenlabs.io/blog/introducing-scribe-v2-realtime) · [ElevenLabs realtime STT](https://elevenlabs.io/realtime-speech-to-text) · [ElevenLabs Swedish STT](https://elevenlabs.io/speech-to-text/swedish) · [ElevenLabs models](https://elevenlabs.io/docs/overview/models) · [ElevenLabs pronunciation dictionaries](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/pronunciation-dictionaries) · [ElevenLabs TTS pricing](https://elevenlabs.io/text-to-speech-api) · [Azure Speech pricing](https://azure.microsoft.com/en-us/pricing/details/speech/) · [Azure language identification](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-identification) · [Azure HD voices](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/high-definition-voices) · [Azure Dragon HD Omni](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/introducing-dragon-hd-omni-azure-speech-new-voice-type-now-in-preview-via-micros/4481288) · [Speechmatics pricing](https://www.speechmatics.com/pricing) · [Speechmatics Swedish](https://www.speechmatics.com/speech-to-text/swedish) · [Google STT pricing](https://cloud.google.com/speech-to-text/pricing) · [Google Chirp 3 HD](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd) · [Google TTS release notes](https://docs.cloud.google.com/text-to-speech/docs/release-notes) · [AssemblyAI multilingual / code-switching](https://www.assemblyai.com/blog/multilingual-speech-to-text-api) · [AssemblyAI Swedish](https://www.assemblyai.com/languages/swedish) · [AssemblyAI pricing](https://www.assemblyai.com/pricing) · [KB-Whisper](https://kb-labb.github.io/posts/2025-03-07-welcome-KB-Whisper/) · [Swedish Whispers (Interspeech 2025)](https://arxiv.org/pdf/2505.17538) · [MDN Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API) · [Speech Recognition API browser support](https://www.testmuai.com/learning-hub/speech-recognition-api-browser-support/)
