# Neural Orb — Figma Make → RTF Handoff

This document indexes the Figma Make prototype for a developer re-implementing
the visual system in React Three Fiber with instanced shader rendering. All
values are pulled directly from the current source; nothing is from the original
spec unless both agree.

---

## 1. File Map

| Concern | File | Symbol / line range |
|---|---|---|
| Entry point | `src/main.tsx` | mounts `App` into `#root` |
| Everything else | `src/App.tsx` | single file, ~550 lines |
| Color tokens | `src/App.tsx` | `PAL` constant, lines 8–12 |
| Tier sizes & opacity | `src/App.tsx` | `TIER_DIAM`, `TIER_OPA`, lines 15–26 |
| Trail radii | `src/App.tsx` | `TRAIL_RAD`, lines 29–31 |
| Scene constants (R, D) | `src/App.tsx` | lines 33–34 |
| Seeded RNG | `src/App.tsx` | `makeRng()`, lines 37–44 |
| Node graph builder | `src/App.tsx` | `buildGraph()`, lines 53–97 |
| Orb sprite texture | `src/App.tsx` | `getOrbTexture()`, lines 112–158 |
| Field wash texture | `src/App.tsx` | `makeFieldTexture()`, lines 161–170 |
| Trail tube geometry | `src/App.tsx` | `buildTrailGeometry()`, lines 173–191 |
| Scene setup, camera, groups | `src/App.tsx` | `useEffect` → lines 197–224 |
| Sprite instantiation | `src/App.tsx` | lines 270–292 |
| Trail build + merge | `src/App.tsx` | lines 294–403 |
| Depth-opacity per frame | `src/App.tsx` | animate loop, lines 466–481 |
| Brain pulse | `src/App.tsx` | lines 484–487 |
| Drag-to-orbit physics | `src/App.tsx` | lines 416–438 |
| Geometry merge utility | `src/App.tsx` | `mergeBufferGeometries()`, lines 519–551 |

---

## 2. Node Rendering Recipe

Nodes are rendered as **THREE.Sprite** (camera-facing quads) with a
pre-baked canvas texture per `hue × tier` (10 combinations). Blend mode
is `THREE.AdditiveBlending` on all sprites. `depthWrite: false`,
`depthTest: false`.

### Texture canvas sizes

| Tier | Canvas (px) |
|---|---|
| brain | 512 × 512 |
| hub | 256 × 256 |
| node | 128 × 128 |
| sub, terminal | 64 × 64 |

### Disc radius

```
dr = SIZE × 0.15
```

All gradient radii below are expressed as multiples of `dr`.

### Layer 1 — Outer halo (corona)

Radial gradient, annular (inner stop at `dr × 1.2`, outer at `SIZE × 0.49`).

| Stop position | Color | Alpha |
|---|---|---|
| 0.0 | `halo` | `haloOpa × 0.28` |
| 0.4 | `halo` | `haloOpa × 0.10` |
| 1.0 | `halo` | `0` |

Filled circle radius: `SIZE × 0.49`  
Blend: additive (inherited from sprite material)

### Layer 2 — Bloom (inner glow ring)

Radial gradient, annular (inner stop at `dr × 0.8`, outer at `dr × 2.8`).

| Stop position | Color | Alpha |
|---|---|---|
| 0.0 | `body` | `bloomOpa × 0.50` |
| 0.5 | `body` | `bloomOpa × 0.18` |
| 1.0 | `body` | `0` |

Filled circle radius: `dr × 2.8`

### Layer 3 — Solid disc (star body)

Flat solid fill, no gradient:

```
fillStyle = rgba(body, coreOpa)
arc(cx, cy, dr)
```

No specular. No rim. No directional lighting. Pure solid color.

### Layer 4 — White pinpoint

Solid flat fill (not a gradient — just a circle):

```
pinR   = max(1, dr × 0.22)
alpha  = min(1.0, coreOpa × 0.85)
fillStyle = rgba(255, 255, 255, alpha)
arc(cx, cy, pinR)
```

---

### Tier opacity table

`TIER_OPA[tier]` = `[haloOpa, bloomOpa, coreOpa]`

