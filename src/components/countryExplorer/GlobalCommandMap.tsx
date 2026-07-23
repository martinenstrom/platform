import { useEffect, useMemo, useRef, useState } from 'react'
import Globe, { type GlobeMethods } from 'react-globe.gl'
import { ACESFilmicToneMapping, MeshBasicMaterial, Vector2, type PerspectiveCamera } from 'three'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { feature } from 'topojson-client'
import type { Feature, Geometry } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { resolveCountryByGeoName } from '~/data/countryExplorer'
import { GLOBAL_HEADLINE_MACRO } from '~/data/countryExplorer/globalHeadlineMacro'
import {
  getMarketStatus,
  MARKET_CENTERS,
  type MarketCenter,
  type MarketStatusValue,
} from '~/data/countryExplorer/marketCenters'
import { GERMANY_DATA } from '~/data/countryExplorer/germany'
import { JAPAN_DATA } from '~/data/countryExplorer/japan'
import { SWEDEN_DATA } from '~/data/countryExplorer/sweden'
import { USA_DATA } from '~/data/countryExplorer/usa'
import {
  attachSceneLayers,
  createAtmosphereLayer,
  createCloudLayer,
  createDayNightMaterial,
  sunPositionAt,
  type AtmosphereLayer,
  type CloudLayer,
  type DayNightMaterial,
} from './globeLayers'
import { FloatingMarketChips } from './FloatingMarketChips'
import {
  createAmbientParticles,
  createBullMount,
  createEnvironment,
  createHoloRings,
  createProjectionBeam,
  createProjectorPlatform,
  type HologramSceneLayer,
} from './holographicProjector'
import type {
  CountryHeadlineMacro,
  CountryRegistryEntry,
  HeatmapLayerId,
} from '~/types/countryExplorer'

const WORLD_ATLAS_URL = '/data/countries-110m.json'
const MARKET_STATUS_REFRESH_MS = 60_000
const AUTO_ROTATE_RESUME_DELAY_MS = 3000
// OrbitControls: autoRotateSpeed 2.0 = 30 s/revolution, so 0.75 ≈ 80 s — inside
// the 70-100 s target band.
const BASE_AUTO_ROTATE_SPEED = 0.75
const BASE_CLOUD_ROTATION_PER_MS = -0.000015 // deg/ms, independent of the globe/camera
const IS_LOW_POWER_DEVICE = typeof window !== 'undefined' && window.innerWidth < 768
// three-globe renders the sphere at radius 100. The canvas spans the entire
// visualization area (no rectangular scene boundary); the default altitude
// frames the globe at ~half the area height, and a camera view-offset places
// it left of center in the workspace between the Data Layers rail and the
// right-side panels. The min/max clamps keep zoom from clipping through the
// Earth or shrinking it away behind the panels.
const DEFAULT_ALTITUDE = 2.85
const GLOBE_VIEW_OFFSET_X = 0.08 // fraction of width the globe sits left of center
const GLOBE_VIEW_OFFSET_Y = 0.04 // fraction of height the globe sits above center
// Camera starts above the equatorial plane so the in-scene projector platform
// below the globe reads as foreshortened ellipses instead of an edge-on line,
// and over Europe/Africa so the densest route clusters face the viewer.
const DEFAULT_CAMERA_LAT = 18
const DEFAULT_CAMERA_LNG = 15
const MIN_CAMERA_DISTANCE = 160 // ~0.6 altitude — can't push into the surface
const MAX_CAMERA_DISTANCE = 480 // ~3.8 altitude — can't zoom out to a dot
// Foreground Charging-Bull model: set to '/data/globe/charging-bull.glb' once a
// LICENSED model file is added there (see createBullMount) — null = no request.
const BULL_MODEL_URL: string | null = null

type CountryFeature = Feature<Geometry, { name: string }>

export interface GlobalLayerToggles {
  countryBorders: boolean
  marketStatus: boolean
  network: boolean
}

interface MarketPoint {
  center: MarketCenter
  status: MarketStatusValue
}

/** Each hub renders two ripple layers: a slow wide pulse and a quick small "burst" every few seconds. */
interface MarketRingDatum extends MarketPoint {
  burst: boolean
}

const MARKET_STATUS_COLOR: Record<MarketStatusValue, string> = {
  OPEN: '#2ecc84',
  'PRE-MARKET': '#eaa73c',
  'AFTER-HOURS': '#8b7bf5',
  CLOSED: '#6b7686',
}

const MARKET_STATUS_LABEL: Record<MarketStatusValue, string> = {
  OPEN: 'Öppen',
  'PRE-MARKET': 'Förhandel',
  'AFTER-HOURS': 'Efterhandel',
  CLOSED: 'Stängd',
}

const CAP_COLOR = {
  base: 'rgba(0, 0, 0, 0)',
  hover: 'rgba(77, 232, 245, 0.25)',
  selected: 'rgba(77, 232, 245, 0.38)',
}
const STROKE_COLOR = {
  // Restrained cyan country outlines — minimal-glow tier so the financial
  // network stays the scene's hero; brighter on hover/select (bloom turns
  // the bright states into glowing wireframes).
  base: 'rgba(56, 217, 255, 0.5)',
  hover: '#4de8ff',
}

/** Placeholder while the real day/night textures are still loading. */
const LOADING_MATERIAL = new MeshBasicMaterial({ color: '#0a0d12' })

/**
 * Real per-country index data only exists for the four full-tier countries —
 * every other hub honestly shows "index data not available" rather than a
 * fabricated number.
 */
const HUB_MARKET_DATA: Partial<
  Record<string, { indexName: string; indexValue: string; changeToday: string }>
