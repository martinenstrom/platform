/**
 * The TTS bake-off: the fixed JARVIS answers through every configured
 * finalist, on raw HTTP, measuring time to first audio and total time, and
 * saving each result for the only judge that matters — a Swedish ear.
 *
 * Finalists (the ruling's): Azure Swedish voices (every sv-SE voice the
 * region lists, HD included, unless AZURE_TTS_VOICES narrows it) in two
 * variants — English spans tagged with <lang xml:lang="en-US"> as we would
 * ship it, and untagged — and ElevenLabs v3 on the voices you name.
 *
 *   node scripts/voice-bakeoff/tts.mjs
 *   node scripts/voice-bakeoff/tts.mjs --roundtrip   # also sends each result through the STT finalists
 *
 * Needs:
 *   AZURE_SPEECH_KEY, AZURE_SPEECH_REGION   (e.g. swedencentral)
 *   ELEVENLABS_API_KEY, ELEVENLABS_VOICE_IDS  (comma-separated; run once without to list voices)
 *   optional: AZURE_TTS_VOICES (comma-separated ShortNames), ELEVENLABS_TTS_MODEL (default eleven_v3),
 *             TTS_PROVIDERS (comma-separated subset of azure,elevenlabs; runs are cumulative)
 *
 * Writes results/tts/<provider>-<voice>[-tagged]-<id>.mp3 and results/tts-report.md.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERE, RESULTS, cell, credentials, loadEnv, median, ms, now, readJson, termHits, writeResult } from './lib.mjs'
import { providers as sttProviders } from './stt-providers.mjs'

loadEnv()

const { answers } = readJson(join(HERE, 'answers.json'))
const roundtrip = process.argv.includes('--roundtrip')
const OUT = join(RESULTS, 'tts')

const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Wraps each English span in <lang>, longest span first so "equity risk premium" is not split by "risk". */
function tagged(answer) {
  let text = escapeXml(answer.text)
  for (const span of [...answer.english].sort((a, b) => b.length - a.length)) {
    text = text.split(escapeXml(span)).join(`<lang xml:lang="en-US">${escapeXml(span)}</lang>`)
  }
  return text
}

/** Reads a streamed body, noting when the first audio byte arrived. */
async function drain(response, started) {
  const reader = response.body.getReader()
  const chunks = []
  let firstAudioMs = null
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    if (firstAudioMs === null && value.length > 0) firstAudioMs = ms(started)
    chunks.push(value)
  }
  return { bytes: Buffer.concat(chunks), firstAudioMs: firstAudioMs ?? ms(started), totalMs: ms(started) }
}

/* ---------------------------------------------------------- providers */

async function azureVoices() {
  const region = process.env.AZURE_SPEECH_REGION
  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
    headers: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY },
  })
  if (!response.ok) throw new Error(`voices ${response.status}: ${await response.text()}`)
  const all = await response.json()
  const named = process.env.AZURE_TTS_VOICES?.split(',').map((v) => v.trim()).filter(Boolean)
  if (named?.length) return all.filter((v) => named.includes(v.ShortName))
  /* Every Swedish voice, plus multilingual and HD voices that list Swedish. */
  return all.filter(
    (v) => v.Locale === 'sv-SE' || (v.SecondaryLocaleList ?? []).includes('sv-SE') || /sv-SE/.test(v.ShortName),
  )
}

