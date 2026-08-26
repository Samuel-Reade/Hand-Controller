// Deterministic placeholder series for the report panels - seeded from the
// report id so every report shows stable, distinct-looking data with no
// clock or randomness at runtime.

export interface MonthPoint {
  month: string
  current: number
  prior: number
}

export interface CategoryPoint {
  name: string
  value: number
}

export interface ReportData {
  months: MonthPoint[]
  categories: CategoryPoint[]
  headline: { label: string; value: string; delta: number }
  kpis: { label: string; value: string; delta: number }[]
}

const MONTHS = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']
const SEGMENTS = ['Enterprise', 'Mid-market', 'SMB', 'Self-serve', 'Partner', 'Other']

function hashSeed(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fmt(n: number, unit: string): string {
  if (unit === '%') return `${n.toFixed(1)}%`
  if (unit === 'ms') return `${Math.round(n)}ms`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

export function reportData(reportId: string, title: string): ReportData {
  const rand = mulberry32(hashSeed(reportId))
  const unit = /rate|coverage|adoption|retention|health|conversion/i.test(title)
    ? '%'
    : /latency/i.test(title)
      ? 'ms'
      : /revenue|mrr|arr|spend|size|roi|forecast|billing/i.test(title)
        ? '$'
        : '#'
  const base = unit === '%' ? 40 + rand() * 45 : unit === 'ms' ? 80 + rand() * 240 : unit === '$' ? 200_000 + rand() * 3_800_000 : 800 + rand() * 40_000
  const trend = (rand() - 0.35) * 0.06 // most series drift up a little
  const wobble = 0.05 + rand() * 0.1

  const months: MonthPoint[] = MONTHS.map((month, i) => {
    const t = base * (1 + trend * i) * (1 + (rand() - 0.5) * wobble)
    const p = base * (1 + trend * (i - 12) * 0.7) * (1 + (rand() - 0.5) * wobble)
    return { month, current: Math.max(0, t), prior: Math.max(0, p) }
  })

  const categories: CategoryPoint[] = SEGMENTS.map((name) => ({
    name,
    value: Math.max(0, (base / 4) * (0.25 + rand())),
  })).sort((a, b) => b.value - a.value)

  const last = months[months.length - 1]
  const deltaPct = ((last.current - last.prior) / Math.max(1e-9, last.prior)) * 100
  const kpiDelta2 = (rand() - 0.4) * 24
  const kpiDelta3 = (rand() - 0.4) * 12

  return {
    months,
    categories,
    headline: { label: 'This period', value: fmt(last.current, unit), delta: deltaPct },
    kpis: [
      { label: '12-mo avg', value: fmt(months.reduce((a, m) => a + m.current, 0) / 12, unit), delta: kpiDelta2 },
      { label: 'Best month', value: fmt(Math.max(...months.map((m) => m.current)), unit), delta: kpiDelta3 },
    ],
  }
}
