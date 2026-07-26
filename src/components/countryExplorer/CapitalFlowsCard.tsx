import { useEffect, useState } from 'react'
import { feature } from 'topojson-client'
import type { Feature, Geometry, Position } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { GLOBAL_CAPITAL_FLOWS } from '~/data/countryExplorer/globalCapitalFlows'
import { cn } from '~/lib/cn'
import { formatNumber } from '~/lib/format'

const WORLD_ATLAS_URL = '/data/countries-110m.json'
const VIEW_W = 360
const VIEW_H = 168
// Crop the empty polar bands so the continents fill the frame.
const TOP_LAT = 78
const BOTTOM_LAT = -58

function project(lng: number, lat: number): [number, number] {
  const x = ((lng + 180) / 360) * VIEW_W
  const y = ((TOP_LAT - lat) / (TOP_LAT - BOTTOM_LAT)) * VIEW_H
  return [x, y]
}

function ringToPath(ring: Position[]): string {
  return ring
    .map(([lng = 0, lat = 0], index) => {
      const [x, y] = project(lng, lat)
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join('')
}

/** Flattens the world topojson into one equirectangular SVG path (all rings). */
function buildLandPath(features: Array<Feature<Geometry>>): string {
  const parts: string[] = []
  for (const f of features) {
    const geometry = f.geometry
    if (geometry.type === 'Polygon') {
      for (const ring of geometry.coordinates) parts.push(ringToPath(ring) + 'Z')
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates)
        for (const ring of polygon) parts.push(ringToPath(ring) + 'Z')
    }
  }
  return parts.join('')
}

/** Approximate visual anchor for each flow region on the map. */
const REGION_ANCHOR: Record<string, [number, number]> = {
  'N. America': [-100, 45],
  Europe: [15, 50],
  Asia: [95, 30],
  Oceania: [134, -25],
}

/**
 * Net capital flow by region, reference-style: a dot-matrix world map (real
 * world-atlas topojson, equirectangular) with green/red flow bars rising from
 * each region, and a labeled totals row beneath. Same real mock data as
 * before — only the presentation changed.
 */
export function CapitalFlowsCard() {
  const [landPath, setLandPath] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(WORLD_ATLAS_URL)
      .then((res) => res.json())
      .then((topology: Topology) => {
        if (cancelled) return
        const countriesObject = topology.objects.countries as GeometryCollection
        const collection = feature(topology, countriesObject)
        setLandPath(buildLandPath(collection.features as Array<Feature<Geometry>>))
      })
      .catch((error: unknown) => {
        console.error('Kunde inte läsa in kartan för kapitalflöden:', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const maxAbs = Math.max(
    ...GLOBAL_CAPITAL_FLOWS.map((r) => Math.abs(r.netFlowBillionsUsd)),
  )

  return (
    <DashboardCard
      dense
      title="Capital Flows (24H)"
      className="h-[400px] transition-shadow duration-200 hover:shadow-[0_0_28px_rgba(77,232,245,0.12)]"
      bodyClassName="flex min-h-0 flex-col"
    >
      <p className="hud-label -mt-1.5 mb-2 text-[9px] text-content-subtle">
        Net flow by region (USD)
      </p>

      <div className="flex min-h-0 flex-1 items-center">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-auto w-full"
          role="img"
          aria-label="Världskarta med nettokapitalflöde per region"
        >
          <defs>
            <pattern id="cf-dots" width="4" height="4" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.75" fill="rgba(77,232,245,0.3)" />
            </pattern>
            {landPath && (
              <clipPath id="cf-land">
                <path d={landPath} />
              </clipPath>
            )}
          </defs>

          {landPath && (
            <rect
              width={VIEW_W}
              height={VIEW_H}
              fill="url(#cf-dots)"
              clipPath="url(#cf-land)"
            />
          )}

          {GLOBAL_CAPITAL_FLOWS.map((flow) => {
            const anchor = REGION_ANCHOR[flow.region]
            if (!anchor) return null
            const [x, y] = project(anchor[0], anchor[1])
            const isPositive = flow.netFlowBillionsUsd >= 0
            const barHeight =
              (Math.abs(flow.netFlowBillionsUsd) / maxAbs) * 46 + 4
            const color = isPositive ? '#2ecc84' : '#f2555a'
            return (
              <g key={flow.region}>
                <rect
                  x={x - 5}
                  y={isPositive ? y - barHeight : y}
                  width={4}
                  height={barHeight}
                  rx={1}
                  fill={color}
                  opacity={0.35}
                />
                <rect
                  x={x - 1.5}
                  y={isPositive ? y - barHeight : y}
                  width={3}
                  height={barHeight}
                  rx={1}
                  fill={color}
                />
                <circle cx={x} cy={y} r={1.8} fill={color} />
              </g>
            )
          })}
        </svg>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-2 border-t border-line pt-2">
        {GLOBAL_CAPITAL_FLOWS.map((flow) => {
          const isPositive = flow.netFlowBillionsUsd >= 0
          return (
            <div key={flow.region} className="min-w-0">
              <p className="hud-label truncate text-[8px] text-content-subtle">
                {flow.region}
              </p>
              <p
                className={cn(
                  'tabular font-mono text-xs',
                  isPositive ? 'text-positive' : 'text-negative',
                )}
              >
                {isPositive ? '+' : '−'}
                {formatNumber(Math.abs(flow.netFlowBillionsUsd), 1)}B
              </p>
            </div>
          )
        })}
      </div>
    </DashboardCard>
  )
}
