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

import type {
  HostOpening,
  HostRequest,
  HostResult,
} from '~/application/analysis/hostContract'
import type { DomainReference } from '~/application/analysis/domainSystem'
import type { JarvisAnswer } from '~/application/jarvis/answer'
import type { MarketContextPointer } from '~/application/jarvis/askJarvis'
import { interpretToolCall, LIVE_TOOL_DEFINITIONS } from '~/application/jarvis/liveTools'
import { resolveJarvisContext } from '~/application/jarvis/context'
import type { MarketBrief, MarketScope } from '~/application/jarvis/marketBrief'
import { answerMarketQuery, type MarketAnswer } from '~/application/jarvis/marketAnswer'
import type { MarketHistorySource } from '~/application/jarvis/marketHistory'
import { mentionsMarket } from '~/application/jarvis/marketIntent'
import {
  recognizeMarketQuery,
  scopeForQuery,
  type MarketConversation,
} from '~/application/jarvis/marketQuery'
import {
  commissionKind,
  isConfirmation,
  isFocusOnly,
  openingFromWords,
} from '~/application/jarvis/opening'
import {
  ACKNOWLEDGEMENT_PATTERN,
  BRIDGING_PATTERN,
  LIVE_BACKEND_INSTRUCTIONS,
  LIVE_MARKET_CONTEXT,
  LIVE_TYPED_CONTEXT,
  LIVE_VOICE_INSTRUCTIONS,
  LIVE_WORKSPACE_CONTEXT,
  MARKET_UNAVAILABLE,
  toolSpeech,
  unsupportedSpeech,
  WORKSPACE_UNCLEAR,
} from '~/presentation/jarvis/liveSpeech'
import {
  marketAnswerSpeech,
  marketAnswerText,
} from '~/presentation/jarvis/marketAnswerText'
import { marketCardOf, type MarketCard } from '~/presentation/jarvis/marketCard'
import type { ResearchCard } from '~/presentation/jarvis/researchCard'
import type { ResearchContext } from '~/application/jarvis/research/researchQuery'
import type { JarvisSpokenAnswer } from '~/presentation/jarvis/spokenAnswer'

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
  | {
      type: 'function_call'
      call_id: string
      name: string
      arguments?: string
      id?: string
    }
  | { type: 'message'; role?: string; content?: { type: string; text?: string }[] }
  | { type: string }

export interface ResponsesResult {
  id: string
  output: ResponsesOutputItem[]
  usage?: Record<string, unknown>
}

export interface LiveProvider {
  /** POST /v1/live/sessions: the session config and the browser's offer in, the answer out. */
  createSession(input: {
    session: Record<string, unknown>
    sdp: string
  }): Promise<{ id: string; sdp: string }>
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
  /**
   * Responses `reasoning.effort` for the backend. The values gpt-5.6-luna
   * accepts, measured 2026-09-16: none, low, medium, high, xhigh, max —
   * "minimal" is refused with a 400.
   */
  backendReasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  voices: readonly string[]
  defaultVoice: string
  /** A session with no user speech for this long is closed by the server. */
  idleSeconds: number
  /** No session outlives this, whatever the browser does. */
  maxSeconds: number
  /**
   * How long a market brief attached to a conversation is offered as context
   * before it is fetched again — the explicit freshness window of the
   * ruling. Every number inside still carries its own observation time.
   */
  marketContextSeconds: number
  prices: {
    voicePerMinuteUsd: number
    /** Per 1M tokens, for the configured backend model. */
    backendInputUsd: number
    backendCachedUsd: number
    backendOutputUsd: number
  }
}

/** The record's answer to a line, in both modalities: what the screen renders, what the voice says. */
export interface WorkspaceResult {
  answer: JarvisAnswer
  spoken: JarvisSpokenAnswer
}

export interface WorkspaceInput {
  text: string
  /** The route the browser last reported for this session. */
  route: string | null
  /** The record's last answer in this session, for "ta resten också". */
  previous: JarvisAnswer | null
  /** The market conversation so far, so a bare "och i veckan?" is the market's and not the record's. */
  marketConversation?: MarketConversation | null
  /** The research conversation so far, so a bare "varför?" after a market answer is research and not the record's. */
  researchContext?: ResearchContext | null
}

/** What the research tier needs to recognise and answer a line. */
export interface ResearchInput {
  text: string
  route: string | null
  market: MarketConversation | null
  research: ResearchContext | null
}

/** A researched answer in both modalities, with the strip and the context it leaves behind. */
export interface ResearchTurn {
  say: string
  spokenSay: string
  card: ResearchCard
  context: ResearchContext
  kind: string
  unavailable: boolean
  evidenceCount: number
}

export interface LiveRuntimeDeps {
  provider: LiveProvider
  /** The host gateway, already bound to the server-resolved operator. */
  host: (request: HostRequest) => Promise<HostResult>
  /** Fresh market data for an observation question; never the firm. */
  market: (scope: MarketScope) => Promise<MarketBrief>
  /**
   * The advisory tier of the one router, for the workspace on screen: null
   * when the line is not the record's to answer. Absent, the voice has no
   * record to read from and the tool says so.
   */
  workspace?: (input: WorkspaceInput) => Promise<WorkspaceResult | null>
  /** The workspace's name for the voice's context — a client, a meeting, an office — from the route. */
  workspaceLabel?: (route: string | null) => Promise<string | null>
  /**
   * A period's series, for "i veckan", "i år": the platform's history, or
   * null when none is bound, in which case every period is honestly missing.
   */
  history?: MarketHistorySource | null
  /**
   * The public research tier: a line that is inherently public and current
   * — why the market moved, what a central bank said, what a company
   * reported — answered from public sources behind the firewall, before any
   * model. Null when the line is not research.
   */
  research?: ((input: ResearchInput) => Promise<ResearchTurn | null>) | null
  /** True when the provider is the simulated one: no audio, lines arrive as text. */
  simulated?: boolean
  config: LiveConfig
  requestId?: () => string
  now?: () => number
  log?: (line: string) => void
}

