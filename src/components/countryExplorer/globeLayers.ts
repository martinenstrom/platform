/**
 * Pure/imperative three.js helpers for the globe's cinematic rendering —
 * day/night shading, a moving cloud layer, and a custom Fresnel atmosphere —
 * kept separate from the React component so it stays focused on wiring.
 * Nothing here is React; everything operates on plain three.js objects.
 *
 * Re-authored from the version built and validated earlier this session,
 * itself adapted from `three-globe`'s own official `day-night-cycle` and
 * `clouds` examples (`node_modules/three-globe/example/`) rather than
 * written from scratch.
 */

import {
  AdditiveBlending,
  BackSide,
  Mesh,
  MeshPhongMaterial,
  ShaderMaterial,
  SphereGeometry,
  TextureLoader,
  Vector2,
  Vector3,
  type Texture,
} from 'three'
import { century, declination, equationOfTime } from 'solar-calculator'

export const GLOBE_TEXTURES = {
  day: '/data/globe/earth-blue-marble.jpg',
  night: '/data/globe/earth-night.jpg',
  clouds: '/data/globe/clouds.png',
} as const

/**
 * Day/night blend shader — adapted from `three-globe`'s own official
 * "day-night-cycle" example (light intensity = dot(normal, sunDirection),
 * softened at the terminator with `smoothstep`), then reworked into a
 * *holographic* Earth: the daylit texture is heavily desaturated, darkened
 * and tinted deep-blue so land reads dark and oceans near-black (no bright
 * satellite look, no blown-out white poles), a faint cyan lat/long data
 * grid is laid over it, and the night texture's city lights stay on the
 * dark side.
 */
const DAY_NIGHT_VERTEX_SHADER = `
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

const DAY_NIGHT_FRAGMENT_SHADER = `
  #define PI 3.141592653589793
  uniform sampler2D dayTexture;
  uniform sampler2D nightTexture;
  uniform vec2 sunPosition;
  uniform vec2 globeRotation;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vViewDir;

  float toRad(in float a) {
    return a * PI / 180.0;
  }

  vec3 Polar2Cartesian(in vec2 c) { // [lng, lat]
    float theta = toRad(90.0 - c.x);
    float phi = toRad(90.0 - c.y);
    return vec3(
      sin(phi) * cos(theta),
      cos(phi),
      sin(phi) * sin(theta)
    );
  }

  void main() {
    float invLon = toRad(globeRotation.x);
    float invLat = -toRad(globeRotation.y);
    mat3 rotX = mat3(
      1, 0, 0,
      0, cos(invLat), -sin(invLat),
      0, sin(invLat), cos(invLat)
    );
    mat3 rotY = mat3(
      cos(invLon), 0, sin(invLon),
      0, 1, 0,
      -sin(invLon), 0, cos(invLon)
    );
    vec3 rotatedSunDirection = rotX * rotY * Polar2Cartesian(sunPosition);
    float intensity = dot(normalize(vNormal), normalize(rotatedSunDirection));

    // Light-absorbing composite: near-black navy oceans, graphite-slate land
    // with the texture kept only as subtle relief — the surface absorbs light
    // rather than reflecting it; the digital overlays carry the brightness.
    vec3 raw = texture2D(dayTexture, vUv).rgb;
    float lum = dot(raw, vec3(0.299, 0.587, 0.114));
    vec3 desat = mix(vec3(lum), raw, 0.06);        // essentially monochrome
    vec3 oceanBase = vec3(0.006, 0.014, 0.023);    // deep navy, almost black
    vec3 landBase = vec3(0.013, 0.021, 0.03);      // dark graphite-slate
    float landMask = smoothstep(0.05, 0.18, lum);
    vec3 dayColor = mix(oceanBase, landBase + desat * 0.05 * vec3(0.5, 0.6, 0.7), landMask);

    // Cyan lat/long data grid — strongest over dark oceans, restrained on land —
    // plus a finer secondary grid so the surface reads as constructed from data.
    float ocean = 1.0 - smoothstep(0.06, 0.18, lum);
    vec2 g = abs(fract(vUv * vec2(48.0, 24.0)) - 0.5);
    float gridLine = smoothstep(0.46, 0.5, max(g.x, g.y));
    dayColor += vec3(0.05, 0.12, 0.16) * gridLine * (0.35 + 0.65 * ocean);
    vec2 g2 = abs(fract(vUv * vec2(96.0, 48.0)) - 0.5);
    float gridFine = smoothstep(0.48, 0.5, max(g2.x, g2.y));
    dayColor += vec3(0.025, 0.06, 0.08) * gridFine * (0.25 + 0.75 * ocean);

    // City lights, cool-shifted — surface data, not warm photography.
    vec3 nightColor = texture2D(nightTexture, vUv).rgb * 1.0 * vec3(0.85, 1.0, 1.22);

    float blendFactor = smoothstep(-0.12, 0.12, intensity);
    vec3 color = mix(nightColor, dayColor, blendFactor);
    // A faint constant city-lights term keeps the data identity on the lit side too.
    color += nightColor * 0.15 * blendFactor;

    // Projector uplight: the platform below is the scene's light source, so
    // the lower hemisphere reads brighter and the top stays darker — never a
    // uniformly lit ball. (Sphere UV: v = 0 at the south pole.)
    float uplight = mix(1.3, 0.68, smoothstep(0.15, 0.85, vUv.y));
    color *= uplight;

    // Internal cyan illumination — kept tight to the limb and subtle, so the
    // continents themselves never emit cyan; the data layers do the glowing.
    float facing = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
    float innerGlow = pow(1.0 - facing, 2.5);
    float shimmer = 0.85 + 0.15 * sin(uTime * 0.9 + vUv.x * 12.0);
    color += vec3(0.06, 0.15, 0.19) * innerGlow * shimmer;
    float fresnel = pow(1.0 - facing, 3.0);
    float alpha = mix(1.0, 0.82, fresnel);
    gl_FragColor = vec4(color, alpha);
  }
