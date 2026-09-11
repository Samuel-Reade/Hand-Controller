# ORB_EYE_SPEC — webcam gaze as a showcase input channel for the constellation

Addendum to ORB_SELECT_SPEC.md (sight/crosshair pointing). Lives at `docs/ORB_EYE_SPEC.md`.
Status: proposed. Nothing here is built. Numbers marked *(est.)* are engineering estimates to be
tuned at the human gate, not measurements.

---

## 1. What this changes and why it is allowed

This adds a **gaze channel** to the hand/camera input path. It does not add a new input *mode*.
Gaze is a modifier on the existing hand mode: it is only live while the camera is `on`, hands are
the active input, and the user has opted the channel in. The mouse model built this week is not
touched, and the field never moves in response to gaze while the mouse is the active input.

LOCKED rules touched, and why each survives intact:

- **Sight is fixed at screen centre (ORB_SELECT_SPEC).** Untouched. The chosen route (§5, route A)
  steers the *field* toward the sight, exactly as the planned PT2 magnet does. The sight never
  follows the eyes. Route B is rejected precisely because it would reverse this rule.
- **Dwell is never the primary confirm.** Untouched. This spec adds no confirm path. Pinch-tap
  remains the only confirm in hand mode; the dwell config stays default-off and secondary.
- **Integrator is FROZEN.** Untouched. Gaze emits the existing `move {dYaw, dPitch}` event onto the
  bus with a source tag; the integrator does not learn a new event type. Differences in feel are a
  FEEL profile (`gazeTorque`), never a fork.
- **Input policy: daily work is conventional input.** Reinforced. Gaze is filed with hands as a
  showcase / room channel. Default off. A user who never touches the camera consent affordance
  never sees any of this.
- **Palette roles.** Violet is used only for the eye channel's on/off control (it is pressable).
  The live-gaze indicator and any debug overlay use **ink**, because they are data. Nothing gaze-
  related colours a node.
- **Privacy: nothing leaves the device.** Reinforced: same stream, same consent, same vendored-
  asset policy as hands, plus a second model file vendored alongside.

---

## 2. LOCKED decisions

- **Gaze shares the hand stream and the hand consent.** One `getUserMedia`, one prompt, one
  status enum. Reason: a second permission prompt is a modal wall by another name and doubles the
  privacy surface for no benefit — the face is already in the frame.
- **Head pose carries the signal; iris refines it.** Uncalibrated iris offset from a 640×480
  webcam at 60 cm is noisy at the ±2–4° level *(est.)*; head yaw/pitch from a 478-point mesh is
  steady to ~1°. Iris contributes a bounded refinement (§3, `irisGainDeg`) and is dropped entirely
  under low confidence. Reason: a channel that is mostly head pose is honest about what a webcam
  can do and never invites pinpoint pointing.
- **Gaze steers rotation; it never points and never confirms.** Route A (§5). Reason: expected
  accuracy is ~100–200 px at desk distance and the median neighbour spacing under the sight is
  ~75 px. Gaze cannot pick a node. It *can* say "the thing I care about is up-left," which is what
  the magnet family already does.
- **A glance does nothing.** Torque begins only after gaze has been outside the dead zone for
  `attendMs` (default 400 ms) and is speed-gated so it can never exceed a slow pan. Reason: the
  field must never twitch because the user read the shell, checked the thumbnail, or looked at a
  second monitor.
- **Hands win.** Any hand `engage` suspends gaze torque instantly; gaze resumes `resumeMs` after
  `release`. Reason: the user's explicit action always outranks an inferred one; two torque sources
  on one integrator would feel like fighting a current.
- **Lost face → freeze, then decay, never fling.** On `facePresent=false` the gaze offset is held
  for `holdMs`, then decays to zero over `decayMs`. No release-velocity event is ever synthesised
  from gaze. Reason: gaze has no legitimate "throw" semantics.
- **Coarse model by default; calibration optional and session-only.** Reason: a 5-point
  calibration takes ~8 s and roughly halves error *(est.)*, which is worth offering in a demo, but a
  showcase channel that demands a ritual before it works will simply not be used.
