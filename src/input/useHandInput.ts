// The thin camera shell (S9): owns getUserMedia, MediaPipe and the detection
// loop - every gesture decision lives in the pure pipeline it feeds.
// Detection runs at camera rate; rendering runs at 60fps; never coupled.
// MediaPipe loads lazily on first start so the orb pays nothing until the
// user opts in. Assets are vendored under /public - nothing leaves the device.
// ORB_ZOOM_SPEC: the landmarker tracks TWO hands; every frame's hand set
// goes to the multi-hand pipeline (arbiter above the untouched single-hand
// machine), and the HUD thumbnail shows both hands' landmarks colour-coded
// by pinch / zoom state.

import { useEffect } from 'react'
import type { HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { InputBus } from './InputBus'
import { createMultiHandPipeline } from './handArbiter'
import { drawEyeIndicator, drawHands, handRuntime } from './handThumbnail'
import { useStore } from '../store'
import { eyeChannel, eyeControl } from './useEyeInput'
import { eyeRuntime } from './eye/channel'

export { handRuntime } from './handThumbnail'

export const HAND_MIN_VIEWPORT = 820 // below this, pointer only (S12 Slice D)
const IDLE_STOP_MS = 20_000 // no hand while idle -> stop camera (S9)

/** Module controller so DOM components can start/stop without prop drilling. */
export const handControl = {
  start: () => {},
  stop: () => {},
}

export function useHandInput(bus: InputBus): void {
  useEffect(() => {
    let running = false
    let starting = false
    let landmarker: HandLandmarker | null = null
    let video: HTMLVideoElement | null = null
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let suspended = false
    let lastHandSeen = 0
    const pipeline = createMultiHandPipeline()

    const setStatus = (s: Parameters<ReturnType<typeof useStore.getState>['setHandStatus']>[0]) =>
      useStore.getState().setHandStatus(s)

    async function start(): Promise<void> {
      if (running || starting) return
      starting = true
      setStatus('starting')
      try {
        // 1280x720 (was 640x480): the face model crops the face and resizes
        // it to its own 256 px input, and at 480p a face at desk distance is
        // ~200 px wide - UPSAMPLED into the model, so the iris is a dozen
        // blurry pixels. At 720p the crop is downsampled instead. The hand
        // model is unaffected (its own crops), the frame upload is bigger;
        // the eye gate measures the cost. `ideal`, so a 480p-only camera
        // still works.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
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
          numHands: 2, // ORB_ZOOM_SPEC section 2: two hands, handedness unused
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
      let hands: NormalizedLandmark[][] = []
      try {
        const result = landmarker.detectForVideo(video, now)
        hands = result.landmarks
      } catch {
        return // one bad frame is not a state change
      }

      const store = useStore.getState()
      // While a dashboard is open, hand input to the orb is suspended
      // entirely (S2, LOCKED). Close out whatever was in flight so nothing
      // stays engaged or zoomed under the panel, then emit nothing.
      if (store.openReport) {
        if (!suspended) {
          suspended = true
          for (const e of pipeline.reset()) bus.emit(e)
        }
      } else {
        if (suspended) {
          suspended = false
          pipeline.reset()
        }
        for (const e of pipeline.process(hands, now)) bus.emit(e)
      }
      // ORB_EYE_SPEC E1: the face model runs on the SAME frame, hand first.
      // The channel itself decides whether it may act (shell open, mouse
      // recent, hand engaged); here it only sees the frame.
      eyeControl.detect(video, now)
      drawThumbnail(hands)

      const present = hands.length > 0
      // ORB_EYE_SPEC: with the gaze channel on, a present face keeps the
      // camera alive too - a hands-free steering session must not be cut
      // off by the no-hand timer. Without the channel, hands alone count.
      if (present || (eyeChannel.enabled && eyeRuntime.facePresent)) lastHandSeen = now
      if (store.handPresent !== present) store.setHandPresent(present)
      const engaged = pipeline.state.single.phase === 'engaged'
      if (store.handEngaged !== engaged) store.setHandEngaged(engaged)
      if (store.handCount !== hands.length) store.setHandCount(hands.length)
      const zooming = pipeline.state.zooming
      if (store.handZoom !== zooming) store.setHandZoom(zooming)

      // Hand missing > 20s while idle: stop the camera, offer re-enable.
      if (!present && !engaged && !zooming && now - lastHandSeen > IDLE_STOP_MS) {
        stop('stopped')
      }
    }

    function drawThumbnail(hands: NormalizedLandmark[][]): void {
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
      drawHands(
        ctx,
        w,
        h,
        hands.map((landmarks, i) => ({ landmarks, pinched: pipeline.pinchedOf(i) })),
        pipeline.state.zooming,
      )
      ctx.restore()
      drawEyeIndicator(ctx, w, h, eyeRuntime)
    }

    function stopTracks(): void {
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
    }

    function stop(finalStatus: 'off' | 'stopped' = 'off'): void {
      if (!running && !starting) return
      // Tracking dropped mid-gesture: freeze and decay, never fling (S11);
      // a zoom in flight springs back.
      for (const e of pipeline.reset()) bus.emit(e)
      running = false
      starting = false
      clearTimeout(timer)
      landmarker?.close()
      landmarker = null
      eyeControl.stop()
      video?.pause()
      video = null
      stopTracks()
      const store = useStore.getState()
      store.setHandPresent(false)
      store.setHandEngaged(false)
      store.setHandCount(0)
      store.setHandZoom(false)
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
