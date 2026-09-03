// Scripted 21-landmark frame streams at 30Hz (S9b) - the required proof for
// the gesture layer, and the only camera this codebase is tested against
// before Slice D. Deterministic: seeded PRNG, no clocks.
// Harness v3 (ORB_ZOOM_SPEC section 6): a second hand. Pair scenarios emit
// two independent landmark sets per frame (own position, scale, pinch state,
// own tracker-noise stream); depth is scripted by scaling each hand about
// its own centre frame to frame (growing = approaching the camera, which
// zooms OUT - the depth mapping is inverted; see handArbiter).

import type { InputEvent, InputBus } from '../input/InputBus'
import { FEEL } from '../config/feel'
import { createMultiHandPipeline } from '../input/handArbiter'
import type { MultiHandPipeline } from '../input/handArbiter'
import { drawHands, handRuntime } from '../input/handThumbnail'
import type { Landmark } from '../input/landmarks'
import { useStore } from '../store'

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

// ── Harness v3: two hands (ORB_ZOOM_SPEC section 6) ─────────────────────────

export interface SyntheticPairFrame {
  /** Detected hands this frame, 0..2, in detection order. Identity is NOT
   *  implied by the index - the pipeline's slot matching resolves it. */
  hands: Landmark[][]
  tMs: number
}

export interface HandSpec {
  cx: number
  cy: number
  scale: number
  ratio: number
}
export type PairSpec = [HandSpec | null, HandSpec | null]

interface PairSegment {
  frames: number
  at(progress: number): PairSpec
}

function buildPair(segments: PairSegment[], seed: number, whiteSigma: number): SyntheticPairFrame[] {
  const rand = mulberry32(seed)
  const noiseA = makeTrackerNoise(rand, whiteSigma)
  const noiseB = makeTrackerNoise(rand, whiteSigma)
  const frames: SyntheticPairFrame[] = []
  let i = 0
  for (const seg of segments) {
    for (let f = 0; f < seg.frames; f++) {
      noiseA.tick()
      noiseB.tick()
      const [a, b] = seg.at(seg.frames <= 1 ? 0 : f / (seg.frames - 1))
      const hands: Landmark[][] = []
      if (a) hands.push(makeHand(a.cx, a.cy, a.scale, a.ratio, (c) => noiseA.at(c)))
      if (b) hands.push(makeHand(b.cx, b.cy, b.scale, b.ratio, (c) => noiseB.at(c)))
      frames.push({ hands, tMs: i * FRAME_MS })
      i++
    }
  }
  return frames
}

// Hand A rests left of centre, hand B right (image coords), both at the
// base scenarios' scale.
const AX = 0.38
const BX = 0.62
const CY = 0.5
const S = 0.09

const pose = (cx: number, cy: number, scale: number, ratio: number): HandSpec => ({
  cx,
  cy,
  scale,
  ratio,
})

/** Canonical two-hand poses: both pinched, both open, one of each. `mul`
 *  scales both hands (depth); sa / sb are the per-hand base scales. */
export const pairPose = {
  bothOpen: (mul = 1, sa = S, sb = S): PairSpec => [
    pose(AX, CY, sa * mul, OPEN_RATIO),
    pose(BX, CY, sb * mul, OPEN_RATIO),
  ],
  bothPinched: (mul = 1, sa = S, sb = S): PairSpec => [
    pose(AX, CY, sa * mul, CLOSED_RATIO),
    pose(BX, CY, sb * mul, CLOSED_RATIO),
  ],
  oneEach: (mul = 1, sa = S, sb = S): PairSpec => [
    pose(AX, CY, sa * mul, CLOSED_RATIO),
    pose(BX, CY, sb * mul, OPEN_RATIO),
  ],
}

const holdPair = (frames: number, spec: PairSpec): PairSegment => ({ frames, at: () => spec })

/** Both pinched; mean scale ratio r0 -> r1 across the segment (a depth move). */
const depth = (frames: number, r0: number, r1: number, sa = S, sb = S): PairSegment => ({
  frames,
  at: (p) => pairPose.bothPinched(r0 + (r1 - r0) * p, sa, sb),
})

/** The mean-scale ratio that yields a given zoom factor at the live zoomGain.
 *  Inverted with the driver: a factor above 1 needs hands SMALLER than at
 *  engage, i.e. pulled back toward you. */
export const scaleRatioFor = (factor: number, gain = FEEL.zoomGain): number =>
  factor ** (-1 / gain)

