// Click-to-centre (docs/DECISIONS.md): the point of the constellation that
// sits on the camera axis. Pure math, no three.js - tests/centering.test.ts.
//
// The scene already has ONE mechanism that moves the field so a node sits at
// screen centre: the drill-in recenter, which translates the offset group by
// -rotate(hubLocal) so the drilled hub lands at the world origin (and, since
// the offset is re-derived from the live rotation every frame, stays pinned
// there while the field rotates about it). Click-to-centre generalises that
// pin to any node WITHOUT touching the drill: the centre target below is a
// point in constellation-local space, blended over select.recenterDuration,
// and the drill composes on top of it - pinPoint(). With the centre at the
// origin every offset is byte-identical to before.
//
// Orbit radius: a node's rotation is about ITSELF (the pin), but from the
// rest distance the whole field - brain included - swings round it on a
// wide arc, which reads as a large-radius orbit. Centring a node therefore
// also brings the camera in by select.centerPush (the drill's own push
// pattern), so the node's neighbourhood is the subject and rotating is
// orbiting it. The push weight blends on the same clock as the position:
// 0 at the origin (home), 1 on a node.

import type { Vec3 } from '../orb/geometry'

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export interface CenterState {
  /** node holding the centre, for telemetry; null = the field's own origin */
  name: string | null
  /** constellation-local point the blend starts from */
  from: Vec3
  /** constellation-local point the blend ends at */
  to: Vec3
  /** blend 0 (at `from`) -> 1 (at `to`) */
  k: number
  /** camera push weight at `from` / `to`: 0 for the origin, 1 for a node */
  wFrom: number
  wTo: number
}

export function createCenterState(): CenterState {
  return { name: null, from: [0, 0, 0], to: [0, 0, 0], k: 1, wFrom: 0, wTo: 0 }
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** Where the centre is right now (eased blend), constellation-local. */
export function currentCenter(s: CenterState): Vec3 {
  return lerp3(s.from, s.to, easeInOutCubic(s.k))
}

/** The camera push weight right now, 0..1 - multiply by select.centerPush. */
export function currentPushWeight(s: CenterState): number {
  const t = easeInOutCubic(s.k)
  return s.wFrom + (s.wTo - s.wFrom) * t
}

/**
 * Fly the centre to `target`. Starts from wherever the centre IS - a click
 * mid-flight retargets without a jump. Returns a new state.
 */
export function setCenterTarget(s: CenterState, name: string | null, target: Vec3): CenterState {
  if (s.name === name && s.k >= 1 && s.to[0] === target[0] && s.to[1] === target[1] && s.to[2] === target[2]) return s
  return {
    name,
    from: currentCenter(s),
    to: [target[0], target[1], target[2]],
    k: 0,
    wFrom: currentPushWeight(s),
    wTo: name === null ? 0 : 1,
  }
}

/** Advance the blend by `delta` seconds over `durationSec`. */
export function stepCenter(s: CenterState, delta: number, durationSec: number): CenterState {
  if (s.k >= 1) return s
  const k = Math.min(1, s.k + delta / Math.max(0.05, durationSec))
  return { ...s, k }
}

/** Shared runtime for the selection marker overlay (pointRuntime pattern). */
export const centerRuntime = {
  /** the selected (centred) node, or null */
  name: null as string | null,
  /** its projected px offset from screen centre - tracks the flight */
  x: 0,
  y: 0,
  /** its projected disc radius in px, for the marker's stand-off */
  r: 0,
  /** its body colour */
  hue: '#C9A227',
  /** blend progress 0..1 */
  k: 1,
}

/** Shared runtime for the cursor hover ring (mouse only, violet = control). */
export const hoverRuntime = {
  /** the node (or level-1 shell report id) under the cursor, or null */
  name: null as string | null,
  /** its projected px offset from screen centre */
  x: 0,
  y: 0,
  /** its visible radius in px - the ring stands just outside it */
  r: 0,
}

/**
 * The point the offset group pins to the origin: the centre while at level
 * 0, the drilled hub once drilled, blended by the drill's own recenter k.
 * kDrill 0 -> the centre exactly; kDrill 1 -> the hub exactly.
 */
export function pinPoint(center: Vec3, hubLocal: Vec3 | null, kDrill: number): Vec3 {
  if (!hubLocal) return center
  return lerp3(center, hubLocal, kDrill)
}
