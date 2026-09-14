# JARVIS voice — the Swedish listening test, measured (slice E, part 2)

**Status: run on 2026-09-15 against the harness at `27df5ee`; STT decided on
evidence; TTS narrowed on evidence and handed to the ear; nothing
implemented.** Every number below was produced by
[`scripts/voice-bakeoff/`](../scripts/voice-bakeoff/README.md) on this
machine, from the twelve utterances recorded by the person in their own
voice and the ten fixed JARVIS answers. Raw outputs live in the git-ignored
`scripts/voice-bakeoff/results/` — the transcripts, the 228 synthesised
files, `listen.html`, and the round-trip transcripts.

---

## 0. What could and could not be measured

| Provider | Role | Outcome |
| --- | --- | --- |
| ElevenLabs Scribe v2 | STT finalist | **Measured**, 12/12 utterances, two passes |
| AssemblyAI Universal-3.5 Pro | STT finalist | **Not measured.** The configured `ASSEMBLYAI_API_KEY` is 10 characters and is refused by both `api.assemblyai.com` and `api.eu.assemblyai.com` (`401 Authentication error, API token missing/invalid`); a real key is 32 hex characters. This is a credential boundary, not a provider result. |
| OpenAI gpt-transcribe | optional baseline | **Not measured.** `429 insufficient_quota` — the OpenAI account has no credits. |
| Azure Speech (swedencentral) | TTS finalist | **Measured**, 9 voices × 2 variants × 10 answers = 180 files, 0 failures |
| ElevenLabs Eleven v3 | TTS finalist | **Measured on 4 premade voices in full and 1 in part** (48 files). The account is on the **Free tier**: library voices are refused via API (`402 paid_plan_required`, which excluded the Swedish-accented "Charlotte"), and the 10 000-credit monthly quota ran out on the last voice's two long paragraphs (`401 quota_exceeded`). |
| Azure fast transcription | not a finalist; control + second round-trip ear | **Measured** on the 12 utterances in two modes, and used as the second ear once the ElevenLabs quota was gone. The Speech resource is on the **F0 tier**: fast transcription is rate-limited to a handful of calls per minute (`429 … retry after 35 seconds`), so the round trip ran slowly, not incompletely. |

The ElevenLabs key is scoped: it can transcribe and synthesise but lacks
`voices_read`, `models_read` and `user_read`, so voices were addressed by
their fixed public ids and the subscription could not be read in advance.

Nothing was tuned per provider after a result was seen. Both Scribe passes
returned identical transcripts.

### 0.1 The control the measurement doc had excluded on paper

The measurement doc set Azure STT aside because its language identification
is per utterance and cannot switch mid-sentence. Measured, on the same twelve
recordings with the same vocabulary unavailable to it (fast transcription
takes no key-term list):

| Azure fast transcription | Finance-term accuracy | Mean WER | Median latency |
| --- | --- | --- | --- |
| `locales: ["sv-SE","en-US"]` | 35/39 (89.7 %) | 11.5 % | 460 ms |
| `locales: []` (multilingual model) | 12/39 (30.8 %) | 91.4 % | 493 ms |

