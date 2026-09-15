/**
 * The OpenAI GPT-Live API, as the two calls the session runtime needs.
 *
 * `POST /v1/live/sessions` with the browser's SDP offer and the session
 * config, and the sideband WebSocket `/v1/live/sessions/{id}/attach`. Both
 * carry the server-side key; the browser never sees it. Node's built-in
 * WebSocket takes the `Authorization` header through its options — measured
 * to work on 2026-09-15, every delegation of the proof went through it.
 */

import type { LiveProvider, LiveSideband } from './liveSession'

export const OPENAI_LIVE_BASE = 'https://api.openai.com/v1/live/sessions'

export class LiveProviderRefusal extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`live/sessions ${status}: ${detail}`)
    this.name = 'LiveProviderRefusal'
  }
}

export interface OpenAiLiveOptions {
  apiKey: string
  /**
   * The same guard the market-data http client honours: when true, no
   * socket is opened and no request is sent — every call fails at once with
   * `NETWORK_DISABLED`. For test and offline environments.
   */
  networkDisabled?: boolean
  /** Bound on the one HTTP call; the sideband socket has the session's own lifetime. */
  timeoutMs?: number
}

export function createOpenAiLiveProvider({ apiKey, networkDisabled = false, timeoutMs = 15_000 }: OpenAiLiveOptions): LiveProvider {
  const guard = () => {
    if (networkDisabled) throw new LiveProviderRefusal(0, 'NETWORK_DISABLED')
  }
  return {
    async createSession({ session, sdp }) {
      guard()
      const response = await fetch(OPENAI_LIVE_BASE, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ session, transport: { type: 'webrtc', sdp } }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      const text = await response.text()
      if (!response.ok) throw new LiveProviderRefusal(response.status, text.slice(0, 300))
      const body = JSON.parse(text) as { session?: { id?: string }; transport?: { sdp?: string } }
      const id = body.session?.id
      const answer = body.transport?.sdp
      if (!id || !answer) throw new LiveProviderRefusal(502, 'unexpected session shape')
      return { id, sdp: answer }
    },

    async attach(sessionId) {
      guard()
      /*
       * Node's WebSocket accepts `headers` as a non-standard option; the
       * WHATWG signature does not declare it, hence the cast.
       */
      const socket = new WebSocket(`${OPENAI_LIVE_BASE}/${sessionId}/attach`.replace(/^https:/, 'wss:'), {
        headers: { authorization: `Bearer ${apiKey}` },
      } as unknown as string[])
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true })
        socket.addEventListener('error', () => reject(new Error('sideband websocket failed')), { once: true })
      })
      const sideband: LiveSideband = {
        send: (event) => socket.send(JSON.stringify(event)),
        onMessage: (handler) =>
          socket.addEventListener('message', ({ data }) => {
            try {
              handler(JSON.parse(String(data)) as Record<string, unknown>)
            } catch {
              /* not JSON; not ours */
            }
          }),
        onClose: (handler) => socket.addEventListener('close', () => handler()),
        close: () => socket.close(),
      }
      return sideband
    },
  }
}
