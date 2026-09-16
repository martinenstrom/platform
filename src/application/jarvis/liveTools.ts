/**
 * What the voice may ask the firm, and how that becomes a host request.
 *
 * GPT-Live delegates reasoning to a backend model; that model may call these
 * five functions and nothing else. Each is interpreted here into the host
 * contract — `ask`, `status`, `result`, `amend`, `close` — or refused as
 * unsupported. The voice model never sees a command, a run, a playbook
 * entry or an actor id; the backend model never chooses who acts. That is
 * the same boundary `financialOsHostFn` holds for the typed presence,
 * reached from a sideband socket instead of a request.
 *
 * ## The two acts on the open case
 *
 * `add_to_delegation` — "ta hänsyn till dollarn också" — becomes `amend`:
 * the person's words, recorded beside their question with who, when and at
 * which version of the case. `close_case` — "stäng ner det pågående ärendet"
 * — becomes `close`, with the reason the person gave. Both act only on the
 * case the conversation is bound to; with no case bound there is nothing to
 * act on, and the refusal says so rather than guessing at one. Neither
 * carries a target the model chose: the reference is the session's.
 *
 * ## The market, without the firm
 *
 * `get_market_snapshot` — "hur ser amerikanska börsen ut idag?" — is not a
 * host request at all. What is happening in the market is an observation
 * JARVIS answers from fresh data (`marketBrief.ts`), and the ruling of
 * 2026-09-16 forbids turning it into a case, a committee or a thesis. It is
 * interpreted as its own kind, executed against the platform's market data,
 * and never touches the institutional record.
 */

import type { DomainReference } from '~/application/analysis/domainSystem'
import type { HostRequest } from '~/application/analysis/hostContract'
import { isMarketScope, MARKET_SCOPES, type MarketScope } from './marketBrief'

export type LiveToolName =
  | 'delegate_to_financial_os'
  | 'check_delegation'
  | 'get_delegation_result'
  | 'add_to_delegation'
  | 'close_case'
  | 'get_market_snapshot'

/** The reason recorded for a closure the person asked for without giving one. */
export const DEFAULT_CLOSE_REASON = 'På användarens begäran i samtalet.'

/** The function definitions, in the shape the Responses backend takes. */
export const LIVE_TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'delegate_to_financial_os',
    description:
      'Lämnar en investeringsfråga till investeringskommittén i Financial OS på operatörens vägnar. Används för varje investeringsbedömning: köpa, sälja, minska, öka, en position, ett bolag eller en fond givet makro. Svaret säger sanningsenligt vad som gäller — pågående arbete, ett beslut som behövs av användaren, ett hinder, eller att det inte gick.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Frågan som ställdes, på användarens språk.' },
        subject: { type: 'string', description: 'Vad frågan gäller: bolag, fond, tillgång eller tema.' },
      },
      required: ['question', 'subject'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'check_delegation',
    description:
      'Läser var det pågående ärendet står — även om det är stängt, och i så fall varför. Svaret är firmans eget läge, aldrig en gissning.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'get_delegation_result',
    description: 'Hämtar kommitténs slutsats eller CIO:s beslut för det pågående ärendet, om ett resultat faktiskt finns.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'add_to_delegation',
    description:
      'Lägger till användarens egna ord i det pågående ärendet, till exempel "ta hänsyn till dollarn också". Tillägget registreras hos firman med vem, när och i vilket läge ärendet var. Svaret säger om arbete som redan gjorts föregår tillägget.',
    parameters: {
      type: 'object',
      properties: { note: { type: 'string', description: 'Vad som ska tas med, med användarens ord.' } },
      required: ['note'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'close_case',
    description:
      'Stänger det pågående ärendet på användarens uttryckliga begäran — "stäng ner det", "avbryt", "lägg ner ärendet". Historiken bevaras; pågående arbete avbryts eller, om inget hunnit göras, läggs ärendet ner. Anropas ALDRIG utan att användaren bett om det.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Varför, med användarens egna ord om de gav ett skäl. Utelämnas annars.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_market_snapshot',
    description:
      'Färska marknadsdata från plattformens egna källor: index med dagsförändring, sektorer, räntor, valutor, råvaror, plattformens riskaptitindex (0–100, härlett — aldrig en VIX-nivå) och dagens rubriker, var och en med observationstid och källa. Anropas för VARJE fråga om hur marknaden, ett index, en sektor, en ränta, en valuta eller en råvara går, står eller rör sig — "idag", "just nu", "senaste", "hur handlar", "vad händer på börsen" — innan du svarar; nivåer ur minnet är förbjudna. Ingen investeringsbedömning, inget ärende: bara observationen. Det som saknas står under unavailable och notServed och sägs som saknat, aldrig gissat.',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: MARKET_SCOPES,
          description:
            '"us" för amerikanska börsen (S&P 500 och Nasdaq 100 som standard, plus sektorer, US 10-year, riskaptit), "europe", "sweden" eller "global". Fråga aldrig användaren vilket index som menas när frågan är vanlig; välj standard och säg vad du använde.',
        },
      },
      required: ['scope'],
      additionalProperties: false,
    },
  },
] as const

