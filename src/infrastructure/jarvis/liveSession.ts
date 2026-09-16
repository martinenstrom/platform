/**
 * A live voice session, from the server's side.
 *
 * The browser owns the microphone and the speaker on a WebRTC media track.
 * This runtime owns everything else: it turns the browser's SDP offer into a
 * GPT-Live session with the server-side key, attaches the sideband socket to
 * that session, and from there executes every delegation call the backend
 * model makes — through the host gateway, as the server-resolved operator,
 * with JARVIS recorded as initiator — reads usage, watches for the one claim
 * the voice must not invent, and closes what the browser forgot.
 *
 * ## What it holds, and what it does not
 *
 * Per session: telemetry (seconds, cost, tokens, tool calls, event counts),
 * the case reference the conversation is bound to, and a rolling 200
 * characters of the voice's own transcript for the acknowledgement watcher.
 * No transcript is stored. The live transcript is conversational data; the
 * institutional record is written only by the host gateway's own commands,
 * with their own provenance.
 *
 * ## Injected, so it can be proved without a provider
 *
 * The OpenAI calls and the host gateway are dependencies. The tests drive
 * the runtime with a fake sideband and a fake host and assert the loop: a
 * function call becomes a host request with no actor in it, a result becomes
 * a tool output whose `acknowledgeWork` is true only for `working`, an idle
 * session is closed, a claim without a reference is counted.
 *
 * ## One process
 *
 * The sideband lives in the process that created the session. A deployment
 * with several server instances must route a session's follow-up calls to
 * the instance holding its sideband, or hold the sideband elsewhere; noted
 * as TD-93 rather than solved here.
 */

import type { HostRequest, HostResult } from '~/application/analysis/hostContract'
import type { DomainReference } from '~/application/analysis/domainSystem'
import { interpretToolCall, LIVE_TOOL_DEFINITIONS } from '~/application/jarvis/liveTools'
import type { MarketBrief, MarketScope } from '~/application/jarvis/marketBrief'
import {
  ACKNOWLEDGEMENT_PATTERN,
  LIVE_BACKEND_INSTRUCTIONS,
  LIVE_TYPED_CONTEXT,
  LIVE_VOICE_INSTRUCTIONS,
  MARKET_UNAVAILABLE,
  toolSpeech,
  unsupportedSpeech,
} from '~/presentation/jarvis/liveSpeech'

/* ------------------------------------------------------------ the ports */

export interface LiveSideband {
  send(event: Record<string, unknown>): void
  onMessage(handler: (event: Record<string, unknown>) => void): void
  onClose(handler: () => void): void
  close(): void
}

/** One Responses call: the backend model, its instructions and tools, and the conversation so far. */
export interface ResponsesRequest {
  model: string
  instructions: string
  tools: readonly unknown[]
  input: unknown[]
  serviceTier?: LiveConfig['backendServiceTier']
  reasoningEffort?: LiveConfig['backendReasoningEffort']
}

export type ResponsesOutputItem =
  | { type: 'function_call'; call_id: string; name: string; arguments?: string; id?: string }
  | { type: 'message'; role?: string; content?: { type: string; text?: string }[] }
  | { type: string }

export interface ResponsesResult {
  id: string
  output: ResponsesOutputItem[]
  usage?: Record<string, unknown>
}

export interface LiveProvider {
  /** POST /v1/live/sessions: the session config and the browser's offer in, the answer out. */
  createSession(input: { session: Record<string, unknown>; sdp: string }): Promise<{ id: string; sdp: string }>
  /** The sideband socket for a running session, authenticated with the server key. */
  attach(sessionId: string): Promise<LiveSideband>
  /** POST /v1/responses: the backend model for a typed line — the same router, without a voice. Stores nothing. */
  respond(request: ResponsesRequest): Promise<ResponsesResult>
}

