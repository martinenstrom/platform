/**
 * Routing by consequence, and how fast it is, measured in HQ by voice.
 *
 * A synthesized conversation (see voice-live/synth-utterances.mjs) plays
 * into the presence's microphone. For each exchange, from the server's own
 * timeline: when the person stopped, when the voice handed off (if it did),
 * how long the market read and the firm's call took, when the first sound
 * came and when the first useful word came — past any "Mm." or "Jag
 * kollar." — and whether the firm opened a case. The firm's case count is
 * sampled through the run so a case can be tied to the line that opened it.
 *
 *   node scripts/probe-jarvis-routing-voice.mjs <conversation> [label]   (dev server on :5173)
 *
 * The conversation's JSON says which lines may open a case; every other
 * line must not.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import pg from 'pg'

const base = process.env.PROBE_BASE ?? 'http://localhost:5173'
const conversationName = process.argv[2] ?? 'c10-routing'
const label = process.argv[3] ?? conversationName
const AUDIO = join(process.cwd(), 'scripts', 'voice-live', 'audio')
const OUT = join(process.cwd(), '.probe')
mkdirSync(OUT, { recursive: true })
const conversation = JSON.parse(readFileSync(join(AUDIO, `${conversationName}.json`), 'utf8'))
const wav = join(AUDIO, `${conversationName}.wav`)
if (!existsSync(wav)) {
  console.error(`no ${wav}; run scripts/voice-live/synth-utterances.mjs first`)
  process.exit(2)
}

const databaseUrl =
  process.env.ANALYSIS_DATABASE_URL ??
  readFileSync(join(process.cwd(), '.env'), 'utf8')
    .split(/\r?\n/)
    .find((line) => line.startsWith('ANALYSIS_DATABASE_URL='))
    ?.slice('ANALYSIS_DATABASE_URL='.length)
const db = new pg.Client({ connectionString: databaseUrl })
await db.connect()
const caseCount = async () => Number((await db.query('SELECT count(*)::int AS n FROM analysis.cases')).rows[0].n)

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const turns = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('ol[aria-label="Samtal"] li[data-by]')].map((li) => ({
      by: li.getAttribute('data-by'),
      voice: Boolean(li.querySelector('[aria-label="sagt"]')),
      text: li.querySelector('p')?.textContent?.replace(/röst$/, '').trim() ?? '',
    })),
  )

const casesAtStart = await caseCount()
await page.goto(`${base}/`, { waitUntil: 'networkidle' })
await page.click('aside[aria-label="JARVIS"] button[aria-label="Starta röst"]')
await page.waitForFunction(() => /Lyssnar|Talar|Tänker/.test(document.querySelector('aside[aria-label="JARVIS"] button[data-voice]')?.textContent ?? ''), null, { timeout: 30_000 })

const caseSamples = []
const startedAt = Date.now()
const total = conversation.seconds * 1000 + 8000
while (Date.now() - startedAt < total) {
  caseSamples.push({ atSeconds: (Date.now() - startedAt) / 1000, cases: await caseCount() })
  await page.waitForTimeout(1000)
}

const allTurns = await turns()
const state = await page.evaluate(async () => {
  const mod = await import('/src/infrastructure/jarvis/serverFns.ts')
  const all = await mod.liveTelemetryFn()
  if (!all.ok) return null
  const last = all.sessions[all.sessions.length - 1]
  return {
    turns: last.turns,
    tools: last.toolCallsByName,
    ackWithoutReference: last.ackWithoutReference,
    voiceSeconds: last.voiceSeconds,
    cost: +(last.voiceCostUsd + last.backend.costUsd).toFixed(4),
    reason: last.reason ?? null,
    events: Object.fromEntries(Object.entries(last.eventCounts).filter(([name]) => /instructions|delegation|closed|error/.test(name))),
  }
})
const stop = await page.$('aside[aria-label="JARVIS"] button[aria-label="Avsluta röst"]')
if (stop) await stop.click()
await page.waitForTimeout(2000)
await browser.close()
const casesAtEnd = await caseCount()
await db.end()

/* Exchanges: what the person said until JARVIS replied, and the reply. */
const exchanges = []
for (const t of allTurns) {
  const open = exchanges[exchanges.length - 1]
  if (t.by === 'user') {
    if (open && open.jarvis.length === 0) open.user = `${open.user} ${t.text}`
    else exchanges.push({ user: t.text, jarvis: [] })
  } else open?.jarvis.push(t.text)
}

/*
 * Which line an exchange was: matched on what was heard, in order, rather
 * than by position — a pause inside one utterance can split it into two
 * exchanges and shift every index after it.
 */
