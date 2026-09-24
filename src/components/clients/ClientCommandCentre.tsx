import { useMemo, useState, type CSSProperties } from 'react'
import { Link } from '@tanstack/react-router'
import type {
  ClientDirectory,
  ClientDirectoryRow,
} from '~/application/advisory/clientDirectory'
import { cn } from '~/lib/cn'
import {
  arrangeRows,
  CLIENT_FILTERS,
  CLIENT_SORTS,
  filterCounts,
  type ClientFilter,
  type ClientSort,
} from '~/presentation/advisory/directoryView'
import {
  formatDayMonth,
  formatLongDate,
  formatMsek,
  formatRiskProfile,
  yearOf,
} from '~/presentation/advisory/format'
import { nextBestActionText, signalText } from '~/presentation/advisory/intelligenceText'
import { SEGMENT_LABEL, SEGMENT_SHORT } from '~/presentation/advisory/text'
import { HealthBar, HealthScore } from './HealthIndicator'
import { JarvisMark } from './JarvisBlock'

/**
 * The same photograph the home page stands in front of, used once here at
 * the head of the command centre — atmosphere behind the title band, never
 * behind the information.
 */
const ENVIRONMENT_PHOTO = '/data/wall-street.jpg'

/**
 * Two grids, one row. Below `xl` the row keeps what answers the desk's
 * questions — who, how large, how the relationship stands, when we spoke,
 * when we meet, what is owed, what JARVIS says — and the secondary figures
 * step aside; from `xl` every column is present. The cells hidden below
 * `xl` say so with `hidden xl:block`, so the two templates stay in step.
 */
const COLUMNS =
  'grid-cols-[minmax(170px,2fr)_minmax(72px,0.9fr)_minmax(96px,1.1fr)_minmax(78px,0.9fr)_minmax(72px,0.8fr)_minmax(66px,0.8fr)_minmax(190px,2.4fr)] ' +
  'xl:grid-cols-[minmax(180px,2.2fr)_repeat(4,minmax(74px,1fr))_minmax(44px,0.55fr)_minmax(86px,1fr)_minmax(80px,1fr)_minmax(80px,1fr)_minmax(60px,0.7fr)_minmax(66px,0.8fr)_minmax(80px,1fr)_minmax(200px,2.4fr)]'

const SECONDARY = 'hidden xl:block'

const HEADERS: readonly { label: string; align?: 'right'; secondary?: boolean }[] = [
  { label: 'Klient' },
  { label: 'AUM', align: 'right' },
  { label: 'Förmögenhet', align: 'right', secondary: true },
  { label: 'Likviditet', align: 'right', secondary: true },
  { label: 'Lån', align: 'right', secondary: true },
  { label: 'Risk', align: 'right', secondary: true },
  { label: 'Relationshälsa' },
  { label: 'Senaste kontakt' },
  { label: 'Nästa möte' },
  { label: 'Signaler', secondary: true },
  { label: 'Åtaganden' },
  { label: 'Möjlighet', secondary: true },
  { label: 'JARVIS' },
]

/**
 * The client command centre: every relationship as one dense row, the
 * figures the desk works from, the flags it filters on, and what JARVIS
 * recommends for each — a relationship desk, not a database.
 */
