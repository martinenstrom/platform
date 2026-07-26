import {
  Activity,
  Bot,
  ChevronUp,
  Factory,
  Landmark,
  Layers,
  Package,
  Percent,
  Ship,
  ShieldAlert,
  Share2,
  TrendingUp,
  Waypoints,
} from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ToggleSwitch } from '~/components/ui/ToggleSwitch'
import { cn } from '~/lib/cn'
import type { HeatmapLayerId } from '~/types/countryExplorer'
import type { GlobalLayerToggles } from './GlobalCommandMap'

interface StructuralToggleDef {
  key: keyof GlobalLayerToggles
  label: string
  icon: typeof Activity
}

const STRUCTURAL_TOGGLES: StructuralToggleDef[] = [
  { key: 'countryBorders', label: 'Landsgränser', icon: Waypoints },
  { key: 'marketStatus', label: 'Marknadsstatus', icon: Activity },
  { key: 'network', label: 'Nätverksaktivitet', icon: Share2 },
]

const HEATMAP_LAYERS: Array<{
  id: HeatmapLayerId
  label: string
  icon: typeof Activity
}> = [
  { id: 'gdp-growth', label: 'BNP-tillväxt', icon: TrendingUp },
  { id: 'inflation', label: 'Inflation', icon: Percent },
  { id: 'policy-rate', label: 'Styrräntor', icon: Landmark },
  { id: 'manufacturing-pmi', label: 'Tillverkning (PMI)', icon: Factory },
  { id: 'political-stability', label: 'Politisk risk', icon: ShieldAlert },
]

/** No live data source exists for these yet — shown disabled with an explanation, never a fabricated heatmap. */
const DISABLED_LAYERS: Array<{ label: string; icon: typeof Activity }> = [
  { label: 'AI-risk', icon: Bot },
  { label: 'Råvaruexponering', icon: Package },
  { label: 'Sjöfartsaktivitet', icon: Ship },
]

interface GlobalDataLayersPanelProps {
  layers: GlobalLayerToggles
  onLayersChange: (layers: GlobalLayerToggles) => void
  activeHeatmap: HeatmapLayerId | null
  onHeatmapChange: (layer: HeatmapLayerId | null) => void
}

/**
 * Docked at the visualization's left boundary. Collapsed by default into a
 * small vertical tab (layers icon + "DATA LAYERS"); the expanded panel slides
 * out hugging the same left edge — smoked dark glass with a dimmed HUD frame
 * (scoped --color-hud-line override) so the globe keeps the visual focus.
 * Collapses via the header chevron, a click anywhere outside, or Escape —
 * never on hover, so it's predictable on keyboard and touch. Same
 * toggles/heatmap logic as always, layout only.
 */
export function GlobalDataLayersPanel({
  layers,
  onLayersChange,
  activeHeatmap,
  onHeatmapChange,
}: GlobalDataLayersPanelProps) {
  // Collapsed by default: the hero reference stacks market HUD panels along
  // the left edge, so the expanded panel is on-demand via the tab.
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    function onPointerDown(event: PointerEvent) {
      const container = containerRef.current
      if (container && event.target instanceof Node && !container.contains(event.target)) {
        setOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Datalager"
        className={cn(
          'hud-frame flex w-10 flex-col items-center gap-2 rounded-lg bg-canvas/70 px-2 py-3 shadow-pop backdrop-blur-xl transition-colors duration-150',
          open ? 'text-accent' : 'text-content-subtle hover:text-content',
        )}
        style={{ '--color-hud-line': 'rgb(77 232 245 / 0.28)' } as CSSProperties}
      >
        <Layers className="h-4 w-4" aria-hidden="true" />
        <span
          aria-hidden="true"
          className="hud-label rotate-180 text-[8px]"
          style={{ writingMode: 'vertical-rl' }}
        >
          Data Layers
        </span>
      </button>

      {/* Positioning lives on this plain wrapper: .hud-frame declares
          position: relative, which would override the `absolute` utility. */}
      <div
        className={cn(
          'absolute top-0 left-0 z-10 transition-all duration-300 ease-out',
          open
            ? 'translate-x-0 opacity-100'
            : 'pointer-events-none -translate-x-2 opacity-0',
        )}
      >
      <div
        className="hud-frame max-h-[32rem] w-48 overflow-y-auto rounded-lg bg-canvas/65 p-2.5 shadow-pop backdrop-blur-xl"
        style={{ '--color-hud-line': 'rgb(77 232 245 / 0.22)' } as CSSProperties}
      >
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="hud-label text-[10px] text-content-subtle">Datalager</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fäll ihop datalager"
            className="text-content-subtle transition-colors duration-150 hover:text-content"
          >
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <ul className="flex flex-col gap-1">
          {STRUCTURAL_TOGGLES.map((toggle) => {
            const Icon = toggle.icon
            return (
              <li key={toggle.key} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs text-content-muted">
                  <Icon className="h-3.5 w-3.5 text-content-subtle" aria-hidden="true" />
                  {toggle.label}
                </span>
                <ToggleSwitch
                  label={toggle.label}
                  labelHidden
                  checked={layers[toggle.key]}
                  onChange={(checked) =>
                    onLayersChange({ ...layers, [toggle.key]: checked })
                  }
                />
              </li>
            )
          })}
        </ul>

        <div className="mt-2.5 border-t border-line pt-2.5">
          <p className="hud-label mb-1 text-[9px] text-content-subtle">Heatmap</p>
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              aria-pressed={activeHeatmap === null}
              onClick={() => onHeatmapChange(null)}
              className={cn(
                'rounded-md px-1.5 py-1 text-left text-xs transition-colors duration-150',
                activeHeatmap === null
                  ? 'bg-accent-soft text-accent'
                  : 'text-content-subtle hover:text-content',
              )}
            >
              Ingen
            </button>
            {HEATMAP_LAYERS.map((layer) => {
              const Icon = layer.icon
              const isActive = activeHeatmap === layer.id
              return (
                <button
                  key={layer.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => onHeatmapChange(layer.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors duration-150',
                    isActive
                      ? 'bg-accent-soft text-accent'
                      : 'text-content-muted hover:bg-surface hover:text-content',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {layer.label}
                </button>
              )
            })}
            {DISABLED_LAYERS.map((layer) => {
              const Icon = layer.icon
              return (
                <div
                  key={layer.label}
                  className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 opacity-50"
                  title="Kräver en ansluten datakälla — inte konfigurerad än"
                >
                  <span className="flex items-center gap-1.5 text-xs text-content-subtle">
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {layer.label}
                  </span>
                  <ToggleSwitch
                    label={`${layer.label} (kräver ansluten datakälla, inte tillgänglig)`}
                    labelHidden
                    checked={false}
                    onChange={() => {}}
                    disabled
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
