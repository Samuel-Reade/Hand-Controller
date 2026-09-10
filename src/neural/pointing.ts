// Crosshair pointing + highlight model (ORB_SELECT_SPEC §2/§3, slice PT1).
// Pure math, no three.js - the whole acquisition model runs headless in
// tests/pointing.test.ts, which is why highlight is testable without a
// webcam: it is a function of (yaw, pitch, viewport) alone.
//
// The sight is FIXED at screen centre and never moves (§1 LOCKED); the user
// rotates the field to bring a node to it. So "pointing" here is projection
// plus an argmin of distance-to-centre over the TARGETABLE nodes, with the
// two-radius deadband that stops the highlight flickering between
// neighbours on hand micro-jitter.
//
// Nothing in this module selects, drills or mutates the scene - PT1 is
// read-only by construction (§8).

import { ORBITS } from '../data/orbits'
import { rotateYawPitch } from '../orb/geometry'
import type { Vec3 } from '../orb/geometry'
import { NCONF } from './config'
import type { PointConfig } from './config'
import { nodePosition } from './graph'
import type { NeuralNode } from './graph'

// ── Projection ──────────────────────────────────────────────────────────────

export interface ViewSpec {
  /** camera z (it dollies with zoom); the camera looks down -Z at the origin */
  camZ: number
  fovDeg: number
  /** viewport height in px - the projection is aspect-independent (see below) */
  viewportH: number
  /** the recenter offset group's translation, if any */
  offset?: Vec3
}

export interface Projected {
  /** px from screen centre, +x right / +y down */
  x: number
  y: number
  /** px distance from screen centre */
  dist: number
  /** depth in front of the camera; > 0 is the near side (the spec's `w`) */
  w: number
}

/**
 * Constellation-local position -> px offset from screen centre.
 *
 * Both axes scale by the SAME factor (viewportH/2)/tan(fov/2): three.js
 * fov is vertical, and the horizontal term picks up a 1/aspect that the
 * NDC->px conversion multiplies straight back out. So distance-from-centre
 * in px depends on viewport HEIGHT only - the acquire/release radii mean
 * the same thing at any aspect ratio.
 */
export function projectLocal(
  local: Vec3,
  yaw: number,
  pitch: number,
  view: ViewSpec,
): Projected {
  const r = rotateYawPitch(local, yaw, pitch)
  const wx = r[0] + (view.offset?.[0] ?? 0)
  const wy = r[1] + (view.offset?.[1] ?? 0)
  const wz = r[2] + (view.offset?.[2] ?? 0)
  const w = view.camZ - wz
  if (w <= 1e-6) return { x: 0, y: 0, dist: Infinity, w }
  const f = view.viewportH / 2 / Math.tan((view.fovDeg * Math.PI) / 360)
  const x = (f * wx) / w
  const y = (-f * wy) / w
  return { x, y, dist: Math.hypot(x, y), w }
}

/** Convenience: project a graph node (brain sits at the origin). */
export function projectNode(
  n: NeuralNode,
  yaw: number,
  pitch: number,
  view: ViewSpec,
): Projected {
  return projectLocal(nodePosition(n), yaw, pitch, view)
}

// ── Targetable nodes (§2) ───────────────────────────────────────────────────

export interface ReportBinding {
  orbitIndex: number
  itemIndex: number
}

/**
 * Which graph node carries which report.
 *
 * PRODUCT DECISION, flagged: ORB_SELECT_SPEC §2 says the binding density
 * ("~35 of 455") is "inherited from P5's `hub i -> orbit (i mod 5)`
 * mapping" and that changing it is out of scope for that spec. P5 never
 * bound reports to graph nodes at all - it re-shelled them onto the globe
 * grid at level 1 - so the binding has to be stated somewhere, and this is
 * the one place.
 *
 * The rule keeps P5's hub->orbit mapping and adds the minimum needed to
 * make the full tree navigable: each report gets exactly ONE host, so the
 * bound count is the report count (35), matching the density the spec
 * names. An orbit is carried by several hubs (20 hubs over 5 orbits), so
 * that orbit's reports are dealt round-robin across its hubs, and within a
 * hub to its descendants in creation order.
 *
 * The alternative - binding every report under every hub that carries its
 * orbit - is closer to P5's "reachable through any hub" behaviour but
 * quadruples the density to 140, which reads as a much busier field. Chosen
 * against; flip this function to change it, nothing else encodes the policy.
 */
