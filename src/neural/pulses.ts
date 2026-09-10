// Traveling pulses (ruling 7.10): a soft trail/hot dot animated along each
// brain↔hub trail, staggered - config-gated, brain↔hub only. The dot's
// position is computed in the VERTEX SHADER from the trail's bezier control
// points (per-instance attributes) and a clock uniform: zero per-frame JS.
// Direction follows trail.flowInward (visual pass): inward = hub -> brain,
// the same sense as the trail energy bands. Gated by the post's MOMENTUM
// (RALLY §5: motion is the momentum channel) - with 160 posts, un-gated dots
// would be 160 moving things on a field where most posts are still.

import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from 'three'
import { NCONF } from './config'
import { TRAIL_HOT } from './palette'
import type { TrailSpec } from './trails'

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uR;
  uniform float uRangeMult;
  uniform float uFloor;
  uniform float uInward;
  attribute vec3 iP0;
  attribute vec3 iP1;
  attribute vec3 iP2;
  attribute float iPhase;
  attribute float iPeriod;
  attribute float iMomentum;
  varying vec2 vUv;
  varying float vDepth;
  varying float vMom;
  void main() {
    vUv = position.xy;
    vMom = iMomentum;
    float t = fract(uTime / iPeriod + iPhase);
    t = mix(t, 1.0 - t, uInward); // inward: run the bezier hub -> brain
    float u = 1.0 - t;
    vec3 p = u * u * iP0 + 2.0 * u * t * iP1 + t * t * iP2;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    float range = uR * uRangeMult;
    float zn = clamp((wp.z + range) / (2.0 * range), 0.0, 1.0);
    float ss = zn * zn * (3.0 - 2.0 * zn);
    vDepth = uFloor + (1.0 - uFloor) * ss;
    vec4 mv = viewMatrix * wp;
    mv.xy += position.xy * uSize;
    gl_Position = projectionMatrix * mv;
  }
`
const FRAG = /* glsl */ `
  uniform vec3 uColor; // linear working space (as-authored path, C4)
  varying vec2 vUv;
  varying float vDepth;
  varying float vMom;
  void main() {
    float r = length(vUv);
    float a = 0.9 * (1.0 - smoothstep(0.18, 0.5, r)) * smoothstep(0.0, 0.35, vMom);
    gl_FragColor = vec4(uColor, a * vDepth);
    #include <colorspace_fragment>
  }
`

/** One instanced mesh carrying every brain→hub pulse dot. */
export function buildPulseMesh(specs: readonly TrailSpec[]): Mesh {
  const brainTrails = specs.filter((s) => s.parentTier === 'brain')
  const n = brainTrails.length
  const quad = new PlaneGeometry(1, 1)
  const geo = new InstancedBufferGeometry()
  geo.index = quad.index
  geo.setAttribute('position', quad.getAttribute('position'))
  geo.instanceCount = n

  const p0 = new Float32Array(n * 3)
  const p1 = new Float32Array(n * 3)
  const p2 = new Float32Array(n * 3)
  const phase = new Float32Array(n)
  const period = new Float32Array(n)
  const mom = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const s = brainTrails[i]
    mom[i] = s.childMomentum
    p0.set([s.pSurf.x, s.pSurf.y, s.pSurf.z], i * 3)
    p1.set([s.ctrl.x, s.ctrl.y, s.ctrl.z], i * 3)
    p2.set([s.cSurf.x, s.cSurf.y, s.cSurf.z], i * 3)
    // Deterministic stagger + 3-5s periods (no runtime randomness).
    phase[i] = (i * 0.6180339887) % 1
    period[i] = 3 + ((i * 7) % 5) * 0.5
  }
  geo.setAttribute('iP0', new InstancedBufferAttribute(p0, 3))
  geo.setAttribute('iP1', new InstancedBufferAttribute(p1, 3))
  geo.setAttribute('iP2', new InstancedBufferAttribute(p2, 3))
  geo.setAttribute('iPhase', new InstancedBufferAttribute(phase, 1))
  geo.setAttribute('iPeriod', new InstancedBufferAttribute(period, 1))
  geo.setAttribute('iMomentum', new InstancedBufferAttribute(mom, 1))

  const hot = new Color(TRAIL_HOT)
  const mat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: 16 }, // world units; ≈ the spec's 6px hot dot on screen
      uColor: { value: [hot.r, hot.g, hot.b] },
      uR: { value: NCONF.generation.R },
      uRangeMult: { value: NCONF.depth.rangeMult },
      uFloor: { value: NCONF.depth.opacityFloor },
      uInward: { value: NCONF.trail.flowInward ? 1 : 0 },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  })
  const mesh = new Mesh(geo, mat)
  mesh.frustumCulled = false
  return mesh
}

export function syncPulseUniforms(mat: ShaderMaterial, timeSec: number): void {
  mat.uniforms.uTime.value = timeSec
  mat.uniforms.uR.value = NCONF.generation.R
  mat.uniforms.uRangeMult.value = NCONF.depth.rangeMult
  mat.uniforms.uFloor.value = NCONF.depth.opacityFloor
  mat.uniforms.uInward.value = NCONF.trail.flowInward ? 1 : 0
}
