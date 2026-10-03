/**
 * Gathering: the plan's steps through the public port, in order, into
 * evidence. A search result is discovery; what becomes a claim is a
 * sentence the source carries — the span a provider cites, a snippet the
 * source published, or, for the facts that matter most, the document
 * itself opened and read. A failed step is counted and skipped, never
 * invented; when every step fails the answer rests on internal data.
 */

import {
  figuresIn,
  freshnessOf,
  type ResearchClaim,
  type ResearchEvidence,
  type ResearchUnavailableReason,
} from './evidence'
import type {
  PublicSearchPort,
  RetrievedDocument,
  SearchNarrative,
  SearchRequest,
  SearchResponse,
} from './publicSearch'
import { cacheKey, type ResearchCache, type SourceClass } from './researchCache'
import type { PlanStep, ResearchPlan } from './researchPlan'
import type { ResearchQuery } from './researchQuery'
import { authorityOf } from './sourceAuthority'

export interface GatherDeps {
  port: PublicSearchPort | null
  cache: ResearchCache
  now: () => Date
  log?: (line: string) => void
}

export interface GatherOutcome {
  evidence: ResearchEvidence[]
  unavailable: ResearchUnavailableReason | null
  steps: { run: number; failed: number }
  /** Every query string that left the platform. */
  queries: string[]
}

const MAX_CLAIM_CHARS = 320
/** How many primary sources a step opens: the latest decision when quick, two when deep. */
const MAX_RETRIEVALS = { quick: 1, deep: 2 } as const
const MAX_RETRIEVED_CLAIMS = 3
/** A claim is a sentence, not a title or a fragment. */
const MIN_CLAIM_WORDS = 5

const sourceClassOf = (step: PlanStep): SourceClass =>
  step.source === 'calendar' ? 'calendar' : step.source

/**
 * The query a step sends: the advisor's own words where allowed, the step
 * reads the open web and the words carry the subject themselves; the typed
 * template otherwise — a bare "Varför?" leans on the conversation, and the
 * template is what names the subject and the period for a search.
 */
export function queryFor(
  step: PlanStep,
  query: ResearchQuery,
  lineAllowed: boolean,
): string {
  const open = step.source === 'news' || step.source === 'search'
  return open && lineAllowed && !query.continues ? query.line : step.query
}

