// EYE_ACCURACY_PLAN phases 2-5, headless. Each idea has its own test so the
// replay numbers and these stay attributable to one change.
import { describe, expect, it } from 'vitest'
import { syntheticFace } from '../src/input/eye/__synthetic__/face'
import {
  ageWeight, calibrationTargets, createOnlineCalibration, fitCalibrationReport, learnConfirm,
} from '../src/input/eye/calibration'
import type { CalibrationSample } from '../src/input/eye/calibration'
import { createEyeChannel } from '../src/input/eye/channel'
import type { EyeContext } from '../src/input/eye/channel'
import { EYE_DEFAULTS } from '../src/input/eye/config'
import type { EyeConfig } from '../src/input/eye/config'
import { LM, blendshapeGaze, headPose, irisOffset, screenPointFrom } from '../src/input/eye/face'
import type { FaceFrame, GazeFeatures } from '../src/input/eye/face'
import { formatMetrics, replayRecording } from '../src/input/eye/replay'
import type { EyeRecording } from '../src/input/eye/replay'
import { createGazeFocus, stepGazeFocus } from '../src/neural/gazeFocus'

const VIEW = { w: 1440, h: 900 }
const FRAME = 1000 / 30
const point = (over: Partial<EyeConfig> = {}): EyeConfig => ({ ...EYE_DEFAULTS, enabled: true, mode: 'point', ...over })
const ctx = (): EyeContext => ({ viewport: VIEW, cameraOn: true, reducedMotion: false, shellOpen: false, pointerIdleMs: Infinity })

/** Move one eye's iris landmark to a given deflection on an otherwise synthetic face. */
function withLeftIris(f: FaceFrame, irisX: number): FaceFrame {
  const pts = f.landmarks.map((p) => ({ ...p }))
  const outer = pts[LM.leftOuter]
  const inner = pts[LM.leftInner]
  const half = Math.abs(inner.x - outer.x) / 2
  const cx = (outer.x + inner.x) / 2
  pts[LM.leftIris] = { ...pts[LM.leftIris], x: cx - irisX * half }
  return { ...f, landmarks: pts }
}

describe('phase 2: signal fidelity', () => {
  it('3.2 foreshortening scales the geometric iris by cos(yaw) / cos(pitch)', () => {
    const on = point()
    const off = point({ foreshortening: false })
    const f = syntheticFace({ yaw: 30, pitch: 20, irisX: 0.5, irisY: -0.4 })
    const head = headPose(f, on)
    const a = irisOffset(f, on, head, blendshapeGaze(f.blendshapes))
    const b = irisOffset(f, off, head, blendshapeGaze(f.blendshapes))
    expect(b.x).toBeCloseTo(0.5, 1)
    expect(a.x).toBeCloseTo(0.5 * Math.cos((30 * Math.PI) / 180), 2)
    expect(a.y).toBeCloseTo(-0.4 * Math.cos((20 * Math.PI) / 180), 2)
  })

  it('3.6 eyes are weighted by openness; 3.8 a disagreeing eye is dropped in favour of the blendshapes', () => {
    const c = point({ vergenceMax: 1 }) // vergence off: quality-weighted mean
    const f = withLeftIris(syntheticFace({ irisX: 0.4 }), 0.8)
    const blend = blendshapeGaze(f.blendshapes)
    const head = headPose(f, c)
    const equal = irisOffset(f, { ...c, eyeQualityWeights: false }, head, blend)
    expect(equal.x).toBeCloseTo(0.6, 1) // plain mean of 0.8 and 0.4
    // the left eye half-closed (blink 0.25, still under the iris threshold): it counts less
    const halfL = { ...f, blendshapes: { ...f.blendshapes, eyeBlinkLeft: 0.25 } }
    const weighted = irisOffset(halfL, c, head, blend)
    expect(weighted.x).toBeLessThan(equal.x)
    expect(weighted.x).toBeGreaterThan(0.4)
    // vergence: L 0.8 vs R 0.4 disagree by 0.4 > 0.3 -> the eye farther from the blendshapes (0.4) is dropped
    const v = irisOffset(f, point(), head, blend)
    expect(v.vergenceDrop).toBe('L')
    expect(v.x).toBeCloseTo(0.4, 1)
  })

  it('2.8 the iris is rejected early on the way down, and the first frame after reopening is held', () => {
    const c = point()
    const halfShut = syntheticFace({ irisX: 0.3, blinkL: 0.4, blinkR: 0.4 })
    const o = irisOffset(halfShut, c, headPose(halfShut, c), blendshapeGaze(halfShut.blendshapes))
    expect(o.okL || o.okR).toBe(false) // 0.4 > blinkIrisThreshold 0.3, though < blinkThreshold 0.5
    // post-blink hold: the frame after the eyes reopen keeps the pre-blink features
    const script = (t: number) =>
      t >= 1000 && t < 1100
        ? syntheticFace({ irisX: 0.3, blinkL: 1, blinkR: 1, noisyBlend: true })
        : t < 1000
          ? syntheticFace({ irisX: 0.3 })
          : syntheticFace({ irisX: -0.6, noisyBlend: true }) // a wild reopen frame
    const ch = createEyeChannel(c)
    let t = 0
    for (; t < 1100; t += FRAME) ch.process(script(t), t, ctx())
    ch.process(script(t), t, ctx()) // first frame after the blink: held
    expect(ch.telemetry.rawFeatures.irisX).toBeCloseTo(0.3, 1)
    t += FRAME
    ch.process(script(t), t, ctx()) // second frame: live again
    expect(ch.telemetry.rawFeatures.irisX).toBeCloseTo(-0.6, 1)
  })
})

