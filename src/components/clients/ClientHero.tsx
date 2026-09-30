import { Link } from '@tanstack/react-router'
import { CalendarCheck2, CalendarDays } from 'lucide-react'
import type { Client360 } from '~/application/advisory/client360'
import {
  formatDaysFromToday,
  formatLongDate,
  formatMsek,
  yearOf,
} from '~/presentation/advisory/format'
import {
  HEALTH_PILL_LABEL,
  INTERACTION_LABEL,
  SEGMENT_LABEL,
  SEGMENT_PILL_LABEL,
} from '~/presentation/advisory/text'
import { ClientPortrait } from './ClientPortrait'

/**
 * The dossier's cover: the portrait in its frame, CLIENT 360, the name in
 * the display face, who they are to the firm, three facts as pills, and the
 * two dates a relationship is measured by. The name carries in from the
 * relationship book (its view-transition name is the client's id) and the
 * frame with it.
 *
 * No doors here: the recommendation panel beside the dossier holds them,
 * because the thing to do next is JARVIS's to say.
 */
export function ClientHero({ view }: { view: Client360 }) {
  const {
    client,
    advisor,
    household,
    office,
    health,
    lastContact,
    nextMeeting,
    balanceSheet,
  } = view
  return (
    <header className="ref-panel px-5 pt-5 pb-4">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <ClientPortrait clientId={client.id} displayName={client.displayName} size="lg" />

        <div className="min-w-0 flex-1">
          <p className="type-section text-institution">Client 360</p>
          <h1
            className="type-display-name mt-1.5"
            style={{ viewTransitionName: `client-${client.id}` }}
          >
            {client.displayName}
          </h1>
          <p className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-content-muted">
            <span>
              {SEGMENT_LABEL[client.segment]} sedan {yearOf(client.relationshipSince)}
            </span>
            {/* The office: relationship metadata, beside the identity and never competing with it. */}
            {office && (
              <>
                <Separator />
                <Link
                  to="/clients/office/$officeId"
                  params={{ officeId: office.id }}
                  className="transition-colors hover:text-content"
                >
                  {office.displayName}
                </Link>
              </>
            )}
            <Separator />
            <span>Rådgivare {advisor?.displayName ?? client.primaryAdvisorId}</span>
            {/* The household, where it is more than the client alone. */}
            {household && household.displayName !== client.displayName && (
              <>
                <Separator />
                <span>{household.displayName}</span>
              </>
            )}
          </p>
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Nyckelfakta">
            <li className="dossier-pill dossier-pill-gold">
              AUM {formatMsek(balanceSheet.assetsWithBank)}
            </li>
            <li className="dossier-pill">{SEGMENT_PILL_LABEL[client.segment]}</li>
            <li className="dossier-pill">{HEALTH_PILL_LABEL[health.band]}</li>
          </ul>
        </div>

        {/* The two dates, beside the identity: not cards, a column of facts. */}
        <dl className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-3 lg:grid-cols-1 lg:border-l lg:border-line lg:pl-5 lg:pt-1">
          <div className="flex items-start gap-2.5">
            <CalendarCheck2
              className="mt-0.5 h-4 w-4 shrink-0 text-[#c9b17a]"
              aria-hidden="true"
              strokeWidth={1.5}
            />
            <div className="min-w-0">
              <dt className="type-section">Senaste kontakt</dt>
              <dd className="mt-0.5 text-[13px] font-medium text-content">
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
          </div>
          <div className="flex items-start gap-2.5">
            <CalendarDays
              className="mt-0.5 h-4 w-4 shrink-0 text-[#c9b17a]"
              aria-hidden="true"
              strokeWidth={1.5}
            />
            <div className="min-w-0">
              <dt className="type-section">Nästa möte</dt>
              <dd className="mt-0.5 text-[13px] font-medium text-content">
                {nextMeeting ? (
                  <>
                    {formatLongDate(nextMeeting.occursOn)}
                    <span className="type-inst-sub block">
                      {formatDaysFromToday(nextMeeting.daysAhead)}
                    </span>
                  </>
                ) : (
                  <span className="type-inst-sub">Ej bokat</span>
                )}
              </dd>
            </div>
          </div>
        </dl>
      </div>
    </header>
  )
}

function Separator() {
  return (
    <span aria-hidden="true" className="text-content-subtle/60">
      |
    </span>
  )
}
