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
import {
  ACKNOWLEDGEMENT_PATTERN,
  LIVE_BACKEND_INSTRUCTIONS,
  LIVE_VOICE_INSTRUCTIONS,
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

export interface LiveProvider {
  /** POST /v1/live/sessions: the session config and the browser's offer in, the answer out. */
  createSession(input: { session: Record<string, unknown>; sdp: string }): Promise<{ id: string; sdp: string }>
  /** The sideband socket for a running session, authenticated with the server key. */
  attach(sessionId: string): Promise<LiveSideband>
}

export interface LiveConfig {
  model: string
  backendModel: string
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
}

export interface LiveSessionState {
  telemetry: LiveTelemetry
  /** The case this conversation is bound to, if the firm gave it one. A pointer. */
  reference: DomainReference | null
  /** What was last delegated, so the presence can name the case the way the typed path does. */
  lastAsk: { question: string; subject: string } | null
  closed: boolean
}

export interface LiveRuntime {
  /** `reference`: the case the conversation is already bound to, so spoken follow-ups read it. */
  open(input: { sdp: string; voice?: string; reference?: DomainReference }): Promise<{ sessionId: string; sdp: string }>
  state(sessionId: string): LiveSessionState | null
  /** Trusted application text into the session — the typed fallback while live. */
  type(sessionId: string, text: string): boolean
  close(sessionId: string): Promise<LiveSessionState | null>
  /** Every session's telemetry, for the cost view. */
  telemetry(): LiveTelemetry[]
}

interface Session {
  id: string
  voice: string
  sideband: LiveSideband | null
  telemetry: LiveTelemetry
  reference: DomainReference | null
  lastAsk: { question: string; subject: string } | null
  /** True once the firm has reported delegated work under way; the claim is truthful after that. */
  everWorking: boolean
  spokenTail: string
  lastUserSpeechAt: number
  openedAt: number
  closed: boolean
  watchdog: ReturnType<typeof setInterval> | null
}

const count = (t: LiveTelemetry, type: string) => {
  t.eventCounts[type] = (t.eventCounts[type] ?? 0) + 1
}

export function createLiveRuntime(deps: LiveRuntimeDeps): LiveRuntime {
  const { provider, host, config } = deps
  const now = deps.now ?? (() => Date.now())
  const requestId = deps.requestId ?? (() => crypto.randomUUID())
  const log = deps.log ?? (() => {})
  const sessions = new Map<string, Session>()

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
        },
      },
    }
  }

  function project(t: LiveTelemetry) {
    t.voiceCostUsd = (t.voiceSeconds / 60) * config.prices.voicePerMinuteUsd
  }

  function accumulate(t: LiveTelemetry, usage: Record<string, unknown>) {
    const details = usage.input_tokens_details as { cached_tokens?: number } | undefined
    const cached = details?.cached_tokens ?? 0
    const input = Math.max(0, Number(usage.input_tokens ?? 0) - cached)
    const output = Number(usage.output_tokens ?? 0)
    t.backend.responses += 1
    t.backend.inputTokens += input
    t.backend.cachedTokens += cached
    t.backend.outputTokens += output
    t.backend.costUsd +=
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
   * The delegation boundary: a function call from the backend becomes a host
   * request or an honest refusal, and its outcome goes back as a tool result
   * the backend must relay. No actor crosses in either direction.
   */
  async function executeToolCall(
    session: Session,
    item: { call_id: string; name: string; arguments?: string },
  ) {
    const t = session.telemetry
    t.toolCalls += 1
    t.toolCallsByName[item.name] = (t.toolCallsByName[item.name] ?? 0) + 1
    let args: unknown = {}
    try {
      args = JSON.parse(item.arguments ?? '{}')
    } catch {
      args = {}
    }
    const interpreted = interpretToolCall(item.name, args, {
      reference: session.reference,
      requestId,
    })
    let speech
    if (interpreted.kind === 'host') {
      const result = await host(interpreted.request)
      speech = toolSpeech(result)
      if (speech.reference) session.reference = speech.reference
      if (interpreted.request.kind === 'ask' && speech.reference)
        session.lastAsk = { question: interpreted.request.question, subject: interpreted.request.subject }
      if (result.state === 'working') session.everWorking = true
      log(`[${session.id}] ${item.name} → ${interpreted.request.kind} → ${result.state}`)
    } else {
      speech = unsupportedSpeech(interpreted.reason)
      log(`[${session.id}] ${item.name} → unsupported (${interpreted.reason})`)
    }
    send(session, {
      type: 'response.item.create',
      event_id: `out_${item.call_id}`,
      item: {
        type: 'function_call_output',
        call_id: item.call_id,
        output: JSON.stringify({
          state: speech.state,
          say: speech.say,
          acknowledgeWork: speech.acknowledgeWork,
          decisionRequired: speech.decisionRequired,
        }),
      },
    })
    send(session, { type: 'response.create', event_id: `continue_${item.call_id}` })
  }

  function onEvent(session: Session, event: Record<string, unknown>) {
    const t = session.telemetry
    const type = String(event.type ?? '')
    count(t, type)
    switch (type) {
      case 'session.usage.updated': {
        const usage = event.usage as { seconds?: number } | undefined
        if (typeof usage?.seconds === 'number') t.voiceSeconds = usage.seconds
        project(t)
        break
      }
      case 'session.input_transcript.delta':
        session.lastUserSpeechAt = now()
        break
      case 'session.output_transcript.delta': {
        session.spokenTail = (session.spokenTail + String(event.delta ?? '')).slice(-200)
        if (ACKNOWLEDGEMENT_PATTERN.test(session.spokenTail) && !session.everWorking) {
          t.ackWithoutReference += 1
          session.spokenTail = ''
          log(`[${session.id}] INVARIANT: delegated work claimed while the firm has none`)
        }
        break
      }
      case 'session.delegation.created':
        t.delegationsCreated += 1
        break
      case 'response.event': {
        const inner = (event.event ?? {}) as Record<string, unknown>
        const innerType = String(inner.type ?? '')
        count(t, `response.event/${innerType}`)
        const item = inner.item as { type?: string; call_id?: string; name?: string; arguments?: string } | undefined
        if (innerType === 'response.output_item.done' && item?.type === 'function_call' && item.call_id && item.name) {
          void executeToolCall(session, { call_id: item.call_id, name: item.name, arguments: item.arguments }).catch(
            (error: unknown) => log(`[${session.id}] tool failed: ${String(error)}`),
          )
        }
        const response = inner.response as { usage?: Record<string, unknown> } | undefined
        if (innerType === 'response.completed' && response?.usage) accumulate(t, response.usage)
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
        },
        reference: reference ?? null,
        lastAsk: null,
        everWorking: false,
        spokenTail: '',
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

    type(sessionId, text) {
      const session = sessions.get(sessionId)
      if (!session || session.closed) return false
      session.telemetry.typedInjections += 1
      session.lastUserSpeechAt = now()
      send(session, {
        type: 'session.instructions.append',
        event_id: `typed_${now()}`,
        delegation_id: null,
        content: `Användaren skrev just detta (text, inte tal): «${text.slice(0, 800)}». Behandla det som om det sagts och svara nu.`,
      })
      return true
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
  }
}
