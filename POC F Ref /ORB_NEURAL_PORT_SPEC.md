# ORB_NEURAL_PORT_SPEC.md — Port & Reconciliation Spec

Directs the port of the Figma Make neural prototype into the existing orb shell codebase.
Reads alongside ORB_BUILD_SPEC.md, ORB_GRAB_SPEC.md, and ORB_NEURAL_SPEC.md. **Where this
document conflicts with ORB_NEURAL_SPEC, this document wins** — it incorporates design
decisions made during the Figma Make iterations that postdate that spec (§3).

---

## 0. INVARIANTS — read first, violate never

These are frozen. If any task in this document appears to require changing them, the task
is wrong, not the invariant. Stop and flag instead.

**FROZEN — zero changes:**
- The gesture machine (pure function), its recognition logic, and every existing harness
  scenario including `fistPassThrough`
- The input bus abstraction and MediaPipe + One Euro pipeline
- The physics integrator, its constants, and its behavior: grab-couple via palm-normal
  basis, fist-brake, zero-g drift with no self-settle, pinch-flick, thrown-vs-placed split
- Every DOM control, button, panel, and the entire dashboard layer — not one line changes
- The report-open event contract: same event, same payload shape, fired on selection

**REPLACED — this is the entire visible diff:**
- The rendered interactive object: globe out, neural star-network in. Reports are nodes.

**EXTENDED, not altered:**
- Selection gains the recursive two-level model (ORB_NEURAL_SPEC §6: anchor + active
  shell, drill-in/out). It reuses existing gestures only. No new gesture primitives; no
  changes to how any existing gesture is recognized. Machine-checkable: Slice N4/N5 gates
  require zero diffs under the gesture-machine source tree.

A user who learned the globe version must need zero relearning beyond "it looks
different and categories drill in."

---

## 1. Transfer package — files to place in the repo

Create `/reference/` in the project root with exactly this:

```
/reference/
  figma-make-build/
    src/App.tsx            ← REQUIRED, NOT YET PROVIDED. ~550 lines; the entire
                              prototype lives here. Ground truth for every value
                              in this document. Export it from Figma Make.
    src/main.tsx           ← required (trivial, but completes the pair)
    src/index.css          ← required if it contains anything beyond Tailwind import
    package.json           ← provided (dependency versions: three ^0.185.1, React 19)
    vite.config.ts         ← provided (provenance only)
    tsconfig.json          ← provided (provenance only)
    index.html             ← provided (provenance only)
    AGENTS.md              ← provided (provenance only; Make scaffold docs)
  images/
    make-screenshot-1.png  ← provided (wide field view)
    make-screenshot-2.png  ← provided (center/brain view)
    original-ref-1.png     ← the two original neuron reference images
    original-ref-2.png
  FIGMA_MAKE_HANDOFF.md    ← provided (Make's self-description of its build)
  REFERENCE.md             ← one paragraph: "App.tsx is ground truth. The handoff
                              doc is a map of it. Where they disagree, code wins."
```

Specs go at the project root alongside the existing ones:

```
ORB_BUILD_SPEC.md          (existing)
ORB_GRAB_SPEC.md           (existing)
ORB_NEURAL_SPEC.md         (existing — superseded in part by the file below)
ORB_NEURAL_PORT_SPEC.md    (this file)
```

**Do NOT port from the scaffold files.** pnpm-lock.yaml, the Figma vite plugins, Tailwind
v4, React 19, and the Make project structure are Make-environment artifacts. The target
project keeps its own Vite/R3F/leva toolchain. The only dependency fact worth noting:
the prototype runs on three ^0.185 — APIs used (Sprite, TubeGeometry,
QuadraticBezierCurve3) are stable and portable.

### Step zero for Claude Code

Before any Slice work: open `/reference/figma-make-build/src/App.tsx` and verify every
constant in §5 of this document against it. The handoff doc was written by the prototype
about itself and has not been independently verified. Any mismatch: the code wins, update
the config default, and note the correction in a `PORT_LOG.md`. If App.tsx is absent,
stop and ask for it — do not proceed on handoff values alone.

