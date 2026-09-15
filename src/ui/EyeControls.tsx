// ORB_EYE_SPEC §6: every eye value on a leva slider under "eye (showcase)".
// The `enabled` checkbox is the same opt-in as the HUD's EYE button (both
// go through the store); the rest render only while enabled so the
// daily-work panel stays uncluttered. Writes go straight into EYE (the
// FEEL/NCONF pattern) - the channel reads them live.

import { button, useControls } from 'leva'
import { useEffect } from 'react'
import { EYE } from '../input/eye/config'
import { useStore } from '../store'

type NumKey = { [K in keyof typeof EYE]: (typeof EYE)[K] extends number ? K : never }[keyof typeof EYE]

const FOLDER = 'eye (showcase)'
const whenEnabled = { render: (get: (k: string) => unknown) => get(`${FOLDER}.enabled`) === true }

function slider(key: NumKey, min: number, max: number, step: number) {
  return {
    value: EYE[key],
    min,
    max,
    step,
    onChange: (v: number) => {
      EYE[key] = v
    },
    ...whenEnabled,
  }
}

export function EyeControls() {
  const eyeEnabled = useStore((s) => s.eyeEnabled)
  const setEyeEnabled = useStore((s) => s.setEyeEnabled)
  const [, set] = useControls(FOLDER, () => ({
    enabled: {
      value: eyeEnabled,
      onChange: (v: boolean) => {
        if (useStore.getState().eyeEnabled !== v) setEyeEnabled(v)
      },
    },
    showDebug: { value: EYE.showDebug, onChange: (v: boolean) => { EYE.showDebug = v }, ...whenEnabled },
    mode: { value: EYE.mode, options: ['point', 'steer'], onChange: (v: 'point' | 'steer') => { EYE.mode = v }, ...whenEnabled },
    'record 10 s': button(() => { void window.__eyeRecord?.(10, 'clip') }),
    'drill (saccades)': button(() => { void window.__eyeDrill?.() }),
    drillStepMs: slider('drillStepMs', 1000, 4000, 250),
    blinkIrisThreshold: slider('blinkIrisThreshold', 0.1, 0.9, 0.05),
    blinkMargin: slider('blinkMargin', 0.05, 0.5, 0.05),
    medianMaxDtMs: slider('medianMaxDtMs', 20, 200, 5),
    handEveryNWhileEye: slider('handEveryNWhileEye', 1, 4, 1),
    calHeadTurn: { value: EYE.calHeadTurn, onChange: (v: boolean) => { EYE.calHeadTurn = v }, ...whenEnabled },
    calHeadTurnMs: slider('calHeadTurnMs', 2000, 12000, 500),
    postBlinkFrames: slider('postBlinkFrames', 0, 4, 1),
    foreshortening: { value: EYE.foreshortening, onChange: (v: boolean) => { EYE.foreshortening = v }, ...whenEnabled },
    vergenceMax: slider('vergenceMax', 0.1, 1, 0.05),
    eyeQualityWeights: { value: EYE.eyeQualityWeights, onChange: (v: boolean) => { EYE.eyeQualityWeights = v }, ...whenEnabled },
    headMinCutoffHz: slider('headMinCutoffHz', 0.2, 5, 0.1),
    irisBeta: slider('irisBeta', 0, 10, 0.25),
    medianPrefilter: { value: EYE.medianPrefilter, onChange: (v: boolean) => { EYE.medianPrefilter = v }, ...whenEnabled },
    freezeEnabled: { value: EYE.freezeEnabled, onChange: (v: boolean) => { EYE.freezeEnabled = v }, ...whenEnabled },
    freezeBelowPxPerSec: slider('freezeBelowPxPerSec', 10, 300, 5),
    freezeAfterMs: slider('freezeAfterMs', 0, 500, 10),
    freezeReleasePxPerSec: slider('freezeReleasePxPerSec', 20, 600, 10),
    freezeTolerancePx: slider('freezeTolerancePx', 0, 60, 1),
    pointSwitchMargin: slider('pointSwitchMargin', 0.3, 1, 0.05),
    learnDecayMin: slider('learnDecayMin', 0, 20, 0.5),
    wideModel: { value: EYE.wideModel, onChange: (v: boolean) => { EYE.wideModel = v }, ...whenEnabled },
    irisBlendWeight: slider('irisBlendWeight', 0, 1, 0.05),
    blendCheck: { value: EYE.blendCheck, onChange: (v: boolean) => { EYE.blendCheck = v }, ...whenEnabled },
    pointMinRadiusPx: slider('pointMinRadiusPx', 20, 200, 5),
    pointRadiusMult: slider('pointRadiusMult', 1, 8, 0.25),
    pointHoldMs: slider('pointHoldMs', 0, 600, 10),
    pointReleaseFactor: slider('pointReleaseFactor', 1, 3, 0.05),
    pointDwellMs: slider('pointDwellMs', 0, 2500, 50),
    fixationMs: slider('fixationMs', 0, 800, 10),
    fixationMaxMs: slider('fixationMaxMs', 100, 1500, 10),
    learnFromConfirms: { value: EYE.learnFromConfirms, onChange: (v: boolean) => { EYE.learnFromConfirms = v }, ...whenEnabled },
    learnFromClicks: { value: EYE.learnFromClicks, onChange: (v: boolean) => { EYE.learnFromClicks = v }, ...whenEnabled },
    learnMaxSamples: slider('learnMaxSamples', 4, 60, 1),
    learnMinSamples: slider('learnMinSamples', 4, 12, 1),
    learnOutlierPx: slider('learnOutlierPx', 20, 200, 5),
    fixationRadiusPx: slider('fixationRadiusPx', 10, 200, 5),
    blinkFreeze: { value: EYE.blinkFreeze, onChange: (v: boolean) => { EYE.blinkFreeze = v }, ...whenEnabled },
    calNinePoints: { value: EYE.calNinePoints, onChange: (v: boolean) => { EYE.calNinePoints = v }, ...whenEnabled },
    calPointHoldMs: slider('calPointHoldMs', 800, 4000, 100),
    calSampleWindowMs: slider('calSampleWindowMs', 300, 2000, 50),
    calInset: slider('calInset', 0.2, 0.8, 0.05),
    calMaxResidualPx: slider('calMaxResidualPx', 40, 400, 10),
    detectEveryNFrames: slider('detectEveryNFrames', 1, 4, 1),
    confidenceMin: slider('confidenceMin', 0.1, 0.9, 0.05),
    blinkThreshold: slider('blinkThreshold', 0.2, 0.9, 0.05),
    headYawMaxDeg: slider('headYawMaxDeg', 15, 60, 1),
    headPitchMaxDeg: slider('headPitchMaxDeg', 15, 60, 1),
    neutralNoseDrop: slider('neutralNoseDrop', 0.2, 1.0, 0.01),
    irisGainDeg: slider('irisGainDeg', 0, 30, 0.5),
    pxPerDeg: slider('pxPerDeg', 10, 100, 1),
    minCutoffHz: slider('minCutoffHz', 0.2, 5, 0.1),
    beta: slider('beta', 0, 0.1, 0.005),
    dCutoffHz: slider('dCutoffHz', 0.2, 5, 0.1),
    deadZone: slider('deadZone', 0.1, 0.6, 0.01),
    hysteresis: slider('hysteresis', 0, 0.2, 0.01),
    attendMs: slider('attendMs', 100, 1500, 25),
    releaseMs: slider('releaseMs', 50, 800, 25),
    maxDegPerSec: slider('maxDegPerSec', 2, 40, 1),
    resumeMs: slider('resumeMs', 100, 2000, 50),
    holdMs: slider('holdMs', 50, 800, 25),
    decayMs: slider('decayMs', 100, 1200, 25),
    irisOkRateMin: slider('irisOkRateMin', 0, 1, 0.05),
  }), { collapsed: true })
  // The HUD button and the checkbox are one opt-in: mirror store -> leva.
  useEffect(() => {
    set({ enabled: eyeEnabled })
  }, [eyeEnabled, set])
  return null
}