| Tier | haloOpa | bloomOpa | coreOpa |
|---|---|---|---|
| brain | 1.00 | 0.90 | 1.00 |
| hub | 0.85 | 0.80 | 0.95 |
| node | 0.60 | 0.62 | 0.80 |
| sub | 0.38 | 0.45 | 0.65 |
| terminal | 0.20 | 0.30 | 0.45 |

These are static baked into the texture. The runtime opacity multiplied on top
is the depth attenuation value (§4).

### Sprite world-space size

```
sz = TIER_DIAM[tier] × 4.2         // normal nodes
sz = TIER_DIAM[tier] × 10          // bokeh terminals only
```

`TIER_DIAM` values (world units):

| Tier | Diameter |
|---|---|
| brain | 85 |
| hub | 104 |
| node | 56 |
| sub | 30 |
| terminal | 13 |

The sprite quad fills `sz × sz` world units. The disc occupies the central
`SIZE × 0.15 / SIZE × 1.0 = 15%` of the texture radius, so the disc
diameter in world units = `sz × 0.30`.

---

## 3. Color Values in Use

All tokens match `FIGMA_NEURAL_ORB_SPEC.md` exactly except the `mid` and
`deep` tokens, which are present in `PAL` but **never sampled** in the
current texture code (the glass-sphere shell was replaced with a flat disc).
They are kept in the palette for reference but have no rendered effect.

### Blue (hue = "blue")
| Token | Hex | Used |
|---|---|---|
| core | `#EAF7FF` | disc white-mix for brain only |
| body | `#4DA8FF` | disc fill, bloom, trail vertex color |
| mid | `#1E6BD6` | **unused in render** |
| deep | `#0A2F63` | **unused in render** |
| halo | `#2E8BFF` | outer corona |

### Red (hue = "red")
| Token | Hex | Used |
|---|---|---|
| core | `#FFF0E8` | (same caveat as blue/core) |
| body | `#FF6B4D` | disc fill, bloom, trail vertex color |
| mid | `#C43A24` | **unused in render** |
| deep | `#5E1409` | **unused in render** |
| halo | `#FF4A2E` | outer corona |

### Violet (hue = "violet", brain only)
| Token | Hex | Used |
|---|---|---|
| core | `#F5EAFF` | (same caveat) |
| body | `#A66BFF` | disc fill, bloom, trail vertex color |
| mid | `#6B2ED6` | **unused in render** |
| deep | `#26094F` | **unused in render** |
| halo | `#8B3BFF` | outer corona |

### Trail structure colors
| Role | Hex |
|---|---|
| trail/base (mid-path) | `#2E6FB0` |
| trail/hot (brain→hub near-brain end) | `#9FD8FF` |

### Background
| Element | Value |
|---|---|
| Canvas clear | `#000000` |
| Field wash inner | `rgba(10,24,48,0.88)` |
| Field wash outer | `rgba(6,14,28,0.60)` at r=0.55, transparent at r=1.0 |
| Warm contamination inner | `rgba(60,22,8,0.55)` |
| Warm contamination mid | `rgba(30,10,4,0.22)` at r=0.5, transparent at r=1.0 |

---

## 4. Depth Attenuation

Computed **per frame** in the animation loop using the sprite's **world-space Z**
position after `sceneGroup` has been rotated.

```
zNorm = clamp((worldZ + R × 1.5) / (R × 3), 0, 1)
      = clamp((worldZ + 1650) / 3300, 0, 1)
```

`zNorm = 0` = farthest back (z = −1650), `zNorm = 1` = closest front (z = +1650).

### Opacity curve (smoothstep)

```
depthOpa = 0.30 + 0.70 × smoothstep(zNorm)
         where smoothstep(t) = t² × (3 − 2t)
```

Anchors: back = **0.30**, front = **1.00**

### Final per-sprite opacity

```
sprite.material.opacity = depthOpa × haloOpa × tierMult
  where tierMult = 1.0 for brain, 0.95 for everything else
```

`haloOpa` is the first element of `TIER_OPA[tier]` (see §2 table).

### Bokeh terminals

10 evenly-spaced terminal nodes are flagged `isBokeh = true`. They receive:
- Fixed `depthOpa = 0.22` (ignores z, always dim)
- Sprite world size = `TIER_DIAM.terminal × 10 = 130` (vs. normal 55)
- Same `haloOpa × tierMult` final multiplier applies on top

### Desaturation

