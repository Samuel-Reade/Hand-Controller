// Rotation model (S8). The pure core - createPhysicsState / applyInputEvent /
// stepPhysics - is what the unit tests drive headless; useOrbPhysics is the
// thin React shell that owns the state ref and subscribes it to the input
// bus. Nothing here touches React state: yaw, pitch and velocities live in
// a plain mutable object and are written straight to the group refs by the
// single useFrame in Orb.tsx.

import { useEffect } from 'react'
import { FEEL, motionPrefs } from '../config/feel'
import type { FeelConfig } from '../config/feel'
import { ORBITS, PITCH_CLAMP } from '../data/orbits'
import type { OrbitDef } from '../data/orbits'
import type { InputBus, InputEvent } from '../input/InputBus'
import { nearestOrbitIndex, yawStep } from './geometry'

export interface PhysicsState {
  yaw: number
  pitch: number
  yawVel: number
  pitchVel: number
  engaged: boolean
  forcedYaw: number | null
  forcedPitch: number | null
  lockedYaw: boolean
  lockedPitch: boolean
}

export function createPhysicsState(yaw = 0, pitch = 0): PhysicsState {
  return {
    yaw,
    pitch,
    yawVel: 0,
    pitchVel: 0,
    engaged: false,
    forcedYaw: null,
    forcedPitch: null,
    lockedYaw: false,
    lockedPitch: false,
  }
}

function clampPitch(s: PhysicsState, clamp: number): void {
  if (s.pitch > clamp) {
    s.pitch = clamp
    if (s.pitchVel > 0) s.pitchVel = 0
  } else if (s.pitch < -clamp) {
    s.pitch = -clamp
    if (s.pitchVel < 0) s.pitchVel = 0
  }
}

// Orbit latitudes in ascending order, as (latitude, index-into-orbits) pairs.
function latitudesAscending(orbits: readonly OrbitDef[]): number[] {
  return orbits.map((o) => o.latitude).sort((a, b) => a - b)
}

/**
 * Feed one InputEvent into the state (S7 semantics):
 *  - engage zeroes velocity and cancels forced detent targets
 *  - move applies directly while engaged
 *  - release hands trailing velocity to the inertia model
 *  - step sets a forced detent target one item/orbit away (stronger spring);
 *    yaw dir +1 = focus the item currently right of centre (yaw target -step),
 *    pitch dir +1 = one orbit up in latitude. Ignored while engaged - a step
 *    must not fight the hand.
 *  - lost behaves like release with zero velocity
 *  - tap carries no positional information; it ends the engagement (the
 *    gesture machine emits tap INSTEAD of release) and the app layer opens
 *    the focused report off the same event.
 */
export function applyInputEvent(
  s: PhysicsState,
  e: InputEvent,
  orbits: readonly OrbitDef[] = ORBITS,
  pitchClamp: number = PITCH_CLAMP,
): void {
  switch (e.type) {
    case 'engage':
      s.engaged = true
      s.yawVel = 0
      s.pitchVel = 0
      s.forcedYaw = null
      s.forcedPitch = null
      break
    case 'move':
      if (!s.engaged) break
      s.yaw += e.dYaw
      s.pitch += e.dPitch
      clampPitch(s, pitchClamp)
      break
    case 'release':
      s.engaged = false
      s.yawVel = e.vYaw
      s.pitchVel = e.vPitch
      break
    case 'lost':
      s.engaged = false
      s.yawVel = 0
      s.pitchVel = 0
      break
    case 'step': {
      if (s.engaged) break
      if (e.axis === 'pitch') {
        const lats = latitudesAscending(orbits)
        const base = s.forcedPitch ?? orbits[nearestOrbitIndex(orbits, s.pitch)].latitude
        let nearest = 0
        for (let i = 1; i < lats.length; i++) {
          if (Math.abs(lats[i] - base) < Math.abs(lats[nearest] - base)) nearest = i
        }
        const next = Math.min(lats.length - 1, Math.max(0, nearest + e.dir))
        s.forcedPitch = lats[next]
      } else {
        const refPitch = s.forcedPitch ?? s.pitch
        const active = orbits[nearestOrbitIndex(orbits, refPitch)]
        const step = yawStep(active.reports.length)
        const base = s.forcedYaw ?? Math.round(s.yaw / step) * step
        s.forcedYaw = base - e.dir * step
      }
      break
    }
    case 'tap':
      // Tap arrives instead of release - end the engagement with no coast.
      s.engaged = false
      s.yawVel = 0
      s.pitchVel = 0
      break
  }
}

