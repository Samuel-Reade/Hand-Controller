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
  NoBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  Vector4,
} from 'three'
import { NCONF } from './config'
import { HUE_INDEX, PAL, TIER_OPA, hexToRgb01 } from './palette'
import type { NeuralHue, NeuralTier } from './palette'

/** Per-frame scale the scene sets: the drawing buffer's height in device px (the glow
 *  cap) and the camera's distance to the pivot (depth of field). */
export const starRuntime = { viewportH: 900, focusZ: NCONF.camera.z }

export interface StarInstance {
  pos: Vector3      // constellation-space position
  tier: NeuralTier
  hue: NeuralHue
  isBokeh?: boolean
  /** RALLY §5 momentum 0..1 - drives the motion channel; 0 = still (default) */
  momentum?: number
  /** RALLY §5 cumulative rallies 0..1 - how white-hot the core burns (size is set via diam/opa) */
  rallies?: number
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
  uniform float uTime;
  uniform float uMomentumGlow;
  uniform float uPulsePeriod;
  uniform float uPulseRateBoost;
  uniform float uTanHalfFov;
  uniform float uGlowFadeStart;
  uniform float uGlowFadeEnd;
  uniform float uDetailStart;
  uniform float uDetailEnd;
  uniform float uViewportH;
  uniform float uFocusZ;
  uniform float uDefocusStart;
  uniform float uDefocusEnd;
  uniform vec3 uBody[3];
  uniform vec3 uHalo[3];
  uniform vec3 uCore[3];
  uniform vec3 uMid[3];
  uniform float uCoreRim;
  uniform float uBlaze;
  uniform float uBlazeSpread;
  attribute vec3 iPos;
  attribute float iDiam;
  attribute float iHue;
  attribute vec3 iOpa;
  attribute float iBokeh;
  attribute float iState;
  attribute float iPhase;
  attribute float iMomentum;
  attribute float iRallies;
  varying vec2 vUv;
  varying vec3 vBody;
  varying vec3 vHalo;
  varying vec3 vCore;
  varying vec3 vRim;
  varying float vRallies;
  varying float vCorona;
  varying float vBlaze;
  varying vec3 vOpa;
  varying float vMult;
  varying float vMultBody;
  varying float vState;
  varying float vGlow;
  varying float vBokeh;
  varying float vDetail;
  varying float vSizePx;
  varying vec3 vViewPos;
  varying float vDiscR;

