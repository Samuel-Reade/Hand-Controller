// Gaze pipeline, pure half (ORB_EYE_SPEC §3): landmarks -> head pose ->
// iris offset -> gaze angles -> screen point. No MediaPipe imports; every
// function here runs headless against synthetic faces (tests/eye.test.ts).
//
// Units: degrees for angles, CSS px for screen points. +yaw = the user
// looks to THEIR right, +pitch = the user looks up. Landmark coordinates are
// MediaPipe's normalised image coords (x right in the IMAGE, y down); the
// camera feed is mirrored to the user, so "the user's right" is -x in the
// image - the one place that flip lives is `mirror` below (§3: "flip in one
// place").
//
// Honest about the numbers: head pose from the mesh is steady to ~1°;
// uncalibrated iris offset is worth ±2-4° of noise (est.). The iris is a
// bounded refinement on head pose, never the signal (§2 LOCKED).

import type { EyeConfig } from './config'

export interface Landmark3 {
  x: number
  y: number
  z?: number
}

export interface FaceFrame {
  /** ms timestamp */
  t: number
  /** 478 normalised landmarks (only the 13 the pipeline reads need be real) */
  landmarks: readonly Landmark3[]
  /** blendshape name -> 0..1 */
  blendshapes: Readonly<Record<string, number>>
  /** face presence 0..1 */
  presence: number
  /** FaceLandmarker's facialTransformationMatrixes[0], 4x4 column-major; optional */
  transform?: ArrayLike<number>
}

// ── Landmark indices (MediaPipe face mesh) ─────────────────────────────────
export const LM = {
  noseTip: 1,
  chin: 152,
  // left eye (the user's left = image right after mirroring; MediaPipe's
  // "left eye" indices are the subject's left)
  leftOuter: 33, leftInner: 133, leftUpper: 159, leftLower: 145, leftIris: 468,
  // right eye
  rightOuter: 263, rightInner: 362, rightUpper: 386, rightLower: 374, rightIris: 473,
} as const

const DEG = 180 / Math.PI
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Image-x -> the user's frame: the feed is mirrored, so right is -x. */
const mirror = (dx: number) => -dx

// ── Head pose ──────────────────────────────────────────────────────────────

export interface HeadPose {
  yaw: number
  pitch: number
  roll: number
  /** within the usable cone (§3: the mesh degrades sharply past ~35°) */
  ok: boolean
  /** which path produced it */
  source: 'transform' | 'landmarks'
}

/**
 * Head yaw/pitch/roll. The transform path decomposes FaceLandmarker's own
 * rotation (preferred: it is what the model was trained to produce). The
 * landmark fallback is the reference for tests and for synthetic frames:
 * nose tip against the eye line, scaled by inter-ocular distance.
 */
export function headPose(frame: FaceFrame, cfg: EyeConfig): HeadPose {
  let yaw: number
  let pitch: number
  let roll: number
  let source: HeadPose['source']
  if (frame.transform && frame.transform.length >= 16) {
    // Column-major 4x4: R = [m0 m4 m8; m1 m5 m9; m2 m6 m10]. MediaPipe's
    // face frame: +x = subject's left in the image... we only need the
    // rotation's yaw (about y) and pitch (about x), Tait-Bryan, and the
    // sign convention is fixed once, here, to match the landmark path.
    const m = frame.transform
    const r00 = m[0], r10 = m[1], r20 = m[2]
    const r21 = m[6], r22 = m[10]
    const r11 = m[5]
    const r01 = m[4]
    pitch = Math.atan2(r21, r22) * DEG
    yaw = Math.atan2(-r20, Math.hypot(r00, r10)) * DEG
    roll = Math.atan2(r10, r00) * DEG
    // The transform's x axis points to the subject's right in image space;
    // the mirrored feed makes that the user's right on screen. yaw about
    // +y with the camera looking down -z: a turn to the subject's right is
    // negative yaw in this basis, so flip to the spec's +yaw = user's right.
    yaw = -yaw
    void r11
    void r01
    source = 'transform'
  } else {
    const p = frame.landmarks
    const L = p[LM.leftOuter]
    const R = p[LM.rightOuter]
    const nose = p[LM.noseTip]
    const eyeMid = { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2 }
    const interOcular = Math.hypot(R.x - L.x, R.y - L.y) || 1e-6
    // nose tip relative to the eye line, normalised by inter-ocular
    const nx = (nose.x - eyeMid.x) / (0.5 * interOcular)
    const ny = (nose.y - eyeMid.y) / (0.42 * interOcular) - cfg.neutralNoseDrop
    yaw = Math.asin(clamp(mirror(nx), -1, 1)) * DEG
    // image y is down: the nose dropping further below the eyes = looking down
    pitch = -Math.asin(clamp(ny, -1, 1)) * DEG
    roll = Math.atan2(R.y - L.y, R.x - L.x) * DEG
    source = 'landmarks'
  }
  const ok = Math.abs(yaw) <= cfg.headYawMaxDeg && Math.abs(pitch) <= cfg.headPitchMaxDeg
  return { yaw, pitch, roll, ok, source }
}

