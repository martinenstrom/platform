/**
 * A typed line to JARVIS, checked field by field.
 *
 * The browser may send the text, an optional subject hint, the case pointer
 * the conversation is bound to, and the live session the line should also be
 * spoken in. Nothing else: an actor, an operator, a command, a model name —
 * refused by name, the way `parseHostRequest` and `parseLiveOpenRequest`
 * refuse them. The reference is a pointer the firm re-reads, never an
 * authority; the session id is the server's own, handed back to it.
 */

import type { CanonicalSymbol } from '~/domain/market'
import type { DomainReference } from '~/application/analysis/domainSystem'
import type { JarvisAnswer } from './answer'
import { parseReference } from './liveOpen'
import { isMarketScope, type MarketScope } from './marketBrief'
import type { MarketConversation, MarketPeriod } from './marketQuery'

export interface MarketContextPointer {
  at: string
  scope?: MarketScope
  conversation?: MarketConversation
}

const MAX_CONVERSATION_SYMBOLS = 8
const RANGES = ['1w', '1m', '3m', '1y', 'ytd'] as const

/** A period as the server wrote it, checked field by field; null for anything else. */
function parsePeriod(value: unknown): MarketPeriod | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null
  switch (value.kind) {
    case 'today':
      return Object.keys(value).length === 1 ? { kind: 'today' } : null
    case 'range':
      return (RANGES as readonly string[]).includes(String(value.range)) &&
        Object.keys(value).length === 2
        ? { kind: 'range', range: value.range as (typeof RANGES)[number] }
        : null
    case 'month':
      return typeof value.year === 'number' &&
        Number.isInteger(value.year) &&
        typeof value.month === 'number' &&
        value.month >= 1 &&
        value.month <= 12 &&
        Object.keys(value).length === 3
        ? { kind: 'month', year: value.year, month: value.month }
        : null
    case 'unsupported':
      return typeof value.label === 'string' &&
        value.label.length <= 40 &&
        Object.keys(value).length === 2
        ? { kind: 'unsupported', label: value.label }
        : null
    default:
      return null
  }
}

/** The market conversation handed back: symbols the platform could have named, a scope, a period. */
function parseConversation(value: unknown): MarketConversation | null {
  if (!isRecord(value) || Object.keys(value).length !== 3) return null
  if (!Array.isArray(value.symbols) || value.symbols.length > MAX_CONVERSATION_SYMBOLS)
    return null
  const symbols: CanonicalSymbol[] = []
  for (const entry of value.symbols) {
    if (typeof entry !== 'string' || !/^[a-z]+:[a-z0-9-]+$/.test(entry)) return null
    symbols.push(entry as CanonicalSymbol)
  }
  if (value.region !== null && !isMarketScope(value.region)) return null
  const period = parsePeriod(value.period)
  if (!period) return null
  return { symbols, region: value.region === null ? null : value.region, period }
}

/** The pointer the server gave back last time: a time, optionally a scope and the conversation. */
export function parseMarketContext(value: unknown): MarketContextPointer | null {
  if (
    !isRecord(value) ||
    typeof value.at !== 'string' ||
    Number.isNaN(Date.parse(value.at))
  )
    return null
  for (const key of Object.keys(value))
    if (key !== 'at' && key !== 'scope' && key !== 'conversation') return null
  const pointer: MarketContextPointer = { at: value.at }
  if (value.scope !== undefined) {
    if (!isMarketScope(value.scope)) return null
    pointer.scope = value.scope
  }
  if (value.conversation !== undefined && value.conversation !== null) {
    const conversation = parseConversation(value.conversation)
    if (!conversation) return null
    pointer.conversation = conversation
  }
  return pointer
}

/** One earlier line of the conversation, as the presence shows it, so a follow-up has its context. */
export interface AskJarvisTurn {
  by: 'user' | 'jarvis'
  text: string
}

export interface AskJarvisRequest {
  text: string
  subject?: string
  reference?: DomainReference
  sessionId?: string
  /** The last few turns before this line, oldest first. Conversational data, never the record. */
  history?: AskJarvisTurn[]
  /**
   * When the conversation last carried a market brief, and — after a market
   * answer — what it was about and over which period, so "och i veckan?"
   * continues it. The server re-reads every number; this is a pointer.
   */
  marketContext?: MarketContextPointer
  /**
   * Where the advisor is: the route on screen. The server resolves the
   * workspace from it — the client, the office, the meeting — the way it
   * re-reads a case reference; the browser never sends an id it chose.
   */
  context?: { route: string }
  /**
   * The record's last structured answer in this conversation, handed back so
   * "ta resten också" or "utveckla punkt två" continues it. Conversational
   * data the server re-arranges; never an authority over the record.
   */
  previous?: JarvisAnswer
}

