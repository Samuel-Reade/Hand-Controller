import { describe, expect, it } from 'vitest'
import { NCONF, generationTuple, tupleHash } from '../src/neural/config'
import type { NeuralConfig } from '../src/neural/config'
import { buildGraph, layoutHash, nodePosition } from '../src/neural/graph'
import { TIER_OPA } from '../src/neural/palette'

const clone = (): NeuralConfig => JSON.parse(JSON.stringify(NCONF)) as NeuralConfig

describe('graph determinism (P2 machine gate)', () => {
  it('same config tuple + seed → identical layout hash', () => {
    const a = layoutHash(buildGraph())
    const b = layoutHash(buildGraph())
    expect(a).toBe(b)
    expect(tupleHash(generationTuple())).toBe(tupleHash(generationTuple()))
  })

  it('a different seed → a different layout', () => {
    const c = clone()
    c.generation.seed = 12345
    expect(layoutHash(buildGraph(c))).not.toBe(layoutHash(buildGraph()))
  })

  it('any generation-tuple change → a different layout (RNG caveat, handoff 8.8)', () => {
    const base = layoutHash(buildGraph())
    const mutations: ((c: NeuralConfig) => void)[] = [
      (c) => { c.generation.hubCount = 19 },
      (c) => { c.generation.nodesPerHubMax = 4 },
      (c) => { c.generation.nodeJitter = 0.23 },
      (c) => { c.generation.redProbability = 0.5 },
    ]
    for (const mutate of mutations) {
      const c = clone()
      mutate(c)
      expect(layoutHash(buildGraph(c))).not.toBe(base)
    }
  })
})

describe('graph structure', () => {
  const nodes = buildGraph()

  it('brain first: violet, at the origin, parentless - and the only brain', () => {
    expect(nodes[0].tier).toBe('brain')
    expect(nodes[0].hue).toBe('violet')
    expect(nodes[0].parentName).toBeNull()
    expect(nodePosition(nodes[0])).toEqual([0, 0, 0])
    expect(nodes.filter((n) => n.tier === 'brain')).toHaveLength(1)
  })

  it('every non-brain node has exactly one existing parent (one incoming trail)', () => {
    const names = new Set(nodes.map((n) => n.name))
    expect(names.size).toBe(nodes.length) // names unique
    for (const n of nodes.slice(1)) {
      expect(n.parentName).toBeTruthy()
      expect(names.has(n.parentName as string)).toBe(true)
    }
  })

  it('parent tiers follow the hierarchy', () => {
    const byName = new Map(nodes.map((n) => [n.name, n]))
    const parentTier = { hub: 'brain', node: 'hub', sub: 'node', terminal: 'sub' } as const
    for (const n of nodes.slice(1)) {
      const p = byName.get(n.parentName as string)
      expect(p?.tier).toBe(parentTier[n.tier as keyof typeof parentTier])
    }
  })

  it('exactly hubCount hubs; population lands in the prototype band', () => {
    expect(nodes.filter((n) => n.tier === 'hub')).toHaveLength(NCONF.generation.hubCount)
    expect(nodes.length).toBeGreaterThan(100) // ~250 in the prototype
    expect(nodes.length).toBeLessThan(600)
  })

  it('bokeh: exactly bokehCount terminals flagged, no other tier', () => {
    const bokeh = nodes.filter((n) => n.isBokeh)
    expect(bokeh).toHaveLength(NCONF.generation.bokehCount)
    for (const b of bokeh) expect(b.tier).toBe('terminal')
  })

  it('red salting is a minority accent; brain is the only violet', () => {
    const nonBrain = nodes.slice(1)
    const red = nonBrain.filter((n) => n.hue === 'red').length
    expect(red / nonBrain.length).toBeGreaterThan(0.05)
    expect(red / nonBrain.length).toBeLessThan(0.3)
    expect(nonBrain.every((n) => n.hue !== 'violet')).toBe(true)
  })

  it('radial growth: children sit farther out than their parents', () => {
    const byName = new Map(nodes.map((n) => [n.name, n]))
    for (const n of nodes.slice(1)) {
      if (n.tier === 'hub') continue
      const p = byName.get(n.parentName as string)
      expect(n.r).toBeGreaterThan((p as { r: number }).r)
    }
  })
})

