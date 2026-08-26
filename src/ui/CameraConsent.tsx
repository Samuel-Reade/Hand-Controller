// Camera consent + hand-tracking feedback (S9, S11). Never a permission
// prompt on load, never a modal wall: the orb works immediately and the
// user opts into hand control with one click. While tracking runs, the user
// sees what the tracker sees: a live mirrored thumbnail with the 21
// landmarks, plus hand / pinch state - without it every tracking failure
// reads as the app being broken.

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
  const wide = useViewportWide()

  // Pointer-only below the responsive cutoff, and without getUserMedia the
  // affordance simply is not offered - the app never gates on a camera.
  if (!wide || !navigator.mediaDevices?.getUserMedia) return null

  if (status === 'on') {
    const state = engaged ? 'PINCH' : present ? 'HAND' : 'SEARCHING'
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
          <button type="button" className="hand-link" onClick={() => handControl.stop()}>
            DISABLE
          </button>
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
            One hand, tracked on this device. Frames never leave this machine.
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
