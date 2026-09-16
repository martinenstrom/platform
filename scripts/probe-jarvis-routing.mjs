/**
 * Routing by consequence, measured in HQ by text: six lines typed into the
 * presence with no voice session, the answer each got, how long it took, and
 * whether the firm opened a case for it.
 *
 * The ruling of 2026-09-16: a question about what the market is doing is
 * answered by JARVIS from fresh data — no case, no committee, no thesis, no
 * scenario. Only a question about what to do with capital goes to the firm.
 * So the first five lines must open no case, and the sixth may.
 *
 *   node scripts/probe-jarvis-routing.mjs [label]      (dev server on :5173, dev DB reachable)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import pg from 'pg'

const base = process.env.PROBE_BASE ?? 'http://localhost:5173'
const label = process.argv[2] ?? 'text'
const OUT = join(process.cwd(), '.probe')
mkdirSync(OUT, { recursive: true })
const WAIT_MS = Number(process.env.PROBE_WAIT_MS ?? 25_000)

/* The acceptance lines, and whether each may open a case. */
const LINES = [
  ['R1', 'Hur ser amerikanska börsen ut idag?', false],
  ['R2', 'Varför?', false],
  ['R3', 'Hur går tech?', false],
  ['R4', 'Vad gör tioåringen?', false],
  ['R5', 'Vad betyder högre tioårsränta för tech?', false],
  ['R6', 'Borde jag minska min USA-exponering?', true],
]

/* The firm's own count of cases, read from the dev database as the application's login. */
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

await page.goto(`${base}/`, { waitUntil: 'networkidle' })
await page.click('aside[aria-label="JARVIS"] button[aria-label="Öppna JARVIS"]')
await page.waitForSelector('aside[aria-label="JARVIS"] textarea')

const results = []
for (const [flow, text, mayOpenCase] of LINES) {
  const casesBefore = await caseCount()
  const before = (await turns()).length
  await page.fill('aside[aria-label="JARVIS"] textarea', text)
  const sentAt = Date.now()
  await page.click('aside[aria-label="JARVIS"] button[aria-label="Ställ frågan"]')
  let answeredAfterMs = null
  while (Date.now() - sentAt < WAIT_MS) {
    const now = await turns()
    if (now.length > before + 1 && now[now.length - 1].by === 'jarvis') {
      answeredAfterMs = Date.now() - sentAt
      break
    }
    await page.waitForTimeout(200)
  }
  const after = await turns()
  const answer = after.slice(before + 1).filter((t) => t.by === 'jarvis').map((t) => t.text).join(' ')
  const casesAfter = await caseCount()
  const opened = casesAfter - casesBefore
  const bound = await activeCase()
  const pass = mayOpenCase ? true : opened === 0 && !bound
  results.push({ flow, text, answeredAfterMs, answer, casesOpened: opened, boundToCase: bound, mayOpenCase, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${flow} "${text}" → ${answeredAfterMs === null ? `no answer in ${WAIT_MS} ms` : `${answeredAfterMs} ms`} · cases +${opened} · bound ${bound}`)
  console.log(`      JARVIS: ${answer || '(nothing)'}`)
}

const telemetry = await page.evaluate(async () => {
  const mod = await import('/src/infrastructure/jarvis/serverFns.ts')
  const all = await mod.liveTelemetryFn()
  return all.ok ? all.typed : null
})
await browser.close()
await db.end()

console.log(`\n${label} · typed turns ${telemetry?.turns ?? '?'} · responses ${telemetry?.responses ?? '?'} · $${telemetry ? telemetry.costUsd.toFixed(4) : '?'} · tools ${JSON.stringify(telemetry?.toolCallsByName ?? {})}`)
console.log('browser errors:', errors.length ? errors : 'none')
const file = join(OUT, `routing-${label}.json`)
writeFileSync(file, JSON.stringify({ label, at: new Date().toISOString(), results, telemetry, errors }, null, 2))
console.log('result:', file)
process.exit(results.every((r) => r.pass) ? 0 : 1)
