/**
 * Live probe of the product's own live-voice door, through a real browser.
 *
 * The proof server had a stub behind its tools. This talks to the product:
 * a headless Chromium on the dev server's origin, the person's recorded
 * Swedish as its microphone, WebRTC negotiated through `openLiveSessionFn`
 * — the production RPC path — and every delegation the voice makes executed
 * by the product's session runtime through the real host gateway. What
 * comes back is the firm's answer, or its honest refusal.
 *
 * In a dev environment with no operator configured, the firm refuses the ask
 * (`operator-unresolved`) and JARVIS must say so without promising a
 * return. With FINANCIAL_OS_OPERATOR_EMPLOYEE_ID set for the dev server, the
 * ask opens a real case and the firm answers `needs-decision` (TD-88), which
 * JARVIS must relay as a decision, not as work under way. Both are measured
 * against the same invariant counter.
 *
 *   node scripts/probe-jarvis-live.mjs                     (dev server on :5173)
 *   node scripts/probe-jarvis-live.mjs c6-direct marin
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.PROBE_BASE ?? 'http://localhost:5173'
const AUDIO = join(process.cwd(), 'scripts', 'voice-live', 'audio')
const OUT = join(process.cwd(), 'scripts', 'voice-live', 'results')
mkdirSync(OUT, { recursive: true })
const [, , conversationName = 'c1-nvidia-cpi', voice = 'marin'] = process.argv
const conversation = JSON.parse(readFileSync(join(AUDIO, `${conversationName}.json`), 'utf8'))
const wav = join(AUDIO, `${conversationName}.wav`)
if (!existsSync(wav)) {
  console.error(`no ${wav}; run scripts/voice-live/make-wav.mjs`)
  process.exit(2)
}

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.goto(`${base}/`, { waitUntil: 'networkidle' })

/*
 * The browser side of a session, as the presence will one day do it: the
 * microphone on a media track, a data channel for events, the offer through
 * the server function, the answer back. No key, no actor, no case.
 */
const clicked = Date.now()
const opened = await page.evaluate(async ({ voice }) => {
  const mod = await import('/src/infrastructure/jarvis/serverFns.ts')
  const proof = { turns: [], events: [], sessionId: null, started: null }
  window.__live = proof
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const pc = new RTCPeerConnection()
  const audio = document.createElement('audio')
  audio.autoplay = true
  document.body.append(audio)
  pc.addEventListener('track', (event) => {
    audio.srcObject = new MediaStream([event.track])
  })
  for (const track of stream.getAudioTracks()) pc.addTrack(track, stream)
  const channel = pc.createDataChannel('oai-events')
  channel.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data)
    if (event.type === 'session.started') proof.started = Date.now()
    if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') {
      const who = event.type.startsWith('session.input') ? 'user' : 'assistant'
      const last = proof.turns[proof.turns.length - 1]
      if (last && last.who === who && event.start_ms - last.endMs < 1200) {
        last.text += event.delta
        last.endMs = Math.max(last.endMs, event.end_ms)
      } else proof.turns.push({ who, text: event.delta, startMs: event.start_ms, endMs: event.end_ms })
    } else if (!event.type.startsWith('session.output_audio')) proof.events.push(event.type === 'response.event' ? `response.event/${event.event?.type}` : event.type)
  })
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  await new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve()
    pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && resolve())
    setTimeout(resolve, 2000)
  })
  const response = await mod.openLiveSessionFn({ data: { sdp: pc.localDescription.sdp, voice } })
  if (!response.ok) return response
  await pc.setRemoteDescription({ type: 'answer', sdp: response.sdp })
  proof.sessionId = response.sessionId
  window.__pc = pc
  return { ok: true, sessionId: response.sessionId }
}, { voice })
console.log('open:', JSON.stringify(opened))
if (!opened.ok) {
  await browser.close()
  process.exit(1)
}

/* A request the contract does not name is refused by name, on the same door. */
const refused = await page.evaluate(async () => {
  const mod = await import('/src/infrastructure/jarvis/serverFns.ts')
  return mod.openLiveSessionFn({ data: { sdp: 'x', actorEmployeeId: 'cio' } })
})
console.log('open with an actor:', JSON.stringify(refused))

await page.waitForFunction(() => window.__live.started !== null, null, { timeout: 30_000 })
const startedAfterMs = Date.now() - clicked
await page.waitForTimeout(conversation.seconds * 1000 + 5000)

const snapshot = await page.evaluate(() => ({ turns: window.__live.turns, events: window.__live.events }))
const state = await page.evaluate(async ({ id }) => {
  const mod = await import('/src/infrastructure/jarvis/serverFns.ts')
  return mod.liveSessionStateFn({ data: { sessionId: id } })
}, { id: opened.sessionId })
const closed = await page.evaluate(async ({ id }) => {
  const mod = await import('/src/infrastructure/jarvis/serverFns.ts')
  window.__pc?.close()
  return mod.closeLiveSessionFn({ data: { sessionId: id } })
}, { id: opened.sessionId })
await browser.close()

const result = {
  conversation: conversationName,
  voice,
  sessionId: opened.sessionId,
  startedAfterMs,
  refusedWithActor: refused,
  turns: snapshot.turns,
  events: snapshot.events,
  state,
  closed,
  browserErrors: errors,
}
const file = join(OUT, `product-${conversationName}-${voice}-${Date.now()}.json`)
writeFileSync(file, JSON.stringify(result, null, 2))

console.log(`session.started after ${startedAfterMs} ms`)
for (const t of snapshot.turns) console.log(`  ${t.who.padEnd(9)} ${(t.startMs / 1000).toFixed(1)}-${(t.endMs / 1000).toFixed(1)}s  ${t.text.trim()}`)
const t = closed.ok ? closed.telemetry : state.ok ? state.telemetry : null
if (t) {
  console.log(`tools ${JSON.stringify(t.toolCallsByName)} · reference ${JSON.stringify((closed.ok ? closed : state).reference)} · ack-without-reference ${t.ackWithoutReference} · voice ${t.voiceSeconds} s · $${(t.voiceCostUsd + t.backend.costUsd).toFixed(4)} · closed ${t.reason}`)
}
console.log('browser errors:', errors.length ? errors : 'none')
console.log('result:', file)
