// Click-to-centre (docs/DECISIONS.md): the mouse hit-test and the centre
// blend, headless against the real graph. The "done" criterion in maths:
// after the blend, the clicked node projects to screen centre.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createCenterState,
  currentCenter,
  currentPushWeight,
  pinPoint,
  setCenterTarget,
  stepCenter,
} from '../src/neural/centering'
import { DISC_FRACTION, NCONF } from '../src/neural/config'
import { buildGraph, nodePosition } from '../src/neural/graph'
import type { NeuralNode } from '../src/neural/graph'
import { rotateYawPitch } from '../src/orb/geometry'
import type { Vec3 } from '../src/orb/geometry'
import { hitTestNodes, projectLocal, projectNode } from '../src/neural/pointing'
import type { ViewSpec } from '../src/neural/pointing'

const VIEW: ViewSpec = { camZ: NCONF.camera.z, fovDeg: NCONF.camera.fov, viewportH: 900 }
const FOCAL = VIEW.viewportH / 2 / Math.tan((VIEW.fovDeg * Math.PI) / 360)
const DIAM = 40
const disc = (diam: number, w: number) => ((diam * NCONF.render.spriteScale * DISC_FRACTION) / 2) * (FOCAL / w)
const radius = (_n: NeuralNode, w: number) => disc(DIAM, w)
/** The scene's hit radius: disc x glow multiplier, floored (select.click*). */
const hitRadius = (diam: number, w: number) =>
  Math.max(NCONF.select.clickMinRadiusPx, disc(diam, w) * NCONF.select.clickRadiusMult)

let nodes: NeuralNode[]
beforeEach(() => {
  nodes = buildGraph()
})

function* rotations(n: number): Generator<[number, number]> {
  let s = 777
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  for (let i = 0; i < n; i++) {
    yield [rnd() * Math.PI * 2, (rnd() - 0.5) * 2 * Math.PI]
  }
}

/** The offset the scene applies for a centre point: -rotate(pin). */
function offsetFor(pin: Vec3, yaw: number, pitch: number): Vec3 {
  const p = rotateYawPitch(pin, yaw, pitch)
  return [-p[0], -p[1], -p[2]]
}

describe('hit-test', () => {
  it('hits the node under the click, inside its hit radius, and not beyond', () => {
    const [yaw, pitch] = [0.4, -0.2]
    const n = nodes.find((x) => x.tier === 'hub' && projectNode(x, yaw, pitch, VIEW).w > 0)!
    const p = projectNode(n, yaw, pitch, VIEW)
    const r = radius(n, p.w)
    const at = (dx: number, dy: number) =>
      hitTestNodes(nodes, yaw, pitch, VIEW, p.x + dx, p.y + dy, radius)
    expect(at(0, 0)?.name).toBe(n.name)
    // just inside the radius still hits THIS node or an overlapping one,
    // well outside it is not this node
    expect(at(r - 0.5, 0)).not.toBeNull()
    const outside = at(0, r + 40)
    expect(outside?.name ?? null).not.toBe(n.name)
  })

  it('ALL nodes are clickable: a minor post is hittable at its glow, not its 2 px disc', () => {
    // the smallest disc in the field, at rest zoom
    const minor = nodes.filter((x) => x.tier !== 'brain')
    const [yaw, pitch] = [0.0, 0.0]
    let tiny: { n: NeuralNode; w: number } | null = null
    for (const n of minor) {
      const p = projectNode(n, yaw, pitch, VIEW)
      if (p.w > 0 && (!tiny || p.w > tiny.w)) tiny = { n, w: p.w }
    }
    const discPx = disc(NCONF.rallies.diamMin, tiny!.w)
    expect(discPx).toBeLessThan(3) // the bug: this was the whole hit target
    const hr = hitRadius(NCONF.rallies.diamMin, tiny!.w)
    expect(hr).toBeGreaterThanOrEqual(NCONF.select.clickMinRadiusPx)
    // and with the scene's radius every node in the field is hittable at its centre
    const rad = (_n: NeuralNode, w: number) => hitRadius(NCONF.rallies.diamMin, w)
    for (const n of nodes) {
      const p = projectNode(n, yaw, pitch, VIEW)
      if (p.w <= 0) continue
      const hit = hitTestNodes(nodes, yaw, pitch, VIEW, p.x, p.y, rad)
      expect(hit).not.toBeNull()
      // dead-centre on a node, the winner is at distance 0 - itself or an
      // exact overlap, never a neighbour elected over it
      expect(hit!.dist).toBeLessThan(1e-9)
    }
  })

  it('any node competes - a structural dead-end is clickable, and so is the brain', () => {
    const brain = nodes.find((x) => x.tier === 'brain')!
    const b = hitTestNodes(nodes, 0.9, 0.3, VIEW, 0, 0, (n, w) =>
      n.tier === 'brain' ? ((NCONF.anchor.brainDiam * NCONF.render.spriteScale * DISC_FRACTION) / 2) * (FOCAL / w) : 0,
    )
    expect(b?.name).toBe(brain.name)
  })

  it('overlapping discs go to the one the click is most centred on', () => {
    const [yaw, pitch] = [1.1, 0.1]
    // two synthetic nodes projecting 10px apart with 30px discs
    const a: NeuralNode = { ...nodes[1], name: 'a', r: 500, phi: Math.PI / 2, theta: 0 }
    const b: NeuralNode = { ...nodes[1], name: 'b', r: 500, phi: Math.PI / 2 + 0.01, theta: 0 }
    const pa = projectNode(a, yaw, pitch, VIEW)
    const pb = projectNode(b, yaw, pitch, VIEW)
    const big = () => 30
    expect(hitTestNodes([a, b], yaw, pitch, VIEW, pa.x, pa.y, big)?.name).toBe('a')
    expect(hitTestNodes([a, b], yaw, pitch, VIEW, pb.x, pb.y, big)?.name).toBe('b')
  })

  it('never hits the far side', () => {
    const behind: NeuralNode = { ...nodes[1], name: 'behind', r: NCONF.camera.z + 100, phi: Math.PI / 2, theta: Math.PI / 2 }
    expect(projectNode(behind, 0, 0, VIEW).w).toBeLessThanOrEqual(0)
    expect(hitTestNodes([behind], 0, 0, VIEW, 0, 0, () => 1e6)).toBeNull()
  })

  it('empty space is a miss', () => {
    expect(hitTestNodes(nodes, 0.2, 0.2, VIEW, 5000, 5000, radius)).toBeNull()
  })
})

