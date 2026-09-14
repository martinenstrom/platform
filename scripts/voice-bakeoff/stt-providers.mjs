/**
 * The STT finalists, on raw HTTP, each receiving the same vocabulary and
 * language hints through the mechanism it would receive them in
 * production. No SDK. Keys come from the environment and are never printed.
 *
 * Used by stt.mjs (the recordings) and tts.mjs --roundtrip (the synthesised
 * answers sent back through the ears).
 */

import { join } from 'node:path'
import { HERE, ms, now, readJson } from './lib.mjs'

const set = readJson(join(HERE, 'utterances.json'))
export const languageHints = set.languageHints
export const vocabulary = set.vocabulary

const wait = (t) => new Promise((resolve) => setTimeout(resolve, t))

export const providers = {
  assemblyai: {
    label: 'AssemblyAI Universal-3.5 Pro',
    keys: ['ASSEMBLYAI_API_KEY'],
    async transcribe(bytes) {
      const base = process.env.ASSEMBLYAI_BASE ?? 'https://api.assemblyai.com'
      const headers = { authorization: process.env.ASSEMBLYAI_API_KEY }
      const started = now()
      /* Raw bytes in, a private URL out; the transcript request must use the same key. */
      const upload = await fetch(`${base}/v2/upload`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/octet-stream' },
        body: bytes,
      })
      if (!upload.ok) throw new Error(`upload ${upload.status}: ${await upload.text()}`)
      const { upload_url } = await upload.json()
      const uploadMs = ms(started)

      const submitted = await fetch(`${base}/v2/transcript`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          audio_url: upload_url,
          speech_models: ['universal-3-5-pro'],
          language_detection: true,
          language_detection_options: { code_switching: true, expected_languages: languageHints },
          keyterms_prompt: vocabulary,
        }),
      })
      if (!submitted.ok) throw new Error(`submit ${submitted.status}: ${await submitted.text()}`)
      let job = await submitted.json()
      while (job.status === 'queued' || job.status === 'processing') {
        await wait(400)
        const poll = await fetch(`${base}/v2/transcript/${job.id}`, { headers })
        job = await poll.json()
      }
      if (job.status !== 'completed') throw new Error(`transcript ${job.status}: ${job.error}`)
      return { text: job.text, language: job.language_code ?? null, latencyMs: ms(started), detail: { uploadMs } }
    },
  },

  elevenlabs: {
    label: 'ElevenLabs Scribe v2',
    keys: ['ELEVENLABS_API_KEY'],
    async transcribe(bytes, mime = 'audio/webm') {
      const form = new FormData()
      form.set('file', new Blob([bytes], { type: mime }), `utterance.${mime === 'audio/mpeg' ? 'mp3' : mime.split('/')[1]}`)
      form.set('model_id', 'scribe_v2')
      /* One multipart field per term; a JSON-encoded list is read as a single 200-character keyword and refused. */
      for (const term of vocabulary) form.append('keyterms', term)
      /* language_code omitted on purpose: the model detects, and may switch mid-utterance. */
      const started = now()
      const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
        body: form,
      })
      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
      const body = await response.json()
      return {
        text: body.text,
        language: body.language_code ?? null,
        latencyMs: ms(started),
        detail: { languageProbability: body.language_probability ?? null },
      }
    },
  },

  azure: {
    /*
     * Not a finalist (the measurement doc excluded it on published grounds:
     * language identification at utterance level, no mid-sentence switch).
     * Here as a second ear for the round trip, and to measure the exclusion
     * rather than trust it. AZURE_STT_LOCALES (default sv-SE,en-US) names
     * the candidate locales for language identification; an empty value
     * asks for the multilingual model, which was measured to lose Swedish.
     */
    label: `Azure fast transcription (${process.env.AZURE_STT_LOCALES ?? 'sv-SE,en-US'})`,
    keys: ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'],
    async transcribe(bytes, mime = 'audio/webm') {
      const region = process.env.AZURE_SPEECH_REGION
      const version = process.env.AZURE_STT_API_VERSION ?? '2025-10-15'
      const form = new FormData()
      form.set('audio', new Blob([bytes], { type: mime }), `utterance.${mime === 'audio/mpeg' ? 'mp3' : mime.split('/')[1]}`)
      const locales = (process.env.AZURE_STT_LOCALES ?? 'sv-SE,en-US').split(',').map((l) => l.trim()).filter(Boolean)
      form.set('definition', JSON.stringify({ locales, profanityFilterMode: 'None' }))
      const started = now()
      let response
      for (let attempt = 0; ; attempt++) {
        response = await fetch(
          `https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=${version}`,
          { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY }, body: form },
        )
        if (response.status !== 429 || attempt >= 8) break
        /* The F0 tier meters calls per minute and says how long to wait; a paid tier does not. */
        const text = await response.text()
        const seconds = Number(response.headers.get('retry-after')) || Number(/retry after (\d+) seconds/i.exec(text)?.[1]) || 30
        await wait((seconds + 1) * 1000)
      }
      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
      const body = await response.json()
      const detected = [...new Set((body.phrases ?? []).map((p) => p.locale).filter(Boolean))]
      return {
        text: (body.combinedPhrases ?? []).map((p) => p.text).join(' '),
        language: detected.join('+') || null,
        latencyMs: ms(started),
        detail: { phrases: (body.phrases ?? []).length, durationMs: body.durationMilliseconds ?? null },
      }
    },
  },

  openai: {
    label: `OpenAI ${process.env.OPENAI_STT_MODEL ?? 'gpt-transcribe'}`,
    keys: ['OPENAI_API_KEY'],
    async transcribe(bytes, mime = 'audio/webm') {
      const model = process.env.OPENAI_STT_MODEL ?? 'gpt-transcribe'
      const form = new FormData()
      form.set('file', new Blob([bytes], { type: mime }), `utterance.${mime === 'audio/mpeg' ? 'mp3' : mime.split('/')[1]}`)
      form.set('model', model)
      form.set('prompt', `Swedish investment conversation with English finance terms: ${vocabulary.join(', ')}.`)
      if (model === 'gpt-transcribe') for (const hint of languageHints) form.append('languages[]', hint)
      const started = now()
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      })
      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
      const body = await response.json()
      return { text: body.text, language: body.language ?? null, latencyMs: ms(started), detail: {} }
    },
  },
}