export function bindReports(nodes: readonly NeuralNode[]): Map<string, ReportBinding> {
  const byName = new Map<string, NeuralNode>()
  for (const n of nodes) byName.set(n.name, n)

  // Each node's owning hub, resolved by walking parents (parents always
  // precede children in creation order, so one pass suffices).
  const hubOf = new Map<string, string | null>()
  const ownerHub = (n: NeuralNode): string | null => {
    const cached = hubOf.get(n.name)
    if (cached !== undefined) return cached
    let owner: string | null
    if (n.tier === 'hub') owner = n.name
    else if (n.parentName === null) owner = null
    else {
      const p = byName.get(n.parentName)
      owner = p ? ownerHub(p) : null
    }
    hubOf.set(n.name, owner)
    return owner
  }

  const hubNames: string[] = []
  const descendants = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.tier !== 'hub') continue
    hubNames.push(n.name)
    descendants.set(n.name, [])
  }
  for (const n of nodes) {
    if (n.tier === 'hub' || n.tier === 'brain') continue
    const owner = ownerHub(n)
    if (owner) descendants.get(owner)!.push(n.name)
  }

  const binding = new Map<string, ReportBinding>()
  for (let orbitIndex = 0; orbitIndex < ORBITS.length; orbitIndex++) {
    // the hubs carrying this orbit, in creation order
    const carriers = hubNames.filter((_, i) => i % ORBITS.length === orbitIndex)
    if (carriers.length === 0) continue
    const reports = ORBITS[orbitIndex].reports
    for (let itemIndex = 0; itemIndex < reports.length; itemIndex++) {
      const hub = carriers[itemIndex % carriers.length]
      const slot = Math.floor(itemIndex / carriers.length)
      const kids = descendants.get(hub)!
      // first free host at or after the dealt slot; the hub itself last
      let host: string | null = null
      for (let k = slot; k < kids.length && host === null; k++) {
        if (!binding.has(kids[k])) host = kids[k]
      }
      if (host === null && !binding.has(hub)) host = hub
      if (host !== null) binding.set(host, { orbitIndex, itemIndex })
    }
  }
  return binding
}

/**
 * §2: targetable iff bound to a report, or an ancestor of a report-bound
 * node. Structural dead-ends still render but the crosshair skips them, so
 * every confirm is meaningful. The brain is the anchor and is always
 * targetable (§4 - it is the drill-out target).
 */
export function targetableNames(
  nodes: readonly NeuralNode[],
  binding: ReadonlyMap<string, ReportBinding> = bindReports(nodes),
): Set<string> {
  const byName = new Map<string, NeuralNode>()
  for (const n of nodes) byName.set(n.name, n)
  const out = new Set<string>()
  for (const name of binding.keys()) {
    let cur: NeuralNode | undefined = byName.get(name)
    while (cur && !out.has(cur.name)) {
      out.add(cur.name)
      cur = cur.parentName ? byName.get(cur.parentName) : undefined
    }
  }
  for (const n of nodes) if (n.tier === 'brain') out.add(n.name)
  return out
}

// ── Highlight with hysteresis (§1 LOCKED, §3) ───────────────────────────────

export interface HighlightCandidate {
  name: string
  dist: number
  w: number
  /**
   * This candidate holds the ANCHOR role (§4 - the drill-out target).
   * It competes differently; see resolveCandidate.
   */
  anchor?: boolean
}

export interface HighlightState {
  name: string | null
  dist: number
}

export function createHighlightState(): HighlightState {
  return { name: null, dist: Infinity }
}

/**
 * Nearest to centre, with the §1 depth tie-break: inside `tieBandPx` OF THE
 * NEAREST the candidates are treated as equally central and the one NEARER
 * THE CAMERA wins - it is the one you would visually say you were pointing
 * at. Far-side nodes (w <= 0) never compete.
 *
 * Two passes on purpose. A single pass that compares each candidate with the
 * running best lets ties CHAIN (A -> C inside the band of A, then B inside
 * the band of C) and walk more than a band away from the true argmin - it
 * surfaced the moment clusters got denser (a 27 px node beat a 17 px one on
 * a 10 px band). The band is relative to the minimum, never transitive.
 */
export function bestCandidate(
  cands: readonly HighlightCandidate[],
  tieBandPx: number = NCONF.point.tieBandPx,
): HighlightCandidate | null {
  let min = Infinity
  for (const c of cands) if (c.w > 0 && c.dist < min) min = c.dist
  if (min === Infinity) return null
  let best: HighlightCandidate | null = null
  for (const c of cands) {
    if (c.w <= 0 || c.dist > min + tieBandPx) continue
    if (!best || c.w > best.w) best = c
  }
  return best
}

/**
 * The frame's winner.
 *
 * SPEC GAP, resolved here and flagged: §1 locks "nearest projected centre
 * wins" and §4 locks "the anchor is always targetable", but the anchor sits
 * at the constellation origin, so it projects to EXACTLY screen centre at
 * every rotation - distance 0, forever. Read literally the two rules make
 * the anchor win essentially always (measured: 294 of 300 random
 * rotations), and no hub could ever be sighted.
 *
 * Resolution: the anchor is a FALLBACK, not a competitor. It can only be
 * acquired when no ordinary targetable node is inside `acquireRadius` -
 * which is exactly the rule P5 already used at level 1
 * (`select.anchorWinsBelow`: the anchor is the candidate when no shell
 * report holds the reticle). Sighting the anchor to drill out still works
 * (§4) - you sight it by rotating so nothing else is under the sight.
 */
