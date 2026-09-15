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
  await page.goto(`${base}/${process.env.LIVE_RECORD === '1' ? '?record=1' : ''}`, { waitUntil: 'networkidle' })
  await page.selectOption('#voice', voice)
  const clicked = Date.now()
  await page.click('#connect')
  let startedMs = null
  try {
    await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Live'), null, { timeout: 30_000 })
    startedMs = Date.now() - clicked
    /* Optional: a trusted instruction for this session, e.g. to answer at length for the barge-in proof. */
    if (process.env.LIVE_INSTRUCT) {
      const id = await page.evaluate(() => window.__proof.sessionId)
      await fetch(`${base}/session/${id}/instructions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: process.env.LIVE_INSTRUCT }) })
    }
  } catch {
    const status = await page.textContent('#status')
    const events = await page.textContent('#events')
    await browser.close()
    return { conversation: conversation.name, voice, failed: `no session.started: ${status}`, events: events.slice(-800) }
  }
  /* The microphone file has been playing since getUserMedia; wait for it to run out, plus room for the last answer. */
  const remaining = conversation.seconds * 1000 - (Date.now() - clicked)
  await page.waitForTimeout(Math.max(0, remaining) + 4000)

  /*
   * Optional: type something into the live session afterwards (LIVE_TYPED)
   * and see whether JARVIS answers it aloud — the instruction-append path,
   * which the docs offer in place of a user-text event.
   */
  let typed = null
  if (process.env.LIVE_TYPED) {
    const before = await page.evaluate(() => window.__proof.turns.length)
    await page.fill('#typedText', process.env.LIVE_TYPED)
    await page.click('#typed button[type="submit"]')
    await page.waitForTimeout(9000)
    const after = await page.evaluate(() => window.__proof.turns.slice(-3).map((t) => ({ who: t.who, text: t.text, startMs: t.startMs })))
    typed = { text: process.env.LIVE_TYPED, turnsBefore: before, spokenAfter: after.filter((t) => t.who === 'assistant').map((t) => t.text.trim()) }
  }

  const snapshot = await page.evaluate(() => ({
    turns: window.__proof.turns.map((t) => ({ who: t.who, text: t.text, startMs: t.startMs, endMs: t.endMs })),
    latencies: window.__proof.latencies,
    interrupts: window.__proof.interrupts,
    bargeIns: window.__proof.bargeIns,
    sessionId: window.__proof.sessionId,
    events: document.getElementById('events').textContent,
  }))
  /*
   * Optional: do not disconnect; let the server's idle policy close the
   * session, and measure how long that took from the last user speech.
   */
  let idle = null
  if (process.env.LIVE_IDLE_WAIT === '1') {
    const started = Date.now()
    let closed = false
    while (Date.now() - started < 180_000) {
      await page.waitForTimeout(1000)
      const s = await (await fetch(`${base}/session/${snapshot.sessionId}/state`)).json()
      if (s.closed) {
        closed = true
        idle = { closedBy: s.telemetry.reason, idleClosed: s.telemetry.idleClosed, voiceSeconds: s.telemetry.voiceSeconds, waitedMs: Date.now() - started }
        break
      }
    }
    if (!closed) idle = { closedBy: null, waitedMs: Date.now() - started }
  } else {
    await page.click('#disconnect')
    await page.waitForTimeout(2500)
  }
  const final = await (await fetch(`${base}/session/${snapshot.sessionId}/state`)).json()
  let recording = null
  if (process.env.LIVE_RECORD === '1') {
    const saved = await page.evaluate(() => window.__proof.audioSaved ?? false)
    recording = saved ? join(RESULTS, `live-${voice}-${snapshot.sessionId}.webm`) : 'not saved'
  }
  await browser.close()

  /*
   * Measurements from the transcripts, which are 200 ms buckets on the
   * session clock. (The sideband's output-audio range was measured to be
   * one continuous span per session — silence included — so it cannot time
   * speech; the transcript can, to within a bucket.)
   *
   * response latency: for each user turn, the next assistant fragment's
   *   start minus the user's end. 0 means the same bucket: JARVIS began
   *   as the person stopped.
   * interruption: a user turn beginning before the previous assistant turn
   *   ended; stop latency = how far the assistant's transcript ran on.
   */
  const turnsInOrder = [...snapshot.turns].sort((a, b) => a.startMs - b.startMs)
  const responseLatencies = []
  const interruptions = []
  for (let i = 0; i < turnsInOrder.length; i++) {
    const t = turnsInOrder[i]
    if (t.who !== 'user') continue
    const next = turnsInOrder.slice(i + 1).find((x) => x.who === 'assistant')
    responseLatencies.push(next ? Math.max(0, next.startMs - t.endMs) : null)
    const previous = [...turnsInOrder.slice(0, i)].reverse().find((x) => x.who === 'assistant')
    if (previous && previous.endMs > t.startMs + 200)
      interruptions.push({ userStartMs: t.startMs, assistantRanToMs: previous.endMs, stopLatencyMs: previous.endMs - t.startMs, assistantSaid: previous.text.trim() })
  }
  const ackBeforeReference = (final.telemetry.timeline?.tools ?? [])
    .filter((tool) => tool.name === 'delegate_to_financial_os')
    .map((tool) => {
      const said = snapshot.turns.find((t) => t.who === 'assistant' && /återkommer|get back|circle back/i.test(t.text))
      return said ? { saidAtMs: said.startMs, referenceAtMs: tool.atAudioMs, leadMs: said.startMs - tool.atAudioMs } : null
    })
    .filter(Boolean)

  const result = {
    conversation: conversation.name,
    voice,
    sessionId: snapshot.sessionId,
    startedAfterMs: startedMs,
    marks: conversation.marks,
    turns: snapshot.turns,
    latenciesMs: snapshot.latencies,
    responseLatenciesMs: responseLatencies,
    interruptions,
    bargeIns: snapshot.bargeIns,
    ackBeforeReference,
    ackWithoutReference: final.telemetry.ackWithoutReference ?? 0,
    instruct: process.env.LIVE_INSTRUCT ?? null,
    idle,
    interrupts: snapshot.interrupts,
    delegations: final.delegations,
    telemetry: final.telemetry,
    negotiationMs: final.negotiationMs,
    recording,
    typed,
    browserErrors: errors,
    events: snapshot.events,
  }
  return result
}

const ackMode = process.env.LIVE_ACK_MODE ?? 'natural'
for (const conversation of conversations) {
  for (const voice of voices) {
    process.stdout.write(`${conversation.name} · ${voice} · ${ackMode} … `)
    try {
      const r = await runOne(conversation, voice)
      r.ackMode = ackMode
      writeFileSync(join(RESULTS, `probe-${conversation.name}-${voice}-${ackMode}.json`), JSON.stringify(r, null, 2))
      if (r.failed) console.log(`FAILED ${r.failed}`)
      else
        console.log(
          `started ${r.startedAfterMs} ms · turns ${r.turns.length} · response ${r.responseLatenciesMs.map((x) => x ?? '–').join('/')} ms · barge-ins ${r.bargeIns.length}${r.bargeIns.length ? ' ' + JSON.stringify(r.bargeIns) : ''} · ack-without-ref ${r.ackWithoutReference} · delegations ${r.delegations.length} · tools ${JSON.stringify(r.telemetry.toolCallsByName)} · ${r.telemetry.voiceSeconds} s · $${(r.telemetry.voiceCostUsd + r.telemetry.backend.costUsd).toFixed(4)}${r.recording ? ' · recording saved' : ''}`,
        )
    } catch (error) {
      console.log(`ERROR ${error.message}`)
      writeFileSync(join(RESULTS, `probe-${conversation.name}-${voice}-${ackMode}.json`), JSON.stringify({ conversation: conversation.name, voice, ackMode, failed: String(error.message) }, null, 2))
    }
  }
}

/* ------------------------------------------------------------- report */

/* Every result on disk, not just this run's, so the report is the whole picture — one row per session. */
const seenSessions = new Set()
const all = readdirSync(RESULTS)
  .filter((f) => /^probe-.*\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(RESULTS, f), 'utf8')))
  .filter((r) => {
    if (!r.sessionId) return true
    if (seenSessions.has(r.sessionId)) return false
    seenSessions.add(r.sessionId)
    return true
  })

const lines = [
  '# GPT-Live probe — what JARVIS heard, said and did',
  '',
  `Base ${base}. Response latency = next assistant transcript start − user transcript end, in 200 ms buckets (0 = the same bucket). Interruption = user speech beginning before the previous assistant turn's transcript ended; stop latency = how far it ran on. Ack before reference = ms between the acknowledgement being spoken and the reference existing (negative = spoken first).`,
  '',
  '## Summary',
  '',
  '| Conversation | Voice | Ack | Started | Response latency (ms) | Interruptions (stop ms) | Ack before reference (ms) | Delegations | Tools | Voice s | Cost |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
]
for (const r of all) {
  if (r.failed) {
    lines.push(`| ${r.conversation} | ${r.voice} | ${r.ackMode ?? ''} | FAILED | | | | | | | |`)
    continue
  }
  lines.push(
    `| ${r.conversation} | ${r.voice} | ${r.ackMode ?? 'natural'} | ${r.startedAfterMs} ms | ${(r.responseLatenciesMs ?? []).map((x) => x ?? '–').join(' / ')} | ${(r.interruptions ?? []).length}${(r.interruptions ?? []).length ? ' (' + r.interruptions.map((i) => i.stopLatencyMs).join('/') + ')' : ''} | ${(r.ackBeforeReference ?? []).map((a) => a.leadMs).join(' / ') || '–'} | ${r.delegations.length} | ${Object.entries(r.telemetry.toolCallsByName).map(([k, v]) => `${k.replace('_to_financial_os', '').replace('_delegation', '')}×${v}`).join(', ') || '–'} | ${r.telemetry.voiceSeconds} | $${(r.telemetry.voiceCostUsd + r.telemetry.backend.costUsd).toFixed(4)} |`,
  )
}
lines.push('')
for (const r of all) {
  lines.push(`## ${r.conversation} · ${r.voice} · ${r.ackMode ?? 'natural'}`, '')
  if (r.failed) {
    lines.push(`FAILED: ${r.failed}`, '', '```', r.events ?? '', '```', '')
    continue
  }
  lines.push(
    `session.started after ${r.startedAfterMs} ms (negotiation ${r.negotiationMs} ms) · voice ${r.telemetry.voiceSeconds} s · voice $${r.telemetry.voiceCostUsd.toFixed(4)} · backend $${r.telemetry.backend.costUsd.toFixed(4)} (${r.telemetry.backend.responses} responses, ${r.telemetry.backend.inputTokens}/${r.telemetry.backend.cachedTokens}/${r.telemetry.backend.outputTokens} tokens) · tools ${r.telemetry.toolCalls} ${JSON.stringify(r.telemetry.toolCallsByName)} · delegations ${r.delegations.length} · close ${r.telemetry.reason ?? '?'}${r.recording ? ` · recording ${r.recording}` : ''}`,
    '',
    `Spoken by the file: ${r.marks.map((m) => `u${m.id} @ ${m.startS}–${m.endS} s`).join(', ')}`,
    '',
    '| Who | Session time | Text |',
    '| --- | --- | --- |',
  )
  for (const t of r.turns) lines.push(`| ${t.who} | ${(t.startMs / 1000).toFixed(1)}–${(t.endMs / 1000).toFixed(1)} s | ${t.text.replace(/\|/g, '\\|')} |`)
  if ((r.bargeIns ?? []).length)
    lines.push('', `Barge-ins (client cut): ${r.bargeIns.map((b) => `onset ${b.onsetSessionMs} ms → muted in ${b.mutedAfterMs} ms; user ended ${b.userEndSessionMs} ms; JARVIS's old turn ran to ${b.assistantRanToSessionMs ?? '?'} ms; new turn at ${b.newTurnSessionMs ?? '?'} ms`).join('; ')}`, '')
  if (r.instruct) lines.push(`Session instruction: ${r.instruct}`, '')
  lines.push('', `Acknowledgement without reference (invariant violations): ${r.ackWithoutReference ?? 0}`, '')
  if (r.delegations.length) lines.push(`Delegations: ${r.delegations.map((d) => `${d.reference.id} (${d.state}, notes ${d.notes.length}) — ${d.subject}: ${d.question}`).join('; ')}`, '')
  if (r.browserErrors.length) lines.push(`Browser errors: ${r.browserErrors.join(' | ')}`, '')
}
writeFileSync(join(RESULTS, 'probe-report.md'), lines.join('\n'))
console.log('report:', join(RESULTS, 'probe-report.md'))
