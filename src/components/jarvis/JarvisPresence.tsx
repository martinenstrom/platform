/**
 * JARVIS, present beside the person in HQ.
 *
 * Mounted once, from the root route, in the space the left navigation used to
 * take. At rest it is a narrow strip: a mark, a state, the Financial OS rail
 * beneath them — the product's five destinations, Klienter one click from the
 * market — and a microphone that says plainly it does not listen yet.
 * Engaged, it expands inward into a conversation, a product state, and the
 * doors to the firm's deeper surfaces — and collapses again. The HQ behind
 * it is untouched.
 *
 * ## It talks to one thing
 *
 * `financialOsHostFn`, and nothing lower. It sees six product states and the
 * typed projections the host contract carries; it never sees a command, a run,
 * a candidate or a playbook entry. `JarvisPresence.test.tsx` scans this
 * directory's imports to keep it that way.
 *
 * ## It remembers a pointer, not the truth
 *
 * The conversation and the Financial OS reference it is bound to live in
 * `sessionStorage` (`presenceStore`). Every question about the case is asked
 * of the firm again; nothing the firm said is cached as an answer.
 *
 * ## The firm's state, JARVIS's words
 *
 * Financial OS returns `working`, `answer-ready`, `blocked`, `needs-decision`,
 * `unsupported` or `failed`. The sentences are `presentation/jarvis`'s, and the
 * three the person must never confuse — work, no way forward, your decision —
 * are three different sentences.
 *
 * ## The deeper surfaces open beside it
 *
 * "Visa hur ni kom fram till det" and "Visa underlaget" open the Boardroom and
 * the record as contextual surfaces over the page, to the right of the
 * conversation (`ContextualSurface`). They are the canonical pages, not
 * copies; the routes stay where they were; closing the surface leaves the HQ
 * beneath exactly as it was. Which surface is open is remembered with the
 * conversation, and collapsing the presence closes it.
 *
 * ## It listens, when asked
 *
 * The microphone is the one visible here, and pressing it opens a live voice
 * session through the product's door — `openLiveSessionFn`, GPT-Live over
 * WebRTC, the server's sideband, the same host gateway as a typed question
 * (`voiceSession.ts`). What is said, by either side, lands in this same
 * conversation; a typed line while the session is live goes into the
 * session and is answered aloud. Pressing the microphone again, collapsing
 * the presence, or forgetting the conversation ends the paid session.
 * Voice is never on until asked, and never a second conversation.
 *
 * ## What it does not do yet
 *
 * It does not route. Every question typed without a live session goes to
 * the firm, because the layer that decides whether a question needs the
 * firm at all is later work; with a live session, the voice backend makes
 * that call inside the tool boundary. Neither is the router.
 */

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { ChevronLeft, Mic, Send, Sparkles } from 'lucide-react'
import { cn } from '~/lib/cn'
import { toneText } from '~/lib/tone'
import { shortcutNav } from '~/lib/navigation'
/* The Financial OS rail stands in the strip: the product's spine, beside JARVIS's mark. */
import { GlobalRail, GlobalRailUtilities } from '~/components/layout/GlobalRail'
import {
  financialOsHostFn,
  getCurrentOperatorFn,
} from '~/infrastructure/analysis/serverFns'
import type { HostRequest, HostResult } from '~/application/analysis/hostContract'
import { resolveJarvisContext, type JarvisContext } from '~/application/jarvis/context'
/* The typed door: one line through the same router the voice delegates to. */
import {
  askJarvisFn,
  liveVoiceModeFn,
  type MarketContextPointer,
} from '~/infrastructure/jarvis/serverFns'
import type { JarvisAnswer } from '~/application/jarvis/answer'
import { answerHeadline } from '~/presentation/jarvis/advisoryAnswerText'
import {
  composePlaceholder,
  contextChip,
  contextLabel,
  contextNamesOf,
  emptyHint,
  jarvisKnows,
  quickActions,
  type ContextNames,
  type KnownFact,
} from '~/presentation/jarvis/contextText'
import {
  amendmentLine,
  answerLines,
  inspectionLines,
  phrase,
} from '~/presentation/jarvis/hostStateText'
import { ContextualSurface, SURFACE_TEXT } from './ContextualSurface'
import { JarvisAnswerView } from './JarvisAnswerView'
import {
  resetPresence,
  updatePresence,
  usePresence,
  type ContextualSurface as SurfaceKind,
  type PresenceState,
  type PresenceTurn,
} from './presenceStore'
import {
  VoiceSession,
  VOICE_STATUS_TEXT,
  type VoiceFragment,
  type VoiceSnapshot,
} from './voiceSession'

