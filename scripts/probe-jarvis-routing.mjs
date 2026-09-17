/**
 * Routing by consequence, and how fast it is, measured in HQ by text.
 *
 * Lines are typed into the presence with no voice session. For each: the
 * time from submit to the visible answer, the server's own stage timings
 * for that turn (tier, routing decision, data, composition, model passes,
 * context), the tools called, the firm's case count before and after, and
 * whether the numbers said match the platform's snapshot.
 *
 * Sets (`--sets`, default all):
 *   followup   the ruling's seven — market overview, why, tech, the 10-year,
 *              meaning, Europe, valuation — none may open a case
 *   tier0      three named-instrument lines, repeated (`--repeat`, default 5)
 *              for median and p95; must be answered without a model
 *   control    the capital question — must open a case
 *   isolation  with that case now bound, the market overview again — must
 *              stay a market question: no new case, no case tool
 *
 *   node scripts/probe-jarvis-routing.mjs [label] [--sets a,b] [--repeat n]   (dev server on :5173)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import pg from 'pg'

const args = process.argv.slice(2)
const label = args.find((a) => !a.startsWith('--')) ?? 'text'
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const sets = opt('sets', 'followup,tier0,control,isolation').split(',')
const repeat = Number(opt('repeat', '5'))
const base = process.env.PROBE_BASE ?? 'http://localhost:5173'
const OUT = join(process.cwd(), '.probe')
mkdirSync(OUT, { recursive: true })
const WAIT_MS = Number(process.env.PROBE_WAIT_MS ?? 25_000)

const FOLLOWUP = [
  ['F1', 'Hur ser amerikanska börsen ut idag?'],
  ['F2', 'Varför?'],
  ['F3', 'Hur går tech?'],
  ['F4', 'Vad gör tioåringen?'],
  ['F5', 'Vad betyder högre tioårsränta för tech?'],
  ['F6', 'Och Europa?'],
  ['F7', 'Hur ser värderingen ut?'],
]
const TIER0 = [
  ['T1', 'Hur gick S&P 500 idag?'],
  ['T2', 'Vad gör tioåringen?'],
  ['T3', 'Hur går Nasdaq?'],
]
const CONTROL = [['C1', 'Borde jag minska min USA-exponering?', true]]
const ISOLATION = [['I1', 'Hur ser amerikanska börsen ut idag?']]

const plan = []
if (sets.includes('followup')) for (const [id, text] of FOLLOWUP) plan.push({ id, text, set: 'followup', mayOpenCase: false })
if (sets.includes('tier0'))
  for (let r = 1; r <= repeat; r++) for (const [id, text] of TIER0) plan.push({ id: `${id}.${r}`, text, set: 'tier0', mayOpenCase: false, expectTier0: true })
if (sets.includes('control')) for (const [id, text] of CONTROL) plan.push({ id, text, set: 'control', mayOpenCase: true })
if (sets.includes('isolation')) for (const [id, text] of ISOLATION) plan.push({ id, text, set: 'isolation', mayOpenCase: false, expectNoCaseTool: true })

const databaseUrl =
  process.env.ANALYSIS_DATABASE_URL ??
  readFileSync(join(process.cwd(), '.env'), 'utf8')
    .split(/\r?\n/)
    .find((line) => line.startsWith('ANALYSIS_DATABASE_URL='))
    ?.slice('ANALYSIS_DATABASE_URL='.length)
if (!databaseUrl) {
  console.error('no ANALYSIS_DATABASE_URL')
  process.exit(2)
}
const db = new pg.Client({ connectionString: databaseUrl })
await db.connect()
const caseCount = async () => Number((await db.query('SELECT count(*)::int AS n FROM analysis.cases')).rows[0].n)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const turns = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('ol[aria-label="Samtal"] li[data-by]')].map((li) => ({
      by: li.getAttribute('data-by'),
      text: li.querySelector('p')?.textContent?.trim() ?? '',
    })),
  )
const activeCase = () => page.evaluate(() => Boolean(document.querySelector('aside[aria-label="JARVIS"] [aria-label="Aktivt ärende"]')))
const typedTelemetry = () =>
  page.evaluate(async () => {
    const mod = await import('/src/infrastructure/jarvis/serverFns.ts')
    const all = await mod.liveTelemetryFn()
    return all.ok ? all.typed : null
  })
await page.goto(`${base}/`, { waitUntil: 'networkidle' })
/* The platform's own numbers, to check what was said against. Read on the page, where the dev server's modules resolve. */
const snapshotNumbers = await page.evaluate(async () => {
  const mod = await import('/src/infrastructure/marketData/serverFns.ts')
  const s = await mod.getOverviewSnapshotFn()
  const out = []
  const quotes = (e) => (e.data ?? []).filter((q) => q.provenance.quality !== 'fixture')
  for (const q of [...quotes(s.indices), ...quotes(s.sectors), ...quotes(s.fx), ...quotes(s.commodities)]) {
    out.push(q.value)
    if (q.percentageChange !== null) out.push(Math.abs(q.percentageChange))
  }
  for (const y of (s.yields.data ?? []).filter((r) => r.provenance.quality !== 'fixture')) {
    out.push(y.yieldPercent)
    if (y.changeBasisPoints !== null) out.push(Math.abs(y.changeBasisPoints))
  }
  if (s.sentiment.data && s.sentiment.data.origin !== 'fixture') out.push(s.sentiment.data.score)
  return out
})
const known = new Set()
for (const v of snapshotNumbers) {
  for (const d of [0, 1, 2, 4]) known.add(Number(v).toFixed(d))
  known.add(String(Math.round(v)))
}
/**
 * How many numbers in an answer are the platform's; a number the platform
 * never served is a fabrication. Names that carry digits (S&P 500), clock
 * times, dates, basis points and the score's scale are not numbers said
 * about the market and are removed first.
 */
