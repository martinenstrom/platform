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
import { createLiveRuntime, type LiveConfig, type LiveProvider, type LiveSideband } from './liveSession'

const config: LiveConfig = {
  model: 'gpt-live-1',
  backendModel: 'gpt-5.6-luna',
  voices: ['marin', 'cedar'],
  defaultVoice: 'marin',
  idleSeconds: 30,
  maxSeconds: 600,
  prices: { voicePerMinuteUsd: 0.05, backendInputUsd: 0.2, backendCachedUsd: 0.02, backendOutputUsd: 1.2 },
}

const reference = { system: 'financial-os', kind: 'case', id: 'case-9', provenanceId: 'p' } as const
const activity = { stage: 'research' as const, desks: [{ id: 'rates', name: 'Rates', isGovernance: false }], outstanding: [], inFlight: 1, expired: 0, awaitingAdoption: 0 }
const bound = { reference, question: 'q', subject: 's', surfaces: { boardroom: '/cases/case-9', record: '/cases/case-9/underlag' }, activity }

/** A sideband the test can speak through. */
function fakeSideband() {
  const sent: Record<string, unknown>[] = []
  let onMessage: (event: Record<string, unknown>) => void = () => {}
  let onClose: () => void = () => {}
  const sideband: LiveSideband & { sent: typeof sent; emit: typeof onMessage; drop: () => void } = {
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
    event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: callId, name, arguments: JSON.stringify(args) } },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('a live session', () => {
  let sideband: ReturnType<typeof fakeSideband>
  let provider: LiveProvider & { sessions: Record<string, unknown>[] }
  let asked: HostRequest[]
  let answer: (request: HostRequest) => HostResult

  beforeEach(() => {
    /* The watchdog's interval and the clock are faked; setTimeout stays real so `flush` can yield. */
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    sideband = fakeSideband()
    provider = {
      sessions: [],
      createSession: vi.fn(async ({ session, sdp }) => {
        provider.sessions.push(session)
        return { id: 'live-1', sdp: `answer-for-${sdp}` }
      }),
      attach: vi.fn(async () => sideband),
    }
    asked = []
    answer = () => ({ ...bound, state: 'working' })
  })
  afterEach(() => vi.useRealTimers())

  const runtime = () =>
    createLiveRuntime({
      provider,
      host: async (request) => {
        asked.push(request)
        return answer(request)
      },
      config,
      requestId: () => 'req-1',
    })

  it('opens with the browser’s offer and the configured session, and a voice it knows', async () => {
    const rt = runtime()
    const opened = await rt.open({ sdp: 'offer', voice: 'cedar' })
    expect(opened).toEqual({ sessionId: 'live-1', sdp: 'answer-for-offer' })
    const session = provider.sessions[0] as Record<string, unknown>
    expect(session.model).toBe('gpt-live-1')
    expect((session.audio as { output: { voice: string } }).output.voice).toBe('cedar')
    const delegation = session.delegation as { type: string; responses: { model: string; tools: { name: string }[] } }
    expect(delegation.type).toBe('responses')
    expect(delegation.responses.model).toBe('gpt-5.6-luna')
    expect(delegation.responses.tools.map((t) => t.name)).toContain('delegate_to_financial_os')
    /* An unknown voice falls back rather than reaching the provider. */
    await rt.open({ sdp: 'offer2', voice: 'not-a-voice' })
    expect((provider.sessions[1] as { audio: { output: { voice: string } } }).audio.output.voice).toBe('marin')
  })

  it('executes a delegation through the host as an ask with no actor, and relays the firm’s promise only when work exists', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    sideband.emit(functionCall('delegate_to_financial_os', { question: 'Borde jag minska Hållbar Energi?', subject: 'Hållbar Energi', actorEmployeeId: 'cio' }))
    await flush()

    expect(asked).toEqual([{ kind: 'ask', requestId: 'req-1', question: 'Borde jag minska Hållbar Energi?', subject: 'Hållbar Energi' }])
    const [output, cont] = sideband.sent
    expect(output?.type).toBe('response.item.create')
    const item = output?.item as { type: string; call_id: string; output: string }
    expect(item.call_id).toBe('call-1')
    const parsed = JSON.parse(item.output)
    expect(parsed.state).toBe('working')
    expect(parsed.acknowledgeWork).toBe(true)
    expect(parsed.say).toContain('Jag kollar på det och återkommer.')
    expect(cont?.type).toBe('response.create')
    expect(rt.state('live-1')?.reference).toEqual(reference)
  })

  it('never promises work for a case that needs the person, is blocked, or failed', async () => {
    for (const result of [
      { ...bound, state: 'needs-decision', decision: { reason: 'institutional-initialization-required' } },
      { ...bound, state: 'blocked', block: { reason: 'synthesis-required', owner: null } },
      { state: 'failed', reason: 'operator-unresolved', code: 'NOT_CONFIGURED' },
    ] as HostResult[]) {
      sideband = fakeSideband()
      answer = () => result
      const rt = runtime()
      await rt.open({ sdp: 'offer' })
      sideband.emit(functionCall('delegate_to_financial_os', { question: 'q', subject: 's' }))
      await flush()
      const parsed = JSON.parse((sideband.sent[0]?.item as { output: string }).output)
      expect(parsed.acknowledgeWork, result.state).toBe(false)
      expect(parsed.say, result.state).not.toMatch(/återkommer/)
    }
  })

  it('remembers the case the firm bound and reads its status with it; a note has no door and says so', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    sideband.emit(functionCall('delegate_to_financial_os', { question: 'q', subject: 's' }, 'c1'))
    await flush()
    answer = () => ({ ...bound, state: 'blocked', block: { reason: 'verification-required', owner: null } })
    sideband.emit(functionCall('check_delegation', {}, 'c2'))
    await flush()
    expect(asked[1]).toEqual({ kind: 'status', reference })
    sideband.emit(functionCall('add_to_delegation', { note: 'ta hänsyn till dollarn' }, 'c3'))
    await flush()
    expect(asked).toHaveLength(2)
    const note = JSON.parse((sideband.sent[4]?.item as { output: string }).output)
    expect(note.state).toBe('unsupported')
    expect(note.say).toContain('inte att lägga till i ärendet ännu')
  })

  it('counts a spoken promise of work while the firm has none', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    sideband.emit({ type: 'session.output_transcript.delta', delta: 'Jag kollar på det ', start_ms: 100, end_ms: 400 })
    sideband.emit({ type: 'session.output_transcript.delta', delta: 'och återkommer.', start_ms: 400, end_ms: 800 })
    expect(rt.state('live-1')?.telemetry.ackWithoutReference).toBe(1)
    /* After the firm reports work, the same sentence is a truthful relay. */
    sideband.emit(functionCall('delegate_to_financial_os', { question: 'q', subject: 's' }))
    await flush()
    sideband.emit({ type: 'session.output_transcript.delta', delta: 'Jag kollar på det och återkommer.', start_ms: 900, end_ms: 1200 })
    expect(rt.state('live-1')?.telemetry.ackWithoutReference).toBe(1)
  })

  it('turns usage into money, separately for the voice and the backend', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    sideband.emit({ type: 'session.usage.updated', usage: { seconds: 120 } })
    sideband.emit({ type: 'response.event', event: { type: 'response.completed', response: { usage: { input_tokens: 10_000, input_tokens_details: { cached_tokens: 4_000 }, output_tokens: 1_000 } } } })
    const t = rt.state('live-1')!.telemetry
    expect(t.voiceSeconds).toBe(120)
    expect(t.voiceCostUsd).toBeCloseTo(0.1, 6)
    expect(t.backend).toEqual({ responses: 1, inputTokens: 6_000, cachedTokens: 4_000, outputTokens: 1_000, costUsd: (6_000 * 0.2 + 4_000 * 0.02 + 1_000 * 1.2) / 1_000_000 })
  })

  it('closes a session the person walked away from, and says why', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    sideband.emit({ type: 'session.input_transcript.delta', delta: 'hej', start_ms: 0, end_ms: 500 })
    vi.advanceTimersByTime(29_000)
    expect(sideband.sent.some((e) => e.type === 'session.close')).toBe(false)
    vi.advanceTimersByTime(2_000)
    expect(sideband.sent.some((e) => e.type === 'session.close')).toBe(true)
    sideband.emit({ type: 'session.closed', reason: 'client_requested', usage: { seconds: 31 } })
    const state = rt.state('live-1')!
    expect(state.closed).toBe(true)
    expect(state.telemetry.closedByPolicy).toBe(true)
    expect(state.telemetry.reason).toMatch(/^idle 3\d s$/)
    expect(state.telemetry.voiceSeconds).toBe(31)
  })

  it('types into the session as trusted text, and refuses once closed', async () => {
    const rt = runtime()
    await rt.open({ sdp: 'offer' })
    expect(rt.type('live-1', 'Vad är term premium?')).toBe(true)
    const appended = sideband.sent.find((e) => e.type === 'session.instructions.append') as { content: string; delegation_id: null }
    expect(appended.content).toContain('Vad är term premium?')
    expect(appended.delegation_id).toBeNull()
    sideband.drop()
    expect(rt.type('live-1', 'igen')).toBe(false)
    expect(rt.state('live-1')?.telemetry.reason).toBe('transport-closed')
  })

  it('does not exist when the provider refuses', async () => {
    provider.createSession = vi.fn(async () => {
      throw new Error('429 insufficient_quota')
    })
    const rt = runtime()
    await expect(rt.open({ sdp: 'offer' })).rejects.toThrow('insufficient_quota')
    expect(rt.telemetry()).toEqual([])
  })
})
