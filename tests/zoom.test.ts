// ORB_ZOOM_SPEC section 6 - two-hand harness scenarios through the real
// multi-hand pipeline (slot matching + filters + arbiter + the untouched
// single-hand machine), plus the pure zoom view's spring-back / hand-off.
import { beforeEach, describe, expect, it } from 'vitest'
import { FEEL } from '../src/config/feel'
import type { InputEvent } from '../src/input/InputBus'
import { createHandPipeline } from '../src/input/gestureMachine'
import { createMultiHandPipeline } from '../src/input/handArbiter'
import {
  applyZoomEvent,
  commitZoomView,
  createZoomView,
  stepZoomView,
} from '../src/input/zoomView'
import { FRAME_MS, pairScenarios, scenarios, toPairFrames } from '../src/dev/syntheticHand'
import type { SyntheticPairFrame } from '../src/dev/syntheticHand'

type ZoomEvent = Extract<InputEvent, { type: 'zoom' }>
type CommitEvent = Extract<InputEvent, { type: 'zoomCommit' }>

interface Stamped {
  e: InputEvent
  tMs: number
  frame: number
}

interface RunOpts {
  level?: 0 | 1
  /** mimic the scene: a commit flips the level immediately (default true) */
  followLevel?: boolean
  hubFocused?: boolean
}

function runPair(frames: SyntheticPairFrame[], opts: RunOpts = {}): Stamped[] {
  const pipeline = createMultiHandPipeline()
  let level: 0 | 1 = opts.level ?? 0
  const out: Stamped[] = []
  frames.forEach((f, frame) => {
    const ctx = { level, hubFocused: opts.hubFocused ?? true }
    for (const e of pipeline.process(f.hands, f.tMs, ctx)) {
      out.push({ e, tMs: f.tMs, frame })
      if (e.type === 'zoomCommit' && (opts.followLevel ?? true)) level = e.dir === 'in' ? 1 : 0
    }
  })
  return out
}

const run = (name: keyof typeof pairScenarios, opts?: RunOpts) =>
  runPair(pairScenarios[name](), opts)

const ofType = <T extends InputEvent['type']>(events: InputEvent[], type: T) =>
  events.filter((e): e is Extract<InputEvent, { type: T }> => e.type === type)
const events = (s: Stamped[]) => s.map((x) => x.e)
const zooms = (s: Stamped[], phase: ZoomEvent['phase']) =>
  s.filter((x): x is Stamped & { e: ZoomEvent } => x.e.type === 'zoom' && x.e.phase === phase)
const commits = (s: Stamped[]) =>
  s.filter((x): x is Stamped & { e: CommitEvent } => x.e.type === 'zoomCommit')
const singleHand = (evs: InputEvent[]) =>
  evs.filter((e) => e.type !== 'zoom' && e.type !== 'zoomCommit')
const isMonotonic = (xs: number[], strict = true) =>
  xs.every((x, i) => i === 0 || (strict ? x > xs[i - 1] : x >= xs[i - 1]))

/** Drive the pure view with a run's zoom events, then let it settle. */
function settleView(s: Stamped[], settleFrames = 60): number {
  const view = createZoomView()
  let last = -1
  for (const x of s) {
    for (; last < x.frame; last++) stepZoomView(view, FRAME_MS / 1000, 1)
    if (x.e.type === 'zoom') applyZoomEvent(view, x.e)
    else if (x.e.type === 'zoomCommit') commitZoomView(view, 0)
  }
  let f = view.factor
  for (let i = 0; i < settleFrames; i++) f = stepZoomView(view, 1 / 60, 1)
  return f
}

beforeEach(() => {
  // Tests run against the shipped defaults.
  FEEL.minCutoff = 1.0
  FEEL.beta = 0.03
  FEEL.deadZone = 0.004
  FEEL.pinchCutoff = 8.0
  FEEL.pinchClose = 0.28
  FEEL.pinchOpen = 0.38
  FEEL.tapMaxMs = 250
  FEEL.tapMaxTravel = 0.02
  FEEL.handGain = 2.6
  FEEL.zoomGain = 2.2
  FEEL.zoomMin = 0.55
  FEEL.zoomMax = 2.1
  FEEL.zoomInCommit = 1.6
  FEEL.zoomOutCommit = 0.64
  FEEL.springBack = 12
  FEEL.zoomCutoff = 6
  FEEL.zoomBeta = 0.02
  FEEL.commitCooldownMs = 350
  FEEL.twoHandFrames = 2
  FEEL.zoomCommitsDrill = true
  FEEL.zoomPersist = false // these suites assert the ORB_ZOOM_SPEC spring-back contract
})

