/**
 * The firewall, with planted private data: a client name, a client id, an
 * amount and the record's vocabulary are each caught; a line in a record
 * scope never leaves whatever it says; a hybrid line yields its client for
 * the private layer and nothing for the public one.
 */

import { describe, expect, it } from 'vitest'
import { decideLine, decomposeHybrid, guardPublicText, RECORD_SCOPES } from './firewall'
import { PLANTED_VOCABULARY } from './research.fixture'

describe('guardPublicText', () => {
  it('passes a public market question', () => {
    expect(guardPublicText('Varför föll Nasdaq i veckan?', PLANTED_VOCABULARY)).toEqual({
      ok: true,
    })
    expect(guardPublicText('Vad sa Powell?', PLANTED_VOCABULARY)).toEqual({ ok: true })
  })

  it('catches a client by first name, by surname, by household and when the name opens the line', () => {
    expect(
      guardPublicText('Vad betyder dagens ränteuppgång för Henrik?', PLANTED_VOCABULARY),
    ).toEqual({
      ok: false,
      violations: ['client-name'],
    })
    expect(guardPublicText('Hur påverkar räntan Dahlqvist?', PLANTED_VOCABULARY).ok).toBe(
      false,
    )
    expect(guardPublicText('Alvarsson och räntorna', PLANTED_VOCABULARY).ok).toBe(false)
  })

  it('catches a record id, an amount and the record’s vocabulary', () => {
    expect(guardPublicText('Vad händer med cl-alvarsson?', PLANTED_VOCABULARY)).toEqual({
      ok: false,
      violations: ['client-id'],
    })
    expect(guardPublicText('Varför föll det 42 miljoner?', PLANTED_VOCABULARY)).toEqual({
      ok: false,
      violations: ['amount'],
    })
    expect(guardPublicText('Hur slår räntan mot bolånet?', PLANTED_VOCABULARY)).toEqual({
      ok: false,
      violations: ['private-record'],
    })
    expect(
      guardPublicText('Vad betyder det för portföljen?', PLANTED_VOCABULARY).ok,
    ).toBe(false)
  })
})

describe('decideLine', () => {
  it('withholds the line in every record scope, whatever it says', () => {
    for (const scope of RECORD_SCOPES)
      expect(decideLine('Varför föll Nasdaq?', scope, PLANTED_VOCABULARY)).toEqual({
        lineAllowed: false,
        violations: [],
        withheld: 'record-scope',
      })
  })

  it('lets a clean line travel from the market or from nowhere in particular, and withholds a tainted one', () => {
    expect(
      decideLine('Varför föll Nasdaq?', 'MARKET', PLANTED_VOCABULARY).lineAllowed,
    ).toBe(true)
    expect(
      decideLine('Varför föll Nasdaq?', 'GLOBAL', PLANTED_VOCABULARY).lineAllowed,
    ).toBe(true)
    expect(
      decideLine('Varför föll Nasdaq för Henrik?', 'MARKET', PLANTED_VOCABULARY),
    ).toEqual({
      lineAllowed: false,
      violations: ['client-name'],
      withheld: 'guard',
    })
  })
})

describe('decomposeHybrid', () => {
  it('names the client for the private layer, and nobody when a first name fits two', () => {
    expect(
      decomposeHybrid('Vad betyder dagens ränteuppgång för Anna?', PLANTED_VOCABULARY),
    ).toEqual({
      clientReference: { id: 'cl-dahlqvist', displayName: 'Anna & Per Dahlqvist' },
      ambiguous: false,
    })
    expect(
      decomposeHybrid('Vad betyder dagens ränteuppgång för Henrik?', PLANTED_VOCABULARY),
    ).toEqual({
      clientReference: null,
      ambiguous: true,
    })
    expect(
      decomposeHybrid('Vad betyder det för Henrik Alvarsson?', PLANTED_VOCABULARY)
        .clientReference?.id,
    ).toBe('cl-alvarsson')
    expect(decomposeHybrid('Varför föll Nasdaq?', PLANTED_VOCABULARY)).toEqual({
      clientReference: null,
      ambiguous: false,
    })
  })
})
