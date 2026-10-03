/**
 * Opening a source: only a primary address is fetched, the page is reduced
 * to its readable text with its title and time, and a failure is honest.
 */

import { describe, expect, it } from 'vitest'
import type { ResearchHttp as HttpClient } from './http'
import { createRetriever, extractReadableText, mayRetrieve } from './retrieve'

const PAGE = `<!doctype html><html><head><title>Federal Reserve Board - Federal Reserve issues FOMC statement</title>
<meta property="article:published_time" content="2026-09-16T14:00:00-04:00">
<script>window.x = 1</script><style>.a{}</style></head>
<body><nav><a href="/">Home</a><a href="/news">News</a></nav>
<div id="content"><h3>Federal Reserve issues FOMC statement</h3>
<p>Recent indicators suggest that economic activity has continued to expand at a solid pace.</p>
<p>The Committee decided to maintain the target range for the federal funds rate at 4-1/4 to 4-1/2 percent.</p>
<p>Voting for the monetary policy action were &quot;all&quot; members &amp; alternates.</p></div>
<footer>Last Update: September 16, 2026</footer></body></html>`

describe('extractReadableText', () => {
  it('keeps the content, drops scripts, styles, navigation and the footer, decodes entities, reads the time', () => {
    const extracted = extractReadableText(PAGE)
    expect(extracted.title).toBe(
      'Federal Reserve Board - Federal Reserve issues FOMC statement',
    )
    expect(extracted.publishedAt).toBe('2026-09-16T18:00:00.000Z')
    expect(extracted.text).toContain(
      'maintain the target range for the federal funds rate at 4-1/4 to 4-1/2 percent',
    )
    expect(extracted.text).toContain('"all" members & alternates')
    expect(extracted.text).not.toContain('window.x')
    expect(extracted.text).not.toContain('Home')
    expect(extracted.text).not.toContain('Last Update')
  })
})

describe('createRetriever', () => {
  const calls: string[] = []
  const http: HttpClient = {
    async getText(url: string) {
      calls.push(url)
      return PAGE
    },
    async getJson<T>(): Promise<T> {
      throw new Error('unused')
    },
  }
  const retrieve = createRetriever({
    http,
    now: () => new Date('2026-10-03T12:00:00.000Z'),
    userAgent: 'test',
  })

  it('opens an official page and returns the document with its publisher', async () => {
    const document = await retrieve(
      'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm',
    )
    expect(document).toMatchObject({
      publisher: 'Federal Reserve',
      title: 'Federal Reserve Board - Federal Reserve issues FOMC statement',
      retrievedAt: '2026-10-03T12:00:00.000Z',
    })
    expect(calls).toHaveLength(1)
  })

  it('refuses a news or unknown address before any request', async () => {
    expect(mayRetrieve('https://www.reuters.com/markets/')).toBe(false)
    expect(mayRetrieve('https://www.sec.gov/Archives/edgar/data/1/x.htm')).toBe(true)
    await expect(retrieve('https://www.reuters.com/markets/x')).rejects.toMatchObject({
      reason: 'unsupported',
    })
    expect(calls).toHaveLength(1)
  })
})

describe('block boundaries', () => {
  it('starts a line at a block element’s opening tag, so an inline label never runs into the first sentence', () => {
    const page = `<html><head><title>Styrräntan oförändrad på 1,75 procent | Sveriges Riksbank</title></head><body>
<span class="page-category"><span class="page-category-theme"></span>Pressmeddelande</span>
<h1>Styrräntan oförändrad på 1,75 procent</h1>
<div class="ingress"><p>Direktionen har beslutat att lämna styrräntan oförändrad på 1,75 procent. Men konjunkturen är starkare och utbudsstörningarna fortsätter.</p></div>
<ul><li>Punkt ett</li><li>Punkt två</li></ul></body></html>`
    const { text } = extractReadableText(page)
    const lines = text.split('\n')
    expect(lines).toContain('Pressmeddelande')
    expect(lines).toContain('Punkt ett')
    expect(
      lines.find((line) =>
        line.startsWith('Direktionen har beslutat att lämna styrräntan'),
      ),
    ).toBeDefined()
    expect(text).not.toContain('Pressmeddelande Direktionen')
    /* The heading is the title and is dropped; the sentences are intact. */
    expect(text).not.toContain('Styrräntan oförändrad på 1,75 procent\n')
    expect(text).toContain(
      'Men konjunkturen är starkare och utbudsstörningarna fortsätter.',
    )
  })
})

describe('a label inside the paragraph', () => {
  it('ends a line after a leading inline label span, as on Riksbanken’s statement page', () => {
    const page = `<html><head><title>Styrräntan oförändrad på 1,75 procent | Sveriges Riksbank</title></head><body>
<article><h1 class="page-title ">Styrräntan oförändrad på 1,75 procent</h1>
<p class="preamble"> <span class="page-category"><span class="page-category-theme section-theme-5"></span>Pressmeddelande</span> Direktionen har beslutat att lämna styrräntan oförändrad på 1,75 procent. Men konjunkturen är starkare.</p>
<p>Det finns fortfarande lediga resurser i ekonomin.</p></article></body></html>`
    const { text } = extractReadableText(page)
    const lines = text.split('\n')
    expect(lines).toContain('Pressmeddelande')
    expect(lines).toContain(
      'Direktionen har beslutat att lämna styrräntan oförändrad på 1,75 procent. Men konjunkturen är starkare.',
    )
    expect(text).not.toContain('Pressmeddelande Direktionen')
  })
})