  void main() {
    vUv = position.xy; // unit quad corners at ±0.5; r=0 center
    int h = int(iHue + 0.5);
    vBody = uBody[h];
    vHalo = uHalo[h];
    vCore = uCore[h];
    vRim = mix(uBody[h], uMid[h], uCoreRim); // saturated edge so the core reads white
    vRallies = iRallies;
    // RALLY §5 momentum channel (motion is its own channel, never size): a
    // moving shout pulses - halo + bloom lift by momentum x uMomentumGlow at a
    // rate that rises with momentum - and a still one is still. The disc's
    // SIZE never changes; size is the cumulative-rallies channel.
    float rate = (1.0 + uPulseRateBoost * iMomentum) / uPulsePeriod;
    float pulse = 0.5 + 0.5 * sin(6.2831853 * (uTime * rate + iPhase));
    float lift = uMomentumGlow * iMomentum * pulse;
    float halo = min(1.0, iOpa.x + lift);
    // §7 affordance: halo lift on the reticle candidate rides iState.
    vOpa = vec3(min(1.0, halo * (1.0 + uAffordanceLift * iState)), min(1.0, iOpa.y + lift), iOpa.z);
    vState = iState;

    vec4 wc = modelMatrix * vec4(iPos, 1.0);
    vec4 mv = viewMatrix * wc;
    // Depth of field (fog pass): stops from the focus plane, |ln(depth /
    // focus)|, through the defocus ramp. Out of focus a node takes the
    // bokeh treatment - continuous, so a body eases out of focus as the
    // camera closes in; only the flagged sprites keep the bokeh scale.
    float defocus = smoothstep(uDefocusStart, uDefocusEnd, abs(log(max(1.0, -mv.z) / uFocusZ)));
    vBokeh = max(iBokeh, defocus);
    float range = uR * uRangeMult;
    float zn = clamp((wc.z + range) / (2.0 * range), 0.0, 1.0);
    float ss = zn * zn * (3.0 - 2.0 * zn);
    float depthOpa = mix(uFloor + (1.0 - uFloor) * ss, uBokehOpacity, vBokeh);
    // PORT_LOG C2: whole-sprite multiplier = depthOpa × haloOpa × tierMult.
    // The momentum lift rides haloOpa here too: a moving shout is BRIGHTER
    // (velocity glow), never bigger.
    vMult = depthOpa * halo * uTierMult;
    // the luminous body is NOT capped by haloOpa - the heart must reach white
    vMultBody = depthOpa * uTierMult;

    // "Powerful": a popular post's glow spreads wider and burns brighter
    // (rallies-driven); the DISC keeps its size - dr = DR / vCorona below.
    float coronaMult = uCoronaMult * (1.0 + uBlazeSpread * iRallies);
    vCorona = coronaMult;
    vBlaze = 1.0 + uBlaze * iRallies * iRallies;
    float size = iDiam * mix(uSpriteScale, uBokehScale, iBokeh) * uScaleMult * coronaMult;

    // Zoom-invariant glow: glare is an optical (screen-space) effect, so a
    // star's corona must not grow to fill the frame as the camera closes in
    // - at 7x the anchor's corona alone tinted every pixel lavender. Fade
    // corona + bloom by the fraction of the frame height the sprite spans;
    // the solid disc and pinpoint are untouched (they ARE the star).
    float frac = size / (2.0 * uTanHalfFov * max(1.0, -mv.z));
    float fade = 1.0 - smoothstep(uGlowFadeStart, uGlowFadeEnd, frac);
    vGlow = fade;
    // Surface detail only once the body is big enough to show it - from
    // afar a node is a pinpoint and the mottle would only alias.
    vDetail = smoothstep(uDetailStart, uDetailEnd, frac) * (1.0 - vBokeh); // no detail out of focus
    vSizePx = frac * uViewportH; // the quad's width on screen, device px (the glow cap)

    mv.xy += position.xy * size; // view-space billboard
    // the depth twin's sphere: the fragment's view position and the disc
    // radius in world units (dr = DR / coronaMult of the quad's width)
    vViewPos = mv.xyz;
    vDiscR = size * 0.15 / coronaMult;
    gl_Position = projectionMatrix * mv;
  }
`

// dr = 0.15 in quad-width UV terms (§4.1); every radius in those same units.
const FRAG = /* glsl */ `
  uniform float uDesat;
  uniform float uCoreStrength;
  uniform float uCoreSize;
  uniform float uDiscEdge;
  varying vec2 vUv;
  varying vec3 vBody;
  varying vec3 vHalo;
  varying vec3 vCore;
  varying vec3 vRim;
  varying float vRallies;
  varying float vCorona;
  varying float vBlaze;
  varying vec3 vOpa;
  varying float vMult;
  varying float vMultBody;
  varying float vState;
  varying float vGlow;
  varying float vBokeh;
  varying float vDetail;
  varying float vSizePx;
  uniform float uTime;
  uniform float uLimb;
  uniform float uDiscEdgeNear;
  uniform float uGlowCapPx;
  uniform float uSurfaceAmp;
  uniform float uSurfaceScale;
  uniform float uSurfaceDrift;
  uniform float uPinPx;

  const float DR = 0.15;