describe('one-hand paths are untouched (arbiter regression)', () => {
  for (const name of Object.keys(scenarios)) {
    it(`${name}: identical events through the arbiter, zero zoom events`, () => {
      const single = createHandPipeline()
      const multi = createMultiHandPipeline()
      const a: InputEvent[] = []
      const b: InputEvent[] = []
      const frames = scenarios[name]()
      for (const f of frames) a.push(...single.process(f.landmarks, f.tMs))
      for (const f of toPairFrames(frames)) b.push(...multi.process(f.hands, f.tMs))
      expect(b).toEqual(a)
      expect(ofType(b, 'zoom')).toHaveLength(0)
      expect(ofType(b, 'zoomCommit')).toHaveLength(0)
    })
  }
})

describe('1. zoomIn', () => {
  it('one engage, monotonic rise, exactly one commit(in), baseline re-latched', () => {
    const s = run('zoomIn')
    expect(zooms(s, 'engage')).toHaveLength(1)
    const c = commits(s)
    expect(c).toHaveLength(1)
    expect(c[0].e.dir).toBe('in')
    const updates = zooms(s, 'update')
    const commitAt = s.indexOf(c[0])
    const before = updates.filter((u) => s.indexOf(u) < commitAt).map((u) => u.e.factor)
    const after = updates.filter((u) => s.indexOf(u) > commitAt).map((u) => u.e.factor)
    // rises monotonically once the depth move is under way (the first two
    // updates sit at ratio 1 inside tracker noise)
    expect(before.length).toBeGreaterThan(4)
    expect(isMonotonic(before.slice(2))).toBe(true)
    expect(before[before.length - 1]).toBeGreaterThanOrEqual(FEEL.zoomInCommit)
    // re-latched: the next update starts back near 1.0 ...
    expect(after[0]).toBeLessThan(1.2)
    // ... keeps rising at level 1 and clamps at zoomMax - no second commit,
    // no report-open (only zoom / zoomCommit events exist here)
    expect(isMonotonic(after, false)).toBe(true)
    expect(after[after.length - 1]).toBeGreaterThan(FEEL.zoomMax - 0.06) // filter converging on the clamp
    expect(singleHand(events(s))).toEqual([])
    const ends = zooms(s, 'end')
    expect(ends).toHaveLength(1)
    expect(ends[0].e.commit).toBe('in')
  })
})

describe('2. zoomOut', () => {
  it('from level 1: exactly one commit(out); none at level 0 floor', () => {
    const s = run('zoomOut', { level: 1 })
    const c = commits(s)
    expect(c).toHaveLength(1)
    expect(c[0].e.dir).toBe('out')
    const updates = zooms(s, 'update').map((u) => u.e.factor)
    expect(Math.min(...updates)).toBeLessThan(FEEL.zoomMin + 0.02) // dollied to the floor and stopped
    expect(singleHand(events(s))).toEqual([])
  })
  it('at level 0 zoom-out never commits (dolly to zoomMin and stop)', () => {
    const s = run('zoomOut', { level: 0 })
    expect(commits(s)).toHaveLength(0)
    expect(Math.min(...zooms(s, 'update').map((u) => u.e.factor))).toBeLessThan(FEEL.zoomMin + 0.02)
  })
})

describe('3. zoomPeekRelease', () => {
  it('zero commits, spring-back to within 0.02 of 1.0, no drill', () => {
    const s = run('zoomPeekRelease')
    expect(commits(s)).toHaveLength(0)
    const peak = Math.max(...zooms(s, 'update').map((u) => u.e.factor))
    expect(peak).toBeGreaterThan(1.15)
    expect(peak).toBeLessThan(FEEL.zoomInCommit)
    const ends = zooms(s, 'end')
    expect(ends).toHaveLength(1)
    expect(ends[0].e.commit).toBe('none')
    expect(Math.abs(settleView(s) - 1)).toBeLessThan(0.02)
    expect(singleHand(events(s))).toEqual([])
  })
})

