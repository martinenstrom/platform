/**
 * How a conversation with JARVIS feels, in numbers: six representative
 * flows through the real HQ microphone, the person's recording as the
 * microphone for the spoken ones and the presence's own compose for the
 * typed ones, all in one live session.
 *
 *   A  a conceptual question (u02, duration arithmetic)
 *   B  an investment question that enters the firm (u01, Nvidia after CPI)
 *   C  an immediate spoken follow-up (u09, "ska jag köpa den nu…")
 *   D  a typed addition to the open case ("Ta hänsyn till dollarn också.")
 *   E  a typed request to close the case ("Stäng ner det pågående ärendet.")
 *   F  a typed follow-up ("Varför stängde vi det?")
 *
 * Per flow: person stops → first audible reply; → first reply that is not
 * a mere acknowledgement; acknowledgement-only turns spoken; JARVIS bubbles
 * shown; the model's handoff, the backend's span and the host call, from
 * the server's own timeline. Before and after are the same script.
 *
 *   node scripts/probe-jarvis-flow.mjs [label]        (dev server on :5173, make-wav.mjs run)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.PROBE_BASE ?? 'http://localhost:5173'
const label = process.argv[2] ?? 'run'
const AUDIO = join(process.cwd(), 'scripts', 'voice-live', 'audio')
const OUT = join(process.cwd(), '.probe')
mkdirSync(OUT, { recursive: true })
const conversation = JSON.parse(readFileSync(join(AUDIO, 'c9-flow.json'), 'utf8'))
const wav = join(AUDIO, 'c9-flow.wav')
if (!existsSync(wav)) {
  console.error('run scripts/voice-live/make-wav.mjs first')
  process.exit(2)
}
const TYPED = [
  ['D', 'Ta hänsyn till dollarn också.'],
  ['E', 'Stäng ner det pågående ärendet.'],
  ['F', 'Varför stängde vi det?'],
]
const ACK_WORDS = 'ett ögonblick|en sekund|jag kollar|jag ser på det|jag tittar|jag tar med det|mm+|hmm+|okej|ja'
/* A reply that is nothing but an acknowledgement. */
const ACK = new RegExp(`^\\s*(${ACK_WORDS})[.!…\\s]*$`, 'i')
/* An acknowledgement that opens a longer reply. */
const ACK_PREFIX = new RegExp(`^\\s*(${ACK_WORDS})[.!…,—-]+\\s+\\S`, 'i')

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required'],
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

await page.goto(`${base}/`, { waitUntil: 'networkidle' })
await page.click('aside[aria-label="JARVIS"] button[aria-label="Starta röst"]')
await page.waitForFunction(() => /Lyssnar|Talar|Tänker/.test(document.querySelector('aside[aria-label="JARVIS"] button[data-voice]')?.textContent ?? ''), null, { timeout: 30_000 })
const bubblesBefore = []
await page.waitForTimeout(conversation.seconds * 1000 + 4000)
bubblesBefore.push((await turns()).length)

/* What the presence says about the session, for when a flow cannot run. */
const notice = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="status"]')].map((n) => n.textContent?.trim()).filter(Boolean).join(' | '),
  )
const micWord = () =>
  page.evaluate(() => document.querySelector('aside[aria-label="JARVIS"] button[data-voice]')?.textContent?.trim() ?? '(no mic button)')
console.log(`after the spoken flows: mic "${await micWord()}" · notice "${await notice()}" · browser errors ${errors.length}`)

for (const [flow, text] of TYPED) {
  const before = (await turns()).length
  const live = await page.$('aside[aria-label="JARVIS"] button[aria-label="Skicka in i samtalet"]')
  if (!live) {
    console.log(`typed ${flow}: the session is not live — mic "${await micWord()}" · notice "${await notice()}"; the typed flows stop here`)
    break
  }
  await page.fill('aside[aria-label="JARVIS"] textarea', text)
  await live.click()
  await page.waitForTimeout(14_000)
  bubblesBefore.push(before)
  console.log(`typed ${flow}: ${text}`)
}

