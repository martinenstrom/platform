import { Archive, ChevronRight, History, ListChecks } from 'lucide-react'
import type { Client360 } from '~/application/advisory/client360'
import { cn } from '~/lib/cn'
import { formatLongDate, yearOf } from '~/presentation/advisory/format'
import {
  CLOSURE_REASON_LABEL,
  LIFECYCLE_EVENT_LABEL,
  lifecycleEventDetail,
  ONBOARDING_AREA_LABEL,
} from '~/presentation/advisory/text'
import { Empty, Fact, Foot, Module, ModuleIcon } from '../dossier/Module'

/**
 * A former relationship, stated once at the head of the dossier: when it
 * ended, why, where it belonged and who answered for it. The dossier below
 * reads as history; nothing proactive is asked of the advisor.
 */
export function FormerClientModule({
  view,
  className,
}: {
  view: Client360
  className?: string
}) {
  const closure = view.client.lifecycle.closure
  const lastStretch = [...view.officeHistory].reverse()[0] ?? null
  const officeName =
    (lastStretch && lastStretch.officeId === view.office?.id
      ? view.office?.displayName
      : view.office?.displayName) ?? view.client.officeId
  return (
    <section
      aria-label="Tidigare klient"
      className={cn('ref-panel flex min-w-0 flex-col px-5 pt-4 pb-4', className)}
    >
      <div className="flex items-center gap-2.5">
        <ModuleIcon icon={Archive} />
        <h2 className="type-section text-content">Tidigare klient</h2>
      </div>
      <p className="mt-3 font-display text-[22px] leading-snug text-content">
        Relation avslutad {closure ? formatLongDate(closure.effectiveDate) : '—'}
      </p>
      <p className="type-inst-sub mt-1.5">
        Historisk vy. Inga rekommendationer, prioriteringar eller Sentinel-ärenden ställs
        för en tidigare klient; tidslinje, minne, underlag och historik är läsbara i sin
        helhet.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-hairline pt-3 sm:grid-cols-4">
        <Fact label="Relation avslutad">
          {closure ? formatLongDate(closure.effectiveDate) : '—'}
        </Fact>
        <Fact label="Orsak">{closure ? CLOSURE_REASON_LABEL[closure.reason] : '—'}</Fact>
        <Fact label="Tidigare kontor">{officeName}</Fact>
        <Fact label="PB-relation">
          {yearOf(view.client.relationshipSince)}–
          {closure ? yearOf(closure.effectiveDate) : ''}
        </Fact>
      </dl>
      {closure?.note && <p className="type-inst-sub mt-3 italic">”{closure.note}”</p>}
    </section>
  )
}

/**
 * The onboarding overview: which of the seven areas the record holds
 * something for, counted, never a percentage; and the door that makes the
 * relationship active.
 */
export function OnboardingModule({
  view,
  onActivate,
  className,
}: {
  view: Client360
  onActivate: (() => void) | null
  className?: string
}) {
  const overview = view.onboarding
  return (
    <Module
      title="Onboarding"
      icon={ListChecks}
      meta={
        overview ? `${overview.known} av ${overview.total} områden kartlagda` : undefined
      }
      className={className}
    >
      {!overview ? (
        <Empty>Ingen onboarding att visa.</Empty>
      ) : (
        <>
          <p className="font-display text-[22px] leading-snug text-content">
            {overview.known} av {overview.total} områden kartlagda
          </p>
          <p className="type-inst-sub mt-1.5">
            Relationen räknas inte in i den aktiva boken förrän den aktiveras. Det som
            saknas visas som data saknas — inget uppskattas.
          </p>
          <ul className="mt-4 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {overview.areas.map((area) => (
              <li
                key={area.area}
                className="dossier-row flex items-center justify-between gap-3 py-2 text-[13px]"
              >
                <span className={area.known ? 'text-content' : 'text-content-muted'}>
                  {ONBOARDING_AREA_LABEL[area.area]}
                </span>
                <span
                  className={cn(
                    'type-machine',
                    area.known ? 'text-positive' : 'text-content-subtle',
                  )}
                >
                  {area.known ? 'kartlagt' : 'data saknas'}
                </span>
              </li>
            ))}
          </ul>
          {onActivate && (
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={onActivate}
                className="jarvis-gold-btn dossier-cta"
              >
                Aktivera PB-relation
              </button>
              <span className="type-inst-sub">
                Relationen flyttas till den aktiva boken och ingår i aggregat och
                Sentinel.
              </span>
            </div>
          )}
        </>
      )}
    </Module>
  )
}

/** The relationship's lifecycle, newest first, and its stretches at offices. */
export function LifecycleHistoryModule({
  view,
  className,
}: {
  view: Client360
  className?: string
}) {
  const officeName = (id: string) =>
    view.office?.id === id ? view.office.displayName : id
  /* The names the dossier knows: its office, its advisor. An id nobody can name stays an id. */
  const names: Record<string, string> = {
    ...(view.office ? { [view.office.id]: view.office.displayName } : {}),
    ...(view.advisor ? { [view.advisor.id]: view.advisor.displayName } : {}),
  }
  return (
    <Module
      id="livscykel"
      title="Relationens historik"
      icon={History}
      meta={`${view.lifecycleEvents.length} händelser`}
      className={className}
    >
      {view.lifecycleEvents.length === 0 ? (
        <Empty>Inga livscykelhändelser registrerade.</Empty>
      ) : (
        <ul className="flex flex-col">
          {view.lifecycleEvents.map((event) => (
            <li key={event.id} className="dossier-row flex items-start gap-3 py-2.5">
              <div className="w-20 shrink-0">
                <p className="tabular text-[12.5px] font-semibold text-content">
                  {formatLongDate(event.effectiveDate)}
                </p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug text-content">
                  {LIFECYCLE_EVENT_LABEL[event.kind]}
                </p>
                <p className="type-inst-sub mt-0.5">
                  {lifecycleEventDetail(event.detail, names)}
                </p>
                {event.note && (
                  <p className="type-inst-sub mt-0.5 italic">”{event.note}”</p>
                )}
              </div>
              <ChevronRight
                className="mt-1 h-3.5 w-3.5 shrink-0 text-content-subtle"
                aria-hidden="true"
              />
            </li>
          ))}
        </ul>
      )}
      {view.officeHistory.length > 0 && (
        <Foot>
          kontor:{' '}
          {view.officeHistory
            .map(
              (s) =>
                `${officeName(s.officeId)} ${yearOf(s.from)}–${s.to ? yearOf(s.to) : ''}`,
            )
            .join(' · ')}
        </Foot>
      )}
    </Module>
  )
}
