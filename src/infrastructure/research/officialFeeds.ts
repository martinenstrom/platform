/**
 * The official sources read directly, as the plan's feeds: the Federal
 * Reserve's monetary-policy releases, the ECB's and Riksbanken's press
 * feeds, the BLS CPI series, and a company's EDGAR filings. Each becomes
 * a `SearchResponse` of hits from the primary source itself — authority 1
 * or 2 by address, dated by the publisher — so the gather step can open
 * the document and read the fact.
 *
 * URLs were read live on 2026-10-03 and the responses recorded as fixtures.
 */

import {
  PublicResearchUnavailable,
  type SearchHit,
  type SearchRequest,
  type SearchResponse,
} from '~/application/jarvis/research/publicSearch'
import type { OfficialFeed } from '~/application/jarvis/research/researchPlan'
import type { ResearchHttp } from './http'
import { parseFeed, type FeedItem } from './rss'

export const FEED_URLS = {
  'fed-monetary': 'https://www.federalreserve.gov/feeds/press_monetary.xml',
  'ecb-press': 'https://www.ecb.europa.eu/rss/press.html',
  'riksbank-press': 'https://www.riksbank.se/sv/rss/pressmeddelanden/',
  'bls-cpi': 'https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0',
} as const

export const BLS_CPI_RELEASE_PAGE = 'https://www.bls.gov/news.release/cpi.htm'