export const pairScenarios: Record<string, () => SyntheticPairFrame[]> = {
  /** 1. zoomIn: both pinched, pulled back toward you - mean scale SHRINKS
   *  smoothly to ratio 1/1.9 over ~600ms. */
  zoomIn: () =>
    buildPair(
      [
        holdPair(9, pairPose.bothOpen(1, 0.16, 0.16)),
        holdPair(4, pairPose.bothPinched(1, 0.16, 0.16)),
        depth(18, 1, 1 / 1.9, 0.16, 0.16),
        holdPair(6, pairPose.bothOpen(1 / 1.9, 0.16, 0.16)),
      ],
      201,
      0.0004,
    ),

  /** 2. zoomOut: (run at level 1) both pinched, pushed toward the screen -
   *  mean scale grows to ratio 1/0.55. */
  zoomOut: () =>
    buildPair(
      [
        holdPair(9, pairPose.bothOpen()),
        holdPair(4, pairPose.bothPinched()),
        depth(18, 1, 1 / 0.55),
        holdPair(6, pairPose.bothOpen(1 / 0.55)),
      ],
      202,
      0.0004,
    ),

  /** 3. zoomPeekRelease: pulls back to FACTOR 1.3 (below zoomInCommit), both open. */
  zoomPeekRelease: () => {
    const r = scaleRatioFor(1.3)
    return buildPair(
      [
        holdPair(9, pairPose.bothOpen()),
        holdPair(4, pairPose.bothPinched()),
        depth(12, 1, r),
        holdPair(8, pairPose.bothOpen(r)),
      ],
      203,
      0.0004,
    )
  },

  /** 4. oneHandNoZoom: A flicks exactly like the base `flick`; B is present
   *  but open the whole time. */
  oneHandNoZoom: () =>
    buildPair(
      [
        { frames: 9, at: () => [pose(0.45, CY, S, OPEN_RATIO), pose(0.72, CY, S, OPEN_RATIO)] },
        { frames: 4, at: () => [pose(0.45, CY, S, CLOSED_RATIO), pose(0.72, CY, S, OPEN_RATIO)] },
        {
          frames: 6,
          at: (p) => [pose(0.45 - 0.25 * p, CY, S, CLOSED_RATIO), pose(0.72, CY, S, OPEN_RATIO)],
        },
        { frames: 4, at: () => [pose(0.2, CY, S, OPEN_RATIO), pose(0.72, CY, S, OPEN_RATIO)] },
      ],
      204,
      0.0004,
    ),

  /** 5. secondHandJoins: A pinch-drags; B pinches at frame 8 of the drag. */
  secondHandJoins: () =>
    buildPair(
      [
        { frames: 9, at: () => [pose(0.45, CY, S, OPEN_RATIO), pose(0.72, CY, S, OPEN_RATIO)] },
        { frames: 4, at: () => [pose(0.45, CY, S, CLOSED_RATIO), pose(0.72, CY, S, OPEN_RATIO)] },
        {
          frames: 20,
          at: (p) => {
            const f = Math.round(p * 19)
            return [
              pose(0.45 - 0.2 * p, CY, S, CLOSED_RATIO),
              pose(0.72, CY, S, f >= 8 ? CLOSED_RATIO : OPEN_RATIO),
            ]
          },
        },
        { frames: 6, at: () => [pose(0.25, CY, S, CLOSED_RATIO), pose(0.72, CY, S, CLOSED_RATIO)] },
        { frames: 6, at: () => [pose(0.25, CY, S, OPEN_RATIO), pose(0.72, CY, S, OPEN_RATIO)] },
      ],
      205,
      0.0004,
    ),

  /** 6. oneHandDrops: mid-zoom B vanishes for 20 frames; A stays pinched. */
  oneHandDrops: () =>
    buildPair(
      [
        holdPair(9, pairPose.bothOpen()),
        holdPair(4, pairPose.bothPinched()),
        depth(10, 1, 1 / 1.08),
        { frames: 20, at: () => [pose(AX, CY, S / 1.08, CLOSED_RATIO), null] },
        holdPair(6, pairPose.bothOpen(1 / 1.08)),
      ],
      206,
      0.0004,
    ),

  /** 7. bothPinchJitter: mean scale wanders (AR(1)) right around the
   *  zoomInCommit ratio for 3s. */
  bothPinchJitter: () => {
    const rc = scaleRatioFor(FEEL.zoomInCommit)
    const gauss = makeGaussian(mulberry32(207))
    const RHO = 0.9
    const STEP = 0.02
    let w = 0
    const wander: number[] = []
    for (let f = 0; f < 90; f++) {
      w = RHO * w + gauss(STEP)
      wander.push(w)
    }
    return buildPair(
      [
        holdPair(9, pairPose.bothOpen()),
        holdPair(4, pairPose.bothPinched()),
        depth(6, 1, rc * 1.03),
        { frames: 90, at: (p) => pairPose.bothPinched(rc * (1 + wander[Math.round(p * 89)])) },
        holdPair(6, pairPose.bothOpen(rc)),
      ],
      208,
      0.0004,
    )
  },

  /** 8. asymmetricDepth: hands at handScale 0.12 and 0.24 moving together
   *  (the zoomIn ratio trajectory - pulling back to 0.06 and 0.12). */
  asymmetricDepth: () =>
    buildPair(
      [
        holdPair(9, pairPose.bothOpen(1, 0.12, 0.24)),
        holdPair(4, pairPose.bothPinched(1, 0.12, 0.24)),
        depth(18, 1, 1 / 1.9, 0.12, 0.24),
        holdPair(6, pairPose.bothOpen(1 / 1.9, 0.12, 0.24)),
      ],
      209,
      0.0004,
    ),

  /** 9. commitCooldown: the pull-back continues fast past the first commit
   *  (ratio 1.8^-p over 20 frames re-crosses the threshold inside 350ms). */
  commitCooldown: () =>
    buildPair(
      [
        holdPair(9, pairPose.bothOpen(1, 0.16, 0.16)),
        holdPair(4, pairPose.bothPinched(1, 0.16, 0.16)),
        { frames: 20, at: (p) => pairPose.bothPinched(1.8 ** -p, 0.16, 0.16) },
        holdPair(6, pairPose.bothOpen(1 / 1.8, 0.16, 0.16)),
      ],
      210,
      0.0004,
    ),
}

