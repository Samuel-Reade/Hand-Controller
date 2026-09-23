# Brief: write `docs/ORB_EYE_SPEC.md` — webcam eye tracking for the Rally constellation

Paste everything below this line into Claude chat. The output should be ONE markdown file,
`ORB_EYE_SPEC.md`, written in the same voice and structure as the project's existing addendum
specs (described in §4). It will be handed to Claude Code to build from, slice by slice.

---

## 1. What you are writing

An implementation spec for adding **webcam eye / gaze tracking** as an input channel to a 3D
"neural constellation" web app. The spec must be buildable without further questions: locked
decisions, a pure-math pipeline, config defaults, headless tests, a browser gate, and build slices
with machine and human gates. Where a product decision is genuinely open, name it explicitly in a
"for the human" list rather than deciding silently.

## 2. The product (Rally) — vocabulary and rules that constrain everything

- Rally is a decentralised idea engine. Developers post **shouts** to company **camps**, add
  **echoes** (replies), and **rally** them. Vocabulary is LOCKED: shout, echo, rally, camp, crew,
  listening.
- The 3D field is the company-facing view of one camp: **each node is a shout**, echoes cluster
  one level deep around their parent, the **brain/anchor is the camp aggregate**. The field's
  ONLY job is pre-attentive salience; reading and acting is 2D, in a panel called **the shell**.
- LOCKED visual channels: **size = cumulative rallies; momentum = its own motion channel;
  colour = status**. Palette roles: **violet is exclusively for Rally controls**, never a data
  colour. Indigo is structure, ink is data.
- Input policy: daily work is conventional input (mouse drag, scroll, click). **Hand control is
  showcase / demo mode only.** Eye tracking is in the same bucket: a demo channel. It must not
  degrade the mouse experience and must be fully optional.

## 3. The codebase as it stands (you cannot see it — these facts are what you have)

Stack: React 19, react-three-fiber + three.js, zustand for LOW-frequency state only, per-frame
mutable "runtime" objects for anything that changes every frame, leva sliders for every tunable,
vitest for headless tests, Playwright scripts as browser gates against the Vite dev server.
Decisions are logged in `docs/DECISIONS.md`; slice results in `docs/PORT_LOG.md`.

