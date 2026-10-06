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
import { advisoryTurn, type AdvisoryTurnResult } from '~/application/jarvis/advisoryTurn'
import { resolveJarvisContext } from '~/application/jarvis/context'
import type { PrivateVocabulary } from '~/application/jarvis/research/firewall'
import { answerResearchQuery } from '~/application/jarvis/research/researchAnswer'
import { createResearchCache } from '~/application/jarvis/research/researchCache'
import { recognizeResearchQuery } from '~/application/jarvis/research/researchQuery'
import type { AdvisoryContext } from '~/application/advisory/ports'
import { researchCardOf } from '~/presentation/jarvis/researchCard'
import {
  researchAnswerSpeech,
  researchAnswerText,
} from '~/presentation/jarvis/researchText'
import {
  composeMarketBrief,
  fetchMarketBriefParts,
  type MarketBrief,
  type MarketScope,
} from '~/application/jarvis/marketBrief'
import type { MarketHistorySource } from '~/application/jarvis/marketHistory'
import type { Container } from '~/infrastructure/marketData/container'
import {
  createLiveRuntime,
  type LiveConfig,
  type LiveRuntime,
  type LiveSessionState,
  type LiveTelemetry,
  type ResearchInput,
  type ResearchTurn,
  type TypedTelemetry,
  type TypedTurnResult,
} from './liveSession'
import { createOpenAiLiveProvider, LiveProviderRefusal } from './openaiLive'
import { createSimulatedLiveProvider } from './simulatedLive'
import { workspaceLabel, workspaceTurn } from './workspaceTurn'
import { parseRouteContext } from '~/application/jarvis/liveOpen'
import type { AdvisoryEntry } from './liveSession'
import type { JarvisAnswer } from '~/application/jarvis/answer'

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

/**
 * A period's series for "i veckan", "i år", through the registry's series
 * capability. Bound lazily per call, like the brief, so nothing at module
 * level names the container.
 */
function marketHistory(getContainer: ContainerGetter): MarketHistorySource {
  return {
    series: async (symbol, range) => {
      const container = await getContainer()
      const { createMarketHistorySource } =
        await import('~/infrastructure/marketData/marketHistorySource')
      return createMarketHistorySource(container, container.newCorrelationId()).series(
        symbol,
        range,
      )
    },
  }
}

/** The voice path without audio: every server-side part of it, no provider. Explicit, never default. */
const simulatedVoice = () => process.env.JARVIS_LIVE_SIMULATE === '1'

/** Research is cached by source class across turns and sessions; process-local, like the market-data cache. */
const researchCache = createResearchCache()

/** The register's names, so the firewall knows what must never leave; read through the record's own context. */
async function researchVocabulary(advisory: AdvisoryGetter): Promise<PrivateVocabulary> {
  const context = await advisory()
  const [clients, offices] = await Promise.all([
    context.repositories.clients.list(),
    context.repositories.clients.offices(),
  ])
  return {
    clients: clients.map((client) => ({
      id: client.id,
      displayName: client.displayName,
    })),
    offices: offices.map((office) => office.displayName),
  }
}

/**
 * The public research tier, bound lazily per call like the brief and the
 * history: the recogniser decides whether the line is research; the port
 * the environment allows gathers the evidence behind the firewall; the
 * renderers put the typed answer into Swedish for the screen and the voice.
 */
function researchTurn(
  getContainer: ContainerGetter,
  advisory: AdvisoryGetter,
): (input: ResearchInput) => Promise<ResearchTurn | null> {
  return async (input) => {
    const jarvis = resolveJarvisContext(input.route ?? '/')
    const query = recognizeResearchQuery(input.text, {
      scope: jarvis.scope,
      market: input.market,
      research: input.research,
    })
    if (!query) return null
    const log = (line: string) => console.log(`[jarvis/research] ${line}`)
    const { publicSearchPortFromEnv } =
      await import('~/infrastructure/research/publicSearchPort')
    const { createResearchHttp } = await import('~/infrastructure/research/http')
    const port = publicSearchPortFromEnv(
      process.env,
      createResearchHttp({
        networkDisabled: process.env.JARVIS_LIVE_NETWORK_DISABLED === '1',
      }),
      () => new Date(),
      log,
    )
    const answer = await answerResearchQuery(query, jarvis.scope, {
      port,
      cache: researchCache,
      vocabulary: () => researchVocabulary(advisory),
      market: (scope) => marketBrief(scope, getContainer),
      history: marketHistory(getContainer),
      now: () => new Date(),
      log,
    })
    return {
      say: researchAnswerText(answer),
      spokenSay: researchAnswerSpeech(answer),
      card: researchCardOf(answer),
      context: answer.context,
      kind: answer.query.kind,
      unavailable: answer.unavailable,
      evidenceCount: answer.result.evidence.length,
    }
  }
}

