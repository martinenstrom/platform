/**
 * Financial OS from a fresh install, the way a person lives it: the first
 * launch asks what to do; CREATE NEW makes an empty book with no demo
 * client; an office and a client are taken in; the application is closed
 * and launched again and they are still there; a backup is exported with
 * a passphrase; a second, empty computer is given the file and the
 * passphrase and has the record back — and, closed and launched once more,
 * still has it. Screenshots along the way in .probe/desktop/.
 *
 * usage: node desktop\probe-persistence.mjs [path-to-Financial OS.exe]
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
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
const out = join('.probe', 'desktop')
mkdirSync(out, { recursive: true })
const PASSPHRASE = 'probe horse battery staple'

function launchOptions(dataDir) {
  const env = { ...process.env, FINANCIAL_OS_DATA_DIR: dataDir }
  delete env.ELECTRON_RUN_AS_NODE
  return executable
    ? { executablePath: executable, args: [], env, timeout: 120000 }
    : { args: ['desktop/main.mjs'], env, timeout: 120000 }
}

async function open(dataDir) {
  const app = await electron.launch(launchOptions(dataDir))
  const page = await app.firstWindow({ timeout: 120000 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('response', (response) => {
    const url = response.url()
    if (/_serverFn|_server/u.test(url) || response.status() >= 400)
      errors.push(`response ${response.status()} ${response.request().method()} ${url.slice(0, 120)}`)
  })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('h1', { timeout: 120000 })
  return { app, page, errors }
}
const settle = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(500)
}
const h1 = async (page) => (await page.locator('h1').first().textContent())?.trim()

/* A failure anywhere: the screen as it was, the page's own errors, the error itself — then out. */
let current = null
async function abort(error) {
  log('FAIL probe aborted:', error instanceof Error ? `${error.name}: ${error.message.split('\n')[0]}` : String(error))
  if (current?.errors?.length) log('page errors:', current.errors.join(' | ').slice(0, 800))
  try {
    await current?.page?.screenshot({ path: join(out, 'p0-failure.png') })
    log('failure url:', current?.page?.url())
    log('failure text:', (await current?.page?.locator('body').innerText({ timeout: 5000 }))?.replace(/\s+/g, ' ').slice(0, 800))
  } catch {}
  try {
    await current?.app?.close()
  } catch {}
  process.exit(1)
}

