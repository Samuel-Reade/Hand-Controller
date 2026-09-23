// ORB_EYE_SPEC §8 tests 1-9, headless against synthetic faces. The channel
// is driven frame by frame at 30 fps with a scripted context; nothing here
// touches MediaPipe or the DOM.
import { describe, expect, it } from 'vitest'
import { OneEuroFilter } from '../src/input/OneEuroFilter'
import { syntheticFace } from '../src/input/eye/__synthetic__/face'
import { createEyeChannel, recentreOffset } from '../src/input/eye/channel'
import type { EyeContext } from '../src/input/eye/channel'
import { EYE_DEFAULTS } from '../src/input/eye/config'
import type { EyeConfig } from '../src/input/eye/config'
import {
  blendshapeGaze,
  gazeAngles,
  gazeFeatures,
  headPose,
  irisAgreementScale,
  irisMix,
  irisOffset,
  screenPoint,
  screenPointFrom,
} from '../src/input/eye/face'
import type { FaceFrame, GazeFeatures } from '../src/input/eye/face'
import {
  calibrationTargets, createOnlineCalibration, fitCalibration, fitCalibrationReport, fixedHeadGain, learnAllowed, learnConfirm, mapWith,
  medianFeatures,
} from '../src/input/eye/calibration'
import type { CalibrationSample } from '../src/input/eye/calibration'
import { createFixation, createGazeFocus, stepFixation, stepGazeFocus } from '../src/neural/gazeFocus'
import type { GazeCandidate } from '../src/neural/gazeFocus'
import type { InputEvent } from '../src/input/InputBus'
import { heardCentre, heardLeave, heardOpen } from '../src/input/useVoiceInput'

/** The steer-mode config (route A) the spec's tests 1-9 are written against. */
const cfg = (over: Partial<EyeConfig> = {}): EyeConfig => ({
  ...EYE_DEFAULTS, enabled: true, mode: 'steer', irisGainDeg: 12, blendCheck: true, irisBlendWeight: 0, ...over,
})
const VIEW = { w: 1440, h: 900 }
const FRAME = 1000 / 30
const ctx = (over: Partial<EyeContext> = {}): EyeContext => ({
  viewport: VIEW, cameraOn: true, reducedMotion: false, shellOpen: false, pointerIdleMs: Infinity, ...over,
})
/** A full feature set from the six core values: per-eye = the combined, per-eye blend = the blend. */
const feat = (f: { headYaw: number; headPitch: number; irisX: number; irisY: number; blendX?: number; blendY?: number; ok?: boolean }): GazeFeatures => {
  const blendX = f.blendX ?? f.irisX
  const blendY = f.blendY ?? f.irisY
  return {
    headYaw: f.headYaw, headPitch: f.headPitch, irisX: f.irisX, irisY: f.irisY, blendX, blendY,
    eyeLX: f.irisX, eyeLY: f.irisY, eyeRX: f.irisX, eyeRY: f.irisY,
    blendLX: blendX, blendLY: blendY, blendRX: blendX, blendRY: blendY,
    ok: f.ok ?? true,
  }
}
/** head yaw that puts the gaze point at `norm` of the half-extent (no iris) */
const yawForNorm = (norm: number, c = cfg()) => (norm * (Math.min(VIEW.w, VIEW.h) / 2)) / c.pxPerDeg

describe('1. headPose (landmark fallback)', () => {
  it('recovers yaw/pitch within 1° across a ±30° grid; ok=false beyond the max', () => {
    const c = cfg()
    for (let yaw = -30; yaw <= 30; yaw += 10) {
      for (let pitch = -25; pitch <= 25; pitch += 12.5) {
        const h = headPose(syntheticFace({ yaw, pitch }), c)
        expect(Math.abs(h.yaw - yaw)).toBeLessThan(1)
        expect(Math.abs(h.pitch - pitch)).toBeLessThan(1)
        expect(h.ok).toBe(true)
        expect(h.source).toBe('landmarks')
      }
    }
    expect(headPose(syntheticFace({ yaw: 40 }), c).ok).toBe(false)
    expect(headPose(syntheticFace({ pitch: -34 }), c).ok).toBe(false)
  })
  it('the transform path agrees with the landmark path within 1.5°', () => {
    const c = cfg()
    const yaw = 20
    const th = (-yaw * Math.PI) / 180 // the documented convention: a turn to the user's right is R_y(-θ)
    const cs = Math.cos(th), sn = Math.sin(th)
    // column-major R_y: columns (c,0,-s), (0,1,0), (s,0,c)
    const transform = [cs, 0, -sn, 0, 0, 1, 0, 0, sn, 0, cs, 0, 0, 0, 0, 1]
    const f: FaceFrame = { ...syntheticFace({ yaw }), transform }
    const viaT = headPose(f, c)
    const viaL = headPose({ ...f, transform: undefined }, c)
    expect(viaT.source).toBe('transform')
    expect(Math.abs(viaT.yaw - viaL.yaw)).toBeLessThan(1.5)
    expect(Math.abs(viaT.pitch - viaL.pitch)).toBeLessThan(1.5)
  })
})

describe('2. irisOffset', () => {
  it('recovers ±1 deflection within 0.05; per-eye ok drops on blink and on lid gap', () => {
    const c = cfg()
    for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.5, -0.5]] as const) {
      const o = irisOffset(syntheticFace({ irisX: x, irisY: y }), c)
      expect(Math.abs(o.x - x)).toBeLessThan(0.05)
      expect(Math.abs(o.y - y)).toBeLessThan(0.05)
      expect(o.okL && o.okR).toBe(true)
    }
    const blinkL = irisOffset(syntheticFace({ irisX: 1, blinkL: 0.8 }), c)
    expect(blinkL.okL).toBe(false)
    expect(blinkL.okR).toBe(true)
    expect(Math.abs(blinkL.x - 1)).toBeLessThan(0.05) // the open eye carries it
    const shut = irisOffset(syntheticFace({ blinkL: 0.9, blinkR: 0.9 }), c)
    expect(shut.okL || shut.okR).toBe(false)
    expect(shut.x).toBe(0)
    expect(shut.y).toBe(0)
  })
})

describe('3. gazeAngles', () => {
  it('is linear in the iris with gain irisGainDeg; the gain halves on blendshape disagreement', () => {
    const c = cfg()
    const head = headPose(syntheticFace({ yaw: 5, pitch: -3 }), c)
    for (const x of [-1, -0.5, 0, 0.5, 1]) {
      const iris = irisOffset(syntheticFace({ irisX: x }), c)
      const g = gazeAngles(head, iris, c)
      expect(Math.abs(g.yaw - (head.yaw + c.irisGainDeg * x))).toBeLessThan(0.6)
    }
    const agree = syntheticFace({ irisX: 0.8 })
    const noisy = syntheticFace({ irisX: 0.8, noisyBlend: true })
    expect(irisAgreementScale(irisOffset(agree, c), blendshapeGaze(agree.blendshapes))).toBe(1)
    expect(irisAgreementScale(irisOffset(noisy, c), blendshapeGaze(noisy.blendshapes))).toBe(0.5)
    expect(gazeAngles(head, irisOffset(noisy, c), c, 0.5).irisGainDeg).toBe(c.irisGainDeg / 2)
  })
})

