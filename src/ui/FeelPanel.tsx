// Live tuning panel (S2, LOCKED): every feel constant on a slider. Leva's
// transient onChange writes straight into the FEEL object - physics and
// rendering read it live, so slider moves change the very next frame with
// zero React re-renders.
//
// The panel is closed by default behind a small gear in the top-right corner
// (user direction 2026-09-14). Leva's `hidden` unmounts only the panel DOM;
// the store and every useControls registration (this file, NeuralScene,
// EyeControls) stay live, so reopening shows the current values. The title
// bar's chevron closes it too - the controlled `collapsed` routes leva's
// collapse back into the gear's state, so the two never disagree.

import { Leva, useControls } from 'leva'
import { useState } from 'react'
import { FEEL } from '../config/feel'

type NumKey = {
  [K in keyof typeof FEEL]: (typeof FEEL)[K] extends number ? K : never
}[keyof typeof FEEL]

function slider(key: NumKey, min: number, max: number, step: number) {
  return {
    value: FEEL[key],
    min,
    max,
    step,
    onChange: (v: number) => {
      FEEL[key] = v
    },
  }
}

export function FeelPanel({ hidden }: { hidden: boolean }) {
  const [open, setOpen] = useState(false)
  useControls('rotation', {
    dragGain: slider('dragGain', 0.001, 0.02, 0.0005),
    friction: slider('friction', 0.2, 40, 0.05), // neural profile sits at 30 (no coast drift)
    detentPull: slider('detentPull', 0.5, 30, 0.25),
    detentBelow: slider('detentBelow', 0, 6, 0.05),
    forcedBoost: slider('forcedBoost', 1, 6, 0.1),
    snapEpsilon: slider('snapEpsilon', 0.001, 0.05, 0.001),
    snapVelocity: slider('snapVelocity', 0.05, 1, 0.01),
  })
  useControls('presentation', {
    falloff: slider('falloff', 0.5, 6, 0.1),
    itemGrow: slider('itemGrow', 0, 6, 0.1),
  })
  useControls('hand', {
    handGain: slider('handGain', 0.5, 6, 0.05),
    minCutoff: slider('minCutoff', 0.05, 5, 0.05),
    beta: slider('beta', 0, 0.2, 0.005),
    deadZone: slider('deadZone', 0, 0.02, 0.0005),
    pinchCutoff: slider('pinchCutoff', 1, 15, 0.5),
    pinchClose: slider('pinchClose', 0.1, 0.6, 0.01),
    pinchOpen: slider('pinchOpen', 0.15, 0.8, 0.01),
    tapMaxMs: slider('tapMaxMs', 50, 600, 10),
    tapMaxTravel: slider('tapMaxTravel', 0, 0.08, 0.001),
  })
  // Two-handed zoom (ORB_ZOOM_SPEC section 5). zoomCommitsDrill is a product
  // fork, not a tuning knob: off = pure camera dolly that never drills.
  useControls('zoom', {
    zoomGain: slider('zoomGain', 0.5, 5, 0.05),
    zoomMin: slider('zoomMin', 0.1, 1, 0.01),
    zoomMax: slider('zoomMax', 1, 16, 0.05),
    zoomInCommit: slider('zoomInCommit', 1.05, 3, 0.05),
    zoomOutCommit: slider('zoomOutCommit', 0.3, 0.95, 0.01),
    springBack: slider('springBack', 1, 40, 0.5),
    zoomCutoff: slider('zoomCutoff', 0.5, 15, 0.5),
    zoomBeta: slider('zoomBeta', 0, 0.2, 0.005),
    commitCooldownMs: slider('commitCooldownMs', 0, 1500, 10),
    twoHandFrames: slider('twoHandFrames', 1, 6, 1),
    zoomPersist: {
      value: FEEL.zoomPersist,
      onChange: (v: boolean) => {
        FEEL.zoomPersist = v
      },
    },
    zoomCommitsDrill: {
      value: FEEL.zoomCommitsDrill,
      onChange: (v: boolean) => {
        FEEL.zoomCommitsDrill = v
      },
    },
  })
  useControls('pointer', {
    tapMaxTravelPx: slider('tapMaxTravelPx', 2, 20, 1),
  })
  return (
    <>
      {!hidden && (
        <button
          type="button"
          className="feel-gear"
          aria-label="Tuning panel"
          aria-expanded={open}
          title="FEEL"
          onClick={() => setOpen((o) => !o)}
        >
          <GearIcon />
        </button>
      )}
      {/* An explicit <Leva> renders its panel inline (a child of .app, not
          leva's #leva__root portal); the wrapper is the CSS hook that hangs
          it under the gear. */}
      <div className="feel-leva">
        <Leva
          hidden={hidden || !open}
          collapsed={{
            collapsed: false,
            onChange: (collapsed) => {
              if (collapsed) setOpen(false)
            },
          }}
          titleBar={{ title: 'FEEL', drag: false, filter: true }}
        />
      </div>
    </>
  )
}

/** Eight-tooth gear, stroked - the instrument register, no fill, no glow. */
function GearIcon() {
  const teeth: string[] = []
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    const c = Math.cos(a)
    const s = Math.sin(a)
    teeth.push(
      `M${(8 + 4.6 * c).toFixed(2)} ${(8 + 4.6 * s).toFixed(2)}L${(8 + 6.8 * c).toFixed(2)} ${(8 + 6.8 * s).toFixed(2)}`,
    )
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="8" cy="8" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d={teeth.join('')} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
