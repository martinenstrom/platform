/**
 * The fast path under each backend configuration, measured in HQ.
 *
 * For every configuration the dev server is started with that environment
 * and the routing probe runs the same lines against it; the results are
 * gathered into one table: median and p95 of the visible latency per set,
 * the stage timings, correctness (routing, numbers), tools and cost. The
 * sixth line is the control: it must reach the firm under every
 * configuration.
 *
 *   node scripts/bench-jarvis-fastpath.mjs [--configs default,minimal,low,high,priority] [--repeat 5]
 *   node scripts/bench-jarvis-fastpath.mjs --aggregate default,minimal,low,high,priority
 *     (no runs: the table from the results already in .probe/)
 *
 * Needs the dev database, OPENAI_API_KEY, and FINANCIAL_OS_OPERATOR_EMPLOYEE_ID
 * in the shell (the control line delegates to the firm as that operator).
 */

import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
/*
 * The efforts gpt-5.6-luna accepts, measured 2026-09-16 with one call each:
 * none, low, medium, high, xhigh, max. "minimal" is refused (400), which a
 * first bench recorded as every line answered "JARVIS kunde inte svara".
 */
const CONFIGS = {
  default: {},
  none: { JARVIS_LIVE_REASONING: 'none' },
  low: { JARVIS_LIVE_REASONING: 'low' },
  medium: { JARVIS_LIVE_REASONING: 'medium' },
  high: { JARVIS_LIVE_REASONING: 'high' },
  priority: { JARVIS_LIVE_SERVICE_TIER: 'priority' },
  'none-priority': { JARVIS_LIVE_REASONING: 'none', JARVIS_LIVE_SERVICE_TIER: 'priority' },
  'low-priority': { JARVIS_LIVE_REASONING: 'low', JARVIS_LIVE_SERVICE_TIER: 'priority' },
}
const aggregateOnly = opt('aggregate', '')
const names = (aggregateOnly || opt('configs', 'default,none,low,high,priority')).split(',')
const repeat = opt('repeat', '5')
const OUT = join(process.cwd(), '.probe')
mkdirSync(OUT, { recursive: true })
const base = 'http://localhost:5173'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function up() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(3000) })
      if (response.ok) return true
    } catch {}
    await sleep(2000)
  }
  return false
}
function killPort() {
  try {
    const lines = execSync('netstat -ano', { encoding: 'utf8' }).split(/\r?\n/).filter((l) => /:5173\s.*LISTENING/.test(l))
    for (const pid of new Set(lines.map((l) => l.trim().split(/\s+/).pop()))) {
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
      } catch {}
    }
  } catch {}
}

const runs = []
for (const name of names) {
  const env = CONFIGS[name]
  if (!env) {
    console.error(`unknown config ${name}`)
    continue
  }
  if (aggregateOnly) {
    const file = join(OUT, `routing-bench-${name}.json`)
    if (existsSync(file)) runs.push({ name, env, ...JSON.parse(readFileSync(file, 'utf8')) })
    else console.error(`no result for ${name} in .probe/`)
    continue
  }
  killPort()
  console.log(`\n=== ${name} ${JSON.stringify(env)} ===`)
  const server = spawn('npm', ['run', 'dev'], { env: { ...process.env, ...env }, shell: true, stdio: 'ignore', detached: false })
  if (!(await up())) {
    console.error('dev server did not come up')
    killPort()
    continue
  }
  const label = `bench-${name}`
  try {
    execSync(`node scripts/probe-jarvis-routing.mjs ${label} --repeat ${repeat}`, { stdio: 'inherit', env: process.env })
  } catch {
    /* a failed check is data, not a stop */
  }
  killPort()
  try {
    server.kill()
  } catch {}
  await sleep(1500)
  const file = join(OUT, `routing-${label}.json`)
  if (existsSync(file)) runs.push({ name, env, ...JSON.parse(readFileSync(file, 'utf8')) })
}

/* The table. */
const cell = (v) => (v === null || v === undefined ? '–' : String(v))
const lines = []
lines.push('| Config | Followup median / p95 | Tier 0 median / p95 | Control | Isolation | Numbers | Passes/turn | Responses | Cost |')
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const run of runs) {
  const f = run.summary.followup
  const t = run.summary.tier0
  const control = run.results.find((r) => r.set === 'control')
  const isolation = run.results.find((r) => r.set === 'isolation')
  const numbers = run.results.reduce((acc, r) => ({ ok: acc.ok + r.numbers.ok, total: acc.total + r.numbers.total }), { ok: 0, total: 0 })
  const router = run.results.filter((r) => r.stages && r.stages.tier === 'router')
  const passes = router.length ? (router.reduce((a, r) => a + r.stages.modelPasses, 0) / router.length).toFixed(2) : '–'
  lines.push(
    `| ${run.name} | ${f ? `${f.medianMs} / ${f.p95Ms} ms` : '–'} | ${t ? `${t.medianMs} / ${t.p95Ms} ms` : '–'} | ${control ? (control.pass ? 'case, PASS' : 'FAIL') : '–'} | ${isolation ? (isolation.pass ? 'PASS' : 'FAIL') : '–'} | ${numbers.ok}/${numbers.total} | ${passes} | ${cell(run.telemetry?.responses)} | $${run.telemetry ? run.telemetry.costUsd.toFixed(4) : '–'} |`,
  )
}
lines.push('')
lines.push('Per line, visible latency in ms (server total in parentheses):')
const ids = [...new Set(runs.flatMap((r) => r.results.map((x) => x.id)))]
lines.push(`| Line | ${runs.map((r) => r.name).join(' | ')} |`)
lines.push(`| --- | ${runs.map(() => '---').join(' | ')} |`)
for (const id of ids) {
  lines.push(
    `| ${id} | ${runs
      .map((r) => {
        const x = r.results.find((y) => y.id === id)
        return x ? `${cell(x.visibleMs)} (${cell(x.stages?.totalMs)})${x.pass ? '' : ' ✗'}` : '–'
      })
      .join(' | ')} |`,
  )
}
const table = lines.join('\n')
console.log(`\n${table}`)
writeFileSync(join(OUT, 'bench-fastpath.md'), table)
writeFileSync(join(OUT, 'bench-fastpath.json'), JSON.stringify({ at: new Date().toISOString(), runs }, null, 2))
console.log('\nresult: .probe/bench-fastpath.md, .probe/bench-fastpath.json')
