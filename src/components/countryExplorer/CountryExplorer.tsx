import { lazy, Suspense, useEffect, useState } from 'react'
import { Globe2, Hand, Mouse, MousePointerClick } from 'lucide-react'
import { cn } from '~/lib/cn'
import { formatDateTime } from '~/lib/format'
import { countryExplorerService } from '~/services/countryExplorerService'
import { COUNTRY_MOCK_NOW, COUNTRY_REGISTRY } from '~/data/countryExplorer'
import { CountryAnalysis } from './CountryAnalysis'
import { CountryExplorerSkeleton } from './CountryExplorerSkeleton'
import { CountrySearch } from './CountrySearch'
import type { GlobalCommandMapProps, GlobalLayerToggles } from './GlobalCommandMap'
import { GlobalDataLayersPanel } from './GlobalDataLayersPanel'
import { MarketOverviewPanel } from './MarketOverviewPanel'
import { MarketStatusPanel } from './MarketStatusPanel'
import type {
  CountryExplorerView,
  CountryMacroData,
  CountryRegistryEntry,
  HeatmapLayerId,
} from '~/types/countryExplorer'

const DEFAULT_LAYERS: GlobalLayerToggles = {
  countryBorders: true,
  marketStatus: true,
  network: true,
}

// Lazy-loaded: three.js/react-globe.gl is a real chunk of bundle weight and
// isn't needed at all on the WebGL-unavailable fallback path.
const GlobalCommandMap = lazy(() =>
  import('./GlobalCommandMap').then((module) => ({ default: module.GlobalCommandMap })),
)

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl'))
  } catch {
    return false
  }
}

/**
 * The Overview page's flagship "Global Command Center": a real interactive
 * 3D globe (see `GlobalCommandMap`) that morphs into a full country analysis
 * dashboard on click or search, entirely inside this one panel — never a
 * route change. See `~/types/countryExplorer.ts` for the
 * `CountryExplorerView` state machine.
 */
