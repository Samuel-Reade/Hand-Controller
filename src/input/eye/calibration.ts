// Gaze calibration (ORB_EYE_SPEC E4, made essential by 'point' mode): a
// per-user linear map from (head, iris) features to screen px, fitted by
// ridge-regularised least squares over a handful of looked-at targets.
// Pure; tests/eye.test.ts. The flow that shows the targets and collects
// samples is ui/EyeCalibration.tsx.

import type { EyeConfig } from './config'
import type { Calibration, GazeFeatures } from './face'
import { FEATURE_KEYS, featureRow, linearPoint, quadBasis } from './face'

export interface CalibrationSample {
  /** median features while the user looked at the target */
  features: GazeFeatures
  /** the target, px from the viewport's top-left */
  target: { x: number; y: number }
  /** fit weight (1 by default); the explicit base decays as confirms accumulate */
  weight?: number
  /** when it was taken (ms); learned samples decay with age */
  t?: number
}

/** The target sequence: centre first, then the corners at `inset` of the half-extent. */
export function calibrationTargets(
  viewport: { w: number; h: number },
  inset: number,
  extra = false,
): { x: number; y: number }[] {
  const cx = viewport.w / 2
  const cy = viewport.h / 2
  const hx = (viewport.w / 2) * inset
  const hy = (viewport.h / 2) * inset
  const pts = [
    { x: cx, y: cy },
    { x: cx - hx, y: cy - hy },
    { x: cx + hx, y: cy - hy },
    { x: cx + hx, y: cy + hy },
    { x: cx - hx, y: cy + hy },
  ]
  if (extra) pts.push({ x: cx, y: cy - hy }, { x: cx + hx, y: cy }, { x: cx, y: cy + hy }, { x: cx - hx, y: cy })
  return pts
}

/** Solve a k x k system by Gauss-Jordan with partial pivoting; null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

/**
 * Ridge least squares for `t ≈ Σ w_k·basis_k` with the ridge relative to
 * each basis column's energy (the constant column excluded).
 */
function lsq(rows: number[][], t: number[], ridge: number, w?: number[]): number[] | null {
  const k = rows[0].length
  const A: number[][] = Array.from({ length: k }, () => Array(k).fill(0))
  const b: number[] = Array(k).fill(0)
  for (let i = 0; i < rows.length; i++) {
    const wi = w?.[i] ?? 1
    for (let p = 0; p < k; p++) {
      b[p] += wi * rows[i][p] * t[i]
      for (let q = 0; q < k; q++) A[p][q] += wi * rows[i][p] * rows[i][q]
    }
  }
  for (let p = 1; p < k; p++) A[p][p] += ridge * A[p][p] + 1e-9
  return solve(A, b)
}

/**
 * Fit one axis: target = a0 + a1·head + a2·irisGeom + a3·irisBlend, ridge-
 * regularised RELATIVE to each feature's own energy (a stability guard, not
 * shrinkage): head is in degrees (Σ² in the tens), the iris features in
 * [-1, 1] (Σ² ~ 0.1); a fixed λ once crushed the iris gains to zero. A
 * user who moves head and eyes in lockstep - collinear features - still
 * gets a stable fit, and the two iris sources are weighed by the data.
 */
function fitAxisRows(rows: number[][], t: number[], wt: number[], ridge: number): number[] | null {
  return lsq(rows, t, ridge, wt)
}

/** Weighted RMS distance in px between a map's prediction and the targets. */
export function residualOf(
  samples: readonly CalibrationSample[],
  map: (f: GazeFeatures) => { x: number; y: number },
): number {
  if (samples.length === 0) return Infinity
  let se = 0
  let sw = 0
  for (const s of samples) {
    const p = map(s.features)
    const w = s.weight ?? 1
    se += w * ((p.x - s.target.x) ** 2 + (p.y - s.target.y) ** 2)
    sw += w
  }
  return sw > 0 ? Math.sqrt(se / sw) : Infinity
}

