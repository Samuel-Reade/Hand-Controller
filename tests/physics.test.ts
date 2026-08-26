import { describe, expect, it } from 'vitest'
import { FEEL, motionPrefs } from '../src/config/feel'
import { ORBITS, PITCH_CLAMP } from '../src/data/orbits'
import { nearestOrbitIndex, yawStep } from '../src/orb/geometry'
import {
  applyInputEvent,
  createPhysicsState,
  stepPhysics,
} from '../src/orb/useOrbPhysics'
import type { PhysicsState } from '../src/orb/useOrbPhysics'

const DT = 1 / 120

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

function simulate(s: PhysicsState, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) stepPhysics(s, DT)
}

function atDetent(s: PhysicsState): boolean {
  const active = ORBITS[nearestOrbitIndex(ORBITS, s.pitch)]
  const step = yawStep(active.reports.length)
  const yawErr = Math.abs(s.yaw - Math.round(s.yaw / step) * step)
  const pitchErr = Math.abs(s.pitch - active.latitude)
  return yawErr < 1e-6 && pitchErr < 1e-6
}

describe('detent convergence', () => {
  it('reaches a detent from 200 random states within 3 simulated seconds and stays', () => {
    const rand = mulberry32(42)
    for (let i = 0; i < 200; i++) {
      const s = createPhysicsState(
        (rand() - 0.5) * 2 * Math.PI,
        (rand() - 0.5) * 2 * PITCH_CLAMP,
      )
      s.yawVel = (rand() - 0.5) * 1.0 // small velocity
      s.pitchVel = (rand() - 0.5) * 1.0
      simulate(s, 3)
      expect(atDetent(s), `state ${i} did not settle: yaw=${s.yaw} pitch=${s.pitch}`).toBe(true)
      const yawAfter = s.yaw
      const pitchAfter = s.pitch
      simulate(s, 1)
      expect(s.yaw).toBe(yawAfter) // stays put
      expect(s.pitch).toBe(pitchAfter)
    }
  })
})

describe('release behaviour', () => {
  it('a flick-velocity release travels at least one item before settling', () => {
    const s = createPhysicsState(0, 0) // equator orbit, at a detent
    const step = yawStep(ORBITS[nearestOrbitIndex(ORBITS, 0)].reports.length)
    applyInputEvent(s, { type: 'engage' })
    applyInputEvent(s, { type: 'release', vYaw: 6, vPitch: 0 })
    simulate(s, 5)
    expect(atDetent(s)).toBe(true)
    expect(Math.abs(s.yaw)).toBeGreaterThanOrEqual(step)
  })

  it('a near-zero release settles onto the nearest item, never the next one', () => {
    const step = yawStep(ORBITS[2].reports.length)
    // Offsets on both sides of a detent, up to just short of the midpoint.
    for (const frac of [0.05, 0.2, 0.35, 0.49, -0.05, -0.2, -0.35, -0.49]) {
      const s = createPhysicsState(step * 3 + frac * step, 0)
      applyInputEvent(s, { type: 'engage' })
      applyInputEvent(s, { type: 'release', vYaw: 0.05 * Math.sign(frac || 1), vPitch: 0 })
      simulate(s, 5)
      expect(atDetent(s)).toBe(true)
      expect(s.yaw).toBeCloseTo(step * 3, 6) // the nearest detent, not a neighbour
    }
  })
})

describe('pitch clamp', () => {
  it('pitch never exceeds the clamp for any input sequence', () => {
    const rand = mulberry32(1234)
    const s = createPhysicsState(0, 0)
    const check = () => {
      expect(Math.abs(s.pitch)).toBeLessThanOrEqual(PITCH_CLAMP + 1e-9)
    }
    // Adversarial mix: violent releases, drags past the clamp, steps, dropouts.
    for (let round = 0; round < 40; round++) {
      applyInputEvent(s, { type: 'engage' })
      for (let i = 0; i < 30; i++) {
        applyInputEvent(s, { type: 'move', dYaw: (rand() - 0.5) * 0.4, dPitch: (rand() - 0.5) * 0.6 })
        check()
      }
      if (round % 3 === 0) {
        applyInputEvent(s, { type: 'lost' })
      } else {
        applyInputEvent(s, {
          type: 'release',
          vYaw: (rand() - 0.5) * 40,
          vPitch: (rand() - 0.5) * 40,
        })
      }
      for (let i = 0; i < 120; i++) {
        stepPhysics(s, DT)
        check()
      }
      applyInputEvent(s, { type: 'step', axis: 'pitch', dir: rand() > 0.5 ? 1 : -1 })
      for (let i = 0; i < 60; i++) {
        stepPhysics(s, DT)
        check()
      }
    }
  })
})

