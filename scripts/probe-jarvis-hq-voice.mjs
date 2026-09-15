/**
 * The HQ microphone, pressed by a browser with the person's voice.
 *
 * Not the bench and not a proof page: the real landing page, the real
 * presence, the microphone that is on screen, the door behind it. Headless
 * Chromium plays a composed conversation from the person's own recordings as
 * its microphone, presses "Starta röst", and what follows is read off the
 * presence itself — the button's state word, the turns in the one
 * conversation, the case the firm bound, the cost line — and then the
 * button is pressed again and the session must be closed on the server.
 *
 *   node scripts/probe-jarvis-hq-voice.mjs                      (dev server on :5173)
 *   node scripts/probe-jarvis-hq-voice.mjs c1-nvidia-cpi
 *   PROBE_TYPED="Men vad är största risken?" node scripts/probe-jarvis-hq-voice.mjs c6-direct
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.PROBE_BASE ?? 'http://localhost:5173'
const AUDIO = join(process.cwd(), 'scripts', 'voice-live', 'audio')
const OUT = join(process.cwd(), '.probe')
mkdirSync(OUT, { recursive: true })
const conversationName = process.argv[2] ?? 'c1-nvidia-cpi'
const conversation = JSON.parse(readFileSync(join(AUDIO, `${conversationName}.json`), 'utf8'))
const wav = join(AUDIO, `${conversationName}.wav`)
if (!existsSync(wav)) {
  console.error(`no ${wav}; run scripts/voice-live/make-wav.mjs`)
  process.exit(2)
}

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) process.exitCode = 1
}
const shot = async (name) => {
  const file = join(OUT, `${name}.png`)
  await page.screenshot({ path: file })
  console.log('screenshot:', file)
}
const micWord = () => page.evaluate(() => document.querySelector('aside[aria-label="JARVIS"] button[data-voice]')?.textContent?.trim() ?? null)
const turns = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('ol[aria-label="Samtal"] li[data-by]')].map((li) => ({
      by: li.getAttribute('data-by'),
      voice: Boolean(li.querySelector('[aria-label="sagt"]')),
      text: li.querySelector('p')?.textContent?.replace(/röst$/, '').trim() ?? '',
    })),
  )

/* ------------------------------------------------------------- HQ */

await page.goto(`${base}/`, { waitUntil: 'networkidle' })
const strip = await page.evaluate(() => ({
  heading: document.querySelector('h1')?.textContent ?? null,
  mic: document.querySelector('aside[aria-label="JARVIS"] button[aria-label="Starta röst"]')?.textContent?.trim() ?? null,
  placeholder: document.body.innerText.includes('Röst kommer'),
}))
console.log('HQ:', JSON.stringify(strip))
check('the real HQ shows the microphone, off, and no placeholder', strip.mic === 'Röst' && !strip.placeholder)

/* ---------------------------------------------------- press the mic */

const pressed = Date.now()
await page.click('aside[aria-label="JARVIS"] button[aria-label="Starta röst"]')
await page.waitForSelector('aside[aria-label="JARVIS"] textarea')
const connecting = await micWord()
await page.waitForFunction(() => /Lyssnar|Talar|Tänker/.test(document.querySelector('aside[aria-label="JARVIS"] button[data-voice]')?.textContent ?? ''), null, { timeout: 30_000 })
const liveAfterMs = Date.now() - pressed
console.log(`mic: "${connecting}" → "${await micWord()}" after ${liveAfterMs} ms`)
check('pressing the microphone opened the panel and a live session', /Lyssnar|Talar|Tänker/.test((await micWord()) ?? ''))
await shot('hq-voice-live')

/* -------------------------------------- the conversation, as spoken */

await page.waitForTimeout(conversation.seconds * 1000 + 5000)
let spoken = await turns()
console.log('turns:')
for (const t of spoken) console.log(`  ${t.by.padEnd(6)} ${t.voice ? 'röst ' : 'text '} ${t.text}`)
check('what was said landed in the one conversation, marked as spoken', spoken.some((t) => t.by === 'user' && t.voice) && spoken.some((t) => t.by === 'jarvis' && t.voice))
check('no promise of delegated work was spoken', !spoken.some((t) => t.by === 'jarvis' && /kollar på det och återkommer/i.test(t.text)))
const activeCase = await page.evaluate(() => document.querySelector('section[aria-label="Aktivt ärende"]')?.textContent ?? null)
console.log('active case:', activeCase)
const costLine = await page.evaluate(() => document.querySelector('p[aria-label="Röstsession"]')?.textContent ?? null)
console.log('cost line:', costLine)
check('the cost line is shown while live', costLine !== null && /Röst ·/.test(costLine))
await shot('hq-voice-spoken')

