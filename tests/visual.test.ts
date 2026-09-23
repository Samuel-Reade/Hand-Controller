// Visual + salience passes: zoom-invariant glow, the RALLY §5 momentum
// channel on placeholder data, trail energy bands, the disc-hugging sight
// ring. This is the pure half - geometry attributes and the maths mirrored
// from the shaders - so "inert at rest" and "still nodes are still" are
// tests, not hopes.
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { DISC_FRACTION, NCONF, bodyAlpha, frameFraction, heartAlpha, ringRadiusPx } from '../src/neural/config'
import { buildGraph, nodePosition } from '../src/neural/graph'
import { momentumFor, nameUnit } from '../src/neural/momentum'
import { buildStarGeometry } from '../src/neural/starField'
import type { StarInstance } from '../src/neural/starField'
import { TRAIL_SEGS, buildTrailGeometry, buildTrailSpecs, flowBandPosition } from '../src/neural/trails'

const nodes = buildGraph()

describe('zoom-invariant glow is inert at the rest view (P0 parity)', () => {
  const r = NCONF.render
  const anchorSize =
    NCONF.anchor.brainDiam * r.spriteScale * NCONF.anchor.coronaMult * (1 + NCONF.brainPulse.amp)
  // the largest possible post quad: diamMax x spriteScale x full blaze spread
  const postSize = NCONF.rallies.diamMax * r.spriteScale * (1 + r.blazeSpread)

  it('the anchor at rest spans less than glowFadeStart of the frame - no fade', () => {
    expect(frameFraction(anchorSize, NCONF.camera.z)).toBeLessThan(r.glowFadeStart)
  })
  it('the biggest, most blazing post at its nearest rest distance is not faded', () => {
    const near = NCONF.camera.z - NCONF.generation.R * NCONF.generation.hubRadialMax
    expect(frameFraction(postSize, near)).toBeLessThan(r.glowFadeStart)
  })
  it('at 7x the anchor is fully faded; at 3x it is partial', () => {
    expect(frameFraction(anchorSize, NCONF.camera.z / 7)).toBeGreaterThan(r.glowFadeEnd)
    const at3 = frameFraction(anchorSize, NCONF.camera.z / 3)
    expect(at3).toBeGreaterThan(r.glowFadeStart)
    expect(at3).toBeLessThan(r.glowFadeEnd)
  })
  it('fade edges are ordered', () => {
    expect(r.glowFadeStart).toBeLessThan(r.glowFadeEnd)
  })
})

describe('RALLY §5 momentum channel - placeholder source', () => {
  const shouts = nodes.filter((n) => n.tier !== 'brain')
  it('marks roughly movingFraction of shouts as moving; the rest are exactly still', () => {
    const moving = shouts.filter((n) => momentumFor(n.name) > 0)
    const frac = moving.length / shouts.length
    expect(frac).toBeGreaterThan(NCONF.momentum.movingFraction * 0.5)
    expect(frac).toBeLessThan(NCONF.momentum.movingFraction * 1.6)
    for (const n of shouts) {
      const m = momentumFor(n.name)
      if (m > 0) {
        expect(m).toBeGreaterThanOrEqual(0.35) // a moving shout is visibly moving
        expect(m).toBeLessThanOrEqual(1)
      } else expect(m).toBe(0)
    }
  })
  it('the brain (camp aggregate) never moves', () => {
    expect(momentumFor('brain')).toBe(0)
  })
  it('is deterministic and independent of the layout RNG', () => {
    expect(momentumFor('n_h3_n1_s0_t2')).toBe(momentumFor('n_h3_n1_s0_t2'))
    expect(nameUnit('a')).not.toBe(nameUnit('b'))
    expect(nameUnit('n_h1')).toBeGreaterThanOrEqual(0)
    expect(nameUnit('n_h1')).toBeLessThan(1)
  })
  it('movingFraction 0 stills the field; 1 moves everything', () => {
    const cfg = { ...NCONF.momentum }
    expect(shouts.every((n) => momentumFor(n.name, { ...cfg, movingFraction: 0 }) === 0)).toBe(true)
    expect(shouts.every((n) => momentumFor(n.name, { ...cfg, movingFraction: 1 }) > 0)).toBe(true)
  })
})

