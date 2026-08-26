// Scripted 21-landmark frame streams at 30Hz (S9b) - the required proof for
// the gesture layer, and the only camera this codebase is tested against
// before Slice D. Deterministic: seeded PRNG, no clocks.

import type { InputEvent, InputBus } from '../input/InputBus'
import { createHandPipeline } from '../input/gestureMachine'
import type { Landmark } from '../input/landmarks'

export interface SyntheticFrame {
  landmarks: Landmark[] | null
  tMs: number
}

export const FRAME_MS = 1000 / 30

const OPEN_RATIO = 0.55 // relaxed hand, well above pinchOpen
const CLOSED_RATIO = 0.16 // firm pinch, well below pinchClose

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box-Muller gaussian from a uniform PRNG. */
function makeGaussian(rand: () => number) {
  return (sigma: number) => {
    const u = Math.max(rand(), 1e-12)
    const v = rand()
    return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}

/**
 * Tracker-realistic noise: real landmark jitter at rest is temporally
 * correlated - a slow wander (AR(1)) plus a small white component - not
 * frame-independent white noise (between near-identical frames the model's
 * output barely moves). Stationary spatial sigma ~= 0.003 per the spec,
 * dominated by the wander term; the white term is sub-pixel.
 */
function makeTrackerNoise(rand: () => number, whiteSigma: number) {
  const gauss = makeGaussian(rand)
  const RHO = 0.9998
  const WANDER_SIGMA = 0.0028
  const stepSigma = WANDER_SIGMA * Math.sqrt(1 - RHO * RHO)
  const wander = new Float64Array(42) // 21 landmarks x 2 axes
  return {
    tick() {
      for (let i = 0; i < wander.length; i++) {
        wander[i] = RHO * wander[i] + gauss(stepSigma)
      }
    },
    at(coord: number) {
      return wander[coord % wander.length] + gauss(whiteSigma)
    },
  }
}

// Rough hand-local template, unit = handScale (|wrist - middle MCP| = 1).
// Image y grows downward; the hand points up, wrist below the knuckle.
// Only 0 (wrist), 9 (middle MCP), 4 (thumb tip) and 8 (index tip) are
// consumed by the pipeline; the rest exist so a thumbnail can draw a hand.
const TEMPLATE: [number, number][] = [
  [0.0, 1.0], // 0 wrist
  [-0.25, 0.8], [-0.42, 0.55], [-0.5, 0.3], [-0.52, 0.1], // thumb chain
  [-0.22, 0.05], [-0.26, -0.25], [-0.28, -0.45], [-0.3, -0.6], // index
  [0.0, 0.0], [0.0, -0.3], [0.0, -0.55], [0.0, -0.72], // middle
  [0.2, 0.05], [0.24, -0.22], [0.26, -0.42], [0.28, -0.55], // ring
  [0.4, 0.15], [0.46, -0.08], [0.5, -0.25], [0.52, -0.38], // pinky
]

/**
 * One hand at centre (cx, cy) with apparent size `scale` and pinch ratio
 * `ratio` (|thumb tip - index tip| / scale). Gaussian noise on every landmark.
 */
export function makeHand(
  cx: number,
  cy: number,
  scale: number,
  ratio: number,
  noiseAt: (coord: number) => number,
): Landmark[] {
  const lms: Landmark[] = TEMPLATE.map(([tx, ty], i) => ({
    x: cx + tx * scale + noiseAt(i * 2),
    y: cy + ty * scale + noiseAt(i * 2 + 1),
  }))
  // Pinch pair placed exactly `ratio * scale` apart, up-left of the knuckle.
  const px = cx - 0.28 * scale
  const py = cy - 0.35 * scale
  lms[4] = { x: px - (ratio * scale) / 2 + noiseAt(8), y: py + noiseAt(9) }
  lms[8] = { x: px + (ratio * scale) / 2 + noiseAt(16), y: py + noiseAt(17) }
  return lms
}

interface Segment {
  frames: number
  /** progress 0..1 across the segment -> frame spec; null = hand missing */
  at(progress: number): { cx: number; cy: number; scale: number; ratio: number } | null
}

function build(segments: Segment[], seed: number, whiteSigma: number): SyntheticFrame[] {
  const rand = mulberry32(seed)
  const noise = makeTrackerNoise(rand, whiteSigma)
  const frames: SyntheticFrame[] = []
  let i = 0
  for (const seg of segments) {
    for (let f = 0; f < seg.frames; f++) {
      noise.tick()
      const spec = seg.at(seg.frames <= 1 ? 0 : f / (seg.frames - 1))
      frames.push({
        landmarks: spec
          ? makeHand(spec.cx, spec.cy, spec.scale, spec.ratio, (c) => noise.at(c))
          : null,
        tMs: i * FRAME_MS,
      })
      i++
    }
  }
  return frames
}

const hold =
  (cx: number, cy: number, scale: number, ratio: number) =>
  () => ({ cx, cy, scale, ratio })

/** Lateral sweep from x0 to x1 (image units), pinched. */
const sweep =
  (x0: number, x1: number, cy: number, scale: number) =>
  (p: number) => ({ cx: x0 + (x1 - x0) * p, cy, scale, ratio: CLOSED_RATIO })

export const scenarios: Record<string, () => SyntheticFrame[]> = {
  /** 1. Hand at a fixed point, pinch open, sigma 0.003, 5s. */
  still: () =>
    build([{ frames: 150, at: hold(0.5, 0.5, 0.09, OPEN_RATIO) }], 101, 0.0004),

  /** 1b. Same, but pinched for the middle 3.5s - proves the dead zone holds
   *  while engaged (extra scenario beyond the spec's seven). */
  stillPinched: () =>
    build(
      [
        { frames: 15, at: hold(0.5, 0.5, 0.09, OPEN_RATIO) },
        { frames: 105, at: hold(0.5, 0.5, 0.09, CLOSED_RATIO) },
        { frames: 15, at: hold(0.5, 0.5, 0.09, OPEN_RATIO) },
      ],
      102,
      0.0004,
    ),

  /** 2. Flick: ~0.25 units over 180ms, pinched throughout, then release.
   *  (Image x decreases: the mirrored pipeline turns it into a rightward
   *  hand move.) */
  flick: () =>
    build(
      [
        { frames: 9, at: hold(0.62, 0.5, 0.09, OPEN_RATIO) },
        { frames: 4, at: hold(0.62, 0.5, 0.09, CLOSED_RATIO) },
        { frames: 6, at: sweep(0.62, 0.37, 0.5, 0.09) },
        { frames: 4, at: hold(0.37, 0.5, 0.09, OPEN_RATIO) },
      ],
      103,
      0.0004,
    ),

  /** 3. Slow drag: 0.15 units over 2s, release at low velocity. */
  slowDrag: () =>
    build(
      [
        { frames: 9, at: hold(0.58, 0.5, 0.09, OPEN_RATIO) },
        { frames: 4, at: hold(0.58, 0.5, 0.09, CLOSED_RATIO) },
        { frames: 60, at: sweep(0.58, 0.43, 0.5, 0.09) },
        { frames: 4, at: hold(0.43, 0.5, 0.09, OPEN_RATIO) },
      ],
      104,
      0.0004,
    ),

  /** 4. Tap: close -> open within ~180ms, < 0.01 travel. */
  tap: () =>
    build(
      [
        { frames: 9, at: hold(0.5, 0.5, 0.09, OPEN_RATIO) },
        { frames: 4, at: hold(0.5, 0.5, 0.09, CLOSED_RATIO) },
        { frames: 6, at: hold(0.5, 0.5, 0.09, OPEN_RATIO) },
      ],
      105,
      0.0004,
    ),

  /** 5. Pinch distance oscillating tightly around the engage threshold, 3s.
   *  Crosses pinchClose repeatedly but never reaches pinchOpen - the
   *  hysteresis gap must hold. */
  pinchJitter: () =>
    build(
      [
        {
          frames: 90,
          at: (p) => ({
            cx: 0.5,
            cy: 0.5,
            scale: 0.09,
            ratio: 0.28 + 0.035 * Math.sin(p * 90 * 0.85),
          }),
        },
      ],
      106,
      0.0004,
    ),

  /** 6. Dropout: mid-drag the hand vanishes for 20 frames. */
  dropout: () =>
    build(
      [
        { frames: 9, at: hold(0.6, 0.5, 0.09, OPEN_RATIO) },
        { frames: 4, at: hold(0.6, 0.5, 0.09, CLOSED_RATIO) },
        { frames: 20, at: sweep(0.6, 0.48, 0.5, 0.09) },
        { frames: 20, at: () => null },
        { frames: 12, at: hold(0.45, 0.5, 0.09, OPEN_RATIO) },
      ],
      107,
      0.0004,
    ),

  /** 7. Approach: the same physical motion (2 hand-lengths of lateral
   *  travel over 0.6s) performed near (scale 0.12) and far (scale 0.06).
   *  Scale normalization must make them agree. */
  approachNear: () => approach(0.12, 108),
  approachFar: () => approach(0.06, 109),
}

function approach(scale: number, seed: number): SyntheticFrame[] {
  const travel = 2 * scale // two hand-lengths in image units
  const x0 = 0.5 + travel / 2
  return build(
    [
      { frames: 9, at: hold(x0, 0.5, scale, OPEN_RATIO) },
      { frames: 4, at: hold(x0, 0.5, scale, CLOSED_RATIO) },
      { frames: 18, at: sweep(x0, x0 - travel, 0.5, scale) },
      { frames: 4, at: hold(x0 - travel, 0.5, scale, OPEN_RATIO) },
    ],
    seed,
    0.0004,
  )
}

/**
 * Dev mode (?input=synthetic&scenario=flick): drive the live app from the
 * harness at 30Hz through the real pipeline, looping with a pause between
 * runs. Returns a stop function.
 */
export function startSyntheticDrive(
  bus: InputBus,
  scenarioName: string,
  onEvent?: (e: InputEvent) => void,
): () => void {
  const make = scenarios[scenarioName] ?? scenarios.flick
  let frames = make()
  let i = 0
  const pipeline = createHandPipeline()
  let epoch = 0
  const id = setInterval(() => {
    if (i >= frames.length) {
      // 1.2s pause, then loop the scenario again.
      if (i >= frames.length + 36) {
        i = 0
        epoch += frames[frames.length - 1].tMs + 36 * FRAME_MS
        frames = make()
        pipeline.reset()
      } else {
        i++
      }
      return
    }
    const f = frames[i++]
    for (const e of pipeline.process(f.landmarks, epoch + f.tMs)) {
      bus.emit(e)
      onEvent?.(e)
    }
  }, FRAME_MS)
  return () => clearInterval(id)
}
