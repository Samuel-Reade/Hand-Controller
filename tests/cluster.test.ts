// Cluster tightness contract (user direction 2026-09-09: "random but in
// tighter clusters"), restated for the Rally shape (many main posts, echoes
// one level deep and uncommon): an echo sits close to its post, still at a
// random offset, and solid discs do not stack. Measured, not eyeballed.
// Prototype (P0) values for reference: cluster RMS 580 wu, max reach 1282 wu.
import { describe, expect, it } from 'vitest'
import { DISC_FRACTION, NCONF } from '../src/neural/config'
import type { NeuralConfig } from '../src/neural/config'
import { buildGraph, layoutHash, nodePosition } from '../src/neural/graph'
import type { NeuralNode } from '../src/neural/graph'
import { computeRallies, diamFor, ownRallies } from '../src/neural/rallies'

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

export function clusterStats(cfg: NeuralConfig = NCONF) {
  const nodes = buildGraph(cfg)
  // disc radii as RENDERED: size is the rallies channel, not the tier table
  const R = computeRallies(nodes, cfg.rallies)
  const discR = (n: NeuralNode) => (diamFor(R.get(n.name) ?? 0, cfg.rallies) * cfg.render.spriteScale * DISC_FRACTION) / 2
  const byName = new Map(nodes.map((n) => [n.name, n]))
  const pos = new Map(nodes.map((n) => [n.name, nodePosition(n)]))
  const hubOf = (n: NeuralNode) => {
    let c = n
    while (c.parentName && c.parentName !== 'brain') c = byName.get(c.parentName)!
    return c
  }
  const clusters = new Map<string, NeuralNode[]>()
  for (const n of nodes) {
    if (n.tier === 'brain' || n.tier === 'hub') continue
    const h = hubOf(n).name
    if (!clusters.has(h)) clusters.set(h, [])
    clusters.get(h)!.push(n)
  }
  let rmsSum = 0
  let maxReach = 0
  const childDist: Record<string, number[]> = { node: [], sub: [], terminal: [] }
  let pcOverlap = 0, pcPairs = 0, sibOverlap = 0, sibPairs = 0
  for (const [h, members] of clusters) {
    const hp = pos.get(h)!
    let s = 0
    for (const m of members) {
      const d = dist(pos.get(m.name)!, hp)
      s += d * d
      maxReach = Math.max(maxReach, d)
    }
    rmsSum += Math.sqrt(s / members.length)
    for (let i = 0; i < members.length; i++) {
      const a = members[i]
      const p = byName.get(a.parentName!)!
      const dpc = dist(pos.get(a.name)!, pos.get(p.name)!)
      childDist[a.tier].push(dpc)
      pcPairs++
      if (dpc < discR(a) + discR(p)) pcOverlap++
      for (let j = i + 1; j < members.length; j++) {
        const b = members[j]
        sibPairs++
        if (dist(pos.get(a.name)!, pos.get(b.name)!) < discR(a) + discR(b)) sibOverlap++
      }
    }
  }
  const mean = (v: number[]) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN)
  const std = (v: number[]) => { const m = mean(v); return Math.sqrt(mean(v.map((x) => (x - m) ** 2))) }
  return {
    clusterRMS: rmsSum / clusters.size,
    maxReach,
    childMean: { node: mean(childDist.node), sub: mean(childDist.sub), terminal: mean(childDist.terminal) },
    childStd: { node: std(childDist.node), sub: std(childDist.sub), terminal: std(childDist.terminal) },
    parentChildOverlap: pcOverlap / pcPairs,
    siblingOverlap: sibOverlap / sibPairs,
    nodes,
  }
}