describe('4. screenPoint', () => {
  it('maps yaw 0 to centre and ±10° to ±380 px at the default pxPerDeg', () => {
    const c = cfg()
    expect(screenPoint({ yaw: 0, pitch: 0 }, c, VIEW)).toEqual({ x: 720, y: 450 })
    expect(screenPoint({ yaw: 10, pitch: 0 }, c, VIEW).x).toBeCloseTo(720 + 380, 6)
    expect(screenPoint({ yaw: -10, pitch: 0 }, c, VIEW).x).toBeCloseTo(720 - 380, 6)
    expect(screenPoint({ yaw: 0, pitch: 10 }, c, VIEW).y).toBeCloseTo(450 - 380, 6) // up is up
  })
})

describe('5. filter stability', () => {
  it('white-noise jitter is smoothed to < 0.6° and a 15° step settles 90 % within 6 frames', () => {
    const c = cfg()
    const params = { minCutoff: c.minCutoffHz, beta: c.beta, dCutoff: c.dCutoffHz }
    // 1 px landmark jitter through the fallback ≈ 1.2° raw on yaw (est.)
    const f = new OneEuroFilter()
    const raw: number[] = []
    const out: number[] = []
    for (let i = 0; i < 200; i++) {
      const yaw = headPose(syntheticFace({ yaw: 0, jitterPx: 1, seed: 7 }, i * FRAME), c).yaw
      raw.push(yaw)
      out.push(f.filter(yaw, (i * FRAME) / 1000, params))
    }
    const sd = (a: number[]) => {
      const m = a.reduce((s, v) => s + v, 0) / a.length
      return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)
    }
    expect(sd(raw)).toBeGreaterThan(0.5) // the jitter is real
    expect(sd(out.slice(30))).toBeLessThan(0.6)
    expect(sd(out.slice(30))).toBeLessThan(sd(raw) / 2)

    const g = new OneEuroFilter()
    g.filter(0, 0, params)
    let settledAt = -1
    for (let i = 1; i <= 30; i++) {
      const v = g.filter(15, (i * FRAME) / 1000, params)
      if (settledAt < 0 && v >= 13.5) settledAt = i
    }
    expect(settledAt).toBeGreaterThan(0)
    expect(settledAt).toBeLessThanOrEqual(6)
  })
})

/** Drive a channel with a face script; returns the events per frame and the states. */
function run(
  c: EyeConfig,
  script: (tMs: number) => FaceFrame | null,
  frames: number,
  ctxAt: (tMs: number) => EyeContext = () => ctx(),
  onBusAt?: (tMs: number) => InputEvent[],
) {
  const ch = createEyeChannel(c)
  const events: { t: number; e: InputEvent }[] = []
  const states: { t: number; s: string }[] = []
  for (let i = 0; i < frames; i++) {
    const t = i * FRAME
    for (const e of onBusAt?.(t) ?? []) ch.onBus(e, t)
    for (const e of ch.process(script(t), t, ctxAt(t))) events.push({ t, e })
    states.push({ t, s: ch.state })
  }
  return { ch, events, states }
}

describe('6. hysteresis (regionGate)', () => {
  it('a point oscillating across deadZone at 5 Hz never enters attending', () => {
    const c = cfg()
    const lo = yawForNorm(0.09, c)
    const hi = yawForNorm(0.36, c)
    const { states } = run(c, (t) => syntheticFace({ yaw: t % 200 < 100 ? hi : lo }), 150)
    expect(states.some((s) => s.s === 'attending')).toBe(false)
  })
  it('held at norm 0.5 it enters attending at attendMs, and leaves only after norm < 0.20 for releaseMs', () => {
    const c = cfg()
    const hold = yawForNorm(0.5, c)
    const { states, events } = run(c, (t) => syntheticFace({ yaw: t < 2000 ? hold : 0 }), 90)
    const entered = states.find((s) => s.s === 'attending')!
    expect(entered).toBeDefined()
    expect(Math.abs(entered.t - c.attendMs)).toBeLessThanOrEqual(FRAME)
    // the engagement opened with a gaze-tagged engage, then moves
    const first = events[0].e
    expect(first.type).toBe('engage')
    expect('source' in first && first.source).toBe('gaze')
    expect(events.filter((x) => x.e.type === 'move').length).toBeGreaterThan(10)
    // at 2000 ms the gaze returns to centre: still attending 100 ms later, idle by 600 ms later
    const at = (t: number) => states.find((s) => s.t >= t)!.s
    expect(at(2100)).toBe('attending')
    expect(at(2600)).toBe('idle')
    // the engagement closed with lost, never release
    expect(events.some((x) => x.e.type === 'release')).toBe(false)
    expect(events.some((x) => x.e.type === 'lost')).toBe(true)
  })
  it('the torque brings the looked-at region toward the sight (content moves opposite)', () => {
    const c = cfg()
    const { events } = run(c, () => syntheticFace({ yaw: yawForNorm(0.6, c) }), 40)
    const moves = events.filter((x) => x.e.type === 'move').map((x) => x.e as { dYaw: number; dPitch: number })
    expect(moves.length).toBeGreaterThan(0)
    for (const m of moves) {
      expect(m.dYaw).toBeLessThan(0) // looking right -> content moves left
      expect(Math.abs(m.dPitch)).toBeLessThan(1e-9)
      // bounded by maxDegPerSec per frame
      expect(Math.abs(m.dYaw)).toBeLessThanOrEqual((c.maxDegPerSec * (FRAME / 1000) * Math.PI) / 180 + 1e-9)
    }
  })
})

describe('7. lost face', () => {
  it('holds the drift for holdMs, decays to zero by holdMs+decayMs, ends with lost, never release', () => {
    const c = cfg()
    const hold = yawForNorm(0.6, c)
    const T0 = 1500
    const { states, events } = run(c, (t) => (t < T0 ? syntheticFace({ yaw: hold }) : null), 90)
    const at = (t: number) => states.find((s) => s.t >= t)!.s
    expect(at(T0 - FRAME)).toBe('attending')
    expect(at(T0 + 100)).toBe('holding')
    expect(at(T0 + c.holdMs + 100)).toBe('decaying')
    expect(at(T0 + c.holdMs + c.decayMs + 2 * FRAME)).toBe('idle')
    // moves continue through the hold at the same magnitude, then shrink
    const held = events.filter((x) => x.t >= T0 && x.t < T0 + c.holdMs && x.e.type === 'move')
    expect(held.length).toBeGreaterThan(3)
    const decayed = events.filter((x) => x.t >= T0 + c.holdMs && x.e.type === 'move').map((x) => Math.abs((x.e as { dYaw: number }).dYaw))
    for (let i = 1; i < decayed.length; i++) expect(decayed[i]).toBeLessThanOrEqual(decayed[i - 1] + 1e-12)
    expect(events.some((x) => x.e.type === 'release')).toBe(false)
    const last = events[events.length - 1].e
    expect(last.type).toBe('lost')
  })
  it('a blink-length dropout does not stutter: the face returning within holdMs resumes attending', () => {
    const c = cfg()
    const hold = yawForNorm(0.6, c)
    const { states, events } = run(c, (t) => (t >= 1500 && t < 1650 ? null : syntheticFace({ yaw: hold })), 80)
    const at = (t: number) => states.find((s) => s.t >= t)!.s
    expect(at(1550)).toBe('holding')
    expect(at(1700)).toBe('attending')
    expect(events.filter((x) => x.e.type === 'lost').length).toBe(0)
  })
})

