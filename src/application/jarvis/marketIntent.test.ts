/**
 * The Tier-0 recogniser: a named instrument's state, and nothing that
 * smells of judgement, reasoning or an overview.
 */

import { describe, expect, it } from 'vitest'
import { mentionsMarket, recognizeRetrieval, scopeForRetrieval } from './marketIntent'

const targets = (text: string) => {
  const intent = recognizeRetrieval(text)
  return intent ? intent.targets.map((t) => ('symbol' in t ? t.symbol : t.kind)) : null
}

describe('a named instrument’s current state', () => {
  it('is recognised in the words a Swedish speaker uses', () => {
    expect(targets('Hur gick S&P 500 idag?')).toEqual(['idx:sp500'])
    expect(targets('Vad står Nasdaq i?')).toEqual(['idx:nasdaq100'])
    expect(targets('Vad gör tioåringen?')).toEqual(['rate:us10y'])
    expect(targets('Hur går tech?')).toEqual(['sector:technology'])
    expect(targets('Hur mycket är guldet upp idag?')).toEqual(['cmd:gold'])
    expect(targets('Vad står dollarn i just nu?')).toEqual(['fx:usdsek'])
    expect(targets('Hur går Stockholmsbörsen idag?')).toEqual(['idx:omxs30'])
    expect(targets('Vilka sektorer går bäst idag?')).toEqual(['sectors'])
    expect(targets('Hur är riskaptiten?')).toEqual(['risk'])
    expect(targets('Hur är VIX?')).toEqual(['vix'])
  })

  it('takes a bare follow-up of a few words as the same question about another instrument', () => {
    expect(targets('Och Nasdaq?')).toEqual(['idx:nasdaq100'])
    expect(targets('Guldet?')).toEqual(['cmd:gold'])
    expect(targets('Tvååringen då?')).toEqual(['rate:us2y'])
  })

  it('names several instruments in the order they were said, at most three', () => {
    expect(targets('Hur gick S&P 500 och Nasdaq idag?')).toEqual(['idx:sp500', 'idx:nasdaq100'])
    expect(targets('Vad gör tioåringen och tvååringen?')).toEqual(['rate:us10y', 'rate:us2y'])
    expect(recognizeRetrieval('Hur gick S&P, Nasdaq, DAX och FTSE idag?')).toBeNull()
  })
})

describe('what is never Tier 0', () => {
  it('an overview that names no instrument', () => {
    expect(recognizeRetrieval('Hur ser amerikanska börsen ut idag?')).toBeNull()
    expect(recognizeRetrieval('Vad händer på marknaden?')).toBeNull()
    expect(recognizeRetrieval('Och Europa?')).toBeNull()
  })

  it('a judgement, whatever instrument it names — the planted violations', () => {
    for (const line of [
      'Ska jag köpa guld?',
      'Borde jag minska min USA-exponering?',
      'Ska jag sälja Nvidia?',
      'Är S&P 500 attraktiv på 12–24 månader?',
      'Hur bör portföljen positioneras om tioåringen går till 5,5 %?',
      'Tycker du att tech är billigt?',
      'Tror du dollarn stärks framöver?',
      'Vad är risken med guld nu?',
    ]) {
      expect(recognizeRetrieval(line), line).toBeNull()
    }
  })

  it('why, meaning, valuation and drivers — the router’s, not the formatter’s', () => {
    for (const line of [
      'Varför faller Nasdaq?',
      'Varför?',
      'Vad betyder högre tioårsränta för tech?',
      'Hur ser värderingen ut?',
      'Vad driver marknaden idag?',
      'Förklara vad tioåringen gör med techvärderingar',
    ]) {
      expect(recognizeRetrieval(line), line).toBeNull()
    }
  })

  it('a long line, an empty line, or a line about the firm’s case', () => {
    expect(recognizeRetrieval('')).toBeNull()
    expect(recognizeRetrieval('Var står ärendet om Nasdaq?')).toBeNull()
    expect(recognizeRetrieval(`Nasdaq ${'och så vidare '.repeat(20)}`)).toBeNull()
  })
})

describe('the scope a retrieval needs', () => {
  it('is the narrowest region that serves every target', () => {
    expect(scopeForRetrieval(recognizeRetrieval('Vad gör tioåringen?')!)).toBe('us')
    expect(scopeForRetrieval(recognizeRetrieval('Hur går OMX idag?')!)).toBe('sweden')
    expect(scopeForRetrieval(recognizeRetrieval('Hur gick DAX idag?')!)).toBe('europe')
    expect(scopeForRetrieval(recognizeRetrieval('Hur gick S&P 500 och DAX idag?')!)).toBe('global')
    expect(scopeForRetrieval(recognizeRetrieval('Vilka sektorer går bäst?')!)).toBe('us')
  })
})

describe('what is about markets at all', () => {
  it('decides when a brief travels with a general turn', () => {
    expect(mentionsMarket('Hur ser amerikanska börsen ut idag?')).toBe(true)
    expect(mentionsMarket('Vad driver marknaden?')).toBe(true)
    expect(mentionsMarket('Och Europa?')).toBe(true)
    expect(mentionsMarket('Vad är term premium?')).toBe(false)
    expect(mentionsMarket('Vad heter du?')).toBe(false)
  })
})
