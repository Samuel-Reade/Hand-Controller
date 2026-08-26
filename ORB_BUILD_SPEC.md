# Build spec: gesture-navigated orb shell for analytics dashboards
### v2 — written for Claude Fable 5 running in Claude Code

Read this whole document before writing any code. It contains the geometry, the physics, the
gesture pipeline, and a set of design decisions that are already made.

## 0. How to work on this

You can build this entire codebase in one run. That is not the constraint. The constraint is
that roughly half of this product's quality lives in two things you cannot perceive: how the
rotation *feels* under a human hand, and whether tracking is stable on a real webcam. The
workflow below is designed around that split.

**Two kinds of gates.**
- **Machine gates** you clear yourself: unit tests pass, typecheck and lint clean, the dev
  server runs, and you have looked at a screenshot of the result (run the dev server and
  capture it with Playwright). Do not ask the human to verify anything a test or screenshot
  can verify.
- **Human gates** are where you stop, summarize, and hand over: they are marked in §12. They
  exist because feel constants and real-camera behaviour can only be judged by a person
  sitting in front of the app. Do not blow through them, and never report a human gate as
  passed.

**Deviation policy.** Decisions marked **LOCKED** in §2 are settled — implement them as
written even if you disagree, and put the objection in your handoff summary. Everything else
is yours to improve. Keep a `DECISIONS.md` at the repo root: one line per choice you made that
this spec didn't dictate (library picked, structure changed, spec bug fixed). If you find an
actual error in this spec — a sign flipped, an API misremembered — fix it, and log it there.

**Verification is part of the build, not an afterthought.** §5 and §9 list required tests.
The gesture pipeline in particular must be proven against the synthetic hand harness (§9b)
*before* any camera code is wired up, because you have no camera: the harness is how you test
what you cannot see.

**Handoff format at each human gate:** what was built, how you verified it (test names,
screenshots), what to try by hand and what it should feel like, open questions, and anything
from `DECISIONS.md` worth flagging.

---

## 1. What this is

A navigation shell for a set of analytics dashboards, shaped as a rotating 3D orb.

- Reports are arranged as points on a sphere, grouped into **orbits** — latitude bands, one per category.
- The user rotates the orb. Whatever rotates into the **focus point** (front-and-centre) is selected.
- Rotating horizontally moves through reports within an orbit; rotating vertically moves between orbits.
- Selecting a report opens a flat 2D dashboard panel over the orb.
- Rotation is driven by **hand motion tracked through the webcam**, with mouse/keyboard as a
  first-class equivalent (not a fallback — see §7).

The thesis: a sphere has no home position and no end stop, which makes it a natural fit for a
gesture that also has no home position. That is the whole reason this shape works.

---

## 2. Decisions already made

Each of these exists to solve a specific failure mode. The reasons tell you what to protect
when you hit implementation trade-offs.

**LOCKED — Rotation is selection. No pointing, no cursor, no raycasting at items.**
Free-air ray-casting carries roughly 1° of jitter, and on a sphere the targets get angularly
smaller and more foreshortened away from centre. That combination is unusable. There is a
fixed focus point; the item nearest it is selected; the "click" gesture carries zero
positional information. No hover states driven by hand position. No floating hand cursor.

**LOCKED — Detents on both axes.** When rotation decays below a threshold, a spring pulls to
the nearest item (yaw) and nearest orbit (pitch). Without this the orb rests *between* items
and nothing is ever definitively selected. The detent converts a sloppy analog gesture into a
discrete choice.

**LOCKED — The orb body is opaque.** A wireframe sphere reads as a flat tangle in projection.
A solid body shaded by a directional light gives real depth, and the depth buffer occludes the
far hemisphere for free.

**LOCKED — Vertical movement snaps between orbits; it does not fling.** With ~5 orbits,
momentum on the pitch axis is useless. Pitch gets a strong spring to the nearest orbit
latitude. Yaw gets full inertia and coast.

