/**
 * The desktop host, exercised as the person uses it: launched like the
 * Start Menu entry would (the unpacked package when it exists, the host
 * script otherwise), the window answering over the application's own
 * scheme, a fresh data directory opening on the first-run choice and the
 * book gated behind it, no port listening for the process, a second launch
 * deferring to the first, and the data directory where it was told to be.
 *
 * usage: node desktop\probe-desktop.mjs [path-to-Financial OS.exe]
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const findings = []
const log = (...args) => console.log(...args)
const check = (name, ok, detail = '') => {
  findings.push({ name, ok })
  log(ok ? 'PASS' : 'FAIL', name, detail)
  if (!ok) process.exitCode = 1
}

const executable = process.argv[2] ?? null
const dataDir = mkdtempSync(join(tmpdir(), 'financial-os-probe-'))
/* An editor's terminal inherits ELECTRON_RUN_AS_NODE; under it Electron is only Node. */
const env = { ...process.env, FINANCIAL_OS_DATA_DIR: dataDir }
delete env.ELECTRON_RUN_AS_NODE
const launchOptions = executable
  ? { executablePath: executable, args: [], env }
  : { args: ['desktop/main.mjs'], env }
log('launching', executable ?? 'desktop/main.mjs', 'data dir', dataDir)

const app = await electron.launch({ ...launchOptions, timeout: 120000 })
const window = await app.firstWindow({ timeout: 120000 })
const pageErrors = []
window.on('pageerror', (error) => pageErrors.push(error.message))
window.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(message.text())
})
await window.waitForLoadState('domcontentloaded')
await window.waitForSelector('h1', { timeout: 120000 })
const url = window.url()
check(
  'the window answers over the application scheme',
  url.startsWith('app://financial-os/'),
  url,
)
check('no localhost in the window URL', !/localhost|127\.0\.0\.1/u.test(url), url)

/* A fresh data directory holds no record: the window opens on the first-run choice, never on a seeded book. */
const h1 = (await window.locator('h1').first().textContent())?.trim()
check('a fresh data directory opens on the first-run choice', h1 === 'Ditt Financial OS', String(h1))
await window.goto('app://financial-os/clients', { waitUntil: 'domcontentloaded' })
await window.waitForSelector('h1', { timeout: 120000 })
const gated = (await window.locator('h1').first().textContent())?.trim()
check('the book is gated behind the choice until a record exists', gated === 'Ditt Financial OS', String(gated))
const assetsOk = await window.evaluate(() =>
  [...document.styleSheets].some((s) =>
    (s.href ?? '').startsWith('app://financial-os/assets/'),
  ),
)
check('stylesheets are served from the application scheme', assetsOk)
const errors = pageErrors.filter((e) => !/Transition was skipped/u.test(e))
check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300))
await window
  .screenshot({ path: join('.probe', 'desktop', 'clients-desktop.png') })
  .catch(() => {})

/*
 * Nothing listens. Measured on an instance started the way the Start Menu
 * starts it — Playwright's own session carries two debugging ports that
 * are its, not the application's — so the window above is closed first and
 * a plain launch is observed.
 */
await app.close()
const plain = spawn(
  executable ?? join('node_modules', 'electron', 'dist', 'electron.exe'),
  executable ? [] : ['desktop/main.mjs'],
  {
    env,
    stdio: 'ignore',
  },
)
await new Promise((resolve) => setTimeout(resolve, 15000))
let listening = ''
try {
  listening = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' })
    .split(/\r?\n/u)
    .filter(
      (line) => /LISTENING/u.test(line) && new RegExp(`\\s${plain.pid}\\s*$`).test(line),
    )
    .join(' | ')
} catch (error) {
  listening = `netstat unavailable: ${error}`
}
check('the process listens on no TCP port', listening === '', listening)

/* The data directory is where the host was told, with its layout. */
const dirs = existsSync(dataDir) ? readdirSync(dataDir) : []
check(
  'the data layout stands in the configured directory',
  ['backups', 'config', 'documents', 'logs'].every((d) => dirs.includes(d)),
  dirs.join(','),
)

/* A second instance hands over and leaves; the first keeps running. */
const second = spawn(
  executable ?? join('node_modules', 'electron', 'dist', 'electron.exe'),
  executable ? [] : ['desktop/main.mjs'],
  {
    env,
    stdio: 'ignore',
  },
)
const secondExit = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve('still running'), 20000)
  second.on('exit', (code) => {
    clearTimeout(timer)
    resolve(`exit ${code}`)
  })
})
check(
  'a second launch defers to the running instance',
  /^exit/u.test(secondExit),
  secondExit,
)
check('the first instance is still running', plain.exitCode === null)
plain.kill()
await new Promise((resolve) => setTimeout(resolve, 1500))
rmSync(dataDir, { recursive: true, force: true })
log(`\n${findings.filter((f) => f.ok).length}/${findings.length} checks passed`)
