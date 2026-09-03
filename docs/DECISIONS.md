# DECISIONS

One line per choice the spec didn't dictate (or dictated loosely).

## Slice A
- Versions pinned: three 0.185.1 / @react-three/fiber 9.7.0 / drei 10.7.8 / React 19.2.8 / leva 0.10.1 (React-19 peer verified) / @mediapipe/tasks-vision 1.0.1 / vitest 4 / vite 8. R3F9 <-> React 19 pairing per spec.
- Linter is oxlint (create-vite's current default), not eslint; `npm run lint`.
- Pure physics core (createPhysicsState/applyInputEvent/stepPhysics) exported from useOrbPhysics.ts so headless tests and the React hook share one implementation; same for the shared `orbRuntime` mutable object the DOM overlays read.
- Promoted the spec's inline magic numbers to FEEL sliders per S2 "every feel constant lives in the config": snapEpsilon (~0.008 rad), snapVelocity (0.30 rad/s, chosen), tapMaxTravelPx (~6 px).
- `tap` also ends the engagement in physics (gesture machine emits tap INSTEAD of release, so something must disengage); zero coast.
- `step` semantics: yaw dir +1 = focus the item currently right of centre (yaw target -= step); pitch dir +1 = one orbit up in latitude. OrbitIndex emits |delta| unit steps for multi-orbit jumps, staying inside the locked event vocabulary; forced targets compose (base = current forced target if set).
- `step` events are ignored while engaged - a step must not fight the hand/pointer mid-drag.
- Selection = argmax of focus weight over all items (S2 "item nearest the focus point"), computed analytically per frame; tests prove analytic == vector-path == three.js transforms.
- Keyboard handling in its own src/input/useKeyboardInput.ts (spec structure only listed usePointerInput.ts).
- Reticle + labels are DOM overlays; reticle corner brackets flash ice briefly on tap so the click gesture has feedback before the Slice B panel exists (Slice A does NOT open a panel on tap - panel is Slice B).
- Dev-only URL params for scripted screenshots: ?yaw=<deg>&pitch=<deg> initial orientation, ?tune=0 hides leva. (?input=synthetic&scenario=... comes with Slice C.)
- Labels flip to the left side of their item on the left half of the screen so text runs outward, never across the reticle; an 8px deadband keeps a dead-centre label from flickering sides.
- FocusAnnouncer: visually-hidden aria-live region announcing the focused report (a11y; not in spec).
- Tests live in tests/ per S4; typechecked via tsconfig.tests.json added to the root references.
- Telemetry: visible by default in dev, hidden in prod until toggled with the T key.
- Pointer velocity = displacement over the trailing 120ms window of samples; pointercancel maps to `lost`.
- ORB_ITEMS (flat placement list) lives in src/orb/items.ts, shared by scene + label layer (fast-refresh hygiene; spec structure folded it into Orb.tsx).
- oxlint's react(immutability) heuristic is scoped off for src/orb/Orb.tsx: mutating materials/refs inside the single useFrame is the S6-mandated pattern, not a bug.

## Slices B + C
- Chart data marks use chart-grade steps of ice/brass (#4E93DC, #B28C1C) - same hues snapped into the dark-surface OKLCH band and CVD-validated (dataviz six-checks); UI chrome keeps the raw S10 tokens. Text stays in ink tokens, never series colors.
- 12-month trend is a 2px line chart with a zoomed (non-zero) domain - lines showing change may zoom; bars keep their zero baseline. Series animation disabled (instrument register: data is just there; also right under reduced-motion).
- Panel is a focus-trapped aria-modal dialog; backdrop click closes it like Escape; closing returns focus to the orb stage.
- Added FEEL.pinchCutoff (8 Hz, slider) - a dedicated One Euro min-cutoff for the pinch-distance channel. At the spec's shared 1 Hz cutoff a pinch transition takes ~5 frames each way (~165 ms x2), so a 180 ms tap can NEVER be confirmed inside tapMaxMs; hysteresis + 2-frame confirms already guard the pinch channel against noise. Position channels keep minCutoff as spec'd.
- Harness noise is tracker-realistic - AR(1) wander (sigma 0.0028, rho 0.9998) plus sub-pixel white (sigma 0.0004), total spatial sigma ~= 0.003 per the spec. Frame-independent white noise at sigma 0.003 is physically wrong for a video tracker and would defeat ANY per-frame dead zone.
- Extra scenario `stillPinched` (hand at rest while engaged) proves the dead zone holds where it actually matters; the spec's `still` (unpinched) also runs. approach is exposed as approachNear/approachFar.
- ?input=synthetic&scenario=<name> loads the harness via dynamic import (kept out of the prod bundle) and loops the scenario with a pause.

## Slice D
- MediaPipe wasm + hand_landmarker.task are vendored under public/ (no CDN at runtime - nothing leaves the device, works offline). The tasks-vision module itself is dynamically imported on first enable, so the orb pays no bundle cost until the user opts in.
- GPU delegate with automatic CPU fallback when GPU init fails.
- detectForVideo drives the pure pipeline from requestVideoFrameCallback (setTimeout ~30Hz fallback); while a report panel is open frames still draw the thumbnail but the pipeline is reset and emits nothing (S2: suspended entirely).
- Camera auto-stops after 20s with no hand while idle (status 'stopped', resume affordance); stopping mid-gesture emits `lost` first so the orb freezes and decays, never flings.
- Hand consent/HUD is one component (CameraConsent.tsx) covering off/starting/on/stopped/denied/error; below 820px it is not offered and a running camera stops on shrink.
- prefers-reduced-motion multiplies effective friction by 3.5 (motionPrefs in feel.ts, tested) and CSS drops panel transitions; direct manipulation and detents unchanged.
- Verification: the whole camera path (consent -> getUserMedia -> wasm + model load -> detection loop -> HUD thumbnail -> disable) was smoke-tested headless with Chromium's fake webcam; only real-hand behaviour remains for the human gate.

## Environment hardening (post-crash)
- The project lives in an iCloud-synced Desktop on a nearly full disk; iCloud "Optimize Mac Storage" evicted file contents out from under the dev server (dataless files whose reads hang), which is what crashed the site. node_modules is symlinked to node_modules.nosync (excluded from iCloud sync); evicted project files were regenerated in place.
- vite watcher debounced (awaitWriteFinish) against sync-driven event storms; changes to Orb.tsx full-reload instead of HMR-remounting the Canvas (WebGL context leak protection); a lost WebGL context recovers with one automatic reload.

## Neural port (P0-P6)
- The globe was replaced by the Figma Make neural star-network per
  ORB_NEURAL_PORT_SPEC.md. Every choice, ground-truth correction (C1-C5)
  and missing-spec assumption is logged in PORT_LOG.md - single home, one
  entry per slice, rather than duplicating here. Frozen layers (gesture
  machine, physics, input bus, DOM/dashboard) carry zero diffs; the neural
  renderer lives in src/neural/ and registers its leva groups from inside
  the scene so FeelPanel.tsx stays untouched. ?scene=globe keeps the globe
  reachable for side-by-side; scripts/verify-neural.mjs re-runs the
  machine gates.

## Two-hand zoom (Z1-Z3, ORB_ZOOM_SPEC)
- Bus vocabulary: two new event types as specified - `zoom` is phased
  (`engage` / `update` / `end`, carrying the factor and the session's commit
  so far) and `zoomCommit` (`in` / `out`). The frozen physics switch has no
  default branch, so both fall through untouched; zero diff there.
- The arbiter (src/input/handArbiter.ts) owns the single-hand machine's
  state object and only ever resets it through the exported factory; a
  conversion to zoom ends an engagement by emitting `release` at zero
  velocity itself. gestureMachine.ts carries zero diff.
- Hand identity is slot-based (nearest last-known knuckle, two-slot
  assignment); MediaPipe handedness labels are never read - they flip under
  the mirror. Filters are NOT reset on dropout, mirroring the single
  pipeline, so every base scenario emits byte-identical events through the
  arbiter (asserted per scenario in tests/zoom.test.ts).
- A hand OPENING ends the zoom immediately; a hand LOST mid-zoom gets the
  same 6-frame tolerance the single machine gives `lost`, holding the last
  factor meanwhile. Re-arming the single machine requires every present
  hand to be open (a hand leaving the frame counts as open).
- After a commit the arbiter re-latches to 1.0 as specified; the scene
  carries the pre-commit factor and eases it out with the P5 recenter
  progress (src/input/zoomView.ts, pure + tested). The spec's bare
  `restDistance / zoomFactor` would snap the camera back at the drill.
- Camera distance is measured to the CURRENT anchor: rest = camera.z minus
  the recenter push once drilled (2000 at level 0, 1100 at level 1). With
  the spec's fixed 2000, zoomMax at level 1 put the camera ~50wu from the
  anchor. `select.recenterPush` (900, inline in P5) is now a leva slider.
- Scenario 3's "ratio 1.3 (below zoomInCommit)" is scripted as FACTOR 1.3
  (scale ratio 1.127): a scale ratio of 1.3 is factor 1.78, above the
  commit. Scenarios 1/2 use the literal scale ratios (1.9 / 0.55).
- asymmetricDepth is compared against zoomIn with zoomCommitsDrill=false so
  a one-frame difference in commit timing cannot split the trajectories.
- `pipeline.reset()` returns the closing events: `lost` for an engagement,
  a zoom `end` for a zoom. Panel-open and camera-stop emit them, so nothing
  stays engaged or zoomed under a dashboard (previously a keyboard-opened
  panel left a hand engagement dangling).
- Dev affordances: `?zoomDrill=0` (zoomCommitsDrill=false at load, the
  human-gate fork), `?scenario=a,b` plays a list, the synthetic drive draws
  into the HUD thumbnail and the HUD renders in synthetic mode - the
  two-hand state is screenshot-able without a camera (scripts/verify-zoom.mjs).
- `?scene=globe` stays zoom-less: the globe never publishes hubFocused (no
  commits) and its camera ignores the zoom view. Flagged per spec section 9.
- ORB_GRAB_SPEC.md is still absent and the grab slices remain in the
  2026-08-25 stash (they edit the frozen gesture machine); the
  `fistPlusPinch` harness pose is deferred with them.

## Environment - out of iCloud (2026-09-02)
- The project no longer lives on the iCloud-synced Desktop; it sits in the
  home directory (`~/rally-biz-ui`), which is not synced. The
  `node_modules -> node_modules.nosync` symlink is retired with it: iCloud
  replaced that symlink with a real directory within minutes of it being
  recreated, then filled the tree with conflict copies (`node_modules 2`,
  `node_modules 3`) and dataless placeholders until `tsc` no longer
  resolved and the editor red-flagged tsconfig.tests.json.
- Eviction and conflict copies are SEPARATE mechanisms: turning off
  "Optimize Mac Storage" stops the first, not the second. Only leaving the
  synced tree fixes both - which is why the nosync symlink was never more
  than a delay. Evidence: `~/rally-orb-poc` (a pre-git copy of this project
  from 2026-08-25) sat in the home directory for a week with one clean
  node_modules and zero duplicates.
- Specs stay in `~/Desktop/Rally .mds/`; plain markdown survives sync fine.
- `~/rally-orb-poc` is left in place but is NOT the live repo (no git).

## Zoom depth mapping inverted (2026-09-02)
- The zoom driver is now `ratio ^ -zoomGain` (was `ratio ^ zoomGain`).
  Pushing both pinched hands toward the screen zooms OUT; pulling them back
  toward your body zooms IN. One line, `stepArbiter` in handArbiter.ts.
- This makes the code agree with ORB_ZOOM_SPEC's own intent line and its
  human-gate question ("does pulling toward you read as zoom-in") - the
  shipped mechanism had the sign backwards against its own spec. The spec's
  section 2/5 formulas were corrected to match rather than the reverse.
- Nothing downstream of the driver changed: factor > 1 still means "nearer
  camera", so the commit thresholds, the spring-back, the carry hand-off and
  `cameraDistance = restDistance / factor` are all untouched.
- The pair scenarios in syntheticHand.ts script PHYSICAL depth, so their
  trajectories were reversed to keep their names true (`zoomIn` now shrinks
  the hands). Scenarios that shrink start from a larger base scale (0.16,
  and 0.12/0.24 for asymmetricDepth) so the far end stays trackable against
  the tracker-noise floor. `scaleRatioFor` is the single inverse and flipped
  with the driver.
- Verified direction-sensitive: restoring the positive exponent fails 6 of
  the zoom tests (scenarios 1, 2, 3, 9 and the dolly fork).

## Specs moved to docs/ (2026-09-02)
- The six spec/log markdown files live in `docs/` now; only README.md stays
  at the repo root, where GitHub and editors expect it. `git mv` was used, so
  history follows each file.
- Doc-to-doc references inside `docs/` are bare filenames and still resolve -
  they became siblings. What needed fixing was everything pointing IN from
  outside: README's index, `see docs/DECISIONS.md` in feel.ts, PORT_LOG.md in
  NeuralScene.tsx / neural/config.ts, and REFERENCE.md's pointer to PORT_LOG.
- PORT_LOG's `reference/...` paths were root-anchored (`/reference/...`) since
  a bare relative path now reads from inside `docs/`.
- `reference/FIGMA_MAKE_HANDOFF.md` still names `FIGMA_NEURAL_ORB_SPEC.md`
  bare. Left as-is deliberately: it is a verbatim Figma Make artifact, and
  PORT_LOG's aliasing note records where the file actually sits.

## Selection model reversal authorized (2026-09-02)
- `docs/ORB_SELECT_SPEC.md` landed: a fixed screen-center crosshair highlights
  the nearest targetable node and a pinch-tap confirms; neural-scene rotation
  becomes free and unbounded. Recorded here because that spec's §0 requires
  it - it deliberately reverses ORB_BUILD_SPEC §2's LOCKED "rotation is
  selection - no pointing, no cursor" and its detents on both axes.
- The reversal is scoped to the neural scene. `?scene=globe` keeps detents,
  rotation-as-selection and the ±1.1 pitch clamp, and stays the reference
  build; the two behaviours are to be FEEL profiles over one integrator, not
  a fork of the physics file.
- NOT YET BUILT. Slices PT1-PT3 with human gates between them; nothing in
  src/ implements it. The doc is filed so the contradiction with the base
  spec is on the record rather than discovered later.
- Interaction with the zoom spec: §6 there makes `zoomCommitsDrill` false
  permanently in this scene and widens the dolly clamps. The shipped default
  is still `true`, so the zoom currently drills - that gap closes at PT3. The
  §6 direction "pull hands toward you = camera in" already matches the
  inverted mapping shipped earlier today.

## ORB_SELECT PT1 build decisions (2026-09-02)
- §5's pointing constants live in `NCONF.point`, not FEEL. The spec files
  them as "FEEL additions", but its own §0 scope guard makes them
  neural-scene-only, and NCONF is that scene's leva-wired config. Keeping
  them out of FEEL leaves the frozen globe tests asserting exactly the FEEL
  they always did.
- The anchor is a fallback candidate, not a positional competitor, and is
  held under that rule rather than the deadband. Forced by a genuine
  contradiction between the spec's §1 and §4 - see the PT1 section of
  docs/PORT_LOG.md for the measurements.
- `bindReports()` in src/neural/pointing.ts is the only place the
  report↔node binding exists. The spec assumed one already existed; P5's
  level-1 re-shell is not one. One host per report (35), matching the
  density §2 names.
- PT1 ships the spec's `acquireRadius: 46` unchanged even though measurement
  says this field wants ~90-130. Tuning it is the human gate's call; the
  slider range covers it.

## External camera, drift-free release, persistent zoom (2026-09-02)
- The neural scene now runs the SAME frozen integrator on its own FEEL
  profile (src/neural/profile.ts, applied at module load in App.tsx when
  `?scene` is not `globe`). This is the "two FEEL profiles over one
  integrator" pattern ORB_SELECT_SPEC §0 prescribes; useOrbPhysics.ts is not
  edited and `?scene=globe` keeps the base FEEL byte-for-byte.
- `detentBelow: 0` disables the FREE detent (it engages only below that
  speed) without touching detentPull, so keyboard / OrbitIndex `step()`
  targets - which bypass detentBelow - still work. `forcedBoost: 25` makes
  that forced spring critically damped against `friction: 30`
  (2*sqrt(9*25) = 30); at the base boost it was so overdamped a step took
  ~8 s to snap.
- `friction: 30` is the drift answer. Coast is v*dt/(1-e^(-f*dt)) (discrete
  Euler), ~0.085 rad for a 2 rad/s release, gone in ~150 ms. Measured in the
  app: a hard flick nudged 12.5 deg inside 250 ms, then 0.01 deg over the
  next 1.75 s. A flick is now a nudge, not a spin - the trade the brief
  asked for ("does not move the screen after release"). Slider: rotation >
  friction, range widened to 40.
- Zoom persists: `FEEL.zoomPersist` (new, default false). When true a
  released two-hand zoom folds its factor into a running `base` in
  zoomView.ts instead of springing back to 1.0, so gestures COMPOUND (measured
  1.273 held flat through release, then 1.273^2 = 1.621 after the next
  gesture). Spring-back stays the default so the ORB_ZOOM_SPEC suites hold
  unchanged (pinned with zoomPersist=false in their beforeEach); the neural
  profile turns it on. Clamps 0.2..12 ("infinite within reason"): camera
  distance = camera.z / factor, 12x from 4600 is ~380 units, outside the
  anchor corona.
- `zoomCommitsDrill: false` in the neural profile - ORB_SELECT_SPEC §6 - a
  commit's recenter + push was the largest unwanted camera translation a
  zoom could cause. Zoom is now a pure dolly here.
- Camera z 2000 -> 4600. The field's outermost node is at r = 1856, so at
  2000 the camera sat AT the shell looking in ("positioned on the brain").
  Fitting r = 1856 in the 52 deg vertical fov needs z >= 4234; 4600 leaves
  ~9% margin. App.tsx now reads NCONF.camera for the Canvas and the far
  plane is 60000 to cover camera.z / zoomMin.
- Pitch clamp relaxed to point.pitchClampFree (1.65) for the neural scene by
  passing the pure core's existing clamp parameter from NeuralScene - the
  globe's PITCH_CLAMP is MAX_ORBIT_LATITUDE + 0.06 (~0.86 rad), which left
  polar clusters unreachable. `NCONF.scene.pitchClamp` / `initialPitch` were
  dead config (never read) before this; still unread, flagged for removal.
- Side effect worth knowing: from outside, nodes project nearer screen
  centre, so PT1's acquisition rate over the detent walk rose from 4/26 to
  12/26 at the unchanged acquireRadius 46.
