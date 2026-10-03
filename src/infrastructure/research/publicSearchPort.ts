/**
 * The public search port as this environment binds it: the official feeds
 * read directly, OpenAI's web search for news and the open web where a
 * key allows it, and the retriever for primary sources. Replaceable by
 * environment — `PUBLIC_RESEARCH_PROVIDER=none` leaves only the feeds and
 * the retriever; `PUBLIC_RESEARCH_DISABLED=1` leaves no port at all, and
 * JARVIS says so honestly.
 */

import type { PublicSearchPort } from '~/application/jarvis/research/publicSearch'
import { PublicResearchUnavailable } from '~/application/jarvis/research/publicSearch'
import type { ResearchHttp } from './http'
import { parseFeedQuery, readOfficialFeed } from './officialFeeds'
import { createOpenAiSearch, type SearchMode } from './openAiSearch'
import { createRetriever } from './retrieve'

export interface PublicSearchPortOptions {
  http: ResearchHttp
  now: () => Date
  /** OpenAI's web search, or null when no provider is configured for the open web. */
  openAi: { apiKey: string; model: string; networkDisabled?: boolean } | null
  userAgent: string
  log?: (line: string) => void
}

export const DEFAULT_RESEARCH_MODEL = 'gpt-5.6-luna'
export const DEFAULT_USER_AGENT = 'FinancialOS/0.1 (public research)'

export function createPublicSearchPort(
  options: PublicSearchPortOptions,
): PublicSearchPort {
  const feeds = { http: options.http, now: options.now, userAgent: options.userAgent }
  const web = options.openAi
    ? createOpenAiSearch({
        apiKey: options.openAi.apiKey,
        model: options.openAi.model,
        now: options.now,
        ...(options.openAi.networkDisabled ? { networkDisabled: true } : {}),
      })
    : null
  const retrieve = createRetriever(feeds)
  const open =
    (mode: SearchMode): PublicSearchPort['search'] =>
    async (request) => {
      if (!web)
        throw new PublicResearchUnavailable(
          'disabled',
          'no open-web search provider configured',
        )
      return web.search(request, mode)
    }
  return {
    search: open('web'),
    searchNews: open('news'),
    async searchOfficial(request) {
      const feed = parseFeedQuery(request.query)
      if (feed) return readOfficialFeed(feed.feed, feed.rest, request, feeds)
      return open('official')(request)
    },
    retrieve,
  }
}

export interface ResearchEnv {
  OPENAI_API_KEY?: string
  PUBLIC_RESEARCH_PROVIDER?: string
  PUBLIC_RESEARCH_MODEL?: string
  PUBLIC_RESEARCH_DISABLED?: string
  PUBLIC_RESEARCH_CONTACT?: string
  JARVIS_LIVE_NETWORK_DISABLED?: string
}

/** The port the environment allows, or null when public research is switched off. */
export function publicSearchPortFromEnv(
  env: ResearchEnv,
  http: ResearchHttp,
  now: () => Date,
  log?: (line: string) => void,
): PublicSearchPort | null {
  if (env.PUBLIC_RESEARCH_DISABLED === '1') return null
  const provider =
    env.PUBLIC_RESEARCH_PROVIDER ?? (env.OPENAI_API_KEY ? 'openai' : 'none')
  const openAi =
    provider === 'openai' && env.OPENAI_API_KEY
      ? {
          apiKey: env.OPENAI_API_KEY,
          model: env.PUBLIC_RESEARCH_MODEL ?? DEFAULT_RESEARCH_MODEL,
          ...(env.JARVIS_LIVE_NETWORK_DISABLED === '1' ? { networkDisabled: true } : {}),
        }
      : null
  const userAgent = env.PUBLIC_RESEARCH_CONTACT
    ? `${DEFAULT_USER_AGENT} ${env.PUBLIC_RESEARCH_CONTACT}`
    : DEFAULT_USER_AGENT
  return createPublicSearchPort({ http, now, openAi, userAgent, ...(log ? { log } : {}) })
}
