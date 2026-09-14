// ORB_EYE_SPEC §6: every value on a leva slider under "Eye (showcase)".
// Read only inside the eye channel (scope guard) - nothing else imports it.

export type EyeMode = 'point' | 'steer'

export interface EyeConfig {
  enabled: boolean          // channel opt-in; separate from camera consent
  showDebug: boolean        // ink gaze dot + dead-zone ring + state label
  /**
   * 'point' (user direction 2026-09-10): the eyes POINT - the node nearest
   * the gaze point is focused (violet ring) and a confirm selects it.
   * 'steer': the spec's route A - sustained off-centre gaze drifts the
   * field toward the fixed sight. Kept for comparison.
   */
  mode: EyeMode

  // model / detection
  detectEveryNFrames: number // 1 = camera rate (30 fps); 2 if the fps gate fails
  confidenceMin: number
  blinkThreshold: number     // eyeBlinkLeft/Right blendshape: the eye counts as shut
  blinkIrisThreshold: number // lower: the iris is rejected this early on the way down (the lid is already moving)
  postBlinkFrames: number    // frames after a blink ends whose iris is rejected (the iris "snaps" on reopen)
  foreshortening: boolean    // scale the geometric iris offset by cos(head yaw / pitch)
  vergenceMax: number        // L/R iris disagreement above this drops the eye farther from the blendshapes
  eyeQualityWeights: boolean // weight the eyes by openness and apparent size, not equally
  headYawMaxDeg: number
  headPitchMaxDeg: number
  neutralNoseDrop: number    // k0 in the landmark pitch fallback (est.)

  // gaze composition (uncalibrated map; a calibration replaces it)
  irisGainDeg: number        // full iris deflection ≈ this many degrees
  irisBlendWeight: number    // 0 = geometric iris only, 1 = the model's eyeLook* blendshapes only
  blendCheck: boolean        // halve iris gain when geometry and blendshapes disagree (spec §3)
  pxPerDeg: number           // 60 cm, ~3.6 CSS px/mm (est.)

  // gaze pointer ('point' mode): a soft cone, sized to the node's glow
  pointMinRadiusPx: number   // capture radius floor
  pointRadiusMult: number    // capture radius = visible radius x this
  pointHoldMs: number        // a rival must be the best for this long to take the focus
  pointSwitchMargin: number  // ...and beat the current focus's score by this factor (< 1) to start that clock
  pointReleaseFactor: number // focus drops once its score exceeds this (x capture radius) for pointHoldMs
  pointDwellMs: number       // 0 = off; else a node focused this long confirms itself (hands-free)
  // fixation: a stare is the MEAN of the recent gaze points, not one frame
  fixationMs: number         // window of recent points averaged while they cluster
  fixationMaxMs: number      // the window grows to this while the fixation holds
  fixationRadiusPx: number   // points farther than this from the latest are a saccade, not the fixation
  blinkFreeze: boolean       // hold the features while both eyes are shut (a blink cannot yank the point)
  // learning from confirms: every Enter on a gazed node is a verified sample
  learnFromConfirms: boolean
  learnMaxSamples: number    // confirm samples kept (newest), on top of the explicit run's
  learnMinSamples: number    // without an explicit run, confirms needed before a learned map is used
  learnOutlierPx: number     // a confirm this far from the fitted map is dropped
  learnDecayMin: number      // learned samples lose weight with age, half-life in minutes (0 = no decay)
  wideModel: boolean         // let the fit try per-eye iris + per-eye blendshapes (LOO-validated)

  // filter (degrees / normalised domain)
  minCutoffHz: number        // the IRIS features' One Euro min cutoff (noisy)
  headMinCutoffHz: number    // the HEAD features' (steady - can be faster)
  beta: number
  dCutoffHz: number
  medianPrefilter: boolean   // median-of-3 on every raw feature before the One Euro
  // speed-gated freeze on the mapped point
  freezeEnabled: boolean
  freezeBelowPxPerSec: number  // hold the point once slower than this...
  freezeAfterMs: number        // ...for this long
  freezeReleasePxPerSec: number // release once faster than this
  freezeTolerancePx: number     // while frozen, re-snap to the fixation mean once it has moved this far

