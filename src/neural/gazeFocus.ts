// Gaze focus (ORB_EYE 'point' mode, user direction 2026-09-10): which node
// the eyes are on. Pure; tests/eye.test.ts.
//
// The gaze point is coarse (2-6° ≈ 80-230 px at 900 px height, est.) while
// nodes sit a median ~75 px apart, so this is a SOFT CONE with strong
// hysteresis, never a pinpoint: every node gets a capture radius scaled to
// its glow (bigger posts are easier targets, as they are for the mouse),
// the node the gaze is most centred on (dist / radius) is the candidate,
// and a candidate must stay the best for `holdMs` before it takes the
// focus. The focus is dropped only after its score has exceeded
// `releaseFactor` for `holdMs`. Confirming is someone else's job: Enter,
// a pinch-tap, or - opt-in - dwell.

export interface GazeCandidate {
  name: string
  /** px from the gaze point to the node's projected centre */
  dist: number
  /** the node's capture radius in px */
  r: number
}

export interface GazeFocusState {
  /** the focused node, or null */
  name: string | null
  /** when it took the focus (ms) */
  since: number
  /** the current best candidate that is not the focus, and since when */
  rival: string | null
  rivalSince: number
  /** the focus has been out of its release cone since (ms), or null */
  lostSince: number | null
  /** a dwell confirm has fired for this focus */
  dwelled: boolean
}

export function createGazeFocus(): GazeFocusState {
  return { name: null, since: 0, rival: null, rivalSince: 0, lostSince: null, dwelled: false }
}

export interface GazeFocusConfig {
  holdMs: number
  releaseFactor: number
  /** a rival must beat the current focus's score by this factor (< 1) to start the switch clock */
  switchMargin?: number
}

/** One frame. Returns the new state; does not mutate the input. */
export function stepGazeFocus(
  s: GazeFocusState,
  cands: readonly GazeCandidate[],
  nowMs: number,
  cfg: GazeFocusConfig,
): GazeFocusState {
  let best: GazeCandidate | null = null
  let bestScore = Infinity
  for (const c of cands) {
    if (c.r <= 0) continue
    const score = c.dist / c.r
    if (score <= 1 && score < bestScore) {
      bestScore = score
      best = c
    }
  }
  let { name, since, rival, rivalSince, lostSince, dwelled } = s

  // the rival: the best candidate that is not the current focus - and,
  // while a focus is held, one that beats it by the switch margin (a
  // near-tie between neighbours stays with the node already focused)
  const cur = name ? cands.find((c) => c.name === name) : undefined
  const curScore = cur && cur.r > 0 ? cur.dist / cur.r : Infinity
  const margin = cfg.switchMargin ?? 1
  if (best && best.name !== name && (!cur || bestScore < curScore * margin)) {
    if (rival !== best.name) {
      rival = best.name
      rivalSince = nowMs
    }
  } else {
    rival = null
  }

  // release: the focus has left its (wider) cone for holdMs
  if (name) {
    const cur = cands.find((c) => c.name === name)
    const out = !cur || cur.r <= 0 || cur.dist / cur.r > cfg.releaseFactor
    if (out) {
      if (lostSince === null) lostSince = nowMs
      if (nowMs - lostSince >= cfg.holdMs) {
        name = null
        lostSince = null
        dwelled = false
      }
    } else {
      lostSince = null
    }
  }

  // acquire / switch: the rival has been the best for holdMs
  if (rival && nowMs - rivalSince >= cfg.holdMs) {
    name = rival
    since = nowMs
    rival = null
    lostSince = null
    dwelled = false
  }
  return { name, since, rival, rivalSince, lostSince, dwelled }
}

// Fixation averaging moved into the channel (input/eye/fixation.ts) so the
// speed-gated freeze sees the stilled point; re-exported for the tests.
export { createFixation, stepFixation } from '../input/eye/fixation'
export type { FixationState } from '../input/eye/fixation'

/** Shared runtime for the overlay + telemetry (pointRuntime pattern). */
export const gazeRuntime = {
  /** the gaze pointer is live (channel idle, face present, not calibrating, shell closed) */
  live: false,
  /** the gaze point, px from screen centre */
  x: 0,
  y: 0,
  /** the focused node, its projected px offset from centre and visible radius */
  name: null as string | null,
  nodeX: 0,
  nodeY: 0,
  nodeR: 0,
  /** ms the focus has been held */
  heldMs: 0,
  /** frames in the current fixation (1 = a fresh saccade) */
  fixationN: 0,
}