`

export interface DayNightMaterial extends ShaderMaterial {
  uniforms: {
    dayTexture: { value: Texture }
    nightTexture: { value: Texture }
    sunPosition: { value: Vector2 }
    globeRotation: { value: Vector2 }
    uTime: { value: number }
  }
}

export async function createDayNightMaterial(): Promise<DayNightMaterial> {
  const loader = new TextureLoader()
  const [dayTexture, nightTexture] = await Promise.all([
    loader.loadAsync(GLOBE_TEXTURES.day),
    loader.loadAsync(GLOBE_TEXTURES.night),
  ])

  return new ShaderMaterial({
    uniforms: {
      dayTexture: { value: dayTexture },
      nightTexture: { value: nightTexture },
      sunPosition: { value: new Vector2() },
      globeRotation: { value: new Vector2() },
      uTime: { value: 0 },
    },
    vertexShader: DAY_NIGHT_VERTEX_SHADER,
    fragmentShader: DAY_NIGHT_FRAGMENT_SHADER,
    transparent: true,
  }) as DayNightMaterial
}

/** [longitude, latitude] of the sun's sub-solar point at `date`, in degrees. */
export function sunPositionAt(date: number): [number, number] {
  const day = new Date(date).setUTCHours(0, 0, 0, 0)
  const t = century(date)
  const longitude = ((day - date) / 864e5) * 360 - 180
  return [longitude - equationOfTime(t) / 4, declination(t)]
}

export interface CloudLayer {
  mesh: Mesh
  dispose: () => void
}

/** Separate, slightly-larger sphere with a transparent cloud texture — rotates independently of the Earth/camera. */
export async function createCloudLayer(
  globeRadius: number,
  lowPower = false,
): Promise<CloudLayer> {
  const CLOUDS_ALTITUDE = 0.006
  const segments = lowPower ? 32 : 64
  const geometry = new SphereGeometry(
    globeRadius * (1 + CLOUDS_ALTITUDE),
    segments,
    segments,
  )
  const material = new MeshPhongMaterial({
    transparent: true,
    opacity: 0.015,
    color: 0xcfe4ff,
    depthWrite: false,
  })
  const mesh = new Mesh(geometry, material)

  const texture = await new TextureLoader().loadAsync(GLOBE_TEXTURES.clouds)
  material.map = texture
  material.needsUpdate = true

  return {
    mesh,
    dispose: () => {
      geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}

/**
 * Custom Fresnel atmosphere — brighter on the sun-facing side, softer on
 * the dark side. react-globe.gl's built-in `showAtmosphere` prop is a flat
 * rim glow that can't vary with sun position, so this replaces it: a
 * larger back-face sphere with additive blending, sharing the same
 * `sunPosition`/`globeRotation` uniforms the day/night material uses.
 */
export interface AtmosphereMaterial extends ShaderMaterial {
  uniforms: {
    sunPosition: { value: Vector2 }
    globeRotation: { value: Vector2 }
    glowColor: { value: Vector3 }
    uTime: { value: number }
  }
}

export interface AtmosphereLayer {
  mesh: Mesh
  material: AtmosphereMaterial
  dispose: () => void
}

const ATMOSPHERE_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const ATMOSPHERE_FRAGMENT_SHADER = `
  #define PI 3.141592653589793
  uniform vec2 sunPosition;
  uniform vec2 globeRotation;
  uniform vec3 glowColor;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  float toRad(in float a) {
    return a * PI / 180.0;
  }

  vec3 Polar2Cartesian(in vec2 c) {
    float theta = toRad(90.0 - c.x);
    float phi = toRad(90.0 - c.y);
    return vec3(
      sin(phi) * cos(theta),
      cos(phi),
      sin(phi) * sin(theta)
    );
  }

  void main() {
    float invLon = toRad(globeRotation.x);
    float invLat = -toRad(globeRotation.y);
    mat3 rotX = mat3(
      1, 0, 0,
      0, cos(invLat), -sin(invLat),
      0, sin(invLat), cos(invLat)
    );
    mat3 rotY = mat3(
      cos(invLon), 0, sin(invLon),
      0, 1, 0,
      -sin(invLon), 0, cos(invLon)
    );
    vec3 rotatedSunDirection = rotX * rotY * Polar2Cartesian(sunPosition);
    float sunFactor = clamp(dot(normalize(vNormal), normalize(rotatedSunDirection)) * 0.5 + 0.5, 0.0, 1.0);

    // Thin holographic rim: continuous but uneven — modulated by illumination
    // (sunFactor), a slow breathing pulse, and a gentle angular variation so it
    // never reads as a solid flat ring. Sharp falloff keeps it edge-only.
    float fresnel = pow(1.0 - clamp(dot(vNormal, vViewDir), 0.0, 1.0), 10.0);
    float breathe = 0.92 + 0.08 * sin(uTime * 1.7);
    float angular = 0.78 + 0.22 * sin(atan(vNormal.y, vNormal.x) * 3.0 + uTime * 0.4);
    float intensity = fresnel * mix(0.4, 1.0, sunFactor) * breathe * angular * 0.16;
    gl_FragColor = vec4(glowColor, intensity);
  }
