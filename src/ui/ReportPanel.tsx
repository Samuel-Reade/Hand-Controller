// The dashboard workspace (S2, LOCKED): plain DOM over the orb, driven by
// mouse and keyboard. While it is open every orb input is suspended. Charts
// are Recharts with deterministic placeholder data; chart marks use the
// validated chart-grade steps of ice and brass, chrome uses the raw tokens.

import { useEffect, useMemo, useRef } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { TOKENS } from '../config/tokens'
import { ORBITS } from '../data/orbits'
import { reportData } from '../data/placeholder'
import { useStore } from '../store'

const AXIS_TICK = { fill: 'rgba(234,230,218,0.45)', fontSize: 9, letterSpacing: '0.08em' }
const GRID_STROKE = 'rgba(42,58,92,0.45)'

function Delta({ value }: { value: number }) {
  const positive = value >= 0
  return (
    <span className={positive ? 'delta delta-up' : 'delta delta-down'}>
      {positive ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

interface TooltipPayload {
  name?: string
  value?: number | string
  color?: string
}

function PanelTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string | number
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="chart-tooltip-row">
          <span className="chart-tooltip-swatch" style={{ background: p.color }} />
          <span className="chart-tooltip-name">{p.name}</span>
          <span className="chart-tooltip-value">
            {typeof p.value === 'number' ? p.value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export function ReportPanel() {
  const openReport = useStore((s) => s.openReport)
  const closeReport = useStore((s) => s.closeReport)
  const panelRef = useRef<HTMLDivElement>(null)

  const report = openReport ? ORBITS[openReport.orbitIndex].reports[openReport.itemIndex] : null
  const orbit = openReport ? ORBITS[openReport.orbitIndex] : null
  const data = useMemo(
    () => (report ? reportData(report.id, report.title) : null),
    [report],
  )

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

  if (!report || !orbit || !data) return null

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
      >
        <header className="panel-header">
          <div>
            <div className="panel-orbit">{orbit.name}</div>
            <h1 id="report-title" className="panel-title">
              {report.title}
            </h1>
          </div>
          <button type="button" className="panel-close" onClick={closeReport}>
            ESC · CLOSE
          </button>
        </header>

        <div className="kpi-row">
          <div className="kpi-tile">
            <div className="kpi-label">{data.headline.label}</div>
            <div className="kpi-value">{data.headline.value}</div>
            <Delta value={data.headline.delta} />
          </div>
          {data.kpis.map((k) => (
            <div className="kpi-tile" key={k.label}>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.value}</div>
              <Delta value={k.delta} />
            </div>
          ))}
        </div>

        <section className="chart-block">
          <div className="chart-head">
            <h2 className="chart-title">Trailing 12 months</h2>
            <div className="chart-legend">
              <span>
                <span className="legend-swatch" style={{ background: TOKENS.chartIce }} />
                Current
              </span>
              <span>
                <span className="legend-swatch legend-swatch-line" style={{ background: TOKENS.chartBrass }} />
                Prior year
              </span>
            </div>
          </div>
          <div className="chart-body chart-body-main">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.months} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="0" vertical={false} />
                <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  domain={[
                    (dataMin: number) => Math.max(0, dataMin * 0.92),
                    (dataMax: number) => dataMax * 1.04,
                  ]}
                  tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${Math.round(v)}`)}
                />
                <Tooltip content={<PanelTooltip />} cursor={{ stroke: 'rgba(234,230,218,0.25)' }} />
                <Line
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="current"
                  name="Current"
                  stroke={TOKENS.chartIce}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
                <Line
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="prior"
                  name="Prior year"
                  stroke={TOKENS.chartBrass}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="chart-block">
          <div className="chart-head">
            <h2 className="chart-title">By segment</h2>
          </div>
          <div className="chart-body chart-body-bars">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.categories} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${Math.round(v)}`)}
                />
                <Tooltip content={<PanelTooltip />} cursor={{ fill: 'rgba(42,58,92,0.25)' }} />
                <Bar
                  isAnimationActive={false}
                  dataKey="value"
                  name="Value"
                  fill={TOKENS.chartIce}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={42}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <footer className="panel-footer">
          Placeholder data · deterministic per report
        </footer>
      </div>
    </div>
  )
}
