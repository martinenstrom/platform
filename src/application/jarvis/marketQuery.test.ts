/**
 * The market family of questions, in an advisor's words: instruments by
 * their aliases, regions, periods, and the follow-ups a conversation
 * carries — recognised deterministically, and refused where judgement,
 * reasoning or a client sentence is what the line is.
 */

import { describe, expect, it } from 'vitest'
import {
  SYM_DAX,
  SYM_DE10Y,
  SYM_DJIA,
  SYM_FTSE100,
  SYM_NASDAQ100,
  SYM_OMXS30,
  SYM_RUSSELL2000,
  SYM_SE10Y,
  SYM_SP500,
  SYM_US10Y,
  SYM_US2Y,
} from '~/domain/market'
import {
  conversationAfter,
  recognizeMarketQuery,
  resolvePeriod,
  scopeForQuery,
  type MarketConversation,
  type MarketQueryOptions,
} from './marketQuery'

const NOW = new Date('2026-10-03T10:00:00.000Z')
const market = (conversation: MarketConversation | null = null): MarketQueryOptions => ({
  scope: 'MARKET',
  conversation,
  now: NOW,
})
const client = (conversation: MarketConversation | null = null): MarketQueryOptions => ({
  scope: 'CLIENT',
  conversation,
  now: NOW,
})
const ask = (text: string, options: MarketQueryOptions = market()) =>
  recognizeMarketQuery(text, options)

describe('instrument aliases', () => {
  it('resolves every way an advisor says S&P 500 to the one index', () => {
    for (const line of [
      'Hur gick S&P 500?',
      'Hur gick sp500?',
      'Hur gick SP 500?',
      'Hur gick S&P?',
      'Hur gick S&P500 idag?',
      'Vad gjorde SPX?',
      'Hur gick amerikanska storbolagen idag?',
      'Hur gick ess och pe 500?',
    ]) {
      const query = ask(line)
      expect(query?.kind, line).toBe('MARKET_INDEX_PERFORMANCE')
      expect(query?.symbols, line).toEqual([SYM_SP500])
      expect(query?.period, line).toEqual({ kind: 'today' })
    }
  })

  it('resolves Nasdaq, Nasdaq 100 and NDX to the served Nasdaq series', () => {
    for (const line of [
      'Vad gjorde Nasdaq?',
      'Hur gick Nasdaq 100?',
      'Hur gick NDX idag?',
      'Hur går Nasdaq-100?',
    ]) {
      expect(ask(line)?.symbols, line).toEqual([SYM_NASDAQ100])
    }
  })

  it('resolves the Dow and the Russell to their history-served indices, never to a guess', () => {
    const dow = ask('Hur gick Dow Jones i veckan?')
    expect(dow?.kind).toBe('MARKET_INDEX_PERFORMANCE')
    expect(dow?.symbols).toEqual([SYM_DJIA])
    expect(dow?.notServed).toEqual([])
    expect(ask('Hur gick Russell 2000 i år?')?.symbols).toEqual([SYM_RUSSELL2000])
  })
})