**LOCKED — The dashboard layer is plain DOM, driven by mouse and keyboard.** Air gestures are
bad at hovering data points, dragging date ranges, and reading dense tables. The orb is the
shell; the dashboard is the workspace. While a dashboard is open, hand input to the orb is
suspended entirely.

**LOCKED — A persistent flat index of orbit names is always visible.** Half the orb faces
away from the user at all times. This is the compensation. Clicking an entry animates to that
orbit.

**LOCKED — Every feel constant lives in one config object wired to live sliders.** Flick
threshold, friction, detent strength, filter cutoffs, pinch thresholds. These get tuned by a
person in front of the running app; anything that changes how the thing feels goes in the
config, never inline in a component.

---

## 3. Stack

- **Vite + React + TypeScript**
- **three.js** + **@react-three/fiber** — resolve and pin compatible current versions
  (R3F v9 pairs with React 19); check the installed versions' APIs rather than assuming
- **@react-three/drei** — helpers only; not `<Html>` per label (§6)
- **zustand** — app state (focus, open report, input mode)
- **leva** — live tuning panel
- **@mediapipe/tasks-vision** — hand tracking
- **vitest** — unit tests for geometry, filter, physics, gesture machine
- **playwright** — dev-server screenshots for your own visual verification

Charts: Recharts, placeholder data. Do not hand-roll SVG charts.

---

## 4. Repo structure

```
DECISIONS.md
src/
  config/
    feel.ts           # the tunable constants — single source of truth
    tokens.ts         # design tokens (§10)
  data/
    orbits.ts         # orbit + report definitions
  orb/
    Orb.tsx           # <Canvas> contents: body, graticule, item meshes
    useOrbPhysics.ts  # rotation model — refs only, no React state
    geometry.ts       # pure math: placement, focus weight  (unit tested)
    LabelLayer.tsx    # DOM overlay, projects world coords each frame
    Reticle.tsx       # fixed focus bracket
  input/
    InputBus.ts       # one interface; pointer, hand, keyboard, harness all feed it
    usePointerInput.ts
    useHandInput.ts   # MediaPipe pipeline (camera only — logic lives below)
    landmarks.ts      # pure: mirror, scale-normalize, pinch ratio  (unit tested)
    OneEuroFilter.ts  # (unit tested)
    gestureMachine.ts # pure state machine, frames in / InputEvents out  (unit tested)
  dev/
    syntheticHand.ts  # scripted 21-landmark streams (§9b)
  ui/
    OrbitIndex.tsx  Telemetry.tsx  ReportPanel.tsx  CameraConsent.tsx
  store.ts
  App.tsx
tests/
```

The split that matters: `gestureMachine.ts` and `landmarks.ts` are pure functions with no
MediaPipe imports, so the entire gesture pipeline is testable with synthetic frames.
`useHandInput.ts` is a thin shell that owns the camera and calls them.

---

## 5. Geometry — implement exactly this

Two nested groups. Inner carries yaw (spin about local Y), outer carries pitch (tilt about
world X). This is a globe: polar axis spins, whole globe tilts.

```
<group ref={tilt} rotation-x={pitch}>
  <group ref={spin} rotation-y={yaw}>
    ...body, graticule, item meshes...
  </group>
</group>
```

Sphere radius `R = 2.45`. Camera: perspective, fov 40, position `[0, 0, 8.2]` (9.6 below
820px viewport width).

**Item placement.** Orbit at latitude φ, item at longitude θ, θ = 0 pointing at +Z (toward
camera), items evenly spaced `θ_i = i · 2π / itemCount`:

```
r = R · cos(φ)
position = ( r · sin(θ), R · sin(φ), r · cos(θ) )
```

