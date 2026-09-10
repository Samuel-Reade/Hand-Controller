// PLACEHOLDER momentum source - RALLY.md §5 (LOCKED channel mapping).
//
// Momentum ("gaining traction") is a RATE OF CHANGE and gets its own motion
// channel: pulse rate + velocity glow on the node, the comet-tail band on its
// trail. It is never size (size = cumulative rallies). Real values will come
// from shout analytics; until then this marks `movingFraction` of shouts as
// moving, with varied intensity, from a deterministic hash of the node name -
// so the field has salience to show, the same nodes move on every load, and
// no RNG draws are taken from the layout generator (layout hash untouched).
// The brain is the camp-wide aggregate and is never "moving" in this sense.

import { NCONF } from './config'
import type { NeuralConfig } from './config'

/**
 * Name -> [0, 1). FNV-1a, then a murmur3 avalanche finalizer: on its own FNV
 * clusters badly for short near-identical names ("n_h0" .. "n_h159" put 4
 * posts in the top 12% instead of ~19), and these placeholders are exactly
 * that. `salt` is XORed in BEFORE the finalizer so two channels drawn from
 * the same name (momentum, rallies) are decorrelated by a full avalanche - a
 * string prefix was not enough (measured rho 0.23). Stable, dependency-free.
 */
export function nameUnit(name: string, salt = 0): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= salt
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Momentum 0..1 for a node: 0 = still (most); moving shouts get 0.35..1. */
export function momentumFor(name: string, cfg: NeuralConfig['momentum'] = NCONF.momentum): number {
  if (name === 'brain') return 0
  const u = nameUnit(name)
  if (u >= cfg.movingFraction) return 0
  return 0.35 + 0.65 * (u / Math.max(1e-9, cfg.movingFraction))
}
