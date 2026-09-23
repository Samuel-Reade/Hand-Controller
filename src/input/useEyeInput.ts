// The eye channel's shell (ORB_EYE_SPEC E1/E3): owns the FaceLandmarker
// lifecycle, feeds the pure channel, bridges the bus. It never opens a
// camera - the hand shell (useHandInput) calls `eyeControl.detect(video)`
// on every frame it already has, so gaze shares the stream, the consent,
// the status enum and the auto-stop (§2 LOCKED). The synthetic harness
// feeds frames through `eyeControl.feed` on the same path minus the model.

import { useEffect } from 'react'
import type { FaceLandmarker } from '@mediapipe/tasks-vision'
import { motionPrefs } from '../config/feel'
import { useStore } from '../store'
import type { InputBus, InputEvent } from './InputBus'
import { cursorRuntime } from './cursor'
import { createOnlineCalibration, learnAllowed, learnConfirm } from './eye/calibration'
import type { CalibrationSample, LearnSource, OnlineCalibration } from './eye/calibration'
import { createEyeChannel, eyeRuntime, recentreOffset } from './eye/channel'
import type { EyeChannel, EyeContext, EyeTelemetry } from './eye/channel'
import { EYE } from './eye/config'
import { screenPointDefault } from './eye/face'
import type { FaceFrame } from './eye/face'
import type { EyeRecording } from './eye/replay'

declare global {
  interface Window {
    /** DEV gate seams (ORB_EYE_SPEC §8): live telemetry, and an event/state log when armed */
    __eyeInfo?: EyeTelemetry
    __eyeLog?: { t: number; type: string; source?: string; state?: string }[]
    __eyeLogStart?: number
    /** DEV: the live eye config, so a gate can try detectEveryNFrames=2 */
    __eyeConf?: typeof EYE
    /** DEV: the online calibration store (explicit base + learned confirms) */
    __eyeOnline?: OnlineCalibration
    /** DEV: record `seconds` of raw frames; resolves with the recording and downloads it as JSON */
    __eyeRecord?: (seconds?: number, label?: string) => Promise<EyeRecording>
    /** DEV: the saccade drill - a ring steps through six positions while recording; the ring is the clip's ground truth */
    __eyeDrill?: () => Promise<EyeRecording>
    /** DEV: the last recording */
    __eyeRecording?: EyeRecording
  }
}

/** The calibration in force: the explicit run's samples plus every verified confirm. */
export const eyeOnline: { state: OnlineCalibration } = { state: createOnlineCalibration() }

/** The explicit calibration flow hands its result here: it becomes the base. */
export function eyeSetBase(samples: CalibrationSample[], cal: OnlineCalibration['cal']): void {
  eyeOnline.state = { base: samples, learned: [], cal, rejected: 0 }
  eyeChannel.calibration = cal
  eyeChannel.offset = { x: 0, y: 0 } // a new map: the old re-centre measured the old one
  if (import.meta.env.DEV) window.__eyeOnline = eyeOnline.state
}

/**
 * A confirm of a gazed node at screen px (from the viewport's top-left):
 * the features of this moment map to that point. Refit; adopt if it does
 * not make the map worse on the evidence. The HUD label follows.
 */
export function eyeLearn(targetX: number, targetY: number, source: LearnSource = 'gaze'): void {
  if (!eyeChannel.enabled || !learnAllowed(EYE, eyeRuntime, source)) return
  const viewport = { w: window.innerWidth, h: window.innerHeight }
  // The map lives BEFORE the standing nudge and the re-centre: teach it the
  // target without them, or the refit would absorb them and they would count twice.
  const { x: ox, y: oy } = eyeChannel.offset
  const sample: CalibrationSample = { features: { ...eyeRuntime.features }, target: { x: targetX - ox, y: targetY - EYE.pointBiasYPx - oy } }
  const { state, changed, report } = learnConfirm(
    eyeOnline.state, sample, EYE, (f) => screenPointDefault(f, EYE, viewport), viewport,
  )
  eyeOnline.state = state
  if (changed && state.cal) {
    eyeChannel.calibration = state.cal
    const px = Math.round(state.cal.residualPx)
    const n = state.base.length + state.learned.length
    useStore.getState().setEyeCalResult(`CAL ${px}PX${state.cal.quad ? ' ·C' : ''} (${n})`)
  }
  if (import.meta.env.DEV) {
    window.__eyeOnline = eyeOnline.state
    console.info('[eye] learn', { source, changed, kept: state.learned.length, rejected: state.rejected, residualPx: report?.residualPx })
  }
}

/** Fed every processed frame while a re-centre samples (null otherwise). */
let recentreSink: (() => void) | null = null
let recentreLabelTimer: ReturnType<typeof setTimeout> | undefined

/**
 * One-look re-centre (Sam 2026-09-22, "it drifts a lot"): a ring shows at
 * the screen centre; after recentreSettleMs the gaze point is sampled for
 * recentreWindowMs; the shift that puts its median on the centre becomes
 * the channel's offset. Resolves with the HUD label.
 */
