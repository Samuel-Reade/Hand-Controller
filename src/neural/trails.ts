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
import { NCONF } from './config'
import type { NeuralConfig } from './config'
import type { NeuralNode } from './graph'
import { nodePosition } from './graph'
import { PAL, TRAIL_BASE, TRAIL_HOT } from './palette'
import type { NeuralTier } from './palette'

export interface TrailSpec {
  pSurf: Vector3
  ctrl: Vector3
  cSurf: Vector3
  radius: number
  parentTier: NeuralTier
  parentBody: Color // linear working space
  childBody: Color
  childName: string
}

const UP = new Vector3(0, 1, 0)
const FALLBACK = new Vector3(1, 0, 0)

/** Pure geometry plan for every trail - exactly one per non-brain node. */
export function buildTrailSpecs(
  nodes: readonly NeuralNode[],
  cfg: NeuralConfig = NCONF,
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
    const pSurf = pPos.clone().addScaledVector(dir, cfg.render.tierDiam[parent.tier] / 2)
    const cSurf = cPos.clone().addScaledVector(dir, -cfg.render.tierDiam[n.tier] / 2)

    // Bend: mid + perp × chordLen × bendFraction, sign deterministic from
    // the child's φ/θ - same sign across all rotations.
    const chord = cSurf.clone().sub(pSurf)
    const chordLen = chord.length()
    const mid = pSurf.clone().add(cSurf).multiplyScalar(0.5)
    const perp = new Vector3().crossVectors(chord, UP).normalize()
    if (perp.lengthSq() < 0.01) perp.crossVectors(chord, FALLBACK).normalize()
    const sign = Math.sin(n.phi * 7.3 + n.theta) > 0 ? 1 : -1
    const ctrl = mid.addScaledVector(perp, chordLen * cfg.trail.bendFraction * sign)

    specs.push({
      pSurf,
      ctrl,
      cSurf,
      radius: cfg.trail.radByTier[parent.tier] ?? cfg.trail.radDefault,
      parentTier: parent.tier,
      parentBody: new Color(PAL[parent.hue].body),
      childBody: new Color(PAL[n.hue].body),
      childName: n.name,
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
  const indices = new Uint32Array(specs.length * idxPerTrail)

  const center = new Vector3()
  const tangent = new Vector3()
  const prevTangent = new Vector3()
  const normal = new Vector3()
  const binormal = new Vector3()
  const arm = new Vector3()

  let vOff = 0
  let iOff = 0
  for (const spec of specs) {
    const radiusMult = pass === 'glow' ? cfg.trail.glowRadiusMult : 1
    const vStart = vOff

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
        colors[vi] = col.r
        colors[vi + 1] = col.g
        colors[vi + 2] = col.b
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
  geo.setIndex(new BufferAttribute(indices, 1))
  return geo
}

const TRAIL_VERT = /* glsl */ `
  uniform float uR;
  uniform float uRangeMult;
  uniform float uFloor;
  varying vec3 vColor;
  varying float vDepth;
  void main() {
    vColor = color;
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
  varying vec3 vColor;
  varying float vDepth;
  void main() {
    gl_FragColor = vec4(vColor, uOpacity * vDepth);
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
    },
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  })
}

export function syncTrailUniforms(core: ShaderMaterial, glow: ShaderMaterial): void {
  for (const m of [core, glow]) {
    m.uniforms.uR.value = NCONF.generation.R
    m.uniforms.uRangeMult.value = NCONF.depth.rangeMult
    m.uniforms.uFloor.value = NCONF.depth.opacityFloor
  }
  core.uniforms.uOpacity.value = NCONF.trail.coreOpacity
  glow.uniforms.uOpacity.value = NCONF.trail.glowOpacity
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
