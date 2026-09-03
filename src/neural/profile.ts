// The neural scene's FEEL profile - the "two FEEL profiles over one
// integrator" pattern ORB_SELECT_SPEC §0 asks for. useOrbPhysics.ts is not
// edited; the same integrator runs both scenes and only the constants differ.
//
// Applied at module load (App.tsx), BEFORE React mounts, so the leva sliders
// initialise from these values rather than the globe's. `?scene=globe` never
// calls this and keeps the base FEEL exactly - its frozen tests assert it.
//
// What each override buys:
//   detentBelow 0     the free detent spring engages only below this angular
//                     speed; at 0 it never engages, so a released rotation is
//                     not dragged onto the globe's latitude/longitude grid (the
//                     "screen moves after I let go"). Keyboard step() targets
//                     still work - forced targets bypass detentBelow and use
//                     detentPull x forcedBoost, both untouched.
//   friction 30       coast distance is v / friction. At the base 2.6 a 3 rad/s
//                     release drifts ~1.15 rad; at 30 it settles in ~0.1 rad
//                     within ~150 ms. A hard flick still nudges the field
//                     (~10 deg at 6 rad/s) - the mechanic survives, the drift
//                     does not. Slider: FeelPanel > rotation > friction.
//   forcedBoost 25    keyboard / OrbitIndex step() targets are a spring of
//                     stiffness detentPull x forcedBoost damped by friction.
//                     At friction 30 the base boost (k = 19.8) is heavily
//                     overdamped and a step takes ~8 s to snap; 25 gives
//                     k = 225 against c = 30 - critically damped (2*sqrt(k) =
//                     c), so a step lands in ~0.5 s with no ring. Forced
//                     targets only: a hand release never sets one.
//   zoomPersist true  a released zoom is folded into a running base instead
//                     of springing back to 1.0 (zoomView.ts) - the camera
//                     stays exactly where the hands left it.
//   zoomCommitsDrill  false, permanently here (ORB_SELECT_SPEC §6): a commit
//                     fires the drill recenter + push, which is by far the
//                     largest unwanted camera translation a zoom could cause.
//   zoomMin/zoomMax   0.2 .. 12 - "infinite within reason". Camera distance is
//                     camera.z / factor: 12x from z=4600 is ~380 units, well
//                     outside the anchor's corona; 0.2x is ~23000 units, the
//                     field still readable. Both on sliders.

import { FEEL } from '../config/feel'
import type { FeelConfig } from '../config/feel'

export const NEURAL_FEEL: Partial<FeelConfig> = {
  detentBelow: 0,
  friction: 30,
  forcedBoost: 25,
  zoomPersist: true,
  zoomCommitsDrill: false,
  zoomMin: 0.2,
  zoomMax: 12,
}

export function applyNeuralFeelProfile(target: FeelConfig = FEEL): void {
  Object.assign(target, NEURAL_FEEL)
}