describe('a ranking over an inferred universe', () => {
  it('"Vad gick bäst?" after one US index ranks the four US majors over the same period', () => {
    const spLastWeek = conversationAfter(ask('Hur gick S&P 500 förra veckan?')!)
    const best = ask('Vad gick bäst?', market(spLastWeek))
    expect(best?.kind).toBe('MARKET_BEST')
    expect(best?.universe).toBe('us-majors')
    expect(best?.symbols).toEqual([SYM_SP500, SYM_NASDAQ100, SYM_DJIA, SYM_RUSSELL2000])
    expect(best?.region).toBe('us')
    expect(best?.period).toEqual({ kind: 'range', range: '1w' })
    expect(best?.superlative).toBe('best')
    /* The thread now covers the four, so "och i år?" ranks them over the year. */
    const after = conversationAfter(best!)
    expect(after.symbols).toHaveLength(4)
    expect(ask('Vad gick sämst i år?', market(after))?.superlative).toBe('worst')
  })

  it('after a European index the universe is Europe’s majors; after a US region, the US majors', () => {
    const omx = conversationAfter(ask('Hur gick OMXS30 i veckan?')!)
    expect(ask('Vilken gick bäst?', market(omx))?.universe).toBe('europe-majors')
    const us = conversationAfter(ask('Hur gick amerikanska börsen i veckan?')!)
    expect(ask('Vad gick bäst?', market(us))?.symbols).toEqual([
      SYM_SP500,
      SYM_NASDAQ100,
      SYM_DJIA,
      SYM_RUSSELL2000,
    ])
  })

  it('over today the universe is the region’s live-quoted indices, since the Dow and the Russell have no quote', () => {
    const spToday = conversationAfter(ask('Hur gick S&P 500 idag?')!)
    const best = ask('Vad gick bäst?', market(spToday))
    expect(best?.universe).toBe('us-majors')
    expect(best?.symbols).toEqual([SYM_SP500, SYM_NASDAQ100])
    expect(best?.period).toEqual({ kind: 'today' })
  })

  it('with nothing to infer the universe from, asks one question back — and "ja" or "Europa" completes it', () => {
    const cold = ask('Vad gick bäst förra veckan?')
    expect(cold?.kind).toBe('MARKET_CLARIFY')
    expect(cold?.clarification).toBe('Menar du bland de stora USA-indexen?')
    const waiting = conversationAfter(cold!)
    expect(waiting.pending).toEqual({
      kind: 'best-universe',
      superlative: 'best',
      period: { kind: 'range', range: '1w' },
    })
    const yes = ask('Ja', market(waiting))
    expect(yes?.kind).toBe('MARKET_BEST')
    expect(yes?.universe).toBe('us-majors')
    expect(yes?.period).toEqual({ kind: 'range', range: '1w' })
    const europe = ask('Europa', market(waiting))
    expect(europe?.universe).toBe('europe-majors')
    expect(europe?.symbols).toEqual([SYM_DAX, SYM_FTSE100, SYM_OMXS30])
    /* A rates thread ranks the rates it covered, in basis points — the thread is wide enough. */
    const rates = conversationAfter(ask('Vad hände med räntorna?')!)
    const mostUp = ask('Vilken steg mest?', market(rates))
    expect(mostUp?.kind).toBe('MARKET_BEST')
    expect(mostUp?.universe).toBeUndefined()
    expect(mostUp?.symbols).toEqual(rates.symbols)
  })

  it('on a client page with no market conversation, the line is not the market’s', () => {
    expect(ask('Vad gick bäst?', client())).toBeNull()
  })
})

describe('regions', () => {
  it('reads the US market as S&P 500 and Nasdaq 100', () => {
    for (const line of [
      'Hur gick amerikanska börsen idag?',
      'Hur gick USA-börsen?',
      'Hur gick börsen i USA?',
      'Hur går USA?',
      'Hur ser amerikanska börsen ut idag?',
    ]) {
      const query = ask(line)
      expect(query?.kind, line).toBe('MARKET_REGION_PERFORMANCE')
      expect(query?.region, line).toBe('us')
      expect(query?.symbols, line).toEqual([SYM_SP500, SYM_NASDAQ100])
    }
  })

  it('reads Europe and Sweden as their indices', () => {
    expect(ask('Hur gick Europa idag?')?.symbols).toEqual([
      SYM_DAX,
      SYM_FTSE100,
      SYM_OMXS30,
    ])
    expect(ask('Hur gick börsen i Sverige?')?.symbols).toEqual([SYM_OMXS30])
    expect(scopeForQuery(ask('Hur gick Europa idag?')!)).toBe('europe')
  })

  it('is a region question over a week when the line says the week', () => {
    for (const line of [
      'Hur gick amerikanska börsen i veckan?',
      'Hur har USA gått i veckan?',
      'Vad har amerikanska börsen gjort senaste veckan?',
    ]) {
      const query = ask(line)
      expect(query?.kind, line).toBe('MARKET_REGION_PERFORMANCE')
      expect(query?.period.kind, line).toBe('range')
      expect(['this-week', '1w']).toContain((query?.period as { range: string }).range)
      expect(query?.explicit, line).toEqual({ subject: true, period: true })
    }
  })

  it('resolves a named month to the calendar month, this year or last', () => {
    expect(ask('Hur gick USA i september?')?.period).toEqual({
      kind: 'month',
      year: 2026,
      month: 9,
    })
    expect(ask('Hur gick S&P 500 i december?')?.period).toEqual({
      kind: 'month',
      year: 2025,
      month: 12,
    })
  })
})

