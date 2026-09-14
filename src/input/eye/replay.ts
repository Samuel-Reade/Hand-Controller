// Replay harness (plan phase 1): run a recording of raw frames through the
// pure pipeline and produce the numbers every accuracy idea is judged by.
// Pure - no DOM, no MediaPipe. tests/eyeReplay.test.ts runs it on synthetic
// recordings; `recordings/*.json` (dev, never shipped) are the real ones.

import { createEyeChannel, createEyeTelemetry } from './channel'
import type { EyeContext, EyeRecordFrame } from './channel'
import type { EyeConfig } from './config'
import type { FaceFrame } from './face'
import { syntheticFace } from './__synthetic__/face'

export interface EyeRecording {
  /** what the recorder wrote: raw features per frame at detector rate */
  frames: EyeRecordFrame[]
  viewport: { w: number; h: number }
  /** free text: "rest", "horizontal saccades", ... */
  label?: string
  /** optional ground truth for saccade clips: the screen points looked at, in order, with times */
  truth?: { t: number; x: number; y: number }[]
}

export interface ReplayMetrics {
  frames: number
  /** rms of the point about its own mean, px - raw (unfiltered) and filtered */
  restJitterRawPx: number
  restJitterPx: number
  /** per-axis filtered rms */
  restJitterXPx: number
  restJitterYPx: number
  /** with `truth` (>= 2 points): fraction of the true excursion the filtered point covers, and settle ms */
  saccadeResponse: number
  saccadeSettleMs: number
  /** with `truth`: rms distance from the filtered point to the truth point over the clip */
  truthErrorPx: number
  /** how often the point was held by the freeze */
  frozenFraction: number
  /** mean head-only vs full point distance: how much the eyes contribute */
  eyeContributionPx: number
}

/**
 * A recording's frames carry RAW features; the channel expects FaceFrames.
 * We rebuild synthetic faces that reproduce those features exactly, so the
 * whole channel (median, filters, map, freeze) runs unchanged.
 */
function faceFor(rec: EyeRecordFrame, cfg: EyeConfig): FaceFrame {
  void cfg
  const f = rec.raw
  return syntheticFace(
    {
      yaw: f.headYaw, pitch: f.headPitch,
      irisX: f.irisX, irisY: f.irisY,
      blinkL: rec.blinkL, blinkR: rec.blinkR,
      presence: rec.confidence > 0 ? 1 : 0,
    },
    rec.t,
  )
}

const rms = (a: number[]) => {
  if (a.length === 0) return 0
  const m = a.reduce((s, v) => s + v, 0) / a.length
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)
}

export function replayRecording(recording: EyeRecording, cfg: EyeConfig): ReplayMetrics {
  const telemetry = createEyeTelemetry()
  const ch = createEyeChannel({ ...cfg, enabled: true, mode: 'point' }, telemetry)
  const ctx: EyeContext = {
    viewport: recording.viewport, cameraOn: true, reducedMotion: false, shellOpen: false, pointerIdleMs: Infinity,
  }
  const filtered: { t: number; x: number; y: number }[] = []
  const raw: { x: number; y: number }[] = []
  let frozenFrames = 0
  let eyeSum = 0
  for (const rec of recording.frames) {
    ch.process(faceFor(rec, cfg), rec.t, ctx)
    if (!telemetry.facePresent) continue
    filtered.push({ t: rec.t, x: telemetry.gazeX, y: telemetry.gazeY })
    raw.push({ x: telemetry.rawX, y: telemetry.rawY })
    if (telemetry.frozen) frozenFrames++
    eyeSum += Math.hypot(telemetry.gazeX - telemetry.headX, telemetry.gazeY - telemetry.headY)
  }
  const n = filtered.length
  const jx = rms(filtered.map((p) => p.x))
  const jy = rms(filtered.map((p) => p.y))
  const out: ReplayMetrics = {
    frames: n,
    restJitterRawPx: Math.hypot(rms(raw.map((p) => p.x)), rms(raw.map((p) => p.y))),
    restJitterPx: Math.hypot(jx, jy),
    restJitterXPx: jx,
    restJitterYPx: jy,
    saccadeResponse: NaN,
    saccadeSettleMs: NaN,
    truthErrorPx: NaN,
    frozenFraction: n ? frozenFrames / n : 0,
    eyeContributionPx: n ? eyeSum / n : 0,
  }
  const truth = recording.truth
  if (truth && truth.length >= 2) {
    // truth error: distance to the truth point in force at each frame
    let se = 0
    let responses: number[] = []
    let settles: number[] = []
    for (const p of filtered) {
      let ti = 0
      while (ti + 1 < truth.length && truth[ti + 1].t <= p.t) ti++
      se += (p.x - truth[ti].x) ** 2 + (p.y - truth[ti].y) ** 2
    }
    out.truthErrorPx = Math.sqrt(se / Math.max(1, n))
    // saccade response: for each truth step, how far the point moved
    // toward the new target (fraction of the step) and when it got within
    // 20 % of it
    for (let i = 1; i < truth.length; i++) {
      const a = truth[i - 1]
      const b = truth[i]
      const step = Math.hypot(b.x - a.x, b.y - a.y)
      if (step < 1) continue
      const before = filtered.filter((p) => p.t >= b.t - 300 && p.t < b.t)
      const after = filtered.filter((p) => p.t >= b.t + 400 && p.t < (truth[i + 1]?.t ?? Infinity))
      if (!before.length || !after.length) continue
      const mean = (ps: typeof filtered) => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length })
      const m0 = mean(before)
      const m1 = mean(after)
      const moved = ((m1.x - m0.x) * (b.x - a.x) + (m1.y - m0.y) * (b.y - a.y)) / step
      responses.push(moved / step)
      const settled = filtered.find((p) => p.t >= b.t && Math.hypot(p.x - m1.x, p.y - m1.y) <= 0.2 * step)
      if (settled) settles.push(settled.t - b.t)
    }
    responses = responses.filter((r) => Number.isFinite(r))
    settles = settles.filter((s) => Number.isFinite(s))
    out.saccadeResponse = responses.length ? responses.reduce((s, r) => s + r, 0) / responses.length : NaN
    out.saccadeSettleMs = settles.length ? settles.reduce((s, r) => s + r, 0) / settles.length : NaN
  }
  return out
}

/** A one-line summary for consoles and logs. */
export function formatMetrics(m: ReplayMetrics): string {
  const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-')
  return (
    `frames ${m.frames} · rest jitter raw ${f(m.restJitterRawPx)} / filtered ${f(m.restJitterPx)} px ` +
    `(x ${f(m.restJitterXPx)} y ${f(m.restJitterYPx)}) · saccade response ${f(m.saccadeResponse, 2)} settle ${f(m.saccadeSettleMs, 0)} ms ` +
    `· truth error ${f(m.truthErrorPx)} px · frozen ${f(m.frozenFraction * 100, 0)} % · eye contribution ${f(m.eyeContributionPx)} px`
  )
}
