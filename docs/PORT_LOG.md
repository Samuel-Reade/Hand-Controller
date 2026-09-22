# PORT_LOG.md

Log of corrections and findings from the neural port. Started at Slice P0.

---

## P0 — 2026-09-01 — transfer package + step-zero verification

Transfer package assembled under `/reference/` per ORB_NEURAL_PORT_SPEC.md §1.
Source: `~/Desktop/POC F Ref /Build 3D Prototype/` (Figma Make export).
`/reference/figma-make-build/src/App.tsx` verified byte-identical to the export.
Image mapping: Make screenshots 7.07.50 PM → `make-screenshot-1.png` (wide field),
7.08.03 PM → `make-screenshot-2.png` (center/brain — matches spec §3's note that
the brain reads as "one more star" against the brighter foreground hubs);
`src/imports/` screenshots 5.54.03 / 5.54.12 PM → `original-ref-1/2.png`.

### Step-zero verification — §5 U-flagged constants vs App.tsx

Every U-flagged value checked against `/reference/figma-make-build/src/App.tsx`.

| Config key | Spec default | App.tsx evidence | Verdict |
|---|---|---|---|
| `neural.seed` | 20260901 | `makeRng(20260901)` L54 | CONFIRMED |
| `neural.hubCount` | 20 | `HUBS = 20` L66 | CONFIRMED |
| `neural.R` | 1100 | `R = 1100` L33 | CONFIRMED |
| `neural.hubRadial` | [0.90, 1.10]×R | `R * rng(0.90, 1.10)` L70 | CONFIRMED |
| `neural.hubJitter` | φ ±0.20, θ ±0.30 | L68–69 | CONFIRMED |
| `neural.nodeRadial` | [1.10, 1.28]×parent | L75 | CONFIRMED |
| `neural.nodeJitter` | ±0.22 rad (φ and θ) | L74 | CONFIRMED |
| `neural.subRadial` | [1.06, 1.18]×parent | L80 | CONFIRMED |
| `neural.subJitter` | ±0.28 rad | L79 | CONFIRMED |
| `neural.terminalRadial` | [1.04, 1.12]×parent | L85 | CONFIRMED |
| `neural.terminalJitter` | ±0.38 rad | L84 | CONFIRMED |
| `neural.redProbability` | 0.15 | `pick(0.15)` L58 | CONFIRMED |
| `render.tierDiam` | 85/104/56/30/13 | `TIER_DIAM` L15–17 | CONFIRMED (prototype brain=85; port default rises to ~180 per §6 — a deliberate spec change, not a prototype value) |
| `render.spriteScale` | 4.2 | L284 | CONFIRMED |
| `render.bokehScale` | 10 | L284 | CONFIRMED |
| `render.bokehCount` | 10 | L92–94 (every ⌊N/10⌋-th terminal, ≤10) | CONFIRMED |
| `render.bokehOpacity` | 0.22 | L473 | CONFIRMED |
| `render.tierOpa` | §4.1 / handoff §2 table | `TIER_OPA` L20–26; layer stops L129–153 | CONFIRMED (all four layer recipes match exactly: corona dr×1.2→SIZE×0.49 stops 0/0.4/1 at ×0.28/×0.10/0; bloom dr×0.8→dr×2.8 stops 0/0.5/1 at ×0.50/×0.18/0; disc solid coreOpa; pinpoint max(1, dr×0.22) white ×0.85) |
| `render.grainAmount` | 0.03, gated | not in prototype (handoff 7.12) | N/A — port-added default stands |
| `depth.range` | ±1.5×R | `(z + R*1.5)/(R*3)` L469 | CONFIRMED |
| `depth.opacityFloor` | 0.30 | `0.30 + 0.70*smoothstep` L476 | CONFIRMED |
| `trail.coreOpacity` | 0.72 | L383 | CONFIRMED |
| `trail.glowOpacity` | 0.22 | L397 | CONFIRMED |
| `trail.glowRadiusMult` | 3.2 | L317 | CONFIRMED |
| `trail.bendFraction` | 0.10 | L187 | CONFIRMED |
| `camera.z` | 2000 | L209 (near 1, far 20000, L208) | CONFIRMED |
| `camera.fov` | 52 | L208 | CONFIRMED |
| `scene.initialPitch` | −0.18 rad | L214 | CONFIRMED |
| `scene.pitchClamp` | ±1.1 rad | L432, L460 | CONFIRMED |
| `brainPulse` | rate 0.003/frame, amp 6% | L455, L485–487 | CONFIRMED with correction C1 below |

Trail structure also confirmed against §4.3: TRAIL_RAD 1.8/1.1/0.65/0.35, default
0.30 (L29–31, `?? 0.3` L315); surface-offset endpoints by TIER_DIAM/2, skip when
chord < 1 (L308–313); ctrl-point sign `sin(φ×7.3 + θ) > 0` with perp = chord×(0,1,0),
fallback chord×(1,0,0) when degenerate (L183–187); core 18×5 segs, glow 12×5
(L176, L190, L317); vertex-color program incl. brain-trail hot ramp t<0.15 and
base at t=0.40 (L327–348); glow = parent→child lerp ×0.55 (L346). Environment
confirmed against §4.4: field wash 7000×5000 @ z=−1200 outside sceneGroup, stops
0.88/0.60@0.55/0 (L161–170, L222–224); warm plane 2800×2200 @ (−550, 350, −1100),
stops 0.55/0.22@0.5/0 (L227–242); pixel ratio cap 2 (L202). Discard-list values
confirmed as documented (drag 0.006 rad/px L430, DAMP 0.94 L419, initial vel
0.0025/0.0004 L418) — not ported, per Invariants.

### Corrections (code wins)

**C1 — brain pulse period: handoff's "~4.4 s" is wrong.** Rate (+0.003/frame) and
swing (scale 1.00→1.06, L485) are confirmed, but sin(pulseT) with +0.003/frame has
period 2π/0.003 ≈ 2094 frames ≈ **35 s at 60 fps**, not 4.4 s. The §4.2 "~4.4s
period" annotation is corrected to ~35 s; the config default stays `rate
0.003/frame, amp 6%` (matches code). If a ~4.4 s feel is ever wanted, that's a
leva decision at the P4 gate, not a port fact.

**C2 — runtime whole-sprite opacity multiplier missing from §4.1.** The prototype's
final per-sprite opacity is `depthOpa × haloOpa × (brain ? 1.0 : 0.95)` (L479–480),
applied to the whole sprite on top of the per-layer alphas already baked into the
texture. So effective disc alpha = coreOpa × haloOpa × tierMult × depthOpa, etc.
The §4.1 instanced shader must include this extra ×haloOpa×tierMult factor on all
four layers or every tier renders brighter than the prototype (terminals ~5× too
bright). Bokeh also receives it on top of the fixed depthOpa 0.22.

**C3 — branch-count ranges absent from the §5 config table.** `buildGraph` draws
child counts per level (L72, L77, L82): nodes/hub `round(uniform(2,5))`, subs/node
`round(uniform(1,4))`, terminals/sub `round(uniform(0,3))` (endpoints half-weighted
by the rounding). These are part of the generation-config tuple the layout hash
depends on (§5 RNG caveat), so they become config keys:
`neural.nodesPerHub = [2,5]`, `neural.subsPerNode = [1,4]`,
`neural.terminalsPerSub = [0,3]`, all as round(uniform(a,b)).

### Reproducibility facts (required for the P2 layout-hash gate)

- RNG: LCG `s = (imul(s, 1664525) + 1013904223) >>> 0; s / 2^32` (L37–44).
- Consumption order: brain consumes **zero** draws (violet ternary short-circuits
  `pick`). Per hub: φ jitter, θ jitter, radial, hue pick; then child-count draw;
  per child: φ jitter, θ jitter, radial, hue pick — strict DFS (L64–89).
- Hub base distribution: Fibonacci sphere — φ = acos(1 − 2(i+0.5)/N),
  θ = π(1+√5)·i, before jitter (L68–69).
- Spherical → cartesian is y-up: x = r·sinφ·cosθ, y = r·cosφ, z = r·sinφ·sinθ
  (L249–256).
- Bokeh flags: every ⌊N_terminals/10⌋-th terminal **in creation order**, up to 10
  (L92–94). The code comment says "deep" terminals; selection is order-based, not
  depth-based.

### Notes

- Spec-name aliasing: the port spec's "ORB_NEURAL_SPEC.md" is
  `/docs/FIGMA_NEURAL_ORB_SPEC.md` (the handoff references it by the bare
  name). Not renamed; treat as the same document.
- `ORB_GRAB_SPEC.md` is referenced as existing but is not present in the repo.
  Flagged for the human; does not block P0–P4.
- `index.css` contains height rules beyond the Tailwind import, so it is included
  in the transfer package per §1's condition.

---

## P1 — 2026-09-01 — one star

Machine gates green: shader compiles, 60 fps, the star system renders in one
instanced draw call (2 total scene draws = field wash + stars), zero page
errors. Verified via Playwright against the dev server
(`?scene=neural&tune=0&chrome=0`); the neural scene is dev-gated behind
`?scene=neural` until Slice P5 promotes it, so the globe build and every
frozen layer are untouched (`git diff` on gesture/physics/DOM trees: empty).

**C4 — color-management parity (extends C2).** The prototype's canvas
textures were uploaded without sRGB decode and converted linear→sRGB at
output, so every star renders as the OETF-brightened version of its hex
token. Verified numerically: make-screenshot-1's hub disc samples
rgb(142,204,255), exactly OETF(#4DA8FF)·opacity; the port reproduces it with
`#include <colorspace_fragment>` in the star and wash shaders (measured
rgb(124,184,235) at depthOpa 0.65 - the predicted value). Trails (P3) take
the OTHER path: the prototype fed them THREE.Color values, which round-trip
sRGB→linear→sRGB and render as-authored - so trail colors must NOT get the
extra brightening. R3F's default ACES tone mapping is disabled (`flat`) in
the neural scene; the prototype had none.

