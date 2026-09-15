/**
 * Three controlled variants of one ElevenLabs voice, same text, same seed.
 *
 * The ruling's frontrunner is nPczCjzI2devNBz1zQrb on eleven_v3, heard as
 * "good, slightly more alive wanted". This produces, for four fixed texts:
 *
 *   A  baseline      — the documented default voice settings, stated
 *                      explicitly so the rendering is reproducible:
 *                      stability 0.5 (v3 "Natural"), similarity_boost 0.75,
 *                      style 0, use_speaker_boost true, speed 1.0; text as-is.
 *   B  slightly alive — identical settings; the text prefixed with one v3
 *                      audio tag, "[warm, engaged] ", which directs delivery
 *                      and is not spoken (the round trip checks that).
 *   C  upper bound   — the same tag, and stability 0.0 (v3 "Creative": "more
 *                      emotional and expressive, but prone to hallucinations").
 *
 * The seed is fixed per text and shared across variants, so what differs
 * between two files is the instruction, not the sampling. Each row records
 * the exact request body minus the text, and the sha1 of the audio: two
 * identical hashes mean the setting changed nothing.
 *
 * Before the listening variants, a short knob probe on the shortest text
 * records what eleven_v3 actually honours (stability 0.3, style, speed,
 * similarity): accepted-and-different, accepted-and-identical, or refused.
 *
 *   node scripts/voice-bakeoff/variants.mjs
 *   node scripts/voice-bakeoff/variants.mjs --skip-knobs
 *
 * Needs ELEVENLABS_API_KEY with text_to_speech, and credits: about 3 000 for
 * the variants and 200 for the knobs. Exit 3 at the credential/quota boundary.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERE, RESULTS, credentials, loadEnv, ms, now, readJson, writeResult } from './lib.mjs'
import { RUNS, buildTtsReport } from './tts-report.mjs'

loadEnv()

export const FRONTRUNNER = { voice: 'nPczCjzI2devNBz1zQrb', label: 'ElevenLabs Brian · eleven_v3', model: 'eleven_v3' }
const TEXT_IDS = ['a01', 'a02', 'a05', 'a10']
const TAG = '[warm, engaged] '
const BASE = { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 }

export const VARIANTS = [
  { variant: 'A-baseline', summary: 'stability 0.5 (Natural) · similarity 0.75 · style 0 · speaker boost · speed 1.0 · text as-is', settings: { voice_settings: { ...BASE } }, prefix: '' },
  { variant: 'B-alive', summary: `as A · text prefixed "${TAG.trim()}"`, settings: { voice_settings: { ...BASE } }, prefix: TAG },
  { variant: 'C-upper', summary: `as B · stability 0.0 (Creative)`, settings: { voice_settings: { ...BASE, stability: 0.0 } }, prefix: TAG },
]

const KNOBS = [
  ['stability 0.3', { voice_settings: { ...BASE, stability: 0.3 } }],
  ['stability 0.0', { voice_settings: { ...BASE, stability: 0.0 } }],
  ['style 0.4', { voice_settings: { ...BASE, style: 0.4 } }],
  ['speed 1.06', { voice_settings: { ...BASE, speed: 1.06 } }],
  ['similarity 0.5', { voice_settings: { ...BASE, similarity_boost: 0.5 } }],
]

const seedFor = (id) => 100_000 + Number(id.slice(1))

async function speak(text, extra) {
  const started = now()
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${FRONTRUNNER.voice}/stream?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: FRONTRUNNER.model, apply_text_normalization: 'auto', ...extra }),
    },
  )
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
  const reader = response.body.getReader()
  const chunks = []
  let firstAudioMs = null
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    if (firstAudioMs === null && value.length > 0) firstAudioMs = ms(started)
    chunks.push(value)
  }
  const bytes = Buffer.concat(chunks)
  return { bytes, firstAudioMs: firstAudioMs ?? ms(started), totalMs: ms(started), sha1: createHash('sha1').update(bytes).digest('hex').slice(0, 12) }
}

const refused = (message) => /\b(401|402|403|429)\b/.test(message)

/*
 * Exit codes are set, never forced: `process.exit` while a fetch body is
 * still closing trips a libuv assertion on Windows.
 */
process.exitCode = await main()

