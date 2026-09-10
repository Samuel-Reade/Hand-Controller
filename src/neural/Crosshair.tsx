// The fixed sight (ORB_SELECT_SPEC §1 LOCKED / §3, slice PT1).
//
// A thin hairline crosshair pinned to screen centre. It is a SIGHT, not a
// cursor: it never tracks the hand and never moves - the user rotates the
// field to bring a node under it. Three states (§3):
//   idle        hairline, low opacity
//   acquired    a thin ring is drawn at the highlighted node's projected
//               position; the crosshair tightens and takes the node's hue
//   confirming  the ring closes/fills briefly so a tap reads as registered
//               before the transition starts
//
// Reads pointRuntime on rAF and writes DOM directly - no React state per
// frame (the Telemetry / LabelLayer pattern). PT1 is read-only: this
// overlay draws, it never selects.

import { useEffect, useRef } from 'react'
import { NCONF } from './config'
import { pointRuntime } from './pointing'

export function Crosshair() {
  const rootRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    let lastState = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const root = rootRef.current
      const ring = ringRef.current
      if (!root || !ring) return
      const p = pointRuntime

      const state = p.confirming && p.name ? 'confirming' : p.name ? 'acquired' : 'idle'
      if (state !== lastState) {
        root.dataset.state = state
        lastState = state
      }
      root.style.setProperty('--arm', `${NCONF.point.crosshairSize}px`)

      // The arms take the target's hue whenever anything is highlighted -
      // including the anchor fallback, where that IS the whole signal.
      if (p.name) root.style.setProperty('--sight', p.hue)
      else root.style.removeProperty('--sight')
      // The ring hugs the star's disc; ringR = 0 means "no ring" (anchor).
      if (p.name && p.ringR > 0) {
        const r = Math.max(6, Math.min(140, p.ringR))
        ring.style.transform = `translate(-50%, -50%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`
        ring.style.width = `${(r * 2).toFixed(1)}px`
        ring.style.height = `${(r * 2).toFixed(1)}px`
        ring.style.borderColor = p.hue
        ring.style.opacity = String(NCONF.point.ringOpacity)
      } else {
        ring.style.opacity = '0'
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="crosshair" ref={rootRef} data-state="idle" aria-hidden="true">
      <span className="crosshair-arm n" />
      <span className="crosshair-arm s" />
      <span className="crosshair-arm w" />
      <span className="crosshair-arm e" />
      <div className="crosshair-ring" ref={ringRef} />
    </div>
  )
}
