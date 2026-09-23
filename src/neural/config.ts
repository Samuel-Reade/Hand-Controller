// The neural feel-config object (ORB_NEURAL_PORT_SPEC §5). Every constant of
// the star-network render lives here as a leva-wired default; nothing may be
// hardcoded at a use site. Defaults verified against the prototype ground
// truth in docs/PORT_LOG.md (P0 step-zero table). Same discipline as FEEL:
// leva mutates in place, renderers read live. Generation-affecting keys
// (the `generation` group) additionally bump `generationVersion` so the
// graph rebuilds; render keys take effect the next frame via uniforms.

import type { NeuralTier } from './palette'

export interface NeuralConfig {
  generation: {
    seed: number
    hubCount: number
    R: number
    hubRadialMin: number; hubRadialMax: number
    hubJitterPhi: number; hubJitterTheta: number
    nodeRadialMin: number; nodeRadialMax: number; nodeJitter: number
    subRadialMin: number; subRadialMax: number; subJitter: number
    terminalRadialMin: number; terminalRadialMax: number; terminalJitter: number
    redProbability: number
    // PORT_LOG C3: branch-count ranges are part of the generation tuple
    nodesPerHubMin: number; nodesPerHubMax: number
    // Echo count follows the post's OWN traction (RALLY: a popular post is a
    // conversation - "a decent amount of subnodes"); minor posts use
    // nodesPerHub. ownRallies is a name hash (no layout-RNG draws), so the
    // positions are untouched; only the loop bound changes. false = the P0
    // uniform bound, byte-exact (parity test).
    echoesByTraction: boolean
    popularEchoMin: number; popularEchoMax: number
    subsPerNodeMin: number; subsPerNodeMax: number
    terminalsPerSubMin: number; terminalsPerSubMax: number
    bokehCount: number
  }
  render: {
    tierDiam: Record<NeuralTier, number>
    spriteScale: number
    bokehScale: number
    bokehOpacity: number
    grainAmount: number
    grainEnabled: boolean
    // Zoom-invariant glow (visual pass): a sprite's corona + bloom fade once
    // it spans more than glowFadeStart of the frame HEIGHT, gone by
    // glowFadeEnd. Glare is optical, not a world-space disc - without this
    // the anchor's corona alone tinted every pixel lavender at 7x. Inert at
    // the rest view (anchor spans ~0.29 there), so P0 parity holds.
    glowFadeStart: number
    glowFadeEnd: number
    // Star cores (user: the flat discs "look stale"). The disc is lit like a
    // star - core-white at the centre falling to the body colour at the rim.
    // The falloff is the ONLY gradient: no specular, no rim light. Big shouts
    // (rallies) burn whiter. coreStrength 0 = ruling-7.1's flat disc.
    // The luminous body (replaces ruling 7.1's flat disc, which read as a
    // sticker at any colour): a white-hot gaussian heart of radius coreSize x
    // dr (larger on popular posts) falling through the BODY colour to a
    // saturated rim, soft-edged - half alpha at dr, gone by discEdge x dr.
    // Its alpha is not capped by haloOpa, so a popular post's heart reaches
    // full white. Size is still the rallies channel (dr).
    coreStrength: number   // how white the heart is (0 = body colour)
    coreSize: number       // heart radius in dr at zero rallies; x (0.6 + 0.4 r)
    discEdge: number       // where the body's soft edge ends, in dr
    coreRim: number        // how far the rim leans from body toward PAL.mid
    // "Powerful" (user direction 2026-09-10) - rallies-driven, so only the
    // posts that matter get it. blaze: corona + bloom alpha x (1 + blaze r^2);
    // blazeSpread: the glow footprint x (1 + spread r) while the DISC (size
    // channel) stays put; spikes: a bright-star diffraction cross on posts
    // above spikeAbove (1.01 = none), at spikeScale of anchor.spikeLength.
    // The anchor itself is exempt from blaze/spread/spikes (its dominance
    // treatment is §6's corona + pulse; spikes removed 2026-09-22).
    blaze: number
    blazeSpread: number
    spikeAbove: number
    spikeScale: number
    // The light pipeline (lighting pass, 2026-09-21; postfx.ts). The scene
    // draws into a half-float target, so overlapping additive glow
    // ACCUMULATES past 1.0 instead of clipping to flat white; a bloom pass
    // spreads only what is hot; Neutral tone mapping (identity below 0.8)
    // then rolls only the hot accumulations off toward white. exposure
    // scales the frame before that - 1 = P0 parity for everything not hot.
    // Samples in the scene target. 0: the trails carry their own hairline
    // (trail.minRadiusPx) so nothing needs coverage. 4 cost 60 -> 24 fps at
    // retina scale on the additive fill (measured 2026-09-21); 2 -> 31.
    msaa: number
    bloomEnabled: boolean
    bloomStrength: number   // how much of the hot pass is added back
    bloomRadius: number     // 0..1 - how far the hot light spreads
    bloomThreshold: number  // linear luminance a pixel must exceed to bloom (1 = over-white only)
    bloomKnee: number       // threshold softness, so a pulsing halo never pops in and out
    exposure: number
    // Glare (replaces the corona's linear ramp, which read as a soft disc
    // with an edge at any zoom): a tight gaussian at the disc edge and a
    // long faint Lorentzian tail - bright where the star's light is,
    // fading the way real glare does. The bloom pass adds the wide spread.
    glareTight: number      // peak alpha x halo, at the disc edge
    glareSigma: number      // gaussian width, in disc radii
    glareTail: number       // tail alpha x halo
    glareTailRadius: number // where the tail is at half strength, in disc radii
    // Node bodies (2026-09-21): a body, not a sticker. Limb darkening - a
    // self-luminous sphere is brightest face-on and dims toward its edge,
    // I = I0 (1 - u (1 - mu)); the Sun's u is ~0.6 - and, once a node spans
    // enough of the frame to see it, a faint surface mottle sampled ON the
    // sphere, so it foreshortens at the limb. Brightness only: the hue is
    // status (RALLY §5). Bokeh sprites (defocused light) get neither.
    limbDarkening: number   // u above; 0 = the flat disc
    surfaceAmp: number      // mottle depth as a fraction of body brightness
    surfaceScale: number    // mottle cells across the disc
    surfaceDrift: number    // rad/s the sphere turns; 0 = still (the momentum channel owns motion)
    detailStart: number     // mottle fades in from this fraction of frame height the sprite spans...
    detailEnd: number       // ...full here (disc ~ 0.3 of the sprite); the pinpoint fades out over the same span
    pinMaxPx: number        // the white pinpoint's radius cap, device px (it scaled with the disc: a sticker up close)
    // Scoped occlusion (2026-09-21): node bodies hide the LINES behind
    // them and the brain hides the nodes and lines behind it; bodies never
    // hide bodies, so at thousands of nodes no shout is lost to the one in
    // front (rotate and it is there anyway). A depth twin of each star
    // mesh writes depth for the solid disc only (x < occludeEdge, inside
    // the opaque part, so the cut is never seen); glow, bokeh and beads
    // hide nothing.
    occlusion: boolean
    occludeEdge: number     // the twin's disc radius in dr; keep under discEdge's opaque plateau
    // Fog pass (2026-09-21): the "fog" at 3x was ordinary nodes near the
    // camera - a body whose soft edge (0.6..discEdge dr) still blurs when
    // the disc is 140 px, wearing glow layers that scale with the world
    // size, so a halo right at rest is a translucent disc three times the
    // body up close. The limb tightens to discEdgeNear as the body
    // resolves (the detail ramp), and the glow's unit - the disc radius
    // the glare and bloom are drawn in - is capped at glowCapPx on screen:
    // glare has a fixed angular size. The cap sits above every rest-view
    // disc, so the rest view is untouched.
    discEdgeNear: number    // the body's soft edge at full detail, in dr (discEdge from afar)
    glowCapPx: number       // the glow unit's cap, device px
    // Depth of field (fog pass): a node far from the focus plane - the
    // pivot the camera looks at - is out of focus. The review's "ten bokeh
    // sprites" were a misread: the Rally shape generates no terminals, so
    // bokehCount flags nothing; the fog at 3x was ordinary shouts near the
    // camera, a minor one a 280 px translucent disc with a limb and mottle.
    // Out of focus it is what the P0 bokeh sprites faked: a soft, dim disc
    // with no glare, no limb, no detail - a foreground blur the eye reads
    // as depth. Defocus rises over |ln(depth / focus)| from defocusStart to
    // defocusEnd stops; the rest view sits within +-0.5 stop of focus, so
    // it is untouched. Fully defocused, the depth opacity is replaced by
    // bokehOpacity - the flagged sprites' own knob.
    defocusStart: number
    defocusEnd: number
    // Backdrop and dust (2026-09-22): the haze is the system's light - a
    // plane behind the brain in WORLD space, so it shrinks and grows with
    // the system on screen (at rest exactly where the camera-riding plane
    // was; the warm accent rides on the same plane). hazeBehind: wu behind
    // the brain; hazeMinAhead: never closer than this in front of the
    // camera (a backdrop, not a wall); hazeInside: the floor the haze dims
    // to as the camera enters the system - from inside a glowing cloud the
    // column of glow in front of you is half as long, so its centre reads
    // half as bright. Dust: a shell of faint points far outside the field,
    // turning at dustParallax of the field's rotation - parallax on the
    // user's own input, no ambient motion (the momentum channel owns
    // motion); a fixed dustSizePx on screen; too dim to mistake for a
    // shout; not a node, so never hovered or clicked.
    hazeBehind: number
    hazeMinAhead: number
    hazeInside: number
    dustCount: number       // baked into the geometry (no slider)
    dustRadius: number      // shell inner radius, wu; the outer is x 1.6 (no slider)
    dustSizePx: number      // CSS px
    dustOpacity: number
    dustParallax: number    // fraction of the field's yaw / pitch
  }
  depth: {
    rangeMult: number      // depth.range = ±rangeMult × R
    opacityFloor: number   // far-hemisphere floor. 0.15 (salience pass) from the P0 0.3: the sphere reads as a volume
    desatStrength: number  // gated, default 0 (ruling 7.6)
  }
  rallies: {
    // RALLY.md §5 (LOCKED): SIZE = cumulative rallies; §3: a parent's total
    // is never less than its children's. PLACEHOLDER source (rallies.ts)
    // until shout data exists. Size and glow interpolate between the P0
    // terminal and hub levels by rallies^sizeGamma; tier is structure only.
    // Two populations (user direction): most posts have little traction, a
    // clear minority are popular. A single power law cannot do both - its
    // median-to-top ratio is fixed - so own demand is drawn from two bands.
    popularFraction: number // share of posts in the popular band
    minorMax: number        // minor band: own demand 0.02..minorMax, quadratic (mostly near the floor)
    popularMin: number      // popular band: own demand popularMin..1
    sizeGamma: number       // size/glow = r^sizeGamma; higher = more contrast between the bands
    diamMin: number       // wu at rallies -> 0 (P0 terminal: 13)
    diamMax: number       // wu at rallies = 1 (P0 hub: 104)
  }
  momentum: {
    // RALLY.md §5 (LOCKED): momentum is its OWN motion channel - pulse rate /
    // velocity glow - never size. A moving shout pulses; a still one is
    // still. PLACEHOLDER data source until shout analytics exist: a
    // deterministic name-hash marks `movingFraction` of shouts as moving
    // (momentum.ts). Nothing here touches disc size (the cumulative channel).
    movingFraction: number  // share of shouts that are "moving" (placeholder)
    glow: number            // halo + bloom opacity lift at full momentum, pulse peak
    pulsePeriod: number     // s at momentum -> 0; period / (1 + pulseRateBoost x m)
    pulseRateBoost: number  // full momentum pulses (1 + boost)x faster; also drives the trail band
  }
  trail: {
    coreOpacity: number
    glowOpacity: number
    glowRadiusMult: number
    bendFraction: number
    taperBase: number      // trail.taperProfile = (taperBase, taperExp)
    taperExp: number
    pulseEnabled: boolean  // brain→hub hot dots (ruling 7.10); OFF since 2026-09-22 - the ripple (flowSwell) carries the flow
    beadsEnabled: boolean  // ruling 7.9 kept them; OFF since 2026-09-10 (user: "no circles at the end of the strings")
    // Where a trail ends, as a fraction of the node's visible disc radius:
    // 0 = the node's centre - the string runs into the core (user direction
    // 2026-09-10). The prototype's surface-to-surface rule (1) was built for
    // hard-edged discs; with luminous bodies it left a gap before the heart.
    endInset: number
    // Lighting pass: the string still runs to the centre (endInset 0), but
    // its alpha fades in over bodyFade x the visible disc radius at each end,
    // so it emerges from under the body instead of painting a bar across it.
    // At the brain, 47 spokes piling into one point was half the white smear.
    // 0 = the old bar.
    bodyFade: number
    // Hairline (lighting pass): the tubes are sub-pixel at the rest view;
    // rasterised without MSAA a pixel only counted when its centre fell
    // inside one, and the strings broke into dim dots. A ring thinner than
    // minRadiusPx on screen is widened to it and dimmed by the same ratio -
    // the light MSAA coverage would have averaged, with no coverage cost.
    minRadiusPx: number
    // Line shading (2026-09-21): across a tube wide enough to show it the
    // light follows the chord through the cylinder - bright down the
    // middle, soft at the edges - and a ring wider than maxRadiusPx on
    // screen is narrowed to it: a string is a filament, never a highway.
    maxRadiusPx: number     // core pass, device px; the glow pass gets x glowRadiusMult
    filamentPow: number     // chord exponent: 1 = the cylinder, higher = a tighter core
    filamentGain: number    // brightness x under the profile (pi/4 of the ribbon's light at pow 1 -> 1.27 keeps it)
    filamentFromPx: number  // the profile fades in from this on-screen radius; under it, parity
    // Trunk grouping (2026-09-21): a parent's children are clustered by
    // direction (within bundleCone degrees) into trunks; each spoke's
    // control point is pulled by bundleStrength onto its trunk's ray, at
    // bundleBranch of the child's distance, so the spokes leave the parent
    // as one trunk and peel off toward their children - dendrites, not a
    // firework, and at thousands of shouts a few trunks at the brain
    // instead of a solid cone. 0 = the individual bend (bendFraction).
    bundleStrength: number
    bundleCone: number      // degrees: siblings closer than this share a trunk
    bundleBranch: number    // the trunk point, as a fraction of the child's distance
    radByTier: Record<NeuralTier, number>
    radDefault: number
    // Energy flow (visual pass): a soft band of brightness travelling along
    // EVERY trail, evaluated per fragment from a clock uniform - zero
    // per-frame JS. The same band swells the tube in the vertex shader
    // (flowSwell): a ripple travelling through the line (user direction
    // 2026-09-22: "something is flowing through it", replacing the dots).
    // flowInward also steers the ruling-7.10 hot dots (brain<->hub) so
    // every moving thing agrees.
    // A post's spoke follows its traction: base brightness = spokeMinWeight +
    // (1 - spokeMinWeight) x t^2 (t = rallies^sizeGamma) and radius x
    // (0.5 + 0.5 t), so 160 spokes read as a few bright lines and many
    // hairlines instead of a dandelion. Quadratic on purpose: linear at 0.25
    // still lit the median post's spoke at ~45% and the starburst stayed.
    // The momentum band is NOT weighted - a moving minor post still shows it.
    // Every trail carries the band (user direction 2026-09-22); a still
    // post's at flowFloor of full strength, momentum lifting it to 1.
    spokeMinWeight: number
    flowEnabled: boolean
    flowInward: boolean    // true: node -> parent -> brain (energy converges on the anchor); false: radiates out
    flowGain: number       // peak brightness lift (1 = 2x)
    flowWidth: number      // band sigma in trail parameter t (0..1)
    flowPeriod: number     // seconds per traversal
    flowSwell: number      // tube radius x (1 + flowSwell x strength) at the band's peak; 0 = light only
    flowFloor: number      // band strength on a still post's trail (0 = moving posts only, the old gate)
  }
  camera: { z: number; fov: number }
  scene: { initialPitch: number; pitchClamp: number }
  brainPulse: { rate: number; amp: number } // rate/frame; period ≈35s (PORT_LOG C1)
  anchor: {
    // §6 dominance treatment - leva-tuned at the P4 gate
    brainDiam: number
    coronaMult: number
    spikeLength: number
  }
  select: {
    // Selection layer (P5). ORB_NEURAL_SPEC §7's select.* keys are
    // unavailable (document missing); these defaults are the port's own,
    // flagged in PORT_LOG for reconciliation when the spec surfaces.
    recenterDuration: number   // ms - drill-in/out recenter animation
    recenterPush: number       // wu - the drilled anchor is pushed this much toward the camera
    childShellRadius: number   // wu - report re-shell radius around the anchor
    anchorWinsBelow: number    // reticle: anchor is the candidate below this w
    affordanceLift: number     // halo lift on the reticle candidate
    maxDepth: number           // ORB_SELECT_SPEC §5: Infinity = full tree; 1 = P5 two-level cap
    // Mouse hit-test (click-to-centre). The solid disc is under 2 px for a
    // minor post at rest zoom while its glow reads far larger, so the hit
    // radius is the disc times the glow multiplier, never below the floor.
    clickRadiusMult: number    // hit radius = disc radius x this (the visible glow)
    clickMinRadiusPx: number   // ...and never smaller than this, in px
    centerPush: number         // wu - the camera comes this much closer to a centred node (orbit radius)
    markGapPx: number          // selection marker: the gap at the node's centre the arms start from
    markMinPx: number          // selection marker: minimum half-size, so a minor post still shows one
    markScale: number          // selection marker: half-size as a fraction of the node's visible radius
  }
  point: PointConfig
}

