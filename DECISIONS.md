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