// ── Iris offset ────────────────────────────────────────────────────────────

export interface EyeOffset {
  /** -1..1, +x = the user's right, +y = up */
  x: number
  y: number
  /** open enough to place the iris (blink below blinkIrisThreshold, lids apart) */
  ok: boolean
  /** eyeBlink blendshape 0..1 */
  blink: number
  /** corner-to-corner span in normalised image units - the eye's apparent size */
  span: number
}

export interface IrisOffset {
  /** -1..1, +x = the user's right, +y = up; the quality-weighted combination of the ok eyes */
  x: number
  y: number
  okL: boolean
  okR: boolean
  L: EyeOffset
  R: EyeOffset
  /** an eye was dropped for disagreeing with the other beyond vergenceMax */
  vergenceDrop: 'L' | 'R' | null
}

function eyeOffset(
  p: readonly Landmark3[],
  iris: number, outer: number, inner: number, upper: number, lower: number,
  blink: number,
  cfg: EyeConfig,
  head?: HeadPose,
): EyeOffset {
  const o = p[outer], i = p[inner], u = p[upper], l = p[lower], c = p[iris]
  const cornerSpan = Math.hypot(i.x - o.x, i.y - o.y) || 1e-6
  const lidGap = Math.hypot(l.x - u.x, l.y - u.y)
  const cornerMid = { x: (o.x + i.x) / 2, y: (o.y + i.y) / 2 }
  const lidMid = { x: (u.x + l.x) / 2, y: (u.y + l.y) / 2 }
  // The iris is rejected EARLIER than the eye counts as shut: the lid is
  // already descending when eyeBlink passes 0.3 (ideas 2.8).
  const ok = blink <= cfg.blinkIrisThreshold && lidGap >= 0.18 * cornerSpan
  let x = clamp(mirror((c.x - cornerMid.x) / (0.5 * cornerSpan)), -1, 1)
  // image y down: iris above the lid midpoint = looking up = +y
  let y = clamp((lidMid.y - c.y) / (0.5 * Math.max(lidGap, 1e-6)), -1, 1)
  // Foreshortening (ideas 3.2): the corner span shrinks by cos(yaw) as the
  // head turns, so the same deflection reads larger; the lid gap likewise
  // with pitch. Undo it.
  if (cfg.foreshortening && head) {
    x *= Math.cos((head.yaw * Math.PI) / 180)
    y *= Math.cos((head.pitch * Math.PI) / 180)
  }
  return { x, y, ok, blink, span: cornerSpan }
}

/**
 * Both eyes, combined by quality (ideas 3.6): each ok eye weighs
 * (1 - blink) x its apparent size (the eye nearer the camera under yaw is
 * the more reliable). A vergence check (3.8): when the two disagree by
 * more than vergenceMax the one farther from the blendshape estimate is
 * dropped for this frame rather than averaged in.
 */