describe('periods', () => {
  it('maps the Swedish period expressions to the series ranges, and never the week to today', () => {
    const cases: [string, unknown][] = [
      ['idag', { kind: 'today' }],
      ['i dag', { kind: 'today' }],
      ['just nu', { kind: 'today' }],
      /* The week under way, seven days back and five sessions are three different periods. */
      ['den här veckan', { kind: 'range', range: 'this-week' }],
      ['i veckan', { kind: 'range', range: 'this-week' }],
      ['senaste veckan', { kind: 'range', range: '1w' }],
      ['förra veckan', { kind: 'range', range: '1w' }],
      ['5 dagar', { kind: 'range', range: '5d' }],
      ['senaste 5 handelsdagarna', { kind: 'range', range: '5d' }],
      /* Month to date against a month back. */
      ['den här månaden', { kind: 'range', range: 'mtd' }],
      ['senaste månaden', { kind: 'range', range: '1m' }],
      ['i år', { kind: 'range', range: 'ytd' }],
      ['YTD', { kind: 'range', range: 'ytd' }],
      ['sedan årsskiftet', { kind: 'range', range: 'ytd' }],
      ['senaste kvartalet', { kind: 'range', range: '3m' }],
      ['senaste året', { kind: 'range', range: '1y' }],
      ['igår', { kind: 'unsupported', label: 'igår' }],
    ]
    for (const [words, period] of cases) {
      expect(resolvePeriod(`Hur gick S&P 500 ${words}?`, NOW), words).toEqual(period)
    }
    expect(resolvePeriod('Hur gick S&P 500?', NOW)).toBeNull()
  })

  it('means today for a full question with a subject and no period, however short', () => {
    const weekly: MarketConversation = {
      symbols: [SYM_SP500],
      region: null,
      period: { kind: 'range', range: '1w' },
    }
    expect(ask('Hur gick S&P 500?', market(weekly))?.period).toEqual({ kind: 'today' })
    expect(ask('Hur gick sp500?', market(weekly))?.period).toEqual({ kind: 'today' })
    expect(ask('Vad gjorde Nasdaq?', market(weekly))?.period).toEqual({ kind: 'today' })
    /* A fragment leans on the conversation. */
    expect(ask('Nasdaq?', market(weekly))?.period).toEqual({ kind: 'range', range: '1w' })
  })
})