export interface LiveConfig {
  model: string
  backendModel: string
  /** Responses `service_tier` for the backend: auto, default, flex or priority. Latency is measured, not assumed. */
  backendServiceTier?: 'auto' | 'default' | 'flex' | 'priority'
  /** Responses `reasoning.effort` for the backend, where the model takes one. */
  backendReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  voices: readonly string[]
  defaultVoice: string
  /** A session with no user speech for this long is closed by the server. */
  idleSeconds: number
  /** No session outlives this, whatever the browser does. */
  maxSeconds: number
  prices: {
    voicePerMinuteUsd: number
    /** Per 1M tokens, for the configured backend model. */
    backendInputUsd: number
    backendCachedUsd: number
    backendOutputUsd: number
  }
}

export interface LiveRuntimeDeps {
  provider: LiveProvider
  /** The host gateway, already bound to the server-resolved operator. */
  host: (request: HostRequest) => Promise<HostResult>
  /** Fresh market data for an observation question; never the firm. */
  market: (scope: MarketScope) => Promise<MarketBrief>
  config: LiveConfig
  requestId?: () => string
  now?: () => number
  log?: (line: string) => void
}

/* --------------------------------------------------------- the telemetry */

export interface LiveTelemetry {
  sessionId: string
  model: string
  backendModel: string
  voice: string
  openedAt: string
  closedAt: string | null
  /** Why the session ended: the provider's reason, or the server's policy. */
  reason: string | null
  voiceSeconds: number
  voiceCostUsd: number
  backend: { responses: number; inputTokens: number; cachedTokens: number; outputTokens: number; costUsd: number }
  toolCalls: number
  toolCallsByName: Record<string, number>
  delegationsCreated: number
  typedInjections: number
  /** A promise of delegated work spoken while the firm had none. The invariant, watched. */
  ackWithoutReference: number
  closedByPolicy: boolean
  eventCounts: Record<string, number>
  /**
   * Where the time went, per user turn, on the session clock in ms: when
   * the person stopped, when the model handed off, when the backend's
   * response began and ended, when the host was called and answered, and
   * when the first spoken reply began. Milliseconds only; no words.
   */
  turns: TurnTiming[]
}

export interface TurnTiming {
  userEndMs: number
  /** `session.delegation.created` — the model chose to hand off. Null when it answered itself. */
  delegationMs: number | null
  /** The backend's `response.created`, estimated on the session clock. */
  backendStartMs: number | null
  /** The host gateway call, if the backend made one: start and duration in wall-clock ms. */
  hostCallMs: number | null
  hostDurationMs: number | null
  /** The market-data call, if the backend made one: start on the session clock, duration in wall-clock ms. */
  marketCallMs: number | null
  marketDurationMs: number | null
  /** The backend's final `response.completed`, estimated on the session clock. */
  backendEndMs: number | null
  /** The first assistant transcript fragment after the person stopped. */
  firstSpeechMs: number | null
  /**
   * Where each spoken reply began: a fragment more than 1.2 s after the
   * previous one opens a new reply. The presence shows one bubble per reply,
   * so a probe can pair these with what was said and tell an acknowledgement
   * from an answer without a word being kept here.
   */
  speechStartsMs: number[]
  /** Typed into the live session rather than spoken. */
  typed: boolean
}

export interface LiveSessionState {
  telemetry: LiveTelemetry
  /** The case this conversation is bound to, if the firm gave it one. A pointer. */
  reference: DomainReference | null
  /** What was last delegated, so the presence can name the case the way the typed path does. */
  lastAsk: { question: string; subject: string } | null
  closed: boolean
}

/** A typed line, answered by the backend through the same tools the voice uses. */
export interface TypedTurnInput {
  text: string
  /** The presence's "Om" field, a hint and nothing more. */
  subject?: string
  /** The case the conversation is bound to, when no session carries it. */
  reference?: DomainReference | null
  /** A live session the answer should also be spoken in. */
  sessionId?: string
  /** The conversation before this line, oldest first, so "varför?" has something to be about. */
  history?: readonly { by: 'user' | 'jarvis'; text: string }[]
}

export interface TypedTurnResult {
  /** What JARVIS answered, as text. Empty when the model said nothing. */
  say: string
  /** The case the conversation is bound to after the turn: unchanged, or the one a delegation opened. */
  reference: DomainReference | null
  lastAsk: { question: string; subject: string } | null
  /** The last tool's product state, when a tool was called; `market-snapshot` for the market. */
  state: string | null
  toolCalls: string[]
  backendMs: number
  /** True when the line was also handed to a live session to be spoken. */
  spoken: boolean
}

