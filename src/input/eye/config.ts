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
  blinkIrisThreshold: number // floor for iris rejection; the live threshold is the user's open-eye baseline + blinkMargin
  blinkMargin: number        // iris rejected when eyeBlink exceeds this user's open-eye baseline by this much
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
  learnFromClicks: boolean   // a mouse/touch tap on a node is a verified sample too (the user looks where they click)
  learnMaxSamples: number    // confirm samples kept (newest), on top of the explicit run's
  learnMinSamples: number    // without an explicit run, confirms needed before a learned map is used
  learnOutlierPx: number     // a confirm this far from the fitted map is dropped
  learnDecayMin: number      // learned samples lose weight with age, half-life in minutes (0 = no decay)
  wideModel: boolean         // let the fit try per-eye iris + per-eye blendshapes (LOO-validated)

  // filter (degrees / normalised domain)
  minCutoffHz: number        // the IRIS features' One Euro min cutoff (noisy)
  headMinCutoffHz: number    // the HEAD features' (steady - can be faster)
  beta: number               // the HEAD features' speed term (degrees/s)
  irisBeta: number           // the IRIS and blendshape features' speed term (normalised units/s - ~100x the head's for the same effect)
  dCutoffHz: number
  medianPrefilter: boolean   // median-of-3 on every raw feature before the One Euro
  medianMaxDtMs: number      // ...only while frames arrive faster than this (at 10 Hz a 3-frame median is 300 ms of lag)
  handEveryNWhileEye: number // with the eye channel on and no hand in view, run the hand model every Nth frame (frees the face model)
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
  calHeadTurn: boolean       // a final stage: eyes on the centre ring while the head turns - separates head gain from eye gain (off: the product is eyes only, head still)
  calHeadTurnMs: number
  // saccade drill (dev): a ring steps centre, left, right, centre, up, down - each shown this long - while
  // the recorder runs with the ring as ground truth, so the replay can say whether a saccade falls short
  // (response < 1) or overshoots (> 1) on THIS user's map
  drillStepMs: number
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
  // Real data (2026-09-15): this user's OPEN-eye blink value sits at 0.2-0.25
  // with a real blink at 0.7; a fixed 0.3 froze the pointer for seconds.
  // The live threshold is baseline + margin, never below the floor.
  blinkIrisThreshold: 0.3,
  blinkMargin: 0.2,
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
  fixationMaxMs: 800, // at 10 Hz (a real machine) 800 ms is only 8 frames; the dispersion rule still resets on a saccade
  fixationRadiusPx: 90, // above the 1-2° (40-80 px) per-frame jitter, so a stare does not fragment
  blinkFreeze: true,
  learnFromConfirms: true,
  // On (2026-09-14): Enter can only confirm the RINGED node, so a gaze
  // confirm with the ring one node too high teaches the map that wrong
  // node. A click is the node the user meant - the only truth that can
  // pull a biased map back. Per user, per sitting, and only when they click.
  learnFromClicks: true,
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
  // 4 (drill clip, 2026-09-14): the iris features are normalised units
  // (a full saccade is ~3 units/s), so the head's 0.015 never opened the
  // cutoff - the iris was a fixed 0.7 Hz low-pass with a 680 ms settle,
  // which is exactly the "falls short" the user felt, and it biased the
  // calibration's sample window 10-15 % low. Sweep: 0.015 -> 4 takes the
  // drill's saccade response 0.80 -> 0.97 and settle 689 -> 526 ms (the
  // rest is reaction time); rest jitter unchanged.
  irisBeta: 4,
  dCutoffHz: 1.0,
  medianPrefilter: true,
  medianMaxDtMs: 60,
  handEveryNWhileEye: 3,
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
  // Off (user direction 2026-09-14): the product is eyes only with the head
  // still. With the head still the stage adds 24 samples a linear map
  // cannot fit (residual 66 -> 120 px on the first live run) and buys
  // nothing. The slider stays for a head-moving demo.
  calHeadTurn: false,
  calHeadTurnMs: 6000,
  drillStepMs: 2000,
  calPointHoldMs: 1600,
  calSampleWindowMs: 1000,
  calInset: 0.65,
  calMaxResidualPx: 120,
}

/** The live, slider-mutated config (the NCONF pattern). */
export const EYE: EyeConfig = { ...EYE_DEFAULTS }