/* A sentence ends at .!? followed by whitespace and a capital, a digit, a quote or a bracket — never inside "0.4" or "bls.gov". */
const SENTENCE_END = /[.!?]+(?=\s+[\p{Lu}\d"“(\[]|\s*$)/gu

/* "U.S.", "Inc.", "t.ex.", "kl.": a period that ends an abbreviation, not a sentence. */
const ABBREVIATION =
  /(?:^|[\s(])(?:\p{Lu}\.\p{Lu}|\p{L}|Inc|Corp|Ltd|St|Mr|Mrs|Ms|Dr|vs|e\.g|i\.e|ca|approx|bl\.a|t\.ex|dvs|kl|s\.k|m\.m|osv|jan|feb|mar|apr|jun|jul|aug|sep|sept|okt|oct|nov|dec|nr|no)$/iu

/** The sentences of a text with their offsets. */
export function sentencesOf(
  text: string,
): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = []
  let start = 0
  const cut = (end: number) => {
    const raw = text.slice(start, end)
    const trimmed = raw.trim()
    if (trimmed.length >= 12) out.push({ text: trimmed, start, end })
    start = end
  }
  for (const line of text.split('\n')) {
    const lineStart = text.indexOf(line, start)
    const lineEnd = lineStart + line.length
    start = lineStart
    for (const match of line.matchAll(SENTENCE_END)) {
      const before = line.slice(Math.max(0, (match.index ?? 0) - 12), match.index ?? 0)
      if (ABBREVIATION.test(before)) continue
      cut(lineStart + (match.index ?? 0) + match[0].length)
    }
    if (start < lineEnd) cut(lineEnd)
    start = lineEnd + 1
  }
  return out
}

/** A claim cut at a word, never mid-word, and marked where it was cut. */
function bounded(text: string): string {
  if (text.length <= MAX_CLAIM_CHARS) return text
  const head = text.slice(0, MAX_CLAIM_CHARS)
  const atWord = head.lastIndexOf(' ')
  return `${(atWord > MAX_CLAIM_CHARS / 2 ? head.slice(0, atWord) : head).replace(/[,;:\s]+$/, '')}…`
}

const wordCount = (text: string): number => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length

const stripTracking = (url: string): string =>
  url.replace(/[?&]utm_source=openai\b/u, '').replace(/\?$/, '')

/** The provider's markdown links, "([bls.gov](https://…))", which carry its citations in the text itself. */
const MARKDOWN_LINK = /\(?\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)\)?/gu

/** A narrative sentence as a claim: links, bold and the gap before punctuation removed. */
function cleanSentence(text: string): string {
  return bounded(
    text
      .replace(MARKDOWN_LINK, '')
      .replace(/\*\*/g, '')
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/\(\s*\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  )
}

/**
 * The narrative sentences a provider ties to a source, by that source's
 * address. The provider's own markdown links are the anchors where it
 * writes them; its offset citations otherwise. A sentence it does not
 * cite is not a claim.
 */
export function claimsFromNarrative(
  narrative: SearchNarrative,
): Map<string, { title: string | null; claims: ResearchClaim[] }> {
  const byUrl = new Map<string, { title: string | null; claims: ResearchClaim[] }>()
  const add = (url: string, title: string | null, text: string) => {
    if (wordCount(text) < MIN_CLAIM_WORDS) return
    const entry = byUrl.get(url) ?? { title, claims: [] }
    if (!entry.claims.some((claim) => claim.text === text))
      entry.claims.push({ text, basis: 'snippet' })
    byUrl.set(url, entry)
  }
  const links = [...narrative.text.matchAll(MARKDOWN_LINK)]
  if (links.length > 0) {
    /* Each link becomes a token with no punctuation in it, so the sentence splitter never cuts inside an address. */
    let cleaned = ''
    let last = 0
    const urls: string[] = []
    for (const link of links) {
      cleaned += narrative.text.slice(last, link.index)
      urls.push(stripTracking(link[2]!))
      cleaned += ` ⟦${urls.length - 1}⟧`
      last = (link.index ?? 0) + link[0].length
    }
    cleaned += narrative.text.slice(last)
    /* A link written after a sentence's full stop cites that sentence: the token moves inside it. */
    cleaned = cleaned.replace(/([.!?])\s*(⟦\d+⟧(?:\s*⟦\d+⟧)*)/gu, ' $2$1')
    for (const sentence of sentencesOf(cleaned)) {
      const refs = [
        ...new Set([...sentence.text.matchAll(/⟦(\d+)⟧/gu)].map((m) => Number(m[1]))),
      ]
      if (refs.length === 0) continue
      const text = cleanSentence(sentence.text.replace(/\s*⟦\d+⟧/gu, ''))
      for (const ref of refs) {
        const url = urls[ref]!
        const title =
          narrative.citations.find((c) => stripTracking(c.url) === url)?.title ?? null
        add(url, title, text)
      }
    }
    return byUrl
  }
  const sentences = sentencesOf(narrative.text)
  for (const citation of narrative.citations) {
    const sentence = sentences.find(
      (entry) => citation.start < entry.end && citation.end > entry.start,
    )
    if (!sentence) continue
    add(stripTracking(citation.url), citation.title, cleanSentence(sentence.text))
  }
  return byUrl
}

/* A figure in a forecast — "kunde bli aktuell", "väntas", "could", "expected" — is not the fact the key names. */
const FORWARD_LOOKING =
  /(?<![\p{L}])(?:kunde|kan bli|möjlig\p{L}*|väntas|förväntas|prognos\p{L}*|senare (?:i år|under)|framöver|nästa|could|may|might|expected|forecast\p{L}*|later this year|projected)(?![\p{L}])/iu

/** The claim with the key's figure attached, when the sentence states a present fact rather than an expectation. */
export function withFigure(claim: ResearchClaim, topicKey: string | null): ResearchClaim {
  if (!topicKey || claim.figure) return claim
  if (claim.basis !== 'retrieved' && FORWARD_LOOKING.test(claim.text)) return claim
  const figure = figuresIn(claim.text)[0]
  return figure
    ? { ...claim, figure: { key: topicKey, value: figure.value, unit: figure.unit } }
    : claim
}

/** Evidence from one response: a hit per address, the narrative's cited sentences attached to theirs. */
function evidenceFrom(
  response: SearchResponse,
  step: PlanStep,
  query: ResearchQuery,
  now: Date,
  nextId: () => string,
): ResearchEvidence[] {
  const narrative: Map<string, { title: string | null; claims: ResearchClaim[] }> =
    response.narrative ? claimsFromNarrative(response.narrative) : new Map()
  const byUrl = new Map<string, ResearchEvidence>()
  const build = (
    url: string,
    title: string | null,
    snippet: string,
    publishedAt: string | null,
    publisher: string | null,
  ): ResearchEvidence => {
    const identity = authorityOf(url)
    return {
      id: nextId(),
      title: title ?? identity.publisher,
      publisher: publisher ?? identity.publisher,
      url,
      publishedAt,
      retrievedAt: response.searchedAt,
      sourceType: identity.sourceType,
      authority: identity.authority,
      snippet: snippet.slice(0, MAX_CLAIM_CHARS),
      claims: [],
      relevantTo: step.topicKey ? [step.topicKey] : [],
      freshness: freshnessOf(publishedAt, now, query.freshness),
    }
  }
  for (const hit of response.hits.slice(0, step.limit)) {
    const url = stripTracking(hit.url)
    if (byUrl.has(url)) continue
    const item = build(url, hit.title, hit.snippet, hit.publishedAt, hit.publisher)
    const snippet = cleanSentence(hit.snippet)
    /* A publisher's excerpt is a claim when it is a sentence and not merely the title again. */
    if (wordCount(snippet) >= MIN_CLAIM_WORDS && snippet !== hit.title.trim())
      item.claims.push(withFigure({ text: snippet, basis: 'snippet' }, step.topicKey))
    byUrl.set(url, item)
  }
  for (const [url, cited] of narrative) {
    const item = byUrl.get(url) ?? build(url, cited.title, '', null, null)
    /* The cited sentences stand before the source's own snippet: readable in the advisor's language, tied to the source. */
    const fresh = cited.claims
      .filter((claim) => !item.claims.some((known) => known.text === claim.text))
      .map((claim) => withFigure(claim, step.topicKey))
    item.claims = [...fresh, ...item.claims]
    byUrl.set(url, item)
  }
  return [...byUrl.values()]
}

/** The sentences of a document worth quoting: whole sentences with a figure first, then the opening ones; never its title. */
export function claimsFromDocument(
  document: RetrievedDocument,
  topicKey: string | null,
): ResearchClaim[] {
  const title = document.title?.trim() ?? ''
  /* The title's own words, before a " | Publisher" suffix: a sentence that opens with them is the heading, not the text. */
  const titleHead = title.split(/\s[|–-]\s/)[0]?.trim() ?? ''
  const isHeading = (text: string) =>
    text === title ||
    title.startsWith(text) ||
    (titleHead.length >= 12 && text.startsWith(titleHead))
  const sentences = sentencesOf(document.text)
    .map((entry) => cleanSentence(entry.text))
    .filter((text) => wordCount(text) >= MIN_CLAIM_WORDS && !isHeading(text))
  const withFigures = sentences.filter((sentence) => figuresIn(sentence).length > 0)
  const chosen = [
    ...withFigures,
    ...sentences.filter((s) => !withFigures.includes(s)),
  ].slice(0, MAX_RETRIEVED_CLAIMS)
  return chosen.map((text) => withFigure({ text, basis: 'retrieved' }, topicKey))
}

/** Run the plan: every step through the port, cached by source class, the failures counted. */
export async function gatherEvidence(
  plan: ResearchPlan,
  query: ResearchQuery,
  lineAllowed: boolean,
  deps: GatherDeps,
): Promise<GatherOutcome> {
  const log = deps.log ?? (() => {})
  if (!deps.port)
    return {
      evidence: [],
      unavailable: 'public-research-disabled',
      steps: { run: 0, failed: 0 },
      queries: [],
    }
  const port = deps.port
  const evidence: ResearchEvidence[] = []
  const queries: string[] = []
  let counter = 0
  const nextId = () => `e${++counter}`
  let run = 0
  let failed = 0
  const seen = new Set<string>()

  for (const step of plan.steps) {
    const text = queryFor(step, query, lineAllowed)
    const request: SearchRequest = {
      query: text,
      freshness: step.freshness,
      domains: step.domains,
      limit: step.limit,
      locale: lineAllowed && step.source !== 'official' ? 'sv' : 'en',
    }
    /* The feed, when the step has one, is the query an adapter reads it by. */
    const sent = step.feed ? `${step.feed}:${text}` : text
    queries.push(sent)
    const now = deps.now()
    const key = cacheKey(sourceClassOf(step), sent, step.domains)
    run += 1
    let response: SearchResponse | null = deps.cache.get<SearchResponse>(key, {
      now: now.getTime(),
      freshnessCritical: query.freshnessCritical,
    })
    if (!response) {
      try {
        response =
          step.source === 'news'
            ? await port.searchNews(request)
            : step.source === 'official' ||
                step.source === 'calendar' ||
                step.source === 'issuer'
              ? await port.searchOfficial({ ...request, query: sent })
              : await port.search(request)
        deps.cache.set(key, sourceClassOf(step), response, now.getTime())
      } catch (error) {
        failed += 1
        log(`research step ${step.source} failed: ${String(error)}`)
        continue
      }
    }
    const items = evidenceFrom(response, step, query, now, nextId).filter((item) => {
      if (!item.url || seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })

    if (step.retrieve) {
      const primary = items
        .filter((item) => item.authority <= 2 && item.url)
        .slice(0, MAX_RETRIEVALS[query.depth])
      for (const item of primary) {
        const documentKey = cacheKey('document', item.url!)
        let document = deps.cache.get<RetrievedDocument>(documentKey, {
          now: now.getTime(),
          freshnessCritical: query.freshnessCritical,
        })
        if (!document) {
          try {
            document = await port.retrieve(item.url!)
            deps.cache.set(documentKey, 'document', document, now.getTime())
          } catch (error) {
            log(`research retrieve failed for ${item.url}: ${String(error)}`)
            continue
          }
        }
        const retrieved = claimsFromDocument(document, step.topicKey)
        if (retrieved.length > 0) {
          /* What the document says stands before what a snippet said about it; the snippet stays as a further claim. */
          item.claims = [
            ...retrieved,
            ...item.claims.filter(
              (claim) => !retrieved.some((known) => known.text === claim.text),
            ),
          ]
          if (!item.publishedAt && document.publishedAt) {
            item.publishedAt = document.publishedAt
            item.freshness = freshnessOf(document.publishedAt, now, query.freshness)
          }
          if (document.title && item.title === item.publisher) item.title = document.title
        }
      }
    }
    evidence.push(...items)
  }

  return {
    evidence,
    unavailable: run > 0 && failed === run ? 'public-research-unavailable' : null,
    steps: { run, failed },
    queries,
  }
}
