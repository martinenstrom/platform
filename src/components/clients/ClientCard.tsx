import { Link } from '@tanstack/react-router'
import type { ClientDirectoryRow } from '~/application/advisory/clientDirectory'
import { cn } from '~/lib/cn'
import { formatDayMonth, formatMsek, yearOf } from '~/presentation/advisory/format'
import { nextBestActionText, signalText } from '~/presentation/advisory/intelligenceText'
import { SEGMENT_LABEL } from '~/presentation/advisory/text'
import { ClientPortrait } from './ClientPortrait'
import { HealthScore } from './HealthIndicator'
import { JarvisMark } from './JarvisBlock'

/** "i dag", "i går", "64 dagar" — the silence, in two words at most. */
function silenceLabel(days: number): string {
  if (days === 0) return 'i dag'
  if (days === 1) return 'i går'
  return `${days} dagar`
}

/**
 * One relationship. The monogram and the name lead and carry into Client
 * 360 (their view-transition names are the client's id); the AUM stands
 * opposite them; four figures beneath; JARVIS's one recommendation at the
 * foot. A two-pixel state edge at the right says only what the rules
 * flagged: at risk of being lost, or in need of attention. Nothing else
 * is coloured. In the whole book the office stands in the meta line, so a
 * cross-office search always says where a relationship belongs.
 */
export function ClientCard({
  row,
  showOffice = false,
}: {
  row: ClientDirectoryRow
  /** Name the office on the card — the whole book does, an office book need not. */
  showOffice?: boolean
}) {
  const state = row.flags.retentionRisk
    ? 'negative'
    : row.flags.needsAttention
      ? 'warning'
      : null
  const signalTitle =
    row.signals.length > 0
      ? row.signals.map((signal) => `• ${signalText(signal).signal}`).join('\n')
      : undefined
  const silent = (row.daysSinceContact ?? 0) > 60
  return (
    <Link
      to="/clients/$clientId"
      params={{ clientId: row.id }}
      className="client-card relative flex h-full flex-col gap-3 px-4 pt-3.5 pb-3 outline-offset-0"
      title={signalTitle}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <ClientPortrait clientId={row.id} displayName={row.displayName} size="sm" />
          <span className="min-w-0">
            <span
              className="block truncate font-display text-[20px] leading-tight font-medium tracking-[-0.005em] text-content"
              style={{ viewTransitionName: `client-${row.id}` }}
            >
              {row.displayName}
            </span>
            <span className="type-inst-sub mt-0.5 block truncate">
              {SEGMENT_LABEL[row.segment]}
              {showOffice && ` · ${row.officeName}`} · PB sedan{' '}
              {yearOf(row.relationshipSince)}
            </span>
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="tabular block text-[17px] leading-tight font-semibold tracking-[-0.012em] text-content">
            {formatMsek(row.aum)}
          </span>
          <span className="type-section mt-1 block">AUM</span>
        </span>
      </div>

      {/* The contact cell carries a date and a silence; it gets the extra width. */}
      <dl className="grid grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,0.95fr)] gap-x-3 border-t border-line pt-2.5">
        <div className="min-w-0">
          <dt className="type-section truncate">Förmögenhet</dt>
          <dd className="tabular mt-0.5 truncate text-[13px] font-medium text-content">
            {formatMsek(row.estimatedWealth)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="type-section truncate">Relation</dt>
          <dd className="mt-0.5 truncate">
            <HealthScore health={row.health} size="sm" />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="type-section truncate">Kontakt</dt>
          <dd className="mt-0.5 truncate text-[13px] font-medium text-content">
            {row.lastContact ? (
              <>
                <span className="tabular">{formatDayMonth(row.lastContact.date)}</span>
                <span className={cn('type-machine ml-1.5', silent && 'text-warning')}>
                  {silenceLabel(row.daysSinceContact ?? 0)}
                </span>
              </>
            ) : (
              <span className="text-content-subtle">—</span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="type-section truncate">Nästa möte</dt>
          <dd className="tabular mt-0.5 truncate text-[13px] font-medium text-content">
            {row.nextMeeting ? (
              formatDayMonth(row.nextMeeting)
            ) : (
              <span className="text-content-subtle">Inget bokat</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-auto border-t border-line pt-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <JarvisMark kind="recommends" className="text-[9.5px]" />
          {row.overdueCommitments > 0 && (
            <span className="type-machine text-negative">
              {row.overdueCommitments} försenade åtaganden
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-content">
          {row.nextBestAction
            ? nextBestActionText(row.nextBestAction)
            : 'Ingen åtgärd rekommenderas'}
        </p>
      </div>

      {state && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-y-3 right-0 w-[2px] rounded-l-full',
            state === 'warning' ? 'bg-warning' : 'bg-negative',
          )}
        />
      )}
    </Link>
  )
}
