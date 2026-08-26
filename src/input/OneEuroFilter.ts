// One Euro filter (S9): smooths hard when still, lightly when fast - unlike
// a moving average it does not add lag exactly where it hurts (flicks).
// Params are passed per call so leva slider changes apply live.

export interface OneEuroParams {
  minCutoff: number
  beta: number
  dCutoff?: number // derivative cutoff, ~1.0 per the paper
}

function smoothingAlpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

export class OneEuroFilter {
  private xPrev: number | null = null
  private dxPrev = 0
  private tPrev = 0

  /** Filter one sample. `tS` is the timestamp in seconds. */
  filter(x: number, tS: number, params: OneEuroParams): number {
    if (this.xPrev === null) {
      this.xPrev = x
      this.tPrev = tS
      this.dxPrev = 0
      return x
    }
    const dt = tS - this.tPrev
    if (dt <= 0) return this.xPrev // non-monotonic timestamp: hold

    const dCutoff = params.dCutoff ?? 1.0
    const dx = (x - this.xPrev) / dt
    const aD = smoothingAlpha(dCutoff, dt)
    const edx = aD * dx + (1 - aD) * this.dxPrev

    const cutoff = params.minCutoff + params.beta * Math.abs(edx)
    const a = smoothingAlpha(cutoff, dt)
    const filtered = a * x + (1 - a) * this.xPrev

    this.xPrev = filtered
    this.dxPrev = edx
    this.tPrev = tS
    return filtered
  }

  reset(): void {
    this.xPrev = null
    this.dxPrev = 0
    this.tPrev = 0
  }
}