describe('follow-ups in a market conversation', () => {
  const sp500Today: MarketConversation = {
    symbols: [SYM_SP500],
    region: null,
    period: { kind: 'today' },
  }

  it('"Och Nasdaq?" keeps the period and changes the instrument', () => {
    const query = ask('Och Nasdaq?', market(sp500Today))
    expect(query?.kind).toBe('MARKET_INDEX_PERFORMANCE')
    expect(query?.symbols).toEqual([SYM_NASDAQ100])
    expect(query?.period).toEqual({ kind: 'today' })
    expect(query?.explicit).toEqual({ subject: true, period: false })
  })

  it('"Och Nasdaq?" widens the thread, so "Vilken gick bäst?" ranks both; a whole question narrows it again', () => {
    const spWeek = conversationAfter(ask('Hur gick S&P 500 i veckan?')!)
    expect(spWeek).toEqual({
      symbols: [SYM_SP500],
      region: null,
      period: { kind: 'range', range: 'this-week' },
    })
    /* The subject is Nasdaq; the thread is both — as the browser carries it, not as a test builds it. */
    const nasdaq = conversationAfter(ask('Och Nasdaq?', market(spWeek))!)
    expect(nasdaq.symbols).toEqual([SYM_NASDAQ100])
    expect(nasdaq.set).toEqual([SYM_SP500, SYM_NASDAQ100])
    const best = ask('Vilken gick bäst?', market(nasdaq))
    expect(best?.kind).toBe('MARKET_BEST')
    expect(best?.symbols).toEqual([SYM_SP500, SYM_NASDAQ100])
    expect(best?.period).toEqual({ kind: 'range', range: 'this-week' })
    /* "Och i år?" moves the period and keeps the thread. */
    const year = conversationAfter(ask('Och i år?', market(nasdaq))!)
    expect(year.symbols).toEqual([SYM_NASDAQ100])
    expect(year.set).toEqual([SYM_SP500, SYM_NASDAQ100])
    expect(year.period).toEqual({ kind: 'range', range: 'ytd' })
    expect(ask('Vilken gick bäst?', market(year))?.symbols).toEqual([
      SYM_SP500,
      SYM_NASDAQ100,
    ])
    /* A whole question is a new subject: the thread narrows to DAX, and a ranking after it is Europe's majors. */
    const dax = conversationAfter(ask('Hur gick DAX i veckan?', market(nasdaq))!)
    expect(dax).toEqual({
      symbols: [SYM_DAX],
      region: null,
      period: { kind: 'range', range: 'this-week' },
    })
    const europe = ask('Vilken gick bäst?', market(dax))
    expect(europe?.universe).toBe('europe-majors')
    expect(europe?.symbols).not.toContain(SYM_NASDAQ100)
  })

  it('"Och i veckan?" keeps the instrument and changes the period', () => {
    const nasdaqToday = conversationAfter(ask('Och Nasdaq?', market(sp500Today))!)
    const query = ask('Och i veckan?', market(nasdaqToday))
    expect(query?.kind).toBe('MARKET_INDEX_PERFORMANCE')
    expect(query?.symbols).toEqual([SYM_NASDAQ100])
    expect(query?.period).toEqual({ kind: 'range', range: 'this-week' })
    expect(query?.explicit).toEqual({ subject: false, period: true })
  })

  it('"Jämför med S&P." compares the conversation’s instrument with the named one over the same period', () => {
    const nasdaqWeek: MarketConversation = {
      symbols: [SYM_NASDAQ100],
      region: null,
      period: { kind: 'range', range: '1w' },
    }
    const query = ask('Jämför med S&P.', market(nasdaqWeek))
    expect(query?.kind).toBe('MARKET_COMPARE')
    expect(query?.symbols).toEqual([SYM_NASDAQ100, SYM_SP500])
    expect(query?.period).toEqual({ kind: 'range', range: '1w' })
  })

  it('"Vilken gick bäst?" ranks what the conversation is about over its period', () => {
    const both: MarketConversation = {
      symbols: [SYM_NASDAQ100, SYM_SP500],
      region: null,
      period: { kind: 'range', range: '1w' },
    }
    const query = ask('Vilken gick bäst?', market(both))
    expect(query?.kind).toBe('MARKET_BEST')
    expect(query?.superlative).toBe('best')
    expect(query?.symbols).toEqual([SYM_NASDAQ100, SYM_SP500])
    expect(query?.period).toEqual({ kind: 'range', range: '1w' })
    expect(ask('Vilken gick sämst?', market(both))?.superlative).toBe('worst')
  })

  it('"Och i veckan?" after a region question stays a region question', () => {
    const usToday = conversationAfter(ask('Hur gick amerikanska börsen idag?')!)
    const query = ask('Och i veckan?', market(usToday))
    expect(query?.kind).toBe('MARKET_REGION_PERFORMANCE')
    expect(query?.region).toBe('us')
    expect(query?.period).toEqual({ kind: 'range', range: 'this-week' })
  })

  it('"Och Europa?" after a weekly question is Europe over the week', () => {
    const usWeek: MarketConversation = {
      symbols: [SYM_SP500, SYM_NASDAQ100],
      region: 'us',
      period: { kind: 'range', range: '1w' },
    }
    const query = ask('Och Europa?', market(usWeek))
    expect(query?.region).toBe('europe')
    expect(query?.period).toEqual({ kind: 'range', range: '1w' })
  })

  it('explicit terms always win over the conversation', () => {
    const nasdaqWeek: MarketConversation = {
      symbols: [SYM_NASDAQ100],
      region: null,
      period: { kind: 'range', range: '1w' },
    }
    const query = ask('Hur gick S&P 500 i år?', market(nasdaqWeek))
    expect(query?.symbols).toEqual([SYM_SP500])
    expect(query?.period).toEqual({ kind: 'range', range: 'ytd' })
  })

  it('has nothing to continue without a conversation — except a ranking, which asks one question back on the market', () => {
    expect(ask('Och i veckan?')).toBeNull()
    expect(ask('Jämför med S&P.')).toBeNull()
    expect(ask('Vilken gick bäst?')?.kind).toBe('MARKET_CLARIFY')
    expect(ask('Vilken gick bäst?', client())).toBeNull()
  })
})

