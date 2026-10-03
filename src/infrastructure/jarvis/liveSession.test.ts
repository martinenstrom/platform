/**
 * The session runtime, driven by a fake sideband and a fake firm.
 *
 * What is proved: a function call from the backend becomes a host request
 * with no actor in it and comes back as a tool result whose promise of work
 * is true only for `working`; the case reference is remembered from the
 * firm's answer and used for the next status; a spoken promise with no
 * reference is counted; usage becomes cost; an idle session is closed by the
 * server; a session refused by the provider never exists.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostRequest, HostResult } from '~/application/analysis/hostContract'
import type { MarketBrief, MarketScope } from '~/application/jarvis/marketBrief'
import { LIVE_APPEND_MAX_CHARS } from '~/presentation/jarvis/liveSpeech'
import type { JarvisAnswer } from '~/application/jarvis/answer'
import {
  createLiveRuntime,
  type LiveConfig,
  type LiveProvider,
  type LiveSideband,
  type ResponsesRequest,
  type ResponsesResult,
  type WorkspaceInput,
  type WorkspaceResult,
} from './liveSession'

const config: LiveConfig = {
  model: 'gpt-live-1',
  backendModel: 'gpt-5.6-luna',
  voices: ['marin', 'cedar'],
  defaultVoice: 'marin',
  idleSeconds: 30,
  marketContextSeconds: 180,
  maxSeconds: 600,
  prices: {
    voicePerMinuteUsd: 0.05,
    backendInputUsd: 0.2,
    backendCachedUsd: 0.02,
    backendOutputUsd: 1.2,
  },
}

const reference = {
  system: 'financial-os',
  kind: 'case',
  id: 'case-9',
  provenanceId: 'p',
} as const
const activity = {
  stage: 'research' as const,
  desks: [{ id: 'rates', name: 'Rates', isGovernance: false }],
  outstanding: [],
  inFlight: 1,
  expired: 0,
  awaitingAdoption: 0,
  failed: 0,
}
const amendments = { count: 0, latestAt: null, workPredates: false }
const bound = {
  reference,
  question: 'q',
  subject: 's',
  surfaces: { boardroom: '/cases/case-9', record: '/cases/case-9/underlag' },
  activity,
  amendments,
}

/** A sideband the test can speak through. */
function fakeSideband() {
  const sent: Record<string, unknown>[] = []
  let onMessage: (event: Record<string, unknown>) => void = () => {}
  let onClose: () => void = () => {}
  const sideband: LiveSideband & {
    sent: typeof sent
    emit: typeof onMessage
    drop: () => void
  } = {
    send: (event) => sent.push(event),
    onMessage: (handler) => (onMessage = handler),
    onClose: (handler) => (onClose = handler),
    close: () => {},
    sent,
    emit: (event) => onMessage(event),
    drop: () => onClose(),
  }
  return sideband
}