async function azureSpeak(voice, ssmlBody) {
  const region = process.env.AZURE_SPEECH_REGION
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="sv-SE"><voice name="${voice}">${ssmlBody}</voice></speak>`
  const started = now()
  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'financial-os-voice-bakeoff',
    },
    body: ssml,
  })
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
  return drain(response, started)
}

async function elevenVoices() {
  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
  })
  if (!response.ok) throw new Error(`voices ${response.status}: ${await response.text()}`)
  return (await response.json()).voices ?? []
}

async function elevenSpeak(voiceId, text) {
  const model = process.env.ELEVENLABS_TTS_MODEL ?? 'eleven_v3'
  const started = now()
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: model }),
    },
  )
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
  return drain(response, started)
}

/* ---------------------------------------------------------------- run */

const jobs = []
const selected = (process.env.TTS_PROVIDERS ?? 'azure,elevenlabs').split(',')

const azure = credentials(['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'])
if (!selected.includes('azure')) console.log('skip Azure: not in TTS_PROVIDERS')
else if (azure.ok) {
  const voices = await azureVoices()
  console.log(`Azure: ${voices.length} Swedish-capable voice(s): ${voices.map((v) => `${v.ShortName} [${v.VoiceType}/${v.Status}]`).join(', ')}`)
  for (const voice of voices) {
    jobs.push({ provider: 'azure', voice: voice.ShortName, variant: 'tagged', speak: (a) => azureSpeak(voice.ShortName, tagged(a)) })
    jobs.push({ provider: 'azure', voice: voice.ShortName, variant: 'untagged', speak: (a) => azureSpeak(voice.ShortName, escapeXml(a.text)) })
  }
} else console.log(`skip Azure: missing ${azure.missing.join(', ')}`)

const eleven = credentials(['ELEVENLABS_API_KEY'])
if (!selected.includes('elevenlabs')) console.log('skip ElevenLabs: not in TTS_PROVIDERS')
else if (eleven.ok) {
  const ids = process.env.ELEVENLABS_VOICE_IDS?.split(',').map((v) => v.trim()).filter(Boolean) ?? []
  if (ids.length === 0) {
    const voices = await elevenVoices()
    console.log('ElevenLabs: set ELEVENLABS_VOICE_IDS to some of these (id · name · labels):')
    for (const v of voices) console.log(`  ${v.voice_id} · ${v.name} · ${JSON.stringify(v.labels ?? {})}`)
  }
  for (const id of ids) jobs.push({ provider: 'elevenlabs', voice: id, variant: process.env.ELEVENLABS_TTS_MODEL ?? 'eleven_v3', speak: (a) => elevenSpeak(id, a.text) })
} else console.log(`skip ElevenLabs: missing ${eleven.missing.join(', ')}`)

if (jobs.length === 0) {
  console.error('Nothing to synthesise. Stop here: this is the credential (or voice selection) boundary.')
  process.exit(3)
}
mkdirSync(OUT, { recursive: true })

const fresh = []
for (const job of jobs) {
  let refused = false
  for (const answer of answers) {
    if (refused) break
    const name = `${job.provider}-${job.voice.replace(/[^\w.-]/g, '_')}-${job.variant}-${answer.id}`
    process.stdout.write(`${name} … `)
    try {
      const out = await job.speak(answer)
      const file = join(OUT, `${name}.mp3`)
      writeFileSync(file, out.bytes)
      fresh.push({ ...job, speak: undefined, name, answerId: answer.id, file, firstAudioMs: out.firstAudioMs, totalMs: out.totalMs, bytes: out.bytes.length })
      console.log(`first audio ${out.firstAudioMs} ms · total ${out.totalMs} ms · ${Math.round(out.bytes.length / 1024)} kB`)
    } catch (error) {
      const message = String(error.message ?? error)
      fresh.push({ ...job, speak: undefined, name, answerId: answer.id, error: message })
      console.log(`FAILED: ${message.split('\n')[0]}`)
      /* A refused key or an exhausted quota will not change on the next answer. */
      refused = /\b(401|402|403|429)\b/.test(message)
    }
  }
}

/*
 * Runs are cumulative and may overlap in time: each run writes its own
 * file under results/tts-runs/, the report is rebuilt from all of them,
 * and a later run of the same voice replaces its earlier rows.
 */
const RUNS = join(RESULTS, 'tts-runs')
mkdirSync(RUNS, { recursive: true })
writeFileSync(join(RUNS, `${new Date().toISOString().replace(/[:.]/g, '-')}-${selected.join('+')}.json`), JSON.stringify(fresh, null, 2))
const results = allRuns()

function allRuns() {
  const legacy = join(RESULTS, 'tts-results.json')
  const files = [...(existsSync(legacy) ? [legacy] : []), ...readdirSync(RUNS).sort().map((f) => join(RUNS, f))]
  const byName = new Map()
  for (const file of files) for (const row of readJson(file)) byName.set(row.name ?? row.file, row)
  return [...byName.values()]
}

/* ---------------------------------------------- optional round trip */

let recovery = null
if (roundtrip) {
  /*
   * A proxy, not a judgement: each synthesised answer is sent back through
   * the STT finalists, and the finance terms that survive say something
   * about how clearly the English inside the Swedish was pronounced. It
   * does not say how it sounds; only a listener does.
   */
  recovery = []
  const ears = Object.entries(sttProviders).filter(([, p]) => credentials(p.keys).ok)
  if (ears.length === 0) console.log('round trip skipped: no STT provider has credentials')
  for (const r of fresh.filter((x) => !x.error)) {
    const answer = answers.find((a) => a.id === r.answerId)
    const terms = answer.english.map((term) => ({ term, accept: [term] }))
    if (terms.length === 0) continue
    for (const [name, provider] of ears) {
      try {
        const out = await provider.transcribe(readFileSync(r.file), 'audio/mpeg')
        recovery.push({ ...r, stt: name, transcript: out.text, hits: termHits(terms, out.text) })
      } catch (error) {
        recovery.push({ ...r, stt: name, error: String(error.message ?? error) })
      }
    }
  }
  writeResult('tts-roundtrip.json', recovery)
}

/* ------------------------------------------------------------- report */

const lines = ['# TTS bake-off — results', '', 'Latencies are measured from request start; quality is yours to score by listening to `results/tts/`.', '']
lines.push('## Summary', '', '| Provider · voice · variant | Median first audio | Median total | Failures |', '| --- | --- | --- | --- |')
const groups = new Map()
for (const r of results) {
  const key = `${r.provider} · ${r.voice} · ${r.variant}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(r)
}
for (const [key, rs] of groups) {
  const ok = rs.filter((r) => !r.error)
  lines.push(`| ${cell(key)} | ${median(ok.map((r) => r.firstAudioMs)) ?? '–'} ms | ${median(ok.map((r) => r.totalMs)) ?? '–'} ms | ${rs.length - ok.length} |`)
}
lines.push('', '## Files', '')
for (const r of results) lines.push(`- ${r.error ? `FAILED ${cell(r.error)}` : `\`${r.file}\` — first audio ${r.firstAudioMs} ms, total ${r.totalMs} ms`}`)
if (recovery) {
  lines.push('', '## Round trip (proxy for English-term clarity, not for sound)', '', '| File | STT | English terms recovered | Transcript |', '| --- | --- | --- | --- |')
  for (const r of recovery) lines.push(`| ${cell(r.file)} | ${r.stt} | ${r.error ? 'FAILED' : r.hits.map((h) => `${h.hit ? '✓' : '✗'} ${h.term}`).join(', ')} | ${cell(r.transcript ?? r.error)} |`)
}
lines.push('', '## Human scoring (fill in)', '', 'Per voice, 1–5: Swedish naturalness · calm authority · English terms inside Swedish · prosody · long-form listenability (a09, a10) · fit with the JARVIS brief. Note first-audio latency beside it.', '')
const path = writeResult('tts-report.md', lines.join('\n'))
console.log('report:', path)

/* ------------------------------------------------------ listening set */

/*
 * One page, every answer, every voice beside it, so the ear compares like
 * with like. Opened straight from disk; the audio sits next to it.
 */
const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const voices = [...groups.keys()]
const html = [
  '<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>JARVIS röst — lyssningsset</title>',
  '<style>body{font-family:system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#e8edf7;background:#060910}',
  'h1{font-size:1.2rem}h2{font-size:1rem;margin-top:2rem;color:#98a3b8}p.text{font-size:1.02rem;line-height:1.5;border-left:2px solid #26344a;padding-left:.8rem}',
  'table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.35rem .5rem;border-bottom:1px solid #1a2434;font-size:.9rem;vertical-align:middle}',
  'th{color:#818da1;font-weight:500}audio{width:100%;height:32px}.ms{color:#98a3b8;white-space:nowrap}</style></head><body>',
  '<h1>Lyssningsset — samma svar, varje röst bredvid varandra</h1>',
  `<p>Bedöm 1–5 per röst: svensk naturlighet · lugn auktoritet · engelska termer inne i svenskan · prosodi · långform (a09, a10) · passar JARVIS-briefen. ${voices.length} röster/varianter.</p>`,
]
for (const answer of answers) {
  html.push(`<h2>${answer.id} — ${escapeHtml(answer.kind)}</h2><p class="text">${escapeHtml(answer.text)}</p>`)
  html.push('<table><tr><th style="width:34%">Röst</th><th>Ljud</th><th class="ms">första ljud / totalt</th></tr>')
  for (const voice of voices) {
    const r = groups.get(voice).find((x) => x.answerId === answer.id)
    if (!r) continue
    const src = r.error ? '' : `tts/${escapeHtml(r.name ?? r.file.split(/[\\/]/).pop().replace(/\.mp3$/, ''))}.mp3`
    html.push(
      `<tr><td>${escapeHtml(voice)}</td><td>${r.error ? `<em>FAILED</em> ${escapeHtml(r.error.split('\n')[0].slice(0, 120))}` : `<audio controls preload="none" src="${src}"></audio>`}</td><td class="ms">${r.error ? '' : `${r.firstAudioMs} / ${r.totalMs} ms`}</td></tr>`,
    )
  }
  html.push('</table>')
}
html.push('</body></html>')
console.log('listening set:', writeResult('listen.html', html.join('\n')))
