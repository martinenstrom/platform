/**
 * The round trip, after the fact: every synthesised answer in results/tts
 * goes back through the configured STT finalists, and what comes out is
 * compared with what went in.
 *
 * A proxy, not a judgement. Two numbers per file: how many of the English
 * spans survived as English words, and the word error rate of the whole
 * Swedish transcript against the answer text. A voice that mangles
 * "equity risk premium" or slurs the Swedish will show it here; how it
 * *sounds* only a listener can say.
 *
 *   node scripts/voice-bakeoff/roundtrip.mjs            # every file without a result yet
 *   node scripts/voice-bakeoff/roundtrip.mjs --all      # redo every file
 *
 * Writes results/tts-roundtrip.json and results/tts-roundtrip.md.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERE, RESULTS, cell, credentials, loadEnv, median, percent, readJson, termHits, wer, writeResult } from './lib.mjs'
import { providers } from './stt-providers.mjs'

loadEnv()

const { answers } = readJson(join(HERE, 'answers.json'))
const OUT = join(RESULTS, 'tts')
const store = join(RESULTS, 'tts-roundtrip.json')
const redo = process.argv.includes('--all')

const selected = (process.env.STT_PROVIDERS ?? 'assemblyai,elevenlabs,openai').split(',')
const ears = Object.entries(providers).filter(([name, p]) => selected.includes(name) && credentials(p.keys).ok)
if (ears.length === 0) {
  console.error('No selected STT provider has credentials; the round trip cannot run.')
  process.exit(3)
}

/* Rows from ears no longer selected are dropped, so a refused key does not linger in the report. */
const previous = (!redo && existsSync(store) ? readJson(store) : []).filter((r) => ears.some(([name]) => name === r.stt))
/* Only a transcript counts as done; a failure is tried again next run. */
const done = new Set(previous.filter((r) => !r.error).map((r) => `${r.file}|${r.stt}`))
const rows = previous.filter((r) => !r.error)
const dead = new Set()

const files = existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith('.mp3')).sort() : []
console.log(`${files.length} synthesised files; ${ears.length} ear(s): ${ears.map(([n]) => n).join(', ')}`)

for (const file of files) {
  const answerId = /-(a\d\d)\.mp3$/.exec(file)?.[1]
  const answer = answers.find((a) => a.id === answerId)
  if (!answer) continue
  const voice = file.replace(/-a\d\d\.mp3$/, '')
  const terms = answer.english.map((term) => ({ term, accept: [term] }))
  for (const [name, provider] of ears) {
    if (done.has(`${file}|${name}`) || dead.has(name)) continue
    process.stdout.write(`${file} · ${name} … `)
    try {
      const out = await provider.transcribe(readFileSync(join(OUT, file)), 'audio/mpeg')
      const hits = termHits(terms, out.text)
      const rate = wer(answer.text, out.text)
      rows.push({ file, voice, answerId, stt: name, transcript: out.text, language: out.language, hits, wer: rate })
      console.log(`WER ${percent(rate)} · english ${hits.filter((h) => h.hit).length}/${hits.length} · ${out.language}`)
    } catch (error) {
      const message = String(error.message ?? error)
      rows.push({ file, voice, answerId, stt: name, error: message })
      console.log(`FAILED: ${message.split('\n')[0]}`)
      /* A refused key or an exhausted quota will not change on the next file. */
      if (/\b(401|402|403)\b/.test(message)) {
        dead.add(name)
        console.log(`${name}: no further files this run.`)
      }
    }
  }
}
writeResult('tts-roundtrip.json', rows)

/* ------------------------------------------------------------- report */

const lines = [
  '# TTS round trip — the ears listening to the voices',
  '',
  'Each synthesised answer transcribed back by the STT finalist(s). WER is against the answer text (lower = the Swedish came through intact); "English" counts the English spans recovered as English words. A proxy for clarity, not for how it sounds.',
  '',
  '## Per voice',
  '',
  '| Voice · variant | STT | Files | Mean WER | Median WER | English spans recovered | Detected as Swedish |',
  '| --- | --- | --- | --- | --- | --- | --- |',
]
const byVoice = new Map()
for (const r of rows) {
  const key = `${r.voice}|${r.stt}`
  if (!byVoice.has(key)) byVoice.set(key, [])
  byVoice.get(key).push(r)
}
for (const [key, rs] of [...byVoice.entries()].sort()) {
  const ok = rs.filter((r) => !r.error)
  const spans = ok.flatMap((r) => r.hits)
  const [voice, stt] = key.split('|')
  lines.push(
    `| ${cell(voice)} | ${stt} | ${ok.length}/${rs.length} | ${ok.length ? percent(ok.reduce((s, r) => s + r.wer, 0) / ok.length) : '–'} | ${ok.length ? percent(median(ok.map((r) => r.wer))) : '–'} | ${spans.length ? `${spans.filter((h) => h.hit).length}/${spans.length}` : '–'} | ${ok.filter((r) => /^sw|^sv/.test(r.language ?? '')).length}/${ok.length} |`,
  )
}
lines.push('', '## Per file', '', '| File | STT | WER | English | Transcript |', '| --- | --- | --- | --- | --- |')
for (const r of rows.sort((a, b) => a.file.localeCompare(b.file))) {
  lines.push(
    r.error
      ? `| ${cell(r.file)} | ${r.stt} | FAILED | | ${cell(r.error.split('\n')[0].slice(0, 160))} |`
      : `| ${cell(r.file)} | ${r.stt} | ${percent(r.wer)} | ${r.hits.map((h) => `${h.hit ? '✓' : '✗'} ${h.term}`).join(', ')} | ${cell(r.transcript)} |`,
  )
}
console.log('report:', writeResult('tts-roundtrip.md', lines.join('\n')))
