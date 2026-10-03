/**
 * The market answer in Swedish: full for the screen, short for the voice,
 * honest about a missing period, and never in the platform's own words.
 */

import { describe, expect, it } from 'vitest'
import { answerMarketQuery, type MarketAnswer } from '~/application/jarvis/marketAnswer'
import {
  briefFixture,
  FIXTURE_NOW,
  weekHistoryFixture as history,
} from '~/application/jarvis/marketAnswer.fixture'
import type { MarketHistorySource } from '~/application/jarvis/marketHistory'
import {
  recognizeMarketQuery,
  type MarketConversation,
} from '~/application/jarvis/marketQuery'
import { SYM_NASDAQ100, SYM_SP500 } from '~/domain/market'
import { marketAnswerSpeech, marketAnswerText } from './marketAnswerText'

const NOW = FIXTURE_NOW

const answer = (
  text: string,
  source: MarketHistorySource | null,
  conversation: MarketConversation | null = null,
): Promise<MarketAnswer> =>
  answerMarketQuery(
    recognizeMarketQuery(text, { scope: 'MARKET', conversation, now: NOW })!,
    {
      brief: async (scope) => briefFixture(scope),
      history: source,
      now: () => NOW,
    },
  )

/** The screenshot's failure: implementation language, which no market answer may ever contain. */
const FORBIDDEN = /modellens väg|rösten är simulerad|registret/i

describe('today', () => {
  it('keeps the Tier-0 sentence for a named instrument, and speaks it shorter', async () => {
    const a = await answer('Hur gick S&P 500?', null)
    expect(marketAnswerText(a)).toBe(
      'S&P 500 ligger på 6 512 just nu, upp 0,42 procent idag (fördröjd data från Yahoo, kl. 16:59).',
    )
    expect(marketAnswerSpeech(a)).toBe('S&P 500 är upp 0,42 procent idag.')
  })

  it('summarises a region in one breath', async () => {
    const a = await answer('Hur gick amerikanska börsen idag?', null)
    expect(marketAnswerSpeech(a)).toBe(
      'S&P 500 är upp 0,42 procent idag och Nasdaq 100 upp 0,7. USA-börsen är alltså överlag positiv idag.',
    )
    const text = marketAnswerText(a)
    expect(text).toContain(
      'USA-börsen idag — överlag positiv: S&P 500 ligger på 6 512 just nu, upp 0,42 procent idag',
    )
    expect(text).toContain('Nasdaq 100 ligger på 23 950 just nu, upp 0,7 procent idag')
  })

  it('answers the rates in a sentence', async () => {
    const a = await answer('Vad hände med räntorna?', null)
    expect(marketAnswerSpeech(a)).toBe(
      'USA:s tioårsränta ligger på 4,12 procent, upp 4 baspunkter.',
    )
  })

  it('says the Dow is not served instead of guessing', async () => {
    const a = await answer('Hur gick Dow Jones idag?', null)
    expect(marketAnswerSpeech(a)).toBe(
      'Dow Jones serveras inte av plattformen, så jag har ingen siffra att ge.',
    )
  })
})

describe('a period', () => {
  it('speaks the week from the series, with the region’s verdict', async () => {
    const a = await answer('Hur gick amerikanska börsen i veckan?', history)
    expect(marketAnswerSpeech(a)).toBe(
      'S&P 500 steg 1,4 procent under veckan medan Nasdaq 100 upp 0,8. USA-börsen var alltså överlag positiv under veckan.',
    )
    expect(marketAnswerText(a)).toBe(
      'USA-börsen under veckan — överlag positiv: S&P 500 steg 1,4 procent (6 490) och Nasdaq 100 steg 0,8 procent (23 950) (Yahoo, t.o.m. 2 okt.).',
    )
  })

  it('says exactly what is missing, and offers today as today — never the day as the week', async () => {
    const a = await answer('Hur gick S&P 500 i veckan?', null)
    const text = marketAnswerText(a)
    expect(text).toContain(
      'Jag har dagens S&P 500-data, men inte en komplett veckoserie i den här datakällan.',
    )
    expect(text).toContain('Idag: S&P 500 ligger på 6 512 just nu, upp 0,42 procent idag')
    expect(text).not.toMatch(/under veckan/)
    expect(marketAnswerSpeech(a)).toBe(
      'Jag har dagens S&P 500-data, men inte en komplett veckoserie i den här datakällan. Idag S&P 500 är upp 0,42 procent.',
    )
    expect(text).not.toMatch(FORBIDDEN)
  })

  it('names several missing instruments once, and a month by its name', async () => {
    const a = await answer('Hur gick USA i september?', null)
    expect(marketAnswerText(a)).toContain(
      'Jag har dagens data för S&P 500 och Nasdaq 100, men inte en komplett serie för september i den här datakällan.',
    )
    const yesterday = await answer('Hur gick S&P 500 igår?', null)
    expect(marketAnswerText(yesterday)).toContain(
      'men ingen serie för igår i den här datakällan',
    )
  })

  it('compares over the same period and says which did best', async () => {
    const nasdaqWeek: MarketConversation = {
      symbols: [SYM_NASDAQ100],
      region: null,
      period: { kind: 'range', range: '1w' },
    }
    const a = await answer('Jämför med S&P.', history, nasdaqWeek)
    expect(marketAnswerSpeech(a)).toBe(
      'Nasdaq 100 steg 0,8 procent under veckan medan S&P 500 upp 1,4. S&P 500 gick alltså bäst.',
    )
    const best = await answer('Vilken gick bäst?', history, {
      symbols: [SYM_NASDAQ100, SYM_SP500],
      region: null,
      period: { kind: 'range', range: '1w' },
    })
    expect(marketAnswerText(best)).toContain('S&P 500 gick bäst.')
  })
})

describe('the regression from the screenshot', () => {
  it('never answers a market question in the platform’s own words', async () => {
    for (const line of [
      'Hur gick amerikanska börsen i veckan?',
      'Hur gick sp500?',
      'Hur gick S&P 500?',
      'Vad gjorde Nasdaq?',
    ]) {
      const a = await answer(line, null)
      expect(marketAnswerText(a), line).not.toMatch(FORBIDDEN)
      expect(marketAnswerSpeech(a), line).not.toMatch(FORBIDDEN)
    }
    expect(marketAnswerSpeech(await answer('Hur gick sp500?', null))).toContain('S&P 500')
  })
})
