/**
 * JARVIS's ears and voice in the browser: one live session at a time.
 *
 * The browser owns exactly what a browser must — the microphone, the
 * speaker, the WebRTC media track and the data channel — and hands the SDP
 * offer to the product's door, `openLiveSessionFn`. The key, the sideband,
 * every delegation and every institutional word live on the server. What
 * comes back down the data channel is transcript fragments and session
 * events; this class turns them into turns for the presence's one
 * conversation and into a truthful state for the one microphone button.
 *
 * ## Explicit, never always-on
 *
 * A session begins when the person presses the microphone and ends when
 * they press it again, collapse the presence, forget the conversation, or
 * leave the page — `pagehide` closes the peer connection, which the
 * provider reads as a hang-up. The server also closes a session that has
 * heard nothing for a while, and the presence says so.
 *
 * ## Barge-in, the v1 ruling
 *
 * When the person begins speaking while JARVIS is speaking, the speaker is
 * muted in the same animation frame and stays muted until JARVIS begins a
 * new turn after theirs. The model hears everything; the person hears no
 * more of the interrupted sentence.
 *
 * ## What fails leaves JARVIS usable
 *
 * A denied microphone, a refused or unconfigured session, a dropped
 * connection: each becomes a concise Swedish notice and the idle state.
 * The conversation and the typed path are untouched.
 */

import type { DomainReference } from '~/application/analysis/domainSystem'
import {
  closeLiveSessionFn,
  liveSessionStateFn,
  openLiveSessionFn,
  typeIntoLiveSessionFn,
} from '~/infrastructure/jarvis/serverFns'

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'unavailable'

/** What a typed line while live came back with. */
export type TypedReply =
  | {
      ok: true
      say: string
      reference: DomainReference | null
      lastAsk: { question: string; subject: string } | null
      /** A market brief was fetched or attached; handed back with the next line. */
      marketContext: { at: string } | null
    }
  | { ok: false }

export interface VoiceSnapshot {
  status: VoiceStatus
  sessionId: string | null
  /** A concise Swedish sentence when voice is unavailable, or ended by the server's policy. */
  notice: string | null
  seconds: number
  costUsd: number
}

/** What the microphone says for each state, and what pressing it does. */
export const VOICE_STATUS_TEXT: Record<VoiceStatus, string> = {
  idle: 'Röst',
  connecting: 'Ansluter…',
  listening: 'Lyssnar',
  thinking: 'Tänker',
  speaking: 'Talar',
  unavailable: 'Röst otillgänglig',
}

export const VOICE_NOTICE = {
  denied: 'Mikrofonen är blockerad i webbläsaren. Skriv i stället.',
  noMicrophone: 'Ingen mikrofon hittades. Skriv i stället.',
  notConfigured: 'Röst är inte konfigurerad på servern. Skriv i stället.',
  refused: 'Rösttjänsten avböjde just nu. Skriv i stället.',
  unavailable: 'Rösttjänsten svarar inte. Skriv i stället.',
  dropped: 'Röstanslutningen bröts. Skriv i stället.',
  idle: 'Röstsessionen stängdes efter tystnad.',
  capped: 'Röstsessionen nådde sin maxlängd.',
} as const

export interface VoiceFragment {
  who: 'user' | 'jarvis'
  delta: string
  startMs: number
  endMs: number
}

export interface VoiceSessionEvents {
  /** A piece of transcript, as the session clock places it. */
  onFragment(fragment: VoiceFragment): void
  /** The firm bound the conversation to a case through a spoken delegation. */
  onReference(reference: DomainReference, ask: { question: string; subject: string } | null): void
}

const IDLE: VoiceSnapshot = { status: 'idle', sessionId: null, notice: null, seconds: 0, costUsd: 0 }

const VAD_THRESHOLD = 0.02
const VAD_HOLD_MS = 600
const SPEAKING_WINDOW_MS = 900

export class VoiceSession {
  private snapshot: VoiceSnapshot = IDLE
  private readonly listeners = new Set<() => void>()
  private pc: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private stream: MediaStream | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private ticker: ReturnType<typeof setInterval> | null = null
  private closingByUs = false
  private assistantLastFragmentAt = 0
  private delegationPending = false
  private userEndMs: number | null = null
  private mutedForBargeIn = false
  private stopVad: (() => void) | null = null
  private readonly onPageHide = () => this.teardown()

  constructor(
    private readonly events: VoiceSessionEvents,
    private readonly audio: HTMLAudioElement,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): VoiceSnapshot {
    return this.snapshot
  }

  get active(): boolean {
    return this.pc !== null
  }

