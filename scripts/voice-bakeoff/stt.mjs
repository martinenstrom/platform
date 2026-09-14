/**
 * The STT bake-off: every recording through every configured finalist.
 *
 * Finalists (the ruling's): AssemblyAI Universal-3.5 Pro, ElevenLabs Scribe
 * v2. Optional baseline: OpenAI (gpt-transcribe, or OPENAI_STT_MODEL).
 *
 *   node scripts/voice-bakeoff/stt.mjs
 *
 * Needs: recordings/NN.webm for the utterances in utterances.json, and
 *   ASSEMBLYAI_API_KEY     (optionally ASSEMBLYAI_BASE=https://api.eu.assemblyai.com)
 *   ELEVENLABS_API_KEY
 *   OPENAI_API_KEY         (optional)
 *   STT_PROVIDERS          (optional, comma-separated subset of assemblyai,elevenlabs,openai)
 *
 * Writes results/stt-<provider>.json and results/stt-report.md.
 * Exit 3: no provider has credentials. Exit 2: nothing recorded.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERE, RECORDINGS, RESULTS, cell, credentials, loadEnv, median, percent, readJson, termHits, wer, writeResult } from './lib.mjs'
import { providers } from './stt-providers.mjs'

loadEnv()

const set = readJson(join(HERE, 'utterances.json'))

/* ------------------------------------------------- the two boundaries */

const selected = (process.env.STT_PROVIDERS ?? 'assemblyai,elevenlabs,openai').split(',')
const runnable = []
for (const name of selected) {
  const provider = providers[name]
  if (!provider) continue
  const { ok, missing } = credentials(provider.keys)
  if (!ok) {
    console.log(`skip ${provider.label}: missing ${missing.join(', ')}`)
    continue
  }
  runnable.push([name, provider])
}
if (runnable.length === 0) {
  console.error('No STT provider has credentials. This is the credential boundary; nothing was sent anywhere.')
  process.exit(3)
}

const recordings = set.utterances.filter((u) => existsSync(join(RECORDINGS, `${u.id}.webm`)))
if (recordings.length === 0) {
  console.error(`No recordings in ${RECORDINGS}. Run record-server.mjs and read the utterances first.`)
  process.exit(2)
}
console.log(`${recordings.length} of ${set.utterances.length} utterances recorded; ${runnable.length} provider(s) configured.`)

/* ---------------------------------------------------------------- run */

const results = {}
for (const [name, provider] of runnable) {
  results[name] = { label: provider.label, utterances: [] }
  for (const utterance of recordings) {
    const bytes = readFileSync(join(RECORDINGS, `${utterance.id}.webm`))
    process.stdout.write(`${provider.label} · ${utterance.id} … `)
    try {
      const out = await provider.transcribe(bytes)
      const hits = termHits(utterance.terms, out.text)
      const rate = wer(utterance.text, out.text)
      results[name].utterances.push({
        id: utterance.id,
        reference: utterance.text,
        transcript: out.text,
        language: out.language,
        latencyMs: out.latencyMs,
        wer: rate,
        terms: hits,
        detail: out.detail,
      })
      console.log(`${out.latencyMs} ms · WER ${percent(rate)} · terms ${hits.filter((h) => h.hit).length}/${hits.length}`)
    } catch (error) {
      const message = String(error.message ?? error)
      results[name].utterances.push({ id: utterance.id, reference: utterance.text, error: message })
      console.log(`FAILED: ${message.split('\n')[0]}`)
      /* A refused key or an exhausted quota will not change on the next file. */
      if (/\b(401|402|403|429)\b/.test(message)) {
        console.log(`${provider.label}: stopping after an account-level refusal.`)
        break
      }
    }
  }
  writeResult(`stt-${name}.json`, results[name])
}
const anySuccess = Object.values(results).some((r) => r.utterances.some((u) => !u.error))

/* The report is cumulative: every provider whose latest run is on disk appears beside this one. */
for (const file of readdirSync(RESULTS).filter((f) => /^stt-[a-z]+\.json$/.test(f))) {
  const name = file.slice(4, -5)
  if (!results[name]) results[name] = readJson(join(RESULTS, file))
}

/* ------------------------------------------------------------- report */

const lines = [
  '# STT bake-off — results',
  '',
  `Recorded utterances: ${recordings.length}. Vocabulary hints and language hints identical for every provider. Latency is request start to final transcript, from this machine.`,
  '',
  '## Summary',
  '',
  '| Provider | Term accuracy | Mean WER | Median latency | Failures |',
  '| --- | --- | --- | --- | --- |',
]
for (const result of Object.values(results)) {
  const ok = result.utterances.filter((u) => !u.error)
  const terms = ok.flatMap((u) => u.terms)
  lines.push(
    `| ${result.label} | ${terms.length ? percent(terms.filter((t) => t.hit).length / terms.length) : '–'} | ${ok.length ? percent(ok.reduce((s, u) => s + u.wer, 0) / ok.length) : '–'} | ${median(ok.map((u) => u.latencyMs)) ?? '–'} ms | ${result.utterances.length - ok.length} |`,
  )
}
lines.push('', '## Per utterance', '')
for (const utterance of recordings) {
  lines.push(`### ${utterance.id} — ${utterance.kind}`, '', `> ${utterance.text}`, '')
  lines.push('| Provider | Transcript | Language | Terms | WER | Latency |', '| --- | --- | --- | --- | --- | --- |')
  for (const result of Object.values(results)) {
    const entry = result.utterances.find((u) => u.id === utterance.id)
    if (!entry) continue
    if (entry.error) {
      lines.push(`| ${result.label} | FAILED: ${cell(entry.error)} | | | | |`)
      continue
    }
    const terms = entry.terms.map((t) => `${t.hit ? '✓' : '✗'} ${t.term}`).join(', ')
    lines.push(`| ${result.label} | ${cell(entry.transcript)} | ${cell(entry.language ?? '?')} | ${cell(terms)} | ${percent(entry.wer)} | ${entry.latencyMs} ms |`)
  }
  lines.push('')
}
lines.push(
  '## Human scoring (fill in)',
  '',
  'Per provider, 1–5: semantic correctness · finance-term correctness · code-switching · readability. Weight a wrong number or a lost term above any article.',
  '',
)
console.log('report:', writeResult('stt-report.md', lines.join('\n')))
if (!anySuccess) {
  console.error('Every transcription failed; the report holds the errors, not results.')
  process.exit(1)
}
