# Neural Orb Space — Figma Design Spec

A rotatable 3D field of glowing nodes orbiting a central brain. This document is the
build spec for the Figma POC: tokens, component anatomy, depth model, placement math,
and the prototype approach for rotation.

---

## 0. What Figma can and cannot do here

Figma has no 3D camera. Rotation is faked. Decide up front which of these you're building,
because the file structure differs:

| Approach | What you get | Cost | Use when |
|---|---|---|---|
| **A. Depth-simulated stills** | 8 keyframe boards at 45° yaw, Smart Animate between them | ~1 day | You need the look approved, and a clickable "it spins" demo |
| **B. Spline / Vectary embed** | Real 3D rotation inside a Figma frame | ~2 days | You need free rotation on both axes for user testing |
| **C. Figma component library only** | Node + trail components, one hero board | ~3 hrs | Code will own the 3D; Figma owns the visual language |

**Recommended: A + C.** Build the component library, render one hero board, then duplicate
it into 8 yaw keyframes using the plugin script in Appendix B. Real free-axis rotation is a
code problem, not a Figma problem — the hand-off notes in §11 cover it.

---

## 1. Canvas

| Property | Value |
|---|---|
| Board size | 1920 × 1080 (also produce 1440 × 900 and 390 × 844) |
| Background | `#000000` |
| Field wash | Ellipse 2400 × 1600, centered, radial gradient `#0A1830` 100% → `#000000` 0%, blend **Screen**, opacity 55% |
| Grain | Noise overlay, 3–4% opacity, blend **Overlay**, on top of everything |
| Center point | `cx = 960`, `cy = 540` |
| Sphere radius | `R = 420` (the nominal shell the hubs sit on) |
| Camera distance | `d = 1600` (used by the projection formula in §6) |

The field wash is the only thing that keeps the black from reading as dead. Keep it dim —
if you can see a hard edge on it, it's too strong.

---

## 2. Color tokens

Name these as Figma variables in a collection called `orb`.

### Blue family — the default node
| Token | Hex | Use |
|---|---|---|
| `blue/core` | `#EAF7FF` | Center pinpoint |
| `blue/body` | `#4DA8FF` | Orb fill, upper |
| `blue/mid` | `#1E6BD6` | Orb fill, lower |
| `blue/deep` | `#0A2F63` | Orb fill, shadowed base |
| `blue/halo` | `#2E8BFF` | Outer glow |

### Red family — accent node, roughly 15% of the population
| Token | Hex | Use |
|---|---|---|
| `red/core` | `#FFF0E8` | Center pinpoint |
| `red/body` | `#FF6B4D` | Orb fill, upper |
| `red/mid` | `#C43A24` | Orb fill, lower |
| `red/deep` | `#5E1409` | Orb fill, shadowed base |
| `red/halo` | `#FF4A2E` | Outer glow |

### Violet family — the brain, and only the brain
| Token | Hex | Use |
|---|---|---|
| `violet/core` | `#F5EAFF` | Inner light |
| `violet/body` | `#A66BFF` | Upper surface |
| `violet/mid` | `#6B2ED6` | Lower surface |
| `violet/deep` | `#26094F` | Shadowed base |
| `violet/halo` | `#8B3BFF` | Outer glow |

### Structure
| Token | Hex | Use |
|---|---|---|
| `trail/base` | `#2E6FB0` | Connection stroke, midpoint |
| `trail/hot` | `#9FD8FF` | Connection stroke, near a node |
| `void` | `#000000` | Background |
| `field` | `#0A1830` | Radial wash |

Red nodes are not an error state and not a category — they're the visual salt. Distribute
them so no two adjacent siblings are both red.

---

## 3. Node anatomy

Every orb is one component, `Node`, built from five stacked layers. Build it once at
**64 px** and scale by tier — do not rebuild per size.

