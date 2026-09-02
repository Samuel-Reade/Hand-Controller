// Scene-side zoom model (ORB_ZOOM_SPEC section 3) - pure, so the spring-back
// and the commit hand-off run headless in tests. The active scene applies
// the bus zoom events, steps it once per frame and maps the result to camera
// distance: cameraDistance = restDistance / factor (bigger hands -> factor
// > 1 -> nearer camera -> zoom in). Two multiplicative parts:
//   hand  - the arbiter's live factor; springs back to 1.0 once released
//   carry - commit hand-off: the arbiter re-latches to 1.0 at a commit, so
//           the pre-commit factor is carried and eased out ALONGSIDE the P5
//           recenter animation - the camera never jumps at the drill
// Also home to zoomRuntime, the one mutable object the HUD / telemetry read
// and the pipeline + scene write each frame (same pattern as orbRuntime;
// the frozen useOrbPhysics.ts cannot grow new fields).

import { FEEL } from '../config/feel'
import type { FeelConfig } from '../config/feel'
import type { InputEvent } from './InputBus'

export interface ZoomView {
  /** the arbiter's factor (last received while live, springing after) */
  hand: number
  /** a two-hand zoom is in progress */
  live: boolean
  /** commit hand-off multiplier, eased from carryFrom to 1 */
  carry: number
  carryFrom: number
  /** transition progress at the moment of commit */
  progress0: number
  /** displayed factor - what the camera uses */
  factor: number
}

export function createZoomView(): ZoomView {
  return { hand: 1, live: false, carry: 1, carryFrom: 1, progress0: 1, factor: 1 }
}

export function applyZoomEvent(v: ZoomView, e: Extract<InputEvent, { type: 'zoom' }>): void {
  if (e.phase === 'end') {
    v.live = false
  } else {
    v.live = true
    v.hand = e.factor
  }
}

/**
 * The scene calls this right after it has started the drill transition for
 * a zoomCommit, passing the transition's current eased progress (0 at a
 * fresh start; > 0 when a commit reverses a transition already in flight).
 * The arbiter has just re-latched to 1.0, so the pre-commit factor is
 * carried and eased out with the recenter - no jump.
 */
export function commitZoomView(v: ZoomView, progressNow: number): void {
  v.carryFrom = v.factor
  v.carry = v.factor
  v.progress0 = progressNow
  v.hand = 1
}

const clamp = (lo: number, hi: number, x: number) => Math.min(hi, Math.max(lo, x))

/**
 * One frame. `progress` is the eased 0..1 progress of the active scene's
 * drill transition (1 when none is in flight). Returns the displayed factor,
 * always inside [zoomMin, zoomMax].
 */
export function stepZoomView(
  v: ZoomView,
  dt: number,
  progress: number,
  feel: FeelConfig = FEEL,
): number {
  if (v.carry !== 1) {
    const span = 1 - v.progress0
    const t = span <= 1e-6 ? 1 : clamp(0, 1, (progress - v.progress0) / span)
    v.carry = t >= 1 ? 1 : v.carryFrom + (1 - v.carryFrom) * t
  }
  if (!v.live && v.hand !== 1 && dt > 0) {
    v.hand += (1 - v.hand) * (1 - Math.exp(-feel.springBack * dt))
    if (Math.abs(v.hand - 1) < 1e-4) v.hand = 1
  }
  v.factor = clamp(feel.zoomMin, feel.zoomMax, v.hand * v.carry)
  return v.factor
}

/** Shared runtime for the HUD + telemetry + the arbiter's scene context. */
export const zoomRuntime = {
  // written by the multi-hand pipeline each processed frame
  handCount: 0,
  present: [false, false] as [boolean, boolean],
  pinched: [false, false] as [boolean, boolean],
  zooming: false,
  factor: 1, // arbiter live factor (1 when not zooming)
  // written by the active scene each rendered frame
  displayed: 1, // camera factor after spring-back / carry
  level: 0 as 0 | 1, // the level the scene is at or heading to
  hubFocused: false, // a hub holds the reticle (level-0 commit precondition)
}
