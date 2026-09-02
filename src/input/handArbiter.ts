// Two-handed arbitration (ORB_ZOOM_SPEC section 4). A pure function ABOVE
// the single-hand gesture machine decides, per camera frame, who owns the
// input:
//   two pinched hands (confirmed twoHandFrames) -> ZOOM owns it: any single-
//     hand engagement is ended cleanly (release at zero velocity - never a
//     tap, never a garbage velocity) and the machine is suppressed; depth
//     is the only thing read
//   one pinched hand -> the frame goes straight to the untouched single-
//     hand machine (flick / tap / drag exactly as today)
//   leaving zoom -> spring back; a FRESH single-hand pinch is required
//     before any flick/tap fires again (the still-pinched remaining hand
//     never re-arms a flick on the frame the other hand drops)
// gestureMachine.ts is not edited: it is called, and its state is only ever
// reset through its own exported factory. Filters + slot identity live in
// createMultiHandPipeline - the composition the camera shell and the
// synthetic harness share, the way createHandPipeline wraps stepGesture.

import { FEEL } from '../config/feel'
import type { FeelConfig } from '../config/feel'
import type { InputEvent, ZoomCommit } from './InputBus'
import { OneEuroFilter } from './OneEuroFilter'
import { createGestureState, stepGesture } from './gestureMachine'
import type { GestureState, HandFrame } from './gestureMachine'
import type { Landmark } from './landmarks'
import { MIDDLE_MCP, handPosition, handScale, pinchDistance } from './landmarks'
import { zoomRuntime } from './zoomView'

export interface ArbiterHand {
  /** Mirrored + filtered knuckle position, image-normalized. */
  pos: { x: number; y: number }
  handScale: number
  /** Filtered pinch distance / handScale. */
  pinchRatio: number
}

export interface ArbiterFrame {
  /** Tracked slots 0 and 1; null = no hand in that slot this frame. */
  hands: readonly [ArbiterHand | null, ArbiterHand | null]
  tMs: number
  /** Scene context for the commit rule (section 3). */
  level: 0 | 1
  hubFocused: boolean
}

export interface ArbiterState {
  /** the single-hand machine's own state (owned, never edited from here) */
  single: GestureState
  /** slot the single machine engaged with; -1 while idle */
  singleSlot: number
  /** per-slot pinch with the pinchClose / pinchOpen hysteresis */
  pinched: [boolean, boolean]
  /** consecutive both-pinched frames (two-hand confirmation) */
  bothFrames: number
  /** false after a zoom ends until every present hand has opened */
  armed: boolean
  zooming: boolean
  /** meanScaleAtEngage, re-latched at every commit */
  baseline: number
  factor: number
  sessionCommit: ZoomCommit
  lastCommitMs: number
  zoomMissing: number
  zoomFilter: OneEuroFilter
}

/** A hand missing this long mid-zoom ends the zoom (the single machine's LOST_FRAMES). */
const ZOOM_LOST_FRAMES = 6

export function createArbiterState(): ArbiterState {
  return {
    single: createGestureState(),
    singleSlot: -1,
    pinched: [false, false],
    bothFrames: 0,
    armed: true,
    zooming: false,
    baseline: 1,
    factor: 1,
    sessionCommit: 'none',
    lastCommitMs: -Infinity,
    zoomMissing: 0,
    zoomFilter: new OneEuroFilter(),
  }
}

const clamp = (lo: number, hi: number, x: number) => Math.min(hi, Math.max(lo, x))

function endZoom(s: ArbiterState, events: InputEvent[]): void {
  events.push({ type: 'zoom', phase: 'end', factor: s.factor, commit: s.sessionCommit })
  s.zooming = false
  s.armed = false
  s.bothFrames = 0
  s.zoomMissing = 0
  s.zoomFilter.reset()
}

/**
 * Advance the arbiter by one camera frame. Mutates `s`, returns the events
 * to put on the bus (its own zoom events plus whatever the single-hand
 * machine emitted for the frame it was handed).
 */
