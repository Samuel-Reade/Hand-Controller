# Orb Shell

Gesture-navigated orb shell for analytics dashboards, rendered as a neural
star-network: reports are nodes orbiting a central anchor; whatever rotates
into the fixed reticle is selected, and categories drill in (tap a hub star
to fly into its system, tap the anchor to fly back out). Driven by
mouse/keyboard or webcam hand tracking (pinch-drag to rotate, pinch-tap to
open). See ORB_BUILD_SPEC.md for the base spec, ORB_NEURAL_PORT_SPEC.md +
PORT_LOG.md for the neural port, and DECISIONS.md for build choices.
`?scene=globe` serves the original globe build for comparison.

- `npm run dev` - dev server (leva tuning panel included)
- `npm test` - geometry / physics / gesture-harness suites
- `npm run typecheck` / `npm run lint` / `npm run build`

Dev URL params: `?yaw=<deg>&pitch=<deg>` initial orientation,
`?input=synthetic&scenario=flick|tap|slowDrag|...` drives the app from the
synthetic hand harness, `?tune=0` hides the tuning panel. `T` toggles
telemetry in prod builds.

Note: `node_modules` is symlinked to `node_modules.nosync` to keep iCloud
Desktop sync from evicting/churning it.
