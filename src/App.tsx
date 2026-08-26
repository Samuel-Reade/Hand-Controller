import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { createInputBus } from './input/InputBus'
import { useHandInput } from './input/useHandInput'
import { useKeyboardInput } from './input/useKeyboardInput'
import { usePointerInput } from './input/usePointerInput'
import { LabelLayer } from './orb/LabelLayer'
import { OrbScene } from './orb/Orb'
import { Reticle } from './orb/Reticle'
import { motionPrefs } from './config/feel'
import { useStore } from './store'
import { CameraConsent } from './ui/CameraConsent'
import { FeelPanel } from './ui/FeelPanel'
import { FocusAnnouncer } from './ui/FocusAnnouncer'
import { OrbitIndex } from './ui/OrbitIndex'
import { ReportPanel } from './ui/ReportPanel'
import { Telemetry } from './ui/Telemetry'

export default function App() {
  const bus = useMemo(() => createInputBus(), [])
  const stageRef = useRef<HTMLDivElement>(null)
  usePointerInput(stageRef, bus)
  useKeyboardInput(bus)
  useHandInput(bus)

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

  // Tap opens the focused report (S9: tap vs drag is the entire click model).
  useEffect(
    () =>
      bus.on((e) => {
        if (e.type === 'tap') useStore.getState().openFocused()
      }),
    [bus],
  )

  // Dev mode (S9b): ?input=synthetic&scenario=<name> drives the live app
  // from the harness through the real pipeline - no camera required.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('input') !== 'synthetic') return
    let stop: (() => void) | undefined
    let cancelled = false
    import('./dev/syntheticHand').then((m) => {
      if (cancelled) return
      useStore.getState().setInputMode('synthetic')
      stop = m.startSyntheticDrive(bus, params.get('scenario') ?? 'flick')
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
          camera={{ fov: 40, position: [0, 0, 8.2], near: 0.1, far: 100 }}
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
          <OrbScene bus={bus} />
        </Canvas>
      </div>
      <LabelLayer />
      <Reticle bus={bus} />
      <OrbitIndex bus={bus} />
      <ReportPanel />
      <CameraConsent />
      <Telemetry />
      <FocusAnnouncer />
      <FeelPanel hidden={hideTune} />
    </div>
  )
}