- **Reduced-motion disables gaze torque entirely.** The channel still reports telemetry (so the
  indicator and debug overlay work) but emits no `move` events. Reason: gaze torque is by
  definition motion the user did not explicitly request.

---

## 3. The pipeline

All functions are pure, live in `src/input/eye/*.ts`, and import nothing from MediaPipe. Units:
degrees for angles, CSS px for screen points, seconds for time. `+yaw` = looking to the user's
right, `+pitch` = looking up (matches the hand bus convention; verify against `landmarks.ts` and
flip in one place if not).

```
FaceFrame ──► headPose ──┐
   │                     ├──► gazeAngles ──► screenPoint ──► oneEuro ──► regionGate ──► torque
   ├──► irisOffset ──────┘        ▲
   └──► confidence ───────────────┘ (gates every stage)
```

**Input.** `FaceFrame = { t, landmarks: [478 × {x,y,z}] (normalised image coords), blendshapes:
Record<name, 0..1>, presence: 0..1, transform?: Float32Array(16) }`. The `transform` is
FaceLandmarker's `facialTransformationMatrixes[0]` when `outputFacialTransformationMatrixes` is
on; it is optional so synthetic frames need not supply it.

**headPose(frame) → { yaw, pitch, roll, ok }.**
- If `transform` is present, decompose its rotation to Euler yaw/pitch/roll. This is the
  preferred path; it is what the model was trained to produce.
- Fallback from landmarks (also the reference for tests): eye-outer corners 33 (L) and 263 (R),
  nose tip 1, chin 152. `interOcular = |p263 − p33|`. `yaw ≈ asin(clamp((nose.x − eyeMid.x) /
  (0.5·interOcular)))` in the mirrored frame; `pitch ≈ asin(clamp((nose.y − eyeMid.y) /
  (0.42·interOcular) − k0))` where `k0` is the neutral nose drop (default 0.55 *(est.)*, tuned in
  E2); `roll = atan2(p263.y − p33.y, p263.x − p33.x)`.
- `ok=false` when `|yaw| > headYawMaxDeg` or `|pitch| > headPitchMaxDeg`: the mesh degrades
  sharply past ~35° and the user is plainly not looking at the screen anyway.

**irisOffset(frame) → { x, y, okL, okR }** in [−1, 1] per axis, +x = user's right, +y = up.
- Left eye: iris centre 468, corners 33 (outer) / 133 (inner), lids 159 (upper) / 145 (lower).
  Right eye: iris 473, corners 263 / 362, lids 386 / 374.
- Per eye: `x = (iris.x − cornerMid.x) / (0.5·cornerSpan)`, `y = (lidMid.y − iris.y) /
  (0.5·lidGap)`; sign-flip x for mirroring so both eyes agree.
- `okL/okR = false` when that eye's `eyeBlink* > blinkThreshold` or `lidGap < 0.18·cornerSpan`
  (eye too closed to place the iris). Average the eyes that are ok; if neither, `x=y=0`.
- Blendshapes `eyeLookIn/Out/Up/Down` are a cross-check, not the source: if the blendshape-
  implied direction disagrees with the geometric one by more than 0.5 on either axis, halve
  `irisGainDeg` for that frame (the model is unsure — glasses, glare).

**gazeAngles(head, iris, cfg) → { yaw, pitch }.**
`yaw = head.yaw + cfg.irisGainDeg · iris.x`, `pitch = head.pitch + cfg.irisGainDeg · iris.y`.
`irisGainDeg` default 12: full iris deflection is worth ~12° *(est.)*, comparable to the real
oculomotor range at a comfortable desk distance, and small enough that iris noise (±0.15 in
normalised units *(est.)*) contributes under ±2°.

**screenPoint(gaze, cfg, viewport) → { x, y }.**
`x = viewport.w/2 + (gaze.yaw − cal.yaw0) · cal.gainX · cfg.pxPerDeg`, likewise y with pitch
(negated, screen y is down). `pxPerDeg` default 38: 60 cm viewing distance gives 10.5 mm/deg, and
a typical laptop panel is ~3.6 CSS px/mm *(est.)*. Without calibration `cal = { yaw0: 0, pitch0: 0,
gainX: 1, gainY: 1 }`. The centre-of-screen assumption (head yaw 0 → screen centre) is wrong by
however far the webcam sits from screen centre; on a laptop that is ~5° pitch, which is exactly
what the 5-point calibration corrects.

