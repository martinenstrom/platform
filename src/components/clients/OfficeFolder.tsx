import { Link } from '@tanstack/react-router'
import { ArrowRight, Building2 } from 'lucide-react'
import type { OfficeBook } from '~/application/advisory/officeBook'
import { cn } from '~/lib/cn'
import { formatDayMonth, formatMsek } from '~/presentation/advisory/format'
import { officeStatusLines, officeSummaryText } from '~/presentation/advisory/officeText'
import { JarvisMark } from './JarvisBlock'

/**
 * One office's Private Banking book, closed: the name in the display face,
 * the book's size, who needs attention, the next meeting, what is owed and
 * what is open — real counts, never a score — with JARVIS's one-line
 * reading beneath. Opening it is opening the office's book: the title
 * carries across (its view-transition name is the office's id).
 *
 * A container, not a card: deep navy, a thin cool border, one gold figure,
 * and a slightly richer material under the pointer. No folder clip-art.
 */
export function OfficeFolder({ book }: { book: OfficeBook }) {
  const { office, metrics, summary, clientCount } = book
  const status = officeStatusLines(summary)
  return (
    <Link
      to="/clients/office/$officeId"
      params={{ officeId: office.id }}
      className="client-card office-folder relative flex h-full flex-col px-5 pt-4 pb-4 outline-offset-0"
      aria-label={`Öppna kontor ${office.displayName}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="type-section flex items-center gap-2 text-institution">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.6} />
            Private Banking book
          </p>
          <h3
            className="type-display-name mt-1.5 truncate text-[28px]"
            style={{ viewTransitionName: `office-${office.id}` }}
          >
            {office.displayName}
          </h3>
          <p className="type-inst-sub mt-1">
            {office.city} · {clientCount === 1 ? '1 klient' : `${clientCount} klienter`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="type-display-figure-sm text-[22px] whitespace-nowrap text-institution">
            {formatMsek(metrics.totalAum)}
          </p>
          <p className="type-section mt-1">AUM</p>
        </div>
      </div>

      {/* Two columns, so the labels read whole; the folder grows a row rather than truncating. */}
      <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-line pt-3">
        <Figure label="Total förmögenhet" value={formatMsek(metrics.estimatedWealth)} />
        <Figure
          label="Behöver uppmärksamhet"
          value={String(metrics.needingAttention)}
          tone={metrics.needingAttention > 0 ? 'warning' : undefined}
        />
        <Figure
          label="Möten"
          value={String(metrics.meetingsWithin14Days)}
          note="inom 14 dagar"
        />
        <Figure
          label="Åtaganden"
          value={String(metrics.openCommitments)}
          note={
            metrics.overdueCommitments > 0
              ? `${metrics.overdueCommitments} försenade`
              : 'inga försenade'
          }
          tone={metrics.overdueCommitments > 0 ? 'negative' : undefined}
        />
        <Figure
          label="Möjligheter"
          value={formatMsek(metrics.opportunityValue)}
          note={`${metrics.activeOpportunities} aktiva`}
        />
        <Figure
          label="Nästa möte"
          value={
            metrics.nextMeeting ? formatDayMonth(metrics.nextMeeting.date) : 'Inget bokat'
          }
          note={metrics.nextMeeting?.displayName}
          muted={!metrics.nextMeeting}
        />
      </dl>

      <div className="mt-3 border-t border-line pt-2.5">
        <JarvisMark kind="insight" className="text-[9.5px]" />
        <p className="mt-0.5 text-[12.5px] leading-snug text-content">
          {officeSummaryText(summary)}
        </p>
      </div>

      <div className="mt-auto flex items-end justify-between gap-3 pt-3">
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5" aria-label="Läge">
          {status.map((line) => (
            <li key={line} className="type-machine flex items-center gap-1.5 normal-case">
              <span
                aria-hidden="true"
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  /riskzonen/.test(line)
                    ? 'bg-negative'
                    : /försenat|försenade/.test(line)
                      ? 'bg-negative'
                      : /uppmärksamhet/.test(line)
                        ? 'bg-warning'
                        : 'bg-positive',
                )}
              />
              {line}
            </li>
          ))}
        </ul>
        <span className="type-section flex shrink-0 items-center gap-1.5 text-institution">
          Öppna kontor
          <ArrowRight className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
        </span>
      </div>
    </Link>
  )
}

function Figure({
  label,
  value,
  note,
  tone,
  muted = false,
}: {
  label: string
  value: string
  note?: string
  tone?: 'warning' | 'negative'
  muted?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="type-section truncate">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
        <span
          className={cn(
            'tabular text-[15px] leading-5 font-semibold text-content',
            tone === 'warning' && 'text-warning',
            tone === 'negative' && 'text-negative',
            muted && 'text-content-subtle',
          )}
        >
          {value}
        </span>
        {note && (
          <span
            className={cn(
              'type-machine truncate',
              tone === 'negative' && 'text-negative',
            )}
          >
            {note}
          </span>
        )}
      </dd>
    </div>
  )
}
