# Addendum spec: two-handed pinch-zoom → depth navigation
### Extends ORB_BUILD_SPEC.md and the neural port (PORT_LOG.md P0–P6). Read those first.
### Sits alongside ORB_GRAB_SPEC.md; §4 defines how the two coexist.

Adds a two-handed gesture. **Both hands pinched, then move them through depth:** pull both
hands toward your body (out of the screen) to **zoom in**, push both hands toward the screen to
**zoom out**. This is the primary way to move between the constellation's two levels — the
field of hubs and a drilled-in hub — using an analog motion that commits at a threshold,
exactly the way rotation is analog and the detent commits.

Two things in the request were resolved during spec-writing. Implement these answers.

**RESOLVED — depth is sensed from apparent hand size, not landmark Z.** MediaPipe's per-landmark
z is too noisy to drive a zoom. `handScale` (wrist→middle-MCP distance in the image) is already
computed per hand and is a stable proxy for distance-to-camera: a hand grows in the image as it
nears the camera and shrinks as it recedes. The zoom driver is the **mean of the two hands'
`handScale`** relative to its value at engage. The mapping is **inverted** so the gesture
matches the intent above: hands shrink (pulled back toward you) → zoom in; grow (pushed toward
the screen) → zoom out. This is
the only reading of "toward / away from the screen" that does not jitter. `handScale` is a
magnitude, so the camera mirror (base spec §9) does not affect it and there is no sign subtlety
on this channel.

**RESOLVED — zoom drives the drill, it is not a free camera.** Continuous depth motion dollies
the active scene's camera; crossing a commit threshold fires the **existing** P5 drill-in /
drill-out transition on the reticle-focused hub. Below the threshold, releasing the pinch
springs the camera back to the level's rest distance — you peeked, you didn't commit. This
reuses `resolveReticle` and the P5 drill path verbatim; it does not reimplement selection. The
alternative — pure camera zoom that never drills — is `zoom.zoomCommitsDrill: false`, a config
flag, flagged for the human gate. Default is `true`.

---

> **Superseded in part by `ORB_SELECT_SPEC.md` §6 (not yet built).** That
> addendum makes zoom a pure camera dolly in the neural scene -
> `zoomCommitsDrill` false permanently, widened clamps, no commit thresholds
> or cooldown - and moves drilling to crosshair point-and-confirm. Sections 3
> (commit) and 7 (Z3) below are inert once it lands; §2's continuous dolly
> and §4's arbitration stay. The globe scene is unaffected.

## 1. LOCKED decisions

**LOCKED — the gesture requires BOTH hands pinched.** Two hands, each with pinchRatio below
`pinchClose` (base spec metric), confirmed 2 consecutive frames. A fist or an open hand on
either side disqualifies zoom. This is what cleanly separates zoom from the one-handed
pinch-flick and the (grab spec) fist.

**LOCKED — two hands ⇒ zoom owns the input.** While two pinched hands are present, the
single-hand machine is suppressed: no flick, no tap, no grab. Depth is the only thing read.
When the hand count drops back to one, the existing single-hand behaviour resumes. §4 specifies
the hand-off so neither transition emits a garbage event.

**LOCKED — zoom is scale-based and symmetric in log space.** The zoom factor is
`(meanScale / meanScaleAtEngage) ^ -zoomGain`, clamped (the negative exponent is the
pull-to-zoom-in inversion). Equal-ratio moves in and out feel
symmetric because the mapping is multiplicative, not additive. Do not drive zoom from the raw
pixel difference of hand size; drive it from the ratio.

**LOCKED — the frozen layers stay frozen.** The neural port holds gesture machine, physics,
input bus core, and the DOM/dashboard layers at zero diffs. This spec adds an *arbitrator*
above the existing single-hand gesture machine (a new pure function) and two new input-bus
event types; it does **not** edit `gestureMachine.ts`'s single-hand logic or any physics. All
67 existing tests must still pass untouched.

**LOCKED — panel-open still suspends all hand input.** When a report panel is open, hand input
is suspended (base spec §11); zoom inherits this. No zoom while a dashboard is open.

---

## 2. Sensing pipeline