**C3 amendment - branch counts are re-drawn every loop iteration.** The
prototype's `for (let j = 0; j < Math.round(rng(2, 5)); j++)` evaluates
`rng` in the loop CONDITION - one fresh draw per iteration check, not one
count draw per parent. C3's config keys stand, but their semantics are
"per-check re-drawn bound," and the port replicates the construct verbatim
(src/neural/graph.ts). Byte-identical layouts depend on it.

**P0 note correction.** P0 assumed root-level FIGMA_NEURAL_ORB_SPEC.md was
the port spec's "ORB_NEURAL_SPEC.md" under another name. It is not - it is
the Figma-side design spec (no §6 selection model, no harness scenarios
1-10, no `select.*` keys). ORB_NEURAL_SPEC.md and ORB_GRAB_SPEC.md are
genuinely absent from the repo and unfindable on this machine. P1-P4 are
unaffected (the port spec is self-contained for rendering); P5's selection
layer (resolveReticle, neural scenarios 1-10, `select.*` defaults) needs
that document or a human decision at the P5 gate.

Housekeeping: `reference/` and the user-moved `POC F Ref /` are excluded
from oxlint; `src/neural/**` joins Orb.tsx in the react(immutability)
override (mutate-in-place is the mandated S6/leva pattern).

---

## P2 — 2026-09-01 — the population

Machine gates green: same config tuple + seed → identical layout hash
(650ce55b at defaults, stable across reloads and in tests); all non-brain
nodes in ONE instanced draw call (gate allowed ≤2; scene total is 3 = wash +
stars + brain); zero per-frame JS iteration over nodes (the frame loop only
syncs O(1) uniforms). 60 fps at 455 nodes on the real GPU (ANGLE/Metal,
Apple M4) - plain headless Chromium reads ~40 because it rasterizes on
SwiftShader; use `--use-angle=metal` for fps gates.

**C5 — the handoff's "~250 nodes" is wrong: the true population is 455.**
Settled by ground truth: tests/neural.test.ts embeds the prototype's
makeRng + buildGraph transcribed verbatim and asserts the port matches it
node-for-node (name, tier, hue, φ, θ, r, parent) at the default config -
it passes, so the port generator is byte-exact and the prototype itself
produces 455 nodes at seed 20260901. The parity test stays as a permanent
regression guard.

Debug overlay (§5 RNG caveat): the leva `neural generation` group displays
seed · generation-tuple hash · layout hash · node count; the same values are
exposed on `window.__neuralInfo` for scripted gates. Field-character human
gate: deferred to ride along with P3's screenshots - without trails the
scene reads as bokeh blobs, which is expected, and density / red salting /
bokeh depth already match the prototype's structure.

---

## P3 — 2026-09-01 — trails

Machine gates green: exactly one incoming trail per non-brain element
(454 = 455 − 1, asserted in tests/trails.test.ts and live via
window.__neuralInfo); trail draw calls = 3 of the allowed ≤4 (merged core +
merged glow + instanced beads); 60 fps on GPU; layout hash unchanged
(650ce55b - trails don't touch generation).

Ported exactly (tested): surface-to-surface bezier endpoints, deterministic
bend sign sin(φ×7.3+θ), 10% bend fraction, TRAIL_RAD by parent tier, the
§4.3 vertex-color program including the brain-trail hot ramp, glow =
parent→child lerp × 0.55. Restored per rulings 7.7/7.8: radius taper
r(t) = rBase × (0.55 + 0.45·|2t−1|^1.5) with junction swell, and per-vertex
depth attenuation in the shader (same zNorm curve as the stars) - far-side
trails now dim to faint threads with their nodes, the prototype's known
"most visible visual gap," closed. Junction beads ride the star instancing
in pin-only mode (uPinOnly), config-gated on. Color-management split (C4)
honored: trail vertex colors take the round-trip THREE.Color path and render
as authored; sprites keep the brightened path.

Human-gate evidence: p3-trails screenshot vs make-screenshot-1 - the field
character (density, red salting, bokeh depth, radiating brain filaments)
reproduces; depth-dimming trails are visibly better than the prototype's
uniform ones, as the gate asks. Awaiting your eye at the running app.

---

## P4 — 2026-09-01 — anchor + environment

Machine gates green (scripted in scripts/verify-neural.mjs): anchor
luminance gate analytic in tests/anchor.test.ts (diam 180 ≥ 1.5× hub 104;
corona ×1.6; spikes on; peak luminance strictly above every shell tier);
60 fps at 9 draw calls (wash, warm, grain, trail core, trail glow, beads,
pulses, stars, brain); zero page errors.

**White-clip gate calibrated to the prototype.** ORB_NEURAL_SPEC §5.2 (the
original white-pixel gate) is missing, so the bound is taken from ground
truth: make-screenshot-1 measures 1.28% near-white (≥250 rgb) in the
center 500/1440-width window, make-screenshot-2 measures 1.93%. The port
measures 0.52% - 2.5× cleaner than the reference. Gate bound recorded as
≤1.28% (prototype parity) in verify-neural.mjs.

§6 dominance treatment implemented as spec'd: `render.tierDiam.brain`
port default 180 (prototype 85 kept as the tier table value; the anchor
mesh carries the role treatment), corona mult 1.6 via quad enlarge +
dr shrink, 4+4 diffraction spikes in-shader (violet-white, masked off the
disc after the first render clipped the core white - spikes emanate FROM
the core, the body color must read), ambient pulse 1.00→1.06 on a clock
uniform at the C1-corrected rate. The treatment rides material uniforms
(uAnchor/uCoronaMult/uSpikeLen), so P5's drill-in hands the role to any
node's mesh without new shader work.

Environment: warm contamination plane and 3% grain overlay (both §4.4,
grain config-gated default on per 7.12). Traveling pulses (7.10): brain→hub
only, staggered 3-5s deterministic, bezier evaluated in the vertex shader
from a clock uniform - zero per-frame JS. Desaturation option: implemented
(uDesat), default 0 per ruling 7.6. Depth *softness* (blur) is NOT
implemented - it needs a render-target post pipeline; flagged as a P4-gate
human decision (§10.2, the prototype argues off).

---

## P5 — 2026-09-01 — physics + selection (provisional pending ORB_NEURAL_SPEC.md)

Machine gates green:
- **Zero diffs under the gesture machine and physics source** - `git diff`
  on src/input, src/orb, src/ui, src/store.ts, src/data, src/config,
  src/dev and the original test files is empty. The constellation is driven
  by the untouched integrator through the frozen `useOrbPhysics` hook.
- All original harness scenarios green (67/67 tests, including the full
  gesture suite - fistPassThrough does not exist in this repo's suite;
  every scenario that does exist passes untouched).
- Report-open contract byte-compatible: the scene writes the same
  `{orbitIndex, itemIndex}` FocusRef through `store.setFocus`; the FROZEN
  App tap listener opens the panel. Verified end-to-end: tap at a level-1
  detent opened "Quality · Review Latency" with announcer, focus trap and
  Escape behavior identical to the globe build.
- End-to-end drive (scripts run against the dev server): drag → coast →
  LOCK on a detent; tap at level 0 drills in with the panel staying closed
  (focus is null at level 0, so `openFocused` no-ops and the same tap
  navigates); pitch two orbits off-band → anchor becomes the candidate →
  tap drills out; ?scene=globe still serves the globe build for
  side-by-side.

The two-level model as built: level 0's active shell is the 20 hubs -
`resolveReticle` is the globe's focus-weight argmax generalized to
arbitrary directions. Drill-in hands the anchor ROLE to the hub (spikes +
corona boost + pulse move to it; the brain drops them), recenters over
`select.recenterDuration` with a zoom push, and re-shells the category's
reports around the anchor **on the globe's own grid** (orbit latitude +
itemTheta at `select.childShellRadius`) - which is what lets the frozen
detent/step physics center reports exactly, with OrbitIndex, keyboard
steps, labels and the announcer all working unmodified.

