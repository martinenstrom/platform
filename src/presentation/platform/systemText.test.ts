/**
 * The system's words and the shell's gate: where a reader is sent before
 * anything else, and how a count, a size and a moment read.
 */

import { describe, expect, it } from 'vitest'
import type { SystemStatus } from '~/infrastructure/platform/serverFns'
import {
  countsText,
  formatBytes,
  STORE_FAILURE_TEXT,
  systemCodeText,
  systemGate,
} from './systemText'

const at = (state: SystemStatus['database']['state']): Pick<SystemStatus, 'database'> => ({
  database: {
    state,
    path: null,
    sizeBytes: null,
    code: null,
    detail: null,
    uncleanShutdown: false,
    openedAt: null,
    counts: null,
  },
})

describe('the gate', () => {
  it('sends a reader without a record to the first-run page, from anywhere but there', () => {
    expect(systemGate(at('NOT_INITIALISED'), '/')).toBe('/setup')
    expect(systemGate(at('NOT_INITIALISED'), '/clients')).toBe('/setup')
    expect(systemGate(at('NOT_INITIALISED'), '/setup')).toBeNull()
  })
  it('sends a reader whose record refused to open to Recovery Mode, and lets the setup page stand', () => {
    expect(systemGate(at('RECOVERY'), '/clients')).toBe('/recovery')
    expect(systemGate(at('RECOVERY'), '/recovery')).toBeNull()
    expect(systemGate(at('RECOVERY'), '/setup')).toBeNull()
  })
  it('lets every page stand when the record is open, or synthetic', () => {
    expect(systemGate(at('OK'), '/clients')).toBeNull()
    expect(systemGate(at('OK'), '/setup')).toBeNull()
    expect(systemGate(at('SYNTHETIC'), '/')).toBeNull()
  })
})

describe('the words', () => {
  it('says counts, never a percentage, and data saknas for none', () => {
    expect(countsText({ clients: 7, offices: 3, documents: 1 })).toBe(
      '7 klienter · 3 kontor · 1 dokument',
    )
    expect(countsText({ clients: 1, offices: 1, documents: 0 })).toBe(
      '1 klient · 1 kontor · 0 dokument',
    )
    expect(countsText(null)).toBe('Data saknas')
  })
  it('reads a size in Swedish units', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 kB')
    expect(formatBytes(1_500_000)).toBe('1,4 MB')
  })
  it('has a sentence for every refusal to open, and a fallback for an unknown code', () => {
    for (const text of Object.values(STORE_FAILURE_TEXT)) {
      expect(text.title.length).toBeGreaterThan(0)
      expect(text.body.length).toBeGreaterThan(0)
    }
    expect(systemCodeText('WRONG_PASSPHRASE')).toMatch(/lösenfras/i)
    expect(systemCodeText('SOMETHING_ELSE')).toMatch(/SOMETHING_ELSE/)
    expect(systemCodeText('CHECKSUM_MISMATCH', 'documents/x.pdf')).toMatch(/documents\/x\.pdf$/)
  })
})