> = {
  stockholm: {
    indexName: SWEDEN_DATA.markets!.primaryIndexName,
    indexValue: SWEDEN_DATA.markets!.primaryIndexValue,
    changeToday: SWEDEN_DATA.markets!.indexChangeToday,
  },
  'new-york': {
    indexName: USA_DATA.markets!.primaryIndexName,
    indexValue: USA_DATA.markets!.primaryIndexValue,
    changeToday: USA_DATA.markets!.indexChangeToday,
  },
  frankfurt: {
    indexName: GERMANY_DATA.markets!.primaryIndexName,
    indexValue: GERMANY_DATA.markets!.primaryIndexValue,
    changeToday: GERMANY_DATA.markets!.indexChangeToday,
  },
  tokyo: {
    indexName: JAPAN_DATA.markets!.primaryIndexName,
    indexValue: JAPAN_DATA.markets!.primaryIndexValue,
    changeToday: JAPAN_DATA.markets!.indexChangeToday,
  },
}

/**
 * Curated "major corridors" between financial hubs — a stylized "the world's
 * markets are connected" visualization, not sourced trade/capital-flow
 * statistics. Stands in for Trade Routes / Shipping Lanes / Capital Flows,
 * which the request frames mainly as atmosphere/motion rather than analytical
 * data layers.
 */
type ArcTone = 'cyan' | 'teal' | 'blue' | 'amber' | 'red' | 'violet'

/**
 * [from, to, tone] — tone only varies the arc's colour for visual depth, not
 * meaning (there is no sourced flow data behind these). Density is deliberately
 * concentrated around Europe, North America, East Asia and Southeast Asia.
 */
const NETWORK_LINKS: Array<[string, string, ArcTone]> = [
  // Europe internal
  ['london', 'paris', 'cyan'],
  ['paris', 'frankfurt', 'teal'],
  ['london', 'stockholm', 'cyan'],
  ['london', 'zurich', 'teal'],
  ['frankfurt', 'zurich', 'blue'],
  ['stockholm', 'frankfurt', 'cyan'],
  ['london', 'frankfurt', 'blue'],
  ['paris', 'zurich', 'cyan'],
  // Transatlantic
  ['new-york', 'london', 'cyan'],
  ['new-york', 'frankfurt', 'teal'],
  ['new-york', 'paris', 'blue'],
  ['toronto', 'london', 'blue'],
  ['new-york', 'toronto', 'teal'],
  ['new-york', 'sao-paulo', 'amber'],
  ['sao-paulo', 'london', 'blue'],
  ['sao-paulo', 'frankfurt', 'violet'],
  // Europe — Middle East — South Asia
  ['london', 'dubai', 'blue'],
  ['frankfurt', 'dubai', 'cyan'],
  ['paris', 'dubai', 'teal'],
  ['dubai', 'mumbai', 'teal'],
  ['dubai', 'singapore', 'red'],
  ['mumbai', 'singapore', 'cyan'],
  ['london', 'hong-kong', 'violet'],
  ['frankfurt', 'shanghai', 'blue'],
  ['london', 'singapore', 'teal'],
  // East / Southeast Asia
  ['singapore', 'hong-kong', 'teal'],
  ['hong-kong', 'shanghai', 'blue'],
  ['shanghai', 'tokyo', 'cyan'],
  ['hong-kong', 'tokyo', 'teal'],
  ['tokyo', 'singapore', 'blue'],
  ['mumbai', 'hong-kong', 'cyan'],
  // Oceania
  ['tokyo', 'sydney', 'blue'],
  ['singapore', 'sydney', 'cyan'],
  ['hong-kong', 'sydney', 'teal'],
  // Transpacific
  ['new-york', 'tokyo', 'cyan'],
  ['tokyo', 'new-york', 'blue'],
  ['new-york', 'hong-kong', 'amber'],
  ['toronto', 'tokyo', 'teal'],
  ['sydney', 'new-york', 'violet'],
  // Densifying corridors
  ['stockholm', 'new-york', 'blue'],
  ['zurich', 'dubai', 'cyan'],
  ['paris', 'singapore', 'violet'],
  ['toronto', 'frankfurt', 'cyan'],
  ['shanghai', 'singapore', 'teal'],
  ['tokyo', 'mumbai', 'blue'],
  ['dubai', 'hong-kong', 'amber'],
  ['sao-paulo', 'toronto', 'teal'],
  ['zurich', 'singapore', 'blue'],
  // Long orbital corridors
  ['london', 'sydney', 'blue'],
  ['frankfurt', 'singapore', 'cyan'],
  ['paris', 'hong-kong', 'teal'],
  ['stockholm', 'tokyo', 'violet'],
  ['new-york', 'dubai', 'blue'],
  ['mumbai', 'sydney', 'teal'],
  ['shanghai', 'sydney', 'blue'],
  ['zurich', 'hong-kong', 'cyan'],
  // Regional density: Europe / North America / East Asia
  ['stockholm', 'paris', 'teal'],
  ['zurich', 'stockholm', 'blue'],
  ['toronto', 'zurich', 'teal'],
  ['frankfurt', 'tokyo', 'cyan'],
  ['london', 'shanghai', 'blue'],
  ['new-york', 'shanghai', 'violet'],
  ['shanghai', 'mumbai', 'amber'],
  ['paris', 'tokyo', 'blue'],
  ['new-york', 'singapore', 'cyan'],
  ['london', 'mumbai', 'teal'],
  ['stockholm', 'hong-kong', 'cyan'],
  ['zurich', 'tokyo', 'teal'],
  ['paris', 'shanghai', 'blue'],
  ['frankfurt', 'hong-kong', 'teal'],
  ['london', 'tokyo', 'cyan'],
  ['toronto', 'shanghai', 'blue'],
  ['dubai', 'tokyo', 'violet'],
  ['sao-paulo', 'singapore', 'amber'],
  ['stockholm', 'singapore', 'blue'],
  ['zurich', 'shanghai', 'teal'],
  ['paris', 'mumbai', 'cyan'],
  ['stockholm', 'dubai', 'teal'],
  ['zurich', 'mumbai', 'blue'],
  ['toronto', 'singapore', 'cyan'],
  ['frankfurt', 'sydney', 'teal'],
  ['sao-paulo', 'shanghai', 'blue'],
  ['dubai', 'shanghai', 'cyan'],
  ['paris', 'sydney', 'violet'],
  ['sao-paulo', 'dubai', 'amber'],
  ['sydney', 'dubai', 'teal'],
]