describe('8. arbitration', () => {
  it('a hand engage during attending suspends the same tick; no gaze move until release + resumeMs + attendMs', () => {
    const c = cfg()
    const hold = yawForNorm(0.6, c)
    const T_ENGAGE = 1200
    const T_RELEASE = 2000
    const { states, events } = run(
      c,
      () => syntheticFace({ yaw: hold }),
      150,
      () => ctx(),
      (t) => {
        if (Math.abs(t - T_ENGAGE) < FRAME / 2) return [{ type: 'engage' }]
        if (Math.abs(t - T_RELEASE) < FRAME / 2) return [{ type: 'release', vYaw: 0, vPitch: 0 }]
        return []
      },
    )
    const at = (t: number) => states.find((s) => s.t >= t)!.s
    expect(at(T_ENGAGE - FRAME)).toBe('attending')
    expect(at(T_ENGAGE)).toBe('suspended')
    // gaze does not `lost` the hand's engagement out from under it
    expect(events.some((x) => x.t >= T_ENGAGE && x.t < T_RELEASE && x.e.type === 'lost')).toBe(false)
    const gazeMovesAfter = events.filter((x) => x.t > T_ENGAGE && x.e.type === 'move')
    expect(gazeMovesAfter.length).toBeGreaterThan(0)
    expect(gazeMovesAfter[0].t).toBeGreaterThanOrEqual(T_RELEASE + c.resumeMs + c.attendMs - FRAME)
  })
  it('the mouse, the shell and a tap all suspend; the pointer must go quiet for resumeMs', () => {
    const c = cfg()
    const hold = yawForNorm(0.6, c)
    const { states: shell } = run(c, () => syntheticFace({ yaw: hold }), 40, () => ctx({ shellOpen: true }))
    expect(shell.every((s) => s.s === 'suspended')).toBe(true)
    const { states: mouse } = run(c, () => syntheticFace({ yaw: hold }), 40, () => ctx({ pointerIdleMs: 100 }))
    expect(mouse.every((s) => s.s === 'suspended')).toBe(true)
    const { states: quiet } = run(c, () => syntheticFace({ yaw: hold }), 60, (t) => ctx({ pointerIdleMs: t }))
    expect(quiet.find((s) => s.s === 'attending')!.t).toBeGreaterThanOrEqual(c.resumeMs + c.attendMs - FRAME)
  })
})

describe('9. reduced motion', () => {
  it('emits zero move events over 300 attending-worthy frames while telemetry still updates', () => {
    const c = cfg()
    const { ch, events } = run(c, (t) => syntheticFace({ yaw: 10 + 5 * Math.sin(t / 500) }), 300, () => ctx({ reducedMotion: true }))
    expect(events.filter((x) => x.e.type === 'move').length).toBe(0)
    expect(events.filter((x) => x.e.type === 'engage').length).toBe(0)
    expect(ch.state).toBe('off')
    expect(Math.abs(ch.telemetry.yaw)).toBeGreaterThan(1) // telemetry tracked the face
    expect(ch.telemetry.facePresent).toBe(true)
  })
  it('a glance (shorter than attendMs) never moves the field', () => {
    const c = cfg()
    const { events } = run(c, (t) => syntheticFace({ yaw: t % 2000 < 250 ? 28 : 0 }), 300)
    expect(events.filter((x) => x.e.type === 'move').length).toBe(0)
  })
})

// ── 'point' mode (user direction 2026-09-10: the eyes point at nodes) ──────

