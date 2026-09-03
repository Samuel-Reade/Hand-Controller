# Addendum spec: crosshair pointing + free rotation selection
### Extends ORB_BUILD_SPEC.md and the neural port (PORT_LOG.md P0–P6).
### Supersedes parts of ORB_ZOOM_SPEC.md (§7 here). Sits alongside ORB_GRAB_SPEC.md.

Replaces the neural scene's selection model. Today the scene snaps rotation onto a grid it
doesn't really have — P5 re-shells reports onto the old globe's latitude/longitude to give the
detents something to land on, and zoom "tries to find nodes to attach to." That is the grid
model fighting a field that has no grid. This spec removes the grid: **rotation becomes free and
unbounded, a fixed crosshair at screen-center highlights whatever node it's over, and a
pinch-tap confirms.**

## 0. What this reverses, and why it's allowed

The base spec §2 LOCKED "rotation is selection — no pointing, no cursor, no raycasting at
items," and locked detents on both axes. **This spec deliberately reverses both, for the neural
scene only.** The reversal is authorized, not an oversight — record it in DECISIONS.md.

The original rule was correct for its object and is still correct there. It solved *free
pointing*: chasing small, foreshortened targets across a curved surface with a shaky hand. This
model is not free pointing. The crosshair is **fixed at dead-center and never moves**; the user
rotates the field to bring a node *to* the crosshair. Selection therefore always happens at the
one on-screen point with the least projection distortion and the most face-on geometry — the
exact property the original rule was protecting. What's dropped is only the detenting, which
never fit a jittered 455-node constellation.

**Scope guard:** `?scene=globe` keeps the original model unchanged — detents, rotation-as-
selection, pitch clamp. The globe stays a valid reference build and its frozen tests stay green.
Everything below applies to the neural scene. Implement the two behaviours as **two FEEL
profiles over one integrator** (the pattern the grab spec used for zero-g); do not fork the
physics file.

---

## 1. LOCKED decisions

**LOCKED — the crosshair is fixed at screen-center and small.** A thin hairline crosshair, a
few pixels each arm, low opacity at rest. It is a sight, not a cursor; it never tracks the hand.
The whole interaction is "rotate the node under the sight, confirm."

**LOCKED — highlight is nearest-to-center within a tolerance, not a pinpoint ray.** Each frame,
the targetable node whose projected center is nearest to screen-center — and within
`acquireRadius` px — is highlighted. A pinpoint ray would demand precision the hand doesn't
have; the tolerance makes it a soft cone. Depth breaks ties: if two candidates are both within
tolerance, the one nearer the camera wins (it's the one you'd visually point at).

**LOCKED — highlight has hysteresis.** Two radii: a node is *acquired* when it enters
`acquireRadius`, and *released* only when it leaves the larger `releaseRadius` (or another node
is nearer by more than a margin). This deadband stops the highlight flickering between neighbours
on hand micro-jitter. Never highlight by a single-frame nearest without the deadband.

**LOCKED — confirm reuses pinch-tap. No new gesture.** The tap-vs-drag split already exists: a
low-travel pinch is a tap, a travelling pinch rotates. Selection is: rotate a node under the
crosshair (highlight), quick pinch-tap (confirm). Do not invent a select gesture; do not use
dwell as the primary (see §5 for dwell as an optional secondary).

**LOCKED — rotation is free and unbounded; no detents in this scene.** Yaw is already free.
Relax the pitch clamp from the category-motivated ±1.1 rad to ±(π/2 + margin) so every node is
reachable by rotation; the constellation has no latitude-means-category semantic to protect.
Momentum and One Euro filtering stay; only the detent spring is removed from this profile.

**LOCKED — magnetic targeting replaces the detent, gently.** Instead of snapping, apply a *weak*
torque toward centering the nearest targetable node, gated to low angular speed and far weaker
than the old detent. It never stops rotation and never commits — it only makes a node slightly
easier to hold under the sight. At flick speed it is negligible and must not fight the throw.
This is the buy-back for losing the detent's certainty; tune it at the human gate.

---

## 2. Targetable nodes — the data reality, handled explicitly

The scene has 455 nodes but far fewer reports (the base data is ~5 categories × ~7 reports).
Most nodes carry no report. Pointing must still be meaningful, so:

**A node is targetable iff it is bound to a report, or it is an ancestor of a report-bound node
(a node on the path to a report).** Structural dead-ends — nodes with no report beneath them —
render as before but are **not** acquirable by the crosshair; the highlight skips them. This
keeps every confirm meaningful: you can only sight things you can actually act on.

- Tap a **report-bound leaf** → open its report (the existing FocusRef → panel contract,
  byte-compatible with P5).
- Tap an **internal targetable node** (has report-bearing descendants) → recenter/drill onto it:
  it flies to center, becomes the new root, its children spread. This is the P5 drill-in
  transition, generalized from "hub" to "any internal node" — reuse it, do not reimplement.