export function irisOffset(
  frame: FaceFrame,
  cfg: EyeConfig,
  head?: HeadPose,
  blend?: { L: { x: number; y: number }; R: { x: number; y: number } },
): IrisOffset {
  const p = frame.landmarks
  const b = frame.blendshapes
  const L = eyeOffset(p, LM.leftIris, LM.leftOuter, LM.leftInner, LM.leftUpper, LM.leftLower, b.eyeBlinkLeft ?? 0, cfg, head)
  const R = eyeOffset(p, LM.rightIris, LM.rightOuter, LM.rightInner, LM.rightUpper, LM.rightLower, b.eyeBlinkRight ?? 0, cfg, head)
  let useL = L.ok
  let useR = R.ok
  let vergenceDrop: 'L' | 'R' | null = null
  if (useL && useR && Math.hypot(L.x - R.x, L.y - R.y) > cfg.vergenceMax) {
    const ref = blend ? { L: blend.L, R: blend.R } : null
    const dL = ref ? Math.hypot(L.x - ref.L.x, L.y - ref.L.y) : 0
    const dR = ref ? Math.hypot(R.x - ref.R.x, R.y - ref.R.y) : 0
    // no reference: keep the larger (nearer) eye
    if (ref ? dL > dR : L.span < R.span) { useL = false; vergenceDrop = 'L' } else { useR = false; vergenceDrop = 'R' }
  }
  const wL = useL ? (cfg.eyeQualityWeights ? (1 - L.blink) * L.span : 1) : 0
  const wR = useR ? (cfg.eyeQualityWeights ? (1 - R.blink) * R.span : 1) : 0
  const sw = wL + wR
  const x = sw > 0 ? (wL * L.x + wR * R.x) / sw : 0
  const y = sw > 0 ? (wL * L.y + wR * R.y) / sw : 0
  return { x, y, okL: L.ok, okR: R.ok, L, R, vergenceDrop }
}

/**
 * Blendshape cross-check (§3): the model's own eyeLook* estimate of the
 * iris direction in the user's frame. Used only to halve the iris gain
 * when it disagrees with the geometry by more than 0.5 on an axis.
 */
export interface BlendGaze {
  x: number
  y: number
  L: { x: number; y: number }
  R: { x: number; y: number }
}

export function blendshapeGaze(b: Readonly<Record<string, number>>): BlendGaze {
  // For the subject's LEFT eye, "in" is toward the nose = the subject's
  // right; for the RIGHT eye "in" is the subject's left.
  const L = {
    x: clamp((b.eyeLookInLeft ?? 0) - (b.eyeLookOutLeft ?? 0), -1, 1),
    y: clamp((b.eyeLookUpLeft ?? 0) - (b.eyeLookDownLeft ?? 0), -1, 1),
  }
  const R = {
    x: clamp((b.eyeLookOutRight ?? 0) - (b.eyeLookInRight ?? 0), -1, 1),
    y: clamp((b.eyeLookUpRight ?? 0) - (b.eyeLookDownRight ?? 0), -1, 1),
  }
  return { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2, L, R }
}

// ── Composition ────────────────────────────────────────────────────────────

export interface GazeAngles {
  yaw: number
  pitch: number
  /** the iris gain actually applied this frame (deg) */
  irisGainDeg: number
}

/**
 * yaw = head.yaw + gain·iris.x, pitch likewise. `irisGainScale` is 1 by
 * default, 0.5 when the blendshape cross-check disagrees, 0 when the
 * channel is head-only (glasses / low light, see channel.ts).
 */
export function gazeAngles(
  head: HeadPose,
  iris: IrisOffset,
  cfg: EyeConfig,
  irisGainScale = 1,
): GazeAngles {
  const gain = cfg.irisGainDeg * irisGainScale
  return { yaw: head.yaw + gain * iris.x, pitch: head.pitch + gain * iris.y, irisGainDeg: gain }
}

/** The cross-check's verdict: 0.5 when geometry and blendshapes disagree. */
export function irisAgreementScale(iris: IrisOffset, blend: { x: number; y: number }): number {
  return Math.abs(iris.x - blend.x) > 0.5 || Math.abs(iris.y - blend.y) > 0.5 ? 0.5 : 1
}

