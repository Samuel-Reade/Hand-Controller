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

## Visual pass: restrained showpiece, alive via light (2026-09-09)
Brief (user): make it more visually appealing; purpose "both equally"
(presentation AND daily use); feel "alive via light, not motion". Constraints
from the specs, honoured: ruling 7.1 flat solid star-discs and the P0 tier
sizes / TIER_OPA are untouched; the sight has "no reticle animation beyond the
tighten" (ORB_SELECT_SPEC:128); zero per-frame JS over nodes; 9 draw calls.
- Zoom-invariant glow. Glare is an optical effect, not a world-space disc,
  so a star's corona + bloom must not grow to fill the frame as the camera
  closes in. starField.ts fades them by the fraction of frame HEIGHT the
  sprite spans (render.glowFadeStart 0.3 -> glowFadeEnd 1.0); the solid disc
  and pinpoint - the star itself - are untouched. Inert at rest (the anchor
  spans 0.29 at its largest; tests/visual.test.ts pins this), so P0 parity
  and the white-clip gate (0.13%, unchanged) hold.
- Backdrop rides with the camera. The wash/warm planes were fixed in world
  space (z -1200 / -1100), tuned for a camera that never moved; with the
  dolly the camera flew INTO them. They now sit at their rest distance from
  the camera every frame - identical at 1x, a backdrop at every zoom.
  Attribution at 7x before the fix: planes 48 of 61/255 background
  luminance, sprites ~12, trails 0, grain 1.
- Result (real two-hand zoom path, median frame luminance /255): rest 7.0
  -> 6.9, 3x 58.8 -> 19.1, 7x 88.2 -> 16.2; at the gate's own rotation 7x
  reads 9.0 with 68% of the frame dark (< 30/255). verify-neural.mjs asserts
  median <= 25.5 at a real 7x, driven through a DEV seam
  (`window.__neuralDev.setZoom`). Median over a 24x15 grid, not corner
  points: six corner samples read 40.9 on that same black frame because two
  near-camera trails crossed them - a corner metric measures where the
  trails are, not whether the frame is dark.
- One reticle. The brass corner brackets + meridian are the globe's
  rotate-INTO-selection instrument (ORB_BUILD_SPEC §10); with free rotation
  and the sight the neural scene showed two reticles on the anchor. It keeps
  only the sight; `?scene=globe` keeps the brackets. Inferred from
  ORB_SELECT_SPEC's scene scoping, not a literal instruction - one line in
  App.tsx to reverse. scripts/interact.mjs (a globe-era smoke test that
  waits for the bracket flash) now targets ?scene=globe.
- Alive via light: two shader effects, both from a clock uniform, both on
  sliders, neither moves geometry (so the drift-free work and the sight's
  hysteresis are untouched). (a) Glow breathing: corona + bloom alpha x
  (1 + breathAmp x haloOpa x sin), per-node golden-ratio phase; amplitude
  rides haloOpa, so hubs breathe most and terminals barely - which is also
  how the tier hierarchy got stronger WITHOUT changing the P0 sizes.
  (b) Trail energy flow: a soft gaussian band of brightness travelling
  parent -> child along every trail (aFlow = (t, phase) per vertex; period 7s,
  sigma 0.06, gain 0.9), evaluated per fragment; brightens the authored
  colour so red trails stay red. Distinct from the ruling-7.10 hot dots
  (brain -> hub only), which are unchanged.
- Measured restraint: 1.65% of pixels change by > 8/255 over 1.5 s at rest,
  0.010% by > 40/255. Layout hash unchanged (650ce55b). fps 60, 9 draws.
- Not done here, flagged: zoom dollies toward the ORIGIN, not toward the
  pointed cluster, so "zoom into a cluster" at high factors passes through
  the near hub shell (the fat trail bars in the 7x shot are trails passing
  the camera - legitimate, not wash). Zooming into a cluster properly is the
  drill recenter (ORB_SELECT_SPEC PT3), not a visual fix.
- Amendment (same day, user direction): all trail motion now runs INWARD -
  the energy bands and the ruling-7.10 hot dots travel node -> parent ->
  brain, so the field reads as reports feeding the anchor rather than the
  anchor broadcasting. `trail.flowInward` (default true, on the slider)
  steers both; `flowBandPosition()` mirrors the shader term so the direction
  is unit-tested. Ruling 7.10's scope (hot dots brain<->hub only) is unchanged.

