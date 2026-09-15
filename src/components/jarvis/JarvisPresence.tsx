/**
 * JARVIS, present beside the person in HQ.
 *
 * Mounted once, from the root route, in the space the left navigation used to
 * take. At rest it is a narrow strip: a mark, a state, and a microphone that
 * says plainly it does not listen yet. Engaged, it expands inward into a
 * conversation, a product state, and the doors to the firm's deeper surfaces
 * — and collapses again. The HQ behind it is untouched.
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
import { Link } from '@tanstack/react-router'
import { ChevronLeft, Mic, Send, Sparkles } from 'lucide-react'
import { cn } from '~/lib/cn'
import { toneText } from '~/lib/tone'
import { primaryNav, utilityNav } from '~/lib/navigation'
import {
  financialOsHostFn,
  getCurrentOperatorFn,
} from '~/infrastructure/analysis/serverFns'
import type { HostRequest, HostResult } from '~/application/analysis/hostContract'
import { answerLines, inspectionLines, phrase } from '~/presentation/jarvis/hostStateText'
import { ContextualSurface, SURFACE_TEXT } from './ContextualSurface'
import {
  resetPresence,
  updatePresence,
  usePresence,
  type ContextualSurface as SurfaceKind,
  type PresenceTurn,
} from './presenceStore'
import { VoiceSession, VOICE_STATUS_TEXT, type VoiceFragment, type VoiceSnapshot } from './voiceSession'

const IDLE_VOICE: VoiceSnapshot = { status: 'idle', sessionId: null, notice: null, seconds: 0, costUsd: 0 }
const voiceActive = (voice: VoiceSnapshot) => voice.status !== 'idle' && voice.status !== 'unavailable'

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
  const [mounted, setMounted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [operator, setOperator] = useState<string | null>(null)
  const asideRef = useRef<HTMLElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const voiceRef = useRef<VoiceSession | null>(null)
  const [voice, setVoice] = useState<VoiceSnapshot>(IDLE_VOICE)
  /* Where each voice turn's last fragment ended, so the next fragment knows whether it continues it. */
  const voiceTurnEnds = useRef(new Map<string, number>())

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
          updatePresence((state) => {
            const last = state.turns[state.turns.length - 1]
            const lastEnd = last ? voiceTurnEnds.current.get(last.id) : undefined
            if (last && last.by === by && last.via === 'voice' && lastEnd !== undefined && fragment.startMs - lastEnd < 1200) {
              voiceTurnEnds.current.set(last.id, Math.max(lastEnd, fragment.endMs))
              return { ...state, turns: [...state.turns.slice(0, -1), { ...last, text: last.text + fragment.delta }] }
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
              : { ...state, reference, subject: ask?.subject ?? state.subject, question: ask?.question ?? state.question },
          )
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
  }, [])

  /** The microphone: start a session bound to the conversation's case, or end the one running. */
  async function toggleVoice() {
    const session = voiceRef.current
    if (!session) return
    if (session.active) {
      await session.stop()
      return
    }
    if (!presence.open) updatePresence((state) => ({ ...state, open: true }))
    await session.start(presence.reference)
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
  async function say(text: string) {
    updatePresence((state) => ({ ...state, turns: [...state.turns, turn('user', text)] }))
    const accepted = await voiceRef.current?.type(text)
    if (!accepted)
      updatePresence((state) => ({
        ...state,
        turns: [...state.turns, turn('jarvis', 'Röstsessionen tog inte emot det. Skriv igen när rösten är av.', { tone: 'warning' })],
      }))
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
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-[#070c14]/95 backdrop-blur-md transition-[width] duration-200',
          /*
           * Engaged, the presence fills the column the rail left — the landing
           * page reserves exactly this — and no more. Measured: a wider panel
           * ran over the column and clipped the greeting beside it.
           */
          open ? 'w-[306px]' : PRESENCE_STRIP_WIDTH,
        )}
      >
        {open ? (
          <ExpandedPanel
            presence={presence}
            busy={busy}
            operator={operator}
            mood={moodOf(busy, lastFromJarvis)}
            voice={voice}
            onCollapse={() => setOpen(false)}
            onConsult={consult}
            onSay={say}
            onOpenSurface={setSurface}
            onToggleVoice={toggleVoice}
            onForget={forget}
          />
        ) : (
          <RestingStrip mood={moodOf(busy, lastFromJarvis)} voice={voice} onOpen={() => setOpen(true)} onToggleVoice={toggleVoice} />
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
  onOpen,
  onToggleVoice,
}: {
  mood: Mood
  voice: VoiceSnapshot
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
      <div className="mt-auto">
        <MicrophoneButton compact voice={voice} onToggle={onToggleVoice} />
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
  onCollapse,
  onConsult,
  onSay,
  onOpenSurface,
  onToggleVoice,
  onForget,
}: {
  presence: ReturnType<typeof usePresence>
  busy: boolean
  operator: string | null
  mood: Mood
  voice: VoiceSnapshot
  onCollapse: () => void
  onConsult: (request: HostRequest, said?: string) => Promise<void>
  onSay: (text: string) => Promise<void>
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
    /* With the session live, the line joins the spoken conversation; without one, it is an ask of the firm. */
    if (live) {
      setQuestion('')
      await onSay(asked)
      return
    }
    if (!about) return
    setQuestion('')
    setSubject('')
    await onConsult(
      { kind: 'ask', requestId: crypto.randomUUID(), question: asked, subject: about },
      asked,
    )
  }

  const followUp = (request: HostRequest, said: string) => () => onConsult(request, said)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line px-3 py-3">
        <Mark mood={mood} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-content">JARVIS</p>
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
          <li className="type-metadata">
            Ställ en investeringsfråga så låter jag investeringsteamet ta den.
          </li>
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
            <p className={cn('font-medium', entry.tone ? toneText[entry.tone] : '')}>
              {entry.text}
              {entry.via === 'voice' && (
                <span className="type-machine ml-1.5 text-content-subtle" aria-label="sagt">
                  röst
                </span>
              )}
            </p>
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
            placeholder={live ? 'Skriv in i samtalet — JARVIS svarar med rösten' : 'Är Nvidia köpvärd på 12–24 månaders sikt?'}
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
                placeholder="Nvidia"
                className="hq-field"
              />
            </label>
          )}
          <button
            type="submit"
            disabled={busy || !question.trim() || (!live && !subject.trim())}
            aria-label={live ? 'Skicka in i samtalet' : 'Ställ frågan'}
            title={live ? 'Skicka in i samtalet' : 'Ställ frågan'}
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
            Röst · {Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2, '0')} · $
            {voice.costUsd.toFixed(3)}
          </p>
        )}
      </form>

      {/* -------------------------------------------------------- doors */}
      <nav
        aria-label="Genvägar"
        className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-3 py-2"
      >
        {[...primaryNav, ...utilityNav].map((item) => (
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
