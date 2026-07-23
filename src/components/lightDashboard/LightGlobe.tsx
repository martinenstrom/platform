import { useEffect, useRef, useState } from 'react'
import Globe, { type GlobeMethods } from 'react-globe.gl'
import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  TextureLoader,
  Vector2,
  type PerspectiveCamera,
  type Texture,
} from 'three'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
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

    // NASA Black Marble: the globe is uniformly dark, space-lit — there is NO
    // daylight hemisphere. Land is near-black, oceans deep navy; the continents
    // are defined almost entirely by glowing golden city lights.
    vec3 ocean = vec3(0.006, 0.022, 0.05);
    vec3 landDark = vec3(0.019, 0.026, 0.036);
    vec3 base = mix(ocean, landDark, land);

    // Flat, very low space ambient with only a whisper of top moonlight on
    // relief — no directional daylight wash across the day-facing side.
    vec3 moonDir = normalize(vec3(-0.3, 0.6, 0.6));
    float moon = max(dot(normal, moonDir), 0.0);
    base *= 0.72 + 0.12 * moon;
    base += vec3(dayLum) * land * 0.02 * moon;

    float facing = clamp(dot(normal, viewDir), 0.0, 1.0);

    // Ocean glint: tight moonlight specular + a soft cool Fresnel reflection.
    vec3 halfDir = normalize(moonDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), 80.0) * (1.0 - land);
    base += vec3(0.3, 0.5, 0.85) * spec * 0.5;
    base += vec3(0.08, 0.2, 0.46) * pow(1.0 - facing, 4.0) * (1.0 - land) * 0.4;

    // Dense golden city lights — THE dominant feature. A modest floor keeps
    // deserts/oceans dark while a gentle curve lets many small cities glow;
    // the warm ramp runs orange (small towns) → gold → white-gold metro cores.
    vec3 night = texture2D(nightTexture, vUv).rgb;
    float rawLum = dot(night, vec3(0.3, 0.59, 0.11));
    float city = pow(max(rawLum - 0.045, 0.0) * 1.15, 1.65);
    float twinkle = 0.9 + 0.1 * sin(uTime * 2.4 + vUv.x * 180.0 + vUv.y * 90.0);
    vec3 lights = mix(vec3(1.0, 0.62, 0.26), vec3(1.0, 0.77, 0.42), clamp(rawLum * 2.0, 0.0, 1.0));
    lights = mix(lights, vec3(1.0, 0.945, 0.78), clamp((rawLum - 0.5) * 2.0, 0.0, 1.0));
    base += lights * city * 9.0 * twinkle;

    // Thin blue-white atmospheric rim (NASA limb), edge-only, stronger on the
    // upper-left as sunlight scattering through the atmosphere.
    float rim = pow(1.0 - facing, 3.1);
    float upperLeft = clamp(dot(normal, normalize(vec3(-0.5, 0.62, 0.3))) * 0.5 + 0.5, 0.0, 1.0);
    base += vec3(0.475, 0.72, 1.0) * rim * (0.4 + 0.4 * upperLeft);

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

/** Warm gold primary/secondary routes with a faint cool-blue tertiary; the
 *  particle "data packets" run brighter warm gold. */
const STATIC_ARC_COLORS = [
  'rgba(255, 168, 84, 0.5)',
  'rgba(255, 140, 60, 0.4)',
  'rgba(120, 175, 255, 0.28)',
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
    camera.fov = 30
    camera.updateProjectionMatrix()
    globe.pointOfView({ lat: 18, lng: 8, altitude: 3.55 }, 0)
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
      if (!Array.isArray(cloudMaterial)) cloudMaterial.opacity = 0.02
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

  // Post-processing + environment: ACES filmic tone mapping, a selective
  // bloom pass that glows ONLY the bright warm city lights (and hubs/arcs),
  // and a faint in-scene star field for depth. Rendering only — no geometry,
  // camera, sizing or interaction is touched.
  useEffect(() => {
    const globe = globeRef.current
    if (!globe || size.width === 0) return

    const renderer = globe.renderer()
    const previousToneMapping = renderer.toneMapping
    renderer.toneMapping = ACESFilmicToneMapping

    const composer = globe.postProcessingComposer()
    const bloom = new UnrealBloomPass(new Vector2(size.width, size.height), 0.72, 0.42, 0.55)
    // Keep the transparent canvas: rewrite the blur shader to carry glow
    // luminance as alpha, and finish with an OutputPass (faithful alpha + the
    // renderer's ACES tone mapping) instead of the pass's opaque screen blit.
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

    // Sparse star field around the globe — mostly dim blue-white with a few
    // faint warm points. Elegant, never a dense field.
    const scene = globe.scene()
    const globeRadius = globe.getGlobeRadius()
    let seed = 90731
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const makeStars = (count: number, color: number, size: number, opacity: number) => {
      const positions = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        const z = rand() * 2 - 1
        const phi = rand() * Math.PI * 2
        const ring = Math.sqrt(Math.max(0, 1 - z * z))
        const radius = globeRadius * (2.6 + rand() * 3.4)
        positions[i * 3] = ring * Math.cos(phi) * radius
        positions[i * 3 + 1] = z * radius
        positions[i * 3 + 2] = ring * Math.sin(phi) * radius
      }
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(positions, 3))
      const material = new PointsMaterial({
        color,
        size,
        transparent: true,
        opacity,
        sizeAttenuation: true,
        depthWrite: false,
      })
      const points = new Points(geometry, material)
      points.frustumCulled = false
      scene.add(points)
      return { points, geometry, material }
    }
    const blueStars = makeStars(200, 0xcfe0ff, 1.1, 0.5)
    const warmStars = makeStars(28, 0xffcf9a, 1.3, 0.55)

    return () => {
      composer.removePass(output)
      composer.removePass(bloom)
      output.dispose()
      bloom.dispose()
      for (const set of [blueStars, warmStars]) {
        scene.remove(set.points)
        set.geometry.dispose()
        set.material.dispose()
      }
      renderer.toneMapping = previousToneMapping
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
          atmosphereColor="#6ea6e0"
          atmosphereAltitude={0.09}
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
            if (arc.particle) return 'rgba(255, 200, 120, 0.95)'
            return (
              STATIC_ARC_COLORS[arc.index % STATIC_ARC_COLORS.length] ??
              'rgba(255, 168, 84, 0.5)'
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
              ? '#ffd08a'
              : '#ffb367'
          }
          pointAltitude={0.012}
          pointRadius={(d) =>
            MAJOR_HUBS.has((d as (typeof MARKET_CENTERS)[number]).id) ? 0.6 : 0.36
          }
          pointsMerge={false}
          ringsData={reducedMotion ? [] : PULSE_HUBS}
          ringLat={(d) => (d as (typeof MARKET_CENTERS)[number]).lat}
          ringLng={(d) => (d as (typeof MARKET_CENTERS)[number]).lng}
          ringColor={() => 'rgba(255, 178, 100, 0.45)'}
          ringMaxRadius={3.2}
          ringPropagationSpeed={1.4}
          ringRepeatPeriod={3200}
        />
      )}
    </div>
  )
}
