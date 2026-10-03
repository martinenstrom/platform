/**
 * The research adapters' HTTP seam: text and JSON over an injected fetch,
 * refused outright when the network is switched off, and every failure an
 * honest `PublicResearchUnavailable` with its reason.
 */

import { describe, expect, it } from 'vitest'
import { createResearchHttp } from './http'

const respond = (status: number, body: string) => {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
    return new Response(body, { status })
  }
  return { calls, fetchImpl }
}

const signal = () => AbortSignal.timeout(5_000)

describe('createResearchHttp', () => {
  it('reads text and JSON with the headers it was given', async () => {
    const { calls, fetchImpl } = respond(200, '{"status":"REQUEST_SUCCEEDED"}')
    const http = createResearchHttp({ networkDisabled: false, fetchImpl })
    expect(
      await http.getText('https://www.riksbank.se/rss', signal(), { 'user-agent': 'x' }),
    ).toContain('REQUEST_SUCCEEDED')
    expect(
      await http.getJson<{ status: string }>('https://api.bls.gov/x', signal()),
    ).toEqual({
      status: 'REQUEST_SUCCEEDED',
    })
    expect(calls[0]!.headers).toEqual({ 'user-agent': 'x' })
    expect(calls[1]!.headers.accept).toBe('application/json')
  })

  it('refuses every request when the network is off, and names a refusal, an outage and unreadable JSON', async () => {
    const off = createResearchHttp({
      networkDisabled: true,
      fetchImpl: respond(200, '').fetchImpl,
    })
    await expect(off.getText('https://x', signal())).rejects.toMatchObject({
      reason: 'disabled',
    })
    const forbidden = createResearchHttp({
      networkDisabled: false,
      fetchImpl: respond(403, '').fetchImpl,
    })
    await expect(forbidden.getText('https://x', signal())).rejects.toMatchObject({
      reason: 'refused',
    })
    const down = createResearchHttp({
      networkDisabled: false,
      fetchImpl: respond(503, '').fetchImpl,
    })
    await expect(down.getText('https://x', signal())).rejects.toMatchObject({
      reason: 'network',
    })
    const garbled = createResearchHttp({
      networkDisabled: false,
      fetchImpl: respond(200, 'not json').fetchImpl,
    })
    await expect(garbled.getJson('https://x', signal())).rejects.toMatchObject({
      reason: 'network',
    })
  })
})
