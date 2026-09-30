import { Building2 } from 'lucide-react'
import type { OfficeBookView } from '~/application/advisory/officeBook'
import { cn } from '~/lib/cn'
import {
  OFFICE_PRIMARY_FILTERS,
  OFFICE_SECONDARY_FILTERS,
} from '~/presentation/advisory/directoryView'
import { formatDayMonth, formatMsek } from '~/presentation/advisory/format'
import { officeStatusLines, officeSummaryText } from '~/presentation/advisory/officeText'
import { ClientBook } from './ClientBook'
import { officeScope } from './directoryState'
import { JarvisMark } from './JarvisBlock'

/**
 * One office's Private Banking book, open: the office's name in the display
 * face (carried in from its folder), the book's figures in one strip,
 * JARVIS's one-line reading of the office, and the office's relationships
 * as the same cards the whole book uses — scoped to the office, with the
 * whole book's search one step away.
 */
export function OfficeBook({ book }: { book: OfficeBookView }) {
  const { office, metrics, summary, rows } = book
  const figures: {
    label: string
    value: string
    note?: string
    tone?: 'warning' | 'negative'
  }[] = [
    { label: 'AUM', value: formatMsek(metrics.totalAum) },
    { label: 'Total förmögenhet', value: formatMsek(metrics.estimatedWealth) },
    { label: 'Klienter', value: String(metrics.totalClients) },
    {
      label: 'Behöver uppmärksamhet',
      value: String(metrics.needingAttention),
      tone: metrics.needingAttention > 0 ? 'warning' : undefined,
    },
    {
      label: 'Möten',
      value: String(metrics.meetingsWithin14Days),
      note: `inom 14 dagar · ${metrics.upcomingMeetings} inom 30`,
    },
    {
      label: 'Åtaganden',
      value: String(metrics.openCommitments),
      note:
        metrics.overdueCommitments > 0
          ? `${metrics.overdueCommitments} försenade`
          : 'inga försenade',
      tone: metrics.overdueCommitments > 0 ? 'negative' : undefined,
    },
    {
      label: 'Möjligheter',
      value: formatMsek(metrics.opportunityValue),
      note: `${metrics.activeOpportunities} aktiva`,
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-1 pt-5 pb-1">
        <div className="min-w-0">
          <p className="type-section flex items-center gap-2 text-institution">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.6} />
            Office book
          </p>
          <h1
            className="type-display-name mt-1.5 text-[36px]"
            style={{ viewTransitionName: `office-${office.id}` }}
          >
            {office.displayName}
          </h1>
          <p className="mt-2.5 max-w-xl text-[13px] leading-snug text-content-muted">
            Private Banking-relationer kopplade till kontoret
            {office.city ? ` · ${office.city}` : ''}.
          </p>
        </div>
        {metrics.nextMeeting && (
          <p className="type-inst-sub shrink-0 text-right">
            <span className="type-section block">Nästa möte</span>
            <span className="tabular mt-0.5 block text-[13px] font-medium text-content">
              {formatDayMonth(metrics.nextMeeting.date)} ·{' '}
              {metrics.nextMeeting.displayName}
            </span>
          </p>
        )}
      </header>

      <section aria-label="Kontorets nyckeltal" className="ref-panel">
        <dl className="grid grid-cols-3 divide-line sm:divide-x xl:grid-cols-7">
          {figures.map((figure) => (
            <div key={figure.label} className="min-w-0 px-3.5 py-2.5">
              {/* Seven share one row: the smaller label the dossier's strip uses. */}
              <dt className="type-section text-[9.5px] leading-[0.9rem] tracking-[0.09em] whitespace-nowrap">
                {figure.label}
              </dt>
              <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
                <span
                  className={cn(
                    'tabular text-[18px] leading-6 font-semibold tracking-[-0.015em] text-content',
                    figure.tone === 'warning' && 'text-warning',
                    figure.tone === 'negative' && 'text-negative',
                  )}
                >
                  {figure.value}
                </span>
                {figure.note && (
                  <span
                    className={cn(
                      'type-machine',
                      figure.tone === 'negative' && 'text-negative',
                    )}
                  >
                    {figure.note}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* JARVIS's reading of the office: counts, in one line, and the status beneath it. */}
      <section
        aria-label={`JARVIS · ${office.displayName}`}
        className="ref-panel flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5 shadow-[inset_2px_0_0_0_var(--color-hud-line)]"
      >
        <div className="min-w-0">
          <JarvisMark kind="insight" className="text-[9.5px]" />
          <span className="type-machine ml-2 text-content-subtle">
            · {office.displayName}
          </span>
          <p className="mt-0.5 text-[13px] leading-snug text-content">
            {officeSummaryText(summary)}
          </p>
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5" aria-label="Läge">
          {officeStatusLines(summary).map((line) => (
            <li key={line} className="type-machine normal-case">
              {line}
            </li>
          ))}
        </ul>
      </section>

      <ClientBook
        rows={rows}
        scope={officeScope(office.id)}
        today={book.today}
        method={book.method}
        primaryFilters={OFFICE_PRIMARY_FILTERS}
        secondaryFilters={OFFICE_SECONDARY_FILTERS}
        searchEverywhere
        emptyText={
          rows.length === 0
            ? 'Inga klienter är kopplade till kontoret.'
            : 'Inga klienter på kontoret matchar urvalet.'
        }
      />
    </div>
  )
}
