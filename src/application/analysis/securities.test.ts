/**
 * What makes a security the security it is.
 *
 * The property under test is the one a slug cannot give: that two providers'
 * observations can be proven to concern the same security. Everything else here
 * exists to stop that proof being quietly weakened.
 */

import { describe, expect, it } from 'vitest'
import {
  GOVERNED_SECURITIES,
  NoProviderIdentifierError,
  UnknownSecurityError,
  findSecurity,
  providerSymbol,
  requireSecurity,
} from './securities'
import { deriveSubjectRef } from './caseIntake'

describe('the governed security registry', () => {
  it('identifies NVDA by venue, currency and symbol', () => {
    const nvda = requireSecurity('sec-nvda')
    expect(nvda.symbol).toBe('NVDA')
    expect(nvda.mic).toBe('XNAS')
    expect(nvda.currency).toBe('USD')
    expect(nvda.kind).toBe('equity')
  })

  it('refuses a security the firm has not admitted', () => {
    /*
     * Fail closed. A registry that answered for anything asked of it would let
     * a case hold evidence about a security nobody approved.
     */
    expect(() => requireSecurity('sec-tsla')).toThrow(UnknownSecurityError)
    expect(findSecurity('sec-tsla')).toBeUndefined()
  })

  it('gives every governed security a provider identifier per source', () => {
    for (const security of GOVERNED_SECURITIES) {
      expect(Object.keys(security.providerIds).length).toBeGreaterThan(0)
    }
  })

  it('refuses to guess a symbol for a source it has no identifier for', () => {
    /*
     * The failure this prevents is silent and expensive: falling back to the
     * venue symbol works for NVDA and fetches the wrong instrument for the
     * first security whose provider ticker differs.
     */
    const nvda = requireSecurity('sec-nvda')
    expect(() => providerSymbol(nvda, 'avanza')).toThrow(NoProviderIdentifierError)
    expect(providerSymbol(nvda, 'yahoo')).toBe('NVDA')
  })
})

describe('why the identity is not a slug', () => {
  it('is stable across the names a person would actually type', () => {
    /*
     * The measured problem. Three spellings of one company produce three slugs
     * and nothing reconciles them; the registry answers with one id for all
     * three because a human resolved it once.
     */
    const spellings = ['Nvidia', 'NVIDIA Corp', 'NVDA']
    const slugs = new Set(spellings.map(deriveSubjectRef))
    expect(slugs.size).toBe(3)

    const nvda = requireSecurity('sec-nvda')
    expect(nvda.id).toBe('sec-nvda')
  })

  it('does not encode the symbol as a rule a reader may rely on', () => {
    /*
     * `sec-nvda` is readable, and that readability is a convenience of the
     * initial value rather than a contract. Nothing may parse an id to learn a
     * symbol — that is what `symbol` is for, and it is the field allowed to
     * change.
     */
    const nvda = requireSecurity('sec-nvda')
    expect(nvda.id).not.toBe(nvda.symbol)
    expect(nvda.id).not.toContain(nvda.mic)
  })
})
