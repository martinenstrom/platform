/**
 * The TTS report and the listening page, rebuilt from every run on disk.
 *
 * Shared by tts.mjs (the provider bake-off) and variants.mjs (controlled
 * variants of one voice), so a variant lands on the same page as the voices
 * it came from. Rows that carry `settings` are variants and get their own
 * section at the top, side by side, with the exact request differences
 * printed under each column.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { RESULTS, cell, median, readJson, writeResult } from './lib.mjs'

export const RUNS = join(RESULTS, 'tts-runs')

/** Every row from every run, later runs replacing earlier rows of the same name. */
export function allRuns() {
  const legacy = join(RESULTS, 'tts-results.json')
  const files = [
    ...(existsSync(legacy) ? [legacy] : []),
    ...(existsSync(RUNS) ? readdirSync(RUNS).sort().map((f) => join(RUNS, f)) : []),
  ]
  const byName = new Map()
  for (const file of files) for (const row of readJson(file)) byName.set(row.name ?? row.file, row)
  return [...byName.values()]
}

const escapeHtml = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const fileName = (r) => r.name ?? r.file.split(/[\\/]/).pop().replace(/\.mp3$/, '')

export function buildTtsReport(answers, { recovery = null } = {}) {
  const results = allRuns()
  const variants = results.filter((r) => r.settings)
  const voices = results.filter((r) => !r.settings)

  /* ----------------------------------------------------------- report */
  const lines = ['# TTS bake-off — results', '', 'Latencies are measured from request start; quality is yours to score by listening to `results/tts/`.', '']
  lines.push('## Summary', '', '| Provider · voice · variant | Median first audio | Median total | Failures |', '| --- | --- | --- | --- |')
  const groups = new Map()
  for (const r of results) {
    const key = `${r.provider} · ${r.voice} · ${r.variant}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  for (const [key, rs] of groups) {
    const ok = rs.filter((r) => !r.error)
    lines.push(`| ${cell(key)} | ${median(ok.map((r) => r.firstAudioMs)) ?? '–'} ms | ${median(ok.map((r) => r.totalMs)) ?? '–'} ms | ${rs.length - ok.length} |`)
  }
  if (variants.length) {
    lines.push('', '## Variants — exact request differences', '')
    const seen = new Set()
    for (const r of variants) {
      const key = `${r.voice} · ${r.variant}`
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(`### ${key}`, '', '```json', JSON.stringify(r.settings, null, 2), '```', '')
      if (r.inputPrefix) lines.push(`Text prefix (an audio tag, not spoken): \`${r.inputPrefix}\``, '')
    }
  }
  lines.push('', '## Files', '')
  for (const r of results) lines.push(`- ${r.error ? `FAILED ${cell(r.error.split('\n')[0].slice(0, 160))}` : `\`${r.file}\` — first audio ${r.firstAudioMs} ms, total ${r.totalMs} ms${r.sha1 ? `, sha1 ${r.sha1}` : ''}`}`)
  if (recovery) {
    lines.push('', '## Round trip (proxy for English-term clarity, not for sound)', '', '| File | STT | English terms recovered | Transcript |', '| --- | --- | --- | --- |')
    for (const r of recovery) lines.push(`| ${cell(r.file)} | ${r.stt} | ${r.error ? 'FAILED' : r.hits.map((h) => `${h.hit ? '✓' : '✗'} ${h.term}`).join(', ')} | ${cell(r.transcript ?? r.error)} |`)
  }
  lines.push('', '## Human scoring (fill in)', '', 'Per voice, 1–5: Swedish naturalness · calm authority · English terms inside Swedish · prosody · long-form listenability (a09, a10) · fit with the JARVIS brief. Note first-audio latency beside it.', '')
  const reportPath = writeResult('tts-report.md', lines.join('\n'))

  /* ------------------------------------------------------ listening set */
  const html = [
    '<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>JARVIS röst — lyssningsset</title>',
    '<style>body{font-family:system-ui,sans-serif;max-width:1180px;margin:2rem auto;padding:0 1rem;color:#e8edf7;background:#060910}',
    'h1{font-size:1.2rem}h2{font-size:1rem;margin-top:2rem;color:#98a3b8}h3{font-size:.95rem;margin:1.4rem 0 .4rem;color:#c5cddb}',
    'p.text{font-size:1.02rem;line-height:1.5;border-left:2px solid #26344a;padding-left:.8rem}',
    'table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.35rem .5rem;border-bottom:1px solid #1a2434;font-size:.9rem;vertical-align:top}',
    'th{color:#818da1;font-weight:500}audio{width:100%;height:32px}.ms{color:#98a3b8;white-space:nowrap}',
    'pre{font-size:.72rem;color:#98a3b8;white-space:pre-wrap;margin:.2rem 0 0}.frontrunner{border:1px solid #26344a;border-radius:8px;padding:1rem 1.2rem;margin:1rem 0 2rem;background:#0a1220}',
    '</style></head><body>',
    '<h1>Lyssningsset — samma svar, varje röst bredvid varandra</h1>',
  ]

  if (variants.length) {
    const byVoice = new Map()
    for (const r of variants) {
      if (!byVoice.has(r.voice)) byVoice.set(r.voice, [])
      byVoice.get(r.voice).push(r)
    }
    for (const [voice, rows] of byVoice) {
      const order = [...new Set(rows.map((r) => r.variant))]
      const label = rows[0].voiceLabel ?? voice
      html.push(`<section class="frontrunner"><h2>Varianter av ${escapeHtml(label)} — samma text, samma seed, olika instruktion</h2>`)
      html.push(`<p>Kolumnerna är A · B · C. Under varje rubrik står exakt vad som skickades som skiljer varianten från A. Lyssna på samma rad, från vänster till höger.</p>`)
      html.push('<table><tr><th style="width:18%">Text</th>')
      for (const v of order) {
        const sample = rows.find((r) => r.variant === v)
        html.push(`<th>${escapeHtml(v)}<pre>${escapeHtml(sample.summary ?? JSON.stringify(sample.settings))}</pre></th>`)
      }
      html.push('</tr>')
      for (const answer of answers) {
        const ofAnswer = rows.filter((r) => r.answerId === answer.id)
        if (ofAnswer.length === 0) continue
        html.push(`<tr><td>${escapeHtml(answer.id)}<br><span class="ms">${escapeHtml(answer.text.slice(0, 60))}${answer.text.length > 60 ? '…' : ''}</span></td>`)
        for (const v of order) {
          const r = ofAnswer.find((x) => x.variant === v)
          html.push(
            `<td>${!r ? '' : r.error ? `<em>FAILED</em> ${escapeHtml(r.error.split('\n')[0].slice(0, 100))}` : `<audio controls preload="none" src="tts/${escapeHtml(fileName(r))}.mp3"></audio><span class="ms">${r.firstAudioMs} / ${r.totalMs} ms · sha1 ${r.sha1 ?? '–'}</span>`}</td>`,
          )
        }
        html.push('</tr>')
      }
      html.push('</table></section>')
    }
  }

  const voiceGroups = new Map()
  for (const r of voices) {
    const key = `${r.provider} · ${r.voice} · ${r.variant}`
    if (!voiceGroups.has(key)) voiceGroups.set(key, [])
    voiceGroups.get(key).push(r)
  }
  const keys = [...voiceGroups.keys()]
  html.push(`<p>Bedöm 1–5 per röst: svensk naturlighet · lugn auktoritet · engelska termer inne i svenskan · prosodi · långform (a09, a10) · passar JARVIS-briefen. ${keys.length} röster/varianter.</p>`)
  for (const answer of answers) {
    html.push(`<h2>${answer.id} — ${escapeHtml(answer.kind)}</h2><p class="text">${escapeHtml(answer.text)}</p>`)
    html.push('<table><tr><th style="width:34%">Röst</th><th>Ljud</th><th class="ms">första ljud / totalt</th></tr>')
    for (const key of keys) {
      const r = voiceGroups.get(key).find((x) => x.answerId === answer.id)
      if (!r) continue
      html.push(
        `<tr><td>${escapeHtml(key)}</td><td>${r.error ? `<em>FAILED</em> ${escapeHtml(r.error.split('\n')[0].slice(0, 120))}` : `<audio controls preload="none" src="tts/${escapeHtml(fileName(r))}.mp3"></audio>`}</td><td class="ms">${r.error ? '' : `${r.firstAudioMs} / ${r.totalMs} ms`}</td></tr>`,
      )
    }
    html.push('</table>')
  }
  html.push('</body></html>')
  const listenPath = writeResult('listen.html', html.join('\n'))
  return { reportPath, listenPath, results }
}
