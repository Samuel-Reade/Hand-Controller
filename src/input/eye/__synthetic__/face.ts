// Synthetic faces (ORB_EYE_SPEC §8): a FaceFrame from a handful of
// parameters, placing the 13 landmarks the pipeline reads on an idealised
// head and zero-filling the rest. The inverse of face.ts's landmark
// fallback by construction, so tests can assert recovery; `transform` is
// omitted so the fallback path is what gets exercised.

import type { FaceFrame, Landmark3 } from '../face'
import { LM } from '../face'
import { EYE_DEFAULTS } from '../config'

export interface SyntheticFaceParams {
  yaw?: number      // deg, +right (the user's right)
  pitch?: number    // deg, +up
  roll?: number     // deg
  irisX?: number    // -1..1, +right
  irisY?: number    // -1..1, +up
  blinkL?: number   // 0..1
  blinkR?: number
  presence?: number
  jitterPx?: number // gaussian px noise (of a 640-wide image) on every landmark
  /** blendshapes disagree with the geometry (glasses / glare) */
  noisyBlend?: boolean
  seed?: number
}

const RAD = Math.PI / 180
const IMG_W = 640
/** eye line centre in normalised image coords, and inter-ocular distance */
const EYE_MID = { x: 0.5, y: 0.42 }
const INTER_OCULAR = 0.18
const CORNER_SPAN = 0.06
const LID_GAP_OPEN = 0.03

function makeRng(seed: number) {
  // Mix the seed first: consecutive seeds into a raw LCG give correlated
  // streams, and the jitter must be white for the filter tests to mean anything.
  let s = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  s ^= s >>> 13
  s = Math.imul(s, 0xc2b2ae35) >>> 0
  s ^= s >>> 16
  const u = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  /** Box-Muller gaussian */
  return () => {
    const a = Math.max(1e-12, u())
    const b = u()
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b)
  }
}

export function syntheticFace(p: SyntheticFaceParams, t = 0): FaceFrame {
  const yaw = p.yaw ?? 0
  const pitch = p.pitch ?? 0
  const roll = p.roll ?? 0
  const irisX = p.irisX ?? 0
  const irisY = p.irisY ?? 0
  const blinkL = p.blinkL ?? 0
  const blinkR = p.blinkR ?? 0
  const k0 = EYE_DEFAULTS.neutralNoseDrop
  const io = INTER_OCULAR

  const pts: Landmark3[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }))
  const set = (i: number, x: number, y: number) => { pts[i] = { x, y, z: 0 } }

  // Eye line: 33 on the image LEFT, 263 on the image RIGHT (unmirrored feed).
  const lx = EYE_MID.x - io / 2
  const rx = EYE_MID.x + io / 2
  set(LM.leftOuter, lx, EYE_MID.y)
  set(LM.rightOuter, rx, EYE_MID.y)
  // Nose tip: the fallback reads yaw = asin(mirror(nx)), pitch = -asin(ny).
  const nx = -Math.sin(yaw * RAD)
  const ny = -Math.sin(pitch * RAD)
  set(LM.noseTip, EYE_MID.x + nx * 0.5 * io, EYE_MID.y + (ny + k0) * 0.42 * io)
  set(LM.chin, EYE_MID.x + nx * 0.5 * io, EYE_MID.y + (ny + k0) * 0.42 * io + 0.9 * io)

  // Eyes: corners along x, lids about the corner line, iris by deflection.
  // `ox` is the OUTER corner (it stays on the eye line set above, so the
  // inter-ocular distance the head-pose fallback reads is exactly io);
  // the eye extends inward from it by CORNER_SPAN.
  const eye = (
    outer: number, inner: number, upper: number, lower: number, iris: number,
    ox: number, dirInner: 1 | -1, blink: number,
  ) => {
    const half = CORNER_SPAN / 2
    const cx = ox + dirInner * half
    set(outer, ox, EYE_MID.y)
    set(inner, cx + dirInner * half, EYE_MID.y)
    const gap = LID_GAP_OPEN * (1 - blink)
    set(upper, cx, EYE_MID.y - gap / 2)
    set(lower, cx, EYE_MID.y + gap / 2)
    // irisOffset: x_user = mirror((c.x - mid.x) / (0.5 span)) -> c.x = mid.x - irisX·half
    // y_user = (lidMid.y - c.y) / (0.5 gap) -> c.y = lidMid.y - irisY·gap/2
    set(iris, cx - irisX * half, EYE_MID.y - irisY * (gap / 2))
  }
  eye(LM.leftOuter, LM.leftInner, LM.leftUpper, LM.leftLower, LM.leftIris, lx, 1, blinkL)
  eye(LM.rightOuter, LM.rightInner, LM.rightUpper, LM.rightLower, LM.rightIris, rx, -1, blinkR)

  // Roll about the eye-line centre.
  if (roll !== 0) {
    const c = Math.cos(roll * RAD)
    const s = Math.sin(roll * RAD)
    for (const q of pts) {
      if (q.x === 0 && q.y === 0) continue
      const dx = q.x - EYE_MID.x
      const dy = q.y - EYE_MID.y
      q.x = EYE_MID.x + dx * c - dy * s
      q.y = EYE_MID.y + dx * s + dy * c
    }
  }

  // Jitter (deterministic).
  if (p.jitterPx) {
    const g = makeRng((p.seed ?? 1) + Math.round(t))
    const sigma = p.jitterPx / IMG_W
    for (const q of pts) {
      if (q.x === 0 && q.y === 0) continue
      q.x += g() * sigma
      q.y += g() * sigma
    }
  }

  // Blendshapes: agree with the geometry unless noisy.
  const bx = p.noisyBlend ? -irisX : irisX
  const by = p.noisyBlend ? -irisY : irisY
  const blendshapes: Record<string, number> = {
    eyeBlinkLeft: blinkL,
    eyeBlinkRight: blinkR,
    // left eye: "in" = toward the nose = the subject's right (+x)
    eyeLookInLeft: Math.max(0, bx),
    eyeLookOutLeft: Math.max(0, -bx),
    // right eye: "in" = the subject's left (-x)
    eyeLookInRight: Math.max(0, -bx),
    eyeLookOutRight: Math.max(0, bx),
    eyeLookUpLeft: Math.max(0, by),
    eyeLookUpRight: Math.max(0, by),
    eyeLookDownLeft: Math.max(0, -by),
    eyeLookDownRight: Math.max(0, -by),
  }

  return { t, landmarks: pts, blendshapes, presence: p.presence ?? 1 }
}