// ── Features + the screen map ──────────────────────────────────────────────

/**
 * The numbers a gaze point is made of. Head pose in degrees; two iris
 * estimates in [-1, 1], kept SEPARATE: the geometric placement (iris
 * centre against the eye corners and lids) and the model's own eyeLook*
 * blendshapes. The default map blends them by `irisBlendWeight`; a
 * calibration gets both as features and learns which to trust on this
 * camera - on real webcams the blendshapes are often the steadier,
 * especially vertically, where the lid gap the geometry divides by closes
 * as the eyes look down.
 */
export interface GazeFeatures {
  headYaw: number
  headPitch: number
  /** geometric iris offset, quality-weighted over the eyes */
  irisX: number
  irisY: number
  /** the blendshape estimate, both eyes */
  blendX: number
  blendY: number
  /** per-eye geometric iris (the wide fit model) */
  eyeLX: number
  eyeLY: number
  eyeRX: number
  eyeRY: number
  /** per-eye blendshape estimate (the wide fit model) */
  blendLX: number
  blendLY: number
  blendRX: number
  blendRY: number
  /** head within the usable cone */
  ok: boolean
}

/** The numeric feature keys, in a fixed order (filters, medians, recordings). */
export const FEATURE_KEYS = [
  'headYaw', 'headPitch', 'irisX', 'irisY', 'blendX', 'blendY',
  'eyeLX', 'eyeLY', 'eyeRX', 'eyeRY', 'blendLX', 'blendLY', 'blendRX', 'blendRY',
] as const
export type FeatureKey = (typeof FEATURE_KEYS)[number]

export function gazeFeatures(
  head: HeadPose,
  iris: IrisOffset,
  blend: BlendGaze,
  _cfg: EyeConfig,
  irisScale = 1,
): GazeFeatures {
  const anyEye = iris.okL || iris.okR
  return {
    headYaw: head.yaw,
    headPitch: head.pitch,
    // with both eyes shut/unplaceable the geometry says nothing: fall back to the blendshapes
    irisX: (anyEye ? iris.x : blend.x) * irisScale,
    irisY: (anyEye ? iris.y : blend.y) * irisScale,
    blendX: blend.x * irisScale,
    blendY: blend.y * irisScale,
    eyeLX: (iris.okL ? iris.L.x : blend.L.x) * irisScale,
    eyeLY: (iris.okL ? iris.L.y : blend.L.y) * irisScale,
    eyeRX: (iris.okR ? iris.R.x : blend.R.x) * irisScale,
    eyeRY: (iris.okR ? iris.R.y : blend.R.y) * irisScale,
    blendLX: blend.L.x * irisScale,
    blendLY: blend.L.y * irisScale,
    blendRX: blend.R.x * irisScale,
    blendRY: blend.R.y * irisScale,
    ok: head.ok,
  }
}

/** The default map's single iris number: the two sources blended. */
export function irisMix(f: GazeFeatures, cfg: EyeConfig): { x: number; y: number } {
  const w = Math.min(1, Math.max(0, cfg.irisBlendWeight))
  return { x: (1 - w) * f.irisX + w * f.blendX, y: (1 - w) * f.irisY + w * f.blendY }
}

/**
 * A per-user linear map from features to screen px, fitted by the
 * calibration (calibration.ts): x = a0 + a1·headYaw + a2·irisX, y likewise.
 * It learns the head-vs-eye mix for THIS user and camera - including a
 * reversed sign, if the camera's convention differs from the assumption.
 */
