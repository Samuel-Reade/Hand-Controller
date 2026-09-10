// The neural feel-config object (ORB_NEURAL_PORT_SPEC §5). Every constant of
// the star-network render lives here as a leva-wired default; nothing may be
// hardcoded at a use site. Defaults verified against the prototype ground
// truth in docs/PORT_LOG.md (P0 step-zero table). Same discipline as FEEL:
// leva mutates in place, renderers read live. Generation-affecting keys
// (the `generation` group) additionally bump `generationVersion` so the
// graph rebuilds; render keys take effect the next frame via uniforms.

import type { NeuralTier } from './palette'

export interface NeuralConfig {
  generation: {
    seed: number
    hubCount: number
    R: number
    hubRadialMin: number; hubRadialMax: number
    hubJitterPhi: number; hubJitterTheta: number
    nodeRadialMin: number; nodeRadialMax: number; nodeJitter: number
    subRadialMin: number; subRadialMax: number; subJitter: number
    terminalRadialMin: number; terminalRadialMax: number; terminalJitter: number
    redProbability: number
    // PORT_LOG C3: branch-count ranges are part of the generation tuple
    nodesPerHubMin: number; nodesPerHubMax: number
    // Echo count follows the post's OWN traction (RALLY: a popular post is a
    // conversation - "a decent amount of subnodes"); minor posts use
    // nodesPerHub. ownRallies is a name hash (no layout-RNG draws), so the
    // positions are untouched; only the loop bound changes. false = the P0
    // uniform bound, byte-exact (parity test).
    echoesByTraction: boolean
    popularEchoMin: number; popularEchoMax: number
    subsPerNodeMin: number; subsPerNodeMax: number
    terminalsPerSubMin: number; terminalsPerSubMax: number
    bokehCount: number
  }
  render: {
    tierDiam: Record<NeuralTier, number>
    spriteScale: number
    bokehScale: number
    bokehOpacity: number
    grainAmount: number
    grainEnabled: boolean
    // Zoom-invariant glow (visual pass): a sprite's corona + bloom fade once
    // it spans more than glowFadeStart of the frame HEIGHT, gone by
    // glowFadeEnd. Glare is optical, not a world-space disc - without this
    // the anchor's corona alone tinted every pixel lavender at 7x. Inert at
    // the rest view (anchor spans ~0.29 there), so P0 parity holds.
    glowFadeStart: number
    glowFadeEnd: number
    // Star cores (user: the flat discs "look stale"). The disc is lit like a
    // star - core-white at the centre falling to the body colour at the rim.
    // The falloff is the ONLY gradient: no specular, no rim light. Big shouts
    // (rallies) burn whiter. coreStrength 0 = ruling-7.1's flat disc.
    // The luminous body (replaces ruling 7.1's flat disc, which read as a
    // sticker at any colour): a white-hot gaussian heart of radius coreSize x
    // dr (larger on popular posts) falling through the BODY colour to a
    // saturated rim, soft-edged - half alpha at dr, gone by discEdge x dr.
    // Its alpha is not capped by haloOpa, so a popular post's heart reaches
    // full white. Size is still the rallies channel (dr).
    coreStrength: number   // how white the heart is (0 = body colour)
    coreSize: number       // heart radius in dr at zero rallies; x (0.6 + 0.4 r)
    discEdge: number       // where the body's soft edge ends, in dr
    coreRim: number        // how far the rim leans from body toward PAL.mid
    // "Powerful" (user direction 2026-09-10) - rallies-driven, so only the
    // posts that matter get it. blaze: corona + bloom alpha x (1 + blaze r^2);
    // blazeSpread: the glow footprint x (1 + spread r) while the DISC (size
    // channel) stays put; spikes: the bright-star diffraction cross the
    // anchor has, on posts above spikeAbove (1.01 = anchor only), at
    // spikeScale of the anchor's length. The anchor itself is exempt from
    // blaze/spread (its dominance treatment is §6's).
    blaze: number
    blazeSpread: number
    spikeAbove: number
    spikeScale: number
  }
  depth: {
    rangeMult: number      // depth.range = ±rangeMult × R
    opacityFloor: number   // far-hemisphere floor. 0.15 (salience pass) from the P0 0.3: the sphere reads as a volume
    desatStrength: number  // gated, default 0 (ruling 7.6)
  }
  rallies: {
    // RALLY.md §5 (LOCKED): SIZE = cumulative rallies; §3: a parent's total
    // is never less than its children's. PLACEHOLDER source (rallies.ts)
    // until shout data exists. Size and glow interpolate between the P0
    // terminal and hub levels by rallies^sizeGamma; tier is structure only.
    // Two populations (user direction): most posts have little traction, a
    // clear minority are popular. A single power law cannot do both - its
    // median-to-top ratio is fixed - so own demand is drawn from two bands.
    popularFraction: number // share of posts in the popular band
    minorMax: number        // minor band: own demand 0.02..minorMax, quadratic (mostly near the floor)
    popularMin: number      // popular band: own demand popularMin..1
    sizeGamma: number       // size/glow = r^sizeGamma; higher = more contrast between the bands
    diamMin: number       // wu at rallies -> 0 (P0 terminal: 13)
    diamMax: number       // wu at rallies = 1 (P0 hub: 104)
  }
  momentum: {
    // RALLY.md §5 (LOCKED): momentum is its OWN motion channel - pulse rate /
    // velocity glow - never size. A moving shout pulses; a still one is
    // still. PLACEHOLDER data source until shout analytics exist: a
    // deterministic name-hash marks `movingFraction` of shouts as moving
    // (momentum.ts). Nothing here touches disc size (the cumulative channel).
    movingFraction: number  // share of shouts that are "moving" (placeholder)
    glow: number            // halo + bloom opacity lift at full momentum, pulse peak
    pulsePeriod: number     // s at momentum -> 0; period / (1 + pulseRateBoost x m)
    pulseRateBoost: number  // full momentum pulses (1 + boost)x faster; also drives the trail band
  }
  trail: {
    coreOpacity: number
    glowOpacity: number
    glowRadiusMult: number
    bendFraction: number
    taperBase: number      // trail.taperProfile = (taperBase, taperExp)
    taperExp: number
    pulseEnabled: boolean  // brain→hub only (ruling 7.10)
    beadsEnabled: boolean  // ruling 7.9 kept them; OFF since 2026-09-10 (user: "no circles at the end of the strings")
    // Where a trail ends, as a fraction of the node's visible disc radius:
    // 0 = the node's centre - the string runs into the core (user direction
    // 2026-09-10). The prototype's surface-to-surface rule (1) was built for
    // hard-edged discs; with luminous bodies it left a gap before the heart.
    endInset: number
    radByTier: Record<NeuralTier, number>
    radDefault: number
    // Energy flow (visual pass): a soft band of brightness travelling along
    // EVERY trail, evaluated per fragment from a clock uniform - zero
    // per-frame JS, no geometry motion. flowInward also steers the
    // ruling-7.10 hot dots (brain<->hub) so every moving thing agrees.
    // A post's spoke follows its traction: base brightness = spokeMinWeight +
    // (1 - spokeMinWeight) x t^2 (t = rallies^sizeGamma) and radius x
    // (0.5 + 0.5 t), so 160 spokes read as a few bright lines and many
    // hairlines instead of a dandelion. Quadratic on purpose: linear at 0.25
    // still lit the median post's spoke at ~45% and the starburst stayed.
    // The momentum band is NOT weighted - a moving minor post still shows it.
    spokeMinWeight: number
    flowEnabled: boolean
    flowInward: boolean    // true: node -> parent -> brain (energy converges on the anchor); false: radiates out
    flowGain: number       // peak brightness lift (1 = 2x)
    flowWidth: number      // band sigma in trail parameter t (0..1)
    flowPeriod: number     // seconds per traversal
  }
  camera: { z: number; fov: number }
  scene: { initialPitch: number; pitchClamp: number }
  brainPulse: { rate: number; amp: number } // rate/frame; period ≈35s (PORT_LOG C1)
  anchor: {
    // §6 dominance treatment - leva-tuned at the P4 gate
    brainDiam: number
    coronaMult: number
    spikeLength: number
  }
  select: {
    // Selection layer (P5). ORB_NEURAL_SPEC §7's select.* keys are
    // unavailable (document missing); these defaults are the port's own,
    // flagged in PORT_LOG for reconciliation when the spec surfaces.
    recenterDuration: number   // ms - drill-in/out recenter animation
    recenterPush: number       // wu - the drilled anchor is pushed this much toward the camera
    childShellRadius: number   // wu - report re-shell radius around the anchor
    anchorWinsBelow: number    // reticle: anchor is the candidate below this w
    affordanceLift: number     // halo lift on the reticle candidate
    maxDepth: number           // ORB_SELECT_SPEC §5: Infinity = full tree; 1 = P5 two-level cap
  }
  point: PointConfig
}