export interface FitReport {
  /** the map, or null when it could not be fitted at all */
  cal: Calibration | null
  /** RMS residual of the fit (Infinity when no fit) */
  residualPx: number
  /** RMS residual of the DEFAULT map on the same samples - the bar to beat */
  defaultResidualPx: number
  samples: number
  /** the fit is usable: under the threshold, or clearly better than the default */
  accepted: boolean
  reason: 'ok' | 'better-than-default' | 'too-few-samples' | 'singular' | 'residual'
  /** a curvature correction was kept (it beat the linear map under leave-one-out) */
  curved: boolean
  /** leave-one-out RMS of the linear and the curved maps (NaN when not tried) */
  looLinearPx: number
  looCurvedPx: number
  /** the wide (per-eye) model was kept (it beat the base model under leave-one-out) */
  wide: boolean
  looWidePx: number
}

type Lin = { model: Calibration['model']; x: number[]; y: number[] }

function fitLinear(samples: readonly CalibrationSample[], ridge: number, model: Calibration['model'] = 'base'): Lin | null {
  const wt = samples.map((s) => s.weight ?? 1)
  const x = fitAxisRows(samples.map((s) => featureRow(s.features, model, 'x')), samples.map((s) => s.target.x), wt, ridge)
  const y = fitAxisRows(samples.map((s) => featureRow(s.features, model, 'y')), samples.map((s) => s.target.y), wt, ridge)
  return x && y ? { model, x, y } : null
}

const linPredict = (l: Lin, f: GazeFeatures) =>
  linearPoint(f, { model: l.model, x: l.x, y: l.y, residualPx: 0, points: 0 })

/**
 * The curvature correction: fit the linear map's residuals, in normalised
 * screen units, as a quadratic in the linear prediction's position.
 */
function fitQuad(
  samples: readonly CalibrationSample[],
  lin: Lin,
  viewport: { w: number; h: number },
  ridge: number,
): { x: number[]; y: number[] } | null {
  const hw = viewport.w / 2
  const hh = viewport.h / 2
  const rows: number[][] = []
  const tx: number[] = []
  const ty: number[] = []
  const wts: number[] = []
  for (const s of samples) {
    const p = linPredict(lin, s.features)
    rows.push(quadBasis((p.x - hw) / hw, (p.y - hh) / hh))
    tx.push((s.target.x - p.x) / hw)
    ty.push((s.target.y - p.y) / hh)
    wts.push(s.weight ?? 1)
  }
  const x = lsq(rows, tx, ridge, wts)
  const y = lsq(rows, ty, ridge, wts)
  return x && y ? { x, y } : null
}

const quadPredict = (
  lin: Lin,
  q: { x: number[]; y: number[] },
  viewport: { w: number; h: number },
  f: GazeFeatures,
) => {
  const p = linPredict(lin, f)
  const hw = viewport.w / 2
  const hh = viewport.h / 2
  const b = quadBasis((p.x - hw) / hw, (p.y - hh) / hh)
  let dx = 0
  let dy = 0
  for (let i = 0; i < 6; i++) {
    dx += q.x[i] * b[i]
    dy += q.y[i] * b[i]
  }
  return { x: p.x + dx * hw, y: p.y + dy * hh }
}

/**
 * Leave-one-out RMS for a model builder: fit on n-1, predict the held-out
 * sample, over every sample. The honest number for a fit with few points.
 */
function loo(
  samples: readonly CalibrationSample[],
  build: (train: readonly CalibrationSample[]) => ((f: GazeFeatures) => { x: number; y: number }) | null,
): number {
  let se = 0
  let n = 0
  for (let i = 0; i < samples.length; i++) {
    const train = samples.filter((_, j) => j !== i)
    const model = build(train)
    if (!model) return Infinity
    const p = model(samples[i].features)
    se += (p.x - samples[i].target.x) ** 2 + (p.y - samples[i].target.y) ** 2
    n++
  }
  return n ? Math.sqrt(se / n) : Infinity
}

