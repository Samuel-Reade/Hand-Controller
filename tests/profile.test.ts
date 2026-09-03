// The neural FEEL profile (src/neural/profile.ts): the same frozen integrator,
// different constants. These pin the two claims the profile makes - a released
// rotation does NOT drift onto the globe grid, and keyboard step() still works
// without the free detent - against createPhysicsState / applyInputEvent /
// stepPhysics directly.
import { describe, expect, it } from 'vitest'
import { FEEL } from '../src/config/feel'
import type { FeelConfig } from '../src/config/feel'
import { ORBITS } from '../src/data/orbits'
import { yawStep } from '../src/orb/geometry'
import { applyInputEvent, createPhysicsState, stepPhysics } from '../src/orb/useOrbPhysics'
import { NEURAL_FEEL, applyNeuralFeelProfile } from '../src/neural/profile'

const base: FeelConfig = { ...FEEL }
const neural: FeelConfig = { ...FEEL }
applyNeuralFeelProfile(neural)

/** Integrate `seconds` at 60 Hz. */
function settle(s: ReturnType<typeof createPhysicsState>, feel: FeelConfig, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) stepPhysics(s, 1 / 60, feel)
}

const activeStep = (pitch: number) => {
  // the orbit the integrator considers active at this pitch (nearest latitude)
  let best = 0
  for (let i = 1; i < ORBITS.length; i++) {
    if (Math.abs(ORBITS[i].latitude - pitch) < Math.abs(ORBITS[best].latitude - pitch)) best = i
  }
  return yawStep(ORBITS[best].reports.length)
}

describe('profile shape', () => {
  it('overrides exactly the documented keys and nothing else', () => {
    const changed = (Object.keys(neural) as (keyof FeelConfig)[]).filter(
      (k) => neural[k] !== base[k],
    )
    expect(changed.sort()).toEqual((Object.keys(NEURAL_FEEL) as (keyof FeelConfig)[]).sort())
    expect(neural.detentBelow).toBe(0)
    expect(neural.zoomPersist).toBe(true)
    expect(neural.zoomCommitsDrill).toBe(false)
    expect(neural.zoomMax).toBeGreaterThan(base.zoomMax)
    expect(neural.zoomMin).toBeLessThan(base.zoomMin)
  })

  it('does not mutate the shared FEEL when given a target', () => {
    expect(FEEL.detentBelow).toBe(base.detentBelow)
    expect(FEEL.zoomPersist).toBe(base.zoomPersist)
  })
})

describe('no drift after release', () => {
  it('base FEEL: a released rotation coasts and is pulled onto the yaw grid', () => {
    const s = createPhysicsState(0, 0)
    applyInputEvent(s, { type: 'release', vYaw: 2, vPitch: 0 })
    settle(s, base, 4)
    const step = activeStep(s.pitch)
    const gridErr = Math.abs(s.yaw - Math.round(s.yaw / step) * step)
    expect(gridErr).toBeLessThan(0.01) // landed on a detent
    expect(Math.abs(s.yaw)).toBeGreaterThan(0.3) // and travelled a long way to get there
  })

  it('neural profile: the same release settles within ~0.1 rad and is NOT dragged to the grid', () => {
    const s = createPhysicsState(0, 0)
    applyInputEvent(s, { type: 'release', vYaw: 2, vPitch: 0 })
    settle(s, neural, 4)
    // The integrator is discrete Euler (position, then decay) so the coast is
    // v*dt / (1 - e^(-friction*dt)), not the continuous v/friction.
    const dt = 1 / 60
    const coast = (2 * dt) / (1 - Math.exp(-neural.friction * dt))
    expect(s.yaw).toBeCloseTo(coast, 4)
    expect(s.yaw).toBeLessThan(0.1) // the claim in profile.ts
    const step = activeStep(s.pitch)
    const gridErr = Math.abs(s.yaw - Math.round(s.yaw / step) * step)
    expect(gridErr).toBeGreaterThan(0.02) // sitting between detents, exactly where it stopped
    expect(Math.abs(s.yawVel)).toBeLessThan(1e-6)
  })

  it('neural profile: velocity is gone within a quarter second', () => {
    const s = createPhysicsState(0, 0)
    applyInputEvent(s, { type: 'release', vYaw: 6, vPitch: 3 })
    settle(s, neural, 0.25)
    expect(Math.abs(s.yawVel)).toBeLessThan(6 * 0.01)
    expect(Math.abs(s.pitchVel)).toBeLessThan(3 * 0.01)
  })

  it('neural profile: a spurious tiny release velocity moves the view imperceptibly', () => {
    const s = createPhysicsState(0.5, 0.2)
    applyInputEvent(s, { type: 'release', vYaw: 0.4, vPitch: -0.3 })
    settle(s, neural, 2)
    expect(Math.abs(s.yaw - 0.5)).toBeLessThan(0.02) // ~1 degree
    expect(Math.abs(s.pitch - 0.2)).toBeLessThan(0.02)
  })
})

describe('keyboard step() survives detentBelow = 0', () => {
  it('a forced yaw step still converges on its target under the neural profile', () => {
    const s = createPhysicsState(0, 0)
    applyInputEvent(s, { type: 'step', axis: 'yaw', dir: 1 })
    expect(s.forcedYaw).not.toBeNull()
    const target = s.forcedYaw!
    settle(s, neural, 1) // one second - it must be FAST, not merely eventual
    expect(Math.abs(s.yaw - target)).toBeLessThan(0.02)
    expect(s.forcedYaw).toBeNull() // snapped and cleared
  })

  it('forcedBoost 25 is critically damped against friction 30 - no overshoot', () => {
    const k = neural.detentPull * neural.forcedBoost
    expect(2 * Math.sqrt(k)).toBeCloseTo(neural.friction, 6)
    const s = createPhysicsState(0, 0)
    applyInputEvent(s, { type: 'step', axis: 'yaw', dir: 1 })
    const target = s.forcedYaw!
    let overshoot = 0
    for (let i = 0; i < 120; i++) {
      stepPhysics(s, 1 / 60, neural)
      if (target < 0 && s.yaw < target) overshoot = Math.max(overshoot, target - s.yaw)
      if (target > 0 && s.yaw > target) overshoot = Math.max(overshoot, s.yaw - target)
    }
    expect(overshoot).toBeLessThan(0.005)
  })

  it('a forced pitch step still converges too', () => {
    const s = createPhysicsState(0, 0)
    applyInputEvent(s, { type: 'step', axis: 'pitch', dir: 1 })
    const target = s.forcedPitch!
    settle(s, neural, 1)
    expect(Math.abs(s.pitch - target)).toBeLessThan(0.02)
  })
})

describe('pitch clamp parameter', () => {
  it('the integrator honours a wider clamp than the globe grid without any edit', () => {
    const wide = 1.65
    const s = createPhysicsState(0, 0)
    applyInputEvent(s, { type: 'engage' })
    applyInputEvent(s, { type: 'move', dYaw: 0, dPitch: 1.5 }, ORBITS, wide)
    expect(s.pitch).toBeCloseTo(1.5, 9) // well past the globe's ~0.86 clamp
    applyInputEvent(s, { type: 'move', dYaw: 0, dPitch: 1.0 }, ORBITS, wide)
    expect(s.pitch).toBe(wide) // and clamped at the wide limit
  })
})
