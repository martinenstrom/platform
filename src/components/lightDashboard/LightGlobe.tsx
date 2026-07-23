import { useEffect, useRef, useState } from 'react'
import Globe, { type GlobeMethods } from 'react-globe.gl'
import {
  ShaderMaterial,
  TextureLoader,
  type PerspectiveCamera,
  type Texture,
} from 'three'
import { feature } from 'topojson-client'
import type { Feature, Geometry } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { resolveCountryByGeoName } from '~/data/countryExplorer'
import {
  createCloudLayer,
  type CloudLayer,
} from '~/components/countryExplorer/globeLayers'
import { MARKET_CENTERS } from '~/data/countryExplorer/marketCenters'
import type { CountryRegistryEntry } from '~/types/countryExplorer'

const WORLD_ATLAS_URL = '/data/countries-110m.json'

type CountryFeature = Feature<Geometry, { name: string }>

/**
 * Cinematic Earth material — layered in one shader over the two vendored
 * 4K NASA-derived textures (MIT-licensed three-globe example assets):
 * - deep navy, near-black glossy ocean (fresnel-weighted key-light specular)
 * - land mass + subtle terrain variation sampled from the blue-marble texture
 * - the REAL night-lights texture as thousands of warm gold city lights,
 *   dense where real cities are, with a gentle regional twinkle
 * - cool key light from the upper left, soft fill, blue scattering rim
 */
const EARTH_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const EARTH_FRAGMENT_SHADER = `
  uniform sampler2D dayTexture;
  uniform sampler2D nightTexture;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vViewDir;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewDir);

    vec3 day = texture2D(dayTexture, vUv).rgb;
    float dayLum = dot(day, vec3(0.299, 0.587, 0.114));
    float land = smoothstep(0.05, 0.2, dayLum);

    // Ocean: deep navy, almost black. Land: dark graphite-blue, only a
    // luminance-based relief lift from the day texture — no daylight colours;
    // the golden city lights carry the land's visual interest.
    vec3 ocean = vec3(0.024, 0.055, 0.1);
    vec3 terrain = vec3(0.045, 0.075, 0.125) + vec3(dayLum) * 0.045;
    vec3 base = mix(ocean, terrain, land);

    // Cinematic key light from the upper left; soft fill floor.
    vec3 keyDir = normalize(vec3(-0.45, 0.55, 0.7));
    float key = 0.5 + 0.6 * max(dot(normal, keyDir), 0.0);
    base *= key;

    // Glossy ocean: tight specular from the key light, oceans only.
    vec3 halfDir = normalize(keyDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), 42.0) * (1.0 - land);
    base += vec3(0.35, 0.5, 0.7) * spec * 0.4;

    // Real city lights, warm-ramped gold/amber with a subtle regional twinkle.
    vec3 night = texture2D(nightTexture, vUv).rgb;
    float lum = dot(night, vec3(0.3, 0.59, 0.11));
    float twinkle = 0.88 + 0.12 * sin(uTime * 2.4 + vUv.x * 180.0 + vUv.y * 90.0);
    vec3 lights = mix(vec3(1.0, 0.7, 0.4), vec3(1.0, 0.87, 0.67), clamp(lum * 2.0, 0.0, 1.0));
    base += lights * lum * 2.2 * twinkle;

    // Blue atmospheric scattering rim.
    float facing = clamp(dot(normal, viewDir), 0.0, 1.0);
    base += vec3(0.3, 0.5, 0.85) * pow(1.0 - facing, 2.6) * 0.42;

    gl_FragColor = vec4(base, 1.0);
  }
`

interface EarthMaterial extends ShaderMaterial {
  uniforms: {
    dayTexture: { value: Texture }
    nightTexture: { value: Texture }
    uTime: { value: number }
  }
}

async function createEarthMaterial(): Promise<EarthMaterial> {
  const loader = new TextureLoader()
  const [dayTexture, nightTexture] = await Promise.all([
    loader.loadAsync('/data/globe/earth-blue-marble.jpg'),
    loader.loadAsync('/data/globe/earth-night.jpg'),
  ])
  return new ShaderMaterial({
    uniforms: {
      dayTexture: { value: dayTexture },
      nightTexture: { value: nightTexture },
      uTime: { value: 0 },
    },
    vertexShader: EARTH_VERTEX_SHADER,
    fragmentShader: EARTH_FRAGMENT_SHADER,
  }) as EarthMaterial
}

interface ArcDatum {
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  index: number
  /** Roughly 40% of routes carry a moving particle; the rest are calm lines. */
  particle: boolean
}

