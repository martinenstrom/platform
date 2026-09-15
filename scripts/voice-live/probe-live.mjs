/**
 * Talks to JARVIS through GPT-Live without a person: headless Chromium with
 * the person's own recorded Swedish as its microphone, one composed
 * conversation per run, and everything measurable written down —
 * transcripts as the model heard and said them, turn latency, interruptions,
 * delegations created, tool calls, voice seconds and cost.
 *
 * The proof server must be running (node scripts/voice-live/server.mjs) and
 * the WAVs made (node scripts/voice-live/make-wav.mjs).
 *
 *   node scripts/voice-live/probe-live.mjs                      # every conversation, default voice
 *   node scripts/voice-live/probe-live.mjs c2-delegation cedar  # one conversation, one voice
 *   PROBE_VOICES=marin,cedar,ash node scripts/voice-live/probe-live.mjs c1-nvidia-cpi
 *
 * Writes scripts/voice-live/results/probe-<conversation>-<voice>.json and
 * results/probe-report.md (git-ignored).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = dirname(fileURLToPath(import.meta.url))
const AUDIO = join(HERE, 'audio')
const RESULTS = join(HERE, 'results')
mkdirSync(RESULTS, { recursive: true })
const base = process.env.PROBE_BASE ?? 'http://localhost:4175'

const [, , onlyConversation, onlyVoice] = process.argv
const voices = (process.env.PROBE_VOICES ?? onlyVoice ?? 'marin').split(',')
const conversations = readdirSync(AUDIO)
  .filter((f) => /^c\d-.*\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(AUDIO, f), 'utf8')))
  .filter((c) => !onlyConversation || c.name === onlyConversation)
if (conversations.length === 0) {
  console.error('no conversations; run make-wav.mjs first')
  process.exit(2)
}

async function runOne(conversation, voice) {
  const wavPath = join(AUDIO, `${conversation.name}.wav`)
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${wavPath}%noloop`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}/`, { waitUntil: 'networkidle' })
  await page.selectOption('#voice', voice)
  const clicked = Date.now()
  await page.click('#connect')
  let startedMs = null
  try {
    await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Live'), null, { timeout: 30_000 })
    startedMs = Date.now() - clicked
  } catch {
    const status = await page.textContent('#status')
    const events = await page.textContent('#events')
    await browser.close()
    return { conversation: conversation.name, voice, failed: `no session.started: ${status}`, events: events.slice(-800) }
  }
  /* The microphone file has been playing since getUserMedia; wait for it to run out, plus room for the last answer. */
  const remaining = conversation.seconds * 1000 - (Date.now() - clicked)
  await page.waitForTimeout(Math.max(0, remaining) + 4000)

  const snapshot = await page.evaluate(() => ({
    turns: window.__proof.turns.map((t) => ({ who: t.who, text: t.text, startMs: t.startMs, endMs: t.endMs })),
    latencies: window.__proof.latencies,
    interrupts: window.__proof.interrupts,
    sessionId: window.__proof.sessionId,
    events: document.getElementById('events').textContent,
  }))
  const state = await (await fetch(`${base}/session/${snapshot.sessionId}/state`)).json()
  await page.click('#disconnect')
  await page.waitForTimeout(1500)
  const final = await (await fetch(`${base}/session/${snapshot.sessionId}/state`)).json()
  await browser.close()

  const result = {
    conversation: conversation.name,
    voice,
    sessionId: snapshot.sessionId,
    startedAfterMs: startedMs,
    marks: conversation.marks,
    turns: snapshot.turns,
    latenciesMs: snapshot.latencies,
    interrupts: snapshot.interrupts,
    delegations: final.delegations,
    telemetry: final.telemetry,
    negotiationMs: final.negotiationMs,
    browserErrors: errors,
    events: snapshot.events,
  }
  writeFileSync(join(RESULTS, `probe-${conversation.name}-${voice}.json`), JSON.stringify(result, null, 2))
  return result
}

const results = []
for (const conversation of conversations) {
  for (const voice of voices) {
    process.stdout.write(`${conversation.name} · ${voice} … `)
    try {
      const r = await runOne(conversation, voice)
      results.push(r)
      if (r.failed) console.log(`FAILED ${r.failed}`)
      else
        console.log(
          `started ${r.startedAfterMs} ms · turns ${r.turns.length} · latency ${r.latenciesMs.join('/') || '–'} ms · interrupts ${r.interrupts} · delegations ${r.delegations.length} · ${r.telemetry.voiceSeconds} s · $${(r.telemetry.voiceCostUsd + r.telemetry.backend.costUsd).toFixed(4)}`,
        )
    } catch (error) {
      console.log(`ERROR ${error.message}`)
      results.push({ conversation: conversation.name, voice, failed: String(error.message) })
    }
  }
}

/* ------------------------------------------------------------- report */

const lines = ['# GPT-Live probe — what JARVIS heard, said and did', '', `Base ${base}. Latency = assistant transcript start − user transcript end, on the session clock.`, '']
for (const r of results) {
  lines.push(`## ${r.conversation} · ${r.voice}`, '')
  if (r.failed) {
    lines.push(`FAILED: ${r.failed}`, '', '```', r.events ?? '', '```', '')
    continue
  }
  lines.push(
    `session.started after ${r.startedAfterMs} ms (negotiation ${r.negotiationMs} ms) · voice ${r.telemetry.voiceSeconds} s · voice $${r.telemetry.voiceCostUsd.toFixed(4)} · backend $${r.telemetry.backend.costUsd.toFixed(4)} (${r.telemetry.backend.responses} responses, ${r.telemetry.backend.inputTokens}/${r.telemetry.backend.cachedTokens}/${r.telemetry.backend.outputTokens} tokens) · tools ${r.telemetry.toolCalls} ${JSON.stringify(r.telemetry.toolCallsByName)} · delegations ${r.delegations.length} · interruptions ${r.interrupts} · close ${r.telemetry.reason ?? '?'}`,
    '',
    `Spoken by the file: ${r.marks.map((m) => `u${m.id} @ ${m.startS}–${m.endS} s`).join(', ')}`,
    '',
    '| Who | Session time | Text |',
    '| --- | --- | --- |',
  )
  for (const t of r.turns) lines.push(`| ${t.who} | ${(t.startMs / 1000).toFixed(1)}–${(t.endMs / 1000).toFixed(1)} s | ${t.text.replace(/\|/g, '\\|')} |`)
  lines.push('', `Turn latencies: ${r.latenciesMs.join(', ') || '–'} ms`, '')
  if (r.delegations.length) lines.push(`Delegations: ${r.delegations.map((d) => `${d.reference.id} (${d.state}, notes ${d.notes.length}) — ${d.subject}: ${d.question}`).join('; ')}`, '')
  if (r.browserErrors.length) lines.push(`Browser errors: ${r.browserErrors.join(' | ')}`, '')
}
writeFileSync(join(RESULTS, 'probe-report.md'), lines.join('\n'))
console.log('report:', join(RESULTS, 'probe-report.md'))