## Salience pass: RALLY §5 momentum channel on placeholder data (2026-09-09)
Brief (user, after sharing RALLY.md): "how can we make it look better now" ->
implement (1) momentum-gated motion, (2) disc-hugging sight ring, (3) depth.
- The field's one job is pre-attentive salience (RALLY §5). Uniform ambient
  breathing gave every node the same energy, so nothing stood out - and it
  sat on the channel RALLY LOCKS for momentum ("pulse rate / velocity glow,
  never size"). Replaced: motion is now the MOMENTUM channel. A moving shout
  pulses (halo + bloom lift by momentum x `momentum.glow`, at a rate that
  rises with momentum) and its incoming trail carries the inward energy band
  (gain x momentum, faster with momentum); a still shout is exactly still.
  Disc SIZE never changes - size is the cumulative-rallies channel. The
  ruling-7.10 brain<->hub hot dots are unchanged.
- PLACEHOLDER data: `src/neural/momentum.ts` marks `movingFraction` (0.10) of
  shouts as moving with intensity 0.35..1 from an FNV hash of the node name.
  Deterministic, no draws from the layout RNG (layout hash 650ce55b
  unchanged), the brain never moves. Real values are a data swap: the
  attribute (`iMomentum`, `aFlow.z`) and shader paths are the final ones.
  Slider group "neural momentum (placeholder)".
- `render.breathAmp / breathPeriod` removed (added earlier the same day,
  never committed) - ambient motion on nodes competes with the momentum
  channel and must not exist alongside it.
- Sight ring hugs the STAR: radius = projected disc radius (DISC_FRACTION
  0.3 of the quad) x highlightSwell, i.e. 0.3x the previous glow-footprint
  ring (`ringRadiusPx`, tested). No ring for the anchor fallback - the arms
  taking the anchor's hue is the whole signal; the ~240 px violet circle on
  the brain at rest is gone. ORB_SELECT_SPEC §3 sizes the ring only via
  highlightSwell, so this is within its letter.
- depth.opacityFloor 0.3 -> 0.15: the far hemisphere recedes and the sphere
  reads as a volume. A deliberate departure from P0 parity on the far side;
  on the slider.
- Measured: motion 1.5 s apart at rest - 0.57% of pixels change > 8/255
  (uniform breathing: 1.65%) while 0.025% change > 40/255 (was 0.010%):
  less total motion, more contrast - the salience shape. Gates: white-clip
  0.10%, 7x median 8.9/255, 9 draws, 60 fps, pointing 13/26.
- Still placeholder, still to decide (RALLY): hue = status needs the Rally
  hex tokens (the violet brain and the red accents go with that); size =
  cumulative rallies replaces the P0 tier table when shout data exists.

## Tighter clusters (2026-09-09, user direction)
"Clean up the spacing between the main nodes and subnodes. Random but in
tighter clusters." The generator (graph.ts) is untouched - it stays the
byte-exact port - only the generation defaults change: child angular jitter
0.22/0.28/0.38 -> 0.12/0.14/0.18 rad, radial spray 1.10-1.28 / 1.06-1.18 /
1.04-1.12 -> 1.05-1.16 / 1.03-1.10 / 1.02-1.07 (x parent r). Measured before
choosing (headless, tests/cluster.test.ts helper):
                 clusterRMS  maxReach  child->parent mean (node/sub/term)  disc overlaps p-c / sib
  prototype (P0)   580 wu    1282 wu      275 / 309 / 414 wu                  0 / 3
  chosen           290 wu     603 wu      149 / 145 / 175 wu                  8 / 25   (of 434 / 4829)
  tighter still    211 wu     430 wu      112 / 104 / 120 wu                 30 / 65   - children stack on parents
Half the spread with < 2% disc overlaps; the next step down starts stacking
solid discs. The nine parameters are on a "neural cluster" slider group
(rebuild). The layout hash changes with the tuple, by design; recorded in
PORT_LOG. This is a departure from the P0 ground-truth layout - the P0 table
in PORT_LOG remains the record of the prototype.

## Interaction is the picture: size/glow = cumulative rallies; star cores (2026-09-09)
Brief (user): "Shouts with a lot of interaction should be the easiest to see.
That is the whole idea. The nodes also look a little stale."
- Diagnosis: size and brightness came from the placeholder TIER table - a
  structural hierarchy, not demand. Interaction was not in the picture at
  all beyond the 10% momentum pulse. RALLY §5 (LOCKED): SIZE = cumulative
  rallies. This is the §9 remap of the size channel.
- PLACEHOLDER rallies (`src/neural/rallies.ts`): own demand = u^4 from a
  name hash (long-tailed: median own 0.06, a few near 1), rolled up the tree
  so every parent carries at least the sum of its children - RALLY §3
  ("rallying an echo implicitly rallies its parent; never let an echo's
  count exceed or detach from its parent's total"), generalised to every
  parent-child edge of the placeholder tree. Normalised to the biggest
  shout. Different hash salt from momentum, so the two channels are
  independent by construction and the field contains both "huge and flat"
  and "small and streaking" (tested) - the anti-bias contrast.
- Remap: diam = lerp(13, 104, r^0.35) and [halo, bloom, core] opacity =
  lerp(TIER_OPA.terminal, TIER_OPA.hub, r^0.35). Gamma measured, not
  guessed: normalised rallies are long-tailed (median 0.034, p90 0.165), so
  at 0.45 nearly half the field (47%) fell dimmer than the old sub tier and
  clusters read wispy; 0.35 puts the MEDIAN shout at the old sub level (halo
  0.40, 41 wu) with 31% below it, giants unchanged. Tier is structure only
  (hierarchy, trail radii, the level-1 shell). Trails now end on each
  node's actual disc surface (`buildTrailSpecs(.., diamOf)`); the sight ring
  uses the per-node diameter. The brain keeps anchor.brainDiam.
- Retired: the P0 tier-size parity on the field. The §6 tier-monotonicity
  test now pins the TIER_OPA scale ENDPOINTS; field-level monotonicity in
  rallies is pinned in tests/rallies.test.ts ("the most-rallied shouts are
  the biggest and brightest").
- Star cores: ruling 7.1's flat pastel disc is what read as "stale". The
  disc is now lit like a star - PAL.core (#EAF7FF blue-white, defined since
  P0 and never rendered) at the centre falling to a SATURATED rim - the body
  colour leaned 0.6 toward PAL.mid (#1E6BD6, also unused since P0) - with
  falloff 1.6; heat = coreStrength x (0.35 + 0.65 x rallies), so big shouts
  burn whiter; the pinpoint grows a little with rallies. The rim matters: the
  body colour already renders pale (OETF path), so body -> core alone barely
  registered in the first cut; a white core reads white only against a
  coloured edge. The falloff is the only gradient - no specular, no rim
  light (7.1's reasons for rejecting the glass look still hold).
  coreStrength 0 + coreRim 0 restores 7.1 exactly; all three on sliders.
  Overrides ruling 7.1's "flat solid disc" by user direction.
- Gate: white-clip 0.46% (white cores on the big central shouts; bound
  1.28%), 7x median 10.1/255, 9 draws, 60 fps, pointing 11/26. Layout hash
  unchanged (37015199): sizes are attributes, not layout.
- Still placeholder: hue = status (Rally palette tokens needed). Not done
  (offered): level-1 label collision.

## Rally shape: many main posts, rare echoes, popular vs minor (2026-09-10)
Brief (user): "The main node should be the brightest and have the most
attention. Also add more main nodes. The subnodes won't be that common. Main
posts with not a lot of traction should also be included. There will be a lot
of these. They will be much smaller and dimmer showing the contrast of the
popular posts vs the ones that don't really matter." Read as: main nodes =
shouts on the brain; subnodes = echoes (one level deep, RALLY §2); the brain
stays the anchor; among posts, the popular ones are the brightest.
- Topology (generation defaults only; the generator is untouched): hubCount
  20 -> 160; echoes round(rng(0, 0.7)) -> 29% of posts get exactly one; sub
  and terminal tiers generated zero times. Placeholder tier mapping: hub =
  main post, node = echo. 200 nodes, 199 trails (was 455/454). Layout hash
  d155a987. No bokeh (no terminals) - the bokeh test now asserts
  min(bokehCount, terminals).
- Two-population rallies (rallies.ts). A single power law cannot give "a lot
  of dim ones AND a clear popular minority" - its median-to-top ratio is
  fixed - so own demand is two bands: popularFraction 0.12 of posts draw
  popularMin 0.4..1, the rest draw 0.02..minorMax 0.15 quadratically (most
  at the floor). Roll-up (§3) unchanged. sizeGamma 0.6 (measured: median post
  27 wu / halo 0.30, popular 66-104 wu / 0.58-0.85 - a 3-4x size gap).
- Spokes follow traction. First cut - vertex colours x a LINEAR weight from
  spokeMinWeight 0.25 - was still a dandelion in the shot: the median post
  (t ~ 0.2) kept ~45% of a full spoke, and 160 of those with the P0 brain
  radius (1.8, sized for 20) made the starburst the loudest element.
  Attribution at rest (chrome=0, planes subtracted): trails 29% of field
  light, sprites 71% - the sprites DO carry the light, but 160 thin
  high-contrast lines dominate the pattern in a way mean luminance
  under-weights. Second cut: base = spokeMinWeight 0.06 + 0.94 x t^2
  (median post ~0.10), radius x (0.5 + 0.5 t), radByTier.brain 1.8 -> 1.2;
  and the weight moved from the vertex colours into aFlow.w so the MOMENTUM
  BAND adds at full strength on top of the base - a minor post that starts
  moving still shows its comet-tail on a hairline. White-clip 0.46 -> 0.11%.
- Ruling-7.10 hot dots gated by the post's momentum (RALLY §5: motion is the
  momentum channel). Scope (brain<->post trails only) unchanged; on the 160
  spokes an un-gated dot per spoke would be 160 moving things.
- nameUnit hash: FNV-1a clustered badly for the short near-identical
  placeholder names (4 popular posts instead of ~19); added a murmur3
  avalanche finalizer, and channels are salted by XOR before the finalizer -
  a string-prefix salt left rallies and momentum correlated at rho 0.23; the
  XOR salt brings it under the 0.15 test bound. Re-deals which placeholder
  posts move / are popular; both are placeholder.
- verify-pointing corrected: it asserted every highlight <= acquireRadius,
  but §1 hysteresis HOLDS a node out to releaseRadius, and with 160 posts a
  node acquired at one detent is often still held at the next. The
  steady-state invariant is <= releaseRadius (88); it also reports how many
  samples sat inside 46.
- Gate: 168/168; verify-neural 7/7 (white-clip 0.14%, 7x median 19.7/255 - up
  from 10, more posts near the camera at 7x; bound 25.5); verify-pointing 9/9,
  18/26 ordinary acquisitions (more posts, more targets); 46 targetable.
- The brain: unchanged - still the largest, brightest object (anchor treatment).

## Random brain distance; echoes follow traction (2026-09-10, user direction)
"Make the spacing to the brain to the node random as well - some closer,
some further, within a limit of too close and too far. Add more subnodes to
the bigger nodes: the bigger nodes would create a conversation forum and
there would be a decent amount of subnodes."
- Brain -> post distance: hubRadialMin/Max 0.9-1.1 -> 0.6-1.35 (x R 1100).
  Inner limit 660 wu clears the anchor's corona quad (half-width 605 wu) so a
  popular post never sits IN the brain's glow; outer 1485 wu keeps echoes
  (to 1.2x) inside the camera fit (max node r 1669 < the 1856 the camera was
  set for). Measured spread: posts 663 / 1088 / 1485 wu (min / median /
  max), std 0.22 R. Same RNG draw as before, wider range - RNG order intact.
- Echoes by traction (config.echoesByTraction, default on): a post's echo
  bound is popularEchoMin..Max (3..7, re-drawn per check per the P0 quirk,
  mean ~4.8) when its OWN demand is in the popular band, else nodesPerHub
  (0..0.7, ~29% get one). Own demand, not cumulative: cumulative rolls UP
  from echoes, so echo count cannot depend on it; own demand is a name hash
  that draws nothing from the layout RNG, so positions are untouched and
  with the flag off the generator is byte-identical to P0 (the parity test
  pins the flag off). generationTuple now includes the echo bounds and the
  rallies band parameters, since the layout depends on them.
- Echo room: nodeJitter 0.12 -> 0.16, nodeRadial 1.05-1.16 -> 1.06-1.20.
  Probe at the new topology: 4/97 echoes touched their popular parent's
  disc at the old values, 0/97 here. Mean echo -> post distance 205 wu; the
  cluster test's bound moved 200 -> 240 for that reason (posts are ~300+ wu
  apart).
- Result: 258 nodes = brain + 160 posts + 97 echoes; 13 popular posts carry
  ~62 of the echoes (mean 4.8 each), 147 minor posts ~35 (mean 0.23). Layout
  d29411df. White-clip 0.09%, 7x median 14.3/255, pointing 18/26.

## "More powerful" nodes: the inverted core falloff, blaze, spikes (2026-09-10)
Brief (user, with a 2.6x shot): "the nodes themselves still look a bit stale.
How can we make them look better and more powerful."
- First finding, a bug from the star-core pass: the disc mix used
  pow(r/dr, 1.6) with the comment "higher = tighter core" - the exponent
  was the wrong way up, so the disc stayed MOSTLY core-white to its rim and
  a popular post rendered as a uniformly whitened pastel bubble. Fixing the
  exponent (shipped briefly as coreFalloff 1.7) traded pale for DIM: the disc
  became mostly the darker rim colour - a translucent coloured circle with a
  dot. Neither is "powerful".
- Real cause: the DISC itself. A flat, hard-edged area of one colour whose
  alpha is capped by haloOpa x coreOpa (~0.75) cannot look powerful in
  additive light - nothing in it ever reaches white. Replaced by a LUMINOUS
  BODY: a white-hot gaussian heart (radius coreSize 0.42 dr x (0.6 + 0.4 r),
  alpha to 1.0 on a popular post) falling through the BODY colour to a
  saturated rim, soft-edged - half alpha at dr, gone by discEdge 1.35 dr, no
  outline. The body stack is scaled by depth x tierMult only (vMultBody),
  NOT by haloOpa - that cap was what kept every heart grey. Glow layers keep
  the PORT_LOG C2 multiplier. Size is still the rallies channel (half-alpha
  edge at dr, so the sight ring maths holds). coreFalloff removed;
  `config.bodyAlpha / heartAlpha` mirror the shader (tested). This retires
  ruling 7.1's flat disc entirely, by user direction.
- Blaze (render.blaze 1.0, blazeSpread 0.5): corona + bloom alpha x
  (1 + blaze r^2), glow footprint x (1 + spread r) - rallies-driven, so a
  popular post burns brighter and radiates wider while its DISC (the size
  channel) is unchanged (dr = DR / vCorona, per instance). Minor posts are
  untouched (r^2). The anchor is exempt (uBlaze/uBlazeSpread 0 on its
  material): its dominance treatment is §6's and the rest-view glow-fade
  parity depends on its footprint.
- Spikes on the top band (render.spikeAbove 0.8, spikeScale 0.45): the §6
  diffraction cross, at 45% of the anchor's length, on posts above 0.8
  rallies - the bright-star signature for the shouts that matter. §6 made
  spikes "unique to the anchor ROLE"; this departs by user direction
  ("more powerful"). spikeAbove 1.01 restores anchor-only.
- Gate: white-clip 0.07% (down - the tighter core has less near-white
  area), 7x median 14.3, 9 draws, 60 fps, pointing 18/26. The largest post
  quad is now diamMax x spriteScale x 1.5 = 655 wu; at its nearest rest
  distance it spans 0.22 of the frame, under glowFadeStart 0.3 - still
  fade-inert at rest (tested).

## Strings run into the core; no beads (2026-09-10, user direction)
"There shouldn't be circles at the end of the strings and the string should
go into the core." (from a ~5x shot)
- The circles were the §4.3 junction BEADS - white pin-only sprites at both
  ends of every trail, kept by ruling 7.9 for prototype parity. Default off
  (`trail.beadsEnabled` false, toggle kept). The mesh is still built and
  hidden; removing it outright would drop a draw call - deferred.
- Trails ended half a sprite diameter short of each node (the prototype's
  surface-to-surface rule, built for hard-edged discs). With luminous bodies
  that left a visible gap before the heart. New `trail.endInset` = where a
  trail ends as a fraction of the node's VISIBLE disc radius; default 0 = the
  centre. The 7.10 momentum dots now run into the heart too. `TrailSpec`
  gained `parentName` so the contract is testable node-for-node.
- The P3 machine-gate test "endpoints sit on the node surfaces along the
  chord" pinned the retired rule; it now pins the new one (centres at
  endInset 0; one visible disc radius out at endInset 1).
- Gate: white-clip 0.24% (spokes now reach the anchor's centre), 7x median
  14.0/255, 9 draws, 60 fps, pointing 9/9.

## Click-to-centre: the mouse clicks the node (2026-09-10, user direction)
Brief: "clicking a node should reposition the viewport so that node becomes
the center of view." Preceded by the question "should we just have the mouse
click the nodes?" - answered yes: RALLY.md puts daily work on conventional
input, and ORB_SELECT_SPEC's fixed sight exists for the hand's precision,
not the mouse's. A mouse click was a blind confirm at the sight ("I clicked
X and got Y").
- A `tap` may now carry a position (px from the viewport centre). Mouse and
  touch taps do; hand pinch-taps, Enter and the synthetic harness do not, so
  every existing tap path is byte-identical for them. This is a scoped
  departure from ORB_SELECT_SPEC §1 ("the sight never tracks the hand") and
  the base spec's "no raycasting at items": the SIGHT still never moves;
  the cursor is a second, precise pointing device with its own hit-test.
  Neural scene only; the globe's tap = open focused report is unchanged.
- Hit-test (`hitTestNodes`): the node whose projected disc (plus
  `select.clickSlackPx`) contains the click, most-centred wins on overlap.
  ANY node is clickable - centring is navigation, not a confirm, so the §2
  targetable filter does not apply. Consequence, visible: centring a
  non-targetable post leaves the sight ring on the nearest targetable
  neighbour, because the §2 filter still governs the highlight.
- "Centre" = the drill's existing recenter, generalised: the offset group
  pins a constellation-local point to the camera axis (`centering.ts`), the
  clicked node at level 0, the drilled hub as the drill blends in
  (`pinPoint`). Rotation is untouched and the pinned node becomes the pivot,
  the same way the drilled hub already did. Blend = `select.recenterDuration`
  with the drill's easing; a click mid-flight retargets from where the
  centre is. Rejected: driving yaw/pitch to a target - it would mean
  teaching the frozen integrator a seek and fighting momentum, for the same
  visible result.
- Routing of a positioned tap, level 0: node -> centre on it; the centred
  post again -> drill in (the confirm the sight would give it, so the mouse
  can still reach level 1); the brain -> centre returns to the origin; empty
  space -> nothing. Level 1: a shell report -> opens it (focus set to the
  CLICKED report, then the S9 open); the drilled hub -> drill out, staying
  centred; any other node -> drill out and centre on it.
- Known seam, left as is: the level-0 hub reticle affordance (`resolveReticle`,
  direction-based, ignores the offset) still lights a hub for the hand model
  after a mouse centring, and it is no longer at the sight. It is the hand's
  instrument; retiring it is PT3's.
- Gates: tests/centering.test.ts (hit-test, blend, "every node projects to
  centre after the blend at any rotation, and is the pivot");
  scripts/verify-centering.mjs in the browser: click centres (249 px -> 0),
  empty miss, second click drills, level-1 click recentres, Enter keeps the
  sight model, globe tap opens. 60 fps, no page errors.

### Follow-up (2026-09-10, user direction): all nodes clickable; Escape = home
"All nodes should be able to be clicked. esc button brings back to the
center node."
- Small posts missed because the hit target was the SOLID DISC: 13 wu
  diamMin x spriteScale x DISC_FRACTION / 2 = 8 wu, under 2 px at rest zoom,
  while the glow the user aims at reads 10-20 px. The hit radius is now the
  disc x `select.clickRadiusMult` (2.5, the visible glow) floored at
  `select.clickMinRadiusPx` (14). `hitTestNodes` takes the effective radius;
  the slack constant is gone. Test: every node in the field is hittable at
  its own centre.
- Escape emits a `home` bus event when no report is open (with one open it
  still closes the panel first). The scene answers by flying any drill out
  and returning the centre to the origin on the same blend, so the pin runs
  hub -> origin monotonically. ORB_SELECT_SPEC §4 asked for Escape as
  drill-out; this is that, plus the click-to-centre undo. The physics and
  the globe ignore the event.
- Gates added: smallest on-screen post clicks and centres (hit r 14 px);
  Escape from a centred post and from a drill both put the brain back at
  screen centre at level 0.

### Follow-up (2026-09-10, user direction): orbit radius, pivot, selection marker
"Scale the radius of rotation down to be a good user experience. The new
node clicked should be the center of rotation. There should also be a
crosshair on the node selected."
- Pivot, verified before changing anything: in a live 200 px drag the
  centred node held 0.00 px from screen centre throughout while the brain
  swung 114 px round it (scratch playwright run; now gate `pivot-is-node`).
  The offset is re-derived from the live rotation every frame, so the
  clicked node IS the centre of rotation. Nothing to fix there.
- "Radius of rotation" read as the ORBIT radius - the camera's distance to
  the pivot. From the rest distance (4600 wu) a peripheral post's rotation
  shows the whole field, brain included, sweeping a wide arc round it: a
  large-radius orbit. Centring a node now also brings the camera in by
  `select.centerPush` (2000 wu, slider; the drill's own push pattern), so
  the node's neighbourhood is the subject and dragging reads as orbiting
  it. The push weight (0 at home, 1 on a node) blends on the same clock as
  the position; node -> node keeps the camera in; Escape pulls it back out.
  The drill's `recenterPush` stacks on top (a drill from a centred hub goes
  closer still; from the origin it is byte-identical to before). Rejected:
  scaling the drag gain down with pivot distance - the field would still
  sweep the same arc, only slower.
- Selection marker: a second crosshair drawn ON the selected node - four
  arms standing `select.markGapPx` outside its disc, `select.markArmPx`
  long, its hue lifted toward white (the raw hue vanished against the
  node's own glow). It follows the node through its flight, so the pick
  reads the instant it lands, and sits concentric outside the sight once
  centred. The sight itself is unchanged and still never moves (§1).
  Gate: marker present, landed, at translate(0,0) after the blend; hidden
  after Escape.

### Follow-up (2026-09-10, user direction): the marker lives inside the node
"make the crosshair only exist within the bounds of the node."
- The selection marker is now inscribed: four arms from `select.markGapPx`
  (2) at the node's centre out to its VISIBLE edge - disc radius x
  render.discEdge, where the luminous body ends - and never past it.
  `select.markMinPx` (5) floors the half-size so a minor post (edge ~2 px)
  still shows one; that floor is the one case the marker may exceed the
  body. `markArmPx` is gone - arm length is the node's, not a constant.
- Two crosses at one point read as clutter, so once the marker LANDS at
  the centre (blend done) the sight's four arms yield to it
  (`data-mark-landed` on the overlay root, CSS opacity 0). The sight's
  ring, states and highlight model are untouched, and it never moves; in
  flight both are visible because they are in different places. Escape
  hides the marker and the sight's arms return.
- Gate: marker extent (gap + arm) <= max(markMinPx, node visible radius),
  measured 31.4 px = 31.4 px on the clicked post; sight arms at opacity 0
  under the landed marker.

### Follow-up (2026-09-10, user direction): no red circle; violet hover ring
"sometimes there is a red circle around a selected node. Also make a hover
with the cursor that is the purple circle."
- The red circle was the SIGHT's ring (PT1): it borrows the highlighted
  node's hue - red on a red post - and on every `engage` it enters the
  "confirming" state (2 px border + fill), which a mouse-down also fires.
  With a centred red post under the sight, every click flashed a filled
  red ring round it. Since a positioned tap never confirms at the sight,
  that ring is the hand model's instrument only: in pointer mode
  (`store.inputMode === 'pointer'`) it is not drawn. Hand mode keeps the
  PT1 ring exactly as gated. The sight's arms are unchanged.
- Hover ring: in pointer mode the node under the cursor gets a violet
  circle (`PAL.violet.body`, RALLY §7 - violet is the control colour, never
  data) just outside its visible edge, and the stage cursor becomes
  `pointer`. It uses the SAME hit-test as the click (`cursorHit`: level-1
  shell reports first, then the field by the glow-floored hit radius), so
  what lights up is exactly what a click would take. Hidden while a button
  is down (a drag is not a hover), while a report is open, off the stage,
  and in hand mode. The cursor position is a per-frame runtime
  (`input/cursor.ts`) written by the pointer adapter, never React state.
- Gate: hovering a post lights the violet ring on that post (diameter >=
  its visible diameter) with the pointer cursor; leaving clears both; the
  sight ring stays hidden in pointer mode and does not fill on mouse-down.

### Follow-up (2026-09-10, user direction): closer POV on a selected node
"make the POV distance smaller when tapping into a node. Keep the main node
distance the same."
- `select.centerPush` 2000 -> 3000: a selected post is now viewed from
  1600 wu (2.9x) instead of 2600. Home is untouched - its push weight is 0,
  so the brain stays at the 4600 wu rest distance.
- The drill no longer STACKS its own push on the centre push (that put the
  camera 700 wu from a blown-out hub); the push is now the greater of the
  two. A drill from a selected post keeps the 1600 wu distance; a drill from
  home via Enter/pinch pushes by recenterPush as before. Supersedes the
  "stacks on top" line in the orbit-radius entry above.
- Found at the closer distance and fixed: level-1 shell reports were tested
  FIRST in the click/hover resolver, so a report's glow-scaled hit disc
  swallowed clicks aimed at field posts behind it. Shell and field now
  compete on the same footing - the click goes to whichever it is most
  centred on, a report winning an exact tie as the thing in front.
- Gate: picks stay clear of the chrome overlays (a node under the ORBITS
  list cannot be clicked - that is the overlay, not the field); a hit-test
  dev seam (`__neuralDev.hitAt`) reports what a click would resolve to.

## Empty shell + two-click navigation (2026-09-10, user direction)
"Remove the analytics visualization from the shell interface. Keep the
shell container structure intact so other content can be added later.
Implement two-click navigation: first click focuses/selects the node,
second click enters the shell."
- The shell is the S2 panel (`ReportPanel`, `.report-panel`). Its
  placeholder analytics - the KPI row, the two Recharts charts on
  deterministic data, the footer - are removed. What remains is the
  container: backdrop, dialog with focus trap and Tab loop, header
  (eyebrow + title + ESC · CLOSE), and an empty `.panel-body` with a floor
  height. Rally's post view (RALLY.md: the shout, its echoes, momentum,
  status) lands in `.panel-body`; nothing else needs rewiring. The
  analytics CSS went with the content. `recharts` is now unused
  (dependency left in package.json - removing it is a separate call) and
  so is `data/placeholder.ts`'s reportData.
- The shell can open on ANY node: the store's open state is a `ShellRef` -
  a report (the globe's and the level-1 reticle's identity, unchanged) or
  `{ node, tier }`. Every "suspend input while open" check is a truthiness
  test and is untouched. Header identity: a report keeps orbit + title; a
  node shows its Rally tier (Camp / Shout / Echo) and name until real shout
  data exists.
- Two-click navigation (mouse): click one SELECTS - centre, marker, camera
  in, as built; click two on the selected node ENTERS - the shell opens on
  it: on its report when it carries one (`bindReports`, the §2 binding, so
  bound nodes keep the identity they always opened with), else on the node
  itself. The second click no longer drills into the child shell; the drill
  stays reachable through the sight model (Enter / pinch-tap), and the
  level-1 click routing (shell report opens, anchor drills out, other node
  drills out and centres) is unchanged. Escape closes the shell and keeps
  the selection; a further Escape goes home, as before.
- Gate: second click opens the shell on the selected node at level 0, as
  an empty container (body present with zero children, no chart markup);
  Escape closes it with the selection kept; the drill gates now enter
  through Enter.

### Follow-up (2026-09-10, user direction): marker at half size, in violet
"scale the crosshair down by 50% and make it the same purple as the ring."
- The selection marker's half-size is now `select.markScale` (0.5) x the
  node's visible radius, still floored by markMinPx, still inscribed. Its
  colour is the hover ring's violet (`PAL.violet.body`, the Rally control
  colour) instead of the node's hue lifted toward white - so both control
  marks read as one system. Gate: extent = half the node's visible radius
  (25.5 of 51 px), colour rgb(166, 107, 255).

## Gaze channel E1-E3 (2026-09-10, ORB_EYE_SPEC route A)
Built slices E1-E3 of docs/ORB_EYE_SPEC.md; E4 (calibration) deferred per
its §9/§11. Route A: gaze STEERS the field toward the fixed sight; it never
points and never confirms. Departures and findings, each deliberate:
- **How torque reaches the frozen integrator.** The spec assumed `move`
  alone would do; the integrator applies `move` only while ENGAGED. The
  channel therefore opens its own engagement (`engage`, tagged
  `source:'gaze'`), streams `move`, and closes with `lost` - a freeze, never
  `release` (a throw). If a hand engages meanwhile the hand simply takes
  the engagement; gaze stops emitting and does not `lost` it out from under
  the hand. The sight's "confirming" state ignores gaze-sourced engages.
  No `gazeTorque` FEEL profile was added: the torque is bounded by
  construction (mag x maxDegPerSec x dt) and the integrator has no
  velocity cap to lower while engaged, so the profile had nothing to do.
- **Gate timers run on the UNFILTERED point.** With the timers on the
  filtered point, the One Euro tail after a 250 ms glance kept the point
  outside the dead zone for ~500 ms and a glance attended. The torque still
  uses the filtered point, so the drift is smooth. (Test: glance = 0 moves.)
- **Idle with no face stays idle.** The spec's diagram sends idle -> holding
  on lost face, which loops idle > holding > decaying > idle forever with
  the face absent. Only `attending` holds and decays; a face returning
  within holdMs resumes attending with no `lost` (a blink never stutters).
- **A present face keeps the camera alive.** The no-hand auto-stop (20 s)
  would end every hands-free gaze session; with the channel enabled, a
  detected face counts as presence for that timer. Without the channel,
  hands alone count, as before.
- **Mouse priority is a grace window**, not strict recency: any pointer
  event within `resumeMs` suspends the channel. Strict "more recent than the
  last gaze frame" would suspend for ~one frame only, since gaze frames
  arrive at 30 Hz.
- **detectEveryNFrames defaults to 2.** Every frame dropped 5 % of frames
  to 33 ms in the headless gate (CPU delegate, ~8 ms/call); every 2nd frame
  added nothing measurable over hands-only. The spec's absolute
  "p95 <= 16.7 ms" is unreadable headless - the renderer idles at p95 18.3
  ms with no camera at all - so the gate measures the eye's ADDED cost
  (p95 within 2 ms of hands-only, median a 60 fps frame). The demo
  hardware decides the absolute number (§11.6).
- **"Nothing leaves the device" was not true before this work.**
  @mediapipe/tasks-vision POSTs usage telemetry to odml.pa.googleapis.com
  unconditionally (on a 60 s timer and on close), for the hand model as
  much as the face model. `index.html` now carries a Content-Security-Policy
  `connect-src 'self'` (plus localhost for Vite HMR); the browser refuses
  the request. The gate counts CSP violations to show the block happening
  and fails on any off-origin RESPONSE.
- **Ink token.** The palette has no ink token yet; the indicator, debug
  dot and ring use the HUD's ivory. Violet is used only for the EYE toggle.
- **Escape** while attending suspends the channel for resumeMs (it also
  goes home, as before): one key, every meaning "stop".
- Human gates still open (need a real face): the yaw sign convention
  (flip in one place in `headPose` if reversed - the transform decomposition
  encodes the assumption "a turn to the user's right is R_y(-θ)"), the
  transform-vs-landmark agreement, glasses -> head-only, and the E3 feel of
  the drift (symptom -> slider table in the spec §9).

## Eye tracking: the eyes POINT (2026-09-10, user direction - reverses ORB_EYE route A)
"it tracks my head movement and nods but not my eyes. I want it to track
my eyes and track what nodes my eyes are focused on so that they can be
selected."
- Route A (gaze steers the field) is set aside; the user's product call is
  route B, made as accurate as a webcam allows. The spec's accuracy warning
  stands and was communicated: uncalibrated iris gaze is coarser than the
  node spacing, so the focus is a SOFT CONE with hysteresis and needs
  calibration to be good. `EYE.mode` = 'point' (default) | 'steer' (kept,
  `?eyeMode=steer`).
- Why it read as head-only: route A weighted head pose over iris by design
  (irisGainDeg 12, the blendshape cross-check halving it, head-only
  fallback). Point mode: irisGainDeg 30 (a full deflection reaches the
  screen edge), the cross-check off by default, and the iris is a
  weighted mix of the geometric placement and the model's own eyeLook*
  blendshapes (`irisBlendWeight` 0.5) - on real webcams the blendshapes are
  often the steadier of the two, especially vertically, where the lid gap
  the geometry divides by closes as the eyes look down.
- Calibration (E4, now essential, `EyeCalibration`): five ivory targets
  (centre, four corners at calInset), 1.6 s each, the filtered FEATURES of
  the last second median-pooled, then a ridge-regularised least-squares
  map per axis: x = a0 + a1·headYaw + a2·irisX (y likewise). The fit
  learns this user's head-vs-eye mix AND the sign convention (tested with
  a reversed axis), which retires the "flip yaw in one place" human gate.
  Rejected above calMaxResidualPx; session only; the HUD shows "CAL 38PX"
  or "CAL FAILED"; Escape cancels. The gaze pointer is suspended while the
  targets are up.
- Focus model (`neural/gazeFocus.ts`): every node gets a capture radius =
  max(pointMinRadiusPx 70, visible radius x pointRadiusMult 4) - bigger
  posts are easier targets, as for the mouse; the node the gaze is most
  centred on is the candidate; it must be the best for pointHoldMs (120)
  to take the focus and is dropped only after leaving its release cone
  (pointReleaseFactor 1.6) for as long. Tested: a 30 Hz jitter between two
  nodes never flickers.
- Feedback: the focused node gets the violet ring (dashed, to say "eyes",
  not "mouse"); an ivory gaze dot shows where the system thinks the eyes
  are - the feedback that was missing. The channel publishes the point;
  the scene does the focusing because it owns the projections.
- Confirm: an UNPOSITIONED tap (Enter, pinch-tap) with a focused node acts
  on it exactly as a click would - select (centre, marker, camera in),
  then enter (the shell). The sight model remains the fallback. Dwell is
  opt-in (`pointDwellMs`, 0 = off): "never primary" holds by default.
- Arbitration unchanged: the mouse (resumeMs grace), a hand engage, a tap
  and the shell all suspend the pointer.
- Gate: `eye-point` scenario - the focus lands 2.2 px from the gaze inside a
  70 px cone; Enter selects it; the eyes follow it to the centre and Enter
  again opens the shell on it. Steer gates run with `?eyeMode=steer`.
- Open at the human gate: the real accuracy on your camera, before and
  after calibration (watch the ivory dot; then CALIBRATE), and whether
  pointMinRadiusPx needs to grow for it.

### Follow-up (2026-09-10): "CAL FAILED both times"
- Root cause in the fit: the ridge regulariser was a FIXED λ = 0.5 in
  feature units. Head yaw is in degrees (Σu² in the tens) so it barely
  noticed; the iris is in [-1, 1] and moves a few tenths across five
  targets (Σv² ~ 0.1), so λ crushed the eye gain toward zero, the fit
  degenerated to head-only, and the residual sailed past 120 px. The ridge
  is now RELATIVE to each feature's own energy (0.1 %): a stability guard,
  not shrinkage. (Synthetic recovery: 55.8 px -> 2.5 px.)
- Acceptance: under `calMaxResidualPx`, OR clearly better (< 80 %) than
  the default map on the same samples AND under twice the threshold -
  labelled "CAL nPX (COARSE)". A least-squares fit beats a fixed map on its
  own samples almost by definition, hence the cap.
- The HUD now says WHY: "CAL FAILED · NO FACE 2/5" (face not seen while
  sampling), "· NO SPREAD" (singular), "· 212PX > 120" (residual). DEV: the
  samples and report land in `window.__eyeCal` and a `[eye] calibration`
  console line, for pasting back. `calNinePoints`, `calPointHoldMs`,
  `calSampleWindowMs`, `calInset`, `calMaxResidualPx` are on the leva panel.

### Accuracy pass (2026-09-10, user direction: "whatever makes stare selection more accurate")
Levers pulled, in order of expected gain; each on a slider.
- **Nine targets at 0.65 of the half-extent** (`calNinePoints` true,
  `calInset` 0.65): redundancy for the fit, coverage of where the nodes are.
  ~14 s.
- **Curvature correction, validated.** After the linear fit, a 6-term
  quadratic in the linear prediction's normalised position is fitted to
  its residuals - the asymmetry (an off-centre camera) and the cross-axis
  coupling (perspective) a 3x3 grid can see. Kept only if it beats the
  linear map under leave-one-out by 5 %, and only with >= 8 samples; the
  HUD label gains "·C". An odd, symmetric bend is invisible on three
  levels per axis and is not attempted (5 levels would be a 25-target run).
- **720p camera** (`ideal`, 480p cameras still work): the face model
  resizes its face crop to 256 px; at 480p a face at desk distance is ~200
  px and was UPSAMPLED into the model. Gate: +0 ms on p95, face detect
  8.1 ms.
- **Fixation averaging** (`fixationMs` 250, `fixationRadiusPx` 90): the
  focus uses the mean of the recent points that cluster with the latest,
  not one frame - per-frame jitter of 1-2° divided by ~2.8; a saccade
  stands alone at once. Tested: 30 px jitter -> < 12 px rms.
- **Blink freeze** (`blinkFreeze`): with both eyes shut the features hold;
  a real blink drags the eyeLook* blendshapes and yanked the point.
- **Smoothing** for a stare: `minCutoffHz` 1.2 -> 0.9; `pointHoldMs` 120
  -> 160.
- Not changed: use-time iris jitter is physics (a dozen-pixel iris); the
  floor stays ~1-2°, which is why the cone + hysteresis remain.

### Accuracy pass 2 (2026-09-11, user direction): learning from confirms
- **Every confirm is a verified sample.** When Enter / a pinch-tap / dwell
  acts on a gazed node, the ring was on the node the user wanted: the
  features of that moment map to that node's screen position. The sample
  joins the explicit run's (the base) in an online store
  (`eye/calibration.ts` learnConfirm; `useEyeInput.eyeLearn`), newest 30
  kept, and the map is refitted on every confirm. The map sharpens with use
  and follows a head that leans or shifts - drift the nine rings could
  never see. Without an explicit run, a learned map appears after
  `learnMinSamples` (6) confirms.
- **Fresh confirms outweigh a stale base.** Weighted least squares: the
  base's weight decays from 1 to a floor of 0.2 over the first 12 confirms
  (`baseWeight`). Adoption compares WEIGHTED residuals - with an unweighted
  check the down-weighted base still dominated the average and real
  improvements were refused (found by the head-shift test).
- **Outliers are judged against the confirms' own consensus** (3x their
  median error, never below `learnOutlierPx` 70): a wrong confirm is
  dropped once; a consistent 90 px disagreement with the base is a head
  shift, not noise (the first rule dropped every drift sample).
- **The two iris sources are separate fit features.** x = a0 + a1·headYaw +
  a2·irisGeom + a3·irisBlend. The fit learns which source to trust on
  this camera (glasses: geometry is noise; contacts: the blendshapes may
  be) - tested both ways, the useless gain lands under 10 % of the useful
  one. The default map still blends them by `irisBlendWeight`.
- **The fixation window grows** from `fixationMs` (250) to
  `fixationMaxMs` (500) while the stare holds: ~15 frames in the mean for a
  steady stare, no extra lag on a fresh one; a saccade resets it.
- HUD: "CAL 38PX ·C (13)" - residual, curvature flag, samples in the map.
  DEV: `window.__eyeOnline`, a `[eye] learn` console line per confirm.
- Gate: the point-mode confirm lands as a learned sample.

## Eye accuracy plan, phases 1-5 built (2026-09-13, user direction: "implement those changes")
Built in one uncommitted pass (the user asked for no commits); each idea has
its own test and its own slider so it can still be judged alone. Numbers
are from the replay harness on SYNTHETIC clips (white-noise jitter, 1-1.5°);
the real recordings decide.
- **Phase 1 - measure.** Overlay diagnostics (ink): raw point (hollow dot),
  head-only point (square), per-eye iris and per-eye blendshape bars, iris
  ok rate per eye, detection Hz, freeze / wide-model flags, eyes-vs-head
  distance. A dev recorder (`window.__eyeRecord(10)` / the leva "record 10 s"
  button) saves raw frames to JSON; `eye/replay.ts` runs a recording through
  the pure pipeline and prints rest jitter (raw / filtered, per axis),
  saccade response and settle, truth error, frozen fraction, eye
  contribution. Recordings rebuild synthetic faces from the raw features so
  the whole channel runs unchanged.
- **Phase 2 - signal.** Foreshortening (iris x cos yaw, y cos pitch); eye
  quality weights ((1 - blink) x apparent size) with a vergence drop (the
  eye farther from the blendshapes goes when L/R disagree > 0.3); blink
  edges (iris rejected at 0.3 on the way down, the first reopen frame
  held). The eyeball-centre model is NOT built: it is gated on the
  head-turn recording showing the calibration breaking down.
- **Phase 3 - steadiness.** Median-of-3 before the One Euro on every
  feature; separate cutoffs (head 1.5 Hz, iris 0.7 Hz); the fixation mean
  MOVED INTO THE CHANNEL ahead of a speed-gated freeze (below 60 px/s for
  100 ms -> hold; release above 160 px/s; re-snap once the mean has moved
  > 30 px). Finding: the freeze must watch the fixation mean, not the
  filtered point - on the filtered point it engaged 6 % of the time at
  1.5° jitter; on the mean, 99 %. Finding: a 12 px re-snap tolerance fired
  on noise and undid the freeze; 30 px holds the rest clip at 0.3 px rms
  (from 6.4) with saccade response 0.96 and settle 125 ms. Finding: the
  median costs exactly one frame (33 ms) per saccade, which the truth-error
  metric weights heavily (66 -> 95 px on the saccade clip) but a selector
  with a 160 ms hold will not feel; kept for spike removal (a spike would
  release the freeze). Separate cutoffs and the median are neutral on
  white noise (+0.5 / +1 px); their value is on real landmark data.
- **Phase 4 - the map.** GazeFeatures carries per-eye iris and per-eye
  blendshapes (14 features, 14 filters). A 'wide' model (6 terms per axis)
  is tried at >= 14 samples and kept only if it beats the base under
  leave-one-out by 5 % (tested: one eye noise -> wide wins, residual
  halved). Learned samples decay with age (half-life `learnDecayMin` 3,
  floor 0.3): a session that drifts twice follows the recent drift.
- **Phase 5 - the selector.** Switch margin: a rival must beat the focused
  node's score by 0.8x before the switch clock starts (a near-tie stays).
  Ring confidence: the gaze ring brightens with fixation length and goes
  solid at ~10 agreeing frames.
- Tests 237 (+12). verify-eye 11/11, verify-centering 13/13.
- Still open, needs the user: the four recordings; which symptom
  dominated; the eyeball model decision; retuning cutoffs from real data.

## First real recordings: what the camera actually delivers (2026-09-15)
Four 10 s clips (rest, horizontal, vertical, head turn) in recordings/.
Findings, each with its fix:
- **Detection ran at 10 Hz**, not 30: every clip has frames 100 ms apart.
  Hand and face models run serially on the main thread. Fixes: with the
  eye channel on and no hand in view the hand model runs every 3rd frame
  (`handEveryNWhileEye`); the median pre-filter stands down above
  `medianMaxDtMs` (60 ms) - at 10 Hz it was 300 ms of lag; the fixation
  window's ceiling is 800 ms (8 frames at 10 Hz). The overlay now shows the
  rate, each model's cost and its delegate (GPU/CPU) so the cause is
  visible on the demo machine.
- **This user's OPEN-eye blink value is 0.2-0.25** (real blink 0.7). The
  0.3 rejection floor treated open eyes as half-shut: iris ok rate 69-79 %,
  head-only mode 12-16 % of frames (iris zeroed -> the point jumped), one
  freeze of 2.3 s. Fix: per-eye open-eye baseline (EMA over frames plainly
  open) + `blinkMargin` 0.2, never below the floor. Replay: both eyes ok
  98-100 %, head-only 0 %.
- **The two eyes carry a constant offset** from each other (L - R = +0.24,
  spread 0.03-0.06 across all clips). The raw-value vergence rule saw that
  as disagreement and flip-flopped which eye it kept, so the combined
  iris jumped by ~0.3 - the "shaky". Fix: vergence on a CHANGE in the
  eyes' difference (EMA, 5 s), dropping the eye that moved more since its
  last accepted value. Tested: a constant offset never trips it; a
  one-eye jump drops that eye for exactly its duration.
- **The blendshapes carry about twice the horizontal signal the geometry
  does** on this camera (horizontal clip, both-ok frames: blend sd 0.08-0.09
  vs geometry 0.03-0.05; frame-to-frame noise similar). The separate-source
  fit already weighs that; nothing to change, worth knowing.
- **Head turn drifted the point 406 px** with the eyes on centre (default
  map). The eyes counter-rotate (blend to -0.72 at 9° of yaw); rings at one
  head pose cannot separate head gain from eye gain. Fix: a calibration
  HEAD-TURN stage (`calHeadTurn`, 6 s): the centre ring stays up, the user
  turns their head slowly with their eyes on it, a sample every 250 ms with
  the centre as target. This is the cheap alternative to the eyeball-centre
  model; the model stays gated on the next head-turn clip.
- **Recorder flaw**: a rejected eye's slot carried its blendshape fallback,
  so the first clips replay wrong for per-eye analysis. The recorder now
  stores the pure geometric per-eye offsets (`geom`); the replay keeps a
  rejected eye rejected on old clips.
- Accuracy floor implied by the clips: rest blend noise ~0.05 units against
  ~0.45 units for the screen width = ~150 px per frame, ÷2-3 after the
  fixation mean at 10 Hz - consistent with the 66 px calibration residual
  the user saw. More frames (the rate) and more averaging are the levers;
  the pupil finder remains the one signal-side lever left.

## Eyes only, head still; the saccade drill (2026-09-14, user direction)
- **The product is eyes only, with the head still.** Asked whether a
  nose (head) pointer would be easier, the user said no: "I want a user
  to be able to keep their head still and just use their eyes. We are
  not that far away. It just jitters and usually falls short or overdoes
  it." A head pointer is the more robust signal (~1° of head noise is
  ~40 px against ~150 px per frame from the iris) and it stays as the
  head-only fallback; it is not the interaction.