/**
 * Fit both axes and judge the result. A fit is accepted when its RMS
 * residual is under `cfg.calMaxResidualPx`, OR when it is clearly better
 * (< 80 %) than the default map's residual on the same samples AND under
 * twice the threshold - "a bad calibration is worse than none" cuts both
 * ways: a fit that beats the uncalibrated map is not worse than none, but
 * a least-squares fit beats a fixed map on its own samples almost by
 * definition, so a hopeless one must still fail. Fewer than 4 samples: no fit.
 */
export function fitCalibrationReport(
  samples: readonly CalibrationSample[],
  cfg: EyeConfig,
  defaultMap: (f: GazeFeatures) => { x: number; y: number },
  ridge = 1e-3,
  viewport?: { w: number; h: number },
): FitReport {
  const defaultResidualPx = residualOf(samples, defaultMap)
  const base = {
    cal: null, residualPx: Infinity, defaultResidualPx, samples: samples.length, accepted: false as const,
    curved: false, looLinearPx: NaN, looCurvedPx: NaN, wide: false, looWidePx: NaN,
  }
  if (samples.length < 4) return { ...base, reason: 'too-few-samples' }
  let lin = fitLinear(samples, ridge, 'base')
  if (!lin) return { ...base, reason: 'singular' }
  let map = (f: GazeFeatures) => linPredict(lin!, f)
  let quad: Calibration['quad'] | undefined
  let curved = false
  let looLinearPx = NaN
  let looCurvedPx = NaN
  let wide = false
  let looWidePx = NaN
  if (viewport && samples.length >= 8) {
    looLinearPx = loo(samples, (train) => {
      const l = fitLinear(train, ridge, 'base')
      return l ? (f) => linPredict(l, f) : null
    })
    // The wide model (per-eye iris + per-eye blendshapes, 6 terms per
    // axis): with enough samples, and only if it wins leave-one-out by 5 %.
    if (cfg.wideModel && samples.length >= 14) {
      looWidePx = loo(samples, (train) => {
        const l = fitLinear(train, ridge, 'wide')
        return l ? (f) => linPredict(l, f) : null
      })
      if (Number.isFinite(looWidePx) && looWidePx < 0.95 * looLinearPx) {
        const w = fitLinear(samples, ridge, 'wide')
        if (w) {
          lin = w
          map = (f) => linPredict(lin!, f)
          wide = true
        }
      }
    }
    const looChosen = wide ? looWidePx : looLinearPx
    const model = lin.model
    looCurvedPx = loo(samples, (train) => {
      const l = fitLinear(train, ridge, model)
      const q = l && fitQuad(train, l, viewport, 0.05)
      return l && q ? (f) => quadPredict(l, q, viewport, f) : null
    })
    if (Number.isFinite(looCurvedPx) && looCurvedPx < 0.95 * looChosen) {
      const q = fitQuad(samples, lin, viewport, 0.05)
      if (q) {
        quad = { x: q.x, y: q.y, viewport: { ...viewport } }
        const l0 = lin
        map = (f) => quadPredict(l0, q, viewport, f)
        curved = true
      }
    }
  }
  const residualPx = residualOf(samples, map)
  if (!Number.isFinite(residualPx)) return { ...base, reason: 'singular' }
  const cal: Calibration = { model: lin.model, x: lin.x, y: lin.y, quad, residualPx, points: samples.length }
  Object.assign(base, { curved, looLinearPx, looCurvedPx, wide, looWidePx })
  if (residualPx <= cfg.calMaxResidualPx) return { ...base, cal, residualPx, accepted: true, reason: 'ok' }
  if (residualPx < 0.8 * defaultResidualPx && residualPx <= 2 * cfg.calMaxResidualPx) {
    return { ...base, cal, residualPx, accepted: true, reason: 'better-than-default' }
  }
  return { ...base, cal, residualPx, reason: 'residual' }
}