export function eyeRecentre(): Promise<string> {
  const store = useStore.getState()
  if (!eyeChannel.enabled || EYE.mode !== 'point' || store.eyeCalibrating || store.eyeRecentring) return Promise.resolve('')
  store.setEyeRecentring(true)
  store.setEyeRecentreResult(null)
  const t0 = performance.now()
  const points: { x: number; y: number }[] = []
  recentreSink = () => {
    if (performance.now() - t0 < EYE.recentreSettleMs) return
    const t = eyeRuntime
    if (t.facePresent && (t.irisOkL || t.irisOkR) && t.eyesShutMs === 0) points.push({ x: t.gazeX, y: t.gazeY })
  }
  return new Promise((resolve) => {
    setTimeout(() => {
      recentreSink = null
      const viewport = { w: window.innerWidth, h: window.innerHeight }
      const r = recentreOffset(points, { x: viewport.w / 2, y: viewport.h / 2 }, eyeChannel.offset, EYE)
      let label: string
      if ('offset' in r) {
        eyeChannel.offset = r.offset
        label = `CENTRED ${Math.round(r.shift.x)},${Math.round(r.shift.y)}`
      } else {
        label = r.error === 'few' ? 'NO GAZE - TRY AGAIN' : 'TOO FAR - CALIBRATE'
      }
      if (import.meta.env.DEV) console.info('[eye] re-centre', { samples: points.length, result: r })
      const s = useStore.getState()
      s.setEyeRecentring(false)
      s.setEyeRecentreResult(label)
      clearTimeout(recentreLabelTimer)
      recentreLabelTimer = setTimeout(() => useStore.getState().setEyeRecentreResult(null), 2500)
      resolve(label)
    }, EYE.recentreSettleMs + EYE.recentreWindowMs)
  })
}

/** Module controller so the hand shell and the harness can drive the channel. */
export const eyeControl = {
  /** run the model on this frame (no-op unless enabled + model ready) */
  detect: (_video: HTMLVideoElement, _nowMs: number): void => {},
  /** feed a frame (or none) straight into the channel - the harness path */
  feed: (_frame: FaceFrame | null, _nowMs: number): void => {},
  /** camera stopped: drop the model and the channel state */
  stop: (): void => {},
}

/** The channel singleton - created here, read by the HUD via eyeRuntime. */
export const eyeChannel: EyeChannel = createEyeChannel(EYE, eyeRuntime)

function context(nowMs: number, synthetic: boolean): EyeContext {
  const s = useStore.getState()
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    cameraOn: synthetic || s.handStatus === 'on',
    reducedMotion: motionPrefs.reducedMotion,
    shellOpen: s.openReport !== null,
    pointerIdleMs: cursorRuntime.lastEventAt > 0 ? nowMs - cursorRuntime.lastEventAt : Infinity,
  }
}