- **The head-turn calibration stage is off by default** (`calHeadTurn`
  false; the slider stays for a head-moving demo). First live run on the
  user's Mac: overlay 16 Hz, face 15 ms GPU, hand 9 ms GPU, blink
  thresholds 0.45/0.45 (the adaptive baseline works), both eyes ok
  100 %; calibration 33 points (9 rings + 24 head-turn samples) at
  120 px residual against 66 px with rings alone; eyes vs head 450 px
  with the head straight. With the head still the stage adds samples a
  linear head+eye map cannot fit and only widens the residual.
- **16 Hz is by design, not the machine**: `detectEveryNFrames` 2 on a
  30 fps camera. Both models run on the GPU, so every frame is
  affordable; the user tries 1 (expect ~30 Hz: three times the frames in
  the fixation mean). The 10 Hz in the first clips was the same cadence
  on a busier machine.
- **"Falls short or overdoes it" was unmeasured.** The first clips had
  no ground truth and no map: the replay ran the DEFAULT map, so its px
  said nothing about the calibrated pointer. Now every recording carries
  the calibration in force (`EyeRecording.calibration`; the replay runs
  it), and a saccade DRILL (HUD button, leva button, `drillStepMs`
  2000) steps a ring centre, left, right, centre, up, down at calInset
  while recording, the ring as `truth`. The replay prints per-step
  response (`saccadeSteps`: under 1 falls short, over 1 overshoots)
  beside the mean. Tested: a map at half gain reads 0.35-0.65 on every
  step, at 1.5x over 1.3; a clip without a map falls back to the default.
