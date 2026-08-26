// DOM overlay for item labels (S6): one absolutely-positioned div per item,
// positioned every frame by the loop in Orb.tsx writing element.style
// directly. CSS-styled DOM keeps text crisp - not drei <Html>, not troika.

import { ORB_ITEMS } from './items'
import { orbRuntime } from './useOrbPhysics'

export function LabelLayer() {
  return (
    <div className="label-layer" aria-hidden="true">
      {ORB_ITEMS.map((item) => (
        <div
          key={item.id}
          className="orb-label"
          style={{ display: 'none' }}
          ref={(el) => {
            if (el) orbRuntime.labelEls.set(item.id, el)
            else orbRuntime.labelEls.delete(item.id)
          }}
        >
          {item.title}
        </div>
      ))}
    </div>
  )
}
