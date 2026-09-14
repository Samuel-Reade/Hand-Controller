// Synthetic gaze scenarios (ORB_EYE_SPEC §8): FaceFrame sequences at 30 fps
// fed through the REAL channel (eyeControl.feed) with no camera, so the
// drift, the glance rule, the lost-face hold/decay and the hand
// arbitration can be watched and gated without a face in front of the
// machine. `?input=synthetic&scenario=eye-sweep&eye=1`.

import type { InputBus, InputEvent } from '../input/InputBus'
import { syntheticFace } from '../input/eye/__synthetic__/face'
import type { SyntheticFaceParams } from '../input/eye/__synthetic__/face'
import type { FaceFrame } from '../input/eye/face'
import { eyeRuntime } from '../input/eye/channel'
import { drawEyeIndicator, handRuntime } from '../input/handThumbnail'
import { eyeControl } from '../input/useEyeInput'

export const FRAME_MS = 1000 / 30

/** One harness frame: a face (or none) and any hand events to emit alongside. */
export interface EyeHarnessFrame {
  tMs: number
  face: FaceFrame | null
  hand?: InputEvent[]
}

const frames = (durationMs: number, at: (tMs: number) => SyntheticFaceParams | null): EyeHarnessFrame[] => {
  const out: EyeHarnessFrame[] = []
  for (let t = 0; t <= durationMs; t += FRAME_MS) {
    const p = at(t)
    out.push({ tMs: t, face: p ? syntheticFace(p, t) : null })
  }
  return out
}

/** A slow figure-eight in head yaw/pitch: ±22° yaw, ±12° pitch, 12 s period. */
const figureEight = (t: number, amp = 1): SyntheticFaceParams => {
  const w = (2 * Math.PI * t) / 12000
  return { yaw: 22 * amp * Math.sin(w), pitch: 12 * amp * Math.sin(2 * w), irisX: 0.3 * Math.sin(w), irisY: 0 }
}

export const eyeScenarios: Record<string, () => EyeHarnessFrame[]> = {
  /** face present, gaze sweeps a slow figure-eight: expect gentle drift */
  'eye-sweep': () => frames(24000, (t) => figureEight(t)),

  /** 250 ms excursions every 2 s: expect ZERO field motion */
  'eye-glance': () => frames(12000, (t) => {
    const phase = t % 2000
    return phase < 250 ? { yaw: 28, pitch: 0 } : { yaw: 0, pitch: 0 }
  }),

  /** attending, then the face drops for 1 s, returns: hold -> decay -> resume */
  'eye-lost': () => frames(9000, (t) => {
    if (t >= 3000 && t < 4000) return null
    return { yaw: 24, pitch: 4 }
  }),

  /** natural 150 ms blinks every 4 s during a sweep: no stutter */
  'eye-blink': () => frames(16000, (t) => {
    const blink = t % 4000 < 150 ? 1 : 0
    return { ...figureEight(t), blinkL: blink, blinkR: blink }
  }),

  /** iris ok only 30 % of the time + noisy blendshapes: head-only, drift still works */
  'eye-glasses': () => frames(16000, (t) => {
    const okFrame = (Math.floor(t / FRAME_MS) % 10) < 3
    const blink = okFrame ? 0 : 0.9
    return { ...figureEight(t), blinkL: blink, blinkR: blink, noisyBlend: true, jitterPx: 2 }
  }),

  /**
   * 'point' mode: the eyes park 250 px right and 120 px above centre
   * (through the default map: yaw 250/38°, pitch 120/38°) for 10 s, so a
   * gate can see a node take the focus and a confirm select it; then, as
   * real eyes would, they follow the selected node to the centre.
   */
  'eye-point': () => frames(30000, (t) => (t < 10000 ? { yaw: 250 / 38, pitch: 120 / 38 } : { yaw: 0, pitch: 0 })),

  /** a sweep interrupted by a scripted hand engage/pan/release at 6 s */
  'eye-hand-mix': () => {
    const out = frames(16000, (t) => figureEight(t))
    // by frame index: engage at 6 s, pan for a second, release at 7 s
    const k0 = Math.round(6000 / FRAME_MS)
    const k1 = Math.round(7000 / FRAME_MS)
    out.forEach((f, k) => {
      if (k === k0) f.hand = [{ type: 'engage' }]
      else if (k > k0 && k < k1) f.hand = [{ type: 'move', dYaw: 0.01, dPitch: 0 }]
      else if (k === k1) f.hand = [{ type: 'release', vYaw: 0, vPitch: 0 }]
    })
    return out
  },
}

export function isEyeScenario(name: string): boolean {
  return name.split(',').some((n) => n.trim().startsWith('eye-'))
}

/**
 * Drive the channel from a scenario at 30 fps, looping. Hand events in a
 * frame go onto the bus BEFORE the face frame, as the camera loop orders
 * them (hand first). Returns a stop function.
 */
export function startSyntheticEyeDrive(
  bus: InputBus,
  scenarioName: string,
  onEvent?: (e: InputEvent) => void,
): () => void {
  const makers = scenarioName
    .split(',')
    .map((s) => s.trim())
    .filter((n) => eyeScenarios[n])
    .map((n) => eyeScenarios[n])
  if (makers.length === 0) makers.push(eyeScenarios['eye-sweep'])
  let which = 0
  let list = makers[0]()
  let i = 0
  const t0 = performance.now()
  let epoch = 0
  const id = setInterval(() => {
    if (i >= list.length) {
      epoch += list[list.length - 1].tMs + FRAME_MS
      which = (which + 1) % makers.length
      list = makers[which]()
      i = 0
      eyeControl.feed(null, t0 + epoch)
    }
    const f = list[i++]
    const now = t0 + epoch + f.tMs
    for (const e of f.hand ?? []) {
      bus.emit(e)
      onEvent?.(e)
    }
    eyeControl.feed(f.face ? { ...f.face, t: now } : null, now)
    // The HUD thumbnail shows the channel's indicator here too, as the
    // camera shell would draw it - so screenshots show the state.
    const canvas = handRuntime.thumbnail
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      drawEyeIndicator(ctx, canvas.width, canvas.height, eyeRuntime)
    }
  }, FRAME_MS)
  return () => {
    clearInterval(id)
    eyeControl.feed(null, performance.now())
  }
}