**Consequences — use these, derive nothing:**
- Effective longitude after yaw is `θ + yaw`; an item is at focus when `θ + yaw ≡ 0 (mod 2π)`.
- Yaw detents sit at multiples of `step = 2π / itemCount` of the active orbit.
- Pitch bringing orbit φ to focus is exactly `pitch = φ`.
- **Focus weight** of an item at world position `p`: `w = p.z / |p|`. 1 = dead centre,
  0 = silhouette edge, < 0 = far side. This one scalar drives selection, label opacity, item scale.

**Sign conventions** (wrong signs feel inverted and are miserable to debug later):
- move right → `yaw += dx · gain` · move down → `pitch += dy · gain`
- clamp pitch to `±(maxOrbitLatitude + 0.06)` rad.

**Required tests (`geometry.test.ts`):**
- item (φ, θ) with `yaw = −θ, pitch = φ` lands within ε of world `(0, 0, R)` and has `w > 0.999`
- w is symmetric in ±θ offsets from focus; w < 0 for the antipodal item
- with several orbits populated, argmax-w agrees with the analytically nearest item for 100
  random (yaw, pitch) states

---

## 6. Rendering

**Body.** `SphereGeometry(R·0.985, 64, 48)`, `MeshPhongMaterial`, dark, low shininess; one
off-axis directional light plus dim ambient. The undersize lets the graticule sit proud
without z-fighting.

**Graticule.** One latitude `LineLoop` per orbit — active orbit noticeably brighter — plus
~8 dim meridians for form.

**Items.** Small spheres. Per frame, from `w`:
- `visible = max(0, (w − 0.10) / 0.90)`
- opacity `= 0.15 + 0.85 · visible^falloff`
- scale `= 1 + itemGrow · visible^6` (steep, so only the focused item swells)

**Labels — DOM, not 3D text.** One absolutely-positioned `<div>` per item in a single
overlay, positioned each frame by projecting world coordinates to screen. Not drei `<Html>`
per item, not troika text: CSS-styled DOM keeps text crisp and is the same
canvas-underneath / DOM-on-top seam the dashboard uses. Cull labels below 0.02 computed
opacity with `display:none`.

**Performance discipline — the one that bites in R3F.** Physics and label positions update at
60fps and must never touch React state. Yaw, pitch, velocities, and per-item DOM refs live in
`useRef`, mutated inside a single `useFrame`, writing `element.style` directly. zustand gets
only low-frequency events: focus changed, panel opened, input mode changed. If you find
yourself calling `setState` inside `useFrame`, stop and restructure. Add a dev-only fps meter;
sustained 60 on an empty scene plus ~40 items is the budget.

---

## 7. The input bus — build this first

Pointer, keyboard, hand, and the synthetic harness all feed one interface; the physics
consumes it and knows nothing about any of them. This is what lets the mouse tune the physics
once, for every input method.

```ts
type InputEvent =
  | { type: 'engage' }
  | { type: 'move'; dYaw: number; dPitch: number }    // radians, already gained
  | { type: 'release'; vYaw: number; vPitch: number } // rad/s, hands off to the coast
  | { type: 'tap' }                                   // open the focused report
  | { type: 'step'; axis: 'yaw' | 'pitch'; dir: -1 | 1 }
  | { type: 'lost' };                                 // tracking dropped: freeze, decay
```

- `engage` zeroes velocity, cancels forced detent targets
- `move` applies directly while engaged
- `release` hands trailing velocity to the inertia model
- `step` sets a forced detent target one item/orbit away, with a stronger spring — arrows and
  the orbit index use this
- `lost` behaves like `release` with zero velocity

Pointer: down → `engage`; move → `move` + running velocity; up → `release`, or `tap` if total
travel < ~6px. Keyboard: arrows → `step`, Enter → `tap`, Escape closes the panel. Full
keyboard operation is a requirement — it is how the app works with the camera off.

---

## 8. Physics

