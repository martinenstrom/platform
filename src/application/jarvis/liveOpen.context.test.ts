/**
 * The open request carries where the advisor is — a route and nothing else
 * — and the workspace tool is interpreted as a question for the record.
 */

import { describe, expect, it } from 'vitest'
import { parseLiveOpenRequest, parseRouteContext } from './liveOpen'
import { interpretToolCall } from './liveTools'

describe('the route in the open request', () => {
  it('accepts a route, and refuses an id the browser chose beside it', () => {
    expect(
      parseLiveOpenRequest({ sdp: 'v=0', context: { route: '/clients/cl-dahlqvist' } }),
    ).toEqual({
      ok: true,
      request: { sdp: 'v=0', context: { route: '/clients/cl-dahlqvist' } },
    })
    expect(
      parseLiveOpenRequest({ sdp: 'v=0', context: { route: '/x', clientId: 'cl-x' } }),
    ).toEqual({
      ok: false,
      field: 'context',
    })
    expect(parseLiveOpenRequest({ sdp: 'v=0', context: { route: 'clients' } })).toEqual({
      ok: false,
      field: 'context',
    })
    expect(parseLiveOpenRequest({ sdp: 'v=0', clientId: 'cl-x' })).toEqual({
      ok: false,
      field: 'clientId',
    })
    expect(parseRouteContext({ route: '/sentinel' })).toEqual({ route: '/sentinel' })
    expect(parseRouteContext({ route: '/sentinel', officeId: 'of-x' })).toBeNull()
    expect(parseRouteContext('/sentinel')).toBeNull()
  })
})

describe('the workspace tool', () => {
  it('is interpreted as a question for the record, trimmed and bounded, never with a target of the model’s choosing', () => {
    expect(
      interpretToolCall(
        'answer_from_workspace',
        { question: '  Vad har de i totalförmögenhet?  ', clientId: 'cl-x' },
        { reference: null, requestId: () => 'r' },
      ),
    ).toEqual({ kind: 'workspace', question: 'Vad har de i totalförmögenhet?' })
    expect(
      interpretToolCall(
        'answer_from_workspace',
        {},
        { reference: null, requestId: () => 'r' },
      ),
    ).toEqual({
      kind: 'workspace',
      question: '',
    })
    const long = interpretToolCall(
      'answer_from_workspace',
      { question: 'x'.repeat(700) },
      { reference: null, requestId: () => 'r' },
    )
    expect(long.kind === 'workspace' && long.question.length).toBe(600)
  })
})