describe('centre blend', () => {
  const dur = NCONF.select.recenterDuration / 1000

  it('starts at the origin and stays there until a target is set', () => {
    let s = createCenterState()
    expect(currentCenter(s)).toEqual([0, 0, 0])
    s = stepCenter(s, 1, dur)
    expect(currentCenter(s)).toEqual([0, 0, 0])
    expect(s.name).toBeNull()
  })

  it('flies to the target over recenterDuration, eased, and lands exactly', () => {
    let s = setCenterTarget(createCenterState(), 'x', [300, -200, 100])
    let lastDist = 0
    for (let t = 0; t < dur + 0.1; t += 1 / 120) {
      s = stepCenter(s, 1 / 120, dur)
      const c = currentCenter(s)
      const dist = Math.hypot(c[0], c[1], c[2])
      expect(dist).toBeGreaterThanOrEqual(lastDist - 1e-9) // monotone, no overshoot
      lastDist = dist
    }
    expect(s.k).toBe(1)
    expect(currentCenter(s)).toEqual([300, -200, 100])
  })

  it('retargets mid-flight from where it is - no jump', () => {
    let s = setCenterTarget(createCenterState(), 'x', [1000, 0, 0])
    s = stepCenter(s, dur / 2, dur)
    const mid = currentCenter(s)
    expect(mid[0]).toBeGreaterThan(0)
    expect(mid[0]).toBeLessThan(1000)
    s = setCenterTarget(s, 'y', [0, 1000, 0])
    expect(currentCenter(s)).toEqual(mid)
    expect(s.k).toBe(0)
  })

  it('clicking the centred node again is a no-op on the blend (the confirm path)', () => {
    let s = setCenterTarget(createCenterState(), 'x', [1, 2, 3])
    s = stepCenter(s, 10, dur)
    expect(setCenterTarget(s, 'x', [1, 2, 3])).toBe(s)
  })

  it('home (Escape): the centre returns to the origin from anywhere, over one blend', () => {
    let s = setCenterTarget(createCenterState(), 'x', [400, 300, -200])
    s = stepCenter(s, 10, dur)
    s = setCenterTarget(s, null, [0, 0, 0])
    expect(s.name).toBeNull()
    expect(currentCenter(s)).toEqual([400, 300, -200]) // starts where it is
    s = stepCenter(s, dur / 2, dur)
    const mid = currentCenter(s)
    expect(Math.hypot(...mid)).toBeGreaterThan(0)
    expect(Math.hypot(...mid)).toBeLessThan(Math.hypot(400, 300, -200))
    s = stepCenter(s, dur, dur)
    expect(currentCenter(s)).toEqual([0, 0, 0])
    // home when already home is a no-op
    expect(setCenterTarget(s, null, [0, 0, 0])).toBe(s)
  })

  it('home while drilled: the pin blends from the hub to the origin as the drill flies out', () => {
    const hub: Vec3 = [600, -100, 250]
    // drilled and centred on the hub (the scene sets both on drill-in via a click)
    let s = setCenterTarget(createCenterState(), 'hub', hub)
    s = stepCenter(s, 10, dur)
    expect(pinPoint(currentCenter(s), hub, 1)).toEqual(hub)
    s = setCenterTarget(s, null, [0, 0, 0])
    // drill-out k and the centre blend run on the same clock
    let last = Math.hypot(...hub)
    for (let t = 0; t <= 1.001; t += 0.1) {
      s = stepCenter(s, dur * 0.1, dur)
      const kDrill = 1 - s.k
      const pin = pinPoint(currentCenter(s), hub, kDrill)
      const d = Math.hypot(...pin)
      expect(d).toBeLessThanOrEqual(last + 1e-9)
      last = d
    }
    expect(last).toBeLessThan(1e-9)
  })

  it('orbit radius: the camera push weight is 0 at home, 1 on a node, blended on the same clock', () => {
    let s = createCenterState()
    expect(currentPushWeight(s)).toBe(0)
    s = setCenterTarget(s, 'x', [100, 0, 0])
    expect(currentPushWeight(s)).toBe(0) // starts from rest
    s = stepCenter(s, dur / 2, dur)
    const half = currentPushWeight(s)
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(1)
    // position and push share the easing: same fraction of the way
    expect(currentCenter(s)[0] / 100).toBeCloseTo(half, 9)
    s = stepCenter(s, dur, dur)
    expect(currentPushWeight(s)).toBe(1)
    // node -> node keeps the camera in (1 -> 1), no bounce
    s = setCenterTarget(s, 'y', [0, 100, 0])
    s = stepCenter(s, dur / 3, dur)
    expect(currentPushWeight(s)).toBe(1)
    // home pulls it back out
    s = setCenterTarget(s, null, [0, 0, 0])
    s = stepCenter(s, dur * 2, dur)
    expect(currentPushWeight(s)).toBe(0)
  })

  it('the drill composes on top: kDrill 0 = centre, 1 = hub', () => {
    expect(pinPoint([10, 20, 30], [100, 200, 300], 0)).toEqual([10, 20, 30])
    expect(pinPoint([10, 20, 30], [100, 200, 300], 1)).toEqual([100, 200, 300])
    expect(pinPoint([10, 20, 30], null, 0.7)).toEqual([10, 20, 30])
    // and with the centre at the origin the drill's own recenter is unchanged
    const k = 0.37
    expect(pinPoint([0, 0, 0], [100, 200, 300], k)).toEqual([100 * k, 200 * k, 300 * k])
  })
})

