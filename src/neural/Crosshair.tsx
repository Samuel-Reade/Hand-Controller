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
//
// Selection marker (click-to-centre, docs/DECISIONS.md): a crosshair drawn
// INSIDE the selected node - four arms from a small centre gap out to
// select.markScale of the node's visible radius (half of it), in the same
// violet as the hover ring (the Rally control colour) - that follows the
// node through its flight to the centre. The sight never moves; once the
// marker lands on top of it the sight's arms yield (data-mark-landed) so
// there is one cross at the centre, not two.
//
// Hover ring (mouse, and the gaze pointer): a violet circle - violet is the
// Rally CONTROL colour, never a data colour - just outside the node under
// the cursor, by the same hit-test a click uses; or, in ORB_EYE 'point'
// mode, just outside the node the eyes are on. The sight's own ring is the
// hand model's (a click never confirms at the sight), so in pointer mode it
// is not drawn: that ring borrowed the node's hue and filled on every
// mouse-down, which read as a red circle flashing round a selected red post.
//
// Gaze dot: while the gaze pointer is live a small ivory dot marks where
// the system thinks the eyes are - the feedback the user needs to aim.

import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { centerRuntime, hoverRuntime } from './centering'
import { NCONF } from './config'
import { gazeRuntime } from './gazeFocus'
import { PAL } from './palette'
import { pointRuntime } from './pointing'

const HOVER_PAD_PX = 4
const HOVER_MIN_R_PX = 9

export function Crosshair() {
  const rootRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const markRef = useRef<HTMLDivElement>(null)
  const hoverRef = useRef<HTMLDivElement>(null)
  const gazeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    let lastState = ''
    // The stage gets a pointer cursor while a node is hovered.
    const stage = document.querySelector<HTMLElement>('.stage')
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const root = rootRef.current
      const ring = ringRef.current
      const mark = markRef.current
      const hover = hoverRef.current
      const gaze = gazeRef.current
      if (!root || !ring || !mark || !hover || !gaze) return
      const p = pointRuntime
      const pointerMode = useStore.getState().inputMode === 'pointer'

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
      // Hand model only - see the header.
      if (p.name && p.ringR > 0 && !pointerMode) {
        const r = Math.max(6, Math.min(140, p.ringR))
        ring.style.transform = `translate(-50%, -50%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`
        ring.style.width = `${(r * 2).toFixed(1)}px`
        ring.style.height = `${(r * 2).toFixed(1)}px`
        ring.style.borderColor = p.hue
        ring.style.opacity = String(NCONF.point.ringOpacity)
      } else {
        ring.style.opacity = '0'
      }

      // The selection marker rides the centred node, inside its bounds:
      // half-size = markScale x the node's visible radius (floored so a
      // minor post still shows one), arms from the centre gap out to there.
      const c = centerRuntime
      const landed = c.name !== null && c.k >= 1
      if (c.name) {
        const half = Math.max(NCONF.select.markMinPx, Math.min(200, c.r) * NCONF.select.markScale)
        const gap = Math.min(NCONF.select.markGapPx, half * 0.5)
        mark.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px)`
        mark.style.setProperty('--gap', `${gap.toFixed(1)}px`)
        mark.style.setProperty('--mark-arm', `${(half - gap).toFixed(1)}px`)
        mark.style.setProperty('--mark', PAL.violet.body)
        mark.style.opacity = '1'
        mark.dataset.landed = landed ? '1' : '0'
      } else {
        mark.style.opacity = '0'
      }
      const landedFlag = landed ? '1' : '0'
      if (root.dataset.markLanded !== landedFlag) root.dataset.markLanded = landedFlag

      // The hover ring, just outside the node under the cursor - or under
      // the eyes (source 'gaze', any input mode).
      const h = hoverRuntime
      const showHover = h.name !== null && (h.source === 'gaze' || pointerMode)
      if (showHover) {
        const r = Math.max(HOVER_MIN_R_PX, Math.min(220, h.r + HOVER_PAD_PX))
        hover.style.transform = `translate(-50%, -50%) translate(${h.x.toFixed(1)}px, ${h.y.toFixed(1)}px)`
        hover.style.width = `${(r * 2).toFixed(1)}px`
        hover.style.height = `${(r * 2).toFixed(1)}px`
        hover.dataset.source = h.source
        // Ring confidence (plan phase 5): a gaze ring brightens and its
        // dashes close up as the fixation stabilises - solid once ~10
        // frames agree - so the user can see when a confirm will land.
        if (h.source === 'gaze') {
          const conf = Math.min(1, gazeRuntime.fixationN / 10)
          hover.style.opacity = (0.45 + 0.55 * conf).toFixed(2)
          hover.dataset.confident = conf >= 1 ? '1' : '0'
        } else {
          hover.style.opacity = '1'
        }
      } else {
        hover.style.opacity = '0'
      }
      const mouseHover = showHover && h.source === 'mouse'
      if (stage && stage.style.cursor !== (mouseHover ? 'pointer' : '')) stage.style.cursor = mouseHover ? 'pointer' : ''

      // The gaze dot.
      const g = gazeRuntime
      if (g.live) {
        gaze.style.transform = `translate(${g.x.toFixed(1)}px, ${g.y.toFixed(1)}px)`
        gaze.style.opacity = '1'
      } else {
        gaze.style.opacity = '0'
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      if (stage) stage.style.cursor = ''
    }
  }, [])

  return (
    <div className="crosshair" ref={rootRef} data-state="idle" aria-hidden="true">
      <span className="crosshair-arm n" />
      <span className="crosshair-arm s" />
      <span className="crosshair-arm w" />
      <span className="crosshair-arm e" />
      <div className="crosshair-ring" ref={ringRef} />
      <div className="crosshair-hover" ref={hoverRef} style={{ borderColor: PAL.violet.body }} />
      <div className="crosshair-gaze" ref={gazeRef} />
      <div className="crosshair-mark" ref={markRef} data-landed="0">
        <span className="crosshair-mark-arm n" />
        <span className="crosshair-mark-arm s" />
        <span className="crosshair-mark-arm w" />
        <span className="crosshair-mark-arm e" />
      </div>
    </div>
  )
}