/**
 * Crosshair pointing + free-rotation profile (ORB_SELECT_SPEC §5). That spec
 * files these under "FEEL additions", but they are neural-scene-only by its
 * own scope guard (§0 - the globe keeps detents and rotation-as-selection),
 * and NCONF is this scene's leva-wired config. Kept here so the globe's FEEL
 * stays exactly what the frozen globe tests assert.
 */
export interface PointConfig {
  // crosshair + highlight (PT1)
  crosshairSize: number   // px, arm length - small
  acquireRadius: number   // px from centre to acquire a node
  releaseRadius: number   // px to drop the current highlight (hysteresis; > acquire)
  switchMargin: number    // px a rival must beat the current highlight by to steal it
  tieBandPx: number       // within this, the nearer-camera node wins
  highlightSwell: number  // scale multiplier on the acquired node
  ringOpacity: number
  // free rotation profile (PT2 - declared now, unused until then).
  // No pitch clamp key: the neural scene rotates without limits on either
  // axis (user direction 2026-09-14) and passes Infinity to the integrator.
  magnetStrength: number  // torque toward centering the nearest node
  magnetSpeedGate: number // rad/s; above this the magnet fades to zero
  magnetMaxPull: number   // hard cap on magnet angular accel
  // confirm (PT3)
  dwellEnabled: boolean   // optional hands-free secondary; never the primary
  dwellMs: number
}