**Assumptions made in lieu of the missing ORB_NEURAL_SPEC.md - reconcile
when it surfaces:**
1. Category mapping: hub i carries orbit (i mod 5), so every category is
   reachable from four hubs and every report stays reachable.
2. Drill-out trigger: the anchor is the reticle candidate when the best
   report w < `select.anchorWinsBelow` (default 0.92); tap then flies out.
   ("The center anchor is the drill-out target," §6.)
3. `select.*` defaults: recenterDuration 650ms (named in §7), 
   childShellRadius 260, anchorWinsBelow 0.92, affordanceLift 0.35, and a
   900wu zoom push during recenter - all leva-tunable at the P5 human gate.
4. Neural scenarios 1-10 (§8 P5 gate) live in the missing document and
   cannot be run; tests/selection.test.ts covers the port's own selection
   invariants (reticle argmax ≡ vector path, detent alignment, drill-out
   rule, full report reachability) in their place.
5. `scene.initialPitch` (-0.18) is unused as of P5 - orientation belongs
   to the physics state; dev ?yaw/?pitch params still work.

Human-gate items left deliberately at leva: drilled-anchor brightness (the
role treatment + converging report trails run hot), child-shell radius
(§10.4), recenter feel.

---

## P6 — 2026-09-01 — Chanel pass

Every config-gated feature toggles live from leva (and from the dev
`window.__nconf` handle used by the scripted pass), each verified by
pixel-diffing on/off screenshots at 2880×1800:

| Gate | Default | Pixels changed when flipped | Verdict evidence |
|---|---|---|---|
| beads (`trail.beadsEnabled`) | on | 6,454 | subtle junction sparkle; visible at trail ends |
| pulses (`trail.pulseEnabled`) | on | ~933 | 20 small dots; quiet - near the motion noise floor |
| grain (`render.grainEnabled`, 3%) | on | 48,338 | broad, faint texture across the frame |
| desat (`depth.desatStrength`) | **off** | 102,180 (0 → 0.6, pulses frozen) | strong effect when on; spec default off (ruling 7.6) |

Defaults kept exactly as the spec set them (beads/pulses/grain on, desat
off). The "anything not missed defaults off" call is §10.3's human
decision - the toggles sit in the leva `neural trail` / `neural
environment` / `neural render` groups, screenshots in the scratch p6-* set.

## Port status

P0-P6 complete. Final sweep: typecheck clean, lint clean, 67/67 tests
(gesture/physics/geometry suites untouched and green, plus neural
generator byte-parity, trails, selection, anchor gates), all
scripts/verify-neural.mjs gates PASS (60fps, 9 draw calls, layout
650ce55b stable, white-clip 0.65% vs prototype 1.28%), zero diffs under
every frozen tree. Outstanding: ORB_NEURAL_SPEC.md + ORB_GRAB_SPEC.md
remain missing (P5 assumptions flagged above); human gates P1-P6 await a
person at the running app with leva.

---

# ORB_SELECT_SPEC — Slice PT1: crosshair + highlight (read-only)

Built per ORB_SELECT_SPEC §8. Read-only by construction: the sight and the
highlight are computed and published, and drive nothing. The P5 reticle,
its detents and its drill routing are untouched, so `?scene=globe` and the
neural scene both behave exactly as before apart from the new overlay.

New: `src/neural/pointing.ts` (pure model), `src/neural/Crosshair.tsx`
(overlay), `NCONF.point` (§5 constants + leva group "neural point (PT1)"),
`tests/pointing.test.ts` (§7 tests 1–5), `scripts/verify-pointing.mjs`.

## Machine gate — PASS

Tests 1–5 green (20 assertions in `tests/pointing.test.ts`; 111 across the
suite). `node scripts/verify-pointing.mjs`: no page errors; DOM state always
agrees with the published highlight; acquired highlights are always inside
`acquireRadius`; ordinary nodes reachable by rotating; §2 filter live at 56
targetable of 455; 60fps with pointing running every frame; the globe scene
never mounts the sight (§0 scope guard). Screenshot:
`shots/point-pt1-acquired.png`.

## Two spec gaps found and resolved (both need a human ruling)

**1. §1 and §4 contradict each other at the anchor.** §1 locks "nearest
projected centre wins"; §4 locks "the anchor is always targetable". But the
anchor sits at the constellation origin, so it projects to EXACTLY screen
centre at every rotation — distance 0, forever. Read literally the anchor
wins essentially always: measured 294 of 300 random rotations, and no hub
could ever be sighted.

Resolved by making the anchor a FALLBACK rather than a competitor: it can
only be acquired when no ordinary targetable node is inside `acquireRadius`.
This is exactly the rule P5 already used at level 1
(`select.anchorWinsBelow`). Sighting the anchor to drill out still works —
you sight it by rotating so that nothing else is under the sight.

A follow-on bug from the same root: the anchor at distance 0 can never fail
the release test (`dist > releaseRadius`) and no rival can beat 0 by
`switchMargin`, so once acquired it latched permanently — measured 0 of 40
drag samples reaching any other node. The anchor is now held under the
fallback rule instead of the deadband and yields the moment a node becomes
acquirable (12 of 40 after the fix). Both are regression-tested.

**2. The report↔node binding did not exist.** §2 defines targetable in terms
of report-bound nodes and their ancestors, and flags the ~35-of-455 density
as "inherited from P5's `hub i → orbit (i mod 5)` mapping". P5 never bound
reports to graph nodes at all — it re-shelled them onto the globe grid at
level 1 — so the binding had to be written. `bindReports()` in
`pointing.ts` is the single place it lives: P5's hub→orbit mapping kept, each
report given exactly ONE host (35 bound, 56 targetable with ancestors,
matching the density the spec names), dealt round-robin across the hubs
carrying that orbit. The alternative — every report under every hub carrying
its orbit — is closer to P5's "reachable through any hub" but quadruples the
density to 140. Chosen against; flip the one function to change it.