/** Lift a single-hand scenario into the pair frame shape. */
export function toPairFrames(frames: readonly SyntheticFrame[]): SyntheticPairFrame[] {
  return frames.map((f) => ({ hands: f.landmarks ? [f.landmarks] : [], tMs: f.tMs }))
}

function drawSyntheticThumb(hands: Landmark[][], pipeline: MultiHandPipeline): void {
  const canvas = handRuntime.thumbnail
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.fillStyle = '#070A15'
  ctx.fillRect(0, 0, w, h)
  ctx.save()
  ctx.translate(w, 0)
  ctx.scale(-1, 1)
  drawHands(
    ctx,
    w,
    h,
    hands.map((landmarks, i) => ({ landmarks, pinched: pipeline.pinchedOf(i) })),
    pipeline.state.zooming,
  )
  ctx.restore()
}

function syncStore(hands: Landmark[][], pipeline: MultiHandPipeline): void {
  const s = useStore.getState()
  const present = hands.length > 0
  if (s.handPresent !== present) s.setHandPresent(present)
  const engaged = pipeline.state.single.phase === 'engaged'
  if (s.handEngaged !== engaged) s.setHandEngaged(engaged)
  if (s.handCount !== hands.length) s.setHandCount(hands.length)
  if (s.handZoom !== pipeline.state.zooming) s.setHandZoom(pipeline.state.zooming)
}

/**
 * Dev mode (?input=synthetic&scenario=flick): drive the live app from the
 * harness at 30Hz through the real (multi-hand) pipeline, looping with a
 * pause between runs. `scenario` may be a comma-separated list (e.g.
 * `zoomIn,zoomOut`) played in sequence; single- and two-hand scenarios mix.
 * Draws the synthetic hands into the HUD thumbnail. Returns a stop function.
 */
export function startSyntheticDrive(
  bus: InputBus,
  scenarioName: string,
  onEvent?: (e: InputEvent) => void,
): () => void {
  const makers: (() => SyntheticPairFrame[])[] = []
  for (const name of scenarioName.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (pairScenarios[name]) makers.push(pairScenarios[name])
    else if (scenarios[name]) makers.push(() => toPairFrames(scenarios[name]()))
  }
  if (makers.length === 0) makers.push(() => toPairFrames(scenarios.flick()))
  let which = 0
  let frames = makers[0]()
  let i = 0
  const pipeline = createMultiHandPipeline()
  let epoch = 0
  const id = setInterval(() => {
    if (i >= frames.length) {
      // 1.2s pause, then the next scenario (or loop).
      if (i >= frames.length + 36) {
        epoch += frames[frames.length - 1].tMs + 36 * FRAME_MS
        which = (which + 1) % makers.length
        frames = makers[which]()
        i = 0
        for (const e of pipeline.reset()) {
          bus.emit(e)
          onEvent?.(e)
        }
      } else {
        i++
      }
      return
    }
    const f = frames[i++]
    for (const e of pipeline.process(f.hands, epoch + f.tMs)) {
      bus.emit(e)
      onEvent?.(e)
    }
    drawSyntheticThumb(f.hands, pipeline)
    syncStore(f.hands, pipeline)
  }, FRAME_MS)
  return () => clearInterval(id)
}