`

export function createAtmosphereLayer(
  globeRadius: number,
  lowPower = false,
): AtmosphereLayer {
  const ATMOSPHERE_ALTITUDE = 0.007
  const segments = lowPower ? 32 : 64
  const geometry = new SphereGeometry(
    globeRadius * (1 + ATMOSPHERE_ALTITUDE),
    segments,
    segments,
  )
  const material = new ShaderMaterial({
    uniforms: {
      sunPosition: { value: new Vector2() },
      globeRotation: { value: new Vector2() },
      // Deep cyan-blue — darker than the raw accent so the rim never reads white.
      glowColor: { value: new Vector3(0.1, 0.42, 0.6) },
      uTime: { value: 0 },
    },
    vertexShader: ATMOSPHERE_VERTEX_SHADER,
    fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
    transparent: true,
    blending: AdditiveBlending,
    side: BackSide,
    depthWrite: false,
  }) as AtmosphereMaterial
  const mesh = new Mesh(geometry, material)

  return {
    mesh,
    material,
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}

/** Adds the cloud + atmosphere layers to the scene once; returns a single disposer. */
export function attachSceneLayers(
  scene: { add: (obj: Mesh) => void; remove: (obj: Mesh) => void },
  clouds: CloudLayer,
  atmosphere: AtmosphereLayer,
): () => void {
  scene.add(clouds.mesh)
  scene.add(atmosphere.mesh)

  return () => {
    scene.remove(clouds.mesh)
    scene.remove(atmosphere.mesh)
    clouds.dispose()
    atmosphere.dispose()
  }
}
