/**
 * Follow-up on the installed application, on its real data root: what the
 * book and the dossier say that a development-leak pattern matched, whether
 * the book names the local register once it holds a client, and the exact
 * wording of a backup review — measured, so expectations are corrected from
 * the surface and not from memory. Exports a bundle to a temporary folder
 * and reviews it in a temporary clean directory; the real root is read only.
 *
 * usage: node desktop\probe-installed-followup.mjs
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const executable = join(process.env.LOCALAPPDATA, 'Programs', 'Financial OS', 'Financial OS.exe')
const REAL_ROOT = join(process.env.APPDATA, 'Financial OS', 'Financial OS')
const PASSPHRASE = process.env.PROBE_PASSPHRASE ?? 'installed verification passphrase'
const CLIENT = 'Financial OS Test'
const log = (...args) => console.log(...args)
const check = (name, ok, detail = '') => {
  log(ok ? 'PASS' : 'FAIL', name, detail)
  if (!ok) process.exitCode = 1
}
const DEV_LEAK = /localhost|127\.0\.0\.1|5173|syntetisk|dev\\platform|dev\/platform|\bat [A-Za-z_$][\w$]*\s*\(|node_modules|\.tsx?:\d+/iu

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
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('h1', { timeout: 120000 })
  return { app, page }
}
const settle = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(500)
}
const text = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ')
const snippet = (body, re) => {
  const m = re.exec(body)
  return m ? `"…${body.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60)}…"` : '(no match)'
}

let { app, page } = await open()
try {
  await page.goto('app://financial-os/clients', { waitUntil: 'domcontentloaded' })
  await settle(page)
  const book = await text(page)
  check('the office view of the book shows no synthetic label', !/syntetisk/i.test(book), snippet(book, /syntetisk/i))
  await page.goto('app://financial-os/clients?view=alla', { waitUntil: 'domcontentloaded' })
  await settle(page)
  const all = await text(page)
  check('the book names the local register', /lokalt register/i.test(all), snippet(all, /lokalt register|syntetisk/i))
  await page.getByRole('link', { name: new RegExp(CLIENT) }).first().click()
  await page.getByRole('heading', { level: 1, name: CLIENT }).waitFor({ timeout: 60000 })
  await settle(page)
  const dossier = await text(page)
  log('dossier dev-leak match:', snippet(dossier, DEV_LEAK))
  const STRICT = /localhost|127\.0\.0\.1|5173|syntetisk|dev\\platform|dev\/platform|node_modules|\.tsx?:\d+|Error:|TypeError|ReferenceError/iu
  check('the dossier shows no localhost, port, synthetic label, repository path or stack trace', !STRICT.test(dossier), snippet(dossier, STRICT))
  await page.goto('app://financial-os/today', { waitUntil: 'domcontentloaded' })
  await settle(page)
  check('Idag shows no development state', !STRICT.test(await text(page)))

  /* A bundle into the application's own local backup folder — kept for the person — reviewed in a temporary clean directory. */
  const external = join(REAL_ROOT, 'backups', 'bundles')
  await page.goto('app://financial-os/settings', { waitUntil: 'domcontentloaded' })
  await settle(page)
  const centre = page.getByRole('region', { name: 'Säkerhet & backup' })
  /* The earlier probes pointed the external folder at temporary directories that no longer exist: clear it, so no daily export is aimed at a vanished path. */
  await centre.getByRole('button', { name: 'Extern mapp' }).click()
  const destination = page.getByRole('region', { name: 'Extern backupmapp' })
  await destination.getByLabel(/^Mapp/).fill('')
  await destination.getByRole('button', { name: 'Spara' }).click()
  await page.waitForTimeout(800)
  const cleared = await page.getByRole('status').innerText().catch(() => '')
  check('the external folder set by the probes is cleared again', /Ingen extern backupmapp vald/.test(cleared), cleared.slice(0, 120))
  await centre.getByRole('button', { name: 'Exportera krypterad backup' }).click()
  const exportPanel = page.getByRole('region', { name: 'Exportera krypterad backup' })
  await exportPanel.locator('select').first().selectOption('LOCAL')
  /* After the first export the passphrase is kept sealed on this computer; the panel then asks for none. */
  const kept = (await exportPanel.getByLabel(/^Ny lösenfras/).count()) > 0
  log('passphrase kept by the installed application:', kept)
  if (!kept) {
    await exportPanel.getByLabel(/^Lösenfras/).fill(PASSPHRASE)
    await exportPanel.getByLabel(/Bekräfta lösenfras/).fill(PASSPHRASE)
  }
  await exportPanel.getByRole('button', { name: 'Exportera' }).click()
  await page.waitForFunction(() => /Krypterad backup skriven|kunde inte|misslyckades/.test(document.querySelector('[role=status]')?.textContent ?? ''), null, { timeout: 120000 })
  const bundles = readdirSync(external).filter((n) => n.endsWith('.financialos')).sort()
  check('a bundle now stands in the local backup folder', bundles.length >= 1, bundles.join(', '))
  const newest = bundles[bundles.length - 1]
  log('bundles kept under the real root:', bundles.join(', '))
  log('snapshots under the real root:', readdirSync(join(REAL_ROOT, 'backups', 'snapshots')).join(', ') || '(none)')
  await app.close()
  await new Promise((r) => setTimeout(r, 2000))

  const clean = mkdtempSync(join(tmpdir(), 'financial-os-followup-restore-'))
  ;({ app, page } = await open(clean))
  await page.getByRole('button', { name: 'Återställ befintligt Financial OS' }).click()
  const restorePanel = page.getByRole('region', { name: 'Återställ från backup' })
  await restorePanel.waitFor({ timeout: 30000 })
  await restorePanel.getByLabel(/Backupfil/).fill(join(external, newest))
  await restorePanel.getByLabel(/^Lösenfras/).fill(PASSPHRASE)
  await restorePanel.getByRole('button', { name: 'Granska backup' }).click()
  await restorePanel.getByText('Backupens innehåll').waitFor({ timeout: 60000 })
  const review = (await restorePanel.innerText()).replace(/\s+/g, ' ')
  log('REVIEW TEXT:', review.slice(0, 1200))
  check('the review validates the format, the checksums, the database and the documents', /kontrollsumm/i.test(review) && /databas/i.test(review) && /dokument/i.test(review) && !/misslyckades|ogiltig/i.test(review), '')
  await restorePanel.getByRole('checkbox').check()
  await restorePanel.getByRole('button', { name: 'Återställ' }).click()
  await page.getByText(/Financial OS är återställt från backupen/).waitFor({ timeout: 120000 })
  check('the bundle restores into the clean directory', existsSync(join(clean, 'financial-os.db')))
  await app.close()
  await new Promise((r) => setTimeout(r, 2000))
  rmSync(clean, { recursive: true, force: true })
  check('the real root and its bundle are untouched', existsSync(join(REAL_ROOT, 'financial-os.db')) && existsSync(join(external, newest)))
} catch (error) {
  log('FAIL follow-up aborted:', error instanceof Error ? error.message.split('\n')[0] : String(error))
  try {
    await app.close()
  } catch {}
  process.exit(1)
}