describe('point mode: features and the calibrated map', () => {
  it('blends geometric iris with the blendshape estimate by irisBlendWeight', () => {
    const c = cfg({ irisBlendWeight: 0.5, mode: 'point' })
    const f = syntheticFace({ irisX: 0.8, irisY: -0.4 })
    const head = headPose(f, c)
    const iris = irisOffset(f, c)
    const blend = blendshapeGaze(f.blendshapes)
    const g = gazeFeatures(head, iris, blend, c)
    expect(Math.abs(g.irisX - 0.8)).toBeLessThan(0.05) // the two sources are kept separate...
    expect(Math.abs(g.blendX - 0.8)).toBeLessThan(0.05)
    expect(Math.abs(g.irisY + 0.4)).toBeLessThan(0.05)
    // ...and the default map blends them: weight 1 = blendshapes only
    const noisy = syntheticFace({ irisX: 0.8, noisyBlend: true })
    const g1 = gazeFeatures(headPose(noisy, c), irisOffset(noisy, c), blendshapeGaze(noisy.blendshapes), c)
    expect(g1.irisX).toBeCloseTo(0.8, 1)
    expect(g1.blendX).toBeCloseTo(-0.8, 1)
    expect(irisMix(g1, { ...c, irisBlendWeight: 1 }).x).toBeCloseTo(-0.8, 1)
    expect(irisMix(g1, { ...c, irisBlendWeight: 0 }).x).toBeCloseTo(0.8, 1)
    // with both eyes shut the geometry says nothing; the blendshapes carry the geometric slot
    const shut = syntheticFace({ irisX: 0.6, blinkL: 0.9, blinkR: 0.9 })
    const g2 = gazeFeatures(headPose(shut, c), irisOffset(shut, c), blendshapeGaze(shut.blendshapes), c)
    expect(g2.irisX).toBeCloseTo(0.6, 1)
  })

  it('the default map reaches the screen edge on a full iris deflection at irisGainDeg 30', () => {
    const c = { ...EYE_DEFAULTS, enabled: true }
    const f = feat({ headYaw: 0, headPitch: 0, irisX: 0.6, irisY: 0 })
    const p = screenPointFrom(f, c, VIEW, null)
    expect(p.x - VIEW.w / 2).toBeCloseTo(0.6 * 30 * 38, 6) // 684 px: past the half-width
  })

  it('fitCalibration recovers a known per-user map, including a reversed sign', () => {
    const c = { ...EYE_DEFAULTS, enabled: true }
    const truth = { x: [700, 25, 900] as const, y: [460, -22, -700] as const } // yaw sign reversed for this user
    const targets = calibrationTargets(VIEW, 0.4, true)
    const samples: CalibrationSample[] = targets.map((t, i) => {
      // a plausible user: head does 40 % of the travel, eyes the rest
      const headYaw = ((t.x - truth.x[0]) * 0.4) / truth.x[1]
      const irisX = ((t.x - truth.x[0]) * 0.6) / truth.x[2]
      const headPitch = ((t.y - truth.y[0]) * 0.4) / truth.y[1]
      const irisY = ((t.y - truth.y[0]) * 0.6) / truth.y[2]
      // a little measurement noise, deterministic
      const n = ((i * 7919) % 13) / 13 - 0.5
      return { features: feat({ headYaw: headYaw + n * 0.3, headPitch, irisX, irisY: irisY + n * 0.01, blendX: irisX, blendY: irisY + n * 0.01, ok: true }), target: t }
    })
    const fit = fitCalibration(samples, c)
    expect(fit).not.toBeNull()
    expect(fit!.residualPx).toBeLessThan(25)
    for (const t of targets) {
      const s = samples.find((x) => x.target === t)!
      const p = screenPointFrom(s.features, c, VIEW, fit)
      expect(Math.abs(p.x - t.x)).toBeLessThan(40)
      expect(Math.abs(p.y - t.y)).toBeLessThan(40)
    }
    expect(Math.sign(fit!.y[1])).toBe(-1) // the reversed sign was learnt, not assumed
  })

  it('a fit with a residual over calMaxResidualPx is rejected; too few samples too', () => {
    // head gain fitted: the synthetic user below looks with the head as well
    const c = { ...EYE_DEFAULTS, enabled: true, calMaxResidualPx: 30, calHeadGainPxPerDeg: -1 }
    const targets = calibrationTargets(VIEW, 0.4)
    // a user who never looked at the targets: the features barely move
    const garbage: CalibrationSample[] = targets.map((t, i) => ({
      features: feat({ headYaw: 3 + (i % 2) * 0.05, headPitch: -1 + (i % 3) * 0.02, irisX: 0.1 + (i % 2) * 0.005, irisY: 0.05, blendX: 0.1 + (i % 2) * 0.005, blendY: 0.05, ok: true }),
      target: t,
    }))
    expect(fitCalibration(garbage, c)).toBeNull()
    expect(fitCalibration(garbage.slice(0, 3), { ...c, calMaxResidualPx: 1e9 })).toBeNull()
    // the report says why, and accepts a fit that clearly beats the default map
    const rep = fitCalibrationReport(garbage, c, (f) => screenPointFrom(f, c, VIEW, null))
    expect(rep.accepted).toBe(false)
    expect(rep.reason).toBe('residual')
    const few = fitCalibrationReport(garbage.slice(0, 3), c, (f) => screenPointFrom(f, c, VIEW, null))
    expect(few.reason).toBe('too-few-samples')
    // a real user whose eyes move less than the default map assumes: the
    // fit's residual (~50 px) misses a tight threshold but beats the default
    // map (hundreds of px) by far - accepted as coarse
    const targets9 = calibrationTargets(VIEW, 0.4, true)
    // ...with measurement noise on every feature (≈ ±40-50 px each)
    const smallEyes: CalibrationSample[] = targets9.map((t, i) => ({
      features: feat({
        headYaw: (t.x - 720) / 60 + ((i % 3) - 1) * 0.8,
        headPitch: (t.y - 450) / -70 + (((i * 5) % 3) - 1) * 0.8,
        irisX: (t.x - 720) / 4000 + (((i * 7) % 3) - 1) * 0.012,
        irisY: (t.y - 450) / -5000 + (((i * 11) % 3) - 1) * 0.01,
        blendX: (t.x - 720) / 4000 + (((i * 7) % 3) - 1) * 0.012,
        blendY: (t.y - 450) / -5000 + (((i * 11) % 3) - 1) * 0.01,
        ok: true,
      }),
      target: t,
    }))
    const tight = { ...c, calMaxResidualPx: 25 } // fit ~48 px: over 25, under the 50 px cap, beats the default (~67)
    const coarse = fitCalibrationReport(smallEyes, tight, (f) => screenPointFrom(f, tight, VIEW, null))
    expect(coarse.reason).toBe('better-than-default')
    expect(coarse.accepted).toBe(true)
    expect(coarse.residualPx).toBeLessThan(coarse.defaultResidualPx * 0.8)
    const med = medianFeatures([
      feat({ headYaw: 1, headPitch: 0, irisX: 0.2, irisY: 0, blendX: 0.2, blendY: 0 }),
      feat({ headYaw: 9, headPitch: 0, irisX: 0.9, irisY: 0, blendX: 0.9, blendY: 0 }),
      feat({ headYaw: 2, headPitch: 0, irisX: 0.3, irisY: 0, blendX: 0.3, blendY: 0 }),
    ])
    expect(med!.headYaw).toBe(2)
    expect(med!.irisX).toBe(0.3)
  })
})

describe('point mode: gaze focus hysteresis', () => {
  const fc = { holdMs: 120, releaseFactor: 1.6 }
  const A = (dist: number): GazeCandidate => ({ name: 'A', dist, r: 80 })
  const B = (dist: number): GazeCandidate => ({ name: 'B', dist, r: 80 })

  it('acquires the most-centred node only after it has been the best for holdMs', () => {
    let s = createGazeFocus()
    for (let t = 0; t < 100; t += FRAME) {
      s = stepGazeFocus(s, [A(10), B(60)], t, fc)
      expect(s.name).toBeNull()
    }
    s = stepGazeFocus(s, [A(10), B(60)], 130, fc)
    expect(s.name).toBe('A')
  })

  it('a gaze point jittering between two nodes does not flicker the focus', () => {
    let s = createGazeFocus()
    for (let t = 0; t < 300; t += FRAME) s = stepGazeFocus(s, [A(10), B(60)], t, fc)
    expect(s.name).toBe('A')
    let switches = 0
    let last = s.name
    // 30 Hz alternation: B is best every other frame, never for holdMs
    for (let t = 300; t < 2000; t += FRAME) {
      const bBest = Math.round(t / FRAME) % 2 === 0
      s = stepGazeFocus(s, [A(bBest ? 50 : 20), B(bBest ? 20 : 50)], t, fc)
      if (s.name !== last) { switches++; last = s.name }
    }
    expect(switches).toBe(0)
    expect(s.name).toBe('A')
  })

  it('switches once a rival stays best for holdMs; releases once out of the cone for holdMs', () => {
    let s = createGazeFocus()
    for (let t = 0; t < 300; t += FRAME) s = stepGazeFocus(s, [A(10), B(60)], t, fc)
    expect(s.name).toBe('A')
    let t = 300
    for (; t < 300 + fc.holdMs + 2 * FRAME; t += FRAME) s = stepGazeFocus(s, [A(60), B(5)], t, fc)
    expect(s.name).toBe('B')
    // far from everything: still held within the release cone (1.6 x 80 = 128 px)...
    for (; t < 1000; t += FRAME) s = stepGazeFocus(s, [A(200), B(120)], t, fc)
    expect(s.name).toBe('B')
    // ...dropped once outside it for holdMs
    for (; t < 1000 + fc.holdMs + 2 * FRAME; t += FRAME) s = stepGazeFocus(s, [A(300), B(140)], t, fc)
    expect(s.name).toBeNull()
  })

  it('a bigger node (larger capture radius) wins at equal distance', () => {
    let s = createGazeFocus()
    const big: GazeCandidate = { name: 'big', dist: 60, r: 160 }
    const small: GazeCandidate = { name: 'small', dist: 60, r: 70 }
    for (let t = 0; t < 300; t += FRAME) s = stepGazeFocus(s, [small, big], t, fc)
    expect(s.name).toBe('big')
  })
})