```
┌ Node (frame, 64×64, clip off)
│  ① Halo      ellipse 205×205  radial grad {halo} 40% → transparent 0%
│                               blend Screen · layer blur 32 · opacity per tier
│  ② Bloom     ellipse 102×102  radial grad {body} 65% → transparent 0%
│                               blend Screen · layer blur 14
│  ③ Shell     ellipse  64×64   radial grad, center at 38%/32%:
│                               {core} 0% → {body} 34% → {mid} 72% → {deep} 100%
│                               inner shadow: {deep} 60%, y +6, blur 10
│                               stroke 1px {body} 45%, inside
│  ④ Specular  ellipse  16×16   at x 14 / y 11, #FFFFFF 70%, layer blur 4, Screen
│  ⑤ Core      ellipse   9×9    centered, #FFFFFF 90%, layer blur 3, Screen
└
```

The shell must read as **glass with something lit inside it**, not as a flat glowing dot.
The offset gradient center and the inner shadow are what do that. Reference the uploaded
images: the orbs have a visible bright ring low-left where light wraps the back surface.

### Size tiers and brightness

Bigger = brighter. This is the rule the whole scene reads by.

| Tier | Variant name | Diameter | Halo opacity | Bloom opacity | Core opacity | Count in scene |
|---|---|---|---|---|---|---|
| Brain | `tier=brain` | 340 | 100% | 90% | 100% | 1 |
| Hub | `tier=hub` | 104 | 85% | 80% | 95% | 6–9 |
| Node | `tier=node` | 56 | 60% | 62% | 80% | 18–28 |
| Sub | `tier=sub` | 30 | 38% | 45% | 65% | 40–70 |
| Terminal | `tier=terminal` | 13 | 20% | 30% | 45% | 90–160 |

Terminals below 16 px drop layers ① and ④ — at that scale they're noise. Keep bloom + shell + core.

### Component variants

```
Node
├─ tier      = brain | hub | node | sub | terminal
├─ hue       = blue | red | violet        (violet only valid with tier=brain)
├─ depth     = d1 | d2 | d3 | d4 | d5     (see §5)
└─ state     = idle | hover | selected | dimmed
```

---

## 4. The brain

Same component family, `tier=brain, hue=violet`, with three additions:

1. **Convolution layer** — between ③ and ④, a set of 7–9 soft vector ribbons following the
   sphere's curvature, `violet/core` at 18%, blend Screen, layer blur 6. Draw them as a single
   flattened vector so they scale cleanly. This is what makes it read as a brain and not a
   large marble. Keep them *inside* the shell silhouette; nothing breaks the sphere edge.
2. **Facet shimmer** — a scattered set of 30–40 tiny triangles (4–10 px) around the shell,
   `violet/core` 25%, blend Screen, echoing the low-poly shatter in the reference. Cluster them
   on the lit side only.
3. **Ambient pulse** — halo scales 100% → 106% over 4s in the code build. In Figma, ship two
   variants (`pulse=lo|hi`) and Smart Animate between them on a loop.

The brain sits at depth `d3` always. Everything else rotates around it.

---

## 5. Depth model

Five discrete bands standing in for a continuous z-axis. Every node and every trail gets
assigned one. This is the single most important part of the spec — a scene where all nodes
render at equal brightness looks flat regardless of how good the orbs are.

| Band | z range (of R) | Scale × | Opacity | Layer blur | Saturation | Z-order |
|---|---|---|---|---|---|---|
| `d1` front | `z > 0.6R` | 1.30 | 100% | 0 | 100% | above brain |
| `d2` | `0.2R … 0.6R` | 1.12 | 90% | 1 | 100% | above brain |
| `d3` mid | `−0.2R … 0.2R` | 1.00 | 78% | 2 | 92% | brain plane |
| `d4` | `−0.6R … −0.2R` | 0.84 | 55% | 4 | 78% | behind brain |
| `d5` back | `z < −0.6R` | 0.64 | 30% | 8 | 60% | behind brain |

Desaturate toward the back by mixing 15% `field` into the fill at `d4` and 30% at `d5`.
Atmospheric perspective — distant things go bluer and lower-contrast. Free depth cue.