describe('phase 3: steadiness', () => {
  it('2.3 median-of-3 removes a single-frame spike the filter would smear', () => {
    const spike = (t: number) => syntheticFace({ yaw: Math.abs(t - 1000) < FRAME / 2 ? 25 : 0 })
    const run = (c: EyeConfig) => {
      const ch = createEyeChannel(c)
      let maxYaw = 0
      for (let t = 0; t < 2000; t += FRAME) {
        ch.process(spike(t), t, ctx())
        if (t > 500) maxYaw = Math.max(maxYaw, Math.abs(ch.telemetry.yaw))
      }
      return maxYaw
    }
    const withMedian = run(point({ freezeEnabled: false }))
    const without = run(point({ freezeEnabled: false, medianPrefilter: false }))
    expect(withMedian).toBeLessThan(0.5)
    expect(without).toBeGreaterThan(2)
  })

  it('2.4 the head is followed faster than the iris (separate cutoffs)', () => {
    const c = point({ freezeEnabled: false, medianPrefilter: false, beta: 0 })
    const settle = (script: (t: number) => FaceFrame, read: (f: GazeFeatures) => number, target: number) => {
      const ch = createEyeChannel(c)
      for (let t = 0; t < 1000; t += FRAME) ch.process(script(t), t, ctx())
      let at = -1
      for (let t = 1000; t < 3000; t += FRAME) {
        ch.process(script(t), t, ctx())
        if (at < 0 && Math.abs(read(ch.telemetry.features) - target) < 0.1 * Math.abs(target)) at = t - 1000
      }
      return at
    }
    const headSettle = settle((t) => syntheticFace({ yaw: t >= 1000 ? 10 : 0 }), (f) => f.headYaw, 10)
    const irisSettle = settle((t) => syntheticFace({ irisX: t >= 1000 ? 0.5 : 0 }), (f) => f.irisX, 0.5)
    expect(headSettle).toBeGreaterThan(0)
    expect(irisSettle).toBeGreaterThan(headSettle)
  })

  it('2.5 the speed-gated freeze holds a resting point dead-still and lets a saccade through', () => {
    const c = point()
    const ch = createEyeChannel(c)
    let seed = 11
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 - 0.5 }
    const xs: number[] = []
    for (let t = 0; t < 2000; t += FRAME) {
      ch.process(syntheticFace({ yaw: 5 + rnd() * 0.6, irisX: 0.2 + rnd() * 0.03 }), t, ctx())
      if (t > 1000) xs.push(ch.telemetry.gazeX)
    }
    expect(ch.telemetry.frozen).toBe(true)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1e-9) // dead-still
    const before = ch.telemetry.gazeX
    for (let t = 2000; t < 2600; t += FRAME) ch.process(syntheticFace({ yaw: 14, irisX: 0.2 }), t, ctx())
    expect(ch.telemetry.gazeX - before).toBeGreaterThan(200) // the saccade released it
  })
})

