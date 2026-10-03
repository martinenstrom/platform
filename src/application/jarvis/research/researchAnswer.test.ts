/**
 * The research answer end to end against a recording port: what left the
 * platform and what came back. The security tests of the brief are here —
 * no client name, id, figure or record vocabulary ever reaches the port,
 * a record-scope line never travels, a hybrid line is decomposed — beside
 * the web-failure, caching and evidence rules.
 */

import { describe, expect, it } from 'vitest'
import { SYM_NASDAQ100, SYM_SP500, SYM_US10Y } from '~/domain/market'
import type { JarvisScope } from '../context'
import { briefFixture, FIXTURE_NOW, weekHistoryFixture } from '../marketAnswer.fixture'
import type { MarketConversation } from '../marketQuery'
import { gatherEvidence } from './gather'
import { planFor } from './researchPlan'
import {
  CNBC_URL,
  FED_STATEMENT_URL,
  PLANTED_CLIENTS,
  PLANTED_VOCABULARY,
  recordingPort,
  REUTERS_URL,
} from './research.fixture'
import { answerResearchQuery, type ResearchAnswerDeps } from './researchAnswer'
import { createResearchCache } from './researchCache'
import { recognizeResearchQuery, type ResearchQueryOptions } from './researchQuery'

const NOW = FIXTURE_NOW
const usLastWeek: MarketConversation = {
  symbols: [SYM_SP500, SYM_NASDAQ100],
  region: 'us',
  period: { kind: 'range', range: 'this-week' },
}
const query = (text: string, over: Partial<ResearchQueryOptions> = {}) =>
  recognizeResearchQuery(text, {
    scope: 'MARKET',
    market: null,
    research: null,
    now: NOW,
    ...over,
  })!

const deps = (
  port: ReturnType<typeof recordingPort>['port'] | null,
  over: Partial<ResearchAnswerDeps> = {},
): ResearchAnswerDeps => ({
  port,
  vocabulary: async () => PLANTED_VOCABULARY,
  market: async (scope) => briefFixture(scope),
  history: weekHistoryFixture,
  now: () => NOW,
  ...over,
})

const PRIVATE =
  /henrik|alvarsson|dahlqvist|anna|per\b|cl-|miljoner|bolån|portfölj|strandvägen/i

describe('the security tests: nothing of the record reaches the port', () => {
  it('a hybrid line sends the typed market event only, and names the client for the private layer', async () => {
    const recording = recordingPort()
    const answer = await answerResearchQuery(
      query('Vad betyder dagens ränteuppgång för Anna?', { market: usLastWeek }),
      'MARKET',
      deps(recording.port),
    )
    expect(answer.clientReference).toEqual({
      id: 'cl-dahlqvist',
      displayName: 'Anna & Per Dahlqvist',
    })
    expect(answer.firewall).toEqual({
      lineIncluded: false,
      withheld: 'guard',
      violations: ['client-name'],
    })
    expect(recording.sent().length).toBeGreaterThan(0)
    for (const sent of recording.sent()) expect(sent, sent).not.toMatch(PRIVATE)
    for (const sent of answer.result.queries) expect(sent, sent).not.toMatch(PRIVATE)
  })

  it('a line with a client id, an amount or the record’s words is withheld and the typed query goes instead', async () => {
    for (const line of [
      'Varför föll Nasdaq för cl-alvarsson?',
      'Varför föll Nasdaq med 42 miljoner?',
      'Varför föll Nasdaq i portföljen?',
    ]) {
      const recording = recordingPort()
      const answer = await answerResearchQuery(
        query(line),
        'MARKET',
        deps(recording.port),
      )
      expect(answer.firewall.lineIncluded, line).toBe(false)
      expect(answer.firewall.withheld, line).toBe('guard')
      for (const sent of recording.sent()) expect(sent, line).not.toMatch(PRIVATE)
    }
  })

  it('in every record scope the advisor’s words never travel, however clean they are', async () => {
    for (const scope of [
      'CLIENT',
      'MEETING',
      'OFFICE',
      'CLIENT_DIRECTORY',
      'SENTINEL',
      'MARKET_IMPACT',
    ] as JarvisScope[]) {
      const recording = recordingPort()
      const answer = await answerResearchQuery(
        query('Varför föll Nasdaq i veckan?', { scope }),
        scope,
        deps(recording.port),
      )
      expect(answer.firewall, scope).toEqual({
        lineIncluded: false,
        withheld: 'record-scope',
        violations: [],
      })
      for (const call of recording.calls)
        if ('query' in call.request)
          expect(call.request.query, scope).not.toContain('Varför föll Nasdaq')
    }
  })

  it('from the market a clean line travels as the open-web query, in Swedish', async () => {
    const recording = recordingPort()
    const answer = await answerResearchQuery(
      query('Varför föll Nasdaq i veckan?'),
      'MARKET',
      deps(recording.port),
    )
    expect(answer.firewall.lineIncluded).toBe(true)
    const news = recording.calls.find((call) => call.method === 'searchNews')!
    /* "I veckan" is a freshness word: the search is a day's, whatever the period. */
    expect(news.request).toMatchObject({
      query: 'Varför föll Nasdaq i veckan?',
      locale: 'sv',
      freshness: 'day',
    })
  })

  it('an ambiguous first name names nobody and still withholds the line', async () => {
    const recording = recordingPort()
    const answer = await answerResearchQuery(
      query('Vad betyder dagens ränteuppgång för Henrik?', { market: usLastWeek }),
      'MARKET',
      deps(recording.port),
    )
    expect(answer.clientReference).toBeNull()
    expect(answer.firewall.lineIncluded).toBe(false)
    expect(
      PLANTED_CLIENTS.filter((c) => c.displayName.startsWith('Henrik')),
    ).toHaveLength(2)
  })
})