describe('4. oneHandNoZoom', () => {
  it('second hand present but open: zero zoom events, the flick fires as in the base suite', () => {
    const evs = events(run('oneHandNoZoom'))
    expect(ofType(evs, 'zoom')).toHaveLength(0)
    expect(ofType(evs, 'zoomCommit')).toHaveLength(0)
    expect(ofType(evs, 'engage')).toHaveLength(1)
    expect(ofType(evs, 'move').length).toBeGreaterThan(2)
    const releases = ofType(evs, 'release')
    expect(releases).toHaveLength(1)
    expect(Math.abs(releases[0].vYaw)).toBeGreaterThan(FEEL.detentBelow)
    expect(releases[0].vYaw).toBeGreaterThan(0)
    expect(ofType(evs, 'tap')).toHaveLength(0)
    expect(ofType(evs, 'lost')).toHaveLength(0)
  })
})

describe('5. secondHandJoins', () => {
  it('the drag ends with a zero-velocity release, exactly one zoom engage, no tap', () => {
    const s = run('secondHandJoins')
    const evs = events(s)
    expect(ofType(evs, 'engage')).toHaveLength(1)
    expect(ofType(evs, 'move').length).toBeGreaterThan(0) // the drag was under way
    const releases = ofType(evs, 'release')
    expect(releases).toHaveLength(1)
    expect(releases[0].vYaw).toBe(0)
    expect(releases[0].vPitch).toBe(0)
    expect(ofType(evs, 'tap')).toHaveLength(0)
    expect(ofType(evs, 'lost')).toHaveLength(0)
    const engages = zooms(s, 'engage')
    expect(engages).toHaveLength(1)
    // the release is the conversion itself: same frame as the zoom engage
    const rel = s.find((x) => x.e.type === 'release')!
    expect(rel.frame).toBe(engages[0].frame)
    // nothing from the single-hand machine after zoom took the input
    const afterZoom = s.filter((x) => x.frame > engages[0].frame).map((x) => x.e)
    expect(singleHand(afterZoom)).toEqual([])
    expect(commits(s)).toHaveLength(0) // lateral motion is not depth
  })
})

describe('6. oneHandDrops', () => {
  it('zoom ends with commit none, springs back, and the remaining pinched hand never re-arms a flick', () => {
    const s = run('oneHandDrops')
    expect(zooms(s, 'engage')).toHaveLength(1)
    const ends = zooms(s, 'end')
    expect(ends).toHaveLength(1)
    expect(ends[0].e.commit).toBe('none')
    const dropFrame = 9 + 4 + 10
    expect(ends[0].frame).toBeGreaterThanOrEqual(dropFrame)
    expect(ends[0].frame).toBeLessThanOrEqual(dropFrame + 7) // 6-frame loss tolerance
    expect(commits(s)).toHaveLength(0)
    expect(singleHand(events(s))).toEqual([]) // no engage / move / release / tap / lost at all
    expect(Math.abs(settleView(s) - 1)).toBeLessThan(0.02)
  })
})

describe('7. bothPinchJitter', () => {
  it('at most one commit; then the cooldown + re-latch hold - no flicker', () => {
    const s = run('bothPinchJitter')
    expect(zooms(s, 'engage')).toHaveLength(1)
    const c = commits(s)
    expect(c.length).toBeLessThanOrEqual(1)
    if (c.length === 1) {
      expect(c[0].e.dir).toBe('in')
      const later = s.filter((x) => x.tMs > c[0].tMs && x.e.type === 'zoomCommit')
      expect(later).toHaveLength(0)
    }
    expect(singleHand(events(s))).toEqual([])
  })
})

describe('8. asymmetricDepth', () => {
  it('hands at 0.06 and 0.12 track the symmetric trajectory within 10%', () => {
    FEEL.zoomCommitsDrill = false // compare pure trajectories - no re-latch mid-run
    const sym = run('zoomIn')
    const asym = run('asymmetricDepth')
    expect(commits(sym)).toHaveLength(0)
    expect(commits(asym)).toHaveLength(0)
    const fs = zooms(sym, 'update').map((u) => u.e.factor)
    const fa = zooms(asym, 'update').map((u) => u.e.factor)
    const n = Math.min(fs.length, fa.length)
    expect(n).toBeGreaterThan(15)
    expect(Math.abs(fs.length - fa.length)).toBeLessThanOrEqual(1)
    for (let i = 0; i < n; i++) {
      expect(Math.abs(fa[i] - fs[i]) / fs[i]).toBeLessThan(0.1)
    }
  })
})