  // gate / hysteresis (fractions of min(w,h)/2)
  deadZone: number
  hysteresis: number
  attendMs: number
  releaseMs: number

  // torque
  maxDegPerSec: number
  resumeMs: number           // after hand release / tap / pointer before gaze may torque again

  // lost-face
  holdMs: number
  decayMs: number

  // head-only fallback
  irisOkRateMin: number      // iris ok rate over the last second below this -> head only

  // calibration (E4)
  calNinePoints: boolean     // 9 targets instead of 5: slower, steadier on a noisy camera
  calPointHoldMs: number
  calSampleWindowMs: number
  calInset: number
  calMaxResidualPx: number
}

export const EYE_DEFAULTS: EyeConfig = {
  enabled: false,
  showDebug: false,
  mode: 'point',

  // 2: at every frame the face model dropped 5 % of frames to 33 ms in the
  // E1 gate (headless, CPU delegate, ~8 ms/call); at every 2nd it added
  // nothing measurable over hands-only. §8: that becomes the default.
  detectEveryNFrames: 2,
  confidenceMin: 0.35,
  blinkThreshold: 0.5,
  blinkIrisThreshold: 0.3,
  postBlinkFrames: 1,
  foreshortening: true,
  vergenceMax: 0.3,
  eyeQualityWeights: true,
  headYawMaxDeg: 35,
  headPitchMaxDeg: 30,
  neutralNoseDrop: 0.55,

  // 30, not the spec's 12: with the eyes as the pointer, a full iris
  // deflection has to reach the screen edge (~18° at 60 cm), and real iris
  // offsets rarely exceed ±0.6 of the corner span. Calibration replaces it.
  irisGainDeg: 30,
  irisBlendWeight: 0.5,
  blendCheck: false,
  pxPerDeg: 38,

  pointMinRadiusPx: 70,
  pointRadiusMult: 4,
  pointHoldMs: 160,
  pointSwitchMargin: 0.8,
  pointReleaseFactor: 1.6,
  pointDwellMs: 0,
  fixationMs: 250,
  fixationMaxMs: 500,
  fixationRadiusPx: 90, // above the 1-2° (40-80 px) per-frame jitter, so a stare does not fragment
  blinkFreeze: true,
  learnFromConfirms: true,
  learnMaxSamples: 30,
  learnMinSamples: 6,
  learnOutlierPx: 70,
  learnDecayMin: 3,
  wideModel: true,

  // Iris 0.7 / head 1.5: the head is steady and can be followed quickly;
  // the iris is the noise and wants the smoothing. beta opens either up on
  // a saccade.
  minCutoffHz: 0.7,
  headMinCutoffHz: 1.5,
  beta: 0.015,
  dCutoffHz: 1.0,
  medianPrefilter: true,
  freezeEnabled: true,
  freezeBelowPxPerSec: 60,   // ~1.5° per second
  freezeAfterMs: 100,
  freezeReleasePxPerSec: 160, // ~4° per second
  freezeTolerancePx: 30,      // above the fixation mean's noise excursions (~25 px at 1.5° jitter); a settling filter's bias is larger and gets corrected

  deadZone: 0.28,
  hysteresis: 0.08,
  attendMs: 400,
  releaseMs: 150,

  maxDegPerSec: 14,
  resumeMs: 600,

  holdMs: 250,
  decayMs: 400,

  irisOkRateMin: 0.4,

  // 9 targets at 0.65 of the half-extent: enough redundancy for the fit to
  // be trusted and for a curvature correction to be validated, and coverage
  // of the region the nodes actually occupy (a map extrapolates badly).
  calNinePoints: true,
  calPointHoldMs: 1600,
  calSampleWindowMs: 1000,
  calInset: 0.65,
  calMaxResidualPx: 120,
}

/** The live, slider-mutated config (the NCONF pattern). */
export const EYE: EyeConfig = { ...EYE_DEFAULTS }
