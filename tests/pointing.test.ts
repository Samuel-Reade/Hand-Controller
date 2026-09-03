// ORB_SELECT_SPEC §7 - the camera-free half of the pointing gate. Highlight
// is a function of (yaw, pitch, viewport), so tests 1-5 (slice PT1) run
// headless against the real graph. Tests 6-10 arrive with PT2/PT3.
import { beforeEach, describe, expect, it } from 'vitest'
import { NCONF } from '../src/neural/config'
import { buildGraph } from '../src/neural/graph'
import type { NeuralNode } from '../src/neural/graph'
import {
  bestCandidate,
  bindReports,
  candidatesFor,
  createHighlightState,
  projectLocal,
  projectNode,
  stepHighlight,
  targetableNames,
} from '../src/neural/pointing'
import type { HighlightCandidate, ViewSpec } from '../src/neural/pointing'

const VIEW: ViewSpec = { camZ: NCONF.camera.z, fovDeg: NCONF.camera.fov, viewportH: 900 }

let nodes: NeuralNode[]
let targetable: Set<string>

beforeEach(() => {
  NCONF.point.acquireRadius = 46
  NCONF.point.releaseRadius = 88
  NCONF.point.switchMargin = 18
  NCONF.point.tieBandPx = 10
  nodes = buildGraph()
  targetable = targetableNames(nodes)
})

/** Deterministic (yaw, pitch) sweep - no clocks, no RNG in the assertions. */
function* rotations(n: number): Generator<[number, number]> {
  let s = 12345
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  for (let i = 0; i < n; i++) {
    yield [rnd() * Math.PI * 2, (rnd() - 0.5) * 2 * NCONF.point.pitchClampFree]
  }
}

describe('projection', () => {
  it('centres the brain and is aspect-independent (px scale is viewport height)', () => {
    const p = projectLocal([0, 0, 0], 0.7, -0.3, VIEW)
    expect(p.dist).toBeCloseTo(0, 9)
    expect(p.w).toBeCloseTo(NCONF.camera.z, 9)
    // a point off-axis scales linearly with viewport height
    const a = projectLocal([100, 0, 0], 0, 0, VIEW)
    const b = projectLocal([100, 0, 0], 0, 0, { ...VIEW, viewportH: 1800 })
    expect(b.dist / a.dist).toBeCloseTo(2, 9)
  })
  it('reports the far side as w <= 0 and never competes', () => {
    const behind = projectLocal([0, 0, NCONF.camera.z + 10], 0, 0, VIEW)
    expect(behind.w).toBeLessThanOrEqual(0)
    expect(bestCandidate([{ name: 'far', dist: 0, w: behind.w }], 10)).toBeNull()
  })
})

describe('§2 targetable set', () => {
  it('binds reports and closes upward over ancestors, never over dead-ends', () => {
    const binding = bindReports(nodes)
    expect(binding.size).toBeGreaterThan(0)
    const byName = new Map(nodes.map((n) => [n.name, n]))
    // every bound node's whole ancestor chain is targetable
    for (const name of binding.keys()) {
      let cur = byName.get(name)
      while (cur) {
        expect(targetable.has(cur.name)).toBe(true)
        cur = cur.parentName ? byName.get(cur.parentName) : undefined
      }
    }
    // the anchor is always targetable (§4 drill-out target)
    expect(targetable.has('brain')).toBe(true)
    // and the filter actually filters - dead-ends exist and are excluded
    expect(targetable.size).toBeLessThan(nodes.length)
    const dead = nodes.filter((n) => !targetable.has(n.name))
    expect(dead.length).toBeGreaterThan(0)
    for (const n of dead) expect(binding.has(n.name)).toBe(false)
  })
})

describe('1. highlightArgmax', () => {
  // The anchor sits at the origin and projects to dead centre at every
  // rotation, so it is excluded from the "nearest wins" comparison - see
  // resolveCandidate's spec-gap note. These assert the ORDINARY argmin.
  const ordinary = (cands: HighlightCandidate[]) => cands.filter((c) => !c.anchor)

  it('over 200 rotations the highlight is the nearest targetable node inside acquireRadius', () => {
    let acquired = 0
    for (const [yaw, pitch] of rotations(200)) {
      const cands = candidatesFor(nodes, targetable, yaw, pitch, VIEW)
      const got = stepHighlight(createHighlightState(), cands)
      const min = ordinary(cands).reduce((m, c) => Math.min(m, c.dist), Infinity)
      if (min > NCONF.point.acquireRadius) {
        // nothing ordinary in range: the anchor takes it, or nothing does
        expect(got.name === null || got.name === 'brain').toBe(true)
        continue
      }
      acquired++
      expect(got.name).not.toBeNull()
      expect(got.name).not.toBe('brain') // an ordinary node in range always beats the anchor
      expect(got.dist).toBeLessThanOrEqual(min + NCONF.point.tieBandPx + 1e-9)
      expect(got.dist).toBeLessThanOrEqual(NCONF.point.acquireRadius)
    }
    expect(acquired).toBeGreaterThan(20) // the sweep actually exercises acquisition
  })

  it('with the tie-band closed, it is exactly the argmin', () => {
    NCONF.point.tieBandPx = 0
    for (const [yaw, pitch] of rotations(60)) {
      const cands = candidatesFor(nodes, targetable, yaw, pitch, VIEW)
      const got = stepHighlight(createHighlightState(), cands)
      if (got.name === null || got.name === 'brain') continue
      const min = Math.min(...ordinary(cands).map((c) => c.dist))
      expect(got.dist).toBeCloseTo(min, 9)
    }
  })
})