describe('9. commitCooldown', () => {
  it('continued growth re-crosses the threshold inside the cooldown without a second commit', () => {
    // Without the cooldown the scenario WOULD commit twice (proves it re-crosses).
    FEEL.commitCooldownMs = 0
    const free = run('commitCooldown', { followLevel: false })
    expect(commits(free).length).toBeGreaterThanOrEqual(2)
    FEEL.commitCooldownMs = 350
    // With the cooldown, any two commits are >= commitCooldownMs apart ...
    const held = commits(run('commitCooldown', { followLevel: false }))
    expect(held.length).toBeGreaterThanOrEqual(1)
    for (let i = 1; i < held.length; i++) {
      expect(held[i].tMs - held[i - 1].tMs).toBeGreaterThanOrEqual(FEEL.commitCooldownMs)
    }
    // ... and with the level following the commit (as the scene does), the
    // level advances exactly once.
    expect(commits(run('commitCooldown'))).toHaveLength(1)
  })
})

describe('config forks + suspension', () => {
  it('zoomCommitsDrill=false: pure dolly, never drills', () => {
    FEEL.zoomCommitsDrill = false
    const s = run('zoomIn')
    expect(commits(s)).toHaveLength(0)
    expect(Math.max(...zooms(s, 'update').map((u) => u.e.factor))).toBeGreaterThan(FEEL.zoomInCommit)
  })
  it('level-0 commit needs a reticle-focused hub', () => {
    const s = run('zoomIn', { hubFocused: false })
    expect(commits(s)).toHaveLength(0)
  })
  it('reset() closes a zoom in flight with an end, a drag with lost - never a fling', () => {
    const frames = pairScenarios.zoomIn()
    const p = createMultiHandPipeline()
    for (const f of frames.slice(0, 20)) p.process(f.hands, f.tMs)
    expect(p.state.zooming).toBe(true)
    const out = p.reset()
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'zoom', phase: 'end' })
    expect(p.state.zooming).toBe(false)
    const q = createMultiHandPipeline()
    for (const f of toPairFrames(scenarios.slowDrag()).slice(0, 30)) q.process(f.hands, f.tMs)
    expect(q.state.single.phase).toBe('engaged')
    expect(q.reset()).toEqual([{ type: 'lost' }])
  })
})

describe('zoom view (pure)', () => {
  it('a commit hands the pre-commit factor to the recenter - the camera is continuous', () => {
    const v = createZoomView()
    applyZoomEvent(v, { type: 'zoom', phase: 'update', factor: 1.6, commit: 'none' })
    expect(stepZoomView(v, 1 / 60, 1)).toBeCloseTo(1.6, 6)
    commitZoomView(v, 0) // arbiter re-latched to 1.0; transition just started
    expect(stepZoomView(v, 1 / 60, 0)).toBeCloseTo(1.6, 6) // no jump
    expect(stepZoomView(v, 1 / 60, 0.5)).toBeCloseTo(1.3, 6) // eases with the recenter
    applyZoomEvent(v, { type: 'zoom', phase: 'update', factor: 1.2, commit: 'in' })
    expect(stepZoomView(v, 1 / 60, 1)).toBeCloseTo(1.2, 6) // carry done, live hand shows
    applyZoomEvent(v, { type: 'zoom', phase: 'end', factor: 1.2, commit: 'in' })
    let f = 1.2
    for (let i = 0; i < 60; i++) f = stepZoomView(v, 1 / 60, 1)
    expect(Math.abs(f - 1)).toBeLessThan(0.02)
  })
  it('stays inside [zoomMin, zoomMax]', () => {
    const v = createZoomView()
    applyZoomEvent(v, { type: 'zoom', phase: 'update', factor: 2.1, commit: 'none' })
    commitZoomView(v, 0)
    applyZoomEvent(v, { type: 'zoom', phase: 'update', factor: 2.1, commit: 'in' })
    expect(stepZoomView(v, 1 / 60, 0)).toBe(FEEL.zoomMax)
  })
})

