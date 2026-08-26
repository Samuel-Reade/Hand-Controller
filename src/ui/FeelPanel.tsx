// Live tuning panel (S2, LOCKED): every feel constant on a slider. Leva's
// transient onChange writes straight into the FEEL object - physics and
// rendering read it live, so slider moves change the very next frame with
// zero React re-renders.

import { Leva, useControls } from 'leva'
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
  useControls('rotation', {
    dragGain: slider('dragGain', 0.001, 0.02, 0.0005),
    friction: slider('friction', 0.2, 8, 0.05),
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
  useControls('pointer', {
    tapMaxTravelPx: slider('tapMaxTravelPx', 2, 20, 1),
  })
  return <Leva hidden={hidden} collapsed={false} titleBar={{ title: 'FEEL' }} />
}
