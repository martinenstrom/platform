import { cn } from '~/lib/cn'
import type { NewsFilter, NewsSort } from '~/types/countryExplorer'

const FILTERS: { value: NewsFilter; label: string }[] = [
  { value: 'all', label: 'Alla' },
  { value: 'macro', label: 'Makro' },
  { value: 'central-bank', label: 'Centralbank' },
  { value: 'politics', label: 'Politik' },
  { value: 'regulation', label: 'Reglering' },
  { value: 'markets', label: 'Marknad' },
  { value: 'companies', label: 'Bolag' },
  { value: 'geopolitics', label: 'Geopolitik' },
]

const SORTS: { value: NewsSort; label: string }[] = [
  { value: 'recent', label: 'Senaste' },
  { value: 'importance', label: 'Vikt' },
  { value: 'impact', label: 'Marknadspåverkan' },
]

export function CountryNewsFilters({
  filter,
  onFilterChange,
  sort,
  onSortChange,
}: {
  filter: NewsFilter
  onFilterChange: (filter: NewsFilter) => void
  sort: NewsSort
  onSortChange: (sort: NewsSort) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrera nyheter">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onFilterChange(option.value)}
            aria-pressed={filter === option.value}
            className={cn(
              'hud-label rounded-md px-2.5 py-1 text-[9px] transition-colors duration-150',
              filter === option.value
                ? 'hud-frame bg-accent-soft text-accent'
                : 'text-content-subtle hover:text-content',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className="hud-label flex items-center gap-2 text-[9px] text-content-subtle">
        Sortera
        <select
          value={sort}
          onChange={(event) => onSortChange(event.target.value as NewsSort)}
          className="hud-frame rounded-md bg-surface-2 px-2 py-1 text-content"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