export const NCONF: NeuralConfig = {
  generation: {
    seed: 20260901,
    // Rally shape (user direction 2026-09-09): the field is MANY main posts
    // (shouts) on the brain, echoes one level deep and uncommon, nothing
    // deeper. Placeholder tier names map: hub = main post, node = echo;
    // sub/terminal are generated zero times. RALLY.md §2-3.
    hubCount: 160,
    R: 1100,
    // Brain -> post distance is random within limits (user direction
    // 2026-09-10): inner 0.6 R sits just outside the anchor's corona (quad
    // half-width 605 wu), outer 1.35 R keeps the echoes inside the camera fit.
    hubRadialMin: 0.6, hubRadialMax: 1.35,
    hubJitterPhi: 0.2, hubJitterTheta: 0.3,
    // Cluster tightness (user direction 2026-09-09: "random but in tighter
    // clusters"). Children still scatter by RNG jitter, but half as far: the
    // prototype's 0.22/0.28/0.38 rad jitter + 1.10-1.28 radial spray put a
    // hub's descendants at RMS 580 wu from it (terminals a mean 414 wu from
    // their parent); these give RMS 290 wu with < 2% disc overlaps. Pinned in
    // tests/cluster.test.ts. A departure from the P0 ground-truth layout.
    // Echoes around a popular post's LARGE disc need a little more room than
    // the 0.12 / 1.05-1.16 that fit the old tiers: measured 4/97 echoes
    // touching their parent's disc there, 0/97 here (PORT_LOG probe).
    nodeRadialMin: 1.06, nodeRadialMax: 1.2, nodeJitter: 0.16,
    subRadialMin: 1.03, subRadialMax: 1.1, subJitter: 0.14,
    terminalRadialMin: 1.02, terminalRadialMax: 1.07, terminalJitter: 0.18,
    redProbability: 0.15,
    // Echoes: round(rng(0, 0.7)) is 1 for 29% of posts, never 2 (the
    // prototype's re-drawn loop bound). sub/terminal: none.
    nodesPerHubMin: 0, nodesPerHubMax: 0.7,
    echoesByTraction: true,
    popularEchoMin: 3, popularEchoMax: 7, // re-drawn per check (P0 quirk): mean ~4.7 echoes on a popular post
    subsPerNodeMin: 0, subsPerNodeMax: 0,
    terminalsPerSubMin: 0, terminalsPerSubMax: 0,
    bokehCount: 10,
  },
  render: {
    tierDiam: { brain: 85, hub: 104, node: 56, sub: 30, terminal: 13 },
    spriteScale: 4.2,
    bokehScale: 10,
    bokehOpacity: 0.22,
    grainAmount: 0.03,
    grainEnabled: true,
    glowFadeStart: 0.3,
    glowFadeEnd: 1.0,
    coreStrength: 0.9,
    coreSize: 0.42,
    discEdge: 1.35,
    coreRim: 0.6,
    blaze: 1.0,
    blazeSpread: 0.5,
    spikeAbove: 0.8,
    spikeScale: 0.45,
    msaa: 0,
    bloomEnabled: true,
    bloomStrength: 0.4,
    bloomRadius: 0.3,
    bloomThreshold: 0.9,
    bloomKnee: 0.2,
    exposure: 1.0,
    glareTight: 0.35,
    glareSigma: 0.5,
    glareTail: 0.08,
    glareTailRadius: 1.5,
    limbDarkening: 0.6,
    surfaceAmp: 0.35,
    surfaceScale: 6.0,
    surfaceDrift: 0,
    detailStart: 0.05,
    detailEnd: 0.15,
    pinMaxPx: 3,
    occlusion: true,
    occludeEdge: 0.85,
    discEdgeNear: 1.08,
    glowCapPx: 30,
    defocusStart: 0.8,
    defocusEnd: 1.8,
    hazeBehind: 1200,
    hazeMinAhead: 1500,
    hazeInside: 0.6,
    dustCount: 1400,
    dustRadius: 5500,
    dustSizePx: 1.4,
    dustOpacity: 0.22,
    dustParallax: 0.35,
  },
  depth: { rangeMult: 1.5, opacityFloor: 0.15, desatStrength: 0 },
  // Measured on the 160-post field (PORT_LOG): gamma 0.6 puts the median
  // post at 27 wu / halo 0.30 and the popular band at 66-104 wu / 0.58-0.85.
  rallies: { popularFraction: 0.12, minorMax: 0.15, popularMin: 0.4, sizeGamma: 0.6, diamMin: 13, diamMax: 104 },
  momentum: { movingFraction: 0.1, glow: 0.6, pulsePeriod: 5.5, pulseRateBoost: 1.5 },
  trail: {
    coreOpacity: 0.9, // 0.72 -> 0.9 (2026-09-22: "make the connecting strings more visible")
    glowOpacity: 0.3,
    glowRadiusMult: 3.2,
    bendFraction: 0.1,
    taperBase: 0.55,
    taperExp: 1.5,
    pulseEnabled: false,
    beadsEnabled: false,
    endInset: 0,
    bodyFade: 1.0,
    minRadiusPx: 0.8,
    maxRadiusPx: 6,
    filamentPow: 1.5,
    filamentGain: 1.5,
    filamentFromPx: 2,
    bundleStrength: 0.9,
    bundleCone: 40,
    bundleBranch: 0.45,
    // brain 1.8 -> 1.2: with 160 spokes the P0 thickness (sized for 20) is
    // the starburst; a popular post's spoke is still the thickest line drawn.
    radByTier: { brain: 1.2, hub: 1.1, node: 0.65, sub: 0.35, terminal: 0.3 },
    radDefault: 0.3,
    // 0.06 -> 0.22 (2026-09-22): a minor post's string read as absent, not
    // thin; popular spokes still lead at 1.0
    spokeMinWeight: 0.22,
    flowEnabled: true,
    flowInward: true, // user direction 2026-09-09: reports feed the brain, not the other way
    flowGain: 0.9,
    flowWidth: 0.06,
    flowPeriod: 7,
    flowSwell: 1.6,
    flowFloor: 0.6,
  },
  camera: { z: 4600, fov: 52 }, // outside the field: max node r=1856 needs z>=4234 to fit the fov
  scene: { initialPitch: -0.18, pitchClamp: 1.1 },
  brainPulse: { rate: 0.003, amp: 0.06 },
  anchor: { brainDiam: 180, coronaMult: 1.6, spikeLength: 0.42 },
  select: {
    recenterDuration: 650,
    recenterPush: 900,
    childShellRadius: 260,
    anchorWinsBelow: 0.92,
    affordanceLift: 0.35,
    maxDepth: Infinity,
    clickRadiusMult: 2.5,
    clickMinRadiusPx: 14,
    // 4600 - 3000 = 1600 wu from a selected node (2.9x); home stays at 4600.
    centerPush: 3000,
    markGapPx: 2,
    markMinPx: 5,
    markScale: 0.5,
  },
  point: {
    crosshairSize:    7,
    acquireRadius:   46,
    releaseRadius:   88,
    switchMargin:    18,
    tieBandPx:       10,
    highlightSwell:   1.6,
    ringOpacity:      0.9,
    magnetStrength:   3.2,
    magnetSpeedGate:  1.4,
    magnetMaxPull:    0.35,
    dwellEnabled:     false,
    dwellMs:        520,
  },
}

