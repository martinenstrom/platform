/**
 * Routing by consequence, measured in HQ by voice: the acceptance lines
 * spoken into the presence's microphone (a synthesized Swedish voice, see
 * synth-utterances.mjs), the answer each got, where the time went, and
 * whether the firm opened a case for it.
 *
 * Per exchange, from the server's own timeline: when the person stopped,
 * when the voice handed off, when the market data was read and how long it
 * took, when the firm was called, and when the first spoken reply began.
 * The firm's case count is read before and after each exchange.
 *
 *   node scripts/probe-jarvis-routing-voice.mjs [label]   (dev server on :5173; audio/c10-routing.wav from synth-utterances)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import pg from 'pg'

const base = process.env.PROBE_BASE ?? 'http://localhost:5173'
const label = process.argv[2] ?? 'voice'
const AUDIO = join(process.cwd(), 'scripts', 'voice-live', 'audio')
const OUT = join(process.cwd(), '.probe')
mkdirSync(OUT, { recursive: true })
const conversation = JSON.parse(readFileSync(join(AUDIO, 'c10-routing.json'), 'utf8'))
const wav = join(AUDIO, 'c10-routing.wav')
if (!existsSync(wav)) {
  console.error('run scripts/voice-live/synth-utterances.mjs c10-routing … first')
  process.exit(2)
}
/* Which exchanges may open a case: only the one about capital. */
const MAY_OPEN = new Set(['r6'])

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

/* Sample the case count as the conversation plays, so a case can be tied to the exchange that opened it. */
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

const rows = exchanges.map((e, i) => {
  const timing = state?.turns[i] ?? null
  const segment = conversation.segments[i] ?? null
  /* A case opened between this exchange's start and the next one's is this exchange's. */
  const from = segment ? segment.startSeconds : 0
  const to = conversation.segments[i + 1]?.startSeconds ?? Infinity
  const before = caseSamples.filter((s) => s.atSeconds <= from).at(-1)?.cases ?? casesAtStart
  const after = caseSamples.filter((s) => s.atSeconds <= to).at(-1)?.cases ?? casesAtEnd
  const opened = after - before
  const id = segment?.id ?? `#${i + 1}`
  const pass = MAY_OPEN.has(id) ? true : opened === 0
  return {
    id,
    expected: segment?.text ?? null,
    heard: e.user,
    jarvis: e.jarvis,
    firstSpeechMs: timing && timing.firstSpeechMs !== null ? timing.firstSpeechMs - timing.userEndMs : null,
    handoffMs: timing && timing.delegationMs !== null ? timing.delegationMs - timing.userEndMs : null,
    marketMs: timing?.marketDurationMs ?? null,
    hostMs: timing?.hostDurationMs ?? null,
    backendSpanMs: timing && timing.backendStartMs !== null && timing.backendEndMs !== null ? timing.backendEndMs - timing.backendStartMs : null,
    casesOpened: opened,
    pass,
  }
})

console.log(`\n${label} · session ${state?.voiceSeconds ?? '?'} s · $${state?.cost ?? '?'} · tools ${JSON.stringify(state?.tools ?? {})} · ack-without-reference ${state?.ackWithoutReference ?? '?'} · cases ${casesAtStart} → ${casesAtEnd}`)
console.log('| Line | First speech | Handoff | Market | Host | Backend span | Cases | Pass |')
for (const r of rows) console.log(`| ${r.id} | ${r.firstSpeechMs ?? '–'} | ${r.handoffMs ?? '–'} | ${r.marketMs ?? '–'} | ${r.hostMs ?? '–'} | ${r.backendSpanMs ?? '–'} | +${r.casesOpened} | ${r.pass ? 'PASS' : 'FAIL'} |`)
for (const r of rows) {
  console.log(`\n${r.id} expected "${r.expected}"\n    heard: ${r.heard}`)
  for (const j of r.jarvis) console.log(`    JARVIS: ${j}`)
}
console.log('\nbrowser errors:', errors.length ? errors : 'none')
const file = join(OUT, `routing-voice-${label}.json`)
writeFileSync(file, JSON.stringify({ label, at: new Date().toISOString(), rows, state, caseSamples, errors }, null, 2))
console.log('result:', file)
process.exit(rows.every((r) => r.pass) && rows.length >= conversation.segments.length ? 0 : 1)
