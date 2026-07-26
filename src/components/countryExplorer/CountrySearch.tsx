import { useEffect, useId, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { searchCountryRegistry } from '~/data/countryExplorer'
import type { CountryRegistryEntry } from '~/types/countryExplorer'

export function CountrySearch({
  onSelectCountry,
}: {
  onSelectCountry: (entry: CountryRegistryEntry) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const results = query.trim() ? searchCountryRegistry(query) : []

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const showResults = open && results.length > 0

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Sök land eller marknad
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-content-subtle"
          aria-hidden="true"
        />
        <input
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={showResults}
          aria-controls={listId}
          autoComplete="off"
          value={query}
          placeholder="Sök land eller marknad…"
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          className="hud-frame h-8 w-full rounded-lg bg-surface pr-3 pl-8 text-xs text-content placeholder:text-content-subtle transition-colors duration-150 hover:bg-surface-2 focus:bg-surface-2"
        />
      </div>

      {showResults && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Sökresultat"
          className="absolute top-10 left-0 z-40 w-full overflow-hidden rounded-lg bg-surface-2 p-1 shadow-pop"
        >
          {results.map((entry) => (
            <li key={entry.countryCode} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setOpen(false)
                  onSelectCountry(entry)
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-150 hover:bg-surface-3"
              >
                <span className="text-lg" aria-hidden="true">
                  {entry.flagEmoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-content">
                    {entry.nameSv}
                  </span>
                  <span className="block truncate text-xs text-content-subtle">
                    {entry.countryCode} · {entry.region}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
