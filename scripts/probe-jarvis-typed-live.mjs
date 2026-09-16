/**
 * Typed lines into a live session, and nothing spoken: does the voice answer
 * what the person types while the microphone is on?
 *
 * The flow probe (`probe-jarvis-flow.mjs`) found three typed lines answered
 * by silence after the open-case acts were wired — no handoff, no speech, no
 * tool call — where the run before them had spoken (false) answers. This
 * isolates the typed path: a silent microphone, four typed lines that
 * should bind a case, add to it, close it and ask why, and the server's own
 * event counts afterwards.
 *
 *   node scripts/probe-jarvis-typed-live.mjs [label]     (dev server on :5173)
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.PROBE_BASE ?? 'http://localhost:5173'
const label = process.argv[2] ?? 'typed'
const OUT = join(process.cwd(), '.probe')
mkdirSync(OUT, { recursive: true })
const WAIT_MS = Number(process.env.PROBE_WAIT_MS ?? 16_000)

/* A silent microphone: 24 kHz mono 16-bit PCM, two minutes of zeros. */
const silence = join(OUT, 'silence-120s.wav')
{
  const rate = 24_000
  const seconds = 120
  const data = Buffer.alloc(rate * seconds * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  writeFileSync(silence, Buffer.concat([header, data]))
}

const TYPED = [
  ['T1', 'Hur ser du på Nvidia efter senaste CPI-siffran?'],
  ['T2', 'Ta hänsyn till dollarn också.'],
  ['T3', 'Stäng ner det pågående ärendet.'],
  ['T4', 'Varför stängde vi det?'],
]

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${silence}%noloop`, '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const turns = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('ol[aria-label="Samtal"] li[data-by]')].map((li) => ({
      by: li.getAttribute('data-by'),
      voice: Boolean(li.querySelector('[aria-label="sagt"]')),
      text: li.querySelector('p')?.textContent?.replace(/röst$/, '').trim() ?? '',
    })),
  )
const micWord = () =>
  page.evaluate(() => document.querySelector('aside[aria-label="JARVIS"] button[data-voice]')?.textContent?.trim() ?? '(no mic button)')
const notice = () =>
  page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((n) => n.textContent?.trim()).filter(Boolean).join(' | '))
const telemetry = () =>
  page.evaluate(async () => {
    const mod = await import('/src/infrastructure/jarvis/serverFns.ts')
    const all = await mod.liveTelemetryFn()
    if (!all.ok) return null
    const last = all.sessions[all.sessions.length - 1]
    return {
      turns: last.turns,
      tools: last.toolCallsByName,
      typedInjections: last.typedInjections,
      delegationsCreated: last.delegationsCreated,
      eventCounts: last.eventCounts,
      reason: last.reason ?? null,
      voiceSeconds: last.voiceSeconds,
      cost: +(last.voiceCostUsd + last.backend.costUsd).toFixed(4),
    }
  })

await page.goto(`${base}/`, { waitUntil: 'networkidle' })
await page.click('aside[aria-label="JARVIS"] button[aria-label="Starta röst"]')
await page.waitForFunction(() => /Lyssnar|Talar|Tänker/.test(document.querySelector('aside[aria-label="JARVIS"] button[data-voice]')?.textContent ?? ''), null, { timeout: 30_000 })
await page.waitForTimeout(3000)
console.log(`live: mic "${await micWord()}"`)

const results = []
for (const [flow, text] of TYPED) {
  const before = (await turns()).length
  const live = await page.$('aside[aria-label="JARVIS"] button[aria-label="Skicka in i samtalet"]')
  if (!live) {
    console.log(`${flow}: the session is not live — mic "${await micWord()}" · notice "${await notice()}"`)
    break
  }
  await page.fill('aside[aria-label="JARVIS"] textarea', text)
  await live.click()
  const sentAt = Date.now()
  /* Wait for a JARVIS bubble, up to WAIT_MS, and note when it came. */
  let repliedAfterMs = null
  while (Date.now() - sentAt < WAIT_MS) {
    const now = await turns()
    if (now.length > before + 1 && now[now.length - 1].by === 'jarvis') {
      repliedAfterMs = Date.now() - sentAt
      break
    }
    await page.waitForTimeout(500)
  }
  /* Let a reply finish. */
  await page.waitForTimeout(repliedAfterMs === null ? 0 : 6000)
  const after = await turns()
  const replies = after.slice(before + 1).filter((t) => t.by === 'jarvis').map((t) => t.text)
  const t = await telemetry()
  results.push({ flow, text, repliedAfterMs, replies, tools: t?.tools ?? null, delegations: t?.delegationsCreated ?? null, mic: await micWord(), notice: await notice() })
  console.log(`${flow} "${text}" → ${repliedAfterMs === null ? `no reply in ${WAIT_MS} ms` : `reply after ${repliedAfterMs} ms`} · tools ${JSON.stringify(t?.tools ?? {})} · delegations ${t?.delegationsCreated ?? '?'} · mic "${await micWord()}"`)
  for (const r of replies) console.log(`    JARVIS: ${r}`)
}

const state = await telemetry()
const stop = await page.$('aside[aria-label="JARVIS"] button[aria-label="Avsluta röst"]')
if (stop) await stop.click()
await page.waitForTimeout(2000)
await browser.close()

console.log(`\n${label} · session ${state?.voiceSeconds ?? '?'} s · $${state?.cost ?? '?'} · typed ${state?.typedInjections ?? '?'} · delegations ${state?.delegationsCreated ?? '?'} · tools ${JSON.stringify(state?.tools ?? {})} · closed ${state?.reason ?? 'no'}`)
console.log('events:', JSON.stringify(state?.eventCounts ?? {}))
console.log('browser errors:', errors.length ? errors : 'none')
const file = join(OUT, `typed-${label}.json`)
writeFileSync(file, JSON.stringify({ label, at: new Date().toISOString(), results, state, errors }, null, 2))
console.log('result:', file)
