/**
 * The compact card: a period answer projected to strings the component only
 * renders — change, start, latest, span, source, the data's own time, the
 * sparkline — and nothing for today.
 */

import { describe, expect, it } from 'vitest'
import { answerMarketQuery } from '~/application/jarvis/marketAnswer'
import {
  briefFixture,
  FIXTURE_NOW,
  weekHistoryFixture,
} from '~/application/jarvis/marketAnswer.fixture'
import {
  recognizeMarketQuery,
  type MarketConversation,
} from '~/application/jarvis/marketQuery'
import { SYM_NASDAQ100 } from '~/domain/market'
import { marketCardOf } from './marketCard'

const answer = (text: string, conversation: MarketConversation | null = null) =>
  answerMarketQuery(
    recognizeMarketQuery(text, { scope: 'MARKET', conversation, now: FIXTURE_NOW })!,
    {
      brief: async (scope) => briefFixture(scope),
      history: weekHistoryFixture,
      now: () => FIXTURE_NOW,
    },
  )

describe('the market card', () => {
  it('projects a week to its block: change, start, latest, span, source, as-of, sparkline', async () => {
    const card = marketCardOf(await answer('Hur gick S&P 500 i veckan?'))!
    expect(card.items).toHaveLength(1)
    expect(card.items[0]).toMatchObject({
      name: 'S&P 500',
      periodLabel: 'DEN HÄR VECKAN',
      change: '+1,59 %',
      tone: 'up',
      start: { value: '7 650', date: '25 sep.' },
      latest: { value: '7 772', date: '2 okt.' },
      span: '25 sep. – 2 okt.',
      source: 'Yahoo Finance',
      asOf: 'Data t.o.m. 2 okt. 2026 16:59',
      spark: [7650, 7700, 7680, 7710, 7740, 7772],
      stale: null,
    })
    expect(card.missing).toEqual([])
    expect(card.difference).toBeNull()
  })

  it('shows a yield in basis points and a comparison’s gap', async () => {
    const ten = marketCardOf(await answer('Vad gjorde amerikanska tioåringen i veckan?'))!
    expect(ten.items[0]).toMatchObject({ change: '+14 bp', latest: { value: '5,28' } })
    const compare = marketCardOf(
      await answer('Jämför med S&P.', {
        symbols: [SYM_NASDAQ100],
        region: null,
        period: { kind: 'range', range: 'this-week' },
      }),
    )!
    expect(compare.items.map((item) => item.name)).toEqual(['Nasdaq 100', 'S&P 500'])
    expect(compare.difference).toBe('Nasdaq 100 efter S&P 500 med 0,79 procentenheter')
  })

  it('has no card for today, and names the components it could not verify', async () => {
    expect(marketCardOf(await answer('Hur gick S&P 500?'))).toBeNull()
    const europe = marketCardOf(await answer('Hur gick Europa i veckan?'))
    expect(europe).toBeNull()
  })
})