describe('phase 4: the map', () => {
  const c = point()
  const dflt = (f: GazeFeatures) => screenPointFrom(f, c, VIEW, null)
  it('the wide model is kept when one eye is noise and the other is good, and beats the base', () => {
    const targets = [...calibrationTargets(VIEW, 0.65, true), ...calibrationTargets(VIEW, 0.3, true).slice(1)]
    const samples: CalibrationSample[] = targets.map((t, i) => {
      const a = (t.x - 720) / 720
      const b = (t.y - 450) / 450
      const nL = (((i * 7) % 5) - 2) * 0.12 // the left eye is junk on this camera
      const eyeLX = 0.35 * a + nL, eyeLY = 0.2 * b + nL
      const eyeRX = 0.35 * a, eyeRY = 0.2 * b
      return {
        features: {
          headYaw: 6 * a, headPitch: -4 * b,
          irisX: (eyeLX + eyeRX) / 2, irisY: (eyeLY + eyeRY) / 2, blendX: (eyeLX + eyeRX) / 2, blendY: (eyeLY + eyeRY) / 2,
          eyeLX, eyeLY, eyeRX, eyeRY, blendLX: eyeLX, blendLY: eyeLY, blendRX: eyeRX, blendRY: eyeRY, ok: true,
        },
        target: t,
      }
    })
    const r = fitCalibrationReport(samples, c, dflt, 1e-3, VIEW)
    expect(r.wide).toBe(true)
    expect(r.cal!.model).toBe('wide')
    expect(r.looWidePx).toBeLessThan(r.looLinearPx) // looLinearPx is now the wide LOO; base was worse
    const base = fitCalibrationReport(samples, { ...c, wideModel: false }, dflt, 1e-3, VIEW)
    expect(r.residualPx).toBeLessThan(base.residualPx * 0.5)
  })
  it('never tries the wide model under 14 samples', () => {
    const targets = calibrationTargets(VIEW, 0.65, true)
    const samples: CalibrationSample[] = targets.map((t) => {
      const a = (t.x - 720) / 720, b = (t.y - 450) / 450
      return { features: { headYaw: 6 * a, headPitch: -4 * b, irisX: 0.35 * a, irisY: 0.2 * b, blendX: 0.35 * a, blendY: 0.2 * b, eyeLX: 0.35 * a, eyeLY: 0.2 * b, eyeRX: 0.35 * a, eyeRY: 0.2 * b, blendLX: 0.35 * a, blendLY: 0.2 * b, blendRX: 0.35 * a, blendRY: 0.2 * b, ok: true }, target: t }
    })
    const r = fitCalibrationReport(samples, c, dflt, 1e-3, VIEW)
    expect(r.wide).toBe(false)
    expect(Number.isNaN(r.looWidePx)).toBe(true)
  })
  it('learned samples decay with age: half weight at the half-life, floor 0.3', () => {
    expect(ageWeight(0, 3)).toBe(1)
    expect(ageWeight(3 * 60_000, 3)).toBeCloseTo(0.5, 6)
    expect(ageWeight(60 * 60_000, 3)).toBe(0.3)
    expect(ageWeight(1e9, 0)).toBe(1)
    // an old drift and a new drift: the map follows the NEW one
    const user = (x: number, y: number, drift: number, t: number): CalibrationSample => ({
      features: { headYaw: (x - drift - 720) / 120, headPitch: (y - 450) / -110, irisX: (x - drift - 720) / 2000, irisY: (y - 450) / -2400, blendX: (x - drift - 720) / 2000, blendY: (y - 450) / -2400, eyeLX: (x - drift - 720) / 2000, eyeLY: (y - 450) / -2400, eyeRX: (x - drift - 720) / 2000, eyeRY: (y - 450) / -2400, blendLX: (x - drift - 720) / 2000, blendLY: (y - 450) / -2400, blendRX: (x - drift - 720) / 2000, blendRY: (y - 450) / -2400, ok: true },
      target: { x, y }, t,
    })
    let s = createOnlineCalibration()
    const cfg = { ...c, learnMinSamples: 6, learnDecayMin: 2 }
    const spots = [[300, 200], [1100, 250], [700, 650], [400, 500], [1000, 700], [800, 350], [500, 300], [1150, 550]]
    let t = 0
    for (const [x, y] of spots) { s = learnConfirm(s, user(x, y, -80, t), cfg, dflt, VIEW, t).state; t += 5000 }
    t += 20 * 60_000 // twenty minutes later the head has shifted the other way
    for (const [x, y] of spots) { s = learnConfirm(s, user(x, y, 80, t), cfg, dflt, VIEW, t).state; t += 5000 }
    const probe = user(900, 400, 80, t)
    const p = screenPointFrom(probe.features, c, VIEW, s.cal)
    expect(Math.abs(p.x - 900)).toBeLessThan(50) // follows the recent drift (an unweighted mix would be ~80 px off)
  })
})

