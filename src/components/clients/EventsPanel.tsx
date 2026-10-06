import { Flag } from 'lucide-react'
import type { Client360 } from '~/application/advisory/client360'
import { cn } from '~/lib/cn'
import {
  formatDayMonth,
  formatDaysFromToday,
  formatLongDate,
  yearOf,
} from '~/presentation/advisory/format'
import { EVENT_LABEL } from '~/presentation/advisory/text'
import { Module } from './dossier/Module'

/**
 * What is coming: every upcoming event with its date, its distance and the
 * reminders it will raise — and the reminders already due within sixty
 * days, derived from those rules rather than stored. Phase 1 stores and
 * shows; notification channels come later.
 */
export function EventsPanel({
  view,
  className,
}: {
  view: Client360
  className?: string
}) {
  const titles = new Map(view.upcomingEvents.map((e) => [e.id, e.title]))
  return (
    <Module
      id="handelser"
      title="Viktiga händelser"
      icon={Flag}
      meta={`${view.upcomingEvents.length} kommande`}
      className={className}
    >
      <ol className="flex flex-col" aria-label="Kommande händelser">
        {view.upcomingEvents.map((event) => (
          <li key={event.id} className="dossier-row flex items-start gap-3 py-2.5">
            <div className="w-12 shrink-0">
              <p className="tabular text-[13px] font-semibold text-content">
                {formatDayMonth(event.occursOn)}
              </p>
              <p className="type-machine">{yearOf(event.occursOn)}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={cn(
                    'type-section',
                    event.importance === 'high' && 'text-institution',
                  )}
                >
                  {EVENT_LABEL[event.type]}
                </span>
                <span className="type-machine">
                  {formatDaysFromToday(event.daysAhead)}
                </span>
                {event.recurring === 'yearly' && (
                  <span className="type-machine">årligen</span>
                )}
              </p>
              <p className="text-[13px] leading-snug text-content">{event.title}</p>
              {event.notes && <p className="type-inst-sub mt-0.5">{event.notes}</p>}
              {event.reminderRules.length > 0 && (
                <p className="type-machine mt-0.5">
                  Påminnelse{' '}
                  {event.reminderRules
                    .map((rule) => `${rule.daysBefore} dagar före`)
                    .join(', ')}
                </p>
              )}
            </div>
          </li>
        ))}
        {view.upcomingEvents.length === 0 && (
          <li className="type-inst-sub py-1">Inga kommande händelser.</li>
        )}
      </ol>
      <section
        aria-label="Påminnelser inom 60 dagar"
        className="mt-3 border-t border-hairline pt-3"
      >
        <h3 className="type-section">Påminnelser inom 60 dagar</h3>
        {view.reminders.length === 0 ? (
          <p className="type-inst-sub mt-1.5">Inga påminnelser faller inom 60 dagar.</p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {view.reminders.map((reminder) => (
              <li
                key={`${reminder.eventId}-${reminder.daysBefore}`}
                className="flex items-baseline gap-2 text-[12px]"
              >
                <span className="type-machine w-16 shrink-0 text-content">
                  {formatLongDate(reminder.remindAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-content-muted">
                  {titles.get(reminder.eventId) ?? reminder.eventId}
                </span>
                <span className="type-machine shrink-0">
                  {reminder.daysBefore} d före
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Module>
  )
}
