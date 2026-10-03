import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  Landmark,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { OfficeBook } from '~/application/advisory/officeBook'
import { cn } from '~/lib/cn'
import { formatDayMonth, formatMsek } from '~/presentation/advisory/format'
import { officePlateUrlOf } from '~/presentation/advisory/officePlates'
import { officeSummaryText } from '~/presentation/advisory/officeText'
import { JarvisMark } from './JarvisBlock'

/**
 * One office's Private Banking book, closed: the street at evening as the
 * tile's plate, the book's size in serif gold on it, the office's name in
 * the display face over its foot, then the six figures a book is read by —
 * real counts, never a score — and JARVIS's one-line reading beneath.
 * Opening it is opening the office's book: the title carries across (its
 * view-transition name is the office's id).
 *
 * The material is the dossier's: deep navy, a thin cool border, one gold
 * figure, a one-pixel lift under the pointer. The plate is presentation —
 * an office without one stands on the navy.
 */
export function OfficeFolder({ book }: { book: OfficeBook }) {
  const { office, metrics, summary, clientCount } = book
  const plate = officePlateUrlOf(office.id)
  return (
    <Link
      to="/clients/office/$officeId"
      params={{ officeId: office.id }}
      className="office-tile group relative flex h-full flex-col outline-offset-0"
      aria-label={`Öppna kontor ${office.displayName}`}
    >
      <div
        className="office-tile-plate relative flex shrink-0 flex-col overflow-hidden"
        data-plate={plate ? office.id : undefined}
      >
        {/*
         * The street at evening — sky, façades, lamps, the water or the road
         * in front — the whole photograph across the tile at its own
         * proportions, never cropped or stretched. The kicker stands on the
         * sky; the name stands on the foreground, which darkens under it.
         */}
        <div className="office-tile-plate-band relative w-full">
          {plate && (
            <div
              className="office-tile-plate-img absolute inset-0"
              style={{ backgroundImage: `url(${plate})` }}
            />
          )}
          <div className="absolute inset-x-0 bottom-0 h-[96px] bg-gradient-to-b from-transparent via-[#0b111c]/40 to-[#0b111c]/85" />
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-4 px-5 pt-4">
            <p className="type-section flex items-center gap-2 text-institution">
              <Landmark className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.6} />
              Private Banking book
            </p>
            <div className="shrink-0 text-right">
              <p className="type-display-figure-sm text-[26px] whitespace-nowrap text-institution">
                {formatMsek(metrics.totalAum)}
              </p>
              <p className="type-section mt-1 text-[#e6c987]/80">AUM</p>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 px-5 pb-2">
            <div className="min-w-0">
              <h3
                className="type-display-name truncate text-[34px]"
                style={{ viewTransitionName: `office-${office.id}` }}
              >
                {office.displayName}
              </h3>
              <p className="type-inst-sub mt-1 text-[13px] text-content-muted">
                {office.city} ·{' '}
                {clientCount === 1 ? '1 klient' : `${clientCount} klienter`}
              </p>
            </div>
            <span className="office-tile-arrow" aria-hidden="true">
              <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <span className="sr-only">Öppna kontor</span>
          </div>
        </div>
      </div>

      {/* Two columns, three rows, cut by hairlines; the folder grows a row rather than truncating. */}
      <dl className="mx-5 grid grid-cols-2 gap-x-6 border-t border-line">
        <Figure
          icon={Wallet}
          label="Total förmögenhet"
          value={formatMsek(metrics.estimatedWealth)}
        />
        <Figure
          icon={null}
          label="Behöver uppmärksamhet"
          value={String(metrics.needingAttention)}
          tone={metrics.needingAttention > 0 ? 'warning' : undefined}
          dot={metrics.needingAttention > 0}
        />
        <Figure
          icon={CalendarDays}
          label="Möten"
          value={String(metrics.meetingsWithin14Days)}
          note="inom 14 dagar"
        />
        <Figure
          icon={ClipboardCheck}
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
          icon={TrendingUp}
          label="Möjligheter"
          value={formatMsek(metrics.opportunityValue)}
          note={`${metrics.activeOpportunities} aktiva`}
          last
        />
        <Figure
          icon={CalendarClock}
          label="Nästa möte"
          value={
            metrics.nextMeeting ? formatDayMonth(metrics.nextMeeting.date) : 'Inget bokat'
          }
          note={metrics.nextMeeting?.displayName}
          muted={!metrics.nextMeeting}
          last
        />
      </dl>

      <div className="office-tile-insight mx-5 mt-auto mb-4 flex items-center gap-3 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <JarvisMark kind="insight" className="text-[9.5px]" />
          <p className="mt-0.5 text-[12.5px] leading-[1.4] text-content">
            {officeSummaryText(summary)}
          </p>
        </div>
        <ArrowRight
          className="h-3.5 w-3.5 shrink-0 text-institution/80 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
          strokeWidth={1.8}
        />
      </div>
    </Link>
  )
}

function Figure({
  icon: Icon,
  label,
  value,
  note,
  tone,
  dot = false,
  muted = false,
  last = false,
}: {
  icon: LucideIcon | null
  label: string
  value: string
  note?: string
  tone?: 'warning' | 'negative'
  dot?: boolean
  muted?: boolean
  last?: boolean
}) {
  return (
    <div className={cn('min-w-0 py-2.5', !last && 'border-b border-line')}>
      <dt className="type-section flex items-center gap-1.5 truncate text-[9.5px]">
        {Icon && (
          <Icon
            className="h-3.5 w-3.5 shrink-0 text-[#c9b17a]/80"
            aria-hidden="true"
            strokeWidth={1.5}
          />
        )}
        {label}
      </dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
        <span
          className={cn(
            'tabular text-[16px] leading-5 font-semibold text-content',
            tone === 'warning' && 'text-warning',
            tone === 'negative' && 'text-negative',
            muted && 'text-content-subtle',
          )}
        >
          {value}
          {dot && (
            <span
              aria-hidden="true"
              className="ml-1.5 inline-block h-1.5 w-1.5 -translate-y-0.5 rounded-full bg-warning"
            />
          )}
        </span>
        {note && (
          <span
            className={cn(
              'type-machine truncate normal-case',
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