**oneEuro.** Two `OneEuroFilter` instances on `gaze.yaw` / `gaze.pitch` (filter in degrees, not
px, so viewport size does not change the feel). Defaults `minCutoffHz 1.2`, `beta 0.015`,
`dCutoffHz 1.0`. Filters are reset on face acquisition so a re-appearing face does not slew in
from a stale value.

**confidence(frame, head, iris) → 0..1.** `presence × headOk × (0.6 + 0.4·eyesOk)`, where
`eyesOk` is the fraction of eyes with ok iris. Below `confidenceMin` (0.35) the frame is treated as
face-lost for gating purposes but telemetry still updates.

**regionGate(point, viewport, state, dt, cfg) → { active, dir, mag }.** This is the hysteresis.
- `r = distance(point, centre)`, `R = min(w, h)/2`. `norm = r / R`.
- Enter attending when `norm > deadZone` (0.28) continuously for `attendMs`; leave when `norm <
  deadZone − hysteresis` (0.28 − 0.08 = 0.20) continuously for `releaseMs` (150). The dead zone
  is ~250 px radius at 900 px height, comfortably above the ~150 px coarse error, so a user
  looking at the sight never triggers torque.
- `mag = smoothstep(deadZone, 1.0, norm)` — torque ramps from zero at the edge of the dead zone
  to full at the viewport edge. `dir` = unit vector from centre to point.

**torque(gate, dt, cfg) → move event.** `dYaw = dir.x · mag · cfg.maxDegPerSec · dt`, `dPitch`
likewise. `maxDegPerSec` default 14: a full 180° pan would take ~13 s, slower than the slowest
deliberate hand pan, so gaze reads as drift rather than steering. The event is emitted as
`move {dYaw, dPitch, source: 'gaze'}` only when the arbitration in §5 says gaze holds the floor.

**Expected accuracy, stated plainly.** Uncalibrated: 3–6° ≈ 110–230 px at 900 px height *(est.)*;
bias dominates (webcam offset, individual iris geometry), jitter after filtering ~±1°. Calibrated:
2–3° *(est.)*. Neither number supports pointing at a 2 px disc with 75 px neighbours, which is why
the pipeline stops at a *direction and magnitude* and never hands the integrator a point.

---

## 4. Calibration

**Default: none.** The coarse model above runs immediately on face acquisition.

**Optional 5-point calibration** (centre, then four points at 40 % of half-width/height toward
each corner), started from the eye control in the thumbnail, ~8 s total:
- Each point is shown as an ink ring for 1.6 s; samples from the last 1.0 s (after the saccade
  settles) are median-pooled.
- Fit per axis: `yaw0` from the centre sample, `gainX` from the least-squares slope of
  screen-x against filtered yaw across the five points (likewise y). Reject the fit and keep
  defaults if either gain falls outside [0.5, 2.0] or the residual exceeds 120 px — a bad
  calibration is worse than none.
- Result lives in the runtime object only. Not persisted: the geometry changes whenever the
  laptop moves. If the human gate later wants persistence, sessionStorage with a viewport-size
  key is the only acceptable store.

**Degraded conditions.**
- *Glasses.* The mesh itself is robust; iris placement under reflections is not. Expect
  `okL/okR` to flicker. Behaviour: the blendshape cross-check halves iris gain; if iris ok rate
  over the last second drops below 40 %, iris gain goes to zero and the channel is head-pose only.
  The indicator shows the "head only" state (§7). Nothing else changes.
- *Low light.* `presence` falls first. Below `confidenceMin` the channel freezes and decays (§5).
  No attempt to "boost" — the hand path already auto-stops after 20 s without a hand; the face
  path follows the same timer.
- *One eye occluded* (hand, hair, profile). Per-eye ok flags handle it: the visible eye is used
  alone. If the occlusion is because head yaw is large, `headOk` will already be false.

---

## 5. Interaction model

### Route chosen: A — gaze steers rotation

