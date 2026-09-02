// Selection layer for the neural port (P5) - pure math, no three.js, runs
// headless in tests. ORB_NEURAL_SPEC §6 (the authoritative selection spec)
// is missing from the repo; this module implements the recursive two-level
// model from ORB_NEURAL_PORT_SPEC's own constraints (§0/§6/§7):
//
//  - Level 0: the active shell is the hub population; resolveReticle picks
//    the hub nearest the fixed focus point - the SAME focus-weight scalar
//    the globe used (w = rotated unit direction · ẑ), over arbitrary hub
//    directions instead of a latitude grid.
//  - Drill-in: the selected hub takes the anchor ROLE (recentered to the
//    origin) and its category's reports re-shell around it on the globe's
//    own grid - orbit latitude + itemTheta spacing at childShellRadius - so
//    the FROZEN physics detents align with the child shell exactly and
//    level-1 selection is literally the globe's math.
//  - Drill-out: the center anchor is the drill-out target (§6) - it becomes
//    the reticle candidate when no shell report holds the focus point
//    (best w < select.anchorWinsBelow).
//
// Category mapping (assumption, flagged in PORT_LOG): hub i carries orbit
// (i mod ORBITS.length). Reports are nodes; every report stays reachable.

import { ORBITS } from '../data/orbits'
import {
  analyticFocusWeight,
  itemLocalPosition,
  itemTheta,
  rotateYawPitch,
} from '../orb/geometry'
import type { Vec3 } from '../orb/geometry'
import { NCONF } from './config'
import type { NeuralNode } from './graph'

/** Neural spherical convention (y-up): unit direction of a graph node. */
export function memberDir(phi: number, theta: number): Vec3 {
  return [
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  ]
}

export interface ReticleResult {
  index: number
  w: number
}

/**
 * resolveReticle over an arbitrary shell: argmax of the focus weight
 * (rotated direction · ẑ) - the globe's one scalar, generalized off the
 * latitude grid. Ties keep the earlier member (stable).
 */
export function resolveReticle(
  dirs: readonly Vec3[],
  yaw: number,
  pitch: number,
): ReticleResult {
  let best: ReticleResult = { index: -1, w: -Infinity }
  for (let i = 0; i < dirs.length; i++) {
    const [, , z] = rotateYawPitch(dirs[i], yaw, pitch)
    if (z > best.w) best = { index: i, w: z }
  }
  return best
}

/** Orbit (category) carried by a hub - assumption: round-robin by index. */
export function hubOrbitIndex(hubIndex: number): number {
  return hubIndex % ORBITS.length
}

export interface ChildShellItem {
  orbitIndex: number
  itemIndex: number
  /** position relative to the anchor (world units) */
  local: Vec3
  phi: number // orbit latitude (globe convention)
  theta: number
}

/**
 * The level-1 re-shell: the category's reports on the globe grid (orbit
 * latitude, itemTheta spacing) at childShellRadius around the anchor.
 * Because this IS the globe's item grid, the frozen physics detents
 * (yawStep of the active orbit, pitch spring to orbit latitude) center a
 * report in the reticle with zero physics changes.
 */
export function childShell(
  orbitIndex: number,
  radius: number = NCONF.select.childShellRadius,
): ChildShellItem[] {
  const orbit = ORBITS[orbitIndex]
  const count = orbit.reports.length
  return orbit.reports.map((_, itemIndex) => {
    const theta = itemTheta(itemIndex, count)
    return {
      orbitIndex,
      itemIndex,
      local: itemLocalPosition(orbit.latitude, theta, radius),
      phi: orbit.latitude,
      theta,
    }
  })
}

export interface Level1Result {
  /** focused report, or null when the anchor holds the reticle */
  item: ChildShellItem | null
  w: number
  anchorWins: boolean
}

/**
 * Level-1 reticle: globe math over the drilled orbit's reports, plus the
 * §6 drill-out rule - the anchor is the candidate when no report holds
 * the focus point.
 */
export function resolveLevel1(
  shell: readonly ChildShellItem[],
  yaw: number,
  pitch: number,
  anchorWinsBelow: number = NCONF.select.anchorWinsBelow,
): Level1Result {
  let best: ChildShellItem | null = null
  let bestW = -Infinity
  for (const item of shell) {
    const w = analyticFocusWeight(item.phi, item.theta, yaw, pitch)
    if (w > bestW) {
      bestW = w
      best = item
    }
  }
  const anchorWins = bestW < anchorWinsBelow
  return { item: anchorWins ? null : best, w: bestW, anchorWins }
}

/** Hub shell directions for level 0, in graph creation order. */
export function hubDirs(nodes: readonly NeuralNode[]): { dirs: Vec3[]; hubIndices: number[] } {
  const dirs: Vec3[] = []
  const hubIndices: number[] = []
  let hubIdx = 0
  for (const n of nodes) {
    if (n.tier !== 'hub') continue
    dirs.push(memberDir(n.phi, n.theta))
    hubIndices.push(hubIdx++)
  }
  return { dirs, hubIndices }
}
