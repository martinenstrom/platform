# Voice bake-off — the Swedish listening test

The measured way to choose JARVIS's ears and voice. Two STT finalists and
two TTS finalists, the same fixed Swedish finance material for each, raw HTTP
throughout (no SDK), keys from the environment only, and the person's own
recordings and every provider output kept out of the repository
(`recordings/` and `results/` are ignored by git).

## 1. Record the utterances — your voice, not a synthesiser's

```
node scripts/voice-bakeoff/record-server.mjs
```

Open <http://localhost:4174/>, read the twelve sentences in
[`utterances.json`](./utterances.json) at your normal pace, one button each.
Each recording is saved as `recordings/NN.webm` (webm/opus, what the
product's own capture would produce). Re-record any you stumbled on.

## 2. Credentials — the boundary this harness stops at

Put these in `.env` (ignored by git) or the shell. None is invented, embedded
or read from anywhere else, and none is ever printed.

| Provider                        | Variables                                                                  | Used by      |
| ------------------------------- | -------------------------------------------------------------------------- | ------------ |
| AssemblyAI Universal-3.5 Pro    | `ASSEMBLYAI_API_KEY` (optional `ASSEMBLYAI_BASE=https://api.eu.assemblyai.com`) | `stt.mjs`    |
| ElevenLabs Scribe v2 + Eleven v3 | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_IDS` (comma-separated; run `tts.mjs` once without it to list voices and their labels) | `stt.mjs`, `tts.mjs` |
| Azure Speech                    | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (e.g. `swedencentral`); optional `AZURE_TTS_VOICES` | `tts.mjs`    |
| OpenAI (optional baseline)      | `OPENAI_API_KEY`; optional `OPENAI_STT_MODEL` (default `gpt-transcribe`)   | `stt.mjs`    |
| Azure fast transcription (not a finalist: a second ear for the round trip, and a measured control) | the Azure Speech key and region above; optional `AZURE_STT_LOCALES` (default `sv-SE,en-US`; empty = multilingual model) | `stt.mjs`, `roundtrip.mjs` |

A provider without credentials is skipped and named; with none configured
the scripts stop and say so.

## 3. Run

```
node scripts/voice-bakeoff/stt.mjs              # results/stt-report.md, results/stt-<provider>.json
node scripts/voice-bakeoff/tts.mjs              # results/tts-report.md, results/listen.html, results/tts/*.mp3
node scripts/voice-bakeoff/roundtrip.mjs        # results/tts-roundtrip.md: every mp3 back through the STT finalists
node scripts/voice-bakeoff/variants.mjs         # A/B/C expressiveness variants of the frontrunner voice, same seed
```

`variants.mjs` renders four fixed texts (a01, a02, a05, a10) three ways on
`nPczCjzI2devNBz1zQrb` / `eleven_v3` with one seed per text: **A** the
documented default voice settings stated explicitly; **B** the same
settings with the text prefixed by the v3 audio tag `[warm, engaged]`;
**C** the same tag with stability 0.0 ("Creative"). It first probes, on the
shortest text, which settings v3 honours (stability 0.3, style, speed,
similarity): same sha1 as the baseline means the knob did nothing, a 4xx
means the value is refused. Every row keeps the exact request body minus
the text and the sha1 of the audio, and `listen.html` puts A, B and C side
by side above the provider comparison. It needs ElevenLabs credits (about
3 200) and stops with exit 3 at the quota boundary.

`STT_PROVIDERS` and `TTS_PROVIDERS` (comma-separated) narrow a run; a
provider that refuses the key or has no quota is skipped after its first
refusal. Runs are cumulative: `stt-report.md` is rebuilt from every
`results/stt-<provider>.json` on disk; each TTS run writes its own file under
`results/tts-runs/`, and the report and `listen.html` are rebuilt from all of
them, with a re-run of the same voice replacing its earlier rows. The round
trip keeps its rows per file and ear and only transcribes what is missing
(`--all` redoes everything). So Azure and ElevenLabs can be run separately,
a voice added later, and an ear added after the fact.

Every STT provider receives the same language hints (`sv`, `en`) and the same
vocabulary list, through the mechanism it would receive them in production
(`keyterms_prompt`, `keyterms`, `keywords`/`prompt`). Nothing is tuned per
provider after a result is seen. Azure is synthesised twice per answer — with
English spans tagged `<lang xml:lang="en-US">`, as it would ship, and
untagged — so the tag's effect is heard, not assumed. ElevenLabs premade
voices have fixed public ids (George `JBFqnCBsd6RMkjVDRZzb`, Daniel
`onwK4e9ZLuTAKqWW03F9`, Charlotte `XB0fDUnXU5powFXDhCwa`, Sarah
`EXAVITQu4vr4xnSDxMaL`, Brian `nPczCjzI2devNBz1zQrb`, Roger
`CwhRBWXzGAHq8TQ4Fs17`), usable even when the key lacks `voices_read`.

## 4. Score

`stt-report.md` carries every transcript beside its reference, the finance
terms that survived (✓/✗), a word error rate, and the latency from request
to final transcript. Score it as the ruling asks: semantic correctness,
finance-term correctness, code-switching, readability, latency — a wrong
number or a lost term above any article.

`tts-report.md` carries first-audio and total latency per voice and the path
of every file; `listen.html` puts every voice beside every answer with a
player each; `tts-roundtrip.md` says how much of the Swedish and how many of
the English spans an STT finalist recovered from each file — a proxy for
clarity, never for sound. Listen in `results/tts/` and score: Swedish naturalness, calm
authority, English terms inside Swedish, prosody, long-form listenability
(a09, a10), fit with the JARVIS brief — Swedish, calm, intelligent, confident
without theatre, professional without corporate polish, warm but restrained.

## 5. What this harness does not do

It does not touch the product, install anything, persist audio anywhere but
`results/`, select a provider, or implement anything. It produces the
evidence for the ruling that will.