/**
 * One answer from the record inside a session, numbered so the browser,
 * which polls, renders each once: the line it answered, the structured
 * answer (null when the model answered), what the voice said, and the door
 * the answer opens.
 */
export interface AdvisoryEntry {
  seq: number
  at: string
  text: string
  answer: JarvisAnswer | null
  say: string
  opens: string | null
  /** True when the line was typed into the session rather than spoken. */
  typed: boolean
  /** The compact card for a period market answer, when the line was the market's. */
  card?: MarketCard | null
  /** The research strip, when the line was research. */
  research?: ResearchCard | null
}

/** How many answers a session keeps for the browser to catch up on. */
const ADVISORY_RING = 30

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
  backend: {
    responses: number
    inputTokens: number
    cachedTokens: number
    outputTokens: number
    costUsd: number
  }
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
   * The first fragment that carried content — past "Mm.", "Hm.", "Jag
   * kollar." and the like. Measured on the words, kept as a millisecond.
   */
  firstUsefulSpeechMs: number | null
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
  /** The route the session answers against, as the browser last reported it. */
  route: string | null
  simulated: boolean
  /** The record's answers in this session, oldest first, the last ADVISORY_RING of them. */
  advisory: AdvisoryEntry[]
  closed: boolean
}

export type { MarketContextPointer }

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
  /** When the conversation last carried a market brief, so a follow-up is answered over the same numbers. */
  marketContext?: MarketContextPointer | null
  /** Where the advisor is, so a generic market question knows whether the market is the scope. */
  context?: { route: string }
}

/**
 * Where a typed turn's time went, in milliseconds, by the stages the ruling
 * names: the routing decision, the data, the composition, the whole. Tier 0
 * is the deterministic path (no model); tiers 1–3 go through the router.
 */
export interface TypedTurnStages {
  /** 0: the deterministic market path; `research`: the public research tier; `router`: the model. */
  tier: 0 | 'research' | 'router'
  /** Tier 0: the recogniser's decision (µs, reported as 0). Router: the first model pass, which decides. */
  intentMs: number
  /** How the router decided: a tool, or a direct answer. */
  routed: 'retrieval' | 'tool' | 'answer'
  toolNames: string[]
  /** The market read, when one happened. */
  dataMs: number | null
  /** Composing the answer: the formatter (Tier 0) or the model's further passes. */
  composeMs: number
  /** Model passes made; 0 on Tier 0. */
  modelPasses: number
  /** A brief travelled with the turn as context, so no fetch was needed for it. */
  contextAttached: boolean
  totalMs: number
}

export interface TypedTurnResult {
  /** What JARVIS answered, as text. Empty when the model said nothing. */
  say: string
  /** The same answer in fewer words, for the voice; present when the answer has two forms. */
  spokenSay?: string
  /** The structured market answer, when the line was the market's. */
  market?: MarketAnswer
  /** The compact card for a period market answer. */
  card?: MarketCard
  /** The research strip, when the line was research. */
  research?: ResearchCard
  /** The case the conversation is bound to after the turn: unchanged, or the one a delegation opened. */
  reference: DomainReference | null
  lastAsk: { question: string; subject: string } | null
  /** The last tool's product state, when a tool was called; `market-snapshot` for the market; `market-retrieval` on Tier 0. */
  state: string | null
  toolCalls: string[]
  backendMs: number
  /** True when the line was also handed to a live session to be spoken. */
  spoken: boolean
  stages: TypedTurnStages
  /** A market brief was fetched or attached for this turn; the presence hands it back with the next line. */
  marketContext: MarketContextPointer | null
}

export interface TypedTelemetry {
  turns: number
  responses: number
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  costUsd: number
  toolCallsByName: Record<string, number>
  /** The last turns' stages, newest last. Milliseconds and tool names, never words. */
  stages: TypedTurnStages[]
}

export interface LiveRuntime {
  /** `reference`: the case the conversation is already bound to, so spoken follow-ups read it; `route`: where the advisor is. */
  open(input: {
    sdp: string
    voice?: string
    reference?: DomainReference
    route?: string
  }): Promise<{ sessionId: string; sdp: string; simulated: boolean }>
  state(sessionId: string): LiveSessionState | null
  /** The advisor moved: the session answers against the new route from now on, and the voice is told where they are. */
  setContext(sessionId: string, route: string): LiveSessionState | null
  /**
   * A line answered from the record outside the session's own loop — a typed
   * line while live — handed to the voice to say and remembered as the last
   * answer, so a spoken "ta resten" continues it. Not listed for the browser,
   * which already holds it.
   */
  speak(
    sessionId: string,
    text: string,
    say: string,
    answer: JarvisAnswer | null,
  ): boolean
  /**
   * A spoken line arriving as text: the simulated microphone, and the tests.
   * The same turn the workspace tool runs — the record first, then the market
   * fast path and the model — recorded for the browser to render.
   */
  hear(sessionId: string, text: string): Promise<AdvisoryEntry | null>
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
  /** The current reply's words so far, for the useful-speech mark; dropped when the person speaks. */
  replyText: string
  /** The end of the last assistant fragment, to tell a new reply from a continuing one. */
  lastAssistantEndMs: number | null
  /** When a market brief was last handed to the voice as context, on the wall clock. */
  marketContextAt: number | null
  /** The subject and period of the last market answer in this session, for a spoken follow-up. */
  marketConversation: MarketConversation | null
  /** The subject of the last researched answer in this session, for "varför?" and "vad säger analytiker?". */
  researchContext: ResearchContext | null
  /** Where the advisor is, as the browser last reported it. */
  route: string | null
  /** The record's last answer in this session, for a continuation. */
  lastAdvisory: JarvisAnswer | null
  advisory: AdvisoryEntry[]
  advisorySeq: number
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

/** A case the firm has convened and cannot open on its own: the person's opening is what it waits for. */
const awaitsOpening = (
  result: HostResult,
): result is Extract<HostResult, { state: 'needs-decision' }> =>
  result.state === 'needs-decision' &&
  result.decision.reason === 'institutional-initialization-required'

const isFunctionCall = (
  item: ResponsesOutputItem,
): item is Extract<ResponsesOutputItem, { type: 'function_call' }> =>
  item.type === 'function_call' && 'call_id' in item && 'name' in item

export function createLiveRuntime(deps: LiveRuntimeDeps): LiveRuntime {
  const { provider, host, market, config, workspace, workspaceLabel } = deps
  const history = deps.history ?? null
  const research = deps.research ?? null
  const simulated = deps.simulated ?? false
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
    stages: [],
  }
  const MAX_STAGES = 200

