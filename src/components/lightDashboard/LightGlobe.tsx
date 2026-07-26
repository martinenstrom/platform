import { useEffect, useRef, useState } from 'react'
import Globe, { type GlobeMethods } from 'react-globe.gl'
import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
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
import {
  createCloudLayer,
  type CloudLayer,
} from '~/components/countryExplorer/globeLayers'
import { MARKET_CENTERS } from '~/data/countryExplorer/marketCenters'
import type { CountryRegistryEntry } from '~/types/countryExplorer'

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
    float land = smoothstep(0.11, 0.22, dayLum);

    // NASA Black Marble: the globe is uniformly dark, space-lit — there is NO
    // daylight hemisphere. Land is near-black, oceans deep navy; the continents
    // are defined almost entirely by glowing golden city lights.
    vec3 ocean = vec3(0.0025, 0.011, 0.05);
    // Very dark charcoal-brown terrain, derived from the real day texture so
    // relief/coastline detail survives, then heavily darkened and desaturated.
    // The continents must read as low-luminance land, never as illuminated
    // surface — all visible brightness comes from the city lights added below.
    float terrainLum = dot(day, vec3(0.299, 0.587, 0.114));
    vec3 landTint = mix(vec3(terrainLum), day, 0.24);
    vec3 landDark = landTint * vec3(0.042, 0.04, 0.035);
    // Deserts (bright, warm sand — Sahara, Arabian, Australian interior) read
    // too hot next to dark forest. Damp them ~13% by luminance × warmth so sand
    // recedes while dark vegetation and neutral ice are untouched — keeps empty
    // terrain quiet and never competing with city lights.
    float sand = smoothstep(0.20, 0.45, terrainLum) * smoothstep(0.0, 0.06, day.r - day.b);
    landDark *= 1.0 - 0.15 * sand;
    vec3 base = mix(ocean, landDark, land);

    // Flat, very low space ambient with only a whisper of top moonlight on
    // relief — no directional daylight wash across the day-facing side.
    vec3 moonDir = normalize(vec3(-0.3, 0.6, 0.6));
    float moon = max(dot(normal, moonDir), 0.0);
    base *= 0.72 + 0.12 * moon;
    base += vec3(dayLum) * land * 0.004 * moon;

    // Keep every ocean pixel a uniform dark blue, even on the moon-shadowed
    // side where the directional dimming above would otherwise crush it to
    // near-black. Masked by (1.0 - land) so land is never touched.
    base += vec3(0.0018, 0.008, 0.032) * (1.0 - land);

    float facing = clamp(dot(normal, viewDir), 0.0, 1.0);

    // Ocean glint: tight moonlight specular + a soft cool Fresnel reflection.
    vec3 halfDir = normalize(moonDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), 80.0) * (1.0 - land);
    base += vec3(0.18, 0.34, 0.7) * spec * 0.28;
    base += vec3(0.08, 0.2, 0.46) * pow(1.0 - facing, 4.0) * (1.0 - land) * 0.4;

    // ================= Illuminated civilization =================
    // THE dominant feature. Built from the real NASA night-lights texture as a
    // dense, layered field of warm light rather than a handful of bright dots.
    //
    // Two-part response tuned for satellite-at-night detail rather than glowing
    // patches. A steep response curve makes the emissive track the night
    // texture's own fine per-pixel structure — thousands of distinct points —
    // instead of inflating mid-tones into blobs, and gives a wide brightness
    // spread (tiny towns → warm cities → blazing capitals):
    //  - coverage: a very low floor so many small settlements register, but a
    //    steep exponent so each stays a small point, not a patch.
    //  - cores: a high threshold + steep power so ONLY true capitals reach the
    //    extreme white-gold HDR that reads as a brilliant metropolitan core.
    // ACES tone mapping (renderer) compresses the peaks, keeping cores warm and
    // detailed instead of clipping to flat white.
    // Unsharp-mask the night lights against a coarser mip (a local average) to
    // recover fine high-frequency detail that mip/bilinear filtering softens:
    // sharper individual settlements, crisper coastal corridors, a less smoothed
    // (more organic) distribution, and clearer structure inside big metros.
    // Deliberately asymmetric — the DARKENING of the gaps between lights is kept
    // full (that is what defines structure) while the bright overshoot at cores
    // is attenuated, so metros gain definition without getting brighter and the
    // bloom/overall exposure is essentially unchanged.
    vec3 night = texture2D(nightTexture, vUv).rgb;
    vec3 nightBlur = texture2D(nightTexture, vUv, 2.0).rgb;
    vec3 diff = night - nightBlur;
    vec3 nightSharp = night + min(diff, vec3(0.0)) * 0.9 + max(diff, vec3(0.0)) * 0.32;
    float rawLum = dot(max(nightSharp, vec3(0.0)), vec3(0.3, 0.59, 0.11));
    float coverage = pow(max(rawLum - 0.006, 0.0) * 1.25, 1.62);
    float cores = pow(max(rawLum - 0.35, 0.0) * 1.7, 2.6);

    // Two shimmers: a gentle regional twinkle over the whole lit field, and a
    // sharper high-frequency sparkle that only the bright metro cores carry, so
    // the dense clusters visibly scintillate and their bloom halos pulse.
    float twinkle = 0.94 + 0.06 * sin(uTime * 2.4 + vUv.x * 180.0 + vUv.y * 90.0);
    float sparkle = 0.72 + 0.28 * sin(uTime * 8.5 + vUv.x * 640.0 + vUv.y * 430.0);
    float city = coverage * twinkle + cores * 3.2 * sparkle;

    // Layered warm gradient — every city carries multiple colour layers, from
    // deep-amber outskirts through orange, golden amber and soft gold to a
    // warm-white core. Never flat white (top stop is warm #FFF8E2).
    vec3 amber      = vec3(1.0, 0.541, 0.227); // #FF8A3A deep amber outer
    vec3 orange     = vec3(1.0, 0.667, 0.290); // #FFAA4A warm orange
    vec3 goldAmber  = vec3(1.0, 0.784, 0.416); // #FFC76A golden amber
    vec3 softGold   = vec3(1.0, 0.886, 0.604); // #FFE29A soft gold
    vec3 warmWhite  = vec3(1.0, 0.945, 0.83); // warm golden core (holds hue when bright)
    vec3 lights = amber;
    lights = mix(lights, orange,    smoothstep(0.03, 0.10, rawLum));
    lights = mix(lights, goldAmber, smoothstep(0.10, 0.22, rawLum));
    lights = mix(lights, softGold,  smoothstep(0.22, 0.42, rawLum));
    lights = mix(lights, warmWhite, smoothstep(0.42, 0.75, rawLum));

    // Strict land gate for the emissive. The shading land mask isn't a clean
    // ocean/land cut — the day texture keeps moderate luminance over water
    // (coasts, shallow seas, ice), so reusing it lets a little light bleed onto
    // the sea. This gate uses a tighter threshold and squares the result, so
    // partial-land pixels (coastal water) collapse to ~zero while solid land
    // stays full. Result: the ocean goes fully dark right up to the shoreline,
    // and only genuine land carries the warm city glow.
    float emitLand = smoothstep(0.09, 0.155, dayLum);
    emitLand *= emitLand;
    // Soft highlight roll-off: below the knee nothing changes (overall exposure
    // and the small/medium-city look are preserved), while the extreme metro-core
    // peaks are gently compressed so they keep warm golden channel detail instead
    // of every channel clipping toward white.
    float emit = city * 5.6;
    emit = emit < 7.5 ? emit : 7.5 + (emit - 7.5) / (1.0 + (emit - 7.5) * 0.16);
    base += lights * emit * emitLand;

    // Atmospheric scattering along the limb, approximating a Rayleigh falloff
    // with two bands: a broad inner haze (low exponent) plus a thin, brighter
    // outer edge (high exponent). The colour shifts from a saturated Rayleigh
    // blue in the denser inner band to a desaturated blue-white right at the
    // limb, and a gentle forward-scatter term lifts the side facing the key
    // (moon) light. Edge-only and low-amplitude — the land/ocean colour balance
    // underneath is untouched, and the peak stays at the previous rim level.
    float fres = 1.0 - facing;
    float haze = pow(fres, 2.7); // tighter — pulled closer to the limb
    float edge = pow(fres, 5.5); // thin bright edge, right at the rim
    float forward = clamp(dot(normal, moonDir) * 0.5 + 0.5, 0.0, 1.0);
    vec3 scatterInner = vec3(0.24, 0.46, 0.95); // saturated Rayleigh blue
    vec3 scatterLimb = vec3(0.44, 0.64, 1.0);   // still predominantly blue at limb
    vec3 scatterCol = mix(scatterInner, scatterLimb, edge);
    // Lower peak + less forward-scatter whiteness so the rim supports the globe
    // without competing with the city lights.
    float scatter = haze * (0.12 + 0.08 * forward) + edge * (0.11 + 0.09 * forward);
    base += scatterCol * scatter;

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