The sight stays fixed. Sustained gaze outside the dead zone applies a weak, speed-gated torque
that brings that region of the field toward the sight. The user then does exactly what they do
today: fine-position with the hand if needed, pinch-tap to confirm.

**Against B (gaze moves the sight).** Reverses a LOCKED rule, and the numbers do not support it:
with 100–200 px error and ~75 px neighbour spacing, the acquire radius would have to be so large
(≥120 px) that the highlight would sit on the wrong node most of the time and hop between two or
three candidates under jitter. Strong hysteresis would make it stick to the wrong one instead.
There is no tuning that makes a coarse pointer precise; B is a precision problem dressed as a
feel problem.

**Against C (gaze only confirms).** Dwell is "never primary" and this would make it the primary
hands-free confirm in all but name. Deliberate blinks collide with natural blinks (every 3–5 s)
and with the blink-driven iris dropout in §3; a double-blink discriminator adds latency (~600 ms)
and false positives in a demo room with laughing. Confirmation is also where the cost of a wrong
signal is highest — a mis-confirm opens the shell on the wrong shout in front of a prospect.
Gaze is a poor confirm and an adequate steer; put it where it is adequate.

**Why A fits.** It is the same family as PT2's magnet: a soft torque on the field toward
something. It composes with the hand rather than competing (the hand does what the hand does;
gaze only fills the gaps when the hand is idle). Its failure mode is "the field drifts slowly the
wrong way," which is visible, harmless, and cancelled by a hand engage.

### Arbitration

Priority is strict: **mouse > hand > gaze**.

- Mouse is the active input whenever the last pointer event is more recent than the last hand or
  gaze event, or the camera status is anything but `on`. In this state the gaze channel emits
  nothing. Gaze does not exist to the mouse model.
- Hand `engage` → gaze goes to `suspended` immediately (same frame). Hand `release` → gaze stays
  suspended for `resumeMs` (600) so the post-release inertia settles before torque can add to it,
  then returns to `idle` and must re-earn `attendMs` before torquing again.
- Two-hand pinch (dolly) → suspended, same as engage.
- Any `tap` → suspended for `resumeMs`; the user is reading whatever they selected.
- While the shell is open → suspended. The shell is 2D reading territory; gaze in the shell would
  be a scroll model, which is out of scope and probably a bad idea.

### Channel state machine

```
off ──(camera on + eye enabled)──► idle
idle ──(norm > deadZone for attendMs)──► attending
attending ──(norm < deadZone−hyst for releaseMs)──► idle
attending ──(hand engage | tap | shell open)──► suspended
idle|attending ──(confidence < min)──► holding ──(holdMs)──► decaying ──(decayMs)──► idle
suspended ──(hand release + resumeMs, shell closed)──► idle
any ──(camera off | eye disabled | reduced-motion on)──► off
```

`holding` keeps the last gate output constant (the field keeps drifting at the same slow rate for
up to `holdMs` = 250 ms — a blink is ~150 ms and must not stutter the drift). `decaying` ramps
`mag` to zero over `decayMs` = 400 ms. Neither state ever emits `release`.

**Nothing moves on a glance.** A glance is any gaze excursion shorter than `attendMs`; it never
reaches `attending`. Eyes flicking to the thumbnail, the leva panel, or a second screen produce
telemetry only.

---

## 6. Config additions

`NCONF.eye`, every value on a leva slider under a folder "Eye (showcase)". Sliders are hidden
entirely when `enabled=false` except the toggle itself, so the daily-work leva panel is not
cluttered.

