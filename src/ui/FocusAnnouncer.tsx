// Screen-reader announcement of the focused report - the visual equivalent
// is the label swelling inside the reticle. Low-frequency zustand subscriber.

import { ORBITS } from '../data/orbits'
import { useStore } from '../store'

export function FocusAnnouncer() {
  const focus = useStore((s) => s.focus)
  const text = focus
    ? `${ORBITS[focus.orbitIndex].name}: ${ORBITS[focus.orbitIndex].reports[focus.itemIndex].title}`
    : ''
  return (
    <div className="visually-hidden" role="status" aria-live="polite">
      {text}
    </div>
  )
}