## For the PT1 human gate

- **`acquireRadius: 46` (the §5 default) is tight for this field.** Measured
  distance from screen centre to the nearest targetable node, over 500
  rotations: p25 = 46px, median = 75px, p75 = 109px at 900px viewport
  height (55 / 90 / 131 at 1080px). So the spec default acquires on only
  ~20–25% of rotations and the anchor fallback covers the rest. Try 90–130
  on the slider. The spec value is shipped unchanged — this is the gate's
  call, not the build's.
- **PT1 is hard to judge with detents still on.** §8 says to overlay the
  sight while rotation still detents "so it can be judged in isolation", but
  the detent grid is the old globe's latitude/longitude and has nothing to
  do with where constellation nodes are — so the settled rotations land
  where nothing is targetable (22 of 26 keyboard-stepped detent positions
  fell back to the anchor). Acquisition reads well while rotating; holding a
  node under the sight is what PT2's free rotation and magnet are for. Judge
  responsiveness and flicker now; judge "can I hold it" at PT2.
- **Node swell is deferred.** §3's acquired state is ring + swell + crosshair
  tighten. Ring and tighten are in. The swell rides the `iState` instanced
  attribute, which the P5 reticle still owns at level 0 — driving it from
  pointing too would put two affordances on screen at once during PT1. It
  lands with PT3 when the reticle model retires.

---

# Camera + controls pass: external view, no drift, persistent zoom

Brief: start outside the system; hand rotate/zoom must not move the view after
release; zoom infinite within reason with no translation on disengage; rotate
to any cluster and zoom into it. Constraint: keep every hand mechanic, do not
restructure the interaction system. Decisions in docs/DECISIONS.md (same date).

## What changed (no gesture machine, arbiter, bus or integrator edits)
- `src/neural/profile.ts` (new): the neural FEEL profile - detentBelow 0,
  friction 30, forcedBoost 25, zoomPersist true, zoomCommitsDrill false,
  zoomMin/zoomMax 0.2/12. Applied at module load; globe untouched.
- `src/input/zoomView.ts`: `base` term; `applyZoomEvent` folds a released
  gesture into it when `feel.zoomPersist`; spring-back only when not.
- `src/neural/config.ts`: camera.z 4600. `src/App.tsx`: Canvas reads NCONF
  camera, far 60000, applies the profile.
- `src/neural/NeuralScene.tsx`: subscribes the integrator with
  point.pitchClampFree via the pure core's own parameter; stepPhysics gets it.
- `src/ui/FeelPanel.tsx`: friction / zoomMin / zoomMax ranges widened to the
  profile; zoomPersist toggle.
- Tests: `tests/profile.test.ts` (new, 9); `tests/zoom.test.ts` +7 for the
  persistent model, old suites pinned to spring-back. 128 total.

## Machine gate - PASS
- Unit: 128/128; typecheck + lint clean.
- `verify-neural.mjs`: all PASS; centre white-clip 0.65% -> 0.13%.
- `verify-pointing.mjs`: all PASS; ordinary acquisitions 4/26 -> 12/26.
- In-app probe (Playwright, 1440x900): camera z 4600 confirmed. Drift: hard
  flick nudged 12.50 deg within 250 ms, then 0.01 deg over the following
  1.75 s. Zoom: synthetic zoomPeekRelease held 1.273 through release and the
  1.2 s pause (spring-back would read 1.000), compounded to 1.621 on the
  harness's next gesture, level stayed 0. Screenshot
  `shots/view-external-initial.png`.

## For the human gate
- The flick is now a nudge (~10 deg for a hard throw). That is the literal
  reading of "does not move after release"; if you want more throw, lower
  rotation > friction (it is on the slider) - every step down trades back
  some post-release travel.
- From 4600 the sprites are ~2.3x smaller than before. That is what
  "outside the system" costs at rest; the persistent zoom is how you get
  back in. If the rest view feels too small, camera.z 4234 is the tightest
  fit that still shows every node.
- Pitch now reaches +/-94.5 deg; past 90 the field reads inverted, exactly
  as ORB_SELECT_SPEC §1 accepts.

---

# Visual pass: zoom-invariant glow, camera-riding backdrop, one reticle, alive via light

Brief and decisions: docs/DECISIONS.md (2026-09-09). Shader-only; the
integrator, arbiter, pointing model and P0 sizes are untouched.

## What changed
- `src/neural/starField.ts`: `iPhase` attribute; `uTime / uBreathAmp /
  uBreathPeriod / uTanHalfFov / uGlowFadeStart / uGlowFadeEnd`; `vGlow` =
  fade x breath multiplies corona + bloom alpha only. `syncStarUniforms(mat,
  timeSec?)` - beads omit the clock and stay still.
- `src/neural/trails.ts`: `aFlow` (t, phase) per vertex; flow band in the
  fragment shader; `syncTrailUniforms(core, glow, timeSec)`.
- `src/neural/NeuralScene.tsx`: backdrop planes follow the camera at their
  rest distance; clock into the syncs; sliders (neural render: glowFadeStart,
  glowFadeEnd, breathAmp, breathPeriod; neural trail: flowEnabled, flowGain,
  flowWidth, flowPeriod); DEV seam `window.__neuralDev.setZoom(f)`.
