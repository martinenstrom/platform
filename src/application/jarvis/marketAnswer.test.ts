/**
 * The structured market answer: today from the brief, a period from the
 * series by the kind of instrument, what is missing named with today's
 * figure beside it as today's — and never the day's change passed off as
 * the period's. The acceptance sequence of Historical Market Data V1 is
 * here: the week, "och Nasdaq?", "vilken gick bäst?", the ten-year in
 * basis points, September, the year.
 */

import { describe, expect, it } from 'vitest'
import {
  SYM_DJIA,
  SYM_NASDAQ100,
  SYM_RUSSELL2000,
  SYM_SP500,
  SYM_US10Y,
} from '~/domain/market'
import { answerMarketQuery } from './marketAnswer'
import {
  briefFixture,
  FIXTURE_NOW,
  usMajorsHistoryFixture,
  weekHistoryFixture,
} from './marketAnswer.fixture'
import type { MarketScope } from './marketBrief'
import type { MarketHistorySource } from './marketHistory'
import {
  conversationAfter,
  recognizeMarketQuery,
  type MarketConversation,
} from './marketQuery'

const deps = (source: MarketHistorySource | null) => ({
  brief: async (scope: MarketScope) => briefFixture(scope),
  history: source,
  now: () => FIXTURE_NOW,
})
const query = (text: string, conversation: MarketConversation | null = null) =>
  recognizeMarketQuery(text, { scope: 'MARKET', conversation, now: FIXTURE_NOW })!

describe('the regression: "Vad gick bäst?" is answered or asked back, never refused', () => {
  it('after "Hur gick S&P 500 förra veckan?" ranks the four US majors over that week', async () => {
    const week = await answerMarketQuery(
      query('Hur gick S&P 500 förra veckan?'),
      deps(usMajorsHistoryFixture),
    )
    expect(week.items[0]!.changePercent).toBeCloseTo(-0.27, 2)
    const best = await answerMarketQuery(
      query('Vad gick bäst?', week.conversation),
      deps(usMajorsHistoryFixture),
    )
    expect(best.kind).toBe('MARKET_BEST')
    expect(best.universe).toBe('us-majors')
    expect(best.items.map((item) => item.symbol)).toEqual([
      SYM_SP500,
      SYM_NASDAQ100,
      SYM_DJIA,
      SYM_RUSSELL2000,
    ])
    expect(best.best?.symbol).toBe(SYM_NASDAQ100)
    expect(best.best?.changePercent).toBeCloseTo(0.65, 2)
    expect(best.worst?.symbol).toBe(SYM_RUSSELL2000)
    expect(best.missing).toEqual([])
  })

  it('with nothing to infer from, the answer is the one question back', async () => {
    const cold = await answerMarketQuery(query('Vad gick bäst?'), deps(null))
    expect(cold.kind).toBe('MARKET_CLARIFY')
    expect(cold.clarification).toBe('Menar du bland de stora USA-indexen?')
    expect(cold.conversation.pending?.kind).toBe('best-universe')
  })

  it('today, the Dow is honestly without a quote while a period is served', async () => {
    const today = await answerMarketQuery(query('Hur gick Dow Jones idag?'), deps(null))
    expect(today.missing).toEqual([
      { symbol: SYM_DJIA, name: 'Dow Jones', reason: 'no-live-quote' },
    ])
    const week = await answerMarketQuery(
      query('Hur gick Dow Jones förra veckan?'),
      deps(usMajorsHistoryFixture),
    )
    expect(week.items[0]!.changePercent).toBeCloseTo(0.3, 2)
  })
})