/** Per tone: faint base-stream head/tail plus a bright comet color that crosses the bloom threshold. */
const ARC_TONE_COLOR: Record<ArcTone, { base: [string, string]; comet: string }> = {
  cyan: { base: ['rgba(76,198,232,0.42)', 'rgba(76,198,232,0.08)'], comet: 'rgba(76,198,232,0.95)' },
  teal: { base: ['rgba(46,204,132,0.45)', 'rgba(46,204,132,0.09)'], comet: 'rgba(46,204,132,0.9)' },
  blue: { base: ['rgba(54,181,235,0.45)', 'rgba(54,181,235,0.08)'], comet: 'rgba(54,201,255,0.92)' },
  amber: { base: ['rgba(234,167,60,0.45)', 'rgba(234,167,60,0.09)'], comet: 'rgba(234,167,60,0.9)' },
  red: { base: ['rgba(242,85,90,0.42)', 'rgba(242,85,90,0.08)'], comet: 'rgba(242,85,90,0.85)' },
  violet: { base: ['rgba(139,123,245,0.45)', 'rgba(139,123,245,0.09)'], comet: 'rgba(139,123,245,0.9)' },
}

interface ArcDatum {
  id: string
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  color: [string, string] | string
  layer: 'base' | 'comet'
  dashLength: number
  dashGap: number
  animMs: number
  stroke: number
  altScale: number
}

const MARKET_CENTER_BY_ID = new Map(MARKET_CENTERS.map((center) => [center.id, center]))

/**
 * Every route renders twice: a faint, near-solid "stream" that gives the
 * network its persistent shape, and a short bright "comet" pulse travelling
 * along the same path — the flowing-energy look, not a dashed line.
 */
const ARCS_DATA: ArcDatum[] = NETWORK_LINKS.flatMap(([fromId, toId, tone], index) => {
  const from = MARKET_CENTER_BY_ID.get(fromId)
  const to = MARKET_CENTER_BY_ID.get(toId)
  if (!from || !to) return []
  const id = `${fromId}-${toId}`
  const shared = {
    startLat: from.lat,
    startLng: from.lng,
    endLat: to.lat,
    endLng: to.lng,
    altScale: 0.16 + (id.length % 5) * 0.045,
  }
  return [
    {
      ...shared,
      id: `${id}-base`,
      color: ARC_TONE_COLOR[tone].base,
      layer: 'base' as const,
      dashLength: 0.92,
      dashGap: 0.08,
      animMs: 20000 + (index % 5) * 2000,
      stroke: 0.26 + (id.length % 3) * 0.06,
    },
    {
      ...shared,
      id: `${id}-comet`,
      color: ARC_TONE_COLOR[tone].comet,
      layer: 'comet' as const,
      dashLength: 0.045,
      dashGap: 0.955,
      animMs: 1500 + (index % 9) * 380,
      stroke: 0.7,
    },
  ]
})

/** Under reduced motion only the static base streams render — frozen comet dots would read as debris. */
const BASE_ARCS_DATA: ArcDatum[] = ARCS_DATA.filter((arc) => arc.layer === 'base')

function heatmapValue(layer: HeatmapLayerId, macro: CountryHeadlineMacro): number {
  switch (layer) {
    case 'gdp-growth':
      return macro.gdpGrowthPercent
    case 'inflation':
      return macro.inflationPercent
    case 'policy-rate':
      return macro.policyRatePercent
    case 'manufacturing-pmi':
      return macro.manufacturingPmi
    case 'political-stability':
      return macro.politicalStabilityScore
  }
}

/** Single-hue intensity heatmap (dim → bright accent cyan) — magnitude only, no positive/negative tone implied. */
function intensityFill(t: number): string {
  const clamped = Math.min(1, Math.max(0, t))
  const alpha = 0.15 + clamped * 0.65
  return `rgba(77, 232, 245, ${alpha.toFixed(2)})`
}

export interface GlobalCommandMapProps {
  onSelectCountry: (entry: CountryRegistryEntry) => void
  selectedGeoName: string | null
  reducedMotion: boolean
  layers: GlobalLayerToggles
  activeHeatmap: HeatmapLayerId | null
  /** Fires once the real topojson country count is known — used for an honest "X countries available" readout. */
  onCountriesLoaded?: (count: number) => void
}

/**
 * The Global Intelligence flagship view: a real, cinematic 3D globe
 * (react-globe.gl/three.js) with real day/night shading, city lights, a
 * moving cloud layer, and a custom Fresnel atmosphere — auto-rotates when
 * idle, drag to rotate, scroll wheel to zoom. Financial hubs glow and pulse
 * by live-computed market status, a curated network layer arcs between
 * them, and optional heatmap layers colour countries by real headline
 * macro figures. See `globeLayers.ts` for the shader/texture internals.
 */
