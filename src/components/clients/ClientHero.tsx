import type { Client360 } from '~/application/advisory/client360'
import { cn } from '~/lib/cn'
import {
  formatDayMonth,
  formatDaysFromToday,
  formatLongDate,
  formatMsek,
  yearOf,
} from '~/presentation/advisory/format'
import { nextBestActionText, signalText } from '~/presentation/advisory/intelligenceText'
import { INTERACTION_LABEL, SEGMENT_LABEL } from '~/presentation/advisory/text'
import { HealthScore } from './HealthIndicator'
import { JarvisMark } from './JarvisBlock'

/**
 * The relationship header — who this is, since when, with whom, how large
 * the relationship is, how it stands, when you last spoke and when you next
 * will — and then the one thing to do next: what, why and by when, as the
 * most visible element on the page. Two doors beside it: prepare the
 * meeting, add what happened.
 *
 * No wall of cards, no photograph: the client's information is the focus.
 */
export function ClientHero({
  view,
  onPrepareMeeting,
  onAddUpdate,
  activeDoor,
}: {
  view: Client360
  onPrepareMeeting: () => void
  onAddUpdate: () => void
  activeDoor: 'update' | 'prep' | null
}) {
  const {
    client,
    advisor,
    health,
    lastContact,
    nextMeeting,
    nextBestAction,
    balanceSheet,
  } = view
  return (
    <header className="ref-panel inst-edge px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.015em] text-content">
            {client.displayName}
          </h1>
          <p className="type-inst-sub mt-1">
            {SEGMENT_LABEL[client.segment]} · Relation sedan{' '}
            {yearOf(client.relationshipSince)} · Ansvarig rådgivare{' '}
            {advisor?.displayName ?? client.primaryAdvisorId}
          </p>
          <dl className="mt-3 flex flex-wrap gap-x-7 gap-y-2">
            <div>
              <dt className="type-section">AUM</dt>
              <dd className="tabular mt-0.5 text-[15px] font-semibold text-content">
                {formatMsek(balanceSheet.assetsWithBank)}
                <span className="type-inst-sub ml-1.5">
                  av {formatMsek(balanceSheet.totalAssets)}
                </span>
              </dd>
            </div>
            <div>
              <dt className="type-section">Relationshälsa</dt>
              <dd className="mt-0.5">
                <HealthScore health={health} />
              </dd>
            </div>
            <div>
              <dt className="type-section">Senaste kontakt</dt>
              <dd className="mt-0.5 text-[15px] font-semibold text-content">
                {lastContact ? (
                  <>
                    {formatDayMonth(lastContact.date)}
                    <span className="type-inst-sub ml-1.5">
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
            <div>
              <dt className="type-section">Nästa möte</dt>
              <dd className="mt-0.5 text-[15px] font-semibold text-content">
                {nextMeeting ? (
                  <>
                    {formatDayMonth(nextMeeting.occursOn)}
                    <span className="type-inst-sub ml-1.5">
                      {formatDaysFromToday(nextMeeting.daysAhead)}
                    </span>
                  </>
                ) : (
                  <span className="type-inst-sub">Inget bokat</span>
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-col lg:items-stretch">
          <button
            type="button"
            onClick={onPrepareMeeting}
            aria-pressed={activeDoor === 'prep'}
            className={cn(
              'type-section rounded-[4px] border px-3.5 py-2 text-center transition-colors',
              activeDoor === 'prep'
                ? 'border-institution bg-institution-soft text-institution'
                : 'border-institution-line bg-institution-soft/60 text-institution hover:bg-institution-soft',
            )}
          >
            Förbered möte
          </button>
          <button
            type="button"
            onClick={onAddUpdate}
            aria-pressed={activeDoor === 'update'}
            className={cn(
              'type-section rounded-[4px] border border-line px-3.5 py-2 text-center text-content-muted transition-colors hover:border-line-strong hover:text-content',
              activeDoor === 'update' && 'border-hud-line bg-accent-soft text-accent',
            )}
          >
            Lägg till klientuppdatering
          </button>
        </div>
      </div>

      {/*
       * The next best action: what, why, when. The one element on the page
       * that may carry a filled institutional ground, because it is the one
       * thing the advisor is meant to do.
       */}
      <section
        aria-label="Nästa bästa åtgärd"
        className="mt-3 rounded-[4px] border border-institution-line bg-institution-soft/35 px-3.5 py-2.5 shadow-[inset_2px_0_0_0_var(--color-institution)]"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <JarvisMark kind="recommends" />
          {nextBestAction && (
            <span className="type-machine">
              brådska {nextBestAction.urgency}/5 · {nextBestAction.method}
            </span>
          )}
        </div>
        {nextBestAction ? (
          <>
            <p className="mt-1 text-[17px] font-medium leading-snug text-content">
              {nextBestActionText(nextBestAction)}
            </p>
            <dl className="mt-1.5 flex flex-wrap gap-x-6 gap-y-0.5 text-[12.5px]">
              <div className="flex gap-1.5">
                <dt className="type-section shrink-0 pt-0.5">Därför</dt>
                <dd className="text-content-muted">
                  {signalText(nextBestAction.signal).signal}
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="type-section shrink-0 pt-0.5">När</dt>
                <dd className="text-content-muted">
                  {nextBestAction.dueDate
                    ? `senast ${formatLongDate(nextBestAction.dueDate)}`
                    : nextMeeting
                      ? `före mötet ${formatDayMonth(nextMeeting.occursOn)}`
                      : 'vid nästa kontakt'}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="type-inst-sub mt-1">
            Ingen åtgärd rekommenderas just nu. Relationen kräver ingenting av dig i dag.
          </p>
        )}
      </section>
    </header>
  )
}