  private set(change: Partial<VoiceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change }
    for (const listener of this.listeners) listener()
  }

  /* ------------------------------------------------------------- start */

  async start(reference: DomainReference | null): Promise<void> {
    if (this.pc) return
    this.set({ status: 'connecting', notice: null, seconds: 0, costUsd: 0 })
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      const name = (error as { name?: string }).name
      this.set({ status: 'idle', notice: name === 'NotFoundError' ? VOICE_NOTICE.noMicrophone : VOICE_NOTICE.denied })
      return
    }
    const pc = new RTCPeerConnection()
    this.pc = pc
    this.closingByUs = false
    pc.addEventListener('track', (event) => {
      this.audio.srcObject = new MediaStream([event.track])
      void this.audio.play().catch(() => {})
    })
    pc.addEventListener('connectionstatechange', () => {
      if ((pc.connectionState === 'failed' || pc.connectionState === 'disconnected') && !this.closingByUs) {
        this.end(VOICE_NOTICE.dropped)
      }
    })
    for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream)
    this.stopVad = watchMicrophone(this.stream, { onSpeechStart: () => this.onUserSpeechStart() })
    const channel = pc.createDataChannel('oai-events')
    this.channel = channel
    channel.addEventListener('message', (event: MessageEvent) => this.onEvent(JSON.parse(String(event.data)) as Record<string, unknown>))
    channel.addEventListener('close', () => {
      if (this.pc && !this.closingByUs) this.end(VOICE_NOTICE.dropped)
    })
    window.addEventListener('pagehide', this.onPageHide)

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve()
      pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && resolve())
      setTimeout(resolve, 2000)
    })
    const sdp = pc.localDescription?.sdp ?? offer.sdp ?? ''
    const opened = await openLiveSessionFn({ data: { sdp, ...(reference ? { reference } : {}) } })
    if (!opened.ok) {
      this.teardown()
      const notice =
        opened.code === 'NOT_CONFIGURED'
          ? VOICE_NOTICE.notConfigured
          : opened.code === 'PROVIDER_REFUSED'
            ? VOICE_NOTICE.refused
            : VOICE_NOTICE.unavailable
      this.set({ status: 'idle', notice })
      return
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: opened.sdp })
    this.set({ sessionId: opened.sessionId })
    this.poll = setInterval(() => void this.refresh(), 2000)
    this.ticker = setInterval(() => this.tick(), 300)
  }

  /* -------------------------------------------------------------- stop */

  /** The person's own stop, or the presence collapsing: the paid session ends now. */
  async stop(): Promise<void> {
    if (!this.pc) return
    const sessionId = this.snapshot.sessionId
    this.closingByUs = true
    this.teardown()
    this.set({ status: 'idle', notice: null })
    if (sessionId) {
      try {
        await closeLiveSessionFn({ data: { sessionId } })
      } catch {
        /* The peer connection is already closed; the provider ends the session on its own. */
      }
    }
  }

  private end(notice: string | null) {
    this.closingByUs = true
    this.teardown()
    this.set({ status: 'idle', notice })
  }

  private teardown() {
    window.removeEventListener('pagehide', this.onPageHide)
    if (this.poll) clearInterval(this.poll)
    if (this.ticker) clearInterval(this.ticker)
    this.poll = this.ticker = null
    this.stopVad?.()
    this.stopVad = null
    this.channel?.close()
    this.pc?.close()
    if (this.stream) for (const track of this.stream.getTracks()) track.stop()
    this.channel = null
    this.pc = null
    this.stream = null
    this.audio.muted = false
    this.mutedForBargeIn = false
    this.delegationPending = false
    this.userEndMs = null
  }

  /* -------------------------------------------------------------- typed */

  /** Text into the live conversation; the answer comes back spoken, and in the transcript. */
  /**
   * A typed line into the live session: routed by the server through the
   * same backend the voice delegates to, then spoken. What comes back is the
   * answer as text and the case the line may have bound.
   */
  async type(
    text: string,
    history: readonly { by: 'user' | 'jarvis'; text: string }[] = [],
    marketContext: { at: string } | null = null,
  ): Promise<TypedReply> {
    const sessionId = this.snapshot.sessionId
    if (!this.pc || !sessionId) return { ok: false }
    const result = await typeIntoLiveSessionFn({
      data: {
        sessionId,
        text,
        ...(history.length > 0 ? { history: [...history] } : {}),
        ...(marketContext ? { marketContext } : {}),
      },
    })
    if (!result.ok) return { ok: false }
    return { ok: true, say: result.say, reference: result.reference, lastAsk: result.lastAsk, marketContext: result.marketContext }
  }

  /* ------------------------------------------------------------ events */

  private onEvent(event: Record<string, unknown>) {
    switch (event.type) {
      case 'session.started':
        this.set({ status: 'listening' })
        break
      case 'session.input_transcript.delta': {
        const endMs = Number(event.end_ms ?? 0)
        /* Where the person's interrupting turn ends, on the session clock, so the speaker knows when to come back. */
        if (this.mutedForBargeIn) this.userEndMs = endMs
        this.events.onFragment({ who: 'user', delta: String(event.delta ?? ''), startMs: Number(event.start_ms ?? 0), endMs })
        break
      }
      case 'session.output_transcript.delta': {
        const startMs = Number(event.start_ms ?? 0)
        const endMs = Number(event.end_ms ?? 0)
        this.assistantLastFragmentAt = performance.now()
        this.delegationPending = false
        if (this.snapshot.status !== 'speaking') this.set({ status: 'speaking' })
        /* JARVIS's new turn after the person's: the speaker comes back. */
        if (this.mutedForBargeIn && this.userEndMs !== null && startMs >= this.userEndMs - 200) {
          this.audio.muted = false
          this.mutedForBargeIn = false
        }
        this.events.onFragment({ who: 'jarvis', delta: String(event.delta ?? ''), startMs, endMs })
        break
      }
      case 'session.delegation.created':
        this.delegationPending = true
        if (this.snapshot.status === 'listening') this.set({ status: 'thinking' })
        void this.refresh()
        break
      case 'response.event': {
        const inner = event.event as { type?: string } | undefined
        if (inner?.type === 'response.completed') void this.refresh()
        break
      }
      case 'session.closed': {
        const reason = String(event.reason ?? '')
        const byPolicy = /idle|max/.test(reason)
        this.end(byPolicy ? (reason.startsWith('max') ? VOICE_NOTICE.capped : VOICE_NOTICE.idle) : this.closingByUs ? null : VOICE_NOTICE.dropped)
        break
      }
      default:
        break
    }
  }

  private tick() {
    if (!this.pc || this.snapshot.status === 'connecting') return
    const status: VoiceStatus =
      performance.now() - this.assistantLastFragmentAt < SPEAKING_WINDOW_MS ? 'speaking' : this.delegationPending ? 'thinking' : 'listening'
    if (status !== this.snapshot.status) this.set({ status })
  }

  /** The server's view: cost, and the case the firm bound. Never a transcript. */
  private async refresh() {
    const sessionId = this.snapshot.sessionId
    if (!sessionId || !this.pc) return
    try {
      const state = await liveSessionStateFn({ data: { sessionId } })
      if (!state.ok) return
      this.set({ seconds: state.telemetry.voiceSeconds, costUsd: state.telemetry.voiceCostUsd + state.telemetry.backend.costUsd })
      if (state.reference) this.events.onReference(state.reference, state.lastAsk)
      if (state.closed && this.pc) {
        const reason = state.telemetry.reason ?? ''
        this.end(reason.startsWith('idle') ? VOICE_NOTICE.idle : reason.startsWith('max') ? VOICE_NOTICE.capped : null)
      }
    } catch {
      /* The next poll will try again; a missed reading changes nothing the person sees. */
    }
  }

  /* --------------------------------------------------------- barge-in */

  /** The person began while JARVIS was speaking: the speaker goes quiet in this frame. */
  private onUserSpeechStart() {
    if (!this.pc || performance.now() - this.assistantLastFragmentAt >= SPEAKING_WINDOW_MS) return
    this.audio.muted = true
    this.mutedForBargeIn = true
    this.userEndMs = null
  }
}

/**
 * A microphone energy detector, for barge-in only. Nothing is recognised
 * or recorded here; a number crosses a threshold. Absent where the browser
 * has no AudioContext (jsdom), in which case barge-in is simply not cut
 * locally.
 */
function watchMicrophone(
  stream: MediaStream,
  handlers: { onSpeechStart: () => void },
): (() => void) | null {
  if (typeof AudioContext === 'undefined') return null
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const data = new Float32Array(analyser.fftSize)
  let speaking = false
  let lastAbove = 0
  let stopped = false
  const tick = () => {
    if (stopped) return
    analyser.getFloatTimeDomainData(data)
    let sum = 0
    for (const value of data) sum += value * value
    const rms = Math.sqrt(sum / data.length)
    const now = performance.now()
    if (rms > VAD_THRESHOLD) {
      lastAbove = now
      if (!speaking) {
        speaking = true
        handlers.onSpeechStart()
      }
    } else if (speaking && now - lastAbove > VAD_HOLD_MS) {
      speaking = false
    }
    requestAnimationFrame(tick)
  }
  void context.resume().then(tick)
  return () => {
    stopped = true
    void context.close()
  }
}