describe('point mode: hop node to node', () => {
  const fc = { holdMs: 120, releaseFactor: 1.6, switchMargin: 0.8, hop: true }
  const A = (dist: number): GazeCandidate => ({ name: 'A', dist, r: 80 })
  const B = (dist: number): GazeCandidate => ({ name: 'B', dist, r: 80 })
  const hold = (s: ReturnType<typeof createGazeFocus>, cands: GazeCandidate[], from: number, to: number) => {
    for (let t = from; t <= to; t += FRAME) s = stepGazeFocus(s, cands, t, fc)
    return s
  }

  it('takes the nearest node even when the gaze is outside every cone', () => {
    const s = hold(createGazeFocus(), [A(300), B(500)], 0, 200)
    expect(s.name).toBe('A')
  })

  it('keeps the node while the gaze wanders into empty space', () => {
    let s = hold(createGazeFocus(), [A(10), B(200)], 0, 200)
    expect(s.name).toBe('A')
    s = hold(s, [A(400), B(400)], 200, 2000)
    expect(s.name).toBe('A')
  })

  it('hops only when a rival wins its own cone for holdMs', () => {
    let s = hold(createGazeFocus(), [A(10), B(200)], 0, 200)
    s = hold(s, [A(150), B(20)], 200, 260) // not held long enough yet
    expect(s.name).toBe('A')
    s = hold(s, [A(150), B(20)], 260, 400)
    expect(s.name).toBe('B')
  })

  it('lets go only when the node leaves the candidates (off screen)', () => {
    let s = hold(createGazeFocus(), [A(10), B(200)], 0, 200)
    s = hold(s, [B(600)], 200, 600)
    expect(s.name).toBe('B') // dropped A, then took the nearest again
  })
})

describe('point mode: the standing vertical nudge', () => {
  it('moves the published point by pointBiasYPx and nothing else', () => {
    const base: EyeConfig = { ...EYE_DEFAULTS, enabled: true, mode: 'point', pointBiasYPx: 0 }
    const plain = createEyeChannel(base)
    const up = createEyeChannel({ ...base, pointBiasYPx: -40 })
    for (let i = 0; i < 40; i++) {
      const t = i * FRAME
      const face = syntheticFace({ yaw: 5, irisX: 0.3, irisY: -0.2 }, t)
      plain.process(face, t, ctx())
      up.process(face, t, ctx())
    }
    expect(up.telemetry.gazeY - plain.telemetry.gazeY).toBeCloseTo(-40, 6)
    expect(up.telemetry.gazeX - plain.telemetry.gazeX).toBeCloseTo(0, 6)
    expect(up.telemetry.rawY - plain.telemetry.rawY).toBeCloseTo(-40, 6)
  })
})

describe('point mode: the channel moves nothing and publishes the point', () => {
  it('emits no events, is idle with a face and suspended by the mouse, and publishes gazeX/Y', () => {
    const c: EyeConfig = { ...EYE_DEFAULTS, enabled: true, mode: 'point' }
    const { ch, events, states } = run(c, () => syntheticFace({ yaw: 8, irisX: 0.4 }), 60)
    expect(events.length).toBe(0)
    expect(states.every((s) => s.s === 'idle')).toBe(true)
    expect(ch.telemetry.facePresent).toBe(true)
    expect(ch.telemetry.gazeX).toBeGreaterThan(VIEW.w / 2 + 100) // right of centre: head 8° + iris
    const { states: m } = run(c, () => syntheticFace({ yaw: 8 }), 20, () => ctx({ pointerIdleMs: 50 }))
    expect(m.every((s) => s.s === 'suspended')).toBe(true)
  })
})

describe('calibration: the head gain is fixed without the head-turn stage', () => {
  // A head-still run: the eyes do the looking; the head wobbles ~0.5° and,
  // by chance, the wobble lines up with the rings - a free fit reads that
  // as a big head gain, which a later posture drift then multiplies.
  const targets = calibrationTargets(VIEW, 0.65, true)
  const samples: CalibrationSample[] = targets.map((t, i) => ({
    features: feat({
      headYaw: -3 + (t.x - VIEW.w / 2) / 1800 + ((i % 3) - 1) * 0.05,
      headPitch: 5 + (t.y - VIEW.h / 2) / -1800,
      // measurement noise on the eyes (~±60 px), as the real runs have
      irisX: (t.x - VIEW.w / 2) / 1500 + (((i * 7) % 3) - 1) * 0.04,
      irisY: (t.y - VIEW.h / 2) / -1500 + (((i * 5) % 3) - 1) * 0.04,
      blendX: (t.x - VIEW.w / 2) / 1500 + (((i * 4) % 3) - 1) * 0.04,
      blendY: (t.y - VIEW.h / 2) / -1500 + (((i * 2) % 3) - 1) * 0.04,
    }),
    target: t,
  }))
  const viewport = VIEW
  const fit = (c: EyeConfig) => fitCalibrationReport(samples, c, (f) => screenPointFrom(f, c, viewport, null), 1e-3, viewport)

  it('uses calHeadGainPxPerDeg for the head term, signed like the default map', () => {
    const c = { ...EYE_DEFAULTS, enabled: true, calHeadTurn: false, calHeadGainPxPerDeg: 38 }
    const r = fit(c)
    expect(r.accepted).toBe(true)
    expect(r.cal!.x[1]).toBe(38)
    expect(r.cal!.y[1]).toBe(-38)
  })

  it('keeps a posture drift small where the free fit blows it up', () => {
    const fixedC = { ...EYE_DEFAULTS, enabled: true, calHeadTurn: false, calHeadGainPxPerDeg: 38 }
    const freeC = { ...fixedC, calHeadGainPxPerDeg: -1 }
    const fixed = fit(fixedC).cal!
    const free = fit(freeC).cal!
    const centre = samples[0].features
    const drifted = { ...centre, headYaw: centre.headYaw - 1.6 }
    const move = (cal: typeof fixed) => Math.abs(mapWith(cal, drifted).x - mapWith(cal, centre).x)
    expect(move(fixed)).toBeCloseTo(38 * 1.6, 3)
    expect(move(free)).toBeGreaterThan(1.5 * move(fixed)) // 104 vs 61 px here
  })

  it('fits it when the head-turn stage runs, or when the gain is negative', () => {
    expect(fixedHeadGain({ calHeadTurn: true, calHeadGainPxPerDeg: 38 })).toBeNull()
    expect(fixedHeadGain({ calHeadTurn: false, calHeadGainPxPerDeg: -1 })).toBeNull()
    expect(fixedHeadGain({ calHeadTurn: false, calHeadGainPxPerDeg: 0 })).toBe(0)
  })
})

// ── accuracy pass (user direction: "whatever makes stare selection more accurate") ──