export const edgarFilingsUrl = (ticker: string, count: number): string =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(ticker)}&type=8-K&dateb=&owner=include&count=${count}&output=atom`

const FEEDS: readonly OfficialFeed[] = [
  'fed-monetary',
  'ecb-press',
  'riksbank-press',
  'bls-cpi',
  'edgar-filings',
]

/** "fed-monetary:Federal Reserve latest …" → the feed and the words after it. */
export function parseFeedQuery(
  query: string,
): { feed: OfficialFeed; rest: string } | null {
  const colon = query.indexOf(':')
  if (colon <= 0) return null
  const feed = query.slice(0, colon) as OfficialFeed
  return FEEDS.includes(feed) ? { feed, rest: query.slice(colon + 1).trim() } : null
}

export interface FeedDeps {
  http: ResearchHttp
  now: () => Date
  /** Sent as User-Agent; the SEC requires one that names the caller. */
  userAgent: string
  timeoutMs?: number
}

/* A decision, not the minutes of one: "Protokoll från det penningpolitiska mötet" stays in the feed's order. */
const DECISION_WORDS =
  /fomc statement|monetary policy decision|interest rate|policy rate|styrränt|räntebesked|räntebeslut|decisions taken|lämnar styrräntan|höjer styrräntan|sänker styrräntan/iu

/** Decisions first, then the feed's own order (newest first). */
function rankedByDecision(items: FeedItem[]): FeedItem[] {
  return [...items]
    .map((item, index) => ({
      item,
      index,
      score: DECISION_WORDS.test(`${item.title} ${item.summary ?? ''}`) ? 1 : 0,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item)
}

const hitOf = (item: FeedItem, publisher: string): SearchHit => ({
  title: item.title,
  url: item.link ?? '',
  snippet: item.summary && item.summary !== item.title ? item.summary : item.title,
  publisher,
  publishedAt: item.publishedAt,
})

interface BlsBody {
  status?: string
  Results?: {
    series?: {
      seriesID: string
      data: {
        year: string
        period: string
        periodName: string
        value: string
        latest?: string
      }[]
    }[]
  }
}

/** The CPI-U all-items index: the latest month against the same month a year earlier. */
export function cpiYearOverYear(
  body: BlsBody,
): { yoy: number; periodName: string; year: string; index: number } | null {
  const data = body.Results?.series?.[0]?.data ?? []
  const monthly = data.filter((row) => /^M(0[1-9]|1[0-2])$/.test(row.period))
  if (monthly.length === 0) return null
  const sorted = [...monthly].sort((a, b) =>
    `${b.year}${b.period}`.localeCompare(`${a.year}${a.period}`),
  )
  const latest = sorted[0]!
  const earlier = sorted.find(
    (row) => row.period === latest.period && Number(row.year) === Number(latest.year) - 1,
  )
  if (!earlier) return null
  const index = Number(latest.value)
  const base = Number(earlier.value)
  if (!Number.isFinite(index) || !Number.isFinite(base) || base === 0) return null
  return {
    yoy: (index / base - 1) * 100,
    periodName: latest.periodName,
    year: latest.year,
    index,
  }
}

/** Read a feed into hits, as many as the request allows. */
export async function readOfficialFeed(
  feed: OfficialFeed,
  rest: string,
  request: SearchRequest,
  deps: FeedDeps,
): Promise<SearchResponse> {
  const limit = request.limit ?? 3
  const signal = AbortSignal.timeout(deps.timeoutMs ?? 15_000)
  const headers = {
    'user-agent': deps.userAgent,
    accept: 'application/xml, text/xml, application/json, */*',
  }
  const searchedAt = deps.now().toISOString()
  const respond = (hits: SearchHit[], provider: string): SearchResponse => ({
    hits: hits.filter((hit) => hit.url).slice(0, limit),
    narrative: null,
    provider,
    searchedAt,
  })
  try {
    switch (feed) {
      case 'fed-monetary': {
        const xml = await deps.http.getText(FEED_URLS[feed], signal, headers)
        return respond(
          rankedByDecision(parseFeed(xml)).map((item) => hitOf(item, 'Federal Reserve')),
          'fed-rss',
        )
      }
      case 'ecb-press': {
        const xml = await deps.http.getText(FEED_URLS[feed], signal, headers)
        return respond(
          rankedByDecision(parseFeed(xml)).map((item) => hitOf(item, 'ECB')),
          'ecb-rss',
        )
      }
      case 'riksbank-press': {
        const xml = await deps.http.getText(FEED_URLS[feed], signal, headers)
        return respond(
          rankedByDecision(parseFeed(xml)).map((item) => hitOf(item, 'Riksbanken')),
          'riksbank-rss',
        )
      }
      case 'bls-cpi': {
        const body = await deps.http.getJson<BlsBody>(FEED_URLS[feed], signal, headers)
        if (body.status !== 'REQUEST_SUCCEEDED')
          throw new PublicResearchUnavailable(
            'refused',
            `BLS ${body.status ?? 'no status'}`,
          )
        const cpi = cpiYearOverYear(body)
        if (!cpi) return respond([], 'bls-api')
        return respond(
          [
            {
              title: `Consumer Price Index, ${cpi.periodName} ${cpi.year}`,
              url: BLS_CPI_RELEASE_PAGE,
              snippet: `The CPI-U for all items (not seasonally adjusted) rose ${cpi.yoy.toFixed(1)} percent over the 12 months ending ${cpi.periodName} ${cpi.year} (index ${cpi.index.toFixed(3)}, BLS series CUUR0000SA0).`,
              publisher: 'BLS',
              publishedAt: null,
            },
          ],
          'bls-api',
        )
      }
      case 'edgar-filings': {
        const ticker = rest.split(/\s+/)[0]?.toUpperCase() ?? ''
        if (!/^[A-Z.-]{1,10}$/.test(ticker))
          throw new PublicResearchUnavailable('unsupported', `no ticker in "${rest}"`)
        const xml = await deps.http.getText(
          edgarFilingsUrl(ticker, Math.max(limit, 5)),
          signal,
          headers,
        )
        const entries = parseFeed(xml)
          .map((item, index) => ({
            item,
            index,
            results: /2\.02/.test(item.content['items-desc'] ?? '') ? 1 : 0,
          }))
          .sort((a, b) => b.results - a.results || a.index - b.index)
          .map(({ item }) => item)
        return respond(
          entries.map((item) => ({
            title: `${item.content['form-name'] ?? 'Filing'} (${item.content['filing-type'] ?? '8-K'})${item.content['items-desc'] ? ` – ${item.content['items-desc']}` : ''}`,
            url: item.content['filing-href'] ?? item.link ?? '',
            snippet: `${ticker}: ${item.content['form-name'] ?? 'filing'} filed ${item.content['filing-date'] ?? 'on an unknown date'}${item.content['items-desc'] ? ` (${item.content['items-desc']})` : ''}.`,
            publisher: 'SEC EDGAR',
            publishedAt: item.publishedAt,
          })),
          'edgar-atom',
        )
      }
    }
  } catch (error) {
    if (error instanceof PublicResearchUnavailable) throw error
    const name = error instanceof Error ? error.name : ''
    throw new PublicResearchUnavailable(
      name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
      `${feed}: ${String(error).slice(0, 120)}`,
    )
  }
}