describe('echoes sit near their post (Rally shape)', () => {
  const s = clusterStats()
  const present = (['node', 'sub', 'terminal'] as const).filter((t) => !Number.isNaN(s.childMean[t]))
  it('the field is main posts + echoes, nothing deeper', () => {
    expect(s.nodes.filter((n) => n.tier === 'hub')).toHaveLength(NCONF.generation.hubCount)
    expect(s.nodes.filter((n) => n.tier === 'sub' || n.tier === 'terminal')).toHaveLength(0)
    const echoes = s.nodes.filter((n) => n.tier === 'node').length
    expect(echoes).toBeGreaterThan(NCONF.generation.hubCount * 0.1)
    expect(echoes).toBeLessThan(NCONF.generation.hubCount) // fewer echoes than posts overall
    expect(present).toEqual(['node'])
  })
  it('echoes concentrate on popular posts (a conversation); minor posts rarely echo', () => {
    const posts = s.nodes.filter((n) => n.tier === 'hub')
    const count = (p: NeuralNode) => s.nodes.filter((n) => n.parentName === p.name).length
    const popular = posts.filter((p) => ownRallies(p.name) >= NCONF.rallies.popularMin)
    const minor = posts.filter((p) => ownRallies(p.name) < NCONF.rallies.popularMin)
    const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length
    expect(popular.length).toBeGreaterThan(5)
    expect(mean(popular.map(count))).toBeGreaterThan(3) // "a decent amount of subnodes"
    expect(mean(minor.map(count))).toBeLessThan(0.5) // "won't be that common"
    expect(popular.every((p) => count(p) >= NCONF.generation.popularEchoMin - 1)).toBe(true)
  })
  it('brain -> post distance is random within limits', () => {
    const rs = s.nodes.filter((n) => n.tier === 'hub').map((n) => n.r / NCONF.generation.R)
    expect(Math.min(...rs)).toBeGreaterThanOrEqual(NCONF.generation.hubRadialMin)
    expect(Math.max(...rs)).toBeLessThanOrEqual(NCONF.generation.hubRadialMax)
    expect(Math.min(...rs)).toBeLessThan(0.75) // some close
    expect(Math.max(...rs)).toBeGreaterThan(1.25) // some far
    const mean = rs.reduce((x, y) => x + y, 0) / rs.length
    const std = Math.sqrt(rs.map((r) => (r - mean) ** 2).reduce((x, y) => x + y, 0) / rs.length)
    expect(std).toBeGreaterThan(0.15) // genuinely spread, not a shell
    // not too close: inner limit clears the anchor's corona quad (605 wu)
    expect(Math.min(...rs) * NCONF.generation.R).toBeGreaterThan(NCONF.anchor.brainDiam * NCONF.render.spriteScale * NCONF.anchor.coronaMult / 2)
  })
  it('an echo sits within ~half the prototype spread of its post (RMS < 350 wu, was 580)', () => {
    expect(s.clusterRMS).toBeLessThan(350)
    expect(s.clusterRMS).toBeGreaterThan(60) // beside the post, not on it
  })
  it('no echo reaches farther than ~0.65 R from its post (was 1282 wu > R)', () => {
    expect(s.maxReach).toBeLessThan(NCONF.generation.R * 0.65)
  })
  it('every present tier sits near its parent (mean < 240 wu) but at a random offset (std > 20)', () => {
    // 240, not the 200 the 4-level tree used: echo offsets scale with the
    // parent's radius (now random 0.6-1.35 R) and echoes were given room so
    // none sit on a popular post's large disc (0/97 overlaps vs 4/97 at the
    // old 0.12 / 1.05-1.16). Posts are ~300+ wu apart; 205 wu is beside its post.
    for (const t of present) {
      expect(s.childMean[t]).toBeLessThan(240)
      expect(s.childStd[t]).toBeGreaterThan(20)
    }
  })
  it('solid discs rarely stack: parent-child < 3%, siblings < 1.5%', () => {
    expect(s.parentChildOverlap).toBeLessThan(0.03)
    expect(Number.isNaN(s.siblingOverlap) ? 0 : s.siblingOverlap).toBeLessThan(0.015)
  })
  it('the layout is still deterministic for the tuple', () => {
    expect(layoutHash(buildGraph())).toBe(layoutHash(buildGraph()))
  })
})
