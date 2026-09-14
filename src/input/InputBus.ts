// One interface between every input method and the physics (S7). Pointer,
// keyboard, hand and the synthetic harness all emit these; the physics
// consumes them and knows nothing about where they came from.

/** Outcome of a two-hand zoom session so far: none, or the last commit. */
export type ZoomCommit = 'none' | 'in' | 'out'

/**
 * ORB_EYE_SPEC: the gaze channel tags what it emits so listeners that mean
 * "the user's hand did this" (the sight's confirming state, the channel's
 * own arbitration) can tell it apart. The physics ignores the tag.
 */
export type InputSource = 'gaze'

export type InputEvent =
  | { type: 'engage'; source?: InputSource }
  | { type: 'move'; dYaw: number; dPitch: number; source?: InputSource } // radians, already gained
  | { type: 'release'; vYaw: number; vPitch: number } // rad/s, hands off to the coast
  // A tap confirms. Hand pinch-taps and Enter are UNPOSITIONED: they act on
  // whatever holds the sight. A mouse/touch tap carries its release point in
  // px from the viewport centre (+x right, +y down) so the active scene can
  // hit-test the node under the cursor (click-to-centre, DECISIONS.md).
  | { type: 'tap'; x?: number; y?: number }
  // Return to the anchor (Escape): undo any drill and any click-to-centre so
  // the brain holds the centre again. The physics ignores it.
  | { type: 'home' }
  | { type: 'step'; axis: 'yaw' | 'pitch'; dir: -1 | 1 }
  | { type: 'lost'; source?: InputSource }            // tracking dropped: freeze, decay
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
