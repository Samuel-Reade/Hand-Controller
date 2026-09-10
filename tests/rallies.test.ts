// RALLY §5 SIZE = cumulative rallies, on the placeholder source. Pins the
// object-model rule (§3: a parent's total is never less than its children's),
// the long tail, independence from momentum, and the point of it all: the
// shouts with the most interaction are the biggest and brightest.
import { describe, expect, it } from 'vitest'
import { NCONF } from '../src/neural/config'
import { buildGraph } from '../src/neural/graph'
import { momentumFor, nameUnit } from '../src/neural/momentum'
import { TIER_OPA } from '../src/neural/palette'
import { computeRallies, diamFor, opaFor, ownRallies } from '../src/neural/rallies'
import { buildTrailSpecs } from '../src/neural/trails'

const nodes = buildGraph()
const shouts = nodes.filter((n) => n.tier !== 'brain')
const R = computeRallies(nodes)

describe('placeholder rallies', () => {
  it('two populations: most posts minor (near the floor), a clear popular minority', () => {
    const posts = shouts.filter((n) => n.tier === 'hub')
    const own = posts.map((n) => ownRallies(n.name)).sort((a, b) => a - b)
    const median = own[Math.floor(own.length / 2)]
    expect(median).toBeLessThan(NCONF.rallies.minorMax / 2) // quadratic minor band: most near the floor
    expect(own[own.length - 1]).toBeGreaterThan(0.8)
    const popular = own.filter((v) => v >= NCONF.rallies.popularMin).length / own.length
    expect(popular).toBeGreaterThan(0.04)
    expect(popular).toBeLessThan(0.2)
    // nothing lands in the gap between the bands
    expect(own.some((v) => v > NCONF.rallies.minorMax && v < NCONF.rallies.popularMin)).toBe(false)
  })
  it('§3 roll-up: every parent carries at least the sum of its children', () => {
    const kids = new Map<string, number>()
    for (const n of shouts) if (n.parentName && n.parentName !== 'brain') kids.set(n.parentName, (kids.get(n.parentName) ?? 0) + R.get(n.name)!)
    let parents = 0
    for (const [p, sum] of kids) {
      parents++
      expect(R.get(p)!).toBeGreaterThanOrEqual(sum - 1e-9)
      expect(R.get(p)!).toBeGreaterThan(sum) // strictly: own demand is added
    }
    expect(parents).toBeGreaterThan(20) // posts that have an echo
  })
  it('normalised: biggest shout = 1, everything in [0, 1], brain = 1 (aggregate)', () => {
    const vals = shouts.map((n) => R.get(n.name)!)
    expect(Math.max(...vals)).toBeCloseTo(1, 12)
    for (const v of vals) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
    expect(R.get('brain')).toBe(1)
  })
  it('is independent of momentum (different hash salt) - both contrasts can exist', () => {
    const a = shouts.map((n) => ownRallies(n.name))
    const b = shouts.map((n) => nameUnit(n.name)) // momentum's underlying draw
    const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length
    const ma = mean(a), mb = mean(b)
    const cov = mean(a.map((x, i) => (x - ma) * (b[i] - mb)))
    const rho = cov / (Math.sqrt(mean(a.map((x) => (x - ma) ** 2))) * Math.sqrt(mean(b.map((x) => (x - mb) ** 2))))
    expect(Math.abs(rho)).toBeLessThan(0.15)
    // and the field actually contains both cases
    const bigStill = shouts.some((n) => R.get(n.name)! > 0.6 && momentumFor(n.name) === 0)
    const smallMoving = shouts.some((n) => R.get(n.name)! < 0.1 && momentumFor(n.name) > 0)
    expect(bigStill).toBe(true)
    expect(smallMoving).toBe(true)
  })
  it('is deterministic', () => {
    const again = computeRallies(buildGraph())
    for (const n of nodes) expect(again.get(n.name)).toBe(R.get(n.name))
  })
})

describe('size and glow are the rallies channel', () => {
  it('diam and every opacity are monotonic in rallies, spanning P0 terminal .. hub', () => {
    expect(diamFor(0)).toBe(NCONF.rallies.diamMin)
    expect(diamFor(1)).toBe(NCONF.rallies.diamMax)
    expect(opaFor(0)).toEqual(TIER_OPA.terminal)
    for (let i = 0; i < 3; i++) expect(opaFor(1)[i]).toBeCloseTo(TIER_OPA.hub[i], 12)
    let lastD = -1, lastO = [-1, -1, -1]
    for (let r = 0; r <= 1.0001; r += 0.05) {
      const d = diamFor(r), o = opaFor(r)
      expect(d).toBeGreaterThanOrEqual(lastD)
      for (let i = 0; i < 3; i++) expect(o[i]).toBeGreaterThanOrEqual(lastO[i])
      lastD = d; lastO = o
    }
  })
  it('the most-rallied shouts are the biggest and brightest on the field', () => {
    const sorted = [...shouts].sort((a, b) => R.get(b.name)! - R.get(a.name)!)
    const top = sorted.slice(0, 10), bottom = sorted.slice(-10)
    const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length
    expect(mean(top.map((n) => diamFor(R.get(n.name)!)))).toBeGreaterThan(2 * mean(bottom.map((n) => diamFor(R.get(n.name)!))))
    expect(mean(top.map((n) => opaFor(R.get(n.name)!)[0]))).toBeGreaterThan(mean(bottom.map((n) => opaFor(R.get(n.name)!)[0])))
  })
  it('a post\'s spoke follows its traction: hairline for minor, full for popular', () => {
    const specs = buildTrailSpecs(nodes, NCONF, undefined, (n) => R.get(n.name) ?? 0)
    const spokes = specs.filter((sp) => sp.parentTier === 'brain')
    expect(spokes).toHaveLength(NCONF.generation.hubCount)
    for (const sp of spokes) {
      expect(sp.weight).toBeGreaterThanOrEqual(NCONF.trail.spokeMinWeight - 1e-9)
      expect(sp.weight).toBeLessThanOrEqual(1 + 1e-9)
    }
    const byR = [...spokes].sort((a, b) => R.get(a.childName)! - R.get(b.childName)!)
    const minor = byR.slice(0, 20), popular = byR.slice(-5)
    const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length
    expect(mean(popular.map((sp) => sp.weight))).toBeGreaterThan(2 * mean(minor.map((sp) => sp.weight)))
    expect(mean(popular.map((sp) => sp.radius))).toBeGreaterThan(mean(minor.map((sp) => sp.radius)))
    // default weighting (no ralliesOf) is full, so other callers are untouched
    expect(buildTrailSpecs(nodes).every((sp) => sp.weight === 1)).toBe(true)
  })
  it('size is not tier: hubs vary, and the small end stays visible', () => {
    const hubD = shouts.filter((n) => n.tier === 'hub').map((n) => diamFor(R.get(n.name)!))
    const mean = hubD.reduce((x, y) => x + y, 0) / hubD.length
    const std = Math.sqrt(hubD.map((d) => (d - mean) ** 2).reduce((x, y) => x + y, 0) / hubD.length)
    expect(std).toBeGreaterThan(5) // not one size for all hubs
    const smallest = Math.min(...shouts.map((n) => diamFor(R.get(n.name)!)))
    expect(smallest).toBeGreaterThanOrEqual(NCONF.rallies.diamMin)
    expect(smallest).toBeLessThan(NCONF.rallies.diamMin * 1.6) // the tail really reaches the floor
  })
})
