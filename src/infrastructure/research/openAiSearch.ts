/**
 * OpenAI's web search behind the public search port: one Responses call
 * with the `web_search` tool, restricted to a domain list where the plan
 * asks for one, answered with a short Swedish narrative whose every
 * sentence cites a source. The narrative is discovery — the gather step
 * keeps only the cited sentences, and opens the primary sources itself.
 *
 * Probed live on 2026-10-03 with the configured backend model: one search,
 * a URL citation, under five seconds. Nothing is stored at the provider.
 */

import {
  PublicResearchUnavailable,
  type SearchRequest,
  type SearchResponse,
} from '~/application/jarvis/research/publicSearch'

export const OPENAI_RESPONSES = 'https://api.openai.com/v1/responses'

/** The limit the API documents for `filters.allowed_domains`. */
const MAX_ALLOWED_DOMAINS = 20

export type SearchMode = 'web' | 'news' | 'official'

export interface OpenAiSearchOptions {
  apiKey: string
  model: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  networkDisabled?: boolean
  now?: () => Date
}

interface Annotation {
  type?: string
  url?: string
  title?: string
  start_index?: number
  end_index?: number
}

interface OutputItem {
  type?: string
  content?: { type?: string; text?: string; annotations?: Annotation[] }[]
}

const FRESHNESS_WORDS: Record<SearchRequest['freshness'], string> = {
  day: 'det senaste dygnet',
  week: 'den senaste veckan',
  month: 'den senaste månaden',
  any: 'nyligen',
}

/** The instruction every search carries: Swedish, short, cited, no advice, no guessing. */
export function searchInstructions(request: SearchRequest, mode: SearchMode): string {
  const scope =
    mode === 'news'
      ? 'Använd ansedda finansiella nyhetskällor.'
      : mode === 'official'
        ? 'Använd den officiella källan själv — centralbanken, statistikmyndigheten, bolagets egen publicering.'
        : 'Använd tillförlitliga offentliga källor.'
  return [
    'Du är researchassistent åt en finansiell rådgivare.',
    'Sök på webben och svara på svenska med 2–4 korta meningar.',
    'Varje mening ska bygga på en källa du citerar; skriv ingen mening utan källa.',
    'Ange siffror exakt som källan anger dem, med datum där det finns.',
    `Prioritera material från ${FRESHNESS_WORDS[request.freshness]}.`,
    scope,
    'Börja direkt med sakinnehållet, utan inledningar som "Om du menar".',
    'Inga råd, inga rekommendationer, ingen spekulation. Hittar du inget verifierat, säg det med en mening.',
  ].join(' ')
}

const stripTracking = (url: string): string =>
  url.replace(/[?&]utm_source=openai\b/u, '').replace(/\?$/, '')

const LINK = /\(?\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)\)?/gu

/**
 * The sentence of a narrative that an offset falls in, with the provider's
 * link markup removed. A link written after a sentence's full stop cites
 * that sentence, so the offset of a link is read as the sentence before it.
 */