/**
 * Advance one frame while not engaged (S8): integrate, exponential friction,
 * detent springs on both axes, pitch clamp, snap-and-clear.
 */
export function stepPhysics(
  s: PhysicsState,
  dt: number,
  feel: FeelConfig = FEEL,
  orbits: readonly OrbitDef[] = ORBITS,
  pitchClamp: number = PITCH_CLAMP,
): void {
  if (s.engaged) {
    s.lockedYaw = false
    s.lockedPitch = false
    return
  }
  // A background tab must not fling the orb on return.
  if (dt > 0.05) dt = 0.05
  if (dt <= 0) return

  s.yaw += s.yawVel * dt
  s.pitch += s.pitchVel * dt
  const friction =
    feel.friction * (motionPrefs.reducedMotion ? motionPrefs.reducedCoastMultiplier : 1)
  const k = Math.exp(-friction * dt)
  s.yawVel *= k
  s.pitchVel *= k

  const active = orbits[nearestOrbitIndex(orbits, s.pitch)]

  // Pitch: strong spring to the nearest orbit latitude - it snaps, never flings.
  const pitchForced = s.forcedPitch !== null
  const targetPitch = s.forcedPitch ?? active.latitude
  if (pitchForced || Math.abs(s.pitchVel) < feel.detentBelow) {
    const pull = feel.detentPull * (pitchForced ? feel.forcedBoost : 1)
    s.pitchVel += (targetPitch - s.pitch) * pull * dt
  }

  // Yaw: full inertia; the detent grabs only once the coast decays.
  const step = yawStep(active.reports.length)
  const yawForced = s.forcedYaw !== null
  const targetYaw = s.forcedYaw ?? Math.round(s.yaw / step) * step
  if (yawForced || Math.abs(s.yawVel) < feel.detentBelow) {
    const pull = feel.detentPull * (yawForced ? feel.forcedBoost : 1)
    s.yawVel += (targetYaw - s.yaw) * pull * dt
  }

  clampPitch(s, pitchClamp)

  // Snap and clear targets once inside epsilon at near-zero speed.
  if (
    Math.abs(targetYaw - s.yaw) < feel.snapEpsilon &&
    Math.abs(s.yawVel) < feel.snapVelocity
  ) {
    s.yaw = targetYaw
    s.yawVel = 0
    s.forcedYaw = null
    s.lockedYaw = true
  } else {
    s.lockedYaw = false
  }
  if (
    Math.abs(targetPitch - s.pitch) < feel.snapEpsilon &&
    Math.abs(s.pitchVel) < feel.snapVelocity
  ) {
    s.pitch = Math.min(pitchClamp, Math.max(-pitchClamp, targetPitch))
    s.pitchVel = 0
    s.forcedPitch = null
    s.lockedPitch = true
  } else {
    s.lockedPitch = false
  }
}

// ---------------------------------------------------------------------------
// Shared runtime: the one mutable object the 60fps world lives in. The frame
// loop writes it; DOM overlays (labels, telemetry) read it directly. React
// state never sees any of this.

export interface OrbRuntime {
  physics: PhysicsState
  focus: { orbitIndex: number; itemIndex: number }
  labelEls: Map<string, HTMLDivElement>
  fps: number
  lastEvent: string
}

export const orbRuntime: OrbRuntime = {
  physics: createPhysicsState(),
  focus: { orbitIndex: -1, itemIndex: -1 },
  labelEls: new Map(),
  fps: 0,
  lastEvent: '-',
}

// Dev-only: ?yaw=<deg>&pitch=<deg> set the initial orientation so Playwright
// can screenshot deterministic states. Singleton init at module load.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search)
  const yawDeg = parseFloat(params.get('yaw') ?? '')
  const pitchDeg = parseFloat(params.get('pitch') ?? '')
  if (!Number.isNaN(yawDeg)) orbRuntime.physics.yaw = (yawDeg * Math.PI) / 180
  if (!Number.isNaN(pitchDeg)) orbRuntime.physics.pitch = (pitchDeg * Math.PI) / 180
}

/**
 * Subscribe the shared physics state to the input bus. Returns the state
 * object; Orb.tsx steps it inside its single useFrame.
 */
export function useOrbPhysics(bus: InputBus): PhysicsState {
  useEffect(() => {
    return bus.on((e) => {
      orbRuntime.lastEvent = e.type
      applyInputEvent(orbRuntime.physics, e)
    })
  }, [bus])

  return orbRuntime.physics
}
