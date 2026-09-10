// Neural star-network color tokens - ported verbatim from the Figma Make
// prototype (reference/figma-make-build/src/App.tsx, PAL). Since the star-core
// pass (2026-09-09) `core` lights the disc centre and `mid` its rim; `deep`
// remains unused.

export type NeuralHue = 'blue' | 'red' | 'violet'
export type NeuralTier = 'brain' | 'hub' | 'node' | 'sub' | 'terminal'

export const PAL: Record<NeuralHue, Record<string, string>> = {
  blue:   { core: '#EAF7FF', body: '#4DA8FF', mid: '#1E6BD6', deep: '#0A2F63', halo: '#2E8BFF' },
  red:    { core: '#FFF0E8', body: '#FF6B4D', mid: '#C43A24', deep: '#5E1409', halo: '#FF4A2E' },
  violet: { core: '#F5EAFF', body: '#A66BFF', mid: '#6B2ED6', deep: '#26094F', halo: '#8B3BFF' },
}

/** Hue index used by the instanced shader's palette uniform arrays. */
export const HUE_INDEX: Record<NeuralHue, number> = { blue: 0, red: 1, violet: 2 }

export const TRAIL_BASE = '#2E6FB0' // trail/base - mid-path color
export const TRAIL_HOT = '#9FD8FF'  // trail/hot - brain-trail near-brain end

/** [haloOpa, bloomOpa, coreOpa] per tier - App.tsx TIER_OPA, confirmed P0. */
export const TIER_OPA: Record<NeuralTier, [number, number, number]> = {
  brain:    [1.0, 0.9, 1.0],
  hub:      [0.85, 0.8, 0.95],
  node:     [0.6, 0.62, 0.8],
  sub:      [0.38, 0.45, 0.65],
  terminal: [0.2, 0.3, 0.45],
}

export function hexToRgb01(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}