export function useEyeInput(bus: InputBus): void {
  useEffect(() => {
    let landmarker: FaceLandmarker | null = null
    let loading: Promise<void> | null = null
    let frameCount = 0

    let lastState = eyeChannel.state
    const logState = () => {
      if (!import.meta.env.DEV) return
      if (eyeChannel.state !== lastState) {
        lastState = eyeChannel.state
        window.__eyeLog?.push({ t: performance.now() - (window.__eyeLogStart ?? 0), type: 'state', state: lastState })
      }
    }
    const emitAll = (events: InputEvent[]) => {
      recentreSink?.()
      for (const e of events) bus.emit(e)
      logState()
    }
    if (import.meta.env.DEV) {
      window.__eyeInfo = eyeRuntime
      window.__eyeConf = EYE
      // The recorder (plan phase 1): raw features at detector rate, for the
      // replay harness. Dev only; downloads a JSON the user can drop into
      // recordings/ for tests/eyeRecordings.test.ts. The calibration in
      // force rides along, so the replay's px are on the user's map.
      const save = (rec: EyeRecording, label: string) => {
        window.__eyeRecording = rec
        try {
          const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = `eye-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
          a.click()
          setTimeout(() => URL.revokeObjectURL(a.href), 5000)
        } catch {
          // no download in this context: the recording is still on window.__eyeRecording
        }
        console.info('[eye] recorded', label, rec.frames.length, 'frames')
      }
      const capture = (ms: number, label: string, truth?: EyeRecording['truth']) =>
        new Promise<EyeRecording>((resolve) => {
          const frames: EyeRecording['frames'] = []
          eyeChannel.record = (f) => frames.push({ ...f, raw: { ...f.raw } })
          setTimeout(() => {
            eyeChannel.record = null
            const rec: EyeRecording = {
              frames, viewport: { w: window.innerWidth, h: window.innerHeight }, label,
              calibration: eyeChannel.calibration, calSamples: eyeOnline.state.base, offset: { ...eyeChannel.offset }, ...(truth ? { truth } : {}),
            }
            save(rec, label)
            resolve(rec)
          }, ms)
        })
      window.__eyeRecord = (seconds = 10, label = 'clip') => capture(seconds * 1000, label)
      // The saccade drill: a ring steps centre, left, right, centre, up, down
      // (EYE.drillStepMs each, at calInset like the calibration rings) while
      // the recorder runs. The ring positions are the clip's ground truth, so
      // the replay reports per-step response - the "falls short or
      // overshoots" the user feels - on the map in force.
      window.__eyeDrill = () => {
        const w = window.innerWidth
        const h = window.innerHeight
        const dx = (w / 2) * EYE.calInset
        const dy = (h / 2) * EYE.calInset
        const ring = [[w / 2, h / 2], [w / 2 - dx, h / 2], [w / 2 + dx, h / 2], [w / 2, h / 2], [w / 2, h / 2 - dy], [w / 2, h / 2 + dy]]
        const step = Math.max(500, EYE.drillStepMs)
        const truth: NonNullable<EyeRecording['truth']> = []
        ring.forEach(([x, y], i) => {
          setTimeout(() => {
            truth.push({ t: performance.now(), x, y })
            useStore.getState().setEyeDrill({ x, y })
          }, i * step)
        })
        return capture(ring.length * step, 'drill', truth).finally(() => useStore.getState().setEyeDrill(null))
      }
    }

    const ensureModel = (): void => {
      if (landmarker || loading) return
      loading = (async () => {
        try {
          const vision = await import('@mediapipe/tasks-vision')
          const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm')
          const options = {
            baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'GPU' as const },
            numFaces: 1,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            runningMode: 'VIDEO' as const,
          }
          try {
            landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options)
            eyeRuntime.delegate = 'GPU'
          } catch {
            landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
              ...options,
              baseOptions: { ...options.baseOptions, delegate: 'CPU' as const },
            })
            eyeRuntime.delegate = 'CPU'
          }
        } catch {
          landmarker = null
          useStore.getState().setEyeEnabled(false) // the channel cannot run; say so by turning it off
        } finally {
          loading = null
        }
      })()
    }

    const dropModel = (): void => {
      landmarker?.close()
      landmarker = null
      frameCount = 0
    }

    eyeControl.detect = (video, nowMs) => {
      if (!eyeChannel.enabled) return
      if (!landmarker) {
        ensureModel()
        emitAll(eyeChannel.process(null, nowMs, context(nowMs, false)))
        return
      }
      frameCount++
      if (frameCount % Math.max(1, Math.round(EYE.detectEveryNFrames)) !== 0) return
      let frame: FaceFrame | null = null
      const t0 = performance.now()
      try {
        const result = landmarker.detectForVideo(video, nowMs)
        const lm = result.faceLandmarks[0]
        if (lm) {
          const blendshapes: Record<string, number> = {}
          for (const c of result.faceBlendshapes[0]?.categories ?? []) blendshapes[c.categoryName] = c.score
          frame = {
            t: nowMs,
            landmarks: lm,
            blendshapes,
            presence: 1,
            transform: result.facialTransformationMatrixes[0]?.data,
          }
        }
      } catch {
        frame = null // one bad frame is not a state change
      }
      eyeRuntime.detectMs = performance.now() - t0
      emitAll(eyeChannel.process(frame, nowMs, context(nowMs, false)))
    }

    eyeControl.feed = (frame, nowMs) => {
      emitAll(eyeChannel.process(frame, nowMs, context(nowMs, true)))
    }

    eyeControl.stop = () => {
      emitAll(eyeChannel.reset())
      dropModel()
    }

    // Arbitration input: everything on the bus the channel did not emit
    // (the channel filters its own by source tag). DEV: log every event.
    const offBus = bus.on((e) => {
      if (e.type === 'recentre') {
        void eyeRecentre()
        return
      }
      eyeChannel.onBus(e, performance.now())
      if (import.meta.env.DEV) {
        window.__eyeLog?.push({
          t: performance.now() - (window.__eyeLogStart ?? 0),
          type: e.type,
          source: 'source' in e ? e.source : undefined,
        })
      }
    })

    // The opt-in toggle: enable loads the model (if the camera is on);
    // disable drops it and ends any held engagement.
    const apply = (enabled: boolean) => {
      eyeChannel.enabled = enabled
      EYE.enabled = enabled
      if (!enabled) {
        emitAll(eyeChannel.reset())
        dropModel()
        eyeOnline.state = createOnlineCalibration()
        eyeChannel.calibration = null
        eyeChannel.offset = { x: 0, y: 0 }
      }
    }
    apply(useStore.getState().eyeEnabled)
    const offStore = useStore.subscribe((s, prev) => {
      if (s.eyeEnabled !== prev.eyeEnabled) apply(s.eyeEnabled)
      if (prev.handStatus === 'on' && s.handStatus !== 'on') {
        emitAll(eyeChannel.reset())
        dropModel()
      }
    })

    return () => {
      offBus()
      offStore()
      emitAll(eyeChannel.reset())
      dropModel()
      eyeControl.detect = () => {}
      eyeControl.feed = () => {}
      eyeControl.stop = () => {}
      if (import.meta.env.DEV) {
        delete window.__eyeInfo
        delete window.__eyeRecord
        delete window.__eyeDrill
      }
    }
  }, [bus])
}
