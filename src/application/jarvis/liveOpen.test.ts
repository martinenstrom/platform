import { describe, expect, it } from 'vitest'
import { parseLiveOpenRequest } from './liveOpen'

const reference = { system: 'financial-os', kind: 'case', id: 'case-1', provenanceId: 'p' } as const

describe('the open request', () => {
  it('takes an offer, a voice and the conversation’s case pointer', () => {
    expect(parseLiveOpenRequest({ sdp: 'v=0', voice: 'cedar', reference })).toEqual({
      ok: true,
      request: { sdp: 'v=0', voice: 'cedar', reference },
    })
    expect(parseLiveOpenRequest({ sdp: 'v=0' })).toEqual({ ok: true, request: { sdp: 'v=0' } })
  })

  it('refuses any field it does not name, by name', () => {
    expect(parseLiveOpenRequest({ sdp: 'v=0', actorEmployeeId: 'cio' })).toEqual({ ok: false, field: 'actorEmployeeId' })
    expect(parseLiveOpenRequest({ sdp: 'v=0', operator: 'x' })).toEqual({ ok: false, field: 'operator' })
    expect(parseLiveOpenRequest({ sdp: 'v=0', command: 'AcceptContribution' })).toEqual({ ok: false, field: 'command' })
  })

  it('refuses a malformed offer, voice or reference', () => {
    expect(parseLiveOpenRequest({ sdp: '' })).toEqual({ ok: false, field: 'sdp' })
    expect(parseLiveOpenRequest({ sdp: 'v=0', voice: 3 })).toEqual({ ok: false, field: 'voice' })
    expect(parseLiveOpenRequest({ sdp: 'v=0', reference: { ...reference, actorEmployeeId: 'cio' } })).toEqual({ ok: false, field: 'reference' })
    expect(parseLiveOpenRequest({ sdp: 'v=0', reference: { ...reference, system: 'other' } })).toEqual({ ok: false, field: 'reference' })
    expect(parseLiveOpenRequest('v=0')).toEqual({ ok: false, field: '' })
  })
})
