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
