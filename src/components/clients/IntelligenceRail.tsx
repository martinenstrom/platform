import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, Sparkles } from 'lucide-react'
import type { Client360 } from '~/application/advisory/client360'
import type { Signal } from '~/domain/advisory'
import { cn } from '~/lib/cn'
import {
  formatDayMonth,
  formatDaysFromToday,
  formatLongDate,
  formatMsek,
} from '~/presentation/advisory/format'
import {
  nextBestActionText,
  SIGNAL_TONE,
  signalText,
  type SignalTone,
} from '~/presentation/advisory/intelligenceText'
import { EVENT_LABEL, HEALTH_BAND_LABEL } from '~/presentation/advisory/text'
import { HealthDrivers } from './HealthIndicator'

/**
 * The right-hand column: the advisor's peripheral intelligence. The main
 * area explains the client; this explains the action — JARVIS's one
 * recommendation first and heaviest, in the gold material; then what needs
 * attention, what is coming, and how the relationship stands beside its
 * openings. Sticky on a wide screen so it stays beside the dossier.
 *
 * Everything here is the read model's: the next best action, the ranked
 * signals, the events, the health with its drivers, the opportunities. The
 * rail orders and words nothing of its own.
 */
export function IntelligenceRail({
  view,
  onCompleteCommitment,
  onAddUpdate,
  updating,
}: {
  view: Client360
  onCompleteCommitment: (commitmentId: string) => Promise<void>
  onAddUpdate: () => void
  updating: boolean
}) {
  const openings = view.opportunities
    .filter((o) => !['won', 'lost'].includes(o.status))
    .slice(0, 3)
  /*
   * What needs attention: the five highest-ranked signals in the order the
   * rules ranked them, and beneath them every open promise the signals did
   * not already name — a promise is the one thing here the advisor can
   * close, so none may be out of reach.
   */
  const shownSignals = view.signals.slice(0, 5)
  const namedCommitments = new Set(
    shownSignals.flatMap((s) =>
      s.kind === 'overdue-commitment' || s.kind === 'commitment-due-soon'
        ? [s.commitmentId]
        : [],
    ),
  )
  const promises = view.openCommitments.filter((c) => !namedCommitments.has(c.id))
  return (
    <aside aria-label="Intelligensrail" className="flex flex-col gap-2.5">
      <Recommendation view={view} onAddUpdate={onAddUpdate} updating={updating} />

      <RailPanel title="Attention" meta={String(shownSignals.length + promises.length)}>
        {shownSignals.length === 0 && promises.length === 0 ? (
          <p className="type-inst-sub px-3 py-2">Inget som kräver uppmärksamhet.</p>
        ) : (
          <ul>
            {shownSignals.map((signal, index) => (
              <AttentionRow
                key={`${signal.kind}-${index}`}
                signal={signal}
                onCompleteCommitment={onCompleteCommitment}
              />
            ))}
            {promises.map((c) => (
              <PromiseRow
                key={c.id}
                commitment={c}
                onCompleteCommitment={onCompleteCommitment}
              />
            ))}
          </ul>
        )}
      </RailPanel>

      <RailPanel title="Kommande aktiviteter" meta={String(view.upcomingEvents.length)}>
        {view.upcomingEvents.length === 0 ? (
          <p className="type-inst-sub px-3 py-2">Inga kommande händelser.</p>
        ) : (
          <ul>
            {view.upcomingEvents.slice(0, 4).map((event) => (
              <li
                key={event.id}
                className="rail-row flex items-baseline gap-3 px-3 py-2 text-[12.5px]"
              >
                <span className="tabular w-11 shrink-0 font-semibold text-content">
                  {formatDayMonth(event.occursOn)}
                </span>
                <span className="min-w-0 flex-1 truncate text-content-muted">
                  {EVENT_LABEL[event.type]}
                  {event.type !== 'birthday' && event.title !== EVENT_LABEL[event.type]
                    ? ` · ${event.title}`
                    : ''}
                </span>
                <span className="type-machine shrink-0">
                  {formatDaysFromToday(event.daysAhead)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </RailPanel>

      <RailPanel title="Relation & möjligheter">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 px-3 py-3">
          <div className="flex flex-col items-center">
            <HealthRing score={view.health.score} band={view.health.band} />
          </div>
          <div className="min-w-0">
            <p className="type-section">Relationshälsa</p>
            <p
              className={cn(
                'mt-1 text-[13px] font-medium',
                view.health.band === 'at-risk'
                  ? 'text-negative'
                  : view.health.band === 'watch'
                    ? 'text-warning'
                    : view.health.band === 'strong'
                      ? 'text-positive'
                      : 'text-content',
              )}
            >
              {HEALTH_BAND_LABEL[view.health.band]}
            </p>
            <p className="type-inst-sub mt-0.5">
              {view.daysSinceContact === null
                ? 'Ingen kontakt registrerad'
                : view.daysSinceContact > 30
                  ? `Ingen kontakt på ${view.daysSinceContact} dagar`
                  : `Kontakt ${formatDaysFromToday(-view.daysSinceContact)}`}
            </p>
            <p className="type-section mt-3">Möjligheter</p>
            {openings.length === 0 ? (
              <p className="type-inst-sub mt-1">Inga aktiva möjligheter.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {openings.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-baseline justify-between gap-2 text-[12.5px]"
                  >
                    <span className="min-w-0 truncate text-content">{o.title}</span>
                    <span className="tabular shrink-0 font-semibold text-content">
                      {formatMsek(o.potentialValue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {/* The score, and every driver behind it — never a bare number. */}
        <div className="border-t border-white/[0.06] px-3 py-2.5">
          <HealthDrivers health={view.health} />
        </div>
      </RailPanel>
    </aside>
  )
}

/* ---------------------------------------------------- the recommendation */

function Recommendation({
  view,
  onAddUpdate,
  updating,
}: {
  view: Client360
  onAddUpdate: () => void
  updating: boolean
}) {
  const action = view.nextBestAction
  const when = action
    ? action.dueDate
      ? `senast ${formatLongDate(action.dueDate)}`
      : view.nextMeeting
        ? `före mötet ${formatDayMonth(view.nextMeeting.occursOn)}`
        : 'vid nästa kontakt'
    : null
  return (
    <section aria-label="JARVIS rekommenderar" className="jarvis-gold px-4 pt-3.5 pb-4">
      <div className="flex items-center justify-between gap-3">
        <span className="type-section flex items-center gap-2 text-[#e6c987]">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-[rgb(217_164_65_/_0.45)] bg-[rgb(217_164_65_/_0.08)]"
          >
            <Sparkles className="h-3 w-3" strokeWidth={1.6} />
          </span>
          JARVIS rekommenderar
        </span>
        {action && (
          <span className="rounded-[3px] bg-[#e9c46a] px-1.5 py-[3px] text-[9.5px] font-semibold tracking-[0.14em] text-[#1a1305] uppercase">
            Brådska {action.urgency}/5
          </span>
        )}
      </div>

      {action ? (
        <>
          <p className="type-display-statement mt-3 text-[#f6efdf]">
            {nextBestActionText(action)}
          </p>
          <p className="mt-2.5 text-[12.5px] leading-snug text-[#d9cdb0]">
            {signalText(action.signal).signal}
          </p>
          <p className="mt-1 text-[12.5px] leading-snug text-[#d9cdb0]">
            {signalText(action.signal).why}{' '}
            <span className="text-[#f6efdf]">Rekommenderad åtgärd {when}.</span>
          </p>
        </>
      ) : (
        <p className="type-display-statement mt-3 text-[#f6efdf]">
          Ingen åtgärd rekommenderas just nu. Relationen kräver ingenting av dig i dag.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to="/clients/$clientId/meeting-prep"
          params={{ clientId: view.client.id }}
          className="jarvis-gold-btn"
        >
          Förbered möte
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
        </Link>
        <button
          type="button"
          onClick={onAddUpdate}
          aria-pressed={updating}
          className={cn('jarvis-ghost-btn', updating && 'bg-[rgb(255_226_170_/_0.12)]')}
        >
          Lägg till klientuppdatering
        </button>
        {/* Only with a meeting to prepare for; the cockpit is the pack's home. */}
        {view.nextMeeting && (
          <Link
            to="/clients/$clientId/meeting-pack"
            params={{ clientId: view.client.id }}
            search={{ depth: 'full' }}
            className="jarvis-ghost-btn"
          >
            Skapa mötesunderlag
          </Link>
        )}
      </div>
      {action && <p className="type-machine mt-3 text-[#a8987a]">{action.method}</p>}
    </section>
  )
}

/* -------------------------------------------------------------- attention */

const TONE_DOT: Record<SignalTone, string> = {
  alert: 'bg-negative',
  signal: 'bg-warning',
  insight: 'bg-info',
}

/** Where on the dossier a signal's subject is explained. */
const ANCHOR: Partial<Record<Signal['kind'], string>> = {
  'goal-at-risk': '#mal',
  'opportunity-open': '#mojligheter',
  'refinancing-approaching': '#finansiering',
  'loan-maturity-approaching': '#finansiering',
  'open-concern': '#klientkontext',
  'no-recent-contact': '#relationstidslinje',
  'retention-risk': '#relationstidslinje',
  'large-withdrawal': '#relationstidslinje',
  'meeting-approaching': '#handelser',
  'birthday-approaching': '#handelser',
  'allocation-drift': '#portfolj',
  'excess-cash': '#formogenhet',
}

function AttentionRow({
  signal,
  onCompleteCommitment,
}: {
  signal: Signal
  onCompleteCommitment: (commitmentId: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const text = signalText(signal)
  const detail =
    signal.kind === 'overdue-commitment'
      ? `Försenat ${signal.daysOverdue} dagar`
      : signal.kind === 'commitment-due-soon'
        ? `Senast ${formatDaysFromToday(signal.daysAhead)}`
        : text.why
  /* A promise is the one signal with an act of its own: closing it. */
  const commitment =
    signal.kind === 'overdue-commitment' || signal.kind === 'commitment-due-soon'
      ? { id: signal.commitmentId, title: signal.title }
      : null
  return (
    <li className="rail-row flex items-start gap-2.5 px-3 py-2.5">
      <span
        aria-hidden="true"
        className={cn(
          'mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full',
          TONE_DOT[SIGNAL_TONE[signal.kind]],
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] leading-snug text-content">
          {commitment ? commitment.title : text.signal}
        </p>
        <p
          className={cn(
            'type-machine mt-0.5 normal-case',
            signal.kind === 'overdue-commitment' && 'text-negative',
          )}
        >
          {detail}
        </p>
      </div>
      {commitment ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onCompleteCommitment(commitment.id)
            } finally {
              setBusy(false)
            }
          }}
          aria-label={`Markera "${commitment.title}" som klart`}
          className="type-machine shrink-0 rounded-[3px] border border-line px-2 py-1 text-content-muted transition-colors hover:border-institution-line hover:text-institution disabled:opacity-40"
        >
          Klart
        </button>
      ) : (
        <a
          href={ANCHOR[signal.kind] ?? '#relationsintelligens'}
          className="type-machine shrink-0 rounded-[3px] border border-line px-2 py-1 text-content-muted transition-colors hover:border-institution-line hover:text-institution"
        >
          Visa
        </a>
      )}
    </li>
  )
}

/** An open promise no signal named: the same row, the same act. */
function PromiseRow({
  commitment,
  onCompleteCommitment,
}: {
  commitment: Client360['openCommitments'][number]
  onCompleteCommitment: (commitmentId: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <li className="rail-row flex items-start gap-2.5 px-3 py-2.5">
      <span
        aria-hidden="true"
        className={cn(
          'mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full',
          commitment.overdue ? 'bg-negative' : 'bg-info',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] leading-snug text-content">{commitment.title}</p>
        <p
          className={cn(
            'type-machine mt-0.5 normal-case',
            commitment.overdue && 'text-negative',
          )}
        >
          {commitment.dueDate
            ? commitment.overdue
              ? `Försenat · ${formatDayMonth(commitment.dueDate)}`
              : `Senast ${formatDayMonth(commitment.dueDate)}`
            : 'Inget datum'}
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onCompleteCommitment(commitment.id)
          } finally {
            setBusy(false)
          }
        }}
        aria-label={`Markera "${commitment.title}" som klart`}
        className="type-machine shrink-0 rounded-[3px] border border-line px-2 py-1 text-content-muted transition-colors hover:border-institution-line hover:text-institution disabled:opacity-40"
      >
        Klart
      </button>
    </li>
  )
}

/* ------------------------------------------------------------------ ring */

const RING_TONE = {
  strong: '#2ecc84',
  stable: '#d9a441',
  watch: '#eaa73c',
  'at-risk': '#f2555a',
} as const

function HealthRing({ score, band }: { score: number; band: keyof typeof RING_TONE }) {
  const r = 30
  const c = 2 * Math.PI * r
  return (
    <div className="relative h-[76px] w-[76px]">
      <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          stroke="rgb(255 255 255 / 0.08)"
          strokeWidth="3"
        />
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          stroke={RING_TONE[band]}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${(c * Math.max(0, Math.min(100, score))) / 100} ${c}`}
          transform="rotate(-90 38 38)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="type-display-figure-sm text-[22px]">{score}</span>
        <span className="type-machine mt-1">/100</span>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- panel */

function RailPanel({
  title,
  meta,
  children,
}: {
  title: string
  meta?: string
  children: ReactNode
}) {
  return (
    <section className="ref-panel">
      <header className="ref-head px-3">
        <h2 className="type-section">{title}</h2>
        {meta && (
          <span className="type-machine rounded-[3px] border border-line px-1.5 py-px">
            {meta}
          </span>
        )}
      </header>
      <div>{children}</div>
    </section>
  )
}
