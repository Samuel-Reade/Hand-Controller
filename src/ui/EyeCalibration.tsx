// Gaze calibration flow (ORB_EYE_SPEC E4, essential in 'point' mode): five
// targets - centre, then four corners at calInset - each shown for
// calPointHoldMs; the FILTERED features from the last calSampleWindowMs are
// median-pooled per target and fitted (input/eye/calibration.ts). The
// result lives on the channel for this session only. Escape cancels. The
// gaze pointer is suspended while this is on screen (store.eyeCalibrating).
// Targets are ivory (data); no violet - nothing here is pressable.

import { useEffect, useMemo, useState } from 'react'
import { calibrationTargets, fitCalibrationReport, medianFeatures } from '../input/eye/calibration'
import type { CalibrationSample, FitReport } from '../input/eye/calibration'
import { eyeRuntime } from '../input/eye/channel'
import { EYE } from '../input/eye/config'
import { screenPointDefault } from '../input/eye/face'
import type { GazeFeatures } from '../input/eye/face'

declare global {
  interface Window {
    /** DEV: the last calibration's samples + report, for diagnosis */
    __eyeCal?: { samples: CalibrationSample[]; report: FitReport; faceFrames: number[] }
  }
}
import { eyeSetBase } from '../input/useEyeInput'
import { useStore } from '../store'

export function EyeCalibration() {
  const calibrating = useStore((s) => s.eyeCalibrating)
  const setCalibrating = useStore((s) => s.setEyeCalibrating)
  const setResult = useStore((s) => s.setEyeCalResult)
  const [index, setIndex] = useState(0)
  const [sampling, setSampling] = useState(false)
  // The target set for this run, fixed when the flow starts.
  const targets = useMemo(
    () => (calibrating ? calibrationTargets({ w: window.innerWidth, h: window.innerHeight }, EYE.calInset, EYE.calNinePoints) : []),
    [calibrating],
  )

  useEffect(() => {
    if (!calibrating || targets.length === 0) return
    const samples: CalibrationSample[] = []
    const faceFrames: number[] = [] // face-present frames sampled per target
    let i = 0
    let cancelled = false
    let window_: GazeFeatures[] = []
    let raf = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const collect = () => {
      raf = requestAnimationFrame(collect)
      if (eyeRuntime.facePresent) window_.push({ ...eyeRuntime.features })
    }

    const showTarget = () => {
      if (cancelled) return
      if (i >= targets.length) return finish()
      setIndex(i)
      setSampling(false)
      window_ = []
      // settle, then sample the last calSampleWindowMs
      timer = setTimeout(() => {
        if (cancelled) return
        setSampling(true)
        window_ = []
        raf = requestAnimationFrame(collect)
        timer = setTimeout(() => {
          cancelAnimationFrame(raf)
          const med = medianFeatures(window_)
          faceFrames.push(window_.length)
          if (med) samples.push({ features: med, target: targets[i] })
          i++
          showTarget()
        }, EYE.calSampleWindowMs)
      }, Math.max(0, EYE.calPointHoldMs - EYE.calSampleWindowMs))
    }

    const finish = () => {
      const viewport = { w: window.innerWidth, h: window.innerHeight }
      const report = fitCalibrationReport(samples, EYE, (f) => screenPointDefault(f, EYE, viewport), 1e-3, viewport)
      eyeSetBase(samples, report.accepted ? report.cal : null)
      // Say WHY when it fails, and how good it is when it passes.
      const px = Number.isFinite(report.residualPx) ? `${Math.round(report.residualPx)}PX` : '-'
      const curved = report.curved ? ' ·C' : ''
      const label =
        report.reason === 'ok' ? `CAL ${px}${curved}`
        : report.reason === 'better-than-default' ? `CAL ${px} (COARSE)${curved}`
        : report.reason === 'too-few-samples' ? `CAL FAILED · NO FACE ${samples.length}/${targets.length}`
        : report.reason === 'singular' ? 'CAL FAILED · NO SPREAD'
        : `CAL FAILED · ${px} > ${Math.round(EYE.calMaxResidualPx)}`
      setResult(label)
      if (import.meta.env.DEV) {
        window.__eyeCal = { samples, report, faceFrames }
        console.info('[eye] calibration', label, {
          residualPx: report.residualPx, defaultResidualPx: report.defaultResidualPx, faceFrames,
          curved: report.curved, looLinearPx: report.looLinearPx, looCurvedPx: report.looCurvedPx,
          samples: samples.map((s) => ({ t: [Math.round(s.target.x), Math.round(s.target.y)], f: {
            headYaw: +s.features.headYaw.toFixed(2), headPitch: +s.features.headPitch.toFixed(2),
            irisX: +s.features.irisX.toFixed(3), irisY: +s.features.irisY.toFixed(3) } })),
        })
      }
      setCalibrating(false)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancelled = true
      setResult(null)
      setCalibrating(false)
    }
    window.addEventListener('keydown', onKey, true)
    // start on the next tick: state updates belong to the timers, not the effect body
    const kick = setTimeout(showTarget, 0)
    return () => {
      cancelled = true
      clearTimeout(kick)
      clearTimeout(timer)
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, true)
      setIndex(0)
      setSampling(false)
    }
  }, [calibrating, targets, setCalibrating, setResult])

  if (!calibrating) return null
  const t = targets[index] ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  return (
    <div className="eye-cal" aria-hidden="true">
      <div
        className="eye-cal-target"
        data-sampling={sampling ? '1' : '0'}
        style={{ transform: `translate(${t.x}px, ${t.y}px)` }}
      />
      <div className="eye-cal-note">
        Look at the ring · {index + 1} / {targets.length || 5} · ESC cancels
      </div>
    </div>
  )
}
