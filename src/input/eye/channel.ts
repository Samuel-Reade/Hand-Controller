// The gaze channel (ORB_EYE_SPEC §3 regionGate/torque, §5 state machine +
// arbitration). Pure: fed FaceFrames (or null = no face) at detector rate
// plus the bus events it must yield to, it returns the bus events it emits.
// No MediaPipe, no DOM, no store - the camera shell and the synthetic
// harness both drive it, and tests/eye.test.ts runs it headless.
//
// Route A: gaze STEERS. Sustained gaze outside the dead zone becomes a
// weak torque that brings that region of the field toward the fixed sight.
// It never points, never confirms, never flings.
//
// How the torque reaches the frozen integrator: the physics applies `move`
// only while ENGAGED, so the channel opens its own engagement (`engage`,
// tagged source:'gaze'), streams `move` while attending, and ends it with
// `lost` (freeze: velocities zeroed, no coast) - never `release`, which
// carries a throw velocity gaze has no right to. If a hand engages while
// gaze holds the floor, the hand simply takes the engagement over; gaze
// stops emitting and does not `lost` it out from under the hand.

import type { InputEvent } from '../InputBus'
import { OneEuroFilter } from '../OneEuroFilter'
import type { EyeConfig } from './config'
import {
  FEATURE_KEYS,
  blendshapeGaze,
  confidence as confidenceOf,
  gazeFeatures,
  headPose,
  irisAgreementScale,
  irisOffset,
  screenPointFrom,
} from './face'
import type { Calibration, FaceFrame, FeatureKey, GazeFeatures } from './face'
import { createFixation, stepFixation } from './fixation'

export type EyeState = 'off' | 'idle' | 'attending' | 'suspended' | 'holding' | 'decaying'

/** What the channel needs to know about the world each frame. */
export interface EyeContext {
  viewport: { w: number; h: number }
  /** the camera is on (or the synthetic harness stands in for it) */
  cameraOn: boolean
  reducedMotion: boolean
  shellOpen: boolean
  /** ms since the last pointer event; Infinity if none */
  pointerIdleMs: number
}

/** Per-frame telemetry (the pointRuntime pattern) - §6 EyeTelemetry plus the gate's output. */
export interface EyeTelemetry {
  state: EyeState
  facePresent: boolean
  confidence: number
  headOnly: boolean
  yaw: number
  pitch: number
  gazeX: number
  gazeY: number
  norm: number
  irisOkL: boolean
  irisOkR: boolean
  blinkL: number
  blinkR: number
  filterCutoffHz: number
  calibrated: boolean
  detectMs: number
  /** the gate's current torque direction (screen frame, unit) and magnitude 0..1 */
  dirX: number
  dirY: number
  mag: number
  /** head pose source for the debug label */
  headSource: 'transform' | 'landmarks' | '-'
  /** the FILTERED features the point was made from - what calibration samples */
  features: GazeFeatures
  /** the RAW (unfiltered) features of this frame */
  rawFeatures: GazeFeatures
  /** the map in use */
  calibratedPoints: number
  calibrationResidualPx: number
  /** diagnostics (ideas §1): the unfiltered point, and the head-only point */
  rawX: number
  rawY: number
  headX: number
  headY: number
  /** iris ok rate over the last second, per eye */
  okRateL: number
  okRateR: number
  /** an eye dropped by the vergence check this frame */
  vergenceDrop: 'L' | 'R' | null
  /** the speed-gated freeze holds the point */
  frozen: boolean
  /** detections per second, measured */
  detectHz: number
  /** the wide model is in use */
  wideModel: boolean
  /** frames in the current fixation (1 = a fresh saccade) and its window */
  fixationN: number
  fixationWindowMs: number
}

/** One raw frame for the dev recorder (ideas §1.6) - what a replay needs. */
export interface EyeRecordFrame {
  t: number
  raw: GazeFeatures
  blinkL: number
  blinkR: number
  okL: boolean
  okR: boolean
  confidence: number
  headOk: boolean
}