```ts
export const EYE_DEFAULTS = {
  enabled: false,          // channel opt-in; separate from camera consent
  showDebug: false,        // ink gaze dot + dead-zone ring + state label

  // model / detection
  detectEveryNFrames: 1,   // 1 = camera rate (30 fps); 2 if fps gate fails
  confidenceMin: 0.35,
  blinkThreshold: 0.5,     // eyeBlinkL/R blendshape
  headYawMaxDeg: 35,
  headPitchMaxDeg: 30,
  neutralNoseDrop: 0.55,   // k0 in the landmark pitch fallback (est.)

  // gaze composition
  irisGainDeg: 12,         // full iris deflection ≈ this many degrees
  pxPerDeg: 38,            // 60 cm, ~3.6 CSS px/mm (est.)

  // filter (degrees domain)
  minCutoffHz: 1.2,
  beta: 0.015,
  dCutoffHz: 1.0,

  // gate / hysteresis (fractions of min(w,h)/2)
  deadZone: 0.28,
  hysteresis: 0.08,
  attendMs: 400,
  releaseMs: 150,

  // torque
  maxDegPerSec: 14,
  resumeMs: 600,           // after hand release / tap before gaze may torque again

  // lost-face
  holdMs: 250,
  decayMs: 400,

  // calibration
  calPointHoldMs: 1600,
  calSampleWindowMs: 1000,
  calInset: 0.40,          // corner points at 40% of half-extent
  calMaxResidualPx: 120,
} as const;
```

Scope guard: `NCONF.eye` is read only inside `useEyeInput`; nothing else imports it. The FEEL
profile system gets one new profile, `gazeTorque`, that is *selected* by the eye channel and
contains no eye-specific integrator behaviour — it only lowers max angular velocity to
`maxDegPerSec` while gaze holds the floor.

**Telemetry** (per-frame runtime object `runtime.eye`, mirrored to the store at 4 Hz for the
indicator and leva monitors):

```ts
interface EyeTelemetry {
  state: 'off'|'idle'|'attending'|'suspended'|'holding'|'decaying';
  facePresent: boolean;
  confidence: number;      // 0..1
  headOnly: boolean;       // iris gain currently zeroed (glasses / low light)
  yaw: number; pitch: number;         // filtered gaze angles, deg
  gazeX: number; gazeY: number;       // screen px
  norm: number;            // distance from centre as fraction of half-extent
  irisOkL: boolean; irisOkR: boolean;
  blinkL: number; blinkR: number;
  filterCutoffHz: number;  // OneEuro's current adaptive cutoff (yaw)
  calibrated: boolean;
  detectMs: number;        // last FaceLandmarker call duration
}
```

---

## 7. Privacy and consent

- Same consent affordance, same status enum, same auto-stop. The eye toggle is disabled until
  camera status is `on`. Enabling eye never triggers a permission prompt because there is nothing
  new to permit.
- `face_landmarker.task` is vendored under `/public/models/` next to the hand model; the wasm is
  already shared. The Playwright gate asserts zero requests to any origin other than the dev
  server while the channel runs.
- **Visible indicator while live:** a small ink iris glyph in the existing thumbnail's corner,
  filled when `state ∈ {idle, attending}`, hollow when `suspended|holding|decaying`, with a
  "head only" ring when `headOnly`. Present whenever the eye channel is anything but `off`.
  Ink, because it reports a state; it is not pressable.
- **Turning it off:** the eye toggle (violet, pressable, in the thumbnail), Escape while
  `attending` (also emits `home` as today — one key, two effects, both "stop"), or stopping the
  camera. Off drops the FaceLandmarker, clears `runtime.eye`, and discards any calibration.
- Frames, landmarks, and calibration never leave the tab and are never written to storage.

---

## 8. Harness and tests

**Synthetic face frames.** `src/input/eye/__synthetic__/face.ts` builds a `FaceFrame` from
`{ yaw, pitch, roll, irisX, irisY, blinkL, blinkR, presence, jitterPx }` by placing the 13
landmarks the pipeline reads (§3) on an idealised head model and filling the rest with zeros.
`transform` is omitted so tests exercise the landmark fallback; one test supplies a matrix and
checks the two paths agree within 1.5°.

**Vitest (headless, pure modules):**
1. `headPose` recovers yaw/pitch within 1° across a ±30° grid; `ok=false` beyond the max.
2. `irisOffset` recovers ±1 deflection within 0.05; per-eye ok drops on blink and on lid gap.
3. `gazeAngles` is linear in iris with gain `irisGainDeg`; gain halves on blendshape disagreement.
4. `screenPoint` maps yaw 0 to centre and ±10° to ±380 px at default `pxPerDeg`.
5. Filter stability: 200 frames of 3 px white-noise jitter at 30 fps yield filtered stdev < 0.6°;
   a 15° step settles within 90 % in ≤ 6 frames (beta path).