/**
 * Fraction of the frame HEIGHT a view-space billboard of world size `sizeWu`
 * spans at camera distance `distWu`. The star shader's glow-fade input,
 * mirrored here (no three.js) so tests can assert the fade is inert at rest.
 */
export function frameFraction(sizeWu: number, distWu: number, fovDeg = NCONF.camera.fov): number {
  return sizeWu / (2 * Math.tan((fovDeg * Math.PI) / 360) * Math.max(1, distWu))
}

/**
 * The solid disc's share of a star sprite's quad width: 2 x DR (starField
 * FRAG, DR = 0.15). Corona and bloom fill the rest of the quad. Used to size
 * the sight's ring to the STAR rather than to its glow footprint.
 */
export const DISC_FRACTION = 0.3

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The luminous body's alpha at normalised radius x (1 = dr): 1 inside 0.6 dr,
 * half at ~dr, 0 by discEdge. Mirrors starField's FRAG.
 */
export function bodyAlpha(x: number, cfg = NCONF.render): number {
  return 1 - smoothstep(0.6, cfg.discEdge, x)
}

/** The white heart's alpha at x for a post of `rallies`. Mirrors the FRAG. */
export function heartAlpha(x: number, rallies: number, cfg = NCONF.render): number {
  const coreR = cfg.coreSize * (0.6 + 0.4 * rallies)
  return Math.exp(-(x * x) / (2 * coreR * coreR)) * (0.45 + 0.55 * rallies)
}