- `src/neural/config.ts`: the eight keys above + `frameFraction()` (the
  shader's fade input mirrored for tests).
- `src/App.tsx`: `{!neural && <Reticle/>}`. `scripts/interact.mjs` -> globe.
- `scripts/verify-neural.mjs`: new check - MEDIAN frame luminance (24x15
  grid) at a real 7x zoom <= 25.5/255. `tests/visual.test.ts` (new, 11).

## Machine gate - PASS
- Unit 139/139; typecheck + lint clean.
- verify-neural: all PASS incl. the new zoom check; white-clip 0.13%
  (unchanged); 9 draws; 60 fps; layout hash 650ce55b (unchanged).
- verify-pointing: 9/9 PASS; 13/26 ordinary acquisitions.
- Frame luminance /255, real zoom path, before -> after:
    six corner points   rest 4.4 -> 4.4 · 3x 46.5 -> 16.4 · 7x 69.3 -> 16.7
    grid median         rest 7.0 -> 6.9 · 3x 58.8 -> 19.1 · 7x 88.2 -> 16.2
    dark fraction <30   rest 76% -> 76% · 3x 4.2% -> 60% · 7x 0.0% -> 63%
  Gate rotation (yaw 0) at 7x: median 9.0, dark 68%, six-point 40.9 - the
  six-point figure is two fat near-camera trails on two sample points, which
  is why the gate uses the median.
- Attribution of the 7x wash BEFORE the fix (toggling subsystems):
  planes-only 47.7 · +grain 49.0 · +sprites 61.2 · trails add 0.0.
- Motion at rest, 1.5 s apart: 1.65% of pixels > 8/255, 0.010% > 40/255.

## Method notes (two own errors, both corrected)
1. The first after-measurement dollied by mutating `NCONF.camera.z`, which by
   construction pins the backdrop to its rest WORLD position - so it measured
   the planes exactly as if the fix were absent (3x 46 -> 44, 7x 69 -> 62)
   and nearly led to the wrong conclusion. Real two-hand zoom changes the
   factor with camera.z fixed; the DEV seam drives that path; the gate uses it.
2. The first gate check sampled six corner points and FAILED (40.9) on a
   frame that was visibly black (median 9.0): two near-camera trails crossed
   two sample points. Replaced with the grid median, which separates
   before/after in both directions (88 vs 9-19) and is indifferent to where
   the trails happen to fall.

## For the human gate
- breathAmp 0.35 / flowGain 0.9 are the "restrained" defaults; both to zero
  gives the P4 still image. If the field reads busy, flowGain first.
- glowFadeStart 0.3 keeps rest byte-identical; lowering it to ~0.2 trims a
  few more /255 at 3x at the cost of a barely-visible corona dip at rest.
- Shots: shots/after-rest.png, after-close.png (3x), after-tight.png (7x);
  before-*.png are the same views before the pass.

---

# Salience pass: momentum channel (placeholder), disc ring, depth

Decisions: docs/DECISIONS.md (2026-09-09, "Salience pass"). Domain: RALLY.md §5.

## What changed
- `src/neural/momentum.ts` (new): `nameUnit` (FNV-1a -> [0,1)), `momentumFor`
  (0 for ~90%, 0.35..1 for `movingFraction`; brain 0). PLACEHOLDER source.
- `src/neural/starField.ts`: `iMomentum` attribute; `uMomentumGlow /
  uPulsePeriod / uPulseRateBoost`; halo = min(1, haloOpa + glow x m x pulse)
  feeds both the corona/bloom alphas and the C2 whole-sprite multiplier
  (brighter, never bigger). Ambient breath removed.
- `src/neural/trails.ts`: `aFlow` is (t, phase, childMomentum); band gain x
  momentum, rate x (1 + boost x m); `flowBandPosition(.., momentum, boost)`.
- `src/neural/config.ts`: `momentum` group; `DISC_FRACTION`; `ringRadiusPx`;
  depth.opacityFloor 0.15; breath keys removed.
- `src/neural/NeuralScene.tsx`: momentum into instances (field + level-1
  reports) and report trail specs; ring via `ringRadiusPx`; slider group.
- `src/neural/Crosshair.tsx`: hue on the arms whenever anything is
  highlighted; ring only when ringR > 0.
- `tests/visual.test.ts` rewritten: 20 tests (152 total).

## Machine gate - PASS
- Unit 152/152; typecheck + lint clean. `grep breath src tests scripts` empty.
- verify-neural 7/7: white-clip 0.10% (was 0.13%), 7x median 8.9/255, 9
  draws, 60 fps, layout 650ce55b. verify-pointing 9/9, 13/26.
- Rest DOM: pointed=brain, state=acquired, ring opacity 0 (no anchor ring).
- Motion 1.5 s apart: 0.57% > 8/255 (was 1.65%); 0.025% > 40/255 (was
  0.010%). Fewer pixels move; the ones that do move harder.

## For the human gate
- `movingFraction` is the placeholder's one product knob: 0.10 reads as "a
  few things are happening"; 0.25 reads busy. It rebuilds attributes.
- `momentum.glow` 0.6 lets a terminal-tier shout at full momentum peak
  around hub brightness (0.2 + 0.6 = 0.8 halo) - "a small node streaking
  next to a dead giant" (RALLY §5). Lower it if small movers overpower hubs.
- `opacityFloor` 0.15: if the far side reads as missing rather than distant,
  0.2 is the compromise.

---

# Tighter clusters + tie-break fix

Decision and the measurement table: docs/DECISIONS.md ("Tighter clusters",
2026-09-09). Generator untouched; nine generation defaults changed.

## What changed
- `src/neural/config.ts`: child jitter 0.12 / 0.14 / 0.18 rad (was 0.22 /
  0.28 / 0.38); radial 1.05-1.16 / 1.03-1.10 / 1.02-1.07 (was 1.10-1.28 /
  1.06-1.18 / 1.04-1.12). Cluster RMS 580 -> 290 wu; max reach 1282 -> 603 wu;
  child->parent means 275/309/414 -> 149/145/175 wu; disc overlaps
  parent-child 8/434, siblings 25/4829.
- `src/neural/NeuralScene.tsx`: "neural cluster" slider group (nine rebuild
  sliders).
- `tests/cluster.test.ts` (new, 6): the tightness contract - RMS < 350, reach
  < 0.65 R, means < 200, still random (std > 20), overlaps < 3% / 1.5%.
- `tests/neural.test.ts`: the prototype byte-parity test now builds on the
  P0 constants explicitly - it pins the GENERATOR, and the defaults are
  allowed to differ from the prototype.
- `src/neural/pointing.ts` `bestCandidate`: two-pass. The single pass
  compared each candidate with the RUNNING best, so depth ties chained
  (A -> C -> B) and could elect a node more than a band from the true nearest;
  denser clusters surfaced it (27.1 px beat 16.7 px on a 10 px band). The
  band is now relative to the minimum. Regression test in pointing.test.ts.

## Machine gate - PASS
- Unit 159/159; typecheck + lint clean.
- Layout hash 650ce55b -> 37015199 (tuple changed, by design); 455 nodes,
  one incoming trail each; 9 draws; 60 fps.
- White-clip 0.41% (was 0.10%): denser clusters stack more additive glow in
  the centre window. Bound 1.28%.
- 7x zoom median 8.9/255 (unchanged). Pointing 9/9, 11-12/26 ordinary
  acquisitions.
- Shots: shots/before-cluster.png -> shots/after-cluster.png (same view).

## For the human gate
- The field's outer radius fell (~1856 -> ~1500 wu), so at camera.z 4600 the
  constellation sits smaller in frame (~34% margin, was 9%). Pulling the
  camera to ~3700 would refill the frame BUT puts the anchor's corona at
  0.36 of the frame height, past glowFadeStart 0.3 - the rest view would no
  longer be fade-inert (visual.test pins that). Raise glowFadeStart with it
  if you want the tighter framing; a human call.
- "neural cluster" sliders rebuild the layout; the tightness test is the
  guard-rail if a value is promoted to a default.

---

# Rallies channel + star cores

Decisions: docs/DECISIONS.md ("Interaction is the picture", 2026-09-09).

## What changed
- `src/neural/rallies.ts` (new): `ownRallies` (u^tailExponent, salted hash),
  `computeRallies` (§3 roll-up, normalised), `diamFor`, `opaFor`.
- `src/neural/starField.ts`: `iRallies` attribute; `uCore[3]`,
  `uCoreStrength`, `uCoreFalloff`; disc = mix(core, body) by radial falloff x
  heat; pinpoint radius 0.22 -> 0.38 x DR across rallies.
- `src/neural/trails.ts`: `buildTrailSpecs(nodes, cfg, diamOf)` - surfaces
  from the per-node diameter.
- `src/neural/NeuralScene.tsx`: per-instance diam / opa / rallies from the
  roll-up; `diamByName` for the ring; slider groups "neural rallies
  (placeholder)" (rebuild) and coreStrength / coreFalloff under render.
- `src/neural/config.ts`: `rallies` group; `render.coreStrength / coreFalloff
  / coreRim`. `palette.ts`: `core` and `mid` are now rendered.
- `tests/rallies.test.ts` (new, 8). `tests/neural.test.ts` §6 test reframed.

## Gamma probe (headless, before choosing sizeGamma)
  normalised rallies: p10 0.0002 · p25 0.0044 · median 0.034 · p75 0.087 · p90 0.165
  gamma   median t   share t<0.2 (dimmer than old sub)   median halo   median diam
  0.45      0.22            47%                              0.34         33 wu
  0.40      0.26            38%                              0.37         37 wu
  0.35      0.31            31%                              0.40         41 wu   <- chosen
  0.30      0.36            27%                              0.44         46 wu
  (old tiers: term .20 / sub .38 / node .60 / hub .85 halo; sub 30 wu)

## Machine gate - PASS
- Unit 167/167; typecheck + lint clean.
- verify-neural 7/7: white-clip 0.46% (0.41 -> 0.46; white cores on the big
  central shouts), 7x median 10.1/255, 9 draws, 60 fps, layout 37015199.
- verify-pointing 9/9, 11/26.
- Shots: shots/after-rallies.png (rest), shots/after-rallies-3x.png.
- First cut (body -> core, no rim, gamma 0.45) shipped briefly and was
  revised in the same session: cores barely registered against the pale
  body colour, and the field read wispy - see DECISIONS.

## For the human gate
- `tailExponent` 4 / `sizeGamma` 0.45 set how unequal the field looks: raise
  the exponent for fewer, bigger giants; lower gamma to lift the small end.
- `coreStrength` 0.9: if the big shouts read as blown-out white, 0.7 keeps
  the body colour in the core; 0 is the 7.1 flat disc for comparison.
- The roll-up makes hubs the biggest shouts by construction (they carry
  their subtree). If a flat "a few random giants anywhere" field is wanted
  instead, drop the roll-up - but that breaks the §3 parent >= children rule
  the placeholder tree is standing in for.

---

# Rally shape: 160 main posts, rare echoes, two-band rallies

Decisions: docs/DECISIONS.md ("Rally shape", 2026-09-10).

## What changed
- `src/neural/config.ts`: hubCount 160; nodesPerHub 0/0.7; subs 0/0;
  terminals 0/0; `rallies` = { popularFraction 0.12, minorMax 0.15,
  popularMin 0.4, sizeGamma 0.6, diamMin 13, diamMax 104 } (tailExponent
  removed); `trail.spokeMinWeight` 0.06; `radByTier.brain` 1.2.
- `src/neural/rallies.ts`: two-band `ownRallies`; salted draw.
- `src/neural/momentum.ts`: `nameUnit(name, salt)` with murmur3 finalizer.
- `src/neural/trails.ts`: `buildTrailSpecs(nodes, cfg, diamOf, ralliesOf)`;
  `TrailSpec.weight` = spokeMinWeight + (1 - spokeMinWeight) t^2, carried in
  `aFlow.w` (vec4) and applied to the BASE colour in the fragment shader -
  the momentum band adds unweighted; radius x (0.5 + 0.5 t);
  radByTier.brain 1.2.
- `src/neural/pulses.ts`: `iMomentum` gates dot alpha (smoothstep 0..0.35).
- `src/neural/NeuralScene.tsx`: ralliesOf into trail specs; sliders -
  hubCount to 400, rallies bands, spokeMinWeight.
- `scripts/verify-pointing.mjs`: distance check against releaseRadius.
- Tests: neural (bokeh rule, P0 constants incl. counts), cluster (Rally
  shape, rendered-disc overlaps), rallies (two bands, spokes by traction).

## Machine gate - PASS
- Unit 168/168; typecheck + lint clean.
- verify-neural 7/7: 200 nodes / 199 trails, 9 draws, 60 fps, layout
  d155a987; white-clip 0.11% (0.46 -> 0.11: 160 mostly-hairline spokes
  replace 20 hot ones); 7x median 14.2/255 (10.1 -> 14.2: more posts near
  the camera at 7x; bound 25.5 - watch this if hubCount goes higher).
- Attribution at rest (chrome=0, centre 700 px, planes subtracted): trails
  29% / sprites 71% of field light; at the brain's surround 43% / 63%
  (additive, so > 100%). Recorded because it contradicted the eye - the
  starburst READ as dominant while carrying under a third of the light.
- Spoke weighting shipped twice in the session: linear from 0.25 (still a
  dandelion, per the shot), then quadratic from 0.06 with the band moved
  off the weight - see DECISIONS.
- verify-pointing 9/9: 18/26 ordinary acquisitions, 17 samples inside 46 px,
  46 targetable of 200.
- Shots: shots/after-posts.png (rest), shots/after-posts-3x.png.

## For the human gate
- `hubCount` 160 is the "a lot of these" number; the slider runs to 400. Past
  ~250 the 7x-zoom darkness check will need glowFadeStart lowered.
- `popularFraction` 0.12 / `popularMin` 0.4 set how many posts read as
  popular and how far above the crowd they start. `sizeGamma` 0.6 is the
  contrast knob.
- `spokeMinWeight` 0.06 (quadratic): at 0 minor posts float unconnected
  until they move; at 0.25 the dandelion returns.
- Camera: the field's outer radius is now ~1.16 R (echoes) ~= 1280 wu -
  camera.z 4600 leaves ~45% margin. Tightening framing still requires
  raising glowFadeStart (rest-view parity test).

---

# Random brain distance + echoes by traction

Decisions: docs/DECISIONS.md (2026-09-10, "Random brain distance").

## What changed
- `src/neural/graph.ts`: the per-hub echo loop bound is chosen by the post's
  own traction when `generation.echoesByTraction`; off = P0 path. Imports
  `ownRallies` (pure hash, no RNG draws).
- `src/neural/config.ts`: hubRadial 0.6-1.35; echoesByTraction true;
  popularEcho 3-7; nodeJitter 0.16, nodeRadial 1.06-1.20; generationTuple +
  echo bounds + rallies band params.
- `src/neural/NeuralScene.tsx`: sliders hubRadialMin/Max, echoesByTraction,
  popularEchoMin/Max (all rebuild).
- Tests: neural (P0 constants pin hubRadial 0.9-1.1 and the flag off),
  cluster (echoes concentrate on popular posts; distance random within
  limits; mean bound 240 with reason). 170 total.

## Probe (headless, before choosing)
  config                       nodes echoes  popular mean / minor mean   post r min/med/max   overlaps p-c / sib
  radial .6-1.35, echo 3-7      258    97       4.8 / 0.23               663 / 1088 / 1485        4/97 / 3/127
  radial .7-1.3                 258    97       4.8 / 0.23               773 / 1113 / 1430        3/97 / 2/127
  radial .5-1.4                 258    97       4.8 / 0.23               554 / 1064 / 1539  (19 posts inside the corona)
  echo 2-6                      252    91       4.1 / 0.26                                        2/91 / 1/86
  echo 4-9                      280   119       6.2 / 0.27                                        4/119 / 9/219
  + echo room .16 / 1.06-1.20   258    97       4.8 / 0.23               663 / 1088 / 1485        0/97 / 1/127  <- chosen

## Machine gate - PASS
- Unit 170/170; typecheck + lint clean.
- verify-neural 7/7: 258 nodes / 257 trails, 9 draws, 60 fps, layout
  d29411df; white-clip 0.09%; 7x median 14.3/255.
- verify-pointing 9/9: 18/26 ordinary acquisitions.
- Shots: shots/after-depth.png (rest), shots/after-depth-3x.png.

## For the human gate
- `hubRadialMin` 0.6: below ~0.55 popular posts start overlapping the
  anchor's corona; `hubRadialMax` 1.35: above ~1.5 echoes leave the camera
  fit at rest.
- `popularEchoMin/Max` 3-7 is the "decent amount"; 4-9 reads as a crowd
  around each popular post and doubles sibling overlaps.

---

# "Powerful" nodes: core falloff fix, blaze, spikes

Decisions: docs/DECISIONS.md (2026-09-10, "More powerful nodes").

## What changed
- `src/neural/starField.ts`: layers 3-4 rebuilt as the luminous body -
  gaussian heart + soft-edged body colour + pin - in its own body stack
  scaled by `vMultBody` (depth x tierMult), composited over the glow stack
  (scaled by vMult, C2). Uniforms uCoreSize / uDiscEdge replace
  uCoreFalloff. `vCorona` per instance = uCoronaMult x
  (1 + uBlazeSpread x rallies), dr = DR / vCorona; `vBlaze` = 1 + uBlaze x
  rallies^2 on corona + bloom alpha; spike gate = anchor ? 1 :
  smoothstep(spikeAbove - 0.08, spikeAbove, rallies), length x spikeScale.
- `src/neural/config.ts`: `coreSize` 0.42, `discEdge` 1.35 (coreFalloff
  removed); `blaze`, `blazeSpread`, `spikeAbove`, `spikeScale`;
  `bodyAlpha()`, `heartAlpha()` mirrors.
- `src/neural/NeuralScene.tsx`: anchor + drilled-role materials set
  uBlaze/uBlazeSpread 0; four sliders under neural render.
- `tests/visual.test.ts`: luminous-body profile (solid inside, half at dr,
  gone by discEdge, monotonic; heart brighter/wider on popular, reaches
  1.0); the rest-view fade-inert check uses the largest blazing post quad.
  172 total.

## Machine gate - PASS
- Unit 172/172; typecheck + lint clean.
- verify-neural 7/7: white-clip 0.21% (0.09 -> 0.21: the hearts now reach
  white; bound 1.28%), 7x median 14.4/255, 9 draws, 60 fps, layout d29411df
  (unchanged - render only).
- Shipped three times in the session: coreFalloff 1.6 (inverted, pale) ->
  1.7 (dim) -> luminous body. A stray backtick in a GLSL comment broke the
  template literal for one gate run (0/7, page error) - caught by the gate,
  fixed, re-run.
- verify-pointing 9/9, 18/26.
- Shots: shots/after-power.png (rest), shots/after-power-3x.png (2.6x, the
  user's zoom).

## For the human gate
- `coreFalloff` 1.7: 2.5 is a pinprick heart; 1.0 is a soft half-disc glow.
- `blaze` 1.0 / `blazeSpread` 0.5: at 2.0 / 1.0 the popular posts start
  to rival the anchor at rest - the brain should stay the brightest.
- `spikeAbove` 0.8 puts spikes on ~5 posts; 0.6 on ~13; 1.01 anchor-only.

---

# Strings into the core, beads off

Decisions: docs/DECISIONS.md (2026-09-10, "Strings run into the core").
- `src/neural/trails.ts`: endpoints = centre + endInset x visible disc radius
  (DISC_FRACTION); `TrailSpec.parentName`. `config`: beadsEnabled false,
  endInset 0; slider endInset. `tests/visual.test.ts` +3; `tests/trails.test.ts`
  P3 endpoint test split into centre/inset contracts. 175 total.
- verify-neural 7/7 (white-clip 0.21 -> 0.24%, 7x 14.0), verify-pointing 9/9.
- Shot: shots/after-strings.png (4.5x).

# ORB_EYE E1-E3: gaze steering channel (2026-09-10)

Decisions: docs/DECISIONS.md (2026-09-10, "Gaze channel E1-E3").
- Pure pipeline `src/input/eye/face.ts` (headPose transform + landmark
  fallback, irisOffset, blendshape cross-check, gazeAngles, screenPoint,
  confidence), `eye/channel.ts` (regionGate hysteresis on the RAW point,
  torque, the six-state machine, arbitration), `eye/config.ts` (EYE +
  EYE_DEFAULTS), `eye/__synthetic__/face.ts` (13-landmark synthetic head).
- Shell `src/input/useEyeInput.ts`: FaceLandmarker lifecycle on the hand
  shell's frames (`eyeControl.detect` from useHandInput, hand first), the
  bus bridge, DEV seams `__eyeInfo / __eyeLog / __eyeConf`. HUD: violet EYE
  toggle (CameraConsent), ivory iris glyph in the thumbnail
  (handThumbnail.drawEyeIndicator), `EyeDebug` overlay, `EyeControls` leva
  folder. Store: `eyeEnabled`. `InputBus`: `source?: 'gaze'` on
  engage/move/lost. `dev/syntheticEye.ts`: six scenarios via
  `?input=synthetic&scenario=eye-*&eye=1`.
- Vendored `public/models/face_landmarker.task` (3.76 MB, float16 v1).
- `index.html`: Content-Security-Policy connect-src 'self' (+ localhost dev)
  - MediaPipe's unconditional telemetry POST to odml.pa.googleapis.com is
  now refused by the browser (2 attempts blocked in the gate).
- Tests `tests/eye.test.ts` 15 (spec tests 1-9 + torque sign, blink
  hold, mouse/shell/tap suspension). 206 total.
- Gate `scripts/verify-eye.mjs` 8/8: fps on a fake camera with BOTH models
  (hands-only p95 18.2 / median 16.7; +eye every 2nd frame p95 18.2 /
  median 16.7 / detect 7.9 ms; every frame p95 33.3 -> default cadence 2),
  no off-origin responses, glance 0.000°, sweep 26.3°, hand-mix 282 gaze
  moves / 0 inside 600 ms of the release, lost = attending > holding >
  decaying > idle, no errors. verify-centering 13/13 unchanged.
- Shots: shots/eye-e1-hud.png (fake camera + EYE ON + glyph),
  shots/eye-e3-sweep-debug.png (ring, dot, state label).
- NOT built: E4 calibration (§9: cut if the E3 human gate says the coarse
  drift suffices). The E1/E3 human gates need a real face: yaw sign, the
  transform-vs-landmark agreement, and the feel of the drift.

# ORB_EYE point mode + calibration (2026-09-10)

Decisions: docs/DECISIONS.md (2026-09-10, "Eye tracking: the eyes POINT").
- `eye/face.ts`: gazeFeatures (head + blended iris), Calibration map,
  screenPointFrom/Default. `eye/calibration.ts`: targets, ridge LSQ fit,
  rejection, medianFeatures. `eye/channel.ts`: filters the four FEATURES,
  maps through the calibration, 'point' mode (no engagement, no torque).
  `neural/gazeFocus.ts`: stepGazeFocus + gazeRuntime. Scene: per-frame
  gaze focus -> hover ring (source 'gaze'), unpositioned tap -> click on the
  gazed node, opt-in dwell. `ui/EyeCalibration.tsx` + HUD CALIBRATE; ivory
  gaze dot in the Crosshair overlay. `dev/syntheticEye.ts`: `eye-point`.
- Tests: tests/eye.test.ts 24 (+9: features blend, default map reach,
  fit recovery incl. reversed sign, rejection, focus acquire / no-flicker /
  switch+release / size wins, point-mode channel). 215 total.
- verify-eye 11/11 (fps every frame now passes headless: +0.1 ms p95 over
  hands-only; point-focus 2.2 px / 70 px cone; point-select; point-enter),
  verify-centering 13/13.
- Shots: shots/eye-point-focus.png, shots/eye-point-shell.png.

# Eye accuracy pass + calibration fix (2026-09-10)

Decisions: docs/DECISIONS.md ("CAL FAILED both times", "Accuracy pass").
- `eye/calibration.ts`: relative ridge (the fixed λ crushed the iris gain -
  every real calibration failed), FitReport with reasons, accept-if-
  better-than-default (capped at 2x threshold), two-stage fit with
  leave-one-out validated curvature (`quadBasis`, k x k solver).
  `eye/face.ts`: Calibration.quad applied in screenPointFrom.
  `eye/channel.ts`: blink freeze. `neural/gazeFocus.ts`: fixation mean.
  `useHandInput`: 1280x720 ideal. Config: 9 points, inset 0.65,
  minCutoff 0.9, hold 160, fixation 250/90, blinkFreeze.
- Tests 220 (+5: curvature kept/not invented/never with 5 points,
  fixation, blink freeze). verify-eye 11/11 (720p: p95 17.6 = hands-only,
  detect 8.1 ms), verify-centering 13/13.

# Eye accuracy pass 2: learning from confirms (2026-09-11)

Decisions: docs/DECISIONS.md ("Accuracy pass 2").
- `eye/face.ts`: GazeFeatures carries irisX/Y AND blendX/Y; irisMix;
  linearPoint (4-term). `eye/calibration.ts`: weighted k x k lsq, 4-term
  axes, CalibrationSample.weight, baseWeight, OnlineCalibration +
  learnConfirm (consensus outliers, weighted adoption), mapWith.
  `eye/channel.ts`: six feature filters. `neural/gazeFocus.ts`: growing
  fixation window. `useEyeInput.ts`: eyeOnline / eyeSetBase / eyeLearn;
  scene calls eyeLearn on every gaze confirm; EyeCalibration seeds the base.
  Config: fixationMaxMs, learnFromConfirms, learnMaxSamples,
  learnMinSamples, learnOutlierPx.
- Tests 225 (+5: source weighting both ways, head-shift tracking, outlier
  drop, no-base learning + cap, growing window). verify-eye 11/11
  (learnedSamples 1 after the confirm), verify-centering 13/13.

# Eye accuracy plan phases 1-5 (2026-09-13)

Decisions: docs/DECISIONS.md ("Eye accuracy plan, phases 1-5 built").
- `eye/face.ts`: per-eye EyeOffset (blink, span), quality-weighted +
  vergence irisOffset(frame, cfg, head, blend), foreshortening, per-eye
  BlendGaze, 14-key GazeFeatures + FEATURE_KEYS, featureRow, model tiers.
  `eye/fixation.ts` (moved from neural/gazeFocus, re-exported).
  `eye/channel.ts`: Median3, per-feature filters with head/iris cutoffs,
  blink edges, fixation -> freeze (tolerance), diagnostics telemetry,
  recorder sink. `eye/calibration.ts`: k x k weighted lsq, 'wide' model
  under LOO, ageWeight. `eye/replay.ts`: replayRecording + formatMetrics.
  `neural/gazeFocus.ts`: switchMargin. `Crosshair`: ring confidence.
  `EyeDebug`: raw/head dots, bars, rates. `EyeControls`: record button +
  15 new controls. Config: 17 new keys.
- Tests: tests/eyeAccuracy.test.ts 12 (phases 1-5). 237 total.
  verify-eye 11/11, verify-centering 13/13. Shot: shots/eye-diagnostics.png.
- Synthetic replay (rest clip, 1.5° jitter): filtered rms 6.4 -> 0.3 px,
  frozen 99 %; saccade clip: response 1.00 -> 0.96, settle 117 -> 125 ms.

# First real recordings + fixes (2026-09-15)

Decisions: docs/DECISIONS.md ("First real recordings").
- recordings/{rest,horizontal,vertical,head}.json (10 Hz, ~100 frames each).
  tests/eyeRecordings.test.ts replays them.
- `eye/face.ts`: eyeOffsets (per-eye thresholds) + combineEyes (drop decided
  by the caller); irisOffset kept as the stateless convenience.
  `eye/channel.ts`: adaptive blink baselines, history-aware vergence,
  rate-aware median, EyeRecordFrame.geom, telemetry (thresholds, median
  state, delegates, hand ms). `useHandInput`: hand every Nth frame while
  the eye is on and no hand is seen; hand ms + delegate. `EyeCalibration`:
  head-turn stage. `__synthetic__/face.ts`: per-eye iris + blendshape
  params. `eye/replay.ts`: per-eye replay, old-clip handling. Config:
  blinkMargin, medianMaxDtMs, handEveryNWhileEye, calHeadTurn(Ms);
  fixationMaxMs 800.
- Tests 244 (+3). verify-eye 11/11, verify-centering 13/13.

# Eyes only + saccade drill (2026-09-14)

Decisions: docs/DECISIONS.md ("Eyes only, head still; the saccade drill").
- `eye/config.ts`: `calHeadTurn` false by default; `drillStepMs`.
  `eye/replay.ts`: `EyeRecording.calibration` (the replay runs it),
  `ReplayMetrics.saccadeSteps`, printed by formatMetrics. `useEyeInput.ts`:
  every recording carries `eyeChannel.calibration`; `window.__eyeDrill`
  (six ring positions at calInset, a `truth` entry per step, store
  `eyeDrill`). `store.ts`: `eyeDrill` / `setEyeDrill`. `EyeCalibration`:
  renders the drill ring. `CameraConsent`: DRILL button. `EyeControls`:
  drill button + `drillStepMs` slider.
- Tests 246 (+2: per-step response on a short / an overshooting map;
  default-map fallback without a recorded map). tsc + oxlint clean.
  Gates NOT run (the user's machine).
- First live overlay: 16 Hz, face 15 ms GPU, hand 9 ms GPU, cal 33 pts
  120 px, eyes vs head 450 px.

# Drill verdict: irisBeta (2026-09-14)

Decisions: docs/DECISIONS.md ("The drill's verdict").
- recordings/drill.json (155 frames, 15 Hz, calibration + truth in the
  clip). `eye/config.ts`: `irisBeta` (4). `eye/channel.ts`: the iris /
  blendshape filters take `irisBeta`. `eye/replay.ts`: optional
  per-frame `trace` on replayRecording. `EyeControls`: `irisBeta` slider.
- Tests 248 (+1: iris steps at 15 Hz settle < 200 ms with irisBeta 4,
  > 300 ms with 0.015, rest jitter within 25 %). tsc + oxlint clean.
  Gates NOT run (the user's machine).
- Drill on the user's map: response 0.80 -> 0.97, settle 689 -> 526 ms.

# Second drill: calibration samples in recordings (2026-09-14)

Decisions: docs/DECISIONS.md ("Second drill: it selects too high").
- `eye/replay.ts`: `EyeRecording.calSamples`. `useEyeInput.ts`: every
  recording carries `eyeOnline.state.base`. `tests/eyeRecordings.test.ts`
  prints, per drill ring, calibration-time vs clip features. 248 tests,
  tsc + oxlint clean. Gates NOT run.
- Finding: only the unpositioned gaze confirm feeds `eyeLearn`
  (NeuralScene.tsx); a mouse click on a node does not. So the learner
  can only reinforce the ring's own choice.

# Click learning (2026-09-14)

Decisions: docs/DECISIONS.md ("Click learning").
- `eye/config.ts`: `learnFromClicks`. `eye/calibration.ts`: `LearnSource`,
  `learnAllowed`. `useEyeInput.ts`: `eyeLearn(x, y, source)` gated by
  `learnAllowed`; the DEV console line names the source.
  `neural/NeuralScene.tsx`: `click(x, y, learn)`; the positioned tap
  passes `learn = true`; a node hit learns from `hit.x/y` (projected
  centre, px from screen centre) + half the viewport. `EyeControls`:
  `learnFromClicks` toggle.
- Tests 250 (+2 in tests/eye.test.ts). tsc + oxlint clean. Gates NOT run
  (the point-select gate in verify-eye still covers the gaze path; the
  click path has no gate yet).

# Scroll to zoom (2026-09-18)

Decisions: docs/DECISIONS.md ("Scroll to zoom").
- `InputBus.ts`: `scrollZoom { logFactor }`. `config/feel.ts`:
  `scrollZoomGain`, `pinchZoomGain`, `scrollZoomRate` (FeelPanel >
  pointer). `input/zoomView.ts`: `scrollZoomLog` (wheel -> ln zoom),
  `applyScrollZoom`, `ZoomView.baseTarget` + the log-space glide in
  `stepZoomView`; the hand fold carries the target with the base.
  `usePointerInput.ts`: non-passive `wheel` on the stage.
  `NeuralScene.tsx`: applies `scrollZoom`; `__neuralDev.setZoom` sets the
  target too.
- Tests 259 (+9 in tests/zoom.test.ts). tsc + oxlint clean.
- Machine gate `scripts/verify-scroll-zoom.mjs`: ALL 9 PASS (5 notches up
  = x2.707, back to 1.005, out to 0.551; 43-frame monotonic glide; pinch
  x1.215; page scrollY 0 / scale 1; shell open suspends it; zero errors).
  Shots: shots/scroll-zoom-in.png, shots/scroll-zoom-out.png. Run against
  the cached headless shell 1243: Playwright 1.62.1 wants 1234, which is
  not installed - `npx playwright install chromium` fixes every gate.