- Tap the **anchor** → drill out one level (see §4).

**Flag for the human:** the report/node binding density (~35 of 455) is inherited from P5's
`hub i → orbit (i mod 5)` mapping and is a real product decision — whether to add reports so more
of the field is live, or prune the constellation toward report-bearing nodes. Out of scope for
this spec; name it in the handoff.

**Full-tree vs two-level:** this spec implements **full recursive navigation** — point and drill
through every internal tier down to report leaves, point at anchor to climb back. If the human
prefers the P5 two-level cap (field → hub → report only), that's `select.maxDepth = 1`; default
is unbounded. Flag at the gate.

---

## 3. Highlight mechanics

Per frame, cheap and O(n) over the ~455 nodes (positions already computed for rendering):

```
center = screen center in px
best = null; bestDist = ∞
for each targetable node n on the near side (w > 0):
    p = project(n.worldPos) → screen px
    d = |p − center|
    if d < bestDist: bestDist = d; best = n

// hysteresis
if current highlight H exists:
    keep H unless  (best ≠ H and bestDist < dist(H) − switchMargin)
                or (dist(H) > releaseRadius)
else:
    highlight best iff bestDist ≤ acquireRadius

// depth tie-break folded into the loop: when |d_a − d_b| < tieBandPx, prefer larger w
```

**Crosshair + node visual states** (design tokens from base spec §10, brass accent):
- **Idle** — hairline crosshair, ~40% opacity, ivory or brass.
- **Acquired** — draw a thin ring around the highlighted node; node brightens and scales up
  slightly (reuse the existing focus-swell curve); crosshair tightens and adopts the node's hue.
  The user must *see* "this is targetable now" before committing.
- **Confirming** — on pinch-down over an acquired node, the ring closes/fills briefly so the tap
  reads as registered even before the transition starts.

Keep it quiet — one ring, one swell, one color shift. No reticle animation beyond the tighten.

---

## 4. Back-navigation

Drilling in is point-and-tap. Out is the open question this model creates; the in-model answer:

**The anchor always represents "current root / go up," and is always targetable.** At the field
level the anchor is the brain; after drilling into node X, the anchor role sits on X (P5 already
migrates the anchor treatment on drill-in). Sighting the anchor and pinch-tapping drills out one
level, reversing the recenter. Also bind **Escape / Backspace** to drill-out for keyboard parity
(base spec requires full keyboard operation). Flag the anchor-as-back choice at the gate — it's
deliberate, not the only option.

---

## 5. FEEL additions

```ts
// crosshair + highlight
crosshairSize:    7,      // px, arm length — small
acquireRadius:   46,      // px from center to acquire a node
releaseRadius:   88,      // px to drop the current highlight (hysteresis; > acquire)
switchMargin:    18,      // px a rival must beat the current highlight by to steal it
tieBandPx:       10,      // within this, nearer-camera node wins
highlightSwell:   1.6,    // scale multiplier on the acquired node (reuse focus curve)
ringOpacity:      0.9,
// free rotation profile (neural scene)
pitchClampFree:   1.65,   // rad (~±94.5°); replaces the ±1.1 category clamp
magnetStrength:   3.2,    // torque toward centering the nearest node
magnetSpeedGate:  1.4,    // rad/s; above this the magnet fades to zero (don't fight flicks)
magnetMaxPull:    0.35,   // hard cap on magnet angular accel
// confirm
confirmTravelMax: (reuse tap travel from base FEEL),
dwellEnabled:     false,  // optional hands-free secondary
dwellMs:          520,
// supersede
select.maxDepth:  Infinity  // Infinity = full tree; 1 = P5 two-level cap
```

All on leva sliders. Telemetry: highlighted node id/tier, its px distance from center, current
depth, and whether the magnet is active. The magnet's live torque is worth showing while tuning.

---

## 6. Reconciling ORB_ZOOM_SPEC.md — zoom decouples from drilling

The zoom spec made two-handed zoom *drive* the drill (`zoomCommitsDrill: true`). **This spec
supersedes that.** With drilling now owned by point-and-confirm, and the user's directive that
zoom be "free and unlimited":

- **`zoom.zoomCommitsDrill` → false, permanently in the neural scene.** Zoom is a pure camera
  dolly: pull hands toward you = camera in, push = camera out. No commit thresholds, no
  re-latching, no cooldown; those parts of the zoom spec's §3 are inert here.
- **Widen the dolly clamps** (zoom spec `zoomMin/zoomMax`) so zoom feels unbounded within
  reason; keep gentle limits only to prevent clipping through the anchor or losing the field
  entirely.
- Zoom and rotation are now both **analog and free**; selection is the single **explicit**
  pointed action. That separation is the point — everything continuous is unconstrained,
  everything committing goes through the crosshair.