describe('§4 anchor is a fallback, not a competitor', () => {
  it('the anchor projects to dead centre at every rotation', () => {
    for (const [yaw, pitch] of rotations(30)) {
      const brain = nodes.find((n) => n.tier === 'brain')!
      expect(projectNode(brain, yaw, pitch, VIEW).dist).toBeCloseTo(0, 9)
    }
  })

  it('an ordinary node inside acquireRadius always beats the dead-centre anchor', () => {
    const s = stepHighlight(createHighlightState(), [
      { name: 'anchor', dist: 0, w: 2000, anchor: true },
      { name: 'hub', dist: NCONF.point.acquireRadius - 1, w: 1000 },
    ])
    expect(s.name).toBe('hub')
  })

  it('the anchor wins only when nothing ordinary is in range (P5 anchorWinsBelow rule)', () => {
    const s = stepHighlight(createHighlightState(), [
      { name: 'anchor', dist: 0, w: 2000, anchor: true },
      { name: 'hub', dist: NCONF.point.acquireRadius + 1, w: 1000 },
    ])
    expect(s.name).toBe('anchor')
  })

  it('the anchor never latches - it yields as soon as a node is acquirable', () => {
    // regression: the anchor sits at distance 0, so releaseRadius is never
    // exceeded and no rival can beat it by switchMargin. Held under the
    // ordinary deadband it would lock on at start-up and never let go.
    let s = stepHighlight(createHighlightState(), [
      { name: 'anchor', dist: 0, w: 2000, anchor: true },
      { name: 'hub', dist: 300, w: 1000 },
    ])
    expect(s.name).toBe('anchor')
    // a node comes into range: the anchor yields immediately, no margin
    s = stepHighlight(s, [
      { name: 'anchor', dist: 0, w: 2000, anchor: true },
      { name: 'hub', dist: NCONF.point.acquireRadius - 1, w: 1000 },
    ])
    expect(s.name).toBe('hub')
    // and when that node leaves, the anchor takes it back
    s = stepHighlight(s, [
      { name: 'anchor', dist: 0, w: 2000, anchor: true },
      { name: 'hub', dist: NCONF.point.releaseRadius + 10, w: 1000 },
    ])
    expect(s.name).toBe('anchor')
  })

  it('the tie-break never elects an out-of-range node over an in-range one', () => {
    // regression: applied to the whole field, the depth tie-break could pick
    // a nearer-camera node just outside acquireRadius and hand the frame to
    // the anchor, even though a closer node was acquirable.
    const s = stepHighlight(createHighlightState(), [
      { name: 'anchor', dist: 0, w: 9000, anchor: true },
      { name: 'inRange', dist: NCONF.point.acquireRadius - 1, w: 100 },
      { name: 'outOfRange', dist: NCONF.point.acquireRadius + 5, w: 8000 },
    ])
    expect(s.name).toBe('inRange')
  })

  it('without the fallback rule the anchor would win essentially always', () => {
    // the regression this guards: measured 294/300 before the rule
    let anchorWins = 0
    for (const [yaw, pitch] of rotations(100)) {
      const cands = candidatesFor(nodes, targetable, yaw, pitch, VIEW)
      const naive = bestCandidate(cands, NCONF.point.tieBandPx)
      if (naive?.name === 'brain') anchorWins++
    }
    expect(anchorWins).toBeGreaterThan(90) // naive nearest-wins is broken here
    // and with the rule, ordinary nodes actually get acquired
    let ordinaryWins = 0
    for (const [yaw, pitch] of rotations(100)) {
      const got = stepHighlight(
        createHighlightState(),
        candidatesFor(nodes, targetable, yaw, pitch, VIEW),
      )
      if (got.name !== null && got.name !== 'brain') ordinaryWins++
    }
    expect(ordinaryWins).toBeGreaterThan(10)
  })
})