describe('momentum rides the star geometry, never its size', () => {
  const instances: StarInstance[] = nodes
    .filter((n) => n.tier !== 'brain')
    .slice(0, 60)
    .map((n) => ({ pos: new Vector3(n.r, 0, 0), tier: n.tier, hue: n.hue, momentum: momentumFor(n.name) }))

  it('iMomentum and iPhase exist per instance; phases distinct and in [0,1)', () => {
    const geo = buildStarGeometry(instances)
    const mom = geo.getAttribute('iMomentum')
    const ph = geo.getAttribute('iPhase')
    expect(mom.count).toBe(instances.length)
    expect(ph.count).toBe(instances.length)
    for (let i = 0; i < instances.length; i++) expect(mom.getX(i)).toBeCloseTo(instances[i].momentum!, 6)
    const vals = Array.from(ph.array as Float32Array)
    for (const v of vals) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    expect(new Set(vals.map((v) => v.toFixed(4))).size).toBe(vals.length)
  })
  it('omitting momentum yields a still instance (0)', () => {
    const geo = buildStarGeometry([{ pos: new Vector3(), tier: 'hub', hue: 'blue' }])
    expect(geo.getAttribute('iMomentum').getX(0)).toBe(0)
  })
  it('size and position attributes are exactly the tier table', () => {
    const geo = buildStarGeometry(instances)
    for (let i = 0; i < instances.length; i++) {
      expect(geo.getAttribute('iDiam').getX(i)).toBe(NCONF.render.tierDiam[instances[i].tier])
    }
  })
})

describe('trail energy band: aFlow = (t, phase, child momentum, traction weight)', () => {
  const specs = buildTrailSpecs(nodes).slice(0, 6)
  for (const pass of ['core', 'glow'] as const) {
    it(`${pass}: t runs 0 -> 1 along each trail; phase and momentum constant per trail`, () => {
      const geo = buildTrailGeometry(specs, pass)
      const flow = geo.getAttribute('aFlow')
      expect(flow.itemSize).toBe(4)
      expect(flow.count).toBe(geo.getAttribute('position').count)
      const SEGS = TRAIL_SEGS[pass]
      const ringVerts = 6
      const perTrail = flow.count / specs.length
      expect(perTrail).toBe((SEGS + 1) * ringVerts)
      const phases: number[] = []
      for (let s = 0; s < specs.length; s++) {
        const base = s * perTrail
        const phase = flow.getY(base)
        phases.push(phase)
        let last = -1
        for (let i = 0; i <= SEGS; i++) {
          const t = flow.getX(base + i * ringVerts)
          expect(t).toBeCloseTo(i / SEGS, 6)
          expect(t).toBeGreaterThan(last)
          last = t
          for (let j = 0; j < ringVerts; j++) {
            expect(flow.getY(base + i * ringVerts + j)).toBe(phase)
            expect(flow.getZ(base + i * ringVerts + j)).toBeCloseTo(specs[s].childMomentum, 6)
            expect(flow.getW(base + i * ringVerts + j)).toBeCloseTo(specs[s].weight, 6)
          }
        }
      }
      expect(new Set(phases.map((p) => p.toFixed(4))).size).toBe(specs.length)
    })
  }
  it("a trail carries its CHILD's momentum (the incoming trail belongs to the child)", () => {
    for (const s of buildTrailSpecs(nodes)) expect(s.childMomentum).toBe(momentumFor(s.childName))
  })
  it('the string runs into the core: endpoints are the node centres (endInset 0)', () => {
    const byName = new Map(nodes.map((n) => [n.name, n]))
    for (const sp of buildTrailSpecs(nodes).slice(0, 40)) {
      const p = new Vector3(...nodePosition(byName.get(sp.parentName)!))
      const c = new Vector3(...nodePosition(byName.get(sp.childName)!))
      expect(sp.pSurf.distanceTo(p)).toBeLessThan(1e-6)
      expect(sp.cSurf.distanceTo(c)).toBeLessThan(1e-6)
    }
    // t = 0 ring sits on the parent end
    const geo = buildTrailGeometry(specs.slice(0, 1), 'core')
    const pos = geo.getAttribute('position')
    const ring0 = new Vector3(pos.getX(0), pos.getY(0), pos.getZ(0))
    expect(ring0.distanceTo(specs[0].pSurf)).toBeLessThan(specs[0].radius * 1.01)
  })
  it('endInset 1 restores surface-to-surface: ends sit one visible disc radius out', () => {
    const cfg = { ...NCONF, trail: { ...NCONF.trail, endInset: 1 } }
    const byName = new Map(nodes.map((n) => [n.name, n]))
    const sp = buildTrailSpecs(nodes, cfg)[0]
    const p = new Vector3(...nodePosition(byName.get(sp.parentName)!))
    const discR = (NCONF.render.tierDiam[byName.get(sp.parentName)!.tier] * NCONF.render.spriteScale * DISC_FRACTION) / 2
    expect(sp.pSurf.distanceTo(p)).toBeCloseTo(discR, 6)
  })
  it('beads are off by default (no circles at the ends of the strings)', () => {
    expect(NCONF.trail.beadsEnabled).toBe(false)
    expect(NCONF.trail.endInset).toBe(0)
  })
})