Not implemented. The original spec called for color desaturation at depth but
this was dropped (see §8). The back-node opacity floor of 0.30 serves the same
perceptual purpose.

### Blur at depth

Not implemented (WebGL sprites can't blur individually without render targets).
See §8.

---

## 5. Trail Geometry

### Curve type

`THREE.QuadraticBezierCurve3` — three control points: parent surface,
a single bend control point, child surface.

### Endpoint offsets

Trails **do not** run center-to-center. Both endpoints are offset inward by
the node's nominal shell radius along the chord direction:

```
dir    = normalize(childPos − parentPos)
pSurf  = parentPos + dir × (TIER_DIAM[parentTier] / 2)
cSurf  = childPos  − dir × (TIER_DIAM[childTier]  / 2)
```

Any pair where `|childPos − parentPos| < 1` is skipped.

### Control point (bend)

```
mid    = (pSurf + cSurf) × 0.5
perp   = normalize(chord × worldUp)          // fallback: chord × (1,0,0)
sign   = sin(childPhi × 7.3 + childTheta) > 0 ? +1 : −1
ctrl   = mid + perp × chordLen × 0.10 × sign
```

Perpendicular offset = **10% of chord length**, alternating sign per node
(deterministic from its φ/θ angles — same sign across all rotations).

### Tube geometry

Two passes per trail, merged into one `Mesh` each for the whole scene:

| Pass | Radius | Tubular segs | Radial segs | Material opacity | Purpose |
|---|---|---|---|---|---|
| core | `TRAIL_RAD[parentTier]` | 18 | 5 | 0.72 | main filament |
| glow | `TRAIL_RAD[parentTier] × 3.2` | 12 | 5 | 0.22 | soft halo around filament |

`TRAIL_RAD` values (world units, tube radius):

| Parent tier | Core radius |
|---|---|
| brain | 1.8 |
| hub | 1.1 |
| node | 0.65 |
| sub | 0.35 |
| (default) | 0.30 |

Both passes use `THREE.AdditiveBlending`, `vertexColors: true`, `depthWrite: false`,
`side: THREE.DoubleSide`.

### Vertex color gradient (core pass)

Parameterised by `t ∈ [0, 1]` along the tube (0 = parent end, 1 = child end):

```
if (parentTier === "brain" && t < 0.15):
    lerp(#9FD8FF → parentBodyColor,  t / 0.15)
else if (t < 0.40):
    lerp(parentBodyColor → #2E6FB0,  t / 0.40)
else:
    lerp(#2E6FB0 → childBodyColor,   (t − 0.40) / 0.60)
```

### Vertex color gradient (glow pass)

```
lerp(parentBodyColor, childBodyColor, t) × 0.55
```

Darker than the core pass so the glow layer doesn't overpower it.

### Junction beads

Not implemented. The spec calls for 3–5 px `#FFFFFF` 60% dots with blur 3
at each junction. Skipped (see §8).

### Taper

Not implemented. TubeGeometry has constant cross-section radius. The spec
calls for a tapered ribbon; this is a known shortcut (see §8).

---

## 6. Tuned Constants

| Constant | Symbol | Current value | Notes |
|---|---|---|---|
| Sphere shell radius | `R` | `1100` wu | Iterated from spec's 420 → 260 → 1100 |
| Camera distance | `D` | `2000` wu | Used only for fog/depth range; not the actual near-clip |
| Camera Z position | — | `2000` wu | Matches D |
| Camera FOV (vertical) | — | `52°` (fixed) | Not tied to D; chosen for full-width coverage |
| Camera near clip | — | `1` wu | |
| Camera far clip | — | `20000` wu | |
| Initial pitch tilt | `sceneGroup.rotation.x` | `−0.18` rad | Slight downward tilt at load |
| Drag sensitivity | — | `0.006` rad/px | Applied to both yaw and pitch |
| Momentum damping | `DAMP` | `0.94` per frame | Applied every frame when not dragging |
| Initial yaw velocity | `velYaw` | `0.0025` rad/frame | Decays to ~0 in ~110 frames |
| Initial pitch velocity | `velPitch` | `0.0004` rad/frame | |
| Pitch clamp | — | `±1.1` rad | Hard-clamp on `sceneGroup.rotation.x` |
| Pixel ratio cap | — | `min(devicePixelRatio, 2)` | |
| Hub count | `HUBS` | `20` | Iterated from spec's 8 |
| Hub radial range | — | `R × [0.90, 1.10]` | Fibonacci sphere + jitter |
| Hub phi jitter | — | `±0.20` rad | |
| Hub theta jitter | — | `±0.30` rad | |
| Node radial range | — | `hub.r × [1.10, 1.28]` | |
| Node angle jitter | — | `±0.22` rad | |
| Sub radial range | — | `node.r × [1.06, 1.18]` | |
| Sub angle jitter | — | `±0.28` rad | |
| Terminal radial range | — | `sub.r × [1.04, 1.12]` | |
| Terminal angle jitter | — | `±0.38` rad | |
| Bokeh count | — | `10` (every `⌊N_terminals/10⌋`-th) | |
| Bokeh depth opacity | — | `0.22` (fixed) | |
| Bokeh sprite scale | — | `TIER_DIAM.terminal × 10 = 130` wu | |
| Normal sprite scale | — | `TIER_DIAM[tier] × 4.2` wu | |
| Brain pulse rate | `pulseT` | `+= 0.003` /frame ≈ 4.4 s period | |
| Brain pulse amplitude | — | `±3%` (scale 1.00 → 1.06) | |
| Depth range start | — | `z = −R × 1.5 = −1650` wu | zNorm = 0 |
| Depth range end | — | `z = +R × 1.5 = +1650` wu | zNorm = 1 |
| Depth opacity floor | — | `0.30` | |
| Depth opacity ceiling | — | `1.00` | |
| RNG seed | `SEED` | `20260901` | |
| Red node probability | — | `0.15` (15%) | Per non-brain node |
| Field wash plane | — | `7000 × 5000` wu at `z = −1200` | Not in sceneGroup |
| Warm contamination plane | — | `2800 × 2200` wu at `(−550, 350, −1100)` | Not in sceneGroup |

---

## 7. Deviations from `FIGMA_NEURAL_ORB_SPEC.md`

### 7.1 Node appearance — glass sphere → solid disc

**Spec:** Five-layer orb: halo / bloom / shell with offset radial gradient
(core→body→mid→deep) / specular highlight offset upper-left / central pinpoint.
Reads as a "translucent shell with something lit inside."

**Build:** Flat solid disc in `body` color, bloom ring in `body` color, faint
halo corona in `halo` color, tiny white center pinpoint. No shell gradient, no
specular, no rim light, no mid/deep color stops. The `mid` and `deep` tokens
are retained in `PAL` but go unused.

**Reason:** Explicit design direction during iteration — "nodes should be solid
colors, kind of looking like real-life accurate stars."

### 7.2 R and hub distance

**Spec:** `R = 420` wu, hubs at `R × ~1.0`.

**Build:** `R = 1100` wu, hubs at `R × [0.90, 1.10]`. Terminals reach roughly
`R × 1.43 ≈ 1570` wu from origin.

**Reason:** Iterated to fill screen width. At camera Z=2000 with FOV=52°, the
horizontal half-extent at z=0 is ~1740 wu; the outer terminals brush the edges.

### 7.3 Hub count

**Spec:** 6–9 hubs.

**Build:** 20 hubs. Explicit design direction — "many more of them."

### 7.4 Branch radii (tightened)

**Spec:** node at hub×(1.15–1.45), sub at node×(1.10–1.30), terminal at sub×(1.05–1.25).

**Build:** node at hub×(1.10–1.28), sub at node×(1.06–1.18), terminal at sub×(1.04–1.12). Tightened to cluster nodes closer to parents.

### 7.5 Camera and projection

**Spec:** `d = 1600`, perspective factor `f = d / (d + z)`, manual projection to a 1920×1080 canvas.

**Build:** Three.js `PerspectiveCamera(52°, aspect, 1, 20000)` at `(0, 0, 2000)`. FOV fixed at 52° (not derived from d). No manual f computation; Three.js handles all projection. The camera never moves — the `sceneGroup` rotates.

### 7.6 Depth model — 5 discrete bands → continuous smoothstep

**Spec:** Five bands (d1–d5) with discrete scale×, opacity, blur, and saturation
values per band.

**Build:** Continuous per-frame `smoothstep(zNorm)` for opacity only. Scale is
handled entirely by Three.js perspective. Blur and saturation are not implemented.

### 7.7 Trail rendering — tapered ribbon → constant-radius tube

**Spec:** Tapered ribbon (widens near nodes, narrows mid-filament) with two
stacked strokes (glow 4× core width at 14% + core at 100%).

**Build:** `THREE.TubeGeometry` with constant radius. Two passes (core + glow at
3.2× radius) merged into two scene-wide meshes. No taper.

### 7.8 Trail width — per-depth scaling

**Spec:** Multiply core width by child's depth `scale ×` and opacity by child's depth opacity.

**Build:** Not implemented. Trail widths are static; only the sprite opacity
changes with depth, not the trails.

### 7.9 Junction beads

**Spec:** 3–5 px `#FFFFFF` 60% dot with blur 3 where trail meets node.

**Build:** Not implemented.

### 7.10 Traveling pulse on brain→hub trails

**Spec:** Optional — 6 px `trail/hot` dot animated along path, brain→hub only.

**Build:** Not implemented.

### 7.11 Brain appearance

**Spec:** Convolution layer (7–9 vector ribbons), facet shimmer (30–40 small
triangles), ambient pulse.

**Build:** The ambient pulse is implemented (scale ±3%, ~4.4 s period). The
convolution ribbons and facet shimmer were removed when the glass-sphere
texture was replaced with the flat-disc star look. The brain is `hue=violet`
with the same 4-layer texture as all other tiers.

### 7.12 Grain overlay

**Spec:** Noise overlay at 3–4% opacity, blend Overlay, on top of everything.

**Build:** Not implemented.

---

## 8. Known Issues and Shortcuts — Do NOT Copy

### 8.1 Manual geometry merge (`mergeBufferGeometries`)

A hand-rolled geometry merge at the bottom of `App.tsx` concatenates
`Float32Array` attribute buffers and index arrays. It assumes all geometries
share exactly the same attribute names (which happens to be true for
`TubeGeometry`) but has no validation. The re-implementation should use
`@react-three/drei`'s `Merged` or a proper instanced approach.

### 8.2 Per-frame `getWorldPosition` for every sprite

The depth-opacity loop calls `sprite.getWorldPosition(tmpPos)` for every node
every frame, which internally traverses the scene graph matrix chain on each
call and re-uses a single shared `THREE.Vector3`. At ~250 nodes this is
acceptable but not scalable. In RTF with instanced geometry, compute depth
in the vertex shader from the instance matrix directly.

### 8.3 Per-sprite cloned `SpriteMaterial` for opacity

Each sprite owns a `.clone()` of the base material so its `opacity` can be
set independently. This creates ~250 `SpriteMaterial` instances. In the
re-implementation, pass depth as an instance attribute and multiply in the
shader.

### 8.4 Canvas texture baked at fixed resolution

Textures are baked once at load time at fixed px sizes (512, 256, 128, 64).
There is no LOD and no regeneration if `devicePixelRatio` changes. In the
re-implementation, generate the sprite appearance in the fragment shader so it
is resolution-independent.

### 8.5 Trail opacity does not respond to depth

Trail meshes are single merged `Mesh` objects with a single global `opacity`
(0.72 core, 0.22 glow). Individual trail segments do not dim when their
endpoint nodes are at depth. The vertex colors carry the hue gradient but
not the depth attenuation. This is the most visible visual gap between the
prototype and the spec.

### 8.6 Brain convolution ribbons removed

When the glass-sphere texture was replaced, the brain-specific cortex ribbon
code was also removed. The brain's violet disc is visually indistinct from a
large hub. The re-implementation should restore the ribbon/fold detail in the
fragment shader clipped to the disc boundary.

### 8.7 `depthTest: false` on all sprites

All sprites skip depth testing. This means sprites always composite over each
other in add mode regardless of 3D position, which is correct for additive
blending but means a sprite can never be "behind" an opaque object. There are
no opaque objects here so this is benign, but note it if the scene gains
non-additive elements.

### 8.8 RNG seed is order-dependent

`buildGraph` advances the RNG in a strict DFS order (hubs, then each hub's
nodes, etc.). Changing hub count, branch counts, or insertion order will
invalidate the entire layout. The seed `20260901` must be preserved exactly
and the graph must be generated with the same traversal order to reproduce the
current layout.