describe('done when: the clicked node is the centre of view', () => {
  it('after the blend, every node projects to screen centre at any rotation', () => {
    const dur = NCONF.select.recenterDuration / 1000
    let i = 0
    for (const n of nodes) {
      if (i++ % 7 !== 0) continue // a spread of the field, not all 400+
      let s = setCenterTarget(createCenterState(), n.name, nodePosition(n))
      s = stepCenter(s, dur + 1, dur)
      for (const [yaw, pitch] of rotations(5)) {
        const offset = offsetFor(pinPoint(currentCenter(s), null, 0), yaw, pitch)
        const p = projectLocal(nodePosition(n), yaw, pitch, { ...VIEW, offset })
        expect(p.w).toBeCloseTo(NCONF.camera.z, 6) // on the axis at the rest distance
        expect(p.dist).toBeLessThan(1e-6)
      }
    }
  })

  it('and the field rotates ABOUT the centred node - it stays put while others move', () => {
    const n = nodes.find((x) => x.tier === 'hub')!
    const other = nodes.find((x) => x.tier === 'hub' && x !== n)!
    const dur = NCONF.select.recenterDuration / 1000
    let s = setCenterTarget(createCenterState(), n.name, nodePosition(n))
    s = stepCenter(s, dur + 1, dur)
    const c = currentCenter(s)
    const at = (yaw: number, pitch: number) => {
      const offset = offsetFor(c, yaw, pitch)
      return {
        n: projectLocal(nodePosition(n), yaw, pitch, { ...VIEW, offset }),
        o: projectLocal(nodePosition(other), yaw, pitch, { ...VIEW, offset }),
      }
    }
    const a = at(0, 0)
    const b = at(0.5, 0.2)
    expect(a.n.dist).toBeLessThan(1e-6)
    expect(b.n.dist).toBeLessThan(1e-6)
    expect(Math.hypot(a.o.x - b.o.x, a.o.y - b.o.y)).toBeGreaterThan(1)
  })
})
