import { describe, expect, it } from 'vitest'
import { NCONF } from '../src/neural/config'
import { TIER_OPA } from '../src/neural/palette'

// §6 anchor-dominance machine gate: luminance monotonic in tier among shell
// members; the current anchor strictly out-luminates everything. Analytic
// over the config (the pixel-side white-clip check runs in verify-neural).
describe('anchor dominance (P4 machine gate)', () => {
  const eff = (t: keyof typeof TIER_OPA, tierMult: number) =>
    TIER_OPA[t][2] * TIER_OPA[t][0] * tierMult

  it('anchor diameter dominates the hub tier (§6.1)', () => {
    expect(NCONF.anchor.brainDiam).toBeGreaterThanOrEqual(NCONF.render.tierDiam.hub * 1.5)
  })

  it('anchor corona mult and spikes are on (§6.2-6.3)', () => {
    expect(NCONF.anchor.coronaMult).toBeGreaterThan(1)
    expect(NCONF.anchor.spikeLength).toBeGreaterThan(0)
  })

  it('anchor peak luminance strictly above every shell tier', () => {
    const anchor = eff('brain', 1.0)
    for (const tier of ['hub', 'node', 'sub', 'terminal'] as const) {
      expect(anchor).toBeGreaterThan(eff(tier, 0.95))
    }
  })

  it('shell-tier luminance stays monotonic', () => {
    expect(eff('hub', 0.95)).toBeGreaterThan(eff('node', 0.95))
    expect(eff('node', 0.95)).toBeGreaterThan(eff('sub', 0.95))
    expect(eff('sub', 0.95)).toBeGreaterThan(eff('terminal', 0.95))
  })

  it('ambient pulse config: 1.00→1.06 swing at 0.003/frame (C1)', () => {
    expect(NCONF.brainPulse.amp).toBeCloseTo(0.06, 9)
    expect(NCONF.brainPulse.rate).toBeCloseTo(0.003, 9)
  })
})
