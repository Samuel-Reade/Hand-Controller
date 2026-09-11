// The shell (S2, LOCKED as "the dashboard workspace"): plain DOM over the
// field, driven by mouse and keyboard. While it is open every orb input is
// suspended. It is an EMPTY CONTAINER (docs/DECISIONS.md, two-click
// navigation): the placeholder analytics that filled it - KPI tiles and two
// Recharts charts on deterministic data - are gone, and `.panel-body` is
// where Rally's post view goes. The container, header, focus trap and close
// paths are unchanged so that content can drop in without rewiring.

import { useEffect, useRef } from 'react'
import { ORBITS } from '../data/orbits'
import { useStore } from '../store'

/** Rally vocabulary for the placeholder tiers (RALLY.md §2-3). */
const TIER_LABEL: Record<string, string> = {
  brain: 'Camp',
  hub: 'Shout',
  node: 'Echo',
  sub: 'Echo',
  terminal: 'Echo',
}

export function ReportPanel() {
  const openReport = useStore((s) => s.openReport)
  const closeReport = useStore((s) => s.closeReport)
  const panelRef = useRef<HTMLDivElement>(null)

  // Focus management: focus moves into the panel on open; a light Tab trap
  // keeps it there. Escape (global handler) and the close button both close.
  useEffect(() => {
    if (!openReport) return
    panelRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openReport])

  if (!openReport) return null

  // Header identity: a report keeps its orbit + title; a node shows its
  // Rally tier and name until real shout data exists.
  const eyebrow =
    'node' in openReport ? (TIER_LABEL[openReport.tier] ?? openReport.tier) : ORBITS[openReport.orbitIndex].name
  const title =
    'node' in openReport ? openReport.node : ORBITS[openReport.orbitIndex].reports[openReport.itemIndex].title

  return (
    <div className="panel-backdrop" onClick={closeReport}>
      <div
        className="report-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        tabIndex={-1}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        data-shell={'node' in openReport ? openReport.node : `report:${openReport.orbitIndex}/${openReport.itemIndex}`}
      >
        <header className="panel-header">
          <div>
            <div className="panel-orbit">{eyebrow}</div>
            <h1 id="report-title" className="panel-title">
              {title}
            </h1>
          </div>
          <button type="button" className="panel-close" onClick={closeReport}>
            ESC · CLOSE
          </button>
        </header>

        {/* The shell's content area. Empty on purpose - Rally's post view
            (the shout, its echoes, momentum, status) lands here. */}
        <div className="panel-body" />
      </div>
    </div>
  )
}