async function main() {
  const { ok, missing } = credentials(['ELEVENLABS_API_KEY'])
  if (!ok) {
    console.error(`Missing ${missing.join(', ')}. This is the credential boundary; nothing was sent.`)
    return 3
  }
  const { answers } = readJson(join(HERE, 'answers.json'))
  const texts = TEXT_IDS.map((id) => answers.find((a) => a.id === id))
  const OUT = join(RESULTS, 'tts')
  mkdirSync(OUT, { recursive: true })
  mkdirSync(RUNS, { recursive: true })

  /* ------------------------------------------------------------ knobs */
  if (!process.argv.includes('--skip-knobs')) {
    const short = texts[0]
    const knobs = []
    let reference = null
    try {
      reference = await speak(short.text, { seed: seedFor(short.id), voice_settings: { ...BASE } })
      knobs.push({ knob: 'baseline (A settings)', status: 200, sha1: reference.sha1, bytes: reference.bytes.length })
      console.log(`knob baseline: sha1 ${reference.sha1} · ${reference.bytes.length} bytes`)
    } catch (error) {
      const message = String(error.message ?? error)
      console.error(`knob baseline: ${message.split('\n')[0]}`)
      if (refused(message)) {
        console.error('Refused at the account level (key, plan or quota). This is the boundary; stopping.')
        return 3
      }
    }
    for (const [knob, extra] of KNOBS) {
      try {
        const out = await speak(short.text, { seed: seedFor(short.id), ...extra })
        const same = reference && out.sha1 === reference.sha1
        knobs.push({ knob, status: 200, sha1: out.sha1, bytes: out.bytes.length, identicalToBaseline: same })
        console.log(`knob ${knob}: accepted · sha1 ${out.sha1} · ${same ? 'IDENTICAL to baseline (knob ignored)' : 'differs from baseline'}`)
      } catch (error) {
        const message = String(error.message ?? error)
        knobs.push({ knob, status: Number(message.slice(0, 3)) || null, error: message.slice(0, 300) })
        console.log(`knob ${knob}: ${message.split('\n')[0].slice(0, 200)}`)
        if (refused(message)) break
      }
    }
    writeResult('variants-knobs.json', knobs)
  }

  /* --------------------------------------------------------- variants */
  const rows = []
  let stop = false
  for (const answer of texts) {
    if (stop) break
    for (const spec of VARIANTS) {
      const name = `elevenlabs-${FRONTRUNNER.voice}-${spec.variant}-${answer.id}`
      process.stdout.write(`${name} … `)
      const request = { seed: seedFor(answer.id), ...spec.settings }
      try {
        const out = await speak(spec.prefix + answer.text, request)
        const file = join(OUT, `${name}.mp3`)
        writeFileSync(file, out.bytes)
        rows.push({
          name,
          provider: 'elevenlabs',
          voice: FRONTRUNNER.voice,
          voiceLabel: FRONTRUNNER.label,
          variant: spec.variant,
          summary: spec.summary,
          answerId: answer.id,
          file,
          settings: { model_id: FRONTRUNNER.model, apply_text_normalization: 'auto', ...request },
          inputPrefix: spec.prefix || undefined,
          firstAudioMs: out.firstAudioMs,
          totalMs: out.totalMs,
          bytes: out.bytes.length,
          sha1: out.sha1,
        })
        console.log(`first audio ${out.firstAudioMs} ms · total ${out.totalMs} ms · sha1 ${out.sha1}`)
      } catch (error) {
        const message = String(error.message ?? error)
        rows.push({ name, provider: 'elevenlabs', voice: FRONTRUNNER.voice, voiceLabel: FRONTRUNNER.label, variant: spec.variant, summary: spec.summary, answerId: answer.id, settings: { model_id: FRONTRUNNER.model, ...request }, inputPrefix: spec.prefix || undefined, error: message })
        console.log(`FAILED: ${message.split('\n')[0].slice(0, 200)}`)
        if (refused(message)) {
          console.error('Refused at the account level (key, plan or quota). Stopping here.')
          stop = true
          break
        }
      }
    }
  }
  writeFileSync(join(RUNS, `${new Date().toISOString().replace(/[:.]/g, '-')}-variants.json`), JSON.stringify(rows, null, 2))
  const { reportPath, listenPath } = buildTtsReport(answers)
  console.log('report:', reportPath)
  console.log('listening set:', listenPath)
  return rows.every((r) => r.error) ? 3 : 0
}
