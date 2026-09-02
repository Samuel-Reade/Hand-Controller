// One interface between every input method and the physics (S7). Pointer,
// keyboard, hand and the synthetic harness all emit these; the physics
// consumes them and knows nothing about where they came from.

/** Outcome of a two-hand zoom session so far: none, or the last commit. */
export type ZoomCommit = 'none' | 'in' | 'out'

export type InputEvent =
  | { type: 'engage' }
  | { type: 'move'; dYaw: number; dPitch: number }    // radians, already gained
  | { type: 'release'; vYaw: number; vPitch: number } // rad/s, hands off to the coast
  | { type: 'tap' }                                   // open the focused report
  | { type: 'step'; axis: 'yaw' | 'pitch'; dir: -1 | 1 }
  | { type: 'lost' }                                  // tracking dropped: freeze, decay
  // Two-handed pinch-zoom (ORB_ZOOM_SPEC). Emitted by the hand arbiter that
  // sits above the single-hand machine; the physics ignores both. The active
  // scene dollies its camera on `zoom` (engage -> updates -> end) and fires
  // its EXISTING drill-in/out transition on `zoomCommit`.
  | { type: 'zoom'; phase: 'engage' | 'update' | 'end'; factor: number; commit: ZoomCommit }
  | { type: 'zoomCommit'; dir: 'in' | 'out' }

export type InputListener = (event: InputEvent) => void

export interface InputBus {
  emit(event: InputEvent): void
  on(listener: InputListener): () => void
}

export function createInputBus(): InputBus {
  const listeners = new Set<InputListener>()
  return {
    emit(event) {
      for (const l of listeners) l(event)
    },
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