export interface TypedTelemetry {
  turns: number
  responses: number
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  costUsd: number
  toolCallsByName: Record<string, number>
}

export interface LiveRuntime {
  /** `reference`: the case the conversation is already bound to, so spoken follow-ups read it. */
  open(input: { sdp: string; voice?: string; reference?: DomainReference }): Promise<{ sessionId: string; sdp: string }>
  state(sessionId: string): LiveSessionState | null
  /**
   * A typed line through the one router: the backend model with the same
   * tools, executed the same way. With a live session, the answer is also
   * handed to the voice to say — never the question, which the voice model
   * would otherwise answer on its own (TD-95).
   */
  respond(input: TypedTurnInput): Promise<TypedTurnResult>
  close(sessionId: string): Promise<LiveSessionState | null>
  /** Every session's telemetry, for the cost view. */
  telemetry(): LiveTelemetry[]
  /** Typed turns outside any session: counts and money, never a word. */
  typedTelemetry(): TypedTelemetry
}

interface Session {
  id: string
  voice: string
  sideband: LiveSideband | null
  telemetry: LiveTelemetry
  /** The session clock's zero, on the wall clock: `session.started`. */
  startedWallMs: number | null
  /** The user's last transcript end; a new assistant fragment after it opens a turn's timing. */
  lastUserEndMs: number | null
  /** The turn timing being filled in, until its first answer arrives. */
  openTurn: TurnTiming | null
  reference: DomainReference | null
  lastAsk: { question: string; subject: string } | null
  /** True once the firm has reported delegated work under way; the claim is truthful after that. */
  everWorking: boolean
  spokenTail: string
  /** The end of the last assistant fragment, to tell a new reply from a continuing one. */
  lastAssistantEndMs: number | null
  lastUserSpeechAt: number
  openedAt: number
  closed: boolean
  watchdog: ReturnType<typeof setInterval> | null
}

const count = (t: LiveTelemetry, type: string) => {
  t.eventCounts[type] = (t.eventCounts[type] ?? 0) + 1
}

/** What a tool call may change in a conversation: the bound case, the last ask, whether work was ever reported. */
interface ToolEffects {
  reference: DomainReference | null
  lastAsk: { question: string; subject: string } | null
  everWorking: boolean
}

const isFunctionCall = (
  item: ResponsesOutputItem,
): item is Extract<ResponsesOutputItem, { type: 'function_call' }> =>
  item.type === 'function_call' && 'call_id' in item && 'name' in item

