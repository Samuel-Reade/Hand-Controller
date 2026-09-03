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
