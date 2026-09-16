/**
 * The browser's door to a live voice session, and nothing lower.
 *
 * Four server functions: open (the SDP exchange), state (telemetry and the
 * bound reference, never a transcript), type (text into a live session), and
 * close. The OpenAI key stays on this side; the browser sends an SDP offer
 * and, at most, a voice name. It cannot send an actor, an operator, a case or
 * a command — `parseLiveOpen` refuses any field it does not name, the way
 * `parseHostRequest` does for the typed presence.
 *
 * Every delegation the voice makes is executed by the session runtime through
 * the same host gateway `financialOsHostFn` uses, as the server-resolved
 * operator, with JARVIS as initiator. Voice and text reach the firm through
 * one contract.
 */

import { createServerFn } from '@tanstack/react-start'
import { NotConfiguredError, productHostGateway } from '~/infrastructure/analysis/runtime'
import type { HostRequest, HostResult } from '~/application/analysis/hostContract'
import { parseLiveOpenRequest } from '~/application/jarvis/liveOpen'
import { createLiveRuntime, type LiveConfig, type LiveRuntime, type LiveSessionState, type LiveTelemetry } from './liveSession'
import { createOpenAiLiveProvider, LiveProviderRefusal } from './openaiLive'

/* ------------------------------------------------------------- config */

/** Measured 2026-09-15: the names the API accepts for gpt-live-1. `sol` exists but is gated. */
export const LIVE_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'] as const

/** Per 1M tokens, from the pricing page on 2026-09-15. Other backends fall back to terra's, the dearer. */
const BACKEND_PRICES: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-5.6-luna': { input: 0.2, cached: 0.02, output: 1.2 },
  'gpt-5.6-terra': { input: 2.0, cached: 0.2, output: 12.0 },
}

function liveConfig(): LiveConfig {
  const backendModel = process.env.JARVIS_LIVE_BACKEND_MODEL ?? 'gpt-5.6-luna'
  const price = BACKEND_PRICES[backendModel] ?? BACKEND_PRICES['gpt-5.6-terra']!
  const voice = process.env.JARVIS_LIVE_VOICE ?? 'marin'
  const tier = process.env.JARVIS_LIVE_SERVICE_TIER
  const effort = process.env.JARVIS_LIVE_REASONING
  return {
    model: process.env.JARVIS_LIVE_MODEL ?? 'gpt-live-1',
    backendModel,
    ...(tier === 'auto' || tier === 'default' || tier === 'flex' || tier === 'priority' ? { backendServiceTier: tier } : {}),
    ...(effort === 'minimal' || effort === 'low' || effort === 'medium' || effort === 'high' ? { backendReasoningEffort: effort } : {}),
    voices: LIVE_VOICES,
    defaultVoice: (LIVE_VOICES as readonly string[]).includes(voice) ? voice : 'marin',
    idleSeconds: Number(process.env.JARVIS_LIVE_IDLE_SECONDS ?? 90),
    maxSeconds: Number(process.env.JARVIS_LIVE_MAX_SECONDS ?? 1200),
    prices: {
      voicePerMinuteUsd: Number(process.env.JARVIS_LIVE_PRICE_PER_MINUTE ?? 0.05),
      backendInputUsd: price.input,
      backendCachedUsd: price.cached,
      backendOutputUsd: price.output,
    },
  }
}

/* ------------------------------------------------------------ runtime */

let live: LiveRuntime | null = null

/** The host gateway, with the runtime's configuration failures turned into host results. */
async function host(request: HostRequest): Promise<HostResult> {
  try {
    const gateway = await productHostGateway()
    return await gateway(request)
  } catch (error) {
    if (error instanceof NotConfiguredError) return { state: 'failed', reason: 'not-configured' }
    console.error('[jarvis/live] host gateway failed', error)
    return { state: 'failed', reason: 'service-unavailable' }
  }
}

function runtime(): LiveRuntime | null {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  if (!live) {
    live = createLiveRuntime({
      provider: createOpenAiLiveProvider({
        apiKey,
        networkDisabled: process.env.JARVIS_LIVE_NETWORK_DISABLED === '1',
      }),
      host,
      config: liveConfig(),
      log: (line) => console.log(`[jarvis/live] ${line}`),
    })
  }
  return live
}

/* -------------------------------------------------------- the requests */

export type LiveOpenResponse =
  | { ok: true; sessionId: string; sdp: string }
  | { ok: false; code: 'NOT_CONFIGURED' | 'INVALID_REQUEST' | 'PROVIDER_REFUSED' | 'SERVICE_UNAVAILABLE'; field?: string }

export const openLiveSessionFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }): Promise<LiveOpenResponse> => {
    const parsed = parseLiveOpenRequest(data)
    if (!parsed.ok) return { ok: false, code: 'INVALID_REQUEST', field: parsed.field }
    const rt = runtime()
    if (!rt) return { ok: false, code: 'NOT_CONFIGURED' }
    try {
      const opened = await rt.open(parsed.request)
      return { ok: true, ...opened }
    } catch (error) {
      if (error instanceof LiveProviderRefusal) {
        console.error('[jarvis/live] provider refused', error.status)
        return { ok: false, code: 'PROVIDER_REFUSED' }
      }
      console.error('[jarvis/live] open failed', error)
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  })

export type LiveStateResponse = { ok: true } & LiveSessionState | { ok: false; code: 'NOT_FOUND' | 'NOT_CONFIGURED' }

export const liveSessionStateFn = createServerFn({ method: 'POST' })
  .validator((input: { sessionId: string }) => ({ sessionId: String(input.sessionId) }))
  .handler(async ({ data }): Promise<LiveStateResponse> => {
    const rt = runtime()
    if (!rt) return { ok: false, code: 'NOT_CONFIGURED' }
    const state = rt.state(data.sessionId)
    return state ? { ok: true, ...state } : { ok: false, code: 'NOT_FOUND' }
  })

export const typeIntoLiveSessionFn = createServerFn({ method: 'POST' })
  .validator((input: { sessionId: string; text: string }) => ({ sessionId: String(input.sessionId), text: String(input.text) }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const rt = runtime()
    if (!rt || !data.text.trim()) return { ok: false }
    return { ok: rt.type(data.sessionId, data.text) }
  })

export const closeLiveSessionFn = createServerFn({ method: 'POST' })
  .validator((input: { sessionId: string }) => ({ sessionId: String(input.sessionId) }))
  .handler(async ({ data }): Promise<LiveStateResponse> => {
    const rt = runtime()
    if (!rt) return { ok: false, code: 'NOT_CONFIGURED' }
    const state = await rt.close(data.sessionId)
    return state ? { ok: true, ...state } : { ok: false, code: 'NOT_FOUND' }
  })

export type LiveTelemetryResponse = { ok: true; sessions: LiveTelemetry[] } | { ok: false; code: 'NOT_CONFIGURED' }

/** Every session's counts and money, for the cost view. Never a word of any conversation. */
export const liveTelemetryFn = createServerFn({ method: 'POST' }).handler(async (): Promise<LiveTelemetryResponse> => {
  const rt = runtime()
  if (!rt) return { ok: false, code: 'NOT_CONFIGURED' }
  return { ok: true, sessions: rt.telemetry() }
})
