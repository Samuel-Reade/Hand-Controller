// The instanced star renderer (ORB_NEURAL_PORT_SPEC §4.1): one camera-facing
// quad geometry, instanced per node, fragment shader reproducing the
// prototype's baked 4-layer texture analytically (corona / bloom / flat disc /
// white pinpoint - NOT a gradient sphere). Depth opacity is computed in the
// vertex shader from world z (fixes handoff 8.2/8.3); the whole-sprite
// runtime multiplier depthOpa × haloOpa × 0.95 is PORT_LOG C2. Additive,
// no depth write/test (all-additive scene, handoff 8.7).
//
// Per-instance size is iDiam (tier diameter) × a live uniform scale, so the
// spriteScale/bokehScale sliders tune without a geometry rebuild.

import {
  AdditiveBlending,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three'
import { NCONF } from './config'
import { HUE_INDEX, PAL, TIER_OPA, hexToRgb01 } from './palette'
import type { NeuralHue, NeuralTier } from './palette'

export interface StarInstance {
  pos: Vector3      // constellation-space position
  tier: NeuralTier
  hue: NeuralHue
  isBokeh?: boolean
  /** selection/affordance state channel (§4.1) - 0 idle; reserved for P5. */
  state?: number
  /** overrides for non-tier instances (junction beads §4.3) */
  diam?: number
  opa?: readonly [number, number, number]
}

const VERT = /* glsl */ `
  uniform float uR;
  uniform float uRangeMult;
  uniform float uFloor;
  uniform float uBokehOpacity;
  uniform float uTierMult;
  uniform float uSpriteScale;
  uniform float uBokehScale;
  uniform float uScaleMult;
  uniform float uCoronaMult;
  uniform float uAffordanceLift;
  uniform vec3 uBody[3];
  uniform vec3 uHalo[3];
  attribute vec3 iPos;
  attribute float iDiam;
  attribute float iHue;
  attribute vec3 iOpa;
  attribute float iBokeh;
  attribute float iState;
  varying vec2 vUv;
  varying vec3 vBody;
  varying vec3 vHalo;
  varying vec3 vOpa;
  varying float vMult;
  varying float vState;

  void main() {
    vUv = position.xy; // unit quad corners at ±0.5; r=0 center
    int h = int(iHue + 0.5);
    vBody = uBody[h];
    vHalo = uHalo[h];
    // §7 affordance: halo lift on the reticle candidate rides iState.
    vOpa = vec3(iOpa.x * (1.0 + uAffordanceLift * iState), iOpa.y, iOpa.z);
    vState = iState;

    vec4 wc = modelMatrix * vec4(iPos, 1.0);
    float range = uR * uRangeMult;
    float zn = clamp((wc.z + range) / (2.0 * range), 0.0, 1.0);
    float ss = zn * zn * (3.0 - 2.0 * zn);
    float depthOpa = mix(uFloor + (1.0 - uFloor) * ss, uBokehOpacity, iBokeh);
    // PORT_LOG C2: whole-sprite multiplier = depthOpa × haloOpa × tierMult
    vMult = depthOpa * iOpa.x * uTierMult;

    float size = iDiam * mix(uSpriteScale, uBokehScale, iBokeh) * uScaleMult * uCoronaMult;
    vec4 mv = viewMatrix * wc;
    mv.xy += position.xy * size; // view-space billboard
    gl_Position = projectionMatrix * mv;
  }
`

// dr = 0.15 in quad-width UV terms (§4.1); every radius in those same units.
const FRAG = /* glsl */ `
  uniform float uDesat;
  varying vec2 vUv;
  varying vec3 vBody;
  varying vec3 vHalo;
  varying vec3 vOpa;
  varying float vMult;
  varying float vState;

  const float DR = 0.15;

  // Canvas source-over compositing - the prototype painted the four layers
  // onto one texture; reproduce the stacking exactly.
  vec4 srcOver(vec4 src, vec4 dst) {
    float a = src.a + dst.a * (1.0 - src.a);
    vec3 rgb = a > 1e-5 ? (src.rgb * src.a + dst.rgb * dst.a * (1.0 - src.a)) / a : vec3(0.0);
    return vec4(rgb, a);
  }

  uniform float uPinOnly;
  uniform float uAnchor;
  uniform float uCoronaMult;
  uniform float uSpikeLen;

  void main() {
    float r = length(vUv);
    float px = fwidth(r); // ~1 device pixel in r units - resolution independence
    float dr = DR / uCoronaMult; // §6: corona radius mult enlarges quad, not disc

    if (uPinOnly > 0.5) {
      // Junction bead (§4.3): tiny soft white dot, 60% - nothing else.
      float aBead = 0.6 * (1.0 - smoothstep(dr * 0.55, dr, r));
      gl_FragColor = vec4(1.0, 1.0, 1.0, aBead * vMult);
      #include <colorspace_fragment>
      return;
    }

    // 1. corona: annular gradient inner DR×1.2 → outer 0.49,
    //    stops 0.0→halo×0.28, 0.4→halo×0.10, 1.0→0 (linear between)
    float tc = clamp((r - dr * 1.2) / (0.49 - dr * 1.2), 0.0, 1.0);
    float aCor = vOpa.x * (tc < 0.4 ? mix(0.28, 0.10, tc / 0.4)
                                    : mix(0.10, 0.0, (tc - 0.4) / 0.6));
    aCor *= 1.0 - smoothstep(0.49 - px, 0.49, r); // canvas fill circle bound
    vec4 col = vec4(vHalo, aCor);

    // 2. bloom: annular inner DR×0.8 → outer DR×2.8,
    //    stops 0.0→body×0.50, 0.5→body×0.18, 1.0→0
    float tb = clamp((r - dr * 0.8) / (dr * 2.0), 0.0, 1.0);
    float aBloom = vOpa.y * (tb < 0.5 ? mix(0.50, 0.18, tb / 0.5)
                                      : mix(0.18, 0.0, (tb - 0.5) / 0.5));
    aBloom *= 1.0 - smoothstep(dr * 2.8 - px, dr * 2.8, r);
    col = srcOver(vec4(vBody, aBloom), col);

    // 3. flat solid disc - no gradient, no specular, no rim; ≤1px AA edge
    float aDisc = vOpa.z * (1.0 - smoothstep(dr - px, dr, r));
    col = srcOver(vec4(vBody, aDisc), col);

    // 4. white pinpoint: radius max(DR×0.22, 1px)
    float pinR = max(dr * 0.22, px);
    float aPin = min(1.0, vOpa.z * 0.85) * (1.0 - smoothstep(pinR - px, pinR, r));
    col = srcOver(vec4(1.0, 1.0, 1.0, aPin), col);

    if (uAnchor > 0.5) {
      // §6 dominance: 4 long + 4 short diffraction cross-spikes, violet-white
      // - the classic bright-star signature, unique to the anchor ROLE.
      vec3 spikeCol = mix(vBody, vec3(1.0), 0.65);
      float wL = dr * 0.10;
      float wS = dr * 0.07;
      float lenL = uSpikeLen;
      float lenS = uSpikeLen * 0.55;
      float ux = (vUv.x + vUv.y) * 0.7071;
      float uy = (vUv.x - vUv.y) * 0.7071;
      float sL =
        exp(-(vUv.y * vUv.y) / (2.0 * wL * wL)) * pow(max(0.0, 1.0 - abs(vUv.x) / lenL), 1.7) +
        exp(-(vUv.x * vUv.x) / (2.0 * wL * wL)) * pow(max(0.0, 1.0 - abs(vUv.y) / lenL), 1.7);
      float sS =
        exp(-(uy * uy) / (2.0 * wS * wS)) * pow(max(0.0, 1.0 - abs(ux) / lenS), 1.7) +
        exp(-(ux * ux) / (2.0 * wS * wS)) * pow(max(0.0, 1.0 - abs(uy) / lenS), 1.7);
      // Spikes emanate FROM the core: masked off inside the disc so the
      // body color still reads and the center doesn't clip to white.
      float spikeMask = smoothstep(dr * 0.7, dr * 1.6, r);
      float aSpike = clamp(0.9 * sL + 0.7 * sS, 0.0, 1.0) * spikeMask * vOpa.x;
      col = srcOver(vec4(spikeCol, aSpike), col);
    }

    // depth desaturation - config-gated, default 0 (ruling 7.6)
    if (uDesat > 0.0) {
      float lum = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
      col.rgb = mix(col.rgb, vec3(lum), uDesat * (1.0 - vMult));
    }

    gl_FragColor = vec4(col.rgb, col.a * vMult);
    // Prototype parity: canvas textures uploaded without sRGB decode, then
    // converted linear->sRGB at output - stars render as the OETF-brightened
    // hex values (verified vs make-screenshot-1: #4DA8FF disc = ~rgb(142,204,255)).
    #include <colorspace_fragment>
  }
`

export function createStarMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uR: { value: NCONF.generation.R },
      uRangeMult: { value: NCONF.depth.rangeMult },
      uFloor: { value: NCONF.depth.opacityFloor },
      uBokehOpacity: { value: NCONF.render.bokehOpacity },
      uTierMult: { value: 0.95 }, // non-brain; the anchor mesh uses 1.0
      uSpriteScale: { value: NCONF.render.spriteScale },
      uBokehScale: { value: NCONF.render.bokehScale },
      uScaleMult: { value: 1 }, // brain ambient pulse rides this (P4)
      uAffordanceLift: { value: NCONF.select.affordanceLift },
      uDesat: { value: NCONF.depth.desatStrength },
      uPinOnly: { value: 0 }, // 1 = junction-bead mode: white dot only (§4.3)
      uAnchor: { value: 0 },   // 1 = anchor-role dominance treatment (§6)
      uCoronaMult: { value: 1 },
      uSpikeLen: { value: NCONF.anchor.spikeLength },
      uBody: { value: (['blue', 'red', 'violet'] as const).map((h) => hexToRgb01(PAL[h].body)).flat() },
      uHalo: { value: (['blue', 'red', 'violet'] as const).map((h) => hexToRgb01(PAL[h].halo)).flat() },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  })
}

