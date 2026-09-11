// App state (zustand) - LOW-FREQUENCY events only: focus changed, panel
// opened, input mode changed. Rotation, velocities and label positions never
// come near this store; they live in orbRuntime and are mutated per frame.

import { create } from 'zustand'
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
  openNode: (node, tier) => set({ openReport: { node, tier } }),
  closeReport: () => set({ openReport: null }),
  setInputMode: (inputMode) => set({ inputMode }),
  setHandStatus: (handStatus) => set({ handStatus }),
  setHandPresent: (handPresent) => set({ handPresent }),
  setHandEngaged: (handEngaged) => set({ handEngaged }),
  setHandCount: (handCount) => set({ handCount }),
  setHandZoom: (handZoom) => set({ handZoom }),
}))
