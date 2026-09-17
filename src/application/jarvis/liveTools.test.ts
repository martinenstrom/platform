/**
 * The voice's five functions, interpreted into the host contract and nothing
 * lower: an ask carries no actor, a status needs a bound case, an addition
 * and a closure act only on the case the conversation is bound to.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_CLOSE_REASON, interpretToolCall, LIVE_TOOL_DEFINITIONS } from './liveTools'

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

describe('the person’s answer to the one question', () => {
  it('is their words on the bound case, with the focus they named, never a host request the model wrote', () => {
    expect(
      interpretToolCall('begin_delegation', { view: '  Pröva den öppet. ', focus: ['makro', ' flöden ', 7, ''] }, context(true)),
    ).toEqual({ kind: 'begin', reference, words: 'Pröva den öppet.', focus: ['makro', 'flöden'] })
    expect(interpretToolCall('begin_delegation', {}, context(true))).toEqual({
      kind: 'begin',
      reference,
      words: null,
      focus: [],
    })
    expect(
      interpretToolCall('begin_delegation', { focus: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }, context(true)),
    ).toMatchObject({ focus: ['a', 'b', 'c', 'd', 'e', 'f'] })
  })

  it('has nothing to answer for without a bound case', () => {
    expect(interpretToolCall('begin_delegation', { view: 'Kör.' }, context(false))).toEqual({
      kind: 'unsupported',
      reason: 'no-open-case',
    })
  })
})

describe('the seven functions', () => {
  it('are the only ones, and each is a function definition the backend can take', () => {
    expect(LIVE_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'delegate_to_financial_os',
      'check_delegation',
      'get_delegation_result',
      'add_to_delegation',
      'begin_delegation',
      'close_case',
      'get_market_snapshot',
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

  it('turns an addition into an amend of the bound case, in the person’s words, with the host’s request id', () => {
    const interpreted = interpretToolCall(
      'add_to_delegation',
      { note: ' Ta hänsyn till dollarn också. ', caseId: 'case-99', actorEmployeeId: 'cio' },
      context(true),
    )
    expect(interpreted).toEqual({
      kind: 'host',
      request: { kind: 'amend', reference, requestId: 'req-1', text: 'Ta hänsyn till dollarn också.' },
    })
    if (interpreted.kind === 'host') expect(Object.keys(interpreted.request).sort()).toEqual(['kind', 'reference', 'requestId', 'text'])
    expect(interpretToolCall('add_to_delegation', { note: '   ' }, context(true))).toEqual({
      kind: 'unsupported',
      reason: 'invalid-arguments',
    })
  })

  it('turns a closure into a close of the bound case, with the person’s reason or the conversation’s', () => {
    expect(interpretToolCall('close_case', { reason: ' Behövs inte längre. ' }, context(true))).toEqual({
      kind: 'host',
      request: { kind: 'close', reference, reason: 'Behövs inte längre.' },
    })
    expect(interpretToolCall('close_case', {}, context(true))).toEqual({
      kind: 'host',
      request: { kind: 'close', reference, reason: DEFAULT_CLOSE_REASON },
    })
    /* The model never chooses the target: a case named in the arguments is ignored. */
    const named = interpretToolCall('close_case', { caseId: 'case-99' }, context(true))
    if (named.kind !== 'host' || named.request.kind !== 'close') throw new Error('expected a close')
    expect(named.request.reference).toEqual(reference)
  })

  it('refuses an addition or a closure with no case bound, rather than guessing at one', () => {
    expect(interpretToolCall('add_to_delegation', { note: 'x' }, context(false))).toEqual({
      kind: 'unsupported',
      reason: 'no-open-case',
    })
    expect(interpretToolCall('close_case', { reason: 'x' }, context(false))).toEqual({
      kind: 'unsupported',
      reason: 'no-open-case',
    })
  })

  it('turns a market question into an observation of the market, never into a host request', () => {
    expect(interpretToolCall('get_market_snapshot', { scope: 'us' }, context(false))).toEqual({
      kind: 'market',
      scope: 'us',
    })
    /* No case is needed, and no case is opened: the reference is untouched either way. */
    expect(interpretToolCall('get_market_snapshot', { scope: 'sweden' }, context(true))).toEqual({
      kind: 'market',
      scope: 'sweden',
    })
    /* A missing or unknown scope is the widest view, never a question back and never a refusal. */
    expect(interpretToolCall('get_market_snapshot', {}, context(false))).toEqual({ kind: 'market', scope: 'global' })
    expect(interpretToolCall('get_market_snapshot', { scope: 'mars' }, context(false))).toEqual({
      kind: 'market',
      scope: 'global',
    })
  })

  it('refuses a function it does not define', () => {
    expect(interpretToolCall('accept_contribution', { runId: 'r' }, context(true))).toEqual({
      kind: 'unsupported',
      reason: 'unknown-tool',
    })
  })
})
