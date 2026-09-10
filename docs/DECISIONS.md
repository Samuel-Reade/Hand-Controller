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