/**
 * Crosshair pointing + free-rotation profile (ORB_SELECT_SPEC §5). That spec
 * files these under "FEEL additions", but they are neural-scene-only by its
 * own scope guard (§0 - the globe keeps detents and rotation-as-selection),
 * and NCONF is this scene's leva-wired config. Kept here so the globe's FEEL
 * stays exactly what the frozen globe tests assert.
 */
export interface PointConfig {
  // crosshair + highlight (PT1)
  crosshairSize: number   // px, arm length - small
  acquireRadius: number   // px from centre to acquire a node
  releaseRadius: number   // px to drop the current highlight (hysteresis; > acquire)
  switchMargin: number    // px a rival must beat the current highlight by to steal it
  tieBandPx: number       // within this, the nearer-camera node wins
  highlightSwell: number  // scale multiplier on the acquired node
  ringOpacity: number
  // free rotation profile (PT2 - declared now, unused until then)
  pitchClampFree: number  // rad (~±94.5°); replaces the ±1.1 category clamp
  magnetStrength: number  // torque toward centering the nearest node
  magnetSpeedGate: number // rad/s; above this the magnet fades to zero
  magnetMaxPull: number   // hard cap on magnet angular accel
  // confirm (PT3)
  dwellEnabled: boolean   // optional hands-free secondary; never the primary
  dwellMs: number
}

