/**
 * The private-data firewall: what may leave Financial OS for the public web.
 *
 * V1 rule, as ruled: PRIVATE CLIENT DATA NEVER LEAVES THE INTERNAL ADVISORY
 * LAYER. A public research request is built from the recogniser's typed
 * slots — instruments, a region, a period, a company, an institution, a
 * release — and those slots name only public things. The advisor's own
 * line travels as a query only where the advisor is on the market or
 * nowhere in particular, and only once this guard has read it and found no
 * client name, no client or household id, no amount, and none of the
 * record's vocabulary. In a client, meeting, office or book scope the line
 * never travels at all.
 *
 * A hybrid line — "vad betyder dagens ränteuppgång för Henrik?" — is
 * decomposed here: the client reference is named for the private layer and
 * the public part is the typed market event alone. Henrik is never sent.
 */

import type { JarvisScope } from '../context'
import { resolveNamedClients, type NamedClient } from '../advisoryIntent'

export interface PrivateVocabulary {
  /** Clients, households and household members by display name. */
  clients: readonly NamedClient[]
  /** Offices by display name; private in the record's scopes, where a line never leaves anyway. */
  offices: readonly string[]
}

export const EMPTY_VOCABULARY: PrivateVocabulary = Object.freeze({
  clients: [],
  offices: [],
})

export type GuardViolation = 'client-name' | 'client-id' | 'amount' | 'private-record'

export type GuardVerdict = { ok: true } | { ok: false; violations: GuardViolation[] }

/* Any id the record mints: `cl-dahlqvist`, `hh-…`, `off-…`, `evt-…`, `cmt-…`. */
const RECORD_ID =
  /(?<![\p{L}\p{N}])(?:cl|hh|off|office|evt|mtg|cmt|opp|int)-[a-z0-9]+(?:-[a-z0-9]+)*(?![\p{L}\p{N}])/iu

/* A money amount in the record's units: "42 miljoner", "1 200 000 kr", "SEK 3,5 mkr". */
const AMOUNT =
  /(?:\d[\d\s.,]*\s?(?:kr|sek|mkr|tkr|mnkr|mdkr|msek|miljoner|miljarder|miljon|miljard|eur|usd|dollar|euro)(?![\p{L}])|(?:sek|usd|eur)\s?\d[\d\s.,]*)/iu

/* The record's own vocabulary: what a client has, owes, wants, fears, promised. */
const PRIVATE_RECORD = new RegExp(
  '(?<![\\p{L}\\p{N}])(?:' +
    [
      'lån\\p{L}*',
      'bolån\\p{L}*',
      'amorter\\p{L}*',
      'kredit\\p{L}*',
      'förmögenhet\\p{L}*',
      'tillgångar\\p{L}*',
      'skuld\\p{L}*',
      'pension\\p{L}*',
      'arv\\p{L}*',
      'skilsmäss\\p{L}*',
      'barn\\p{L}*',
      'familj\\p{L}*',
      'sjuk\\p{L}*',
      'hälsa',
      'oro\\p{L}*',
      'mål(?:et|en)?',
      'möte\\p{L}*',
      'löfte\\p{L}*',
      'åtagande\\p{L}*',
      'klient\\p{L}*',
      'kund\\p{L}*',
      'hushåll\\p{L}*',
      'portfölj\\p{L}*',
      'innehav\\p{L}*',
      'konto\\p{L}*',
      'depå\\p{L}*',
      'relation\\p{L}*',
      'sentinel',
      'marknadspåverkan',
      'mötesunderlag\\p{L}*',
    ].join('|') +
    ')(?![\\p{L}\\p{N}])',
  'iu',
)

/** Whether the line names a client: the record's own resolver, so a first name two clients share is still a name. */
function namesClient(text: string, vocabulary: PrivateVocabulary): boolean {
  const resolution = resolveNamedClients(text, vocabulary.clients)
  if (resolution.kind !== 'none') return true
  /* The resolver ignores a capitalised first word; a line that opens with a client's name is still a line about them. */
  const first = text.match(/^\p{Lu}\p{Ll}+/u)?.[0]
  return (
    first !== undefined &&
    vocabulary.clients.some((client) =>
      client.displayName.split(/[\s&]+/).includes(first),
    )
  )
}

/** Read a text the way the public web would receive it, and refuse anything of the record's. */
export function guardPublicText(
  text: string,
  vocabulary: PrivateVocabulary,
): GuardVerdict {
  const violations: GuardViolation[] = []
  if (namesClient(text, vocabulary)) violations.push('client-name')
  if (RECORD_ID.test(text)) violations.push('client-id')
  if (AMOUNT.test(text)) violations.push('amount')
  if (PRIVATE_RECORD.test(text)) violations.push('private-record')
  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}

/** The scopes where the advisor is looking at the record: a line there never leaves. */
export const RECORD_SCOPES: readonly JarvisScope[] = [
  'CLIENT',
  'MEETING',
  'OFFICE',
  'CLIENT_DIRECTORY',
  'SENTINEL',
  'MARKET_IMPACT',
]

export interface HybridDecomposition {
  /** The client the line referred to, for the private layer; null when it named none. */
  clientReference: NamedClient | null
  /** True when the line fits several clients and nobody is guessed. */
  ambiguous: boolean
}

/** A client the line referred to, resolved against the register and never guessed. */
export function decomposeHybrid(
  text: string,
  vocabulary: PrivateVocabulary,
): HybridDecomposition {
  const resolution = resolveNamedClients(text, vocabulary.clients)
  if (resolution.kind === 'one')
    return { clientReference: resolution.client, ambiguous: false }
  if (resolution.kind === 'many') return { clientReference: null, ambiguous: true }
  const first = text.match(/^\p{Lu}\p{Ll}+/u)?.[0]
  const byFirst = first
    ? vocabulary.clients.filter((client) =>
        client.displayName.split(/[\s&]+/).includes(first),
      )
    : []
  if (byFirst.length === 1) return { clientReference: byFirst[0]!, ambiguous: false }
  return { clientReference: null, ambiguous: byFirst.length > 1 }
}

export interface PublicQueryDecision {
  /** The advisor's line may be sent as a query. */
  lineAllowed: boolean
  violations: GuardViolation[]
  /** Why the line was withheld, when it was. */
  withheld: 'record-scope' | 'guard' | null
}

/** Whether the advisor's own words may leave, given where they are and what the words contain. */
export function decideLine(
  text: string,
  scope: JarvisScope,
  vocabulary: PrivateVocabulary,
): PublicQueryDecision {
  if (RECORD_SCOPES.includes(scope))
    return { lineAllowed: false, violations: [], withheld: 'record-scope' }
  const verdict = guardPublicText(text, vocabulary)
  if (!verdict.ok)
    return { lineAllowed: false, violations: verdict.violations, withheld: 'guard' }
  return { lineAllowed: true, violations: [], withheld: null }
}