**Two hands.** MediaPipe must run `numHands: 2` — the current build ships `numHands: 1`
(base spec §9), so this is a required change to `useHandInput.ts` only. `detectForVideo` returns
up to two hands; take the two highest-score results. Handedness is irrelevant here (the zoom
driver is a symmetric mean), so do not depend on left/right labelling, which flips under the
mirror anyway.

**Per hand, per frame** (reusing `landmarks.ts`): `handScale_i = |lm[0] − lm[9]|`,
`pinchRatio_i = |lm[4] − lm[8]| / handScale_i`.

**Zoom driver.**
```
meanScale = (handScale_L + handScale_R) / 2
ratio     = meanScale / meanScaleAtEngage          // 1.0 at the moment both pinches confirm
zoomRaw   = clamp(zoomMin, zoomMax, ratio ^ -zoomGain)   // negative: smaller hands = zoom in
zoom      = OneEuro(zoomRaw, zoomCutoff, zoomBeta)  // its own filter channel
```
`meanScaleAtEngage` is latched when the two-pinch engages and **re-latched after every commit**
(§3) so each level starts from a neutral zoom.

**Robustness note for the harness, not a runtime branch:** because the driver is a *mean*, one
hand nearer than the other is handled without special-casing — the `asymmetricDepth` scenario
(§5) exists to prove the mean doesn't swing wildly, not to add code.

---

## 3. What zoom does

