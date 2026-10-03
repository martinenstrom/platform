/**
 * The typed door, parsed field by field: a line, an optional subject, the
 * case pointer already held, the session to speak in — and nothing else.
 */

import { describe, expect, it } from 'vitest'
import { parseAskJarvisRequest } from './askJarvis'

const reference = {
  system: 'financial-os',
  kind: 'case',
  id: 'case-1',
  provenanceId: 'p',
}

describe('a typed line to JARVIS', () => {
  it('accepts the line alone, trimmed', () => {
    expect(
      parseAskJarvisRequest({ text: '  Hur ser amerikanska börsen ut idag? ' }),
    ).toEqual({
      ok: true,
      request: { text: 'Hur ser amerikanska börsen ut idag?' },
    })
  })

  it('accepts a subject hint, the bound case and a live session', () => {
    expect(
      parseAskJarvisRequest({
        text: 'Är Nvidia köpvärd?',
        subject: ' Nvidia ',
        reference,
        sessionId: 'live-1',
      }),
    ).toEqual({
      ok: true,
      request: {
        text: 'Är Nvidia köpvärd?',
        subject: 'Nvidia',
        reference,
        sessionId: 'live-1',
      },
    })
    /* An empty hint is no hint. */
    expect(parseAskJarvisRequest({ text: 'x', subject: '  ' })).toEqual({
      ok: true,
      request: { text: 'x' },
    })
  })

  it('carries the last turns as context, bounded, and refuses a malformed one', () => {
    const history = Array.from({ length: 15 }, (_, i) => ({
      by: i % 2 ? 'jarvis' : 'user',
      text: `t${i}`,
    }))
    const parsed = parseAskJarvisRequest({ text: 'Varför?', history })
    if (!parsed.ok) throw new Error(parsed.field)
    expect(parsed.request.history).toHaveLength(12)
    expect(parsed.request.history![0]).toEqual({ by: 'jarvis', text: 't3' })
    expect(parsed.request.history![11]).toEqual({ by: 'user', text: 't14' })
    /* A long turn is cut, an empty one dropped, an empty history is no history. */
    const long = parseAskJarvisRequest({
      text: 'x',
      history: [
        { by: 'jarvis', text: 'a'.repeat(700) },
        { by: 'user', text: '  ' },
      ],
    })
    if (!long.ok) throw new Error(long.field)
    expect(long.request.history).toEqual([{ by: 'jarvis', text: 'a'.repeat(600) }])
    expect(parseAskJarvisRequest({ text: 'x', history: [] })).toEqual({
      ok: true,
      request: { text: 'x' },
    })
    for (const bad of [
      'not a list',
      [{ by: 'system', text: 'x' }],
      [{ by: 'user' }],
      [{ by: 'user', text: 1 }],
    ]) {
      expect(parseAskJarvisRequest({ text: 'x', history: bad })).toEqual({
        ok: false,
        field: 'history',
      })
    }
  })

  it('carries when the conversation last held a market brief, and refuses anything but a time', () => {
    expect(
      parseAskJarvisRequest({
        text: 'Varför?',
        marketContext: { at: '2026-09-16T18:21:00.000Z' },
      }),
    ).toEqual({
      ok: true,
      request: { text: 'Varför?', marketContext: { at: '2026-09-16T18:21:00.000Z' } },
    })
    expect(parseAskJarvisRequest({ text: 'x', marketContext: null })).toEqual({
      ok: true,
      request: { text: 'x' },
    })
    for (const bad of [
      { at: 'yesterday' },
      { at: 1 },
      { at: '2026-09-16T18:21:00.000Z', brief: {} },
      'now',
    ]) {
      expect(parseAskJarvisRequest({ text: 'x', marketContext: bad })).toEqual({
        ok: false,
        field: 'marketContext',
      })
    }
  })

  it('carries the market conversation back as the server wrote it, and refuses one it did not', () => {
    const conversation = {
      symbols: ['idx:nasdaq100'],
      region: null,
      period: { kind: 'range', range: '1w' },
    }
    expect(
      parseAskJarvisRequest({
        text: 'Jämför med S&P.',
        marketContext: { at: '2026-10-02T15:00:00.000Z', scope: 'us', conversation },
      }),
    ).toEqual({
      ok: true,
      request: {
        text: 'Jämför med S&P.',
        marketContext: { at: '2026-10-02T15:00:00.000Z', scope: 'us', conversation },
      },
    })
    for (const bad of [
      {
        symbols: ['idx:nasdaq100'],
        region: null,
        period: { kind: 'range', range: '2w' },
      },
      { symbols: ['DROP TABLE'], region: null, period: { kind: 'today' } },
      { symbols: [], region: 'mars', period: { kind: 'today' } },
      { symbols: [], region: null, period: { kind: 'today' }, level: 6512 },
      {
        symbols: new Array(9).fill('idx:sp500'),
        region: null,
        period: { kind: 'today' },
      },
    ]) {
      expect(
        parseAskJarvisRequest({
          text: 'x',
          marketContext: { at: '2026-10-02T15:00:00.000Z', conversation: bad },
        }),
      ).toEqual({ ok: false, field: 'marketContext' })
    }
    expect(
      parseAskJarvisRequest({
        text: 'x',
        marketContext: { at: '2026-10-02T15:00:00.000Z', scope: 'nowhere' },
      }),
    ).toEqual({ ok: false, field: 'marketContext' })
  })

  it('carries where the advisor is as a route, and refuses anything but one', () => {
    expect(
      parseAskJarvisRequest({
        text: 'Vad har jag lovat?',
        context: { route: '/clients/cl-dahlqvist' },
      }),
    ).toEqual({
      ok: true,
      request: {
        text: 'Vad har jag lovat?',
        context: { route: '/clients/cl-dahlqvist' },
      },
    })
    expect(parseAskJarvisRequest({ text: 'x', context: null })).toEqual({
      ok: true,
      request: { text: 'x' },
    })
    /* An id of the browser's choosing never crosses: only the route, which the server resolves. */
    for (const bad of [
      { clientId: 'cl-x' },
      { route: 'clients' },
      { route: '/x', clientId: 'cl-x' },
      { route: 7 },
      '/clients',
      { route: `/${'x'.repeat(400)}` },
    ]) {
      expect(parseAskJarvisRequest({ text: 'x', context: bad })).toEqual({
        ok: false,
        field: 'context',
      })
    }
  })

  it('refuses an empty or oversized line', () => {
    expect(parseAskJarvisRequest({ text: '   ' })).toEqual({ ok: false, field: 'text' })
    expect(parseAskJarvisRequest({ text: 'x'.repeat(2_001) })).toEqual({
      ok: false,
      field: 'text',
    })
    expect(parseAskJarvisRequest({})).toEqual({ ok: false, field: 'text' })
    expect(parseAskJarvisRequest('Hur går börsen?')).toEqual({ ok: false, field: '' })
  })

  it('refuses an actor, an operator, a model or a command by name', () => {
    for (const field of [
      'actingEmployeeId',
      'actorId',
      'operator',
      'model',
      'command',
      'caseId',
      'instructions',
    ]) {
      expect(parseAskJarvisRequest({ text: 'x', [field]: 'v' })).toEqual({
        ok: false,
        field,
      })
    }
  })

  it('refuses a malformed reference or session id', () => {
    expect(parseAskJarvisRequest({ text: 'x', reference: { id: 'case-1' } })).toEqual({
      ok: false,
      field: 'reference',
    })
    expect(
      parseAskJarvisRequest({ text: 'x', reference: { ...reference, system: 'other' } }),
    ).toEqual({
      ok: false,
      field: 'reference',
    })
    expect(parseAskJarvisRequest({ text: 'x', sessionId: '' })).toEqual({
      ok: false,
      field: 'sessionId',
    })
    expect(parseAskJarvisRequest({ text: 'x', sessionId: 7 })).toEqual({
      ok: false,
      field: 'sessionId',
    })
  })
})