export function sentenceAround(text: string, offset: number): string {
  /* Links become dotless tokens first, so a period inside an address never ends a sentence. */
  let cleaned = ''
  let last = 0
  let shifted = offset
  let insideLink = false
  for (const link of text.matchAll(LINK)) {
    const index = link.index ?? 0
    cleaned += text.slice(last, index)
    const token = ' ⟦⟧'
    if (index <= offset && offset < index + link[0].length) {
      insideLink = true
      shifted = cleaned.length
    } else if (index < offset) shifted += token.length - link[0].length
    cleaned += token
    last = index + link[0].length
  }
  cleaned += text.slice(last)
  /* The sentence before a link's position, when the offset is the link itself. */
  const position = Math.max(
    0,
    Math.min(insideLink ? shifted - 1 : shifted, cleaned.length - 1),
  )
  let start = position
  while (
    start > 0 &&
    !(
      /[.!?]\s$/.test(cleaned.slice(Math.max(0, start - 2), start)) &&
      /[\p{Lu}\d"“(\[]/u.test(cleaned.charAt(start))
    )
  )
    start -= 1
  const tail = /[.!?](?=\s+[\p{Lu}\d"“(\[]|\s*$)/gu
  tail.lastIndex = insideLink ? Math.max(0, position - 1) : position
  const found = tail.exec(cleaned)
  const end = found ? found.index + 1 : cleaned.length
  return cleaned
    .slice(start, end)
    .replace(/\s*⟦⟧/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function createOpenAiSearch(options: OpenAiSearchOptions) {
  const doFetch = options.fetchImpl ?? globalThis.fetch
  const now = options.now ?? (() => new Date())
  const timeoutMs = options.timeoutMs ?? 20_000

  async function search(
    request: SearchRequest,
    mode: SearchMode,
  ): Promise<SearchResponse> {
    if (options.networkDisabled)
      throw new PublicResearchUnavailable('disabled', 'network disabled')
    const domains = (request.domains ?? []).slice(0, MAX_ALLOWED_DOMAINS)
    const body = {
      model: options.model,
      instructions: searchInstructions(request, mode),
      input: request.query,
      tools: [
        {
          type: 'web_search',
          search_context_size: 'medium',
          ...(domains.length > 0 ? { filters: { allowed_domains: domains } } : {}),
        },
      ],
      tool_choice: 'required',
      store: false,
      max_output_tokens: 700,
      reasoning: { effort: 'low' },
    }
    let response: Response
    try {
      response = await doFetch(OPENAI_RESPONSES, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      throw new PublicResearchUnavailable(
        name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
        String(error).slice(0, 120),
      )
    }
    const text = await response.text()
    if (!response.ok)
      throw new PublicResearchUnavailable(
        response.status >= 500 ? 'network' : 'refused',
        `${response.status} ${text.slice(0, 160)}`,
      )
    let parsed: { output?: OutputItem[] }
    try {
      parsed = JSON.parse(text) as { output?: OutputItem[] }
    } catch {
      throw new PublicResearchUnavailable('network', 'unreadable response')
    }
    return parseSearchOutput(parsed.output ?? [], now().toISOString())
  }

  return { search }
}

/** The message text and its citations, as hits and a narrative; nothing the model did not cite becomes a hit. */
export function parseSearchOutput(
  output: readonly OutputItem[],
  searchedAt: string,
): SearchResponse {
  let narrativeText = ''
  const citations: SearchResponse['narrative'] extends infer N
    ? N extends { citations: infer C }
      ? C
      : never
    : never = []
  const hits: SearchResponse['hits'] = []
  const seen = new Set<string>()
  for (const item of output) {
    if (item.type !== 'message') continue
    for (const part of item.content ?? []) {
      if (part.type !== 'output_text' || typeof part.text !== 'string') continue
      const offset = narrativeText.length
      narrativeText += (narrativeText ? '\n' : '') + part.text
      const base = narrativeText.length - part.text.length
      void offset
      for (const annotation of part.annotations ?? []) {
        if (annotation.type !== 'url_citation' || !annotation.url) continue
        const url = stripTracking(annotation.url)
        const start = base + (annotation.start_index ?? 0)
        const end = base + (annotation.end_index ?? annotation.start_index ?? 0)
        citations.push({ url, title: annotation.title ?? null, start, end })
        if (!seen.has(url)) {
          seen.add(url)
          hits.push({
            title: annotation.title ?? url,
            url,
            /* The provider's citation span is usually its own link markup; the sentence around it is what the source said. */
            snippet: sentenceAround(part.text, annotation.start_index ?? 0),
            publisher: null,
            publishedAt: null,
          })
        }
      }
    }
  }
  return {
    hits,
    narrative: narrativeText ? { text: narrativeText, citations } : null,
    provider: 'openai-web-search',
    searchedAt,
  }
}