/** Refresh the live-tunable uniforms from NCONF - call once per frame. O(1). */
export function syncStarUniforms(mat: ShaderMaterial): void {
  mat.uniforms.uR.value = NCONF.generation.R
  mat.uniforms.uRangeMult.value = NCONF.depth.rangeMult
  mat.uniforms.uFloor.value = NCONF.depth.opacityFloor
  mat.uniforms.uBokehOpacity.value = NCONF.render.bokehOpacity
  mat.uniforms.uSpriteScale.value = NCONF.render.spriteScale
  mat.uniforms.uBokehScale.value = NCONF.render.bokehScale
  mat.uniforms.uDesat.value = NCONF.depth.desatStrength
  mat.uniforms.uAffordanceLift.value = NCONF.select.affordanceLift
}

/** Pack instances into a single InstancedBufferGeometry (one draw call). */
export function buildStarGeometry(instances: readonly StarInstance[]): InstancedBufferGeometry {
  const quad = new PlaneGeometry(1, 1)
  const geo = new InstancedBufferGeometry()
  geo.index = quad.index
  geo.setAttribute('position', quad.getAttribute('position'))
  geo.instanceCount = instances.length

  const n = instances.length
  const pos = new Float32Array(n * 3)
  const diam = new Float32Array(n)
  const hue = new Float32Array(n)
  const opa = new Float32Array(n * 3)
  const bokeh = new Float32Array(n)
  const state = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    const inst = instances[i]
    pos[i * 3] = inst.pos.x
    pos[i * 3 + 1] = inst.pos.y
    pos[i * 3 + 2] = inst.pos.z
    diam[i] = inst.diam ?? NCONF.render.tierDiam[inst.tier]
    hue[i] = HUE_INDEX[inst.hue]
    const [h, b, c] = inst.opa ?? TIER_OPA[inst.tier]
    opa[i * 3] = h
    opa[i * 3 + 1] = b
    opa[i * 3 + 2] = c
    bokeh[i] = inst.isBokeh ? 1 : 0
    state[i] = inst.state ?? 0
  }

  geo.setAttribute('iPos', new InstancedBufferAttribute(pos, 3))
  geo.setAttribute('iDiam', new InstancedBufferAttribute(diam, 1))
  geo.setAttribute('iHue', new InstancedBufferAttribute(hue, 1))
  geo.setAttribute('iOpa', new InstancedBufferAttribute(opa, 3))
  geo.setAttribute('iBokeh', new InstancedBufferAttribute(bokeh, 1))
  geo.setAttribute('iState', new InstancedBufferAttribute(state, 1))
  return geo
}

export function createStarMesh(instances: readonly StarInstance[]): Mesh {
  const mesh = new Mesh(buildStarGeometry(instances), createStarMaterial())
  mesh.frustumCulled = false // instanced positions live in attributes
  return mesh
}
