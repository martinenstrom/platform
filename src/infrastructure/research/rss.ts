/**
 * A small reader for the feeds the official sources publish: RSS 2.0
 * (the Federal Reserve, the ECB, Riksbanken) and Atom (EDGAR). Enough to
 * read a title, a link, a time and a summary; no XML library, no network.
 */

export interface FeedItem {
  title: string
  link: string | null
  /** ISO 8601, when the feed gives a parseable time. */
  publishedAt: string | null
  summary: string | null
  /** Atom only: the child elements of `<content>`, by tag name — EDGAR's filing-date, form-name, items-desc. */
  content: Record<string, string>
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/gu, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);|&#39;/g,
      (entity) => ENTITIES[entity] ?? entity,
    )
}

const stripCdata = (text: string): string =>
  text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')

/** The text of the first `<name>` element inside a fragment, entities decoded; null when absent. */
export function tagText(fragment: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'iu').exec(
    fragment,
  )
  if (!match) return null
  const inner = decodeEntities(stripCdata(match[1]!))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return inner || null
}

/** An Atom `<link href="…">`, else the RSS `<link>` text. */
function linkOf(fragment: string): string | null {
  const atom = /<link\b[^>]*\bhref="([^"]+)"[^>]*\/?>/iu.exec(fragment)
  if (atom) return decodeEntities(atom[1]!)
  return tagText(fragment, 'link')
}

function timeOf(fragment: string): string | null {
  const raw =
    tagText(fragment, 'pubDate') ??
    tagText(fragment, 'updated') ??
    tagText(fragment, 'a10:updated') ??
    tagText(fragment, 'published') ??
    tagText(fragment, 'dc:date')
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

/** EDGAR's `<content>` carries the filing's fields as child elements. */
function contentFields(fragment: string): Record<string, string> {
  const content = /<content\b[^>]*>([\s\S]*?)<\/content>/iu.exec(fragment)?.[1]
  if (!content) return {}
  const fields: Record<string, string> = {}
  for (const match of content.matchAll(/<([a-z][a-z0-9_-]*)>([\s\S]*?)<\/\1>/giu)) {
    const value = decodeEntities(match[2]!)
      .replace(/<[^>]+>/g, '')
      .trim()
    if (value) fields[match[1]!.toLowerCase()] = value
  }
  return fields
}

/** Every item or entry in the feed, in the feed's own order. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = []
  const pattern = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/giu
  for (const match of xml.matchAll(pattern)) {
    const fragment = match[2]!
    const title = tagText(fragment, 'title')
    if (!title) continue
    items.push({
      title,
      link: linkOf(fragment),
      publishedAt: timeOf(fragment),
      summary: tagText(fragment, 'description') ?? tagText(fragment, 'summary'),
      content: contentFields(fragment),
    })
  }
  return items
}
