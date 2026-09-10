// Trails (ORB_NEURAL_PORT_SPEC §4.3). Kept from the prototype: quadratic
// bezier per trail, surface-to-surface endpoints, deterministic bend sign,
// two passes (core + glow ×3.2 radius), the exact vertex-color program.
// Replaced: constant-radius TubeGeometry → merged variable-radius tubes with
// TAPER (junction swell, ruling 7.7) and per-vertex depth attenuation in the
// shader (ruling 7.8 - the prototype's most visible gap, closed here).
//
// Color management (PORT_LOG C4): trail colors ride THREE.Color, which
// converts hex → linear working space; the shader converts back at output.
// Round-trip = colors render as authored, exactly like the prototype's
// vertexColors path (unlike the star sprites' brightened path).

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three'
import { DISC_FRACTION, NCONF } from './config'
import type { NeuralConfig } from './config'
import type { NeuralNode } from './graph'
import { nodePosition } from './graph'
import { momentumFor } from './momentum'
import { PAL, TRAIL_BASE, TRAIL_HOT } from './palette'
import type { NeuralTier } from './palette'

export interface TrailSpec {
  /** trail start - the parent's centre when trail.endInset is 0 */
  pSurf: Vector3
  ctrl: Vector3
  /** trail end - the child's centre when trail.endInset is 0 */
  cSurf: Vector3
  radius: number
  parentName: string
  parentTier: NeuralTier
  parentBody: Color // linear working space
  childBody: Color
  childName: string
  /** RALLY §5 momentum of the CHILD (this is its incoming trail) - gates the energy band */
  childMomentum: number
  /** brightness x (and half the radius scaling) by the child's traction: spokeMinWeight..1 */
  weight: number
}

const UP = new Vector3(0, 1, 0)
const FALLBACK = new Vector3(1, 0, 0)

/**
 * Pure geometry plan for every trail - exactly one per non-brain node.
 * `diamOf` gives each node's sprite diameter so trails end on the disc
 * surface; sizes are the rallies channel now, so the default (tier table) is
 * only right for callers that still size by tier. `ralliesOf` (0..1) weights
 * the trail's brightness and radius by the child's traction (default: full).
 */
export function buildTrailSpecs(
  nodes: readonly NeuralNode[],
  cfg: NeuralConfig = NCONF,
  diamOf: (n: NeuralNode) => number = (n) => cfg.render.tierDiam[n.tier],
  ralliesOf: (n: NeuralNode) => number = () => 1,
): TrailSpec[] {
  const byName = new Map(nodes.map((n) => [n.name, n]))
  const positions = new Map(nodes.map((n) => [n.name, new Vector3(...nodePosition(n))]))
  const specs: TrailSpec[] = []

  for (const n of nodes) {
    if (!n.parentName) continue
    const parent = byName.get(n.parentName)
    if (!parent) continue
    const pPos = positions.get(parent.name) as Vector3
    const cPos = positions.get(n.name) as Vector3

    const dir = cPos.clone().sub(pPos)
    const dist = dir.length()
    if (dist < 1) continue // prototype guard; never fires at default config
    dir.divideScalar(dist)
    // endpoints: inset from each centre by endInset x the visible disc radius
    // (0 = the centre: the string runs into the core)
    const discR = (m: NeuralNode) => (diamOf(m) * cfg.render.spriteScale * DISC_FRACTION) / 2
    const pSurf = pPos.clone().addScaledVector(dir, cfg.trail.endInset * discR(parent))
    const cSurf = cPos.clone().addScaledVector(dir, -cfg.trail.endInset * discR(n))

    // Bend: mid + perp × chordLen × bendFraction, sign deterministic from
    // the child's φ/θ - same sign across all rotations.
    const chord = cSurf.clone().sub(pSurf)
    const chordLen = chord.length()
    const mid = pSurf.clone().add(cSurf).multiplyScalar(0.5)
    const perp = new Vector3().crossVectors(chord, UP).normalize()
    if (perp.lengthSq() < 0.01) perp.crossVectors(chord, FALLBACK).normalize()
    const sign = Math.sin(n.phi * 7.3 + n.theta) > 0 ? 1 : -1
    const ctrl = mid.addScaledVector(perp, chordLen * cfg.trail.bendFraction * sign)

    // traction weight: a popular post's spoke is full; a minor one a hairline.
    // Quadratic in t so the median post (t ~ 0.2) sits near the floor.
    const t = Math.pow(Math.min(1, Math.max(0, ralliesOf(n))), cfg.rallies.sizeGamma)
    const weight = cfg.trail.spokeMinWeight + (1 - cfg.trail.spokeMinWeight) * t * t
    specs.push({
      pSurf,
      ctrl,
      cSurf,
      radius: (cfg.trail.radByTier[parent.tier] ?? cfg.trail.radDefault) * (0.5 + 0.5 * t),
      parentName: parent.name,
      parentTier: parent.tier,
      parentBody: new Color(PAL[parent.hue].body),
      childBody: new Color(PAL[n.hue].body),
      childName: n.name,
      childMomentum: momentumFor(n.name),
      weight,
    })
  }
  return specs
}

