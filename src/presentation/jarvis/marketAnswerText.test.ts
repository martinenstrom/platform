/**
 * The market answer in Swedish: full for the screen, short for the voice,
 * a yield in basis points, a comparison in percentage points, honest about
 * a missing period, and never in the platform's own words.
 */

import { describe, expect, it } from 'vitest'
import { answerMarketQuery, type MarketAnswer } from '~/application/jarvis/marketAnswer'
import {
  briefFixture,
  FIXTURE_NOW,
  usMajorsHistoryFixture,
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
      'S&P 500 ligger på 7 772 just nu, upp 0,42 procent idag (fördröjd data från Yahoo Finance, kl. 16:59).',
    )
    expect(marketAnswerSpeech(a)).toBe('S&P 500 är upp 0,42 procent idag.')
  })

  it('summarises a region in one breath', async () => {
    const a = await answer('Hur gick amerikanska börsen idag?', null)
    expect(marketAnswerSpeech(a)).toBe(
      'S&P 500 är upp 0,42 procent idag och Nasdaq 100 upp 0,7. USA-börsen är alltså överlag positiv idag.',
    )
    expect(marketAnswerText(a)).toContain(
      'USA-börsen idag — överlag positiv: S&P 500 ligger på 7 772 just nu',
    )
  })

  it('answers the rates in a sentence, and says the Dow has no quote today but has its periods', async () => {
    expect(marketAnswerSpeech(await answer('Vad hände med räntorna?', null))).toBe(
      'USA:s tioårsränta ligger på 5,28 procent, ned 2 baspunkter.',
    )
    expect(marketAnswerSpeech(await answer('Hur gick Dow Jones idag?', null))).toBe(
      'Dow Jones har ingen dagsnotering här, men jag kan svara om perioder.',
    )
    expect(marketAnswerText(await answer('Hur gick Dow Jones idag?', null))).toBe(
      'Dow Jones har ingen dagsnotering i den här datakällan; jag kan svara om veckan, månaden eller året.',
    )
  })
})

describe('a ranking over the US majors', () => {
  it('"Vad gick bäst?" after S&P 500 last week names the universe, the winner and the loser', async () => {
    const week = await answer('Hur gick S&P 500 förra veckan?', usMajorsHistoryFixture)
    const best = await answer('Vad gick bäst?', usMajorsHistoryFixture, week.conversation)
    expect(marketAnswerSpeech(best)).toBe(
      'Bland de stora USA-indexen gick Nasdaq 100 bäst den senaste veckan, upp 0,65 procent; Russell 2000 är ned 0,5 procent.',
    )
    const text = marketAnswerText(best)
    expect(text).toContain('Bland de stora USA-indexen gick Nasdaq 100 bäst.')
    expect(text).toContain('Dow Jones är upp 0,3 procent den senaste veckan')
    expect(text).not.toMatch(FORBIDDEN)
  })

  it('with nothing to infer from, both forms are the one question back', async () => {
    const cold = await answer('Vad gick bäst?', null)
    expect(marketAnswerSpeech(cold)).toBe('Menar du bland de stora USA-indexen?')
    expect(marketAnswerText(cold)).toBe('Menar du bland de stora USA-indexen?')
  })
})