  /**
   * The market brief handed to a live voice session as context, so the
   * voice answers a simple state question itself, from fresh numbers with
   * their times and sources, and hands off only what is not there. Sent at
   * open, again after every market read, and again when the window passes.
   */
  async function injectMarketContext(session: Session, why: string) {
    try {
      const brief = await market('global')
      if (session.closed) return
      session.marketContextAt = now()
      const content = LIVE_MARKET_CONTEXT.voice(brief, config.marketContextSeconds)
      send(session, {
        type: 'session.instructions.append',
        event_id: `market_${now()}`,
        delegation_id: null,
        content,
      })
      log(
        `[${session.id}] market context ${why}: ${brief.indices.length} indices, ${brief.unavailable.length} unavailable, ${content.length} chars`,
      )
    } catch (error) {
      log(`[${session.id}] market context ${why} failed: ${String(error)}`)
    }
  }

  /** Where the advisor is, told to the voice: a short append, re-sent on every route change. */
  async function injectWorkspaceContext(session: Session, why: string) {
    try {
      const label = workspaceLabel ? await workspaceLabel(session.route) : null
      if (session.closed) return
      send(session, {
        type: 'session.instructions.append',
        event_id: `workspace_${now()}`,
        delegation_id: null,
        content: LIVE_WORKSPACE_CONTEXT.voice(label),
      })
      log(
        `[${session.id}] workspace context ${why}: ${label ?? 'no subject'} (${session.route ?? 'no route'})`,
      )
    } catch (error) {
      log(`[${session.id}] workspace context ${why} failed: ${String(error)}`)
    }
  }

  /** An answer from the record, kept for the browser and as the conversation's last answer. */
  function recordAdvisory(
    session: Session,
    text: string,
    answer: JarvisAnswer | null,
    say: string,
    typed: boolean,
    card: MarketCard | null = null,
    researchCard: ResearchCard | null = null,
  ): AdvisoryEntry {
    session.advisorySeq += 1
    const entry: AdvisoryEntry = {
      seq: session.advisorySeq,
      at: new Date(now()).toISOString(),
      text,
      answer,
      say,
      opens: answer?.opens ?? null,
      typed,
      ...(card ? { card } : {}),
      ...(researchCard ? { research: researchCard } : {}),
    }
    if (answer) session.lastAdvisory = answer
    session.advisory.push(entry)
    if (session.advisory.length > ADVISORY_RING) session.advisory.shift()
    return entry
  }

  /** The record's answer to a line in a session, or null when the line is the model's. */
  async function answerFromWorkspace(
    session: Session,
    text: string,
  ): Promise<WorkspaceResult | null> {
    if (!workspace) return null
    return workspace({
      text,
      route: session.route,
      previous: session.lastAdvisory,
      marketConversation: session.marketConversation,
      researchContext: session.researchContext,
    })
  }

  /** The research tier's answer to a line in a session, or null when the line is not research or the tier is not bound. */
  async function researchTurnFor(
    session: Session,
    text: string,
  ): Promise<ResearchTurn | null> {
    if (!research) return null
    return research({
      text,
      route: session.route,
      market: session.marketConversation,
      research: session.researchContext,
    })
  }

  /** A market answer in both forms: the text the presence shows, the sentence the voice says. */
  interface MarketTurn {
    answer: MarketAnswer
    say: string
    spokenSay: string
    scope: MarketScope
    dataMs: number
  }

  /**
   * The market's answer to a line, where the line is the market's: the
   * recogniser decides in microseconds, the brief and the series answer from
   * the platform, the renderer speaks the numbers. No model. The conversation
   * carries the subject and the period on to the next line.
   */
  async function marketTurnFor(
    text: string,
    route: string | null,
    conversation: MarketConversation | null,
  ): Promise<MarketTurn | null> {
    /* No route reported: nowhere in particular, so a generic line is the router's and a named one the market's. */
    const scope = route ? resolveJarvisContext(route).scope : 'GLOBAL'
    const query = recognizeMarketQuery(text, {
      scope,
      conversation,
      now: new Date(now()),
    })
    if (!query) return null
    const started = now()
    const answer = await answerMarketQuery(query, {
      brief: market,
      history,
      now: () => new Date(now()),
    })
    return {
      answer,
      say: marketAnswerText(answer),
      spokenSay: marketAnswerSpeech(answer),
      scope: scopeForQuery(query),
      dataMs: now() - started,
    }
  }

