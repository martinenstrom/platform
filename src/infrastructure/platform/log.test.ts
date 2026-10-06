// @vitest-environment node
/**
 * The diagnostic log: a person's words never reach it, whatever a caller
 * passes; an error is its name and message, not a stack, unless asked for;
 * the file is bounded and rotates, keeping a fixed number of earlier files.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger, describeError, LOG_FILE, redactFields } from './log'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fos-log-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const lines = (path: string) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)

describe('the diagnostic log', () => {
  it('never carries a name, a note, a text or a secret, at any depth', () => {
    const redacted = redactFields({
      clientId: 'client-0001',
      displayName: 'Anna Exempel',
      note: 'Anna vill flytta sitt bolån',
      passphrase: 'correct horse',
      apiKey: 'sk-123',
      nested: { title: 'Fondförslag', count: 3, deeper: { text: 'x', ok: true } },
      list: [{ statement: 'hemligt', kind: 'concern' }],
      long: 'a'.repeat(500),
    })
    expect(redacted).toEqual({
      clientId: 'client-0001',
      displayName: '[redacted]',
      note: '[redacted]',
      passphrase: '[redacted]',
      apiKey: '[redacted]',
      nested: { title: '[redacted]', count: 3, deeper: { text: '[redacted]', ok: true } },
      list: [{ statement: '[redacted]', kind: 'concern' }],
      long: `${'a'.repeat(200)}…`,
    })
  })

  it('writes an error as its name and message, and the stack only when asked for', () => {
    const error = new Error('store unavailable')
    expect(describeError(error)).toEqual({ name: 'Error', message: 'store unavailable' })
    expect(describeError(error, true)).toHaveProperty('stack')
    const log = createLogger(dir, { now: () => new Date('2026-10-04T10:00:00.000Z') })
    log.error('store.open.failed', error, { code: 'INTEGRITY_FAILED', note: 'x' })
    const [entry] = lines(log.path!)
    expect(entry).toEqual({
      at: '2026-10-04T10:00:00.000Z',
      level: 'error',
      event: 'store.open.failed',
      code: 'INTEGRITY_FAILED',
      note: '[redacted]',
      error: { name: 'Error', message: 'store unavailable' },
    })
  })

  it('rotates at the bound and keeps a fixed number of earlier files', () => {
    const log = createLogger(dir, { maxBytes: 400, keep: 2 })
    for (let i = 0; i < 40; i += 1) log.info('tick', { i, filler: 'x'.repeat(60) })
    const path = join(dir, LOG_FILE)
    expect(existsSync(path)).toBe(true)
    expect(existsSync(`${path}.1`)).toBe(true)
    expect(existsSync(`${path}.2`)).toBe(true)
    expect(existsSync(`${path}.3`)).toBe(false)
    expect(readFileSync(path).length).toBeLessThanOrEqual(400)
    /* The newest entry is in the live file; the oldest kept entry is in the last rotated one. */
    const newest = lines(path).at(-1)
    expect(newest?.['i']).toBe(39)
    const oldestKept = lines(`${path}.2`)[0]
    expect(Number(oldestKept?.['i'])).toBeGreaterThan(0)
  })
})