**Input bus.** Every input method emits typed events onto one bus; the physics integrator
consumes them and knows nothing about the source. Events today:
`engage`, `move {dYaw, dPitch}`, `release {vYaw, vPitch}`, `tap {x?, y?}` (a positioned tap is a
mouse click; hand pinch-taps and Enter are unpositioned), `step`, `lost`, `zoom`, `zoomCommit`,
`home` (Escape). The physics ignores event types it does not know, so new events are cheap.
The integrator file is FROZEN (the globe reference build's tests pin it); behaviour differences
are FEEL profiles over one integrator, never a fork.

**Camera pipeline (hands).** `useHandInput` owns `getUserMedia` (640×480 @ 30 fps), creates a
MediaPipe `HandLandmarker` from `@mediapipe/tasks-vision` 1.0.1 with assets vendored under
`/public/models/hand_landmarker.task` and the `@mediapipe/tasks-vision` wasm, served from `node_modules` by `vite.config.ts` (nothing leaves the device),
GPU delegate with CPU fallback, detection at camera rate via `requestVideoFrameCallback`,
auto-stop after 20 s with no hand, a consent affordance (never a modal wall, never on load), and
a status enum in the store (`off | starting | on | stopped | denied | error`). A thumbnail shows
the user their own mirrored feed with landmarks. **Eye tracking must share this stream and this
consent** — no second `getUserMedia`, no second permission prompt. A `FaceLandmarker` model
(`face_landmarker.task`) would have to be vendored alongside; it exposes 478 landmarks with
iris points 468–477 and 52 blendshapes including `eyeLookIn/Out/Up/Down` and `eyeBlink`.

**Pure-math pattern.** Landmark maths lives in modules with NO MediaPipe imports (`landmarks.ts`,
`gestureMachine.ts`) so the whole pipeline tests headless with synthetic landmarks. A
`OneEuroFilter` class exists. A dev harness (`?input=synthetic&scenario=<name>`) drives the live
app from scripted landmark frames through the real pipeline with no camera.

**Selection model today.**
- A fixed *sight* (crosshair) at screen centre, LOCKED: it never moves and never tracks the
  hand. Highlight = nearest targetable node within `acquireRadius` (46 px) with hysteresis
  (`releaseRadius` 88, `switchMargin` 18, depth tie-break). Hand model: rotate the field to bring
  a node under the sight, pinch-tap to confirm. Two-hand pinch = camera dolly.
- Mouse model (built this week, keep intact): a violet **hover ring** on the node under the
  cursor; **click one selects** (the node flies to screen centre, becomes the pivot, the camera
  comes in from 4600 to 1600 wu, an inscribed violet crosshair marks it at half its radius);
  **click two enters** (the shell opens on it — currently an empty container); Escape closes the
  shell, then returns home. Hit-testing uses a glow-scaled radius with a 14 px floor so minor
  posts are clickable. Small nodes are ~2 px discs; nearest targetable neighbours are a median
  ~75 px apart at 900 px viewport height.
- Slice PT1 of the sight spec is built (read-only highlight); PT2 (free rotation + magnet) and
  PT3 (confirm routing) are NOT built. Dwell exists in config, default off, and is explicitly
  "never the primary confirm".

## 4. Format — mirror the existing addendum specs

The house style is `ORB_SELECT_SPEC.md` (crosshair pointing). Reproduce its shape:

0. **What this changes and why it is allowed** — name any LOCKED rule you touch and justify it.
1. **LOCKED decisions** — short, bold, each with the reason.
2. **The pipeline** — landmarks → head pose → gaze vector → screen point → filter → hysteresis,
   as pure functions with named inputs/outputs. State the expected accuracy honestly:
   uncalibrated webcam gaze is coarse (several degrees ≈ 100–200 px at desk distance); head pose
   is far steadier than iris offset and should carry most of the signal, iris refining it.
3. **Calibration** — either an explicit no-calibration coarse model, or an optional quick
   calibration (e.g. 5 points) with the default stated. Say what happens with glasses, low light,
   and one eye occluded.
4. **Interaction model** — how gaze combines with the hand and the mouse, and the arbitration
   between them. Choose ONE of these routes and argue it against the other two:
   - **A. Gaze steers rotation.** The sight stays fixed; looking off-centre applies a weak,
     speed-gated torque that brings that region toward the sight (same family as the planned
     magnet). Fits the sight spec as written.
   - **B. Gaze moves the sight.** The highlight point follows the eyes. Reverses a LOCKED
     decision; needs a large acquire radius and strong hysteresis.
   - **C. Gaze only confirms.** Pointing is unchanged; eyes provide the hands-free secondary —
     dwell on the highlighted node or a deliberate blink — with the "dwell never primary" rule
     respected.
   Whatever you pick: gaze is only live while the camera is on and hands are the active mode;
   the mouse model is untouched; a lost face degrades gracefully (freeze, decay, never fling);
   nothing in the field moves because the user merely glanced.
5. **Config additions** — a `NCONF.eye` block (or FEEL additions with a scope guard) with
   defaults, every value on a leva slider, plus telemetry fields to expose (gaze point, confidence,
   face present, filter state).
6. **Privacy and consent** — same consent as hands, frames never leave the device, a visible
   indicator while the eye channel is live, and how the user turns it off.
7. **Harness and tests** — headless vitest cases against synthetic face landmarks (head-pose
   extraction, gaze mapping, filter stability, hysteresis, lost-face behaviour, blink/dwell
   timing if used), a synthetic scenario for the dev harness, and a Playwright gate that checks
   no page errors, 60 fps with the face pipeline running, and the interaction contract.
8. **Build order and gates** — 3–4 slices, each with a machine gate (tests, screenshot, fps) and
   a human gate with a "symptom → slider" tuning guide.
9. **Do not** — a list. At minimum: no new `getUserMedia`; no network; no changes to the frozen
   integrator; violet only for controls; dwell never primary; no gaze-driven motion in the field
   while the mouse is the active input; reduced-motion respected; no pinpoint gaze pointing.

Also include a short **"For the human"** list of open product decisions (e.g. whether eye
tracking lives in Rally at all, which route, calibration or not), each with your recommendation.

## 5. Output rules

- One file, markdown, ~250–400 lines. Section headers as above. Config in a fenced `ts` block.
- Prefer concrete numbers with reasons over adjectives. Where you estimate, say so.
- Write for an implementer who has the codebase open; do not restate the codebase back at me
  beyond what a decision needs.