describe('rates and the market as a whole', () => {
  it('reads "räntorna" as the rates of the conversation’s region, else every region’s', () => {
    expect(ask('Vad hände med räntorna?')?.kind).toBe('MARKET_RATES')
    expect(ask('Vad hände med räntorna?')?.symbols).toEqual([
      SYM_US10Y,
      SYM_US2Y,
      SYM_DE10Y,
      SYM_SE10Y,
    ])
    const us: MarketConversation = {
      symbols: [SYM_SP500, SYM_NASDAQ100],
      region: 'us',
      period: { kind: 'today' },
    }
    expect(ask('Vad hände med räntorna?', market(us))?.symbols).toEqual([
      SYM_US10Y,
      SYM_US2Y,
    ])
    expect(ask('Hur gick de amerikanska räntorna?')?.symbols).toEqual([
      SYM_US10Y,
      SYM_US2Y,
    ])
  })

  it('answers a generic question from market scope with the market as a whole', () => {
    for (const line of [
      'Vad händer idag?',
      'Vad sticker ut?',
      'Hur ser läget ut?',
      'Hur gick börsen idag?',
    ]) {
      expect(ask(line)?.kind, line).toBe('MARKET_OVERVIEW')
    }
  })

  it('does not take a generic question away from a client page, or from nowhere in particular', () => {
    expect(ask('Vad händer idag?', client())).toBeNull()
    expect(ask('Vad sticker ut?', client())).toBeNull()
    expect(
      ask('Vad händer idag?', { scope: 'GLOBAL', conversation: null, now: NOW }),
    ).toBeNull()
    expect(
      ask('Hur ser det ut där borta just nu?', {
        scope: 'GLOBAL',
        conversation: null,
        now: NOW,
      }),
    ).toBeNull()
  })
})

describe('precedence and refusals', () => {
  it('lets a clearly named instrument win over the client on screen', () => {
    const query = ask('Hur gick S&P 500 idag?', client())
    expect(query?.kind).toBe('MARKET_INDEX_PERFORMANCE')
    expect(ask('Hur gick amerikanska börsen i veckan?', client())?.kind).toBe(
      'MARKET_REGION_PERFORMANCE',
    )
  })

  it('lets a bare period follow-up stay the market’s on a client page when a market conversation is under way', () => {
    const sp500: MarketConversation = {
      symbols: [SYM_SP500],
      region: null,
      period: { kind: 'today' },
    }
    expect(ask('Och i veckan?', client(sp500))?.symbols).toEqual([SYM_SP500])
  })

  it('leaves a client sentence that merely mentions a region or an instrument alone', () => {
    expect(ask('Kunden har bolag i USA.', client())).toBeNull()
    expect(ask('De äger Nasdaq-aktier via fonden.', client())).toBeNull()
    expect(ask('Vad har de i totalförmögenhet?', client())).toBeNull()
  })

  it('refuses judgement, reasoning and meaning, whatever instrument the line names', () => {
    for (const line of [
      'Ska jag köpa S&P 500?',
      'Borde jag minska min USA-exponering?',
      'Varför föll Nasdaq i veckan?',
      'Vad betyder högre tioårsränta för tech?',
      'Tror du dollarn stärks framöver?',
      'Är S&P 500 attraktiv på 12–24 månader?',
    ]) {
      expect(ask(line), line).toBeNull()
    }
  })

  it('answers several named instruments at once, over the period said', () => {
    const query = ask('Hur gick S&P 500 och Nasdaq i veckan?')
    expect(query?.symbols).toEqual([SYM_SP500, SYM_NASDAQ100])
    expect(query?.period).toEqual({ kind: 'range', range: 'this-week' })
  })
})
