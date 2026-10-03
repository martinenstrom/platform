/**
 * Opening a source: the page fetched and reduced to its readable text, so
 * a material claim — a policy rate, a release figure, a guidance sentence
 * — is read from the document and not from a snippet. Only a primary
 * source is opened: an official or an issuer address by the reviewed
 * table. Everything else is refused here, before any request.
 */

import {
  PublicResearchUnavailable,
  type RetrievedDocument,
} from '~/application/jarvis/research/publicSearch'
import { authorityOf } from '~/application/jarvis/research/sourceAuthority'
import type { ResearchHttp } from './http'
import { decodeEntities } from './rss'

export const MAX_DOCUMENT_CHARS = 20_000

export interface RetrieverDeps {
  http: ResearchHttp
  now: () => Date
  userAgent: string
  timeoutMs?: number
}

/** A primary source by address: official or issuer. */
export function mayRetrieve(url: string): boolean {
  return authorityOf(url).authority <= 2
}

/** The readable text of an HTML page, its title, and the publication time where the page states one. */
export function extractReadableText(html: string): {
  title: string | null
  text: string
  publishedAt: string | null
} {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1]
  const meta = (names: string[]): string | null => {
    for (const name of names) {
      const match = new RegExp(
        `<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]+content=["']([^"']+)["']`,
        'iu',
      ).exec(html)
      if (match) return match[1]!
      const reversed = new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${name}["']`,
        'iu',
      ).exec(html)
      if (reversed) return reversed[1]!
    }
    return null
  }
  const stamp = meta([
    'article:published_time',
    'datePublished',
    'pubdate',
    'date',
    'DC.date.issued',
  ])
  const parsed = stamp ? Date.parse(stamp) : NaN
  const body = html
    /* Line breaks in the source are formatting, not sentence ends; the block tags below mark the real ones. */
    .replace(/\r?\n/g, ' ')
    /* The head is metadata — the title is read separately above — never text of the document. */
    .replace(/<head\b[\s\S]*?<\/head>/giu, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/giu, ' ')
    .replace(
      /<(?:nav|header|footer|aside|noscript|svg|form)\b[\s\S]*?<\/(?:nav|header|footer|aside|noscript|svg|form)>/giu,
      ' ',
    )
    .replace(/<!--[\s\S]*?-->/g, ' ')
    /* Decorative empty spans (a theme marker) carry no text and would hide a label from the rule below. */
    .replace(/<span\b[^>]*>\s*<\/span>/giu, '')
    /*
     * A label at the head of a paragraph — "<p class="preamble"><span
     * class="page-category">Pressmeddelande</span> Direktionen har beslutat
     * …" — is a formatting boundary, not part of the first sentence: the
     * leading inline span ends a line. The words themselves are kept.
     */
    .replace(
      /(<(?:p|div|h[1-6]|li|td|dd|section|article)\b[^>]*>\s*(?:<span\b[^>]*>[^<]*<\/span>\s*)+)/giu,
      '$1\n',
    )
    /*
     * A block element begins and ends a line — its opening tag as much as its
     * closing one, so an inline label before a paragraph ("Pressmeddelande"
     * in a span, then <p>Direktionen har beslutat …) never runs into the
     * paragraph's first sentence. The text itself is untouched.
     */
    .replace(
      /<\/?(?:html|body|p|div|li|h[1-6]|tr|td|th|ul|ol|table|section|article|blockquote|main|dl|dt|dd|figure|figcaption|header|footer|nav|aside|form|title)\b[^>]*>|<br\s*\/?>/giu,
      '\n',
    )
    .replace(/<[^>]+>/g, ' ')
  const cleanTitle = title
    ? decodeEntities(title).replace(/\s+/g, ' ').trim() || null
    : null
  /* The page's own title is a label, not a sentence of the document: it goes with the metadata, not the text. */
  const titleHead = cleanTitle?.split(/\s[|–-]\s/)[0]?.trim() ?? ''
  const text = decodeEntities(body)
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return trimmed !== cleanTitle && (titleHead.length < 12 || trimmed !== titleHead)
    })
    .join('\n')
    .trim()
    .slice(0, MAX_DOCUMENT_CHARS)
  return {
    title: cleanTitle,
    text,
    publishedAt: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
  }
}

export function createRetriever(
  deps: RetrieverDeps,
): (url: string) => Promise<RetrievedDocument> {
  return async (url) => {
    if (!mayRetrieve(url))
      throw new PublicResearchUnavailable('unsupported', `not a primary source: ${url}`)
    const signal = AbortSignal.timeout(deps.timeoutMs ?? 15_000)
    let html: string
    try {
      html = await deps.http.getText(url, signal, {
        'user-agent': deps.userAgent,
        accept: 'text/html, application/xhtml+xml, text/plain, */*',
      })
    } catch (error) {
      if (error instanceof PublicResearchUnavailable) throw error
      const name = error instanceof Error ? error.name : ''
      throw new PublicResearchUnavailable(
        name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
        `${url}: ${String(error).slice(0, 120)}`,
      )
    }
    const extracted = extractReadableText(html)
    return {
      url,
      title: extracted.title,
      text: extracted.text,
      publishedAt: extracted.publishedAt,
      retrievedAt: deps.now().toISOString(),
      publisher: authorityOf(url).publisher,
    }
  }
}