/**
 * The sight's ring radius in px for a highlighted node: the STAR's projected
 * disc radius x highlightSwell - not the glow footprint, ~3x wider. 0 for the
 * anchor fallback: the anchor is the camp aggregate, and when nothing else is
 * under the sight the arms taking its hue is the whole signal.
 */
export function ringRadiusPx(
  tier: NeuralTier,
  diamWu: number,
  spriteScale: number,
  focal: number,
  w: number,
  swell: number,
): number {
  if (tier === 'brain') return 0
  return ((diamWu * spriteScale * DISC_FRACTION) / 2) * (focal / w) * swell
}

/**
 * The generation-config tuple (§5 RNG caveat): the seed reproduces a layout
 * only per this tuple. Hashed for the debug overlay + layout-hash gate.
 */
export function generationTuple(c: NeuralConfig = NCONF): number[] {
  const g = c.generation
  return [
    g.seed, g.hubCount, g.R,
    g.hubRadialMin, g.hubRadialMax, g.hubJitterPhi, g.hubJitterTheta,
    g.nodeRadialMin, g.nodeRadialMax, g.nodeJitter,
    g.subRadialMin, g.subRadialMax, g.subJitter,
    g.terminalRadialMin, g.terminalRadialMax, g.terminalJitter,
    g.redProbability,
    g.nodesPerHubMin, g.nodesPerHubMax,
    g.subsPerNodeMin, g.subsPerNodeMax,
    g.terminalsPerSubMin, g.terminalsPerSubMax,
    g.bokehCount,
    // echo-by-traction makes the layout depend on these too
    g.echoesByTraction ? 1 : 0, g.popularEchoMin, g.popularEchoMax,
    c.rallies.popularFraction, c.rallies.popularMin,
  ]
}

/** FNV-1a over the tuple's float bits - stable, dependency-free. */
export function tupleHash(tuple: number[]): string {
  const buf = new DataView(new ArrayBuffer(8))
  let h = 2166136261
  for (const v of tuple) {
    buf.setFloat64(0, v)
    for (let i = 0; i < 8; i++) {
      h ^= buf.getUint8(i)
      h = Math.imul(h, 16777619)
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
