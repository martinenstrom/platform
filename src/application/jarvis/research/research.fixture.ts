/**
 * A public search port that records every request and answers from canned
 * responses, so tests can assert what left the platform and what came back.
 * Test data; nothing imports this at runtime.
 */

import type { NamedClient } from '../advisoryIntent'
import type { PrivateVocabulary } from './firewall'
import {
  PublicResearchUnavailable,
  type PublicSearchPort,
  type RetrievedDocument,
  type SearchRequest,
  type SearchResponse,
} from './publicSearch'

export const FIXTURE_SEARCHED_AT = '2026-10-02T15:05:00.000Z'

export const FED_STATEMENT_URL =
  'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm'
export const REUTERS_URL =
  'https://www.reuters.com/markets/us/stocks-fall-yields-rise-2026-10-02/'
export const CNBC_URL = 'https://www.cnbc.com/2026/10/02/stock-market-today.html'
export const BLOG_URL = 'https://some-market-blog.example/why-stocks-fell'

/** Clients the register knows, planted so the firewall has something to catch. */
export const PLANTED_CLIENTS: readonly NamedClient[] = [
  { id: 'cl-alvarsson', displayName: 'Henrik Alvarsson' },
  { id: 'cl-dahlqvist', displayName: 'Anna & Per Dahlqvist' },
  { id: 'cl-lindqvist', displayName: 'Henrik Lindqvist' },
]

export const PLANTED_VOCABULARY: PrivateVocabulary = {
  clients: PLANTED_CLIENTS,
  offices: ['Strandvägen', 'Norrmalm'],
}

const narrative = (parts: { text: string; url: string | null; title?: string }[]) => {
  let text = ''
  const citations: { url: string; title: string | null; start: number; end: number }[] =
    []
  for (const part of parts) {
    const start = text.length
    text += part.text
    if (part.url)
      citations.push({
        url: part.url,
        title: part.title ?? null,
        start,
        end: text.length,
      })
    text += ' '
  }
  return { text: text.trim(), citations }
}

export const officialResponse = (): SearchResponse => ({
  hits: [
    {
      title: 'Federal Reserve issues FOMC statement',
      url: FED_STATEMENT_URL,
      snippet:
        'The Committee decided to maintain the target range for the federal funds rate at 4-1/4 to 4-1/2 percent.',
      publisher: 'Federal Reserve',
      publishedAt: '2026-09-16T18:00:00.000Z',
    },
  ],
  narrative: null,
  provider: 'fixture',
  searchedAt: FIXTURE_SEARCHED_AT,
})

/** Two cited sentences and one the provider did not cite — which must never become a claim. */
export const newsResponse = (): SearchResponse => ({
  hits: [
    {
      title: 'Stocks fall as yields rise after strong jobs report',
      url: REUTERS_URL,
      snippet:
        'U.S. stocks fell on Friday as Treasury yields climbed after a stronger-than-expected jobs report.',
      publisher: 'Reuters',
      publishedAt: '2026-10-02T14:30:00.000Z',
    },
    {
      title: 'Tech leads the decline',
      url: CNBC_URL,
      snippet: 'Technology shares led the decline, with semiconductors under pressure.',
      publisher: 'CNBC',
      publishedAt: '2026-10-02T14:40:00.000Z',
    },
  ],
  narrative: narrative([
    {
      text: 'S&P 500 pressas främst av högre långräntor efter den starkare jobbrapporten.',
      url: REUTERS_URL,
      title: 'Stocks fall as yields rise',
    },
    {
      text: 'Tech är den svagaste större sektorn.',
      url: CNBC_URL,
      title: 'Tech leads the decline',
    },
    { text: 'Det här är en gissning utan källa.', url: null },
  ]),
  provider: 'fixture',
  searchedAt: FIXTURE_SEARCHED_AT,
})

export const searchResponse = (): SearchResponse => ({
  hits: [
    {
      title: 'Why stocks fell this week',
      url: BLOG_URL,
      snippet: 'Stocks fell this week because of rising yields, a blogger writes.',
      publisher: null,
      publishedAt: null,
    },
  ],
  narrative: null,
  provider: 'fixture',
  searchedAt: FIXTURE_SEARCHED_AT,
})

export const fedDocument = (): RetrievedDocument => ({
  url: FED_STATEMENT_URL,
  title: 'Federal Reserve issues FOMC statement',
  text: 'Recent indicators suggest that economic activity has continued to expand at a solid pace. The Committee decided to maintain the target range for the federal funds rate at 4-1/4 to 4-1/2 percent. The Committee will continue to monitor the implications of incoming information.',
  publishedAt: '2026-09-16T18:00:00.000Z',
  retrievedAt: FIXTURE_SEARCHED_AT,
  publisher: 'Federal Reserve',
})

export interface RecordedCall {
  method: 'search' | 'searchNews' | 'searchOfficial' | 'retrieve'
  request: SearchRequest | { url: string }
}

export interface RecordingPort {
  port: PublicSearchPort
  calls: RecordedCall[]
  /** Every string that reached the port: queries and urls, for the firewall's assertions. */
  sent: () => string[]
}

/** A port answering from the canned responses; `fail` makes every call throw as the network would. */
export function recordingPort(
  options: {
    fail?: boolean
    official?: () => SearchResponse
    news?: () => SearchResponse
    search?: () => SearchResponse
    document?: (url: string) => RetrievedDocument
  } = {},
): RecordingPort {
  const calls: RecordedCall[] = []
  const unavailable = () => {
    throw new PublicResearchUnavailable('network', 'fixture offline')
  }
  const port: PublicSearchPort = {
    async search(request) {
      calls.push({ method: 'search', request })
      if (options.fail) unavailable()
      return (options.search ?? searchResponse)()
    },
    async searchNews(request) {
      calls.push({ method: 'searchNews', request })
      if (options.fail) unavailable()
      return (options.news ?? newsResponse)()
    },
    async searchOfficial(request) {
      calls.push({ method: 'searchOfficial', request })
      if (options.fail) unavailable()
      return (options.official ?? officialResponse)()
    },
    async retrieve(url) {
      calls.push({ method: 'retrieve', request: { url } })
      if (options.fail) unavailable()
      return (options.document ?? fedDocument)(url)
    },
  }
  return {
    port,
    calls,
    sent: () =>
      calls.map((call) =>
        'url' in call.request
          ? call.request.url
          : `${call.request.query} ${(call.request.domains ?? []).join(' ')}`,
      ),
  }
}