export function createEyeTelemetry(): EyeTelemetry {
  return {
    state: 'off', facePresent: false, confidence: 0, headOnly: false,
    yaw: 0, pitch: 0, gazeX: 0, gazeY: 0, norm: 0,
    irisOkL: false, irisOkR: false, blinkL: 0, blinkR: 0,
    filterCutoffHz: 0, calibrated: false, detectMs: 0,
    dirX: 0, dirY: 0, mag: 0, headSource: '-',
    features: zeroFeatures(),
    rawFeatures: zeroFeatures(),
    calibratedPoints: 0, calibrationResidualPx: 0,
    rawX: 0, rawY: 0, headX: 0, headY: 0,
    okRateL: 0, okRateR: 0, vergenceDrop: null, frozen: false, detectHz: 0, wideModel: false,
    fixationN: 0, fixationWindowMs: 0,
  }
}

export function zeroFeatures(): GazeFeatures {
  const f = { ok: false } as GazeFeatures
  for (const k of FEATURE_KEYS) f[k] = 0
  return f
}

/** Median of the last three values per feature (ideas 2.3): kills single-frame landmark spikes. */
class Median3 {
  private a: number[] = []
  push(v: number): number {
    this.a.push(v)
    if (this.a.length > 3) this.a.shift()
    if (this.a.length < 3) return v
    const [p, q, r] = this.a
    return Math.max(Math.min(p, q), Math.min(Math.max(p, q), r))
  }
  reset(): void {
    this.a = []
  }
}

/** Shared runtime read by the HUD indicator, the debug overlay and leva monitors. */
export const eyeRuntime: EyeTelemetry = createEyeTelemetry()

const DEG2RAD = Math.PI / 180
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export interface EyeChannel {
  readonly state: EyeState
  readonly telemetry: EyeTelemetry
  enabled: boolean
  /** the per-user map, or null for the default (calibration.ts) */
  calibration: Calibration | null
  /** One detector frame (null = no face this frame). Returns the bus events to emit. */
  process(frame: FaceFrame | null, nowMs: number, ctx: EyeContext): InputEvent[]
  /** Every bus event the channel did not emit itself - the arbitration input. */
  onBus(e: InputEvent, nowMs: number): void
  /** Camera off / disable: drop everything. Returns the events that end a held engagement. */
  reset(): InputEvent[]
  /** dev recorder sink: called with every raw frame while set */
  record: ((frame: EyeRecordFrame) => void) | null
}

