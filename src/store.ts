// App state (zustand) - LOW-FREQUENCY events only: focus changed, panel
// opened, input mode changed. Rotation, velocities and label positions never
// come near this store; they live in orbRuntime and are mutated per frame.

import { create } from 'zustand'
import { FLAGS } from './config/flags'
import type { FocusRef } from './orb/geometry'

export type InputMode = 'pointer' | 'hand' | 'synthetic'

/**
 * What the shell (the panel over the field) is open on: a report - the
 * globe's and the level-1 reticle's identity - or any node of the neural
 * field (two-click navigation, docs/DECISIONS.md). The shell is an empty
 * container for now; its content is Rally's to add.
 */
export type ShellRef = FocusRef | { node: string; tier: string }

/** Camera lifecycle for hand control (S11): never a modal wall, never on load. */
export type HandStatus =
  | 'off' // camera not started; quiet affordance offers it
  | 'starting'
  | 'on'
  | 'stopped' // auto-stopped after 20s with no hand; offer resume
  | 'denied' // permission refused; mouse + keyboard carry on
  | 'error' // camera/model failure; mouse + keyboard carry on

interface AppState {
  focus: FocusRef | null
  openReport: ShellRef | null // Slice B renders the shell for this
  inputMode: InputMode
  handStatus: HandStatus
  handPresent: boolean
  handEngaged: boolean
  handCount: number // 0 / 1 / 2 tracked hands (ORB_ZOOM_SPEC HUD)
  handZoom: boolean // the two-pinch zoom is engaged
  eyeEnabled: boolean // ORB_EYE_SPEC: the gaze channel opt-in (separate from camera consent)
  eyeCalibrating: boolean // the calibration flow is on screen (gaze pointer suspended)
  eyeCalResult: string | null // last calibration outcome for the HUD ("CAL 38PX" / "CAL FAILED")
  eyeDrill: { x: number; y: number } | null // the saccade drill's ring (dev recorder), shown while it records
  eyeRecentring: boolean // the one-look re-centre is sampling (its centre ring is on screen)
  eyeRecentreResult: string | null // the last re-centre's outcome for the HUD, shown briefly
  setFocus(focus: FocusRef): void
  openFocused(): void
  openNode(node: string, tier: string): void
  closeReport(): void
  setInputMode(mode: InputMode): void
  setHandStatus(handStatus: HandStatus): void
  setHandPresent(handPresent: boolean): void
  setHandEngaged(handEngaged: boolean): void
  setHandCount(handCount: number): void
  setHandZoom(handZoom: boolean): void
  setEyeEnabled(eyeEnabled: boolean): void
  setEyeCalibrating(eyeCalibrating: boolean): void
  setEyeCalResult(eyeCalResult: string | null): void
  setEyeDrill(eyeDrill: { x: number; y: number } | null): void
  setEyeRecentring(eyeRecentring: boolean): void
  setEyeRecentreResult(eyeRecentreResult: string | null): void
}

export const useStore = create<AppState>((set, get) => ({
  focus: null,
  openReport: null,
  inputMode: 'pointer',
  handStatus: 'off',
  handPresent: false,
  handEngaged: false,
  handCount: 0,
  handZoom: false,
  eyeEnabled: false,
  eyeCalibrating: false,
  eyeCalResult: null,
  eyeDrill: null,
  eyeRecentring: false,
  eyeRecentreResult: null,
  setFocus: (focus) => set({ focus }),
  openFocused: () => {
    const { focus } = get()
    if (focus) set({ openReport: focus })
  },
  openNode: (node, tier) => set({ openReport: { node, tier } }),
  closeReport: () => set({ openReport: null }),
  setInputMode: (inputMode) => set({ inputMode }),
  setHandStatus: (handStatus) => set({ handStatus }),
  setHandPresent: (handPresent) => set({ handPresent }),
  setHandEngaged: (handEngaged) => set({ handEngaged }),
  setHandCount: (handCount) => set({ handCount }),
  setHandZoom: (handZoom) => set({ handZoom }),
  // The eye flag (config/flags.ts) is the one gate: with it off nothing can
  // turn eye control on - not the HUD, leva, ?eye=1 nor the harness - so the
  // face model, the gaze pointer and the voice commands never start.
  setEyeEnabled: (on) => {
    const eyeEnabled = on && FLAGS.eye
    set({ eyeEnabled, ...(eyeEnabled ? {} : { eyeCalibrating: false, eyeCalResult: null, eyeDrill: null, eyeRecentring: false, eyeRecentreResult: null }) })
  },
  setEyeCalibrating: (eyeCalibrating) => set({ eyeCalibrating }),
  setEyeCalResult: (eyeCalResult) => set({ eyeCalResult }),
  setEyeDrill: (eyeDrill) => set({ eyeDrill }),
  setEyeRecentring: (eyeRecentring) => set({ eyeRecentring }),
  setEyeRecentreResult: (eyeRecentreResult) => set({ eyeRecentreResult }),
}))