- Replay of the first four clips on the default map, for the record:
  rest filtered 59 px rms (x 49, y 34), frozen 91 %; horizontal 64 px;
  vertical 114 px (x 108); head 110 px. Target under 25 px. The vertical
  clip's HORIZONTAL noise is the first thing to read on the new clips.
- Tests 246 (+2). Playwright gates not run (the user's machine).

## No rotational limits on hand or trackpad drag (2026-09-14, user direction)
Brief (user): "there should be no rotational limits from the hand control or
drag with the trackpad."
- The only bound either channel hit was the pitch clamp the neural scene
  passed into the shared integrator (`point.pitchClampFree`, 1.65 rad,
  ORB_SELECT_SPEC §1). Yaw was already unbounded and the free detent is
  off in the neural profile, so nothing else pulled a released rotation.
- NeuralScene now passes `Infinity` (`NO_PITCH_CLAMP`) to both
  `applyInputEvent` and `stepPhysics`. `clampPitch` is inert at Infinity;
  the pure core is untouched and the globe keeps `PITCH_CLAMP` with its
  frozen tests.
- `point.pitchClampFree` removed from `PointConfig` / `NCONF` (it would be
  dead config). The centering and pointing tests that sampled random
  pitches inside it now sample the full circle (±π); all 246 tests green.
- Known consequence, not addressed: yaw is the inner Euler axis, so past
  ±90° of pitch a horizontal drag spins the field the opposite way on
  screen from the way it does upright. A trackball (quaternion) model
  would fix that; it is a separate decision.
- `NCONF.scene.pitchClamp` (1.1) stays as the dead config it already was;
  still flagged for removal.

## The drill's verdict: the iris filter never opened up (2026-09-14)
The first DRILL clip (15 Hz, 9-ring calibration at 60 px residual, no
head-turn stage), replayed on the user's own map:
- **Per-step response 0.76 0.78 0.68 0.98 0.82 (mean 0.80), settle
  689 ms.** The trajectories show why: the eyes land ~400 ms after the
  ring moves (reaction + saccade) and the RAW mapped point lands with
  them, but the filtered point then creeps for another 600-800 ms.
  Cause: the One Euro's speed term (`beta` 0.015) is scaled for the head
  in degrees/s; the iris and blendshape features are normalised units,
  where a saccade is ~3 units/s, so the term added 0.05 Hz and the iris
  was a fixed 0.7 Hz low-pass (time constant 227 ms, 95 % in ~680 ms).
  The same lag biased the CALIBRATION: its sample window (600-1600 ms
  after a ring appears) saw features still 10-15 % short, which is the
  12 % gain shortfall the raw point showed on both horizontal steps.
- **Fix: `irisBeta`, its own knob (4), the head keeps `beta`.** Sweep on
  the drill + rest + horizontal clips (minCutoff 0.7 / 1.0 / 1.5 x beta
  0.015 ... 8): at 0.7 / 4 the drill's response goes 0.80 -> 0.97 (steps
  1.02 0.91 0.87 1.10 0.94), settle 689 -> 526 ms, truth error 283 -> 262
  px; the rest clip's filtered jitter is unchanged (59.4 -> 59.5 px).
  The remaining ~500 ms is reaction time + the saccade itself. Cutoff
  changes bought nothing on top. The next calibration inherits the fix
  (its window now sees settled features).
