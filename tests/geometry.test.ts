import { describe, expect, it } from 'vitest'
import { Group, Object3D, Vector3 } from 'three'
import {
  SPHERE_RADIUS,
  analyticFocusWeight,
  focusWeight,
  focusedItem,
  itemLocalPosition,
  itemTheta,
  itemWorldPosition,
} from '../src/orb/geometry'
import type { OrbitDef } from '../src/data/orbits'
import { ORBITS } from '../src/data/orbits'

const DEG = Math.PI / 180

// Deterministic PRNG so failures reproduce.
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

function testOrbit(latitudeDeg: number, count: number): OrbitDef {
  return {
    id: `t${latitudeDeg}`,
    name: `T${latitudeDeg}`,
    latitudeDeg,
    latitude: latitudeDeg * DEG,
    reports: Array.from({ length: count }, (_, i) => ({ id: `t${latitudeDeg}/${i}`, title: `${i}` })),
  }
}

describe('item placement and focus weight', () => {
  it('yaw = -theta, pitch = phi lands the item at world (0, 0, R) with w > 0.999', () => {
    for (const phiDeg of [46, 23, 0, -23, -46]) {
      const phi = phiDeg * DEG
      for (const theta of [0, 0.7, 2.1, 4.4, 5.9]) {
        const p = itemWorldPosition(phi, theta, -theta, phi)
        expect(Math.abs(p[0])).toBeLessThan(1e-9)
        expect(Math.abs(p[1])).toBeLessThan(1e-9)
        expect(Math.abs(p[2] - SPHERE_RADIUS)).toBeLessThan(1e-9)
        expect(focusWeight(p)).toBeGreaterThan(0.999)
      }
    }
  })

  it('w is symmetric in +/- theta offsets from focus', () => {
    for (const phiDeg of [46, 0, -23]) {
      const phi = phiDeg * DEG
      const theta = 1.3
      for (const delta of [0.1, 0.5, 1.2, 2.0]) {
        const plus = focusWeight(itemWorldPosition(phi, theta + delta, -theta, phi))
        const minus = focusWeight(itemWorldPosition(phi, theta - delta, -theta, phi))
        expect(Math.abs(plus - minus)).toBeLessThan(1e-9)
      }
    }
  })

  it('w < 0 for the antipodal item', () => {
    // Mirrored orbits with even, equal counts contain true antipodes:
    // the antipode of (phi, theta) is (-phi, theta + pi).
    const orbits = [testOrbit(23, 8), testOrbit(-23, 8)]
    const yaw = 0.31
    const pitch = 23 * DEG
    for (let i = 0; i < 8; i++) {
      const theta = itemTheta(i, 8)
      const w = focusWeight(itemWorldPosition(orbits[0].latitude, theta, yaw, pitch))
      const wAnti = focusWeight(
        itemWorldPosition(orbits[1].latitude, theta + Math.PI, yaw, pitch),
      )
      expect(Math.abs(w + wAnti)).toBeLessThan(1e-9) // exact antipode: w flips sign
    }
    // And for the focused item specifically, the antipode is far side.
    const focusedW = focusWeight(itemWorldPosition(23 * DEG, 0, 0, 23 * DEG))
    const antipodalW = focusWeight(itemWorldPosition(-23 * DEG, Math.PI, 0, 23 * DEG))
    expect(focusedW).toBeGreaterThan(0.999)
    expect(antipodalW).toBeLessThan(-0.999)
  })

  it('matches three.js nested-group transforms (sign conventions are real)', () => {
    const rand = mulberry32(7)
    for (let i = 0; i < 25; i++) {
      const phi = (rand() - 0.5) * Math.PI * 0.9
      const theta = rand() * Math.PI * 2
      const yaw = (rand() - 0.5) * 20
      const pitch = (rand() - 0.5) * 1.7
      const tilt = new Group()
      tilt.rotation.x = pitch
      const spin = new Group()
      spin.rotation.y = yaw
      tilt.add(spin)
      const obj = new Object3D()
      obj.position.set(...itemLocalPosition(phi, theta))
      spin.add(obj)
      tilt.updateMatrixWorld(true)
      const world = obj.getWorldPosition(new Vector3())
      const ours = itemWorldPosition(phi, theta, yaw, pitch)
      expect(Math.abs(world.x - ours[0])).toBeLessThan(1e-9)
      expect(Math.abs(world.y - ours[1])).toBeLessThan(1e-9)
      expect(Math.abs(world.z - ours[2])).toBeLessThan(1e-9)
    }
  })

  it('analytic focus weight equals the vector-path focus weight', () => {
    const rand = mulberry32(11)
    for (let i = 0; i < 200; i++) {
      const phi = (rand() - 0.5) * Math.PI * 0.9
      const theta = rand() * Math.PI * 2
      const yaw = (rand() - 0.5) * 20
      const pitch = (rand() - 0.5) * 1.7
      const viaVector = focusWeight(itemWorldPosition(phi, theta, yaw, pitch))
      const viaAngles = analyticFocusWeight(phi, theta, yaw, pitch)
      expect(Math.abs(viaVector - viaAngles)).toBeLessThan(1e-9)
    }
  })

  it('argmax-w agrees with the analytically nearest item for 100 random states', () => {
    const rand = mulberry32(23)
    for (let i = 0; i < 100; i++) {
      const yaw = (rand() - 0.5) * 20
      const pitch = (rand() - 0.5) * 1.7
      // Numeric path: brute-force argmax of w over actual world positions.
      let best = { orbitIndex: -1, itemIndex: -1, w: -Infinity }
      for (let oi = 0; oi < ORBITS.length; oi++) {
        const o = ORBITS[oi]
        for (let ii = 0; ii < o.reports.length; ii++) {
          const w = focusWeight(
            itemWorldPosition(o.latitude, itemTheta(ii, o.reports.length), yaw, pitch),
          )
          if (w > best.w) best = { orbitIndex: oi, itemIndex: ii, w }
        }
      }
      // Analytic path: focusedItem uses the closed-form weight.
      const analytic = focusedItem(ORBITS, yaw, pitch)
      expect(analytic.orbitIndex).toBe(best.orbitIndex)
      expect(analytic.itemIndex).toBe(best.itemIndex)
    }
  })
})
