/**
 * Turns the bake-off recordings (webm/opus, the person's own voice) into
 * WAV files Chromium can play as a fake microphone, and composes a few
 * conversations from them — utterance, pause, utterance — so an automated
 * probe can speak to GPT-Live in Swedish, and interrupt it.
 *
 * Decoding happens in headless Chromium (no ffmpeg on this machine):
 * decodeAudioData → resample to 24 kHz mono → PCM16 WAV.
 *
 *   node scripts/voice-live/make-wav.mjs
 *
 * Writes scripts/voice-live/audio/*.wav (git-ignored).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = dirname(fileURLToPath(import.meta.url))
const RECORDINGS = join(HERE, '..', 'voice-bakeoff', 'recordings')
const AUDIO = join(HERE, 'audio')
mkdirSync(AUDIO, { recursive: true })

/* Each conversation: utterance ids and the seconds of silence before each. */
const CONVERSATIONS = {
  /* one ordinary question with a company name and an acronym, then silence to let JARVIS answer */
  'c1-nvidia-cpi': [
    { id: '01', silenceBefore: 3.0 },
    { id: 'silence', seconds: 12 },
  ],
  /* an investment judgement (delegation), then a follow-up while the case is open */
  'c2-delegation': [
    { id: '03', silenceBefore: 3.0 },
    { id: 'silence', seconds: 9 },
    { id: '09', silenceBefore: 0 },
    { id: 'silence', seconds: 10 },
  ],
  /* the long question, then an interruption 2 s into the answer */
  'c3-interrupt': [
    { id: '12', silenceBefore: 3.0 },
    { id: 'silence', seconds: 2.5 },
    { id: '04', silenceBefore: 0 },
    { id: 'silence', seconds: 12 },
  ],
  /* terminology: three English terms, curve vocabulary, term premium */
  'c4-terms': [
    { id: '04', silenceBefore: 3.0 },
    { id: 'silence', seconds: 9 },
    { id: '06', silenceBefore: 0 },
    { id: 'silence', seconds: 9 },
    { id: '08', silenceBefore: 0 },
    { id: 'silence', seconds: 10 },
  ],
  /* all English, so the answer language rule is exercised */
  'c5-english': [
    { id: '10', silenceBefore: 3.0 },
    { id: 'silence', seconds: 10 },
  ],
  /*
   * Measured 2026-09-15: every question above was delegated, because each
   * asked for a judgement or a current market fact. These two ask for
   * understanding — duration arithmetic, what an ECB cut means for real
   * rates — which JARVIS should answer itself (the fast/reasoning path).
   */
  'c6-direct': [
    { id: '02', silenceBefore: 3.0 },
    { id: 'silence', seconds: 14 },
    { id: '07', silenceBefore: 0 },
    { id: 'silence', seconds: 14 },
  ],
  /*
   * The first interruption test never overlapped: JARVIS answered the long
   * question with one short sentence. A conceptual question earns a longer
   * answer; the follow-up lands 2.5 s into it.
   */
  'c7-interrupt': [
    { id: '02', silenceBefore: 3.0 },
    /*
     * Measured: the backend answer to u02 begins ≈5 s after the question
     * ends, so 2.5 s of silence put the follow-up into JARVIS's silence,
     * not his speech. Seven seconds lands it two seconds into the answer.
     */
    { id: 'silence', seconds: 5.5 },
    { id: '09', silenceBefore: 0 },
    { id: 'silence', seconds: 12 },
  ],
}

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent('<!doctype html><title>decode</title>')

const RATE = 24_000

async function decode(id) {
  const bytes = readFileSync(join(RECORDINGS, `${id}.webm`))
  const samples = await page.evaluate(
    async ({ b64, rate }) => {
      const bin = atob(b64)
      const buf = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
      const ctx = new OfflineAudioContext(1, 1, rate)
      const decoded = await ctx.decodeAudioData(buf.buffer)
      const out = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate)
      const src = out.createBufferSource()
      src.buffer = decoded
      src.connect(out.destination)
      src.start()
      const rendered = await out.startRendering()
      return Array.from(rendered.getChannelData(0))
    },
    { b64: bytes.toString('base64'), rate: RATE },
  )
  return Float32Array.from(samples)
}

function wav(float32) {
  const pcm = Buffer.alloc(float32.length * 2)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    pcm.writeInt16LE(Math.round(s * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

const cache = new Map()
const sample = async (id) => {
  if (!cache.has(id)) cache.set(id, await decode(id))
  return cache.get(id)
}
const silence = (seconds) => new Float32Array(Math.round(seconds * RATE))

const utteranceIds = [...new Set(Object.values(CONVERSATIONS).flat().map((p) => p.id).filter((id) => id !== 'silence'))]
for (const id of utteranceIds) {
  if (!existsSync(join(RECORDINGS, `${id}.webm`))) {
    console.error(`missing recording ${id}.webm`)
    process.exit(2)
  }
  const s = await sample(id)
  writeFileSync(join(AUDIO, `u${id}.wav`), wav(s))
  console.log(`u${id}.wav · ${(s.length / RATE).toFixed(1)} s`)
}

for (const [name, parts] of Object.entries(CONVERSATIONS)) {
  const pieces = []
  const marks = []
  let cursor = 0
  for (const part of parts) {
    if (part.id === 'silence') {
      pieces.push(silence(part.seconds))
      cursor += part.seconds
      continue
    }
    if (part.silenceBefore) {
      pieces.push(silence(part.silenceBefore))
      cursor += part.silenceBefore
    }
    const s = await sample(part.id)
    marks.push({ id: part.id, startS: Number(cursor.toFixed(2)), endS: Number((cursor + s.length / RATE).toFixed(2)) })
    pieces.push(s)
    cursor += s.length / RATE
  }
  const total = pieces.reduce((n, p) => n + p.length, 0)
  const joined = new Float32Array(total)
  let offset = 0
  for (const p of pieces) {
    joined.set(p, offset)
    offset += p.length
  }
  writeFileSync(join(AUDIO, `${name}.wav`), wav(joined))
  writeFileSync(join(AUDIO, `${name}.json`), JSON.stringify({ name, seconds: Number(cursor.toFixed(2)), marks }, null, 2))
  console.log(`${name}.wav · ${cursor.toFixed(1)} s · ${marks.map((m) => `${m.id}@${m.startS}s`).join(', ')}`)
}

await browser.close()
