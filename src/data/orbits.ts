// Orbit + report definitions. Five orbits (S14): latitude bands crowd near
// the poles, so ~5 is the practical ceiling for this shape.

export interface ReportDef {
  id: string
  title: string
}

export interface OrbitDef {
  id: string
  name: string
  latitudeDeg: number
  latitude: number // radians
  reports: ReportDef[]
}

const DEG = Math.PI / 180

function orbit(id: string, name: string, latitudeDeg: number, titles: string[]): OrbitDef {
  return {
    id,
    name,
    latitudeDeg,
    latitude: latitudeDeg * DEG,
    reports: titles.map((title) => ({
      id: `${id}/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title,
    })),
  }
}

// Ordered top-down by latitude. Index 0 is the highest band.
export const ORBITS: OrbitDef[] = [
  orbit('growth', 'Growth', 46, [
    'New Signups', 'Activation Funnel', 'Acquisition Channels',
    'Campaign ROI', 'Viral Coefficient', 'Trial Conversions',
  ]),
  orbit('revenue', 'Revenue', 23, [
    'MRR Overview', 'ARR Momentum', 'Expansion Revenue', 'Churned Revenue',
    'Pipeline Velocity', 'Deal Size Spread', 'Billing Health', 'Forecast vs Actual',
  ]),
  orbit('operations', 'Operations', 0, [
    'Uptime & Incidents', 'API Latency', 'Error Budget', 'Deploy Frequency',
    'Queue Depth', 'Infra Spend', 'Support Backlog', 'On-call Load',
  ]),
  orbit('retention', 'Retention', -23, [
    'Cohort Retention', 'Feature Adoption', 'DAU / MAU', 'Session Depth',
    'Churn Risk', 'NPS Trend', 'Resurrection Rate',
  ]),
  orbit('quality', 'Quality', -46, [
    'Defect Escapes', 'Test Coverage', 'Build Health',
    'Regression Rate', 'Review Latency', 'Flake Rate',
  ]),
]

export const MAX_ORBIT_LATITUDE = Math.max(...ORBITS.map((o) => Math.abs(o.latitude)))

// S5: clamp pitch to +/-(maxOrbitLatitude + 0.06) rad
export const PITCH_CLAMP = MAX_ORBIT_LATITUDE + 0.06