function verifyNumbers(text) {
  const cleaned = text
    .replace(/S&P\s?500|Nasdaq\s?100|FTSE\s?100|Nikkei\s?225|OMXS30|Russell\s?2000|10[- ]?year|2[- ]?year|tio-?år\w*|två-?år\w*/gi, ' ')
    .replace(/kl\.?\s?\d{1,2}[:.]\d{2}|\b\d{1,2}[:.]\d{2}\b/gi, ' ')
    .replace(/\b\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b/gi, ' ')
    .replace(/\bav 100\b|0[–-]100|\b\d+\s*(?:bas|ränte)?punkter?\b/gi, ' ')
  const tokens = [...cleaned.matchAll(/\d[\d\s]*(?:[,.]\d+)?/g)].map((m) => m[0].replace(/\s/g, '').replace(',', '.')).filter((t) => t.length > 0)
  const numeric = tokens.filter((t) => !/^\d{1,2}$/.test(t) || Number(t) > 12) /* skip dates and small ordinals */
  let ok = 0
  for (const t of numeric) {
    const n = Number(t)
    if (Number.isNaN(n)) continue
    const candidates = [n.toFixed(0), n.toFixed(1), n.toFixed(2), n.toFixed(4), String(Math.round(n))]
    if (candidates.some((c) => known.has(c))) ok += 1
  }
  return { ok, total: numeric.length }
}

await page.click('aside[aria-label="JARVIS"] button[aria-label="Öppna JARVIS"]')
await page.waitForSelector('aside[aria-label="JARVIS"] textarea')