/** The map, or null when not accepted (the older shape; tests use it). */
export function fitCalibration(
  samples: readonly CalibrationSample[],
  cfg: EyeConfig,
  ridge = 1e-3,
): Calibration | null {
  // without a default map to compare against, only the threshold applies
  const r = fitCalibrationReport(samples, cfg, () => ({ x: Infinity, y: Infinity }), ridge)
  return r.reason === 'ok' ? r.cal : null
}

/** Per-feature median of a window of feature samples. */
export function medianFeatures(window: readonly GazeFeatures[]): GazeFeatures | null {
  if (window.length === 0) return null
  const med = (k: keyof Omit<GazeFeatures, 'ok'>) => {
    const a = window.map((f) => f[k]).sort((p, q) => p - q)
    const m = Math.floor(a.length / 2)
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
  }
  const out = { ok: true } as GazeFeatures
  for (const k of FEATURE_KEYS) out[k] = med(k)
  return out
}

// ── Learning from confirms ─────────────────────────────────────────────────

/**
 * Every confirm of a gazed node is a calibration sample the user just
 * verified: the ring was on the node they wanted, so the features at that
 * moment map to that node's screen position. Kept alongside the explicit
 * run's samples (the base), newest first, capped; refitted each time with
 * outliers dropped, so the map sharpens with use and follows the drift of
 * a head that leans or shifts. A refit is only adopted when it does not
 * make the map worse on the evidence (its residual on the retained set is
 * no higher than the current map's).
 */
export interface OnlineCalibration {
  /** the explicit calibration run's samples (weight 1, never dropped) */
  base: CalibrationSample[]
  /** confirm samples, newest last, capped */
  learned: CalibrationSample[]
  /** the map in force, or null for the default */
  cal: Calibration | null
  /** how many confirms were rejected as outliers */
  rejected: number
}

/** Where a learned sample came from: Enter/pinch on the ringed node, or a positioned click on a node. */
export type LearnSource = 'gaze' | 'click'

/**
 * May this moment's features be learned from? The flag for the source, a
 * face, and NOT head-only (the iris zeroed would teach a head-only map).
 */
export function learnAllowed(
  cfg: Pick<EyeConfig, 'learnFromConfirms' | 'learnFromClicks'>,
  t: { facePresent: boolean; headOnly: boolean },
  source: LearnSource,
): boolean {
  const flag = source === 'click' ? cfg.learnFromClicks : cfg.learnFromConfirms
  return flag && t.facePresent && !t.headOnly
}

export function createOnlineCalibration(): OnlineCalibration {
  return { base: [], learned: [], cal: null, rejected: 0 }
}

export interface LearnConfig {
  learnMaxSamples: number
  learnMinSamples: number
  learnOutlierPx: number
  learnDecayMin: number
}

/** A learned sample's weight by age: half-life `halfLifeMin`, floor 0.3; 1 with no decay. */
export function ageWeight(ageMs: number, halfLifeMin: number): number {
  if (halfLifeMin <= 0 || !Number.isFinite(ageMs)) return 1
  return Math.max(0.3, Math.pow(0.5, ageMs / (halfLifeMin * 60_000)))
}

/**
 * The explicit run's weight once `n` confirms have accumulated: it starts
 * at 1 and decays to a floor of 0.2 over the first 12 confirms. The base
 * is the only wide-coverage evidence, so it never vanishes; but a head
 * that has shifted since the run makes it stale, and fresh confirms are
 * where the eyes ARE now.
 */
export function baseWeight(n: number): number {
  return Math.max(0.2, 1 - n / 12)
}

/**
 * Add a confirm and refit. Returns the new state and whether the map
 * changed. `viewport` enables the curvature stage as in the explicit fit.
 */