describe('accuracy: curvature correction under leave-one-out', () => {
  const c = { ...EYE_DEFAULTS, enabled: true }
  const targets9 = calibrationTargets(VIEW, 0.65, true)
  /**
   * A user with the curvature a 3x3 grid CAN see: an asymmetric response
   * (the camera sits off-centre, so a look to one side reads larger than
   * the other) and cross-axis coupling (the vertical estimate depends on
   * where the eyes are horizontally - perspective). An odd, symmetric bend
   * is invisible on three levels per axis; that is not this test's job.
   * The features are linear in the gaze angles (a, b); the target is not.
   */
  const curvedUser = (t: { x: number; y: number }, i: number): CalibrationSample => {
    const a = (t.x - 720) / 720
    const b = (t.y - 450) / 450
    const n = (((i * 7) % 5) - 2) * 0.003
    return {
      features: feat({ headYaw: 6 * a, headPitch: -4 * b, irisX: 0.35 * a + n, irisY: 0.2 * b + n, blendX: 0.35 * a + n, blendY: 0.2 * b + n, ok: true }),
      target: { x: 720 + 720 * (a + 0.15 * a * a + 0.2 * a * b), y: 450 + 450 * (b + 0.12 * b * b - 0.15 * a * b) },
    }
  }
  const linearUser = (t: { x: number; y: number }, i: number): CalibrationSample => ({
    features: feat({
      headYaw: (t.x - 720) / 120 + (((i * 3) % 5) - 2) * 0.05,
      headPitch: (t.y - 450) / -110,
      irisX: (t.x - 720) / 2000,
      irisY: (t.y - 450) / -2400 + (((i * 7) % 5) - 2) * 0.003,
      blendX: (t.x - 720) / 2000,
      blendY: (t.y - 450) / -2400 + (((i * 7) % 5) - 2) * 0.003,
      ok: true,
    }),
    target: t,
  })
  const dflt = (f: GazeFeatures) => screenPointFrom(f, c, VIEW, null)

  it('keeps the curvature when it wins leave-one-out, and the map then hits the corners', () => {
    const samples = targets9.map(curvedUser)
    const r = fitCalibrationReport(samples, c, dflt, 1e-3, VIEW)
    expect(r.accepted).toBe(true)
    expect(r.curved).toBe(true)
    expect(r.looCurvedPx).toBeLessThan(r.looLinearPx * 0.95)
    // an unseen point between two targets is predicted well
    const probe = curvedUser({ x: 720 + 0.35 * 720, y: 450 - 0.4 * 450 }, 99)
    const p = screenPointFrom(probe.features, c, VIEW, r.cal)
    const lin = fitCalibrationReport(samples, c, dflt, 1e-3) // no viewport: linear only
    const pl = screenPointFrom(probe.features, c, VIEW, lin.cal)
    const errCurved = Math.hypot(p.x - probe.target.x, p.y - probe.target.y)
    const errLinear = Math.hypot(pl.x - probe.target.x, pl.y - probe.target.y)
    expect(errCurved).toBeLessThan(errLinear)
    expect(errCurved).toBeLessThan(40)
  })

  it('does not invent curvature on a linear user', () => {
    const samples = targets9.map(linearUser)
    const r = fitCalibrationReport(samples, c, dflt, 1e-3, VIEW)
    expect(r.accepted).toBe(true)
    expect(r.curved).toBe(false)
    expect(r.cal!.quad).toBeUndefined()
  })

  it('never tries curvature with five points', () => {
    const samples = calibrationTargets(VIEW, 0.65).map(curvedUser)
    const r = fitCalibrationReport(samples, c, dflt, 1e-3, VIEW)
    expect(r.curved).toBe(false)
    expect(Number.isNaN(r.looLinearPx)).toBe(true)
  })
})

describe('accuracy: fixation averaging', () => {
  const fc = { fixationMs: 250, fixationRadiusPx: 90 }
  it('a stare with 30 px jitter is averaged to less than half of it; a saccade resets at once', () => {
    let s = createFixation()
    let seed = 3
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 - 0.5 }
    const errs: number[] = []
    for (let i = 0; i < 90; i++) {
      const r = stepFixation(s, 300 + rnd() * 60, -100 + rnd() * 60, i * FRAME, fc)
      s = r.state
      if (i > 10) errs.push(Math.hypot(r.x - 300, r.y + 100))
      if (i > 10) expect(r.n).toBeGreaterThanOrEqual(6)
    }
    const rms = Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length)
    expect(rms).toBeLessThan(12) // raw uniform ±30 px jitter has rms ≈ 24 px
    // saccade: the next point is far away - it stands alone immediately
    const j = stepFixation(s, 900, 200, 91 * FRAME, fc)
    expect(j.n).toBe(1)
    expect(j.x).toBe(900)
  })
})

describe('accuracy: blink freeze', () => {
  it('a blink holds the gaze point instead of dragging it', () => {
    const c: EyeConfig = { ...EYE_DEFAULTS, enabled: true, mode: 'point' }
    // during a real blink the lids drag the eyeLook* blendshapes too: noisyBlend
    const script = (t: number) =>
      t >= 1000 && t < 1150
        ? syntheticFace({ yaw: 6, irisX: 0.4, blinkL: 1, blinkR: 1, noisyBlend: true })
        : syntheticFace({ yaw: 6, irisX: 0.4 })
    const { ch } = run(c, script, 30) // to t = 1000
    const before = ch.telemetry.gazeX
    const xs: number[] = []
    for (let t = 1000; t < 1200; t += FRAME) {
      ch.process(script(t), t, ctx())
      xs.push(ch.telemetry.gazeX)
    }
    for (const x of xs) expect(Math.abs(x - before)).toBeLessThan(2)
    // and without the freeze the blink DOES move it (the property the freeze exists for)
    const cNo = { ...c, blinkFreeze: false }
    const { ch: ch2 } = run(cNo, script, 30)
    const before2 = ch2.telemetry.gazeX
    let moved = 0
    for (let t = 1000; t < 1200; t += FRAME) {
      ch2.process(script(t), t, ctx())
      moved = Math.max(moved, Math.abs(ch2.telemetry.gazeX - before2))
    }
    expect(moved).toBeGreaterThan(2)
  })
})

// ── accuracy pass 2: learning from confirms, two iris sources, growing fixation ──

describe('accuracy: the fit weighs the two iris sources by the data', () => {
  it('trusts the clean source when the other is noise', () => {
    const c = { ...EYE_DEFAULTS, enabled: true }
    const targets9 = calibrationTargets(VIEW, 0.65, true)
    const dflt = (f: GazeFeatures) => screenPointFrom(f, c, VIEW, null)
    // geometric iris is garbage on this camera (glasses); the blendshapes are good
    const glasses: CalibrationSample[] = targets9.map((t, i) => ({
      features: feat({
        headYaw: (t.x - 720) / 150, headPitch: (t.y - 450) / -140,
        irisX: (((i * 7) % 5) - 2) * 0.15, irisY: (((i * 3) % 5) - 2) * 0.1, // noise, unrelated to the target
        blendX: (t.x - 720) / 1500, blendY: (t.y - 450) / -1400,
        ok: true,
      }),
      target: t,
    }))
    const r = fitCalibrationReport(glasses, c, dflt, 1e-3, VIEW)
    expect(r.accepted).toBe(true)
    expect(r.residualPx).toBeLessThan(15)
    // the geometric gains are tiny next to the blendshape gains
    expect(Math.abs(r.cal!.x[2])).toBeLessThan(Math.abs(r.cal!.x[3]) * 0.1)
    expect(Math.abs(r.cal!.y[2])).toBeLessThan(Math.abs(r.cal!.y[3]) * 0.1)
    // and the reverse camera, where the blendshapes are the noise
    const contacts: CalibrationSample[] = glasses.map((g) => ({
      features: { ...g.features, irisX: g.features.blendX, blendX: g.features.irisX, irisY: g.features.blendY, blendY: g.features.irisY },
      target: g.target,
    }))
    const r2 = fitCalibrationReport(contacts, c, dflt, 1e-3, VIEW)
    expect(r2.residualPx).toBeLessThan(15)
    expect(Math.abs(r2.cal!.x[3])).toBeLessThan(Math.abs(r2.cal!.x[2]) * 0.1)
  })
})