describe('a period from a real series', () => {
  it('speaks the week for one index, with where it stands', async () => {
    const a = await answer('Hur gick S&P 500 i veckan?', history)
    expect(marketAnswerSpeech(a)).toBe(
      'S&P 500 är upp 1,59 procent den här veckan. Indexet står senast i 7 772.',
    )
    expect(marketAnswerText(a)).toBe(
      'S&P 500 är upp 1,59 procent den här veckan (7 650 → 7 772, 25 sep. – 2 okt.; Yahoo Finance, t.o.m. 2 okt. 16:59).',
    )
  })

  it('speaks a region’s week from its components, with the verdict', async () => {
    const a = await answer('Hur gick amerikanska börsen i veckan?', history)
    expect(marketAnswerSpeech(a)).toBe(
      'S&P 500 är upp 1,59 procent den här veckan och Nasdaq 100 upp 0,8. USA-börsen har alltså en positiv vecka.',
    )
    expect(marketAnswerText(a)).toContain('USA-börsen har en positiv vecka.')
  })

  it('speaks a yield in basis points, to its level — never as a return', async () => {
    const a = await answer('Vad gjorde amerikanska tioåringen i veckan?', history)
    expect(marketAnswerSpeech(a)).toBe(
      'USA:s tioårsränta är upp 14 baspunkter den här veckan, till 5,28 procent.',
    )
    expect(marketAnswerText(a)).not.toMatch(/procent den här veckan \(/)
  })

  it('compares two indices over the same week in percentage points', async () => {
    const nasdaqWeek: MarketConversation = {
      symbols: [SYM_NASDAQ100],
      region: null,
      period: { kind: 'range', range: 'this-week' },
    }
    const a = await answer('Jämför med S&P.', history, nasdaqWeek)
    expect(marketAnswerSpeech(a)).toBe(
      'Nasdaq 100 är upp 0,8 procent den här veckan mot S&P 500:s 1,59, alltså 0,79 procentenheter mindre.',
    )
    expect(marketAnswerText(a)).toContain(
      'Nasdaq 100 efter S&P 500 med 0,79 procentenheter.',
    )
    const best = await answer('Vilken gick bäst?', history, {
      symbols: [SYM_NASDAQ100, SYM_SP500],
      region: null,
      period: { kind: 'range', range: 'this-week' },
    })
    expect(marketAnswerSpeech(best)).toBe(
      'Bäst den här veckan gick S&P 500, som är upp 1,59 procent; Nasdaq 100 är upp 0,8 procent.',
    )
  })

  it('answers a region from the components it has and names the one it cannot verify', async () => {
    const one: MarketHistorySource = {
      series: async (symbol) =>
        symbol === SYM_SP500
          ? history.series(symbol, { from: '2026-09-01', to: '2026-10-02' })
          : {
              state: 'error',
              error: {
                code: 'network',
                message: 'down',
                providerId: 'yahoo',
                retryable: true,
              },
            },
    }
    const a = await answer('Hur gick amerikanska börsen i veckan?', one)
    expect(marketAnswerSpeech(a)).toBe(
      'S&P 500 är upp 1,59 procent den här veckan. Indexet står senast i 7 772. Jag kan inte verifiera en komplett veckoserie för Nasdaq 100 just nu. Dagens förändring: Nasdaq 100 upp 0,7 procent.',
    )
  })
})

describe('a period the series cannot serve', () => {
  it('says what it cannot verify and offers today as today — never the day as the week', async () => {
    const down: MarketHistorySource = {
      series: async () => ({
        state: 'error',
        error: { code: 'network', message: 'down', providerId: 'yahoo', retryable: true },
      }),
    }
    const a = await answer('Hur gick S&P 500 i veckan?', down)
    expect(marketAnswerSpeech(a)).toBe(
      'Jag kan inte verifiera en komplett veckoserie för S&P 500 just nu. Dagens förändring: S&P 500 upp 0,42 procent.',
    )
    const text = marketAnswerText(a)
    expect(text).toContain(
      'Jag kan inte verifiera en komplett veckoserie för S&P 500 just nu.',
    )
    expect(text).toContain('Idag: S&P 500 ligger på 7 772 just nu, upp 0,42 procent idag')
    expect(text).not.toMatch(/den här veckan \(/)
    expect(text).not.toMatch(FORBIDDEN)
  })

  it('says what data it has when no source exists at all, and names a month by its name', async () => {
    const a = await answer('Hur gick S&P 500 i veckan?', null)
    expect(marketAnswerText(a)).toContain(
      'Jag har dagens S&P 500-data, men inte en komplett veckoserie i den här datakällan.',
    )
    const september = await answer('Hur gick USA i september?', null)
    expect(marketAnswerText(september)).toContain(
      'Jag har dagens data för S&P 500 och Nasdaq 100, men inte en komplett serie för september i den här datakällan.',
    )
    const yesterday = await answer('Hur gick S&P 500 igår?', null)
    expect(marketAnswerText(yesterday)).toContain(
      'men ingen serie för igår i den här datakällan',
    )
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
