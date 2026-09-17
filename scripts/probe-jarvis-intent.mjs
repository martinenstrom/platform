/**
 * From natural intent to real work, measured in HQ by text.
 *
 * The gold conversation of 2026-09-17: the person asked the committee to
 * find out why gold was up, and was asked five times for a thesis, a scope
 * and a formal approval. This probe types the same intent and counts what
 * the ruling counts — turns from clear intent to work actually starting on
 * the firm's record — and reads the record, not the conversation, to say
 * whether it started: an opening revision, and desk runs.
 *
 *   node scripts/probe-jarvis-intent.mjs [label]        (dev server on :5173)
 *   node scripts/probe-jarvis-intent.mjs --record [n]   print the newest n cases' records, no browser
 *
 * Lines: the intent; the focus, as the ruling's acceptance example gives
 * it; and the closing. Each must be answered without the words of a form,
 * the first must open exactly one case and start work, the second must
 * open none, and the third must close the case.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const args = process.argv.slice(2)
const recordOnly = args.includes('--record')
/* Leave the case open, and wait for the desks' runs to end, so the record can show what the work produced. */
const keepOpen = args.includes('--keep-open')
const SETTLE_MS = Number(process.env.PROBE_SETTLE_MS ?? 420_000)
const label = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? 'intent'
const base = process.env.PROBE_BASE ?? 'http://localhost:5173'
const OUT = join(process.cwd(), '.probe')
mkdirSync(OUT, { recursive: true })
const WAIT_MS = Number(process.env.PROBE_WAIT_MS ?? 40_000)
const FORM_WORDS = /utgångstes|\btes\b|omfattning|formell|godkännande|godkänna|systemet kräver|scenario/i

const LINES = [
  { id: 'L1', text: 'Kolla med kommittén och be dem ta reda på varför guld är upp idag.', opens: 1, startsWork: true },
  { id: 'L2', text: 'Makro, flöden och specifika händelser.', opens: 0 },
  { id: 'L3', text: 'Stäng ärendet.', opens: 0, closes: true },
]

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

/** One case as the record holds it: the question, what the person added, the opening, the runs. */
async function record(caseId) {
  const c = (await db.query('SELECT id, question, subject_display_name, stage, opened_at, closed_at FROM analysis.cases WHERE id = $1', [caseId])).rows[0]
  const amendments = (await db.query('SELECT text, recorded_at FROM analysis.case_amendments WHERE case_id = $1 ORDER BY recorded_at', [caseId])).rows
  const revisions = (await db.query('SELECT revision_number, statement, position, proposed_by_employee_id, proposed_at FROM analysis.thesis_revisions WHERE case_id = $1 ORDER BY revision_number', [caseId])).rows
  const runs = (await db.query('SELECT id, department_id, state, provider_kind, playbook_entry_key, started_at, completed_at, agent_principal_id FROM analysis.runs WHERE case_id = $1 ORDER BY started_at', [caseId])).rows
  const evidence = (
    await db.query(
      'SELECT s.id, s.assembled_at, count(i.observation_id)::int AS items FROM analysis.evidence_sets s LEFT JOIN analysis.evidence_items i ON i.evidence_set_id = s.id WHERE s.correlation_id = $1 GROUP BY s.id, s.assembled_at',
      [caseId],
    )
  ).rows
  return { ...c, amendments, revisions, runs, evidence }
}
async function newestCases(n) {
  const rows = (await db.query('SELECT id FROM analysis.cases ORDER BY opened_at DESC LIMIT $1', [n])).rows
  const out = []
  for (const row of rows) out.push(await record(row.id))
  return out
}
function printRecord(r) {
  console.log(`\n${r.id} · ${r.stage}${r.closed_at ? ` · closed ${r.closed_at}` : ''} · opened ${r.opened_at}\n  Q: ${r.question}`)
  for (const a of r.amendments) console.log(`  + ${a.recorded_at}  ${a.text}`)
  for (const v of r.revisions) console.log(`  opening r${v.revision_number} [${v.position}] by ${v.proposed_by_employee_id ?? '–'} at ${v.proposed_at}: ${v.statement}`)
  for (const e of r.evidence) console.log(`  evidence ${e.id} (${e.items} items) assembled ${e.assembled_at}`)
  for (const run of r.runs) console.log(`  run ${run.department_id}/${run.playbook_entry_key} ${run.state} (${run.provider_kind}, ${run.agent_principal_id ?? 'employee'}) started ${run.started_at}${run.completed_at ? ` done ${run.completed_at}` : ''}`)
  if (r.revisions.length === 0 && r.runs.length === 0) console.log('  (no opening, no runs: work never started)')
}

