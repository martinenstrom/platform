/**
 * In-scene holographic projector: an engineered platform (dark base plate,
 * polar ring/spoke grid, segmented rings, radar sweep, orbiting lights, amber
 * accents), a layered volumetric multi-ray beam with scan lines and rising
 * dust motes, and an ambient particle field — real three.js geometry living
 * inside the globe scene so it foreshortens, occludes and scales with the
 * camera (replacing the earlier screen-space CSS mock, which detached from
 * the globe on drag/zoom). Same conventions as `globeLayers.ts`: nothing here
 * is React.
 */

import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3 as ThreeVector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export interface HologramSceneLayer {
  group: Group
  tick: (deltaMs: number) => void
  dispose: () => void
}

const CYAN = 0x4cc6e8
const AMBER = 0xeaa73c
const TWO_PI = Math.PI * 2
/** Platform plane's offset below the globe center, in globe radii. */
const PLATFORM_DROP = 1.16

/** Deterministic mulberry32 PRNG so particle layouts are stable across renders. */
function createRandom(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Disposable {
  dispose: () => void
}

/**
 * Shared soft radial sprite for all particle systems — without it,
 * PointsMaterial draws hard squares, which read as artifacts whenever a
 * particle drifts close to the camera. Cached for the module's lifetime.
 */
let softDotTexture: CanvasTexture | null = null
function getSoftDotTexture(): CanvasTexture {
  if (softDotTexture) return softDotTexture
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.55)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  softDotTexture = new CanvasTexture(canvas)
  return softDotTexture
}

function glowMaterial(opacity: number, color: number = CYAN): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  })
}

