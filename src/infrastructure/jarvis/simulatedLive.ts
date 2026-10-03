/**
 * A live provider with no provider: the voice path without audio.
 *
 * With JARVIS_LIVE_SIMULATE=1 the server runs every part of the voice
 * architecture it owns — the session, its route, the workspace tool path,
 * the market fast path, the spoken renderer, the versioned answers the
 * presence polls — against a provider that opens no socket, speaks nothing
 * and, asked to reason, says plainly that it is simulated. What the person
 * "says" arrives through `hearInLiveSessionFn` as text, the way a
 * transcript would. Nothing here reaches a network.
 */

import type { LiveProvider, LiveSideband, ResponsesResult } from './liveSession'

export const SIMULATED_SDP = 'simulated'

/**
 * What the simulated provider says for a line that is neither the market's
 * nor the record's: an honest sentence in the person's words, never an
 * implementation detail. A market question never reaches it — the market
 * path answers those before any model.
 */
export const SIMULATED_MODEL_SAY =
  'Det kan jag inte svara på i den här miljön. Fråga om marknaden eller om det du har på skärmen, så svarar jag ur våra egna data.'

export function createSimulatedLiveProvider(): LiveProvider {
  let counter = 0
  return {
    async createSession() {
      counter += 1
      return { id: `sim-${counter}`, sdp: SIMULATED_SDP }
    },
    async attach(): Promise<LiveSideband> {
      let onMessage: (event: Record<string, unknown>) => void = () => {}
      let onClose: () => void = () => {}
      const sideband: LiveSideband = {
        send: () => {},
        onMessage: (handler) => {
          onMessage = handler
          /* The provider's first word, the way the real one opens. */
          setTimeout(() => onMessage({ type: 'session.started' }), 0)
        },
        onClose: (handler) => {
          onClose = handler
        },
        close: () => onClose(),
      }
      return sideband
    },
    async respond(): Promise<ResponsesResult> {
      return {
        id: 'sim-response',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: SIMULATED_MODEL_SAY }],
          },
        ],
      }
    },
  }
}