- **Vertical drifts with the eyelids.** The centre ring read 245 px apart
  in y six seconds apart (segment 0 vs 3): eyeLookDown blendshape -0.111
  vs -0.048 (x 2839 px/unit = 179 px) with blink 0.29 vs 0.24, plus
  ~34 px of head pitch. The fit leans on blendY (2839) over geometric
  irisY (365) for the vertical, and blendY moves with eye openness. The
  geometric irisY is no better (cross-coupled: 0.207 looking left vs
  0.273 at centre, same height). This is the signal-side problem the
  pupil finder is for; the filter cannot fix it. Horizontal is sound:
  both horizontal steps within 12 % on the raw point, sd 7-30 px at
  fixation.
- **Head term, second order.** With the head still during calibration the
  head columns have no variance and the fit's head gain is arbitrary: x
  -53 px/deg (wrong sign vs the physical +38), y -56. Over the clip the
  head swayed 1.4° / 1.8° (sd 0.27 / 0.37), i.e. 76 / 102 px through
  those gains. Not fixed yet; candidates are tying the head gain to the
  fitted iris gain (a head turn with the eyes on a target is a no-op) or
  dropping the head columns when their variance is small.
- The overlay's cadence: the clip is still at 15 Hz (median 67 ms
  between frames), so `detectEveryNFrames` was still 2.