**Bokeh pass:** 8–14 nodes at `d5` get pushed further — blur 16, opacity 18%, scale 0.5.
These are the out-of-focus soft circles in the first reference image. They sell the depth
more than anything else in this list.

---

## 6. Placement math

Nodes live on a shell around the brain. Compute in 3D, then project to 2D.

**Sphere point** (φ = polar, θ = azimuth, r = radius from center):

```
x = r · sin(φ) · cos(θ)
y = r · cos(φ)
z = r · sin(φ) · sin(θ)
```

**Yaw rotation** by angle `α` (this is what the prototype keyframes step through):

```
x' =  x·cos(α) + z·sin(α)
z' = −x·sin(α) + z·cos(α)
y' =  y
```

**Pitch** by `β` (apply after yaw):

```
y'' = y'·cos(β) − z'·sin(β)
z'' = y'·sin(β) + z'·cos(β)
```

**Perspective projection** to the board:

```
f      = d / (d + z'')          // d = 1600
screenX = cx + x'  · f
screenY = cy + y'' · f
scale   = f                      // multiply into the tier diameter
```

At `d = 1600` and `R = 420`, `f` ranges about 0.79 (far) to 1.36 (near). That's a strong
enough perspective to feel dimensional without the near nodes ballooning.

### Density and randomness

The brief says density is random. Random ≠ uniform noise — pure random clumps badly and
looks accidental. Use this instead:

1. Place 6–9 **hubs** with a Fibonacci sphere distribution at `r = R`, then jitter each by
   ±20° in θ, ±14° in φ, and ±12% in r. That gives organic irregularity while guaranteeing
   no empty hemisphere.
2. Each hub spawns 2–5 **nodes** at `r = R · (1.15 … 1.45)`, within a 35° cone pointing
   outward from the hub, angularly jittered.
3. Each node spawns 1–4 **subs** at `r × (1.1 … 1.3)`, cone 45°.
4. Each sub spawns 0–3 **terminals**, cone 60°, `r × (1.05 … 1.25)`.

Branch factor decays outward. Result: dense near the brain, wispy at the edge, with real
voids between hub territories. Seed the RNG and record the seed in the layer name so a
layout can be reproduced.

**Constraint:** no node's projected bounding box may overlap another's by more than 30% at
`α = 0`. Nudge in θ, never in screen space — moving in screen space breaks the geometry when
you generate the next keyframe.

---

## 7. Trails (connections)

Every node connects to exactly one parent. No cross-links in v1 — the tree reads clearly,
a graph reads as spaghetti.

Each trail is **two stacked strokes**:

```
Glow    — width = core × 4,  {halo} at 14%,  layer blur 10,  blend Screen
Core    — width per table,   gradient stroke,               blend Screen
```

| Connection | Core width | Gradient |
|---|---|---|
| brain → hub | 3.0 | `trail/hot` 65% → `trail/base` 35% → child `body` 60% |
| hub → node | 2.0 | parent `body` 55% → `trail/base` 28% → child `body` 50% |
| node → sub | 1.25 | parent `body` 45% → 22% → child `body` 40% |
| sub → terminal | 0.75 | parent `body` 35% → 18% |

Multiply core width by the child's depth `scale ×`, and multiply opacity by the child's
depth opacity. A `d5` trail is a faint thread; a `d1` trail is a bright filament.

**Shape:** never straight. Draw as a quadratic curve with the control point offset
perpendicular to the chord by 8–14% of chord length, alternating sign per sibling. The
reference images have a slight organic sag in every filament.

**Junction beads:** where a trail meets a node, add a 3–5 px `#FFFFFF` 60% dot with blur 3.
Where two trails cross in screen space at `d1`/`d2`, add nothing — let them overlap.

**Traveling pulse (optional):** a 6 px `trail/hot` dot at 90%, blur 4, animated along the
path. Use on brain→hub only, staggered, 3–5s. More than that and the scene twitches.

---

## 8. Rotation prototype

Build 8 boards: `Rotate / yaw-000` through `yaw-315`, at 45° increments.

