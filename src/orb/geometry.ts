// Pure math for the orb: item placement, the two-rotation transform into
// world space, and the focus weight that drives selection, label opacity and
// item scale. No three.js imports - everything here runs headless in tests.

import type { OrbitDef } from '../data/orbits'

export const SPHERE_RADIUS = 2.45
export const TWO_PI = Math.PI * 2

export type Vec3 = [number, number, number]

/** Wrap an angle to (-pi, pi]. */
export function wrapAngle(a: number): number {
  let x = a % TWO_PI
  if (x <= -Math.PI) x += TWO_PI
  else if (x > Math.PI) x -= TWO_PI
  return x
}

/** Wrap an angle to [0, 2pi). */
export function mod2pi(a: number): number {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI
}

/** Longitude of item i of count, evenly spaced from theta = 0 (+Z, camera). */
export function itemTheta(i: number, count: number): number {
  return (i * TWO_PI) / count
}

/** Yaw detent spacing for an orbit of `count` items. */
export function yawStep(count: number): number {
  return TWO_PI / count
}

/**
 * Item position before any rotation. Orbit latitude phi, item longitude
 * theta, theta = 0 pointing at +Z:
 *   r = R cos(phi);  p = (r sin(theta), R sin(phi), r cos(theta))
 */
export function itemLocalPosition(phi: number, theta: number, radius = SPHERE_RADIUS): Vec3 {
  const r = radius * Math.cos(phi)
  return [r * Math.sin(theta), radius * Math.sin(phi), r * Math.cos(theta)]
}

/**
 * Apply the two nested groups (S5): inner spin about local Y by yaw, then
 * outer tilt about world X by pitch. Matches three.js rotation-y/rotation-x
 * conventions exactly (right-handed; verified against Object3D in tests).
 */
export function rotateYawPitch(p: Vec3, yaw: number, pitch: number): Vec3 {
  const [x, y, z] = p
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const x1 = x * cy + z * sy
  const z1 = -x * sy + z * cy
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const y2 = y * cp - z1 * sp
  const z2 = y * sp + z1 * cp
  return [x1, y2, z2]
}

export function itemWorldPosition(
  phi: number, theta: number, yaw: number, pitch: number, radius = SPHERE_RADIUS,
): Vec3 {
  return rotateYawPitch(itemLocalPosition(phi, theta, radius), yaw, pitch)
}

/**
 * Focus weight of a world position: w = p.z / |p|.
 * 1 = dead centre, 0 = silhouette edge, < 0 = far side.
 */
export function focusWeight(p: Vec3): number {
  const [x, y, z] = p
  const len = Math.hypot(x, y, z)
  return len === 0 ? 0 : z / len
}

/**
 * Focus weight straight from the angles - no vectors. Derived by expanding
 * rotateYawPitch over itemLocalPosition:
 *   w = sin(phi) sin(pitch) + cos(phi) cos(pitch) cos(theta + yaw)
 */
export function analyticFocusWeight(phi: number, theta: number, yaw: number, pitch: number): number {
  return (
    Math.sin(phi) * Math.sin(pitch) +
    Math.cos(phi) * Math.cos(pitch) * Math.cos(theta + yaw)
  )
}

/** Index of the orbit whose latitude is nearest the given pitch. */
export function nearestOrbitIndex(orbits: readonly OrbitDef[], pitch: number): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < orbits.length; i++) {
    const d = Math.abs(orbits[i].latitude - pitch)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/** Item on a `count`-item orbit whose effective longitude theta + yaw is nearest 0. */
export function nearestItemIndex(count: number, yaw: number): number {
  const step = yawStep(count)
  return Math.round(mod2pi(-yaw) / step) % count
}

export interface FocusRef {
  orbitIndex: number
  itemIndex: number
}

/**
 * Argmax of focus weight across every item - "the item nearest the focus
 * point" (S2). The one scalar w decides; nothing is raycast.
 */
export function focusedItem(
  orbits: readonly OrbitDef[], yaw: number, pitch: number,
): FocusRef & { w: number } {
  let best: FocusRef & { w: number } = { orbitIndex: 0, itemIndex: 0, w: -Infinity }
  for (let oi = 0; oi < orbits.length; oi++) {
    const o = orbits[oi]
    const count = o.reports.length
    for (let ii = 0; ii < count; ii++) {
      const w = analyticFocusWeight(o.latitude, itemTheta(ii, count), yaw, pitch)
      if (w > best.w) best = { orbitIndex: oi, itemIndex: ii, w }
    }
  }
  return best
}
