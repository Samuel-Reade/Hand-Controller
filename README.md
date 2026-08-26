# Orb Shell

Gesture-navigated orb shell for analytics dashboards. Reports sit on a
rotating 3D sphere; whatever rotates into the fixed reticle is selected.
Driven by mouse/keyboard or webcam hand tracking (pinch-drag to rotate,
pinch-tap to open). See ORB_BUILD_SPEC.md (on the Desktop) for the full
spec and DECISIONS.md for choices made during the build.

- `npm run dev` - dev server (leva tuning panel included)
- `npm test` - geometry / physics / gesture-harness suites
- `npm run typecheck` / `npm run lint` / `npm run build`

Dev URL params: `?yaw=<deg>&pitch=<deg>` initial orientation,
`?input=synthetic&scenario=flick|tap|slowDrag|...` drives the app from the
synthetic hand harness, `?tune=0` hides the tuning panel. `T` toggles
telemetry in prod builds.

Note: `node_modules` is symlinked to `node_modules.nosync` to keep iCloud
Desktop sync from evicting/churning it.