export function resolveCandidate(
  cands: readonly HighlightCandidate[],
  cfg: PointConfig = NCONF.point,
): HighlightCandidate | null {
  const ordinary = cands.filter((c) => !c.anchor)
  // The tie-break runs over the IN-RANGE set, not the whole field: applied
  // to everything it could otherwise elect a node just outside
  // acquireRadius (nearer the camera, inside the tie band) while a closer
  // one sat inside the radius - and hand the frame to the anchor.
  const inRange = bestCandidate(
    ordinary.filter((c) => c.dist <= cfg.acquireRadius),
    cfg.tieBandPx,
  )
  if (inRange) return inRange
  const anchor = bestCandidate(
    cands.filter((c) => c.anchor),
    cfg.tieBandPx,
  )
  if (anchor && anchor.dist <= cfg.acquireRadius) return anchor
  // Nothing acquirable this frame. Report the nearest ordinary node anyway:
  // stepHighlight will not ACQUIRE it (too far), but the pseudocode's steal
  // rule still lets it take over an existing highlight by switchMargin.
  return bestCandidate(ordinary, cfg.tieBandPx) ?? anchor
}

/**
 * One frame of the highlight deadband (§1 LOCKED - never a single-frame
 * nearest):
 *   - nothing held: acquire the winner iff it is inside acquireRadius
 *   - something held: keep it until it leaves releaseRadius, or a rival
 *     beats it by more than switchMargin
 * Returns the new state; does not mutate the input.
 */
export function stepHighlight(
  s: HighlightState,
  cands: readonly HighlightCandidate[],
  cfg: PointConfig = NCONF.point,
): HighlightState {
  const best = resolveCandidate(cands, cfg)
  const acquire = (): HighlightState =>
    best && best.dist <= cfg.acquireRadius
      ? { name: best.name, dist: best.dist }
      : { name: null, dist: Infinity }

  if (s.name === null) return acquire()

  // The held node may have left the candidate set entirely (rotated to the
  // far side): treat that as a release.
  const cur = cands.find((c) => c.name === s.name && c.w > 0)
  if (!cur) return acquire()

  // The anchor is held under the fallback rule, not the deadband. It sits at
  // distance 0 forever, so the ordinary release tests can never fire on it:
  // releaseRadius is never exceeded, and no rival can beat 0 by
  // switchMargin. Without this branch the anchor latches at start-up and the
  // sight never moves again (measured: 0 of 40 drag samples reached any
  // other node). It yields the instant an ordinary node is acquirable.
  if (cur.anchor) {
    return best && !best.anchor && best.dist <= cfg.acquireRadius
      ? { name: best.name, dist: best.dist }
      : { name: cur.name, dist: cur.dist }
  }

  if (cur.dist > cfg.releaseRadius) return acquire()
  if (best && best.name !== cur.name && best.dist < cur.dist - cfg.switchMargin) {
    return { name: best.name, dist: best.dist }
  }
  return { name: cur.name, dist: cur.dist }
}

// ── Frame helper ────────────────────────────────────────────────────────────

/**
 * Project every targetable node once - O(n) over the field. `anchorName` is
 * the node currently holding the anchor role (the brain at level 0; the
 * drilled node once inside), which competes per resolveCandidate.
 */
export function candidatesFor(
  nodes: readonly NeuralNode[],
  targetable: ReadonlySet<string>,
  yaw: number,
  pitch: number,
  view: ViewSpec,
  anchorName = 'brain',
): HighlightCandidate[] {
  const out: HighlightCandidate[] = []
  for (const n of nodes) {
    if (!targetable.has(n.name)) continue
    const p = projectNode(n, yaw, pitch, view)
    if (p.w <= 0) continue
    out.push({ name: n.name, dist: p.dist, w: p.w, anchor: n.name === anchorName })
  }
  return out
}

/** Shared runtime for the crosshair overlay + telemetry (orbRuntime pattern). */
export const pointRuntime = {
  /** highlighted node name, or null */
  name: null as string | null,
  tier: '' as string,
  /** px from screen centre of the highlight (Infinity when none) */
  dist: Infinity,
  /** projected px offset from centre, for the ring overlay */
  x: 0,
  y: 0,
  /** ring radius in px - the node's projected sprite radius */
  ringR: 0,
  /** the highlighted node's body colour, for the ring + sight tint */
  hue: '#C9A227',
  /** current drill depth (0 = field) */
  depth: 0,
  /** PT2: whether the magnetic targeting torque is active */
  magnet: false,
  /** pinch is down over an acquired node (the Confirming state, §3) */
  confirming: false,
  /** how many nodes are targetable at all - a sanity number for the gate */
  targetableCount: 0,
}
