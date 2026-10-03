/**
 * OpenAI's web search as the port sees it: the request carries the
 * instructions, the domain filter and a required search; the response's
 * cited spans become hits and a narrative, nothing uncited becomes a hit,
 * and a refusal or a timeout is an honest unavailability.
 */

import { describe, expect, it } from 'vitest'
import { createOpenAiSearch, parseSearchOutput, searchInstructions } from './openAiSearch'

const NOW = new Date('2026-10-03T12:00:00.000Z')

/** The shape the live probe of 2026-10-03 returned: a search call, then a message with a cited span. */
const text =
  'USA:s headline-KPI-inflation var **3,4 procent i årstakt i augusti 2026**, enligt BLS. ([bls.gov](https://www.bls.gov/news.release/cpi.htm?utm_source=openai)) Detta är en mening utan källa.'
const liveShape = {
  output: [
    {
      type: 'web_search_call',
      status: 'completed',
      action: { type: 'search', queries: ['site:bls.gov CPI'] },
    },
    {
      type: 'message',
      content: [
        {
          type: 'output_text',
          text,
          annotations: [
            {
              type: 'url_citation',
              start_index: 0,
              end_index: text.indexOf(') Detta') + 1,
              url: 'https://www.bls.gov/news.release/cpi.htm?utm_source=openai',
              title: 'Consumer Price Index News Release - 2026 M08 Results',
            },
          ],
        },
      ],
    },
  ],
}

describe('parseSearchOutput', () => {
  it('turns the cited span into one hit and the narrative, with the tracking parameter stripped', () => {
    const response = parseSearchOutput(liveShape.output, NOW.toISOString())
    expect(response.hits).toHaveLength(1)
    expect(response.hits[0]).toMatchObject({
      url: 'https://www.bls.gov/news.release/cpi.htm',
      title: 'Consumer Price Index News Release - 2026 M08 Results',
      publisher: null,
      publishedAt: null,
    })
    expect(response.hits[0]!.snippet).toContain('3,4 procent i årstakt i augusti 2026')
    expect(response.narrative?.citations).toEqual([
      {
        url: 'https://www.bls.gov/news.release/cpi.htm',
        title: 'Consumer Price Index News Release - 2026 M08 Results',
        start: 0,
        end: text.indexOf(') Detta') + 1,
      },
    ])
    expect(response.provider).toBe('openai-web-search')
  })

  it('an answer with no citation is no hit at all', () => {
    const response = parseSearchOutput(
      [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'Jag hittar inget verifierat.',
              annotations: [],
            },
          ],
        },
      ],
      NOW.toISOString(),
    )
    expect(response.hits).toEqual([])
    expect(response.narrative?.text).toBe('Jag hittar inget verifierat.')
  })
})

describe('createOpenAiSearch', () => {
  const capture = (status: number, body: unknown) => {
    const requests: {
      url: string
      body: Record<string, unknown>
      headers: Record<string, string>
    }[] = []
    const fetchImpl: typeof fetch = async (url, init) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        headers: (init?.headers ?? {}) as Record<string, string>,
      })
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    }
    return { requests, fetchImpl }
  }

  it('sends a required web search with the domain filter, Swedish instructions and no storage', async () => {
    const { requests, fetchImpl } = capture(200, liveShape)
    const search = createOpenAiSearch({
      apiKey: 'k',
      model: 'm',
      fetchImpl,
      now: () => NOW,
    })
    await search.search(
      {
        query: 'US CPI latest',
        freshness: 'week',
        domains: ['bls.gov', 'bea.gov'],
        locale: 'en',
      },
      'official',
    )
    expect(requests[0]!.url).toBe('https://api.openai.com/v1/responses')
    expect(requests[0]!.headers.authorization).toBe('Bearer k')
    expect(requests[0]!.body).toMatchObject({
      model: 'm',
      input: 'US CPI latest',
      tool_choice: 'required',
      store: false,
      tools: [
        { type: 'web_search', filters: { allowed_domains: ['bls.gov', 'bea.gov'] } },
      ],
    })
    expect(String(requests[0]!.body.instructions)).toContain(
      'Varje mening ska bygga på en källa',
    )
    expect(String(requests[0]!.body.instructions)).toContain('den senaste veckan')
  })

  it('omits the filter without domains, and never sends the key anywhere but the header', async () => {
    const { requests, fetchImpl } = capture(200, liveShape)
    const search = createOpenAiSearch({ apiKey: 'secret-key', model: 'm', fetchImpl })
    await search.search({ query: 'why did stocks fall', freshness: 'day' }, 'news')
    expect(
      (requests[0]!.body.tools as { filters?: unknown }[])[0]!.filters,
    ).toBeUndefined()
    expect(JSON.stringify(requests[0]!.body)).not.toContain('secret-key')
  })

  it('a refusal and a server error are unavailability, with the reason', async () => {
    const refused = createOpenAiSearch({
      apiKey: 'k',
      model: 'm',
      fetchImpl: capture(429, { error: 'quota' }).fetchImpl,
    })
    await expect(
      refused.search({ query: 'x', freshness: 'any' }, 'web'),
    ).rejects.toMatchObject({
      name: 'PublicResearchUnavailable',
      reason: 'refused',
    })
    const down = createOpenAiSearch({
      apiKey: 'k',
      model: 'm',
      fetchImpl: capture(503, {}).fetchImpl,
    })
    await expect(
      down.search({ query: 'x', freshness: 'any' }, 'web'),
    ).rejects.toMatchObject({ reason: 'network' })
    const offline = createOpenAiSearch({ apiKey: 'k', model: 'm', networkDisabled: true })
    await expect(
      offline.search({ query: 'x', freshness: 'any' }, 'web'),
    ).rejects.toMatchObject({ reason: 'disabled' })
  })

  it('the instructions name the scope of each mode', () => {
    expect(searchInstructions({ query: 'x', freshness: 'day' }, 'official')).toContain(
      'officiella källan',
    )
    expect(searchInstructions({ query: 'x', freshness: 'day' }, 'news')).toContain(
      'nyhetskällor',
    )
  })
})
