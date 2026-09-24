import type { ReactNode } from 'react'
import type { Client360 } from '~/application/advisory/client360'
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
} from '~/presentation/advisory/intelligenceText'
import { EVENT_LABEL, PRIORITY_LABEL } from '~/presentation/advisory/text'
import { HealthBar, HealthDrivers, HealthScore } from './HealthIndicator'
import { JarvisBlock } from './JarvisBlock'

const PRIORITY_DOT = {
  high: 'bg-warning',
  medium: 'bg-accent',
  low: 'bg-content-subtle',
} as const

/**
 * The right-hand column: what the advisor should do. The main area explains
 * the client; this explains the action — the next best action first, then
 * the signals, the promises, what is coming, the relationship's health and
 * its openings. Sticky on a wide screen so it stays beside the page.
 */
export function IntelligenceRail({
  view,
  onCompleteCommitment,
}: {
  view: Client360
  onCompleteCommitment: (commitmentId: string) => Promise<void>
}) {
  const openings = view.opportunities
    .filter((o) => !['won', 'lost'].includes(o.status))
    .slice(0, 3)
  return (
    <aside aria-label="Intelligensrail" className="flex flex-col gap-2">
      <RailSection title="Nästa bästa åtgärd">
        {view.nextBestAction ? (
          <JarvisBlock
            kind="recommends"
            meta={`brådska ${view.nextBestAction.urgency}/5`}
          >
            <p className="type-inst-lg">{nextBestActionText(view.nextBestAction)}</p>
            {view.nextBestAction.dueDate && (
              <p className="type-machine mt-1">
                Senast {formatLongDate(view.nextBestAction.dueDate)}
              </p>
            )}
          </JarvisBlock>
        ) : (
          <p className="type-inst-sub px-1">Ingen åtgärd rekommenderas.</p>
        )}
      </RailSection>

      <RailSection title="JARVIS-signaler" meta={String(view.signals.length)}>
        {view.signals.length === 0 ? (
          <p className="type-inst-sub px-1">Inga signaler.</p>
        ) : (
          <ul className="space-y-1.5">
            {view.signals.slice(0, 6).map((signal, index) => (
              <li
                key={`${signal.kind}-${index}`}
                className="flex items-start gap-2 text-[12px] leading-snug"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                    PRIORITY_DOT[signal.priority],
                  )}
                  title={`${PRIORITY_LABEL[signal.priority]} prioritet`}
                />
                <span
                  className={cn(
                    SIGNAL_TONE[signal.kind] === 'alert'
                      ? 'text-content'
                      : 'text-content-muted',
                  )}
                >
                  {signalText(signal).signal}
                </span>
              </li>
            ))}
          </ul>
        )}
      </RailSection>

      <RailSection title="Öppna åtaganden" meta={String(view.openCommitments.length)}>
        {view.openCommitments.length === 0 ? (
          <p className="type-inst-sub px-1">Inga öppna åtaganden.</p>
        ) : (
          <ul className="space-y-1.5">
            {view.openCommitments.slice(0, 5).map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-[12px] leading-snug">
                <div className="min-w-0 flex-1">
                  <p className="text-content">{c.title}</p>
                  <p className={cn('type-machine', c.overdue && 'text-negative')}>
                    {c.dueDate
                      ? c.overdue
                        ? `Försenat · ${formatDayMonth(c.dueDate)}`
                        : `Senast ${formatDayMonth(c.dueDate)}`
                      : 'Inget datum'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void onCompleteCommitment(c.id)}
                  className="type-machine shrink-0 rounded-[3px] border border-line px-1.5 py-0.5 text-content-subtle transition-colors hover:border-institution-line hover:text-institution"
                  aria-label={`Markera "${c.title}" som klart`}
                >
                  Klart
                </button>
              </li>
            ))}
          </ul>
        )}
      </RailSection>

      <RailSection title="Kommande">
        {view.upcomingEvents.length === 0 ? (
          <p className="type-inst-sub px-1">Inga kommande händelser.</p>
        ) : (
          <ul className="space-y-1">
            {view.upcomingEvents.slice(0, 6).map((event) => (
              <li key={event.id} className="flex items-baseline gap-2 text-[12px]">
                <span className="tabular w-11 shrink-0 text-content">
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
      </RailSection>

      <RailSection
        title="Möjligheter"
        meta={
          openings.length > 0
            ? formatMsek(openings.reduce((s, o) => s + o.potentialValue, 0))
            : undefined
        }
      >
        {openings.length === 0 ? (
          <p className="type-inst-sub px-1">Inga aktiva möjligheter.</p>
        ) : (
          <ul className="space-y-1">
            {openings.map((o) => (
              <li
                key={o.id}
                className="flex items-baseline justify-between gap-2 text-[12px]"
              >
                <span className="min-w-0 truncate text-content-muted">{o.title}</span>
                <span className="tabular shrink-0 text-content">
                  {formatMsek(o.potentialValue)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </RailSection>

      {/* Risks last: the score, and every driver behind it — never a bare number. */}
      <RailSection title="Relationshälsa" meta={`${view.health.method}`}>
        <div className="px-1">
          <HealthScore health={view.health} size="lg" />
          <HealthBar health={view.health} className="mt-1.5" />
          <div className="mt-2">
            <HealthDrivers health={view.health} />
          </div>
        </div>
      </RailSection>
    </aside>
  )
}

function RailSection({
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
      <header className="ref-head">
        <h2 className="type-section">{title}</h2>
        {meta && <span className="type-machine">{meta}</span>}
      </header>
      <div className="p-2">{children}</div>
    </section>
  )
}
