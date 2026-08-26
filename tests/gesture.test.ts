import { beforeEach, describe, expect, it } from 'vitest'
import { FEEL } from '../src/config/feel'
import type { InputEvent } from '../src/input/InputBus'
import { OneEuroFilter } from '../src/input/OneEuroFilter'
import { createHandPipeline } from '../src/input/gestureMachine'
import {
  handPosition,
  handScale,
  mirrorX,
  pinchRatio,
} from '../src/input/landmarks'
import { FRAME_MS, makeHand, scenarios } from '../src/dev/syntheticHand'

function run(name: keyof typeof scenarios): InputEvent[] {
  const pipeline = createHandPipeline()
  const events: InputEvent[] = []
  for (const frame of scenarios[name]()) {
    events.push(...pipeline.process(frame.landmarks, frame.tMs))
  }
  return events
}

const ofType = <T extends InputEvent['type']>(events: InputEvent[], type: T) =>
  events.filter((e): e is Extract<InputEvent, { type: T }> => e.type === type)

beforeEach(() => {
  // Tests run against the shipped defaults.
  FEEL.minCutoff = 1.0
  FEEL.beta = 0.03
  FEEL.deadZone = 0.004
  FEEL.pinchCutoff = 8.0
  FEEL.pinchClose = 0.28
  FEEL.pinchOpen = 0.38
  FEEL.tapMaxMs = 250
  FEEL.tapMaxTravel = 0.02
  FEEL.handGain = 2.6
})

describe('landmarks (pure)', () => {
  const noNoise = () => 0
  it('mirrors x', () => {
    expect(mirrorX({ x: 0.2, y: 0.7 })).toEqual({ x: 0.8, y: 0.7 })
  })
  it('handScale is wrist-to-knuckle distance', () => {
    const h = makeHand(0.5, 0.5, 0.09, 0.3, noNoise)
    expect(handScale(h)).toBeCloseTo(0.09, 10) // template: |wrist-mcp9| = 1 unit
  })
  it('pinch ratio is scale-invariant', () => {
    const near = makeHand(0.5, 0.5, 0.12, 0.3, noNoise)
    const far = makeHand(0.5, 0.5, 0.06, 0.3, noNoise)
    expect(pinchRatio(near)).toBeCloseTo(0.3, 10)
    expect(pinchRatio(far)).toBeCloseTo(0.3, 10)
  })
  it('hand position is the mirrored knuckle', () => {
    const h = makeHand(0.4, 0.6, 0.09, 0.3, noNoise)
    expect(handPosition(h)).toEqual({ x: 1 - h[9].x, y: h[9].y })
  })
})

describe('OneEuroFilter (pure)', () => {
  const params = { minCutoff: 1.0, beta: 0.03 }
  it('passes the first sample through and converges on a constant', () => {
    const f = new OneEuroFilter()
    expect(f.filter(0.5, 0, params)).toBe(0.5)
    let out = 0
    for (let i = 1; i <= 120; i++) out = f.filter(0.8, i / 30, params)
    expect(out).toBeCloseTo(0.8, 3)
  })
  it('shrinks noise variance when still', () => {
    let a = 987654321 >>> 0
    const rand = () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const f = new OneEuroFilter()
    const raw: number[] = []
    const filtered: number[] = []
    for (let i = 0; i < 300; i++) {
      const x = 0.5 + (rand() - 0.5) * 0.01
      raw.push(x)
      filtered.push(f.filter(x, i / 30, params))
    }
    const variance = (xs: number[]) => {
      const tail = xs.slice(50)
      const mean = tail.reduce((s, x) => s + x, 0) / tail.length
      return tail.reduce((s, x) => s + (x - mean) ** 2, 0) / tail.length
    }
    expect(variance(filtered)).toBeLessThan(variance(raw) * 0.25)
  })
  it('beta reduces lag on fast motion', () => {
    const lagAt = (beta: number) => {
      const f = new OneEuroFilter()
      let out = 0
      for (let i = 0; i < 30; i++) {
        const x = i * 0.02 // fast ramp
        out = f.filter(x, i / 30, { minCutoff: 1.0, beta })
      }
      return 29 * 0.02 - out
    }
    expect(lagAt(0.05)).toBeLessThan(lagAt(0))
  })
  it('holds on a non-monotonic timestamp instead of exploding', () => {
    const f = new OneEuroFilter()
    f.filter(0.5, 1, params)
    const out = f.filter(9.9, 1, params) // same timestamp
    expect(out).toBeCloseTo(0.5, 10)
  })
})