/* ------------------------------------------------- typed, while live */

if (process.env.PROBE_TYPED) {
  await page.fill('aside[aria-label="JARVIS"] textarea', process.env.PROBE_TYPED)
  await page.click('aside[aria-label="JARVIS"] button[aria-label="Skicka in i samtalet"]')
  await page.waitForTimeout(12_000)
  const after = await turns()
  const typedIndex = after.findIndex((t) => t.by === 'user' && !t.voice && t.text === process.env.PROBE_TYPED)
  const answered = typedIndex >= 0 && after.slice(typedIndex + 1).some((t) => t.by === 'jarvis' && t.voice)
  console.log('after typing:')
  for (const t of after.slice(typedIndex)) console.log(`  ${t.by.padEnd(6)} ${t.voice ? 'röst ' : 'text '} ${t.text}`)
  check('a typed line while live was answered aloud in the same conversation', answered)
  spoken = after
}

/* ----------------------------------------------- press it again: closed */

const sessionId = await page.evaluate(() => {
  const line = document.querySelector('p[aria-label="Röstsession"]')
  return line ? 'present' : null
})
await page.click('aside[aria-label="JARVIS"] button[aria-label="Avsluta röst"]')
await page.waitForSelector('aside[aria-label="JARVIS"] button[aria-label="Starta röst"]', { timeout: 10_000 })
const afterStop = await micWord()
console.log(`mic after stop: "${afterStop}"`)
check('pressing the active microphone returned it to off', afterStop === 'Röst')
/* The close is a round trip — the door, the sideband, the provider's confirmation — so give it a moment. */
let telemetry = null
for (let attempt = 0; attempt < 20; attempt++) {
  telemetry = await page.evaluate(async () => {
    const mod = await import('/src/infrastructure/jarvis/serverFns.ts')
    const all = await mod.liveTelemetryFn()
    if (!all.ok) return all
    const last = all.sessions[all.sessions.length - 1]
    return last ? { sessionId: last.sessionId, closedAt: last.closedAt, reason: last.reason, voiceSeconds: last.voiceSeconds, cost: +(last.voiceCostUsd + last.backend.costUsd).toFixed(4), tools: last.toolCallsByName, ackWithoutReference: last.ackWithoutReference } : null
  })
  if (telemetry?.closedAt) break
  await page.waitForTimeout(500)
}
console.log('server telemetry:', JSON.stringify(telemetry))
check('the server closed the session', Boolean(telemetry?.closedAt))
check('the invariant counter reads zero', telemetry?.ackWithoutReference === 0)
check('the conversation survived the session ending', (await turns()).length === spoken.length)

/* ----------------------------------------------- reload: nothing leaks */

await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('aside[aria-label="JARVIS"]')
const reloaded = await page.evaluate(() => ({
  mic: document.querySelector('aside[aria-label="JARVIS"] button[data-voice]')?.textContent?.trim() ?? null,
  turns: document.querySelectorAll('ol[aria-label="Samtal"] li[data-by]').length,
  panelOpen: Boolean(document.querySelector('aside[aria-label="JARVIS"] textarea')),
}))
console.log('after reload:', JSON.stringify(reloaded))
check('after a reload the microphone is off and the conversation is still there', reloaded.mic === 'Röst' && reloaded.turns === spoken.length)
const sessionsOpen = await page.evaluate(async () => {
  const mod = await import('/src/infrastructure/jarvis/serverFns.ts')
  const all = await mod.liveTelemetryFn()
  return all.ok ? all.sessions.filter((s) => !s.closedAt).length : null
})
check('no session is left open on the server', sessionsOpen === 0)
await shot('hq-voice-reloaded')

console.log('browser errors:', errors.length ? errors : 'none')
check('no browser errors', errors.length === 0)
writeFileSync(join(OUT, `hq-voice-${conversationName}.json`), JSON.stringify({ conversationName, liveAfterMs, turns: spoken, activeCase, costLine, telemetry, reloaded, errors }, null, 2))
await browser.close()