export const NCONF: NeuralConfig = {
  generation: {
    seed: 20260901,
    // Rally shape (user direction 2026-09-09): the field is MANY main posts
    // (shouts) on the brain, echoes one level deep and uncommon, nothing
    // deeper. Placeholder tier names map: hub = main post, node = echo;
    // sub/terminal are generated zero times. RALLY.md §2-3.
    hubCount: 160,
    R: 1100,
    // Brain -> post distance is random within limits (user direction
    // 2026-09-10): inner 0.6 R sits just outside the anchor's corona (quad
    // half-width 605 wu), outer 1.35 R keeps the echoes inside the camera fit.
    hubRadialMin: 0.6, hubRadialMax: 1.35,
    hubJitterPhi: 0.2, hubJitterTheta: 0.3,
    // Cluster tightness (user direction 2026-09-09: "random but in tighter
    // clusters"). Children still scatter by RNG jitter, but half as far: the
    // prototype's 0.22/0.28/0.38 rad jitter + 1.10-1.28 radial spray put a
    // hub's descendants at RMS 580 wu from it (terminals a mean 414 wu from
    // their parent); these give RMS 290 wu with < 2% disc overlaps. Pinned in
    // tests/cluster.test.ts. A departure from the P0 ground-truth layout.
    // Echoes around a popular post's LARGE disc need a little more room than
    // the 0.12 / 1.05-1.16 that fit the old tiers: measured 4/97 echoes
    // touching their parent's disc there, 0/97 here (PORT_LOG probe).
    nodeRadialMin: 1.06, nodeRadialMax: 1.2, nodeJitter: 0.16,
    subRadialMin: 1.03, subRadialMax: 1.1, subJitter: 0.14,
    terminalRadialMin: 1.02, terminalRadialMax: 1.07, terminalJitter: 0.18,
    redProbability: 0.15,
    // Echoes: round(rng(0, 0.7)) is 1 for 29% of posts, never 2 (the
    // prototype's re-drawn loop bound). sub/terminal: none.
    nodesPerHubMin: 0, nodesPerHubMax: 0.7,
    echoesByTraction: true,
    popularEchoMin: 3, popularEchoMax: 7, // re-drawn per check (P0 quirk): mean ~4.7 echoes on a popular post
    subsPerNodeMin: 0, subsPerNodeMax: 0,
    terminalsPerSubMin: 0, terminalsPerSubMax: 0,
    bokehCount: 10,
  },
  render: {
    tierDiam: { brain: 85, hub: 104, node: 56, sub: 30, terminal: 13 },
    spriteScale: 4.2,
    bokehScale: 10,
    bokehOpacity: 0.22,
    grainAmount: 0.03,
    grainEnabled: true,
    glowFadeStart: 0.3,
    glowFadeEnd: 1.0,
    coreStrength: 0.9,
    coreSize: 0.42,
    discEdge: 1.35,
    coreRim: 0.6,
    blaze: 1.0,
    blazeSpread: 0.5,
    spikeAbove: 0.8,
    spikeScale: 0.45,
  },
  depth: { rangeMult: 1.5, opacityFloor: 0.15, desatStrength: 0 },
  // Measured on the 160-post field (PORT_LOG): gamma 0.6 puts the median
  // post at 27 wu / halo 0.30 and the popular band at 66-104 wu / 0.58-0.85.
  rallies: { popularFraction: 0.12, minorMax: 0.15, popularMin: 0.4, sizeGamma: 0.6, diamMin: 13, diamMax: 104 },
  momentum: { movingFraction: 0.1, glow: 0.6, pulsePeriod: 5.5, pulseRateBoost: 1.5 },
  trail: {
    coreOpacity: 0.72,
    glowOpacity: 0.22,
    glowRadiusMult: 3.2,
    bendFraction: 0.1,
    taperBase: 0.55,
    taperExp: 1.5,
    pulseEnabled: true,
    beadsEnabled: false,
    endInset: 0,
    // brain 1.8 -> 1.2: with 160 spokes the P0 thickness (sized for 20) is
    // the starburst; a popular post's spoke is still the thickest line drawn.
    radByTier: { brain: 1.2, hub: 1.1, node: 0.65, sub: 0.35, terminal: 0.3 },
    radDefault: 0.3,
    spokeMinWeight: 0.06,
    flowEnabled: true,
    flowInward: true, // user direction 2026-09-09: reports feed the brain, not the other way
    flowGain: 0.9,
    flowWidth: 0.06,
    flowPeriod: 7,
  },
  camera: { z: 4600, fov: 52 }, // outside the field: max node r=1856 needs z>=4234 to fit the fov
  scene: { initialPitch: -0.18, pitchClamp: 1.1 },
  brainPulse: { rate: 0.003, amp: 0.06 },
  anchor: { brainDiam: 180, coronaMult: 1.6, spikeLength: 0.42 },
  select: {
    recenterDuration: 650,
    recenterPush: 900,
    childShellRadius: 260,
    anchorWinsBelow: 0.92,
    affordanceLift: 0.35,
    maxDepth: Infinity,
  },
  point: {
    crosshairSize:    7,
    acquireRadius:   46,
    releaseRadius:   88,
    switchMargin:    18,
    tieBandPx:       10,
    highlightSwell:   1.6,
    ringOpacity:      0.9,
    pitchClampFree:   1.65,
    magnetStrength:   3.2,
    magnetSpeedGate:  1.4,
    magnetMaxPull:    0.35,
    dwellEnabled:     false,
    dwellMs:        520,
  },
}

