import type { CSSProperties } from 'react'
import { Sparkline } from '~/components/charts/Sparkline'
import { GLOBAL_MARKET_OVERVIEW } from '~/data/countryExplorer/globalMarketOverview'
import { GERMANY_DATA } from '~/data/countryExplorer/germany'
import { JAPAN_DATA } from '~/data/countryExplorer/japan'
import { marketIndices } from '~/data/mockData'
import { cn } from '~/lib/cn'
import { formatNumber, formatPercent } from '~/lib/format'

interface PanelDatum {
  id: string
  label: string
  value: string
  change: string
  negative: boolean
  sparkline: number[]
}

/**
 * Deterministic decorative trend series for panels whose mock source has no
 * sparkline array — same convention as the rest of the mock layer (plausible,
 * clearly non-live shapes), seeded per panel so renders are stable.
 */
function mockTrend(seed: number, upward: boolean): number[] {
  let a = seed
  const next = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const points: number[] = []
  let level = 100
  for (let i = 0; i < 18; i++) {
    level += (next() - (upward ? 0.42 : 0.58)) * 2.2
    points.push(level)
  }
  return points
}

function indexPanel(id: string, sparkSeed: number): PanelDatum | null {
  const quote = marketIndices.find((q) => q.id === id)
  if (!quote) return null
  return {
    id,
    label: quote.name,
    value: formatNumber(quote.value, quote.precision),
    change: formatPercent(quote.changePercent),
    negative: quote.changePercent < 0,
    sparkline: mockTrend(sparkSeed, quote.changePercent >= 0),
  }
}

function overviewPanel(id: string): PanelDatum | null {
  const indicator = GLOBAL_MARKET_OVERVIEW.find((i) => i.id === id)
  if (!indicator) return null
  return {
    id,
    label: indicator.label,
    value: indicator.value,
    change: indicator.change,
    negative: indicator.tone === 'negative',
    sparkline: indicator.sparkline ?? mockTrend(7, indicator.tone !== 'negative'),
  }
}

function countryIndexPanel(
  id: string,
  markets: { primaryIndexName: string; primaryIndexValue: string; indexChangeToday: string },
  sparkSeed: number,
): PanelDatum {
  const negative = markets.indexChangeToday.trim().startsWith('−') ||
    markets.indexChangeToday.trim().startsWith('-')
  return {
    id,
    label: markets.primaryIndexName,
    value: markets.primaryIndexValue,
    change: markets.indexChangeToday,
    negative,
    sparkline: mockTrend(sparkSeed, !negative),
  }
}

/** Reference layout: four HUD panels stacked on each side of the scene. */
function buildStacks(): { left: PanelDatum[]; right: PanelDatum[] } {
  const left = [
    indexPanel('sp500', 11),
    indexPanel('omxs30', 23),
    countryIndexPanel('dax', GERMANY_DATA.markets!, 31),
    overviewPanel('10y-us-yield'),
  ].filter((p): p is PanelDatum => p !== null)
  const right = [
    countryIndexPanel('nikkei', JAPAN_DATA.markets!, 41),
    indexPanel('usdsek', 53),
    overviewPanel('dxy-index'),
    overviewPanel('vix'),
  ].filter((p): p is PanelDatum => p !== null)
  return { left, right }
}

const STACK_TOPS = ['6%', '29.5%', '53%', '76%']
const TILTS = [1.6, -1.2, 1.1, -1.8]

/**
 * The reference's floating institutional HUD stacks: four smoked-glass market
 * panels per side, suspended with slight 3D tilt and parallax, mini area
 * charts, thin cyan edges. Same real mock quotes as the ticker/overview/
 * country datasets — no invented numbers (trend lines are decorative mock
 * series, like every chart in this app). Decorative layer: pointer-events
 * pass through; the same figures stay accessible in the semantic panels.
 */
export function FloatingMarketChips({ reducedMotion }: { reducedMotion: boolean }) {
  const { left, right } = buildStacks()

  const renderPanel = (panel: PanelDatum, index: number, side: 'left' | 'right') => (
    <div
      key={panel.id}
      className="absolute"
      style={{
        [side]: side === 'left' ? '4.5%' : '25.8%',
        top: STACK_TOPS[index],
        transform: `translate3d(calc(var(--par-x, 0) * ${side === 'left' ? -3 : 3}px), calc(var(--par-y, 0) * -2px), 0)`,
        transition: 'transform 0.5s ease-out',
      }}
    >
      <div
        className={cn(
          side === 'left' ? 'w-36' : 'w-30',
          'rounded-lg border border-[rgba(33,211,255,0.42)] px-2.5 py-2',
          !reducedMotion &&
            'animate-[hologram-float_var(--float-dur)_ease-in-out_infinite]',
        )}
        style={
          {
            background: 'rgba(4, 12, 20, 0.72)',
            boxShadow:
              '0 18px 50px rgba(0,0,0,0.45), 0 0 18px rgba(24,207,244,0.12), inset 0 1px 0 rgba(83,228,255,0.08)',
            backdropFilter: 'blur(6px)',
            rotate: `${TILTS[index] ?? 0}deg`,
            '--float-dur': `${7 + index * 0.8}s`,
            animationDelay: `${index * 1.3}s`,
          } as CSSProperties
        }
      >
        <p className="hud-label text-[9px] tracking-[0.08em] text-[#7fa9bd]">
          {panel.label}
        </p>
        <p className="mt-1 font-mono text-[17px] leading-none font-medium text-[#e9fbff]">
          {panel.value}
        </p>
        <p
          className={cn(
            'mt-0.5 font-mono text-[11px]',
            panel.negative ? 'text-negative' : 'text-positive',
          )}
        >
          {panel.change}
        </p>
        <div className="mt-1.5">
          <Sparkline
            data={panel.sparkline}
            trendUp={!panel.negative}
            width={side === 'left' ? 118 : 96}
            height={18}
            area
          />
        </div>
      </div>
    </div>
  )

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10">
      {left.map((panel, index) => renderPanel(panel, index, 'left'))}
      {right.map((panel, index) => renderPanel(panel, index, 'right'))}
    </div>
  )
}
