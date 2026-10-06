import { Link } from '@tanstack/react-router'
import { CalendarDays } from 'lucide-react'
import type { Client360 } from '~/application/advisory/client360'
import { cn } from '~/lib/cn'
import {
  formatDayMonth,
  formatDaysFromToday,
  formatLongDate,
} from '~/presentation/advisory/format'
import { EVENT_LABEL, INTERACTION_LABEL } from '~/presentation/advisory/text'
import { ModuleIcon } from './Module'

const UPCOMING_SHOWN = 3

/**
 * Template 3 — the next meeting. The date the relationship is measured
 * against, in the display face; the two dates behind it (the last contact,
 * the last meeting); what is coming within the horizon; and, with a
 * meeting to prepare for, the door to the pack. Where no meeting is
 * booked the card says so — it does not offer a booking the product has
 * no door for.
 */
export function MeetingCard({
  view,
  className,
}: {
  view: Client360
  className?: string
}) {
  const { nextMeeting, lastContact, lastMeeting, upcomingEvents, client } = view
  const coming = upcomingEvents
    .filter((event) => event.id !== nextMeeting?.id)
    .slice(0, UPCOMING_SHOWN)
  return (
    <section
      aria-label="Nästa möte och kommande"
      className={cn('ref-panel flex min-w-0 flex-col px-5 pt-4 pb-4', className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <ModuleIcon icon={CalendarDays} />
          <div className="min-w-0">
            <h2 className="type-section text-content">Nästa möte</h2>
            <p className="mt-1 font-display text-[22px] leading-none text-content">
              {nextMeeting ? formatLongDate(nextMeeting.occursOn) : 'Ej bokat'}
            </p>
            <p className="type-inst-sub mt-1.5">
              {nextMeeting
                ? `${formatDaysFromToday(nextMeeting.daysAhead)} · ${nextMeeting.title}`
                : 'Inget möte i kalendern. Boka vid nästa kontakt.'}
            </p>
          </div>
        </div>
        {nextMeeting && (
          <Link
            to="/clients/$clientId/meeting-pack"
            params={{ clientId: client.id }}
            search={{ depth: 'full' }}
            className="jarvis-ghost-btn shrink-0 px-3 py-1.5 text-[11.5px]"
          >
            Skapa mötesunderlag
          </Link>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 border-t border-hairline pt-3">
        <div className="min-w-0">
          <dt className="type-section">Senaste kontakt</dt>
          <dd className="mt-1 text-[13px] leading-snug text-content">
            {lastContact ? (
              <>
                {formatLongDate(lastContact.date)}
                <span className="type-inst-sub block">
                  {INTERACTION_LABEL[lastContact.type]}
                  {view.daysSinceContact !== null &&
                    ` · ${formatDaysFromToday(-view.daysSinceContact)}`}
                </span>
              </>
            ) : (
              <span className="type-inst-sub">Ingen kontakt registrerad</span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="type-section">Senaste möte</dt>
          <dd className="mt-1 text-[13px] leading-snug text-content">
            {lastMeeting ? (
              <>
                {formatLongDate(lastMeeting.date)}
                <span className="type-inst-sub block truncate">{lastMeeting.title}</span>
              </>
            ) : (
              <span className="type-inst-sub">Inget möte registrerat</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-4 border-t border-hairline pt-3">
        <p className="type-section">Kommande</p>
        {coming.length === 0 ? (
          <p className="type-inst-sub mt-1.5">Inga fler kommande händelser.</p>
        ) : (
          <ul className="mt-1.5 flex flex-col">
            {coming.map((event) => (
              <li
                key={event.id}
                className="dossier-row flex items-baseline gap-3 py-1.5 text-[12.5px]"
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
      </div>
    </section>
  )
}
