import { useEffect, useId, useRef, useState } from 'react'
import { Menu, RefreshCw, Search, Sparkles } from 'lucide-react'
import { cn } from '~/lib/cn'
import { marketStatus } from '~/data/mockData'
import { marketDataService } from '~/services/marketDataService'
import { Button, IconButton } from '~/components/ui/Button'
import type { Instrument } from '~/types'

const INSTRUMENT_TYPE_LABEL: Record<Instrument['type'], string> = {
  stock: 'Aktie',
  fund: 'Fond',
  etf: 'ETF',
  index: 'Index',
  currency: 'Valuta',
  crypto: 'Krypto',
}

export function AppHeader({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 bg-canvas/90 px-6 backdrop-blur-md">
      <IconButton label="Öppna menyn" onClick={onOpenMobileNav} className="lg:hidden">
        <Menu className="h-4 w-4" aria-hidden="true" />
      </IconButton>

      <InstrumentSearch />

      <div className="ml-auto flex items-center gap-3">
        <MarketStatusIndicator />
        <IconButton label="Uppdatera data">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </IconButton>
        <Button variant="primary" size="sm">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Ny analys
        </Button>
      </div>
    </header>
  )
}

function MarketStatusIndicator() {
  const { isOpen, label, detail } = marketStatus
  return (
    <span
      className="hidden items-center gap-2 text-xs text-content-muted md:inline-flex"
      title={detail}
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          isOpen ? 'bg-positive' : 'bg-content-subtle',
        )}
      />
      {label}
    </span>
  )
}

function InstrumentSearch() {
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Instrument[]>([])
  const [isSearching, setIsSearching] = useState(false)

  // Debounced: when AVANZA_MCP_ENABLED is on, this hits the real Avanza API,
  // so every keystroke would otherwise fire a live network request.
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setIsSearching(false)
      return
    }

    let cancelled = false
    setIsSearching(true)
    const timeout = setTimeout(() => {
      marketDataService.searchInstruments(trimmed).then((instruments) => {
        if (!cancelled) {
          setResults(instruments)
          setIsSearching(false)
        }
      })
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [query])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        inputRef.current?.focus()
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const showResults = open && query.trim().length > 0

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <search>
        <label htmlFor={`${listId}-input`} className="sr-only">
          Sök instrument
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-content-subtle"
            aria-hidden="true"
          />
          <input
            id={`${listId}-input`}
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={showResults}
            aria-controls={listId}
            autoComplete="off"
            value={query}
            placeholder="Sök…"
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            className={cn(
              'h-9 w-full rounded-lg bg-surface pr-14 pl-9 text-sm text-content',
              'placeholder:text-content-subtle transition-colors duration-150',
              'hover:bg-surface-2 focus:bg-surface-2 focus:outline-none',
              '[&::-webkit-search-cancel-button]:appearance-none',
            )}
          />
          <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 font-sans text-[11px] text-content-subtle sm:block">
            ⌘K
          </kbd>
        </div>
      </search>

      {showResults && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Sökresultat"
          className="absolute top-12 left-0 z-40 w-full overflow-hidden rounded-lg bg-surface-2 p-1 shadow-pop"
        >
          {isSearching ? (
            <li className="px-3 py-2.5 text-sm text-content-muted">Söker…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-content-muted">
              Inga träffar för ”{query}”.
            </li>
          ) : (
            results.map((instrument) => (
              <li key={instrument.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery(instrument.name)
                    setOpen(false)
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors duration-150 hover:bg-surface-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-content">
                      {instrument.name}
                    </span>
                    <span className="block text-xs text-content-subtle">
                      {instrument.ticker}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-content-subtle">
                    {INSTRUMENT_TYPE_LABEL[instrument.type]}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