/**
 * Fraction of the frame HEIGHT a view-space billboard of world size `sizeWu`
 * spans at camera distance `distWu`. The star shader's glow-fade input,
 * mirrored here (no three.js) so tests can assert the fade is inert at rest.
 */
export function frameFraction(sizeWu: number, distWu: number, fovDeg = NCONF.camera.fov): number {
  return sizeWu / (2 * Math.tan((fovDeg * Math.PI) / 360) * Math.max(1, distWu))
}

/**
 * The solid disc's share of a star sprite's quad width: 2 x DR (starField
 * FRAG, DR = 0.15). Corona and bloom fill the rest of the quad. Used to size
 * the sight's ring to the STAR rather than to its glow footprint.
 */
export const DISC_FRACTION = 0.3

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The luminous body's alpha at normalised radius x (1 = dr): 1 inside 0.6 dr,
 * half at ~dr, 0 by discEdge. Mirrors starField's FRAG.
 */
export function bodyAlpha(x: number, cfg = NCONF.render): number {
  return 1 - smoothstep(0.6, cfg.discEdge, x)
}

/** The white heart's alpha at x for a post of `rallies`. Mirrors the FRAG. */
export function heartAlpha(x: number, rallies: number, cfg = NCONF.render): number {
  const coreR = cfg.coreSize * (0.6 + 0.4 * rallies)
  return Math.exp(-(x * x) / (2 * coreR * coreR)) * (0.45 + 0.55 * rallies)
}

