/**
 * Proves the recorder page end to end without a person: Chromium with a
 * fake microphone opens the page, records utterance 01 for two seconds,
 * stops, and the server must have written recordings/01.webm with a
 * WebM header. The fake file is deleted afterwards so a real recording
 * is never mistaken for it.
 *
 *   node scripts/voice-bakeoff/probe-recorder.mjs
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { HERE, RECORDINGS } from './lib.mjs'

const target = join(RECORDINGS, '01.webm')
if (existsSync(target)) {
  console.error(`${target} exists; refusing to overwrite a real recording.`)
  process.exit(2)
}

const server = spawn(process.execPath, [join(HERE, 'record-server.mjs')], { stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((resolve) => server.stdout.on('data', (chunk) => String(chunk).includes('recorder at') && resolve()))

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
let ok = false
try {
  const page = await browser.newPage()
  await page.goto('http://localhost:4174/')
  await page.waitForSelector('li')
  const count = await page.locator('li').count()
  const first = page.locator('li').first().locator('button')
  await first.click()
  await page.waitForFunction(() => document.querySelector('li .status')?.textContent?.includes('spelar in'))
  await page.waitForTimeout(2000)
  await first.click()
  await page.waitForFunction(() => document.querySelector('li .status')?.textContent?.includes('sparad'))
  const bytes = readFileSync(target)
  const webm = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
  console.log(`utterances listed: ${count}; saved ${bytes.length} bytes; WebM header: ${webm}`)
  ok = count === 12 && bytes.length > 0 && webm
} finally {
  await browser.close()
  server.kill()
  if (existsSync(target)) unlinkSync(target)
}
console.log(ok ? 'recorder probe: PASS' : 'recorder probe: FAIL')
process.exit(ok ? 0 : 1)