With candidate locales it is fast and mostly right, but its errors change
meaning: _inverterad_ became **investerad** (06), _Nvidia_ became **envida**
(12), _EBITDA_ became **ebita** and _P/E 31_ became **p 31** (05), _"Vad
händer med durationen"_ became **"Vänder med durationen"** (02). The
multilingual model never detected Swedish at all: it returned English,
German and Canadian-French text for Swedish speech (_"Hypoverka higher for
longer handispan can hold bar on the way"_ for utterance 03). The exclusion
stands, now on evidence.

## 1. STT — ElevenLabs Scribe v2 on the twelve utterances

Identical hints for every provider: the 22-term vocabulary through
`keyterms`, no language code (the model detects and may switch). Latency is
request start to final transcript, from this machine, for a webm/opus
utterance of 2–12 seconds.

| Pass | Finance-term accuracy | Mean WER | Median latency | Range |
| --- | --- | --- | --- | --- |
| 1 | 39/39 (100 %) | 1.6 % | 874 ms | 614–2 055 ms |
| 2 | 39/39 (100 %) | 1.6 % | 769 ms | 606–1 377 ms |

What the ear cares about, observed:

- **Every finance term survived, in every utterance**, in the form a Swedish
  analyst would write: _Nvidia_, _CPI-siffran_, _durationen_, _US 10-year_,
  _50 basispunkter_, _higher for longer_, _Handelsbanken Hållbar Energi_,
  _Fed_, _earnings yield_, _equity risk premium_, _Microsoft_, _EBITDA_,
  _P/E 31_, _yield curve_, _tvååringen_, _tioåringen_, _ECB_, _realräntan_,
  _term premium_, _Treasuries_, _Federal Reserves_, _investeringskommittén_,
  _tekniksektorn_.
- **Code-switching inside one Swedish utterance needed no mode.** Utterance
  04 — _"Vad säger Fed, earnings yield och equity risk premium just nu?"_ —
  came back verbatim, detected as Swedish. Utterance 03 kept _higher for
  longer_ as English inside Swedish grammar.
- **Numbers are right, and formatted the Swedish way**: _3,2 % mot väntade
  3,0_; _4,5 %_; _12 %_; _50 basispunkter_; _fyrtio gånger_ (spoken as a
  word, written as a word — the scorer accepts both). Percent signs come
  back as `%` rather than _procent_; that is formatting, not error.
- **The only real error is a name in English mode**: the all-English
  utterance 10 opened with _Joris_ for _Jarvis_. In Swedish mode (01) the
  name was right. Everything after the name in utterance 10 was verbatim and
  the language flipped to `eng` correctly — the answer-language rule can be
  driven from `language_code`.
- **The residual WER is punctuation and articles**: an inserted _ett_ before
  _P/E 31_ (05), a full stop for a dash (11), _40_ as _fyrtio_ (12). No word
  that changes meaning was lost or invented in any Swedish utterance.
- **Latency scales with length**: the 12-second question took 1.4–2.1 s; the
  short ones 0.6–0.9 s. Push-to-talk with an utterance of ordinary length
  will show a transcript well under a second after release.

## 2. TTS — first-audio latency, measured

Every answer was synthesised over the streaming endpoint of each provider;
"first audio" is the arrival of the first non-empty chunk, "total" the last.
Azure is 24 kHz 48 kbit/s mp3; ElevenLabs 44.1 kHz 128 kbit/s mp3.

| Voice · variant | Median first audio | Median total | Files |
| --- | --- | --- | --- |
| Azure sv-SE-SofieNeural · tagged / untagged | 267 / 260 ms | 425 / 330 ms | 20 |
| Azure sv-SE-MattiasNeural · tagged / untagged | 245 / 253 ms | 400 / 344 ms | 20 |
| Azure sv-SE-HilleviNeural · tagged / untagged | 179 / 162 ms | 309 / 290 ms | 20 |
| Azure en-US-AvaMultilingualNeural · tagged / untagged | 225 / 177 ms | 375 / 281 ms | 20 |
| Azure en-US-AndrewMultilingualNeural · tagged / untagged | 230 / 199 ms | 383 / 289 ms | 20 |
| Azure en-US-Ava:DragonHDLatestNeural · tagged / untagged | 158 / 162 ms | 720 / 754 ms | 20 |
| Azure en-US-Andrew:DragonHDLatestNeural · tagged / untagged | 152 / 161 ms | 789 / 735 ms | 20 |
| Azure de-DE-Seraphina:DragonHDLatestNeural · tagged / untagged | 164 / 160 ms | 699 / 732 ms | 20 |
| Azure en-GB-Ollie:DragonHDLatestNeural · tagged / untagged | 166 / 161 ms | 668 / 674 ms | 20 |
| ElevenLabs v3 · George (JBFqnCBsd6RMkjVDRZzb) | 691 ms | 2 536 ms | 10 |
| ElevenLabs v3 · Daniel (onwK4e9ZLuTAKqWW03F9) | 722 ms | 2 690 ms | 10 |
| ElevenLabs v3 · Sarah (EXAVITQu4vr4xnSDxMaL) | 661 ms | 2 619 ms | 10 |
| ElevenLabs v3 · Brian (nPczCjzI2devNBz1zQrb) | 622 ms | 2 459 ms | 10 |
| ElevenLabs v3 · Roger (CwhRBWXzGAHq8TQ4Fs17) | 677 ms | 2 029 ms | 8 (quota) |

Observed:

- **Azure starts speaking in 150–270 ms; ElevenLabs v3 in 600–750 ms.** For
  the acknowledgement _"Jag kollar på det och återkommer."_ Azure has
  finished (≈ 300 ms) before ElevenLabs has begun. On the 0–2 s
  acknowledgement budget of the routing addendum both fit, but Azure leaves
  the whole budget to the router.
- **The long paragraphs (a09, a10, ≈ 45 s of speech) took ElevenLabs 16–19 s
  to finish generating**, streamed from the first 0.6 s; Azure HD finished
  them in 5–6 s, Azure neural in under 2.5 s. Interruptibility is therefore
  a client property (stop playback, abandon the stream) for both; neither
  blocks.
- **Azure's `<lang xml:lang="en-US">` tags cost nothing measurable** — first
  audio moves by tens of milliseconds. Whether they help the pronunciation is
  in the round trip below and in the ear.
- **Azure Dragon HD is not faster to first audio than Azure neural but is
  2–3× slower to finish**, and there is **no Swedish-native Dragon HD voice
  in swedencentral** (785 voices listed; the three sv-SE voices are Sofie,
  Mattias, Hillevi, all standard neural). The HD candidates are multilingual
  voices whose secondary-locale list includes sv-SE — so they speak Swedish
  as a second language.

## 3. Round trip — the ears listening to the voices (proxy, not judgement)

Every synthesised file was sent back through Scribe v2. Two numbers per
file: WER of the recovered Swedish against the answer text, and how many of
the English spans (Nvidia, equity risk premium, Fed, ECB, Verification,
Research Office, Devil's Advocate, Rates, term premium, CPI, yield curve,
Handelsbanken Hållbar Energi, higher for longer) came back as English words.
A voice that swedifies _Nvidia_ into something Scribe cannot recognise, or
slurs the Swedish, shows here. How it *sounds* — prosody, warmth, calm — it
cannot show.

Two ears were used, because the first ran dry. **Scribe v2** heard 46 files
before the ElevenLabs free quota ended — all of Seraphina HD, most of Ollie
HD, seven of Mattias untagged, three of Sofie tagged. **Azure fast
transcription (sv-SE + en-US)** then heard every file, slowly, under the F0
rate limit. Azure's own error rate on the person's real speech was 11.5 %
WER with meaning-changing slips (§0.1), so its absolute numbers are inflated
and only the comparison between voices under the same ear is informative.

### 3.1 What Scribe v2 heard (46 files)

| Voice · variant | Files | Mean WER | English spans recovered |
| --- | --- | --- | --- |
| Azure de-DE-Seraphina:DragonHD · tagged | 10 | 1.9 % | 18/18 |
| Azure de-DE-Seraphina:DragonHD · untagged | 10 | 1.8 % | 17/18 |
| Azure en-GB-Ollie:DragonHD · tagged | 8 | 1.5 % | 5/5 |
| Azure en-GB-Ollie:DragonHD · untagged | 7 | 5.9 % | 5/5 |
| Azure sv-SE-Mattias · untagged | 7 | 1.5 % | 15/18 |
| Azure sv-SE-Sofie · tagged | 3 | 0.0 % | – |

Observed: the Swedish of the HD multilingual voices came back essentially
verbatim (the 45-second committee answer from Seraphina, tagged, at 0 %
WER with every English span intact: _Research Office_, _Nvidia_, _Devil's
Advocate_, _equity risk premium_, _Rates_, _term premium_, _Verification_).
The native Swedish voice **Mattias, untagged, lost three English spans of
eighteen** — the Scribe transcript has the Swedish right and the English
term altered — which is the case for `<lang>` tags on native voices that
§3.2 tests across the board.

### 3.2 What Azure heard (all 228 files, one ear for every voice)

| Voice · variant | Mean WER | English spans recovered (of 18) |
| --- | --- | --- |
| **ElevenLabs v3 · Daniel** | 1.4 % | **18** |
| **ElevenLabs v3 · Brian** | 1.4 % | **18** |
| **ElevenLabs v3 · Sarah** | 1.5 % | **18** |
| ElevenLabs v3 · George | 5.8 % | 16 |
| ElevenLabs v3 · Roger (8 files) | 0.0 % | 5 of 5 |
| **Azure en-US-Andrew:DragonHD · tagged** | 1.2 % | **18** |
| Azure en-US-Andrew:DragonHD · untagged | 1.9 % | 16 |
| Azure en-US-Ava:DragonHD · tagged | 1.3 % | 16 |
| Azure en-US-Ava:DragonHD · untagged | 2.0 % | 17 |
| Azure de-DE-Seraphina:DragonHD · tagged | 3.4 % | 17 |
| Azure de-DE-Seraphina:DragonHD · untagged | 3.0 % | 18 |
| Azure en-GB-Ollie:DragonHD · tagged | 5.9 % | 14 |
| Azure en-GB-Ollie:DragonHD · untagged | 10.4 % | 17 |
| **Azure sv-SE-Hillevi · tagged** | 2.8 % | **17** |
| Azure sv-SE-Hillevi · untagged | 3.7 % | 14 |
| Azure sv-SE-Mattias · tagged | 3.1 % | 10 |
| Azure sv-SE-Mattias · untagged | 2.3 % | 14 |
| Azure sv-SE-Sofie · tagged | 3.0 % | 10 |
| Azure sv-SE-Sofie · untagged | 3.3 % | 12 |
| Azure en-US-AndrewMultilingual · tagged | 3.4 % | 13 |
| Azure en-US-AndrewMultilingual · untagged | 4.5 % | 10 |
| Azure en-US-AvaMultilingual · tagged | 4.9 % | 12 |
| Azure en-US-AvaMultilingual · untagged | 2.5 % | 13 |

Every file was detected as Swedish by both ears; no voice drifted into
English. What the transcripts show, on the two answers that carry the most
English (a05 with _Nvidia_ and _equity risk premium_; a09, the 45-second
committee answer with seven English spans):

- **ElevenLabs v3 renders the English inside the Swedish so that the ear
  writes it as English**: Daniel's a09 came back with all seven spans
  intact; Sarah and Brian likewise across all ten answers. George lost
  _term premium_ once and slurred elsewhere (5.8 % WER).
- **Azure Dragon HD multilingual voices match that**: Andrew HD, tagged,
  18/18 with the lowest Swedish WER of any voice (1.2 %); Ava HD close
  behind. Ollie (British) is the weakest HD voice in Swedish (10.4 % WER
  untagged).
- **The native Swedish voices swedify English names unless told not to,
  and not always even then.** Mattias, tagged, said _Nvidia_ as something
  the ear wrote **NVD** in both a05 and a09, and _Devil's Advocate_ as
  **Devos Advocate**; Sofie, tagged, turned _Research Office_ into
  **Research Aphys** and lost _equity risk premium_ in a09; Sofie untagged
  produced **Ecody Risk Premium**. Hillevi is the exception: tagged, she
  kept 17 of 18 (a09: every span, 5.9 % WER), and lost _Research Office_
  (**Reserve Office**), _Devil's Advocate_ and _Verification_ only when
  untagged.
- **The `<lang>` tag is not a free win; its effect is per voice.** It
  helps Hillevi (+3 spans), Andrew HD (+2) and AndrewMultilingual (+3);
  it hurts Mattias (−4), Seraphina (−1), Ava HD (−1) and AvaMultilingual
  (−1). Whatever voice is chosen, the tag decision is a listening decision
  for that voice, and the harness has both variants of every answer.

Read all of this as clarity, not beauty: an ear that writes _Nvidia_
correctly has heard an English _Nvidia_; whether that English sat naturally
inside Swedish prosody is what `listen.html` is for.

## 4. Recommendation — for the ruling, not for implementation

### 4.1 STT

**PRIMARY: ElevenLabs Scribe v2.** On the person's own voice it met the
Swedish-first criterion outright: every finance term, every number, every
code-switch, in one Swedish utterance without a language mode, in 0.6–1.4 s
for questions of ordinary length. Two conditions before it ships:

1. **A paid ElevenLabs plan and a key scoped to speech-to-text**, held
   server-side. The free tier that ran this test permits no commercial use,
   has a 10 000-credit month, and refused library voices; none of that is a
   provider limitation, all of it is account state.
2. **Retention configured and confirmed** (zero-retention or the shortest
   available) before the first production utterance — the ruling's own
   condition. The bake-off did not verify it: the key lacks `user_read`.

One observed weakness to design around: in English mode the name _Jarvis_
came back as _Joris_ (utterance 10). Swedish mode got it right. The wake
word is not in v1 (push-to-talk), so nothing hangs on it; when it is, the
name goes into the key-term list with its accepted spellings.

**FALLBACK: AssemblyAI Universal-3.5 Pro — on paper only, until it is
measured.** Its key was not valid and it produced no result. The harness runs
it the moment `ASSEMBLYAI_API_KEY` is a real key (`node
scripts/voice-bakeoff/stt.mjs` with `STT_PROVIDERS=assemblyai`). **Until
then the fallback for the ears is the keyboard**, which the presence already
has; not Azure, which was measured to turn _inverterad_ into _investerad_.
A fallback that changes the meaning of a rates question is worse than none.

### 4.2 TTS

Sound is the ruling's to judge, from `results/listen.html`, against the
brief: Swedish, calm, intelligent, confident without theatre, professional
without corporate polish, warm but restrained. What the measurement can say:

**PRIMARY: Azure Speech — `sv-SE-HilleviNeural` with English spans
tagged, unless the ear prefers `en-US-Andrew:DragonHDLatestNeural`
tagged.**

- Azure starts speaking in **150–270 ms** and finishes a 45-second answer
  in under 2.5 s (neural) or 6 s (HD), so an acknowledgement is audible
  before the router has decided anything, and a long committee answer can
  be cut off at any word without waiting on generation.
- **Hillevi is the only native Swedish voice that keeps the English
  intact** (17/18 spans, tagged; §3.2). Sofie and Mattias swedify
  _Nvidia_ and _Devil's Advocate_ even when tagged, which on a rates or
  equity answer is a wrong word, not an accent. If the ear rejects Hillevi
  on the brief, the native option is gone and the choice is between the
  HD multilingual voices and ElevenLabs.
- **Andrew HD, tagged, is the clearest voice measured on any provider**
  (18/18, 1.2 % WER) — but it speaks Swedish as a second language, is
  2–3× slower to finish, and costs twice the neural rate. Whether its
  Swedish sounds Swedish is exactly the question only the ear answers.
- `<lang xml:lang="en-US">` costs nothing measurable and helps Hillevi
  and Andrew HD; it is a per-voice decision, not a rule (§3.2).
- Cost is an order of magnitude below ElevenLabs at the volumes in the
  measurement doc, and the resource is already provisioned (F0 today; S0
  for production, which also lifts the rate limit that slowed the round
  trip).

**FALLBACK: ElevenLabs Eleven v3 — Daniel, Brian or Sarah by ear** (all
three 18/18 English spans, 1.4–1.5 % WER; George slurred; Charlotte, the
Swedish-accented library voice, needs a paid plan to be heard at all).

- First audio **600–750 ms**, long answers streamed over 16–19 s: usable,
  within budget, and never the first choice for the acknowledgement.
- It handles code-switched text natively with no markup, which is exactly
  what a fallback should need: the same plain Swedish string the primary
  gets, minus the tags.
- If the ear finds v3 clearly more natural in Swedish than Hillevi and
  Andrew HD, the order flips and the latency and a paid plan are paid for
  — that is a ruling on sound, which this document cannot make. On the
  measured evidence alone, v3 and Andrew HD are tied on clarity, and Azure
  wins on latency, cost and provisioning.

Both providers sit behind the `Synthesizer` port from the measurement doc;
switching or reordering them touches configuration, never the UI.

### 4.3 What the ruling is asked to decide

1. Scribe v2 as primary STT, and a paid ElevenLabs plan with a
   speech-to-text-scoped key and confirmed retention.
2. Whether to obtain a valid AssemblyAI key to measure the fallback, or
   accept text as the only fallback for v1.
3. Hillevi (native, tagged) or Andrew HD (multilingual, tagged), by ear
   from the listening set; whether a voice that speaks Swedish as a second
   language is admissible for a Swedish-first assistant.
4. Whether ElevenLabs v3 stays as TTS fallback (paid plan) or v1 ships
   Azure-only.
5. S0 for the Azure Speech resource before production.

Then slice F.