/**
 * The relationship record's one context, reached by a dynamic import inside
 * a function body (TD-107 discipline): the advisory tier of the voice path
 * reads the same record the typed path does.
 */
async function advisory(): Promise<AdvisoryContext> {
  const { advisoryContext } = await import('~/infrastructure/advisory/serverFns')
  return advisoryContext(
    () => import('~/infrastructure/advisory/marketSource'),
    () => import('~/infrastructure/advisory/container'),
  )
}

function runtime(getContainer: ContainerGetter): LiveRuntime | null {
  const apiKey = process.env.OPENAI_API_KEY
  const simulated = simulatedVoice()
  if (!apiKey && !simulated) return null
  if (!live) {
    live = createLiveRuntime({
      provider: simulated
        ? createSimulatedLiveProvider()
        : createOpenAiLiveProvider({
            apiKey: apiKey ?? '',
            networkDisabled: process.env.JARVIS_LIVE_NETWORK_DISABLED === '1',
          }),
      host,
      market: (scope) => marketBrief(scope, getContainer),
      history: marketHistory(getContainer),
      /* The public research tier: why the market moved, what a central bank said, behind the firewall. */
      research: researchTurn(getContainer, advisory),
      /* The one brain: the voice's workspace questions go through the same advisory tier as a typed line. */
      workspace: (input) => workspaceTurn(advisory, input),
      workspaceLabel: (route) => workspaceLabel(advisory, route),
      simulated,
      config: liveConfig(),
      log: (line) => console.log(`[jarvis/live] ${line}`),
    })
  }
  return live
}

/* -------------------------------------------------------- the requests */

export type LiveOpenResponse =
  | { ok: true; sessionId: string; sdp: string; simulated: boolean }
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
      const { context, ...rest } = parsed.request
      const opened = await rt.open({
        ...rest,
        ...(context ? { route: context.route } : {}),
      })
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

export type { AdvisoryEntry }
export type { MarketContextPointer } from '~/application/jarvis/askJarvis'

export interface LiveVoiceMode {
  /** A session can be opened: a key is configured, or the simulated provider is on. */
  configured: boolean
  /** The simulated provider: no audio, lines arrive as text through `hearInLiveSessionFn`. */
  simulated: boolean
}

/** What kind of voice the server offers, so the browser knows whether to open a microphone at all. */
export const liveVoiceModeFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<LiveVoiceMode> => ({
    configured: Boolean(process.env.OPENAI_API_KEY) || simulatedVoice(),
    simulated: simulatedVoice(),
  }),
)

export const liveSessionStateFn = createServerFn({ method: 'POST' })
  .validator((input: { sessionId: string }) => ({ sessionId: String(input.sessionId) }))
  .handler(async ({ data }): Promise<LiveStateResponse> => {
    const { getContainer } = await import('~/infrastructure/marketData/containerInstance')
    const rt = runtime(getContainer)
    if (!rt) return { ok: false, code: 'NOT_CONFIGURED' }
    const state = rt.state(data.sessionId)
    return state ? { ok: true, ...state } : { ok: false, code: 'NOT_FOUND' }
  })

/**
 * The advisor moved while the session is live: the browser sends the route
 * and nothing else, and the server re-resolves the workspace from it — the
 * voice answers about what is on screen now, never about where the
 * conversation began.
 */
export const updateLiveSessionContextFn = createServerFn({ method: 'POST' })
  .validator((input: { sessionId: string; context: unknown }) => ({
    sessionId: String(input.sessionId),
    context: input.context,
  }))
  .handler(async ({ data }): Promise<LiveStateResponse> => {
    const context = parseRouteContext(data.context)
    if (!context) return { ok: false, code: 'NOT_FOUND' }
    const { getContainer } = await import('~/infrastructure/marketData/containerInstance')
    const rt = runtime(getContainer)
    if (!rt) return { ok: false, code: 'NOT_CONFIGURED' }
    const state = rt.setContext(data.sessionId, context.route)
    return state ? { ok: true, ...state } : { ok: false, code: 'NOT_FOUND' }
  })