6. Hysteresis: a point oscillating across `deadZone` at 5 Hz never enters `attending`; a point
   held at `norm=0.5` enters at exactly `attendMs`; leaving requires `norm < 0.20` for `releaseMs`.
7. Lost face: from `attending`, confidence→0 holds output for `holdMs`, decays to 0 by
   `holdMs+decayMs`, and the emitted event list contains no `release`.
8. Arbitration: `engage` during `attending` → `suspended` same tick; no `move{source:'gaze'}`
   until `release + resumeMs + attendMs`.
9. Reduced-motion: with the flag set, 300 attending frames emit zero `move` events, telemetry
   still updates.
10. Calibration: five synthetic samples with a 5° pitch bias and 1.3× x-gain produce a fit within
    0.5° / 0.05; a residual over `calMaxResidualPx` keeps defaults.

**Dev harness scenarios** (`?input=synthetic&scenario=…`), driven through the real pipeline:
- `eye-sweep` — face present, gaze sweeps a slow figure-eight; expect gentle field drift, no
  highlight change without a hand.
- `eye-glance` — 250 ms excursions every 2 s; expect zero field motion.
- `eye-lost` — attending, then face drops for 1 s, returns; expect hold → decay → clean resume.
- `eye-blink` — natural blinks at 4 s intervals during a sweep; expect no stutter.
- `eye-glasses` — iris ok rate 30 % with noisy blendshapes; expect `headOnly=true`, drift still
  works from head pose.
- `eye-hand-mix` — sweep interrupted by scripted hand engage/release; expect suspend/resume timing.

**Playwright gate** (`scripts/gate-eye.ts` against the Vite dev server):
- Loads `?input=synthetic&scenario=eye-sweep&eye=1`; asserts no page errors and no console
  errors across 10 s.
- Samples `requestAnimationFrame` deltas for 5 s with the face pipeline running (synthetic
  frames at 30 fps through the same worker path): p95 frame time ≤ 16.7 ms. If it fails,
  `detectEveryNFrames=2` must pass, and that becomes the shipped default.
- Network: zero requests off-origin.
- Contract: in `eye-glance`, the field's yaw/pitch after 10 s equals its start within 0.1°; in
  `eye-sweep` it differs by > 5°; in `eye-hand-mix` no gaze `move` event is logged within 600 ms
  of any hand `release`.
- Screenshot with `showDebug=1` for the human gate (dot, ring, state label visible).

---

## 9. Build order and gates

**E1 — plumbing, no motion.** Vendor `face_landmarker.task`; extend `useHandInput`'s frame
callback to run FaceLandmarker on the same `VideoFrame` (one `detectForVideo` each, hand first);
populate `runtime.eye` and the thumbnail indicator; leva folder; `enabled` toggle. No events
emitted. *Machine gate:* typecheck, existing tests green, Playwright fps gate with both models
running, zero off-origin requests. *Human gate:* turn head, watch telemetry yaw/pitch track;
glasses on/off, watch `headOnly` flip. Symptom → slider: yaw reads reversed → flip sign in one
place in `headPose`, not in config; confidence flickers at rest → lower `confidenceMin` to 0.25.

**E2 — pure pipeline + tests + harness.** `headPose`, `irisOffset`, `gazeAngles`, `screenPoint`,
filter wiring, `regionGate`; synthetic face builder; tests 1–7, 9; scenarios `eye-sweep`,
`eye-glance`, `eye-lost`, `eye-blink`, `eye-glasses`. Still no events. *Machine gate:* tests
green, harness scenarios run without page errors, debug overlay screenshot. *Human gate:* with
`showDebug` on, look at the four screen corners and centre; the dot should land in the right
quadrant every time and within ~200 px most of the time. Symptom → slider: dot lags the eyes →
raise `beta` to 0.03; dot jitters at rest → lower `minCutoffHz` to 0.8; dot overshoots the edges →
lower `pxPerDeg`; dot barely leaves centre → raise `pxPerDeg` or `irisGainDeg`; dot rides high
on a laptop → this is webcam offset, run calibration (E4) rather than tuning.

