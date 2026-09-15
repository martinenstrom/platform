/**
 * The GPT-Live listening page: every captured JARVIS recording, one row per
 * voice and conversation, with the transcript of what was said beside the
 * player, so the ear can compare voices on the same words.
 *
 *   node scripts/voice-live/listen.mjs        → results/listen.html (open it in a browser)
 *
 * The recordings are JARVIS's side of each session, captured in the browser
 * (live.html?record=1). They are local, git-ignored, and never left the
 * machine except as the audio the session itself produced.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RESULTS = join(HERE, 'results')

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/* Every probe result that saved a recording — one row per session, whatever the result was called. */
const seen = new Set()
const runs = readdirSync(RESULTS)
  .filter((f) => /^probe-.*\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(RESULTS, f), 'utf8')))
  .filter((r) => !r.failed && r.recording && /\.webm$/.test(r.recording) && existsSync(r.recording))
  .filter((r) => (seen.has(r.sessionId) ? false : (seen.add(r.sessionId), true)))
  .sort((a, b) => a.voice.localeCompare(b.voice) || a.conversation.localeCompare(b.conversation))

const byConversation = new Map()
for (const r of runs) {
  if (!byConversation.has(r.conversation)) byConversation.set(r.conversation, [])
  byConversation.get(r.conversation).push(r)
}

const html = [
  '<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>JARVIS · GPT-Live röster</title>',
  '<style>body{font-family:system-ui,sans-serif;max-width:1180px;margin:2rem auto;padding:0 1rem;color:#e8edf7;background:#060910}',
  'h1{font-size:1.2rem}h2{font-size:1rem;margin-top:2rem;color:#98a3b8}p.hint{color:#818da1;font-size:.85rem}',
  'table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.45rem .5rem;border-bottom:1px solid #1a2434;font-size:.9rem;vertical-align:top}',
  'th{color:#818da1;font-weight:500}audio{width:100%;height:32px}.voice{font-weight:600}.said{color:#c5cddb;font-size:.85rem;line-height:1.4}.said span{color:#818da1}',
  '</style></head><body>',
  '<h1>GPT-Live — JARVIS med sex röster, samma ord</h1>',
  '<p class="hint">Inspelningarna är JARVIS sida av varje session, tagna i webbläsaren. Bedöm: naturlig svenska · intelligens · lugn auktoritet · värme · lite levande snarare än platt · engelska finanstermer · långform · känns det som JARVIS. Ingen rangordning är gjord här.</p>',
]
if (runs.length === 0) html.push('<p>Inga inspelningar ännu. Kör <code>LIVE_RECORD=1 node scripts/voice-live/probe-live.mjs c4-terms</code> med <code>PROBE_VOICES</code>.</p>')
for (const [conversation, rows] of byConversation) {
  html.push(`<h2>${escapeHtml(conversation)}</h2>`)
  html.push('<table><tr><th style="width:9%">Röst</th><th style="width:40%">Ljud (JARVIS)</th><th>Vad som sades</th></tr>')
  for (const r of rows) {
    const said = r.turns
      .filter((t) => t.who === 'assistant')
      .map((t) => `<span>${(t.startMs / 1000).toFixed(1)} s</span> ${escapeHtml(t.text.trim())}`)
      .join('<br>')
    const file = r.recording.split(/[\\/]/).pop()
    html.push(`<tr><td class="voice">${escapeHtml(r.voice)}</td><td><audio controls preload="none" src="${escapeHtml(file)}"></audio><div class="hint">${escapeHtml(file)} · ${r.telemetry.voiceSeconds} s</div></td><td class="said">${said}</td></tr>`)
  }
  html.push('</table>')
}
html.push('</body></html>')
const out = join(RESULTS, 'listen.html')
writeFileSync(out, html.join('\n'))
console.log(`${runs.length} recording(s) across ${byConversation.size} conversation(s) → ${out}`)