**Non-negotiable rule:** every node keeps the **same layer name across all 8 boards**, e.g.
`n_h3_n2_s1`. Smart Animate matches on name. If names drift, nodes teleport instead of orbit.

Per board, for each node:
- recompute `screenX`, `screenY`, `scale` via §6
- reassign the depth band from the new `z''`
- swap the `depth` variant and reorder the layer against the brain accordingly
- rewrite the trail curve

Appendix B does all of this. Doing it by hand is not realistic past about 40 nodes.

**Prototype wiring:** `yaw-000 → yaw-045 → … → yaw-315 → yaw-000`, On Drag (horizontal) or
On Click, **Smart Animate**, 700ms, `Ease In And Out`. The 45° step is coarse — nodes near
the silhouette edge will visibly cut corners. That's an accepted POC limitation; note it on
the board so reviewers don't file it as a bug.

If pitch matters for the review, build a second row `pitch-neg30 / pitch-000 / pitch-pos30`
at `yaw-000` only, and demo the two axes separately.

---

## 9. States

| State | Treatment |
|---|---|
| `idle` | Per §3 |
| `hover` | Halo opacity +30%, scale ×1.06, core to 100%, label fades in over 120ms |
| `selected` | Halo +45%, a 1px ring at 1.5× diameter in `{body}` 40%, all trails on the path back to the brain lift to 100% |
| `dimmed` | Opacity ×0.35, saturation ×0.5 — applied to everything *not* on the selected path |

**Labels.** Sans-serif, 13/16, `#DCEBFF` at 85%, letter-spacing 0. Positioned outside the
halo on the side with more empty space, with a 1px leader line in `trail/base` 40% running
from the label to the shell edge. Labels only appear on hover/selected — a scene with 200
persistent labels is unreadable. Never render a label for `d4` or `d5`; rotate the node
forward first.

Set the type in one family with real character — something like **Söhne**, **Untitled
Sans**, or **Basis Grotesque**. Avoid Inter here; on a black field its neutrality reads as
placeholder.

---

## 10. File structure

```
📄 Page: 00 Tokens          variables, color swatches, effect styles
📄 Page: 01 Components      Node (all variants), Trail, Label, Brain
📄 Page: 02 Hero            single approved board at yaw-000, 1920×1080
📄 Page: 03 Rotation        8 keyframe boards + prototype wiring
📄 Page: 04 States          hover / selected / dimmed on a 9-node subset
📄 Page: 05 Responsive      1440 and 390 variants
📄 Page: 99 Scratch         explorations, rejected passes
```

**Layer naming:**

```
n_<hubIndex>_<nodeIndex>_<subIndex>_<terminalIndex>     nodes
t_<childName>                                            the trail into that node
brain                                                    the brain
```

Example: `n_h3_n2_s1_t4` is terminal 4 of sub 1 of node 2 of hub 3. Its incoming trail is
`t_n_h3_n2_s1_t4`.

---

## 11. Build order

**Slice 1 — visual language.** One `Node` component at `tier=hub, hue=blue, depth=d1`,
on the black field with the wash. Nothing else. Compare it side by side with the reference
images at 100% zoom. Do not proceed until the single orb is convincing — every problem here
multiplies by 200 later.

**Slice 2 — tiers and hues.** Full variant set. Lay out a 5×3 grid of every tier × hue and
check that the brightness ramp reads monotonically when squinting.

**Slice 3 — the brain.** Convolutions, facets, halo. Place it alone at center.

**Slice 4 — one branch.** Brain → 1 hub → 3 nodes → 6 subs → 10 terminals, with trails,
across at least three depth bands. This is where trail widths and depth falloff get tuned.

**Slice 5 — full scene.** Run the generator (Appendix B) at `α = 0`. Adjust the seed until
the composition has a clear focal asymmetry — a perfectly even scatter looks synthetic.

**Slice 6 — keyframes and prototype.** Generate the remaining 7 boards, wire the prototype.

**Slice 7 — states and responsive.**

### Review gates

