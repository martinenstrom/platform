/**
 * Live probe of the contextual surfaces (slice F), through a real browser.
 *
 * Component tests prove the surfaces open the canonical pages; this proves
 * the product does it over a real HQ with a real case: the Boardroom and
 * the record open beside the engaged presence, the page beneath stays put,
 * closing returns to it, the conversation survives, and the canonical routes
 * still render on their own. Screenshots, because a composition is judged
 * by looking at it.
 *
 * Nothing is manufactured. The case is one the firm already holds, found
 * through `getCaseListFn`; the conversation is seeded into the presence
 * store as the product itself would store it — a pointer and some turns —
 * because the dev server has no operator and `ask` cannot bind a case.
 *
 *   node scripts/probe-jarvis-surfaces.mjs            (dev server on :5173)
 *   PROBE_OUT=path/to/dir node scripts/probe-jarvis-surfaces.mjs
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.PROBE_BASE ?? 'http://localhost:5173'
const out = process.env.PROBE_OUT ?? join(process.cwd(), '.probe')
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (error) => {
  errors.push(error.message)
  console.error('[browser error]', error.message)
})
page.on('console', (message) => {
  if (message.type() === 'error') console.error('[console]', message.text().slice(0, 300))
})

const shot = async (name) => {
  const file = join(out, `${name}.png`)
  await page.screenshot({ path: file })
  console.log('screenshot:', file)
}
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) process.exitCode = 1
}

/* ------------------------------------------------- a case the firm holds */

await page.goto(`${base}/`, { waitUntil: 'networkidle' })
const seed = await page.evaluate(async () => {
  const mod = await import('/src/infrastructure/analysis/serverFns.ts')
  const list = await mod.getCaseListFn()
  if (!list.ok || list.cases.length === 0) return null
  const entry = list.cases[0]
  const reference = {
    system: 'financial-os',
    kind: 'case',
    id: entry.investmentCase.id,
    provenanceId: 'as-remembered',
  }
  const turn = (by, text, over = {}) => ({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    by,
    text,
    ...over,
  })
  /* The case's subject is a typed reference; the presence stores the name JARVIS would say. */
  const subject = entry.investmentCase.subject
  window.sessionStorage.setItem(
    'jarvis:presence',
    JSON.stringify({
      open: true,
      reference,
      subject: typeof subject === 'string' ? subject : (subject?.displayName ?? 'Ärende'),
      question: entry.investmentCase.question,
      turns: [
        turn('user', entry.investmentCase.question),
        turn('jarvis', 'Jag kollar på det.', { state: 'working' }),
      ],
      surface: null,
    }),
  )
  return { id: reference.id, question: entry.investmentCase.question }
})
if (!seed) {
  console.error('The dev firm holds no case; nothing to open.')
  process.exit(2)
}
console.log('case:', JSON.stringify(seed))

await page.reload({ waitUntil: 'networkidle' })
const reloaded = await page.evaluate(() => ({
  aside: Boolean(document.querySelector('aside[aria-label="JARVIS"]')),
  textarea: Boolean(document.querySelector('aside[aria-label="JARVIS"] textarea')),
  session: window.sessionStorage.getItem('jarvis:presence')?.slice(0, 120) ?? null,
}))
console.log('after reload:', JSON.stringify(reloaded))
await shot('surfaces-hq-reloaded')
await page.waitForSelector('aside[aria-label="JARVIS"] textarea')
await shot('surfaces-hq-engaged')

/* ------------------------------------------------------- the Boardroom */

await page.click('button:has-text("Visa hur ni kom fram till det")')
const room = page.getByRole('region', { name: 'Styrelserummet' })
await room.waitFor({ state: 'visible' })
await room.getByRole('heading', { level: 1 }).first().waitFor({ state: 'attached', timeout: 60_000 })
await page.waitForLoadState('networkidle')
const boardroom = await page.evaluate(() => {
  const region = document.querySelector('section[aria-label="Styrelserummet"]')
  const rect = region.getBoundingClientRect()
  const aside = document.querySelector('aside[aria-label="JARVIS"]').getBoundingClientRect()
  return {
    left: Math.round(rect.left),
    width: Math.round(rect.width),
    asideWidth: Math.round(aside.width),
    heading: region.querySelector('h1')?.textContent ?? null,
    canonical: region.querySelector('a[href^="/cases/"]')?.getAttribute('href') ?? null,
    committee: Boolean(region.querySelector('[aria-label="Investeringskommitténs bord"]')),
    hqHeadingBeneath: document.querySelector('main h1')?.textContent ?? null,
    path: location.pathname,
    turns: document.querySelectorAll('ol[aria-label="Samtal"] li[data-by]').length,
  }
})
console.log('boardroom:', JSON.stringify(boardroom))
await shot('surfaces-boardroom')
check('Boardroom stands to the right of the engaged presence', boardroom.left === 306 && boardroom.asideWidth === 306)
check('Boardroom is the canonical room (committee table present)', boardroom.committee)
check('Boardroom heading is the case question', boardroom.heading === seed.question)
check('Boardroom offers the canonical page', boardroom.canonical === `/cases/${seed.id}`)
check('HQ beneath is untouched (still /, still its own heading)', boardroom.path === '/' && boardroom.hqHeadingBeneath !== null)
check('conversation intact while the room is open', boardroom.turns === 2)