const LINKS: Array<[string, string]> = [
  ['new-york', 'london'],
  ['london', 'stockholm'],
  ['london', 'frankfurt'],
  ['frankfurt', 'zurich'],
  ['paris', 'frankfurt'],
  ['paris', 'new-york'],
  ['stockholm', 'new-york'],
  ['new-york', 'toronto'],
  ['new-york', 'sao-paulo'],
  ['sao-paulo', 'london'],
  ['london', 'dubai'],
  ['zurich', 'dubai'],
  ['dubai', 'mumbai'],
  ['dubai', 'shanghai'],
  ['mumbai', 'singapore'],
  ['mumbai', 'hong-kong'],
  ['singapore', 'hong-kong'],
  ['paris', 'singapore'],
  ['hong-kong', 'shanghai'],
  ['frankfurt', 'shanghai'],
  ['shanghai', 'tokyo'],
  ['tokyo', 'singapore'],
  ['toronto', 'tokyo'],
  ['tokyo', 'sydney'],
  ['hong-kong', 'sydney'],
  ['singapore', 'sydney'],
  ['new-york', 'tokyo'],
  ['new-york', 'hong-kong'],
  ['stockholm', 'frankfurt'],
  ['london', 'singapore'],
]

const CENTER_BY_ID = new Map(MARKET_CENTERS.map((c) => [c.id, c]))
const ARCS: ArcDatum[] = LINKS.flatMap(([a, b], index) => {
  const from = CENTER_BY_ID.get(a)
  const to = CENTER_BY_ID.get(b)
  if (!from || !to) return []
  return [
    {
      startLat: from.lat,
      startLng: from.lng,
      endLat: to.lat,
      endLng: to.lng,
      index,
      particle: index % 5 < 2,
    },
  ]
})

/** Calm lines: cyan/soft blue, some almost invisible; particles run warm amber. */
const STATIC_ARC_COLORS = [
  'rgba(108, 200, 255, 0.42)',
  'rgba(90, 150, 246, 0.34)',
  'rgba(140, 200, 255, 0.16)',
]

const MAJOR_HUBS = new Set([
  'new-york',
  'london',
  'frankfurt',
  'tokyo',
  'hong-kong',
  'singapore',
])

const PULSE_HUBS = MARKET_CENTERS.filter((c) => MAJOR_HUBS.has(c.id))

interface LightGlobeProps {
  onSelectCountry: (entry: CountryRegistryEntry) => void
  reducedMotion: boolean
}