Machine-checkable:
- [ ] Every node has exactly one incoming trail
- [ ] Every layer name is unique within a board and identical across all 8 boards
- [ ] No node uses a `depth` variant inconsistent with its computed `z''`
- [ ] Every `d4`/`d5` node is ordered behind `brain` in the layer list

Human judgment:
- [ ] The scene reads as spherical, not as a flat scatter, in a 2-second glance
- [ ] The brain is unambiguously the center of mass and the brightest object
- [ ] Red nodes read as accents, not as a second system
- [ ] Rotation feels like the camera orbiting, not like nodes sliding
- [ ] It doesn't look like a stock "AI network" image — check it against the references and
      then against your own memory of every fintech landing page

---

## 12. Hand-off to code

The Figma file defines appearance. It cannot define the interaction. For the real build:

- **Geometry:** §6 is directly implementable. Same formulas, continuous `α` and `β`.
- **Depth:** replace the five discrete bands with continuous interpolation on `f`. The bands
  exist only because Figma needs discrete variants.
- **Rendering:** the halo/bloom/shell/specular/core stack maps to a sprite with an additive
  blend, or to a shader with a radial falloff. Do not build it as five meshes per node —
  at 250 nodes that's 1250 draw calls.
- **Trails:** quadratic Bézier in 3D, projected per frame, drawn as a tapered ribbon.
- **Rotation input:** drag-to-orbit with momentum, damping ~0.94/frame, no auto-settle.
- **What Figma will lie to you about:** overdraw. 200 screen-blend halos stack to white mush
  in a real renderer far more aggressively than they do in Figma's compositor. Budget for
  clamping halo contribution per pixel.

---

## Appendix A — Effect style reference

| Style name | Definition |
|---|---|
| `glow/halo-lg` | Layer blur 32 |
| `glow/halo-sm` | Layer blur 14 |
| `glow/spec` | Layer blur 4 |
| `depth/blur-d2` | Layer blur 1 |
| `depth/blur-d3` | Layer blur 2 |
| `depth/blur-d4` | Layer blur 4 |
| `depth/blur-d5` | Layer blur 8 |
| `depth/bokeh` | Layer blur 16 |
| `shell/inner` | Inner shadow, y +6, blur 10, color `{deep}` 60% |

---

## Appendix B — Generator script

Run in a Figma plugin scratchpad (any "run JS in Figma" plugin, or a dev-mode plugin with
this as `code.js`). It computes the graph once, then emits one board per yaw step. It creates
**instances of your `Node` component**, so the visual work in Slices 1–3 is preserved.