```ts
export const FEEL = {
  dragGain:    0.0060,  // px -> radians (pointer)
  handGain:    2.60,    // normalized hand units -> radians (§9)
  friction:    2.60,    // exponential decay; higher = shorter coast
  detentPull:  9.00,    // spring toward nearest item / orbit
  detentBelow: 2.20,    // detent engages under this speed (rad/s)
  forcedBoost: 2.20,    // spring multiplier for step() / index clicks
  falloff:     2.20,    // label + item fade exponent
  itemGrow:    2.40,    // focus swell
  // hand pipeline
  minCutoff:   1.00,    // One Euro
  beta:        0.03,
  deadZone:    0.004,   // normalized units/frame below which motion is ignored
  pinchClose:  0.28,    // ratio to engage
  pinchOpen:   0.38,    // ratio to release — must exceed pinchClose (hysteresis)
  tapMaxMs:    250,
  tapMaxTravel:0.02     // normalized units
};
```

These came from a working prototype; they are a starting point, not gospel. Every one gets a
leva slider.

Per frame, when not engaged:

```
yaw += yawVel·dt;  pitch += pitchVel·dt
k = exp(−friction·dt);  yawVel·=k;  pitchVel·=k

activeOrbit = orbit with latitude nearest current pitch
if (forcedPitch ≠ null or |pitchVel| < detentBelow)
    pitchVel += (targetPitch − pitch) · pull · dt
step = 2π / activeOrbit.itemCount
targetYaw = forcedYaw ?? round(yaw/step)·step
if (forcedYaw ≠ null or |yawVel| < detentBelow)
    yawVel += (targetYaw − yaw) · pull · dt

clamp pitch; write to the two group refs
```

Clamp `dt` to 0.05s so a background tab doesn't fling the orb on return. Snap and clear a
forced target within ~0.008 rad at near-zero velocity.

**Required tests (`physics.test.ts`)** — run the step function headless at fixed dt:
- from any of 200 random (yaw, pitch, small velocity) states, the system reaches a detent
  (item + orbit) within 3 simulated seconds and stays there
- a release at flick velocity travels ≥ 1 item before settling; a release at near-zero
  velocity settles onto the *nearest* item, never the next one
- pitch never exceeds the clamp for any input sequence

---

## 9. Hand tracking

**Pipeline.** `getUserMedia` 640×480 @ 30fps into a hidden `<video>`. `FilesetResolver
.forVisionTasks(...)` → `HandLandmarker.createFromOptions({ numHands: 1, runningMode:
'VIDEO', delegate: 'GPU' })` with `hand_landmarker.task`. Call `detectForVideo(video,
timestampMs)` from `requestVideoFrameCallback` (fallback ~30Hz interval). **Detection runs at
camera rate; rendering runs at 60fps; never couple them.**

**Landmark.** Use landmark 9 (middle-finger MCP — the knuckle) as hand position, not a
fingertip; fingertips are the noisiest points and move independently of the hand.

**Mirror x.** The user-facing feed is mirrored relative to the user; without the flip, moving
right rotates left.

**Scale-normalize.** Landmarks are 0–1 image coordinates, so a closer hand produces larger
deltas for the same real motion. `handScale = |landmark[0] − landmark[9]|` (wrist→knuckle);
divide positional deltas and pinch distance by it, or gains and thresholds drift as the user
leans.

**Filter.** One Euro on x, y of landmark 9 and on pinch distance. Not a moving average — that
adds lag exactly where it hurts (flicks); One Euro smooths hard when still and lightly when
fast. Implement properly (`minCutoff`, `beta`, dCutoff ≈ 1.0); both parameters on sliders.

**Gesture machine** (pure function: `(frame, state) → { state, events[] }`):

```
IDLE
  hand present ∧ pinchRatio < pinchClose for 2 consecutive frames
      → ENGAGED   (emit engage; start timer; zero travel)
ENGAGED
  each frame: delta = (filtered pos − last) / handScale
              |delta| > deadZone → emit move(delta · handGain); accumulate travel
  pinchRatio > pinchOpen for 2 frames:
      elapsed < tapMaxMs ∧ travel < tapMaxTravel → emit tap
      else → emit release(trailing velocity over last ~3 frames)
      → IDLE
  hand missing > 6 frames → emit lost → IDLE
IDLE
  hand missing > 20s → stop camera, show re-enable affordance
```

