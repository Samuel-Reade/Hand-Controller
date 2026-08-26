// Every constant that changes how the orb *feels*, in one object.
// Leva sliders (src/ui/FeelPanel.tsx) mutate this object in place; physics,
// input and rendering read it live every frame. Never inline a feel value in
// a component - add it here and give it a slider.

export interface FeelConfig {
  dragGain: number     // px -> radians (pointer)
  handGain: number     // normalized hand units -> radians
  friction: number     // exponential decay; higher = shorter coast
  detentPull: number   // spring toward nearest item / orbit
  detentBelow: number  // detent engages under this speed (rad/s)
  forcedBoost: number  // spring multiplier for step() / index clicks
  falloff: number      // label + item fade exponent
  itemGrow: number     // focus swell
  // hand pipeline
  minCutoff: number    // One Euro
  beta: number         // One Euro speed coefficient
  deadZone: number     // normalized units/frame below which motion is ignored
  pinchCutoff: number  // One Euro min cutoff for pinch distance (Hz) - see DECISIONS.md
  pinchClose: number   // ratio to engage
  pinchOpen: number    // ratio to release - must exceed pinchClose (hysteresis)
  tapMaxMs: number
  tapMaxTravel: number // normalized units (hand)
  // detent snap + pointer tap (promoted from magic numbers - see DECISIONS.md)
  snapEpsilon: number  // rad: snap-and-clear a target inside this error...
  snapVelocity: number // ...when speed is under this (rad/s)
  tapMaxTravelPx: number // pointer travel under this is a tap, not a drag
}

export const FEEL: FeelConfig = {
  dragGain:    0.0060,
  handGain:    2.60,
  friction:    2.60,
  detentPull:  9.00,
  detentBelow: 2.20,
  forcedBoost: 2.20,
  falloff:     2.20,
  itemGrow:    2.40,
  minCutoff:   1.00,
  beta:        0.03,
  deadZone:    0.004,
  pinchCutoff: 8.0,
  pinchClose:  0.28,
  pinchOpen:   0.38,
  tapMaxMs:    250,
  tapMaxTravel: 0.02,
  snapEpsilon: 0.008,
  snapVelocity: 0.30,
  tapMaxTravelPx: 6,
}

// prefers-reduced-motion (S11): inertia IS the product, so the coast
// shortens substantially rather than disappearing. Set from the media query
// in App; read live by the physics.
export const motionPrefs = {
  reducedMotion: false,
  reducedCoastMultiplier: 3.5, // effective friction multiplier
}