describe('accuracy: learning from confirms', () => {
  const c = { ...EYE_DEFAULTS, enabled: true }
  const dflt = (f: GazeFeatures) => screenPointFrom(f, c, VIEW, null)
  /** the true map of a user whose head has since shifted: a constant 90 px offset */
  const user = (x: number, y: number, drift = 0): CalibrationSample => ({
    features: feat({ headYaw: (x - drift - 720) / 120, headPitch: (y - 450) / -110, irisX: (x - drift - 720) / 2000, irisY: (y - 450) / -2400, blendX: (x - drift - 720) / 2000, blendY: (y - 450) / -2400, ok: true }),
    target: { x, y },
  })

  it('a click may teach only with learnFromClicks, a face, and the iris in play; the gaze flag is separate', () => {
    const face = { facePresent: true, headOnly: false }
    expect(learnAllowed({ learnFromConfirms: true, learnFromClicks: true }, face, 'click')).toBe(true)
    expect(learnAllowed({ learnFromConfirms: true, learnFromClicks: false }, face, 'click')).toBe(false)
    expect(learnAllowed({ learnFromConfirms: false, learnFromClicks: true }, face, 'gaze')).toBe(false)
    expect(learnAllowed({ learnFromConfirms: false, learnFromClicks: true }, face, 'click')).toBe(true)
    expect(learnAllowed({ learnFromConfirms: true, learnFromClicks: true }, { facePresent: false, headOnly: false }, 'click')).toBe(false)
    expect(learnAllowed({ learnFromConfirms: true, learnFromClicks: true }, { facePresent: true, headOnly: true }, 'gaze')).toBe(false)
  })

  it('clicks on the nodes the user meant pull a map that reads 70 px high back down', () => {
    const base = calibrationTargets(VIEW, 0.65, true).map((t) => user(t.x, t.y))
    let s = { ...createOnlineCalibration(), base, cal: fitCalibrationReport(base, c, dflt, 1e-3, VIEW).cal }
    // the user's vertical has drifted: looking at (x, y) now produces the features the base saw at (x, y - 70)
    const drifted = (x: number, y: number): CalibrationSample => ({ features: user(x, y - 70).features, target: { x, y } })
    const probe = drifted(700, 500)
    const before = mapWith(s.cal!, probe.features)
    expect(before.y - 500).toBeLessThan(-50) // reads high
    // the base keeps ~60 % of its weight at six confirms and 20 % at twelve (baseWeight)
    const spots = [[300, 200], [1100, 250], [700, 650], [400, 500], [1000, 700], [800, 350], [500, 300], [1150, 550], [250, 600], [900, 150], [600, 750], [1050, 450]]
    for (const [x, y] of spots.slice(0, 6)) s = learnConfirm(s, drifted(x, y), c, dflt, VIEW).state
    const six = mapWith(s.cal!, probe.features)
    expect(Math.abs(six.y - 500)).toBeLessThan(Math.abs(before.y - 500) / 2)
    for (const [x, y] of spots.slice(6)) s = learnConfirm(s, drifted(x, y), c, dflt, VIEW).state
    const twelve = mapWith(s.cal!, probe.features)
    expect(Math.abs(twelve.y - 500)).toBeLessThan(15)
    expect(Math.abs(twelve.x - 700)).toBeLessThan(15)
  })

  it('an explicit base plus confirms tracks a head shift the base could not see', () => {
    const base = calibrationTargets(VIEW, 0.65, true).map((t) => user(t.x, t.y))
    let s = { ...createOnlineCalibration(), base, cal: fitCalibrationReport(base, c, dflt, 1e-3, VIEW).cal }
    const probe = user(1000, 300, 90)
    const before = mapWith(s.cal!, probe.features)
    expect(Math.abs(before.x - 1000)).toBeGreaterThan(60) // the shifted head reads ~90 px off
    // the user confirms nodes around the screen with the shifted head
    const spots = [[300, 200], [1100, 250], [700, 650], [400, 500], [1000, 700], [800, 350], [500, 300], [1150, 550]]
    let changed = 0
    for (const [x, y] of spots) {
      const r = learnConfirm(s, user(x, y, 90), c, dflt, VIEW)
      s = r.state
      if (r.changed) changed++
    }
    expect(changed).toBeGreaterThan(0)
    const after = mapWith(s.cal!, probe.features)
    expect(Math.abs(after.x - 1000)).toBeLessThan(Math.abs(before.x - 1000) / 2)
    expect(s.learned.length).toBe(spots.length)
  })

  it('a wrong confirm is dropped as an outlier and does not poison the map', () => {
    const base = calibrationTargets(VIEW, 0.65, true).map((t) => user(t.x, t.y))
    let s = { ...createOnlineCalibration(), base, cal: fitCalibrationReport(base, c, dflt, 1e-3, VIEW).cal }
    const good = [[300, 200], [1100, 250], [700, 650], [400, 500]].map(([x, y]) => user(x, y))
    for (const g of good) s = learnConfirm(s, g, c, dflt, VIEW).state
    // a confirm 400 px from where the eyes were
    const wrong: CalibrationSample = { features: user(300, 300).features, target: { x: 700, y: 300 } }
    const r = learnConfirm(s, wrong, c, dflt, VIEW)
    s = r.state
    expect(s.rejected).toBe(1)
    expect(s.learned.some((l) => l.target.x === 700 && l.target.y === 300)).toBe(false)
    const probe = user(900, 400)
    const p = mapWith(s.cal!, probe.features)
    expect(Math.hypot(p.x - 900, p.y - 400)).toBeLessThan(20)
  })

  it('without an explicit run, a map appears only after learnMinSamples confirms, and the store is capped', () => {
    let s = createOnlineCalibration()
    const cfg = { ...c, learnMinSamples: 6, learnMaxSamples: 10 }
    const spots = Array.from({ length: 14 }, (_, i) => [200 + ((i * 97) % 1000), 150 + ((i * 61) % 600)])
    for (let i = 0; i < spots.length; i++) {
      const [x, y] = spots[i]
      s = learnConfirm(s, user(x, y), cfg, dflt, VIEW).state
      if (i + 1 < 6) expect(s.cal).toBeNull()
    }
    expect(s.cal).not.toBeNull()
    expect(s.learned.length).toBe(10)
    const probe = user(640, 420)
    const p = mapWith(s.cal!, probe.features)
    expect(Math.hypot(p.x - 640, p.y - 420)).toBeLessThan(20)
  })
})

describe('accuracy: the fixation window grows while the stare holds', () => {
  it('starts at fixationMs, reaches fixationMaxMs, and a saccade resets it', () => {
    const fc = { fixationMs: 250, fixationMaxMs: 500, fixationRadiusPx: 90 }
    let s = createFixation()
    let w = 0
    let n = 0
    for (let i = 0; i < 40; i++) {
      const r = stepFixation(s, 300 + (i % 3) * 5, -100, i * FRAME, fc)
      s = r.state
      w = r.windowMs
      n = r.n
      if (i === 9) {
        expect(w).toBeGreaterThanOrEqual(250)
        expect(w).toBeLessThan(400)
      }
    }
    expect(w).toBe(500)
    expect(n).toBeGreaterThanOrEqual(14) // ~15 frames in half a second
    const j = stepFixation(s, 900, 300, 41 * FRAME, fc)
    expect(j.n).toBe(1)
    expect(j.windowMs).toBe(250)
  })
})

