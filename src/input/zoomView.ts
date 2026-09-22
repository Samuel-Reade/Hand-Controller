// Scene-side zoom model (ORB_ZOOM_SPEC section 3) - pure, so the spring-back
// and the commit hand-off run headless in tests. The active scene applies
// the bus zoom events, steps it once per frame and maps the result to camera
// distance: cameraDistance = restDistance / factor (factor > 1 -> nearer
// camera -> zoom in). The arbiter yields factor > 1 for SMALLER hands, i.e.
// hands pulled back toward you - see handArbiter. Three multiplicative parts:
//   base  - zoom kept from earlier gestures (feel.zoomPersist). Each two-hand
//           gesture starts at hand = 1 relative to its own engage size, so
//           "infinite" zoom is the PRODUCT of gestures: on release the hand
//           factor folds into base and the camera stays exactly where the
//           hands left it. With zoomPersist false, base stays 1 and the
//           original ORB_ZOOM_SPEC spring-back contract holds. The scroll
//           wheel moves base too - through `baseTarget`, which base eases
//           toward, so a wheel notch glides instead of stepping.
//   hand  - the arbiter's live factor; springs back to 1.0 once released
//           (only when not persisting)
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
  /** zoom kept from earlier gestures and the scroll wheel (1 unless feel.zoomPersist or scrolled) */
  base: number
  /** where base is easing to: equal to base except while a scroll glides */
  baseTarget: number
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

const clamp = (lo: number, hi: number, x: number) => Math.min(hi, Math.max(lo, x))

export function createZoomView(): ZoomView {
  return { base: 1, baseTarget: 1, hand: 1, live: false, carry: 1, carryFrom: 1, progress0: 1, factor: 1 }
}

/** WheelEvent.deltaMode 1 / 2 in px - unit conversions, not feel. 33 px a line puts
 *  Firefox's 3-line notch level with Chrome's 100 px one. */
const WHEEL_LINE_PX = 33
const WHEEL_PAGE_PX = 800
/** One wheel event never changes the zoom by more than x1.5 (a page-mode or
 *  ctrl + mouse-wheel event would otherwise leap). */
const MAX_SCROLL_STEP = Math.log(1.5)

/**
 * A wheel event -> the natural log of the zoom multiplier it asks for
 * (> 0 = in). Regular scroll mechanics: scrolling UP (deltaY < 0) zooms in,
 * DOWN zooms out - the sign the browser delivers, so the OS's scroll
 * direction setting applies here exactly as it does to a page. Exponential:
 * every notch is the same ratio at any zoom, and scrolling back by the same
 * amount returns exactly. A trackpad pinch arrives as a wheel event with
 * ctrlKey and small deltas; it has its own gain.
 */
export function scrollZoomLog(
  e: { deltaY: number; deltaMode: number; ctrlKey: boolean },
  feel: FeelConfig = FEEL,
): number {
  const px = e.deltaY * (e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? WHEEL_PAGE_PX : 1)
  const log = -px * (e.ctrlKey ? feel.pinchZoomGain : feel.scrollZoomGain)
  return clamp(-MAX_SCROLL_STEP, MAX_SCROLL_STEP, log)
}

/**
 * A scroll: move the zoom target by `logFactor`, clamped to the dolly range
 * so scrolling past a limit never banks zoom - the first notch back always
 * responds. base eases to it in stepZoomView.
 */
export function applyScrollZoom(v: ZoomView, logFactor: number, feel: FeelConfig = FEEL): void {
  v.baseTarget = clamp(feel.zoomMin, feel.zoomMax, v.baseTarget * Math.exp(logFactor))
}

export function applyZoomEvent(
  v: ZoomView,
  e: Extract<InputEvent, { type: 'zoom' }>,
  feel: FeelConfig = FEEL,
): void {
  if (e.phase === 'end') {
    v.live = false
    if (feel.zoomPersist) {
      // Keep what the hands did: fold the gesture into the running base
      // (clamped so base itself never leaves the dolly range) and reset the
      // hand so there is nothing left to spring.
      v.base = clamp(feel.zoomMin, feel.zoomMax, v.base * v.hand)
      v.baseTarget = clamp(feel.zoomMin, feel.zoomMax, v.baseTarget * v.hand)
      v.hand = 1
    }
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
  // The scroll glide, in log space so zooming in and out ease alike.
  if (v.base !== v.baseTarget && dt > 0) {
    const gap = Math.log(v.baseTarget / v.base)
    v.base = Math.abs(gap) < 1e-4 ? v.baseTarget : v.base * Math.exp(gap * (1 - Math.exp(-feel.scrollZoomRate * dt)))
  }
  if (!feel.zoomPersist && !v.live && v.hand !== 1 && dt > 0) {
    v.hand += (1 - v.hand) * (1 - Math.exp(-feel.springBack * dt))
    if (Math.abs(v.hand - 1) < 1e-4) v.hand = 1
  }
  v.factor = clamp(feel.zoomMin, feel.zoomMax, v.base * v.hand * v.carry)
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
