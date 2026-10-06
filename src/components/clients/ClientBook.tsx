import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { ClientDirectoryRow } from '~/application/advisory/clientDirectory'
import { cn } from '~/lib/cn'
import {
  arrangeRows,
  CLIENT_FILTERS,
  CLIENT_SORTS,
  filterCounts,
  filterLabel,
  type ClientFilter,
  type ClientSort,
} from '~/presentation/advisory/directoryView'
import { formatLongDate } from '~/presentation/advisory/format'
import { SEGMENT_LABEL } from '~/presentation/advisory/text'
import { useRecordLabel } from '../platform/recordLabel'
import { ClientCard } from './ClientCard'
import {
  updateDirectoryState,
  useDirectoryState,
  type DirectoryScope,
} from './directoryState'

const ALL_FILTERS: readonly ClientFilter[] = CLIENT_FILTERS.map((f) => f.id)

/**
 * A relationship book: the search, the filters, the order and the cards —
 * the whole book's or one office's, told apart by the scope whose memory
 * it keeps. An office book shows its first row of filters and the rest
 * behind "Fler filter"; the whole book shows them all. A search inside an
 * office book is scoped to the office and offers the whole book beside it.
 */
export function ClientBook({
  rows,
  scope,
  today,
  method,
  showOffice = false,
  primaryFilters = ALL_FILTERS,
  secondaryFilters = [],
  searchEverywhere = false,
  emptyText = 'Inga klienter matchar urvalet.',
}: {
  rows: readonly ClientDirectoryRow[]
  scope: DirectoryScope
  today: string
  method: string
  showOffice?: boolean
  primaryFilters?: readonly ClientFilter[]
  secondaryFilters?: readonly ClientFilter[]
  /** Offer the whole book's search beside this one — inside an office. */
  searchEverywhere?: boolean
  emptyText?: string
}) {
  const { query, filter, sort } = useDirectoryState(scope)
  const [more, setMore] = useState(false)
  const record = useRecordLabel()
  const showSecondary =
    secondaryFilters.length > 0 && (more || secondaryFilters.includes(filter))

  const counts = useMemo(() => filterCounts(rows), [rows])
  const shown = useMemo(
    () =>
      arrangeRows(rows, {
        filter,
        sort,
        query,
        segmentLabelOf: (row) => SEGMENT_LABEL[row.segment],
      }),
    [rows, filter, sort, query],
  )

  const chip = (id: ClientFilter) => (
    <li key={id}>
      <button
        type="button"
        onClick={() => updateDirectoryState(scope, { filter: id })}
        aria-pressed={filter === id}
        className={cn(
          'rounded-chip border px-1.5 py-0.5 text-[11.5px] transition-colors',
          filter === id
            ? 'border-institution-line bg-institution-soft text-institution'
            : 'border-line text-content-muted hover:border-line-strong hover:text-content',
          counts[id] === 0 && filter !== id && 'opacity-50',
        )}
      >
        {filterLabel(id)} <span className="tabular opacity-70">{counts[id]}</span>
      </button>
    </li>
  )

  return (
    <section aria-label="Klientlista" className="flex flex-col gap-2.5">
      <div className="ref-panel flex flex-col gap-2 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <label htmlFor={`client-search-${scope}`} className="sr-only">
              Sök klient
            </label>
            <input
              id={`client-search-${scope}`}
              type="search"
              value={query}
              onChange={(e) => updateDirectoryState(scope, { query: e.target.value })}
              placeholder={
                searchEverywhere
                  ? 'Sök klient på kontoret'
                  : 'Sök klient, kontor eller rådgivare'
              }
              className="hq-field h-8 w-64 max-w-full py-1 text-[12.5px]"
            />
            {searchEverywhere && (
              <Link
                to="/clients"
                search={{ view: 'alla' }}
                onClick={() => updateDirectoryState('all', { query, filter: 'all' })}
                className="type-machine whitespace-nowrap text-content-subtle underline decoration-dotted underline-offset-4 transition-colors hover:text-content"
              >
                Sök i alla klienter
              </Link>
            )}
            <ul className="flex flex-wrap gap-1" aria-label="Filter">
              {primaryFilters.map(chip)}
              {secondaryFilters.length > 0 && (
                <li>
                  <button
                    type="button"
                    onClick={() => setMore((v) => !v)}
                    aria-expanded={showSecondary}
                    className="type-machine rounded-chip border border-dashed border-line px-1.5 py-[3px] text-content-subtle transition-colors hover:border-line-strong hover:text-content"
                  >
                    {showSecondary ? 'Färre filter' : 'Fler filter'}
                  </button>
                </li>
              )}
            </ul>
          </div>
          <label className="flex items-center gap-2">
            <span className="type-section">Sortera</span>
            <select
              value={sort}
              onChange={(e) =>
                updateDirectoryState(scope, { sort: e.target.value as ClientSort })
              }
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
        {showSecondary && (
          <ul
            className="flex flex-wrap gap-1 border-t border-line pt-2"
            aria-label="Fler filter"
          >
            {secondaryFilters.map(chip)}
          </ul>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="ref-panel type-inst-sub px-3 py-8 text-center">{emptyText}</p>
      ) : (
        <ul className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((row) => (
            <li key={row.id} className="min-w-0">
              <ClientCard row={row} showOffice={showOffice} />
            </li>
          ))}
        </ul>
      )}
      <p className="type-machine px-1">
        {shown.length} av {rows.length} klienter · derivat per {formatLongDate(today)} ·{' '}
        {method} · {record}
      </p>
    </section>
  )
}