/** Rotates a planar (XY) mesh flat into the platform's XZ plane. */
function flat<T extends Mesh>(mesh: T): T {
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

const BASE_PLATE_VERTEX_SHADER = `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** Dark plate with a faintly lighter centre — reads as a soft reflective surface, never a glow disc. */
const BASE_PLATE_FRAGMENT_SHADER = `
  uniform float uRadius;
  varying vec2 vPos;
  void main() {
    float r = length(vPos) / uRadius;
    vec3 color = mix(vec3(0.012, 0.02, 0.034), vec3(0.004, 0.008, 0.014), r);
    float alpha = (1.0 - smoothstep(0.72, 1.0, r)) * 0.85;
    gl_FragColor = vec4(color, alpha);
  }
`

const SWEEP_VERTEX_SHADER = `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SWEEP_FRAGMENT_SHADER = `
  uniform float uAngle;
  uniform float uInner;
  uniform float uOuter;
  uniform float uStrength;
  varying vec2 vPos;
  void main() {
    float ang = atan(vPos.y, vPos.x);
    float d = mod(uAngle - ang, 6.2831853);
    float trail = smoothstep(1.2, 0.0, d);
    float r = length(vPos);
    float radial = smoothstep(uInner, uInner + 14.0, r) * (1.0 - smoothstep(uOuter - 20.0, uOuter, r));
    gl_FragColor = vec4(vec3(0.298, 0.776, 0.91), trail * radial * uStrength);
  }
`

const HOLO_DISC_VERTEX_SHADER = `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** Faint additive disc with a soft radial fade — a floating holographic plane. */
const HOLO_DISC_FRAGMENT_SHADER = `
  uniform float uRadius;
  uniform float uAlpha;
  varying vec2 vPos;
  void main() {
    float r = length(vPos) / uRadius;
    float alpha = (1.0 - smoothstep(0.45, 1.0, r)) * uAlpha;
    gl_FragColor = vec4(vec3(0.298, 0.776, 0.91), alpha);
  }
`

/**
 * The engineered projector platform: dark base plate, an 8-ring polar grid
 * with radial spokes and tick marks, segmented counter-rotating rings, amber
 * accent rings and lights, a radar sweep, orbiting light dots, an expanding
 * energy pulse and a bright central source — several independent animation
 * speeds, wider than the globe's lower third.
 */
export function createProjectorPlatform(globeRadius: number): HologramSceneLayer {
  const group = new Group()
  group.position.y = -globeRadius * PLATFORM_DROP
  const disposables: Disposable[] = []

  const plateUniforms = { uRadius: { value: globeRadius * 1.48 } }
  const plateGeometry = new CircleGeometry(globeRadius * 1.48, 96)
  const plateMaterial = new ShaderMaterial({
    uniforms: plateUniforms,
    vertexShader: BASE_PLATE_VERTEX_SHADER,
    fragmentShader: BASE_PLATE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
  disposables.push(plateGeometry, plateMaterial)
  const plate = flat(new Mesh(plateGeometry, plateMaterial))
  plate.position.y = -0.5
  group.add(plate)

  // Structural ring grid, fading outward.
  ;[
    { r: 0.32, opacity: 0.36 },
    { r: 0.5, opacity: 0.31 },
    { r: 0.68, opacity: 0.27 },
    { r: 0.86, opacity: 0.24 },
    { r: 1.02, opacity: 0.2 },
    { r: 1.16, opacity: 0.17 },
    { r: 1.28, opacity: 0.14 },
    { r: 1.38, opacity: 0.11 },
    { r: 1.5, opacity: 0.085 },
  ].forEach(({ r, opacity }) => {
    const radius = globeRadius * r
    const geometry = new RingGeometry(radius - 0.7, radius + 0.7, 96)
    const material = glowMaterial(opacity)
    disposables.push(geometry, material)
    group.add(flat(new Mesh(geometry, material)))
  })

  // Subtle amber accent rings.
  ;[
    { r: 0.6, opacity: 0.26 },
    { r: 1.33, opacity: 0.18 },
  ].forEach(({ r, opacity }) => {
    const radius = globeRadius * r
    const geometry = new RingGeometry(radius - 0.45, radius + 0.45, 96)
    const material = glowMaterial(opacity, AMBER)
    disposables.push(geometry, material)
    group.add(flat(new Mesh(geometry, material)))
  })

  // Radial spokes — with the rings they form the platform's circular grid.
  // The whole spoke wheel creeps around, reading as moving radial lights.
  const spokesSub = new Group()
  {
    spokesSub.rotation.x = -Math.PI / 2
    const length = globeRadius * (1.38 - 0.32)
    const geometry = new PlaneGeometry(length, 0.55)
    geometry.translate(globeRadius * ((1.38 + 0.32) / 2), 0, 0)
    const material = glowMaterial(0.085)
    disposables.push(geometry, material)
    for (let i = 0; i < 12; i++) {
      const spoke = new Mesh(geometry, material)
      spoke.rotation.z = (TWO_PI / 12) * i
      spokesSub.add(spoke)
    }
    group.add(spokesSub)
  }

  // Inner spoke wheel, counter-rotating — a second layer of radial machinery.
  const innerSpokesSub = new Group()
  {
    innerSpokesSub.rotation.x = -Math.PI / 2
    const length = globeRadius * (0.55 - 0.32)
    const geometry = new PlaneGeometry(length, 0.5)
    geometry.translate(globeRadius * ((0.55 + 0.32) / 2), 0, 0)
    const material = glowMaterial(0.12)
    disposables.push(geometry, material)
    for (let i = 0; i < 8; i++) {
      const spoke = new Mesh(geometry, material)
      spoke.rotation.z = (TWO_PI / 8) * i + 0.3
      innerSpokesSub.add(spoke)
    }
    group.add(innerSpokesSub)
  }

  // Tiny rectangular markers scattered across the platform, rotating as one
  // slow constellation.
  const markerSub = new Group()
  {
    markerSub.rotation.x = -Math.PI / 2
    markerSub.position.y = 0.9
    const geometry = new PlaneGeometry(2.4, 1.1)
    const material = glowMaterial(0.5)
    disposables.push(geometry, material)
    const random = createRandom(77)
    for (let i = 0; i < 10; i++) {
      const marker = new Mesh(geometry, material)
      const angle = random() * TWO_PI
      const radius = globeRadius * (0.6 + random() * 0.8)
      marker.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
      marker.rotation.z = angle
      markerSub.add(marker)
    }
    group.add(markerSub)
  }

  // Small holographic slices stacked above the source, spinning independently.
  const sliceRings = [
    { r: 0.17, y: 6, speed: 0.8 },
    { r: 0.13, y: 10, speed: -0.6 },
    { r: 0.1, y: 14, speed: 1.1 },
    { r: 0.08, y: 18, speed: -0.9 },
  ].map(({ r, y, speed }) => {
    const sub = new Group()
    sub.rotation.x = -Math.PI / 2
    sub.position.y = y
    const radius = globeRadius * r
    const geometry = new RingGeometry(radius - 0.6, radius + 0.6, 48, 1, 0, 4.6)
    const material = glowMaterial(0.4)
    disposables.push(geometry, material)
    sub.add(new Mesh(geometry, material))
    group.add(sub)
    return { sub, speed }
  })

  // Static tick marks: a dense band inside the outer ring, a sparser inner band.
  ;[
    { r: 1.36, count: 48, arc: 0.016, opacity: 0.38, width: 1.6 },
    { r: 0.9, count: 32, arc: 0.012, opacity: 0.24, width: 1.2 },
  ].forEach(({ r, count, arc, opacity, width }) => {
    const sub = new Group()
    sub.rotation.x = -Math.PI / 2
    const radius = globeRadius * r
    const geometry = new RingGeometry(radius - width, radius + width, 4, 1, 0, arc)
    const material = glowMaterial(opacity)
    disposables.push(geometry, material)
    for (let i = 0; i < count; i++) {
      const tick = new Mesh(geometry, material)
      tick.rotation.z = (TWO_PI / count) * i
      sub.add(tick)
    }
    group.add(sub)
  })

  // Faint holographic discs floating just above the plate.
  ;[
    { r: 0.5, y: 2.5, alpha: 0.09 },
    { r: 0.9, y: 1.2, alpha: 0.055 },
  ].forEach(({ r, y, alpha }) => {
    const radius = globeRadius * r
    const uniforms = { uRadius: { value: radius }, uAlpha: { value: alpha } }
    const geometry = new CircleGeometry(radius, 64)
    const material = new ShaderMaterial({
      uniforms,
      vertexShader: HOLO_DISC_VERTEX_SHADER,
      fragmentShader: HOLO_DISC_FRAGMENT_SHADER,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    })
    disposables.push(geometry, material)
    const disc = flat(new Mesh(geometry, material))
    disc.position.y = y
    group.add(disc)
  })

  // Segmented rings rotating at independent speeds and directions.
  const dashedRings = [
    { radius: globeRadius * 0.42, count: 14, speed: TWO_PI / 14 },
    { radius: globeRadius * 0.55, count: 20, speed: -TWO_PI / 18 },
    { radius: globeRadius * 0.78, count: 28, speed: TWO_PI / 26 },
    { radius: globeRadius * 1.08, count: 36, speed: -TWO_PI / 38 },
    { radius: globeRadius * 1.32, count: 44, speed: TWO_PI / 60 },
    { radius: globeRadius * 1.44, count: 52, speed: -TWO_PI / 84 },
  ].map(({ radius, count, speed }) => {
    const sub = new Group()
    sub.rotation.x = -Math.PI / 2
    const geometry = new RingGeometry(radius - 0.9, radius + 0.9, 10, 1, 0, (TWO_PI / count) * 0.55)
    const material = glowMaterial(0.48)
    disposables.push(geometry, material)
    for (let i = 0; i < count; i++) {
      const dash = new Mesh(geometry, material)
      dash.rotation.z = (TWO_PI / count) * i
      sub.add(dash)
    }
    group.add(sub)
    return { sub, speed }
  })

  // Two radar sweeps: a broad outer one and a dimmer inner one running opposite.
  const makeSweep = (inner: number, outer: number, strength: number) => {
    const uniforms = {
      uAngle: { value: 0 },
      uInner: { value: globeRadius * inner },
      uOuter: { value: globeRadius * outer },
      uStrength: { value: strength },
    }
    const geometry = new RingGeometry(globeRadius * inner, globeRadius * outer, 96)
    const material = new ShaderMaterial({
      uniforms,
      vertexShader: SWEEP_VERTEX_SHADER,
      fragmentShader: SWEEP_FRAGMENT_SHADER,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    })
    disposables.push(geometry, material)
    group.add(flat(new Mesh(geometry, material)))
    return uniforms
  }
  const sweepUniforms = makeSweep(0.3, 1.38, 0.3)
  const innerSweepUniforms = makeSweep(0.18, 0.7, 0.18)

  // Bright light segments traveling along rings at independent speeds.
  const travelSegments = [
    { radius: globeRadius * 0.86, speed: 0.9, phase: 1.2, arc: 0.42 },
    { radius: globeRadius * 1.02, speed: 0.4, phase: 2.6, arc: 0.5 },
    { radius: globeRadius * 1.28, speed: -0.55, phase: 4.0, arc: 0.3 },
    { radius: globeRadius * 1.44, speed: 0.24, phase: 0.4, arc: 0.36 },
  ].map(({ radius, speed, phase, arc }) => {
    const sub = new Group()
    sub.rotation.x = -Math.PI / 2
    const geometry = new RingGeometry(radius - 1.1, radius + 1.1, 12, 1, 0, arc)
    const material = glowMaterial(0.72, 0x8fdcef)
    disposables.push(geometry, material)
    const mesh = new Mesh(geometry, material)
    mesh.rotation.z = phase
    sub.add(mesh)
    group.add(sub)
    return { sub, speed }
  })

  const orbitDotGeometry = new SphereGeometry(1.6, 10, 10)
  const orbitDotMaterial = new MeshBasicMaterial({ color: 0x74cfe6 })
  disposables.push(orbitDotGeometry, orbitDotMaterial)
  const orbitDots = [
    { radius: globeRadius * 0.68, speed: 0.5, phase: 0 },
    { radius: globeRadius * 0.95, speed: -0.34, phase: 2.1 },
    { radius: globeRadius * 1.16, speed: 0.22, phase: 3.3 },
    { radius: globeRadius * 1.28, speed: -0.18, phase: 4.9 },
  ].map((dot) => {
    const mesh = new Mesh(orbitDotGeometry, orbitDotMaterial)
    mesh.position.set(Math.cos(dot.phase) * dot.radius, 1.2, Math.sin(dot.phase) * dot.radius)
    group.add(mesh)
    return { ...dot, mesh }
  })

  const amberGeometry = new SphereGeometry(1.2, 10, 10)
  const amberMaterial = new MeshBasicMaterial({ color: AMBER })
  disposables.push(amberGeometry, amberMaterial)
  ;[0.4, 1.9, 2.7, 3.5, 5.1, 5.9].forEach((angle) => {
    const mesh = new Mesh(amberGeometry, amberMaterial)
    mesh.position.set(
      Math.cos(angle) * globeRadius * 1.2,
      0.8,
      Math.sin(angle) * globeRadius * 1.2,
    )
    group.add(mesh)
  })

  // Small amber radial ticks on the outer band — engineering accents.
  {
    const sub = new Group()
    sub.rotation.x = -Math.PI / 2
    const radius = globeRadius * 1.44
    const geometry = new RingGeometry(radius - 1.1, radius + 1.1, 4, 1, 0, 0.012)
    const material = glowMaterial(0.4, AMBER)
    disposables.push(geometry, material)
    for (let i = 0; i < 8; i++) {
      const tick = new Mesh(geometry, material)
      tick.rotation.z = (TWO_PI / 8) * i + 0.2
      sub.add(tick)
    }
    group.add(sub)
  }

  // Two energy pulses in counter-phase — a continuous, staggered emission.
  const pulseGeometry = new RingGeometry(0.94, 1, 64)
  const pulses = [0, 0.5].map((phase) => {
    const material = glowMaterial(0.6)
    disposables.push(material)
    const mesh = flat(new Mesh(pulseGeometry, material))
    group.add(mesh)
    return { mesh, material, phase }
  })
  disposables.push(pulseGeometry)

  const sourceGeometry = new CircleGeometry(globeRadius * 0.07, 48)
  const sourceMaterial = glowMaterial(0.95)
  sourceMaterial.color.set(0xd8f4fc)
  disposables.push(sourceGeometry, sourceMaterial)
  const source = flat(new Mesh(sourceGeometry, sourceMaterial))
  source.position.y = 0.2
  group.add(source)

  const coreGeometry = new SphereGeometry(2.6, 12, 12)
  const coreMaterial = new MeshBasicMaterial({ color: 0xd6f6ff })
  disposables.push(coreGeometry, coreMaterial)
  const core = new Mesh(coreGeometry, coreMaterial)
  core.position.y = 1.5
  group.add(core)

  let elapsed = 0
  let pulseT = 0.3
  const applyPulse = () => {
    pulses.forEach(({ mesh, material, phase }) => {
      const t = (pulseT + phase) % 1
      const scale = globeRadius * (0.3 + t * 1.25)
      mesh.scale.set(scale, scale, 1)
      material.opacity = 0.6 * (1 - t) ** 1.5
    })
  }
  applyPulse()

  return {
    group,
    tick: (deltaMs) => {
      const dt = deltaMs / 1000
      elapsed += dt
      dashedRings.forEach(({ sub, speed }) => {
        sub.rotation.z += speed * dt
      })
      travelSegments.forEach(({ sub, speed }) => {
        sub.rotation.z += speed * dt
      })
      sliceRings.forEach(({ sub, speed }) => {
        sub.rotation.z += speed * dt
      })
      spokesSub.rotation.z += (TWO_PI / 240) * dt
      innerSpokesSub.rotation.z -= (TWO_PI / 180) * dt
      markerSub.rotation.z -= (TWO_PI / 90) * dt
      sweepUniforms.uAngle.value = (elapsed * (TWO_PI / 10)) % TWO_PI
      innerSweepUniforms.uAngle.value = TWO_PI - ((elapsed * (TWO_PI / 11)) % TWO_PI)
      orbitDots.forEach(({ mesh, radius, speed, phase }) => {
        const angle = phase + elapsed * speed
        mesh.position.set(Math.cos(angle) * radius, 1.2, Math.sin(angle) * radius)
      })
      pulseT = (pulseT + dt / 3.6) % 1
      applyPulse()
    },
    dispose: () => disposables.forEach((d) => d.dispose()),
  }
}

const BEAM_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const BEAM_FRAGMENT_SHADER = `
  uniform float uTime;
  uniform float uAlpha;
  uniform float uRays;
  uniform float uSpeed;
  varying vec2 vUv;
  void main() {
    float vertical = pow(1.0 - vUv.y, 1.1);
    float rays = 0.5 + 0.5 * sin(vUv.x * 6.2831853 * uRays + uTime * uSpeed);
    float scan = 0.85 + 0.15 * sin(vUv.y * 46.0 - uTime * 2.2);
    gl_FragColor = vec4(vec3(0.298, 0.776, 0.91), vertical * rays * scan * uAlpha);
  }
`

/**
 * The volumetric projection beam: three nested open cones widening toward the
 * globe's lower hemisphere, whose shader carries a vertical falloff, drifting
 * ray striations and moving horizontal scan lines (light rays, not a solid
 * cone), with fine dust motes rising inside the volume.
 */
export function createProjectionBeam(globeRadius: number): HologramSceneLayer {
  const group = new Group()
  group.position.y = -globeRadius * PLATFORM_DROP
  const disposables: Disposable[] = []

  const cones = [
    { top: 0.52, bottom: 0.1, height: 0.38, alpha: 0.55, rays: 7, speed: 0.5 },
    { top: 0.8, bottom: 0.16, height: 0.36, alpha: 0.3, rays: 11, speed: -0.3 },
    { top: 0.95, bottom: 0.2, height: 0.34, alpha: 0.18, rays: 15, speed: 0.22 },
  ].map((cone) => {
    const height = globeRadius * cone.height
    const uniforms = {
      uTime: { value: 0 },
      uAlpha: { value: cone.alpha },
      uRays: { value: cone.rays },
      uSpeed: { value: cone.speed },
    }
    const geometry = new CylinderGeometry(
      globeRadius * cone.top,
      globeRadius * cone.bottom,
      height,
      48,
      1,
      true,
    )
    const material = new ShaderMaterial({
      uniforms,
      vertexShader: BEAM_VERTEX_SHADER,
      fragmentShader: BEAM_FRAGMENT_SHADER,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    })
    disposables.push(geometry, material)
    const mesh = new Mesh(geometry, material)
    mesh.position.y = height / 2 + 2
    group.add(mesh)
    return { uniforms }
  })

  const random = createRandom(1337)
  const MOTE_COUNT = 110
  const beamHeight = globeRadius * 0.38
  const motes = Array.from({ length: MOTE_COUNT }, () => ({
    angle: random() * TWO_PI,
    radiusFrac: Math.sqrt(random()),
    h: random(),
    speed: 0.06 + random() * 0.1,
  }))
  const positions = new Float32Array(MOTE_COUNT * 3)
  const positionAttribute = new BufferAttribute(positions, 3)
  const moteGeometry = new BufferGeometry()
  moteGeometry.setAttribute('position', positionAttribute)
  const moteMaterial = new PointsMaterial({
    color: 0x8fd8ef,
    size: 1.7,
    map: getSoftDotTexture(),
    transparent: true,
    opacity: 0.7,
    blending: AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })
  disposables.push(moteGeometry, moteMaterial)
  const motePoints = new Points(moteGeometry, moteMaterial)
  motePoints.frustumCulled = false
  group.add(motePoints)

  const writeMotes = () => {
    motes.forEach((mote, i) => {
      const radiusAt =
        globeRadius * (0.1 + (0.52 - 0.1) * mote.h) * mote.radiusFrac
      positions[i * 3] = Math.cos(mote.angle) * radiusAt
      positions[i * 3 + 1] = 2 + mote.h * beamHeight
      positions[i * 3 + 2] = Math.sin(mote.angle) * radiusAt
    })
    positionAttribute.needsUpdate = true
  }
  writeMotes()

  return {
    group,
    tick: (deltaMs) => {
      const dt = deltaMs / 1000
      cones.forEach(({ uniforms }) => {
        uniforms.uTime.value += dt
      })
      motes.forEach((mote) => {
        mote.h += mote.speed * dt
        if (mote.h > 1) mote.h -= 1
      })
      writeMotes()
    },
    dispose: () => disposables.forEach((d) => d.dispose()),
  }
}

/**
 * Two thin holographic orbit rings inclined around the globe — their far
 * halves vanish behind the Earth (real depth), the near halves drift slowly
 * across it. Very low alpha so they layer under the data, never over it.
 */
export function createHoloRings(globeRadius: number): HologramSceneLayer {
  const group = new Group()
  const disposables: Disposable[] = []

  const rings = [
    { radius: 1.18, tilt: 0.42, opacity: 0.1, speed: 0.05 },
    { radius: 1.32, tilt: -0.2, opacity: 0.06, speed: -0.032 },
  ].map(({ radius, tilt, opacity, speed }) => {
    const sub = new Group()
    sub.rotation.x = -Math.PI / 2 + tilt
    const r = globeRadius * radius
    const geometry = new RingGeometry(r - 0.5, r + 0.5, 128)
    const material = glowMaterial(opacity)
    disposables.push(geometry, material)
    sub.add(new Mesh(geometry, material))

    // A few brighter segments so the rotation is visible.
    const segGeometry = new RingGeometry(r - 0.9, r + 0.9, 16, 1, 0, 0.7)
    const segMaterial = glowMaterial(opacity * 2.2)
    disposables.push(segGeometry, segMaterial)
    for (let i = 0; i < 3; i++) {
      const seg = new Mesh(segGeometry, segMaterial)
      seg.rotation.z = (TWO_PI / 3) * i + radius
      sub.add(seg)
    }
    group.add(sub)
    return { sub, speed }
  })

  // Latitude scanner: a thin horizontal ring sweeping the globe from pole to
  // pole, its radius following the sphere's cross-section at each height.
  const scanGeometry = new RingGeometry(0.985, 1.015, 128)
  const scanMaterial = glowMaterial(0.16)
  disposables.push(scanGeometry, scanMaterial)
  const scanMesh = new Mesh(scanGeometry, scanMaterial)
  scanMesh.rotation.x = -Math.PI / 2
  group.add(scanMesh)
  let scanElapsed = 0
  const applyScan = () => {
    const phase = (scanElapsed / 9) % 1
    const y = Math.cos(phase * TWO_PI) * 0.92 * globeRadius
    const crossSection = Math.sqrt(Math.max(0, globeRadius ** 2 - y ** 2)) * 1.012
    scanMesh.position.y = y
    scanMesh.scale.set(crossSection, crossSection, 1)
    scanMaterial.opacity = 0.16 * (crossSection / globeRadius)
  }
  applyScan()

  return {
    group,
    tick: (deltaMs) => {
      const dt = deltaMs / 1000
      rings.forEach(({ sub, speed }) => {
        sub.rotation.z += speed * dt
      })
      scanElapsed += dt
      applyScan()
    },
    dispose: () => disposables.forEach((d) => d.dispose()),
  }
}

/**
 * Optional Charging-Bull foreground mount. Attempts to load a user-supplied,
 * licensed model from `/data/globe/charging-bull.glb`; if the file is absent
 * the layer stays empty — nothing is fabricated. The group is intended to be
 * parented to the CAMERA (screen-locked foreground subject, like the
 * reference), scaled to ~35% of the viewport height, given a bronze PBR
 * material with a soft cyan rim, standing at the lower center of the frame.
 */
export function createBullMount(url: string | null): HologramSceneLayer {
  const group = new Group()
  const disposables: Disposable[] = []
  if (!url) {
    // No licensed model configured — the mount stays empty, no request made.
    return { group, tick: () => {}, dispose: () => {} }
  }

  const bronze = new MeshStandardMaterial({
    color: 0x68401f,
    metalness: 0.85,
    roughness: 0.42,
    emissive: 0x0a1e28,
    emissiveIntensity: 0.35,
  })
  disposables.push(bronze)

  new GLTFLoader().load(
    url,
    (gltf) => {
      const model = gltf.scene
      model.traverse((obj) => {
        if ((obj as Mesh).isMesh) {
          const mesh = obj as Mesh
          disposables.push(mesh.geometry)
          mesh.material = bronze
        }
      })
      // Normalize: ~82 world units tall at the camera-space mount distance
      // (~35% of the viewport height), feet at the frame's lower edge.
      const bounds = new Box3().setFromObject(model)
      const size = bounds.getSize(new ThreeVector3())
      const scale = 82 / Math.max(size.y, 0.0001)
      model.scale.setScalar(scale)
      const scaled = new Box3().setFromObject(model)
      model.position.y -= scaled.min.y // feet at group origin
      group.add(model)
    },
    undefined,
    () => {
      // No licensed model present — the mount stays empty by design.
    },
  )

  return {
    group,
    tick: () => {},
    dispose: () => disposables.forEach((d) => d.dispose()),
  }
}

/**
 * Ambient data particles at two depths — a near shell and a farther, dimmer
 * one counter-rotating so the scene carries real parallax as it drifts.
 */
export function createAmbientParticles(globeRadius: number): HologramSceneLayer {
  const group = new Group()
  group.rotation.x = 0.1
  const disposables: Disposable[] = []

  const makeShell = (
    seed: number,
    count: number,
    minRadius: number,
    maxRadius: number,
    size: number,
    opacity: number,
    color = 0x7fc9e8,
  ) => {
    const random = createRandom(seed)
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const z = random() * 2 - 1
      const phi = random() * TWO_PI
      const ringRadius = Math.sqrt(Math.max(0, 1 - z * z))
      const radius = globeRadius * (minRadius + random() * (maxRadius - minRadius))
      positions[i * 3] = ringRadius * Math.cos(phi) * radius
      positions[i * 3 + 1] = z * radius
      positions[i * 3 + 2] = ringRadius * Math.sin(phi) * radius
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    const material = new PointsMaterial({
      color,
      size,
      map: getSoftDotTexture(),
      transparent: true,
      opacity,
      blending: AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
    disposables.push(geometry, material)
    const shell = new Group()
    const points = new Points(geometry, material)
    points.frustumCulled = false
    shell.add(points)
    group.add(shell)
    return { shell, material, baseOpacity: opacity }
  }

  const near = makeShell(20260722, 600, 1.3, 2.4, 1.35, 0.45)
  const far = makeShell(919, 320, 2.8, 4.6, 1.0, 0.24)
  // Sparse star field: tiny, mostly white, far away — infinite depth, not astronomy.
  const stars = makeShell(4211, 220, 5.0, 7.5, 0.7, 0.32, 0xffffff)

  let elapsed = 0
  return {
    group,
    tick: (deltaMs) => {
      const dt = deltaMs / 1000
      elapsed += dt
      near.shell.rotation.y += 0.018 * dt
      far.shell.rotation.y -= 0.011 * dt
      stars.shell.rotation.y += 0.0035 * dt
      // Atmospheric breathing: the whole particle field brightens and settles
      // on a ~24 s cycle — almost imperceptible, loops seamlessly.
      const breathe = 0.92 + 0.08 * Math.sin((elapsed * TWO_PI) / 24)
      near.material.opacity = near.baseOpacity * breathe
      far.material.opacity = far.baseOpacity * breathe
    },
    dispose: () => disposables.forEach((d) => d.dispose()),
  }
}

/**
 * The far environment: a handful of drifting wireframe hologram fragments
 * (hexagons, broken circles, thin grids) and a huge, barely-visible energy
 * wave expanding through the room every ~14 s. Everything is deterministic,
 * slow and very low alpha — depth and life, never clutter.
 */
export function createEnvironment(globeRadius: number): HologramSceneLayer {
  const group = new Group()
  const disposables: Disposable[] = []
  const random = createRandom(60321)

  const lineMaterial = new LineBasicMaterial({
    color: CYAN,
    transparent: true,
    opacity: 0.09,
    blending: AdditiveBlending,
    depthWrite: false,
  })
  disposables.push(lineMaterial)

  function polygonGeometry(radius: number, sides: number): BufferGeometry {
    const positions = new Float32Array(sides * 3)
    for (let i = 0; i < sides; i++) {
      const angle = (TWO_PI / sides) * i
      positions[i * 3] = Math.cos(angle) * radius
      positions[i * 3 + 1] = Math.sin(angle) * radius
      positions[i * 3 + 2] = 0
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    return geometry
  }

  interface Drifter {
    object: Mesh | LineLoop
    spinX: number
    spinY: number
    bobPhase: number
    baseY: number
  }
  const drifters: Drifter[] = []

  const place = (object: Mesh | LineLoop) => {
    const angle = random() * TWO_PI
    const radius = globeRadius * (2.4 + random() * 1.5)
    const y = (random() * 2 - 1) * globeRadius * 1.4
    object.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
    object.rotation.set(random() * TWO_PI, random() * TWO_PI, random() * TWO_PI)
    group.add(object)
    drifters.push({
      object,
      spinX: (random() - 0.5) * 0.06,
      spinY: (random() - 0.5) * 0.08,
      bobPhase: random() * TWO_PI,
      baseY: y,
    })
  }

  // Wireframe hexagons + a tiny polygon.
  ;[14, 9, 6].forEach((radius, index) => {
    const geometry = polygonGeometry(radius, index === 2 ? 5 : 6)
    disposables.push(geometry)
    place(new LineLoop(geometry, lineMaterial))
  })

  // Broken circles (arc fragments).
  ;[16, 11].forEach((radius) => {
    const geometry = new RingGeometry(radius - 0.25, radius + 0.25, 48, 1, 0, 4.1)
    const material = glowMaterial(0.06)
    disposables.push(geometry, material)
    place(new Mesh(geometry, material))
  })

  // One thin wireframe grid plane.
  {
    const geometry = new PlaneGeometry(26, 26, 4, 4)
    const material = new MeshBasicMaterial({
      color: CYAN,
      wireframe: true,
      transparent: true,
      opacity: 0.05,
      blending: AdditiveBlending,
      depthWrite: false,
    })
    disposables.push(geometry, material)
    place(new Mesh(geometry, material))
  }

  // Environment-scale energy wave, expanding along the platform plane.
  const waveGeometry = new RingGeometry(0.985, 1.0, 96)
  const waveMaterial = glowMaterial(0.06)
  disposables.push(waveGeometry, waveMaterial)
  const wave = new Mesh(waveGeometry, waveMaterial)
  wave.rotation.x = -Math.PI / 2
  wave.position.y = -globeRadius * 1.15
  group.add(wave)

  let elapsed = 0
  const applyWave = () => {
    const t = (elapsed / 14) % 1
    const scale = globeRadius * (1.5 + t * 2.7)
    wave.scale.set(scale, scale, 1)
    waveMaterial.opacity = 0.06 * (1 - t) ** 2
  }
  applyWave()

  return {
    group,
    tick: (deltaMs) => {
      const dt = deltaMs / 1000
      elapsed += dt
      drifters.forEach((d) => {
        d.object.rotation.x += d.spinX * dt
        d.object.rotation.y += d.spinY * dt
        d.object.position.y = d.baseY + Math.sin(elapsed * 0.12 + d.bobPhase) * 3
      })
      applyWave()
    },
    dispose: () => disposables.forEach((d) => d.dispose()),
  }
}
