// Camera consent + hand-tracking feedback (S9, S11). Never a permission
// prompt on load, never a modal wall: the orb works immediately and the
// user opts into hand control with one click. While tracking runs, the user
// sees what the tracker sees: a live mirrored thumbnail with both hands'
// landmarks, colour-coded by pinch / two-pinch-zoom state - without it every
// tracking failure reads as the app being broken. The synthetic harness
// (?input=synthetic) draws into the same HUD so screenshots show it too.

import { useEffect, useState } from 'react'
import { HAND_MIN_VIEWPORT, handControl, handRuntime } from '../input/useHandInput'
import { useStore } from '../store'

function useViewportWide(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= HAND_MIN_VIEWPORT,
  )
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${HAND_MIN_VIEWPORT}px)`)
    const onChange = () => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}

export function CameraConsent() {
  const status = useStore((s) => s.handStatus)
  const present = useStore((s) => s.handPresent)
  const engaged = useStore((s) => s.handEngaged)
  const count = useStore((s) => s.handCount)
  const zoom = useStore((s) => s.handZoom)
  const synthetic = useStore((s) => s.inputMode === 'synthetic')
  const eyeEnabled = useStore((s) => s.eyeEnabled)
  const setEyeEnabled = useStore((s) => s.setEyeEnabled)
  const calibrating = useStore((s) => s.eyeCalibrating)
  const setCalibrating = useStore((s) => s.setEyeCalibrating)
  const calResult = useStore((s) => s.eyeCalResult)
  const [recording, setRecording] = useState<string | null>(null)
  // Dev recorder (EYE_ACCURACY_PLAN phase 1): four ten-second clips; the
  // JSON downloads and goes into recordings/. Dev only.
  const record = async () => {
    if (!import.meta.env.DEV || !window.__eyeRecord || recording) return
    setRecording('RECORDING 10 S…')
    try {
      await window.__eyeRecord(10, 'clip')
      setRecording('SAVED')
    } finally {
      setTimeout(() => setRecording(null), 1500)
    }
  }
  // The saccade drill (EYE_ACCURACY_PLAN): a ring steps through six
  // positions for drillStepMs each while the recorder runs; the ring is the
  // clip's ground truth. Dev only.
  const [drilling, setDrilling] = useState<string | null>(null)
  const drill = async () => {
    if (!import.meta.env.DEV || !window.__eyeDrill || recording || drilling) return
    setDrilling('DRILL…')
    try {
      await window.__eyeDrill()
      setDrilling('SAVED')
    } finally {
      setTimeout(() => setDrilling(null), 1500)
    }
  }
  const wide = useViewportWide()

  // Pointer-only below the responsive cutoff, and without getUserMedia the
  // affordance simply is not offered - the app never gates on a camera.
  if (!synthetic && (!wide || !navigator.mediaDevices?.getUserMedia)) return null

  if (status === 'on' || synthetic) {
    const state = zoom
      ? 'ZOOM'
      : engaged
        ? 'PINCH'
        : present
          ? count === 2
            ? 'HANDS'
            : 'HAND'
          : 'SEARCHING'
    return (
      <div className="hand-hud">
        <canvas
          width={164}
          height={123}
          className="hand-thumb"
          ref={(el) => {
            handRuntime.thumbnail = el
          }}
        />
        <div className="hand-hud-row">
          <span className="hand-state" data-state={state.toLowerCase()}>
            {state}
          </span>
          {/* ORB_EYE_SPEC §7: the gaze channel's opt-in. Violet because it is
              pressable; disabled until the camera is on, and never a prompt. */}
          <button
            type="button"
            className="hand-link hand-link-eye"
            aria-pressed={eyeEnabled}
            onClick={() => setEyeEnabled(!eyeEnabled)}
          >
            {eyeEnabled ? 'EYE ON' : 'EYE'}
          </button>
          {eyeEnabled && (
            <button
              type="button"
              className="hand-link hand-link-eye"
              disabled={calibrating}
              onClick={() => setCalibrating(true)}
              title="Five targets, about eight seconds. Session only."
            >
              {calibrating ? 'CALIBRATING…' : (calResult ?? 'CALIBRATE')}
            </button>
          )}
          {eyeEnabled && import.meta.env.DEV && (
            <button
              type="button"
              className="hand-link hand-link-eye"
              disabled={recording !== null}
              onClick={() => void record()}
              title="Ten seconds of raw gaze numbers to a JSON file (no video). Drop it into recordings/."
            >
              {recording ?? 'RECORD 10 S'}
            </button>
          )}
          {eyeEnabled && import.meta.env.DEV && (
            <button
              type="button"
              className="hand-link hand-link-eye"
              disabled={recording !== null || drilling !== null}
              onClick={() => void drill()}
              title="Twelve seconds: a ring steps centre, left, right, centre, up, down. Follow it with your eyes only, head still. Saves a JSON with the ring as ground truth."
            >
              {drilling ?? 'DRILL'}
            </button>
          )}
          {synthetic ? (
            <span className="hand-state">SYNTHETIC</span>
          ) : (
            <button type="button" className="hand-link" onClick={() => handControl.stop()}>
              DISABLE
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="hand-consent">
      {status === 'off' && (
        <>
          <button type="button" className="hand-cta" onClick={() => handControl.start()}>
            ✋ ENABLE HAND CONTROL
          </button>
          <p className="hand-note">
            One or two hands, tracked on this device. Frames never leave this machine.
          </p>
        </>
      )}
      {status === 'starting' && <p className="hand-note">STARTING CAMERA…</p>}
      {status === 'stopped' && (
        <>
          <button type="button" className="hand-cta" onClick={() => handControl.start()}>
            RESUME HAND CONTROL
          </button>
          <p className="hand-note">Camera stopped - no hand seen for a while.</p>
        </>
      )}
      {status === 'denied' && (
        <>
          <p className="hand-note">
            Camera access declined - mouse and keyboard drive everything.
          </p>
          <button type="button" className="hand-link" onClick={() => handControl.start()}>
            TRY AGAIN
          </button>
        </>
      )}
      {status === 'error' && (
        <>
          <p className="hand-note">
            Hand tracking unavailable - mouse and keyboard drive everything.
          </p>
          <button type="button" className="hand-link" onClick={() => handControl.start()}>
            TRY AGAIN
          </button>
        </>
      )}
    </div>
  )
}