  // Value noise for the surface mottle: three octaves, sampled at a point
  // on the unit sphere so the pattern wraps and foreshortens at the limb.
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.03) + 0.2 * vnoise(p * 4.07);
  }

  // Canvas source-over compositing - the prototype painted the four layers
  // onto one texture; reproduce the stacking exactly.
  vec4 srcOver(vec4 src, vec4 dst) {
    float a = src.a + dst.a * (1.0 - src.a);
    vec3 rgb = a > 1e-5 ? (src.rgb * src.a + dst.rgb * dst.a * (1.0 - src.a)) / a : vec3(0.0);
    return vec4(rgb, a);
  }

  uniform float uPinOnly;
  uniform float uAnchor;
  uniform vec4 uGlare; // (tight peak, sigma, tail, tail radius) - config.render.glare*
  uniform float uSpikeLen;
  uniform float uSpikeAbove;
  uniform float uSpikeScale;

  void main() {
    float r = length(vUv);
    float px = fwidth(r); // ~1 device pixel in r units - resolution independence
    float dr = DR / vCorona; // §6 + blaze: corona/spread enlarge the quad, not the disc
    // The glow unit (fog pass): glare and bloom are drawn in disc radii,
    // capped at uGlowCapPx on screen - glare has a fixed angular size, and
    // scaling with the body it wrapped every near node in a translucent
    // disc three times its size. Above every rest-view disc, so inert there.
    float glowUnit = min(dr, uGlowCapPx / max(1.0, vSizePx));
    // The body's soft edge tightens as the body resolves (uDiscEdgeNear):
    // a resolved sphere has a limb, a far star is blurred by the optics.
    float edge = mix(uDiscEdge, uDiscEdgeNear, vDetail);

    if (uPinOnly > 0.5) {
      // Junction bead (§4.3): tiny soft white dot, 60% - nothing else.
      float aBead = 0.6 * (1.0 - smoothstep(dr * 0.55, dr, r));
      gl_FragColor = vec4(1.0, 1.0, 1.0, aBead * vMult);
      #include <colorspace_fragment>
      return;
    }

    // 1. glare (lighting pass; replaces the corona's linear ramp, which read
    //    as a soft disc with an edge at any zoom): a tight gaussian at the
    //    disc edge plus a long faint Lorentzian tail - bright where the
    //    star's light is, fading the way real glare does - windowed softly
    //    at the quad edge. The bloom pass adds the wide spread, hot only.
    //    A bokeh sprite is defocused light - it has no glare (the peak at
    //    its huge disc edge drew a bright rim at 3x).
    //    Outside the disc only - like the corona it replaces (annular from
    //    1.2 dr): glare over the disc interior filled every body with light
    //    and the tone mapper flattened it to a white sticker.
    float q = max(0.0, r - dr) / glowUnit; // distance outside the disc, in glow units
    float glare = (1.0 - vBokeh) * (uGlare.x * exp(-(q * q) / (2.0 * uGlare.y * uGlare.y))
                                  + uGlare.z / (1.0 + (q * q) / (uGlare.w * uGlare.w)));
    glare *= smoothstep(0.6, 1.0, r / dr); // rises through the disc's soft edge
    float aCor = vOpa.x * min(1.0, glare);
    aCor *= 1.0 - smoothstep(0.38, 0.49, r); // quad window, no cut
    aCor *= vGlow * vBlaze; // zoom fade x blaze (vertex)
    vec4 col = vec4(vHalo, aCor);

    // 2. bloom: annular inner DR×0.8 → outer 0.8 dr + 2 glow units (2.8 dr
    //    uncapped), stops 0.0→body×0.50, 0.5→body×0.18, 1.0→0
    float bloomOut = dr * 0.8 + glowUnit * 2.0;
    float tb = clamp((r - dr * 0.8) / (glowUnit * 2.0), 0.0, 1.0);
    float aBloom = vOpa.y * (tb < 0.5 ? mix(0.50, 0.18, tb / 0.5)
                                      : mix(0.18, 0.0, (tb - 0.5) / 0.5));
    aBloom *= 1.0 - smoothstep(bloomOut - px, bloomOut, r);
    aBloom *= min(1.0, vGlow * vBlaze);
    col = srcOver(vec4(vBody, aBloom), col);

    // 3. the luminous body (replaces the 7.1 flat disc, which read as a
    //    sticker at any colour): a white-hot gaussian heart falling through
    //    the BODY colour to a saturated rim, soft-edged - no outline. Kept in
    //    its own stack (body) so its alpha is scaled by vMultBody, not by
    //    haloOpa: the heart of a popular post reaches full white. Size is
    //    still the rallies channel - half alpha at dr, gone by uDiscEdge dr.
    //    Mirrored by config.bodyAlpha / heartAlpha.
    float x = r / dr;
    // out of focus (vBokeh) the heart spreads and cools and the edge blurs
    float heat = uCoreStrength * (0.35 + 0.65 * vRallies) * (1.0 - 0.6 * vBokeh);
    float coreR = uCoreSize * (0.6 + 0.4 * vRallies) * (1.0 + vBokeh);
    float aHeart = exp(-(x * x) / (2.0 * coreR * coreR)) * (0.45 + 0.55 * vRallies) * vOpa.z * (1.0 - 0.5 * vBokeh);
    //    A resolved sphere has a limb: the ramp starts later with detail
    //    (0.6 -> 0.88 dr), which also keeps the occlusion cut (occludeEdge
    //    0.85) inside the opaque zone - at 0.6 -> 1.08 the cut sat where the
    //    body was half transparent and a line behind ended in a stub.
    float aBody = vOpa.z * (1.0 - smoothstep(mix(0.6, 0.88, vDetail) - 0.4 * vBokeh, edge + 0.5 * vBokeh, x));
    vec3 bodyCol = mix(vBody, vRim, smoothstep(0.7, edge, x));
    vec4 body = vec4(bodyCol, aBody);
    body = srcOver(vec4(mix(vBody, vCore, heat), min(1.0, aHeart)), body);

    // 3b. a body, not a sticker (node-bodies pass), shading the WHOLE body
    //     layer, heart included - under the heart alone a popular post is a
    //     flat white disc. Limb darkening: a self-luminous sphere is
    //     brightest face-on and dims toward its edge, I = I0 (1 - u (1 - mu)),
    //     squared here because the tone mapper flattens anything above 0.8.
    //     Close enough to see it, a surface mottle sampled ON the sphere
    //     (X, Y, mu) so it wraps and foreshortens at the limb, turning at
    //     uSurfaceDrift (0 = still). Brightness only: the hue is status.
    //     Not on bokeh (defocused light).
    float xs = min(x, 1.0);
    float mu = sqrt(max(0.0, 1.0 - xs * xs));
    float limb = 1.0 - uLimb * (1.0 - mu);
    float shade = mix(1.0, limb * limb, 1.0 - vBokeh);
    if (vDetail > 0.001) {
      float a = uTime * uSurfaceDrift;
      vec3 sp = vec3(vUv / dr, mu);
      sp = vec3(sp.x * cos(a) - sp.z * sin(a), sp.y, sp.x * sin(a) + sp.z * cos(a));
      float n = fbm(sp * uSurfaceScale) - 0.5;
      shade *= 1.0 + uSurfaceAmp * vDetail * n * mu;
    }
    body.rgb *= shade;

    // 4. white pinpoint - the star's unresolved image: max(DR×0.22, 1px), the
    //    >= 1 px guarantee for far, tiny posts, a little larger on big
    //    shouts. Node-bodies pass: capped at uPinPx device px and gone once
    //    the body resolves (vDetail) - scaling with the disc it was a flat
    //    white sticker over 22-38% of every close-up. The heart carries the
    //    centre from there.
    float pinR = clamp(dr * (0.22 + 0.16 * vRallies), px, px * uPinPx);
    float aPin = min(1.0, vOpa.z * 0.85) * (1.0 - smoothstep(pinR - px, pinR, r)) * (1.0 - max(vDetail, vBokeh));
    body = srcOver(vec4(1.0, 1.0, 1.0, aPin), body);

    // Spikes: the anchor's §6 dominance cross at full length; posts above
    // uSpikeAbove (rallies) get the same cross at uSpikeScale - the bright-
    // star signature for the shouts that matter. uSpikeAbove > 1 = anchor only.
    float spikeGate = uAnchor > 0.5 ? 1.0 : smoothstep(uSpikeAbove - 0.08, uSpikeAbove, vRallies);
    if (spikeGate > 0.001) {
      float lenMul = uAnchor > 0.5 ? 1.0 : uSpikeScale;
      vec3 spikeCol = mix(vBody, vec3(1.0), 0.65);
      float wL = dr * 0.10;
      float wS = dr * 0.07;
      float lenL = uSpikeLen * lenMul;
      float lenS = uSpikeLen * lenMul * 0.55;
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
      float aSpike = clamp(0.9 * sL + 0.7 * sS, 0.0, 1.0) * spikeMask * vOpa.x * spikeGate;
      col = srcOver(vec4(spikeCol, aSpike), col);
    }

    // glow (corona, bloom, spikes): depth x haloOpa x tierMult (PORT_LOG C2);
    // body (heart, body, pin): depth x tierMult - the heart is not dimmed by
    // the tier's halo opacity
    col.a *= vMult;
    body.a *= vMultBody;
    vec4 outc = srcOver(body, col);

    // depth desaturation - config-gated, default 0 (ruling 7.6)
    if (uDesat > 0.0) {
      float lum = dot(outc.rgb, vec3(0.2126, 0.7152, 0.0722));
      outc.rgb = mix(outc.rgb, vec3(lum), uDesat * (1.0 - vMult));
    }

    gl_FragColor = outc;
    // Prototype parity: canvas textures uploaded without sRGB decode, then
    // converted linear->sRGB at output - stars render as the OETF-brightened
    // hex values (verified vs make-screenshot-1: #4DA8FF disc = ~rgb(142,204,255)).
    #include <colorspace_fragment>
  }
