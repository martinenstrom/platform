/**
 * The production-readiness persistence audit, on the host as the person
 * lives it: a clean record; an office created and updated; a client with
 * its initial goal, meeting, event, concern, note and liability; a note
 * through the update flow that confirms a commitment, a meeting and a
 * concern; the relationship activated; a Meeting Pack generated where the
 * record carries one; the application closed completely and launched
 * again with every record verified; an encrypted backup; a clean data
 * directory restored from it and launched again with every record
 * verified once more; and JARVIS answering from the restored record. The
 * institution pages are read too, so what they say on the desktop is
 * measured rather than assumed.
 *
 * usage: node desktop\probe-audit.mjs [path-to-Financial OS.exe]
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
const out = join('.probe', 'audit')
mkdirSync(out, { recursive: true })
const PASSPHRASE = 'audit horse battery staple'

const CLIENT = 'Karin Exempel'
const OFFICE = 'Stureplan'
const OFFICE_DESCRIPTION = 'Kontoret för entreprenörer i city'
const GOAL = 'Pension vid 60 med bibehållen livsstil'
const FIRST_MEETING = '2026-11-05'
const EVENT_TITLE = 'Bolånet omsätts'
const EVENT_DATE = '2026-12-01'
const CONCERN = 'Orolig för koncentrationen i energi'
const NOTE = 'Första samtalet: vill samla familjens kapital hos oss.'
const UPDATE =
  'Träffade klienten i dag. Hon är orolig över energiallokeringen. Jag lovade att återkomma med en jämförelse av två placeringsalternativ. Nästa möte är bokat 3 december.'

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

let current = null
async function abort(error) {
  log('FAIL probe aborted:', error instanceof Error ? `${error.name}: ${error.message.split('\n')[0]}` : String(error))
  if (current?.errors?.length) log('page errors:', current.errors.join(' | ').slice(0, 800))
  try {
    await current?.page?.screenshot({ path: join(out, 'a0-failure.png') })
    log('failure url:', current?.page?.url())
    log('failure text:', (await text(current.page)).slice(0, 800))
  } catch {}
  try {
    await current?.app?.close()
  } catch {}
  process.exit(1)
}

/** Every record the probe wrote, read back from the surfaces, in one pass. */
async function verifyRecord(page, phase, clientUrl, officeUrl) {
  await page.goto(clientUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { level: 1, name: CLIENT }).waitFor({ timeout: 60000 })
  await settle(page)
  const dossier = await text(page)
  const expect = (what, pattern) => check(`${phase}: ${what}`, pattern.test(dossier))
  expect('client is active, not onboarding', /CLIENT 360(?! · ONBOARDING)/i)
  expect('office named on the dossier', new RegExp(OFFICE))
  expect('AUM 3,0 MSEK', /3,0 MSEK/)
  expect('liability 1,2 MSEK', /1,2 MSEK/)
  expect('goal', new RegExp(GOAL.slice(0, 16)))
  expect('first meeting 5 nov 2026', /5 nov 2026/)
  expect('important event', new RegExp(EVENT_TITLE))
  expect('initial concern', new RegExp(CONCERN.slice(0, 20)))
  expect('initial note in the timeline', /Inledande notering/)
  /* The original words stand inside a collapsed "Ursprunglig notering" disclosure, present in the DOM, outside the page text. */
  check(`${phase}: initial note text kept verbatim`, (await page.getByText(/samla familjens kapital/).count()) >= 1)
  expect('update note text', /orolig över energiallokeringen/)
  expect('commitment from the note', /jämförelse av två placeringsalternativ/)
  expect('meeting from the note, 3 dec 2026', /3 dec 2026/)
  expect('activation in the history', /PB-relation aktiverad/)
  await page.screenshot({ path: join(out, `${phase}-dossier.png`), fullPage: true })

  await page.goto(officeUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { level: 1, name: OFFICE }).waitFor({ timeout: 60000 })
  await settle(page)
  check(`${phase}: office book holds the client`, (await page.getByRole('link', { name: new RegExp(CLIENT) }).count()) >= 1)
  await page.getByRole('button', { name: 'Kontorsåtgärder' }).click()
  await page.getByRole('menuitem', { name: 'Redigera kontor' }).click()
  const description = await page.getByLabel(/^Beskrivning/).inputValue()
  check(`${phase}: office description kept`, description === OFFICE_DESCRIPTION, description)

  await page.goto(`${clientUrl}/meeting-pack`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1', { timeout: 60000 })
  await settle(page)
  const downloads = await page.getByRole('button', { name: /Ladda ner .*_v1\.pdf/ }).count()
  const versions = await page.getByRole('region', { name: 'Genererade versioner' }).innerText().catch(() => '')
  return { versions: `${downloads} download control(s) · ${versions.replace(/\s+/g, ' ').slice(0, 100)}`, downloads }
}

const first = mkdtempSync(join(tmpdir(), 'financial-os-audit-first-'))
let { app, page, errors } = await open(first)
current = { app, page, errors }
let clientUrl = ''
let officeUrl = ''
try {
  /* ---- A. a clean record ---- */
  check('A: fresh install opens on the first-run choice', (await h1(page)) === 'Ditt Financial OS', await h1(page))
  await page.getByRole('button', { name: 'Skapa nytt Financial OS' }).first().click()
  const createPanel = page.getByRole('region', { name: 'Skapa nytt Financial OS' })
  await createPanel.waitFor({ timeout: 30000 })
  await createPanel.getByRole('button', { name: 'Skapa nytt Financial OS' }).click()
  await page.waitForURL(/\/clients/, { timeout: 60000 })
  await page.getByRole('heading', { level: 1, name: 'Klienter' }).waitFor({ timeout: 60000 })
  check('A: clean database created, empty book', /Klienter\s*0\b/i.test(await page.getByRole('region', { name: 'Nyckeltal' }).innerText()))

  /* ---- C. an office, created then updated (a client needs one) ---- */
  await page.goto('app://financial-os/clients/office/new', { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/^Namn/).fill(OFFICE)
  await page.getByLabel(/^Ort/).fill('Stockholm')
  await page.getByRole('button', { name: 'Skapa kontor' }).click()
  await page.waitForURL(/\/clients\/office\/of-/, { timeout: 60000 })
  await settle(page)
  officeUrl = page.url()
  check('C: office created', (await h1(page)) === OFFICE, await h1(page))
  await page.getByRole('button', { name: 'Kontorsåtgärder' }).click()
  await page.getByRole('menuitem', { name: 'Redigera kontor' }).click()
  await page.getByLabel(/^Beskrivning/).fill(OFFICE_DESCRIPTION)
  await page.getByRole('button', { name: 'Spara kontor' }).click()
  await page.waitForTimeout(1200)
  await settle(page)
  await page.getByRole('button', { name: 'Kontorsåtgärder' }).click()
  await page.getByRole('menuitem', { name: 'Redigera kontor' }).click()
  check('C: office updated', (await page.getByLabel(/^Beskrivning/).inputValue()) === OFFICE_DESCRIPTION)

  /* ---- B. a client, with its initial goal, meeting, event, concern, note and liability ---- */
  await page.goto('app://financial-os/clients/new', { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/^Namn/).first().fill(CLIENT)
  await page.getByLabel(/^Kontor/).selectOption({ label: OFFICE })
  await page.getByLabel(/^AUM hos banken/).fill('3000000')
  await page.getByLabel(/^Skulder/).fill('1200000')
  await page.getByLabel(/^Ränta på skulden/).first().fill('3.5')
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
  check('B: client created with its initial context', /ONBOARDING/i.test(await text(page)), clientUrl)

  /* ---- D–G. a note through the update flow: commitment, meeting, concern ---- */
  await page.getByRole('button', { name: 'Lägg till klientuppdatering' }).first().click()
  const flow = page.getByRole('region', { name: 'Lägg till klientuppdatering' })
  await flow.waitFor({ timeout: 30000 })
  await flow.locator('#client-update-note').fill(UPDATE)
  await flow.getByRole('button', { name: 'Spara & analysera' }).click()
  await flow.getByRole('button', { name: 'Bekräfta alla' }).waitFor({ timeout: 60000 })
  const understood = await flow.innerText()
  check('D: JARVIS understood the note into items', /Åtagande|Löfte/i.test(understood) && /möte/i.test(understood), understood.replace(/\s+/g, ' ').slice(0, 200))
  await flow.getByRole('button', { name: 'Bekräfta alla' }).click()
  await flow.getByText('Uppdateringen är sparad i relationstidslinjen.').waitFor({ timeout: 60000 })
  const saved = await flow.innerText()
  check('E–G: facts, a commitment and a meeting confirmed', /[1-9]\d* fakta/.test(saved) && /[1-9]\d* åtaganden/.test(saved) && /[1-9]\d* händelser/.test(saved), saved.replace(/\s+/g, ' ').slice(0, 160))
  await flow.getByRole('button', { name: 'Stäng' }).last().click()
  await page.waitForTimeout(800)
  await settle(page)

  /* ---- H. lifecycle transition ---- */
  await page.goto(clientUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Aktivera PB-relation' }).first().click()
  const activate = page.getByRole('region', { name: 'Aktivera PB-relation' })
  await activate.waitFor({ timeout: 30000 })
  await activate.getByRole('button', { name: 'Aktivera PB-relation' }).click()
  await page.waitForTimeout(1000)
  await settle(page)
  check('H: relationship activated', !/CLIENT 360 · ONBOARDING/i.test(await text(page)))

  /* ---- I. a generated document, where the record carries one ---- */
  await page.goto(`${clientUrl}/meeting-pack`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1', { timeout: 60000 })
  await settle(page)
  const status = await page.getByRole('region', { name: 'Status' }).innerText().catch(() => '')
  const pdfButton = page.getByRole('button', { name: 'Generera PDF' })
  let generated = 'not attempted'
  if ((await pdfButton.count()) > 0 && (await pdfButton.isEnabled())) {
    await pdfButton.click()
    await page.getByRole('button', { name: /Ladda ner .*_v1\.pdf/ }).waitFor({ timeout: 120000 })
    generated = 'generated'
  } else {
    generated = `not generable: ${status.replace(/\s+/g, ' ').slice(0, 120)}`
  }
  check('I: Meeting Pack metadata created where the record allows', generated === 'generated', generated)
  await page.screenshot({ path: join(out, 'a1-meeting-pack.png') })
  check('no page errors before the close', pageErrors(errors).length === 0, pageErrors(errors).join(' | ').slice(0, 300))

  /* ---- J–L. closed completely, launched again, every record verified ---- */
  await app.close()
  await new Promise((r) => setTimeout(r, 1500))
  check('J: closed in order, no write-ahead log left', !existsSync(join(first, 'financial-os.db-wal')))
  ;({ app, page, errors } = await open(first))
  current = { app, page, errors }
  check('K: relaunch opens the book, not the first-run page', (await h1(page)) !== 'Ditt Financial OS', await h1(page))
  const afterRelaunch = await verifyRecord(page, 'L', clientUrl, officeUrl)
  check('L: Meeting Pack version listed after relaunch', generated !== 'generated' || afterRelaunch.downloads >= 1, afterRelaunch.versions)

  /* ---- the institution pages, as the desktop shows them ---- */
  await page.goto('app://financial-os/headquarters', { waitUntil: 'domcontentloaded' })
  await settle(page)
  const hq = await text(page)
  check('institution: Huvudkontoret says the analysis environment has no database', /Analysmiljön saknar databaskonfiguration/.test(hq), hq.slice(0, 160))
  await page.goto('app://financial-os/evidence', { waitUntil: 'domcontentloaded' })
  await settle(page)
  check('institution: Underlag says the same', /Analysmiljön saknar databaskonfiguration/.test(await text(page)))

  /* ---- M. an encrypted backup ---- */
  const external = mkdtempSync(join(tmpdir(), 'financial-os-audit-usb-'))
  await page.goto('app://financial-os/settings', { waitUntil: 'domcontentloaded' })
  await settle(page)
  const centre = page.getByRole('region', { name: 'Säkerhet & backup' })
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
  check('M: encrypted backup exported and verified', /öppnad och verifierad efter skrivning/.test(exportText), exportText.slice(0, 160))
  const bundles = readdirSync(external).filter((n) => n.endsWith('.financialos'))
  check('M: the bundle stands in the external folder', bundles.length === 1)
  await app.close()
  await new Promise((r) => setTimeout(r, 1500))

  /* ---- N–P. a clean machine, restored, verified ---- */
  const second = mkdtempSync(join(tmpdir(), 'financial-os-audit-second-'))
  ;({ app, page, errors } = await open(second))
  current = { app, page, errors }
  check('N: the clean data directory opens on the first-run choice', (await h1(page)) === 'Ditt Financial OS')
  await page.getByRole('button', { name: 'Återställ befintligt Financial OS' }).click()
  const restorePanel = page.getByRole('region', { name: 'Återställ från backup' })
  await restorePanel.waitFor({ timeout: 30000 })
  await restorePanel.getByLabel(/Backupfil/).fill(join(external, bundles[0]))
  await restorePanel.getByLabel(/^Lösenfras/).fill(PASSPHRASE)
  await restorePanel.getByRole('button', { name: 'Granska backup' }).click()
  await restorePanel.getByText('Backupens innehåll').waitFor({ timeout: 60000 })
  const review = await restorePanel.innerText()
  check('O: the bundle is reviewed first: 1 client, 1 office', /1 klient · 1 kontor/.test(review), review.replace(/\s+/g, ' ').slice(0, 160))
  await restorePanel.getByRole('checkbox').check()
  await restorePanel.getByRole('button', { name: 'Återställ' }).click()
  await page.getByText(/Financial OS är återställt från backupen/).waitFor({ timeout: 120000 })
  check('O: restore completed with its summary', true)
  await app.close()
  await new Promise((r) => setTimeout(r, 1500))
  ;({ app, page, errors } = await open(second))
  current = { app, page, errors }
  const afterRestore = await verifyRecord(page, 'P', clientUrl, officeUrl)
  check('P: Meeting Pack version listed after restore', generated !== 'generated' || afterRestore.downloads >= 1, afterRestore.versions)

  /* ---- Q. JARVIS answers from the restored record ---- */
  await page.goto(clientUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { level: 1, name: CLIENT }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'Öppna JARVIS' }).click()
  const ask = page.getByRole('textbox', { name: 'Fråga', exact: true })
  await ask.fill('Vad har jag lovat?')
  await page.getByRole('button', { name: 'Ställ frågan' }).click()
  const talk = page.getByRole('list', { name: 'Samtal' })
  await talk.getByText('Du lovade').first().waitFor({ timeout: 60000 })
  const promised = await talk.innerText()
  check('Q: JARVIS lists the restored commitment', /jämförelse av två placeringsalternativ/.test(promised), promised.replace(/\s+/g, ' ').slice(0, 200))
  await ask.fill('När ses vi?')
  await page.getByRole('button', { name: 'Ställ frågan' }).click()
  await talk.getByText(/Nästa möte/).first().waitFor({ timeout: 60000 })
  check('Q: JARVIS names the restored next meeting', /5 nov 2026|den 5 november/.test(await talk.innerText()))
  await page.goto('app://financial-os/clients', { waitUntil: 'domcontentloaded' })
  await settle(page)
  await ask.fill('Vilka nya klienter har jag?')
  await page.getByRole('button', { name: 'Ställ frågan' }).click()
  await talk.getByText('Nya klienter').first().waitFor({ timeout: 60000 })
  check('Q: JARVIS answers the book from the restored lifecycle feed', new RegExp(CLIENT).test(await talk.innerText()))
  await page.screenshot({ path: join(out, 'a2-jarvis-after-restore.png') })
  check('no page errors after restore', pageErrors(errors).length === 0, pageErrors(errors).join(' | ').slice(0, 300))
  await app.close()
  await new Promise((r) => setTimeout(r, 1500))
  for (const dir of [first, second, external]) rmSync(dir, { recursive: true, force: true })
} catch (error) {
  await abort(error)
}
log(`\n${findings.filter((f) => f.ok).length}/${findings.length} checks passed`)