describe('evidence, support and confidence', () => {
  it('"Varför föll USA-börsen i veckan?": the platform’s numbers, then the cited claims in authority order', async () => {
    const recording = recordingPort()
    const answer = await answerResearchQuery(
      query('Varför föll USA-börsen i veckan?'),
      'MARKET',
      deps(recording.port),
    )
    expect(answer.marketFacts?.items.map((item) => item.symbol)).toEqual([
      SYM_SP500,
      SYM_NASDAQ100,
      SYM_US10Y,
    ])
    expect(answer.marketFacts?.items[2]!.changeBasisPoints).toBeCloseTo(14, 6)
    const urls = answer.result.evidence.map((item) => item.url)
    expect(urls).toEqual([REUTERS_URL, CNBC_URL])
    expect(answer.support.map((entry) => entry.claim.text)).toEqual([
      'S&P 500 pressas främst av högre långräntor efter den starkare jobbrapporten.',
      'Tech är den svagaste större sektorn.',
      'U.S. stocks fell on Friday as Treasury yields climbed after a stronger-than-expected jobs report.',
    ])
    /* The provider's uncited sentence is nowhere. */
    expect(JSON.stringify(answer.result)).not.toContain('gissning utan källa')
    expect(answer.confidence).toBe('STRONG_EVIDENCE')
    expect(answer.asOf).toBe('2026-10-02T14:40:00.000Z')
    expect(answer.context).toMatchObject({ region: 'us', evidenceIds: ['e1', 'e2'] })
  })

  it('a central-bank question opens the statement and reads the figure from the document itself', async () => {
    const recording = recordingPort()
    const answer = await answerResearchQuery(
      query('Vad sa Fed?'),
      'MARKET',
      deps(recording.port),
    )
    expect(recording.calls.map((call) => call.method)).toEqual([
      'searchOfficial',
      'retrieve',
      'searchNews',
    ])
    expect(recording.calls[0]!.request).toMatchObject({
      query: expect.stringMatching(/^fed-monetary:/),
      domains: ['federalreserve.gov'],
    })
    expect(recording.calls[1]!.request).toEqual({ url: FED_STATEMENT_URL })
    const fed = answer.result.evidence.find((item) => item.url === FED_STATEMENT_URL)!
    expect(fed).toMatchObject({
      sourceType: 'official',
      authority: 1,
      publisher: 'Federal Reserve',
    })
    expect(fed.claims[0]).toMatchObject({
      basis: 'retrieved',
      figure: { key: 'fed:policy-rate', unit: 'percent' },
    })
    expect(answer.support[0]!.evidenceId).toBe(fed.id)
    expect(answer.confidence).toBe('STRONG_EVIDENCE')
  })

  it('an unknown site ranks last and alone yields only mixed support', async () => {
    const recording = recordingPort({
      news: () => ({
        hits: [],
        narrative: null,
        provider: 'fixture',
        searchedAt: '2026-10-02T15:05:00.000Z',
      }),
    })
    const answer = await answerResearchQuery(
      query('Vad händer med dollarn?'),
      'MARKET',
      deps(recording.port),
    )
    expect(answer.result.evidence[0]).toMatchObject({ sourceType: 'other', authority: 6 })
    expect(answer.confidence).toBe('MIXED')
  })
})

