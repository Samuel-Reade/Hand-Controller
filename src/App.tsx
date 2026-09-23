import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { createInputBus } from './input/InputBus'
import { EYE } from './input/eye/config'
import { useEyeInput } from './input/useEyeInput'
import { useHandInput } from './input/useHandInput'
import { useKeyboardInput } from './input/useKeyboardInput'
import { useVoiceInput } from './input/useVoiceInput'
import { usePointerInput } from './input/usePointerInput'
import { LabelLayer } from './orb/LabelLayer'
import { NCONF } from './neural/config'
import { Crosshair } from './neural/Crosshair'
import { NeuralScene } from './neural/NeuralScene'
import { applyNeuralFeelProfile } from './neural/profile'
import { OrbScene } from './orb/Orb'
import { Reticle } from './orb/Reticle'
import { FEEL, motionPrefs } from './config/feel'
import { useStore } from './store'
import { CameraConsent } from './ui/CameraConsent'
import { FLAGS } from './config/flags'
import { EyeCalibration } from './ui/EyeCalibration'
import { EyeControls } from './ui/EyeControls'
import { EyeDebug } from './ui/EyeDebug'
import { FeelPanel } from './ui/FeelPanel'
import { FocusAnnouncer } from './ui/FocusAnnouncer'
import { OrbitIndex } from './ui/OrbitIndex'
import { ReportPanel } from './ui/ReportPanel'
import { Telemetry } from './ui/Telemetry'

// Dev-only: ?zoomDrill=0 runs the two-hand zoom as a pure camera dolly that never
// drills (ORB_ZOOM_SPEC zoomCommitsDrill=false, the human-gate fork) - set at
// module load so the leva checkbox reflects it.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search)
  if (params.get('zoomDrill') === '0') {
    FEEL.zoomCommitsDrill = false
  }
  // ORB_EYE_SPEC §8: the debug overlay for gate screenshots; the mode for
  // the steer-route scenarios ('point' is the default).
  if (params.get('eyeDebug') === '1') EYE.showDebug = true
  const mode = params.get('eyeMode')
  if (mode === 'steer' || mode === 'point') EYE.mode = mode
}

// The neural scene runs the SAME integrator on its own FEEL profile (no free
// detent, fast settle, persistent zoom - see neural/profile.ts). Module load,
// before React mounts, so the leva sliders show the live values. The globe
// keeps the base FEEL untouched.
if (typeof window !== 'undefined') {
  if (new URLSearchParams(window.location.search).get('scene') !== 'globe') {
    applyNeuralFeelProfile()
  }
}