describe('flow direction and rate', () => {
  const P = NCONF.trail.flowPeriod
  it('inward: the band moves toward the parent (t decreases) - energy converges on the brain', () => {
    expect(flowBandPosition(0, P, 0.5, true)).toBeCloseTo(0.5, 9)
    expect(flowBandPosition(0.1 * P, P, 0.5, true)).toBeCloseTo(0.4, 9)
  })
  it('outward: the same band moves toward the child (t increases)', () => {
    expect(flowBandPosition(0, P, 0.5, false)).toBeCloseTo(0.5, 9)
    expect(flowBandPosition(0.1 * P, P, 0.5, false)).toBeCloseTo(0.6, 9)
  })
  it('more momentum, faster band: full momentum with boost 1.5 travels 2.5x as far', () => {
    const slow = flowBandPosition(0.1 * P, P, 0.5, false, 0, 1.5)
    const fast = flowBandPosition(0.1 * P, P, 0.5, false, 1, 1.5)
    expect(slow).toBeCloseTo(0.6, 9)
    expect(fast).toBeCloseTo(0.75, 9)
  })
  it('wraps cleanly in both directions and stays in [0,1)', () => {
    for (let s = 0; s < 40; s++) {
      for (const inward of [true, false]) {
        const t = flowBandPosition(s * 0.37 * P, P, 0.123, inward, 0.7, 1.5)
        expect(t).toBeGreaterThanOrEqual(0)
        expect(t).toBeLessThan(1)
      }
    }
  })
  it('default is inward', () => {
    expect(NCONF.trail.flowInward).toBe(true)
  })
})

describe('the sight ring hugs the star, not its glow', () => {
  const focal = 450 / Math.tan((NCONF.camera.fov * Math.PI) / 360)
  it('ring radius is the projected DISC radius x swell - 0.3x the old quad-based ring', () => {
    const diam = NCONF.render.tierDiam.node
    const r = ringRadiusPx('node', diam, NCONF.render.spriteScale, focal, NCONF.camera.z, 1.6)
    const oldQuadRing = ((diam * NCONF.render.spriteScale) / 2) * (focal / NCONF.camera.z) * 1.6
    expect(r / oldQuadRing).toBeCloseTo(DISC_FRACTION, 9)
    expect(DISC_FRACTION).toBe(0.3) // 2 x DR in starField's fragment shader
  })
  it('there is no ring for the anchor fallback', () => {
    expect(ringRadiusPx('brain', NCONF.anchor.brainDiam, NCONF.render.spriteScale, focal, NCONF.camera.z, 1.6)).toBe(0)
  })
  it('a hub ring is larger than a node ring at the same depth', () => {
    const h = ringRadiusPx('hub', NCONF.render.tierDiam.hub, NCONF.render.spriteScale, focal, NCONF.camera.z, 1.6)
    const n = ringRadiusPx('node', NCONF.render.tierDiam.node, NCONF.render.spriteScale, focal, NCONF.camera.z, 1.6)
    expect(h).toBeGreaterThan(n)
  })
})

describe('the luminous body', () => {
  it('is solid inside, half alpha at the disc radius (the size channel), gone by discEdge', () => {
    expect(bodyAlpha(0)).toBe(1)
    expect(bodyAlpha(0.6)).toBe(1)
    expect(bodyAlpha(1)).toBeGreaterThan(0.35)
    expect(bodyAlpha(1)).toBeLessThan(0.65)
    expect(bodyAlpha(NCONF.render.discEdge)).toBe(0)
    let last = 2
    for (let x = 0; x <= 2; x += 0.05) { const a = bodyAlpha(x); expect(a).toBeLessThanOrEqual(last + 1e-9); last = a }
  })
  it('the heart is brighter and wider on a popular post than on a minor one', () => {
    expect(heartAlpha(0, 1)).toBeGreaterThan(heartAlpha(0, 0))
    expect(heartAlpha(0.3, 1)).toBeGreaterThan(1.5 * heartAlpha(0.3, 0))
    expect(heartAlpha(0, 1)).toBeCloseTo(1, 9) // a popular heart reaches full white
    expect(heartAlpha(1.2, 1)).toBeLessThan(0.05) // and it IS a heart, not the whole body
  })
})

describe('config', () => {
  it('salience-pass defaults', () => {
    expect(NCONF.depth.opacityFloor).toBe(0.15)
    expect(NCONF.momentum.movingFraction).toBeGreaterThan(0)
    expect(NCONF.momentum.movingFraction).toBeLessThan(0.3) // a few things move, not the field
    expect(NCONF.momentum.glow).toBeGreaterThan(0)
    expect(NCONF.trail.flowEnabled).toBe(true)
    expect(NCONF.trail.flowGain).toBeGreaterThan(0)
  })
})
