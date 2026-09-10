// Pure star-network generator - a byte-exact port of the prototype's
// buildGraph (reference/figma-make-build/src/App.tsx L53-97), parameterized
// by the generation config. No three.js imports; runs headless in tests.
//
// Reproducibility contract (§5 RNG caveat + PORT_LOG): the same
// generation-config tuple + seed must yield an identical layout. That
// requires replicating the prototype's RNG consumption order EXACTLY:
//  - the LCG: s = (imul(s, 1664525) + 1013904223) >>> 0; s / 2^32
//  - brain consumes zero draws (the hue ternary short-circuits pick)
//  - per node: phi jitter, theta jitter, radial, THEN hue pick (inside add)
//  - branch counts sit in the loop CONDITION - `j < Math.round(rng(a, b))`
//    draws a fresh bound on EVERY iteration check (PORT_LOG C3 amendment).

import { NCONF } from './config'
import type { NeuralConfig } from './config'
import { HUE_INDEX } from './palette'
import type { NeuralHue, NeuralTier } from './palette'
import { ownRallies } from './rallies'

export interface NeuralNode {
  name: string
  tier: NeuralTier
  hue: NeuralHue
  phi: number
  theta: number
  r: number
  parentName: string | null
  isBokeh: boolean
}

export function makeRng(seed: number) {
  let s = seed >>> 0
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  return {
    rng: (a: number, b: number) => a + rnd() * (b - a),
    pick: (p: number) => rnd() < p,
  }
}

export function buildGraph(cfg: NeuralConfig = NCONF): NeuralNode[] {
  const g = cfg.generation
  const { rng, pick } = makeRng(g.seed)
  const nodes: NeuralNode[] = []

  function add(
    name: string, tier: NeuralTier,
    phi: number, theta: number, r: number,
    parent: string | null,
  ): NeuralNode {
    // Hue drawn INSIDE add, after the positional args - order matters.
    const hue: NeuralHue =
      tier === 'brain' ? 'violet' : pick(g.redProbability) ? 'red' : 'blue'
    const n: NeuralNode = { name, tier, hue, phi, theta, r, parentName: parent, isBokeh: false }
    nodes.push(n)
    return n
  }

  add('brain', 'brain', 0, 0, 0, null)

  for (let i = 0; i < g.hubCount; i++) {
    // Fibonacci sphere + jitter
    const phi = Math.acos(1 - (2 * (i + 0.5)) / g.hubCount) + rng(-g.hubJitterPhi, g.hubJitterPhi)
    const theta = Math.PI * (1 + Math.sqrt(5)) * i + rng(-g.hubJitterTheta, g.hubJitterTheta)
    const h = add(`n_h${i}`, 'hub', phi, theta, g.R * rng(g.hubRadialMin, g.hubRadialMax), 'brain')

    // Echo count by the post's own traction (config.echoesByTraction): a
    // popular post is a conversation. ownRallies is a name hash - it draws
    // nothing from the layout RNG - so only the loop bound differs from P0.
    const popular = g.echoesByTraction && ownRallies(h.name, cfg.rallies) >= cfg.rallies.popularMin
    const eMin = popular ? g.popularEchoMin : g.nodesPerHubMin
    const eMax = popular ? g.popularEchoMax : g.nodesPerHubMax
    // Prototype quirk, kept deliberately: the bound is re-drawn each check.
    for (let j = 0; j < Math.round(rng(eMin, eMax)); j++) {
      const nd = add(`${h.name}_n${j}`, 'node',
        phi + rng(-g.nodeJitter, g.nodeJitter),
        theta + rng(-g.nodeJitter, g.nodeJitter),
        h.r * rng(g.nodeRadialMin, g.nodeRadialMax), h.name)

      for (let k = 0; k < Math.round(rng(g.subsPerNodeMin, g.subsPerNodeMax)); k++) {
        const sb = add(`${nd.name}_s${k}`, 'sub',
          nd.phi + rng(-g.subJitter, g.subJitter),
          nd.theta + rng(-g.subJitter, g.subJitter),
          nd.r * rng(g.subRadialMin, g.subRadialMax), nd.name)

        for (let m = 0; m < Math.round(rng(g.terminalsPerSubMin, g.terminalsPerSubMax)); m++) {
          add(`${sb.name}_t${m}`, 'terminal',
            sb.phi + rng(-g.terminalJitter, g.terminalJitter),
            sb.theta + rng(-g.terminalJitter, g.terminalJitter),
            sb.r * rng(g.terminalRadialMin, g.terminalRadialMax), sb.name)
        }
      }
    }
  }

  // Bokeh flags: every ⌊N/count⌋-th terminal in creation order, up to count.
  const terms = nodes.filter((n) => n.tier === 'terminal')
  const step = Math.max(1, Math.floor(terms.length / g.bokehCount))
  for (let i = 0; i < terms.length && i < g.bokehCount * step; i += step) terms[i].isBokeh = true

  return nodes
}

/** Spherical → cartesian, y-up (prototype nodePos): brain at the origin. */
export function nodePosition(n: NeuralNode): [number, number, number] {
  if (n.tier === 'brain') return [0, 0, 0]
  return [
    n.r * Math.sin(n.phi) * Math.cos(n.theta),
    n.r * Math.cos(n.phi),
    n.r * Math.sin(n.phi) * Math.sin(n.theta),
  ]
}

const TIER_INDEX: Record<NeuralTier, number> = { brain: 0, hub: 1, node: 2, sub: 3, terminal: 4 }

/** FNV-1a over every node's numeric identity, in creation order. */
export function layoutHash(nodes: readonly NeuralNode[]): string {
  const buf = new DataView(new ArrayBuffer(8))
  let h = 2166136261
  const mix = (v: number) => {
    buf.setFloat64(0, v)
    for (let i = 0; i < 8; i++) {
      h ^= buf.getUint8(i)
      h = Math.imul(h, 16777619)
    }
  }
  for (const n of nodes) {
    mix(n.phi); mix(n.theta); mix(n.r)
    mix(TIER_INDEX[n.tier]); mix(HUE_INDEX[n.hue]); mix(n.isBokeh ? 1 : 0)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
