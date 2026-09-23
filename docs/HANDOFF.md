# Handoff: eye-tracking look selector (2026-09-15)

Paste into a new Claude Code chat opened in /Users/samreade/company_map.

## Who / what
Sam (they/them) is building Rally's 3D "neural constellation" (React 19 + react-three-fiber,
zustand, leva, vitest, Playwright gates). Nodes are shouts, the brain is the camp aggregate. The
current thread of work is **webcam eye tracking that lets Sam look at a node and select it**
("the look selector"). Domain rules that constrain everything: RALLY.md vocabulary is LOCKED;
violet is for controls only; the 3D field's only job is salience.

## Working conventions Sam has set
- **Do not commit unless Sam asks.** When asked, commit in logical groups and push to `main`
  (origin = github.com/Samuel-Reade/Hand-Controller).
- Record every product decision in `docs/DECISIONS.md` and every slice in `docs/PORT_LOG.md`.
- Every behaviour change gets its own test and its own leva slider (folder "eye (showcase)").
- Judge accuracy by numbers (replay harness on recordings, confirm residuals), then by Sam's
  human gate: calibrate, look at ten nodes, Enter on each, count first-time hits.
- Sam is concise and wants short, direct answers; explain findings plainly.

## State of the repo
- Last push: `bf3dfea` "Eye tracking: gaze channel, point-mode look selector, calibration,
  learning" (and `a4bd28c` face model + CSP). Everything below is **UNCOMMITTED** in the working
  tree (Sam said no commits during this round):
  - EYE_ACCURACY_PLAN phases 1-5 (diagnostics overlay, recorder, replay harness, foreshortening,
    eye quality weights, vergence, blink edges, median-of-3, separate head/iris cutoffs,
    fixation mean in the channel + speed-gated freeze, wide per-eye fit model, age-decayed
    learned samples, switch margin, ring confidence).
  - Real-data fixes from Sam's first four recordings (see below).
  - `recordings/{rest,horizontal,vertical,head}.json` + `tests/eyeRecordings.test.ts`;
    HUD "RECORD 10 S" button; `tsconfig.tests.json` gained node types.
  - `docs/EYE_ACCURACY_PLAN.md`, DECISIONS/PORT_LOG entries for all of it.
- Tests: 244 pass (`npx vitest run`). Gates: `node scripts/verify-eye.mjs` 11/11,
  `node scripts/verify-centering.mjs` 13/13 (need `npx vite` up on :5173). Lint `npx oxlint src
  tests`, types `npx tsc -b`.

## Where the code lives
- `src/input/eye/face.ts` pure maths (head pose, per-eye iris `eyeOffsets` + `combineEyes`,
  per-eye blendshapes, 14-key `GazeFeatures`, calibrated map with 'base'/'wide' models +
  curvature).
- `src/input/eye/channel.ts` the channel: adaptive blink thresholds, history-aware vergence,
  per-feature filters (median only when frames < 60 ms apart), fixation mean, freeze, telemetry
  (`eyeRuntime`), recorder sink, point/steer modes, arbitration (mouse > hand > gaze).
- `src/input/eye/calibration.ts` weighted ridge fit, LOO-validated wide model and curvature,
  online learning from confirms (`learnConfirm`, consensus outliers, base weight decay, age decay).
- `src/input/eye/fixation.ts`, `replay.ts` (recording -> metrics), `config.ts` (`EYE`, all knobs).
- `src/input/useEyeInput.ts` shell: FaceLandmarker on the hand shell's frames, `eyeLearn`,
  `eyeSetBase`, DEV seams `window.__eyeInfo/__eyeConf/__eyeOnline/__eyeRecord/__eyeCal`.
- `src/input/useHandInput.ts` camera (720p ideal), hand model every Nth frame while the eye is
  on and no hand is seen (`handEveryNWhileEye` 3), face model on the same frame.
- `src/neural/gazeFocus.ts` soft-cone focus with hysteresis + switch margin; scene wiring in
  `src/neural/NeuralScene.tsx` (gaze focus -> violet dashed ring; Enter/pinch/dwell = click on
  the gazed node; each confirm feeds `eyeLearn`).