const IDLE_VOICE: VoiceSnapshot = {
  status: 'idle',
  sessionId: null,
  notice: null,
  seconds: 0,
  costUsd: 0,
  simulated: false,
}
const voiceActive = (voice: VoiceSnapshot) =>
  voice.status !== 'idle' && voice.status !== 'unavailable'

/** The strip's width at rest; `AppLayout` reserves the same on every shell route. */
export const PRESENCE_STRIP_WIDTH = 'w-16'

const turn = (
  by: PresenceTurn['by'],
  text: string,
  over: Partial<PresenceTurn> = {},
): PresenceTurn => ({
  id: crypto.randomUUID(),
  at: new Date().toISOString(),
  by,
  text,
  ...over,
})

/** The dot beside the mark: what JARVIS is doing, at a glance. */
type Mood = 'dormant' | 'thinking' | 'working' | 'ready' | 'attention'

const MOOD_CLASS: Record<Mood, string> = {
  dormant: 'bg-content-subtle',
  thinking: 'bg-accent animate-pulse',
  working: 'bg-accent',
  ready: 'bg-positive',
  attention: 'bg-warning',
}

function moodOf(busy: boolean, last: PresenceTurn | undefined): Mood {
  if (busy) return 'thinking'
  switch (last?.state) {
    case 'working':
      return 'working'
    case 'answer-ready':
      return 'ready'
    case 'blocked':
    case 'needs-decision':
    case 'failed':
      return 'attention'
    default:
      return 'dormant'
  }
}