- `replayRecording` gained an optional per-frame trace tap (used for the
  trajectory analysis). Tests 248 (+1; the 2.4 cutoff test now holds both
  speed terms at 0 so only the cutoffs differ).

## Orbit index removed from the neural scene (2026-09-14, user direction)
Brief (user): screenshot of the ORBITS panel (Growth / Revenue / Operations /
Retention / Quality with latitude and count), "remove these".
- App.tsx mounts `OrbitIndex` only when `!neural`, the same scope guard the
  brass Reticle uses. `?scene=globe` keeps the panel; the component, its
  CSS and the `step` pitch ladder it drives are untouched (the keyboard and
  the drill-in recenter still emit `step`).
- Rationale: the panel is the globe's category ladder. With free rotation,
  no detents and no pitch clamp the neural scene has no latitude grid to
  walk, so the panel named positions that mean nothing in the field.

## Second drill: "it selects too high" is the vertical signal (2026-09-14)
Recalibrated (9 rings, 52 px residual, head x gain now +8.7 px/deg),
then a DRILL, still at 15 Hz. Filtered vertical error per segment:
centre -21, left -50, right +89, centre -61, up -42, down -173 px
(negative = above the target). Five of six read HIGH, the down ring
worst; the same centre ring drifted 40 px between its two visits six
seconds apart. Horizontal: within 40 px everywhere but the left ring.
- **Cause: the vertical map rides on one blendshape.** y = 291 - 67·pitch
  + 230·irisY - 2749·blendY. The geometric irisY does not tell centre
  (0.28-0.30) from down (0.29) on this face - the lid covers the iris
  looking down - so the fit put the vertical on eyeLookDown, whose
  centre reading wandered -0.084 .. -0.102 (50 px) and read -0.144
  looking RIGHT at the same height (150 px low). The head-pitch term
  (-67 px/deg) is the fit using head pitch as a proxy for vertical gaze
  (the pose estimate tilts with the eyes); consistent with calibration,
  so not the drift.