/* ------------------------------------------------ Escape closes it only */

await page.keyboard.press('Escape')
const afterEscape = await page.evaluate(() => ({
  room: Boolean(document.querySelector('section[aria-label="Styrelserummet"]')),
  panelOpen: Boolean(document.querySelector('aside[aria-label="JARVIS"] textarea')),
  turns: document.querySelectorAll('ol[aria-label="Samtal"] li[data-by]').length,
  path: location.pathname,
  session: JSON.parse(window.sessionStorage.getItem('jarvis:presence')).surface,
}))
console.log('after Escape:', JSON.stringify(afterEscape))
check('Escape closes the room and only the room', !afterEscape.room && afterEscape.panelOpen)
check('closing returns to the same HQ with the conversation', afterEscape.path === '/' && afterEscape.turns === 2 && afterEscape.session === null)
await shot('surfaces-closed')

/* ---------------------------------------------------------- the record */

await page.click('button:has-text("Visa underlaget")')
const record = page.getByRole('region', { name: 'Underlaget' })
await record.waitFor({ state: 'visible' })
await record
  .getByRole('heading', { name: 'Underlag', exact: true })
  .waitFor({ state: 'attached', timeout: 60_000 })
await page.waitForLoadState('networkidle')
const underlag = await page.evaluate(() => {
  const region = document.querySelector('section[aria-label="Underlaget"]')
  return {
    left: Math.round(region.getBoundingClientRect().left),
    headings: [...region.querySelectorAll('h2')].map((h) => h.textContent).slice(0, 6),
    canonical: region.querySelector('a[href$="/underlag"]')?.getAttribute('href') ?? null,
    path: location.pathname,
  }
})
console.log('underlag:', JSON.stringify(underlag))
await shot('surfaces-underlag')
check('record stands beside the presence', underlag.left === 306)
check('record is the canonical record (its own sections)', underlag.headings.some((h) => /Beslutsunderlagets status/.test(h)))
check('record offers the canonical page', underlag.canonical === `/cases/${seed.id}/underlag`)
await page.click('button[aria-label="Stäng underlaget"]')

/* ------------------------------------- the surface survives navigation */

await page.click('button:has-text("Visa hur ni kom fram till det")')
await page.getByRole('region', { name: 'Styrelserummet' }).waitFor({ state: 'visible' })
await page.click('nav[aria-label="Genvägar"] a[href="/headquarters"]')
await page.waitForURL(`${base}/headquarters`)
await page.locator('main h1', { hasText: 'Huvudkontor' }).waitFor({ state: 'attached', timeout: 60_000 })
const navigated = await page.evaluate(() => ({
  room: Boolean(document.querySelector('section[aria-label="Styrelserummet"]')),
  path: location.pathname,
  turns: document.querySelectorAll('ol[aria-label="Samtal"] li[data-by]').length,
}))
console.log('after navigation:', JSON.stringify(navigated))
check('the room stays open across a navigation beneath it', navigated.room && navigated.path === '/headquarters' && navigated.turns === 2)
await shot('surfaces-headquarters')

/* --------------------------------------- the canonical routes still work */

for (const [path, expectH1] of [
  [`/cases/${seed.id}`, seed.question],
  [`/cases/${seed.id}/underlag`, 'Underlag'],
]) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
  const h1 = await page.locator('main h1').first().textContent()
  check(`canonical ${path} renders`, h1 === expectH1)
}

console.log('browser errors:', errors.length === 0 ? 'none' : errors)
check('no browser errors', errors.length === 0)
await browser.close()
