// The fixed focus bracket (S10) - the signature element. Four thin brass
// corner brackets at screen centre plus a faint meridian across the
// viewport. It never moves; things rotate INTO selection. Flashes briefly
// on tap so the click gesture has visible feedback.

import { useEffect, useRef } from 'react'
import type { InputBus } from '../input/InputBus'

export function Reticle({ bus }: { bus: InputBus }) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = bus.on((e) => {
      if (e.type !== 'tap') return
      const el = rootRef.current
      if (!el) return
      el.dataset.flash = '1'
      clearTimeout(timer)
      timer = setTimeout(() => {
        delete el.dataset.flash
      }, 300)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [bus])

  return (
    <div className="reticle" ref={rootRef} aria-hidden="true">
      <div className="reticle-meridian" />
      <div className="reticle-box">
        <span className="reticle-corner tl" />
        <span className="reticle-corner tr" />
        <span className="reticle-corner bl" />
        <span className="reticle-corner br" />
      </div>
    </div>
  )
}