const MAX_TEXT = 2_000
const MAX_ROUTE = 400
const MAX_PREVIOUS_CHARS = 120_000

/** A structured answer handed back: its shape is checked, its content is the server's own earlier work. */
export function parsePreviousAnswer(value: unknown): JarvisAnswer | null {
  if (!isRecord(value)) return null
  if (value.method !== 'advisory-rules-v1') return null
  if (typeof value.intent !== 'string' || typeof value.scope !== 'string') return null
  if (
    !isRecord(value.about) ||
    !Array.isArray(value.sections) ||
    !Array.isArray(value.sources)
  )
    return null
  if (!Array.isArray(value.actions) || !isRecord(value.titles)) return null
  if (JSON.stringify(value).length > MAX_PREVIOUS_CHARS) return null
  return value as unknown as JarvisAnswer
}
/** How much of the conversation travels with a line: enough for "varför?", not a transcript. */
export const MAX_HISTORY_TURNS = 12
export const MAX_HISTORY_TURN_CHARS = 600

function parseHistory(value: unknown): AskJarvisTurn[] | null {
  if (!Array.isArray(value)) return null
  const turns: AskJarvisTurn[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    if (entry.by !== 'user' && entry.by !== 'jarvis') return null
    if (typeof entry.text !== 'string') return null
    const text = entry.text.trim().slice(0, MAX_HISTORY_TURN_CHARS)
    if (text) turns.push({ by: entry.by, text })
  }
  return turns.slice(-MAX_HISTORY_TURNS)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseAskJarvisRequest(
  input: unknown,
): { ok: true; request: AskJarvisRequest } | { ok: false; field: string } {
  if (!isRecord(input)) return { ok: false, field: '' }
  for (const key of Object.keys(input)) {
    if (
      key !== 'text' &&
      key !== 'subject' &&
      key !== 'reference' &&
      key !== 'sessionId' &&
      key !== 'history' &&
      key !== 'marketContext' &&
      key !== 'context' &&
      key !== 'previous'
    )
      return { ok: false, field: key }
  }
  let previous: JarvisAnswer | undefined
  if (input.previous !== undefined && input.previous !== null) {
    const parsed = parsePreviousAnswer(input.previous)
    if (!parsed) return { ok: false, field: 'previous' }
    previous = parsed
  }
  let context: { route: string } | undefined
  if (input.context !== undefined && input.context !== null) {
    const value = input.context
    if (
      !isRecord(value) ||
      typeof value.route !== 'string' ||
      !value.route.startsWith('/') ||
      value.route.length > MAX_ROUTE ||
      Object.keys(value).length !== 1
    )
      return { ok: false, field: 'context' }
    context = { route: value.route }
  }
  let marketContext: MarketContextPointer | undefined
  if (input.marketContext !== undefined && input.marketContext !== null) {
    const parsed = parseMarketContext(input.marketContext)
    if (!parsed) return { ok: false, field: 'marketContext' }
    marketContext = parsed
  }
  if (
    typeof input.text !== 'string' ||
    input.text.trim().length === 0 ||
    input.text.length > MAX_TEXT
  )
    return { ok: false, field: 'text' }
  if (input.subject !== undefined && typeof input.subject !== 'string')
    return { ok: false, field: 'subject' }
  if (
    input.sessionId !== undefined &&
    (typeof input.sessionId !== 'string' || !input.sessionId)
  )
    return { ok: false, field: 'sessionId' }
  let reference: DomainReference | undefined
  if (input.reference !== undefined) {
    const parsed = parseReference(input.reference)
    if (!parsed) return { ok: false, field: 'reference' }
    reference = parsed
  }
  let history: AskJarvisTurn[] | undefined
  if (input.history !== undefined) {
    const parsed = parseHistory(input.history)
    if (!parsed) return { ok: false, field: 'history' }
    if (parsed.length > 0) history = parsed
  }
  const subject = typeof input.subject === 'string' ? input.subject.trim() : ''
  return {
    ok: true,
    request: {
      text: input.text.trim(),
      ...(subject ? { subject } : {}),
      ...(reference ? { reference } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(history ? { history } : {}),
      ...(marketContext ? { marketContext } : {}),
      ...(context ? { context } : {}),
      ...(previous ? { previous } : {}),
    },
  }
}
