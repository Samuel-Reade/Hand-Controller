// Design tokens (S10). CSS custom properties carry these for the DOM layers
// (src/index.css); this module is the same palette for canvas materials.

export const TOKENS = {
  void: '#0B1020',      // page ground (radial gradient to voidEdge)
  voidEdge: '#070A15',
  deep: '#121A31',      // orb body, panel surfaces
  graticule: '#2A3A5C', // ring lines, hairline borders
  ivory: '#EAE6DA',     // primary text
  brass: '#C9A227',     // focus, reticle, active orbit - the one accent
  ice: '#7FB2D9',       // secondary state, positive deltas, focus rings
  // Chart-grade data-mark steps: same hues as ice/brass, snapped into the
  // dark-mode OKLCH band (L 0.48-0.67, C >= 0.10) and CVD-validated against
  // the panel surface. UI chrome uses the tokens above; data marks use these.
  chartIce: '#4E93DC',
  chartBrass: '#B28C1C',
} as const
