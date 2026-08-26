// The persistent flat index of orbit names (S2, LOCKED): half the orb always
// faces away - this is the compensation. A real <button> list; clicking an
// entry animates to that orbit through `step` events on the bus.

import { ORBITS } from '../data/orbits'
import type { InputBus } from '../input/InputBus'
import { nearestOrbitIndex } from '../orb/geometry'
import { orbRuntime } from '../orb/useOrbPhysics'
import { useStore } from '../store'

// Latitude rank in ascending order, per orbit index - `step` dir +1 walks up.
const RANK: number[] = (() => {
  const sorted = [...ORBITS.map((o) => o.latitude)].sort((a, b) => a - b)
  return ORBITS.map((o) => sorted.indexOf(o.latitude))
})()

export function OrbitIndex({ bus }: { bus: InputBus }) {
  const activeOrbit = useStore((s) => s.focus?.orbitIndex ?? -1)

  const goTo = (targetIndex: number) => {
    const p = orbRuntime.physics
    const currentLat = p.forcedPitch ?? p.pitch
    const current = nearestOrbitIndex(ORBITS, currentLat)
    const delta = RANK[targetIndex] - RANK[current]
    const dir = delta > 0 ? 1 : -1
    for (let i = 0; i < Math.abs(delta); i++) {
      bus.emit({ type: 'step', axis: 'pitch', dir })
    }
  }

  return (
    <nav className="orbit-index" aria-label="Orbits">
      <div className="orbit-index-title">Orbits</div>
      <ul>
        {ORBITS.map((orbit, i) => (
          <li key={orbit.id}>
            <button
              type="button"
              data-active={i === activeOrbit ? '1' : undefined}
              aria-current={i === activeOrbit ? 'true' : undefined}
              onClick={() => goTo(i)}
            >
              <span className="orbit-name">{orbit.name}</span>
              <span className="orbit-meta">
                {orbit.latitudeDeg >= 0 ? '+' : '−'}
                {String(Math.abs(orbit.latitudeDeg)).padStart(2, '0')}° · {orbit.reports.length}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