function functionCall(name: string, args: Record<string, unknown>, callId = 'call-1') {
  return {
    type: 'response.event',
    delegation_id: 'd-1',
    event: {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: callId,
        name,
        arguments: JSON.stringify(args),
      },
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A market brief with one index in it, as the market dependency answers. */
const brief = (scope: MarketScope): MarketBrief => ({
  scope,
  generatedAt: '2026-09-16T14:00:00.000Z',
  indices: [
    {
      symbol: 'idx:sp500',
      name: 'S&P 500',
      observedAt: '2026-09-16T13:59:40.000Z',
      source: 'Yahoo',
      quality: 'delayed',
      session: 'open',
      freshness: 'current',
      delivery: 'fresh',
      level: 6512.3,
      changePercent: 0.42,
      changeAbsolute: 27.1,
      changePeriod: 'intraday',
    },
  ],
  sectors: [],
  rates: [],
  curveSlopeBasisPoints: null,
  fx: [],
  commodities: [],
  riskAppetite: null,
  headlines: [],
  unavailable: ['riskaptit'],
  notServed: ['Dow Jones'],
})

/** A Responses result: a function call, or a spoken answer. */
const functionCallResult = (
  name: string,
  args: Record<string, unknown>,
  callId = 'fc-1',
): ResponsesResult => ({
  id: `resp-${callId}`,
  output: [
    {
      type: 'function_call',
      id: `fc_${callId}`,
      call_id: callId,
      name,
      arguments: JSON.stringify(args),
    },
  ],
  usage: {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 20,
  },
})
const textResult = (text: string): ResponsesResult => ({
  id: 'resp-text',
  output: [
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
  ],
  usage: {
    input_tokens: 200,
    input_tokens_details: { cached_tokens: 100 },
    output_tokens: 40,
  },
})

describe('a live session', () => {
  let sideband: ReturnType<typeof fakeSideband>
  let provider: LiveProvider & {
    sessions: Record<string, unknown>[]
    responses: ResponsesRequest[]
  }
  let asked: HostRequest[]
  let answer: (request: HostRequest) => HostResult
  let marketAsked: MarketScope[]
  let respondWith: (request: ResponsesRequest) => ResponsesResult
  /* What the runtime sent, without the market and workspace context it hands the voice on its own. */
  const tool = () =>
    sideband.sent.filter(
      (e) =>
        !(
          e.type === 'session.instructions.append' &&
          (String(e.event_id).startsWith('market_') ||
            String(e.event_id).startsWith('workspace_'))
        ),
    )

  beforeEach(() => {
    /* The watchdog's interval and the clock are faked; setTimeout stays real so `flush` can yield. */
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    sideband = fakeSideband()
    provider = {
      sessions: [],
      responses: [],
      createSession: vi.fn(async ({ session, sdp }) => {
        provider.sessions.push(session)
        return { id: 'live-1', sdp: `answer-for-${sdp}` }
      }),
      attach: vi.fn(async () => sideband),
      respond: vi.fn(async (request) => {
        provider.responses.push(request)
        return respondWith(request)
      }),
    }
    asked = []
    answer = () => ({ ...bound, state: 'working' })
    marketAsked = []
    respondWith = () => textResult('Svar.')
  })
  afterEach(() => vi.useRealTimers())

  const runtime = () =>
    createLiveRuntime({
      provider,
      host: async (request) => {
        asked.push(request)
        return answer(request)
      },
      market: async (scope) => {
        marketAsked.push(scope)
        return brief(scope)
      },
      config,
      requestId: () => 'req-1',
    })

  it('opens with the browser’s offer and the configured session, and a voice it knows', async () => {
    const rt = runtime()
    const opened = await rt.open({ sdp: 'offer', voice: 'cedar' })
    expect(opened).toEqual({
      sessionId: 'live-1',
      sdp: 'answer-for-offer',
      simulated: false,
    })
    const session = provider.sessions[0] as Record<string, unknown>
    expect(session.model).toBe('gpt-live-1')
    expect((session.audio as { output: { voice: string } }).output.voice).toBe('cedar')
    const delegation = session.delegation as {
      type: string
      responses: { model: string; tools: { name: string }[] }
    }
    expect(delegation.type).toBe('responses')
    expect(delegation.responses.model).toBe('gpt-5.6-luna')
    expect(delegation.responses.tools.map((t) => t.name)).toContain(
      'delegate_to_financial_os',
    )
    /* An unknown voice falls back rather than reaching the provider. */
    await rt.open({ sdp: 'offer2', voice: 'not-a-voice' })
    expect(
      (provider.sessions[1] as { audio: { output: { voice: string } } }).audio.output
        .voice,
    ).toBe('marin')
  })

  it('executes a delegation through the host as an ask with no actor, and relays the firm’s promise only when work exists', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    sideband.emit(
      functionCall('delegate_to_financial_os', {
        question: 'Borde jag minska Hållbar Energi?',
        subject: 'Hållbar Energi',
        actorEmployeeId: 'cio',
      }),
    )
    await flush()

    expect(asked).toEqual([
      {
        kind: 'ask',
        requestId: 'req-1',
        question: 'Borde jag minska Hållbar Energi?',
        subject: 'Hållbar Energi',
      },
    ])
    const [output, cont] = tool()
    expect(output?.type).toBe('response.item.create')
    const item = output?.item as { type: string; call_id: string; output: string }
    expect(item.call_id).toBe('call-1')
    const parsed = JSON.parse(item.output)
    expect(parsed.state).toBe('working')
    expect(parsed.acknowledgeWork).toBe(true)
    expect(parsed.say).toContain('Jag kollar på det och återkommer.')
    expect(cont?.type).toBe('response.create')
    expect(rt.state('live-1')?.reference).toEqual(reference)
    expect(rt.state('live-1')?.lastAsk).toEqual({
      question: 'Borde jag minska Hållbar Energi?',
      subject: 'Hållbar Energi',
    })
  })

  it('never promises work for a case that needs the person, is blocked, or failed', async () => {
    for (const result of [
      {
        ...bound,
        state: 'needs-decision',
        decision: { reason: 'institutional-initialization-required' },
      },
      {
        ...bound,
        state: 'blocked',
        block: { reason: 'synthesis-required', owner: null },
      },
      { state: 'failed', reason: 'operator-unresolved', code: 'NOT_CONFIGURED' },
    ] as HostResult[]) {
      sideband = fakeSideband()
      answer = () => result
      const rt = runtime()
      await rt.open({ sdp: 'offer' })
      sideband.emit(
        functionCall('delegate_to_financial_os', { question: 'q', subject: 's' }),
      )
      await flush()
      const parsed = JSON.parse((tool()[0]?.item as { output: string }).output)
      expect(parsed.acknowledgeWork, result.state).toBe(false)
      expect(parsed.say, result.state).not.toMatch(/återkommer/)
    }
  })

  it('opens already bound to the conversation’s case, so a spoken follow-up reads it', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer', reference })
    answer = () => ({
      ...bound,
      state: 'blocked',
      block: { reason: 'verification-required', owner: null },
    })
    sideband.emit(functionCall('check_delegation', {}, 'c1'))
    await flush()
    expect(asked).toEqual([{ kind: 'status', reference }])
    expect(rt.state('live-1')?.lastAsk).toBeNull()
  })

  it('reads the objection behind a block itself, and says it in the objector’s words', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer', reference })
    const advocate = {
      id: 'devils-advocate',
      name: "Devil's Advocate",
      isGovernance: true,
    }
    const objection = {
      reviewId: 'review-da',
      byDepartmentId: 'devils-advocate',
      raisedAs: 'devils-advocate' as const,
      superseded: false,
      revisionId: null,
      challengeId: 'challenge-1',
      contests: 'claim-1',
      argument: 'Realräntorna föll först efter att guldet steg.',
      materiality: 'material' as const,
      outcome: 'open' as const,
      counterEvidenceCount: 0,
    }
    answer = (request) => ({
      ...bound,
      state: 'blocked',
      block: { reason: 'objections-unresolved', owner: advocate },
      ...(request.kind === 'inspect'
        ? { inspection: { view: 'objections' as const, objections: [objection] } }
        : {}),
    })
    sideband.emit(functionCall('check_delegation', {}, 'c1'))
    await flush()
    /* One status read, then the objections behind it — the model asked for neither twice. */
    expect(asked).toEqual([
      { kind: 'status', reference },
      { kind: 'inspect', reference, view: { kind: 'objections' } },
    ])
    const outputs = tool().filter(
      (event) =>
        typeof (event as { item?: { output?: unknown } }).item?.output === 'string',
    )
    const said = JSON.parse((outputs.at(-1)!.item as { output: string }).output)
    expect(said.state).toBe('blocked')
    expect(said.say).toContain(
      "Devil's Advocate invänder: Realräntorna föll först efter att guldet steg.",
    )
  })

  it('remembers the case the firm bound, reads its status with it, and adds to it in the person’s words', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    sideband.emit(
      functionCall('delegate_to_financial_os', { question: 'q', subject: 's' }, 'c1'),
    )
    await flush()
    answer = () => ({
      ...bound,
      state: 'blocked',
      block: { reason: 'verification-required', owner: null },
    })
    sideband.emit(functionCall('check_delegation', {}, 'c2'))
    await flush()
    expect(asked[1]).toEqual({ kind: 'status', reference })
    answer = () => ({
      ...bound,
      state: 'blocked',
      block: { reason: 'verification-required', owner: null },
      amendments: { count: 1, latestAt: '2026-09-16T08:00:00.000Z', workPredates: true },
    })
    sideband.emit(
      functionCall(
        'add_to_delegation',
        { note: ' ta hänsyn till dollarn ', actorEmployeeId: 'cio' },
        'c3',
      ),
    )
    await flush()
    expect(asked[2]).toEqual({
      kind: 'amend',
      reference,
      requestId: 'req-1',
      text: 'ta hänsyn till dollarn',
    })
    const added = JSON.parse((tool()[4]?.item as { output: string }).output)
    expect(added.state).toBe('blocked')
    expect(added.say).toBe(
      'Tillagt i ärendet. Det arbete som redan gjorts tar inte hänsyn till det.',
    )
    expect(added.acknowledgeWork).toBe(false)
  })

  it('closes the bound case on instruction, and confirms it only from what the firm read back', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer', reference })
    answer = () => ({
      ...bound,
      state: 'closed',
      closure: {
        kind: 'abandoned',
        reason: 'På användarens begäran i samtalet.',
        at: '2026-09-16T08:00:00.000Z',
        byDesk: null,
      },
    })
    sideband.emit(functionCall('close_case', {}, 'c1'))
    await flush()
    expect(asked).toEqual([
      { kind: 'close', reference, reason: 'På användarens begäran i samtalet.' },
    ])
    const closed = JSON.parse((tool()[0]?.item as { output: string }).output)
    expect(closed.state).toBe('closed')
    expect(closed.say).toBe(
      'Ärendet är stängt. Lades ner innan något arbete gjorts — På användarens begäran i samtalet.',
    )
    expect(closed.acknowledgeWork).toBe(false)
    expect(closed.decisionRequired).toBe(false)
  })

  it('lets neither act reach the firm while no case is bound', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    sideband.emit(functionCall('close_case', { reason: 'x' }, 'c1'))
    await flush()
    sideband.emit(functionCall('add_to_delegation', { note: 'x' }, 'c2'))
    await flush()
    expect(asked).toEqual([])
    for (const index of [0, 2]) {
      const out = JSON.parse((tool()[index]?.item as { output: string }).output)
      expect(out.state).toBe('unsupported')
      expect(out.say).toContain('inget pågående ärende')
      expect(out.acknowledgeWork).toBe(false)
    }
  })

  it('keeps where the time went per turn, in milliseconds and never in words', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    sideband.emit({ type: 'session.started', session: { id: 'live-1' } })
    sideband.emit({
      type: 'session.input_transcript.delta',
      delta: 'Hur ser du på Nvidia?',
      start_ms: 6000,
      end_ms: 8000,
    })
    sideband.emit({
      type: 'session.delegation.created',
      delegation: { id: 'd-1' },
      offset_ms: 7800,
    })
    sideband.emit({
      type: 'response.event',
      delegation_id: 'd-1',
      event: { type: 'response.created' },
    })
    sideband.emit(
      functionCall(
        'delegate_to_financial_os',
        { question: 'Hur ser du på Nvidia?', subject: 'Nvidia' },
        'c1',
      ),
    )
    await flush()
    sideband.emit({
      type: 'session.output_transcript.delta',
      delta: 'Ett ögonblick.',
      start_ms: 8200,
      end_ms: 8900,
    })
    sideband.emit({
      type: 'session.output_transcript.delta',
      delta: 'Jag kollar på det och återkommer.',
      start_ms: 11000,
      end_ms: 12500,
    })
    /* Two whole bridging sentences are not useful, nor a stray syllable; the firm's answer is. */
    sideband.emit({
      type: 'session.output_transcript.delta',
      delta: 'sep.,',
      start_ms: 12500,
      end_ms: 12580,
    })
    sideband.emit({
      type: 'session.output_transcript.delta',
      delta: 'Firman har tagit frågan.',
      start_ms: 12600,
      end_ms: 13200,
    })
    sideband.emit({
      type: 'response.event',
      delegation_id: 'd-1',
      event: { type: 'response.completed', response: {} },
    })
    /* The person speaking again opens the next turn's timing. */
    sideband.emit({
      type: 'session.input_transcript.delta',
      delta: 'Okej.',
      start_ms: 14000,
      end_ms: 14400,
    })
    sideband.emit({
      type: 'session.output_transcript.delta',
      delta: 'Bra.',
      start_ms: 14600,
      end_ms: 14900,
    })
    /* A typed line is a turn too. */
    respondWith = () => textResult('Noterat.')
    await rt.respond({ text: 'Ta hänsyn till dollarn också.', sessionId: 'live-1' })

    const turns = rt.state('live-1')!.telemetry.turns
    expect(turns).toHaveLength(3)
    expect(turns[0]).toMatchObject({
      userEndMs: 8000,
      delegationMs: 7800,
      firstSpeechMs: 8200,
      firstUsefulSpeechMs: 12600,
      speechStartsMs: [8200, 11000],
      typed: false,
    })
    expect(turns[0]!.backendStartMs).not.toBeNull()
    expect(turns[0]!.backendEndMs).not.toBeNull()
    expect(turns[0]!.hostCallMs).not.toBeNull()
    expect(turns[0]!.hostDurationMs).not.toBeNull()
    expect(turns[1]).toMatchObject({
      userEndMs: 14400,
      delegationMs: null,
      firstSpeechMs: 14600,
      speechStartsMs: [14600],
      typed: false,
    })
    expect(turns[2]).toMatchObject({
      typed: true,
      firstSpeechMs: null,
      speechStartsMs: [],
    })
    expect(JSON.stringify(turns)).not.toMatch(/Nvidia|dollarn|ögonblick|återkommer/)
  })

  it('counts a spoken promise of work while the firm has none', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    sideband.emit({
      type: 'session.output_transcript.delta',
      delta: 'Jag kollar på det ',
      start_ms: 100,
      end_ms: 400,
    })
    sideband.emit({
      type: 'session.output_transcript.delta',
      delta: 'och återkommer.',
      start_ms: 400,
      end_ms: 800,
    })
    expect(rt.state('live-1')?.telemetry.ackWithoutReference).toBe(1)
    /* After the firm reports work, the same sentence is a truthful relay. */
    sideband.emit(
      functionCall('delegate_to_financial_os', { question: 'q', subject: 's' }),
    )
    await flush()
    sideband.emit({
      type: 'session.output_transcript.delta',
      delta: 'Jag kollar på det och återkommer.',
      start_ms: 900,
      end_ms: 1200,
    })
    expect(rt.state('live-1')?.telemetry.ackWithoutReference).toBe(1)
  })

  it('turns usage into money, separately for the voice and the backend', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    sideband.emit({ type: 'session.usage.updated', usage: { seconds: 120 } })
    sideband.emit({
      type: 'response.event',
      event: {
        type: 'response.completed',
        response: {
          usage: {
            input_tokens: 10_000,
            input_tokens_details: { cached_tokens: 4_000 },
            output_tokens: 1_000,
          },
        },
      },
    })
    const t = rt.state('live-1')!.telemetry
    expect(t.voiceSeconds).toBe(120)
    expect(t.voiceCostUsd).toBeCloseTo(0.1, 6)
    expect(t.backend).toEqual({
      responses: 1,
      inputTokens: 6_000,
      cachedTokens: 4_000,
      outputTokens: 1_000,
      costUsd: (6_000 * 0.2 + 4_000 * 0.02 + 1_000 * 1.2) / 1_000_000,
    })
  })

  it('closes a session the person walked away from, and says why', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    sideband.emit({
      type: 'session.input_transcript.delta',
      delta: 'hej',
      start_ms: 0,
      end_ms: 500,
    })
    vi.advanceTimersByTime(29_000)
    expect(tool().some((e) => e.type === 'session.close')).toBe(false)
    vi.advanceTimersByTime(2_000)
    expect(tool().some((e) => e.type === 'session.close')).toBe(true)
    sideband.emit({
      type: 'session.closed',
      reason: 'client_requested',
      usage: { seconds: 31 },
    })
    const state = rt.state('live-1')!
    expect(state.closed).toBe(true)
    expect(state.telemetry.closedByPolicy).toBe(true)
    expect(state.telemetry.reason).toMatch(/^idle 3\d s$/)
    expect(state.telemetry.voiceSeconds).toBe(31)
  })

  it('answers a market question from the market, and the firm is never asked', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    sideband.emit(functionCall('get_market_snapshot', { scope: 'us' }, 'm1'))
    await flush()
    /* 'global' is the context handed to the voice at open and after the read; the tool itself asked for 'us'. */
    expect(marketAsked.filter((scope) => scope === 'us')).toEqual(['us'])
    expect(asked).toEqual([])
    const out = JSON.parse((tool()[0]?.item as { output: string }).output)
    expect(out.state).toBe('market-snapshot')
    expect(out.acknowledgeWork).toBe(false)
    expect(out.brief.indices[0].name).toBe('S&P 500')
    expect(out.brief.unavailable).toEqual(['riskaptit'])
    /* Nothing was bound: the market is not a case. */
    expect(rt.state('live-1')?.reference).toBeNull()
    expect(rt.state('live-1')?.telemetry.toolCallsByName).toEqual({
      get_market_snapshot: 1,
    })
  })

  it('says the market is unavailable rather than guessing when the sources fail', async () => {
    const failing = createLiveRuntime({
      provider,
      host: async () => ({ state: 'failed', reason: 'service-unavailable' }),
      market: async () => {
        throw new Error('all providers down')
      },
      config,
      requestId: () => 'req-1',
    })
    await failing.open({ sdp: 'offer' })
    sideband.emit(functionCall('get_market_snapshot', { scope: 'us' }, 'm1'))
    await flush()
    const out = JSON.parse((tool()[0]?.item as { output: string }).output)
    expect(out.state).toBe('market-unavailable')
    expect(out.say).toContain('inte åt färska marknadsdata')
    expect(out.acknowledgeWork).toBe(false)
  })

  it('answers a typed line through the backend and the same tools, with nothing kept at the provider', async () => {
    const rt = runtime()
    let round = 0
    respondWith = () =>
      round++ === 0
        ? functionCallResult('get_market_snapshot', { scope: 'us' })
        : textResult('S&P 500 är upp 0,4 procent.')
    /* A line that names no market word: no brief is attached, so the tool is offered and the router reaches for it. */
    const result = await rt.respond({ text: 'Hur ser det ut där borta just nu?' })
    expect(result.say).toBe('S&P 500 är upp 0,4 procent.')
    expect(result.toolCalls).toEqual(['get_market_snapshot'])
    expect(result.state).toBe('market-snapshot')
    expect(result.reference).toBeNull()
    expect(result.spoken).toBe(false)
    expect(marketAsked).toEqual(['us'])
    expect(result.stages.contextAttached).toBe(false)
    expect(asked).toEqual([])
    /* Two calls: the second carries the call and its output back, in the request. */
    expect(provider.responses).toHaveLength(2)
    const second = provider.responses[1]!
    expect(
      second.input.map(
        (item) =>
          (item as { type?: string; role?: string }).type ??
          (item as { role: string }).role,
      ),
    ).toEqual(['user', 'function_call', 'function_call_output'])
    expect(second.instructions).toContain('Kanalen är text')
    expect(second.tools.map((tool) => (tool as { name: string }).name)).toContain(
      'get_market_snapshot',
    )
    const t = rt.typedTelemetry()
    expect(t.turns).toBe(1)
    expect(t.responses).toBe(2)
    expect(t.toolCallsByName).toEqual({ get_market_snapshot: 1 })
    expect(t.costUsd).toBeGreaterThan(0)
  })

  it('binds a typed delegation to the case the firm opened, with no actor in the request', async () => {
    const rt = runtime()
    let round = 0
    respondWith = () =>
      round++ === 0
        ? functionCallResult('delegate_to_financial_os', {
            question: 'Borde jag minska USA?',
            subject: 'USA',
            actorEmployeeId: 'cio',
          })
        : textResult('Kommittén behöver din utgångstes.')
    answer = () => ({
      ...bound,
      state: 'needs-decision',
      decision: { reason: 'institutional-initialization-required' },
    })
    const result = await rt.respond({ text: 'Borde jag minska min USA-exponering?' })
    expect(asked).toEqual([
      {
        kind: 'ask',
        requestId: 'req-1',
        question: 'Borde jag minska USA?',
        subject: 'USA',
      },
    ])
    expect(result.reference).toEqual(reference)
    expect(result.lastAsk).toEqual({ question: 'Borde jag minska USA?', subject: 'USA' })
    expect(result.state).toBe('needs-decision')
    expect(result.say).toBe('Kommittén behöver din utgångstes.')
  })

  describe('the person speaks human; JARVIS translates (ruled 2026-09-17)', () => {
    /* The firm's own question decides what the person's later words are; here it is a capital question. */
    const usa = {
      ...bound,
      question: 'Borde jag minska min USA-exponering?',
      subject: 'USA-exponering',
    }
    const awaiting: HostResult = {
      ...usa,
      state: 'needs-decision',
      decision: { reason: 'institutional-initialization-required' },
    }
    const macro = { id: 'global-macro', name: 'Global Macro', isGovernance: false }
    const started: HostResult = {
      ...usa,
      state: 'working',
      commission: {
        evidence: {
          family: 'us-par-curve',
          from: '2026-08-18',
          to: '2026-09-17',
          observations: 220,
        },
        started: [macro],
        adopted: [],
        filed: [],
        withheld: [],
      },
    }
    /** The firm as it behaves: convened and waiting, then started on the opening. */
    const firm = (request: HostRequest): HostResult =>
      request.kind === 'begin' ? started : awaiting
    const toolOutputs = (index: number): string =>
      JSON.stringify(
        provider.responses[index]!.input.filter(
          (item) => (item as { type?: string }).type === 'function_call_output',
        ),
      )

    it('opens an explanation on the person’s words at once — no thesis, no scope, no second question', async () => {
      const rt = runtime()
      let round = 0
      const line = 'Kolla med kommittén och be dem ta reda på varför guld är upp idag.'
      respondWith = () =>
        round++ === 0
          ? functionCallResult('delegate_to_financial_os', {
              question: line,
              subject: 'Guld',
            })
          : textResult('Absolut, jag tar det vidare.')
      answer = firm
      const result = await rt.respond({ text: line })
      expect(asked.map((request) => request.kind)).toEqual(['ask', 'begin'])
      expect(asked[1]).toMatchObject({
        kind: 'begin',
        reference,
        opening: {
          kind: 'explanation',
          focus: ['makro', 'flöden', 'specifika händelser'],
        },
      })
      expect(result.state).toBe('working')
      expect(result.reference).toEqual(reference)
      /* What the model was handed to say: the work, the desk, the basis — and none of the ceremony. */
      const said = toolOutputs(1)
      expect(said).toContain('Absolut. Jag ber dem ta reda på vad som driver')
      expect(said).toContain('makro, flöden, specifika händelser')
      expect(said).toContain(
        'Global Macro har börjat, med den amerikanska räntekurvan som underlag.',
      )
      expect(said).toContain('Jag återkommer när det är klart.')
      for (const word of ['utgångstes', 'omfattning', 'godkännande', 'formell'])
        expect(said.toLowerCase()).not.toContain(word)
      expect(rt.typedTelemetry().responses).toBe(2)
    })

    it('keeps the focus the person named in the same breath', async () => {
      const rt = runtime()
      let round = 0
      const line =
        'Be kommittén ta reda på varför guld är upp idag, framför allt flödena och dollarn.'
      respondWith = () =>
        round++ === 0
          ? functionCallResult('delegate_to_financial_os', {
              question: line,
              subject: 'Guld',
            })
          : textResult('Absolut.')
      answer = firm
      await rt.respond({ text: line })
      expect(asked[1]).toMatchObject({
        opening: { kind: 'explanation', focus: ['flöden', 'dollarn'] },
      })
    })

    it('asks the one human question for a capital question, and begins on any reasonable answer', async () => {
      const rt = runtime()
      let round = 0
      respondWith = () =>
        round++ === 0
          ? functionCallResult('delegate_to_financial_os', {
              question: 'Borde jag minska min USA-exponering?',
              subject: 'USA-exponering',
            })
          : textResult(
              'Vill du att de utgår från din egen syn, eller prövar frågan öppet?',
            )
      answer = firm
      const first = await rt.respond({ text: 'Borde jag minska min USA-exponering?' })
      expect(asked.map((request) => request.kind)).toEqual(['ask'])
      expect(first.state).toBe('needs-decision')
      expect(toolOutputs(1)).toContain('En sak innan de sätter igång.')
      expect(toolOutputs(1)).toContain('din egen syn')
      expect(toolOutputs(1).toLowerCase()).not.toContain('utgångstes')

      /* "Pröva den öppet." — the answer, through begin_delegation, on the bound case. */
      round = 0
      respondWith = () =>
        round++ === 0
          ? functionCallResult('begin_delegation', { view: 'Pröva den öppet.' })
          : textResult('Perfekt, jag kör på det.')
      const second = await rt.respond({ text: 'Pröva den öppet.', reference })
      expect(asked.slice(1).map((request) => request.kind)).toEqual(['status', 'begin'])
      expect(asked[2]).toMatchObject({
        kind: 'begin',
        opening: { kind: 'position', focus: [], view: null },
      })
      expect(second.state).toBe('working')
    })

    it('takes words added to a case that still awaits its opening as the opening — the loop cannot happen', async () => {
      const rt = runtime()
      let round = 0
      respondWith = () =>
        round++ === 0
          ? functionCallResult('add_to_delegation', {
              note: 'Jag är negativ till USA, värderingen är huvudskälet.',
            })
          : textResult('Absolut, jag tar det vidare.')
      answer = firm
      const result = await rt.respond({
        text: 'Jag är negativ till USA, värderingen är huvudskälet.',
        reference,
      })
      expect(asked.map((request) => request.kind)).toEqual(['amend', 'begin'])
      expect(asked[1]).toMatchObject({
        kind: 'begin',
        opening: {
          kind: 'position',
          focus: ['värdering'],
          view: {
            statement: 'Jag är negativ till USA, värderingen är huvudskälet.',
            position: 'reduce',
          },
        },
      })
      expect(result.state).toBe('working')
    })

    it('reads a bare confirmation as leave to examine openly, and a focus as focus', async () => {
      const rt = runtime()
      for (const [note, opening] of [
        ['De kan börja.', { kind: 'position', focus: [], view: null }],
        ['Kör.', { kind: 'position', focus: [], view: null }],
        [
          'Makro, flöden och specifika händelser.',
          {
            kind: 'position',
            focus: ['makro', 'flöden', 'specifika händelser'],
            view: null,
          },
        ],
      ] as const) {
        asked.length = 0
        let round = 0
        respondWith = () =>
          round++ === 0
            ? functionCallResult('add_to_delegation', { note })
            : textResult('Absolut.')
        answer = firm
        await rt.respond({ text: note, reference })
        expect(
          asked.map((request) => request.kind),
          note,
        ).toEqual(['amend', 'begin'])
        expect(asked[1], note).toMatchObject({ kind: 'begin', opening })
      }
    })

    it('never lets a focus or a confirmation open a second case while one is bound, whatever tool the model chose', async () => {
      const rt = runtime()
      answer = (request) =>
        request.kind === 'amend'
          ? {
              ...started,
              amendments: {
                count: 1,
                latestAt: '2026-09-17T19:14:30.000Z',
                workPredates: true,
              },
            }
          : started
      for (const line of ['Makro, flöden och specifika händelser.', 'De kan börja.']) {
        asked.length = 0
        let round = 0
        respondWith = () =>
          round++ === 0
            ? functionCallResult('delegate_to_financial_os', {
                question: line,
                subject: 'Guld',
              })
            : textResult('Tillagt.')
        await rt.respond({ text: line, reference })
        expect(
          asked.map((request) => request.kind),
          line,
        ).toEqual(['amend'])
        expect(asked[0], line).toMatchObject({ kind: 'amend', reference, text: line })
      }
      /* A new question while a case is bound is still a new question. */
      asked.length = 0
      let round = 0
      respondWith = () =>
        round++ === 0
          ? functionCallResult('delegate_to_financial_os', {
              question: 'Borde jag köpa silver?',
              subject: 'Silver',
            })
          : textResult('Svar.')
      await rt.respond({ text: 'Borde jag köpa silver?', reference })
      expect(asked.map((request) => request.kind)).toEqual(['ask'])
    })

    it('keeps what the person says once the firm is under way, and drops only a bare confirmation', async () => {
      const rt = runtime()
      answer = (request) =>
        request.kind === 'amend'
          ? {
              ...started,
              amendments: {
                count: 1,
                latestAt: '2026-09-17T19:14:30.000Z',
                workPredates: true,
              },
            }
          : started
      let round = 0
      respondWith = () =>
        round++ === 0
          ? functionCallResult('begin_delegation', {
              view: 'Makro, flöden och specifika händelser.',
            })
          : textResult('Tillagt.')
      await rt.respond({ text: 'Makro, flöden och specifika händelser.', reference })
      expect(asked.map((request) => request.kind)).toEqual(['status', 'amend'])
      expect(asked[1]).toMatchObject({
        kind: 'amend',
        text: 'Makro, flöden och specifika händelser.',
      })
      asked.length = 0
      round = 0
      respondWith = () =>
        round++ === 0
          ? functionCallResult('begin_delegation', { view: 'Kör.' })
          : textResult('De är igång.')
      await rt.respond({ text: 'Kör.', reference })
      expect(asked.map((request) => request.kind)).toEqual(['status'])
    })

    it('takes a typed focus line as an addition even when the model asks the firm a rephrased question', async () => {
      const rt = runtime()
      answer = (request) =>
        request.kind === 'amend'
          ? {
              ...started,
              amendments: {
                count: 1,
                latestAt: '2026-09-18T17:46:30.000Z',
                workPredates: true,
              },
            }
          : started
      let round = 0
      respondWith = () =>
        round++ === 0
          ? functionCallResult('delegate_to_financial_os', {
              question: 'Ta reda på varför guld är upp idag.',
              subject: 'Guld',
            })
          : textResult('Tillagt.')
      await rt.respond({ text: 'Makro, flöden och specifika händelser.', reference })
      /* Measured 2026-09-18: the model rephrased the person's focus into the case's question. The person's own line decides. */
      expect(asked.map((request) => request.kind)).toEqual(['amend'])
      expect(asked[0]).toMatchObject({
        kind: 'amend',
        reference,
        text: 'Makro, flöden och specifika händelser.',
      })
    })

    it('tells the truth when no desk could start, and promises no return', async () => {
      const rt = runtime()
      let round = 0
      const line = 'Kolla med kommittén varför oljan faller idag.'
      respondWith = () =>
        round++ === 0
          ? functionCallResult('delegate_to_financial_os', {
              question: line,
              subject: 'Olja',
            })
          : textResult('Jag har lagt frågan hos dem.')
      answer = (request) =>
        request.kind === 'begin'
          ? {
              ...bound,
              state: 'blocked',
              block: { reason: 'analysis-required', owner: macro },
              commission: {
                evidence: null,
                started: [],
                adopted: [],
                filed: [],
                withheld: [{ desk: null, reason: 'no-evidence-basis' }],
              },
            }
          : awaiting
      const result = await rt.respond({ text: line })
      expect(asked.map((request) => request.kind)).toEqual(['ask', 'begin'])
      expect(result.state).toBe('blocked')
      const said = toolOutputs(1)
      expect(said).toContain(
        'Men borden kan inte börja än — firman har inget registrerat underlag för den här sortens fråga än.',
      )
      expect(said).not.toContain('återkommer')
      expect(JSON.parse(JSON.parse(toolOutputs(1))[0].output).acknowledgeWork).toBe(false)
    })
  })

  it('carries the bound case into a typed follow-up, and tells the backend the channel is text', async () => {
    const rt = runtime()
    respondWith = () => textResult('Ärendet väntar på ditt beslut.')
    await rt.respond({ text: 'Var står det?', reference })
    expect(provider.responses[0]!.instructions).toContain('bundet till ett ärende')
    expect(provider.responses[0]!.input[0]).toEqual({
      role: 'user',
      content: 'Var står det?',
    })
    /* The subject hint travels as a hint, on the line itself. */
    await rt.respond({ text: 'Är Nvidia köpvärd?', subject: 'Nvidia' })
    expect(provider.responses[1]!.input[0]).toEqual({
      role: 'user',
      content: 'Är Nvidia köpvärd?\n(Ämne: Nvidia)',
    })
    /* Earlier turns travel as the messages they were, so "varför?" is about something. */
    await rt.respond({
      text: 'Varför?',
      history: [
        { by: 'user', text: 'Hur går börsen?' },
        { by: 'jarvis', text: 'S&P 500 är upp 0,4 procent.' },
      ],
    })
    expect(provider.responses[2]!.input).toEqual([
      { role: 'user', content: 'Hur går börsen?' },
      { role: 'assistant', content: 'S&P 500 är upp 0,4 procent.' },
      { role: 'user', content: 'Varför?' },
    ])
  })

  it('speaks a typed line’s routed answer in the live session, and never hands the question to the voice', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    sideband.emit({ type: 'session.started', session: { id: 'live-1' } })
    respondWith = () => textResult('S&P 500 är upp 0,4 procent.')
    const result = await rt.respond({ text: 'Hur går börsen?', sessionId: 'live-1' })
    expect(result.spoken).toBe(true)
    const appended = tool().find((e) => e.type === 'session.instructions.append') as {
      content: string
      delegation_id: null
    }
    expect(appended.content).toContain('«S&P 500 är upp 0,4 procent.»')
    expect(appended.content).toContain('Svara inte på frågan själv.')
    expect(appended.delegation_id).toBeNull()
    const state = rt.state('live-1')!
    expect(state.telemetry.typedInjections).toBe(1)
    expect(state.telemetry.backend.responses).toBe(1)
    expect(state.telemetry.turns[0]).toMatchObject({ typed: true, delegationMs: null })
    /* The session's own effects carry: a delegation typed while live binds the session. */
    let round = 0
    respondWith = () =>
      round++ === 0
        ? functionCallResult('delegate_to_financial_os', { question: 'q', subject: 's' })
        : textResult('Klart.')
    answer = () => ({
      ...bound,
      state: 'needs-decision',
      decision: { reason: 'institutional-initialization-required' },
    })
    await rt.respond({ text: 'Ska jag sälja Nvidia?', sessionId: 'live-1' })
    expect(rt.state('live-1')?.reference).toEqual(reference)
    /* Once the session is closed, the line is still answered, as text alone. */
    sideband.drop()
    respondWith = () => textResult('Text.')
    const after = await rt.respond({ text: 'igen', sessionId: 'live-1' })
    expect(after.say).toBe('Text.')
    expect(after.spoken).toBe(false)
  })

  it('answers a named instrument’s state in Tier 0: no model, the platform’s number with its time and source', async () => {
    const rt = runtime()
    const result = await rt.respond({ text: 'Hur gick S&P 500 idag?' })
    expect(provider.responses).toHaveLength(0)
    expect(marketAsked).toEqual(['us'])
    expect(result.say).toBe(
      'S&P 500 ligger på 6 512 just nu, upp 0,42 procent idag (fördröjd data från Yahoo, kl. 15:59).',
    )
    expect(result.state).toBe('market-retrieval')
    expect(result.stages).toMatchObject({
      tier: 0,
      routed: 'retrieval',
      modelPasses: 0,
      contextAttached: false,
    })
    expect(result.stages.dataMs).not.toBeNull()
    /* The pointer carries the subject and the period on, so "och Nasdaq?" and "och i veckan?" have something to be about. */
    expect(result.marketContext).toEqual({
      at: '2026-09-16T14:00:00.000Z',
      scope: 'us',
      conversation: { symbols: ['idx:sp500'], region: null, period: { kind: 'today' } },
    })
    expect(result.spokenSay).toBe('S&P 500 är upp 0,42 procent idag.')
    expect(rt.typedTelemetry().stages).toHaveLength(1)
    expect(rt.typedTelemetry().responses).toBe(0)
  })

  it('routes a judgement about a named instrument to the router, never to the formatter', async () => {
    const rt = runtime()
    let round = 0
    respondWith = () =>
      round++ === 0
        ? functionCallResult('delegate_to_financial_os', {
            question: 'Ska jag köpa guld?',
            subject: 'guld',
          })
        : textResult('Kommittén behöver din utgångstes.')
    answer = () => ({
      ...bound,
      state: 'needs-decision',
      decision: { reason: 'institutional-initialization-required' },
    })
    const result = await rt.respond({ text: 'Ska jag köpa guld?' })
    expect(result.stages).toMatchObject({
      tier: 'router',
      routed: 'tool',
      modelPasses: 2,
    })
    expect(asked).toHaveLength(1)
    expect(result.reference).toEqual(reference)
  })

  it('attaches a fresh brief as context to a market question the router owns, so it answers over the numbers', async () => {
    const rt = runtime()
    respondWith = () => textResult('S&P 500 föll 0,45 procent; tech höll emot.')
    /* A driver is the router's: the market path answers what happened, never why. */
    const result = await rt.respond({ text: 'Vad driver amerikanska börsen idag?' })
    expect(marketAsked).toEqual(['global'])
    expect(provider.responses[0]!.instructions).toContain('MARKNADSLÄGE hämtat')
    expect(provider.responses[0]!.instructions).toContain('S&P 500')
    expect(provider.responses[0]!.instructions).toContain('drivkraft är inte verifierad')
    /* With the global brief attached, the snapshot tool has nothing to add and is not offered; the firm's tools are. */
    const offered = provider.responses[0]!.tools.map(
      (tool) => (tool as { name: string }).name,
    )
    expect(offered).not.toContain('get_market_snapshot')
    expect(offered).toContain('delegate_to_financial_os')
    expect(result.stages).toMatchObject({
      tier: 'router',
      routed: 'answer',
      modelPasses: 1,
      contextAttached: true,
    })
    expect(result.marketContext).toEqual({
      at: '2026-09-16T14:00:00.000Z',
      scope: 'global',
    })
    /* A follow-up carrying the pointer gets the numbers again, fresh; a line about nothing market-like gets none. */
    await rt.respond({
      text: 'Varför?',
      marketContext: { at: '2026-09-16T14:00:00.000Z' },
    })
    expect(provider.responses[1]!.instructions).toContain('MARKNADSLÄGE hämtat')
    await rt.respond({ text: 'Vad är term premium?' })
    expect(provider.responses[2]!.instructions).not.toContain('MARKNADSLÄGE hämtat')
    expect(
      provider.responses[2]!.tools.map((tool) => (tool as { name: string }).name),
    ).toContain('get_market_snapshot')
    expect(marketAsked).toEqual(['global', 'global'])
  })

  it('hands the voice fresh numbers at open, after a read, and again when the window passes', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    await flush()
    const contexts = () =>
      sideband.sent.filter(
        (e) =>
          e.type === 'session.instructions.append' &&
          String(e.event_id).startsWith('market_'),
      )
    expect(contexts()).toHaveLength(1)
    expect(String(contexts()[0]!.content)).toContain('MARKNADSLÄGE hämtat')
    expect(String(contexts()[0]!.content)).toContain(
      'S&P 500 6 512 upp 0,42 % (öppet, Yahoo 15:59)',
    )
    expect(String(contexts()[0]!.content)).toContain('Gäller 3 min')
    /* The provider refuses an append above 500 tokens; the brief is held under that by construction. */
    expect(String(contexts()[0]!.content).length).toBeLessThanOrEqual(
      LIVE_APPEND_MAX_CHARS,
    )
    sideband.emit(functionCall('get_market_snapshot', { scope: 'us' }, 'm1'))
    await flush()
    await flush()
    expect(contexts()).toHaveLength(2)
    /* The window passes while the person keeps talking (under the idle policy): fresh numbers again, once. */
    for (let step = 1; step <= 8; step++) {
      vi.advanceTimersByTime(25_000)
      sideband.emit({
        type: 'session.input_transcript.delta',
        delta: 'hej',
        start_ms: step * 25_000,
        end_ms: step * 25_000 + 500,
      })
    }
    await flush()
    expect(contexts()).toHaveLength(3)
  })

  it('counts a refused market-context append by name, so a silent voice is visible in telemetry', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    await flush()
    sideband.emit({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        code: 'invalid_value',
        message: 'Context append text must not exceed 500 tokens.',
        param: 'content',
        client_event_id: 'market_1',
      },
    })
    sideband.emit({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        code: 'invalid_value',
        message: 'other',
        client_event_id: 'say_1',
      },
    })
    const counts = rt.state('live-1')?.telemetry.eventCounts ?? {}
    expect(counts.error).toBe(2)
    expect(counts['error.market_context']).toBe(1)
  })

  describe('the fast path, as a product principle (ruled 2026-09-17)', () => {
    /*
     * A simple market fact goes structured fresh data → deterministic
     * formatting → answer. Never simple fact → general model → tools →
     * general model → answer. A richer JARVIS must not become a slower one;
     * these lines hold the chain: no case, no model, a provenanced value,
     * an honest absence, and the router for everything that is not a fact.
     */
    const RETRIEVALS = [
      'Hur gick S&P 500 idag?',
      'Vad gör tioåringen?',
      'Hur går Nasdaq?',
      'Hur går tech?',
      'Vad gör dollarn?',
    ]

    it('answers every simple retrieval with no model pass, no institutional case, and a provenanced value or an honest absence', async () => {
      const rt = runtime()
      for (const text of RETRIEVALS) {
        const result = await rt.respond({ text })
        expect(result.stages, text).toMatchObject({
          tier: 0,
          routed: 'retrieval',
          modelPasses: 0,
          contextAttached: false,
        })
        expect(result.reference, text).toBeNull()
        expect(result.say, text).toMatch(
          /\(fördröjd data från Yahoo, kl\. 15:59\)|saknas i datan just nu/,
        )
      }
      expect(provider.responses).toHaveLength(0)
      expect(asked).toHaveLength(0)
      expect(rt.typedTelemetry().responses).toBe(0)
    })

    it('says a stale number as the latest available, never as now', async () => {
      const us = brief('us')
      const stale: MarketBrief = {
        ...us,
        indices: [{ ...us.indices[0]!, freshness: 'stale' }],
      }
      const rt = createLiveRuntime({
        provider,
        host: async (request) => {
          asked.push(request)
          return answer(request)
        },
        market: async () => stale,
        config,
        requestId: () => 'req-1',
      })
      const result = await rt.respond({ text: 'Hur gick S&P 500 idag?' })
      expect(result.say).toBe(
        'Senaste tillgängliga noteringen för S&P 500 är från kl. 15:59 (Yahoo): 6 512, upp 0,42 procent.',
      )
      expect(result.say).not.toContain('just nu')
      expect(result.stages.modelPasses).toBe(0)
      expect(provider.responses).toHaveLength(0)
    })

    it('never lets a judgement, a why, a meaning, a case act or a broad synthesis take the fast path — the planted violations', async () => {
      const rt = runtime()
      respondWith = () => textResult('Svar.')
      const violations = [
        'Borde jag köpa S&P 500?',
        'Varför faller tioåringen?',
        'Vad betyder högre tioårsränta för tech?',
        'Lägg till att tioåringen oroar mig i ärendet.',
        'Vad driver amerikanska börsen idag?',
      ]
      for (const text of violations) {
        const result = await rt.respond({ text })
        expect(result.stages.tier, text).toBe('router')
      }
      expect(provider.responses).toHaveLength(violations.length)
    })
  })

  it('does not exist when the provider refuses', async () => {
    provider.createSession = vi.fn(async () => {
      throw new Error('429 insufficient_quota')
    })
    const rt = runtime()
    await expect(rt.open({ sdp: 'offer' })).rejects.toThrow('insufficient_quota')
    expect(rt.telemetry()).toEqual([])
  })

  /* ----------------------------------------------- the workspace: one brain */

  describe('the workspace on screen', () => {
    const answerFor = (text: string, clientId: string): JarvisAnswer => ({
      scope: 'CLIENT',
      intent: 'KEY_FIGURES',
      about: {
        kind: 'client',
        id: clientId,
        label: clientId === 'cl-dahlqvist' ? 'Anna & Per Dahlqvist' : 'Henrik Alvarsson',
        href: `/clients/${clientId}`,
        switched: false,
      },
      sections: [
        {
          key: 'figures',
          items: [{ kind: 'record-text', text, nature: 'fact', sourceIds: [] }],
        },
      ],
      sources: [],
      actions: [],
      titles: {},
      today: '2026-09-23',
      confidence: 'high',
      method: 'advisory-rules-v1',
      askedAt: '2026-09-23T10:00:00.000Z',
      ...(text.includes('pack')
        ? { opens: `/clients/${clientId}/meeting-pack?depth=full&format=both` }
        : {}),
    })
    let workspaceCalls: WorkspaceInput[]
    let workspaceAnswers: (input: WorkspaceInput) => WorkspaceResult | null
    const workspaceRuntime = (simulated = false) =>
      createLiveRuntime({
        provider,
        host: async (request) => {
          asked.push(request)
          return answer(request)
        },
        market: async (scope) => {
          marketAsked.push(scope)
          return brief(scope)
        },
        workspace: async (input) => {
          workspaceCalls.push(input)
          return workspaceAnswers(input)
        },
        workspaceLabel: async (route) =>
          route?.includes('cl-dahlqvist')
            ? 'Anna & Per Dahlqvist'
            : route?.includes('cl-alvarsson')
              ? 'Henrik Alvarsson'
              : null,
        simulated,
        config,
        requestId: () => 'req-1',
      })
    const clientOf = (route: string | null) =>
      route?.includes('cl-alvarsson') ? 'cl-alvarsson' : 'cl-dahlqvist'
    const outputs = () =>
      tool()
        .filter(
          (event) =>
            typeof (event as { item?: { output?: unknown } }).item?.output === 'string',
        )
        .map(
          (event) =>
            JSON.parse((event.item as { output: string }).output) as Record<
              string,
              unknown
            >,
        )
    const workspaceAppends = () =>
      sideband.sent.filter(
        (e) =>
          e.type === 'session.instructions.append' &&
          String(e.event_id).startsWith('workspace_'),
      )

    beforeEach(() => {
      workspaceCalls = []
      workspaceAnswers = (input) => {
        const text = `svar om ${input.text}`
        return {
          answer: answerFor(text, clientOf(input.route)),
          spoken: {
            say: `${text}.`,
            sentences: [`${text}.`],
            covered: 1,
            remaining: 0,
            method: 'spoken-answer-v1',
          },
        }
      }
    })

    it('answers a spoken workspace question through the one router with the session’s route, tells the voice where the advisor is, and lists the answer for the browser', async () => {
      const rt = workspaceRuntime()
      await rt.open({ sdp: 'offer', route: '/clients/cl-dahlqvist' })
      await flush()
      expect(workspaceAppends()).toHaveLength(1)
      expect(String(workspaceAppends()[0]!.content)).toContain('Anna & Per Dahlqvist')
      sideband.emit(
        functionCall(
          'answer_from_workspace',
          { question: 'Vad har de i totalförmögenhet?', clientId: 'cl-someone-else' },
          'w1',
        ),
      )
      await flush()
      /* The route is the session's; nothing the model put beside the question reaches the record. */
      expect(workspaceCalls).toEqual([
        {
          text: 'Vad har de i totalförmögenhet?',
          route: '/clients/cl-dahlqvist',
          previous: null,
          marketConversation: null,
        },
      ])
      const [out] = outputs()
      expect(out).toMatchObject({
        state: 'workspace-answer',
        say: 'svar om Vad har de i totalförmögenhet?.',
        acknowledgeWork: false,
        decisionRequired: false,
      })
      expect(asked).toEqual([])
      const state = rt.state('live-1')!
      expect(state.route).toBe('/clients/cl-dahlqvist')
      expect(state.advisory).toHaveLength(1)
      expect(state.advisory[0]).toMatchObject({
        seq: 1,
        text: 'Vad har de i totalförmögenhet?',
        say: 'svar om Vad har de i totalförmögenhet?.',
        typed: false,
        opens: null,
      })
      expect(state.advisory[0]!.answer?.about.id).toBe('cl-dahlqvist')
    })

    it('lets a route change win: the next question is about the new screen, with no earlier answer to continue', async () => {
      const rt = workspaceRuntime()
      await rt.open({ sdp: 'offer', route: '/clients/cl-dahlqvist' })
      sideband.emit(
        functionCall(
          'answer_from_workspace',
          { question: 'Vad har de i totalförmögenhet?' },
          'w1',
        ),
      )
      await flush()
      sideband.emit(
        functionCall('answer_from_workspace', { question: 'Och hos oss?' }, 'w2'),
      )
      await flush()
      /* The second question continues the first: the earlier answer travels with it. */
      expect(workspaceCalls[1]?.previous?.about.id).toBe('cl-dahlqvist')
      const moved = rt.setContext('live-1', '/clients/cl-alvarsson')
      expect(moved?.route).toBe('/clients/cl-alvarsson')
      await flush()
      expect(workspaceAppends().length).toBe(2)
      expect(String(workspaceAppends()[1]!.content)).toContain('Henrik Alvarsson')
      sideband.emit(
        functionCall(
          'answer_from_workspace',
          { question: 'Vad är viktigast just nu?' },
          'w3',
        ),
      )
      await flush()
      expect(workspaceCalls[2]).toEqual({
        text: 'Vad är viktigast just nu?',
        route: '/clients/cl-alvarsson',
        previous: null,
        marketConversation: null,
      })
      expect(rt.state('live-1')!.advisory.at(-1)!.answer?.about.id).toBe('cl-alvarsson')
      /* The same route again is no change: nothing re-sent, the continuation kept. */
      rt.setContext('live-1', '/clients/cl-alvarsson')
      await flush()
      expect(workspaceAppends().length).toBe(2)
    })

    it('asks again for an empty line, and hands the model what is not the record’s', async () => {
      const rt = workspaceRuntime()
      await rt.open({ sdp: 'offer', route: '/clients/cl-dahlqvist' })
      sideband.emit(functionCall('answer_from_workspace', { question: '  ' }, 'w1'))
      await flush()
      expect(outputs()[0]).toMatchObject({
        state: 'workspace-unclear',
        say: 'Jag uppfattade inte det. Kan du säga det igen?',
      })
      expect(workspaceCalls).toEqual([])
      workspaceAnswers = () => null
      sideband.emit(
        functionCall('answer_from_workspace', { question: 'Vad är term premium?' }, 'w2'),
      )
      await flush()
      expect(outputs()[1]).toMatchObject({
        state: 'workspace-unanswered',
        acknowledgeWork: false,
      })
      expect(outputs()[1]).not.toHaveProperty('say')
      expect(rt.state('live-1')!.advisory).toHaveLength(0)
    })

    it('carries the door a pack answer opens, so the browser can open the preview', async () => {
      const rt = workspaceRuntime()
      await rt.open({ sdp: 'offer', route: '/clients/cl-dahlqvist/meeting-prep' })
      sideband.emit(
        functionCall('answer_from_workspace', { question: 'Prepare full pack' }, 'w1'),
      )
      await flush()
      expect(rt.state('live-1')!.advisory[0]!.opens).toBe(
        '/clients/cl-dahlqvist/meeting-pack?depth=full&format=both',
      )
    })

    it('speaks a typed line’s record answer in the session and remembers it for a spoken continuation', async () => {
      const rt = workspaceRuntime()
      await rt.open({ sdp: 'offer', route: '/clients/cl-dahlqvist' })
      const previous = answerFor('skrivet', 'cl-dahlqvist')
      expect(
        rt.speak('live-1', 'Vad har de i totalförmögenhet?', '42 miljoner.', previous),
      ).toBe(true)
      const append = tool().find(
        (e) =>
          e.type === 'session.instructions.append' &&
          String(e.event_id).startsWith('typed_'),
      )
      expect(String(append?.content)).toContain('«42 miljoner.»')
      expect(String(append?.content)).toContain('ordagrant')
      expect(rt.state('live-1')!.advisory).toHaveLength(0)
      sideband.emit(
        functionCall('answer_from_workspace', { question: 'Ta resten också' }, 'w1'),
      )
      await flush()
      expect(workspaceCalls[0]?.previous).toEqual(previous)
    })

    it('answers a spoken market question through the workspace tool from the platform, remembers the subject, and never lets the voice model answer it', async () => {
      const rt = workspaceRuntime()
      await rt.open({ sdp: 'offer', route: '/' })
      await flush()
      sideband.emit(
        functionCall(
          'answer_from_workspace',
          { question: 'Hur gick S&P 500 idag?' },
          'm1',
        ),
      )
      await flush()
      expect(outputs().at(-1)).toMatchObject({
        state: 'workspace-answer',
        say: 'S&P 500 är upp 0,42 procent idag.',
        acknowledgeWork: false,
        decisionRequired: false,
      })
      /* The record was never asked: the market answered. */
      expect(workspaceCalls).toEqual([])
      expect(rt.state('live-1')!.advisory.at(-1)).toMatchObject({
        text: 'Hur gick S&P 500 idag?',
        say: 'S&P 500 är upp 0,42 procent idag.',
        answer: null,
      })
      /* "Och i veckan?" is S&P 500 over the week: no series is bound, so the week is honestly missing and today is today's. */
      sideband.emit(
        functionCall('answer_from_workspace', { question: 'Och i veckan?' }, 'm2'),
      )
      await flush()
      expect(outputs().at(-1)?.say).toBe(
        'Jag har dagens S&P 500-data, men inte en komplett veckoserie i den här datakällan. Idag S&P 500 är upp 0,42 procent.',
      )
      /* A record question on the market page is still the record's. */
      sideband.emit(
        functionCall(
          'answer_from_workspace',
          { question: 'Vad har de i totalförmögenhet?' },
          'm3',
        ),
      )
      await flush()
      expect(workspaceCalls).toHaveLength(1)
      expect(workspaceCalls[0]).toMatchObject({
        text: 'Vad har de i totalförmögenhet?',
        marketConversation: {
          symbols: ['idx:sp500'],
          region: null,
          period: { kind: 'range', range: '1w' },
        },
      })
    })

    it('hears the market in a simulated session — a region, a period, the follow-ups — and never answers in the platform’s own words', async () => {
      const rt = workspaceRuntime(true)
      workspaceAnswers = () => null
      await rt.open({ sdp: 'simulated', route: '/' })
      const forbidden = /modellens väg|rösten är simulerad|registret/i
      const week = await rt.hear('live-1', 'Hur gick amerikanska börsen i veckan?')
      expect(week?.say).not.toMatch(forbidden)
      expect(week?.say).toBe(
        'Jag har dagens S&P 500-data, men inte en komplett veckoserie i den här datakällan. Nasdaq 100 saknas i datan just nu. Idag S&P 500 är upp 0,42 procent.',
      )
      const sp = await rt.hear('live-1', 'Hur gick sp500?')
      expect(sp?.say).toBe('S&P 500 är upp 0,42 procent idag.')
      const nasdaq = await rt.hear('live-1', 'Och Nasdaq?')
      expect(nasdaq?.say).toBe(
        'Nasdaq 100 saknas i datan just nu — källan svarar inte, och jag vill inte gissa.',
      )
      const weekly = await rt.hear('live-1', 'Och i veckan?')
      expect(weekly?.say).toBe(
        'Nasdaq 100 saknas i datan just nu, och jag har ingen veckoserie i den här datakällan.',
      )
      const rates = await rt.hear('live-1', 'Vad hände med räntorna?')
      expect(rates?.say).toBe('Räntorna saknas i datan just nu; jag vill inte gissa.')
      /* Five market lines, no model pass, every one listed for the browser. */
      expect(provider.responses).toHaveLength(0)
      expect(rt.state('live-1')!.advisory.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
      for (const entry of rt.state('live-1')!.advisory)
        expect(entry.say).not.toMatch(forbidden)
    })

    it('hears a simulated line: the record first, then the market fast path and the model, each listed once', async () => {
      const rt = workspaceRuntime(true)
      const opened = await rt.open({ sdp: 'simulated', route: '/clients/cl-dahlqvist' })
      expect(opened.simulated).toBe(true)
      const heard = await rt.hear('live-1', 'Vad har de i totalförmögenhet?')
      expect(heard).toMatchObject({
        seq: 1,
        say: 'svar om Vad har de i totalförmögenhet?.',
        typed: false,
      })
      expect(heard?.answer?.intent).toBe('KEY_FIGURES')
      workspaceAnswers = () => null
      const market = await rt.hear('live-1', 'Hur gick S&P 500 idag?')
      expect(market?.answer).toBeNull()
      expect(market?.say).toContain('S&P 500')
      /* The global brief at open, then the scope the line asked for. */
      expect(marketAsked).toEqual(['global', 'us'])
      respondWith = () => textResult('Term premium är …')
      const model = await rt.hear('live-1', 'Vad är term premium?')
      expect(model?.say).toBe('Term premium är …')
      expect(provider.responses).toHaveLength(1)
      expect(rt.state('live-1')!.advisory.map((e) => e.seq)).toEqual([1, 2, 3])
      const blank = await rt.hear('live-1', '…')
      expect(blank?.say).toBe('Jag uppfattade inte det. Kan du säga det igen?')
      expect(rt.state('live-1')!.simulated).toBe(true)
    })
  })
})