export function JarvisPresence() {
  const presence = usePresence()
  /*
   * Where the advisor is. The route on screen resolves to the context —
   * the client, the office, the meeting — and travels with every typed
   * line; the names come from what the page already loaded. Read from the
   * resolved location, so the presence names the page that is on screen.
   */
  const route = useRouterState({
    select: (state) => {
      const location = state.resolvedLocation ?? state.location
      return `${location.pathname}${location.searchStr ?? ''}`
    },
  })
  const namesKey = useRouterState({
    select: (state) =>
      JSON.stringify(contextNamesOf(state.matches.map((match) => match.loaderData))),
  })
  const knowsKey = useRouterState({
    select: (state) =>
      JSON.stringify(jarvisKnows(state.matches.map((match) => match.loaderData))),
  })
  const context = resolveJarvisContext(route)
  const names = JSON.parse(namesKey) as ContextNames
  const knows = JSON.parse(knowsKey) as KnownFact[]
  const navigate = useNavigate()
  const [mounted, setMounted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [operator, setOperator] = useState<string | null>(null)
  const asideRef = useRef<HTMLElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const voiceRef = useRef<VoiceSession | null>(null)
  const [voice, setVoice] = useState<VoiceSnapshot>(IDLE_VOICE)
  /* Where each voice turn's last fragment ended, so the next fragment knows whether it continues it. */
  const voiceTurnEnds = useRef(new Map<string, number>())
  /*
   * A typed line while live is answered as text first and then spoken; the
   * spoken echo is the same answer, so its transcript is not shown as a
   * second bubble. Until this moment, or until the person speaks again.
   */
  const echoUntil = useRef(0)

  useEffect(() => setMounted(true), [])

  /*
   * One voice session for the life of the presence. Its fragments become
   * turns in the one conversation; the case it binds becomes the one
   * reference; unmounting ends it.
   */
  useEffect(() => {
    if (!audioRef.current) return
    const session = new VoiceSession(
      {
        onFragment: (fragment: VoiceFragment) => {
          const by = fragment.who === 'user' ? 'user' : 'jarvis'
          if (by === 'user') echoUntil.current = 0
          else if (echoUntil.current > Date.now()) return
          updatePresence((state) => {
            const last = state.turns[state.turns.length - 1]
            const lastEnd = last ? voiceTurnEnds.current.get(last.id) : undefined
            /*
             * One bubble per side per exchange. The person's fragments join
             * while they keep talking; everything JARVIS says until the
             * person speaks again is one reply — an acknowledgement, a wait
             * and an answer are one response, not three messages.
             */
            const continues =
              last &&
              last.by === by &&
              last.via === 'voice' &&
              lastEnd !== undefined &&
              (by === 'jarvis' || fragment.startMs - lastEnd < 1200)
            if (continues) {
              voiceTurnEnds.current.set(last.id, Math.max(lastEnd, fragment.endMs))
              /* Fragments of one utterance join as spoken; a reply resumed after a pause gets one space. */
              const text =
                fragment.startMs - lastEnd > 1200
                  ? `${last.text.trimEnd()} ${fragment.delta.trimStart()}`
                  : last.text + fragment.delta
              return { ...state, turns: [...state.turns.slice(0, -1), { ...last, text }] }
            }
            /* A stray full stop or a breath is not a turn of its own. */
            if (!/[\p{L}\p{N}]/u.test(fragment.delta)) return state
            const next = turn(by, fragment.delta.trimStart(), { via: 'voice' })
            voiceTurnEnds.current.set(next.id, fragment.endMs)
            return { ...state, turns: [...state.turns, next] }
          })
        },
        onReference: (reference, ask) => {
          updatePresence((state) =>
            state.reference?.id === reference.id
              ? state
              : {
                  ...state,
                  reference,
                  subject: ask?.subject ?? state.subject,
                  question: ask?.question ?? state.question,
                },
          )
        },
        /*
         * The record answered a spoken line. The voice is saying the spoken
         * rendering; the presence shows the structured answer with its
         * evidence. The transcript bubble that is already forming for this
         * reply becomes the card, so one reply is one bubble; without one,
         * the card is the bubble.
         */
        onAdvisory: (entry) => {
          const say = entry.say
          echoUntil.current = Date.now() + 30_000
          updatePresence((state) => {
            const last = state.turns[state.turns.length - 1]
            const recent =
              last &&
              last.by === 'jarvis' &&
              last.via === 'voice' &&
              Date.now() - new Date(last.at).getTime() < 30_000
            const card = turn('jarvis', say, {
              via: 'voice',
              ...(entry.answer ? { answer: entry.answer } : {}),
            })
            return {
              ...state,
              turns: recent
                ? [...state.turns.slice(0, -1), { ...card, id: last.id }]
                : [...state.turns, card],
            }
          })
          if (entry.opens) void navigate({ href: entry.opens })
        },
      },
      audioRef.current,
    )
    voiceRef.current = session
    const unsubscribe = session.subscribe(() => setVoice(session.getSnapshot()))
    return () => {
      unsubscribe()
      void session.stop()
      voiceRef.current = null
    }
    /* `navigate` is stable for the router's life; the session is one per presence. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* The advisor moved while the voice is live: the session answers against the new route from now on. */
  useEffect(() => {
    voiceRef.current?.setContext(route)
  }, [route])

  /** The microphone: start a session bound to the conversation's case, where the advisor is, or end the one running. */
  async function toggleVoice() {
    const session = voiceRef.current
    if (!session) return
    if (session.active) {
      await session.stop()
      return
    }
    if (!presence.open) updatePresence((state) => ({ ...state, open: true }))
    const mode = await liveVoiceModeFn().catch(() => ({
      configured: true,
      simulated: false,
    }))
    await session.start(presence.reference, route, mode)
  }

  /* Who JARVIS is talking to, as the server resolves it. Read once per opening. */
  useEffect(() => {
    if (!mounted || !presence.open) return
    let cancelled = false
    getCurrentOperatorFn()
      .then((result) => {
        if (cancelled) return
        setOperator(
          result.ok
            ? `${result.operator.displayName} · ${result.operator.roleTitle}`
            : 'Ingen operatör konfigurerad',
        )
      })
      .catch(() => {
        if (!cancelled) setOperator(null)
      })
    return () => {
      cancelled = true
    }
  }, [mounted, presence.open])

  const open = mounted && presence.open
  const lastFromJarvis = [...presence.turns]
    .reverse()
    .find((entry) => entry.by === 'jarvis')

  /* Collapsing the presence closes whatever surface stood beside it, and the paid voice session with it. */
  const setOpen = (value: boolean) => {
    if (!value) void voiceRef.current?.stop()
    updatePresence((state) => ({
      ...state,
      open: value,
      surface: value ? state.surface : null,
    }))
  }

  /** Forgetting the conversation ends the session that was part of it. */
  const forget = () => {
    void voiceRef.current?.stop()
    voiceTurnEnds.current.clear()
    resetPresence()
  }

  /** A typed line while the session is live: into the same session, answered aloud. */
  /** The last few turns, as context for a typed line. Conversational data; the record is the firm's. */
  const recentHistory = () =>
    presence.turns.slice(-10).map((entry) => ({ by: entry.by, text: entry.text }))

  /**
   * The market brief the conversation last carried, if recent: a pointer
   * the server uses to answer a follow-up over the same numbers. Ten
   * minutes is the conversation's memory of it, not the data's freshness —
   * the server re-reads the numbers and applies its own window.
   */
  const recentMarketContext = (): MarketContextPointer | null => {
    const at = presence.marketContextAt
    if (!at) return null
    if (Date.now() - new Date(at).getTime() >= 10 * 60_000) return null
    const conversation = presence.marketConversation
    return conversation
      ? { at, conversation: conversation as MarketContextPointer['conversation'] }
      : { at }
  }

  /** The market pointer a reply gave back, kept for the next line; a reply without one changes nothing. */
  const marketPointerOf = (
    state: PresenceState,
    pointer: MarketContextPointer | null | undefined,
  ): Pick<PresenceState, 'marketContextAt' | 'marketConversation'> => ({
    marketContextAt: pointer?.at ?? state.marketContextAt,
    marketConversation: pointer
      ? (pointer.conversation ?? null)
      : state.marketConversation,
  })

  /** The record's last structured answer in this conversation, for a continuation. */
  const previousAnswer = (): JarvisAnswer | null =>
    [...presence.turns].reverse().find((entry) => entry.by === 'jarvis' && entry.answer)
      ?.answer ?? null

  /** A typed line while live: routed by the server, answered here as text, then spoken by the voice. */
  async function say(text: string) {
    const history = recentHistory()
    const marketContext = recentMarketContext()
    const session = voiceRef.current
    /* The simulated microphone: the line is what the person said; the answer arrives as a spoken turn. */
    if (session && voice.simulated) {
      updatePresence((state) => ({
        ...state,
        turns: [...state.turns, turn('user', text, { via: 'voice' })],
      }))
      setBusy(true)
      try {
        const heard = await session.hear(text)
        if (!heard) {
          updatePresence((state) => ({
            ...state,
            turns: [
              ...state.turns,
              turn('jarvis', 'Röstsessionen tog inte emot det.', { tone: 'warning' }),
            ],
          }))
        }
      } finally {
        setBusy(false)
      }
      return
    }
    updatePresence((state) => ({ ...state, turns: [...state.turns, turn('user', text)] }))
    setBusy(true)
    try {
      const reply = await session?.type(text, history, marketContext, previousAnswer())
      if (!reply?.ok) {
        updatePresence((state) => ({
          ...state,
          turns: [
            ...state.turns,
            turn(
              'jarvis',
              'Röstsessionen tog inte emot det. Skriv igen när rösten är av.',
              { tone: 'warning' },
            ),
          ],
        }))
        return
      }
      if (reply.say) echoUntil.current = Date.now() + 30_000
      /* The record answered: the structured answer, with its evidence; the voice says the spoken form. */
      if (reply.advisory) {
        const answer = reply.advisory
        updatePresence((state) => ({
          ...state,
          turns: [...state.turns, turn('jarvis', answerHeadline(answer), { answer })],
        }))
        if (answer.opens) void navigate({ href: answer.opens })
        return
      }
      updatePresence((state) => ({
        ...state,
        reference: reply.reference ?? state.reference,
        subject: reply.lastAsk?.subject ?? state.subject,
        question: reply.lastAsk?.question ?? state.question,
        ...marketPointerOf(state, reply.marketContext),
        turns: [
          ...state.turns,
          turn('jarvis', reply.say || 'JARVIS svarade inte på det.'),
        ],
      }))
    } finally {
      setBusy(false)
    }
  }

  /**
   * A typed line with no session: the same router as the voice — the
   * backend model with the firm's tools and the market's — never a case by
   * default. What comes back is what JARVIS answered, and the case the line
   * bound if it warranted one.
   */
  async function ask(text: string, subject: string) {
    const history = recentHistory()
    const marketContext = recentMarketContext()
    updatePresence((state) => ({ ...state, turns: [...state.turns, turn('user', text)] }))
    setBusy(true)
    try {
      const reference = presence.reference
      const result = await askJarvisFn({
        data: {
          text,
          ...(subject ? { subject } : {}),
          ...(reference ? { reference } : {}),
          ...(history.length > 0 ? { history } : {}),
          ...(marketContext ? { marketContext } : {}),
          /* Where the advisor is: the server resolves the workspace from it. */
          context: { route },
          /* The last structured answer, so "ta resten också" continues it. */
          ...(previousAnswer() ? { previous: previousAnswer() } : {}),
        },
      })
      if (!result.ok) {
        updatePresence((state) => ({
          ...state,
          turns: [
            ...state.turns,
            turn('jarvis', 'JARVIS kunde inte svara just nu.', { tone: 'warning' }),
          ],
        }))
        return
      }
      /* The record answered: a structured answer, rendered as its sections. */
      if ('advisory' in result) {
        const answer = result.advisory
        updatePresence((state) => ({
          ...state,
          turns: [...state.turns, turn('jarvis', answerHeadline(answer), { answer })],
        }))
        /* A door the answer opens itself: the pack preview a "prepare the pack" line asked for. */
        if (answer.opens) void navigate({ href: answer.opens })
        return
      }
      updatePresence((state) => ({
        ...state,
        reference: result.reference ?? state.reference,
        subject: result.lastAsk?.subject ?? state.subject,
        question: result.lastAsk?.question ?? state.question,
        ...marketPointerOf(state, result.marketContext),
        turns: [
          ...state.turns,
          turn('jarvis', result.say || 'JARVIS svarade inte på det.'),
        ],
      }))
    } catch {
      updatePresence((state) => ({
        ...state,
        turns: [
          ...state.turns,
          turn('jarvis', 'Jag fick inte kontakt med JARVIS.', { tone: 'warning' }),
        ],
      }))
    } finally {
      setBusy(false)
    }
  }

  const setSurface = (surface: SurfaceKind | null) =>
    updatePresence((state) => ({ ...state, surface }))

  /** One exchange with the firm: what was said, and what the firm answered. */
  async function consult(request: HostRequest, said?: string) {
    if (said)
      updatePresence((state) => ({
        ...state,
        turns: [...state.turns, turn('user', said)],
      }))
    setBusy(true)
    try {
      const result: HostResult = await financialOsHostFn({ data: request })
      const spoken = phrase(result)
      const lines = [
        spoken.detail,
        amendmentLine(result),
        ...(result.state === 'answer-ready' && result.answer
          ? answerLines(result.answer)
          : []),
        ...('inspection' in result && result.inspection
          ? inspectionLines(result.inspection)
          : []),
      ].filter((line): line is string => Boolean(line))
      updatePresence((state) => ({
        ...state,
        reference:
          'reference' in result && result.reference ? result.reference : state.reference,
        subject: 'subject' in result ? result.subject : state.subject,
        question: 'question' in result ? result.question : state.question,
        turns: [
          ...state.turns,
          turn('jarvis', spoken.headline, {
            detail: lines.join('\n'),
            tone: spoken.tone,
            state: result.state,
          }),
        ],
      }))
    } catch {
      updatePresence((state) => ({
        ...state,
        turns: [
          ...state.turns,
          turn('jarvis', 'Jag fick inte kontakt med investeringsteamet.', {
            tone: 'negative',
            state: 'failed',
          }),
        ],
      }))
    } finally {
      setBusy(false)
    }
  }

  /* Escape collapses the panel — scoped to the panel, so the HQ's own Escape is untouched. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <>
      <aside
        ref={asideRef}
        aria-label="JARVIS"
        onKeyDown={onKeyDown}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col transition-[width] duration-200',
          /*
           * Engaged, the presence fills the column the rail left — the landing
           * page reserves exactly this — and no more. Measured: a wider panel
           * ran over the column and clipped the greeting beside it. At rest the
           * strip is a gradient over the room rather than a bar on it, so the
           * photograph runs under the rail to the edge.
           */
          open
            ? 'w-[306px] border-r border-line bg-[#070c14]/95 backdrop-blur-md'
            : `${PRESENCE_STRIP_WIDTH} rail-strip`,
        )}
      >
        {open ? (
          <ExpandedPanel
            presence={presence}
            busy={busy}
            operator={operator}
            mood={moodOf(busy, lastFromJarvis)}
            voice={voice}
            context={context}
            contextName={contextLabel(context, names)}
            knows={knows}
            onCollapse={() => setOpen(false)}
            onConsult={consult}
            onSay={say}
            onAsk={ask}
            onOpenSurface={setSurface}
            onToggleVoice={toggleVoice}
            onForget={forget}
          />
        ) : (
          <RestingStrip
            mood={moodOf(busy, lastFromJarvis)}
            voice={voice}
            chip={contextChip(context, names)}
            contextName={contextLabel(context, names)}
            onOpen={() => setOpen(true)}
            onToggleVoice={toggleVoice}
          />
        )}
        {/* JARVIS's voice plays here; the element is the session's speaker and nothing else. */}
        <audio ref={audioRef} autoPlay aria-hidden="true" className="hidden" />
      </aside>
      {/*
       * A sibling of the presence, never a child: the surface stands over the
       * page to the right of the engaged panel, and the panel keeps its own
       * width, scroll and Escape.
       */}
      {open && presence.surface && presence.reference && (
        <ContextualSurface
          kind={presence.surface}
          reference={presence.reference}
          subject={presence.subject}
          question={presence.question}
          onClose={() => setSurface(null)}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------- at rest */

function Mark({ mood, className }: { mood: Mood; className?: string }) {
  return (
    <span
      className={cn(
        'relative inline-flex h-9 w-9 items-center justify-center',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="hud-glow absolute inset-0 rounded-full border border-hud-line bg-surface-2"
      />
      <Sparkles className="relative h-4 w-4 text-content" aria-hidden="true" />
      <span
        aria-hidden="true"
        className={cn(
          'absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-[#070c14]',
          MOOD_CLASS[mood],
        )}
      />
    </span>
  )
}

/**
 * The microphone. Pressing it starts a live session; pressing it while one
 * runs ends it. Its word is the session's truthful state — Röst, Ansluter…,
 * Lyssnar, Tänker, Talar — and its ring says at a glance whether JARVIS is
 * listening. Never on by itself.
 */
function MicrophoneButton({
  voice,
  onToggle,
  compact = false,
}: {
  voice: VoiceSnapshot
  onToggle: () => void
  compact?: boolean
}) {
  const active = voiceActive(voice)
  const label = active ? 'Avsluta röst' : 'Starta röst'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={label}
      title={label}
      data-voice={voice.status}
      className={cn(
        'inline-flex items-center gap-1 rounded-lg transition-colors',
        compact ? 'flex-col' : 'flex-row gap-2',
        active ? 'text-accent' : 'text-content-muted hover:text-content',
      )}
    >
      <span
        className={cn(
          'relative inline-flex h-8 w-8 items-center justify-center rounded-full border',
          active ? 'border-accent' : 'border-line',
          voice.status === 'listening' && 'animate-pulse',
        )}
      >
        <Mic className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="type-machine">{VOICE_STATUS_TEXT[voice.status]}</span>
    </button>
  )
}

function RestingStrip({
  mood,
  voice,
  chip,
  contextName,
  onOpen,
  onToggleVoice,
}: {
  mood: Mood
  voice: VoiceSnapshot
  /** The context in at most seven characters: a client's initials, an office's stub. */
  chip: string
  contextName: string
  onOpen: () => void
  onToggleVoice: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center py-4">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Öppna JARVIS"
        title="Öppna JARVIS"
        className="rounded-full transition-transform duration-150 hover:scale-105"
      >
        <Mark mood={mood} />
      </button>
      <span className="type-machine mt-2 text-content-muted">JARVIS</span>
      {/* What JARVIS is looking at, at a glance: quiet, and named in full on hover. */}
      {chip && (
        <span
          className="type-machine mt-1 max-w-[3.5rem] truncate text-institution"
          aria-label={`Kontext: ${contextName}`}
          title={contextName}
        >
          {chip}
        </span>
      )}
      {/* The product's spine, under JARVIS's mark; the microphone and the utilities at the foot. */}
      <GlobalRail className="mt-5" />
      <div className="mt-auto flex w-full flex-col items-center gap-2">
        <MicrophoneButton compact voice={voice} onToggle={onToggleVoice} />
        <GlobalRailUtilities />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ engaged */

function ExpandedPanel({
  presence,
  busy,
  operator,
  mood,
  voice,
  context,
  contextName,
  knows,
  onCollapse,
  onConsult,
  onSay,
  onAsk,
  onOpenSurface,
  onToggleVoice,
  onForget,
}: {
  presence: ReturnType<typeof usePresence>
  busy: boolean
  operator: string | null
  mood: Mood
  voice: VoiceSnapshot
  /** Where the advisor is, and what to call it. */
  context: JarvisContext
  contextName: string
  /** The few things JARVIS already knows about the client on screen. */
  knows: readonly KnownFact[]
  onCollapse: () => void
  onConsult: (request: HostRequest, said?: string) => Promise<void>
  onSay: (text: string) => Promise<void>
  onAsk: (text: string, subject: string) => Promise<void>
  onOpenSurface: (surface: SurfaceKind) => void
  onToggleVoice: () => void
  onForget: () => void
}) {
  const [question, setQuestion] = useState('')
  const [subject, setSubject] = useState('')
  const logRef = useRef<HTMLOListElement>(null)
  const live = voiceActive(voice) && voice.sessionId !== null

  useEffect(() => {
    /* Assigned rather than `scrollTo`, which jsdom does not implement. */
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [presence.turns.length, presence.turns[presence.turns.length - 1]?.text, busy])

  const reference = presence.reference

  async function submit(event: FormEvent) {
    event.preventDefault()
    const asked = question.trim()
    const about = subject.trim()
    if (!asked || busy) return
    /* With the session live, the line joins the spoken conversation; without one, JARVIS routes it. */
    if (live) {
      setQuestion('')
      await onSay(asked)
      return
    }
    setQuestion('')
    setSubject('')
    await onAsk(asked, about)
  }

  const followUp = (request: HostRequest, said: string) => () => onConsult(request, said)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line px-3 py-3">
        <Mark mood={mood} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-content">JARVIS</p>
          {/* What JARVIS is looking at: the same Financial OS the advisor is. */}
          <p className="type-machine truncate text-institution" aria-label="Kontext">
            {contextName}
          </p>
          {/* With the voice live, the same workspace — said so, beside the ear. */}
          {live && (
            <p className="type-machine truncate text-content" aria-label="Röstkontext">
              JARVIS lyssnar · {contextName}
            </p>
          )}
          <p className="type-metadata truncate">{operator ?? '…'}</p>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Fäll ihop JARVIS"
          title="Fäll ihop JARVIS"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-content-subtle hover:bg-surface-2 hover:text-content"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      {/* ------------------------------------------------- the conversation */}
      <ol
        ref={logRef}
        aria-label="Samtal"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3"
      >
        {presence.turns.length === 0 && (
          <li className="type-metadata">{emptyHint(context)}</li>
        )}
        {presence.turns.map((entry) => (
          <li
            key={entry.id}
            data-by={entry.by}
            data-state={entry.state ?? undefined}
            className={cn(
              'max-w-[92%] rounded-lg px-3 py-2 text-[13px] leading-snug',
              entry.by === 'user'
                ? 'self-end bg-surface-3 text-content'
                : 'self-start border border-line bg-surface text-content',
            )}
          >
            {entry.answer ? (
              <>
                {/* A spoken answer: what the voice said, then the same answer with its evidence. */}
                {entry.via === 'voice' && entry.text && (
                  <p className="mb-2 font-medium">
                    {entry.text}
                    <span
                      className="type-machine ml-1.5 text-content-subtle"
                      aria-label="sagt"
                    >
                      röst
                    </span>
                  </p>
                )}
                <JarvisAnswerView answer={entry.answer} />
              </>
            ) : (
              <p className={cn('font-medium', entry.tone ? toneText[entry.tone] : '')}>
                {entry.text}
                {entry.via === 'voice' && (
                  <span
                    className="type-machine ml-1.5 text-content-subtle"
                    aria-label="sagt"
                  >
                    röst
                  </span>
                )}
              </p>
            )}
            {entry.detail && (
              <p className="mt-1 whitespace-pre-line text-content-muted">
                {entry.detail}
              </p>
            )}
          </li>
        ))}
        {busy && (
          <li className="type-metadata self-start" aria-live="polite">
            Frågar investeringsteamet…
          </li>
        )}
        {voice.status === 'thinking' && (
          <li className="type-metadata self-start" aria-live="polite">
            Tänker…
          </li>
        )}
      </ol>

      {/* ------------------------------------------- the case in hand */}
      {reference && (
        <section aria-label="Aktivt ärende" className="border-t border-line px-3 py-2">
          <p className="type-section truncate">{presence.subject ?? 'Ärende'}</p>
          <p className="type-metadata truncate">{presence.question ?? reference.id}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <FollowUp
              onClick={followUp({ kind: 'status', reference }, 'Var står det?')}
              disabled={busy}
            >
              Var står det?
            </FollowUp>
            <FollowUp
              onClick={followUp({ kind: 'result', reference }, 'Vad kom ni fram till?')}
              disabled={busy}
            >
              Vad kom ni fram till?
            </FollowUp>
            <FollowUp
              onClick={followUp(
                { kind: 'inspect', reference, view: { kind: 'objections' } },
                'Vilka invändningar finns?',
              )}
              disabled={busy}
            >
              Vilka invändningar finns?
            </FollowUp>
            <FollowUp
              onClick={followUp(
                { kind: 'inspect', reference, view: { kind: 'debate' } },
                'Hur gick debatten?',
              )}
              disabled={busy}
            >
              Hur gick debatten?
            </FollowUp>
          </div>
          {/*
           * The doors to the deeper surfaces. Buttons, not links: they open
           * the canonical page beside the conversation and leave the HQ where
           * it is. The page as a page is one click further, in the surface's
           * own header.
           */}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {(['boardroom', 'underlag'] as const).map((surface) => (
              <button
                key={surface}
                type="button"
                onClick={() => onOpenSurface(surface)}
                aria-pressed={presence.surface === surface}
                className={cn(
                  'brd-console-link',
                  presence.surface === surface && 'text-content',
                )}
              >
                {SURFACE_TEXT[surface].open} →
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------- what JARVIS knows */}
      {knows.length > 0 && (
        <section aria-label="JARVIS vet" className="border-t border-line px-3 py-2">
          <p className="type-section text-[9.5px]">JARVIS vet</p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {knows.map((fact) => (
              <li key={fact.key} className="type-machine normal-case text-content-muted">
                {fact.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------------------------------------------- quick actions */}
      {!live && quickActions(context).length > 0 && (
        <nav
          aria-label="Snabbfrågor"
          className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2"
        >
          {quickActions(context).map((action) => (
            <button
              key={action}
              type="button"
              disabled={busy}
              onClick={() => void onAsk(action, '')}
              className="rounded-[3px] border border-line px-2 py-0.5 text-[11.5px] text-content-muted transition-colors hover:border-institution-line hover:text-institution disabled:opacity-40"
            >
              {action}
            </button>
          ))}
        </nav>
      )}

      {/* ------------------------------------------------------ compose */}
      <form
        onSubmit={submit}
        className="flex flex-col gap-2 border-t border-line px-3 py-3"
      >
        <label className="flex flex-col gap-1">
          <span className="type-section">Fråga</span>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={
              live
                ? voice.simulated
                  ? 'Skriv det du skulle ha sagt — rösten är simulerad'
                  : 'Skriv in i samtalet — JARVIS svarar med rösten'
                : composePlaceholder(context)
            }
            rows={2}
            className="hq-field resize-none"
          />
        </label>
        <div className="flex items-end gap-2">
          {!live && (
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="type-section">Om</span>
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Valfritt"
                className="hq-field"
              />
            </label>
          )}
          <button
            type="submit"
            disabled={busy || !question.trim()}
            aria-label={
              live
                ? voice.simulated
                  ? 'Säg det (simulerad röst)'
                  : 'Skicka in i samtalet'
                : 'Ställ frågan'
            }
            title={
              live
                ? voice.simulated
                  ? 'Säg det (simulerad röst)'
                  : 'Skicka in i samtalet'
                : 'Ställ frågan'
            }
            className={cn(
              'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-content transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40',
              live && 'ml-auto',
            )}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
          <MicrophoneButton voice={voice} onToggle={onToggleVoice} />
        </div>
        {/* What the voice is doing, or why it is not: a sentence, never a code. */}
        {voice.notice && (
          <p role="status" className="type-metadata text-warning">
            {voice.notice}
          </p>
        )}
        {live && (
          <p className="type-metadata" aria-label="Röstsession">
            Röst · {Math.floor(voice.seconds / 60)}:
            {String(voice.seconds % 60).padStart(2, '0')} · ${voice.costUsd.toFixed(3)}
          </p>
        )}
      </form>

      {/* -------------------------------------------------------- doors */}
      <nav
        aria-label="Genvägar"
        className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-3 py-2"
      >
        {shortcutNav.map((item) => (
          <Link key={item.to} to={item.to} className="type-machine hover:text-content">
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={onForget}
          className="type-machine ml-auto hover:text-content"
        >
          Glöm samtalet
        </button>
      </nav>
    </div>
  )
}

function FollowUp({
  children,
  onClick,
  disabled,
}: {
  children: string
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-line px-2 py-1 text-[11.5px] text-content-muted transition-colors hover:bg-surface-2 hover:text-content disabled:opacity-40"
    >
      {children}
    </button>
  )
}