describe('phase 5: the selector', () => {
  it('a near-tie between neighbours stays with the focused node (switch margin)', () => {
    const fc = { holdMs: 120, releaseFactor: 1.6, switchMargin: 0.8 }
    const A = (d: number) => ({ name: 'A', dist: d, r: 80 })
    const B = (d: number) => ({ name: 'B', dist: d, r: 80 })
    let s = createGazeFocus()
    for (let t = 0; t < 300; t += FRAME) s = stepGazeFocus(s, [A(20), B(60)], t, fc)
    expect(s.name).toBe('A')
    // B slightly better (score 0.45 vs A 0.5): not by the margin -> no switch, ever
    for (let t = 300; t < 1500; t += FRAME) s = stepGazeFocus(s, [A(40), B(36)], t, fc)
    expect(s.name).toBe('A')
    // B clearly better (0.3 vs 0.5) -> switches after holdMs
    for (let t = 1500; t < 1500 + 120 + 2 * FRAME; t += FRAME) s = stepGazeFocus(s, [A(40), B(24)], t, fc)
    expect(s.name).toBe('B')
  })
})

describe('phase 1: the replay harness on synthetic recordings', () => {
  const rest = (jitterYaw: number, frames = 300): EyeRecording => {
    let seed = 5
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 - 0.5 }
    const c = point()
    const out: EyeRecording = { frames: [], viewport: VIEW, label: 'rest' }
    for (let i = 0; i < frames; i++) {
      const f = syntheticFace({ yaw: 3 + rnd() * jitterYaw, pitch: -1 + rnd() * jitterYaw * 0.6, irisX: 0.1 + rnd() * 0.04, irisY: rnd() * 0.04 })
      const head = headPose(f, c)
      const blend = blendshapeGaze(f.blendshapes)
      const iris = irisOffset(f, c, head, blend)
      const raw = { headYaw: head.yaw, headPitch: head.pitch, irisX: iris.x, irisY: iris.y, blendX: blend.x, blendY: blend.y, eyeLX: iris.L.x, eyeLY: iris.L.y, eyeRX: iris.R.x, eyeRY: iris.R.y, blendLX: blend.L.x, blendLY: blend.L.y, blendRX: blend.R.x, blendRY: blend.R.y, ok: true }
      out.frames.push({ t: i * FRAME, raw, blinkL: 0, blinkR: 0, okL: true, okR: true, confidence: 1, headOk: true })
    }
    return out
  }
  it('reports rest jitter, and the pipeline cuts it', () => {
    const m = replayRecording(rest(1.5), point())
    expect(m.frames).toBeGreaterThan(250)
    expect(m.restJitterRawPx).toBeGreaterThan(20)
    expect(m.restJitterPx).toBeLessThan(m.restJitterRawPx / 2)
    expect(m.frozenFraction).toBeGreaterThan(0.5)
    expect(formatMetrics(m)).toContain('rest jitter')
  })
  it('reports saccade response and settle against ground truth', () => {
    const c = point()
    const rec: EyeRecording = { frames: [], viewport: VIEW, label: 'saccades', truth: [] }
    const targets = [[720, 450], [1100, 450], [340, 450], [720, 200]]
    let t = 0
    for (const [x, y] of targets) {
      rec.truth!.push({ t, x, y })
      for (let i = 0; i < 45; i++, t += FRAME) {
        // the user's eyes on the target: through the default map inverse (head only, iris 0)
        const yaw = (x - 720) / c.pxPerDeg
        const pitch = (450 - y) / c.pxPerDeg
        const f = syntheticFace({ yaw, pitch })
        const head = headPose(f, c)
        const blend = blendshapeGaze(f.blendshapes)
        const iris = irisOffset(f, c, head, blend)
        rec.frames.push({ t, raw: { headYaw: head.yaw, headPitch: head.pitch, irisX: iris.x, irisY: iris.y, blendX: blend.x, blendY: blend.y, eyeLX: iris.L.x, eyeLY: iris.L.y, eyeRX: iris.R.x, eyeRY: iris.R.y, blendLX: blend.L.x, blendLY: blend.L.y, blendRX: blend.R.x, blendRY: blend.R.y, ok: true }, blinkL: 0, blinkR: 0, okL: true, okR: true, confidence: 1, headOk: true })
      }
    }
    const m = replayRecording(rec, c)
    expect(m.saccadeResponse).toBeGreaterThan(0.85)
    expect(m.saccadeSettleMs).toBeLessThan(300)
    expect(m.truthErrorPx).toBeLessThan(120) // the transitions count against it
  })
})