export type UnsupportedToolReason =
  /** A status, result, addition or closure was asked for and no case is bound to the conversation. */
  | 'no-open-case'
  | 'unknown-tool'
  | 'invalid-arguments'

export type ToolInterpretation =
  | { kind: 'host'; request: HostRequest }
  /** An observation of the market, answered by JARVIS from fresh data — never the firm. */
  | { kind: 'market'; scope: MarketScope }
  | { kind: 'unsupported'; reason: UnsupportedToolReason }

export interface ToolContext {
  /** The case the conversation is bound to, if any — a pointer the session remembers. */
  reference: DomainReference | null
  requestId: () => string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/** A tool call from the backend, interpreted into the host contract. */
export function interpretToolCall(
  name: string,
  args: unknown,
  context: ToolContext,
): ToolInterpretation {
  const input = isRecord(args) ? args : {}
  switch (name as LiveToolName) {
    case 'delegate_to_financial_os': {
      if (!nonEmpty(input.question) || !nonEmpty(input.subject))
        return { kind: 'unsupported', reason: 'invalid-arguments' }
      return {
        kind: 'host',
        request: {
          kind: 'ask',
          requestId: context.requestId(),
          question: input.question.trim(),
          subject: input.subject.trim(),
        },
      }
    }
    case 'check_delegation':
      if (!context.reference) return { kind: 'unsupported', reason: 'no-open-case' }
      return { kind: 'host', request: { kind: 'status', reference: context.reference } }
    case 'get_delegation_result':
      if (!context.reference) return { kind: 'unsupported', reason: 'no-open-case' }
      return { kind: 'host', request: { kind: 'result', reference: context.reference } }
    case 'add_to_delegation':
      if (!context.reference) return { kind: 'unsupported', reason: 'no-open-case' }
      if (!nonEmpty(input.note)) return { kind: 'unsupported', reason: 'invalid-arguments' }
      return {
        kind: 'host',
        request: {
          kind: 'amend',
          reference: context.reference,
          requestId: context.requestId(),
          text: input.note.trim(),
        },
      }
    case 'get_market_snapshot':
      /* A missing or unknown scope is answered with the widest view, never with a question back. */
      return { kind: 'market', scope: isMarketScope(input.scope) ? input.scope : 'global' }
    case 'close_case':
      if (!context.reference) return { kind: 'unsupported', reason: 'no-open-case' }
      return {
        kind: 'host',
        request: {
          kind: 'close',
          reference: context.reference,
          reason: nonEmpty(input.reason) ? input.reason.trim() : DEFAULT_CLOSE_REASON,
        },
      }
    default:
      return { kind: 'unsupported', reason: 'unknown-tool' }
  }
}