if (recordOnly) {
  const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 3)
  for (const r of await newestCases(n)) printRecord(r)
  await db.end()
  process.exit(0)
}

const { chromium } = await import('playwright')
const caseCount = async () => Number((await db.query('SELECT count(*)::int AS n FROM analysis.cases')).rows[0].n)
const newestCaseId = async () => (await db.query('SELECT id FROM analysis.cases ORDER BY opened_at DESC LIMIT 1')).rows[0]?.id ?? null

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
const typedTelemetry = () =>
  page.evaluate(async () => {
    const mod = await import('/src/infrastructure/jarvis/serverFns.ts')
    const all = await mod.liveTelemetryFn()
    return all.ok ? all.typed : null
  })
await page.goto(`${base}/`, { waitUntil: 'networkidle' })
await page.click('aside[aria-label="JARVIS"] button[aria-label="Öppna JARVIS"]')
await page.waitForSelector('aside[aria-label="JARVIS"] textarea')

const results = []
let caseId = null
let stagesSeen = (await typedTelemetry())?.stages.length ?? 0
let clarifications = 0
let workStartedAtTurn = null
for (const [index, step] of (keepOpen ? LINES.filter((line) => !line.closes) : LINES).entries()) {
  const casesBefore = await caseCount()
  const before = (await turns()).length
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
  const opened = (await caseCount()) - casesBefore
  if (opened > 0) caseId = await newestCaseId()
  const telemetry = await typedTelemetry()
  const stages = telemetry && telemetry.stages.length > stagesSeen ? telemetry.stages[telemetry.stages.length - 1] : null
  stagesSeen = telemetry?.stages.length ?? stagesSeen
  const rec = caseId ? await record(caseId) : null
  const started = rec ? rec.revisions.length > 0 && rec.runs.length > 0 : false
  if (started && workStartedAtTurn === null) workStartedAtTurn = index + 1
  const asksBack = /\?\s*$/.test(answer) && !started
  if (asksBack) clarifications += 1
  const checks = []
  if (opened !== (step.opens ?? 0)) checks.push(`opened ${opened}, expected ${step.opens ?? 0}`)
  if (step.startsWork && !started) checks.push('work did not start on the record')
  if (step.closes && !(rec && rec.closed_at)) checks.push('case not closed')
  if (FORM_WORDS.test(answer)) checks.push(`form words: ${answer.match(FORM_WORDS)?.[0]}`)
  if (visibleMs === null) checks.push('no answer')
  const pass = checks.length === 0
  results.push({ ...step, visibleMs, stages, answer, casesOpened: opened, started, checks, pass })
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${step.id} ${visibleMs === null ? `none in ${WAIT_MS} ms` : `${String(visibleMs).padStart(5)} ms`} · ${stages ? `passes ${stages.modelPasses} [${stages.toolNames.join(',')}]` : 'no stages'} · cases +${opened}${started ? ' · work on the record' : ''}${checks.length ? ' · ' + checks.join('; ') : ''}`,
  )
  console.log(`      ${step.text}\n      JARVIS: ${answer || '(nothing)'}`)
}

await browser.close()
let finalRecord = caseId ? await record(caseId) : null
if (keepOpen && finalRecord) {
  /* The desks' runs continue in the server after `begin` returned; what they produced is on the record when they end. */
  const startedAt = Date.now()
  while (Date.now() - startedAt < SETTLE_MS && finalRecord.runs.some((run) => run.state === 'running')) {
    await new Promise((resolve) => setTimeout(resolve, 15_000))
    finalRecord = await record(caseId)
  }
  const claims = (await db.query('SELECT run_id, count(*)::int AS n FROM analysis.produced_claims WHERE run_id = ANY($1) GROUP BY run_id', [finalRecord.runs.map((run) => run.id)])).rows
  finalRecord.claims = Object.fromEntries(claims.map((row) => [row.run_id, row.n]))
  console.log(`\nsettled after ${Math.round((Date.now() - startedAt) / 1000)} s · produced claims per run: ${JSON.stringify(finalRecord.claims)}`)
}
if (finalRecord) printRecord(finalRecord)
await db.end()

console.log(`\n${label} · clarification turns before work: ${clarifications} · work started at turn: ${workStartedAtTurn ?? 'never'} · browser errors: ${errors.length ? errors.join('; ') : 'none'}`)
const file = join(OUT, `intent-${label}.json`)
writeFileSync(file, JSON.stringify({ label, at: new Date().toISOString(), results, clarifications, workStartedAtTurn, record: finalRecord, errors }, null, 2))
console.log('result:', file)
process.exit(results.every((r) => r.pass) ? 0 : 1)
