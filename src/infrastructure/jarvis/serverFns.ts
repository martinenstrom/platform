/**
 * The browser's door to JARVIS, and nothing lower.
 *
 * Live voice: open (the SDP exchange), state (telemetry and the bound
 * reference, never a transcript), type (a line into a live session), close.
 * Typed text: `askJarvisFn`, one line through the same backend model and the
 * same tools the voice delegates to — the one router (TD-95). The OpenAI key
 * stays on this side; the browser sends an SDP offer, a voice name, a line
 * of text, and the case pointer it already holds. It cannot send an actor,
 * an operator, a case id of its choosing or a command — `parseLiveOpen` and
 * `parseAskJarvisRequest` refuse any field they do not name, the way
 * `parseHostRequest` does for the host contract.
 *
 * Every delegation the backend makes is executed by the session runtime
 * through the same host gateway `financialOsHostFn` uses, as the
 * server-resolved operator, with JARVIS as initiator. A market observation
 * is read from the platform's own market data and never reaches the firm.
 */

import { createServerFn } from '@tanstack/react-start'
import { NotConfiguredError, productHostGateway } from '~/infrastructure/analysis/runtime'
import type { HostRequest, HostResult } from '~/application/analysis/hostContract'
import { parseLiveOpenRequest } from '~/application/jarvis/liveOpen'
import { parseAskJarvisRequest } from '~/application/jarvis/askJarvis'
import {
  composeMarketBrief,
  fetchMarketBriefParts,
  type MarketBrief,
  type MarketScope,
} from '~/application/jarvis/marketBrief'
import type { Container } from '~/infrastructure/marketData/container'
import {
  createLiveRuntime,
  type LiveConfig,
  type LiveRuntime,
  type LiveSessionState,
  type LiveTelemetry,
  type TypedTelemetry,
  type TypedTurnResult,
} from './liveSession'
import { createOpenAiLiveProvider, LiveProviderRefusal } from './openaiLive'

/* ------------------------------------------------------------- config */

/** Measured 2026-09-15: the names the API accepts for gpt-live-1. `sol` exists but is gated. */
export const LIVE_VOICES = [
  'marin',
  'cedar',
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
] as const

/** Per 1M tokens, from the pricing page on 2026-09-15. Other backends fall back to terra's, the dearer. */
const BACKEND_PRICES: Record<string, { input: number; cached: number; output: number }> =
  {
    'gpt-5.6-luna': { input: 0.2, cached: 0.02, output: 1.2 },
    'gpt-5.6-terra': { input: 2.0, cached: 0.2, output: 12.0 },
  }

function liveConfig(): LiveConfig {
  const backendModel = process.env.JARVIS_LIVE_BACKEND_MODEL ?? 'gpt-5.6-luna'
  const price = BACKEND_PRICES[backendModel] ?? BACKEND_PRICES['gpt-5.6-terra']!
  const voice = process.env.JARVIS_LIVE_VOICE ?? 'marin'
  const tier = process.env.JARVIS_LIVE_SERVICE_TIER
  /*
   * Benchmarked in HQ on 2026-09-16 (docs/jarvis-voice-live-proof.md §12):
   * `none` answered every follow-up line as correctly and as honestly as
   * `high` at a median of 2.1 s against 3.1 s unset and 3.8 s high, routed
   * the capital question to the firm every time, and verified every
   * number. The priority tier bought ~0.2 s at a premium price and stays
   * off unless configured.
   */
  const effort = process.env.JARVIS_LIVE_REASONING ?? 'none'
  return {
    model: process.env.JARVIS_LIVE_MODEL ?? 'gpt-live-1',
    backendModel,
    ...(tier === 'auto' || tier === 'default' || tier === 'flex' || tier === 'priority'
      ? { backendServiceTier: tier }
      : {}),
    ...(effort === 'none' ||
    effort === 'low' ||
    effort === 'medium' ||
    effort === 'high' ||
    effort === 'xhigh' ||
    effort === 'max'
      ? { backendReasoningEffort: effort }
      : {}),
    voices: LIVE_VOICES,
    defaultVoice: (LIVE_VOICES as readonly string[]).includes(voice) ? voice : 'marin',
    idleSeconds: Number(process.env.JARVIS_LIVE_IDLE_SECONDS ?? 90),
    maxSeconds: Number(process.env.JARVIS_LIVE_MAX_SECONDS ?? 1200),
    /* The explicit window a fetched brief is reused as context; the numbers inside keep their own times. */
    marketContextSeconds: Number(process.env.JARVIS_LIVE_MARKET_CONTEXT_SECONDS ?? 180),
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
    if (error instanceof NotConfiguredError)
      return { state: 'failed', reason: 'not-configured' }
    console.error('[jarvis/live] host gateway failed', error)
    return { state: 'failed', reason: 'service-unavailable' }
  }
}

/**
 * Fresh market data for an observation question, from the same container
 * and the same symbol sets the Overview resolves, so a question inside the
 * page's cache TTL costs no provider call.
 */
/**
 * The market-data container is handed in by each handler, which imports it
 * dynamically inside its own body. Nothing at module level names the
 * container module: a module-level import, static or dynamic, is loaded by
 * the client build and pulls the providers — and the MCP stdio client — into
 * the browser bundle.
 */
type ContainerGetter = () => Promise<Container>

async function marketBrief(
  scope: MarketScope,
  getContainer: ContainerGetter,
): Promise<MarketBrief> {
  const container = await getContainer()
  const { createOverviewDataSource } =
    await import('~/infrastructure/marketData/overviewDataSource')
  const source = createOverviewDataSource(container, container.newCorrelationId())
  const parts = await fetchMarketBriefParts(source, scope)
  return composeMarketBrief(parts, scope, source.now())
}

