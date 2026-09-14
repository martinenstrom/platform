/**
 * Live probe of the JARVIS presence, through a real browser.
 *
 * Component tests prove the presence; this proves the product mounts it, that
 * it stands where the rail stood, that it asks the firm through the one door
 * and repeats the firm's answer, and that it survives a navigation. It also
 * takes screenshots, because a composition is judged by looking at it.
 *
 *   node scripts/probe-jarvis-presence.mjs            (dev server on :5173)
 *   PROBE_OUT=path/to/dir node scripts/probe-jarvis-presence.mjs
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.PROBE_BASE ?? 'http://localhost:5173'
const out = process.env.PROBE_OUT ?? join(process.cwd(), '.probe')
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('pageerror', (error) => console.error('[browser error]', error.message))
const rpc = []
page.on('request', (request) => {
  if (request.url().includes('_serverFn')) rpc.push(request.url().replace(base, ''))
})

const shot = async (name) => {
  const file = join(out, `${name}.png`)
  await page.screenshot({ path: file })
  console.log('screenshot:', file)
}

/* ------------------------------------------------------------- at rest */

await page.goto(`${base}/`, { waitUntil: 'networkidle' })
const rest = await page.evaluate(() => {
  const aside = document.querySelector('aside[aria-label="JARVIS"]')
  const rect = aside?.getBoundingClientRect()
  return {
    mounted: Boolean(aside),
    width: rect ? Math.round(rect.width) : null,
    left: rect ? Math.round(rect.left) : null,
    openButton: Boolean(aside?.querySelector('button[aria-label="Öppna JARVIS"]')),
    mic: aside?.querySelector('[role="img"]')?.getAttribute('aria-label') ?? null,
    railLinks: [...document.querySelectorAll('aside nav a')].map((a) =>
      a.textContent.trim(),
    ),
    greeting: document.querySelector('h1')?.textContent ?? null,
  }
})
console.log('at rest:', JSON.stringify(rest))
await shot('hq-jarvis-rest')

/* ------------------------------------------------------------- engaged */

await page.click('button[aria-label="Öppna JARVIS"]')
await page.waitForSelector('textarea')
await shot('hq-jarvis-open')
await page.fill('textarea', 'Är Nvidia köpvärd på 12–24 månaders sikt?')
await page.fill('input[placeholder="Nvidia"]', 'Nvidia')
await page.click('button[aria-label="Ställ frågan"]')
await page.waitForFunction(
  () =>
    document.querySelectorAll('ol[aria-label="Samtal"] li[data-by="jarvis"]').length > 0,
  null,
  { timeout: 60_000 },
)
const engaged = await page.evaluate(() => {
  const aside = document.querySelector('aside[aria-label="JARVIS"]')
  const turns = [...document.querySelectorAll('ol[aria-label="Samtal"] li[data-by]')].map(
    (li) => ({
      by: li.getAttribute('data-by'),
      state: li.getAttribute('data-state'),
      text: li.querySelector('p')?.textContent,
    }),
  )
  return {
    width: Math.round(aside.getBoundingClientRect().width),
    operator: aside.querySelector('header p.type-metadata')?.textContent ?? null,
    turns,
    session: window.sessionStorage.getItem('jarvis:presence')?.slice(0, 160) ?? null,
  }
})
console.log('engaged:', JSON.stringify(engaged, null, 2))
await shot('hq-jarvis-asked')

/* ---------------------------------------------------- across navigation */

await page.click('nav[aria-label="Genvägar"] a[href="/headquarters"]')
await page.waitForURL(`${base}/headquarters`)
/*
 * The URL moves before the loader lands; a screenshot taken then shows the
 * previous page shifted by the reserved strip. Wait for the floor itself.
 */
await page
  .locator('h1', { hasText: 'Huvudkontor' })
  .waitFor({ state: 'attached', timeout: 60_000 })
await page.waitForLoadState('networkidle')
const after = await page.evaluate(() => ({
  path: location.pathname,
  presenceOpen: Boolean(document.querySelector('aside[aria-label="JARVIS"] textarea')),
  turns: document.querySelectorAll('ol[aria-label="Samtal"] li[data-by]').length,
}))
console.log('after navigation:', JSON.stringify(after))
await shot('hq-jarvis-headquarters')

console.log('server function calls from the presence:', rpc.length)
await browser.close()
