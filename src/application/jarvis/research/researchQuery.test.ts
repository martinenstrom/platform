/**
 * The research family in an advisor's words: the inherently public and
 * current questions are routed here first — never after an internal
 * failure, never to a model's memory — and the judgement questions never
 * are. Context survives the follow-ups.
 */

import { describe, expect, it } from 'vitest'
import { SYM_NASDAQ100, SYM_SP500 } from '~/domain/market'
import type { MarketConversation } from '../marketQuery'
import {
  recognizeResearchQuery,
  researchContextAfter,
  topicOf,
  type ResearchContext,
  type ResearchQueryOptions,
} from './researchQuery'

const NOW = new Date('2026-10-03T08:00:00.000Z')
const market = (over: Partial<ResearchQueryOptions> = {}): ResearchQueryOptions => ({
  scope: 'MARKET',
  market: null,
  research: null,
  now: NOW,
  ...over,
})
const ask = (text: string, options: ResearchQueryOptions = market()) =>
  recognizeResearchQuery(text, options)

describe('the inherently public questions are research first', () => {
  it('recognises each of the brief’s examples with its kind and its subject', () => {
    expect(ask('Varför går börsen ner just nu?')).toMatchObject({
      kind: 'MARKET_WHY',
      freshnessCritical: true,
      freshness: 'day',
    })
    expect(ask('Vad sa Powell idag?')).toMatchObject({
      kind: 'CENTRAL_BANK',
      institution: 'fed',
      country: 'us',
      freshnessCritical: true,
    })
    expect(ask('Vad rapporterade Nvidia?')).toMatchObject({
      kind: 'COMPANY',
      companies: [{ name: 'Nvidia', ticker: 'NVDA' }],
    })
    expect(ask('Vad väntar marknaden sig av CPI?')).toMatchObject({
      kind: 'MARKET_EXPECTATIONS',
      release: 'cpi',
      country: 'us',
    })
    expect(ask('Vad händer nästa vecka?')?.kind).toBe('WEEK_AHEAD')
    expect(ask('Vilka stora bolag rapporterar idag?')?.kind).toBe('WEEK_AHEAD')
    expect(ask('Vad drev Nasdaq igår?')).toMatchObject({
      kind: 'MARKET_WHY',
      instruments: [SYM_NASDAQ100],
    })
    expect(ask('Vad ska jag hålla koll på?')?.kind).toBe('WEEK_AHEAD')
    expect(ask('Hur ser pre-market ut?')).toMatchObject({
      kind: 'PRE_MARKET',
      freshnessCritical: true,
    })
    expect(ask('Vad driver marknaden?')?.kind).toBe('MARKET_DRIVERS')
    expect(ask('Vad säger analytiker om nästa vecka?')?.kind).toBe('ANALYST_VIEW')
    expect(ask('Vad tycker marknaden om nästa Fed-möte?')).toMatchObject({
      kind: 'MARKET_EXPECTATIONS',
      institution: 'fed',
    })
    expect(ask('Vad hände med Nvidia?')?.kind).toBe('COMPANY')
    expect(ask('Vad beslutade Riksbanken?')).toMatchObject({
      kind: 'CENTRAL_BANK',
      institution: 'riksbank',
      country: 'se',
    })
    expect(ask('Vad visade KPI i Sverige?')).toMatchObject({
      kind: 'MACRO_RELEASE',
      release: 'cpi',
      country: 'se',
    })
    expect(ask('Vad händer med dollarn?')?.kind).toBe('GENERAL_FINANCIAL')
  })

  it('tells research from market data: a level is the market tier’s, a reason is research', () => {
    expect(ask('Vad står S&P i?')).toBeNull()
    expect(ask('Hur gick S&P 500 i veckan?')).toBeNull()
    expect(ask('Varför går S&P upp?')).toMatchObject({
      kind: 'MARKET_WHY',
      instruments: [SYM_SP500],
    })
  })

  it('refuses judgement and allocation, which stay the firm’s', () => {
    for (const line of [
      'Borde jag köpa Nvidia?',
      'Ska vi öka exponeringen mot USA?',
      'Vilken vikt ska vi ha i tech?',
      'Rekommenderar du Novo Nordisk?',
      'Should I buy Tesla?',
    ])
      expect(ask(line), line).toBeNull()
  })

  it('reads depth from the words, and a bare "research this" as the deep form of why', () => {
    expect(ask('Ta reda på varför börsen föll.')?.depth).toBe('deep')
    expect(ask('Varför föll börsen?')?.depth).toBe('quick')
    const usWeek: MarketConversation = {
      symbols: [SYM_SP500, SYM_NASDAQ100],
      region: 'us',
      period: { kind: 'range', range: '1w' },
    }
    const deep = ask('Gör en ordentlig analys.', market({ market: usWeek }))
    expect(deep).toMatchObject({
      kind: 'MARKET_WHY',
      depth: 'deep',
      region: 'us',
      continues: true,
    })
    expect(ask('Research this.', market({ market: usWeek }))?.depth).toBe('deep')
  })

  it('has nothing to say to a line with no public subject and no context', () => {
    expect(ask('Varför?')).toBeNull()
    expect(ask('Gör en ordentlig analys.')).toBeNull()
    expect(ask('Vad är term premium?')).toBeNull()
  })
})