- UI: `src/ui/EyeCalibration.tsx` (9 rings + head-turn stage), `EyeDebug.tsx` (`?eyeDebug=1`:
  raw/head-only dots, per-eye bars, rates, delegates), `EyeControls.tsx` (leva),
  `CameraConsent.tsx` (EYE / CALIBRATE / RECORD buttons in the HUD).
- Synthetic harness: `src/dev/syntheticEye.ts` (`?input=synthetic&scenario=eye-point&eye=1`).

## What Sam's four recordings showed (2026-09-15) and what was done
1. Detection runs at **10 Hz** on Sam's Mac (frames 100 ms apart). Fix: hand model every 3rd
   frame while the eye is on; median stands down at low rates; fixation window up to 800 ms.
   Overlay shows Hz, per-model ms and GPU/CPU delegate. **Root cause not yet confirmed** - ask
   Sam for the overlay's Hz line ("12 Hz face 45 ms CPU hand 50 ms CPU"); if CPU, consider a
   Web Worker for the face model or 480p.
2. Sam's **open-eye blink value is 0.2-0.25** (real blink 0.7). Fix: per-eye adaptive baseline +
   `blinkMargin` 0.2. Replay: both eyes ok 98-100 % (was ~70 %), head-only mode gone.
3. Sam's **eyes carry a constant 0.24 offset** from each other. The old vergence rule flip-flopped
   eyes = the "shaky" dot. Fix: vergence on a CHANGE in the L-R difference; reference advances
   only for accepted eyes.
4. Blendshapes carry ~2x the horizontal signal of the geometry on Sam's camera (the fit weighs it).
5. **Head turn drifted the point 406 px** with eyes on centre. Fix: calibration head-turn stage
   (`calHeadTurn`, 6 s, eyes on the centre ring, head turns). The eyeball-centre model stays
   gated on the NEXT head-turn clip (recorded with the fixed recorder).
6. Recorder flaw fixed: rejected eyes used to record their blendshape fallback; now `geom`
   holds pure per-eye values. Replay handles the old clips by keeping rejected eyes rejected.
Calibration residual Sam saw with 9 rings: 66 px (~1.5°). Implied floor at 10 Hz ~50-70 px.

## Sam's machine
It froze repeatedly during the last session (load average 89 on 10 cores, rebooted). Not
memory. Hogs at the time: VS Code 132 %, camera daemons (the app tab holding the camera),
WindowServer 46 %, Claude app. Advice given: close the app tab / DISABLE in the HUD to stop the
camera; restart VS Code (this chat was huge). **Offered but not built: a light mode** - 480p when
the models are on CPU, face every 2nd frame by default, 30 fps render cap while the eye is on.
Do not run Playwright gates while Sam's machine is struggling (each launches Chromium with a
fake camera and both models).

## Immediate next steps
1. Ask whether the freeze is the whole Mac, Chrome, or VS Code; build the light mode if wanted.
2. Sam reloads, enables camera, EYE, CALIBRATE (with the head-turn stage), reads the overlay Hz
   line, runs the ten-node gate, and re-records the four clips with the fixed recorder
   (HUD RECORD 10 S -> files land on the Desktop; copy to `recordings/` as rest/horizontal/
   vertical/head.json; `npx vitest run tests/eyeRecordings.test.ts` prints metrics).
3. Decide the eyeball-centre model from the new head clip (build if drift > ~60 px calibrated).
4. Remaining signal-side lever if still needed: a pupil finder on the raw 720p eye crop.
5. Commit + push when Sam asks (two commits: real-data fixes; accuracy pass), then update
   `docs/EYE_ACCURACY_PLAN.md` status.

## Memory files (auto-loaded next session)
`~/.claude/projects/-Users-samreade-company-map/memory/`: rally-domain, eye-tracking-direction,
eye-tracking-status - update eye-tracking-status when the state changes.