/** Taper profile (§4.3): peaks at both endpoints, minimum at t=0.5. */
export function taperRadius(t: number, base: number, cfg: NeuralConfig = NCONF): number {
  return base * (cfg.trail.taperBase + (1 - cfg.trail.taperBase) * Math.abs(2 * t - 1) ** cfg.trail.taperExp)
}

const HOT = new Color(TRAIL_HOT)
const BASE = new Color(TRAIL_BASE)

/** The §4.3 core-pass color program, evaluated at ring parameter t. */
export function coreColorAt(t: number, parentTier: NeuralTier, pBody: Color, cBody: Color): Color {
  const col = new Color()
  if (parentTier === 'brain' && t < 0.15) col.lerpColors(HOT, pBody, t / 0.15)
  else if (t < 0.4) col.lerpColors(pBody, BASE, t / 0.4)
  else col.lerpColors(BASE, cBody, (t - 0.4) / 0.6)
  return col
}

/** Glow pass: plain parent→child lerp × 0.55. */
export function glowColorAt(t: number, pBody: Color, cBody: Color): Color {
  return new Color().lerpColors(pBody, cBody, t).multiplyScalar(0.55)
}

function bezier(out: Vector3, a: Vector3, b: Vector3, c: Vector3, t: number): Vector3 {
  const u = 1 - t
  return out.set(
    u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    u * u * a.z + 2 * u * t * b.z + t * t * c.z,
  )
}

function bezierTangent(out: Vector3, a: Vector3, b: Vector3, c: Vector3, t: number): Vector3 {
  return out.set(
    2 * (1 - t) * (b.x - a.x) + 2 * t * (c.x - b.x),
    2 * (1 - t) * (b.y - a.y) + 2 * t * (c.y - b.y),
    2 * (1 - t) * (b.z - a.z) + 2 * t * (c.z - b.z),
  ).normalize()
}

/**
 * Build one merged tube geometry for a pass. Variable radius (taper),
 * parallel-transported frames, radial cross-section like the prototype's
 * TubeGeometry (radialSegments 5, seam vertex duplicated).
 */