export function createEyeChannel(cfg: EyeConfig, telemetry: EyeTelemetry = createEyeTelemetry()): EyeChannel {
  let state: EyeState = 'off'
  /** the state to return to when a hold ends with the face back */
  let heldFrom: 'idle' | 'attending' = 'idle'
  let holdingSince = 0
  let decayingSince = 0
  /** gate timers: when norm first went outside / inside continuously; null = not currently */
  let outsideSince: number | null = null
  let insideSince: number | null = null
  /** gaze currently holds the physics engagement */
  let holdsEngagement = false
  /** suspended until (hand release / tap / pointer): ms */
  let suspendedUntil = 0
  /** a hand engagement is in progress (engage seen, no release/lost/tap yet) */
  let handEngaged = false
  /** the last torque output, held through `holding`, decayed through `decaying` */
  let lastDir = { x: 0, y: 0 }
  let lastMag = 0
  let facePresent = false
  let lastT = 0
  /** one One Euro + one median-of-3 per feature */
  const filters = new Map<FeatureKey, OneEuroFilter>()
  const medians = new Map<FeatureKey, Median3>()
  for (const k of FEATURE_KEYS) {
    filters.set(k, new OneEuroFilter())
    medians.set(k, new Median3())
  }
  const resetFilters = () => {
    for (const f of filters.values()) f.reset()
    for (const m of medians.values()) m.reset()
  }
  /** iris ok flags over the last second, per eye, for the head-only fallback + the ok-rate readout */
  const okHistory: { t: number; okL: number; okR: number }[] = []
  /** the last features with at least one eye open (blink freeze) */
  let lastRaw: GazeFeatures | null = null
  /** frames left to reject after a blink ends (the iris snaps on reopen) */
  let postBlink = 0
  let wasBlinking = false
  /** fixation averaging ahead of the freeze */
  let fixation = createFixation()
  /** speed-gated freeze state */
  let frozen = false
  let slowSince: number | null = null
  let lastPt: { x: number; y: number; t: number } | null = null
  let heldPt: { x: number; y: number } | null = null
  /** detection rate */
  const detectTimes: number[] = []

  const setState = (s: EyeState) => {
    state = s
    telemetry.state = s
  }

  const endEngagement = (out: InputEvent[]) => {
    if (holdsEngagement) {
      out.push({ type: 'lost', source: 'gaze' })
      holdsEngagement = false
    }
  }

  const resetGate = () => {
    outsideSince = null
    insideSince = null
    lastDir = { x: 0, y: 0 }
    lastMag = 0
    telemetry.dirX = 0
    telemetry.dirY = 0
    telemetry.mag = 0
  }

  const goOff = (out: InputEvent[]) => {
    endEngagement(out)
    resetGate()
    facePresent = false
    resetFilters()
    okHistory.length = 0
    lastRaw = null
    postBlink = 0
    wasBlinking = false
    frozen = false
    slowSince = null
    lastPt = null
    heldPt = null
    fixation = createFixation()
    setState('off')
  }

  const channel: EyeChannel = {
    get state() { return state },
    telemetry,
    enabled: cfg.enabled,
    calibration: null,
    record: null,

    onBus(e, nowMs) {
      if ('source' in e && e.source === 'gaze') return
      switch (e.type) {
        case 'engage':
        case 'zoom':
          // The hand took the floor. If gaze held the engagement the hand's
          // engage has replaced it - do not `lost` it out from under them.
          handEngaged = e.type === 'engage' ? true : handEngaged
          holdsEngagement = false
          if (state === 'attending' || state === 'idle' || state === 'holding' || state === 'decaying') {
            resetGate()
            setState('suspended')
          }
          suspendedUntil = Infinity
          break
        case 'release':
        case 'lost':
        case 'tap':
        case 'home': // Escape: "stop" - also stops a drift (§7)
          handEngaged = false
          holdsEngagement = false
          suspendedUntil = nowMs + cfg.resumeMs
          if (state === 'attending' || state === 'idle' || state === 'holding' || state === 'decaying') {
            resetGate()
            setState('suspended')
          }
          break
        default:
          break
      }
    },

    process(frame, nowMs, ctx) {
      const out: InputEvent[] = []
      const dt = lastT > 0 ? Math.min(0.1, Math.max(0, (nowMs - lastT) / 1000)) : 1 / 30
      lastT = nowMs

      // ── any -> off ────────────────────────────────────────────────────
      const live = channel.enabled && ctx.cameraOn
      if (!live) {
        if (state !== 'off') goOff(out)
        telemetry.facePresent = false
        telemetry.confidence = 0
        return out
      }
      if (state === 'off') setState('idle')

      // ── telemetry from the frame (always, even when reduced-motion) ──
      let conf = 0
      let norm = 0
      let normRaw = 0
      let dir = { x: 0, y: 0 }
      if (frame) {
        detectTimes.push(nowMs)
        while (detectTimes.length && detectTimes[0] < nowMs - 1000) detectTimes.shift()
        telemetry.detectHz = detectTimes.length
        const head = headPose(frame, cfg)
        const blend = blendshapeGaze(frame.blendshapes)
        const iris = irisOffset(frame, cfg, head, blend)
        okHistory.push({ t: nowMs, okL: iris.okL ? 1 : 0, okR: iris.okR ? 1 : 0 })
        while (okHistory.length && okHistory[0].t < nowMs - 1000) okHistory.shift()
        const okRateL = okHistory.reduce((a, h) => a + h.okL, 0) / Math.max(1, okHistory.length)
        const okRateR = okHistory.reduce((a, h) => a + h.okR, 0) / Math.max(1, okHistory.length)
        const okRate = (okRateL + okRateR) / 2
        const headOnly = okRate < cfg.irisOkRateMin
        const scale = headOnly ? 0 : cfg.blendCheck ? irisAgreementScale(iris, blend) : 1
        // Blink freeze: with BOTH eyes shut the iris cannot be placed and
        // the eyeLook* blendshapes swing (the lids drag them "down"); hold
        // the last features instead of letting a blink yank the point. The
        // iris is rejected early on the way down (blinkIrisThreshold) and
        // for postBlinkFrames after the eyes reopen (it snaps back).
        const blinking = !iris.okL && !iris.okR
        if (wasBlinking && !blinking) postBlink = cfg.postBlinkFrames
        else if (!blinking && postBlink > 0) postBlink--
        wasBlinking = blinking
        const hold = cfg.blinkFreeze && (blinking || postBlink > 0) && lastRaw !== null
        const raw = hold ? lastRaw! : gazeFeatures(head, iris, blend, cfg, scale)
        if (!hold) lastRaw = raw
        conf = confidenceOf(frame, head, iris)
        channel.record?.({
          t: nowMs, raw, blinkL: frame.blendshapes.eyeBlinkLeft ?? 0, blinkR: frame.blendshapes.eyeBlinkRight ?? 0,
          okL: iris.okL, okR: iris.okR, confidence: conf, headOk: head.ok,
        })
        if (!facePresent) resetFilters()
        const tS = nowMs / 1000
        const headParams = { minCutoff: cfg.headMinCutoffHz, beta: cfg.beta, dCutoff: cfg.dCutoffHz }
        const irisParams = { minCutoff: cfg.minCutoffHz, beta: cfg.beta, dCutoff: cfg.dCutoffHz }
        // Filter the FEATURES, not the point: both the default map and a
        // calibration then see the same smoothed inputs. Median-of-3 first
        // (spikes), then One Euro - the head steady and quick, the iris
        // smoothed harder (ideas 2.3, 2.4).
        const f = { ok: raw.ok } as GazeFeatures
        for (const k of FEATURE_KEYS) {
          const v = cfg.medianPrefilter ? medians.get(k)!.push(raw[k]) : raw[k]
          const isHead = k === 'headYaw' || k === 'headPitch'
          f[k] = filters.get(k)!.filter(v, tS, isHead ? headParams : irisParams)
        }
        const ptFiltered = screenPointFrom(f, cfg, ctx.viewport, channel.calibration)
        // Fixation mean (the stare, not the frame), then the freeze on top.
        const fx = stepFixation(fixation, ptFiltered.x, ptFiltered.y, nowMs, {
          fixationMs: cfg.fixationMs, fixationMaxMs: cfg.fixationMaxMs, fixationRadiusPx: cfg.fixationRadiusPx,
        })
        fixation = fx.state
        telemetry.fixationN = fx.n
        telemetry.fixationWindowMs = fx.windowMs
        let pt = { x: fx.x, y: fx.y }
        // Speed-gated freeze (ideas 2.5): once the point has been slower than
        // freezeBelowPxPerSec for freezeAfterMs it is held dead-still until
        // it moves faster than freezeReleasePxPerSec - eyes at rest produce
        // a still dot, and the filter alone never quite gets there.
        if (cfg.freezeEnabled) {
          const speed = lastPt ? Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y) / Math.max(1e-3, (nowMs - lastPt.t) / 1000) : Infinity
          lastPt = { x: pt.x, y: pt.y, t: nowMs }
          if (frozen) {
            if (speed > cfg.freezeReleasePxPerSec) {
              frozen = false
              slowSince = null
            } else if (heldPt) {
              // A freeze taken while the filter was still settling after a
              // saccade holds a point biased toward where the eyes came
              // from; once the fixation mean has moved past a noise-sized
              // tolerance, re-snap to it. Noise never gets that far.
              if (Math.hypot(pt.x - heldPt.x, pt.y - heldPt.y) > cfg.freezeTolerancePx) heldPt = { x: pt.x, y: pt.y }
              pt = heldPt
            }
          } else if (speed < cfg.freezeBelowPxPerSec) {
            if (slowSince === null) slowSince = nowMs
            if (nowMs - slowSince >= cfg.freezeAfterMs) {
              frozen = true
              heldPt = { x: pt.x, y: pt.y }
            }
          } else {
            slowSince = null
          }
          if (frozen && !heldPt) heldPt = { x: pt.x, y: pt.y }
        } else {
          frozen = false
        }
        const cx = ctx.viewport.w / 2
        const cy = ctx.viewport.h / 2
        const R = Math.min(ctx.viewport.w, ctx.viewport.h) / 2 || 1
        const rx = pt.x - cx
        const ry = pt.y - cy
        const r = Math.hypot(rx, ry)
        norm = r / R
        dir = r > 1e-6 ? { x: rx / r, y: ry / r } : { x: 0, y: 0 }
        // The gate's TIMERS run on the unfiltered point: the filter's tail
        // after a glance would otherwise count as part of the excursion and
        // turn a 250 ms glance into a 500 ms one. The torque itself uses the
        // filtered point, so the drift is smooth.
        const ptRaw = screenPointFrom(raw, cfg, ctx.viewport, channel.calibration)
        normRaw = Math.hypot(ptRaw.x - cx, ptRaw.y - cy) / R
        // head-only point: the same map with every iris feature zeroed
        const headF = { ...f }
        for (const k of FEATURE_KEYS) if (k !== 'headYaw' && k !== 'headPitch') headF[k] = 0
        const ptHead = screenPointFrom(headF, cfg, ctx.viewport, channel.calibration)
        telemetry.headOnly = headOnly
        telemetry.yaw = f.headYaw
        telemetry.pitch = f.headPitch
        telemetry.features = f
        telemetry.rawFeatures = raw
        telemetry.gazeX = pt.x
        telemetry.gazeY = pt.y
        telemetry.rawX = ptRaw.x
        telemetry.rawY = ptRaw.y
        telemetry.headX = ptHead.x
        telemetry.headY = ptHead.y
        telemetry.okRateL = okRateL
        telemetry.okRateR = okRateR
        telemetry.vergenceDrop = iris.vergenceDrop
        telemetry.frozen = frozen
        telemetry.wideModel = channel.calibration?.model === 'wide'
        telemetry.norm = norm
        telemetry.irisOkL = iris.okL
        telemetry.irisOkR = iris.okR
        telemetry.blinkL = frame.blendshapes.eyeBlinkLeft ?? 0
        telemetry.blinkR = frame.blendshapes.eyeBlinkRight ?? 0
        telemetry.headSource = head.source
        telemetry.filterCutoffHz = cfg.minCutoffHz
      }
      telemetry.confidence = conf
      const present = frame !== null && conf >= cfg.confidenceMin
      telemetry.facePresent = present
      telemetry.calibrated = channel.calibration !== null
      telemetry.calibratedPoints = channel.calibration?.points ?? 0
      telemetry.calibrationResidualPx = channel.calibration?.residualPx ?? 0

      // ── 'point' mode: the eyes point; nothing here moves the field ────
      // The scene reads gazeX/gazeY + facePresent + state each frame and
      // focuses the node under the gaze (neural/gazeFocus.ts). Only the
      // suspension rules apply - the mouse, a hand engage, a tap, the shell.
      if (cfg.mode === 'point') {
        const pointerRecentP = ctx.pointerIdleMs < cfg.resumeMs
        const suspendedP = handEngaged || nowMs < suspendedUntil || pointerRecentP || ctx.shellOpen
        endEngagement(out) // never holds one in this mode
        resetGate()
        setState(suspendedP ? 'suspended' : 'idle')
        facePresent = present
        return out
      }

      // ── reduced motion: telemetry only, state off ─────────────────────
      if (ctx.reducedMotion) {
        if (state !== 'off') goOff(out)
        setState('off')
        return out
      }

      // ── suspension (hand / tap / pointer / shell) ─────────────────────
      const pointerRecent = ctx.pointerIdleMs < cfg.resumeMs
      const suspendedNow = handEngaged || nowMs < suspendedUntil || pointerRecent || ctx.shellOpen
      if (suspendedNow) {
        if (state !== 'suspended') {
          // A pointer / shell suspension while gaze holds the floor: end it.
          endEngagement(out)
          resetGate()
          setState('suspended')
        }
        facePresent = present
        return out
      }
      if (state === 'suspended') {
        setState('idle')
        resetGate()
      }

      // ── lost face: hold, then decay, then idle ────────────────────────
      if (!present) {
        // Idle with no face simply stays idle (there is nothing to hold);
        // attending holds its drift, then decays it, then idles.
        if (state === 'attending') {
          heldFrom = state
          holdingSince = nowMs
          setState('holding')
        }
        if (state === 'idle') {
          resetGate()
          facePresent = false
          return out
        }
        if (state === 'holding' && nowMs - holdingSince >= cfg.holdMs) {
          decayingSince = nowMs
          setState('decaying')
        }
        if (state === 'decaying') {
          const k = Math.min(1, (nowMs - decayingSince) / Math.max(1, cfg.decayMs))
          const mag = lastMag * (1 - k)
          if (mag > 0 && holdsEngagement) out.push(torque(dir0(lastDir), mag, dt, cfg))
          telemetry.mag = mag
          if (k >= 1) {
            endEngagement(out)
            resetGate()
            setState('idle')
          }
        } else if (state === 'holding' && holdsEngagement && lastMag > 0) {
          out.push(torque(lastDir, lastMag, dt, cfg)) // hold the drift through a blink
        }
        facePresent = false
        return out
      }
      if (state === 'holding') {
        // the face came back within the hold: carry on as before
        setState(heldFrom)
      } else if (state === 'decaying') {
        endEngagement(out)
        resetGate()
        setState('idle')
      }
      facePresent = true

      // ── the gate (hysteresis) ─────────────────────────────────────────
      const outside = normRaw > cfg.deadZone
      const inside = normRaw < cfg.deadZone - cfg.hysteresis
      if (outside) {
        if (outsideSince === null) outsideSince = nowMs
        insideSince = null
      } else if (inside) {
        if (insideSince === null) insideSince = nowMs
        outsideSince = null
      } else {
        outsideSince = null
        insideSince = null
      }
      if (state === 'idle' && outsideSince !== null && nowMs - outsideSince >= cfg.attendMs) {
        setState('attending')
        if (!holdsEngagement) {
          out.push({ type: 'engage', source: 'gaze' })
          holdsEngagement = true
        }
      } else if (state === 'attending' && insideSince !== null && nowMs - insideSince >= cfg.releaseMs) {
        endEngagement(out)
        resetGate()
        setState('idle')
      }

      // ── torque ────────────────────────────────────────────────────────
      if (state === 'attending') {
        const mag = smoothstep(cfg.deadZone, 1.0, norm)
        lastDir = dir
        lastMag = mag
        telemetry.dirX = dir.x
        telemetry.dirY = dir.y
        telemetry.mag = mag
        if (holdsEngagement && mag > 0) out.push(torque(dir, mag, dt, cfg))
      } else {
        telemetry.dirX = 0
        telemetry.dirY = 0
        telemetry.mag = 0
      }
      return out
    },

    reset() {
      const out: InputEvent[] = []
      goOff(out)
      handEngaged = false
      suspendedUntil = 0
      lastT = 0
      return out
    },
  }
  return channel
}

const dir0 = (d: { x: number; y: number }) => d

/**
 * The move that brings the looked-at region toward the sight: content
 * moves OPPOSITE to the gaze direction (a drag of -dir), at
 * mag·maxDegPerSec. Degrees -> radians for the bus.
 */
export function torque(
  dir: { x: number; y: number },
  mag: number,
  dt: number,
  cfg: EyeConfig,
): InputEvent {
  const step = mag * cfg.maxDegPerSec * dt * DEG2RAD
  return { type: 'move', dYaw: -dir.x * step, dPitch: -dir.y * step, source: 'gaze' }
}