describe('the platform’s own numbers for a rates question', () => {
  it('"Vad betyder dagens ränteuppgång?" opens with today’s rates from the brief, as the market tier states them', async () => {
    const recording = recordingPort()
    const answer = await answerResearchQuery(
      query('Vad betyder dagens ränteuppgång?', { market: usLastWeek }),
      'MARKET',
      deps(recording.port),
    )
    expect(answer.query.instruments).toEqual([SYM_US10Y, 'rate:us2y'])
    expect(answer.marketFacts?.kind).toBe('MARKET_RATES')
    expect(answer.marketFacts?.rates.map((rate) => rate.symbol)).toEqual([SYM_US10Y])
  })
})

describe('web failure and caching', () => {
  it('when every public step fails, the answer rests on the platform’s numbers and says research is unavailable', async () => {
    const recording = recordingPort({ fail: true })
    const answer = await answerResearchQuery(
      query('Varför föll USA-börsen i veckan?'),
      'MARKET',
      deps(recording.port),
    )
    expect(answer.unavailable).toBe(true)
    expect(answer.result.unavailable).toBe('public-research-unavailable')
    expect(answer.result.steps).toEqual({ run: 1, failed: 1 })
    expect(answer.marketFacts?.items.length).toBe(3)
    expect(answer.support).toEqual([])
    expect(answer.confidence).toBe('INSUFFICIENT')
  })

  it('with no port configured, research is disabled and nothing is attempted', async () => {
    const answer = await answerResearchQuery(query('Vad sa Fed?'), 'MARKET', deps(null))
    expect(answer.result.unavailable).toBe('public-research-disabled')
    expect(answer.result.steps).toEqual({ run: 0, failed: 0 })
  })

  it('the same question twice costs one search, and a freshness-critical question bypasses an aging entry', async () => {
    const recording = recordingPort()
    const cache = createResearchCache()
    let now = NOW
    const d = deps(recording.port, { cache, now: () => now })
    await answerResearchQuery(query('Vad sa Fed?'), 'MARKET', d)
    await answerResearchQuery(query('Vad sa Fed?'), 'MARKET', d)
    expect(
      recording.calls.filter((call) => call.method === 'searchOfficial'),
    ).toHaveLength(1)
    /* Twenty minutes later "idag" refuses the cached search, though an official entry would otherwise hold for hours. */
    now = new Date(NOW.getTime() + 20 * 60_000)
    await answerResearchQuery(query('Vad sa Fed idag?'), 'MARKET', d)
    expect(
      recording.calls.filter((call) => call.method === 'searchOfficial'),
    ).toHaveLength(2)
  })
})

describe('gatherEvidence', () => {
  it('keeps the provider’s cited sentences as claims of their sources and nothing else', async () => {
    const recording = recordingPort()
    const q = query('Varför föll Nasdaq i veckan?')
    const outcome = await gatherEvidence(planFor(q, NOW), q, true, {
      port: recording.port,
      cache: createResearchCache(),
      now: () => NOW,
    })
    const reuters = outcome.evidence.find((item) => item.url === REUTERS_URL)!
    expect(reuters.claims.map((claim) => claim.text)).toEqual([
      'S&P 500 pressas främst av högre långräntor efter den starkare jobbrapporten.',
      'U.S. stocks fell on Friday as Treasury yields climbed after a stronger-than-expected jobs report.',
    ])
    expect(outcome.queries).toEqual(['Varför föll Nasdaq i veckan?'])
    expect(outcome.unavailable).toBeNull()
  })
})
