/**
 * What the voice may ask the firm, and how that becomes a host request.
 *
 * GPT-Live delegates reasoning to a backend model; that model may call these
 * four functions and nothing else. Each is interpreted here into the host
 * contract — `ask`, `status`, `result` — or refused as unsupported. The
 * voice model never sees a command, a run, a playbook entry or an actor id;
 * the backend model never chooses who acts. That is the same boundary
 * `financialOsHostFn` holds for the typed presence, reached from a sideband
 * socket instead of a request.
 *
 * ## The temporary boundary, stated
 *
 * `add_to_delegation` — "ta hänsyn till dollarn också" while a case is open —
 * has no host request to become. The host contract carries no way to attach
 * context to a case, and inventing one here would be a second institutional
 * router. It is interpreted as `unsupported` with a reason the voice can say
 * honestly; the session's own conversation keeps the remark until the firm
 * has a door for it.
 */

import type { DomainReference } from '~/application/analysis/domainSystem'
import type { HostRequest } from '~/application/analysis/hostContract'

export type LiveToolName =
  | 'delegate_to_financial_os'
  | 'check_delegation'
  | 'get_delegation_result'
  | 'add_to_delegation'

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
    description: 'Läser var det senaste ärendet står. Svaret är firmans eget läge, aldrig en gissning.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'get_delegation_result',
    description: 'Hämtar kommitténs slutsats eller CIO:s beslut för det senaste ärendet, om ett resultat faktiskt finns.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'add_to_delegation',
    description:
      'Ett tillägg till det pågående ärendet, till exempel "ta hänsyn till dollarn också". Firman kan ännu inte ta emot tillägg till ett öppet ärende; svaret säger det.',
    parameters: {
      type: 'object',
      properties: { note: { type: 'string', description: 'Vad som ska tas med.' } },
      required: ['note'],
      additionalProperties: false,
    },
  },
] as const

export type UnsupportedToolReason =
  /** The firm has no door for this yet — `add_to_delegation`. */
  | 'context-not-supported'
  /** A status or result was asked for and no case is bound to the conversation. */
  | 'no-open-case'
  | 'unknown-tool'
  | 'invalid-arguments'

export type ToolInterpretation =
  | { kind: 'host'; request: HostRequest }
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
      return {
        kind: 'unsupported',
        reason: context.reference ? 'context-not-supported' : 'no-open-case',
      }
    default:
      return { kind: 'unsupported', reason: 'unknown-tool' }
  }
}