/* ---- the first computer: first launch ---- */
const first = mkdtempSync(join(tmpdir(), 'financial-os-first-'))
let { app, page, errors } = await open(first)
current = { app, page, errors }
try {
check('a fresh install opens on the first-run choice', (await h1(page)) === 'Ditt Financial OS', await h1(page))
check('no database was written before the choice', !existsSync(join(first, 'financial-os.db')))
await page.screenshot({ path: join(out, 'p1-first-run.png') })

await page.getByRole('button', { name: 'Skapa nytt Financial OS' }).first().click()
const createPanel = page.getByRole('region', { name: 'Skapa nytt Financial OS' })
await createPanel.waitFor({ timeout: 30000 })
await createPanel.getByRole('button', { name: 'Skapa nytt Financial OS' }).click()
await page.waitForURL(/\/clients/, { timeout: 60000 })
await settle(page)
check('CREATE NEW lands on an empty Klienter', (await h1(page)) === 'Klienter', await h1(page))
const metrics = await page.getByRole('region', { name: 'Nyckeltal' }).innerText().catch(() => '')
check('the new book holds zero clients — nothing seeded', /Klienter\s*0\b/i.test(metrics), metrics.replace(/\s+/g, ' ').slice(0, 80))
check('the database now exists', existsSync(join(first, 'financial-os.db')))
await page.screenshot({ path: join(out, 'p2-empty-book.png') })

/* ---- an office and a client ---- */
await page.goto('app://financial-os/clients/office/new', { waitUntil: 'domcontentloaded' })
await page.getByLabel(/^Namn/).fill('Stureplan')
await page.getByLabel(/^Ort/).fill('Stockholm')
await page.getByRole('button', { name: 'Skapa kontor' }).click()
await page.waitForURL(/\/clients\/office\/of-/, { timeout: 60000 })
await settle(page)
check('an office is created in the fresh record', (await h1(page)) === 'Stureplan', await h1(page))
await page.goto('app://financial-os/clients/new', { waitUntil: 'domcontentloaded' })
await page.getByLabel(/^Namn/).first().fill('Anna Exempel')
await page.getByLabel(/^Kontor/).selectOption({ label: 'Stureplan' })
await page.getByLabel(/^AUM hos banken/).fill('3000000')
await page.getByRole('button', { name: 'Skapa PB-relation' }).click()
await page.waitForURL(/\/clients\/client-/, { timeout: 60000 })
await page.getByRole('heading', { level: 1, name: 'Anna Exempel' }).waitFor({ timeout: 60000 })
check('a client is taken in', true)
await page.screenshot({ path: join(out, 'p3-client-created.png') })
const errors1 = errors.filter((e) => !/Transition was skipped|^response [23]\d\d /u.test(e))
check('no page errors on the first computer', errors1.length === 0, errors1.join(' | ').slice(0, 300))

/* ---- closed in order, launched again ---- */
await app.close()
await new Promise((r) => setTimeout(r, 1500))
check('the controlled close left no write-ahead log', !existsSync(join(first, 'financial-os.db-wal')))
;({ app, page, errors } = await open(first))
current = { app, page, errors }
check('the relaunch opens the book, not the first-run page', (await h1(page)) !== 'Ditt Financial OS', await h1(page))
await page.goto('app://financial-os/clients/onboarding', { waitUntil: 'domcontentloaded' })
await settle(page)
check('the client survived the restart', (await page.getByRole('link', { name: /Anna Exempel/ }).count()) >= 1)
await page.screenshot({ path: join(out, 'p4-after-relaunch.png') })

/* ---- backups: a snapshot, and an encrypted export ---- */
const external = mkdtempSync(join(tmpdir(), 'financial-os-usb-'))
await page.goto('app://financial-os/settings', { waitUntil: 'domcontentloaded' })
await settle(page)
const centre = page.getByRole('region', { name: 'Säkerhet & backup' })
await centre.getByRole('button', { name: 'Skapa backup nu' }).click()
await page.getByRole('status').waitFor({ timeout: 60000 })
check('a snapshot is taken on demand', /Ögonblicksbild tagen/.test(await page.getByRole('status').innerText()), await page.getByRole('status').innerText())
check('the snapshot is on disk with its sidecar', readdirSync(join(first, 'backups', 'snapshots')).some((n) => n.endsWith('.db.json')))
await centre.getByRole('button', { name: 'Extern mapp' }).click()
await page.getByRole('region', { name: 'Extern backupmapp' }).getByLabel(/^Mapp/).fill(external)
await page.getByRole('region', { name: 'Extern backupmapp' }).getByRole('button', { name: 'Spara' }).click()
await page.waitForTimeout(800)
await centre.getByRole('button', { name: 'Exportera krypterad backup' }).click()
const exportPanel = page.getByRole('region', { name: 'Exportera krypterad backup' })
await exportPanel.getByLabel(/^Lösenfras/).fill(PASSPHRASE)
await exportPanel.getByLabel(/Bekräfta lösenfras/).fill(PASSPHRASE)
await exportPanel.getByRole('button', { name: 'Exportera' }).click()
await page.waitForFunction(() => /Krypterad backup skriven|kunde inte|misslyckades/.test(document.querySelector('[role=status]')?.textContent ?? ''), null, { timeout: 120000 })
const exportText = await page.getByRole('status').innerText()
check('an encrypted bundle is exported and verified', /öppnad och verifierad efter skrivning/.test(exportText), exportText.slice(0, 200))
const bundles = readdirSync(external).filter((n) => n.endsWith('.financialos'))
check('the bundle stands in the external folder', bundles.length === 1, bundles.join(','))
await page.screenshot({ path: join(out, 'p5-recovery-center.png') })
const errors2 = errors.filter((e) => !/Transition was skipped|^response [23]\d\d /u.test(e))
check('no page errors in the Recovery Center', errors2.length === 0, errors2.join(' | ').slice(0, 300))
await app.close()
await new Promise((r) => setTimeout(r, 1500))

/* ---- the second computer: restore ---- */
const second = mkdtempSync(join(tmpdir(), 'financial-os-second-'))
;({ app, page, errors } = await open(second))
current = { app, page, errors }
check('the second computer opens on the first-run choice', (await h1(page)) === 'Ditt Financial OS', await h1(page))
await page.getByRole('button', { name: 'Återställ befintligt Financial OS' }).click()
const restorePanel = page.getByRole('region', { name: 'Återställ från backup' })
await restorePanel.waitFor({ timeout: 30000 })
await restorePanel.getByLabel(/Backupfil/).fill(join(external, bundles[0]))
await restorePanel.getByLabel(/^Lösenfras/).fill(PASSPHRASE)
await restorePanel.getByRole('button', { name: 'Granska backup' }).click()
await restorePanel.getByText('Backupens innehåll').waitFor({ timeout: 60000 })
const contents = await restorePanel.innerText()
check('the bundle is reviewed before anything is restored', /1 klient · 1 kontor/.test(contents), contents.replace(/\s+/g, ' ').slice(0, 200))
await page.screenshot({ path: join(out, 'p6-restore-review.png') })
await restorePanel.getByRole('checkbox').check()
await restorePanel.getByRole('button', { name: 'Återställ' }).click()
await page.getByText(/Financial OS är återställt från backupen/).waitFor({ timeout: 120000 })
check('the restore completes with its summary', true)
check('the restored database stands in the second data directory', existsSync(join(second, 'financial-os.db')))
await page.screenshot({ path: join(out, 'p7-restored.png') })
const errors3 = errors.filter((e) => !/Transition was skipped|^response [23]\d\d /u.test(e))
check('no page errors during restore', errors3.length === 0, errors3.join(' | ').slice(0, 300))
await app.close()
await new Promise((r) => setTimeout(r, 1500))

/* ---- the second computer, launched again ---- */
;({ app, page, errors } = await open(second))
current = { app, page, errors }
await page.goto('app://financial-os/clients/onboarding', { waitUntil: 'domcontentloaded' })
await settle(page)
check('after the relaunch the restored client is there', (await page.getByRole('link', { name: /Anna Exempel/ }).count()) >= 1)
await page.goto('app://financial-os/clients/office/of-stureplan', { waitUntil: 'domcontentloaded' })
await settle(page)
check('and so is the restored office', (await h1(page)) === 'Stureplan', await h1(page))
await page.screenshot({ path: join(out, 'p8-restored-relaunch.png') })
await app.close()
await new Promise((r) => setTimeout(r, 1500))

for (const dir of [first, second, external]) rmSync(dir, { recursive: true, force: true })
} catch (error) {
  await abort(error)
}
log(`\n${findings.filter((f) => f.ok).length}/${findings.length} checks passed`)
