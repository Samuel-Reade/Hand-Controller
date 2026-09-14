# Eye look-selector: accuracy plan (2026-09-13)

**Status 2026-09-13:** phases 1-5 built (uncommitted) except the eyeball-centre model
(gated on the head-turn recording) and the data-driven retune (needs the recordings). See
DECISIONS.md "Eye accuracy plan, phases 1-5 built" for the numbers and findings.

Goal: the violet ring lands on the node you are looking at, first time, and stays still while
you hold your gaze. Judged by numbers from recordings and by confirm residuals, then by the human
gate - never by feel alone. One idea per commit so we learn which ones move the needle.

Source of ideas: EYE_TRACKING_IDEAS.md (marked up in session), the current `src/input/eye/*`.
Status of the build going in: point mode, 9-ring calibration with validated curvature, learning
from confirms, separate iris sources, 720p, fixation mean, blink freeze. All UNCOMMITTED.

## Step 0 - commit what exists
One commit for the eye build as it stands, so every later step is a clean diff.

## Phase 1 - measure (one commit)
Diagnostics on the debug overlay (ink): raw vs filtered dot; a head-only dot beside the full
one; per-eye iris bars; the four eyeLook blendshape bars; iris ok rate per eye; detection Hz and
ms. A dev-only 10 s recorder that saves raw channels (`yaw, pitch, per-eye irisX/Y, blendshapes,
blinkL/R, confidence, t`) to JSON. A vitest replay harness that runs a recording through the pure
pipeline and prints:
- **rest jitter**: rms of the point at rest, raw and filtered, per axis (px)
- **saccade response**: fraction of the true excursion the point covers, and settle time (ms)
- **head-turn drift**: movement of the point while the eyes stay on centre and the head turns (px)
- **confirm residual**: distance from the gaze point to the confirmed node at confirm time
  (already available from the online calibration; trend it over a session)

You record four clips of ~10 s: rest on centre; horizontal saccades; vertical saccades; head
turns with eyes on centre. Those four files are the benchmark for everything below.

## Phase 2 - signal fidelity (symptom: "doesn't follow the eyes")
Each its own commit, kept only if the replay numbers improve:
1. Foreshortening: scale the geometric iris offset by cos(head yaw) (ideas 3.2). Trivial.
2. Eye quality weighting: weight each eye by (1 - blink) and its corner span in px; drop the eye
   that disagrees with the blendshapes when L/R differ by > 0.3 (3.6, 3.8).
3. Blink edges: reject iris ~3 frames before the blink threshold and the frame after reopen (2.8).
4. Eyeball-centre model (3.3) - ONLY if the head-turn clip shows the map breaking down: gaze ray
   from an estimated eyeball centre through the iris, using the head rotation we already have.
   The structural fix for "calibrated at one head pose".

Targets: saccade response >= 80 % of the true excursion within 150 ms; head-turn drift < 60 px
over +-20 deg of yaw.

## Phase 3 - steadiness (symptom: "shaky")
1. Median-of-3 before the One Euro filter (2.3).
2. Separate cutoffs for head (steady, ~1.5 Hz) and iris (noisy, ~0.6 Hz); the six filters exist
   already (2.4).
3. Speed-gated freeze: hold the point dead-still below ~1.5 deg/s for > 100 ms, release above
   ~4 deg/s (2.5) - if the fixation mean is not stilling it enough.
4. Retune minCutoff / beta from the rest and saccade recordings, not by hand.

Target: rest jitter < 25 px rms filtered at 900 px height, with saccade settle still < 150 ms.

## Phase 4 - the map
1. Wider feature vector for the fit: per-eye iris x/y and the four blendshapes individually
   (8 features per axis) once confirm samples have accumulated; ridge keeps it stable (5.2+).
2. Time-decay of learned samples so a session that drifts twice does not fight itself.
3. Decide 5 / 9 / 25 rings from the residual pattern on the recordings, not by guessing.

Target: calibration residual trending down over a session's confirms.

## Phase 5 - the selector
1. Fixation-consistent disambiguation: when two candidates score within 20 % of each other,
   prefer the one the last 0.5 s of fixation history favours.
2. Ring confidence: the dashed ring tightens as the fixation stabilises, so you can see when a
   confirm will land where you mean.
3. Revisit dwell as the first step (select = centre + camera in), which spreads the neighbours
   and makes the second, precise pick easier.

## Human gate, each phase
Enable camera, EYE, CALIBRATE; look at ten nodes across the field and press Enter on each; count
first-time hits. Ten of ten at rest distance is the bar for "done"; the phase's numbers are the
bar for "commit".

## What I need from you
- Which symptom dominated last time: the dot shaking at rest, or not moving enough when only the
  eyes move. It sets whether Phase 2 or Phase 3 goes first.
- The four recordings, once Phase 1 lands (two minutes at the keyboard).