const results = []
let stagesSeen = (await typedTelemetry())?.stages.length ?? 0
for (const step of plan) {
  const casesBefore = await caseCount()
  const before = (await turns()).length
  const boundBefore = await activeCase()
  await page.fill('aside[aria-label="JARVIS"] textarea', step.text)
  const sentAt = Date.now()
  await page.click('aside[aria-label="JARVIS"] button[aria-label="Ställ frågan"]')
  let visibleMs = null
  while (Date.now() - sentAt < WAIT_MS) {
    const now = await turns()
    if (now.length > before + 1 && now[now.length - 1].by === 'jarvis') {
      visibleMs = Date.now() - sentAt
      break
    }
    await page.waitForTimeout(50)
  }
  const after = await turns()
  const answer = after.slice(before + 1).filter((t) => t.by === 'jarvis').map((t) => t.text).join(' ')
  const casesAfter = await caseCount()
  const opened = casesAfter - casesBefore
  const bound = await activeCase()
  const telemetry = await typedTelemetry()
  const stages = telemetry && telemetry.stages.length > stagesSeen ? telemetry.stages[telemetry.stages.length - 1] : null
  stagesSeen = telemetry?.stages.length ?? stagesSeen
  const numbers = verifyNumbers(answer)
  const checks = []
  if (!step.mayOpenCase && opened !== 0) checks.push('opened a case')
  if (step.mayOpenCase && opened !== 1) checks.push('opened no case')
  if (step.expectTier0 && stages?.tier !== 0) checks.push(`tier ${stages?.tier ?? '?'}`)
  if (step.expectNoCaseTool && stages?.toolNames.some((n) => n !== 'get_market_snapshot')) checks.push(`case tool ${stages.toolNames.join(',')}`)
  if (step.expectNoCaseTool && !boundBefore) checks.push('no case was bound before the isolation line')
  if (numbers.total > 0 && numbers.ok < numbers.total) checks.push(`numbers ${numbers.ok}/${numbers.total}`)
  if (visibleMs === null) checks.push('no answer')
  const pass = checks.length === 0
  results.push({ ...step, visibleMs, stages, answer, casesOpened: opened, boundToCase: bound, numbers, checks, pass })
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${step.id.padEnd(5)} ${visibleMs === null ? `none in ${WAIT_MS} ms` : `${String(visibleMs).padStart(5)} ms`} · ${stages ? `tier ${stages.tier} ${stages.routed} intent ${stages.intentMs} data ${stages.dataMs ?? '–'} compose ${stages.composeMs} passes ${stages.modelPasses}${stages.contextAttached ? ' ctx' : ''} [${stages.toolNames.join(',')}]` : 'no stages'} · cases +${opened}${checks.length ? ' · ' + checks.join('; ') : ''}`,
  )
  console.log(`      ${step.text}\n      JARVIS: ${answer || '(nothing)'}`)
}

const telemetry = await typedTelemetry()
await browser.close()
await db.end()

/* Median and p95 per set, on the visible latency. */
const percentile = (values, p) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}
const summary = {}
for (const set of ['followup', 'tier0', 'control', 'isolation']) {
  const values = results.filter((r) => r.set === set && r.visibleMs !== null).map((r) => r.visibleMs)
  if (values.length) summary[set] = { n: values.length, medianMs: percentile(values, 50), p95Ms: percentile(values, 95), maxMs: Math.max(...values) }
}
console.log(`\n${label} · typed turns ${telemetry?.turns ?? '?'} · responses ${telemetry?.responses ?? '?'} · $${telemetry ? telemetry.costUsd.toFixed(4) : '?'} · tools ${JSON.stringify(telemetry?.toolCallsByName ?? {})}`)
for (const [set, s] of Object.entries(summary)) console.log(`${set.padEnd(10)} n=${s.n} median ${s.medianMs} ms · p95 ${s.p95Ms} ms · max ${s.maxMs} ms`)
console.log('browser errors:', errors.length ? errors : 'none')
const file = join(OUT, `routing-${label}.json`)
writeFileSync(file, JSON.stringify({ label, at: new Date().toISOString(), plan: { sets, repeat }, results, summary, telemetry, errors }, null, 2))
console.log('result:', file)
process.exit(results.every((r) => r.pass) ? 0 : 1)