- **Not fixable by the filter or the map.** irisBeta is doing its job
  (fixation sd 2-8 px). The bias is slow drift and cross-coupling in
  the signal: ±60-90 px vertical at any moment on this face.
- **Learning from confirms cannot correct it either**: Enter selects the
  ringed node, so a confirm with the ring on the wrong node teaches the
  map that wrong node. Only a confirm the user placed themselves (mouse
  or hand on the node they meant) is truth.
- Done now: recordings carry the calibration SAMPLES (`calSamples`), and
  the reader test prints, per ring, how it read at calibration vs in the
  clip - the next drill shows where the drift is.
- Options, the user's call: (1) the pupil finder on the raw 720p crop -
  the one signal-side lever; (2) a selector prior that prefers the node
  BELOW the point when two are near (matches five of six segments, but
  is a bandage); (3) layout: keep selectable neighbours >= 150 px apart
  vertically.

## Click learning (2026-09-14, user direction: "Implement click learning")
- **A positioned click on a node is a verified gaze sample.** The user
  looks where they click. Enter can only confirm the RINGED node, so
  when the ring sits one node too high a gaze confirm teaches the map
  that wrong node; a click on the node they meant is the only truth
  that can pull a biased map back. `learnFromClicks` (on; slider),
  separate from `learnFromConfirms`. The scene's click path passes the
  hit node's projected centre to `eyeLearn(..., 'click')`; shell reports
  do not teach.
- **Guard shared by both sources** (`learnAllowed`): the source's flag, a
  face present, and NOT head-only - a head-only moment has the iris
  zeroed and would teach a head-only map. This guard now applies to
  gaze confirms too (it did not before).