const DAY_TEXTURE_URL = '/data/globe/earth-blue-marble.jpg'
const NIGHT_TEXTURE_4K_URL = '/data/globe/earth-night.jpg' // 4096×2048 fallback
const NIGHT_TEXTURE_8K_URL = '/data/globe/earth-night-8k.jpg' // 8192×4096 default

/**
 * Pick the night-lights texture by GPU/device capability. The 8K asset needs a
 * GPU that can hold an 8192-wide texture and enough memory to be worthwhile, so
 * we fall back to the 4K asset on constrained GPUs, mobile, and low-memory /
 * low-core devices. Purely a resolution choice — the shader is identical either
 * way. Runs once; SSR-safe (returns 4K when there is no DOM).
 */
function pickNightTextureUrl(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return NIGHT_TEXTURE_4K_URL
  }
  try {
    const probe = document.createElement('canvas')
    const gl = (probe.getContext('webgl2') ??
      probe.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return NIGHT_TEXTURE_4K_URL

    // The 8192-wide texture cannot be uploaded if the GPU's max is below it.
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    if (!maxTextureSize || maxTextureSize < 8192) return NIGHT_TEXTURE_4K_URL

    // Mobile / tablet: skip the ~180 MB (with mipmaps) 8K upload regardless.
    const ua = navigator.userAgent ?? ''
    if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) {
      return NIGHT_TEXTURE_4K_URL
    }

    // Low-memory / low-core desktops: stay on 4K where reported.
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    if (typeof deviceMemory === 'number' && deviceMemory > 0 && deviceMemory < 4) {
      return NIGHT_TEXTURE_4K_URL
    }
    const cores = navigator.hardwareConcurrency
    if (typeof cores === 'number' && cores > 0 && cores < 4) {
      return NIGHT_TEXTURE_4K_URL
    }

    return NIGHT_TEXTURE_8K_URL
  } catch {
    return NIGHT_TEXTURE_4K_URL
  }
}