export interface Calibration {
  /**
   * The linear map. 'base' (4 terms): x = x[0] + x[1]·headYaw + x[2]·irisX +
   * x[3]·blendX, y likewise with pitch / irisY / blendY. 'wide' (6 terms):
   * x = x[0] + x[1]·headYaw + x[2]·eyeLX + x[3]·eyeRX + x[4]·blendLX +
   * x[5]·blendRX, y likewise - the per-eye sources individually, kept
   * only when leave-one-out says it beats 'base'.
   */
  model: 'base' | 'wide'
  x: number[]
  y: number[]
  /**
   * Optional curvature correction on the LINEAR prediction, in normalised
   * screen units (u = (px - w/2) / (w/2), v likewise): px += Σ qx·[1, u, v,
   * u², v², uv] · (w/2), py likewise. Kept only when leave-one-out
   * validation says it beats the linear map (calibration.ts).
   */
  quad?: { x: number[]; y: number[]; viewport: { w: number; h: number } }
  /** RMS fit residual in px, for the HUD */
  residualPx: number
  points: number
}

/** The six curvature basis terms at a normalised point. */
export function quadBasis(u: number, v: number): number[] {
  return [1, u, v, u * u, v * v, u * v]
}

/** Features -> screen px from the viewport's top-left (uncalibrated map). */
export function screenPointDefault(
  f: GazeFeatures,
  cfg: EyeConfig,
  viewport: { w: number; h: number },
): { x: number; y: number } {
  const m = irisMix(f, cfg)
  return {
    x: viewport.w / 2 + (f.headYaw + cfg.irisGainDeg * m.x) * cfg.pxPerDeg,
    y: viewport.h / 2 - (f.headPitch + cfg.irisGainDeg * m.y) * cfg.pxPerDeg,
  }
}

/** The feature rows a model reads, per axis. */
export function featureRow(f: GazeFeatures, model: Calibration['model'], axis: 'x' | 'y'): number[] {
  if (model === 'wide') {
    return axis === 'x'
      ? [1, f.headYaw, f.eyeLX, f.eyeRX, f.blendLX, f.blendRX]
      : [1, f.headPitch, f.eyeLY, f.eyeRY, f.blendLY, f.blendRY]
  }
  return axis === 'x' ? [1, f.headYaw, f.irisX, f.blendX] : [1, f.headPitch, f.irisY, f.blendY]
}

/** The linear part of a calibrated map. */
export function linearPoint(f: GazeFeatures, cal: Calibration): { x: number; y: number } {
  const rx = featureRow(f, cal.model, 'x')
  const ry = featureRow(f, cal.model, 'y')
  let x = 0
  let y = 0
  for (let i = 0; i < rx.length; i++) {
    x += (cal.x[i] ?? 0) * rx[i]
    y += (cal.y[i] ?? 0) * ry[i]
  }
  return { x, y }
}

/** Features -> screen px, calibrated when a fit exists. */
export function screenPointFrom(
  f: GazeFeatures,
  cfg: EyeConfig,
  viewport: { w: number; h: number },
  cal: Calibration | null,
): { x: number; y: number } {
  if (!cal) return screenPointDefault(f, cfg, viewport)
  let { x, y } = linearPoint(f, cal)
  if (cal.quad) {
    const hw = cal.quad.viewport.w / 2
    const hh = cal.quad.viewport.h / 2
    const b = quadBasis((x - hw) / hw, (y - hh) / hh)
    let dx = 0
    let dy = 0
    for (let i = 0; i < 6; i++) {
      dx += cal.quad.x[i] * b[i]
      dy += cal.quad.y[i] * b[i]
    }
    x += dx * hw
    y += dy * hh
  }
  return { x, y }
}

/** Legacy angles map (steer-mode telemetry, tests). */
export function screenPoint(
  gaze: { yaw: number; pitch: number },
  cfg: EyeConfig,
  viewport: { w: number; h: number },
): { x: number; y: number } {
  return {
    x: viewport.w / 2 + gaze.yaw * cfg.pxPerDeg,
    y: viewport.h / 2 - gaze.pitch * cfg.pxPerDeg,
  }
}

/** presence × headOk × (0.6 + 0.4·eyesOk) */
export function confidence(frame: FaceFrame, head: HeadPose, iris: IrisOffset): number {
  const eyesOk = ((iris.okL ? 1 : 0) + (iris.okR ? 1 : 0)) / 2
  return frame.presence * (head.ok ? 1 : 0) * (0.6 + 0.4 * eyesOk)
}
