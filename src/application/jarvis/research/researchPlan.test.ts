/**
 * Tool selection, as the brief rules it: the official source first for a
 * central bank or a release, the filing first for a company, market data
 * plus reporting for a move, calendars first for the week ahead, and never
 * a generic search where a structured source exists.
 */

import { describe, expect, it } from 'vitest'
import { SYM_NASDAQ100, SYM_SP500, SYM_US10Y } from '~/domain/market'
import { planFor } from './researchPlan'
import { recognizeResearchQuery, type ResearchQueryOptions } from './researchQuery'

const NOW = new Date('2026-10-03T08:00:00.000Z')
const options: ResearchQueryOptions = {
  scope: 'MARKET',
  market: null,
  research: null,
  now: NOW,
}
const plan = (text: string) => planFor(recognizeResearchQuery(text, options)!, NOW)

describe('planFor', () => {
  it('a central-bank question: the bank’s own feed first, opened, then news for context — no generic search', () => {
    const p = plan('Vad sa Fed?')
    expect(p.steps.map((step) => step.source)).toEqual(['official', 'news'])
    expect(p.steps[0]).toMatchObject({
      feed: 'fed-monetary',
      domains: ['federalreserve.gov'],
      retrieve: true,
      topicKey: 'fed:policy-rate',
      purpose: 'fact',
    })
    expect(p.steps[1]!.purpose).toBe('context')
    expect(p.marketFacts).toBeNull()
  })

  it('a US CPI question: the BLS feed first; a Swedish one — "KPI", the Swedish word — SCB’s domains', () => {
    expect(plan('Vad visade CPI?').steps[0]).toMatchObject({
      source: 'official',
      feed: 'bls-cpi',
      domains: ['bls.gov'],
      topicKey: 'us:cpi',
    })
    expect(plan('Vad visade amerikansk KPI?').steps[0]).toMatchObject({ feed: 'bls-cpi' })
    expect(plan('Vad visade KPI?').steps[0]).toMatchObject({
      feed: null,
      topicKey: 'se:cpi',
    })
    expect(plan('Vad visade svensk KPI?').steps[0]).toMatchObject({
      source: 'official',
      feed: null,
      domains: ['scb.se', 'riksbank.se', 'konj.se'],
      topicKey: 'se:cpi',
    })
  })

  it('a company question: the filing first, then news; EDGAR only where the company files there', () => {
    expect(plan('Vad rapporterade Nvidia?').steps[0]).toMatchObject({
      source: 'issuer',
      feed: 'edgar-filings',
      domains: ['sec.gov'],
    })
    expect(plan('Vad rapporterade Volvo?').steps[0]).toMatchObject({
      source: 'issuer',
      feed: null,
    })
    expect(plan('Vad rapporterade Nvidia?').steps[1]!.source).toBe('news')
  })

  it('why the market moved: the platform’s numbers first, then reporting; deep adds the open web', () => {
    const quick = plan('Varför föll USA-börsen i veckan?')
    expect(quick.marketFacts).toEqual({
      symbols: [SYM_SP500, SYM_NASDAQ100, SYM_US10Y],
      region: 'us',
      period: { kind: 'range', range: 'this-week' },
    })
    expect(quick.steps.map((step) => step.source)).toEqual(['news'])
    expect(quick.steps[0]!.limit).toBe(3)
    const deep = plan('Ta reda på varför USA-börsen föll i veckan.')
    expect(deep.steps.map((step) => step.source)).toEqual(['news', 'search'])
    expect(deep.steps[0]!.limit).toBe(6)
  })

  it('the week ahead: official calendars first, then reporting', () => {
    const p = plan('Vad händer nästa vecka?')
    expect(p.steps[0]).toMatchObject({ source: 'calendar', purpose: 'calendar' })
    expect(p.steps[0]!.domains).toContain('federalreserve.gov')
    expect(p.steps[1]!.source).toBe('news')
  })

  it('a general current question is the only one that opens with a search', () => {
    expect(plan('Vad händer med dollarn?').steps.map((step) => step.source)).toEqual([
      'search',
    ])
    for (const text of [
      'Vad sa Fed?',
      'Vad visade CPI?',
      'Vad rapporterade Nvidia?',
      'Vad händer nästa vecka?',
    ])
      expect(plan(text).steps[0]!.source, text).not.toBe('search')
  })
})