export function GlobalCommandMap({
  onSelectCountry,
  selectedGeoName,
  reducedMotion,
  layers,
  activeHeatmap,
  onCountriesLoaded,
}: GlobalCommandMapProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<GlobeMethods | undefined>(undefined)
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const cloudsRef = useRef<CloudLayer | null>(null)
  const atmosphereRef = useRef<AtmosphereLayer | null>(null)
  const hologramLayersRef = useRef<HologramSceneLayer[]>([])
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [countries, setCountries] = useState<CountryFeature[]>([])
  const [hoveredGeoName, setHoveredGeoName] = useState<string | null>(null)
  const [marketPoints, setMarketPoints] = useState<MarketPoint[]>([])
  const [dayNightMaterial, setDayNightMaterial] = useState<DayNightMaterial | null>(null)

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(WORLD_ATLAS_URL)
      .then((res) => res.json())
      .then((topology: Topology) => {
        if (cancelled) return
        const countriesObject = topology.objects.countries as GeometryCollection<{
          name: string
        }>
        const collection = feature(topology, countriesObject)
        const features = collection.features as CountryFeature[]
        setCountries(features)
        onCountriesLoaded?.(features.length)
      })
      .catch((error: unknown) => {
        console.error('Kunde inte läsa in världskartan:', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function refresh() {
      const now = new Date()
      setMarketPoints(
        MARKET_CENTERS.map((center) => ({
          center,
          status: getMarketStatus(center, now),
        })),
      )
    }
    refresh()
    const id = setInterval(refresh, MARKET_STATUS_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  // Real day/night shader material — loaded once, independent of country polygons.
  useEffect(() => {
    let cancelled = false
    createDayNightMaterial()
      .then((material) => {
        if (!cancelled) setDayNightMaterial(material)
      })
      .catch((error: unknown) => {
        console.error('Kunde inte läsa in jordtexturer, behåller enkel yta:', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Clouds, custom Fresnel atmosphere and the in-scene holographic projector
  // (platform + beam + ambient particles) — attached directly to the three.js
  // scene once the globe is ready.
  useEffect(() => {
    const scene = globeRef.current?.scene()
    if (!scene || size.width === 0) return
    let cancelled = false
    let detach: (() => void) | null = null

    const globeRadius = globeRef.current!.getGlobeRadius()
    const hologramLayers = [
      createProjectorPlatform(globeRadius),
      createProjectionBeam(globeRadius),
      createAmbientParticles(globeRadius),
      createHoloRings(globeRadius),
      createEnvironment(globeRadius),
    ]
    hologramLayersRef.current = hologramLayers
    hologramLayers.forEach((layer) => scene.add(layer.group))

    // Optional foreground Charging Bull. Parented to the camera so it stays
    // screen-locked at the lower center of the frame, in front of the globe —
    // the reference composition. Enable by dropping a LICENSED model at
    // public/data/globe/charging-bull.glb and setting BULL_MODEL_URL below.
    const camera = globeRef.current!.camera()
    const bull = createBullMount(BULL_MODEL_URL)
    bull.group.position.set(0, -118, -260)
    camera.add(bull.group)
    scene.add(camera)

    Promise.all([
      createCloudLayer(globeRadius, IS_LOW_POWER_DEVICE),
      Promise.resolve(createAtmosphereLayer(globeRadius, IS_LOW_POWER_DEVICE)),
    ]).then(([clouds, atmosphere]) => {
      if (cancelled) {
        clouds.dispose()
        atmosphere.dispose()
        return
      }
      cloudsRef.current = clouds
      atmosphereRef.current = atmosphere
      detach = attachSceneLayers(scene, clouds, atmosphere)
    })

    return () => {
      cancelled = true
      detach?.()
      cloudsRef.current = null
      atmosphereRef.current = null
      hologramLayers.forEach((layer) => {
        scene.remove(layer.group)
        layer.dispose()
      })
      hologramLayersRef.current = []
      camera.remove(bull.group)
      bull.dispose()
    }
    // Only once the globe has finished its first render pass (`size` flips from 0).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width > 0])

  // Selective bloom: a luminance-thresholded UnrealBloomPass on the globe's own
  // post-processing composer (which react-globe.gl already renders through) —
  // the dark Earth body stays below the threshold, so only bright emissives
  // (borders, hubs, arcs, rim, projector, particles) glow. Skipped on
  // low-power devices.
  useEffect(() => {
    const globe = globeRef.current
    if (!globe || size.width === 0 || IS_LOW_POWER_DEVICE) return
    const composer = globe.postProcessingComposer()
    const bloom = new UnrealBloomPass(new Vector2(size.width, size.height), 0.4, 0.5, 0.68)
    // Two alpha fixes so bloom doesn't turn this transparent canvas into an
    // opaque black square: (1) the pass's separable-blur shader hard-codes
    // alpha = 1.0 — rewrite it to carry the glow's own luminance as alpha so
    // empty pixels stay transparent while halos still add up; (2) never let
    // the bloom pass render to screen itself (its base-copy blit uses an
    // opaque MeshBasicMaterial that stamps alpha = 1 across the canvas) — an
    // OutputPass finishes the chain instead, copying alpha faithfully and
    // applying the same sRGB conversion as direct rendering.
    bloom.separableBlurMaterials.forEach((material) => {
      material.fragmentShader = material.fragmentShader.replace(
        'gl_FragColor = vec4( diffuseSum, 1.0 );',
        'gl_FragColor = vec4( diffuseSum, clamp( max( diffuseSum.r, max( diffuseSum.g, diffuseSum.b ) ), 0.0, 1.0 ) );',
      )
      material.needsUpdate = true
    })
    const output = new OutputPass()
    composer.addPass(bloom)
    composer.addPass(output)
    return () => {
      composer.removePass(output)
      composer.removePass(bloom)
      output.dispose()
      bloom.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width > 0])

  useEffect(() => {
    const controls = globeRef.current?.controls()
    if (!controls) return
    controls.autoRotate = !reducedMotion
    controls.autoRotateSpeed = BASE_AUTO_ROTATE_SPEED
    controls.enableDamping = true
    controls.enableZoom = true
    controls.minDistance = MIN_CAMERA_DISTANCE
    controls.maxDistance = MAX_CAMERA_DISTANCE
  }, [countries, reducedMotion])

  // Pull the camera back and above the equator once the globe mounts: the Earth
  // reads smaller with negative space, and the projector platform below it is
  // seen at a downward angle (foreshortened ellipses, like the reference).
  const initialPovSet = useRef(false)
  useEffect(() => {
    if (initialPovSet.current || size.width === 0 || !globeRef.current) return
    initialPovSet.current = true
    globeRef.current.pointOfView(
      { lat: DEFAULT_CAMERA_LAT, lng: DEFAULT_CAMERA_LNG, altitude: DEFAULT_ALTITUDE },
      0,
    )
  }, [size.width])

  function resetView() {
    globeRef.current?.pointOfView(
      { lat: DEFAULT_CAMERA_LAT, lng: DEFAULT_CAMERA_LNG, altitude: DEFAULT_ALTITUDE },
      reducedMotion ? 0 : 800,
    )
  }

  // Keeps the shaders' globeRotation uniform in sync with the camera, same technique
  // three-globe's own day-night example uses (see globeLayers.ts's header comment).
  useEffect(() => {
    const controls = globeRef.current?.controls()
    const globe = globeRef.current
    if (!controls || !globe || !dayNightMaterial) return
    function onChange() {
      const { lng, lat } = globe!.toGeoCoords(globe!.camera().position)
      dayNightMaterial!.uniforms.globeRotation.value.set(lng, lat)
      if (atmosphereRef.current) {
        atmosphereRef.current.material.uniforms.globeRotation.value.set(lng, lat)
      }
    }
    controls.addEventListener('change', onChange)
    onChange()
    return () => controls.removeEventListener('change', onChange)
  }, [dayNightMaterial])

  // Renderer setup: capped pixel ratio (perf) — same cap three-globe's own
  // examples use. The composer mirrors it so bloom render targets match.
  useEffect(() => {
    const globe = globeRef.current
    if (!globe || size.width === 0) return
    const ratio = Math.min(2, window.devicePixelRatio)
    const renderer = globe.renderer()
    renderer.setPixelRatio(ratio)
    renderer.toneMapping = ACESFilmicToneMapping
    const composer = globe.postProcessingComposer()
    composer.setPixelRatio(ratio)
    composer.setSize(size.width, size.height)
  }, [size.width, size.height])

  // View offset: the full-bleed canvas renders the scene shifted so the globe
  // sits left of center and slightly high — the same composition as before,
  // but with particles, rings and routes free to fill the whole workspace.
  // Raycasting respects the offset, so hover/click stay accurate.
  useEffect(() => {
    const camera = globeRef.current?.camera() as PerspectiveCamera | undefined
    if (!camera || size.width === 0) return
    camera.setViewOffset(
      size.width,
      size.height,
      size.width * GLOBE_VIEW_OFFSET_X,
      size.height * GLOBE_VIEW_OFFSET_Y,
      size.width,
      size.height,
    )
    return () => camera.clearViewOffset()
  }, [size.width, size.height])

  // Single continuous loop: advances cloud rotation, the real sun position and
  // every hologram animation (projector rings/sweep/pulse, beam rays/motes,
  // ambient drift, rim breathing). Paused while the tab is hidden; frozen (but
  // still rendered) under reducedMotion.
  useEffect(() => {
    let frameId: number
    let cancelled = false
    let last = performance.now()

    function tick() {
      if (!cancelled) frameId = requestAnimationFrame(tick)
      const now = performance.now()
      // Clamped so a background tab doesn't fast-forward the animations on return.
      const delta = Math.min(now - last, 100)
      last = now
      if (document.hidden) return

      if (dayNightMaterial) {
        const [lng, lat] = sunPositionAt(Date.now())
        dayNightMaterial.uniforms.sunPosition.value.set(lng, lat)
        if (atmosphereRef.current) {
          atmosphereRef.current.material.uniforms.sunPosition.value.set(lng, lat)
        }
      }

      if (reducedMotion) return

      const clouds = cloudsRef.current
      if (clouds) {
        clouds.mesh.rotation.y += BASE_CLOUD_ROTATION_PER_MS * delta
      }
      if (dayNightMaterial) {
        dayNightMaterial.uniforms.uTime.value += delta / 1000
      }
      if (atmosphereRef.current) {
        atmosphereRef.current.material.uniforms.uTime.value += delta / 1000
      }
      hologramLayersRef.current.forEach((layer) => layer.tick(delta))
    }

    frameId = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(frameId)
    }
  }, [dayNightMaterial, reducedMotion])

  useEffect(() => () => clearTimeout(resumeTimeoutRef.current), [])

  function pauseAutoRotate() {
    if (reducedMotion) return
    const controls = globeRef.current?.controls()
    if (controls) controls.autoRotate = false
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current)
    resumeTimeoutRef.current = setTimeout(() => {
      const current = globeRef.current?.controls()
      if (current) current.autoRotate = true
    }, AUTO_ROTATE_RESUME_DELAY_MS)
  }

  const heatmapDomain = useMemo((): [number, number] => {
    if (!activeHeatmap) return [0, 1]
    const values = Object.values(GLOBAL_HEADLINE_MACRO).map((macro) =>
      heatmapValue(activeHeatmap, macro),
    )
    return [Math.min(...values), Math.max(...values)]
  }, [activeHeatmap])

  const polygonCapColor = useMemo(
    () => (polygon: object) => {
      const name = (polygon as CountryFeature).properties.name
      if (!activeHeatmap) {
        if (name === selectedGeoName) return CAP_COLOR.selected
        if (name === hoveredGeoName) return CAP_COLOR.hover
        return CAP_COLOR.base
      }
      const entry = resolveCountryByGeoName(name)
      const macro = GLOBAL_HEADLINE_MACRO[entry.countryCode]
      if (!macro) return 'rgba(148, 197, 214, 0.04)'
      const [min, max] = heatmapDomain
      const t = max > min ? (heatmapValue(activeHeatmap, macro) - min) / (max - min) : 0.5
      return intensityFill(t)
    },
    [selectedGeoName, hoveredGeoName, activeHeatmap, heatmapDomain],
  )

  const polygonStrokeColor = useMemo(
    () => (polygon: object) => {
      if (!layers.countryBorders) return false
      const name = (polygon as CountryFeature).properties.name
      return name === hoveredGeoName || name === selectedGeoName
        ? STROKE_COLOR.hover
        : STROKE_COLOR.base
    },
    [hoveredGeoName, selectedGeoName, layers.countryBorders],
  )

  function handleSelect(geoFeature: CountryFeature) {
    const entry = resolveCountryByGeoName(geoFeature.properties.name)
    if (!reducedMotion) {
      globeRef.current?.pointOfView(
        { lat: entry.lat, lng: entry.lng, altitude: 1.6 },
        800,
      )
    }
    onSelectCountry(entry)
  }

  function handleParallax(event: React.PointerEvent<HTMLDivElement>) {
    if (reducedMotion) return
    const el = event.currentTarget
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--par-x', (((event.clientX - rect.left) / rect.width - 0.5) * 2).toFixed(3))
    el.style.setProperty('--par-y', (((event.clientY - rect.top) / rect.height - 0.5) * 2).toFixed(3))
  }

  return (
    <div className="relative h-full w-full overflow-hidden" onPointerMove={handleParallax}>
      {/* Base environment: a near-black navy gradient the whole scene sits in. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background: 'linear-gradient(180deg, #04070c, #071018 55%, #0a1520)',
          opacity: 0.55,
        }}
      />

      {/* Blurred dark depth blobs — barely visible parallax-scale layers. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 30% 40% at 18% 30%, rgba(10,21,32,0.55), transparent 70%), radial-gradient(ellipse 34% 45% at 72% 72%, rgba(16,24,34,0.5), transparent 70%)',
          filter: 'blur(40px)',
          transform: 'translate3d(calc(var(--par-x, 0) * -7px), calc(var(--par-y, 0) * -5px), 0)',
          transition: 'transform 0.5s ease-out',
        }}
      />

      {/* Stylized financial-district canyon: tall window-lit towers framing
          the sides, a columned classical facade with flag cues on the right —
          suggestive holographic architecture in the product's own language. */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[72%] w-full opacity-60"
        preserveAspectRatio="none"
        viewBox="0 0 100 72"
        style={{
          filter: 'blur(0.6px)',
          transform: 'translate3d(calc(var(--par-x, 0) * -3px), 0, 0)',
          transition: 'transform 0.5s ease-out',
        }}
      >
        {/* Far canyon wall — tallest, dimmest. */}
        {[
          [0, 6, 8], [7, 12, 6], [12, 2, 9], [20, 10, 6], [25, 16, 7],
          [56, 14, 6], [61, 4, 8], [68, 10, 6],
        ].map(([x = 0, top = 10, w = 8]) => (
          <rect
            key={`far-${x}`}
            x={x}
            y={top}
            width={w}
            height={72 - top}
            fill="rgba(5,11,18,0.7)"
          />
        ))}
        {/* Near towers. */}
        {[
          [2, 24, 9], [10, 34, 7], [16, 20, 8], [23, 40, 8], [29, 28, 6],
          [58, 30, 7], [64, 22, 8], [70, 36, 7],
        ].map(([x = 0, top = 10, w = 8]) => (
          <rect
            key={`near-${x}`}
            x={x}
            y={top}
            width={w}
            height={72 - top}
            fill="rgba(7,16,26,0.9)"
          />
        ))}
        {/* Dense restrained window lights, warm and cool. */}
        {[
          [3, 28], [4.5, 34], [6, 40], [3.5, 48], [11, 38], [12.5, 44],
          [17, 24], [18.5, 30], [17.5, 38], [24, 44], [25.5, 50], [24.5, 58],
          [30, 32], [31, 40], [8, 16], [13.5, 8], [21, 14], [26.5, 20],
          [59, 34], [60.5, 40], [59.5, 48], [65, 26], [66.5, 32], [65.5, 40],
          [71, 40], [72.5, 46], [71.5, 54], [62, 10], [69, 16], [57, 20],
        ].map(([x = 0, y = 20], index) => (
          <rect
            key={`window-${index}`}
            x={x}
            y={y}
            width={0.6}
            height={0.8}
            fill={index % 3 === 0 ? 'rgba(229,163,61,0.4)' : 'rgba(20,207,244,0.24)'}
          />
        ))}
        {/* Classical institutional facade, right side: pediment, columns, flags. */}
        <rect x={76} y={24} width={23} height={48} fill="rgba(9,18,28,0.92)" />
        <path d="M76.5 24 L87.5 18.5 L98.5 24 Z" fill="rgba(12,22,33,0.95)" />
        {[78, 80.8, 83.6, 86.4, 89.2, 92, 94.8].map((x) => (
          <rect
            key={`column-${x}`}
            x={x}
            y={26}
            width={1.3}
            height={34}
            fill="rgba(17,27,38,0.95)"
          />
        ))}
        {[79.6, 82.4, 85.2, 88, 90.8, 93.6].map((x, index) => (
          <rect
            key={`glow-${x}`}
            x={x}
            y={32 + (index % 2) * 2}
            width={1.4}
            height={18}
            fill="rgba(229,163,61,0.14)"
          />
        ))}
        {/* Flag cues on the facade. */}
        {[80.5, 86.2, 91.9].map((x) => (
          <g key={`flag-${x}`}>
            <rect x={x} y={20.5} width={0.18} height={4.5} fill="rgba(120,130,140,0.5)" />
            <rect x={x + 0.18} y={20.7} width={2.1} height={1.3} fill="rgba(178,60,66,0.55)" />
            <rect x={x + 0.18} y={21.05} width={2.1} height={0.22} fill="rgba(224,228,235,0.5)" />
            <rect x={x + 0.18} y={21.5} width={2.1} height={0.22} fill="rgba(224,228,235,0.5)" />
            <rect x={x + 0.18} y={20.7} width={0.8} height={0.75} fill="rgba(52,74,140,0.65)" />
          </g>
        ))}
        {/* Street lamps along the canyon base. */}
        {[6, 30, 55, 75].map((x) => (
          <circle key={`lamp-${x}`} cx={x} cy={69} r={0.55} fill="rgba(229,163,61,0.5)" />
        ))}
      </svg>

      {/* Wet-street reflection: faint vertical light streaks pooling below the
          scene, as if the pavement mirrors the holograms and lamps. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-24"
        style={{
          background:
            'repeating-linear-gradient(90deg, rgba(20,207,244,0.04) 0 2px, transparent 2px 26px), radial-gradient(ellipse 34% 100% at 42% 100%, rgba(20,207,244,0.08), transparent 70%), linear-gradient(to top, rgba(20,207,244,0.06), transparent)',
          maskImage: 'linear-gradient(to top, black, transparent)',
        }}
      />

      {/* Digital architecture silhouettes along the floor — a distant, blurred
          rack/skyline band, barely brighter than the background. */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-20 w-full opacity-50"
        preserveAspectRatio="none"
        viewBox="0 0 100 20"
        style={{
          filter: 'blur(1.5px)',
          transform: 'translate3d(calc(var(--par-x, 0) * -4px), 0, 0)',
          transition: 'transform 0.5s ease-out',
        }}
      >
        {[
          [0, 8], [6, 13], [11, 6], [17, 11], [22, 15], [28, 7], [33, 12],
          [39, 9], [44, 14], [50, 6], [55, 10], [61, 13], [66, 8], [72, 12],
          [77, 15], [83, 9], [88, 12], [94, 7],
        ].map(([x, h]) => (
          <rect
            key={x}
            x={x}
            y={20 - (h ?? 6)}
            width={4.5}
            height={h}
            fill="rgba(12,24,38,0.85)"
          />
        ))}
        {[8, 30, 52, 74, 90].map((x) => (
          <rect
            key={`glint-${x}`}
            x={x}
            y={9}
            width={0.5}
            height={11}
            fill="rgba(76,198,232,0.08)"
          />
        ))}
      </svg>

      {/* Fine digital noise — breaks up flat gradients, film-grain subtle. */}
      <div
        aria-hidden="true"
        className="command-center-noise pointer-events-none absolute inset-0 z-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='120' height='120' filter='url(%23n)' opacity='0.6'/></svg>\")",
        }}
      />

      {/* Barely visible diagonal digital streaks. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'repeating-linear-gradient(115deg, rgba(76,198,232,0.008) 0 1px, transparent 1px 140px)',
        }}
      />

      {/* Faint technical scan lines — horizontal and a sparser vertical set. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'repeating-linear-gradient(180deg, rgba(76,198,232,0.014) 0 1px, transparent 1px 72px), repeating-linear-gradient(90deg, rgba(76,198,232,0.01) 0 1px, transparent 1px 96px)',
        }}
      />

      {/* Dark radial haze pooling depth behind the globe — darkening only,
          never a glowing disc. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 62% 55% at 42% 46%, rgba(2,5,11,0.78), rgba(2,5,11,0.42) 55%, transparent 78%)',
        }}
      />

      {/* Low fog band pooling behind the projector zone — layered depth. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-48"
        style={{
          background:
            'radial-gradient(ellipse 55% 90% at 42% 100%, rgba(5,9,17,0.55), transparent 75%)',
        }}
      />

      {/* Faint vertical technical light columns for room depth. */}
      {[16, 68, 88].map((left) => (
        <div
          key={left}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 z-0 w-14"
          style={{
            left: `${left}%`,
            background:
              'linear-gradient(to top, transparent 6%, rgba(76,198,232,0.02) 45%, transparent 92%)',
          }}
        />
      ))}

      {/* Faint teal ceiling light falling from above — operations-room depth. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-40"
        style={{
          background: 'linear-gradient(to bottom, rgba(13,148,136,0.03), transparent)',
        }}
      />

      {/* Very subtle trading-floor ambience along the bottom edge. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-28"
        style={{
          background:
            'linear-gradient(to top, rgba(76,198,232,0.04), transparent)',
        }}
      />

      {/* Localized cyan haze directly behind the globe — low alpha, soft. */}
      <div
        aria-hidden="true"
        className="command-center-breathe pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(circle 26% at 42% 46%, rgba(76,198,232,0.065), transparent 62%)',
          transform: 'translate3d(calc(var(--par-x, 0) * 3px), calc(var(--par-y, 0) * 2px), 0)',
          transition: 'transform 0.5s ease-out',
        }}
      />

      {/* Soft volumetric light rising from the projector zone. */}
      <div
        aria-hidden="true"
        className="command-center-breathe pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 22% 55% at 42% 76%, rgba(76,198,232,0.05), transparent 70%)',
          transform: 'translate3d(calc(var(--par-x, 0) * 2px), calc(var(--par-y, 0) * 1.5px), 0)',
          transition: 'transform 0.5s ease-out',
        }}
      />

      {/* Full-bleed scene: the canvas spans the entire visualization area, so
          particles, orbit rings, routes and the projector blend seamlessly
          into the workspace — no rectangular boundary. A camera view-offset
          keeps the globe left of center, clear of the side panels. */}
      <div
        ref={wrapperRef}
        className="absolute inset-0 z-10"
        role="application"
        aria-label="Interaktiv 3D-jordglob för att välja land att analysera. Sök land i sökrutan för ett tangentbordsvänligt alternativ."
        onPointerDown={pauseAutoRotate}
        onPointerMove={pauseAutoRotate}
        onWheel={pauseAutoRotate}
      >
          {size.width > 0 && size.height > 0 && (
            <Globe
              ref={globeRef}
              width={size.width}
              height={size.height}
              backgroundColor="rgba(0,0,0,0)"
              globeImageUrl={null}
              globeMaterial={dayNightMaterial ?? LOADING_MATERIAL}
              polygonsData={countries}
              polygonCapColor={polygonCapColor}
              polygonSideColor={() => 'rgba(10, 13, 18, 0.4)'}
              polygonStrokeColor={polygonStrokeColor}
              polygonAltitude={(polygon: object) => {
                const name = (polygon as CountryFeature).properties.name
                return name === selectedGeoName
                  ? 0.02
                  : name === hoveredGeoName
                    ? 0.015
                    : 0.006
              }}
              polygonsTransitionDuration={reducedMotion ? 0 : 250}
              polygonLabel={(polygon: object) => {
                const p = polygon as CountryFeature
                const entry = resolveCountryByGeoName(p.properties.name)
                return `
                <div class="hud-frame rounded-md bg-surface-2 px-3 py-2 font-mono text-[11px] shadow-pop">
                  <div class="text-content font-semibold tracking-wide">${entry.nameEn.toUpperCase()}</div>
                  <div class="text-content-subtle mt-0.5">${entry.countryCode} · ${entry.region.toUpperCase()}</div>
                  <div class="text-accent mt-1">Klicka för landsanalys</div>
                </div>
              `
              }}
              onPolygonHover={(polygon) => {
                const p = polygon as CountryFeature | null
                setHoveredGeoName(p?.properties.name ?? null)
              }}
              onPolygonClick={(polygon) => handleSelect(polygon as CountryFeature)}
              pointsData={layers.marketStatus ? marketPoints : []}
              pointLat={(d) => (d as MarketPoint).center.lat}
              pointLng={(d) => (d as MarketPoint).center.lng}
              pointColor={(d) => MARKET_STATUS_COLOR[(d as MarketPoint).status]}
              pointAltitude={0.022}
              pointRadius={0.55}
              pointsMerge={false}
              pointLabel={(d) => {
                const point = d as MarketPoint
                const hubData = HUB_MARKET_DATA[point.center.id]
                return `
                <div class="hud-frame rounded-md bg-surface-2 px-3 py-2 font-mono text-[11px] shadow-pop">
                  <div class="text-content font-semibold tracking-wide">${point.center.name.toUpperCase()}</div>
                  <div class="text-content-subtle mt-0.5">${point.center.openLocal}–${point.center.closeLocal} lokal tid</div>
                  <div class="text-content-subtle">${MARKET_STATUS_LABEL[point.status]}</div>
                  <div class="text-accent mt-1">${
                    hubData
                      ? `${hubData.indexName}: ${hubData.indexValue} (${hubData.changeToday})`
                      : 'Indexdata ej tillgänglig'
                  }</div>
                </div>
              `
              }}
              ringsData={
                layers.marketStatus && !reducedMotion
                  ? marketPoints.flatMap((point): MarketRingDatum[] => [
                      { ...point, burst: false },
                      { ...point, burst: true },
                    ])
                  : []
              }
              ringLat={(d) => (d as MarketRingDatum).center.lat}
              ringLng={(d) => (d as MarketRingDatum).center.lng}
              ringColor={(d: object) =>
                MARKET_STATUS_COLOR[(d as MarketRingDatum).status]
              }
              ringMaxRadius={(d: object) => ((d as MarketRingDatum).burst ? 1.6 : 3)}
              ringPropagationSpeed={(d: object) =>
                (d as MarketRingDatum).burst ? 2.6 : 0.9
              }
              ringRepeatPeriod={(d: object) =>
                (d as MarketRingDatum).burst ? 4600 : 3000
              }
              arcsData={
                layers.network ? (reducedMotion ? BASE_ARCS_DATA : ARCS_DATA) : []
              }
              arcStartLat={(d) => (d as ArcDatum).startLat}
              arcStartLng={(d) => (d as ArcDatum).startLng}
              arcEndLat={(d) => (d as ArcDatum).endLat}
              arcEndLng={(d) => (d as ArcDatum).endLng}
              arcColor={(d: object) => (d as ArcDatum).color}
              arcAltitudeAutoScale={(d) => (d as ArcDatum).altScale}
              arcStroke={(d) => (d as ArcDatum).stroke}
              arcDashLength={(d: object) => (d as ArcDatum).dashLength}
              arcDashGap={(d: object) => (d as ArcDatum).dashGap}
              arcDashAnimateTime={(d) =>
                reducedMotion ? 0 : (d as ArcDatum).animMs
              }
            />
          )}
        </div>

      <FloatingMarketChips reducedMotion={reducedMotion} />

      <button
        type="button"
        onClick={resetView}
        className="hud-label absolute bottom-4 left-4 z-10 rounded-md bg-surface-2/70 px-2.5 py-1.5 text-[9px] text-content-subtle backdrop-blur transition-colors duration-150 hover:text-accent"
      >
        Återställ vy
      </button>
    </div>
  )
}