export function LightGlobe({ onSelectCountry, reducedMotion }: LightGlobeProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<GlobeMethods | undefined>(undefined)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [countries, setCountries] = useState<CountryFeature[]>([])
  const [hoveredName, setHoveredName] = useState<string | null>(null)
  const [earthMaterial, setEarthMaterial] = useState<EarthMaterial | null>(null)
  const cloudsRef = useRef<CloudLayer | null>(null)

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
        setCountries(feature(topology, countriesObject).features as CountryFeature[])
      })
      .catch((error: unknown) => {
        console.error('Kunde inte läsa in världskartan:', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    createEarthMaterial()
      .then((material) => {
        if (!cancelled) setEarthMaterial(material)
      })
      .catch((error: unknown) => {
        console.error('Kunde inte läsa in jordtexturer:', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Camera: restrained 32° FOV, altitude compensated; gentle zoom clamps.
  useEffect(() => {
    const globe = globeRef.current
    if (!globe || size.width === 0) return
    const camera = globe.camera() as PerspectiveCamera
    camera.fov = 32
    camera.updateProjectionMatrix()
    globe.pointOfView({ lat: 22, lng: 5, altitude: 4.0 }, 0)
  }, [size.width > 0])

  // Slow cinematic rotation (~107 s/rev), damping, zoom clamps. Keyed on size
  // too: country data can arrive before the canvas exists.
  useEffect(() => {
    const controls = globeRef.current?.controls()
    if (!controls) return
    controls.autoRotate = !reducedMotion
    controls.autoRotateSpeed = 0.28
    controls.enableDamping = true
    controls.enableZoom = true
    controls.minDistance = 400
    controls.maxDistance = 660
    controls.minPolarAngle = Math.PI * 0.18
    controls.maxPolarAngle = Math.PI * 0.82
  }, [countries, reducedMotion, size.width > 0])

  // Subtle cloud layer drifting independently of the rotation.
  useEffect(() => {
    const globe = globeRef.current
    if (!globe || size.width === 0) return
    let cancelled = false
    let detach: (() => void) | null = null
    createCloudLayer(globe.getGlobeRadius(), false).then((clouds) => {
      if (cancelled) {
        clouds.dispose()
        return
      }
      const cloudMaterial = clouds.mesh.material
      if (!Array.isArray(cloudMaterial)) cloudMaterial.opacity = 0.05
      cloudsRef.current = clouds
      globe.scene().add(clouds.mesh)
      detach = () => {
        globe.scene().remove(clouds.mesh)
        clouds.dispose()
      }
    })
    return () => {
      cancelled = true
      detach?.()
      cloudsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width > 0])

  // One quiet loop: city-light twinkle time + cloud drift. Frozen under
  // reduced motion; skipped while the tab is hidden.
  useEffect(() => {
    if (reducedMotion) return undefined
    let frameId: number
    let cancelled = false
    function tick() {
      if (!cancelled) frameId = requestAnimationFrame(tick)
      if (document.hidden) return
      if (earthMaterial) earthMaterial.uniforms.uTime.value += 1 / 60
      const clouds = cloudsRef.current
      if (clouds) clouds.mesh.rotation.y -= 0.00024
    }
    frameId = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(frameId)
    }
  }, [earthMaterial, reducedMotion])

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full"
      role="application"
      aria-label="Interaktiv jordglob. Klicka på ett land för landsanalys."
    >
      {size.width > 0 && size.height > 0 && earthMaterial && (
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl={null}
          globeMaterial={earthMaterial}
          showAtmosphere
          atmosphereColor="#8fc2f0"
          atmosphereAltitude={0.13}
          polygonsData={countries}
          polygonCapColor={(polygon: object) =>
            hoveredName === (polygon as CountryFeature).properties.name
              ? 'rgba(160, 210, 255, 0.14)'
              : 'rgba(0,0,0,0)'
          }
          polygonSideColor={() => 'rgba(0,0,0,0)'}
          polygonStrokeColor={(polygon: object) =>
            hoveredName === (polygon as CountryFeature).properties.name
              ? 'rgba(185, 225, 255, 0.85)'
              : 'rgba(120, 170, 230, 0.22)'
          }
          polygonAltitude={0.006}
          polygonsTransitionDuration={0}
          polygonLabel={(polygon: object) => {
            const entry = resolveCountryByGeoName(
              (polygon as CountryFeature).properties.name,
            )
            return `<div style="background:#ffffff;border:1px solid #E9EEF5;border-radius:8px;padding:6px 10px;font-size:12px;color:#1e293b;box-shadow:0 10px 40px rgba(30,40,60,0.1)">${entry.nameEn} · klicka för analys</div>`
          }}
          onPolygonHover={(polygon) => {
            setHoveredName(
              polygon ? (polygon as CountryFeature).properties.name : null,
            )
          }}
          onPolygonClick={(polygon) => {
            onSelectCountry(
              resolveCountryByGeoName((polygon as CountryFeature).properties.name),
            )
          }}
          arcsData={ARCS}
          arcStartLat={(d) => (d as ArcDatum).startLat}
          arcStartLng={(d) => (d as ArcDatum).startLng}
          arcEndLat={(d) => (d as ArcDatum).endLat}
          arcEndLng={(d) => (d as ArcDatum).endLng}
          arcColor={(d: object) => {
            const arc = d as ArcDatum
            if (arc.particle) return 'rgba(255, 186, 102, 0.85)'
            return (
              STATIC_ARC_COLORS[arc.index % STATIC_ARC_COLORS.length] ??
              'rgba(108, 200, 255, 0.42)'
            )
          }}
          arcStroke={(d) =>
            (d as ArcDatum).particle ? 0.32 : 0.2 + ((d as ArcDatum).index % 2) * 0.08
          }
          arcAltitudeAutoScale={(d) => 0.12 + ((d as ArcDatum).index % 5) * 0.07}
          arcDashLength={(d: object) => ((d as ArcDatum).particle ? 0.05 : 1)}
          arcDashGap={(d: object) => ((d as ArcDatum).particle ? 0.55 : 0)}
          arcDashAnimateTime={(d) => {
            const arc = d as ArcDatum
            if (reducedMotion || !arc.particle) return 0
            return 3200 + (arc.index % 4) * 950
          }}
          pointsData={MARKET_CENTERS}
          pointLat={(d) => (d as (typeof MARKET_CENTERS)[number]).lat}
          pointLng={(d) => (d as (typeof MARKET_CENTERS)[number]).lng}
          pointColor={(d) =>
            MAJOR_HUBS.has((d as (typeof MARKET_CENTERS)[number]).id)
              ? '#ffddaa'
              : '#7fb8ff'
          }
          pointAltitude={0.012}
          pointRadius={(d) =>
            MAJOR_HUBS.has((d as (typeof MARKET_CENTERS)[number]).id) ? 0.6 : 0.36
          }
          pointsMerge={false}
          ringsData={reducedMotion ? [] : PULSE_HUBS}
          ringLat={(d) => (d as (typeof MARKET_CENTERS)[number]).lat}
          ringLng={(d) => (d as (typeof MARKET_CENTERS)[number]).lng}
          ringColor={() => 'rgba(255, 199, 138, 0.4)'}
          ringMaxRadius={3.2}
          ringPropagationSpeed={1.4}
          ringRepeatPeriod={3200}
        />
      )}
    </div>
  )
}
