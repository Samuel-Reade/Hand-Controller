// Fixation averaging (EYE_ACCURACY_PLAN): a stare is the MEAN of the recent
// gaze points that cluster with the latest one (a dispersion rule), not one
// frame. The window GROWS from `fixationMs` to `fixationMaxMs` while the
// fixation holds - more frames in the mean for a steady stare, no extra lag
// on a fresh one. A saccade (the latest point outside the radius of the
// recent ones) starts a new fixation. Lives in the channel, ahead of the
// speed-gated freeze, so the freeze sees the stilled point.

export interface FixationState {
  pts: { t: number; x: number; y: number }[]
  /** when the current fixation began (the last saccade), ms */
  since: number
}

export function createFixation(): FixationState {
  return { pts: [], since: 0 }
}

export function stepFixation(
  s: FixationState,
  x: number,
  y: number,
  nowMs: number,
  cfg: { fixationMs: number; fixationMaxMs?: number; fixationRadiusPx: number },
): { state: FixationState; x: number; y: number; n: number; windowMs: number } {
  const maxMs = Math.max(cfg.fixationMs, cfg.fixationMaxMs ?? cfg.fixationMs)
  const inCluster = s.pts.filter((p) => Math.hypot(p.x - x, p.y - y) <= cfg.fixationRadiusPx)
  const since = inCluster.length === 0 ? nowMs : s.since
  const windowMs = Math.min(maxMs, Math.max(cfg.fixationMs, nowMs - since))
  const keep = inCluster.filter((p) => nowMs - p.t <= windowMs)
  keep.push({ t: nowMs, x, y })
  let mx = 0
  let my = 0
  for (const p of keep) {
    mx += p.x
    my += p.y
  }
  return { state: { pts: keep, since }, x: mx / keep.length, y: my / keep.length, n: keep.length, windowMs }
}
