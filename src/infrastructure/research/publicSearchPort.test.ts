/**
 * The composite port: a feed-prefixed official query goes to the feed
 * reader, an open-web query to the configured provider, and with no
 * provider the open web is honestly unavailable while the feeds and the
 * retriever still work. The environment decides which port exists.
 */

import { readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ResearchHttp as HttpClient } from './http'
import { createPublicSearchPort, publicSearchPortFromEnv } from './publicSearchPort'

const FIXTURES = resolvePath(process.cwd(), 'src/infrastructure/research/__fixtures__')
const NOW = new Date('2026-10-03T12:00:00.000Z')

const http: HttpClient = {
  async getText(url: string) {
    if (url.includes('press_monetary.xml'))
      return readFileSync(join(FIXTURES, 'fed.press_monetary.xml'), 'utf8')
    throw new Error(`unexpected ${url}`)
  },
  async getJson<T>(): Promise<T> {
    throw new Error('unused')
  },
}

describe('createPublicSearchPort', () => {
  it('routes a feed query to the feed and, without a provider, refuses the open web honestly', async () => {
    const port = createPublicSearchPort({
      http,
      now: () => NOW,
      openAi: null,
      userAgent: 'test',
    })
    const fed = await port.searchOfficial({
      query: 'fed-monetary:latest',
      freshness: 'month',
      limit: 2,
    })
    expect(fed.provider).toBe('fed-rss')
    expect(fed.hits).toHaveLength(2)
    await expect(
      port.searchNews({ query: 'why', freshness: 'day' }),
    ).rejects.toMatchObject({ reason: 'disabled' })
    await expect(port.search({ query: 'why', freshness: 'day' })).rejects.toMatchObject({
      reason: 'disabled',
    })
    await expect(
      port.searchOfficial({ query: 'no feed here', freshness: 'month' }),
    ).rejects.toMatchObject({ reason: 'disabled' })
  })
})

describe('publicSearchPortFromEnv', () => {
  it('is null when disabled, feeds-only without a key, and the provider with one', () => {
    expect(
      publicSearchPortFromEnv(
        { PUBLIC_RESEARCH_DISABLED: '1', OPENAI_API_KEY: 'k' },
        http,
        () => NOW,
      ),
    ).toBeNull()
    expect(publicSearchPortFromEnv({}, http, () => NOW)).not.toBeNull()
    expect(
      publicSearchPortFromEnv({ OPENAI_API_KEY: 'k' }, http, () => NOW),
    ).not.toBeNull()
    expect(
      publicSearchPortFromEnv(
        { OPENAI_API_KEY: 'k', PUBLIC_RESEARCH_PROVIDER: 'none' },
        http,
        () => NOW,
      ),
    ).not.toBeNull()
  })
})