export function learnConfirm(
  s: OnlineCalibration,
  sample: CalibrationSample,
  cfg: EyeConfig & LearnConfig,
  defaultMap: (f: GazeFeatures) => { x: number; y: number },
  viewport: { w: number; h: number },
  nowMs = sample.t ?? 0,
): { state: OnlineCalibration; changed: boolean; report: FitReport | null } {
  const learned = [...s.learned, sample].slice(-cfg.learnMaxSamples)
  const weighted = (base: CalibrationSample[], n: number) => base.map((b) => ({ ...b, weight: baseWeight(n) }))
  // learned samples decay with age (a session that drifts twice must not fight itself)
  const aged = (ls: CalibrationSample[]) =>
    ls.map((l) => ({ ...l, weight: (l.weight ?? 1) * ageWeight(l.t !== undefined ? nowMs - l.t : 0, cfg.learnDecayMin) }))
  let all = [...weighted(s.base, learned.length), ...aged(learned)]
  // Without an explicit run, wait for enough confirms before trusting a map.
  if (s.base.length === 0 && learned.length < cfg.learnMinSamples) {
    return { state: { ...s, learned }, changed: false, report: null }
  }
  const currentMap = s.cal ? (f: GazeFeatures) => mapWith(s.cal!, f) : defaultMap
  let report = fitCalibrationReport(all, cfg, defaultMap, 1e-3, viewport)
  let rejected = s.rejected
  if (report.cal) {
    // Outlier pass: a learned sample far from the fitted map was a wrong
    // confirm (or a saccade at the moment of pressing) - drop it once. The
    // bar is relative to the CONFIRMS' own consensus (3x their median
    // error), never below learnOutlierPx: a head that has shifted makes
    // every confirm disagree with the stale base by the same amount, and
    // that agreement is the signal, not noise.
    const fitted = report.cal
    const errs = learned.map((l) => {
      const p = mapWith(fitted, l.features)
      return Math.hypot(p.x - l.target.x, p.y - l.target.y)
    })
    const sorted = [...errs].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0
    const bar = Math.max(cfg.learnOutlierPx, 3 * median)
    const keep = learned.filter((_, i) => errs[i] <= bar)
    if (keep.length !== learned.length) {
      rejected += learned.length - keep.length
      all = [...weighted(s.base, keep.length), ...aged(keep)]
      report = fitCalibrationReport(all, cfg, defaultMap, 1e-3, viewport)
      const state = { base: s.base, learned: keep, cal: s.cal, rejected }
      if (!report.cal) return { state, changed: false, report }
      return adopt(state, report, currentMap, all)
    }
  }
  const state = { base: s.base, learned, cal: s.cal, rejected }
  if (!report.cal) return { state, changed: false, report }
  return adopt(state, report, currentMap, all)
}

function adopt(
  state: OnlineCalibration,
  report: FitReport,
  currentMap: (f: GazeFeatures) => { x: number; y: number },
  evidence: readonly CalibrationSample[],
): { state: OnlineCalibration; changed: boolean; report: FitReport } {
  const before = residualOf(evidence, currentMap)
  // adopt unless it is worse on the evidence than what we have (a fresh
  // default map has a huge residual, so the first fit always wins)
  if (report.cal && report.residualPx <= before + 1e-9 && (report.accepted || state.cal !== null)) {
    return { state: { ...state, cal: report.cal }, changed: true, report }
  }
  return { state, changed: false, report }
}

/** Apply a calibration (linear + optional curvature) - the same maths as screenPointFrom. */
export function mapWith(cal: Calibration, f: GazeFeatures): { x: number; y: number } {
  let { x, y } = linearPoint(f, cal)
  if (cal.quad) {
    const hw = cal.quad.viewport.w / 2
    const hh = cal.quad.viewport.h / 2
    const b = quadBasis((x - hw) / hw, (y - hh) / hh)
    let dx = 0
    let dy = 0
    for (let i = 0; i < 6; i++) {
      dx += cal.quad.x[i] * b[i]
      dy += cal.quad.y[i] * b[i]
    }
    x += dx * hw
    y += dy * hh
  }
  return { x, y }
}