export function stepArbiter(
  s: ArbiterState,
  frame: ArbiterFrame,
  feel: FeelConfig = FEEL,
): InputEvent[] {
  const events: InputEvent[] = []
  const { hands, tMs } = frame
  const tS = tMs / 1000
  const zoomParams = { minCutoff: feel.zoomCutoff, beta: feel.zoomBeta }

  // Per-slot pinch state with hysteresis. A missing hand is not pinched.
  let presentCount = 0
  let pinchedCount = 0
  for (let i = 0; i < 2; i++) {
    const h = hands[i]
    if (!h) {
      s.pinched[i] = false
      continue
    }
    presentCount++
    if (h.pinchRatio < feel.pinchClose) s.pinched[i] = true
    else if (h.pinchRatio > feel.pinchOpen) s.pinched[i] = false
    if (s.pinched[i]) pinchedCount++
  }

  if (s.zooming) {
    const a = hands[0]
    const b = hands[1]
    const opened = (a !== null && !s.pinched[0]) || (b !== null && !s.pinched[1])
    if (opened) {
      endZoom(s, events)
    } else if (!a || !b) {
      // A hand dropped out of tracking: hold the factor briefly, then end.
      s.zoomMissing++
      if (s.zoomMissing > ZOOM_LOST_FRAMES) endZoom(s, events)
    } else {
      s.zoomMissing = 0
      // Zoom driver (section 2): ratio of the MEAN apparent size to its value
      // at engage, symmetric in log space, on its own filter channel.
      const meanScale = (a.handScale + b.handScale) / 2
      const ratio = meanScale / s.baseline
      const raw = clamp(feel.zoomMin, feel.zoomMax, ratio ** feel.zoomGain)
      s.factor = s.zoomFilter.filter(raw, tS, zoomParams)
      events.push({ type: 'zoom', phase: 'update', factor: s.factor, commit: s.sessionCommit })

      // Commit (section 3): thresholds fire the existing drill transition;
      // the ends clamp (no report-open on zoom-in at level 1, no under-drill).
      if (feel.zoomCommitsDrill && tMs - s.lastCommitMs >= feel.commitCooldownMs) {
        let dir: 'in' | 'out' | null = null
        if (frame.level === 0 && s.factor >= feel.zoomInCommit && frame.hubFocused) dir = 'in'
        else if (frame.level === 1 && s.factor <= feel.zoomOutCommit) dir = 'out'
        if (dir) {
          events.push({ type: 'zoomCommit', dir })
          s.baseline = meanScale // re-latch: zoom recenters to 1.0 at the new level
          s.lastCommitMs = tMs
          s.sessionCommit = dir
          s.zoomFilter.reset()
          s.factor = s.zoomFilter.filter(1, tS, zoomParams)
        }
      }
    }
  } else {
    // Two-hand confirmation: both present, both pinched, twoHandFrames in a row.
    if (presentCount === 2 && pinchedCount === 2) s.bothFrames++
    else s.bothFrames = 0
    if (s.bothFrames >= feel.twoHandFrames) {
      // Take the input away from the single-hand machine cleanly.
      if (s.single.phase === 'engaged') events.push({ type: 'release', vYaw: 0, vPitch: 0 })
      Object.assign(s.single, createGestureState())
      s.singleSlot = -1
      s.zooming = true
      s.bothFrames = 0
      s.zoomMissing = 0
      s.baseline = (hands[0]!.handScale + hands[1]!.handScale) / 2
      s.sessionCommit = 'none'
      s.lastCommitMs = -Infinity
      s.zoomFilter.reset()
      s.factor = s.zoomFilter.filter(1, tS, zoomParams)
      events.push({ type: 'zoom', phase: 'engage', factor: s.factor, commit: 'none' })
    }
  }

  // Re-arm the single-hand machine only once every present hand has opened.
  if (!s.armed && pinchedCount === 0) s.armed = true

  // Route ONE hand (or nothing) to the untouched single-hand machine.
  let feed: HandFrame = { present: false, tMs }
  let feedSlot = -1
  if (!s.zooming && s.armed) {
    if (s.single.phase === 'engaged') feedSlot = s.singleSlot
    else if (pinchedCount === 2) feedSlot = -1 // both pinched, not yet confirmed: hold
    else if (pinchedCount === 1) feedSlot = s.pinched[0] ? 0 : 1
    else feedSlot = hands[0] ? 0 : hands[1] ? 1 : -1
    const h = feedSlot >= 0 ? hands[feedSlot] : null
    if (h) feed = { present: true, pos: h.pos, handScale: h.handScale, pinchRatio: h.pinchRatio, tMs }
  }
  const wasIdle = s.single.phase === 'idle'
  const singleEvents = stepGesture(s.single, feed, feel)
  if (wasIdle && s.single.phase === 'engaged') s.singleSlot = feedSlot
  if (s.single.phase === 'idle') s.singleSlot = -1
  for (const e of singleEvents) events.push(e)

  return events
}

// ---------------------------------------------------------------------------
// The full pure pipeline for up to two hands: raw landmark sets -> slot
// identity (nearest-knuckle matching, so filters and pinch hysteresis follow
// the same physical hand frame to frame; handedness labels are never used -
// they flip under the mirror) -> per-slot mirror / One Euro (x, y, pinch)
// -> arbiter -> single-hand machine. With one hand present the per-slot
// numbers are exactly createHandPipeline's, so the one-hand paths are
// byte-identical to the base build (asserted in tests/zoom.test.ts).

export interface MultiHandPipeline {
  state: ArbiterState
  process(
    hands: readonly (readonly Landmark[])[] | null,
    tMs: number,
    ctx?: { level: 0 | 1; hubFocused: boolean },
  ): InputEvent[]
  /** Pinch state of the i-th detected hand of the last frame (for the HUD). */
  pinchedOf(detectedIndex: number): boolean
  /**
   * Close out anything in flight (panel opened, camera stopped, harness
   * loop). Returns the events that end it cleanly - `lost` for a single-hand
   * engagement, a zoom `end` for a zoom - never a fling.
   */
  reset(): InputEvent[]
}