describe('2. hysteresis', () => {
  // Two nodes straddling centre; sweeping moves A out and B in.
  const sweep = (steps: number) => {
    const s0 = createHighlightState()
    let s = s0
    const seen: (string | null)[] = []
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const cands: HighlightCandidate[] = [
        { name: 'A', dist: Math.abs(-60 + 120 * t), w: 1000 },
        { name: 'B', dist: Math.abs(60 - 120 * t + 40), w: 1000 },
      ]
      s = stepHighlight(s, cands)
      seen.push(s.name)
    }
    return seen
  }

  it('switches at most once and never oscillates', () => {
    const seen = sweep(240)
    let switches = 0
    for (let i = 1; i < seen.length; i++) {
      if (seen[i] !== seen[i - 1] && seen[i] !== null && seen[i - 1] !== null) switches++
    }
    expect(switches).toBeLessThanOrEqual(1)
  })

  it('a rival inside switchMargin cannot steal the highlight', () => {
    const held = { name: 'A', dist: 30 }
    // B is nearer, but by less than switchMargin
    const s = stepHighlight(held, [
      { name: 'A', dist: 30, w: 1000 },
      { name: 'B', dist: 30 - NCONF.point.switchMargin + 1, w: 1000 },
    ])
    expect(s.name).toBe('A')
    // beat it by more than the margin and it steals
    const s2 = stepHighlight(held, [
      { name: 'A', dist: 30, w: 1000 },
      { name: 'B', dist: 30 - NCONF.point.switchMargin - 1, w: 1000 },
    ])
    expect(s2.name).toBe('B')
  })

  it('holds past acquireRadius and releases only past releaseRadius', () => {
    const between = (NCONF.point.acquireRadius + NCONF.point.releaseRadius) / 2
    const held = { name: 'A', dist: 10 }
    expect(stepHighlight(held, [{ name: 'A', dist: between, w: 1 }]).name).toBe('A')
    const past = NCONF.point.releaseRadius + 1
    expect(stepHighlight(held, [{ name: 'A', dist: past, w: 1 }]).name).toBeNull()
  })
})

describe('3. tolerance', () => {
  it('just outside acquireRadius is not highlighted; just inside is', () => {
    const out = stepHighlight(createHighlightState(), [
      { name: 'A', dist: NCONF.point.acquireRadius + 0.5, w: 1 },
    ])
    expect(out.name).toBeNull()
    const inside = stepHighlight(createHighlightState(), [
      { name: 'A', dist: NCONF.point.acquireRadius - 0.5, w: 1 },
    ])
    expect(inside.name).toBe('A')
  })
})

describe('4. depthTie', () => {
  it('inside tieBandPx the nearer-camera node wins; outside it, distance wins', () => {
    const near = { name: 'near', dist: 20 + NCONF.point.tieBandPx - 1, w: 2000 }
    const far = { name: 'far', dist: 20, w: 100 }
    expect(bestCandidate([far, near])!.name).toBe('near')
    expect(bestCandidate([near, far])!.name).toBe('near')
    // beyond the band, the closer-to-centre node wins regardless of depth
    const wide = { name: 'near', dist: 20 + NCONF.point.tieBandPx + 5, w: 2000 }
    expect(bestCandidate([far, wide])!.name).toBe('far')
  })
})

describe('5. skipStructural', () => {
  it('a non-targetable node dead-centre is never highlighted', () => {
    const dead = nodes.find((n) => !targetable.has(n.name))!
    // find a rotation that brings it near centre, then confirm it is absent
    // from the candidate set and cannot be chosen
    const cands = candidatesFor(nodes, targetable, 0.4, -0.2, VIEW)
    expect(cands.some((c) => c.name === dead.name)).toBe(false)
    // even handed in dead-centre alongside a targetable rival, the model only
    // ever sees what candidatesFor emitted - so the rival wins
    const live = cands[0]
    expect(live).toBeDefined()
    const s = stepHighlight(createHighlightState(), [{ ...live, dist: 5 }])
    expect(s.name).toBe(live.name)
    expect(targetable.has(s.name!)).toBe(true)
  })

  it('every highlight the model can ever return is targetable', () => {
    for (const [yaw, pitch] of rotations(80)) {
      const cands = candidatesFor(nodes, targetable, yaw, pitch, VIEW)
      const s = stepHighlight(createHighlightState(), cands)
      if (s.name !== null) expect(targetable.has(s.name)).toBe(true)
    }
  })
})

describe('PT1 is read-only', () => {
  it('projecting and highlighting never mutates the graph or the config', () => {
    const before = JSON.stringify(nodes)
    const cfgBefore = JSON.stringify(NCONF.point)
    let s = createHighlightState()
    for (const [yaw, pitch] of rotations(50)) {
      s = stepHighlight(s, candidatesFor(nodes, targetable, yaw, pitch, VIEW))
    }
    expect(JSON.stringify(nodes)).toBe(before)
    expect(JSON.stringify(NCONF.point)).toBe(cfgBefore)
  })
  it('projectNode agrees with projectLocal on the node position', () => {
    const n = nodes.find((x) => x.tier === 'hub')!
    const a = projectNode(n, 0.3, 0.1, VIEW)
    const b = projectLocal(
      [
        n.r * Math.sin(n.phi) * Math.cos(n.theta),
        n.r * Math.cos(n.phi),
        n.r * Math.sin(n.phi) * Math.sin(n.theta),
      ],
      0.3,
      0.1,
      VIEW,
    )
    expect(a.dist).toBeCloseTo(b.dist, 9)
  })
})