export default function App() {
  const bus = useMemo(() => createInputBus(), [])
  const stageRef = useRef<HTMLDivElement>(null)
  usePointerInput(stageRef, bus)
  useKeyboardInput(bus)
  useHandInput(bus)
  useEyeInput(bus) // ORB_EYE_SPEC: rides the hand shell's frames; never opens a camera
  useVoiceInput(bus) // "open" confirms the gazed node; listens only while eye control is on

  // prefers-reduced-motion: shorten the coast substantially, keep direct
  // manipulation - inertia IS the product (S11). CSS drops panel transitions.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => {
      motionPrefs.reducedMotion = mq.matches
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // Neural port (ORB_NEURAL_PORT_SPEC §0): the star network IS the rendered
  // object as of Slice P5. The globe build stays reachable at ?scene=globe
  // for side-by-side gates; ?chrome=0 hides overlays for screenshot gates.
  const neural = useMemo(
    () => new URLSearchParams(window.location.search).get('scene') !== 'globe',
    [],
  )

  // Tap opens the focused report (S9: tap vs drag is the entire click model).
  // In the neural scene a POSITIONED tap (a mouse click) is routed by the
  // scene itself - it hit-tests the node under the cursor (click-to-centre,
  // docs/DECISIONS.md) and opens a report only when a report was clicked.
  // The globe keeps every tap = open focused, unchanged.
  useEffect(
    () =>
      bus.on((e) => {
        if (e.type !== 'tap') return
        if (neural && e.x !== undefined) return
        useStore.getState().openFocused()
      }),
    [bus, neural],
  )

  // Dev mode (S9b): ?input=synthetic&scenario=<name> drives the live app
  // from the harness through the real pipeline - no camera required.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('input') !== 'synthetic') return
    let stop: (() => void) | undefined
    let cancelled = false
    const scenario = params.get('scenario') ?? 'flick'
    // ORB_EYE_SPEC §8: eye-* scenarios feed the gaze channel instead of the
    // hand pipeline; ?eye=1 opts the channel in as the HUD button would.
    if (params.get('eye') === '1') useStore.getState().setEyeEnabled(true)
    import(scenario.includes('eye-') ? './dev/syntheticEye' : './dev/syntheticHand').then((m) => {
      if (cancelled) return
      useStore.getState().setInputMode('synthetic')
      stop =
        'startSyntheticEyeDrive' in m
          ? m.startSyntheticEyeDrive(bus, scenario)
          : m.startSyntheticDrive(bus, scenario)
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [bus])

  // Closing the panel returns focus to the orb (S11 focus management).
  useEffect(
    () =>
      useStore.subscribe((state, prev) => {
        if (prev.openReport && !state.openReport) stageRef.current?.focus()
      }),
    [],
  )

  // Dev niceties for scripted screenshots: ?tune=0 hides the leva panel.
  const hideTune = useMemo(
    () => import.meta.env.DEV && new URLSearchParams(window.location.search).get('tune') === '0',
    [],
  )

  const hideChrome = useMemo(
    () => import.meta.env.DEV && new URLSearchParams(window.location.search).get('chrome') === '0',
    [],
  )

  return (
    <div className="app">
      <div
        className="stage"
        ref={stageRef}
        role="application"
        tabIndex={0}
        aria-label="Report orb. Arrow keys move between reports and orbits, Enter opens the focused report."
      >
        <Canvas
          camera={
            neural
              ? // far covers the widest dolly: camera.z / zoomMin (0.2) = 23000
                { fov: NCONF.camera.fov, position: [0, 0, NCONF.camera.z], near: 1, far: 60000 }
              : { fov: 40, position: [0, 0, 8.2], near: 0.1, far: 100 }
          }
          flat={neural}
          gl={{ antialias: true, alpha: true }}
          dpr={[1, 2]}
          onCreated={({ gl }) => {
            // If the browser ever kills the WebGL context (GPU reset, context
            // churn), recover with a clean reload instead of a dead black page.
            gl.domElement.addEventListener('webglcontextlost', (e) => {
              e.preventDefault()
              window.location.reload()
            })
          }}
        >
          {neural ? <NeuralScene bus={bus} /> : <OrbScene bus={bus} />}
        </Canvas>
      </div>
      {!hideChrome && (
        <>
          <LabelLayer />
          {/* The brass focus bracket is the globe's rotate-INTO-selection
              instrument (ORB_BUILD_SPEC §10). With free rotation and the
              sight, the neural scene showed two reticles on the anchor; it
              keeps only the sight. docs/DECISIONS.md, visual pass. */}
          {!neural && <Reticle bus={bus} />}
          {/* ORB_SELECT_SPEC §0 scope guard: the sight is neural-scene only;
              ?scene=globe keeps rotation-as-selection untouched. */}
          {neural && <Crosshair />}
          {neural && FLAGS.eye && <EyeDebug />}
          {neural && FLAGS.eye && <EyeCalibration />}
          {/* The orbit index is the globe's category ladder. The neural scene
              has no category grid to walk (user direction 2026-09-14: remove
              it); ?scene=globe keeps it. docs/DECISIONS.md. */}
          {!neural && <OrbitIndex bus={bus} />}
          <CameraConsent />
          <Telemetry />
        </>
      )}
      <ReportPanel />
      <FocusAnnouncer />
      <FeelPanel hidden={hideTune} />
      {neural && FLAGS.eye && <EyeControls />}
    </div>
  )
}
