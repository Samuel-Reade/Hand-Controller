// PLACEHOLDER cumulative-rallies source - RALLY.md §5 (SIZE = cumulative
// rallies, LOCKED) and §3 (rallying an echo implicitly rallies its parent: a
// parent's total is never less than its children's).
//
// Until shout data exists: each node gets an OWN demand from a heavy-tailed
// hash of its name (most shouts small, a few huge - real demand is
// long-tailed), and cumulative demand rolls up the tree so every parent
// carries at least the sum of its children. Normalised so the largest shout
// is 1. Independent of momentum.ts by construction (different hash salt):
// the field must show "huge and flat" and "small and streaking" both - that
// contrast is RALLY's anti-bias rule. The brain is the camp aggregate and is
// not sized by this (it is the anchor).

import { NCONF } from './config'
import type { NeuralNode } from './graph'
import { nameUnit } from './momentum'
import { TIER_OPA } from './palette'

type RalliesCfg = typeof NCONF.rallies

/**
 * Own demand, two populations. The top `popularFraction` of the hash is a
 * popular post: popularMin..1, mildly front-loaded. Everything else is minor:
 * 0.02..minorMax, quadratic so most sit near the floor. A single power law
 * cannot give "many dim AND a clear popular minority" - its median-to-top
 * ratio is fixed - hence two bands. Different salt from momentum.
 */
const RALLIES_SALT = 0x9e3779b9 // golden-ratio constant; momentum uses salt 0

export function ownRallies(name: string, cfg: RalliesCfg = NCONF.rallies): number {
  const u = nameUnit(name, RALLIES_SALT)
  const cut = 1 - cfg.popularFraction
  if (u >= cut) {
    const v = (u - cut) / Math.max(1e-9, cfg.popularFraction)
    return cfg.popularMin + (1 - cfg.popularMin) * Math.pow(v, 0.7)
  }
  const v = u / Math.max(1e-9, cut)
  return 0.02 + (cfg.minorMax - 0.02) * v * v
}

/** Cumulative demand rolled up the tree (§3), normalised: biggest shout = 1. */
export function computeRallies(nodes: readonly NeuralNode[], cfg: RalliesCfg = NCONF.rallies): Map<string, number> {
  const cum = new Map<string, number>()
  for (const n of nodes) if (n.tier !== 'brain') cum.set(n.name, ownRallies(n.name, cfg))
  // Creation order puts every parent before its children, so a backward walk
  // sees each child's completed total before adding it to the parent.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]
    if (n.tier === 'brain' || !n.parentName || n.parentName === 'brain') continue
    cum.set(n.parentName, (cum.get(n.parentName) ?? 0) + (cum.get(n.name) ?? 0))
  }
  let max = 0
  for (const v of cum.values()) max = Math.max(max, v)
  const out = new Map<string, number>()
  for (const [k, v] of cum) out.set(k, max > 0 ? v / max : 0)
  out.set('brain', 1) // the aggregate of everything; sized by anchor.brainDiam, not this
  return out
}

/** Sprite diameter (wu) for normalised rallies r: P0 terminal .. P0 hub. */
export function diamFor(r: number, cfg: RalliesCfg = NCONF.rallies): number {
  return cfg.diamMin + (cfg.diamMax - cfg.diamMin) * Math.pow(Math.min(1, Math.max(0, r)), cfg.sizeGamma)
}

/** [haloOpa, bloomOpa, coreOpa] for r: P0 terminal .. P0 hub. */
export function opaFor(r: number, cfg: RalliesCfg = NCONF.rallies): [number, number, number] {
  const t = Math.pow(Math.min(1, Math.max(0, r)), cfg.sizeGamma)
  const lo = TIER_OPA.terminal
  const hi = TIER_OPA.hub
  return [lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, lo[2] + (hi[2] - lo[2]) * t]
}