export type LiveHearResponse =
  | { ok: true; entry: AdvisoryEntry }
  | {
      ok: false
      code: 'NOT_FOUND' | 'NOT_CONFIGURED' | 'NOT_SIMULATED' | 'INVALID_REQUEST'
    }

/**
 * The simulated microphone: a spoken line as text, into a simulated session,
 * through exactly the turn the voice's workspace tool runs. Refused for a
 * real session — a real voice hears the person itself.
 */
export const hearInLiveSessionFn = createServerFn({ method: 'POST' })
  .validator((input: { sessionId: string; text: string }) => ({
    sessionId: String(input.sessionId),
    text: String(input.text),
  }))
  .handler(async ({ data }): Promise<LiveHearResponse> => {
    if (!simulatedVoice()) return { ok: false, code: 'NOT_SIMULATED' }
    if (data.text.length > 2_000) return { ok: false, code: 'INVALID_REQUEST' }
    const { getContainer } = await import('~/infrastructure/marketData/containerInstance')
    const rt = runtime(getContainer)
    if (!rt) return { ok: false, code: 'NOT_CONFIGURED' }
    const entry = await rt.hear(data.sessionId, data.text)
    return entry ? { ok: true, entry } : { ok: false, code: 'NOT_FOUND' }
  })

/**
 * What a typed line came back with: a structured answer from the
 * relationship record when the workspace made the line the record's, else
 * the model's answer as text and the case it may have bound.
 */
export type AskJarvisResponse =
  | ({ ok: true; spoken?: string } & AdvisoryTurnResult)
  | ({ ok: true } & TypedTurnResult)
  | {
      ok: false
      code:
        'NOT_CONFIGURED' | 'INVALID_REQUEST' | 'PROVIDER_REFUSED' | 'SERVICE_UNAVAILABLE'
      field?: string
    }

type AdvisoryGetter = () => Promise<AdvisoryContext>

async function typedTurn(
  input: unknown,
  getContainer: ContainerGetter,
  advisory?: AdvisoryGetter,
): Promise<AskJarvisResponse> {
  const parsed = parseAskJarvisRequest(input)
  if (!parsed.ok) return { ok: false, code: 'INVALID_REQUEST', field: parsed.field }
  /*
   * The advisory tier first: on a client, an office, the book, Sentinel or
   * Marknadspåverkan the record answers what it can, with no model and no
   * key. What it cannot answer goes on to the router below, unchanged.
   */
  if (advisory) {
    try {
      const turn = await advisoryTurn(parsed.request, advisory)
      if (turn) return { ok: true, ...turn }
    } catch (error) {
      console.error('[jarvis/advisory] failed', error)
      return { ok: false, code: 'SERVICE_UNAVAILABLE' }
    }
  }
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
    /* The relationship record's one context, reached the way its own doors reach it (TD-107 discipline). */
    const { advisoryContext } = await import('~/infrastructure/advisory/serverFns')
    return typedTurn(data, getContainer, () =>
      advisoryContext(
        () => import('~/infrastructure/advisory/marketSource'),
        () => import('~/infrastructure/advisory/container'),
      ),
    )
  })

/**
 * A typed line while a session is live: the same router — the record first,
 * with the route the browser sends — and the answer is then handed to the
 * voice to say. The voice model never sees the question on its own, so it
 * cannot answer it on its own.
 */
export const typeIntoLiveSessionFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      sessionId: string
      text: string
      history?: unknown
      marketContext?: unknown
      context?: unknown
      previous?: unknown
    }) => ({
      sessionId: String(input.sessionId),
      text: String(input.text),
      ...(input.history !== undefined ? { history: input.history } : {}),
      ...(input.marketContext !== undefined
        ? { marketContext: input.marketContext }
        : {}),
      ...(input.context !== undefined ? { context: input.context } : {}),
      ...(input.previous !== undefined ? { previous: input.previous } : {}),
    }),
  )
  .handler(async ({ data }): Promise<AskJarvisResponse> => {
    const { getContainer } = await import('~/infrastructure/marketData/containerInstance')
    const result = await typedTurn(data, getContainer, advisory)
    if (result.ok && 'advisory' in result) {
      /* The record answered: the voice says the spoken rendering, and remembers the answer for a spoken "ta resten". */
      const rt = runtime(getContainer)
      const { spokenAnswerOf } = await import('~/presentation/jarvis/spokenAnswer')
      const spoken = spokenAnswerOf(result.advisory)
      rt?.speak(data.sessionId, data.text, spoken.say, result.advisory as JarvisAnswer)
      return { ...result, spoken: spoken.say }
    }
    return result
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