describe('persistent zoom (neural profile: zoomPersist=true)', () => {
  beforeEach(() => {
    FEEL.zoomPersist = true
    FEEL.zoomCommitsDrill = false
    FEEL.zoomMin = 0.2
    FEEL.zoomMax = 12
  })

  it('a released zoom is kept - no spring-back to 1.0', () => {
    const v = createZoomView()
    applyZoomEvent(v, { type: 'zoom', phase: 'engage', factor: 1, commit: 'none' })
    applyZoomEvent(v, { type: 'zoom', phase: 'update', factor: 1.8, commit: 'none' })
    expect(stepZoomView(v, 1 / 60, 1)).toBeCloseTo(1.8, 6)
    applyZoomEvent(v, { type: 'zoom', phase: 'end', factor: 1.8, commit: 'none' })
    let f = 0
    for (let i = 0; i < 120; i++) f = stepZoomView(v, 1 / 60, 1) // two seconds
    expect(f).toBeCloseTo(1.8, 6)
    expect(v.base).toBeCloseTo(1.8, 6)
    expect(v.hand).toBe(1)
  })

  it('gestures compound: the second zoom multiplies onto the first', () => {
    const v = createZoomView()
    const gesture = (peak: number) => {
      applyZoomEvent(v, { type: 'zoom', phase: 'engage', factor: 1, commit: 'none' })
      applyZoomEvent(v, { type: 'zoom', phase: 'update', factor: peak, commit: 'none' })
      stepZoomView(v, 1 / 60, 1)
      applyZoomEvent(v, { type: 'zoom', phase: 'end', factor: peak, commit: 'none' })
      return stepZoomView(v, 1 / 60, 1)
    }
    expect(gesture(2)).toBeCloseTo(2, 6)
    expect(gesture(1.5)).toBeCloseTo(3, 6)
    expect(gesture(0.5)).toBeCloseTo(1.5, 6) // zooming back out compounds the same way
  })

  it('live factor mid-gesture is base x hand, so a new gesture starts from where the last left off', () => {
    const v = createZoomView()
    applyZoomEvent(v, { type: 'zoom', phase: 'update', factor: 2, commit: 'none' })
    applyZoomEvent(v, { type: 'zoom', phase: 'end', factor: 2, commit: 'none' })
    stepZoomView(v, 1 / 60, 1)
    applyZoomEvent(v, { type: 'zoom', phase: 'engage', factor: 1, commit: 'none' })
    expect(stepZoomView(v, 1 / 60, 1)).toBeCloseTo(2, 6) // no jump at engage
    applyZoomEvent(v, { type: 'zoom', phase: 'update', factor: 1.25, commit: 'none' })
    expect(stepZoomView(v, 1 / 60, 1)).toBeCloseTo(2.5, 6)
  })

  it('"infinite within reason": the running base is clamped to [zoomMin, zoomMax]', () => {
    const v = createZoomView()
    for (let i = 0; i < 6; i++) {
      applyZoomEvent(v, { type: 'zoom', phase: 'update', factor: 3, commit: 'none' })
      applyZoomEvent(v, { type: 'zoom', phase: 'end', factor: 3, commit: 'none' })
    }
    expect(stepZoomView(v, 1 / 60, 1)).toBe(FEEL.zoomMax)
    expect(v.base).toBe(FEEL.zoomMax)
    for (let i = 0; i < 12; i++) {
      applyZoomEvent(v, { type: 'zoom', phase: 'update', factor: 0.3, commit: 'none' })
      applyZoomEvent(v, { type: 'zoom', phase: 'end', factor: 0.3, commit: 'none' })
    }
    expect(stepZoomView(v, 1 / 60, 1)).toBe(FEEL.zoomMin)
  })

  it('through the real pipeline: zoomPeekRelease keeps its peak instead of settling to 1', () => {
    const s = run('zoomPeekRelease')
    expect(commits(s)).toHaveLength(0)
    const peak = Math.max(...zooms(s, 'update').map((u) => u.e.factor))
    expect(peak).toBeGreaterThan(1.15)
    const settled = settleView(s)
    expect(Math.abs(settled - 1)).toBeGreaterThan(0.1) // NOT sprung back
    // the last live factor is what the camera keeps
    const updates = zooms(s, 'update')
    expect(settled).toBeCloseTo(updates[updates.length - 1].e.factor, 3)
  })

  it('a full zoomIn dolly runs past the old 2.1 ceiling and never drills', () => {
    const s = run('zoomIn')
    expect(commits(s)).toHaveLength(0)
    expect(Math.max(...zooms(s, 'update').map((u) => u.e.factor))).toBeGreaterThan(2.1)
  })

  it('zoomPersist=false is byte-for-byte the old contract (spring back within 0.02)', () => {
    FEEL.zoomPersist = false
    const s = run('zoomPeekRelease')
    expect(Math.abs(settleView(s) - 1)).toBeLessThan(0.02)
  })
})