const wordsOf = (text) => new Set((text.toLowerCase().match(/[\p{L}\p{N}&]+/gu) ?? []).filter((w) => w.length > 2))
const overlap = (a, b) => {
  const wa = wordsOf(a)
  const wb = wordsOf(b)
  if (wa.size === 0 || wb.size === 0) return 0
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared += 1
  return shared / Math.min(wa.size, wb.size)
}
let nextSegment = 0
const matched = exchanges.map((e) => {
  let best = null
  let bestScore = 0
  for (let s = nextSegment; s < conversation.segments.length; s++) {
    const score = overlap(e.user, conversation.segments[s].text)
    if (score > bestScore) {
      bestScore = score
      best = s
    }
  }
  if (best === null || bestScore < 0.5) return null
  nextSegment = best + 1
  return best
})

const rows = exchanges.map((e, i) => {
  const timing = state?.turns[i] ?? null
  const segmentIndex = matched[i]
  const segment = segmentIndex === null ? null : conversation.segments[segmentIndex]
  const from = segment ? segment.startSeconds : null
  const to = segment ? (conversation.segments[segmentIndex + 1]?.startSeconds ?? Infinity) : null
  /* An exchange no line accounts for (a fragment, a garbled first line) is reported, not judged. */
  const before = from === null ? null : (caseSamples.filter((s) => s.atSeconds <= from).at(-1)?.cases ?? casesAtStart)
  const after = to === null ? null : (caseSamples.filter((s) => s.atSeconds <= to).at(-1)?.cases ?? casesAtEnd)
  const opened = before === null || after === null ? null : after - before
  const id = segment?.id ?? `#${i + 1}`
  const mayOpen = segment?.mayOpenCase === true
  const pass = opened === null ? true : mayOpen ? opened === 1 : opened === 0
  const rel = (v) => (timing && v !== null && v !== undefined ? v - timing.userEndMs : null)
  return {
    id,
    expected: segment?.text ?? null,
    heard: e.user,
    jarvis: e.jarvis,
    firstSpeechMs: rel(timing?.firstSpeechMs),
    firstUsefulMs: rel(timing?.firstUsefulSpeechMs),
    handoffMs: rel(timing?.delegationMs),
    marketMs: timing?.marketDurationMs ?? null,
    hostMs: timing?.hostDurationMs ?? null,
    backendSpanMs: timing && timing.backendStartMs !== null && timing.backendEndMs !== null ? timing.backendEndMs - timing.backendStartMs : null,
    casesOpened: opened,
    mayOpenCase: mayOpen,
    pass,
  }
})

const percentile = (values, p) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}
const useful = rows.filter((r) => r.firstUsefulMs !== null).map((r) => r.firstUsefulMs)

console.log(`\n${label} · session ${state?.voiceSeconds ?? '?'} s · $${state?.cost ?? '?'} · tools ${JSON.stringify(state?.tools ?? {})} · ack-without-reference ${state?.ackWithoutReference ?? '?'} · cases ${casesAtStart} → ${casesAtEnd} · events ${JSON.stringify(state?.events ?? {})}`)
console.log('| Line | First sound | First useful | Handoff | Market | Host | Backend span | Cases | Pass |')
for (const r of rows) console.log(`| ${r.id} | ${r.firstSpeechMs ?? '–'} | ${r.firstUsefulMs ?? '–'} | ${r.handoffMs ?? '–'} | ${r.marketMs ?? '–'} | ${r.hostMs ?? '–'} | ${r.backendSpanMs ?? '–'} | ${r.casesOpened === null ? '–' : `+${r.casesOpened}`} | ${r.pass ? 'PASS' : 'FAIL'} |`)
console.log(`first useful word: n=${useful.length} median ${percentile(useful, 50)} ms · p95 ${percentile(useful, 95)} ms`)
for (const r of rows) {
  console.log(`\n${r.id} expected "${r.expected}"\n    heard: ${r.heard}`)
  for (const j of r.jarvis) console.log(`    JARVIS: ${j}`)
}
console.log('\nbrowser errors:', errors.length ? errors : 'none')
const file = join(OUT, `routing-voice-${label}.json`)
writeFileSync(file, JSON.stringify({ label, conversation: conversationName, at: new Date().toISOString(), rows, useful: { n: useful.length, medianMs: percentile(useful, 50), p95Ms: percentile(useful, 95) }, state, caseSamples, errors }, null, 2))
console.log('result:', file)
const matchedLines = matched.filter((m) => m !== null).length
console.log(`lines matched: ${matchedLines} of ${conversation.segments.length}`)
process.exit(rows.every((r) => r.pass) && matchedLines >= conversation.segments.length - 1 ? 0 : 1)