describe('clickless confirm: eyes closed', () => {
  const c: EyeConfig = { ...EYE_DEFAULTS, enabled: true, mode: 'point' }
  it('counts a deliberate closure; a blink never reaches the confirm', () => {
    // eyes shut from 1000 ms to 2100 ms (open again past closeGraceMs by 2500), with a 150 ms blink earlier
    const script = (t: number) =>
      (t >= 400 && t < 550) || (t >= 1000 && t < 2100)
        ? syntheticFace({ yaw: 6, blinkL: 0.9, blinkR: 0.9 })
        : syntheticFace({ yaw: 6 })
    const ch = createEyeChannel(c)
    let blinkMax = 0
    let shutMax = 0
    for (let t = 0; t < 2500; t += FRAME) {
      ch.process(script(t), t, ctx())
      if (t < 900) blinkMax = Math.max(blinkMax, ch.telemetry.eyesShutMs)
      else if (t < 2100) shutMax = Math.max(shutMax, ch.telemetry.eyesShutMs)
    }
    expect(blinkMax).toBeLessThan(c.closeConfirmMs)
    expect(shutMax).toBeGreaterThanOrEqual(c.closeConfirmMs)
    expect(ch.telemetry.eyesShutMs).toBe(0) // open again
  })
  it("Sam's closure: right eye only 0.46, one frame flickering open - still reaches the confirm", () => {
    // rest.json: open 0.22/0.20; a full blink peaked 0.74/0.54 then 0.68/0.48.
    // A fixed 0.5 floor never held for a second on that right eye.
    const ch = createEyeChannel(c)
    let t = 0
    for (; t < 2000; t += FRAME) ch.process(syntheticFace({ yaw: 6, blinkL: 0.22, blinkR: 0.2 }), t, ctx())
    let shutMax = 0
    for (let k = 0; t < 3500; t += FRAME, k++) {
      const flicker = k === 15 // one frame open, mid-closure
      ch.process(syntheticFace({ yaw: 6, blinkL: flicker ? 0.22 : 0.7, blinkR: flicker ? 0.2 : 0.46 }), t, ctx())
      shutMax = Math.max(shutMax, ch.telemetry.eyesShutMs)
    }
    expect(shutMax).toBeGreaterThanOrEqual(c.closeConfirmMs)
  })
  it('looking down (lids at 0.34, Sam\'s vertical clip max) is not a closure', () => {
    const ch = createEyeChannel(c)
    let t = 0
    for (; t < 2000; t += FRAME) ch.process(syntheticFace({ yaw: 6, blinkL: 0.22, blinkR: 0.2 }), t, ctx())
    for (; t < 4000; t += FRAME) ch.process(syntheticFace({ yaw: 6, irisY: 0.4, blinkL: 0.34, blinkR: 0.34 }), t, ctx())
    expect(ch.telemetry.eyesShutMs).toBe(0)
  })
  it('one eye shut (a wink) or a lost face does not count', () => {
    const ch = createEyeChannel(c)
    for (let t = 0; t < 1500; t += FRAME) ch.process(syntheticFace({ yaw: 6, blinkL: 0.9 }), t, ctx())
    expect(ch.telemetry.eyesShutMs).toBe(0)
    for (let t = 1500; t < 2500; t += FRAME) ch.process(syntheticFace({ yaw: 6, blinkL: 0.9, blinkR: 0.9 }), t, ctx())
    expect(ch.telemetry.eyesShutMs).toBeGreaterThan(900)
    ch.process(null, 2500, ctx())
    expect(ch.telemetry.eyesShutMs).toBe(0)
  })
})

describe('clickless confirm: voice', () => {
  it('"open" as a whole word, anywhere in the phrase', () => {
    expect(heardOpen('open')).toBe(true)
    expect(heardOpen(' Open it')).toBe(true)
    expect(heardOpen('okay open')).toBe(true)
    expect(heardOpen('opened')).toBe(false)
    expect(heardOpen('reopen')).toBe(false)
    expect(heardOpen('close')).toBe(false)
  })
  it('"leave" (and its common mishearing "leaf") as a whole word', () => {
    expect(heardLeave('leave')).toBe(true)
    expect(heardLeave('Leave it')).toBe(true)
    expect(heardLeave('leaf')).toBe(true)
    expect(heardLeave('leaves')).toBe(false)
    expect(heardLeave('open')).toBe(false)
  })
})

describe('re-centre', () => {
  const rc = { recentreMinSamples: 5, recentreMaxPx: 450 }
  const centre = { x: 720, y: 450 }
  it('the median of the samples moves onto the centre; a glance away does not drag it', () => {
    // drill 3's shape: everything ~196 px left and ~50 px low of the ring
    const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ x: 524 + (i % 3) * 4, y: 500 + (i % 2) * 6 }))
    pts.push({ x: 1300, y: 100 }) // a glance at the corner mid-window
    const r = recentreOffset(pts, centre, { x: 0, y: 0 }, rc)
    if (!('offset' in r)) throw new Error('refused')
    expect(Math.abs(r.offset.x - 192)).toBeLessThan(6)
    expect(Math.abs(r.offset.y - -50)).toBeLessThan(6)
  })
  it('adds to the offset in force (the samples already include it)', () => {
    const pts = Array.from({ length: 8 }, () => ({ x: 700, y: 450 }))
    const r = recentreOffset(pts, centre, { x: 150, y: -30 }, rc)
    if (!('offset' in r)) throw new Error('refused')
    expect(r.offset).toEqual({ x: 170, y: -30 })
    expect(r.shift).toEqual({ x: 20, y: 0 })
  })
  it('refuses too few samples, and a total shift past recentreMaxPx', () => {
    expect(recentreOffset([{ x: 1, y: 1 }], centre, { x: 0, y: 0 }, rc)).toEqual({ error: 'few' })
    const far = Array.from({ length: 8 }, () => ({ x: 100, y: 450 }))
    expect('error' in recentreOffset(far, centre, { x: 0, y: 0 }, rc)).toBe(true)
  })
  it('the channel adds the offset to the gaze point, after the map', () => {
    const c: EyeConfig = { ...EYE_DEFAULTS, enabled: true, mode: 'point' }
    const a = createEyeChannel(c)
    const b = createEyeChannel(c)
    b.offset = { x: 120, y: -40 }
    for (let t = 0; t < 1500; t += FRAME) {
      a.process(syntheticFace({ yaw: 4, irisX: 0.2 }), t, ctx())
      b.process(syntheticFace({ yaw: 4, irisX: 0.2 }), t, ctx())
    }
    expect(b.telemetry.gazeX - a.telemetry.gazeX).toBeCloseTo(120, 0)
    expect(b.telemetry.gazeY - a.telemetry.gazeY).toBeCloseTo(-40, 0)
  })
  it('"centre" / "center" / "recenter" as a whole word', () => {
    expect(heardCentre('centre')).toBe(true)
    expect(heardCentre('Center')).toBe(true)
    expect(heardCentre('recenter please')).toBe(true)
    expect(heardCentre('re-centre')).toBe(true)
    expect(heardCentre('central')).toBe(false)
    expect(heardCentre('open')).toBe(false)
  })
})