export function createLiveRuntime(deps: LiveRuntimeDeps): LiveRuntime {
  const { provider, host, market, config } = deps
  const now = deps.now ?? (() => Date.now())
  const requestId = deps.requestId ?? (() => crypto.randomUUID())
  const log = deps.log ?? (() => {})
  const sessions = new Map<string, Session>()
  const typed: TypedTelemetry = {
    turns: 0,
    responses: 0,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    toolCallsByName: {},
  }

  function sessionConfig(voice: string): Record<string, unknown> {
    return {
      model: config.model,
      instructions: LIVE_VOICE_INSTRUCTIONS,
      audio: { output: { voice } },
      delegation: {
        type: 'responses',
        responses: {
          model: config.backendModel,
          instructions: LIVE_BACKEND_INSTRUCTIONS,
          tools: LIVE_TOOL_DEFINITIONS,
          tool_choice: 'auto',
          parallel_tool_calls: false,
          ...(config.backendServiceTier ? { service_tier: config.backendServiceTier } : {}),
          ...(config.backendReasoningEffort ? { reasoning: { effort: config.backendReasoningEffort } } : {}),
        },
      },
    }
  }

  function project(t: LiveTelemetry) {
    t.voiceCostUsd = (t.voiceSeconds / 60) * config.prices.voicePerMinuteUsd
  }

  function accumulate(t: LiveTelemetry, usage: Record<string, unknown>) {
    accumulateInto(t.backend, usage)
  }

  function accumulateInto(
    bucket: { responses: number; inputTokens: number; cachedTokens: number; outputTokens: number; costUsd: number },
    usage: Record<string, unknown>,
  ) {
    const details = usage.input_tokens_details as { cached_tokens?: number } | undefined
    const cached = details?.cached_tokens ?? 0
    const input = Math.max(0, Number(usage.input_tokens ?? 0) - cached)
    const output = Number(usage.output_tokens ?? 0)
    bucket.responses += 1
    bucket.inputTokens += input
    bucket.cachedTokens += cached
    bucket.outputTokens += output
    bucket.costUsd +=
      (input * config.prices.backendInputUsd +
        cached * config.prices.backendCachedUsd +
        output * config.prices.backendOutputUsd) /
      1_000_000
  }

  function send(session: Session, event: Record<string, unknown>) {
    if (session.sideband && !session.closed) session.sideband.send(event)
    else log(`[${session.id}] dropped ${String(event.type)}: no sideband`)
  }

  function finish(session: Session, reason: string | null, byPolicy: boolean) {
    if (session.closed) return
    session.closed = true
    session.telemetry.closedAt = new Date(now()).toISOString()
    session.telemetry.reason = session.telemetry.reason ?? reason
    session.telemetry.closedByPolicy = session.telemetry.closedByPolicy || byPolicy
    if (session.watchdog) clearInterval(session.watchdog)
    session.watchdog = null
    project(session.telemetry)
  }

  /**
   * The tool boundary, shared by the voice's delegation loop and a typed
   * turn: a function call from the backend becomes a host request, a market
   * observation or an honest refusal, and its outcome is the tool result the
   * backend must relay. No actor crosses in either direction; the market
   * never reaches the firm.
   */
  async function runTool(
    call: { name: string; arguments?: string },
    effects: ToolEffects,
    timing: TurnTiming | null,
    clock: (wallMs: number) => number | null,
    tag: string,
  ): Promise<{ output: Record<string, unknown>; state: string }> {
    let args: unknown = {}
    try {
      args = JSON.parse(call.arguments ?? '{}')
    } catch {
      args = {}
    }
    const interpreted = interpretToolCall(call.name, args, { reference: effects.reference, requestId })
    if (interpreted.kind === 'host') {
      const started = now()
      if (timing && timing.hostCallMs === null) timing.hostCallMs = clock(started)
      const result = await host(interpreted.request)
      if (timing && timing.hostDurationMs === null) timing.hostDurationMs = now() - started
      const speech = toolSpeech(result, interpreted.request.kind)
      if (speech.reference) effects.reference = speech.reference
      if (interpreted.request.kind === 'ask' && speech.reference)
        effects.lastAsk = { question: interpreted.request.question, subject: interpreted.request.subject }
      if (result.state === 'working') effects.everWorking = true
      log(`[${tag}] ${call.name} → ${interpreted.request.kind} → ${result.state}`)
      return {
        state: speech.state,
        output: {
          state: speech.state,
          say: speech.say,
          acknowledgeWork: speech.acknowledgeWork,
          decisionRequired: speech.decisionRequired,
        },
      }
    }
    if (interpreted.kind === 'market') {
      const started = now()
      if (timing && timing.marketCallMs === null) timing.marketCallMs = clock(started)
      try {
        const brief = await market(interpreted.scope)
        if (timing && timing.marketDurationMs === null) timing.marketDurationMs = now() - started
        log(`[${tag}] ${call.name} → market ${interpreted.scope} → ${brief.indices.length} indices, ${brief.unavailable.length} unavailable`)
        return {
          state: 'market-snapshot',
          output: { state: 'market-snapshot', acknowledgeWork: false, decisionRequired: false, brief },
        }
      } catch (error) {
        if (timing && timing.marketDurationMs === null) timing.marketDurationMs = now() - started
        log(`[${tag}] ${call.name} → market ${interpreted.scope} → failed: ${String(error)}`)
        return {
          state: 'market-unavailable',
          output: { state: 'market-unavailable', say: MARKET_UNAVAILABLE, acknowledgeWork: false, decisionRequired: false },
        }
      }
    }
    const speech = unsupportedSpeech(interpreted.reason)
    log(`[${tag}] ${call.name} → unsupported (${interpreted.reason})`)
    return {
      state: speech.state,
      output: {
        state: speech.state,
        say: speech.say,
        acknowledgeWork: speech.acknowledgeWork,
        decisionRequired: speech.decisionRequired,
      },
    }
  }

  /** A function call from the sideband, executed and answered on the sideband. */
  async function executeToolCall(
    session: Session,
    item: { call_id: string; name: string; arguments?: string },
  ) {
    const t = session.telemetry
    t.toolCalls += 1
    t.toolCallsByName[item.name] = (t.toolCallsByName[item.name] ?? 0) + 1
    const { output } = await runTool(item, session, session.openTurn, (wallMs) => sessionMs(session, wallMs), session.id)
    send(session, {
      type: 'response.item.create',
      event_id: `out_${item.call_id}`,
      item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(output) },
    })
    send(session, { type: 'response.create', event_id: `continue_${item.call_id}` })
  }

  /** The text of a Responses result: every output_text part, in order. */
  function answerOf(result: ResponsesResult): string {
    return result.output
      .filter((item): item is Extract<ResponsesOutputItem, { type: 'message' }> => item.type === 'message')
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === 'output_text')
      .map((part) => part.text ?? '')
      .join('\n')
      .trim()
  }

  /** Wall-clock time as the session clock would read it, once `session.started` has anchored it. */
  function sessionMs(session: Session, wallMs: number): number | null {
    return session.startedWallMs === null ? null : wallMs - session.startedWallMs
  }

  function openTurn(session: Session, userEndMs: number, typed: boolean) {
    session.openTurn = {
      userEndMs,
      delegationMs: null,
      backendStartMs: null,
      hostCallMs: null,
      hostDurationMs: null,
      marketCallMs: null,
      marketDurationMs: null,
      backendEndMs: null,
      firstSpeechMs: null,
      speechStartsMs: [],
      typed,
    }
    session.telemetry.turns.push(session.openTurn)
  }

  function onEvent(session: Session, event: Record<string, unknown>) {
    const t = session.telemetry
    const type = String(event.type ?? '')
    count(t, type)
    switch (type) {
      case 'session.started':
        session.startedWallMs = now()
        break
      case 'session.usage.updated': {
        const usage = event.usage as { seconds?: number } | undefined
        if (typeof usage?.seconds === 'number') t.voiceSeconds = usage.seconds
        project(t)
        break
      }
      case 'session.input_transcript.delta': {
        session.lastUserSpeechAt = now()
        const endMs = Number(event.end_ms ?? 0)
        /* The person speaking again after a reply began opens a new turn's timing. */
        if (session.openTurn && session.openTurn.firstSpeechMs !== null) session.openTurn = null
        if (!session.openTurn) openTurn(session, endMs, false)
        else session.openTurn.userEndMs = endMs
        session.lastUserEndMs = endMs
        break
      }
      case 'session.output_transcript.delta': {
        const delta = String(event.delta ?? '')
        const startMs = Number(event.start_ms ?? 0)
        const endMs = Number(event.end_ms ?? startMs)
        session.spokenTail = (session.spokenTail + delta).slice(-200)
        if (ACKNOWLEDGEMENT_PATTERN.test(session.spokenTail) && !session.everWorking) {
          t.ackWithoutReference += 1
          session.spokenTail = ''
          log(`[${session.id}] INVARIANT: delegated work claimed while the firm has none`)
        }
        const turn = session.openTurn
        if (turn && startMs >= turn.userEndMs - 400) {
          if (turn.firstSpeechMs === null) turn.firstSpeechMs = startMs
          if (session.lastAssistantEndMs === null || startMs - session.lastAssistantEndMs > 1200) turn.speechStartsMs.push(startMs)
        }
        session.lastAssistantEndMs = Math.max(session.lastAssistantEndMs ?? 0, endMs)
        break
      }
      case 'session.delegation.created': {
        t.delegationsCreated += 1
        const offset = typeof event.offset_ms === 'number' ? event.offset_ms : sessionMs(session, now())
        if (session.openTurn && session.openTurn.delegationMs === null) session.openTurn.delegationMs = offset
        break
      }
      case 'response.event': {
        const inner = (event.event ?? {}) as Record<string, unknown>
        const innerType = String(inner.type ?? '')
        count(t, `response.event/${innerType}`)
        if (innerType === 'response.created' && session.openTurn && session.openTurn.backendStartMs === null)
          session.openTurn.backendStartMs = sessionMs(session, now())
        const item = inner.item as { type?: string; call_id?: string; name?: string; arguments?: string } | undefined
        if (innerType === 'response.output_item.done' && item?.type === 'function_call' && item.call_id && item.name) {
          void executeToolCall(session, { call_id: item.call_id, name: item.name, arguments: item.arguments }).catch(
            (error: unknown) => log(`[${session.id}] tool failed: ${String(error)}`),
          )
        }
        const response = inner.response as { usage?: Record<string, unknown> } | undefined
        if (innerType === 'response.completed') {
          if (response?.usage) accumulate(t, response.usage)
          if (session.openTurn) session.openTurn.backendEndMs = sessionMs(session, now())
        }
        break
      }
      case 'session.closed': {
        const usage = event.usage as { seconds?: number } | undefined
        if (typeof usage?.seconds === 'number') t.voiceSeconds = usage.seconds
        finish(session, typeof event.reason === 'string' ? event.reason : null, false)
        break
      }
      case 'error':
        log(`[${session.id}] error event: ${JSON.stringify(event.error ?? event).slice(0, 200)}`)
        break
      default:
        break
    }
  }

  function watch(session: Session) {
    session.watchdog = setInterval(() => {
      if (session.closed) return
      const idle = (now() - session.lastUserSpeechAt) / 1000
      const age = (now() - session.openedAt) / 1000
      if (idle >= config.idleSeconds || age >= config.maxSeconds) {
        session.telemetry.reason = idle >= config.idleSeconds ? `idle ${Math.round(idle)} s` : `max ${Math.round(age)} s`
        session.telemetry.closedByPolicy = true
        log(`[${session.id}] closing by policy: ${session.telemetry.reason}`)
        send(session, { type: 'session.close', event_id: `policy_${now()}` })
        if (session.watchdog) clearInterval(session.watchdog)
        session.watchdog = null
      }
    }, 1000)
  }

  return {
    async open({ sdp, voice, reference }) {
      const chosen = voice && config.voices.includes(voice) ? voice : config.defaultVoice
      const created = await provider.createSession({ session: sessionConfig(chosen), sdp })
      const session: Session = {
        id: created.id,
        voice: chosen,
        sideband: null,
        telemetry: {
          sessionId: created.id,
          model: config.model,
          backendModel: config.backendModel,
          voice: chosen,
          openedAt: new Date(now()).toISOString(),
          closedAt: null,
          reason: null,
          voiceSeconds: 0,
          voiceCostUsd: 0,
          backend: { responses: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 },
          toolCalls: 0,
          toolCallsByName: {},
          delegationsCreated: 0,
          typedInjections: 0,
          ackWithoutReference: 0,
          closedByPolicy: false,
          eventCounts: {},
          turns: [],
        },
        startedWallMs: null,
        lastUserEndMs: null,
        openTurn: null,
        reference: reference ?? null,
        lastAsk: null,
        everWorking: false,
        spokenTail: '',
        lastAssistantEndMs: null,
        lastUserSpeechAt: now(),
        openedAt: now(),
        closed: false,
        watchdog: null,
      }
      sessions.set(session.id, session)
      try {
        const sideband = await provider.attach(session.id)
        session.sideband = sideband
        sideband.onMessage((event) => onEvent(session, event))
        sideband.onClose(() => finish(session, 'transport-closed', false))
        watch(session)
      } catch (error) {
        log(`[${session.id}] sideband failed: ${String(error)}`)
        finish(session, 'sideband-unavailable', false)
      }
      return { sessionId: session.id, sdp: created.sdp }
    },

    state(sessionId) {
      const session = sessions.get(sessionId)
      if (!session) return null
      return { telemetry: session.telemetry, reference: session.reference, lastAsk: session.lastAsk, closed: session.closed }
    },

    async respond(input) {
      const session = input.sessionId ? (sessions.get(input.sessionId) ?? null) : null
      const live = session !== null && !session.closed
      /* A live session carries the conversation's effects; a bare typed turn carries its own. */
      const effects: ToolEffects = session ?? { reference: input.reference ?? null, lastAsk: null, everWorking: false }
      const tag = session?.id ?? 'typed'
      const timing: TurnTiming | null = (() => {
        if (!live) return null
        const at = sessionMs(session, now())
        if (at === null) return null
        openTurn(session, at, true)
        session.lastUserSpeechAt = now()
        return session.openTurn
      })()
      const clock = (wallMs: number) => (session ? sessionMs(session, wallMs) : null)
      const usage = (result: ResponsesResult) => {
        if (!result.usage) return
        if (session) accumulate(session.telemetry, result.usage)
        else accumulateInto(typed, result.usage)
      }
      const countTool = (name: string) => {
        const bucket = session ? session.telemetry : typed
        bucket.toolCallsByName[name] = (bucket.toolCallsByName[name] ?? 0) + 1
        if (session) session.telemetry.toolCalls += 1
      }

      const started = now()
      if (!session) typed.turns += 1
      const bound = effects.reference ? `\n${LIVE_TYPED_CONTEXT.bound}` : ''
      const request = (conversation: unknown[]): ResponsesRequest => ({
        model: config.backendModel,
        instructions: `${LIVE_BACKEND_INSTRUCTIONS}\n${LIVE_TYPED_CONTEXT.channel}${bound}`,
        tools: LIVE_TOOL_DEFINITIONS,
        input: conversation,
        ...(config.backendServiceTier ? { serviceTier: config.backendServiceTier } : {}),
        ...(config.backendReasoningEffort ? { reasoningEffort: config.backendReasoningEffort } : {}),
      })
      /* The earlier turns travel as the messages they were; the backend keeps nothing between calls. */
      const conversation: unknown[] = [
        ...(input.history ?? []).map((turn) => ({ role: turn.by === 'user' ? 'user' : 'assistant', content: turn.text })),
        { role: 'user', content: input.subject ? `${input.text}\n(Ämne: ${input.subject})` : input.text },
      ]
      const toolCalls: string[] = []
      let state: string | null = null

      if (timing) timing.backendStartMs = clock(now())
      let result = await provider.respond(request(conversation))
      usage(result)
      for (let round = 0; round < 4; round++) {
        const calls = result.output.filter(isFunctionCall)
        if (calls.length === 0) break
        for (const call of calls) {
          countTool(call.name)
          toolCalls.push(call.name)
          const ran = await runTool(call, effects, timing, clock, tag)
          state = ran.state
          /* The call and its result travel back in the request; nothing is kept at the provider. */
          conversation.push(call)
          conversation.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(ran.output) })
        }
        result = await provider.respond(request(conversation))
        usage(result)
      }
      if (timing) timing.backendEndMs = clock(now())
      const say = answerOf(result)
      const backendMs = now() - started

      let spoken = false
      if (live && say) {
        session.telemetry.typedInjections += 1
        send(session, {
          type: 'session.instructions.append',
          event_id: `typed_${now()}`,
          delegation_id: null,
          content: LIVE_TYPED_CONTEXT.speak(input.text, say),
        })
        spoken = true
      }
      log(`[${tag}] typed → ${toolCalls.join(',') || 'no tool'} → ${state ?? 'answered'} in ${backendMs} ms`)
      return { say, reference: effects.reference, lastAsk: effects.lastAsk, state, toolCalls, backendMs, spoken }
    },

    async close(sessionId) {
      const session = sessions.get(sessionId)
      if (!session) return null
      if (!session.closed) {
        send(session, { type: 'session.close', event_id: `close_${now()}` })
        /* The provider confirms with session.closed and final usage; wait briefly for it, then finish regardless. */
        await new Promise<void>((resolve) => {
          const started = now()
          const tick = setInterval(() => {
            if (session.closed || now() - started > 5000) {
              clearInterval(tick)
              resolve()
            }
          }, 100)
        })
        finish(session, 'close-requested', false)
        session.sideband?.close()
      }
      return { telemetry: session.telemetry, reference: session.reference, lastAsk: session.lastAsk, closed: true }
    },

    telemetry() {
      return [...sessions.values()].map((session) => session.telemetry)
    },

    typedTelemetry() {
      return typed
    },
  }
}