```js
// --- config -------------------------------------------------------------
const CX = 960, CY = 540, R = 420, D = 1600, SEED = 20260901;
const YAWS = [0, 45, 90, 135, 180, 225, 270, 315];
const TIER = { brain: 340, hub: 104, node: 56, sub: 30, terminal: 13 };

// deterministic RNG so a layout is reproducible from SEED
let s = SEED;
const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
const rng = (a, b) => a + rnd() * (b - a);
const pick = (p) => rnd() < p;

// --- build the graph in 3D ---------------------------------------------
const nodes = [];
function add(name, tier, phi, theta, r, parent) {
  const n = { name, tier, phi, theta, r, parent,
              hue: tier === 'brain' ? 'violet' : (pick(0.15) ? 'red' : 'blue') };
  nodes.push(n);
  return n;
}

add('brain', 'brain', 0, 0, 0, null);

const HUBS = 8;
for (let i = 0; i < HUBS; i++) {
  // Fibonacci sphere + jitter
  const phi = Math.acos(1 - 2 * (i + 0.5) / HUBS) + rng(-0.24, 0.24);
  const theta = Math.PI * (1 + Math.sqrt(5)) * i + rng(-0.35, 0.35);
  const h = add(`n_h${i}`, 'hub', phi, theta, R * rng(0.88, 1.12), 'brain');

  const nCount = Math.round(rng(2, 5));
  for (let j = 0; j < nCount; j++) {
    const nd = add(`${h.name}_n${j}`, 'node',
      phi + rng(-0.30, 0.30), theta + rng(-0.30, 0.30),
      h.r * rng(1.15, 1.45), h.name);

    const sCount = Math.round(rng(1, 4));
    for (let k = 0; k < sCount; k++) {
      const sb = add(`${nd.name}_s${k}`, 'sub',
        nd.phi + rng(-0.40, 0.40), nd.theta + rng(-0.40, 0.40),
        nd.r * rng(1.10, 1.30), nd.name);

      const tCount = Math.round(rng(0, 3));
      for (let m = 0; m < tCount; m++) {
        add(`${sb.name}_t${m}`, 'terminal',
          sb.phi + rng(-0.55, 0.55), sb.theta + rng(-0.55, 0.55),
          sb.r * rng(1.05, 1.25), sb.name);
      }
    }
  }
}

// --- project ------------------------------------------------------------
function project(n, yawDeg) {
  const a = yawDeg * Math.PI / 180;
  const x0 = n.r * Math.sin(n.phi) * Math.cos(n.theta);
  const y0 = n.r * Math.cos(n.phi);
  const z0 = n.r * Math.sin(n.phi) * Math.sin(n.theta);
  const x = x0 * Math.cos(a) + z0 * Math.sin(a);
  const z = -x0 * Math.sin(a) + z0 * Math.cos(a);
  const f = D / (D + z);
  return { x: CX + x * f, y: CY + y0 * f, z, f };
}

const band = (z) =>
  z >  0.6 * R ? 'd1' :
  z >  0.2 * R ? 'd2' :
  z > -0.2 * R ? 'd3' :
  z > -0.6 * R ? 'd4' : 'd5';

// --- emit boards --------------------------------------------------------
(async () => {
  const comp = figma.currentPage.findOne(n => n.type === 'COMPONENT_SET' && n.name === 'Node');
  if (!comp) { figma.notify('Component set "Node" not found on this page'); return; }

  YAWS.forEach((yaw, bi) => {
    const board = figma.createFrame();
    board.name = `Rotate / yaw-${String(yaw).padStart(3, '0')}`;
    board.resize(1920, 1080);
    board.x = bi * 2020;
    board.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];

    // paint back-to-front so z-order is correct without extra sorting
    const placed = nodes
      .map(n => ({ n, p: project(n, yaw) }))
      .sort((a, b) => a.p.z - b.p.z);

    placed.forEach(({ n, p }) => {
      const variant = comp.defaultVariant.createInstance();
      variant.setProperties({ tier: n.tier, hue: n.hue, depth: band(p.z), state: 'idle' });
      const size = TIER[n.tier] * p.f;
      variant.resize(size, size);
      variant.x = p.x - size / 2;
      variant.y = p.y - size / 2;
      variant.name = n.name;
      board.appendChild(variant);
    });
  });
  figma.notify(`Generated ${YAWS.length} boards, ${nodes.length} nodes each`);
})();
```

**Not covered by the script:** trails. Vector paths with per-segment gradient strokes are
painful to generate via the plugin API. Two options — draw them once on `yaw-000` by hand
and accept that they only animate approximately, or extend the script to emit
`figma.createVector()` with the quadratic control point from §7. If the POC is about the
orbs, the first option is fine; the trails read as texture at scene scale.

---

## Appendix C — Reference notes

From the supplied images, the specific qualities worth matching:

- Orbs are **translucent shells**, not emissive balls. You can see through the leading edge
  to a brighter interior.
- The brightest pixel in any orb is off-center, low-left, where the interior light hits the
  back wall of the shell.
- Filaments are **not uniform width** — they taper toward the node and swell at junctions.
- There is warm contamination in the field: faint amber/rust at the frame edges against all
  that blue. Add a single ellipse of `#3A1508` at 12%, blend Screen, layer blur 80, placed
  off-center. It stops the scene from going monochrome-cold.
- Out-of-focus background orbs are doing enormous work. Do not skip the bokeh pass.
