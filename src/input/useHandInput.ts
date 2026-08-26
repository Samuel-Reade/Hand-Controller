// The thin camera shell (S9): owns getUserMedia, MediaPipe and the detection
// loop - every gesture decision lives in the pure pipeline it feeds.
// Detection runs at camera rate; rendering runs at 60fps; never coupled.
// MediaPipe loads lazily on first start so the orb pays nothing until the
// user opts in. Assets are vendored under /public - nothing leaves the device.

import { useEffect } from 'react'
import type { HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { InputBus } from './InputBus'
import { createHandPipeline } from './gestureMachine'
import { useStore } from '../store'
import { TOKENS } from '../config/tokens'

export const HAND_MIN_VIEWPORT = 820 // below this, pointer only (S12 Slice D)
const IDLE_STOP_MS = 20_000 // no hand while idle -> stop camera (S9)

interface HandRuntime {
  /** HUD registers its thumbnail canvas here; the shell draws into it. */
  thumbnail: HTMLCanvasElement | null
}

export const handRuntime: HandRuntime = { thumbnail: null }

/** Module controller so DOM components can start/stop without prop drilling. */
export const handControl = {
  start: () => {},
  stop: () => {},
}

type Connections = { start: number; end: number }[]

export function useHandInput(bus: InputBus): void {
  useEffect(() => {
    let running = false
    let starting = false
    let landmarker: HandLandmarker | null = null
    let connections: Connections = []
    let video: HTMLVideoElement | null = null
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let suspended = false
    let lastHandSeen = 0
    const pipeline = createHandPipeline()

    const setStatus = (s: Parameters<ReturnType<typeof useStore.getState>['setHandStatus']>[0]) =>
      useStore.getState().setHandStatus(s)

    async function start(): Promise<void> {
      if (running || starting) return
      starting = true
      setStatus('starting')
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, frameRate: 30 },
          audio: false,
        })
      } catch (err) {
        starting = false
        setStatus(err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'error')
        return
      }
      try {
        const vision = await import('@mediapipe/tasks-vision')
        const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm')
        const options = {
          baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'GPU' as const },
          numHands: 1,
          runningMode: 'VIDEO' as const,
        }
        try {
          landmarker = await vision.HandLandmarker.createFromOptions(fileset, options)
        } catch {
          // Some machines have no usable GPU delegate - fall back to CPU.
          landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
            ...options,
            baseOptions: { ...options.baseOptions, delegate: 'CPU' as const },
          })
        }
        connections = vision.HandLandmarker.HAND_CONNECTIONS
      } catch {
        starting = false
        stopTracks()
        setStatus('error')
        return
      }
      video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      try {
        await video.play()
      } catch {
        starting = false
        stopTracks()
        setStatus('error')
        return
      }
      starting = false
      running = true
      suspended = false
      lastHandSeen = performance.now()
      pipeline.reset()
      setStatus('on')
      useStore.getState().setInputMode('hand')
      pump()
    }

    // Detection at camera rate: requestVideoFrameCallback when available,
    // ~30Hz interval otherwise.
    function pump(): void {
      if (!running || !video) return
      if ('requestVideoFrameCallback' in video) {
        video.requestVideoFrameCallback(() => {
          detect()
          pump()
        })
      } else {
        timer = setTimeout(() => {
          detect()
          pump()
        }, 33)
      }
    }

    function detect(): void {
      if (!running || !landmarker || !video) return
      const now = performance.now()
      let landmarks: NormalizedLandmark[] | null = null
      try {
        const result = landmarker.detectForVideo(video, now)
        landmarks = result.landmarks[0] ?? null
      } catch {
        return // one bad frame is not a state change
      }
      drawThumbnail(landmarks)

      const store = useStore.getState()
      // While a dashboard is open, hand input to the orb is suspended
      // entirely (S2, LOCKED). Reset so no stale gesture survives the panel.
      if (store.openReport) {
        if (!suspended) {
          suspended = true
          pipeline.reset()
        }
      } else {
        if (suspended) {
          suspended = false
          pipeline.reset()
        }
        for (const e of pipeline.process(landmarks, now)) bus.emit(e)
      }

      const present = landmarks !== null
      if (present) lastHandSeen = now
      if (store.handPresent !== present) store.setHandPresent(present)
      const engaged = pipeline.state.phase === 'engaged'
      if (store.handEngaged !== engaged) store.setHandEngaged(engaged)

      // Hand missing > 20s while idle: stop the camera, offer re-enable.
      if (!present && pipeline.state.phase === 'idle' && now - lastHandSeen > IDLE_STOP_MS) {
        stop('stopped')
      }
    }

    function drawThumbnail(landmarks: NormalizedLandmark[] | null): void {
      const canvas = handRuntime.thumbnail
      if (!canvas || !video) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const w = canvas.width
      const h = canvas.height
      ctx.save()
      // The user sees themselves - mirror the feed and the landmarks with it.
      ctx.translate(w, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, 0, 0, w, h)
      if (landmarks) {
        ctx.strokeStyle = 'rgba(127,178,217,0.8)'
        ctx.lineWidth = 1
        for (const c of connections) {
          const a = landmarks[c.start]
          const b = landmarks[c.end]
          ctx.beginPath()
          ctx.moveTo(a.x * w, a.y * h)
          ctx.lineTo(b.x * w, b.y * h)
          ctx.stroke()
        }
        ctx.fillStyle = TOKENS.brass
        for (const p of landmarks) {
          ctx.beginPath()
          ctx.arc(p.x * w, p.y * h, 1.6, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.restore()
    }

    function stopTracks(): void {
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
    }

    function stop(finalStatus: 'off' | 'stopped' = 'off'): void {
      if (!running && !starting) return
      // Tracking dropped mid-gesture: freeze and decay, never fling (S11).
      if (pipeline.state.phase === 'engaged') bus.emit({ type: 'lost' })
      running = false
      starting = false
      clearTimeout(timer)
      landmarker?.close()
      landmarker = null
      video?.pause()
      video = null
      stopTracks()
      pipeline.reset()
      const store = useStore.getState()
      store.setHandPresent(false)
      store.setHandEngaged(false)
      store.setInputMode('pointer')
      setStatus(finalStatus)
    }

    handControl.start = () => {
      void start()
    }
    handControl.stop = () => stop('off')

    // Hand tracking is off below the responsive cutoff.
    const onResize = () => {
      if (window.innerWidth < HAND_MIN_VIEWPORT && (running || starting)) stop('off')
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      stop('off')
      handControl.start = () => {}
      handControl.stop = () => {}
    }
  }, [bus])
}