`pinchRatio = |landmark[4] − landmark[8]| / handScale` (thumb tip to index tip). The
hysteresis gap between `pinchClose` and `pinchOpen` is what stops flicker at the threshold —
never collapse it to one value.

**Tap vs drag is the entire click model.** Quick pinch-release without movement opens the
focused report; a pinch that moves rotates the orb. Same as a mouse; nothing else to learn.

**Fatigue.** Tune `handGain` so ~15cm of lateral travel spins a full orbit — the user works
with a hand resting near their body, not held at shoulder height. If users seem to reach,
raise the gain, don't ask for bigger motions.

**Feedback is mandatory.** The user cannot see what the tracker sees. Always show: hand
detected, pinch engaged, tracking quality — plus a small live camera thumbnail with the 21
landmarks drawn over it. Without it, every tracking failure reads as the app being broken.

### 9b. Synthetic hand harness — how you test what you can't see

You have no webcam. `dev/syntheticHand.ts` generates scripted 21-landmark frame streams at
30Hz, and it is the *required* proof for the gesture layer. Scenarios to implement:

1. **still** — hand held at a fixed point with Gaussian noise (σ ≈ 0.003 normalized) on every
   landmark, 5s
2. **flick** — lateral sweep, ~0.25 normalized units over 180ms, pinched throughout, then release
3. **slowDrag** — pinched, 0.15 units over 2s, release at low velocity
4. **tap** — pinch close → open within 180ms, < 0.01 travel
5. **pinchJitter** — pinch distance oscillating tightly around the threshold for 3s
6. **dropout** — mid-drag, hand vanishes for 20 frames
7. **approach** — same lateral motion performed at handScale 0.06 and 0.12 (near/far)

**Required tests (`gesture.test.ts`)** — feed scenarios through filter + machine, assert on
the emitted events:
- *still*: zero `move` events after the filter (dead zone holds); no spurious engage
- *flick*: exactly one engage → moves → one `release` with velocity above the coast threshold
- *tap*: exactly one `tap`, zero `move` events beyond dead-zone noise
- *pinchJitter*: at most one engage/release pair (hysteresis holds)
- *dropout*: exactly one `lost`, no `release` with garbage velocity
- *approach*: total emitted rotation for near vs far runs matches within 10% (scale
  normalization holds)

Also wire `?input=synthetic&scenario=flick` as a dev mode driving the live app from the
harness, so you can screenshot end-to-end behaviour — orb coasting after a synthetic flick —
without a camera. Camera code is not connected until every harness test passes.

---

## 10. Design tokens

```
--void:      #0B1020   page ground (radial gradient to #070A15 at edges)
--deep:      #121A31   orb body, panel surfaces
--graticule: #2A3A5C   ring lines, hairline borders
--ivory:     #EAE6DA   primary text
--brass:     #C9A227   focus, reticle, active orbit — the one accent
--ice:       #7FB2D9   secondary state, positive deltas, focus rings
```

Type: monospace stack for all instrument chrome — labels, telemetry, ticks, buttons —
uppercase, wide tracking (0.1–0.22em), 10–11px micro-labels. System sans for prose inside the
dashboard panel only. Register: *navigational instrument* — orrery, star chart, plotting
table. Not sci-fi HUD: no glow, no scanlines, no neon.

The reticle is the signature element: four thin brass corner brackets at screen centre plus a
faint horizontal meridian across the viewport. It never moves; it is the physical statement of
"things rotate into selection." Everything else stays quiet.

Telemetry (lat, lon, angular velocity, lock state) stays visible in dev, toggleable in prod.

