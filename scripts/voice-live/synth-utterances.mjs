/**
 * Swedish lines as a microphone: synthesized with Azure Speech into one
 * 24 kHz WAV with silence between them, for the fake-microphone probes.
 *
 * The person's own recordings cover the twelve bake-off utterances and
 * nothing else. A routing test needs other lines — "Hur ser amerikanska
 * börsen ut idag?" — and what it measures is routing, not the ear, so a
 * synthetic voice is a fair stand-in for the microphone. Not for judging
 * how JARVIS sounds: that stays the person's ear.
 *
 *   node scripts/voice-live/synth-utterances.mjs <name> "line 1" "line 2" …
 *     → scripts/voice-live/audio/<name>.wav + <name>.json
 *
 *   AZURE_SPEECH_KEY, AZURE_SPEECH_REGION from .env or the shell;
 *   SYNTH_VOICE (default sv-SE-SofieNeural), SYNTH_LEAD_SECONDS (3),
 *   SYNTH_GAP_SECONDS (16) — the room JARVIS gets to fetch and speak.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RATE = 24_000
const AUDIO = join(process.cwd(), 'scripts', 'voice-live', 'audio')
mkdirSync(AUDIO, { recursive: true })

function env(name) {
  if (process.env[name]) return process.env[name]
  const file = join(process.cwd(), '.env')
  if (!existsSync(file)) return undefined
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`))
  return line?.slice(name.length + 1).trim()
}

const [name, ...lines] = process.argv.slice(2)
if (!name || lines.length === 0) {
  console.error('usage: synth-utterances.mjs <name> "line" ["line" …]')
  process.exit(2)
}
const key = env('AZURE_SPEECH_KEY')
const region = env('AZURE_SPEECH_REGION')
if (!key || !region) {
  console.error('AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are required')
  process.exit(2)
}
const voice = process.env.SYNTH_VOICE ?? 'sv-SE-SofieNeural'
const lead = Number(process.env.SYNTH_LEAD_SECONDS ?? 3)
const gap = Number(process.env.SYNTH_GAP_SECONDS ?? 16)

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** One line, as 16-bit mono PCM at 24 kHz, from Azure's own RIFF output. */
async function speak(text) {
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="sv-SE"><voice name="${voice}">${escape(text)}</voice></speak>`
  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
      'User-Agent': 'financial-os-voice-probe',
    },
    body: ssml,
  })
  if (!response.ok) throw new Error(`azure ${response.status}: ${await response.text()}`)
  const riff = Buffer.from(await response.arrayBuffer())
  /* Find the data chunk rather than assuming a 44-byte header. */
  let offset = 12
  while (offset + 8 <= riff.length) {
    const id = riff.toString('ascii', offset, offset + 4)
    const size = riff.readUInt32LE(offset + 4)
    if (id === 'data') return riff.subarray(offset + 8, offset + 8 + size)
    offset += 8 + size + (size % 2)
  }
  throw new Error('no data chunk in Azure output')
}

const silence = (seconds) => Buffer.alloc(Math.round(seconds * RATE) * 2)

const parts = [silence(lead)]
const segments = []
let cursor = lead
for (const [index, text] of lines.entries()) {
  const pcm = await speak(text)
  const seconds = pcm.length / 2 / RATE
  segments.push({ id: `r${index + 1}`, text, startSeconds: +cursor.toFixed(2), endSeconds: +(cursor + seconds).toFixed(2) })
  parts.push(pcm, silence(gap))
  cursor += seconds + gap
  console.log(`${segments[segments.length - 1].id} ${seconds.toFixed(2)} s  ${text}`)
}
const data = Buffer.concat(parts)
const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + data.length, 4)
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
header.writeUInt32LE(data.length, 40)
writeFileSync(join(AUDIO, `${name}.wav`), Buffer.concat([header, data]))
writeFileSync(join(AUDIO, `${name}.json`), JSON.stringify({ name, voice, seconds: +cursor.toFixed(2), segments }, null, 2))
console.log(`${name}: ${cursor.toFixed(1)} s, ${segments.length} lines, voice ${voice}`)