- **How fast it learns, from the test**: a map reading 70 px high is
  halved after 6 clicks spread across the field and under 15 px after
  12, because the calibration keeps ~60 % of its weight at 6 confirms
  and 20 % at 12 (`baseWeight`). Learned samples halve in weight every
  3 min, so tracking a drift takes about a click a minute; stop and it
  slides back toward the calibration. It fixes where the map is
  centred, never the moment-to-moment wander (~60 px vertical on this
  user's face).
- Per user, per sitting, and only when they click: a hands-free visitor
  gets the nine-ring calibration and nothing else. The product answer
  for the vertical stays layout spacing / a taller capture cone and,
  if the gate says so, the pupil finder.
- Tests 250 (+2: the guard; the 70 px correction curve).

## FEEL panel behind a gear icon (2026-09-14, user direction)
Brief (user): "Make the FEEL dropdown a little settings icon in the top right
corner."
- FeelPanel renders a 28 px stroked gear (`.feel-gear`, fixed top-right,
  instrument register: outline, no glow) and mounts leva with
  `hidden={!open}`. Closed by default. Leva's `hidden` unmounts only the
  panel DOM; the global store and every `useControls` registration
  (FeelPanel, NeuralScene folders, EyeControls) stay live, so reopening
  shows the current values and slider writes into FEEL / NCONF are
  unaffected while closed.
- The title bar stays (title FEEL, filter on, drag off) and its chevron
  closes the panel: a controlled `collapsed` routes leva's collapse into
  the gear's state, so the chevron and the gear never disagree.
- An explicit `<Leva>` renders its panel inline (a child of `.app`), not in
  leva's `#leva__root` portal, so FeelPanel wraps it in `.feel-leva` as the
  CSS hook. The root is offset to top 50 px to hang under the gear, and
  leva's own folder-list cap (`calc(100vh - 20px - titleBar)`) is reduced
  by the same 40 px so the bottom edge stays where leva put it. Adding a
  second scroll container on the root instead scrolled the title bar out of
  view on open; rejected.
- Leva toggles only on the chevron icon, not the title text.
- `?tune=0` still hides everything, gear included, for scripted shots.

## Scroll to zoom (2026-09-18, user direction)
Brief (user): "a user can scroll to zoom in and out. It should follow regular
scroll mechanics. Scroll up is zoom and scroll down is zoom out."
- **Direction is the browser's**: wheel `deltaY < 0` (scroll up) zooms in,
  `deltaY > 0` out - the sign every map and design tool uses. The OS's
  scroll-direction setting (macOS natural scrolling) applies to the zoom
  exactly as it does to page scrolling; nothing here inverts it.
- **Exponential**: each notch is the same ratio at any zoom (ln(zoom) per px,
  `scrollZoomGain` 0.002: a 100 px mouse notch = x1.22), so scrolling back
  the same amount returns exactly. Firefox's line-mode wheel is converted at
  33 px a line (its 3-line notch = Chrome's 100 px). One event never moves
  the zoom more than x1.5.
- **Trackpad pinch** arrives as a wheel with `ctrlKey` (Chrome, Edge, Firefox)
  and gets its own gain (`pinchZoomGain` 0.01 = 1:1 with the fingers in
  Chrome). The default is always prevented on the stage, so neither the page
  scrolls nor a pinch browser-zooms the app.
- **It glides**: the scroll moves a target (`ZoomView.baseTarget`) and the
  persistent zoom eases to it in log space at `scrollZoomRate` (14/s, ~0.25 s
  to 97 %), so a mouse notch is not a jump; a trackpad's stream stays
  continuous.
- **Same dolly as the two-hand zoom**: it moves the persistent base, so it
  compounds with hand gestures both ways, dollies toward whatever holds the
  centre (the brain, or a clicked node - the pivot), shares the
  `zoomMin`/`zoomMax` range (0.2-12) and never drills. Scrolling past a
  limit banks nothing; the first notch back responds.
- **Toward the centre, not the cursor**: the field rotates about its pinned
  centre and a click is how a node becomes that centre; zoom-to-cursor
  would have to move the pin on every notch. Not built.
- A new bus event, `scrollZoom`, not the hand's `zoom`: the gaze channel
  treats `zoom` as a hand taking the floor and suspends until a release,
  which a wheel never sends. The physics and the gaze arbitration ignore
  `scrollZoom`. Suspended while the shell is open (S2).
- Neural scene only; `?scene=globe` stays zoom-less.

## Lighting pass (2026-09-21, user direction)
Brief (user): "how can we make the nodes look better and more realistic?" -
recommendations made from screenshots (rest, 0.45x, 3x, a hub close-up, a
clicked node, 6x); the user took the lighting step first.
- **What was wrong**: every glow layer is additive and the frame clipped at
  1.0 per channel, so wherever glows overlapped the colour maxed out to flat
  white - the brain was a white smear, hubs at 3x were white stickers, a
  clicked node at 6x a flat cyan disc. The corona was a linear ramp with an
  edge, so it read as a soft disc at any zoom; 47 spokes piled into the
  brain's centre.
- **The pipeline** (src/neural/postfx.ts): the scene renders into a
  half-float target (additive light ACCUMULATES past 1.0), a bloom pass
  spreads only what is hot (threshold 0.9 linear, soft knee, at half the
  frame size), the output pass tone-maps and encodes sRGB, grain rides last
  in the darks only. Nothing converts twice: three makes
  `colorspace_fragment` a no-op inside a render target, so the P0 colours
  come out of the output pass exactly as they came off the screen.
- **Neutral, not AgX**: Neutral (Khronos PBR Neutral) is the identity below
  0.8 and only compresses the hot accumulations toward white - P0 parity for
  everything that is not hot. AgX was built first: it lifts and greys the
  wash (~17% on the blue channel, worked through from its curve) and
  re-renders every colour in the frame; the frame read foggy at rest.
  Exposure 1.0.
- **No MSAA in the target - the trails carry their own hairline.** Without
  multisampling a sub-pixel tube only counted where a pixel centre fell
  inside it: the strings rasterised as dim dotted lines. Measured at retina
  scale (2880x1800, headless Chromium on ANGLE Metal): 4 samples 24 fps, 2
  samples 31, none 48 before the half-size bloom chain and 60 after. So the
  trail vertex shader widens any ring thinner than `trail.minRadiusPx`
  (0.6) to it and divides its light by the same ratio - the coverage MSAA
  averaged, at no fill cost. `render.msaa` stays on a slider (0/2/4).
- **Glare, not corona** (starField.ts): a tight gaussian at the disc edge
  (glareTight 0.35, sigma 0.5 disc radii) plus a long faint Lorentzian
  tail (0.08, half at 1.5 radii), windowed softly at the quad edge - bright
  where the star's light is, fading the way glare does. Bokeh sprites get
  none: defocused light has no glare (the peak at their huge disc edge drew
  a bright rim at 3x).
- **Body fade** (trails.ts): the string still runs to the centre (endInset
  0, ruling kept) but its alpha fades in over `trail.bodyFade` (1.0) x the
  visible disc radius at each end, so it emerges from under the body
  instead of painting a bar across it; at the brain the pile-up was half
  the smear.
- Grain moved to a pass after tone mapping (in the linear target, 3% noise
  on black came out as sparkle) and is masked out of the highlights: grain
  lives in the shadows of a photograph, never on a light source.
- The gate's draw-call number stays the SCENE's: a counting pass records
  the calls right after the render pass (the bloom's own quads excluded).
- Measured: centre white-clip 1.28% (the prototype bound) -> 0.00%; 7x
  median 17.6 -> 12.9/255; rest 6.6/255; 60 fps at 1x and at retina.
- Not this pass (recommendations 3-7, still open): sphere-shaded bodies
  with surface detail up close, filament-shaded lines with a screen-space
  width cap, occlusion, dendrite-style trunk grouping of the spokes, a
  backdrop that scales with the system, distant dust. The ten bokeh
  sprites still read as fog at 3x (blur by distance from the focused node,
  or drop them).

## Node bodies (2026-09-21, user direction)
Brief (user): "do node bodies" - recommendation 3 from the lighting review:
up close every node was a flat disc.
- **What the flat disc actually was: the white PINPOINT.** Its radius is
  DR x (0.22 + 0.16 rallies) - the >= 1 px guarantee for far, tiny posts -
  but it scaled with the disc, so at 6-12x it was a flat white sticker over
  22-38% of every body, immune to any shading underneath. Found by
  elimination: at exposure 0.3 with limb darkening and mottle at maximum
  and the heart off, the disc did not change; the centred node's visible
  radius at 12x is 352 px and the sticker was 140. Now capped at
  `render.pinMaxPx` (3 device px) and faded out as the body resolves (the
  detail span): a resolved disc has no unresolved image. From afar nothing
  changes; hubs at rest trade their hard white dot for the soft white-hot
  heart.
- **Limb darkening** on the WHOLE body layer, heart included: a
  self-luminous sphere is brightest face-on and dims toward its edge,
  I = I0 (1 - u (1 - mu)), the Sun's u ~ 0.6 - squared, because the tone
  mapper flattens anything above 0.8. Applied to the body colour alone it
  hid under the heart of every popular post.
- **Surface mottle**: three octaves of value noise sampled ON the sphere
  (X, Y, mu), so it wraps and foreshortens at the limb; brightness only -
  the hue is status (RALLY §5); fades in from `detailStart` to `detailEnd`
  of the frame height the sprite spans (discs ~13-40 px), so from afar a
  node is still a pinpoint and nothing aliases. `surfaceDrift` turns the
  sphere (rad/s) and defaults to 0: the momentum channel owns motion on a
  node; the slider is there for the demo. `surfaceScale` 6 cells across
  the disc (3 read as one gradient on a 700 px disc).
- Bokeh sprites get neither: defocused light has no limb and no surface.
- **Glare is annular again.** The lighting pass's glare used
  max(0, r - dr), which is zero across the whole disc interior, so the
  tight peak painted every body with light (the corona it replaced started
  at 1.2 dr). Masked to rise through the disc's soft edge.
- Cost: 60 fps at rest, 6x and 12x, at 1x and retina scale, shading on or
  off (a capture's HUD reads 19-21 during the screenshot stall; that is
  not the frame rate). Gate 7/7 unchanged: white-clip 0.00%, 7x median
  12.9/255.
- Still open from the review: filament-shaded lines with a width cap (4),
  occlusion - the strings still cross the bodies (6), trunk grouping (5),
  the backdrop and dust (7), the bokeh fog at 3x.

## Line shading (2026-09-21, user direction)
Brief (user): "do line shading" - recommendation 4 from the lighting review:
up close the strings were flat ribbons (at 12x a two-tone band ~90 px
wide, the core tube plus the glow tube, each flat across).
- **Filament profile** (trails.ts, fragment): across a tube wide enough
  to show it, the light follows the chord through the cylinder,
  sqrt(1 - (d/R)^2) with d the fragment's distance from the centreline
  (from the interpolated view-space position and axis, so it is exact for
  the five-facet tube) - bright down the middle, soft at the edges. Raised
  to `filamentPow` (1.5) for a tighter core, x `filamentGain` (1.5) so the
  profile keeps the ribbon's light (pi/4 of it at pow 1). Fades in from
  `filamentFromPx` (2 px on-screen radius) to 3x that: under it the band
  is a pixel or two, the profile stays off and the rest view is untouched.
- **Width cap** (vertex): a ring wider than `maxRadiusPx` (6 device px,
  core; x glowRadiusMult for the glow pass) is narrowed to it, the reverse
  of the hairline's floor - a string is a filament at 12x, never a
  highway. Not energy-conserving on purpose (a 30 px tube narrowed to 6
  would burn white at 5x); the cap is floored at minRadiusPx so the two
  never fight.
- Leva 'neural line': minRadiusPx, maxRadiusPx, filamentPow/Gain/FromPx.
- Gate 7/7: 7x median 12.9 -> 12.5/255, white-clip 0.00%, 60 fps.
- Still open from the review: occlusion - the strings still cross the
  bodies (6), trunk grouping (5), the backdrop and dust (7), the bokeh
  fog at 3x.

## Scoped occlusion (2026-09-21, user direction)
Brief (user): "do scoped occlusion" - recommendation 6, scoped after the
user asked whether occlusion would hide nodes at thousands of shouts.
- **The scope**: node bodies hide the LINES behind them and the brain
  hides the nodes and lines behind it; bodies never hide bodies. At
  thousands of nodes no shout is lost to the one in front of it (and the
  field rotates), while the visible fake - a filament running across a
  globe - is gone. The full version is the same mechanism with the nodes'
  twin drawn before the stars; not built.
- **Mechanism** (starField.ts `createDepthTwin`): a depth twin of each
  star mesh - the same geometry and the SAME uniform objects, so one sync
  serves both and the anchor's settings carry over - draws nothing but
  depth for the solid disc (x < `occludeEdge`, 0.85, inside the body's
  opaque plateau, so the cut it makes in what is behind is never seen).
  Glow, bokeh (defocused light) and junction beads hide nothing. Draw
  order, all additive so it changes nothing else: brain twin (-3), stars
  testing depth (-2), nodes' twin (-1), lines / beads / pulses testing
  depth (0..3), brain (10). The drilled level gets a twin for its report
  nodes (3) ahead of its lines (4); the reports themselves never test.
- Everything the twins occlude is a soft-edged tube or sprite cut inside
  an opaque disc: no seam to hide. Flat billboard depth, not a sphere's:
  the body fade already hides the last disc radius of every line, where
  the difference would show.
- `render.occlusion` (true) turns it all off per frame - nothing writes,
  nothing tests, the all-additive scene as it was. Draw calls 7 -> 9 (the
  two twins), the §8 gate's bound exactly.
- Gate 7/7: 60 fps, white-clip 0.00%, 7x median 12.5/255.
- Still open from the review: trunk grouping (5) - at thousands of nodes
  the spokes, not occlusion, are what fills the centre; the backdrop and
  dust (7); the bokeh fog at 3x.