export function buildTrailGeometry(
  specs: readonly TrailSpec[],
  pass: 'core' | 'glow',
  cfg: NeuralConfig = NCONF,
): BufferGeometry {
  const SEGS = pass === 'core' ? 18 : 12
  const RAD = 5
  const ringVerts = RAD + 1
  const vertsPerTrail = (SEGS + 1) * ringVerts
  const idxPerTrail = SEGS * RAD * 6
  const positions = new Float32Array(specs.length * vertsPerTrail * 3)
  const colors = new Float32Array(specs.length * vertsPerTrail * 3)
  // (t along the trail, per-trail phase, child momentum, traction weight)
  const flow = new Float32Array(specs.length * vertsPerTrail * 4)
  const indices = new Uint32Array(specs.length * idxPerTrail)

  const center = new Vector3()
  const tangent = new Vector3()
  const prevTangent = new Vector3()
  const normal = new Vector3()
  const binormal = new Vector3()
  const arm = new Vector3()

  let vOff = 0
  let iOff = 0
  let si = 0
  for (const spec of specs) {
    const radiusMult = pass === 'glow' ? cfg.trail.glowRadiusMult : 1
    const vStart = vOff
    // deterministic golden-ratio stagger per trail (no RNG)
    const phase = (si * 0.6180339887) % 1
    si++

    // Initial frame: normal = least-aligned axis projected off the tangent.
    bezierTangent(tangent, spec.pSurf, spec.ctrl, spec.cSurf, 0)
    normal.set(0, 1, 0)
    if (Math.abs(tangent.y) > 0.9) normal.set(1, 0, 0)
    normal.addScaledVector(tangent, -normal.dot(tangent)).normalize()
    prevTangent.copy(tangent)

    for (let i = 0; i <= SEGS; i++) {
      const t = i / SEGS
      bezier(center, spec.pSurf, spec.ctrl, spec.cSurf, t)
      bezierTangent(tangent, spec.pSurf, spec.ctrl, spec.cSurf, t)
      // parallel transport the normal
      normal.addScaledVector(tangent, -normal.dot(tangent)).normalize()
      binormal.crossVectors(tangent, normal)
      prevTangent.copy(tangent)

      const r = taperRadius(t, spec.radius, cfg) * radiusMult
      const col =
        pass === 'core'
          ? coreColorAt(t, spec.parentTier, spec.parentBody, spec.childBody)
          : glowColorAt(t, spec.parentBody, spec.childBody)

      for (let j = 0; j <= RAD; j++) {
        const a = (j / RAD) * Math.PI * 2
        arm.copy(normal).multiplyScalar(Math.cos(a)).addScaledVector(binormal, Math.sin(a))
        const vi = vOff * 3
        positions[vi] = center.x + arm.x * r
        positions[vi + 1] = center.y + arm.y * r
        positions[vi + 2] = center.z + arm.z * r
        // colour stays UNWEIGHTED: the shader applies weight to the base only,
        // so the momentum band brightens a hairline spoke at full strength
        colors[vi] = col.r
        colors[vi + 1] = col.g
        colors[vi + 2] = col.b
        flow[vOff * 4] = t
        flow[vOff * 4 + 1] = phase
        flow[vOff * 4 + 2] = spec.childMomentum
        flow[vOff * 4 + 3] = spec.weight
        vOff++
      }
    }

    for (let i = 0; i < SEGS; i++) {
      for (let j = 0; j < RAD; j++) {
        const a = vStart + i * ringVerts + j
        const b = a + ringVerts
        indices[iOff++] = a
        indices[iOff++] = b
        indices[iOff++] = a + 1
        indices[iOff++] = b
        indices[iOff++] = b + 1
        indices[iOff++] = a + 1
      }
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('color', new BufferAttribute(colors, 3))
  geo.setAttribute('aFlow', new BufferAttribute(flow, 4))
  geo.setIndex(new BufferAttribute(indices, 1))
  return geo
}

const TRAIL_VERT = /* glsl */ `
  uniform float uR;
  uniform float uRangeMult;
  uniform float uFloor;
  attribute vec4 aFlow;
  varying vec3 vColor;
  varying float vDepth;
  varying vec4 vFlow;
  void main() {
    vColor = color;
    vFlow = aFlow;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float range = uR * uRangeMult;
    float zn = clamp((wp.z + range) / (2.0 * range), 0.0, 1.0);
    float ss = zn * zn * (3.0 - 2.0 * zn);
    vDepth = uFloor + (1.0 - uFloor) * ss; // same zNorm curve as the stars
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const TRAIL_FRAG = /* glsl */ `
  uniform float uOpacity;
  uniform float uTime;
  uniform float uFlowGain;
  uniform float uFlowWidth;
  uniform float uFlowPeriod;
  uniform float uFlowInward;
  uniform float uFlowRateBoost;
  varying vec3 vColor;
  varying float vDepth;
  varying vec4 vFlow;
  void main() {
    // Energy flow: a soft band travelling along the trail, staggered per
    // trail. t runs parent (0) -> child (1); dir = -1 (uFlowInward) moves the
    // band child -> parent so energy converges on the brain, +1 radiates out.
    // Circular distance so the band wraps cleanly; it brightens the authored
    // colour rather than recolouring it, so red trails stay red. Per
    // fragment, from a clock uniform - zero JS. Mirrored in flowBandPosition().
    // RALLY §5: the band is the momentum channel's comet-tail - only a moving
    // shout's trail carries it (x vFlow.z), and faster with more momentum.
    float dir = uFlowInward > 0.5 ? -1.0 : 1.0;
    float rate = (1.0 + uFlowRateBoost * vFlow.z) / uFlowPeriod;
    float band = fract(vFlow.x - dir * (uTime * rate + vFlow.y));
    float d = min(band, 1.0 - band);
    float flow = uFlowGain * vFlow.z * exp(-(d * d) / (2.0 * uFlowWidth * uFlowWidth));
    // Traction sets the BASE (vFlow.w: hairline for a minor post, full for a
    // popular one); the momentum band adds at full strength regardless, so a
    // small post that starts moving still shows its comet-tail.
    gl_FragColor = vec4(vColor * (vFlow.w + flow), uOpacity * vDepth);
    #include <colorspace_fragment>
  }
`

export function createTrailMaterial(pass: 'core' | 'glow'): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    uniforms: {
      uR: { value: NCONF.generation.R },
      uRangeMult: { value: NCONF.depth.rangeMult },
      uFloor: { value: NCONF.depth.opacityFloor },
      uOpacity: { value: pass === 'core' ? NCONF.trail.coreOpacity : NCONF.trail.glowOpacity },
      uTime: { value: 0 },
      uFlowGain: { value: NCONF.trail.flowEnabled ? NCONF.trail.flowGain : 0 },
      uFlowWidth: { value: NCONF.trail.flowWidth },
      uFlowPeriod: { value: NCONF.trail.flowPeriod },
      uFlowInward: { value: NCONF.trail.flowInward ? 1 : 0 },
      uFlowRateBoost: { value: NCONF.momentum.pulseRateBoost },
    },
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  })
}

export function syncTrailUniforms(core: ShaderMaterial, glow: ShaderMaterial, timeSec = 0): void {
  const gain = NCONF.trail.flowEnabled ? NCONF.trail.flowGain : 0
  for (const m of [core, glow]) {
    m.uniforms.uR.value = NCONF.generation.R
    m.uniforms.uRangeMult.value = NCONF.depth.rangeMult
    m.uniforms.uFloor.value = NCONF.depth.opacityFloor
    m.uniforms.uTime.value = timeSec
    m.uniforms.uFlowGain.value = gain
    m.uniforms.uFlowWidth.value = Math.max(0.005, NCONF.trail.flowWidth)
    m.uniforms.uFlowPeriod.value = Math.max(0.1, NCONF.trail.flowPeriod)
    m.uniforms.uFlowInward.value = NCONF.trail.flowInward ? 1 : 0
    m.uniforms.uFlowRateBoost.value = NCONF.momentum.pulseRateBoost
  }
  core.uniforms.uOpacity.value = NCONF.trail.coreOpacity
  glow.uniforms.uOpacity.value = NCONF.trail.glowOpacity
}

/**
 * Where along a trail (t: parent 0 -> child 1) the energy band peaks at
 * `timeSec` - the pure mirror of TRAIL_FRAG's band term, so direction is a
 * test, not a hope. Inward: t decreases with time (toward the parent/brain).
 */
export function flowBandPosition(
  timeSec: number,
  period: number,
  phase: number,
  inward: boolean,
  momentum = 1,
  rateBoost = 0,
): number {
  const dir = inward ? -1 : 1
  const rate = (1 + rateBoost * momentum) / period
  const x = dir * (timeSec * rate + phase)
  return ((x % 1) + 1) % 1
}

export interface TrailMeshes {
  core: Mesh
  glow: Mesh
}

export function buildTrailMeshes(specs: readonly TrailSpec[]): TrailMeshes {
  const core = new Mesh(buildTrailGeometry(specs, 'core'), createTrailMaterial('core'))
  const glow = new Mesh(buildTrailGeometry(specs, 'glow'), createTrailMaterial('glow'))
  core.frustumCulled = false
  glow.frustumCulled = false
  return { core, glow }
}