  const readable = (text: string): boolean => /[\p{L}\p{N}]{2,}/u.test(text)

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
          ...(config.backendServiceTier
            ? { service_tier: config.backendServiceTier }
            : {}),
          ...(config.backendReasoningEffort
            ? { reasoning: { effort: config.backendReasoningEffort } }
            : {}),
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
    bucket: {
      responses: number
      inputTokens: number
      cachedTokens: number
      outputTokens: number
      costUsd: number
    },
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
    /** The person's own words this turn, where the runtime has them (a typed turn); the voice's are not on the sideband. */
    line: string | null = null,
  ): Promise<{ output: Record<string, unknown>; state: string }> {
    let args: unknown = {}
    try {
      args = JSON.parse(call.arguments ?? '{}')
    } catch {
      args = {}
    }
    const interpreted = interpretToolCall(call.name, args, {
      reference: effects.reference,
      requestId,
    })
    if (interpreted.kind === 'host' || interpreted.kind === 'begin') {
      const started = now()
      if (timing && timing.hostCallMs === null) timing.hostCallMs = clock(started)
      const path: string[] = []
      let request: HostRequest
      let result: HostResult
      let opening: HostOpening | undefined
      if (interpreted.kind === 'begin') {
        /*
         * The person's answer to the one question. The case's own question
         * decides what the words are — a view, a focus, or a confirmation —
         * so the firm is read first and never asked twice.
         */
        const status = await host({ kind: 'status', reference: interpreted.reference })
        path.push('status', status.state)
        if (awaitsOpening(status)) {
          opening = openingFromWords(
            status.question,
            interpreted.words,
            interpreted.focus,
          )
          request = {
            kind: 'begin',
            reference: interpreted.reference,
            requestId: requestId(),
            opening,
          }
          result = await host(request)
          path.push(`begin (${opening.kind})`, result.state)
        } else if (interpreted.words && !isConfirmation(interpreted.words)) {
          /* The firm is already under way; what the person said is still theirs to have on the record. */
          request = {
            kind: 'amend',
            reference: interpreted.reference,
            requestId: requestId(),
            text: interpreted.words,
          }
          result = await host(request)
          path.push('amend', result.state)
        } else {
          request = { kind: 'status', reference: interpreted.reference }
          result = status
        }
      } else if (
        interpreted.request.kind === 'ask' &&
        effects.reference &&
        [line, interpreted.request.question].some(
          (words) => words !== null && (isFocusOnly(words) || isConfirmation(words)),
        )
      ) {
        /*
         * A focus alone, or a bare "kör", while a case is bound is about that
         * case — never a second question to the firm, whatever tool the model
         * reached for. Measured 2026-09-17: "Makro, flöden och specifika
         * händelser." opened a duplicate case once in three runs. Measured
         * 2026-09-18: the model rephrased that line into the case's question
         * before asking, so the person's OWN words are read where the runtime
         * has them, and they are what goes on the record.
         */
        request = {
          kind: 'amend',
          reference: effects.reference,
          requestId: requestId(),
          text: line ?? interpreted.request.question,
        }
        result = await host(request)
        path.push('ask taken as addition', 'amend', result.state)
      } else {
        request = interpreted.request
        result = await host(request)
        path.push(request.kind, result.state)
      }
      /*
       * An explanation the person asked the firm for opens at once, on their
       * words and their focus. A capital question keeps its one question. Words
       * added to a case that still awaits its opening ARE the opening — the
       * loop of 2026-09-17 (five confirmations, five "needs a thesis") cannot
       * happen here, whatever the model does with them.
       */
      if (awaitsOpening(result) && (request.kind === 'ask' || request.kind === 'amend')) {
        const question = request.kind === 'ask' ? request.question : result.question
        const words = request.kind === 'amend' ? request.text : null
        if (request.kind === 'ask' && commissionKind(question) !== 'explanation') {
          /* The one question, asked once; the answer comes back as begin_delegation or as an addition. */
        } else {
          opening = openingFromWords(question, words)
          const begin: HostRequest = {
            kind: 'begin',
            reference: result.reference,
            requestId: requestId(),
            opening,
          }
          result = await host(begin)
          path.push(`begin (${opening.kind})`, result.state)
          if (request.kind === 'amend') request = begin
        }
      }
      /*
       * A material objection is the firm's own stop, and the person hears
       * what it is rather than that "something" is open: the runtime reads
       * the objections behind the block itself (G1, 2026-09-17). One read,
       * no second tool call for the model to think of.
       */
      if (
        result.state === 'blocked' &&
        result.block.reason === 'objections-unresolved' &&
        !result.inspection
      ) {
        const inspected = await host({
          kind: 'inspect',
          reference: result.reference,
          view: { kind: 'objections' },
        })
        if (inspected.state === 'blocked' && inspected.inspection) {
          result = inspected
          path.push('inspect (objections)')
        }
      }
      if (timing && timing.hostDurationMs === null)
        timing.hostDurationMs = now() - started
      const speech = toolSpeech(result, opening ? 'begin' : request.kind, opening)
      if (speech.reference) effects.reference = speech.reference
      if (request.kind === 'ask' && speech.reference)
        effects.lastAsk = { question: request.question, subject: request.subject }
      if (result.state === 'working') effects.everWorking = true
      log(`[${tag}] ${call.name} → ${path.join(' → ')}`)
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
    if (interpreted.kind === 'workspace') {
      /*
       * The record answers what is on screen through the same router the
       * typed line uses; the session supplies the route, never the model.
       * What the voice reads is the spoken rendering, verbatim; what the
       * browser renders is the structured answer, from the session state.
       */
      /* A live session's effects ARE the session; a bare typed turn's are not, and have no route. */
      const session = sessions.get((effects as { id?: string }).id ?? '') ?? null
      const question = interpreted.question
      if (!readable(question)) {
        log(`[${tag}] ${call.name} → unclear`)
        return {
          state: 'workspace-unclear',
          output: {
            state: 'workspace-unclear',
            say: WORKSPACE_UNCLEAR,
            acknowledgeWork: false,
            decisionRequired: false,
          },
        }
      }
      const started = now()
      /*
       * The market first, through the same path a typed line takes: a named
       * instrument, a region, a period or a follow-up is answered from the
       * platform's numbers and read verbatim — the voice model never answers
       * the market on its own.
       */
      if (session) {
        let marketTurn: MarketTurn | null = null
        try {
          marketTurn = await marketTurnFor(
            question,
            session.route,
            session.marketConversation,
          )
        } catch (error) {
          log(`[${tag}] ${call.name} → market read failed: ${String(error)}`)
          marketTurn = null
        }
        if (marketTurn) {
          session.marketConversation = marketTurn.answer.conversation
          recordAdvisory(
            session,
            question,
            null,
            marketTurn.spokenSay,
            false,
            marketCardOf(marketTurn.answer),
          )
          log(
            `[${tag}] ${call.name} → ${marketTurn.answer.kind} (${marketTurn.scope}) in ${now() - started} ms`,
          )
          return {
            state: 'workspace-answer',
            output: {
              state: 'workspace-answer',
              say: marketTurn.spokenSay,
              acknowledgeWork: false,
              decisionRequired: false,
            },
          }
        }
        /* Then research: why the market moved, what a central bank said — from public sources behind the firewall, read verbatim. */
        let researched: ResearchTurn | null = null
        try {
          researched = await researchTurnFor(session, question)
        } catch (error) {
          log(`[${tag}] ${call.name} → research failed: ${String(error)}`)
          researched = null
        }
        if (researched) {
          session.researchContext = researched.context
          recordAdvisory(
            session,
            question,
            null,
            researched.spokenSay,
            false,
            null,
            researched.card,
          )
          log(
            `[${tag}] ${call.name} → research ${researched.kind} (${researched.evidenceCount} sources${researched.unavailable ? ', unavailable' : ''}) in ${now() - started} ms`,
          )
          return {
            state: 'workspace-answer',
            output: {
              state: 'workspace-answer',
              say: researched.spokenSay,
              acknowledgeWork: false,
              decisionRequired: false,
            },
          }
        }
      }
      const result = session ? await answerFromWorkspace(session, question) : null
      if (!result) {
        log(
          `[${tag}] ${call.name} → not the record's (${session?.route ?? 'no route'}) in ${now() - started} ms`,
        )
        return {
          state: 'workspace-unanswered',
          output: {
            state: 'workspace-unanswered',
            acknowledgeWork: false,
            decisionRequired: false,
            note: 'Frågan rör inte det som visas i registret. Svara själv enligt dina regler.',
          },
        }
      }
      if (session)
        recordAdvisory(session, question, result.answer, result.spoken.say, false)
      log(
        `[${tag}] ${call.name} → ${result.answer.intent} (${session?.route ?? 'no route'}) in ${now() - started} ms`,
      )
      return {
        state: 'workspace-answer',
        output: {
          state: 'workspace-answer',
          say: result.spoken.say,
          acknowledgeWork: false,
          decisionRequired: false,
        },
      }
    }
    if (interpreted.kind === 'market') {
      const started = now()
      if (timing && timing.marketCallMs === null) timing.marketCallMs = clock(started)
      try {
        const brief = await market(interpreted.scope)
        if (timing && timing.marketDurationMs === null)
          timing.marketDurationMs = now() - started
        log(
          `[${tag}] ${call.name} → market ${interpreted.scope} → ${brief.indices.length} indices, ${brief.unavailable.length} unavailable`,
        )
        return {
          state: 'market-snapshot',
          output: {
            state: 'market-snapshot',
            acknowledgeWork: false,
            decisionRequired: false,
            brief,
          },
        }
      } catch (error) {
        if (timing && timing.marketDurationMs === null)
          timing.marketDurationMs = now() - started
        log(
          `[${tag}] ${call.name} → market ${interpreted.scope} → failed: ${String(error)}`,
        )
        return {
          state: 'market-unavailable',
          output: {
            state: 'market-unavailable',
            say: MARKET_UNAVAILABLE,
            acknowledgeWork: false,
            decisionRequired: false,
          },
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
    const { output, state } = await runTool(
      item,
      session,
      session.openTurn,
      (wallMs) => sessionMs(session, wallMs),
      session.id,
    )
    send(session, {
      type: 'response.item.create',
      event_id: `out_${item.call_id}`,
      item: {
        type: 'function_call_output',
        call_id: item.call_id,
        output: JSON.stringify(output),
      },
    })
    send(session, { type: 'response.create', event_id: `continue_${item.call_id}` })
    /* The voice gets the same fresh numbers, so the next simple question needs no handoff. */
    if (state === 'market-snapshot') void injectMarketContext(session, 'after a read')
  }

  /** The text of a Responses result: every output_text part, in order. */
  function answerOf(result: ResponsesResult): string {
    return result.output
      .filter(
        (item): item is Extract<ResponsesOutputItem, { type: 'message' }> =>
          item.type === 'message',
      )
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
      firstUsefulSpeechMs: null,
      speechStartsMs: [],
      typed,
    }
    session.replyText = ''
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
        if (session.openTurn && session.openTurn.firstSpeechMs !== null)
          session.openTurn = null
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
          if (
            session.lastAssistantEndMs === null ||
            startMs - session.lastAssistantEndMs > 1200
          )
            turn.speechStartsMs.push(startMs)
          /*
           * The useful-speech mark: the first fragment after which the reply,
           * with its bridging words stripped, says something. The words are
           * held only until the person speaks again; the mark is a number.
           */
          if (turn.firstUsefulSpeechMs === null) {
            session.replyText = (session.replyText + delta).slice(-300)
            const content = session.replyText.replace(BRIDGING_PATTERN, '')
            /* Two words of content — not a stray syllable of a date ("sep.,"), which a run of 2026-09-17 counted as an answer. */
            if ((content.match(/[\p{L}\p{N}]{2,}/gu) ?? []).length >= 2)
              turn.firstUsefulSpeechMs = startMs
          }
        }
        session.lastAssistantEndMs = Math.max(session.lastAssistantEndMs ?? 0, endMs)
        break
      }
      case 'session.delegation.created': {
        t.delegationsCreated += 1
        const offset =
          typeof event.offset_ms === 'number'
            ? event.offset_ms
            : sessionMs(session, now())
        if (session.openTurn && session.openTurn.delegationMs === null)
          session.openTurn.delegationMs = offset
        break
      }
      case 'response.event': {
        const inner = (event.event ?? {}) as Record<string, unknown>
        const innerType = String(inner.type ?? '')
        count(t, `response.event/${innerType}`)
        if (
          innerType === 'response.created' &&
          session.openTurn &&
          session.openTurn.backendStartMs === null
        )
          session.openTurn.backendStartMs = sessionMs(session, now())
        const item = inner.item as
          | { type?: string; call_id?: string; name?: string; arguments?: string }
          | undefined
        if (
          innerType === 'response.output_item.done' &&
          item?.type === 'function_call' &&
          item.call_id &&
          item.name
        ) {
          void executeToolCall(session, {
            call_id: item.call_id,
            name: item.name,
            arguments: item.arguments,
          }).catch((error: unknown) =>
            log(`[${session.id}] tool failed: ${String(error)}`),
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
      case 'error': {
        /* A refused market-context append is the one error that leaves the voice without its numbers: counted by name. */
        const error = event.error as { client_event_id?: unknown } | undefined
        if (
          typeof error?.client_event_id === 'string' &&
          error.client_event_id.startsWith('market_')
        ) {
          count(session.telemetry, 'error.market_context')
        }
        log(
          `[${session.id}] error event: ${JSON.stringify(event.error ?? event).slice(0, 200)}`,
        )
        break
      }
      default:
        break
    }
  }

  function watch(session: Session) {
    session.watchdog = setInterval(() => {
      if (session.closed) return
      const idle = (now() - session.lastUserSpeechAt) / 1000
      const age = (now() - session.openedAt) / 1000
      /* The window passed while the person is still talking: fresh numbers, or none. */
      if (
        session.marketContextAt !== null &&
        now() - session.marketContextAt >= config.marketContextSeconds * 1000 &&
        idle < 60
      ) {
        session.marketContextAt = now()
        void injectMarketContext(session, 'window passed')
      }
      if (idle >= config.idleSeconds || age >= config.maxSeconds) {
        session.telemetry.reason =
          idle >= config.idleSeconds
            ? `idle ${Math.round(idle)} s`
            : `max ${Math.round(age)} s`
        session.telemetry.closedByPolicy = true
        log(`[${session.id}] closing by policy: ${session.telemetry.reason}`)
        send(session, { type: 'session.close', event_id: `policy_${now()}` })
        if (session.watchdog) clearInterval(session.watchdog)
        session.watchdog = null
      }
    }, 1000)
  }

  const respond: LiveRuntime['respond'] = async (input) => respondImpl(input)

  const runtime: LiveRuntime = {
    async open({ sdp, voice, reference, route }) {
      const chosen = voice && config.voices.includes(voice) ? voice : config.defaultVoice
      const created = await provider.createSession({
        session: sessionConfig(chosen),
        sdp,
      })
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
          backend: {
            responses: 0,
            inputTokens: 0,
            cachedTokens: 0,
            outputTokens: 0,
            costUsd: 0,
          },
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
        replyText: '',
        lastAssistantEndMs: null,
        marketContextAt: null,
        marketConversation: null,
        researchContext: null,
        route: route ?? null,
        lastAdvisory: null,
        advisory: [],
        advisorySeq: 0,
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
        /* Not awaited: the offer is answered now; the numbers and the workspace follow within the session's first seconds. */
        void injectMarketContext(session, 'at open')
        void injectWorkspaceContext(session, 'at open')
      } catch (error) {
        log(`[${session.id}] sideband failed: ${String(error)}`)
        finish(session, 'sideband-unavailable', false)
      }
      return { sessionId: session.id, sdp: created.sdp, simulated }
    },

    state(sessionId) {
      const session = sessions.get(sessionId)
      if (!session) return null
      return stateOf(session)
    },

    setContext(sessionId, route) {
      const session = sessions.get(sessionId)
      if (!session) return null
      if (session.route !== route) {
        session.route = route
        /* A new subject: the earlier answer is not continued across it. */
        session.lastAdvisory = null
        if (!session.closed) void injectWorkspaceContext(session, 'route changed')
      }
      return stateOf(session)
    },

    speak(sessionId, text, say, answer) {
      const session = sessions.get(sessionId)
      if (!session || session.closed) return false
      if (answer) session.lastAdvisory = answer
      session.telemetry.typedInjections += 1
      send(session, {
        type: 'session.instructions.append',
        event_id: `typed_${now()}`,
        delegation_id: null,
        content: LIVE_WORKSPACE_CONTEXT.speak(text, say),
      })
      return true
    },

    async hear(sessionId, text) {
      const session = sessions.get(sessionId)
      if (!session || session.closed) return null
      const line = text.trim()
      session.lastUserSpeechAt = now()
      if (!readable(line))
        return recordAdvisory(session, line, null, WORKSPACE_UNCLEAR, false)
      const started = now()
      const result = await answerFromWorkspace(session, line)
      if (result) {
        log(
          `[${session.id}] heard → ${result.answer.intent} (${session.route ?? 'no route'}) in ${now() - started} ms`,
        )
        return recordAdvisory(session, line, result.answer, result.spoken.say, false)
      }
      /* Not the record's: the market path and the model, exactly as a typed line; the voice says the spoken form. */
      const typed = await respond({ text: line, sessionId })
      log(`[${session.id}] heard → ${typed.state ?? 'model'} in ${now() - started} ms`)
      return recordAdvisory(
        session,
        line,
        null,
        typed.spokenSay ?? typed.say,
        false,
        typed.card ?? null,
        typed.research ?? null,
      )
    },

    respond,

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
      return { ...stateOf(session), closed: true }
    },

    telemetry() {
      return [...sessions.values()].map((session) => session.telemetry)
    },

    typedTelemetry() {
      return typed
    },
  }

  function stateOf(session: Session): LiveSessionState {
    return {
      telemetry: session.telemetry,
      reference: session.reference,
      lastAsk: session.lastAsk,
      route: session.route,
      simulated,
      advisory: [...session.advisory],
      closed: session.closed,
    }
  }

  async function respondImpl(input: TypedTurnInput): Promise<TypedTurnResult> {
    {
      const session = input.sessionId ? (sessions.get(input.sessionId) ?? null) : null
      const live = session !== null && !session.closed
      /* A live session carries the conversation's effects; a bare typed turn carries its own. */
      const effects: ToolEffects = session ?? {
        reference: input.reference ?? null,
        lastAsk: null,
        everWorking: false,
      }
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
      const recordStages = (stages: TypedTurnStages) => {
        typed.stages.push(stages)
        if (typed.stages.length > MAX_STAGES) typed.stages.shift()
      }
      /** The answer, handed to the voice as well when the session is live. */
      const deliver = (say: string): boolean => {
        if (!live || !say) return false
        session.telemetry.typedInjections += 1
        send(session, {
          type: 'session.instructions.append',
          event_id: `typed_${now()}`,
          delegation_id: null,
          content: LIVE_TYPED_CONTEXT.speak(input.text, say),
        })
        return true
      }

      /*
       * Tier 0: the market's own questions — a named instrument, a region,
       * a period, a comparison, a follow-up — recognised in microseconds and
       * answered from the platform's numbers, the subject and the period
       * carried on to the next line. No model. A market question the
       * platform cannot read right now is answered as unavailable, never
       * handed to the model to guess at.
       */
      const route = session?.route ?? input.context?.route ?? null
      const marketConversation =
        session?.marketConversation ?? input.marketContext?.conversation ?? null
      const researchContext =
        session?.researchContext ?? input.marketContext?.research ?? null
      /** The pointer handed back: the research context rides along so a follow-up keeps its subject. */
      const withResearch = (
        pointer: MarketContextPointer | null,
        context: ResearchContext | null,
      ): MarketContextPointer | null =>
        pointer ? { ...pointer, ...(context ? { research: context } : {}) } : null
      const scopeOfLine = route ? resolveJarvisContext(route).scope : 'GLOBAL'
      const query = recognizeMarketQuery(input.text, {
        scope: scopeOfLine,
        conversation: marketConversation,
        now: new Date(now()),
      })
      if (query) {
        const scope = scopeForQuery(query)
        const dataStarted = now()
        if (timing && timing.marketCallMs === null)
          timing.marketCallMs = clock(dataStarted)
        let say: string
        let spokenSay: string
        let answer: MarketAnswer | null = null
        let dataMs: number | null = null
        let context: TypedTurnResult['marketContext'] = null
        try {
          answer = await answerMarketQuery(query, {
            brief: market,
            history,
            now: () => new Date(now()),
          })
          dataMs = now() - dataStarted
          say = marketAnswerText(answer)
          spokenSay = marketAnswerSpeech(answer)
          context = { at: answer.generatedAt, scope, conversation: answer.conversation }
          if (session) session.marketConversation = answer.conversation
        } catch (error) {
          /* The platform could not be read: said plainly, and the subject is still remembered. */
          log(`[${tag}] market read failed: ${String(error)}`)
          dataMs = now() - dataStarted
          say = MARKET_UNAVAILABLE
          spokenSay = MARKET_UNAVAILABLE
        }
        if (timing && timing.marketDurationMs === null) timing.marketDurationMs = dataMs
        const composeStarted = now()
        const stages: TypedTurnStages = {
          tier: 0,
          intentMs: 0,
          routed: 'retrieval',
          toolNames: [],
          dataMs,
          composeMs: now() - composeStarted,
          modelPasses: 0,
          contextAttached: false,
          totalMs: now() - started,
        }
        recordStages(stages)
        if (timing) timing.backendEndMs = clock(now())
        const spoken = deliver(spokenSay)
        log(
          `[${tag}] typed → tier 0 ${query.kind} (${query.symbols.length} symbol${query.symbols.length === 1 ? '' : 's'}, ${scope}, ${query.period.kind}) in ${stages.totalMs} ms`,
        )
        const card = answer ? marketCardOf(answer) : null
        return {
          say,
          spokenSay,
          ...(answer ? { market: answer } : {}),
          ...(card ? { card } : {}),
          reference: effects.reference,
          lastAsk: effects.lastAsk,
          state: 'market-retrieval',
          toolCalls: [],
          backendMs: stages.totalMs,
          spoken,
          stages,
          marketContext: withResearch(context, researchContext),
        }
      }

      /*
       * The research tier: a line that is inherently public and current —
       * why the market moved, what a central bank said, what a company
       * reported, what the week holds — answered from public sources behind
       * the firewall, before any model and never from a model's memory. The
       * subject carries on to the next line.
       */
      if (research) {
        const researchStarted = now()
        let turn: ResearchTurn | null = null
        try {
          turn = await research({
            text: input.text,
            route,
            market: marketConversation,
            research: researchContext,
          })
        } catch (error) {
          log(`[${tag}] research failed: ${String(error)}`)
        }
        if (turn) {
          if (session) session.researchContext = turn.context
          const stages: TypedTurnStages = {
            tier: 'research',
            intentMs: 0,
            routed: 'retrieval',
            toolNames: [],
            dataMs: now() - researchStarted,
            composeMs: 0,
            modelPasses: 0,
            contextAttached: false,
            totalMs: now() - started,
          }
          recordStages(stages)
          if (timing) timing.backendEndMs = clock(now())
          const spoken = deliver(turn.spokenSay)
          log(
            `[${tag}] typed → research ${turn.kind} (${turn.evidenceCount} source${turn.evidenceCount === 1 ? '' : 's'}${turn.unavailable ? ', unavailable' : ''}) in ${stages.totalMs} ms`,
          )
          return {
            say: turn.say,
            spokenSay: turn.spokenSay,
            research: turn.card,
            reference: effects.reference,
            lastAsk: effects.lastAsk,
            state: 'research',
            toolCalls: [],
            backendMs: stages.totalMs,
            spoken,
            stages,
            marketContext: {
              at: new Date(now()).toISOString(),
              ...(marketConversation ? { conversation: marketConversation } : {}),
              research: turn.context,
            },
          }
        }
      }

      /*
       * The router. A brief travels with the turn when the line is about
       * markets or the conversation already carried one — fresh from the
       * platform's cache, every number with its own time — so the model
       * answers over the numbers and fetches only what it does not have.
       */
      const wantsContext =
        mentionsMarket(input.text) ||
        (input.marketContext !== undefined && input.marketContext !== null) ||
        (input.history ?? []).some(
          (turn) => turn.by === 'user' && mentionsMarket(turn.text),
        )
      let contextText = ''
      let dataMs: number | null = null
      let context: TypedTurnResult['marketContext'] = null
      if (wantsContext) {
        const dataStarted = now()
        try {
          const brief = await market('global')
          dataMs = now() - dataStarted
          if (timing) {
            if (timing.marketCallMs === null) timing.marketCallMs = clock(dataStarted)
            if (timing.marketDurationMs === null) timing.marketDurationMs = dataMs
          }
          contextText = `\n\n${LIVE_MARKET_CONTEXT.typed(brief, config.marketContextSeconds)}`
          context = { at: brief.generatedAt, scope: 'global' }
        } catch (error) {
          log(`[${tag}] market context failed: ${String(error)}`)
        }
      }

      const bound = effects.reference ? `\n${LIVE_TYPED_CONTEXT.bound}` : ''
      /*
       * With the global brief attached the snapshot tool has nothing to add
       * — every scope is in it — so it is not offered. Measured: offered, the
       * router still called it on a third of market lines and paid a second
       * model pass for numbers it already had.
       */
      const tools = contextText
        ? LIVE_TOOL_DEFINITIONS.filter((tool) => tool.name !== 'get_market_snapshot')
        : LIVE_TOOL_DEFINITIONS
      const request = (conversation: unknown[]): ResponsesRequest => ({
        model: config.backendModel,
        instructions: `${LIVE_BACKEND_INSTRUCTIONS}\n${LIVE_TYPED_CONTEXT.channel}${bound}${contextText}`,
        tools,
        input: conversation,
        ...(config.backendServiceTier ? { serviceTier: config.backendServiceTier } : {}),
        ...(config.backendReasoningEffort
          ? { reasoningEffort: config.backendReasoningEffort }
          : {}),
      })
      /* The earlier turns travel as the messages they were; the backend keeps nothing between calls. */
      const conversation: unknown[] = [
        ...(input.history ?? []).map((turn) => ({
          role: turn.by === 'user' ? 'user' : 'assistant',
          content: turn.text,
        })),
        {
          role: 'user',
          content: input.subject ? `${input.text}\n(Ämne: ${input.subject})` : input.text,
        },
      ]
      const toolCalls: string[] = []
      let state: string | null = null
      let modelPasses = 0

      if (timing) timing.backendStartMs = clock(now())
      const routingStarted = now()
      let result = await provider.respond(request(conversation))
      modelPasses += 1
      usage(result)
      const intentMs = now() - routingStarted
      const routed: TypedTurnStages['routed'] = result.output.some(isFunctionCall)
        ? 'tool'
        : 'answer'
      const composeStarted = now()
      for (let round = 0; round < 4; round++) {
        const calls = result.output.filter(isFunctionCall)
        if (calls.length === 0) break
        for (const call of calls) {
          countTool(call.name)
          toolCalls.push(call.name)
          const toolStarted = now()
          const ran = await runTool(call, effects, timing, clock, tag, input.text)
          if (ran.state === 'market-snapshot')
            dataMs = (dataMs ?? 0) + (now() - toolStarted)
          state = ran.state
          /* The call and its result travel back in the request; nothing is kept at the provider. */
          conversation.push(call)
          conversation.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(ran.output),
          })
        }
        result = await provider.respond(request(conversation))
        modelPasses += 1
        usage(result)
      }
      if (timing) timing.backendEndMs = clock(now())
      const say = answerOf(result)
      const stages: TypedTurnStages = {
        tier: 'router',
        intentMs,
        routed,
        toolNames: toolCalls,
        dataMs,
        composeMs: routed === 'tool' ? now() - composeStarted : 0,
        modelPasses,
        contextAttached: contextText !== '',
        totalMs: now() - started,
      }
      recordStages(stages)
      if (toolCalls.includes('get_market_snapshot'))
        context = context ?? { at: new Date(now()).toISOString(), scope: 'global' }

      const spoken = deliver(say)
      log(
        `[${tag}] typed → ${toolCalls.join(',') || 'no tool'} → ${state ?? 'answered'} in ${stages.totalMs} ms (${modelPasses} pass${modelPasses === 1 ? '' : 'es'}${contextText ? ', context' : ''})`,
      )
      return {
        say,
        reference: effects.reference,
        lastAsk: effects.lastAsk,
        state,
        toolCalls,
        backendMs: stages.totalMs,
        spoken,
        stages,
        marketContext: withResearch(context, researchContext),
      }
    }
  }

  return runtime
}
