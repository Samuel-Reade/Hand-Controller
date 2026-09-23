// Keyboard -> InputBus. Full keyboard operation is a requirement (S7): it is
// how the app works with the camera off. Arrows step between items/orbits,
// Enter taps, Escape closes the report panel - or, with none open, returns
// the view to the centre node (home). C re-centres the gaze pointer (eye
// control only; the eye shell ignores it otherwise).

import { useEffect } from 'react'
import type { InputBus } from './InputBus'
import { useStore } from '../store'

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function useKeyboardInput(bus: InputBus): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditable(e.target)) return
      const { openReport, closeReport } = useStore.getState()
      if (e.key === 'Escape') {
        e.preventDefault()
        if (openReport) closeReport()
        else bus.emit({ type: 'home' })
        return
      }
      if (openReport) return // orb input suspended while a report is open
      switch (e.key) {
        // dir +1 on yaw focuses the item currently right of centre;
        // dir +1 on pitch focuses the orbit above (higher latitude).
        case 'ArrowRight':
          e.preventDefault()
          bus.emit({ type: 'step', axis: 'yaw', dir: 1 })
          break
        case 'ArrowLeft':
          e.preventDefault()
          bus.emit({ type: 'step', axis: 'yaw', dir: -1 })
          break
        case 'ArrowUp':
          e.preventDefault()
          bus.emit({ type: 'step', axis: 'pitch', dir: 1 })
          break
        case 'ArrowDown':
          e.preventDefault()
          bus.emit({ type: 'step', axis: 'pitch', dir: -1 })
          break
        case 'Enter':
          e.preventDefault()
          bus.emit({ type: 'tap' })
          break
        case 'c':
        case 'C':
          if (!useStore.getState().eyeEnabled || e.metaKey || e.ctrlKey || e.altKey) break
          e.preventDefault()
          bus.emit({ type: 'recentre' })
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bus])
}