describe('the research context survives the follow-ups', () => {
  const usLastWeek: MarketConversation = {
    symbols: [SYM_SP500, SYM_NASDAQ100],
    region: 'us',
    period: { kind: 'range', range: '1w' },
  }

  it('"Hur gick USA förra veckan?" then "Varför?" is why the US market moved last week', () => {
    const why = ask('Varför?', market({ market: usLastWeek }))
    expect(why).toMatchObject({
      kind: 'MARKET_WHY',
      region: 'us',
      period: { kind: 'range', range: '1w' },
      instruments: [SYM_SP500, SYM_NASDAQ100],
      continues: true,
      explicit: { subject: false, period: false },
    })
  })

  it('carries the subject on through analysts, expectations and an English reversal question', () => {
    const context: ResearchContext = researchContextAfter(
      ask('Varför?', market({ market: usLastWeek }))!,
      ['e1', 'e2'],
      '2026-10-02T15:05:00.000Z',
    )
    expect(context).toMatchObject({
      topic: SYM_SP500,
      region: 'us',
      evidenceIds: ['e1', 'e2'],
    })
    const analysts = ask(
      'Vad säger analytiker om nästa vecka?',
      market({ research: context }),
    )
    expect(analysts).toMatchObject({ kind: 'ANALYST_VIEW', region: 'us' })
    const reverse = ask(
      'What could reverse it?',
      market({ research: context, market: usLastWeek }),
    )
    expect(reverse).toMatchObject({ kind: 'MARKET_WHY', region: 'us', continues: true })
  })

  it('a company stays the subject: "Vad sa bolaget om guidance?", "Hur ser värderingen ut?"', () => {
    const nvidia = researchContextAfter(ask('Vad rapporterade Nvidia?')!, [], null)
    expect(topicOf(ask('Vad rapporterade Nvidia?')!)).toBe('company:nvidia')
    expect(
      ask('Vad sa bolaget om guidance?', market({ research: nvidia })),
    ).toMatchObject({
      kind: 'COMPANY',
      companies: [{ name: 'Nvidia' }],
    })
    expect(ask('Hur ser värderingen ut?', market({ research: nvidia }))).toMatchObject({
      kind: 'COMPANY',
      companies: [{ name: 'Nvidia' }],
    })
  })

  it('explicit words always win over the context', () => {
    const context = researchContextAfter(ask('Vad sa Powell?')!, [], null)
    expect(ask('Och Riksbanken?', market({ research: context }))).toMatchObject({
      kind: 'CENTRAL_BANK',
      institution: 'riksbank',
    })
    expect(ask('Varför föll DAX idag?', market({ market: usLastWeek }))).toMatchObject({
      instruments: ['idx:dax'],
      period: { kind: 'today' },
      explicit: { subject: true, period: true },
    })
  })

  it('names a company the list does not know, when the line says it reported', () => {
    expect(ask('Vad rapporterade Alleima?')).toMatchObject({
      kind: 'COMPANY',
      companies: [{ name: 'Alleima', ticker: null }],
    })
  })
})