/**
 * Filtering for the equirectangular Earth maps. Both are power-of-two, so we
 * enable mipmaps + trilinear min filtering (kills shimmer/aliasing when the
 * globe is small on screen) and max anisotropy (keeps city lights and coastal
 * detail crisp at grazing angles near the limb, instead of smearing). Three
 * clamps the anisotropy request to the GPU's real maximum at upload time.
 *
 * Color space is left as NoColorSpace to match the exact pipeline the shader
 * and bloom were tuned against — the raw texel values are sampled directly, so
 * swapping the 4K asset for the 8K one changes resolution only, never the look.
 */
function configureEarthTexture(texture: Texture): Texture {
  texture.colorSpace = NoColorSpace
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = 16
  texture.needsUpdate = true
  return texture
}

async function loadNightTexture(loader: TextureLoader): Promise<Texture> {
  const url = pickNightTextureUrl()
  try {
    return await loader.loadAsync(url)
  } catch (error) {
    // If the 8K asset fails (network/decoding/memory), degrade to 4K.
    if (url !== NIGHT_TEXTURE_4K_URL) {
      console.warn('8K night texture failed, falling back to 4K:', error)
      return loader.loadAsync(NIGHT_TEXTURE_4K_URL)
    }
    throw error
  }
}

async function createEarthMaterial(): Promise<EarthMaterial> {
  const loader = new TextureLoader()
  const [dayTexture, nightTexture] = await Promise.all([
    loader.loadAsync(DAY_TEXTURE_URL),
    loadNightTexture(loader),
  ])
  configureEarthTexture(dayTexture)
  configureEarthTexture(nightTexture)
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

/**
 * Each route is drawn as a faint continuous "line" arc (the structure). Routes
 * that carry traffic ALSO get a second "packet" arc on the identical path — a
 * tiny bright moving dash. Two arcs with the same endpoints + altitude overlap
 * exactly, so the packet appears to travel along the visible line while only the
 * packet is bright enough to catch the bloom (glow around the packet, not the
 * whole arc).
 */
type ArcKind = 'line' | 'packet'
/**
 * Weight drives BOTH the height hierarchy and the warm-gold brightness:
 *   hero     — iconic global-trunk long-hauls: highest, brightest.
 *   trunk    — other long routes between two global hubs: high.
 *   inter    — intercontinental regional routes: medium.
 *   regional — short same-region routes: low, hugging the globe.
 */
type ArcWeight = 'hero' | 'trunk' | 'inter' | 'regional'
interface ArcDatum {
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  index: number
  weight: ArcWeight
  /** A small accent set rendered cool blue-white; everything else is warm gold. */
  cool: boolean
  /** Altitude auto-scale (×distance by the lib) — sets the height hierarchy. */
  altitudeScale: number
  stroke: number
  kind: ArcKind
  /** Dash params. Lines are solid (length 1, gap 0, time 0); packets animate. */
  dashLength: number
  dashGap: number
  animateTime: number
}

// A weighted, non-uniform route set. Major financial/tech hubs (NY, London,
// Singapore, Hong Kong, Frankfurt, Tokyo) carry many outgoing links; smaller
// centers only a few. Emphasis on intercontinental corridors (NA↔EU, EU↔Asia,
// NA↔Asia, Asia↔Oceania) plus tighter regional clusters in Europe, North
// America and East Asia.
const LINKS: Array<[string, string]> = [
  // North America ↔ Europe
  ['new-york', 'london'],
  ['new-york', 'frankfurt'],
  ['new-york', 'paris'],
  ['new-york', 'zurich'],
  ['stockholm', 'new-york'],
  ['toronto', 'london'],
  ['toronto', 'new-york'],
  // Europe (regional)
  ['london', 'frankfurt'],
  ['london', 'paris'],
  ['london', 'zurich'],
  ['london', 'stockholm'],
  ['paris', 'frankfurt'],
  ['paris', 'zurich'],
  ['frankfurt', 'zurich'],
  ['frankfurt', 'stockholm'],
  // Europe ↔ Middle East / Asia
  ['london', 'dubai'],
  ['london', 'mumbai'],
  ['london', 'hong-kong'],
  ['london', 'tokyo'],
  ['london', 'singapore'],
  ['frankfurt', 'dubai'],
  ['frankfurt', 'singapore'],
  ['frankfurt', 'shanghai'],
  ['paris', 'dubai'],
  ['paris', 'hong-kong'],
  ['paris', 'singapore'],
  ['zurich', 'dubai'],
  ['zurich', 'singapore'],
  // North America ↔ Asia
  ['new-york', 'tokyo'],
  ['new-york', 'hong-kong'],
  ['new-york', 'singapore'],
  ['new-york', 'mumbai'],
  ['new-york', 'dubai'],
  ['toronto', 'tokyo'],
  ['toronto', 'hong-kong'],
  // Middle East ↔ Asia
  ['dubai', 'mumbai'],
  ['dubai', 'shanghai'],
  ['dubai', 'singapore'],
  ['dubai', 'hong-kong'],
  ['mumbai', 'singapore'],
  ['mumbai', 'hong-kong'],
  // East Asia (regional)
  ['hong-kong', 'singapore'],
  ['hong-kong', 'shanghai'],
  ['hong-kong', 'tokyo'],
  ['shanghai', 'tokyo'],
  ['shanghai', 'singapore'],
  ['singapore', 'tokyo'],
  // Asia ↔ Oceania
  ['tokyo', 'sydney'],
  ['hong-kong', 'sydney'],
  ['singapore', 'sydney'],
  // South America
  ['new-york', 'sao-paulo'],
  ['sao-paulo', 'london'],
  ['sao-paulo', 'frankfurt'],
  // Africa
  ['johannesburg', 'london'],
  ['johannesburg', 'new-york'],
  ['johannesburg', 'frankfurt'],
  ['johannesburg', 'dubai'],
  ['johannesburg', 'singapore'],
  ['johannesburg', 'sao-paulo'],
  ['lagos', 'london'],
  ['lagos', 'frankfurt'],
  ['lagos', 'dubai'],
  ['cape-town', 'johannesburg'],
  ['cape-town', 'london'],
  ['cape-town', 'dubai'],
  ['nairobi', 'london'],
  ['nairobi', 'dubai'],
  ['nairobi', 'mumbai'],
  ['nairobi', 'johannesburg'],
  ['casablanca', 'london'],
  ['casablanca', 'paris'],
  ['casablanca', 'new-york'],
  // South America → Europe / Africa / South Asia
  ['sao-paulo', 'paris'],
  ['sao-paulo', 'lagos'],
  ['sao-paulo', 'cape-town'],
  ['sao-paulo', 'mumbai'],
  ['buenos-aires', 'sao-paulo'],
  ['buenos-aires', 'london'],
  ['buenos-aires', 'johannesburg'],
  ['buenos-aires', 'mumbai'],
  ['santiago', 'sao-paulo'],
  ['santiago', 'frankfurt'],
  ['santiago', 'johannesburg'],
  ['santiago', 'mumbai'],
  ['bogota', 'london'],
  ['bogota', 'lagos'],
  ['bogota', 'mumbai'],
]

const MAJOR_HUBS = new Set([
  'new-york',
  'london',
  'frankfurt',
  'tokyo',
  'hong-kong',
  'singapore',
])

const CENTER_BY_ID = new Map(MARKET_CENTERS.map((c) => [c.id, c]))

// Deterministic per-arc pseudo-random so heights, packet selection, speeds and
// offsets vary organically but stay stable across renders.
function arcHash(n: number): number {
  let h = Math.imul(n + 1, 2654435761)
  h = (h ^ (h >>> 15)) >>> 0
  return h
}

const routeKey = (a: string, b: string) => [a, b].sort().join('|')

// A handful of iconic long-haul corridors between the largest global hubs,
// drawn highest and brightest to convey global scale.
const HERO_ROUTES = new Set([
  routeKey('new-york', 'tokyo'),
  routeKey('new-york', 'hong-kong'),
  routeKey('new-york', 'singapore'),
  routeKey('london', 'tokyo'),
  routeKey('london', 'hong-kong'),
  routeKey('london', 'singapore'),
  routeKey('london', 'johannesburg'),
])

// Great-circle central angle as a fraction of PI (0 = same point, 1 = antipodal).
function arcDistance(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const r = Math.PI / 180
  const la1 = a.lat * r
  const la2 = b.lat * r
  const d =
    Math.sin(la1) * Math.sin(la2) +
    Math.cos(la1) * Math.cos(la2) * Math.cos((a.lng - b.lng) * r)
  return Math.acos(Math.min(1, Math.max(-1, d))) / Math.PI
}

// Per-weight tables. The lib multiplies altitude by route distance, so short
// routes stay low even when important — giving a strong layered 3-D hierarchy.
const ALT_SCALE: Record<ArcWeight, number> = {
  hero: 0.58,
  trunk: 0.46,
  inter: 0.3,
  regional: 0.13,
}
const LINE_STROKE: Record<ArcWeight, number> = {
  hero: 0.12,
  trunk: 0.115,
  inter: 0.095,
  regional: 0.078,
}
const PACKET_STROKE: Record<ArcWeight, number> = {
  hero: 0.27,
  trunk: 0.25,
  inter: 0.22,
  regional: 0.2,
}
const PACKET_PROB: Record<ArcWeight, number> = {
  hero: 82,
  trunk: 58,
  inter: 40,
  regional: 26,
}
const PACKET_SPEED: Record<ArcWeight, number> = {
  hero: 2000,
  trunk: 2300,
  inter: 2900,
  regional: 3400,
}

function weightFor(a: string, b: string, dist: number, hero: boolean): ArcWeight {
  if (hero) return 'hero'
  // Short routes always hug the globe, regardless of hub importance.
  if (dist < 0.2) return 'regional'
  // Long routes between two global hubs are trunks; other long routes are
  // intercontinental regionals.
  if (MAJOR_HUBS.has(a) && MAJOR_HUBS.has(b)) return 'trunk'
  return 'inter'
}

const LINE_ARCS: ArcDatum[] = LINKS.flatMap(([a, b], index) => {
  const from = CENTER_BY_ID.get(a)
  const to = CENTER_BY_ID.get(b)
  if (!from || !to) return []
  const hero = HERO_ROUTES.has(routeKey(a, b))
  const dist = arcDistance(from, to)
  const weight = weightFor(a, b, dist, hero)
  const jitter = (arcHash(index) % 100) / 100 - 0.5
  const altitudeScale = ALT_SCALE[weight] + jitter * 0.05
  // Warm gold everywhere; only a small ~8% accent set — never the important
  // hero/trunk routes — is cool blue-white, purely for visual contrast.
  const cool =
    weight !== 'hero' && weight !== 'trunk' && arcHash(index * 11 + 7) % 100 < 15
  return [
    {
      startLat: from.lat,
      startLng: from.lng,
      endLat: to.lat,
      endLng: to.lng,
      index,
      weight,
      cool,
      altitudeScale,
      stroke: LINE_STROKE[weight],
      kind: 'line',
      dashLength: 1,
      dashGap: 0,
      animateTime: 0,
    },
  ]
})

// Packets are probabilistic and weighted toward busier routes, so not every arc
// carries one and the flow feels organic. A share run in reverse (bidirectional
// traffic); size, spacing and speed vary per packet; hero/trunk routes
// occasionally carry two packets chasing each other.
const PACKET_ARCS: ArcDatum[] = LINE_ARCS.flatMap((arc) => {
  const h = arcHash(arc.index * 7 + 5)
  if (h % 100 >= PACKET_PROB[arc.weight]) return []
  const reversed = (h & 1) === 0
  const multi = (arc.weight === 'hero' || arc.weight === 'trunk') && h % 3 === 0
  const dashLength = 0.025 + (h % 3) * 0.008 // subtle size variation
  const dashGap = multi ? 0.4 + (h % 3) * 0.05 : 0.72 + (h % 5) * 0.05
  return [
    {
      ...arc,
      kind: 'packet',
      startLat: reversed ? arc.endLat : arc.startLat,
      startLng: reversed ? arc.endLng : arc.startLng,
      endLat: reversed ? arc.startLat : arc.endLat,
      endLng: reversed ? arc.startLng : arc.endLng,
      stroke: PACKET_STROKE[arc.weight] + (h % 3) * 0.02, // subtle size variation
      dashLength,
      dashGap,
      animateTime: PACKET_SPEED[arc.weight] + (h % 6) * 460,
    },
  ]
})

const ARCS_ALL: ArcDatum[] = [...LINE_ARCS, ...PACKET_ARCS]

const PULSE_HUBS = MARKET_CENTERS.filter((c) => MAJOR_HUBS.has(c.id))

interface LightGlobeProps {
  onSelectCountry: (entry: CountryRegistryEntry) => void
  reducedMotion: boolean
}

export function LightGlobe({ reducedMotion }: LightGlobeProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<GlobeMethods | undefined>(undefined)
  const [size, setSize] = useState({ width: 0, height: 0 })
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

  // Gentle cinematic auto-rotation, damping, zoom clamps.
  useEffect(() => {
    const controls = globeRef.current?.controls()
    if (!controls) return
    controls.autoRotate = !reducedMotion
    controls.autoRotateSpeed = 0.42
    controls.enableDamping = true
    controls.enableZoom = true
    controls.minDistance = 400
    controls.maxDistance = 660
    controls.minPolarAngle = Math.PI * 0.18
    controls.maxPolarAngle = Math.PI * 0.82
  }, [reducedMotion, size.width > 0])

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
    const bloom = new UnrealBloomPass(
      new Vector2(size.width, size.height),
      0.34,
      0.18,
      0.75,
    )
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
      aria-label="Interaktiv jordglob över globala marknader."
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
          atmosphereColor="#4f7398"
          atmosphereAltitude={0.055}
          arcsData={reducedMotion ? LINE_ARCS : ARCS_ALL}
          arcStartLat={(d) => (d as ArcDatum).startLat}
          arcStartLng={(d) => (d as ArcDatum).startLng}
          arcEndLat={(d) => (d as ArcDatum).endLat}
          arcEndLng={(d) => (d as ArcDatum).endLng}
          arcColor={(d: object) => {
            const arc = d as ArcDatum
            // Every arc is a 3-stop gradient that fades to fully transparent at
            // both endpoints (smooth fade-in / fade-out) and peaks at the apex.
            // Packets are bright (they catch the bloom → soft glow travels with
            // them); the underlying line stays faint (below bloom, no glow).
            // Warm gold dominates, brightness scaling with weight; only the small
            // cool accent set is blue-white.
            if (arc.kind === 'packet') {
              if (arc.cool) {
                return [
                  'rgba(200, 224, 251, 0)',
                  'rgba(230, 242, 255, 0.9)',
                  'rgba(200, 224, 251, 0)',
                ]
              }
              const a =
                arc.weight === 'hero'
                  ? 0.98
                  : arc.weight === 'trunk'
                    ? 0.94
                    : arc.weight === 'inter'
                      ? 0.9
                      : 0.85
              return [
                'rgba(255, 206, 142, 0)',
                `rgba(255, 232, 186, ${a})`,
                'rgba(255, 206, 142, 0)',
              ]
            }
            if (arc.cool) {
              return [
                'rgba(150, 186, 236, 0)',
                'rgba(176, 206, 240, 0.16)',
                'rgba(150, 186, 236, 0)',
              ]
            }
            const a =
              arc.weight === 'hero'
                ? 0.42
                : arc.weight === 'trunk'
                  ? 0.34
                  : arc.weight === 'inter'
                    ? 0.27
                    : 0.21
            return [
              'rgba(255, 186, 102, 0)',
              `rgba(255, 202, 130, ${a})`,
              'rgba(255, 186, 102, 0)',
            ]
          }}
          arcStroke={(d) => (d as ArcDatum).stroke}
          arcAltitudeAutoScale={(d) => (d as ArcDatum).altitudeScale}
          arcDashLength={(d: object) => (d as ArcDatum).dashLength}
          arcDashGap={(d: object) => (d as ArcDatum).dashGap}
          arcDashAnimateTime={(d: object) => (d as ArcDatum).animateTime}
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