interface Slot {
  active: boolean
  missing: number
  last: { x: number; y: number }
  fx: OneEuroFilter
  fy: OneEuroFilter
  fPinch: OneEuroFilter
}

const SLOT_LOST_FRAMES = 6

function makeSlot(): Slot {
  return {
    active: false,
    missing: 0,
    last: { x: 0, y: 0 },
    fx: new OneEuroFilter(),
    fy: new OneEuroFilter(),
    fPinch: new OneEuroFilter(),
  }
}

/** Detected-hand index -> slot index, by nearest last-known knuckle. */
function matchSlots(slots: readonly [Slot, Slot], pts: { x: number; y: number }[]): number[] {
  const d = (s: Slot, p: { x: number; y: number }) => Math.hypot(s.last.x - p.x, s.last.y - p.y)
  const active = [0, 1].filter((i) => slots[i].active)
  if (pts.length === 0) return []
  if (pts.length === 1) {
    if (active.length === 0) return [0]
    if (active.length === 1) return [active[0]]
    return [d(slots[0], pts[0]) <= d(slots[1], pts[0]) ? 0 : 1]
  }
  if (active.length === 0) return [0, 1]
  if (active.length === 1) {
    const a = active[0]
    const firstIsA = d(slots[a], pts[0]) <= d(slots[a], pts[1])
    return firstIsA ? (a === 0 ? [0, 1] : [1, 0]) : (a === 0 ? [1, 0] : [0, 1])
  }
  const straight = d(slots[0], pts[0]) + d(slots[1], pts[1])
  const crossed = d(slots[0], pts[1]) + d(slots[1], pts[0])
  return straight <= crossed ? [0, 1] : [1, 0]
}

export function createMultiHandPipeline(feel: FeelConfig = FEEL): MultiHandPipeline {
  const slots: [Slot, Slot] = [makeSlot(), makeSlot()]
  const state = createArbiterState()
  let assignment: number[] = []

  const publish = (count: number) => {
    zoomRuntime.handCount = count
    zoomRuntime.present[0] = slots[0].missing === 0 && slots[0].active
    zoomRuntime.present[1] = slots[1].missing === 0 && slots[1].active
    zoomRuntime.pinched[0] = state.pinched[0]
    zoomRuntime.pinched[1] = state.pinched[1]
    zoomRuntime.zooming = state.zooming
    zoomRuntime.factor = state.zooming ? state.factor : 1
  }

  return {
    state,
    process(hands, tMs, ctx) {
      const det = (hands ?? [])
        .filter((lm) => lm.length >= 21 && handScale(lm) >= 1e-6)
        .slice(0, 2)
      assignment = matchSlots(
        slots,
        det.map((lm) => ({ x: lm[MIDDLE_MCP].x, y: lm[MIDDLE_MCP].y })),
      )
      const out: [ArbiterHand | null, ArbiterHand | null] = [null, null]
      const tS = tMs / 1000
      const posParams = { minCutoff: feel.minCutoff, beta: feel.beta }
      const pinchParams = { minCutoff: feel.pinchCutoff, beta: feel.beta }
      const used = [false, false]
      det.forEach((lm, i) => {
        const si = assignment[i]
        const slot = slots[si]
        const scale = handScale(lm)
        const raw = handPosition(lm)
        const pos = {
          x: slot.fx.filter(raw.x, tS, posParams),
          y: slot.fy.filter(raw.y, tS, posParams),
        }
        const pinch = slot.fPinch.filter(pinchDistance(lm), tS, pinchParams)
        out[si] = { pos, handScale: scale, pinchRatio: pinch / scale }
        slot.active = true
        slot.missing = 0
        slot.last = { x: lm[MIDDLE_MCP].x, y: lm[MIDDLE_MCP].y }
        used[si] = true
      })
      for (let i = 0; i < 2; i++) {
        if (used[i] || !slots[i].active) continue
        slots[i].missing++
        if (slots[i].missing > SLOT_LOST_FRAMES) slots[i].active = false
      }
      const events = stepArbiter(
        state,
        {
          hands: out,
          tMs,
          level: ctx?.level ?? zoomRuntime.level,
          hubFocused: ctx?.hubFocused ?? zoomRuntime.hubFocused,
        },
        feel,
      )
      publish(det.length)
      return events
    },
    pinchedOf(i) {
      const si = assignment[i]
      return si === undefined ? false : state.pinched[si]
    },
    reset() {
      const events: InputEvent[] = []
      if (state.single.phase === 'engaged') events.push({ type: 'lost' })
      if (state.zooming) {
        events.push({ type: 'zoom', phase: 'end', factor: state.factor, commit: state.sessionCommit })
      }
      for (const slot of slots) {
        slot.fx.reset()
        slot.fy.reset()
        slot.fPinch.reset()
        slot.active = false
        slot.missing = 0
      }
      Object.assign(state, createArbiterState())
      assignment = []
      publish(0)
      return events
    },
  }
}
