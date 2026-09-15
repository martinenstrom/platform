/**
 * The voice's four functions, interpreted into the host contract and nothing
 * lower: an ask carries no actor, a status needs a bound case, a note has no
 * door yet and says so.
 */

import { describe, expect, it } from 'vitest'
import { interpretToolCall, LIVE_TOOL_DEFINITIONS } from './liveTools'

const reference = {
  system: 'financial-os',
  kind: 'case',
  id: 'case-7',
  provenanceId: 'prov-1',
} as const

const context = (bound: boolean) => ({
  reference: bound ? reference : null,
  requestId: () => 'req-1',
})

describe('the four functions', () => {
  it('are the only ones, and each is a function definition the backend can take', () => {
    expect(LIVE_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'delegate_to_financial_os',
      'check_delegation',
      'get_delegation_result',
      'add_to_delegation',
    ])
    for (const tool of LIVE_TOOL_DEFINITIONS) {
      expect(tool.type).toBe('function')
      expect(tool.parameters.additionalProperties).toBe(false)
    }
  })

  it('turns a delegation into an ask with exactly the contract’s fields — no actor, however it was passed', () => {
    const interpreted = interpretToolCall(
      'delegate_to_financial_os',
      { question: ' Borde jag minska Hållbar Energi? ', subject: 'Hållbar Energi', actorEmployeeId: 'cio', actingAs: 'x' },
      context(false),
    )
    expect(interpreted).toEqual({
      kind: 'host',
      request: {
        kind: 'ask',
        requestId: 'req-1',
        question: 'Borde jag minska Hållbar Energi?',
        subject: 'Hållbar Energi',
      },
    })
    if (interpreted.kind === 'host') expect(Object.keys(interpreted.request).sort()).toEqual(['kind', 'question', 'requestId', 'subject'])
  })

  it('refuses a delegation with no question or subject rather than asking the firm something empty', () => {
    expect(interpretToolCall('delegate_to_financial_os', { question: '', subject: 'x' }, context(false))).toEqual({
      kind: 'unsupported',
      reason: 'invalid-arguments',
    })
    expect(interpretToolCall('delegate_to_financial_os', 'not an object', context(false)).kind).toBe('unsupported')
  })

  it('reads status and result only against the case the conversation is bound to', () => {
    expect(interpretToolCall('check_delegation', {}, context(true))).toEqual({
      kind: 'host',
      request: { kind: 'status', reference },
    })
    expect(interpretToolCall('get_delegation_result', {}, context(true))).toEqual({
      kind: 'host',
      request: { kind: 'result', reference },
    })
    expect(interpretToolCall('check_delegation', {}, context(false))).toEqual({ kind: 'unsupported', reason: 'no-open-case' })
    expect(interpretToolCall('get_delegation_result', {}, context(false))).toEqual({ kind: 'unsupported', reason: 'no-open-case' })
  })

  it('has no door for a note on an open case, and does not invent one', () => {
    expect(interpretToolCall('add_to_delegation', { note: 'ta hänsyn till dollarn' }, context(true))).toEqual({
      kind: 'unsupported',
      reason: 'context-not-supported',
    })
    expect(interpretToolCall('add_to_delegation', { note: 'x' }, context(false))).toEqual({
      kind: 'unsupported',
      reason: 'no-open-case',
    })
  })

  it('refuses a function it does not define', () => {
    expect(interpretToolCall('accept_contribution', { runId: 'r' }, context(true))).toEqual({
      kind: 'unsupported',
      reason: 'unknown-tool',
    })
  })
})