describe('brightness monotonicity (restated gate, §6)', () => {
  it('effective peak luminance is monotonic in tier among shell members', () => {
    // disc luminance ∝ coreOpa × haloOpa (the C2 whole-sprite multiplier)
    const eff = (t: keyof typeof TIER_OPA) => TIER_OPA[t][2] * TIER_OPA[t][0]
    expect(eff('hub')).toBeGreaterThan(eff('node'))
    expect(eff('node')).toBeGreaterThan(eff('sub'))
    expect(eff('sub')).toBeGreaterThan(eff('terminal'))
    // the anchor strictly out-luminates everything (brain: tierMult 1.0 vs 0.95)
    expect(eff('brain') * 1.0).toBeGreaterThan(eff('hub') * 0.95)
  })
})

describe('byte-parity with the prototype generator (ground truth)', () => {
  // The prototype's makeRng + buildGraph transcribed VERBATIM from
  // reference/figma-make-build/src/App.tsx L37-97 (literal constants and
  // the per-check count re-draw included). The port must reproduce it
  // node-for-node at the default config.
  function protoGraph() {
    let s = 20260901 >>> 0
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
    const rng = (a: number, b: number) => a + rnd() * (b - a)
    const pick = (p: number) => rnd() < p
    interface P { name: string; tier: string; hue: string; phi: number; theta: number; r: number; parentName: string | null }
    const nodes: P[] = []
    function add(name: string, tier: string, phi: number, theta: number, r: number, parent: string | null): P {
      const hue = tier === 'brain' ? 'violet' : pick(0.15) ? 'red' : 'blue'
      const n: P = { name, tier, hue, phi, theta, r, parentName: parent }
      nodes.push(n)
      return n
    }
    add('brain', 'brain', 0, 0, 0, null)
    const HUBS = 20
    const R = 1100
    for (let i = 0; i < HUBS; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / HUBS) + rng(-0.2, 0.2)
      const theta = Math.PI * (1 + Math.sqrt(5)) * i + rng(-0.3, 0.3)
      const h = add(`n_h${i}`, 'hub', phi, theta, R * rng(0.9, 1.1), 'brain')
      for (let j = 0; j < Math.round(rng(2, 5)); j++) {
        const nd = add(`${h.name}_n${j}`, 'node',
          phi + rng(-0.22, 0.22), theta + rng(-0.22, 0.22),
          h.r * rng(1.1, 1.28), h.name)
        for (let k = 0; k < Math.round(rng(1, 4)); k++) {
          const sb = add(`${nd.name}_s${k}`, 'sub',
            nd.phi + rng(-0.28, 0.28), nd.theta + rng(-0.28, 0.28),
            nd.r * rng(1.06, 1.18), nd.name)
          for (let m = 0; m < Math.round(rng(0, 3)); m++) {
            add(`${sb.name}_t${m}`, 'terminal',
              sb.phi + rng(-0.38, 0.38), sb.theta + rng(-0.38, 0.38),
              sb.r * rng(1.04, 1.12), sb.name)
          }
        }
      }
    }
    return nodes
  }

  it('default-config port === prototype, node for node', () => {
    const proto = protoGraph()
    const ours = buildGraph()
    expect(ours.length).toBe(proto.length)
    for (let i = 0; i < proto.length; i++) {
      expect(ours[i].name).toBe(proto[i].name)
      expect(ours[i].tier).toBe(proto[i].tier)
      expect(ours[i].hue).toBe(proto[i].hue)
      expect(ours[i].phi).toBe(proto[i].phi)
      expect(ours[i].theta).toBe(proto[i].theta)
      expect(ours[i].r).toBe(proto[i].r)
      expect(ours[i].parentName).toBe(proto[i].parentName)
    }
  })
})