When you screenshot a slice, critique it against this register before moving on: if it reads
as generic sci-fi HUD or a template dashboard, adjust before the gate, and note what you
changed.

---

## 11. Fallbacks and states — build them, don't stub them

- **No camera / denied / no `getUserMedia`:** fully usable by mouse + keyboard; a quiet
  non-blocking affordance offers hand control. Never a modal wall.
- **Permission prompt:** never on page load. The orb works immediately; the user opts into
  hand control with a click, with one line explaining what the camera is for and that frames
  never leave the device.
- **Tracking lost mid-gesture:** freeze, decay to the nearest detent, indicate it. Never fling.
- **`prefers-reduced-motion`:** drop panel transitions, shorten the coast substantially, keep
  direct manipulation — inertia *is* the product, don't disable it outright.
- **Focus management:** opening a report moves focus into the panel; closing returns it to the
  orb. Visible focus rings everywhere. The orbit index is a real `<button>` list.

---

## 12. Build order and gates

**Slice A — Orb + physics + pointer.** Scene, body, graticule, items from `orbits.ts`, label
layer, reticle, orbit index, input bus, physics, pointer + keyboard, telemetry, leva.
*Machine gate:* geometry + physics tests green; typecheck/lint clean; screenshots at three
(yaw, pitch) states show correct placement, falloff, and active-orbit highlight; fps meter
holds 60.
*Human gate:* feel. Hand over with: what a flick should do (coast, land cleanly on an item),
what slow release should do (nearest item, no overshoot), which sliders to reach for first.
**Stop here.** The human tunes `FEEL` before anything is built on top of it.

**Slice B — Report panel.** zustand, DOM panel over the canvas, Recharts placeholders, orb
input suspended while open, Escape, focus management.
*Machine gate:* screenshot of open panel; keyboard-only walkthrough works; tests still green.
No human gate — fold into the next handoff.

**Slice C — Gesture pipeline against the harness.** `landmarks.ts`, `OneEuroFilter.ts`,
`gestureMachine.ts`, `syntheticHand.ts`, all §9b tests, the `?input=synthetic` dev mode, and
a screenshot of the orb mid-coast driven by the synthetic flick. **No camera code yet.**
*Machine gate:* every harness test green. This slice is complete without a webcam ever
existing.

**Slice D — Live camera + polish.** `useHandInput.ts` (the thin camera shell), consent flow,
landmark thumbnail overlay, fallback states, reduced-motion, responsive (hand tracking off
below ~820px, pointer only), build + lint clean.
*Human gate:* real-hand feel and tracking stability — jitter at rest, flick quality, tap
reliability, whether the pinch thresholds fit an actual hand. Hand over with a tuning guide:
symptom → slider (e.g. "drifts at rest → raise deadZone or minCutoff"; "flicks die early →
lower friction"; "engages when I talk with my hands → tighten pinchClose").

---

## 13. Do not

- Do not raycast hand position at the orb or add a floating hand cursor.
- Do not add gestures beyond pinch-drag and pinch-tap.
- Do not put physics values in React state or re-render on rotation.
- Do not render labels as 3D text or one drei `<Html>` per item.
- Do not use `localStorage` or any persistence — local prototype, in-memory only.
- Do not gate the app behind camera permission.
- Do not scatter feel constants through components.
- Do not weaken or delete a failing harness test to get a gate green — a failing gesture test
  means the pipeline is wrong, and it is the only camera you have.
- Do not report a human gate as passed, and do not begin Slice B before the Slice A human
  gate has actually happened.

---

## 14. Defaults chosen — flag these in your handoff

Five orbits at latitudes +46°, +23°, 0°, −23°, −46°, 6–8 placeholder reports each. Latitude
bands crowd near the poles, so ~5 orbits is the practical ceiling; if the real product needs a
dozen categories, this shape fights back and the arrangement needs rethinking — say so in the
handoff rather than silently packing more in.
