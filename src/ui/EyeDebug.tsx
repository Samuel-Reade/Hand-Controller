// ORB_EYE_SPEC §6 `showDebug`: the gaze point as an ink dot, the dead-zone
// ring, and a state label - for the human gates. Reads eyeRuntime on rAF
// and writes DOM directly (the Crosshair pattern). Ink, never violet.
//
// Diagnostics (EYE_ACCURACY_PLAN phase 1): the RAW point as a hollow dot
// (calm hollow + laggy filled = the filter; wild hollow = the source), the
// HEAD-ONLY point as a small square (on top of the filled dot = the eyes
// are contributing nothing), per-eye iris bars, the blendshape bars, the
// per-eye ok rate, and the detection rate.

import { useEffect, useRef } from 'react'
import { eyeRuntime } from '../input/eye/channel'
import { EYE } from '../input/eye/config'

export function EyeDebug() {
  const rootRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)
  const rawRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const barsRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const root = rootRef.current
      const ring = ringRef.current
      const dot = dotRef.current
      const rawDot = rawRef.current
      const headDot = headRef.current
      const bars = barsRef.current
      const label = labelRef.current
      if (!root || !ring || !dot || !rawDot || !headDot || !bars || !label) return
      const show = EYE.showDebug && eyeRuntime.state !== 'off'
      root.hidden = !show
      if (!show) return
      const e = eyeRuntime
      const R = Math.min(window.innerWidth, window.innerHeight) / 2
      const d = 2 * R * EYE.deadZone
      ring.style.width = `${d.toFixed(0)}px`
      ring.style.height = `${d.toFixed(0)}px`
      dot.style.transform = `translate(${e.gazeX.toFixed(1)}px, ${e.gazeY.toFixed(1)}px)`
      dot.style.opacity = e.facePresent ? '1' : '0.25'
      rawDot.style.transform = `translate(${e.rawX.toFixed(1)}px, ${e.rawY.toFixed(1)}px)`
      rawDot.style.opacity = e.facePresent ? '0.8' : '0'
      headDot.style.transform = `translate(${e.headX.toFixed(1)}px, ${e.headY.toFixed(1)}px)`
      headDot.style.opacity = e.facePresent ? '0.8' : '0'
      // bars: per-eye geometric iris x/y, per-eye blendshape x/y (-1..1 -> 0..100 %)
      const r = e.rawFeatures
      const rows: [string, number][] = [
        ['iris L x', r.eyeLX], ['iris L y', r.eyeLY], ['iris R x', r.eyeRX], ['iris R y', r.eyeRY],
        ['blend L x', r.blendLX], ['blend L y', r.blendLY], ['blend R x', r.blendRX], ['blend R y', r.blendRY],
      ]
      const kids = bars.children
      for (let i = 0; i < rows.length; i++) {
        const el = kids[i] as HTMLElement | undefined
        if (!el) continue
        const [name, v] = rows[i]
        const fill = el.firstElementChild as HTMLElement
        const pct = Math.max(-1, Math.min(1, v)) * 50
        fill.style.left = `${50 + Math.min(0, pct)}%`
        fill.style.width = `${Math.abs(pct)}%`
        el.dataset.name = `${name} ${v >= 0 ? '+' : ''}${v.toFixed(2)}`
      }
      label.textContent =
        `EYE ${e.state.toUpperCase()}${e.headOnly ? ' · HEAD ONLY' : ''}${e.frozen ? ' · FROZEN' : ''}${e.wideModel ? ' · WIDE' : ''}\n` +
        `yaw ${e.yaw.toFixed(1)}°  pitch ${e.pitch.toFixed(1)}°  norm ${e.norm.toFixed(2)}  ${e.headSource}\n` +
        `conf ${e.confidence.toFixed(2)}  iris ok L ${(e.okRateL * 100).toFixed(0)}% R ${(e.okRateR * 100).toFixed(0)}%` +
        `  blink thr ${e.blinkThresholdL.toFixed(2)}/${e.blinkThresholdR.toFixed(2)}${e.vergenceDrop ? `  drop ${e.vergenceDrop}` : ''}\n` +
        `${e.detectHz} Hz  face ${e.detectMs.toFixed(0)} ms ${e.delegate}  hand ${e.handDetectMs.toFixed(0)} ms ${e.handDelegate}${e.medianActive ? '' : '  median off'}\n` +
        `cal ${e.calibratedPoints ? `${e.calibratedPoints} pts ${e.calibrationResidualPx.toFixed(0)} px` : 'default map'}` +
        `  eyes vs head ${Math.hypot(e.gazeX - e.headX, e.gazeY - e.headY).toFixed(0)} px`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="eye-debug" ref={rootRef} hidden aria-hidden="true">
      <div className="eye-debug-ring" ref={ringRef} />
      <div className="eye-debug-dot" ref={dotRef} />
      <div className="eye-debug-dot eye-debug-raw" ref={rawRef} />
      <div className="eye-debug-dot eye-debug-head" ref={headRef} />
      <div className="eye-debug-label" ref={labelRef} />
      <div className="eye-debug-bars" ref={barsRef}>
        {Array.from({ length: 8 }, (_, i) => (
          <div className="eye-debug-bar" key={i}>
            <span className="eye-debug-bar-fill" />
          </div>
        ))}
      </div>
    </div>
  )
}