The active scene owns a `zoomFactor` (1.0 = the level's rest framing). The continuous value
dollies the camera; the thresholds commit a level change.

**Continuous (below commit).** Map `zoomFactor` to camera distance:
`cameraDistance = restDistance / zoomFactor` (bigger hands → `zoomFactor` > 1 → nearer camera →
zoom in). For the neural scene `restDistance` is the ported camera z (2000; PORT_LOG P0). Clamp
to `[restDistance / zoomMax, restDistance / zoomMin]`. Apply to the scene camera only; do not
touch physics or rotation.

**Commit.**
```
if zoomCommitsDrill and no cooldown active:
  level 0 (field)  and zoomFactor ≥ zoomInCommit  and a hub is reticle-focused
      → emit the P5 DRILL-IN on that hub
  level 1 (drilled) and zoomFactor ≤ zoomOutCommit
      → emit the P5 DRILL-OUT
  on either commit: re-latch meanScaleAtEngage = current meanScale (zoom recenters to 1.0 at
      the new level), start commitCooldownMs, let the P5 recenter animation run
```
Clamp the ends: zoom-in while already at level 1 does **not** open the focused report (tap owns
that) — it just dollies to `zoomMax` and stops. Zoom-out at level 0 dollies to `zoomMin` and
stops. Only tap opens a report; only zoom/tap drill.

**Release below commit.** Both-hands pinch ends without having crossed a threshold → spring
`zoomFactor` back to 1.0 at `springBack`, camera returns to the level's rest framing.

**`resolveReticle` is the source of "which hub".** Reuse the P5 function that generalises the
globe's focus-weight argmax; the drilled-in target is whatever the reticle is on, identical to a
tap-drill. Do not add a second notion of "focused hub".

---

## 4. Arbitration — the disambiguation that makes or breaks this

A new pure function `handArbiter(frame, state, feel) → { state, events[] }` sits **above** the
existing single-hand `gestureMachine`. Per frame it receives 0, 1, or 2 detected hands and
decides who gets the input. The existing single-hand machine is called unchanged for the
one-hand paths.

```
count pinched hands (pinchRatio < pinchClose, per-hand hysteresis to pinchOpen)

TWO pinched, confirmed 2 frames:
    if we were in a one-hand engagement (flick/grab):
        end it cleanly first — emit release(vel = 0)   // never a tap, never garbage velocity
    enter ZOOM: latch meanScaleAtEngage; suppress the single-hand machine
    each frame: emit zoom(zoomFactor)                  // continuous
    on commit: emit zoomCommit('in'|'out') + re-latch  // §3

leaving ZOOM (a hand opens, or a hand is lost):
    emit zoom END with commit:'none' if no threshold was crossed
    → spring-back (§3); do NOT resume a one-hand gesture this frame
    require a fresh single-hand pinch (new engage) before any flick/tap fires again

ONE pinched (and never a second hand this window):
    pass the frame straight to the existing single-hand gestureMachine (flick / tap /
    grab-if-built) — behaviour identical to today

ZERO hands for > lostFrames while zooming: emit zoom END commit:'none', spring back
```

Failure modes this defends against, all required as harness assertions (§5):
- **A one-hand flick must never start a zoom** and **a starting zoom must never emit a flick or
  tap.** The 2-frame two-hand confirmation plus the clean single-hand release is the guard.
- **A second hand joining mid-flick** converts to zoom without flinging the constellation
  (release velocity forced to zero at the conversion).
- **One hand dropping mid-zoom** ends zoom into a spring-back, and does not immediately re-arm a
  one-hand flick from the still-pinched remaining hand.

The single-hand `gestureMachine.ts` is not edited. If the grab spec is already built, fist is
one-handed and lives entirely inside the single-hand machine, so two-pinch zoom and fist never
compete — the arbiter routes by pinched-hand count before either is consulted.

---

## 5. FEEL additions

```ts
// two-handed zoom
zoomGain:         2.2,    // ratio^-gain — apparent-size change → zoom (hands back = in)
zoomMin:          0.55,   // clamp on the continuous factor (max zoom-out)
zoomMax:          2.10,   // clamp (max zoom-in)
zoomInCommit:     1.60,   // factor ≥ this at level 0 → drill in
zoomOutCommit:    0.64,   // factor ≤ this at level 1 → drill out
springBack:      12.0,    // spring rate back to 1.0 on sub-threshold release
zoomCutoff:       6.0,    // One Euro min cutoff, zoom channel (fast motion, low lag)
zoomBeta:         0.02,
commitCooldownMs: 350,    // after a commit, ignore re-trigger while hands + camera recenter
twoHandFrames:    2,      // consecutive both-pinched frames to enter zoom
zoomCommitsDrill: true    // false = pure camera dolly, never drills (human-gate fork)
```

All on leva sliders. Telemetry additions: hand count (0/1/2), per-hand pinch state, live
`zoomFactor`, and current level. The camera thumbnail (base spec §9) must show **both** hands'
landmarks and colour-code the two-pinch-engaged state — the user has to see why the app thinks
it's zooming.

---

## 6. Harness v3 — two synthetic hands

`dev/syntheticHand.ts` currently emits one hand. Extend it to emit a **pair** (left/right
landmark sets at independent positions, scales, and pinch states) and add canonical two-hand
poses (both-pinched, both-open, one-each). This remains the only camera Claude Code has; camera
code is not touched until these pass. Depth is scripted by scaling both hands' landmark sets
about their own centres frame-to-frame (growing = approaching the camera = zooming out).

Scenarios and required assertions (`tests/zoom.test.ts`):

1. **zoomIn** — both pinched, pulled back: mean scale shrinks smoothly to ratio ≈ 1/1.9 over
   ~600ms. Assert:
   one zoom engage; `zoomFactor` rises monotonically (post-filter); exactly one
   `zoomCommit('in')` as it crosses `zoomInCommit`; baseline re-latched after.
2. **zoomOut** — start drilled (level 1), both pinched, pushed toward the screen: mean scale
   grows to ratio ≈ 1/0.55.
   Assert: one `zoomCommit('out')`; none at level 0's floor.
3. **zoomPeekRelease** — pull back to factor 1.3 (below `zoomInCommit`), both hands open.
   Assert: zero commits; `zoomFactor` springs back to within 0.02 of 1.0; no drill.
4. **oneHandNoZoom** — only one hand ever pinched, dragged. Assert: zero zoom events; the
   existing single-hand flick fires exactly as in the base gesture suite (regression).
5. **secondHandJoins** — one-hand pinch-drag underway, second hand pinches at frame 8. Assert:
   the single-hand engagement ends with a zero-velocity release (no flick coast); exactly one
   zoom engage; no tap.
6. **oneHandDrops** — mid-zoom, one hand disappears for 20 frames. Assert: one zoom END with
   commit `'none'`; spring-back; **no** flick or tap from the remaining pinched hand.
7. **bothPinchJitter** — mean scale noisy right around `zoomInCommit` (AR(1) wander per the
   port's realistic-noise decision). Assert: at most one `zoomCommit`, then cooldown holds — no
   commit flicker.
8. **asymmetricDepth** — hands at handScale 0.12 and 0.24 moving together. Assert: `zoomFactor`
   tracks the mean smoothly, no swing > 10% beyond the symmetric-case trajectory.
9. **commitCooldown** — a valid zoomIn commit immediately followed by continued pull-back.
   Assert:
   no second commit inside `commitCooldownMs`; the level advanced exactly once.

Wire the pair scenarios into `?input=synthetic&scenario=` and screenshot zoomIn mid-dolly and a
post-commit drilled state end-to-end.

---

## 7. Build order and gates

**Slice Z1 — two-hand plumbing.** `numHands: 2` in the camera shell; pair emission in the
harness; `handArbiter` skeleton routing by pinched-hand count; two-hand detection + engage;
telemetry + thumbnail showing both hands. No zoom motion yet — just prove two hands track and a
both-pinch engages/disengages cleanly, and that one-hand paths are untouched.
*Machine gate:* scenarios 4/5/6 green (the arbitration regressions), all 67 prior tests green,
typecheck + lint clean, screenshot of the HUD showing two engaged hands.

**Slice Z2 — continuous zoom.** Zoom driver, filter channel, camera dolly, spring-back on
sub-threshold release. No commits yet (`zoomCommitsDrill` effectively off for this slice).
*Machine gate:* scenario 3 (peek/release) + asymmetricDepth green; screenshot of the field
dollied in and back.
*Human gate:* raw zoom feel. Hand over with: does pulling toward you read as zoom-in, is
`zoomGain` comfortable (small depth move → useful zoom), does spring-back feel right, and the
fatigue read on holding two pinches. Tune `zoomGain / zoomMin / zoomMax / springBack / zoomCutoff`
here before commits are wired.

**Slice Z3 — commit → drill.** Thresholds fire the P5 drill-in/out; re-latch; cooldown; the end
clamps (no report-open on zoom, no over/under-drill). `zoomCommitsDrill` default true.
*Machine gate:* scenarios 1/2/7/8/9 green; end-to-end screenshots of a zoom-driven drill-in and
drill-out; frozen-layer `git diff` still empty on physics + single-hand gesture machine.
*Human gate:* the whole thing in the hand. Symptom → slider guide, at least: "drills before I
mean to → raise `zoomInCommit` or `commitCooldownMs`"; "have to reach too far to zoom → raise
`zoomGain`"; "commit feels twitchy at the threshold → widen the `zoomInCommit`/`zoomOutCommit`
gap or raise `zoomCutoff`"; "zoom fights my one-hand flick → the arbiter is resuming too eagerly,
check the fresh-pinch requirement". Put the `zoomCommitsDrill=false` alternative in front of the
human explicitly.

---

## 8. Do not

Everything in the base spec §13 and the grab spec §8, plus:
- Do not drive zoom from MediaPipe landmark z, or from raw hand-size pixel deltas — ratio of
  mean `handScale` only.
- Do not edit the single-hand `gestureMachine.ts` logic or any physics/integrator file. Zoom is
  an arbiter above the machine plus a scene-camera effect. Keep the frozen diffs empty.
- Do not let a two-hand zoom emit flick, tap, or grab; do not let a one-hand gesture emit zoom.
- Do not open a report on zoom, and do not drill past the two existing levels.
- Do not resume a one-hand gesture on the same frame a hand drops out of zoom — require a fresh
  pinch.
- Do not add two-handed rotation or two-handed pan. They are natural neighbours and explicitly
  out of scope; if raised, they are a separate spec, not a quiet addition here.
- Do not reimplement drill-in/out — emit the same transition the tap path already uses.

---

## 9. Reconcile — flag in the handoff

- The zoom targets the active scene's camera; it's specified against the neural scene (the live
  build). Note whether `?scene=globe` should adopt the same zoom or stay zoom-less.
- `zoomCommitsDrill` is a genuine product fork, not a tuning knob — surface it at the Z3 gate.
- If `ORB_GRAB_SPEC.md` is built by the time this lands, confirm in the handoff that fist
  (one-handed) and two-pinch zoom never co-fire, per §4's count-first routing — and add a
  `fistPlusPinch` harness pose (one fist, one pinch) asserting neither zoom nor grab engages.
