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
      form.set('file', new Blob([bytes], { type: mime }), `utterance.${mime.split('/')[1]}`)
      form.set('model_id', 'scribe_v2')
      form.set('keyterms', JSON.stringify(vocabulary))
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

  openai: {
    label: `OpenAI ${process.env.OPENAI_STT_MODEL ?? 'gpt-transcribe'}`,
    keys: ['OPENAI_API_KEY'],
    async transcribe(bytes, mime = 'audio/webm') {
      const model = process.env.OPENAI_STT_MODEL ?? 'gpt-transcribe'
      const form = new FormData()
      form.set('file', new Blob([bytes], { type: mime }), `utterance.${mime.split('/')[1]}`)
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