---

## 2. What the prototype is (verified against screenshots)

A full-window Three.js scene: black clear color, deep blue field wash plane, one warm
amber contamination glow, ~20 hub star-systems on a shell of R=1100, four-tier hierarchy,
thin bright bezier filaments, bokeh foreground/background discs. Nodes are **flat
luminous star-discs** — solid body-color disc, bloom ring, wide faint corona, white
pinpoint — not glass spheres. The brain is a violet starburst at origin. Camera fixed at
z=2000, FOV 52°; the scene group rotates with drag + momentum (damp 0.94 — matching the
existing physics profile's register). Rendering is sprite-per-node with cloned materials;
per-frame JS loops set depth opacity. It looks right and performs wrong — the port keeps
the look and replaces the machinery.

---

## 3. Reconciliation — what supersedes ORB_NEURAL_SPEC

Deviations recorded in the handoff §7, classified. "ADOPT" = the deviation was design
direction during Make iteration and becomes the spec. "RESTORE" = the deviation was a
prototype shortcut; the original spec intent still stands and the port must close the gap.

| # | Deviation | Ruling |
|---|---|---|
| 7.1 | Glass shell → flat solid star-disc | **ADOPT.** Explicit direction ("solid colors, like real-life accurate stars"). ORB_NEURAL_SPEC §5.1's five-layer glass recipe is replaced by the four-layer star recipe in §4 below. `mid`/`deep` palette tokens remain defined but unused by node rendering. |
| 7.2 | R 420 → 1100, camera z 2000, FOV 52° | **ADOPT** as config defaults. Tuned for screen fill. |
| 7.3 | 8 hubs → 20 | **ADOPT** as default `neural.hubCount = 20`. Note §7 selection implication. |
| 7.4 | Tightened branch radii | **ADOPT** as defaults (values in §5). |
| 7.5 | Manual projection → PerspectiveCamera | **ADOPT.** Was always the intended real-3D form. |
| 7.6 | 5 depth bands → continuous smoothstep opacity only; no desat, no blur | **ADOPT** the continuous smoothstep (floor 0.30). Desaturation and softness land as config-gated options, default **off**, decided at the Slice P4 human gate. The 0.30 floor demonstrably carries the depth read in the screenshots. |
| 7.7 | Tapered ribbon → constant-radius tube | **RESTORE taper.** Star aesthetic doesn't excuse constant width; the reference images taper. Implement as radius function along the tube path. |
| 7.8 | No per-trail depth attenuation | **RESTORE.** Handoff itself calls this "the most visible visual gap." Trails must dim with their child node's depth. Shader-side (§4.3), not per-frame JS. |
| 7.9 | Junction beads skipped | **RESTORE**, config-gated default on; Chanel-gate it in the polish slice. |
| 7.10 | Traveling pulses skipped | Config-gated per original spec, default on for brain→hub only. |
| 7.11 | Brain visually indistinct from a hub | **RESTORE dominance, redesign the means.** See §6 — this one matters for selection, not just looks. |
| 7.12 | Grain overlay skipped | Config-gated, default on at 3%, Chanel-gated. |

ORB_NEURAL_SPEC sections affected: §5.1 (node recipe → §4 here), §5.3 (depth → smoothstep
model here), §3 table values (→ §5 here), §2 note that `mid`/`deep` are reserved, and the
brightness-monotonicity gate (→ §6 anchor-dominance gate here). Everything else in
ORB_NEURAL_SPEC — §4 physics retarget, all of §6 selection, §7 config discipline, §8
harness scenarios 1–10, §10 slices — stands unchanged.

---

## 4. Rendering port — the star recipe as instanced shaders

The prototype's per-sprite materials and per-frame JS loops are disqualified by handoff
§8 (do-not-copy list: hand-rolled geometry merge, per-frame getWorldPosition × 250,
~250 cloned SpriteMaterials, fixed-resolution baked canvas textures, global trail
opacity). The port renders the same pixels with correct machinery:

### 4.1 Nodes — one instanced draw

Single instanced camera-facing quad geometry; per-instance attributes: position, tier
scale, hue (palette index into a uniform array), the three tier opacities, isBokeh flag,
selection/affordance state. Fragment shader reproduces the baked texture analytically
(resolution-independent — fixes handoff 8.4). With `dr = 0.15` in quad UV-radius terms:

| Layer | Geometry | Stops (position → alpha, in the layer's color) |
|---|---|---|
| corona | annular gradient, inner `dr×1.2`, outer `0.49` | `halo`: 0.0 → haloOpa×0.28, 0.4 → haloOpa×0.10, 1.0 → 0 |
| bloom | annular gradient, inner `dr×0.8`, outer `dr×2.8` | `body`: 0.0 → bloomOpa×0.50, 0.5 → bloomOpa×0.18, 1.0 → 0 |
| disc | solid circle, radius `dr` | `body` at coreOpa, hard edge (≤1px AA) |
| pinpoint | solid circle, radius `max(dr×0.22, 1px)` | white at min(1, coreOpa×0.85) |

No gradient on the disc. No specular. No rim. The flat disc against the soft corona IS
the star look — resist the urge to "improve" it back into a sphere.

Additive blending, depthWrite off, depthTest off (scene is all-additive; note handoff
8.7 if opaque elements ever enter). Depth opacity is computed **in the vertex shader**
from the instance's world z (fixes 8.2/8.3): `zNorm = clamp((wz + 1650)/3300, 0, 1)`,
`depthOpa = 0.30 + 0.70·smoothstep(zNorm)`, multiplied into all four layers. Bokeh
instances override `depthOpa = 0.22` and scale ×10 (vs normal ×4.2 of tier diameter).

Machine gate: all non-brain nodes in ≤ 2 draw calls; zero per-frame JS iteration over
nodes for rendering purposes.

### 4.2 The brain/anchor — the one bespoke object

Same star shader family, violet, plus the dominance treatment in §6. May be its own
draw call. Carries the ambient pulse: scale 1.00→1.06, ~4.4s period (prototype:
+0.003/frame), driven by clock uniform, not JS scaling.

### 4.3 Trails

Keep: QuadraticBezierCurve3 per trail; surface-to-surface endpoints (offset each end by
the node's nominal radius along the chord); control point at mid + perpendicular ×
chordLen × 0.10, sign deterministic from child φ/θ (`sin(φ×7.3 + θ) > 0`); two passes
(core + glow at 3.2× radius); the vertex-color gradient program exactly as the handoff
gives it — brain trails run `trail/hot` for the first 15% of t, everything lerps through
`trail/base` at t=0.40 to the child's body color; glow pass = plain parent→child lerp
× 0.55.

Replace: constant-radius TubeGeometry → a single merged (or instanced-segment) ribbon
with **taper** — radius peaks at both endpoints (junction swell), minimum at t≈0.5,
suggested profile `r(t) = rBase × (0.55 + 0.45·|2t−1|^1.5)` as the starting leva value —
and **per-vertex depth attenuation** using the same zNorm curve, so a trail dims into
the distance with its child (closes 8.5). Core pass base opacity 0.72, glow 0.22, times
depth. `TRAIL_RAD` by parent tier: brain 1.8, hub 1.1, node 0.65, sub 0.35, default 0.30.

Junction beads: tiny white instances (from the node instancing system, pinpoint-only
mode) at trail endpoints, config-gated.

### 4.4 Environment

Field wash: 7000×5000 plane at z=−1200, outside the rotating group, radial texture
`rgba(10,24,48,0.88)` center → `rgba(6,14,28,0.60)` at r=0.55 → transparent. Warm
contamination: 2800×2200 plane at (−550, 350, −1100), `rgba(60,22,8,0.55)` →
`rgba(30,10,4,0.22)` at r=0.5 → transparent. Both additive, both static. Grain: 3%
config-gated post pass. Pixel ratio capped at 2.

---

## 5. Constants → config keys

Every value below enters the single feel-config object as a leva-wired default.
**Status U = unverified against App.tsx** (source: handoff only) — step zero clears
these. Nothing here may be hardcoded at the use site.

| Config key | Default | Status |
|---|---|---|
| `neural.seed` | 20260901 | U |
| `neural.hubCount` | 20 | U |
| `neural.R` | 1100 | U |
| `neural.hubRadial` | [0.90, 1.10] ×R | U |
| `neural.hubJitter` | φ ±0.20, θ ±0.30 rad | U |
| `neural.nodeRadial` | [1.10, 1.28] ×parent | U |
| `neural.nodeJitter` | ±0.22 rad | U |
| `neural.subRadial` | [1.06, 1.18] ×parent | U |
| `neural.subJitter` | ±0.28 rad | U |
| `neural.terminalRadial` | [1.04, 1.12] ×parent | U |
| `neural.terminalJitter` | ±0.38 rad | U |
| `neural.redProbability` | 0.15 | U |
| `render.tierDiam` | brain 85 (see §6), hub 104, node 56, sub 30, terminal 13 | U |
| `render.spriteScale` | 4.2 | U |
| `render.bokehScale` | 10 | U |
| `render.bokehCount` | 10 | U |
| `render.bokehOpacity` | 0.22 | U |
| `render.tierOpa` | table in §4.1 / handoff §2 | U |
| `render.grainAmount` | 0.03, gated | U |
| `depth.range` | ±1.5 ×R | U |
| `depth.opacityFloor` | 0.30 | U |
| `depth.desatStrength` | 0 (gated off) | — |
| `trail.coreOpacity` | 0.72 | U |
| `trail.glowOpacity` | 0.22 | U |
| `trail.glowRadiusMult` | 3.2 | U |
| `trail.bendFraction` | 0.10 | U |
| `trail.taperProfile` | (0.55, 1.5) — new, no prototype value | — |
| `trail.pulseEnabled` | true, brain→hub only | — |
| `trail.beadsEnabled` | true | — |
| `camera.z` | 2000 | U |
| `camera.fov` | 52 | U |
| `scene.initialPitch` | −0.18 rad | U |
| `scene.pitchClamp` | ±1.1 rad | U |
| `brainPulse` | rate 0.003/frame, amp 6% | U |

Selection keys from ORB_NEURAL_SPEC §7 (`select.*`) are unchanged and additive to this.

**Input-adjacent values need care:** the prototype's drag sensitivity (0.006 rad/px) and
damping (0.94) belong to *its* mouse-orbit code, which is on the discard list — the
target uses the existing physics integrator untouched (Invariants). Damping happens to
match; treat that as a nice confirmation of feel, not something to port.

**RNG caveat (handoff 8.8):** the seed reproduces a layout only for a fixed
(hubCount, branch ranges, traversal order) tuple. The ORB_NEURAL_SPEC "same seed →
byte-identical layout" gate is hereby scoped: identical **per config tuple**. Changing a
generation slider legitimately produces a new layout; the debug overlay must display
seed + a hash of the generation-config tuple so any layout remains reproducible.

---

## 6. The brain problem — must fix, affects selection

In the prototype the brain is diameter 85 vs hubs at 104 — smaller and visually
indistinct from a hub (handoff 8.6, confirmed in screenshot 2 where the violet
starburst reads as "one more star"). Under the recursive selection model this is not
cosmetic: **the center anchor is the drill-out target and the user's "you are here"
landmark.** An anchor that doesn't dominate breaks navigation legibility.

The old fix (convolution ribbons, glass cortex) died with the glass aesthetic. The new
dominance treatment must be native to the star language:

1. `render.tierDiam.brain` default rises to ~180 (leva-tuned at the gate)
2. Corona radius multiplier ~1.6× the standard recipe
3. **Diffraction spikes** — 4 long + 4 short cross-spikes in the fragment shader,
   violet-white, the classic bright-star signature. Consistent with "real-life accurate
   stars," unique to the anchor role, and cheap.
4. When a hub holds the anchor role after drill-in, it inherits the treatment (spikes +
   corona boost + pulse) for as long as it is the anchor — the treatment marks the
   *role*, not the brain object.

The ORB_NEURAL_SPEC brightness-monotonicity gate is restated: **luminance monotonic in
tier among shell members; the current anchor strictly out-luminates everything.**

---

## 7. Selection-layer notes specific to this build

- 20 hubs on the shell is roughly the old latitude-band item density — good news: the
  reticle disambiguation function faces the same candidate spacing the globe did.
  `resolveReticle` and scenarios 1–10 apply as written.
- Terminals at up to ~1.43R with tightened clustering means child shells (after drill-in)
  are compact around their hub; `select.recenterDuration` (650ms default) and the child
  re-shell radius will need a leva pass at the Slice P5 human gate.
- The prototype has **no selection code at all** — nothing to port, nothing to fight.
  The affordance rendering (halo lift on reticle candidate) rides the instanced
  attributes from §4.1.

---

## 8. Build slices

Replaces ORB_NEURAL_SPEC §10's N-slices (same philosophy, resequenced for the port).
Machine gates scriptable; human gates = person + running app + leva.

**P0 — reference in place.** Transfer package per §1 complete, App.tsx present, step-zero
verification done, PORT_LOG.md records corrections. *Machine:* every U-flagged constant
either confirmed or corrected.

**P1 — one star.** Instanced node shader, single hub-tier blue star on black + field
wash. *Machine:* 60fps, shader compiles, one draw call. *Human:* side-by-side vs
make-screenshot-1 at matched zoom — flat disc, soft corona, white pinpoint; NOT a
gradient sphere.

**P2 — the population.** Full generator with §5 defaults, instancing, bokeh, depth
opacity in-shader. *Machine:* same config tuple + seed → identical layout hash; ≤2 draw
calls for non-brain nodes; zero per-frame JS node loops. *Human:* screenshots
reproduce the prototype's field character (density, red salting, bokeh depth).

**P3 — trails.** Bezier ribbons with taper + per-vertex depth, vertex-color program,
beads. *Machine:* every non-brain element exactly one incoming trail; trail draw calls
≤4. *Human:* trails dim into the distance with their nodes (the prototype's known gap —
compare and confirm the port is *better* here, not identical).

**P4 — anchor + environment.** Brain dominance treatment (§6), warm glow, grain,
pulses; desat/softness options evaluated. *Machine:* anchor luminance gate. *Human:*
brain unmistakable in a 1-second glance from any rotation; scene doesn't blow out near
center (white-pixel gate from ORB_NEURAL_SPEC §5.2 applies).

**P5 — physics + selection.** Constellation quaternion driven by existing physics;
active shell, resolveReticle, drill-in/out with anchor-role handoff, latch. *Machine:*
all original harness scenarios + neural scenarios 1–10 green; **zero diffs under gesture
machine and physics source**; report-open event payload byte-compatible with the globe
build. *Human:* the invariant sentence — a globe user needs zero relearning; drill-in
reads as flying into a star system.

**P6 — Chanel pass.** Toggle each gated feature (beads, pulses, grain, desat) off/on in
leva; anything not missed defaults off.

---

## 9. Discard list — explicitly dead code

From the Make build, do not port under any framing: the mouse drag-orbit handler and its
sensitivity constants; per-sprite cloned materials; per-frame getWorldPosition depth
loop; hand-rolled mergeBufferGeometries; baked canvas texture generation; the React/Vite
scaffold, Figma plugins, Tailwind setup, and AGENTS.md conventions. If a port task seems
to need one of these, the §4 shader-side equivalent is the answer.

---

## 10. Open items for the human (decide at gates, not before)

1. Brain diameter and spike length (P4 gate, leva).
2. Desaturation/softness at depth on or off (P4 gate — the prototype argues off).
3. Beads and grain survive the Chanel pass or not (P6).
4. Child-shell radius after drill-in (P5 gate).
