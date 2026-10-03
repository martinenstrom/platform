/**
 * The official feeds against recorded responses: the Fed's, the ECB's and
 * Riksbanken's press feeds read into dated hits with decisions first, the
 * BLS CPI index turned into a twelve-month figure, EDGAR's filings by
 * ticker with the results filing first, and every failure an honest
 * `PublicResearchUnavailable`.
 */

import { readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PublicResearchUnavailable } from '~/application/jarvis/research/publicSearch'
import type { ResearchHttp as HttpClient } from './http'
import {
  cpiYearOverYear,
  edgarFilingsUrl,
  parseFeedQuery,
  readOfficialFeed,
} from './officialFeeds'
import { parseFeed } from './rss'

const FIXTURES = resolvePath(process.cwd(), 'src/infrastructure/research/__fixtures__')
const recorded = (name: string) => readFileSync(join(FIXTURES, name), 'utf8')

const NOW = new Date('2026-10-03T12:00:00.000Z')

function stub(byUrl: Record<string, string>, calls: string[] = []): HttpClient {
  const find = (url: string) => {
    for (const [fragment, body] of Object.entries(byUrl))
      if (url.includes(fragment)) return body
    throw new Error(`no recorded body for ${url}`)
  }
  return {
    async getText(url: string) {
      calls.push(url)
      return find(url)
    },
    async getJson<T>(url: string): Promise<T> {
      calls.push(url)
      return JSON.parse(find(url)) as T
    },
  }
}

const deps = (http: HttpClient) => ({ http, now: () => NOW, userAgent: 'test-agent' })
const request = { query: '', freshness: 'month' as const, limit: 3 }

describe('parseFeed', () => {
  it('reads the Fed’s RSS: titles, CDATA links, GMT times', () => {
    const items = parseFeed(recorded('fed.press_monetary.xml'))
    expect(items[0]).toMatchObject({
      title: 'Federal Reserve issues FOMC statement',
      link: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm',
      publishedAt: '2026-09-16T18:00:00.000Z',
    })
    expect(items.length).toBeGreaterThan(5)
  })

  it('reads Riksbanken’s RSS with its Swedish summaries and +02:00 times, and the ECB’s', () => {
    const riksbank = parseFeed(recorded('riksbank.pressmeddelanden.xml'))
    const decision = riksbank.find(
      (item) => item.title === 'Styrräntan oförändrad på 1,75 procent',
    )!
    expect(decision.summary).toContain(
      'Direktionen har beslutat att lämna styrräntan oförändrad på 1,75 procent',
    )
    expect(decision.publishedAt).toBe('2026-09-24T07:30:36.000Z')
    const ecb = parseFeed(recorded('ecb.press.rss.xml'))
    expect(ecb[0]!.link).toMatch(/^https:\/\/www\.ecb\.europa\.eu\//)
    expect(ecb[0]!.publishedAt).toBe('2026-10-02T13:00:00.000Z')
  })

  it('reads EDGAR’s Atom entries with their filing fields', () => {
    const entries = parseFeed(recorded('edgar.nvda.8k.atom.xml'))
    expect(entries[0]).toMatchObject({
      title: '8-K - Current report',
      link: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/0001045810-26-000078-index.htm',
      publishedAt: '2026-09-03T12:03:56.000Z',
    })
    expect(entries[0]!.content).toMatchObject({
      'filing-date': '2026-09-03',
      'filing-type': '8-K',
      'form-name': 'Current report',
      'items-desc': 'item 8.01',
    })
  })
})

describe('readOfficialFeed', () => {
  it('the Fed: decisions first, the Fed as publisher, limited to the request', async () => {
    const calls: string[] = []
    const response = await readOfficialFeed(
      'fed-monetary',
      'Federal Reserve latest policy decision',
      request,
      deps(stub({ 'press_monetary.xml': recorded('fed.press_monetary.xml') }, calls)),
    )
    expect(calls).toEqual(['https://www.federalreserve.gov/feeds/press_monetary.xml'])
    expect(response.hits).toHaveLength(3)
    expect(response.hits[0]).toMatchObject({
      title: 'Federal Reserve issues FOMC statement',
      publisher: 'Federal Reserve',
      publishedAt: '2026-09-16T18:00:00.000Z',
    })
    expect(response.provider).toBe('fed-rss')
    expect(response.searchedAt).toBe(NOW.toISOString())
  })

  it('Riksbanken: the rate decision ranks before the minutes that the feed lists first', async () => {
    const response = await readOfficialFeed(
      'riksbank-press',
      'Riksbanken',
      request,
      deps(stub({ 'rss/pressmeddelanden': recorded('riksbank.pressmeddelanden.xml') })),
    )
    expect(response.hits[0]!.title).toBe('Styrräntan oförändrad på 1,75 procent')
    expect(response.hits[0]!.snippet).toContain('1,75 procent')
    expect(response.hits[0]!.publisher).toBe('Riksbanken')
  })

  it('BLS: the CPI-U index becomes the twelve-month figure, as one hit on the release page', async () => {
    const body = JSON.parse(recorded('bls.cpi.CUUR0000SA0.json')) as Parameters<
      typeof cpiYearOverYear
    >[0]
    const cpi = cpiYearOverYear(body)!
    expect(cpi).toMatchObject({ periodName: 'August', year: '2026', index: 334.98 })
    expect(cpi.yoy).toBeGreaterThan(0)
    const response = await readOfficialFeed(
      'bls-cpi',
      '',
      request,
      deps(stub({ CUUR0000SA0: recorded('bls.cpi.CUUR0000SA0.json') })),
    )
    expect(response.hits).toHaveLength(1)
    expect(response.hits[0]).toMatchObject({
      url: 'https://www.bls.gov/news.release/cpi.htm',
      publisher: 'BLS',
    })
    expect(response.hits[0]!.snippet).toMatch(
      /rose \d+\.\d percent over the 12 months ending August 2026/,
    )
  })

  it('EDGAR: the ticker is the first word, the results filing ranks first, the URL names the ticker', async () => {
    const calls: string[] = []
    const response = await readOfficialFeed(
      'edgar-filings',
      'NVDA 8-K earnings release',
      request,
      deps(stub({ 'browse-edgar': recorded('edgar.nvda.8k.atom.xml') }, calls)),
    )
    expect(calls[0]).toBe(edgarFilingsUrl('NVDA', 5))
    expect(response.hits[0]).toMatchObject({ publisher: 'SEC EDGAR' })
    expect(response.hits[0]!.title).toMatch(/2\.02|Current report/)
    expect(response.hits.every((hit) => hit.url.startsWith('https://www.sec.gov/'))).toBe(
      true,
    )
    await expect(
      readOfficialFeed('edgar-filings', '', request, deps(stub({}))),
    ).rejects.toBeInstanceOf(PublicResearchUnavailable)
  })

  it('a feed that cannot be read is unavailable, never a guess', async () => {
    await expect(
      readOfficialFeed('ecb-press', '', request, deps(stub({}))),
    ).rejects.toMatchObject({ name: 'PublicResearchUnavailable', reason: 'network' })
  })

  it('parses the feed prefix the plan writes', () => {
    expect(parseFeedQuery('fed-monetary:Federal Reserve latest')).toEqual({
      feed: 'fed-monetary',
      rest: 'Federal Reserve latest',
    })
    expect(parseFeedQuery('Federal Reserve latest')).toBeNull()
    expect(parseFeedQuery('nonsense:x')).toBeNull()
  })
})
