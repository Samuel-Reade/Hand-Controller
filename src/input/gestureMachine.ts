// Pure gesture state machine (S9): frames in, InputEvents out. Plus the
// pipeline composition (filters + machine) shared verbatim by the synthetic
// harness tests and the live camera shell - the tests test the real thing.

import { FEEL } from '../config/feel'
import type { FeelConfig } from '../config/feel'
import type { InputEvent } from './InputBus'
import { OneEuroFilter } from './OneEuroFilter'
import type { Landmark } from './landmarks'
import { handPosition, handScale, pinchDistance } from './landmarks'

export interface HandFrame {
  present: boolean
  /** Mirrored + filtered knuckle position, image-normalized. */
  pos?: { x: number; y: number }
  handScale?: number
  /** Filtered pinch distance / handScale. */
  pinchRatio?: number
  tMs: number
}

export interface GestureState {
  phase: 'idle' | 'engaged'
  closeFrames: number
  openFrames: number
  missingFrames: number
  engagedAtMs: number
  travel: number
  last: { x: number; y: number } | null
  lastTMs: number
  velBuf: { vx: number; vy: number }[] // normalized units/s, trailing ~3 frames
}

const ENGAGE_FRAMES = 2 // consecutive closed frames to engage
const RELEASE_FRAMES = 2 // consecutive open frames to release
const LOST_FRAMES = 6 // missing frames before a mid-gesture drop is `lost`
const VEL_BUF_LEN = 3

export function createGestureState(): GestureState {
  return {
    phase: 'idle',
    closeFrames: 0,
    openFrames: 0,
    missingFrames: 0,
    engagedAtMs: 0,
    travel: 0,
    last: null,
    lastTMs: 0,
    velBuf: [],
  }
}

function endEngagement(s: GestureState): void {
  s.phase = 'idle'
  s.closeFrames = 0
  s.openFrames = 0
  s.missingFrames = 0
  s.travel = 0
  s.last = null
  s.velBuf = []
}

/**
 * Advance the machine by one camera frame. Mutates `state`, returns the
 * events to put on the bus.
 *
 * IDLE:    pinchRatio < pinchClose for 2 consecutive frames -> ENGAGED
 * ENGAGED: per-frame delta = (pos - last) / handScale; |delta| > deadZone
 *          -> move(delta * handGain). pinchRatio > pinchOpen for 2 frames ->
 *          tap (quick + still) or release (trailing velocity). Hand missing
 *          > 6 frames -> lost.
 * The hysteresis gap between pinchClose and pinchOpen stops flicker at the
 * threshold - never collapse them to one value.
 */
export function stepGesture(
  s: GestureState,
  frame: HandFrame,
  feel: FeelConfig = FEEL,
): InputEvent[] {
  const events: InputEvent[] = []

  if (!frame.present) {
    if (s.phase === 'engaged') {
      s.missingFrames++
      if (s.missingFrames > LOST_FRAMES) {
        endEngagement(s)
        events.push({ type: 'lost' })
      }
    } else {
      s.closeFrames = 0
    }
    return events
  }

  const pos = frame.pos
  const scale = frame.handScale
  const ratio = frame.pinchRatio
  if (!pos || scale === undefined || scale < 1e-6 || ratio === undefined) return events
  s.missingFrames = 0

  if (s.phase === 'idle') {
    if (ratio < feel.pinchClose) s.closeFrames++
    else s.closeFrames = 0
    if (s.closeFrames >= ENGAGE_FRAMES) {
      s.phase = 'engaged'
      s.closeFrames = 0
      s.openFrames = 0
      s.engagedAtMs = frame.tMs
      s.travel = 0
      s.last = { ...pos }
      s.lastTMs = frame.tMs
      s.velBuf = []
      events.push({ type: 'engage' })
    }
    return events
  }

  // ENGAGED
  const last = s.last ?? pos
  const dt = (frame.tMs - s.lastTMs) / 1000
  const dx = (pos.x - last.x) / scale
  const dy = (pos.y - last.y) / scale
  const mag = Math.hypot(dx, dy)
  if (dt > 0) {
    s.velBuf.push({ vx: dx / dt, vy: dy / dt })
    if (s.velBuf.length > VEL_BUF_LEN) s.velBuf.shift()
  }
  if (mag > feel.deadZone) {
    events.push({ type: 'move', dYaw: dx * feel.handGain, dPitch: dy * feel.handGain })
    s.travel += mag
  }
  s.last = { ...pos }
  s.lastTMs = frame.tMs

  if (ratio > feel.pinchOpen) s.openFrames++
  else s.openFrames = 0
  if (s.openFrames >= RELEASE_FRAMES) {
    const elapsed = frame.tMs - s.engagedAtMs
    const travel = s.travel
    const buf = s.velBuf
    endEngagement(s)
    if (elapsed < feel.tapMaxMs && travel < feel.tapMaxTravel) {
      events.push({ type: 'tap' })
    } else {
      let vx = 0
      let vy = 0
      for (const v of buf) {
        vx += v.vx
        vy += v.vy
      }
      const n = Math.max(1, buf.length)
      events.push({
        type: 'release',
        vYaw: (vx / n) * feel.handGain,
        vPitch: (vy / n) * feel.handGain,
      })
    }
  }
  return events
}

/**
 * The full pure pipeline: raw landmarks -> mirror -> scale-normalize ->
 * One Euro (x, y of the knuckle, and pinch distance) -> gesture machine.
 * The camera shell and the synthetic harness both drive this.
 */
export interface HandPipeline {
  state: GestureState
  process(landmarks: readonly Landmark[] | null, tMs: number): InputEvent[]
  reset(): void
}

export function createHandPipeline(feel: FeelConfig = FEEL): HandPipeline {
  const fx = new OneEuroFilter()
  const fy = new OneEuroFilter()
  const fPinch = new OneEuroFilter()
  const state = createGestureState()

  return {
    state,
    process(landmarks, tMs) {
      if (!landmarks || landmarks.length < 21) {
        return stepGesture(state, { present: false, tMs }, feel)
      }
      const scale = handScale(landmarks)
      if (scale < 1e-6) return stepGesture(state, { present: false, tMs }, feel)
      const tS = tMs / 1000
      const params = { minCutoff: feel.minCutoff, beta: feel.beta }
      const raw = handPosition(landmarks)
      const pos = {
        x: fx.filter(raw.x, tS, params),
        y: fy.filter(raw.y, tS, params),
      }
      const pinch = fPinch.filter(pinchDistance(landmarks), tS, {
        minCutoff: feel.pinchCutoff,
        beta: feel.beta,
      })
      return stepGesture(
        state,
        { present: true, pos, handScale: scale, pinchRatio: pinch / scale, tMs },
        feel,
      )
    },
    reset() {
      fx.reset()
      fy.reset()
      fPinch.reset()
      Object.assign(state, createGestureState())
    },
  }
}
