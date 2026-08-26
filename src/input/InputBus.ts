// One interface between every input method and the physics (S7). Pointer,
// keyboard, hand and the synthetic harness all emit these; the physics
// consumes them and knows nothing about where they came from.

export type InputEvent =
  | { type: 'engage' }
  | { type: 'move'; dYaw: number; dPitch: number }    // radians, already gained
  | { type: 'release'; vYaw: number; vPitch: number } // rad/s, hands off to the coast
  | { type: 'tap' }                                   // open the focused report
  | { type: 'step'; axis: 'yaw' | 'pitch'; dir: -1 | 1 }
  | { type: 'lost' }                                  // tracking dropped: freeze, decay

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