function runtime(getContainer: ContainerGetter): LiveRuntime | null {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  if (!live) {
    live = createLiveRuntime({
      provider: createOpenAiLiveProvider({
        apiKey,
        networkDisabled: process.env.JARVIS_LIVE_NETWORK_DISABLED === '1',
      }),
      host,
      market: (scope) => marketBrief(scope, getContainer),
      config: liveConfig(),
      log: (line) => console.log(`[jarvis/live] ${line}`),
    })
  }
  return live
}

/* -------------------------------------------------------- the requests */

export type LiveOpenResponse =
  | { ok: true; sessionId: string; sdp: string }
  | {
      ok: false
      code:
        'NOT_CONFIGURED' | 'INVALID_REQUEST' | 'PROVIDER_REFUSED' | 'SERVICE_UNAVAILABLE'
      field?: string
    }

export const openLiveSessionFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }): Promise<LiveOpenResponse> => {
    const parsed = parseLiveOpenRequest(data)
    if (!parsed.ok) return { ok: false, code: 'INVALID_REQUEST', field: parsed.field }
    const { getContainer } = await import('~/infrastructure/marketData/containerInstance')
    const rt = runtime(getContainer)
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

export type LiveStateResponse =
  ({ ok: true } & LiveSessionState) | { ok: false; code: 'NOT_FOUND' | 'NOT_CONFIGURED' }

export const liveSessionStateFn = createServerFn({ method: 'POST' })
  .validator((input: { sessionId: string }) => ({ sessionId: String(input.sessionId) }))
  .handler(async ({ data }): Promise<LiveStateResponse> => {
    const { getContainer } = await import('~/infrastructure/marketData/containerInstance')
    const rt = runtime(getContainer)
    if (!rt) return { ok: false, code: 'NOT_CONFIGURED' }
    const state = rt.state(data.sessionId)
    return state ? { ok: true, ...state } : { ok: false, code: 'NOT_FOUND' }
  })

/** What a typed line came back with: the answer as text, and the case it may have bound. */
export type AskJarvisResponse =
  | ({ ok: true } & TypedTurnResult)
  | {
      ok: false
      code:
        'NOT_CONFIGURED' | 'INVALID_REQUEST' | 'PROVIDER_REFUSED' | 'SERVICE_UNAVAILABLE'
      field?: string
    }

async function typedTurn(
  input: unknown,
  getContainer: ContainerGetter,
): Promise<AskJarvisResponse> {
  const parsed = parseAskJarvisRequest(input)
  if (!parsed.ok) return { ok: false, code: 'INVALID_REQUEST', field: parsed.field }
  const rt = runtime(getContainer)
  if (!rt) return { ok: false, code: 'NOT_CONFIGURED' }
  try {
    return { ok: true, ...(await rt.respond(parsed.request)) }
  } catch (error) {
    if (error instanceof LiveProviderRefusal) {
      console.error('[jarvis/typed] provider refused', error.status)
      return { ok: false, code: 'PROVIDER_REFUSED' }
    }
    console.error('[jarvis/typed] failed', error)
    return { ok: false, code: 'SERVICE_UNAVAILABLE' }
  }
}

/**
 * A typed line to JARVIS with no voice session: the backend model, the same
 * tools, the same execution. The answer comes back as text; a delegation,
 * if the line warranted one, binds the conversation to the case it opened.
 */
export const askJarvisFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }): Promise<AskJarvisResponse> => {
    const { getContainer } = await import('~/infrastructure/marketData/containerInstance')
    return typedTurn(data, getContainer)
  })

/**
 * A typed line while a session is live: the same router, and the answer is
 * then handed to the voice to say. The voice model never sees the question
 * on its own, so it cannot answer it on its own.
 */
export const typeIntoLiveSessionFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      sessionId: string
      text: string
      history?: unknown
      marketContext?: unknown
    }) => ({
      sessionId: String(input.sessionId),
      text: String(input.text),
      ...(input.history !== undefined ? { history: input.history } : {}),
      ...(input.marketContext !== undefined
        ? { marketContext: input.marketContext }
        : {}),
    }),
  )
  .handler(async ({ data }): Promise<AskJarvisResponse> => {
    const { getContainer } = await import('~/infrastructure/marketData/containerInstance')
    return typedTurn(data, getContainer)
  })

export const closeLiveSessionFn = createServerFn({ method: 'POST' })
  .validator((input: { sessionId: string }) => ({ sessionId: String(input.sessionId) }))
  .handler(async ({ data }): Promise<LiveStateResponse> => {
    const { getContainer } = await import('~/infrastructure/marketData/containerInstance')
    const rt = runtime(getContainer)
    if (!rt) return { ok: false, code: 'NOT_CONFIGURED' }
    const state = await rt.close(data.sessionId)
    return state ? { ok: true, ...state } : { ok: false, code: 'NOT_FOUND' }
  })

export type LiveTelemetryResponse =
  | { ok: true; sessions: LiveTelemetry[]; typed: TypedTelemetry }
  | { ok: false; code: 'NOT_CONFIGURED' }

/** Every session's counts and money, and the typed turns outside sessions. Never a word of any conversation. */
export const liveTelemetryFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<LiveTelemetryResponse> => {
    const { getContainer } = await import('~/infrastructure/marketData/containerInstance')
    const rt = runtime(getContainer)
    if (!rt) return { ok: false, code: 'NOT_CONFIGURED' }
    return { ok: true, sessions: rt.telemetry(), typed: rt.typedTelemetry() }
  },
)