describe('today', () => {
  it('answers a named instrument from the brief, with its provenance', async () => {
    const answer = await answerMarketQuery(query('Hur gick S&P 500?'), deps(null))
    expect(answer.kind).toBe('MARKET_INDEX_PERFORMANCE')
    expect(answer.items).toMatchObject([
      {
        symbol: SYM_SP500,
        changePercent: 0.42,
        level: 7772,
        source: 'Yahoo Finance',
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

describe('the week, from a real series', () => {
  it('"Hur gick S&P 500 i veckan?": from last Friday’s 7 650 to 7 772, measured, never today’s change', async () => {
    const answer = await answerMarketQuery(
      query('Hur gick S&P 500 i veckan?'),
      deps(weekHistoryFixture),
    )
    expect(answer.period).toEqual({ kind: 'range', range: 'this-week' })
    const [sp] = answer.items
    expect(sp).toMatchObject({
      symbol: SYM_SP500,
      metric: 'price',
      changePeriod: 'period',
      start: { date: '2026-09-25', value: 7650 },
      end: { date: '2026-10-02', value: 7772 },
      sessions: 5,
      source: 'Yahoo Finance',
      latestIsStale: false,
    })
    expect(sp!.changePercent).toBeCloseTo((7772 / 7650 - 1) * 100, 6)
    expect(sp!.changePercent).not.toBeCloseTo(0.42, 2)
    expect(sp!.spark).toEqual([7650, 7700, 7680, 7710, 7740, 7772])
    expect(answer.missing).toEqual([])
    expect(answer.todayOf).toEqual([])
  })

  it('"Och Nasdaq?" is the same week for Nasdaq; "Vilken gick bäst?" ranks both over it', async () => {
    const week = await answerMarketQuery(
      query('Hur gick S&P 500 i veckan?'),
      deps(weekHistoryFixture),
    )
    const nasdaq = await answerMarketQuery(
      query('Och Nasdaq?', week.conversation),
      deps(weekHistoryFixture),
    )
    expect(nasdaq.period).toEqual({ kind: 'range', range: 'this-week' })
    expect(nasdaq.items[0]!.symbol).toBe(SYM_NASDAQ100)
    expect(nasdaq.items[0]!.changePercent).toBeCloseTo(0.8, 2)
    /* Over the conversation as the answer hands it back — not one built by hand — the thread is both. */
    expect(nasdaq.conversation.set).toEqual([SYM_SP500, SYM_NASDAQ100])
    const best = await answerMarketQuery(
      query('Vilken gick bäst?', nasdaq.conversation),
      deps(weekHistoryFixture),
    )
    expect(best.kind).toBe('MARKET_BEST')
    expect(best.items.map((item) => item.symbol)).toEqual([SYM_SP500, SYM_NASDAQ100])
    expect(best.best?.symbol).toBe(SYM_SP500)
    expect(best.worst?.symbol).toBe(SYM_NASDAQ100)
  })

  it('"Jämför dem" over the week: two returns, the same end, and the gap in percentage points', async () => {
    const both: MarketConversation = {
      symbols: [SYM_NASDAQ100],
      region: null,
      period: { kind: 'range', range: 'this-week' },
    }
    const answer = await answerMarketQuery(
      query('Jämför med S&P.', both),
      deps(weekHistoryFixture),
    )
    expect(answer.kind).toBe('MARKET_COMPARE')
    expect(answer.comparison?.a.symbol).toBe(SYM_NASDAQ100)
    expect(answer.comparison?.b.symbol).toBe(SYM_SP500)
    expect(answer.comparison?.a.end?.date).toBe(answer.comparison?.b.end?.date)
    expect(answer.comparison?.differencePercentagePoints).toBeCloseTo(
      0.8 - (7772 / 7650 - 1) * 100,
      4,
    )
  })

  it('"Vad gjorde amerikanska tioåringen i veckan?": a change in basis points, not a return', async () => {
    const answer = await answerMarketQuery(
      query('Vad gjorde amerikanska tioåringen i veckan?'),
      deps(weekHistoryFixture),
    )
    expect(answer.kind).toBe('MARKET_INDEX_PERFORMANCE')
    const [ten] = answer.items
    expect(ten).toMatchObject({
      symbol: SYM_US10Y,
      metric: 'yield',
      changePercent: null,
      level: 5.28,
      source: 'U.S. Treasury',
    })
    expect(ten!.changeBasisPoints).toBeCloseTo(14, 6)
  })

  it('answers a region over the week from the components it has, and names the one it has not', async () => {
    const answer = await answerMarketQuery(
      query('Hur gick Europa i veckan?'),
      deps(weekHistoryFixture),
    )
    expect(answer.items).toEqual([])
    expect(answer.missing.map((entry) => [entry.name, entry.reason])).toEqual([
      ['DAX', 'no-series'],
      ['FTSE 100', 'no-series'],
      ['OMXS30', 'no-series'],
    ])
    const us = await answerMarketQuery(
      query('Hur gick amerikanska börsen i veckan?'),
      deps(weekHistoryFixture),
    )
    expect(us.items.map((item) => item.symbol)).toEqual([SYM_SP500, SYM_NASDAQ100])
    expect(us.best?.symbol).toBe(SYM_SP500)
  })
})

describe('a period the series cannot serve', () => {
  it('names what is missing and offers today’s figure as today’s, never as the period’s', async () => {
    const answer = await answerMarketQuery(
      query('Hur gick amerikanska börsen i veckan?'),
      deps(null),
    )
    expect(answer.items).toEqual([])
    expect(answer.missing.map((entry) => [entry.name, entry.reason])).toEqual([
      ['S&P 500', 'no-history-source'],
      ['Nasdaq 100', 'no-history-source'],
    ])
    expect(
      answer.todayOf.map((item) => [item.symbol, item.period, item.changePercent]),
    ).toEqual([
      [SYM_SP500, { kind: 'today' }, 0.42],
      [SYM_NASDAQ100, { kind: 'today' }, 0.7],
    ])
  })

  it('says a named month is missing when no series covers it, and the year likewise', async () => {
    const september = await answerMarketQuery(
      query('Hur gick S&P i september?'),
      deps(weekHistoryFixture),
    )
    expect(september.period).toEqual({ kind: 'month', year: 2026, month: 9 })
    expect(september.missing.map((entry) => entry.reason)).toEqual([
      'insufficient-coverage',
    ])
    expect(september.todayOf).toHaveLength(1)
    const year = await answerMarketQuery(
      query('Hur har S&P gått i år?'),
      deps(weekHistoryFixture),
    )
    expect(year.period).toEqual({ kind: 'range', range: 'ytd' })
    expect(year.missing.map((entry) => entry.reason)).toEqual(['insufficient-coverage'])
  })

  it('answers September and the year when the series reaches', async () => {
    const dates: string[] = []
    const cursor = new Date('2025-12-29T00:00:00.000Z')
    while (dates.length < 200) {
      const day = cursor.getUTCDay()
      if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    const { buildProvenance, buildSeries } = await import('~/domain/market')
    const long: MarketHistorySource = {
      series: async (symbol) => {
        const data = buildSeries({
          symbol,
          interval: '1d',
          points: dates.map((date, index) => ({
            t: `${date}T20:00:00.000Z`,
            v: 7000 + index,
          })),
          provenance: buildProvenance({
            asOf: '2026-10-02T14:59:40.000Z',
            nowMs: FIXTURE_NOW.getTime(),
            source: { providerId: 'yahoo', providerName: 'Yahoo Finance' },
            quality: 'delayed',
          }),
        })
        return { state: 'ok', data, provenance: data.provenance }
      },
    }
    const september = await answerMarketQuery(
      query('Hur gick S&P i september?'),
      deps(long),
    )
    expect(september.items[0]?.start?.date).toBe('2026-09-01')
    expect(september.items[0]?.end?.date).toBe('2026-09-30')
    const year = await answerMarketQuery(query('Hur har S&P gått i år?'), deps(long))
    expect(year.items[0]?.start?.date).toBe('2025-12-31')
    expect(year.items[0]?.end?.date).toBe('2026-10-02')
    expect(year.conversation.period).toEqual({ kind: 'range', range: 'ytd' })
    expect(conversationAfter(query('Hur har S&P gått i år?')).period).toEqual({
      kind: 'range',
      range: 'ytd',
    })
  })
})