describe('step targeting', () => {
  it('yaw step dir +1 targets one item lower in yaw (focus moves right)', () => {
    const s = createPhysicsState(0, 0)
    const step = yawStep(ORBITS[2].reports.length)
    applyInputEvent(s, { type: 'step', axis: 'yaw', dir: 1 })
    expect(s.forcedYaw).toBeCloseTo(-step, 9)
    applyInputEvent(s, { type: 'step', axis: 'yaw', dir: 1 })
    expect(s.forcedYaw).toBeCloseTo(-2 * step, 9) // steps compose
    simulate(s, 3)
    expect(s.yaw).toBeCloseTo(-2 * step, 2)
    expect(s.forcedYaw).toBeNull() // snapped and cleared
  })

  it('pitch steps walk the orbit ladder and clamp at the ends', () => {
    const s = createPhysicsState(0, 0)
    applyInputEvent(s, { type: 'step', axis: 'pitch', dir: 1 })
    expect(s.forcedPitch).toBeCloseTo(ORBITS[1].latitude, 9) // +23 deg
    applyInputEvent(s, { type: 'step', axis: 'pitch', dir: 1 })
    applyInputEvent(s, { type: 'step', axis: 'pitch', dir: 1 })
    expect(s.forcedPitch).toBeCloseTo(ORBITS[0].latitude, 9) // top; further +1 stays
    applyInputEvent(s, { type: 'step', axis: 'pitch', dir: 1 })
    expect(s.forcedPitch).toBeCloseTo(ORBITS[0].latitude, 9)
    simulate(s, 3)
    expect(s.pitch).toBeCloseTo(ORBITS[0].latitude, 2)
  })

  it('engage cancels forced targets and zeroes velocity', () => {
    const s = createPhysicsState(0, 0)
    applyInputEvent(s, { type: 'step', axis: 'yaw', dir: -1 })
    applyInputEvent(s, { type: 'release', vYaw: 3, vPitch: 0 }) // stale but present
    applyInputEvent(s, { type: 'engage' })
    expect(s.forcedYaw).toBeNull()
    expect(s.yawVel).toBe(0)
    expect(s.pitchVel).toBe(0)
  })
})

describe('frame-time hygiene', () => {
  it('clamps dt so a background tab cannot fling the orb', () => {
    const s = createPhysicsState(0, 0)
    applyInputEvent(s, { type: 'engage' })
    applyInputEvent(s, { type: 'release', vYaw: 2, vPitch: 0 })
    const before = s.yaw
    stepPhysics(s, 4.0) // tab was hidden for 4 seconds
    expect(Math.abs(s.yaw - before)).toBeLessThanOrEqual(2 * 0.05 + 1e-9)
  })

  it('uses live FEEL values (leva mutates the object in place)', () => {
    const original = FEEL.friction
    try {
      const a = createPhysicsState(0, 0)
      a.yawVel = 3
      FEEL.friction = 0.5
      stepPhysics(a, DT)
      const slowDecay = a.yawVel
      const b = createPhysicsState(0, 0)
      b.yawVel = 3
      FEEL.friction = 8
      stepPhysics(b, DT)
      expect(b.yawVel).toBeLessThan(slowDecay)
    } finally {
      FEEL.friction = original
    }
  })
})

describe('tap', () => {
  it('ends the engagement with no coast (tap arrives instead of release)', () => {
    const s = createPhysicsState(0, 0)
    applyInputEvent(s, { type: 'engage' })
    applyInputEvent(s, { type: 'move', dYaw: 0.001, dPitch: 0 })
    applyInputEvent(s, { type: 'tap' })
    expect(s.engaged).toBe(false)
    expect(s.yawVel).toBe(0)
    simulate(s, 3)
    expect(atDetent(s)).toBe(true)
  })
})

describe('prefers-reduced-motion', () => {
  it('shortens the coast substantially without disabling inertia', () => {
    const coastDistance = (reduced: boolean) => {
      motionPrefs.reducedMotion = reduced
      const s = createPhysicsState(0, 0)
      applyInputEvent(s, { type: 'engage' })
      applyInputEvent(s, { type: 'release', vYaw: 8, vPitch: 0 })
      simulate(s, 6)
      motionPrefs.reducedMotion = false
      return Math.abs(s.yaw)
    }
    const normal = coastDistance(false)
    const reduced = coastDistance(true)
    expect(reduced).toBeGreaterThan(0) // inertia still exists
    expect(reduced).toBeLessThan(normal * 0.5) // but substantially shorter
  })
})