`

// Depth twin (scoped occlusion, 2026-09-21): the solid disc writes depth and
// nothing else. The glow around a body stays additive and hides nothing;
// bokeh (defocused light) and junction beads hide nothing.
const DEPTH_FRAG = /* glsl */ `
  uniform float uPinOnly;
  uniform float uOccludeEdge;
  uniform mat4 projectionMatrix;
  varying vec2 vUv;
  varying float vCorona;
  varying float vBokeh;
  varying vec3 vViewPos;
  varying float vDiscR;
  const float DR = 0.15;
  void main() {
    float r = length(vUv);
    float dr = DR / vCorona;
    float x = r / dr;
    // the cut shrinks with defocus: a blurred body has no hard edge to hide behind
    if (uPinOnly > 0.5 || x > uOccludeEdge * (1.0 - vBokeh)) discard;
    // A sphere's depth, not the billboard's: the surface sits sqrt(R^2 - d^2)
    // nearer the camera than the plane through the centre, so a line vanishes
    // where it enters the sphere. Flat, a line in front of the centre plane
    // but inside the sphere drew over the disc and cut off at the plane.
    float h = vDiscR * sqrt(max(0.0, 1.0 - x * x));
    vec4 clip = projectionMatrix * vec4(vViewPos.xy, vViewPos.z + h, 1.0);
    gl_FragDepthEXT = clip.z / clip.w * 0.5 + 0.5;
    gl_FragColor = vec4(0.0);
  }
