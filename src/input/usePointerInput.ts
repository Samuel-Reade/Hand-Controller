// Pointer -> InputBus (S7): down = engage, move = move + running velocity,
// up = release, or tap if total travel stayed under the tap radius.
// The physics never learns a mouse exists. A tap carries where it landed
// (px from the stage centre) so a scene can hit-test the node under the
// cursor; the physics ignores the position.

import { useEffect } from 'react'
import type { RefObject } from 'react'
import { FEEL } from '../config/feel'
import type { InputBus } from './InputBus'
import { cursorRuntime } from './cursor'
import { useStore } from '../store'

interface Sample {
  t: number
  x: number
  y: number
}

const VELOCITY_WINDOW_MS = 120

export function usePointerInput(targetRef: RefObject<HTMLElement | null>, bus: InputBus): void {
  useEffect(() => {
    const el = targetRef.current
    if (!el) return

    let dragging = false
    let lastX = 0
    let lastY = 0
    let startX = 0
    let startY = 0
    let maxTravel = 0
    let samples: Sample[] = []

    const track = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      cursorRuntime.x = e.clientX - (rect.left + rect.width / 2)
      cursorRuntime.y = e.clientY - (rect.top + rect.height / 2)
      cursorRuntime.inside = true
      cursorRuntime.lastEventAt = performance.now()
    }
    const onLeave = () => {
      cursorRuntime.inside = false
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      track(e)
      cursorRuntime.down = true
      if (useStore.getState().openReport) return // orb input suspended (S2)
      dragging = true
      el.setPointerCapture(e.pointerId)
      lastX = startX = e.clientX
      lastY = startY = e.clientY
      maxTravel = 0
      samples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }]
      useStore.getState().setInputMode('pointer')
      bus.emit({ type: 'engage' })
    }

    const onMove = (e: PointerEvent) => {
      track(e)
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      // move right -> yaw += dx * gain ; move down -> pitch += dy * gain (S5)
      bus.emit({ type: 'move', dYaw: dx * FEEL.dragGain, dPitch: dy * FEEL.dragGain })
      maxTravel = Math.max(maxTravel, Math.hypot(e.clientX - startX, e.clientY - startY))
      samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY })
      while (samples.length > 2 && e.timeStamp - samples[0].t > VELOCITY_WINDOW_MS) samples.shift()
    }

    const endDrag = (e: PointerEvent, kind: 'release' | 'lost') => {
      cursorRuntime.down = false
      if (!dragging) return
      dragging = false
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (kind === 'lost') {
        bus.emit({ type: 'lost' })
        return
      }
      if (maxTravel < FEEL.tapMaxTravelPx) {
        // The DOWN point is the intended target; travel under the tap
        // radius is jitter, not aim.
        const rect = el.getBoundingClientRect()
        bus.emit({
          type: 'tap',
          x: startX - (rect.left + rect.width / 2),
          y: startY - (rect.top + rect.height / 2),
        })
        return
      }
      // Trailing velocity over the recent window, in rad/s.
      let vYaw = 0
      let vPitch = 0
      const first = samples[0]
      const dt = (e.timeStamp - first.t) / 1000
      if (samples.length >= 2 && dt > 0.015) {
        vYaw = ((e.clientX - first.x) / dt) * FEEL.dragGain
        vPitch = ((e.clientY - first.y) / dt) * FEEL.dragGain
      }
      bus.emit({ type: 'release', vYaw, vPitch })
    }

    const onUp = (e: PointerEvent) => endDrag(e, 'release')
    const onCancel = (e: PointerEvent) => endDrag(e, 'lost')

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onCancel)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onCancel)
      el.removeEventListener('pointerleave', onLeave)
      cursorRuntime.inside = false
      cursorRuntime.down = false
    }
  }, [targetRef, bus])
}
