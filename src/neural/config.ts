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
  }
  depth: {
    rangeMult: number      // depth.range = ±rangeMult × R
    opacityFloor: number
    desatStrength: number  // gated, default 0 (ruling 7.6)
  }
  trail: {
    coreOpacity: number
    glowOpacity: number
    glowRadiusMult: number
    bendFraction: number
    taperBase: number      // trail.taperProfile = (taperBase, taperExp)
    taperExp: number
    pulseEnabled: boolean  // brain→hub only (ruling 7.10)
    beadsEnabled: boolean  // ruling 7.9
    radByTier: Record<NeuralTier, number>
    radDefault: number
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
    hubCount: 20,
    R: 1100,
    hubRadialMin: 0.9, hubRadialMax: 1.1,
    hubJitterPhi: 0.2, hubJitterTheta: 0.3,
    nodeRadialMin: 1.1, nodeRadialMax: 1.28, nodeJitter: 0.22,
    subRadialMin: 1.06, subRadialMax: 1.18, subJitter: 0.28,
    terminalRadialMin: 1.04, terminalRadialMax: 1.12, terminalJitter: 0.38,
    redProbability: 0.15,
    nodesPerHubMin: 2, nodesPerHubMax: 5,
    subsPerNodeMin: 1, subsPerNodeMax: 4,
    terminalsPerSubMin: 0, terminalsPerSubMax: 3,
    bokehCount: 10,
  },
  render: {
    tierDiam: { brain: 85, hub: 104, node: 56, sub: 30, terminal: 13 },
    spriteScale: 4.2,
    bokehScale: 10,
    bokehOpacity: 0.22,
    grainAmount: 0.03,
    grainEnabled: true,
  },
  depth: { rangeMult: 1.5, opacityFloor: 0.3, desatStrength: 0 },
  trail: {
    coreOpacity: 0.72,
    glowOpacity: 0.22,
    glowRadiusMult: 3.2,
    bendFraction: 0.1,
    taperBase: 0.55,
    taperExp: 1.5,
    pulseEnabled: true,
    beadsEnabled: true,
    radByTier: { brain: 1.8, hub: 1.1, node: 0.65, sub: 0.35, terminal: 0.3 },
    radDefault: 0.3,
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