export function CountryExplorer() {
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [view, setView] = useState<CountryExplorerView>({ mode: 'globe' })
  const [entry, setEntry] = useState<CountryRegistryEntry | null>(null)
  const [data, setData] = useState<CountryMacroData | null>(null)
  const [layers, setLayers] = useState<GlobalLayerToggles>(DEFAULT_LAYERS)
  const [activeHeatmap, setActiveHeatmap] = useState<HeatmapLayerId | null>(null)
  const [panelMounted, setPanelMounted] = useState(false)
  const [countriesAvailable, setCountriesAvailable] = useState(COUNTRY_REGISTRY.length)
  // Hidden by default: its four stats are duplicated by the floating HUD
  // stacks, and the hero reference uses floating panels, not a dashboard column.
  const [showMarketOverview, setShowMarketOverview] = useState(false)
  const [showMarketStatus, setShowMarketStatus] = useState(true)

  useEffect(() => {
    setWebglSupported(detectWebGL())

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(media.matches)
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  // Flip a frame after the floating panel mounts so its enter transition
  // actually animates from a starting state rather than snapping in.
  useEffect(() => {
    if (view.mode === 'globe') {
      setPanelMounted(false)
      return undefined
    }
    const id = requestAnimationFrame(() => setPanelMounted(true))
    return () => cancelAnimationFrame(id)
  }, [view.mode])

  function goToGlobe() {
    setView({ mode: 'globe' })
  }

  async function selectCountry(nextEntry: CountryRegistryEntry) {
    setEntry(nextEntry)
    setView({ mode: 'loading-country', countryCode: nextEntry.countryCode })
    try {
      const result = await countryExplorerService.getCountryAnalysis(
        nextEntry.countryCode,
      )
      setData(result)
      setView({ mode: 'country-analysis', countryCode: nextEntry.countryCode })
    } catch (error) {
      console.error('Kunde inte hämta landsanalys:', error)
      setView({
        mode: 'country-error',
        countryCode: nextEntry.countryCode,
        error: 'Kunde inte hämta landsanalysen just nu. Försök igen.',
      })
    }
  }

  // Escape always returns to the map, from any non-globe mode.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && view.mode !== 'globe') goToGlobe()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [view.mode])

  const showingGlobe = view.mode === 'globe'
  const globeProps: GlobalCommandMapProps = {
    onSelectCountry: selectCountry,
    selectedGeoName: entry?.geoName ?? null,
    reducedMotion,
    layers,
    activeHeatmap,
    onCountriesLoaded: setCountriesAvailable,
  }

  return (
    // Seamless command-center section — no card frame; the scene belongs to the page.
    <section className="relative flex h-[820px] flex-col overflow-hidden">
      {/* Subtle animated grid + drifting particles — scoped to this hero, purely decorative. */}
      <div
        aria-hidden="true"
        className="command-center-grid pointer-events-none absolute inset-0"
      />
      <div
        aria-hidden="true"
        className="command-center-particles pointer-events-none absolute inset-0"
      />

      {showingGlobe && (
        <header className="relative flex flex-wrap items-start justify-between gap-4 px-6 pt-5 pb-3">
          <div className="min-w-0">
            <h2 className="hud-label flex items-center gap-2 text-sm text-accent">
              <span className="hud-frame flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              Global Markets // Country Explorer
            </h2>
            <p className="mt-2 max-w-md text-xs leading-relaxed text-content-muted">
              Select a country to analyze its macroeconomy, market conditions, investment
              climate and current developments.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="hud-label inline-flex items-center gap-1.5 rounded border border-line bg-surface/60 px-2 py-1 text-[8px] text-content-subtle">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-positive"
                />
                Live Macro Data
              </span>
              <span className="hud-label rounded border border-line bg-surface/60 px-2 py-1 text-[8px] text-content-subtle">
                Last Updated: {formatDateTime(COUNTRY_MOCK_NOW)} CET
              </span>
              <span className="hud-label rounded border border-line bg-surface/60 px-2 py-1 text-[8px] text-content-subtle">
                Countries Available: {countriesAvailable}
              </span>
            </div>
          </div>
          <CountrySearch onSelectCountry={selectCountry} />
        </header>
      )}

      <div className="relative flex-1">
        {/* Map stays faintly visible behind the floating analysis panel rather than fully hiding — never opacity-0. */}
        <div
          className={cn(
            'absolute inset-0 transition-all duration-500 ease-out',
            showingGlobe
              ? 'scale-100 opacity-100 blur-none'
              : 'pointer-events-none scale-105 opacity-25 blur-sm',
          )}
          aria-hidden={!showingGlobe}
        >
          {webglSupported === false ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="hud-frame max-w-sm rounded-lg bg-surface-2 p-4 text-sm text-content-muted">
                Din enhet eller webbläsare stödjer inte WebGL, så den interaktiva
                3D-jorden kan inte visas. Använd sökrutan ovan för att välja land
                istället.
              </p>
            </div>
          ) : webglSupported === null ? (
            <CountryExplorerSkeleton />
          ) : (
            <Suspense fallback={<CountryExplorerSkeleton />}>
              <GlobalCommandMap {...globeProps} />
            </Suspense>
          )}

          {showingGlobe && webglSupported === true && (
            <>
              <div className="absolute top-2 left-2 z-10">
                <GlobalDataLayersPanel
                  layers={layers}
                  onLayersChange={setLayers}
                  activeHeatmap={activeHeatmap}
                  onHeatmapChange={setActiveHeatmap}
                />
              </div>

              <div className="absolute top-4 right-4 z-10 flex flex-col gap-4">
                {showMarketOverview && (
                  <MarketOverviewPanel onClose={() => setShowMarketOverview(false)} />
                )}
                {showMarketStatus && (
                  <MarketStatusPanel onClose={() => setShowMarketStatus(false)} />
                )}
              </div>

              <p className="hud-label pointer-events-none absolute inset-x-0 bottom-3 z-10 flex items-center justify-center gap-4 text-[9px] text-content-subtle">
                <span className="inline-flex items-center gap-1.5">
                  <Hand className="h-3 w-3" aria-hidden="true" /> Drag to Rotate
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <Mouse className="h-3 w-3" aria-hidden="true" /> Scroll to Zoom
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <MousePointerClick className="h-3 w-3" aria-hidden="true" /> Click a
                  Country to Analyze
                </span>
              </p>
            </>
          )}
        </div>

        {!showingGlobe && (
          <div className="absolute inset-0 flex items-center justify-center p-2">
            <div
              className={cn(
                'hud-frame flex h-[85%] w-[85%] flex-col overflow-hidden rounded-2xl bg-surface/90 p-5 shadow-pop backdrop-blur-xl',
                reducedMotion ? 'duration-0' : 'transition-all duration-[650ms] ease-out',
                panelMounted
                  ? 'scale-100 opacity-100 blur-none'
                  : 'scale-95 opacity-0 blur-sm',
              )}
            >
              {view.mode === 'loading-country' && <CountryExplorerSkeleton />}

              {view.mode === 'country-error' && (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <p className="text-sm text-negative">{view.error}</p>
                  <button
                    type="button"
                    onClick={goToGlobe}
                    className="hud-label text-xs text-accent"
                  >
                    Tillbaka till världskartan
                  </button>
                </div>
              )}

              {view.mode === 'country-analysis' && data && entry && (
                <CountryAnalysis
                  data={data}
                  flagEmoji={entry.flagEmoji}
                  onBack={goToGlobe}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
