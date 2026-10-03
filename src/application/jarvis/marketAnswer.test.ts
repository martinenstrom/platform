/**
 * The structured market answer: today from the brief, a period from the
 * series, what is missing named with today's figure beside it as today's —
 * and never the day's change passed off as the period's.
 */

import { describe, expect, it } from 'vitest'
import { SYM_NASDAQ100, SYM_SP500, SYM_US10Y } from '~/domain/market'
import { answerMarketQuery } from './marketAnswer'
import { briefFixture, FIXTURE_NOW, weekHistoryFixture } from './marketAnswer.fixture'
import type { MarketScope } from './marketBrief'
import type { MarketHistorySource } from './marketHistory'
import { recognizeMarketQuery, type MarketConversation } from './marketQuery'

const deps = (source: MarketHistorySource | null) => ({
  brief: async (scope: MarketScope) => briefFixture(scope),
  history: source,
  now: () => FIXTURE_NOW,
})
const query = (text: string, conversation: MarketConversation | null = null) =>
  recognizeMarketQuery(text, { scope: 'MARKET', conversation, now: FIXTURE_NOW })!

describe('today', () => {
  it('answers a named instrument from the brief, with its provenance', async () => {
    const answer = await answerMarketQuery(query('Hur gick S&P 500?'), deps(null))
    expect(answer.kind).toBe('MARKET_INDEX_PERFORMANCE')
    expect(answer.items).toMatchObject([
      {
        symbol: SYM_SP500,
        changePercent: 0.42,
        level: 6512.3,
        source: 'Yahoo',
        changePeriod: 'intraday',
      },
    ])
    expect(answer.missing).toEqual([])
    expect(answer.conversation).toEqual({
      symbols: [SYM_SP500],
      region: null,
      period: { kind: 'today' },
    })
  })

  it('answers a region from its indices, and ranks them', async () => {
    const answer = await answerMarketQuery(
      query('Hur gick amerikanska börsen idag?'),
      deps(null),
    )
    expect(answer.kind).toBe('MARKET_REGION_PERFORMANCE')
    expect(answer.items.map((item) => item.symbol)).toEqual([SYM_SP500, SYM_NASDAQ100])
    expect(answer.best?.symbol).toBe(SYM_NASDAQ100)
    expect(answer.worst?.symbol).toBe(SYM_SP500)
  })

  it('answers the rates from the brief', async () => {
    const answer = await answerMarketQuery(query('Vad hände med räntorna?'), deps(null))
    expect(answer.kind).toBe('MARKET_RATES')
    expect(answer.rates.map((rate) => rate.symbol)).toEqual([SYM_US10Y])
  })
})

describe('a period', () => {
  it('answers the week from the series, never from today’s change', async () => {
    const answer = await answerMarketQuery(
      query('Hur gick amerikanska börsen i veckan?'),
      deps(weekHistoryFixture),
    )
    expect(answer.period).toEqual({ kind: 'range', range: '1w' })
    expect(
      answer.items.map((item) => [
        item.symbol,
        Number(item.changePercent!.toFixed(2)),
        item.changePeriod,
      ]),
    ).toEqual([
      [SYM_SP500, 1.4, 'period'],
      [SYM_NASDAQ100, 0.8, 'period'],
    ])
    expect(answer.missing).toEqual([])
    expect(answer.todayOf).toEqual([])
    expect(answer.best?.symbol).toBe(SYM_SP500)
  })

  it('names what the series cannot serve, and offers today’s figure as today’s', async () => {
    const answer = await answerMarketQuery(
      query('Hur gick amerikanska börsen i veckan?'),
      deps(null),
    )
    expect(answer.items).toEqual([])
    expect(answer.missing.map((entry) => [entry.name, entry.reason])).toEqual([
      ['S&P 500', 'no-history-source'],
      ['Nasdaq 100', 'no-history-source'],
    ])
    /* Today's figures travel apart, labelled today, so no renderer can mistake them for the week. */
    expect(
      answer.todayOf.map((item) => [item.symbol, item.period, item.changePercent]),
    ).toEqual([
      [SYM_SP500, { kind: 'today' }, 0.42],
      [SYM_NASDAQ100, { kind: 'today' }, 0.7],
    ])
    expect(
      answer.items.some(
        (item) => item.period.kind === 'range' && item.changePercent === 0.42,
      ),
    ).toBe(false)
  })

  it('answers a comparison over the conversation’s period', async () => {
    const nasdaqWeek: MarketConversation = {
      symbols: [SYM_NASDAQ100],
      region: null,
      period: { kind: 'range', range: '1w' },
    }
    const answer = await answerMarketQuery(
      query('Jämför med S&P.', nasdaqWeek),
      deps(weekHistoryFixture),
    )
    expect(answer.kind).toBe('MARKET_COMPARE')
    expect(answer.items.map((item) => item.symbol)).toEqual([SYM_NASDAQ100, SYM_SP500])
    expect(answer.best?.symbol).toBe(SYM_SP500)
  })

  it('says a named month is missing when no series covers it', async () => {
    const answer = await answerMarketQuery(
      query('Hur gick USA i september?'),
      deps(weekHistoryFixture),
    )
    expect(answer.period).toEqual({ kind: 'month', year: 2026, month: 9 })
    expect(answer.missing.map((entry) => entry.reason)).toEqual([
      'insufficient-coverage',
      'insufficient-coverage',
    ])
    expect(answer.todayOf).toHaveLength(2)
  })
})