`

/**
 * Scoped occlusion: a depth twin of a star mesh - the same geometry and the
 * SAME uniform objects (one sync serves both, and the anchor's settings
 * carry over), drawing only depth for the solid disc (x < occludeEdge, the
 * opaque part, so the cut it makes in what is behind is never seen). Give
 * it a renderOrder after what the bodies must not hide and before what they
 * must: bodies never hide bodies, only the lines; the brain hides both.
 */
export function createDepthTwin(visible: Mesh): Mesh {
  const src = visible.material as ShaderMaterial
  const mat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: DEPTH_FRAG,
    uniforms: src.uniforms,
    transparent: true, // sorted with the additive passes by renderOrder
    colorWrite: false,
    depthWrite: true,
    depthTest: true,
    blending: NoBlending,
    side: DoubleSide,
  })
  const mesh = new Mesh(visible.geometry, mat)
  mesh.frustumCulled = false
  return mesh
}

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
      uGlare: { value: new Vector4() }, // filled by syncStarUniforms
      uSpikeLen: { value: NCONF.anchor.spikeLength },
      uTime: { value: 0 },
      uMomentumGlow: { value: NCONF.momentum.glow },
      uPulsePeriod: { value: NCONF.momentum.pulsePeriod },
      uPulseRateBoost: { value: NCONF.momentum.pulseRateBoost },
      uTanHalfFov: { value: Math.tan((NCONF.camera.fov * Math.PI) / 360) },
      uGlowFadeStart: { value: NCONF.render.glowFadeStart },
      uGlowFadeEnd: { value: NCONF.render.glowFadeEnd },
      uDetailStart: { value: NCONF.render.detailStart },
      uDetailEnd: { value: NCONF.render.detailEnd },
      uLimb: { value: NCONF.render.limbDarkening },
      uSurfaceAmp: { value: NCONF.render.surfaceAmp },
      uSurfaceScale: { value: NCONF.render.surfaceScale },
      uSurfaceDrift: { value: NCONF.render.surfaceDrift },
      uPinPx: { value: NCONF.render.pinMaxPx },
      uOccludeEdge: { value: NCONF.render.occludeEdge }, // the depth twin's disc (createDepthTwin)
      uDiscEdgeNear: { value: NCONF.render.discEdgeNear },
      uGlowCapPx: { value: NCONF.render.glowCapPx },
      uViewportH: { value: starRuntime.viewportH },
      uFocusZ: { value: starRuntime.focusZ },
      uDefocusStart: { value: NCONF.render.defocusStart },
      uDefocusEnd: { value: NCONF.render.defocusEnd },
      uBody: { value: (['blue', 'red', 'violet'] as const).map((h) => hexToRgb01(PAL[h].body)).flat() },
      uHalo: { value: (['blue', 'red', 'violet'] as const).map((h) => hexToRgb01(PAL[h].halo)).flat() },
      uCore: { value: (['blue', 'red', 'violet'] as const).map((h) => hexToRgb01(PAL[h].core)).flat() },
      uMid: { value: (['blue', 'red', 'violet'] as const).map((h) => hexToRgb01(PAL[h].mid)).flat() },
      uCoreRim: { value: NCONF.render.coreRim },
      uBlaze: { value: NCONF.render.blaze },
      uBlazeSpread: { value: NCONF.render.blazeSpread },
      uSpikeAbove: { value: NCONF.render.spikeAbove },
      uSpikeScale: { value: NCONF.render.spikeScale },
      uCoreStrength: { value: NCONF.render.coreStrength },
      uCoreSize: { value: NCONF.render.coreSize },
      uDiscEdge: { value: NCONF.render.discEdge },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  })
}

/**
 * Refresh the live-tunable uniforms from NCONF - call once per frame. O(1).
 * `timeSec` drives the momentum pulse; omit it (beads) and nothing moves.
 */
export function syncStarUniforms(mat: ShaderMaterial, timeSec?: number): void {
  if (timeSec !== undefined) mat.uniforms.uTime.value = timeSec
  mat.uniforms.uMomentumGlow.value = NCONF.momentum.glow
  mat.uniforms.uPulsePeriod.value = Math.max(0.1, NCONF.momentum.pulsePeriod)
  mat.uniforms.uPulseRateBoost.value = NCONF.momentum.pulseRateBoost
  mat.uniforms.uGlowFadeStart.value = NCONF.render.glowFadeStart
  // smoothstep needs edge0 < edge1 - keep the sliders from inverting it
  mat.uniforms.uGlowFadeEnd.value = Math.max(NCONF.render.glowFadeStart + 0.01, NCONF.render.glowFadeEnd)
  mat.uniforms.uR.value = NCONF.generation.R
  mat.uniforms.uRangeMult.value = NCONF.depth.rangeMult
  mat.uniforms.uFloor.value = NCONF.depth.opacityFloor
  mat.uniforms.uBokehOpacity.value = NCONF.render.bokehOpacity
  mat.uniforms.uSpriteScale.value = NCONF.render.spriteScale
  mat.uniforms.uBokehScale.value = NCONF.render.bokehScale
  mat.uniforms.uDesat.value = NCONF.depth.desatStrength
  mat.uniforms.uCoreStrength.value = NCONF.render.coreStrength
  mat.uniforms.uCoreSize.value = Math.max(0.05, NCONF.render.coreSize)
  mat.uniforms.uDiscEdge.value = Math.max(1.01, NCONF.render.discEdge)
  mat.uniforms.uCoreRim.value = NCONF.render.coreRim
  mat.uniforms.uSpikeAbove.value = NCONF.render.spikeAbove
  mat.uniforms.uSpikeScale.value = NCONF.render.spikeScale
  mat.uniforms.uDetailStart.value = NCONF.render.detailStart
  mat.uniforms.uDetailEnd.value = Math.max(NCONF.render.detailStart + 0.01, NCONF.render.detailEnd)
  mat.uniforms.uLimb.value = NCONF.render.limbDarkening
  mat.uniforms.uSurfaceAmp.value = NCONF.render.surfaceAmp
  mat.uniforms.uSurfaceScale.value = Math.max(0.1, NCONF.render.surfaceScale)
  mat.uniforms.uSurfaceDrift.value = NCONF.render.surfaceDrift
  mat.uniforms.uPinPx.value = Math.max(1, NCONF.render.pinMaxPx) // clamp needs lo <= hi
  mat.uniforms.uOccludeEdge.value = NCONF.render.occludeEdge
  mat.uniforms.uDiscEdgeNear.value = Math.max(1.01, NCONF.render.discEdgeNear)
  mat.uniforms.uGlowCapPx.value = Math.max(1, NCONF.render.glowCapPx)
  mat.uniforms.uViewportH.value = starRuntime.viewportH
  mat.uniforms.uFocusZ.value = Math.max(1, starRuntime.focusZ)
  mat.uniforms.uDefocusStart.value = NCONF.render.defocusStart
  mat.uniforms.uDefocusEnd.value = Math.max(NCONF.render.defocusStart + 0.01, NCONF.render.defocusEnd)
  // widths floored so the sliders can never divide the glare by zero
  ;(mat.uniforms.uGlare.value as Vector4).set(
    NCONF.render.glareTight,
    Math.max(0.05, NCONF.render.glareSigma),
    NCONF.render.glareTail,
    Math.max(0.05, NCONF.render.glareTailRadius),
  )
  // blaze/spread are per-material so the anchor can opt out (see NeuralScene)
  if (mat.uniforms.uBlaze.value !== 0) mat.uniforms.uBlaze.value = NCONF.render.blaze
  if (mat.uniforms.uBlazeSpread.value !== 0) mat.uniforms.uBlazeSpread.value = NCONF.render.blazeSpread
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
  const phase = new Float32Array(n)
  const momentum = new Float32Array(n)
  const rallies = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    const inst = instances[i]
    // deterministic golden-ratio stagger for the momentum pulse (no RNG,
    // not part of the layout hash)
    phase[i] = (i * 0.6180339887) % 1
    momentum[i] = inst.momentum ?? 0
    rallies[i] = inst.rallies ?? 0
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
  geo.setAttribute('iPhase', new InstancedBufferAttribute(phase, 1))
  geo.setAttribute('iMomentum', new InstancedBufferAttribute(momentum, 1))
  geo.setAttribute('iRallies', new InstancedBufferAttribute(rallies, 1))
  return geo
}

export function createStarMesh(instances: readonly StarInstance[]): Mesh {
  const mesh = new Mesh(buildStarGeometry(instances), createStarMaterial())
  mesh.frustumCulled = false // instanced positions live in attributes
  return mesh
}
