import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Client360 } from '~/application/advisory/client360'
import { cn } from '~/lib/cn'
import { formatLongDate, formatMsek, yearOf } from '~/presentation/advisory/format'
import {
  HEALTH_PILL_LABEL,
  SEGMENT_LABEL,
  SEGMENT_PILL_LABEL,
} from '~/presentation/advisory/text'
import { ClientPortrait } from './ClientPortrait'

/**
 * The dossier's cover, standing on the room itself: the portrait in its
 * frame, the kicker, the name in the display face as the dominant element,
 * one line saying who they are to the firm, three facts as pills — and,
 * at the right, the two things an advisor does from here: prepare the
 * meeting, add what happened. The administration of the relationship
 * stands behind one restrained menu, never on the cover. No panel behind
 * it: the scene is the cover.
 *
 * A former relationship says so in its pill and offers no meeting to
 * prepare; the dossier beneath reads as history.
 */
export function ClientHero({
  view,
  onAddUpdate,
  updating,
  menu,
}: {
  view: Client360
  onAddUpdate: () => void
  updating: boolean
  /** The overflow menu, where the route provides the lifecycle doors. */
  menu?: ReactNode
}) {
  const { client, advisor, household, office, health, balanceSheet } = view
  const status = client.lifecycle.status
  return (
    <header className="flex flex-col gap-5 px-2 pt-3 pb-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex min-w-0 items-center gap-6 lg:gap-8">
        <ClientPortrait clientId={client.id} displayName={client.displayName} size="xl" />

        <div className="min-w-0">
          <p className="type-section text-institution">
            {status === 'former'
              ? 'Client 360 · Tidigare klient'
              : status === 'onboarding'
                ? 'Client 360 · Onboarding'
                : 'Client 360'}
          </p>
          <h1
            className="type-display-name mt-1.5 text-[52px] leading-none"
            style={{ viewTransitionName: `client-${client.id}` }}
          >
            {client.displayName}
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-display text-[15px] leading-snug text-content-muted">
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
            {status === 'former' ? (
              <li className="dossier-pill">
                Relation avslutad
                {client.lifecycle.closure
                  ? ` ${formatLongDate(client.lifecycle.closure.effectiveDate)}`
                  : ''}
              </li>
            ) : status === 'onboarding' ? (
              <li className="dossier-pill">
                Onboarding sedan {formatLongDate(client.lifecycle.since)}
              </li>
            ) : (
              <li className="dossier-pill">{HEALTH_PILL_LABEL[health.band]}</li>
            )}
          </ul>
        </div>
      </div>

      {/* The acts, at the cover's right: the primary in the gold, the second beside it, the rest behind the menu. */}
      <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end lg:pb-2">
        {status !== 'former' && (
          <Link
            to="/clients/$clientId/meeting-prep"
            params={{ clientId: client.id }}
            className="jarvis-gold-btn dossier-cta"
          >
            Förbered möte
            <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
          </Link>
        )}
        <button
          type="button"
          onClick={onAddUpdate}
          aria-pressed={updating}
          className={cn(
            'jarvis-ghost-btn dossier-cta',
            updating && 'bg-[rgb(255_226_170_/_0.12)]',
          )}
        >
          Lägg till klientuppdatering
        </button>
        {menu}
      </div>
    </header>
  )
}

function Separator() {
  return (
    <span aria-hidden="true" className="text-content-subtle/70">
      ·
    </span>
  )
}
