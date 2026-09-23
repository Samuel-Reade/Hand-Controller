// Gaze calibration flow (ORB_EYE_SPEC E4, essential in 'point' mode): nine
// (or five) targets - centre, then the ring at calInset - each shown for
// calPointHoldMs; the FILTERED features from the last calSampleWindowMs are
// median-pooled per target and fitted (input/eye/calibration.ts). Then,
// optionally, a HEAD-TURN stage: the centre ring stays up while the user
// slowly turns their head with their eyes on it, sampled every 250 ms
// with the centre as the target. Rings at one head pose leave the fit
// unable to tell head gain from eye gain (the two move together toward
// every ring); the head-turn samples pin it down, which is what keeps the
// map true when the head moves (the first real head-turn clip drifted
// 406 px). The result lives on the channel for this session only. Escape
// cancels. The gaze pointer is suspended while this is on screen
// (store.eyeCalibrating). Targets are ivory (data); nothing here is pressable.

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
  const drill = useStore((s) => s.eyeDrill)
  const recentring = useStore((s) => s.eyeRecentring)
  const [index, setIndex] = useState(0)
  const [sampling, setSampling] = useState(false)
  const [headTurn, setHeadTurn] = useState(false)
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

    // The head-turn stage: the centre ring, one sample per 250 ms window,
    // target = centre, for calHeadTurnMs.
    const headTurnStage = () => {
      if (cancelled) return
      setHeadTurn(true)
      setSampling(true)
      const centre = targets[0]
      let stageWindow: GazeFeatures[] = []
      const tick = () => {
        raf = requestAnimationFrame(tick)
        if (eyeRuntime.facePresent) stageWindow.push({ ...eyeRuntime.features })
      }
      raf = requestAnimationFrame(tick)
      const every = setInterval(() => {
        const med = medianFeatures(stageWindow)
        stageWindow = []
        if (med) samples.push({ features: med, target: centre })
      }, 250)
      timer = setTimeout(() => {
        clearInterval(every)
        cancelAnimationFrame(raf)
        finish()
      }, EYE.calHeadTurnMs)
      cleanupExtra = () => clearInterval(every)
    }
    let cleanupExtra: (() => void) | null = null

    const showTarget = () => {
      if (cancelled) return
      if (i >= targets.length) return EYE.calHeadTurn ? headTurnStage() : finish()
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
      cleanupExtra?.()
      window.removeEventListener('keydown', onKey, true)
      setIndex(0)
      setSampling(false)
      setHeadTurn(false)
    }
  }, [calibrating, targets, setCalibrating, setResult])

  // The saccade drill (dev recorder): the same ring, stepped by the shell's
  // __eyeDrill; the gaze pointer keeps running - the clip is what matters.
  // The one-look re-centre (useEyeInput.eyeRecentre): the same ring, at the
  // screen centre - where the sight is - while the gaze is sampled.
  if (!calibrating && recentring) {
    return (
      <div className="eye-cal" aria-hidden="true">
        <div className="eye-cal-target" data-sampling="1" style={{ transform: `translate(${window.innerWidth / 2}px, ${window.innerHeight / 2}px)` }} />
        <div className="eye-cal-note">Look at the ring · re-centring</div>
      </div>
    )
  }
  if (!calibrating && drill) {
    return (
      <div className="eye-cal" aria-hidden="true">
        <div className="eye-cal-target" data-sampling="0" style={{ transform: `translate(${drill.x}px, ${drill.y}px)` }} />
        <div className="eye-cal-note">Saccade drill · follow the ring with your eyes only · recording</div>
      </div>
    )
  }
  if (!calibrating) return null
  const t = headTurn ? targets[0] : (targets[index] ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 })
  return (
    <div className="eye-cal" aria-hidden="true">
      <div
        className="eye-cal-target"
        data-sampling={sampling ? '1' : '0'}
        style={{ transform: `translate(${t.x}px, ${t.y}px)` }}
      />
      <div className="eye-cal-note">
        {headTurn
          ? 'Keep your eyes on the ring · slowly turn your head left, then right · ESC cancels'
          : `Look at the ring · ${index + 1} / ${targets.length || 5} · ESC cancels`}
      </div>
    </div>
  )
}