If the zoom spec isn't built yet, implement its Z1/Z2 (two-hand tracking + continuous dolly) and
**skip Z3** (commit → drill) entirely.

---

## 7. Harness + tests — mostly camera-free

Highlight and rotation are deterministic given a rotation state, so most of this tests without a
webcam. Confirm reuses the existing tap harness. `tests/pointing.test.ts`:

1. **highlightArgmax** — for 200 random rotation states, the highlighted node equals the analytic
   nearest-projected targetable node within `acquireRadius`, or none when all are outside it.
2. **hysteresis** — sweep rotation slowly past two close nodes; assert the highlight switches at
   most once and never oscillates within the `switchMargin`/`releaseRadius` band.
3. **tolerance** — a node just outside `acquireRadius` is not highlighted; nudged just inside, it
   is.
4. **depthTie** — two nodes projecting within `tieBandPx` of center; assert the nearer-camera one
   is chosen.
5. **skipStructural** — a non-targetable structural node dead-center is never highlighted; the
   nearest targetable node is chosen instead (or none).
6. **reachability** — every targetable node can be brought within `acquireRadius` of center for
   some (yaw, pitch) inside the free clamp — nothing is unreachable.
7. **magnetLowSpeed** — near a node at low angular speed, the magnet reduces center-offset over
   time (converges); **magnetHighSpeed** — at flick speed the magnet's contribution is < a few %
   of velocity (doesn't fight the throw).
8. **confirmRouting** — tap on a report-leaf emits report-open with the correct FocusRef; tap on
   an internal node emits drill-in to it; tap on the anchor emits drill-out; each verified
   against the P5 transition contract.
9. **zoomDecoupled** (regression on §6) — two-hand zoom over the full range emits zero drill
   events; drilling only ever comes from a confirm.
10. **frozenGlobe** — `?scene=globe` still detents and selects by rotation; its original tests
    pass untouched.

Screenshot the acquired-highlight state (ring + swell + crosshair tighten) and a post-confirm
drilled state via the dev harness.

---

## 8. Build order and gates

**Slice PT1 — crosshair + highlight (read-only).** Fixed crosshair, projection, nearest-within-
tolerance, hysteresis, targetable-node filter (§2), the three visual states. No selection, no
rotation change yet — rotation still detents as it does today; you're only overlaying the sight
and highlight so it can be judged in isolation.
*Machine gate:* tests 1–5 green; screenshot of an acquired highlight; 60 fps held.
*Human gate:* does the sight feel right at that size, is acquisition responsive, does the ring
read as "grabbable," does hysteresis kill the flicker. Tune `crosshairSize / acquireRadius /
releaseRadius / switchMargin`.

**Slice PT2 — free rotation + magnetic targeting.** Swap the neural scene onto the free profile:
remove detents, relax the pitch clamp, add the speed-gated magnet. Globe keeps its profile.
*Machine gate:* tests 6, 7 green; frozen-layer `git diff` empty on the integrator (profile, not
fork); globe tests green.
*Human gate:* **the feel gate.** Is free rotation pleasant without detents; does the magnet help
you hold a node without feeling sticky or fighting flicks; is the relaxed pitch reachable and not
disorienting. Tune `magnetStrength / magnetSpeedGate / magnetMaxPull`.

**Slice PT3 — confirm + zoom decouple.** Pinch-tap routing (drill-in / drill-out / report-open,
§2–§4), Escape/Backspace back, and the ORB_ZOOM reconciliation (§6). Full loop live.
*Machine gate:* tests 8, 9, 10 green; end-to-end screenshots of point→confirm→drill and a
report open; zoom emits no drills.
*Human gate:* the whole thing in the hand. Symptom → slider guide, at least: "highlights the
wrong node in a cluster → lower `acquireRadius` or raise `switchMargin`"; "highlight flickers →
widen `releaseRadius`"; "hard to hold a small node → raise `magnetStrength`"; "magnet fights my
flicks → lower `magnetSpeedGate`"; "confirm sometimes rotates instead of selecting → lower
`confirmTravelMax`". Put `select.maxDepth` (full-tree vs two-level) and the anchor-as-back choice
in front of the human explicitly.

---

## 9. Do not

Base spec §13, grab spec §8, zoom spec §8 (except the §6 supersessions here), plus:
- Do not let the crosshair track the hand — it is fixed at center, always.
- Do not select by pinpoint ray; nearest-within-tolerance with hysteresis only.
- Do not highlight structural (non-targetable) nodes.
- Do not restore detents to the neural scene, and do not fork the integrator — free vs detent is
  a FEEL profile.
- Do not let zoom drill in this scene; drilling is point-and-confirm only.
- Do not make dwell the primary confirm; it's an optional, default-off secondary.
- Do not reimplement the drill transition — reuse P5's, generalized to any internal node.
- Do not change the globe scene's model; it is the reference build.
