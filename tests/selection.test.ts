import { describe, expect, it } from 'vitest'
import { ORBITS } from '../src/data/orbits'
import {
  analyticFocusWeight,
  focusWeight,
  itemTheta,
  rotateYawPitch,
  yawStep,
} from '../src/orb/geometry'
import { NCONF } from '../src/neural/config'
import { buildGraph } from '../src/neural/graph'
import {
  childShell,
  hubDirs,
  hubOrbitIndex,
  memberDir,
  resolveLevel1,
  resolveReticle,
} from '../src/neural/selection'

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

const nodes = buildGraph()
const { dirs } = hubDirs(nodes)

describe('resolveReticle over the hub shell (level 0)', () => {
  it('memberDir is unit length and matches the graph position direction', () => {
    for (const n of nodes.slice(1, 40)) {
      const d = memberDir(n.phi, n.theta)
      expect(Math.hypot(...d)).toBeCloseTo(1, 9)
    }
  })

  it('agrees with the brute-force vector focus weight for 200 random states', () => {
    const rand = mulberry32(77)
    for (let i = 0; i < 200; i++) {
      const yaw = (rand() - 0.5) * 20
      const pitch = (rand() - 0.5) * 1.7
      let bestI = -1
      let bestW = -Infinity
      for (let d = 0; d < dirs.length; d++) {
        const w = focusWeight(rotateYawPitch(dirs[d], yaw, pitch))
        if (w > bestW) {
          bestW = w
          bestI = d
        }
      }
      const r = resolveReticle(dirs, yaw, pitch)
      expect(r.index).toBe(bestI)
      expect(r.w).toBeCloseTo(bestW, 9)
    }
  })

  it('a hub rotated into the reticle wins with w → 1', () => {
    const h = nodes.find((n) => n.tier === 'hub')
    if (!h) throw new Error('no hub')
    // Rotation that carries dir to +z: yaw so azimuth lands on +z, pitch = elevation.
    const d = memberDir(h.phi, h.theta)
    const yaw = -Math.atan2(d[0], d[2])
    const [, y1, z1] = rotateYawPitch(d, yaw, 0)
    const pitch = Math.atan2(y1, z1)
    const r = resolveReticle(dirs, yaw, pitch)
    expect(r.w).toBeGreaterThan(0.999)
    expect(dirs[r.index]).toEqual(d)
  })
})

describe('category mapping + child shell (level 1)', () => {
  it('every orbit is carried by at least one hub; every report reachable', () => {
    const covered = new Set<number>()
    for (let i = 0; i < NCONF.generation.hubCount; i++) covered.add(hubOrbitIndex(i))
    expect(covered.size).toBe(ORBITS.length)
  })

  it('re-shells the full report list on the globe grid at childShellRadius', () => {
    for (let o = 0; o < ORBITS.length; o++) {
      const shell = childShell(o)
      expect(shell).toHaveLength(ORBITS[o].reports.length)
      for (const item of shell) {
        expect(Math.hypot(...item.local)).toBeCloseTo(NCONF.select.childShellRadius, 6)
        expect(item.phi).toBe(ORBITS[o].latitude)
      }
    }
  })

  it('frozen detents center each report: yaw = -itemTheta, pitch = latitude → w > 0.999', () => {
    for (let o = 0; o < ORBITS.length; o++) {
      const shell = childShell(o)
      const count = shell.length
      for (const item of shell) {
        const r = resolveLevel1(shell, -item.theta, ORBITS[o].latitude)
        expect(r.anchorWins).toBe(false)
        expect(r.item?.itemIndex).toBe(item.itemIndex)
        expect(r.w).toBeGreaterThan(0.999)
        // and the detent grid spacing is the orbit's yawStep
        expect(item.theta).toBeCloseTo(itemTheta(item.itemIndex, count), 12)
        expect(yawStep(count)).toBeCloseTo((Math.PI * 2) / count, 12)
      }
    }
  })

  it('level-1 math IS the globe math (analyticFocusWeight)', () => {
    const rand = mulberry32(99)
    const shell = childShell(2)
    for (let i = 0; i < 50; i++) {
      const yaw = (rand() - 0.5) * 20
      const pitch = (rand() - 0.5) * 1.7
      const r = resolveLevel1(shell, yaw, pitch, -Infinity)
      let bestW = -Infinity
      for (const item of shell) {
        bestW = Math.max(bestW, analyticFocusWeight(item.phi, item.theta, yaw, pitch))
      }
      expect(r.w).toBeCloseTo(bestW, 12)
    }
  })

  it('the anchor takes the reticle when no report holds the focus (§6 drill-out)', () => {
    const shell = childShell(0) // 6 reports, 60° apart
    const midYaw = -itemTheta(0, shell.length) - yawStep(shell.length) / 2
    // pitched well off the orbit latitude, between detents: nothing focused
    const r = resolveLevel1(shell, midYaw, ORBITS[0].latitude - 0.5)
    expect(r.anchorWins).toBe(true)
    expect(r.item).toBeNull()
    // and at a detent the report wins again
    const r2 = resolveLevel1(shell, -itemTheta(2, shell.length), ORBITS[0].latitude)
    expect(r2.anchorWins).toBe(false)
    expect(r2.item?.itemIndex).toBe(2)
  })
})
