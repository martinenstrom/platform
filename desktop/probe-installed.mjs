/**
 * The INSTALLED Financial OS, on its REAL data root, as the person uses it:
 * the first-run choice with nothing written before it; a clearly marked
 * local test relationship with its note, commitment and meeting; the
 * database and its directories where the operating system keeps
 * application data; the application closed completely and launched again
 * with the record verified and JARVIS answering from it; a local snapshot
 * and an encrypted backup made from the installed application; the backup
 * restored into a clean, temporary data directory with the record and
 * JARVIS verified once more; and no development state anywhere on screen.
 *
 * usage: node desktop\probe-installed.mjs [path-to-installed Financial OS.exe]
 *
 * The main flow runs WITHOUT a data-directory override, so it exercises the
 * real root; only the restore runs in a temporary directory, so the person's
 * data is never overwritten by this probe.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
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
const executable =
  process.argv[2] ?? join(process.env.LOCALAPPDATA, 'Programs', 'Financial OS', 'Financial OS.exe')
const REAL_ROOT = join(process.env.APPDATA, 'Financial OS', 'Financial OS')
const out = join('.probe', 'installed')
mkdirSync(out, { recursive: true })
const PASSPHRASE = process.env.PROBE_PASSPHRASE ?? 'installed verification passphrase'

const CLIENT = 'Financial OS Test'
const OFFICE = 'Testkontor'
const GOAL = 'TESTDATA – pension vid 60 med bibehållen livsstil'
const FIRST_MEETING = '2026-11-05'
const EVENT_TITLE = 'TESTDATA – bolånet omsätts'
const EVENT_DATE = '2026-12-01'
const CONCERN = 'TESTDATA – orolig för koncentrationen i energi'
const NOTE = 'TESTDATA: första samtalet, vill samla familjens kapital hos oss.'
const UPDATE =
  'TESTDATA: Träffade klienten i dag. Jag lovade att återkomma med en jämförelse av två placeringsalternativ. Nästa möte är bokat 3 december.'

function launchOptions(dataDir) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.FINANCIAL_OS_DATA_DIR
  if (dataDir) env.FINANCIAL_OS_DATA_DIR = dataDir
  return { executablePath: executable, args: [], env, timeout: 120000 }
}

async function open(dataDir = null) {
  const app = await electron.launch(launchOptions(dataDir))
  const page = await app.firstWindow({ timeout: 120000 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('response', (response) => {
    if (response.status() >= 400)
      errors.push(`response ${response.status()} ${response.request().method()} ${response.url().slice(0, 120)}`)
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
const text = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ')
const pageErrors = (errors) => errors.filter((e) => !/Transition was skipped/u.test(e))
const running = () => {
  const list = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Financial OS.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
  })
  return list.split('\n').filter((line) => /Financial OS\.exe/u.test(line)).length
}
const DEV_LEAK = /localhost|127\.0\.0\.1|5173|syntetisk|dev\\platform|dev\/platform|\bat [A-Za-z_$][\w$]*\s*\(|node_modules|\.tsx?:\d+/iu

let current = null
async function abort(error) {
  log('FAIL probe aborted:', error instanceof Error ? `${error.name}: ${error.message.split('\n')[0]}` : String(error))
  if (current?.errors?.length) log('page errors:', current.errors.join(' | ').slice(0, 800))
  try {
    await current?.page?.screenshot({ path: join(out, 'failure.png') })
    log('failure url:', current?.page?.url())
    log('failure text:', (await text(current.page)).slice(0, 800))
  } catch {}
  try {
    await current?.app?.close()
  } catch {}
  process.exit(1)
}

async function verifyRecord(page, phase, clientUrl) {
  await page.goto(clientUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { level: 1, name: CLIENT }).waitFor({ timeout: 60000 })
  await settle(page)
  const dossier = await text(page)
  const expect = (what, pattern) => check(`${phase}: ${what}`, pattern.test(dossier))
  expect('office named on the dossier', new RegExp(OFFICE))
  expect('goal', /pension vid 60/)
  expect('first meeting 5 nov 2026', /5 nov 2026/)
  expect('important event', /bolånet omsätts/i)
  expect('initial concern', /koncentrationen i energi/)
  expect('initial note in the timeline', /Inledande notering/)
  check(`${phase}: initial note text kept verbatim`, (await page.getByText(/samla familjens kapital/).count()) >= 1)
  expect('update note text', /Träffade klienten i dag/)
  expect('commitment from the note', /jämförelse av två placeringsalternativ/)
  expect('meeting from the note, 3 dec 2026', /3 dec 2026/)
  check(`${phase}: no development state on the dossier`, !DEV_LEAK.test(dossier))
  await page.screenshot({ path: join(out, `${phase}-dossier.png`), fullPage: true })
}

async function askJarvis(page, question, expectPattern, label) {
  const ask = page.getByRole('textbox', { name: 'Fråga', exact: true })
  if ((await ask.count()) === 0) await page.getByRole('button', { name: 'Öppna JARVIS' }).click()
  await ask.fill(question)
  await page.getByRole('button', { name: 'Ställ frågan' }).click()
  const talk = page.getByRole('list', { name: 'Samtal' })
  await talk.getByText(expectPattern).first().waitFor({ timeout: 60000 })
  const answer = await talk.innerText()
  check(label, expectPattern.test(answer), answer.replace(/\s+/g, ' ').slice(-220))
  return answer
}

log('installed executable', executable)
log('real data root', REAL_ROOT)
check('the installed executable exists', existsSync(executable))
const dbBefore = existsSync(join(REAL_ROOT, 'financial-os.db'))
log('database exists before the probe:', dbBefore)

let { app, page, errors } = await open()
current = { app, page, errors }
let clientUrl = ''
try {
  /* ---- 1–3. production host, first run, nothing written before the choice ---- */
  check('window served over the application scheme', page.url().startsWith('app://financial-os/'), page.url())
  check('no localhost in the window URL', !/localhost|127\.0\.0\.1|5173/u.test(page.url()))
  if (!dbBefore) {
    check('first run: the page offers CREATE NEW and RESTORE EXISTING', (await h1(page)) === 'Ditt Financial OS' && (await page.getByRole('button', { name: 'Skapa nytt Financial OS' }).count()) >= 1 && (await page.getByRole('button', { name: 'Återställ befintligt Financial OS' }).count()) >= 1, await h1(page))
    check('first run: no database written before the choice', !existsSync(join(REAL_ROOT, 'financial-os.db')))
    await page.screenshot({ path: join(out, '1-first-run.png') })
    await page.getByRole('button', { name: 'Skapa nytt Financial OS' }).first().click()
    const createPanel = page.getByRole('region', { name: 'Skapa nytt Financial OS' })
    await createPanel.waitFor({ timeout: 30000 })
    await createPanel.getByRole('button', { name: 'Skapa nytt Financial OS' }).click()
    await page.waitForURL(/\/clients/, { timeout: 60000 })
    await page.getByRole('heading', { level: 1, name: 'Klienter' }).waitFor({ timeout: 60000 })
    check('a clean, empty database was created on the choice', /Klienter\s*0\b/i.test(await page.getByRole('region', { name: 'Nyckeltal' }).innerText()) && existsSync(join(REAL_ROOT, 'financial-os.db')))
  } else {
    check('an existing production database opens on the book, not the first-run page', (await h1(page)) !== 'Ditt Financial OS', await h1(page))
  }
  check('no synthetic client mode: the book names a local register', /lokalt register/i.test(await text(page)))
  check('no development state on the book', !DEV_LEAK.test(await text(page)))

  /* ---- 4. a clearly marked local test relationship ---- */
  await page.goto('app://financial-os/clients/office/new', { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/^Namn/).fill(OFFICE)
  await page.getByLabel(/^Ort/).fill('Stockholm')
  await page.getByRole('button', { name: 'Skapa kontor' }).click()
  await page.waitForURL(/\/clients\/office\/of-/, { timeout: 60000 })
  await settle(page)
  check('test office created', (await h1(page)) === OFFICE, await h1(page))

  await page.goto('app://financial-os/clients/new', { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/^Namn/).first().fill(CLIENT)
  await page.getByLabel(/^Kontor/).selectOption({ label: OFFICE })
  await page.getByLabel(/^AUM hos banken/).fill('1000000')
  await page.getByPlaceholder('målet i klientens ord').fill(GOAL)
  await page.getByLabel(/^Nästa möte/).fill(FIRST_MEETING)
  await page.getByPlaceholder('vad').fill(EVENT_TITLE)
  await page.getByPlaceholder('vad').locator('xpath=following-sibling::input[@type="date"]').fill(EVENT_DATE)
  await page.getByLabel(/^Känd oro/).fill(CONCERN)
  await page.getByLabel(/^Inledande notering/).fill(NOTE)
  await page.getByRole('button', { name: 'Skapa PB-relation' }).click()
  await page.waitForURL(/\/clients\/client-/, { timeout: 60000 })
  await page.getByRole('heading', { level: 1, name: CLIENT }).waitFor({ timeout: 60000 })
  await settle(page)
  clientUrl = page.url()
  check('test client created with its note, meeting and event', /ONBOARDING/i.test(await text(page)), clientUrl)

  await page.getByRole('button', { name: 'Lägg till klientuppdatering' }).first().click()
  const flow = page.getByRole('region', { name: 'Lägg till klientuppdatering' })
  await flow.waitFor({ timeout: 30000 })
  await flow.locator('#client-update-note').fill(UPDATE)
  await flow.getByRole('button', { name: 'Spara & analysera' }).click()
  await flow.getByRole('button', { name: 'Bekräfta alla' }).waitFor({ timeout: 60000 })
  await flow.getByRole('button', { name: 'Bekräfta alla' }).click()
  await flow.getByText('Uppdateringen är sparad i relationstidslinjen.').waitFor({ timeout: 60000 })
  const saved = await flow.innerText()
  check('a commitment and a meeting confirmed through Client Memory', /[1-9]\d* åtaganden/.test(saved) && /[1-9]\d* händelser/.test(saved), saved.replace(/\s+/g, ' ').slice(0, 160))
  await flow.getByRole('button', { name: 'Stäng' }).last().click()
  await settle(page)

  await page.goto(clientUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Aktivera PB-relation' }).first().click()
  const activate = page.getByRole('region', { name: 'Aktivera PB-relation' })
  await activate.waitFor({ timeout: 30000 })
  await activate.getByRole('button', { name: 'Aktivera PB-relation' }).click()
  await page.waitForTimeout(1000)
  await settle(page)
  check('test relationship activated', !/CLIENT 360 · ONBOARDING/i.test(await text(page)))

  /* ---- 5. where the files physically are ---- */
  for (const name of ['financial-os.db', 'documents', 'backups', 'logs', 'config']) {
    const path = join(REAL_ROOT, name)
    check(`data on disk: ${path}`, existsSync(path), existsSync(path) ? `${statSync(path).isDirectory() ? 'dir' : `${statSync(path).size} bytes`}` : 'missing')
  }
  await page.goto('app://financial-os/settings', { waitUntil: 'domcontentloaded' })
  await settle(page)
  const settingsText = await text(page)
  check('the application reports the real data root', settingsText.includes(REAL_ROOT), settingsText.match(/[A-Z]:\\[^ ]*Financial OS[^ ]*/)?.[0] ?? '(no path shown)')
  check('the application reports version 0.1.0', /0\.1\.0(?!-dev)/.test(settingsText) && !/0\.1\.0-dev/.test(settingsText))
  check('no development state on the settings page', !DEV_LEAK.test(settingsText))
  log('settings excerpt:', settingsText.slice(0, 600))
  await page.screenshot({ path: join(out, '5-settings.png'), fullPage: true })
  check('no page errors before the close', pageErrors(errors).length === 0, pageErrors(errors).join(' | ').slice(0, 300))

  /* ---- 6. closed completely, launched again, the record verified, JARVIS asked ---- */
  await app.close()
  await new Promise((r) => setTimeout(r, 2000))
  check('closed completely: no Financial OS process', running() === 0, `${running()} process(es)`)
  check('closed in order: no write-ahead log left beside the database', !existsSync(join(REAL_ROOT, 'financial-os.db-wal')))
  ;({ app, page, errors } = await open())
  current = { app, page, errors }
  check('relaunch opens the book, not the first-run page', (await h1(page)) !== 'Ditt Financial OS', await h1(page))
  await verifyRecord(page, '6-after-relaunch', clientUrl)
  await page.goto('app://financial-os/today', { waitUntil: 'domcontentloaded' })
  await settle(page)
  check('Idag lists the test relationship from the installed record', new RegExp(CLIENT).test(await text(page)))
  await askJarvis(page, 'Vad har jag lovat Financial OS Test?', /jämförelse av två placeringsalternativ/, 'JARVIS answers the named promise from the installed SQLite record')
  await page.goto(clientUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { level: 1, name: CLIENT }).waitFor({ timeout: 60000 })
  await askJarvis(page, 'När ses vi?', /5 nov 2026|den 5 november/, 'JARVIS names the next meeting from the installed record')
  await page.screenshot({ path: join(out, '6-jarvis-after-relaunch.png') })

  /* ---- 8. a snapshot and an encrypted backup from the installed application ---- */
  const external = mkdtempSync(join(tmpdir(), 'financial-os-installed-usb-'))
  await page.goto('app://financial-os/settings', { waitUntil: 'domcontentloaded' })
  await settle(page)
  const centre = page.getByRole('region', { name: 'Säkerhet & backup' })
  check('backup centre offers snapshot, verify, export, restore and the folder', ['Skapa backup nu', 'Verifiera backup', 'Exportera krypterad backup', 'Återställ från backup', 'Öppna backupmapp'].every((name) => true), '')
  for (const name of ['Skapa backup nu', 'Verifiera backup', 'Exportera krypterad backup', 'Återställ från backup', 'Öppna backupmapp']) {
    check(`backup centre control: ${name}`, (await centre.getByRole('button', { name }).count()) >= 1)
  }
  const snapshotsBefore = existsSync(join(REAL_ROOT, 'backups', 'snapshots')) ? readdirSync(join(REAL_ROOT, 'backups', 'snapshots')).length : 0
  await centre.getByRole('button', { name: 'Skapa backup nu' }).click()
  await page.waitForTimeout(2500)
  await settle(page)
  const snapshotsAfter = readdirSync(join(REAL_ROOT, 'backups', 'snapshots')).length
  check('a local snapshot was written under backups\\snapshots', snapshotsAfter > snapshotsBefore, `${snapshotsBefore} → ${snapshotsAfter}`)
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
  check('encrypted backup exported and verified after writing', /öppnad och verifierad efter skrivning/.test(exportText), exportText.slice(0, 160))
  const bundles = readdirSync(external).filter((n) => n.endsWith('.financialos'))
  check('the .financialos bundle physically exists in the chosen folder', bundles.length === 1, bundles.join(', '))
  await centre.getByRole('button', { name: 'Verifiera backup' }).click()
  await page.waitForTimeout(2500)
  await settle(page)
  const centreText = await centre.innerText()
  check('backup status is shown in the centre', /backup|snapshot|Senaste/i.test(centreText))
  check('the passphrase never appears on screen', !centreText.includes(PASSPHRASE) && !(await text(page)).includes(PASSPHRASE))
  await page.screenshot({ path: join(out, '8-backup-centre.png'), fullPage: true })
  check('no page errors before the restore', pageErrors(errors).length === 0, pageErrors(errors).join(' | ').slice(0, 300))
  await app.close()
  await new Promise((r) => setTimeout(r, 2000))
  check('closed completely before the restore', running() === 0)

  /* ---- 9. restore into a CLEAN temporary data directory — the real root is never touched ---- */
  const clean = mkdtempSync(join(tmpdir(), 'financial-os-installed-restore-'))
  ;({ app, page, errors } = await open(clean))
  current = { app, page, errors }
  check('clean directory opens on the first-run choice', (await h1(page)) === 'Ditt Financial OS')
  await page.getByRole('button', { name: 'Återställ befintligt Financial OS' }).click()
  const restorePanel = page.getByRole('region', { name: 'Återställ från backup' })
  await restorePanel.waitFor({ timeout: 30000 })
  await restorePanel.getByLabel(/Backupfil/).fill(join(external, bundles[0]))
  await restorePanel.getByLabel(/^Lösenfras/).fill(PASSPHRASE)
  await restorePanel.getByRole('button', { name: 'Granska backup' }).click()
  await restorePanel.getByText('Backupens innehåll').waitFor({ timeout: 60000 })
  const review = (await restorePanel.innerText()).replace(/\s+/g, ' ')
  check('backup review opens: 1 client, 1 office', /1 klient · 1 kontor/.test(review), review.slice(0, 200))
  for (const [what, pattern] of [['manifest', /manifest/i], ['checksums', /kontrollsumm/i], ['database', /databas/i], ['documents', /dokument/i]]) {
    check(`backup review validates the ${what}`, pattern.test(review))
  }
  check('the review shows no failure', !/misslyckades|ogiltig|fel\b/i.test(review))
  await page.screenshot({ path: join(out, '9-restore-review.png'), fullPage: true })
  await restorePanel.getByRole('checkbox').check()
  await restorePanel.getByRole('button', { name: 'Återställ' }).click()
  await page.getByText(/Financial OS är återställt från backupen/).waitFor({ timeout: 120000 })
  check('restore completed into the clean directory', existsSync(join(clean, 'financial-os.db')))
  check('the real root was not touched by the restore', existsSync(join(REAL_ROOT, 'financial-os.db')))
  await app.close()
  await new Promise((r) => setTimeout(r, 2000))
  ;({ app, page, errors } = await open(clean))
  current = { app, page, errors }
  await verifyRecord(page, '9-after-restore', clientUrl)
  await askJarvis(page, 'Vad har jag lovat?', /jämförelse av två placeringsalternativ/, 'JARVIS answers from the restored record')
  check('no page errors after restore', pageErrors(errors).length === 0, pageErrors(errors).join(' | ').slice(0, 300))
  await app.close()
  await new Promise((r) => setTimeout(r, 2000))
  for (const dir of [clean, external]) rmSync(dir, { recursive: true, force: true })
  check('temporary restore and export directories removed', !existsSync(clean) && !existsSync(external))
} catch (error) {
  await abort(error)
}
log(`\n${findings.filter((f) => f.ok).length}/${findings.length} checks passed`)
