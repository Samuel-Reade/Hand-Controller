// Instrument telemetry (S10): lat, lon, angular velocity, lock state, fps,
// plus the two-hand zoom channel (ORB_ZOOM_SPEC section 5): hand count with
// per-slot pinch state, live zoom factor, current level. Reads orbRuntime /
// zoomRuntime on a 100ms interval and writes textContent directly - no React
// state, no per-frame renders. Visible in dev; toggled with T in prod.

import { useEffect, useRef, useState } from 'react'
import { zoomRuntime } from '../input/zoomView'
import { orbRuntime } from '../orb/useOrbPhysics'

const RAD2DEG = 180 / Math.PI

export function Telemetry() {
  const [visible, setVisible] = useState(import.meta.env.DEV)
  const latRef = useRef<HTMLSpanElement>(null)
  const lonRef = useRef<HTMLSpanElement>(null)
  const velRef = useRef<HTMLSpanElement>(null)
  const lockRef = useRef<HTMLSpanElement>(null)
  const fpsRef = useRef<HTMLSpanElement>(null)
  const handsRef = useRef<HTMLSpanElement>(null)
  const zoomRef = useRef<HTMLSpanElement>(null)
  const lvlRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 't') return
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return
      }
      setVisible((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!visible) return
    const id = setInterval(() => {
      const p = orbRuntime.physics
      if (latRef.current) {
        const lat = p.pitch * RAD2DEG
        latRef.current.textContent = `${lat >= 0 ? '+' : '−'}${Math.abs(lat).toFixed(1)}°`
      }
      if (lonRef.current) {
        const lon = (((-p.yaw * RAD2DEG) % 360) + 360) % 360
        lonRef.current.textContent = `${lon.toFixed(1).padStart(5, '0')}°`
      }
      if (velRef.current) {
        velRef.current.textContent = Math.hypot(p.yawVel, p.pitchVel).toFixed(2)
      }
      if (lockRef.current) {
        const state = p.engaged ? 'DRAG' : p.lockedYaw && p.lockedPitch ? 'LOCK' : 'COAST'
        lockRef.current.textContent = state
        lockRef.current.dataset.state = state.toLowerCase()
      }
      if (fpsRef.current) fpsRef.current.textContent = String(orbRuntime.fps)
      const z = zoomRuntime
      if (handsRef.current) {
        // count, then one glyph per slot: ● pinched · ○ open · · absent
        const glyph = (i: 0 | 1) => (!z.present[i] ? '·' : z.pinched[i] ? '●' : '○')
        handsRef.current.textContent = `${z.handCount} ${glyph(0)}${glyph(1)}`
      }
      if (zoomRef.current) {
        zoomRef.current.textContent = `${z.displayed.toFixed(2)}×`
        zoomRef.current.dataset.state = z.zooming ? 'zoom' : 'rest'
      }
      if (lvlRef.current) lvlRef.current.textContent = String(z.level)
    }, 100)
    return () => clearInterval(id)
  }, [visible])

  if (!visible) return null
  return (
    <div className="telemetry" aria-hidden="true">
      <span className="t-key">LAT</span> <span ref={latRef}>—</span>
      <span className="t-key">LON</span> <span ref={lonRef}>—</span>
      <span className="t-key">ω</span> <span ref={velRef}>—</span>
      <span className="t-key">ST</span> <span ref={lockRef} className="t-lock">—</span>
      <span className="t-key">HANDS</span> <span ref={handsRef}>—</span>
      <span className="t-key">ZOOM</span> <span ref={zoomRef} className="t-zoom">—</span>
      <span className="t-key">LVL</span> <span ref={lvlRef}>—</span>
      <span className="t-key">FPS</span> <span ref={fpsRef}>—</span>
    </div>
  )
}
