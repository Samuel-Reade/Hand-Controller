// App state (zustand) - LOW-FREQUENCY events only: focus changed, panel
// opened, input mode changed. Rotation, velocities and label positions never
// come near this store; they live in orbRuntime and are mutated per frame.

import { create } from 'zustand'
import type { FocusRef } from './orb/geometry'

export type InputMode = 'pointer' | 'hand' | 'synthetic'

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
  openReport: FocusRef | null // Slice B renders the panel for this
  inputMode: InputMode
  handStatus: HandStatus
  handPresent: boolean
  handEngaged: boolean
  handCount: number // 0 / 1 / 2 tracked hands (ORB_ZOOM_SPEC HUD)
  handZoom: boolean // the two-pinch zoom is engaged
  setFocus(focus: FocusRef): void
  openFocused(): void
  closeReport(): void
  setInputMode(mode: InputMode): void
  setHandStatus(handStatus: HandStatus): void
  setHandPresent(handPresent: boolean): void
  setHandEngaged(handEngaged: boolean): void
  setHandCount(handCount: number): void
  setHandZoom(handZoom: boolean): void
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
  setFocus: (focus) => set({ focus }),
  openFocused: () => {
    const { focus } = get()
    if (focus) set({ openReport: focus })
  },
  closeReport: () => set({ openReport: null }),
  setInputMode: (inputMode) => set({ inputMode }),
  setHandStatus: (handStatus) => set({ handStatus }),
  setHandPresent: (handPresent) => set({ handPresent }),
  setHandEngaged: (handEngaged) => set({ handEngaged }),
  setHandCount: (handCount) => set({ handCount }),
  setHandZoom: (handZoom) => set({ handZoom }),
}))
