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
 * ## What it does not do yet
 *
 * It does not route. Every question typed here goes to the firm, because the
 * layer that decides whether a question needs the firm at all is later work;
 * this is the institutional branch made callable, not the router. It does not
 * listen: the microphone is drawn muted and labelled so, and no audio API is
 * touched. Voice is its own slice.
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

  useEffect(() => setMounted(true), [])

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

  /* Collapsing the presence closes whatever surface stood beside it. */
  const setOpen = (value: boolean) =>
    updatePresence((state) => ({
      ...state,
      open: value,
      surface: value ? state.surface : null,
    }))

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
            onCollapse={() => setOpen(false)}
            onConsult={consult}
            onOpenSurface={setSurface}
          />
        ) : (
          <RestingStrip mood={moodOf(busy, lastFromJarvis)} onOpen={() => setOpen(true)} />
        )}
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
 * The microphone, drawn muted and named so. It listens to nothing: no audio
 * API is touched anywhere in this component, and until the voice slice makes
 * it real the control must not look as though pressing it would.
 */
function InertMicrophone({ compact = false }: { compact?: boolean }) {
  return (
    <span
      role="img"
      aria-label="Röst kommer i en senare version"
      title="Röst kommer i en senare version"
      className={cn(
        'inline-flex flex-col items-center gap-1 text-content-subtle opacity-50',
        compact ? '' : 'flex-row gap-2',
      )}
    >
      <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-line">
        <Mic className="h-3.5 w-3.5" aria-hidden="true" />
        <span
          aria-hidden="true"
          className="absolute h-[2px] w-6 rotate-45 rounded-full bg-content-subtle"
        />
      </span>
      <span className="type-machine">{compact ? 'Röst' : 'Röst kommer'}</span>
    </span>
  )
}

function RestingStrip({ mood, onOpen }: { mood: Mood; onOpen: () => void }) {
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
        <InertMicrophone compact />
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
  onCollapse,
  onConsult,
  onOpenSurface,
}: {
  presence: ReturnType<typeof usePresence>
  busy: boolean
  operator: string | null
  mood: Mood
  onCollapse: () => void
  onConsult: (request: HostRequest, said?: string) => Promise<void>
  onOpenSurface: (surface: SurfaceKind) => void
}) {
  const [question, setQuestion] = useState('')
  const [subject, setSubject] = useState('')
  const logRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    /* Assigned rather than `scrollTo`, which jsdom does not implement. */
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [presence.turns.length, busy])

  const reference = presence.reference

  async function submit(event: FormEvent) {
    event.preventDefault()
    const asked = question.trim()
    const about = subject.trim()
    if (!asked || !about || busy) return
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
            placeholder="Är Nvidia köpvärd på 12–24 månaders sikt?"
            rows={2}
            className="hq-field resize-none"
          />
        </label>
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="type-section">Om</span>
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Nvidia"
              className="hq-field"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !question.trim() || !subject.trim()}
            aria-label="Ställ frågan"
            title="Ställ frågan"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-content transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
          <InertMicrophone />
        </div>
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
          onClick={resetPresence}
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