/**
 * The sight's ring radius in px for a highlighted node: the STAR's projected
 * disc radius x highlightSwell - not the glow footprint, ~3x wider. 0 for the
 * anchor fallback: the anchor is the camp aggregate, and when nothing else is
 * under the sight the arms taking its hue is the whole signal.
 */
export function ringRadiusPx(
  tier: NeuralTier,
  diamWu: number,
  spriteScale: number,
  focal: number,
  w: number,
  swell: number,
): number {
  if (tier === 'brain') return 0
  return ((diamWu * spriteScale * DISC_FRACTION) / 2) * (focal / w) * swell
}

/**
 * The generation-config tuple (§5 RNG caveat): the seed reproduces a layout
 * only per this tuple. Hashed for the debug overlay + layout-hash gate.
 */
export function generationTuple(c: NeuralConfig = NCONF): number[] {
  const g = c.generation
  return [
    g.seed, g.hubCount, g.R,
    g.hubRadialMin, g.hubRadialMax, g.hubJitterPhi, g.hubJitterTheta,
    g.nodeRadialMin, g.nodeRadialMax, g.nodeJitter,
    g.subRadialMin, g.subRadialMax, g.subJitter,
    g.terminalRadialMin, g.terminalRadialMax, g.terminalJitter,
    g.redProbability,
    g.nodesPerHubMin, g.nodesPerHubMax,
    g.subsPerNodeMin, g.subsPerNodeMax,
    g.terminalsPerSubMin, g.terminalsPerSubMax,
    g.bokehCount,
    // echo-by-traction makes the layout depend on these too
    g.echoesByTraction ? 1 : 0, g.popularEchoMin, g.popularEchoMax,
    c.rallies.popularFraction, c.rallies.popularMin,
  ]
}

/** FNV-1a over the tuple's float bits - stable, dependency-free. */
export function tupleHash(tuple: number[]): string {
  const buf = new DataView(new ArrayBuffer(8))
  let h = 2166136261
  for (const v of tuple) {
    buf.setFloat64(0, v)
    for (let i = 0; i < 8; i++) {
      h ^= buf.getUint8(i)
      h = Math.imul(h, 16777619)
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
