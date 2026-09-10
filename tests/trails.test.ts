import { describe, expect, it } from 'vitest'
import { Color, Vector3 } from 'three'
import { DISC_FRACTION, NCONF } from '../src/neural/config'
import { buildGraph, nodePosition } from '../src/neural/graph'
import { PAL, TRAIL_BASE, TRAIL_HOT } from '../src/neural/palette'
import {
  buildTrailSpecs,
  coreColorAt,
  glowColorAt,
  taperRadius,
} from '../src/neural/trails'

const nodes = buildGraph()
const specs = buildTrailSpecs(nodes)

describe('trail topology (P3 machine gate)', () => {
  it('every non-brain element has exactly one incoming trail', () => {
    expect(specs.length).toBe(nodes.length - 1)
    const children = new Set(specs.map((s) => s.childName))
    expect(children.size).toBe(specs.length) // one per child, no duplicates
  })

  it('trail radius follows the parent tier (TRAIL_RAD)', () => {
    for (const s of specs) {
      expect(s.radius).toBe(NCONF.trail.radByTier[s.parentTier])
    }
  })

  // 2026-09-10: the prototype's surface-to-surface rule is retired - the
  // string runs into the core (trail.endInset 0). The contract is now: the
  // endpoints are the node centres by default, and endInset moves them out
  // along the chord by that fraction of the VISIBLE disc radius.
  it('endpoints are the node centres by default (the string runs into the core)', () => {
    const byName = new Map(nodes.map((n) => [n.name, n]))
    const pos = new Map(nodes.map((n) => [n.name, new Vector3(...nodePosition(n))]))
    for (const s of specs.slice(0, 40)) {
      const child = byName.get(s.childName)
      if (!child) throw new Error('missing child')
      const parent = byName.get(child.parentName as string)
      if (!parent) throw new Error('missing parent')
      expect(s.parentName).toBe(parent.name)
      expect(s.pSurf.distanceTo(pos.get(parent.name) as Vector3)).toBeLessThan(1e-6)
      expect(s.cSurf.distanceTo(pos.get(child.name) as Vector3)).toBeLessThan(1e-6)
    }
  })

  it('endInset moves the endpoints out along the chord by that fraction of the disc radius', () => {
    const cfg = { ...NCONF, trail: { ...NCONF.trail, endInset: 1 } }
    const byName = new Map(nodes.map((n) => [n.name, n]))
    const pos = new Map(nodes.map((n) => [n.name, new Vector3(...nodePosition(n))]))
    const discR = (tier: keyof typeof NCONF.render.tierDiam) => (NCONF.render.tierDiam[tier] * NCONF.render.spriteScale * DISC_FRACTION) / 2
    for (const s of buildTrailSpecs(nodes, cfg).slice(0, 40)) {
      const child = byName.get(s.childName) as (typeof nodes)[0]
      const parent = byName.get(s.parentName) as (typeof nodes)[0]
      const pPos = pos.get(parent.name) as Vector3
      const cPos = pos.get(child.name) as Vector3
      expect(s.pSurf.distanceTo(pPos)).toBeCloseTo(discR(parent.tier), 6)
      expect(s.cSurf.distanceTo(cPos)).toBeCloseTo(discR(child.tier), 6)
      // both offsets lie along the parent→child chord
      const chord = cPos.clone().sub(pPos).normalize()
      const off = s.pSurf.clone().sub(pPos).normalize()
      expect(off.dot(chord)).toBeCloseTo(1, 6)
    }
  })

  it('bend sign is deterministic from the child φ/θ', () => {
    const byName = new Map(nodes.map((n) => [n.name, n]))
    const UP = new Vector3(0, 1, 0)
    for (const s of specs.slice(0, 60)) {
      const child = byName.get(s.childName)
      if (!child) throw new Error('missing child')
      const expected = Math.sin(child.phi * 7.3 + child.theta) > 0 ? 1 : -1
      const chord = s.cSurf.clone().sub(s.pSurf)
      const mid = s.pSurf.clone().add(s.cSurf).multiplyScalar(0.5)
      const perp = new Vector3().crossVectors(chord, UP).normalize()
      if (perp.lengthSq() < 0.01) perp.crossVectors(chord, new Vector3(1, 0, 0)).normalize()
      const side = Math.sign(s.ctrl.clone().sub(mid).dot(perp))
      expect(side).toBe(expected)
      // offset magnitude = chordLen × bendFraction
      expect(s.ctrl.distanceTo(mid)).toBeCloseTo(chord.length() * NCONF.trail.bendFraction, 6)
    }
  })
})

describe('taper profile (ruling 7.7 restored)', () => {
  it('peaks at both endpoints, minimum at t=0.5', () => {
    const base = 1.1
    expect(taperRadius(0, base)).toBeCloseTo(base, 9)
    expect(taperRadius(1, base)).toBeCloseTo(base, 9)
    expect(taperRadius(0.5, base)).toBeCloseTo(base * NCONF.trail.taperBase, 9)
    let prev = taperRadius(0, base)
    for (let t = 0.05; t <= 0.5; t += 0.05) {
      const r = taperRadius(t, base)
      expect(r).toBeLessThan(prev)
      prev = r
    }
  })
})

describe('vertex color program (§4.3, exact)', () => {
  const p = new Color(PAL.blue.body)
  const c = new Color(PAL.red.body)

  it('brain trails run trail/hot for the first 15%', () => {
    expect(coreColorAt(0, 'brain', p, c).getHex()).toBe(new Color(TRAIL_HOT).getHex())
    // at t=0.15 the hot ramp has fully landed on the parent body color path
    const at = coreColorAt(0.149999, 'brain', p, c)
    const target = new Color(TRAIL_HOT).lerp(p, 0.149999 / 0.15)
    expect(at.getHex()).toBe(target.getHex())
  })

  it('everything lerps through trail/base at t=0.40 to the child body', () => {
    expect(coreColorAt(0, 'hub', p, c).getHex()).toBe(p.getHex())
    expect(coreColorAt(0.4, 'hub', p, c).getHex()).toBe(new Color(TRAIL_BASE).getHex())
    expect(coreColorAt(1, 'hub', p, c).getHex()).toBe(c.getHex())
  })

  it('glow pass is the plain parent→child lerp × 0.55', () => {
    const g = glowColorAt(0.5, p, c)
    const expected = new Color().lerpColors(p, c, 0.5).multiplyScalar(0.55)
    expect(g.r).toBeCloseTo(expected.r, 9)
    expect(g.g).toBeCloseTo(expected.g, 9)
    expect(g.b).toBeCloseTo(expected.b, 9)
  })
})