export function ClientCommandCentre({ directory }: { directory: ClientDirectory }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ClientFilter>('all')
  const [sort, setSort] = useState<ClientSort>('priority')

  const counts = useMemo(() => filterCounts(directory.rows), [directory.rows])
  const rows = useMemo(
    () =>
      arrangeRows(directory.rows, {
        filter,
        sort,
        query,
        segmentLabelOf: (row) => SEGMENT_LABEL[row.segment],
      }),
    [directory.rows, filter, sort, query],
  )
  const { metrics } = directory

  const tiles: {
    label: string
    value: string
    tone?: 'warning' | 'negative' | 'accent'
  }[] = [
    { label: 'Klienter', value: String(metrics.totalClients) },
    { label: 'Total AUM', value: formatMsek(metrics.totalAum) },
    { label: 'Total förmögenhet', value: formatMsek(metrics.estimatedWealth) },
    {
      label: 'Behöver åtgärd',
      value: String(metrics.needingAttention),
      tone: metrics.needingAttention > 0 ? 'warning' : undefined,
    },
    { label: 'Möten inom 30 dagar', value: String(metrics.upcomingMeetings) },
    { label: 'Öppna åtaganden', value: String(metrics.openCommitments) },
    {
      label: 'Försenade åtaganden',
      value: String(metrics.overdueCommitments),
      tone: metrics.overdueCommitments > 0 ? 'negative' : undefined,
    },
    {
      label: 'Aktiva möjligheter',
      value: `${metrics.activeOpportunities} · ${formatMsek(metrics.opportunityValue)}`,
      tone: 'accent',
    },
  ]

  return (
    <div className="flex flex-col gap-2">
      <header
        className="ref-environment ref-environment-hero relative overflow-hidden rounded-[5px] border border-line"
        style={{ '--environment-photo': `url(${ENVIRONMENT_PHOTO})` } as CSSProperties}
      >
        <div className="relative px-5 pb-4 pt-8">
          <p className="type-section text-institution">Financial OS · Klienter</p>
          <h1 className="mt-1 text-[26px] font-semibold uppercase leading-none tracking-[0.16em] text-content">
            Klientintelligens
          </h1>
          <p className="type-inst-sub mt-2 max-w-xl text-content-muted">
            Dina private banking-relationer, prioriteringar och möjligheter.
          </p>
        </div>
        <div
          className="ref-environment-seam absolute inset-x-0 bottom-0 h-10"
          aria-hidden="true"
        />
      </header>

      <section aria-label="Nyckeltal" className="ref-panel">
        <dl className="grid grid-cols-2 divide-line sm:grid-cols-4 xl:grid-cols-8 xl:divide-x">
          {tiles.map((tile) => (
            <div key={tile.label} className="min-w-0 px-3 py-2.5">
              <dt className="type-section truncate">{tile.label}</dt>
              <dd
                className={cn(
                  'type-figure mt-1 truncate',
                  tile.tone === 'warning' && 'text-warning',
                  tile.tone === 'negative' && 'text-negative',
                  tile.tone === 'accent' && 'text-accent',
                )}
              >
                {tile.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="ref-panel" aria-label="Klientlista">
        <div className="ref-head flex-wrap gap-y-2 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <label htmlFor="client-search" className="sr-only">
              Sök klient
            </label>
            <input
              id="client-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Sök klient, rådgivare eller segment"
              className="hq-field h-8 w-56 max-w-full py-1 text-[12.5px]"
            />
            <ul className="flex flex-wrap gap-1" aria-label="Filter">
              {CLIENT_FILTERS.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setFilter(f.id)}
                    aria-pressed={filter === f.id}
                    className={cn(
                      'rounded-[3px] border px-1.5 py-0.5 text-[11.5px] transition-colors',
                      filter === f.id
                        ? 'border-institution-line bg-institution-soft text-institution'
                        : 'border-line text-content-muted hover:border-line-strong hover:text-content',
                      counts[f.id] === 0 && filter !== f.id && 'opacity-50',
                    )}
                  >
                    {f.label} <span className="tabular opacity-70">{counts[f.id]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <label className="flex items-center gap-2">
            <span className="type-section">Sortera</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as ClientSort)}
              className="hq-field h-8 py-1 text-[12px]"
            >
              {CLIENT_SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[760px] xl:min-w-[1240px]">
            <div
              className={cn(
                'grid items-end gap-x-3 border-b border-line px-3 py-1.5',
                COLUMNS,
              )}
              role="row"
            >
              {HEADERS.map((header) => (
                <span
                  key={header.label}
                  className={cn(
                    'type-section',
                    header.align === 'right' && 'text-right',
                    header.secondary && SECONDARY,
                  )}
                  role="columnheader"
                >
                  {header.label}
                </span>
              ))}
            </div>
            {rows.length === 0 ? (
              <p className="type-inst-sub px-3 py-6 text-center">
                Inga klienter matchar urvalet.
              </p>
            ) : (
              <ul>
                {rows.map((row) => (
                  <li key={row.id}>
                    <ClientRow row={row} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <p className="type-machine border-t border-line px-3 py-1.5">
          {rows.length} av {directory.rows.length} klienter · derivat per{' '}
          {formatLongDate(directory.today)} · {directory.method} · syntetiska klienter
        </p>
      </section>
    </div>
  )
}

/** "i dag", "i går", "64 dagar" — the silence, in two words at most. */
function silenceLabel(days: number): string {
  if (days === 0) return 'i dag'
  if (days === 1) return 'i går'
  return `${days} dagar`
}

function ClientRow({ row }: { row: ClientDirectoryRow }) {
  const signalTitle =
    row.signals.length > 0
      ? row.signals.map((signal) => `• ${signalText(signal).signal}`).join('\n')
      : undefined
  return (
    <Link
      to="/clients/$clientId"
      params={{ clientId: row.id }}
      className={cn(
        'grid items-center gap-x-3 border-b border-line px-3 py-2 text-[12px] transition-colors hover:bg-surface-2',
        row.flags.needsAttention && 'shadow-[inset_2px_0_0_0_var(--color-warning)]',
        COLUMNS,
      )}
    >
      <span className="min-w-0">
        <span className="type-inst-lg block truncate">{row.displayName}</span>
        <span className="type-inst-sub block truncate">
          {SEGMENT_SHORT[row.segment]} · sedan {yearOf(row.relationshipSince)} ·{' '}
          {row.advisorName}
        </span>
      </span>
      <Figure value={formatMsek(row.aum)} />
      <Figure value={formatMsek(row.estimatedWealth)} muted secondary />
      <Figure value={formatMsek(row.liquidity)} muted secondary />
      <Figure value={row.loans > 0 ? formatMsek(row.loans) : '—'} muted secondary />
      <Figure value={formatRiskProfile(row.riskProfile)} muted secondary />
      <span className="min-w-0">
        <HealthScore health={row.health} size="sm" />
        <HealthBar health={row.health} className="mt-1" />
      </span>
      <span className="min-w-0">
        {row.lastContact ? (
          <>
            <span className="tabular block text-content">
              {formatDayMonth(row.lastContact.date)}
            </span>
            <span
              className={cn(
                'type-machine block',
                (row.daysSinceContact ?? 0) > 60 && 'text-warning',
              )}
            >
              {silenceLabel(row.daysSinceContact ?? 0)}
            </span>
          </>
        ) : (
          <span className="text-content-subtle">—</span>
        )}
      </span>
      <span className="min-w-0">
        {row.nextMeeting ? (
          <span className="tabular block text-content">
            {formatDayMonth(row.nextMeeting)}
          </span>
        ) : (
          <span className="text-content-subtle">Inget bokat</span>
        )}
      </span>
      <span className={cn('min-w-0', SECONDARY)} title={signalTitle}>
        {row.signalCount === 0 ? (
          <span className="text-content-subtle">—</span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'tabular',
                row.highPrioritySignals > 0 ? 'text-warning' : 'text-content',
              )}
            >
              {row.signalCount}
            </span>
            {row.highPrioritySignals > 0 && (
              <span className="type-machine text-warning">
                {row.highPrioritySignals} hög
              </span>
            )}
          </span>
        )}
      </span>
      <span className="min-w-0">
        {row.openCommitments === 0 ? (
          <span className="text-content-subtle">—</span>
        ) : (
          <>
            <span className="tabular text-content">{row.openCommitments}</span>
            {row.overdueCommitments > 0 && (
              <span className="type-machine ml-1.5 text-negative">
                {row.overdueCommitments} försenade
              </span>
            )}
          </>
        )}
      </span>
      <span className={cn('tabular min-w-0 text-content', SECONDARY)}>
        {row.opportunityValue > 0 ? formatMsek(row.opportunityValue) : '—'}
      </span>
      <span className="min-w-0">
        <JarvisMark kind="recommends" className="text-[9.5px]" />
        <span
          className="line-clamp-2 text-content"
          title={row.nextBestAction ? nextBestActionText(row.nextBestAction) : undefined}
        >
          {row.nextBestAction
            ? nextBestActionText(row.nextBestAction)
            : 'Ingen åtgärd rekommenderas'}
        </span>
      </span>
    </Link>
  )
}

function Figure({
  value,
  muted = false,
  secondary = false,
}: {
  value: string
  muted?: boolean
  secondary?: boolean
}) {
  return (
    <span
      className={cn(
        'tabular min-w-0 truncate text-right',
        muted ? 'text-content-muted' : 'text-content',
        secondary && SECONDARY,
      )}
    >
      {value}
    </span>
  )
}