describe('synthetic hand scenarios (S9b)', () => {
  it('still: no events at all - no spurious engage, dead zone holds', () => {
    expect(run('still')).toEqual([])
  })

  it('stillPinched: one engage, zero moves from noise, one quiet release', () => {
    const events = run('stillPinched')
    expect(ofType(events, 'engage')).toHaveLength(1)
    expect(ofType(events, 'move')).toHaveLength(0)
    const releases = ofType(events, 'release')
    expect(releases).toHaveLength(1)
    expect(Math.hypot(releases[0].vYaw, releases[0].vPitch)).toBeLessThan(0.5)
  })

  it('flick: exactly one engage -> moves -> one release above the coast threshold', () => {
    const events = run('flick')
    expect(ofType(events, 'engage')).toHaveLength(1)
    expect(ofType(events, 'move').length).toBeGreaterThan(2)
    const releases = ofType(events, 'release')
    expect(releases).toHaveLength(1)
    expect(Math.abs(releases[0].vYaw)).toBeGreaterThan(FEEL.detentBelow)
    expect(releases[0].vYaw).toBeGreaterThan(0) // image-left sweep, mirrored = rightward = +yaw
    expect(ofType(events, 'tap')).toHaveLength(0)
    expect(ofType(events, 'lost')).toHaveLength(0)
  })

  it('slowDrag: one engage, sustained moves, release at low velocity', () => {
    const events = run('slowDrag')
    expect(ofType(events, 'engage')).toHaveLength(1)
    expect(ofType(events, 'move').length).toBeGreaterThan(20)
    const releases = ofType(events, 'release')
    expect(releases).toHaveLength(1)
    expect(Math.hypot(releases[0].vYaw, releases[0].vPitch)).toBeLessThan(FEEL.detentBelow)
    expect(ofType(events, 'tap')).toHaveLength(0)
  })

  it('tap: exactly one tap, zero moves beyond dead-zone noise', () => {
    const events = run('tap')
    expect(ofType(events, 'tap')).toHaveLength(1)
    expect(ofType(events, 'engage')).toHaveLength(1)
    expect(ofType(events, 'move')).toHaveLength(0)
    expect(ofType(events, 'release')).toHaveLength(0)
  })

  it('pinchJitter: at most one engage/release pair - hysteresis holds', () => {
    const events = run('pinchJitter')
    expect(ofType(events, 'engage').length).toBeLessThanOrEqual(1)
    expect(ofType(events, 'release').length).toBeLessThanOrEqual(1)
    expect(ofType(events, 'tap')).toHaveLength(0)
  })

  it('dropout: exactly one lost, no release with garbage velocity', () => {
    const events = run('dropout')
    expect(ofType(events, 'engage')).toHaveLength(1)
    expect(ofType(events, 'lost')).toHaveLength(1)
    expect(ofType(events, 'release')).toHaveLength(0)
  })

  it('approach: near and far runs emit the same total rotation within 10%', () => {
    const total = (events: InputEvent[]) =>
      ofType(events, 'move').reduce((s, m) => s + Math.abs(m.dYaw), 0)
    const near = total(run('approachNear'))
    const far = total(run('approachFar'))
    expect(near).toBeGreaterThan(0.5) // the sweep actually rotated the orb
    expect(Math.abs(near - far) / Math.max(near, far)).toBeLessThan(0.1)
  })

  it('frames arrive at 30Hz', () => {
    const frames = scenarios.flick()
    expect(frames[1].tMs - frames[0].tMs).toBeCloseTo(FRAME_MS, 6)
  })
})
