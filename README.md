# Orb Shell

Gesture-navigated orb shell for analytics dashboards, rendered as a neural
star-network: reports are nodes orbiting a central anchor; whatever rotates
into the fixed reticle is selected, and categories drill in (tap a hub star
to fly into its system, tap the anchor to fly back out). Driven by
mouse/keyboard or webcam hand tracking (pinch-drag to rotate, pinch-tap to
open, both hands pinched and pulled toward you / pushed away to zoom in and
out - the zoom commits the drill at a threshold). Specs live in `docs/`: see
docs/ORB_BUILD_SPEC.md for the base spec, docs/ORB_NEURAL_PORT_SPEC.md +
docs/PORT_LOG.md for the neural port, docs/ORB_ZOOM_SPEC.md for the two-hand
zoom, docs/ORB_SELECT_SPEC.md for crosshair pointing + free rotation (not yet
built - it supersedes the zoom spec's drill-on-commit), and
docs/DECISIONS.md for build choices.
`?scene=globe` serves the original globe build for comparison (zoom-less).

- `npm run dev` - dev server (leva tuning panel included)
- `npm test` - geometry / physics / gesture-harness / two-hand zoom suites
- `npm run typecheck` / `npm run lint` / `npm run build`
- `node scripts/verify-neural.mjs` / `node scripts/verify-zoom.mjs` /
  `node scripts/verify-pointing.mjs` - machine gates against a running dev
  server (pass `--use-angle=metal` fps gates)

Visual + salience passes (2026-09-09): glow fades with on-screen size so
zoom never washes the frame; the backdrop rides with the camera; the neural
scene shows one reticle (the sight, ring hugging the star). Motion is the
The field has Rally's shape: ~160 main posts (shouts) on the brain at random
distances within limits (0.6-1.35 R), echoes one level deep - several on a
popular post (a conversation), rarely on a minor one - and nothing deeper. RALLY §5 channels on PLACEHOLDER
data until shout analytics exist: SIZE and glow = cumulative rallies
(`src/neural/rallies.ts`: two bands - most posts minor and dim, a popular
minority big and bright; rolled up parent >= children per §3; a post's spoke
follows its traction), MOMENTUM = motion (`src/neural/momentum.ts`, ~10% of
posts pulse and their trails carry an inward energy band; the rest are
still). Discs are lit like stars (hot core-white heart, saturated rim); popular posts
blaze wider and brighter and the top band carries the anchor's diffraction
spikes.
Geometry never moves. Clusters are tight (children scatter half as far as
the prototype's spray - `tests/cluster.test.ts` pins it; "neural cluster"
sliders). `verify-neural.mjs` asserts the background stays dark at a real
7x zoom.

The neural scene runs the shared physics on its own FEEL profile
(`src/neural/profile.ts`: no free detent, fast settle, persistent zoom, camera
outside the field); `?scene=globe` keeps the base FEEL.

Dev URL params: `?yaw=<deg>&pitch=<deg>` initial orientation,
`?input=synthetic&scenario=flick|tap|slowDrag|...` drives the app from the
synthetic hand harness (two-hand scenarios: `zoomIn`, `zoomOut`,
`zoomPeekRelease`, `oneHandNoZoom`, `secondHandJoins`, `oneHandDrops`,
`bothPinchJitter`, `asymmetricDepth`, `commitCooldown`; a comma list such as
`zoomIn,zoomOut` plays in sequence), `?zoomDrill=0` makes the zoom a pure
camera dolly that never drills, `?tune=0` hides the tuning panel, `?chrome=0`
hides overlays. `T` toggles telemetry in prod builds.

Note: keep this project OUT of iCloud-synced folders (Desktop, Documents).
Sync there evicts file contents and leaves conflict copies (`node_modules 2`,
`node_modules 3`), which breaks the toolchain; it lives in the home
directory for that reason. See docs/DECISIONS.md.