**E3 — torque + arbitration.** `gazeTorque` FEEL profile; emit `move{source:'gaze'}`; state
machine; suspend/resume with hands, tap, shell; reduced-motion guard; tests 8; scenario
`eye-hand-mix`; full Playwright contract. *Machine gate:* all tests, all scenarios, fps, contract
assertions. *Human gate:* the one that matters. Sit, look at a node off to the side, wait — the
field should begin drifting it toward the sight after ~half a second, slowly, and stop when it
arrives in the dead zone; glance at the thumbnail — nothing; pinch and pan — gaze stops dead;
release — no double-motion. Symptom → slider: field twitches on glances → raise `attendMs` to
600; drift too fast/feels like steering → lower `maxDegPerSec` to 8; drift never starts → lower
`deadZone` to 0.22 or check `norm` telemetry; field keeps going after node is centred → widen
`hysteresis` is wrong here, *narrow* `deadZone`; fights the hand after release → raise `resumeMs`
to 900; stutters on blinks → raise `holdMs` to 350.

**E4 — optional calibration + polish.** 5-point flow, fit, rejection, indicator states, test 10.
*Machine gate:* test 10, calibration scenario screenshot. *Human gate:* calibrate, repeat the E2
corner test; error should visibly halve. Symptom → slider: calibration always rejected → raise
`calMaxResidualPx` to 180 or lengthen `calPointHoldMs`; still biased → `calInset` too small,
raise to 0.5.

Log each slice in `docs/PORT_LOG.md`; log the route-A choice and the head-pose-first decision in
`docs/DECISIONS.md`.

---

## 10. Do not

- No second `getUserMedia`, no second permission prompt, no separate status enum.
- No network. Model and wasm vendored; the gate asserts it.
- No edits to the frozen integrator. New behaviour is a FEEL profile plus events it already knows.
- No new event types unless the integrator would otherwise need to change — `move` with a
  `source` tag suffices.
- Violet only for the eye on/off control. Indicator, debug dot, dead-zone ring, calibration
  targets are ink.
- Dwell never primary. This spec adds no confirm; do not "just add" blink-confirm in E3.
- No gaze-driven motion while the mouse is the active input, while the shell is open, or while
  reduced-motion is on.
- No pinpoint gaze pointing: never hand the sight, the hit-test, or the highlight a gaze point.
- No `release` events synthesised from gaze; lost face freezes and decays.
- No persistence of frames, landmarks, or calibration to any storage in this spec.
- No modal calibration wall on enable; calibration is a button, not a gate.
- Do not tune by editing `EYE_DEFAULTS` mid-session; tune on the slider, then commit the number
  with a PORT_LOG note.

---

## 11. For the human

1. **Does eye tracking live in Rally at all?** Recommendation: build E1–E3 in the Hand-Controller
   repo as a showcase channel, same bucket as hands; decide on inclusion in the Rally product only
   after the "is hand control in Rally" question (RALLY.md §5) is answered, since the two share a
   fate.
2. **Route A vs B vs C.** Recommendation: A, for the reasons in §5. If you want a hands-free
   *confirm* for the room demo, that is a separate decision that must first reopen "dwell never
   primary" — do not smuggle it in here.
3. **Calibration.** Recommendation: default off, optional 5-point, session-only (E4). Cut E4
   entirely if the E3 human gate says the coarse drift is good enough for a demo.
4. **Should gaze torque be on by default in showcase mode** (i.e. enabled whenever the camera is
   on), or a separate opt-in? Recommendation: separate opt-in until the E3 gate has been passed by
   at least two people other than the author; then fold it into showcase mode.
5. **Escape semantics.** Currently Escape closes the shell then goes home. This spec also lets it
   stop an `attending` drift. Recommendation: accept the overload — every meaning is "stop".
6. **Frame budget.** If both models cannot hold 60 fps on the demo machine, choose between
   `detectEveryNFrames=2` for the face (recommended; gaze tolerates 15 Hz) and dropping the hand
   thumbnail's landmark overlay. Decide on the actual demo hardware, not a dev laptop.