const allTurns = await turns()
const state = await page.evaluate(async () => {
  const mod = await import('/src/infrastructure/jarvis/serverFns.ts')
  const all = await mod.liveTelemetryFn()
  if (!all.ok) return null
  const last = all.sessions[all.sessions.length - 1]
  /* Event names that say how a session ended, if it did: closes and errors, counted. */
  const ended = Object.fromEntries(Object.entries(last.eventCounts).filter(([name]) => /closed|error|failed/i.test(name)))
  return {
    turns: last.turns,
    tools: last.toolCallsByName,
    ackWithoutReference: last.ackWithoutReference,
    voiceSeconds: last.voiceSeconds,
    cost: +(last.voiceCostUsd + last.backend.costUsd).toFixed(4),
    reason: last.reason ?? null,
    closedByPolicy: last.closedByPolicy,
    ended,
  }
})
const stop = await page.$('aside[aria-label="JARVIS"] button[aria-label="Avsluta röst"]')
if (stop) await stop.click()
await page.waitForTimeout(2000)
await browser.close()

/* ------------------------------------------------------------- analysis */

/*
 * Group the visible conversation into exchanges: what the person said until
 * JARVIS replied, and the replies. A pause inside one utterance shows as two
 * user bubbles; they are one exchange, as they are one turn on the server.
 */
const responses = []
for (const t of allTurns) {
  const open = responses[responses.length - 1]
  if (t.by === 'user') {
    if (open && open.jarvis.length === 0 && open.voice === t.voice) open.user = `${open.user} ${t.text}`
    else responses.push({ user: t.text, voice: t.voice, jarvis: [] })
  } else open?.jarvis.push(t.text)
}
const flows = ['A', 'B', 'C', 'D', 'E', 'F']
const rows = responses.map((r, i) => {
  const timing = state?.turns[i] ?? null
  /*
   * The presence shows one bubble per reply, so an acknowledgement is the
   * reply's opening words rather than a bubble of its own. The server keeps
   * where each spoken reply began; pairing the two says when the person
   * heard something and when they heard the answer.
   */
  const text = r.jarvis.join(' ')
  const ackOnly = ACK.test(text)
  const ackFirst = !ackOnly && ACK_PREFIX.test(text)
  const starts = timing?.speechStartsMs ?? []
  const firstAnswer = ackOnly ? null : ackFirst ? (starts[1] ?? null) : (starts[0] ?? null)
  return {
    flow: flows[i] ?? `#${i + 1}`,
    user: r.user,
    via: r.voice ? 'spoken' : 'typed',
    replies: starts.length,
    ackOnly,
    ackFirst,
    firstSpeechMs: timing && timing.firstSpeechMs !== null ? timing.firstSpeechMs - timing.userEndMs : null,
    firstAnswerMs: timing && firstAnswer !== null ? firstAnswer - timing.userEndMs : null,
    handoffMs: timing && timing.delegationMs !== null ? timing.delegationMs - timing.userEndMs : null,
    backendSpanMs: timing && timing.backendStartMs !== null && timing.backendEndMs !== null ? timing.backendEndMs - timing.backendStartMs : null,
    hostMs: timing?.hostDurationMs ?? null,
    jarvis: r.jarvis,
  }
})


console.log(`\n${label} · session ${state?.voiceSeconds ?? '?'} s · $${state?.cost ?? '?'} · tools ${JSON.stringify(state?.tools ?? {})} · ack-without-reference ${state?.ackWithoutReference ?? '?'} · closed ${state?.reason ?? 'no'}${state?.closedByPolicy ? ' (policy)' : ''} · ${JSON.stringify(state?.ended ?? {})}`)
console.log('| Flow | Via | First speech | First answer | Handoff | Backend span | Host | Replies | Ack first |')
for (const r of rows) console.log(`| ${r.flow} | ${r.via} | ${r.firstSpeechMs ?? '–'} | ${r.firstAnswerMs ?? '–'} | ${r.handoffMs ?? '–'} | ${r.backendSpanMs ?? '–'} | ${r.hostMs ?? '–'} | ${r.replies} | ${r.ackOnly ? 'only' : r.ackFirst ? 'yes' : 'no'} |`)
for (const r of rows) {
  console.log(`\n${r.flow} (${r.via}) ${r.user}`)
  for (const j of r.jarvis) console.log(`    JARVIS: ${j}`)
}
console.log('\nbrowser errors:', errors.length ? errors : 'none')
const file = join(OUT, `flow-${label}.json`)
writeFileSync(file, JSON.stringify({ label, at: new Date().toISOString(), rows, state, errors }, null, 2))
console.log('result:', file)
